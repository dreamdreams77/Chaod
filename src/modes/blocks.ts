/**
 * BLOCK PARTY — a falling-block puzzle club night. Seven pieces, a fair bag, hold, a ghost, wall
 * kicks and lock delay. Clear the goal number of lines to win; topping out costs a heart and
 * clears the top of the well. The rules live in procgen/blocks.ts.
 *
 * Mutation honoured: BOMB BLOCKS (puzzle + shooter) — every ninth piece is a bomb that blasts the
 * blocks around where it lands. Chaos flags honoured: surge (faster fall), tide (rising garbage), blind (no ghost or next).
 * Controls: arrows move, down soft-drops, up hard-drops, Z / X rotate, C holds a piece.
 * Touch: drag sideways to slide the piece, drag down to soft drop, flick up to hard drop, tap to rotate, tap HOLD to hold.
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import type { DirectorContext } from '../chaos/director.ts';
import { Rng } from '../core/rng.ts';
import {
  Board, COLS, COLORS, HIDDEN, PIECE_COLOR, PieceId, Piece, ROWS, VISIBLE, addGarbage, cellsOf, clearTop, dropDistance, emptyBoard, explode, fallSeconds, fits, fullRows,
  lineScore, lock, moved, nextBag, removeRows, rotated, spawn, stackHeight,
} from '../procgen/blocks.ts';
import { H, W, PAL, backdrop, glow, rect, frame, bar, hearts, clamp } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';

type Phase = 'intro' | 'play' | 'clear' | 'won' | 'lost';

export const CELL = 11;
export const WELL_X = 240 - (COLS * CELL) / 2;
export const WELL_Y = 24;
const LOCK_DELAY = 0.5;
const MAX_LOCK_RESETS = 15;
const DAS = 0.17;
const ARR = 0.045;

export class BlocksMode extends ModeBase {
  id = 'blocks';
  crt = 0.22;
  hp: number;
  phase: Phase = 'intro';
  board: Board = emptyBoard();
  cur: Piece | null = null;
  hold: PieceId | null = null;
  private holdBomb = false;
  private holdUsed = false;
  queue: PieceId[] = [];
  lines = 0;
  score = 0;
  readonly goal: number;
  pieces = 0;
  combo = -1;
  private bagRng: Rng;
  private garbRng: Rng;
  private fallT = 0;
  private lockT = 0;
  private lockResets = 0;
  private dasDir = 0;
  private dasT = 0;
  private clearT = 0;
  private clearRows: number[] = [];
  private introT = 1.8;
  private tideT = 0;
  endT = 0;
  private banner: { text: string; color: string; t: number } | null = null;
  /** Touch drag state (see the header for the scheme). */
  private touch: { x0: number; y0: number; t0: number; col0: number; moved: boolean; flicked: boolean; piece: number } | null = null;
  private touchSoft = false;

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'blocks', opts);
    this.hp = this.stats.maxHp;
    this.applyCarry();
    this.goal = { easy: 24, normal: 30, hard: 40 }[game.settings.difficulty];
    this.bagRng = this.rng.fork(0xb10c);
    this.garbRng = this.rng.fork(0x6a5b);
    const start = { easy: 0, normal: 0, hard: 2 }[game.settings.difficulty] + Math.floor((this.tier - 1) * 4);
    if (start > 0) addGarbage(this.board, this.garbRng, start);
    this.refillQueue();
  }

  enter(): void {
    this.game.music('blocks');
    if (!this.game.profile.lore.includes('blocks_intro')) {
      this.game.profile.lore.push('blocks_intro');
      this.game.say([
        { who: 'manual', name: 'THE MANUAL', text: 'The Core filed a genre under "puzzle night". Seven shapes fall, you fit them, full rows vanish. Clear the goal number of lines to win.' },
        { who: 'manual', name: 'THE MANUAL', text: 'Arrows move, DOWN drops faster, UP drops at once, Z and X rotate, C holds a piece. On a phone: drag to slide, flick up to drop, tap to rotate. Topping out costs a heart.' },
      ]);
    }
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: this.phase === 'play', bossActive: false };
  }

  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  // ---- numbers ---------------------------------------------------------------------
  private get bombEvery(): number {
    return Math.max(3, Math.round(this.fusion.param('bomb_pieces', 'every', 9)));
  }
  /** Level drives the fall speed: lines, difficulty and ENDLESS rounds. */
  get level(): number {
    return Math.max(1, 1 + Math.floor(this.lines / 10) + { easy: -1, normal: 0, hard: 2 }[this.game.settings.difficulty] + Math.floor((this.tier - 1) * 5));
  }
  /** Perks and assist mode make everything gentler (below 1); ENDLESS rounds are already in the level. */
  private get ease(): number {
    return this.diffMult / ({ easy: 0.6, normal: 1, hard: 1.4 }[this.game.settings.difficulty] * this.tier);
  }
  private get fallInterval(): number {
    let s = fallSeconds(this.level) / this.ease;
    if (this.director.flag('surge')) s /= 2.2;
    return s;
  }
  /** The piece's resting row (for the ghost). */
  get ghostY(): number {
    return this.cur ? this.cur.y + dropDistance(this.board, this.cur) : 0;
  }

  private refillQueue(): void {
    while (this.queue.length < 7) this.queue.push(...nextBag(this.bagRng));
  }

  // ---- simulation ------------------------------------------------------------------
  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    this.tickShared(dt);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 1.6) this.banner = null;
    }
    if (this.phase === 'won' || this.phase === 'lost') {
      this.endT += dt;
      if (this.phase === 'won' && this.endT > 2.2) {
        const score = this.score + this.hp * 300 + Math.max(0, 3000 - Math.floor(this.time * 12)) + this.runBits * 10;
        this.finish(true, score);
      } else if (this.phase === 'lost' && this.endT > 1.8) this.finish(false, this.score + this.lines * 20);
      return;
    }
    if (this.phase === 'intro') {
      if (this.game.inDialog) return;
      this.introT -= dt;
      if (this.introT <= 0) {
        this.phase = 'play';
        this.nextPiece();
      }
      return;
    }
    if (this.phase === 'clear') {
      this.clearT -= dt;
      if (this.clearT <= 0) {
        removeRows(this.board, this.clearRows);
        this.clearRows = [];
        if (this.board.every((r) => r.every((c) => c === 0))) {
          this.score += 1000 * this.level;
          this.addBits(10, 240, WELL_Y + 100);
          this.say('PERFECT CLEAR!', '#ffcf3f');
          this.runFlags.add('perfect_clear');
        }
        this.phase = 'play';
        if (this.lines >= this.goal) this.win();
        else this.nextPiece();
      }
      return;
    }

    // Rising garbage while the tide event is on.
    if (this.director.flag('tide')) {
      this.tideT += dt;
      if (this.tideT >= 2.8) {
        this.tideT = 0;
        if (addGarbage(this.board, this.garbRng, 1)) this.topOut();
        else if (this.cur && !fits(this.board, this.cur)) this.cur = { ...this.cur, y: this.cur.y - 1 };
      }
    }
    if (!this.cur) return;
    this.handleInput(dt);
    if (!this.cur) return;
    // gravity and lock delay
    const interval = this.touchSoft || this.game.input.held('down') ? Math.min(this.fallInterval, 0.04) : this.fallInterval;
    this.fallT += dt;
    while (this.cur && this.fallT >= interval) {
      this.fallT -= interval;
      const m = moved(this.board, this.cur, 0, 1);
      if (m) {
        this.cur = m;
        this.lockT = 0;
        if (interval < this.fallInterval) this.score += 1;
      } else break;
    }
    if (this.cur && !moved(this.board, this.cur, 0, 1)) {
      this.lockT += dt;
      if (this.lockT >= LOCK_DELAY) this.lockPiece();
    }
  }

  private handleInput(dt: number): void {
    const inp = this.game.input;
    if (!this.cur) return;
    const dir = (inp.held('left') ? -1 : 0) + (inp.held('right') ? 1 : 0);
    if (dir !== this.dasDir) {
      this.dasDir = dir;
      this.dasT = 0;
      if (dir) this.shift(dir);
    } else if (dir) {
      this.dasT += dt;
      if (this.dasT >= DAS) {
        this.dasT -= ARR;
        this.shift(dir);
      }
    }
    if (inp.pressed('jump') || inp.pressed('confirm')) this.rotate(1);
    if (inp.pressed('attack')) this.rotate(-1);
    if (inp.pressed('special')) this.holdPiece();
    if (inp.pressed('up')) this.hardDrop();
  }

  shift(dx: number): boolean {
    if (!this.cur) return false;
    const m = moved(this.board, this.cur, dx, 0);
    if (!m) return false;
    this.cur = m;
    this.onMoved();
    return true;
  }

  rotate(dir: 1 | -1): boolean {
    if (!this.cur || this.phase !== 'play') return false;
    const r = rotated(this.board, this.cur, dir);
    if (!r) return false;
    this.cur = r;
    this.game.audio.sfx('select');
    this.onMoved();
    return true;
  }

  /** A successful slide or turn on the ground buys a little more time, up to a limit. */
  private onMoved(): void {
    if (this.cur && !moved(this.board, this.cur, 0, 1) && this.lockResets < MAX_LOCK_RESETS) {
      this.lockT = 0;
      this.lockResets++;
    }
  }

  hardDrop(): void {
    if (!this.cur || this.phase !== 'play') return;
    const d = dropDistance(this.board, this.cur);
    this.cur = { ...this.cur, y: this.cur.y + d };
    this.score += 2 * d;
    this.game.audio.sfx('land');
    this.lockPiece();
  }

  holdPiece(): void {
    if (!this.cur || this.holdUsed || this.phase !== 'play') return;
    const id = this.cur.id;
    const bomb = !!this.cur.bomb;
    if (this.hold) {
      const swapped = spawn(this.hold, this.holdBomb);
      if (!fits(this.board, swapped)) return;
      this.hold = id;
      this.holdBomb = bomb;
      this.cur = swapped;
      this.resetFall();
    } else {
      this.hold = id;
      this.holdBomb = bomb;
      this.cur = null;
      this.nextPiece(true);
    }
    this.holdUsed = true;
    this.game.audio.sfx('select');
  }

  private resetFall(): void {
    this.fallT = 0;
    this.lockT = 0;
    this.lockResets = 0;
  }

  /** Brings in the next piece; a blocked spawn is a top-out. `fromHold` keeps the hold lock. */
  private nextPiece(fromHold = false): void {
    this.refillQueue();
    const id = this.queue.shift()!;
    this.pieces++;
    const bomb = this.fusion.has('bomb_pieces') && this.pieces % this.bombEvery === 0;
    const p = spawn(id, bomb);
    if (!fromHold) this.holdUsed = false;
    this.resetFall();
    if (!fits(this.board, p)) {
      this.cur = null;
      this.topOut();
      return;
    }
    this.cur = p;
    // pieces start falling right away if they can
  }

  private lockPiece(): void {
    const p = this.cur;
    if (!p) return;
    this.cur = null;
    const above = lock(this.board, p);
    this.game.audio.sfx('land');
    if (p.bomb) {
      const cells = cellsOf(p);
      const low = cells.reduce((a, c) => (c[1] > a[1] ? c : a), cells[0]);
      const n = explode(this.board, low[0], low[1]);
      if (n > 0) {
        this.game.audio.sfx('explode');
        this.game.fx.shake(3);
        this.particles.burst(WELL_X + low[0] * CELL, WELL_Y + (low[1] - HIDDEN) * CELL, ['#ff9f3f', '#fff', '#ff3f5a'], 20, 110);
        this.score += n * 10;
        this.addBits(Math.ceil(n / 4), WELL_X + low[0] * CELL, WELL_Y + (low[1] - HIDDEN) * CELL - 8);
      }
    }
    if (above) {
      this.topOut();
      return;
    }
    const rows = fullRows(this.board);
    if (rows.length === 0) {
      this.combo = -1;
      this.nextPiece();
      return;
    }
    this.combo++;
    this.lines += rows.length;
    const pts = lineScore(rows.length, this.level) + (this.combo > 0 ? 50 * this.combo * this.level : 0);
    this.score += pts;
    this.addBits(rows.length >= 4 ? 12 : rows.length, 240, WELL_Y + (rows[0] - HIDDEN) * CELL);
    this.director.feed(rows.length * 3);
    this.game.audio.sfx(rows.length >= 4 ? 'levelup' : 'coin');
    if (rows.length >= 4) {
      this.say('QUAD CLEAR!', '#3fe0ff');
      this.runFlags.add('quad_clear');
    }
    else if (this.combo >= 2) this.say(`COMBO x${this.combo}`, '#ffcf3f');
    for (const y of rows) this.particles.burst(240, WELL_Y + (y - HIDDEN) * CELL + 5, [COLORS[1 + (y % 7)], '#fff'], 8, 90);
    if (this.lines >= 10 && !this.foundFloppies.includes('blocks-0')) this.collectFloppy(0);
    if (this.lines >= 20 && !this.foundFloppies.includes('blocks-1')) this.collectFloppy(1);
    this.clearRows = rows;
    this.clearT = 0.28;
    this.phase = 'clear';
  }

  private win(): void {
    this.phase = 'won';
    this.endT = 0;
    this.cur = null;
    if (!this.foundFloppies.includes('blocks-2')) this.collectFloppy(2);
    this.addBits(40);
    this.say('PARTY CLEARED!', '#7dff6b');
    this.game.audio.sfx('levelup');
    this.game.fx.flash('#7dff6b', 0.35);
  }

  /** A full well: lose a heart and the top of the stack, or the night if that was the last heart. */
  topOut(): void {
    const dmg = this.takenMult;
    this.hp = Math.max(0, this.hp - dmg);
    this.noteDamage(dmg);
    this.cur = null;
    this.director.clearAll();
    if (this.hp <= 0) {
      this.phase = 'lost';
      this.endT = 0;
      this.game.audio.sfx('explode');
      this.say('GAME OVER', '#ff3f5a');
      return;
    }
    clearTop(this.board, 12);
    this.say('WELL CLEARED!', '#ff6f3f');
    this.game.audio.sfx('powerup');
    this.phase = 'play';
    this.nextPiece();
  }

  private say(text: string, color: string): void {
    this.banner = { text, color, t: 0 };
  }

  // ---- touch -----------------------------------------------------------------------
  tap(x: number, y: number): boolean {
    this.touch = { x0: x, y0: y, t0: this.time, col0: this.cur?.x ?? 0, moved: false, flicked: false, piece: this.pieces };
    return true;
  }

  drag(x: number, y: number): void {
    const t = this.touch;
    if (!t || !this.cur || this.phase !== 'play') return;
    // A new piece (or one that arrived while the finger was already down) is anchored where the finger is now.
    if (t.piece !== this.pieces) {
      t.piece = this.pieces;
      t.x0 = x;
      t.y0 = y;
      t.col0 = this.cur.x;
      t.flicked = false;
      t.moved = true;
    }
    const dx = x - t.x0;
    const dy = y - t.y0;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) t.moved = true;
    // Slide to the column under the finger's travel, one step at a time so walls and the stack still count.
    const target = t.col0 + Math.round(dx / (CELL + 3));
    let guard = 0;
    while (this.cur && this.cur.x !== target && guard++ < COLS && this.shift(Math.sign(target - this.cur.x))) {
      /* keep stepping */
    }
    this.touchSoft = dy > 28 && Math.abs(dy) > Math.abs(dx);
    if (dy < -46 && Math.abs(dy) > Math.abs(dx) && !t.flicked) {
      t.flicked = true;
      this.hardDrop();
    }
  }

  dragEnd(): void {
    const t = this.touch;
    this.touch = null;
    this.touchSoft = false;
    if (!t || this.phase !== 'play') return;
    if (!t.moved && this.time - t.t0 < 0.35) {
      // A short tap: HOLD if it lands on the hold box, otherwise rotate.
      if (t.x0 < WELL_X - 8 && t.y0 > 30 && t.y0 < 86) this.holdPiece();
      else this.rotate(1);
    }
  }

  // ---- drawing ---------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const pal = PAL.blocks;
    backdrop(ctx, pal.bg0, pal.bg1);
    this.drawParty(ctx);
    this.drawWell(ctx);
    this.drawSide(ctx);
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    this.drawHud(ctx);
  }

  /** Disco lights behind the well that react to clears. */
  private drawParty(ctx: CanvasRenderingContext2D): void {
    const t = this.time;
    for (let i = 0; i < 5; i++) {
      const x = 60 + i * 90 + Math.sin(t * 0.7 + i) * 24;
      const hue = ['255,63,164', '63,224,255', '255,207,63', '125,255,107', '176,122,255'][i];
      ctx.globalAlpha = 0.5;
      glow(ctx, x, 40 + Math.sin(t + i * 2) * 8, 80, hue, 0.12 + (this.phase === 'clear' ? 0.1 : 0));
      ctx.globalAlpha = 1;
    }
    for (let y = 30; y < H - 20; y += 20) rect(ctx, 0, y, W, 1, 'rgba(255,255,255,0.03)');
  }

  private cellRect(ctx: CanvasRenderingContext2D, x: number, y: number, color: number, alpha = 1): void {
    const px = WELL_X + x * CELL;
    const py = WELL_Y + (y - HIDDEN) * CELL;
    if (py < WELL_Y - 1) return;
    ctx.globalAlpha = alpha;
    const c = COLORS[color];
    rect(ctx, px, py, CELL - 1, CELL - 1, c);
    rect(ctx, px, py, CELL - 1, 2, 'rgba(255,255,255,0.45)');
    rect(ctx, px, py, 2, CELL - 1, 'rgba(255,255,255,0.25)');
    rect(ctx, px, py + CELL - 3, CELL - 1, 2, 'rgba(0,0,0,0.3)');
    ctx.globalAlpha = 1;
  }

  private drawWell(ctx: CanvasRenderingContext2D): void {
    const x0 = WELL_X, y0 = WELL_Y;
    rect(ctx, x0 - 3, y0 - 3, COLS * CELL + 6, VISIBLE * CELL + 6, '#2a1650');
    rect(ctx, x0 - 1, y0 - 1, COLS * CELL + 2, VISIBLE * CELL + 2, '#05020d');
    for (let x = 1; x < COLS; x++) rect(ctx, x0 + x * CELL - 1, y0, 1, VISIBLE * CELL, 'rgba(255,255,255,0.04)');
    for (let y = 1; y < VISIBLE; y++) rect(ctx, x0, y0 + y * CELL - 1, COLS * CELL, 1, 'rgba(255,255,255,0.04)');
    for (let y = HIDDEN; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (this.board[y][x]) this.cellRect(ctx, x, y, this.board[y][x]);
    if (this.cur) {
      const blind = this.director.flag('blind');
      if (!blind) {
        const gy = this.ghostY;
        for (const [cx, cy] of cellsOf({ ...this.cur, y: gy })) this.cellRect(ctx, cx, cy, 8, 0.28);
      }
      const color = this.cur.bomb ? 7 : PIECE_COLOR[this.cur.id];
      for (const [cx, cy] of cellsOf(this.cur)) {
        this.cellRect(ctx, cx, cy, color);
        if (this.cur.bomb && cy >= HIDDEN) rect(ctx, WELL_X + cx * CELL + 3, WELL_Y + (cy - HIDDEN) * CELL + 3, 4, 4, Math.floor(this.time * 6) % 2 ? '#fff' : '#ff3f5a');
      }
    }
    // Flashing rows while they clear.
    if (this.phase === 'clear') {
      ctx.globalAlpha = 0.5 + Math.sin(this.time * 30) * 0.3;
      for (const y of this.clearRows) rect(ctx, x0, y0 + (y - HIDDEN) * CELL, COLS * CELL, CELL - 1, '#ffffff');
      ctx.globalAlpha = 1;
    }
    // Danger line when the stack gets close to the top.
    if (stackHeight(this.board) >= VISIBLE - 4 && this.phase === 'play') {
      ctx.globalAlpha = 0.25 + Math.sin(this.time * 6) * 0.15;
      rect(ctx, x0, y0, COLS * CELL, 2, '#ff3f5a');
      ctx.globalAlpha = 1;
    }
  }

  private drawMini(ctx: CanvasRenderingContext2D, id: PieceId, cx: number, cy: number, size = 7, alpha = 1): void {
    const cells = cellsOf({ id, rot: 0, x: 0, y: 0 });
    const minX = Math.min(...cells.map((c) => c[0]));
    const maxX = Math.max(...cells.map((c) => c[0]));
    const minY = Math.min(...cells.map((c) => c[1]));
    const maxY = Math.max(...cells.map((c) => c[1]));
    const ox = cx - ((maxX - minX + 1) * size) / 2;
    const oy = cy - ((maxY - minY + 1) * size) / 2;
    ctx.globalAlpha = alpha;
    for (const [x, y] of cells) {
      const px = ox + (x - minX) * size, py = oy + (y - minY) * size;
      rect(ctx, px, py, size - 1, size - 1, COLORS[PIECE_COLOR[id]]);
      rect(ctx, px, py, size - 1, 1, 'rgba(255,255,255,0.4)');
    }
    ctx.globalAlpha = 1;
  }

  private drawSide(ctx: CanvasRenderingContext2D): void {
    const blind = this.director.flag('blind');
    // HOLD on the left, NEXT on the right
    frame(ctx, WELL_X - 82, 30, 62, 50, '#150d2a', '#3a3050');
    drawText(ctx, 'HOLD', WELL_X - 51, 34, '#9a9ab8', { align: 'center' });
    if (this.hold) this.drawMini(ctx, this.hold, WELL_X - 51, 60, 8, this.holdUsed ? 0.4 : 1);
    frame(ctx, WELL_X + COLS * CELL + 20, 30, 62, 124, '#150d2a', '#3a3050');
    drawText(ctx, 'NEXT', WELL_X + COLS * CELL + 51, 34, '#9a9ab8', { align: 'center' });
    if (blind) drawText(ctx, '???', WELL_X + COLS * CELL + 51, 90, '#ff3f5a', { align: 'center' });
    else for (let i = 0; i < 4; i++) this.drawMini(ctx, this.queue[i] ?? 'I', WELL_X + COLS * CELL + 51, 56 + i * 28, i === 0 ? 8 : 6, i === 0 ? 1 : 0.8);
    // stats
    const sx = WELL_X - 82;
    drawText(ctx, 'LINES', sx, 96, '#9a9ab8');
    drawText(ctx, `${this.lines}/${this.goal}`, sx, 106, '#7dff6b');
    bar(ctx, sx, 118, 62, 4, this.lines / this.goal, '#7dff6b', '#102010', '#ffffff55');
    drawText(ctx, 'LEVEL', sx, 130, '#9a9ab8');
    drawText(ctx, `${this.level}`, sx, 140, '#3fe0ff');
    drawText(ctx, 'SCORE', sx, 154, '#9a9ab8');
    drawText(ctx, `${this.score}`, sx, 164, '#fff');
    drawText(ctx, 'BITS', sx, 178, '#9a9ab8');
    drawText(ctx, `${this.runBits}`, sx, 188, '#ffcf3f');
    if (this.combo >= 1) drawText(ctx, `COMBO ${this.combo}`, sx, 202, '#ffcf3f');
    if (this.fusion.has('bomb_pieces')) {
      const left = this.bombEvery - (this.pieces % this.bombEvery);
      const bombNow = this.cur?.bomb || this.hold !== null && this.holdBomb;
      drawText(ctx, this.cur?.bomb ? 'BOMB NOW!' : `BOMB IN ${left === this.bombEvery ? this.bombEvery : left}`, WELL_X + COLS * CELL + 20, 160, bombNow ? '#ff3f5a' : '#ff9f3f');
    }
    this.drawRunInfo(ctx, WELL_X + COLS * CELL + 20, 174);
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    hearts(ctx, 6, 6, this.hp, this.stats.maxHp);
    this.drawChaosHud(ctx, W - 106, 6);
    if (this.phase === 'intro') drawText(ctx, 'GET READY', 240, 120, '#ffcf3f', { align: 'center', scale: 3 });
    if (this.banner) {
      const a = this.banner.t < 0.15 ? this.banner.t / 0.15 : this.banner.t > 1.3 ? 1 - (this.banner.t - 1.3) / 0.3 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      drawText(ctx, this.banner.text, 240, 96, this.banner.color, { align: 'center', scale: 2 });
      ctx.globalAlpha = 1;
    }
    this.drawHint(ctx, 'ARROWS MOVE • UP DROP • Z X ROTATE • C HOLD', 'DRAG: SLIDE • DRAG DOWN: SOFT DROP • FLICK UP: DROP • TAP: ROTATE');
    this.drawSeed(ctx);
  }
}
