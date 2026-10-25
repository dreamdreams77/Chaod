/**
 * Lobby mini-games: CART CATCH (reflex) and GLITCH MEMORY (pattern recall).
 * Small self-contained scenes; results flow through applyMini so bits, personal
 * bests and quests are handled (and tested) in one place.
 */
import type { Game, Scene } from '../game.ts';
import { H, W, PAL, Particles, Popups, backdrop, glow, rect, frame, bar, clamp } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { drawCass, drawFloppy, drawBit } from '../render/actors.ts';
import { MiniId, MINIS } from '../data/quests.ts';
import { MiniOutcome, applyMini } from '../data/progression.ts';
import { Rng } from '../core/rng.ts';

export function startMini(game: Game, id: MiniId): void {
  game.goto(id === 'catch' ? new CatchScene(game) : id === 'breakout' ? new BreakoutScene(game) : new MemoryScene(game));
}

abstract class MiniBase implements Scene {
  abstract id: string;
  crt = 0.3;
  protected t = 0;
  protected over = false;
  protected overT = 0;
  protected score = 0;
  protected outcome: MiniOutcome | null = null;
  protected readonly particles = new Particles(200);
  protected readonly popups = new Popups();
  protected abstract readonly miniId: MiniId;
  constructor(protected game: Game) {}

  enter(): void {
    this.game.music('hub');
  }

  /** Ends the game exactly once: pays out, saves and announces finished quests. */
  protected finish(): void {
    if (this.over) return;
    this.over = true;
    const { profile, outcome } = applyMini(this.game.profile, this.miniId, this.score);
    this.game.profile = profile;
    this.game.saveProfile();
    this.outcome = outcome;
    this.game.announceAchievements(outcome.achievements);
    for (const q of outcome.quests) this.game.toast('QUEST COMPLETE', q.title, '#ffcf3f');
    this.game.audio.sfx(outcome.best ? 'levelup' : 'powerup');
  }

  /** Handles the end-of-game panel; returns true while it is showing. */
  protected updateOver(dt: number): boolean {
    if (!this.over) return false;
    this.overT += dt;
    this.particles.update(dt);
    this.popups.update(dt);
    const inp = this.game.input;
    if (this.overT > 0.5 && (inp.pressed('confirm') || inp.pressed('jump'))) startMini(this.game, this.miniId);
    else if (this.overT > 0.5 && (inp.pressed('back') || inp.pressed('attack'))) this.game.toHub();
    return true;
  }

  protected drawOver(ctx: CanvasRenderingContext2D, unit: string): void {
    if (!this.over || !this.outcome) return;
    rect(ctx, 0, 0, W, H, 'rgba(5,2,13,0.65)');
    frame(ctx, W / 2 - 110, 70, 220, 124, '#1d1233', '#3fe0ff');
    const info = MINIS.find((m) => m.id === this.miniId)!;
    drawText(ctx, info.title, W / 2, 80, '#3fe0ff', { align: 'center', scale: 2 });
    drawText(ctx, `${this.score} ${unit}`, W / 2, 104, '#fff', { align: 'center', scale: 2 });
    if (this.outcome.best) drawText(ctx, 'NEW PERSONAL BEST!', W / 2, 124, '#7dff6b', { align: 'center' });
    else drawText(ctx, `BEST ${this.game.profile.mini[this.miniId]?.best ?? 0}`, W / 2, 124, '#9a9ab8', { align: 'center' });
    drawText(ctx, `+${this.outcome.bits} BITS`, W / 2, 138, '#ffcf3f', { align: 'center' });
    this.outcome.quests.forEach((q, i) => drawText(ctx, `QUEST: ${q.title}  +${q.bits}`, W / 2, 152 + i * 10, '#ffcf3f', { align: 'center' }));
    const row = 172;
    drawText(ctx, this.game.input.label('Z: PLAY AGAIN   X: LOBBY'), W / 2, row, '#ccc', { align: 'center' });
  }

  /** Shared arcade-room backdrop: gradient, light pools and a receding floor grid. */
  protected drawBackdrop(ctx: CanvasRenderingContext2D, accent: string): void {
    backdrop(ctx, '#05020d', '#1d0f33');
    glow(ctx, W / 2, 60, 200, accent, 0.18 + Math.sin(this.t * 2) * 0.03);
    ctx.strokeStyle = 'rgba(255,63,164,0.18)';
    for (let i = -9; i <= 9; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * 14, 150);
      ctx.lineTo(W / 2 + i * 70, H);
      ctx.stroke();
    }
    for (let i = 0; i < 9; i++) rect(ctx, 0, 150 + i * i * 1.6 + ((this.t * 14) % 6) * (i / 9), W, 1, 'rgba(255,63,164,0.2)');
  }

  update(_dt: number): void {}
  draw(_ctx: CanvasRenderingContext2D): void {}
}

// ---- CART CATCH ----------------------------------------------------------------------

interface Faller {
  x: number;
  y: number;
  vy: number;
  kind: 'bit' | 'floppy' | 'bug';
}

const CATCH_SECONDS = 30;
const FLOOR_Y = H - 30;

export class CatchScene extends MiniBase {
  id = 'mini-catch';
  protected readonly miniId = 'catch' as const;
  private px = W / 2;
  private facing = 1;
  private moving = false;
  private lives = 3;
  private combo = 0;
  private spawnT = 0.6;
  private hurtT = 0;
  private readonly items: Faller[] = [];
  private readonly rng: Rng;

  constructor(game: Game) {
    super(game);
    // Reward-paying games ignore the fixed-seed setting, otherwise a pattern could be memorised and farmed.
    this.rng = new Rng(game.rng.int(1, 999999));
  }

  update(dt: number): void {
    this.t += dt;
    if (this.updateOver(dt)) return;
    const inp = this.game.input;
    if (inp.pressed('back') || inp.pressed('pause')) {
      // Leaving early ends the round and banks what you have; press again to return to the lobby.
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    const ax = inp.axisX();
    this.moving = ax !== 0;
    if (ax) this.facing = ax;
    this.px = clamp(this.px + ax * 200 * dt, 16, W - 16);

    const left = CATCH_SECONDS - this.t;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const ramp = this.t / CATCH_SECONDS;
      this.spawnT = 0.62 - ramp * 0.28;
      const r = this.rng.next();
      const kind: Faller['kind'] = r < 0.58 ? 'bit' : r < 0.72 ? 'floppy' : 'bug';
      this.items.push({ x: this.rng.range(20, W - 20), y: -10, vy: this.rng.range(70, 100) + ramp * 70, kind });
    }
    for (const it of this.items) {
      it.y += it.vy * dt;
      // Catch zone: the cartridge slot held above Cass's head.
      if (it.y >= FLOOR_Y - 36 && it.y <= FLOOR_Y - 22 && Math.abs(it.x - this.px) < 17) {
        it.y = 999;
        this.catchItem(it);
      } else if (it.y > H + 10) {
        if (it.kind !== 'bug') this.combo = 0;
      }
    }
    for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].y > H + 10) this.items.splice(i, 1);
    if (left <= 0 || this.lives <= 0) this.finish();
  }

  private catchItem(it: Faller): void {
    const a = this.game.audio;
    if (it.kind === 'bug') {
      this.lives--;
      this.combo = 0;
      this.hurtT = 0.4;
      a.sfx('hurt');
      this.game.fx.shake(2);
      this.particles.burst(it.x, FLOOR_Y - 30, ['#ff3f3f', '#b07aff'], 14, 90);
      this.popups.add(it.x, FLOOR_Y - 44, 'BUG!', '#ff3f3f');
      return;
    }
    this.combo++;
    const mult = 1 + Math.floor(this.combo / 8);
    const gain = (it.kind === 'floppy' ? 5 : 1) * mult;
    this.score += gain;
    a.sfx(it.kind === 'floppy' ? 'floppy' : 'coin', 1 + Math.min(0.5, this.combo * 0.02));
    this.particles.burst(it.x, FLOOR_Y - 30, it.kind === 'floppy' ? ['#3fe0ff', '#fff'] : ['#ffcf3f', '#fff'], 8, 70);
    this.popups.add(it.x, FLOOR_Y - 44, `+${gain}`, it.kind === 'floppy' ? '#3fe0ff' : '#ffcf3f');
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.drawBackdrop(ctx, '63,224,255');
    for (const it of this.items) {
      // Ground shadow grows as the item nears the floor so the drop is easy to judge.
      ctx.globalAlpha = 0.15 + clamp(it.y / FLOOR_Y, 0, 1) * 0.3;
      rect(ctx, it.x - 6, FLOOR_Y + 1, 12, 3, '#000');
      ctx.globalAlpha = 1;
      if (it.kind === 'bit') drawBit(ctx, it.x, it.y, this.t + it.x);
      else if (it.kind === 'floppy') drawFloppy(ctx, it.x, it.y, this.t);
      else {
        glow(ctx, it.x, it.y, 14, '255,63,63', 0.4);
        rect(ctx, it.x - 6, it.y - 6, 12, 12, '#3a0a14');
        rect(ctx, it.x - 4, it.y - 4, 8, 8, '#ff3f3f');
        rect(ctx, it.x - 3, it.y - 2, 2, 2, '#fff');
        rect(ctx, it.x + 1, it.y - 2, 2, 2, '#fff');
        rect(ctx, it.x - 8, it.y + ((this.t * 20) % 3), 3, 1, '#ff3fd2');
      }
    }
    rect(ctx, 0, FLOOR_Y + 2, W, H - FLOOR_Y, '#120a24');
    rect(ctx, 0, FLOOR_Y + 2, W, 1, PAL.hub.accent);
    // Cass holding the cartridge slot
    const flash = this.hurtT > 0 && Math.floor(this.t * 20) % 2 === 0;
    drawCass(ctx, { x: this.px, y: FLOOR_Y + 2, facing: this.facing, pose: this.moving ? 'run' : 'idle', t: this.t, flash }, this.game.profile.character);
    rect(ctx, this.px - 15, FLOOR_Y - 36, 30, 3, '#3fe0ff');
    rect(ctx, this.px - 15, FLOOR_Y - 36, 3, 8, '#3fe0ff');
    rect(ctx, this.px + 12, FLOOR_Y - 36, 3, 8, '#3fe0ff');
    rect(ctx, this.px - 12, FLOOR_Y - 35, 24, 1, '#ffffff66');
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    // HUD
    const left = Math.max(0, CATCH_SECONDS - this.t);
    drawText(ctx, `SCORE ${this.score}`, 8, 8, '#ffcf3f');
    drawText(ctx, `COMBO ${this.combo}${this.combo >= 8 ? ' x' + (1 + Math.floor(this.combo / 8)) : ''}`, 8, 18, '#3fe0ff');
    for (let i = 0; i < 3; i++) drawText(ctx, '♥', W - 40 + i * 9, 8, i < this.lives ? '#ff3f6b' : '#40303a');
    bar(ctx, W / 2 - 50, 8, 100, 5, left / CATCH_SECONDS, left < 8 ? '#ff3f3f' : '#7dff6b', '#102010', '#ffffff55');
    drawText(ctx, `${Math.ceil(left)}`, W / 2, 16, '#fff', { align: 'center' });
    if (this.t < 3) drawText(ctx, this.game.input.label('ARROWS MOVE • CATCH BITS AND FLOPPIES • DODGE RED BUGS'), W / 2, H - 14, '#fff', { align: 'center' });
    this.drawOver(ctx, 'PTS');
  }
}

// ---- BYTE BREAKOUT -------------------------------------------------------------------

const BR_COLS = 10;
const BR_ROWS = 5;
const BR_W = 44;
const BR_H = 12;
const BR_X0 = (W - BR_COLS * BR_W) / 2;
const BR_Y0 = 40;
const BR_COLORS = ['#ff3fd2', '#ff6f3f', '#ffcf3f', '#7dff6b', '#3fe0ff'];
const PADDLE_Y = H - 26;
const BREAKOUT_SECONDS = 90;

interface Brick {
  hp: number;
  alive: boolean;
}

export class BreakoutScene extends MiniBase {
  id = 'mini-breakout';
  protected readonly miniId = 'breakout' as const;
  private px = W / 2;
  private pw = 56;
  private bx = W / 2;
  private by = PADDLE_Y - 6;
  private bvx = 0;
  private bvy = 0;
  private stuck = true;
  private stuckT = 0;
  private lives = 3;
  private speed = 150;
  private destroyed = 0;
  private trail: Array<{ x: number; y: number }> = [];
  private readonly bricks: Brick[][];
  private readonly rng: Rng;

  constructor(game: Game) {
    super(game);
    // Private stream, like the other reward games, so a fixed seed cannot make serves repeatable.
    this.rng = new Rng(game.rng.int(1, 999999));
    // Top row takes two hits, so the wall rewards aiming for it.
    this.bricks = Array.from({ length: BR_ROWS }, (_, r) => Array.from({ length: BR_COLS }, () => ({ hp: r === 0 ? 2 : 1, alive: true })));
  }

  private launch(): void {
    this.stuck = false;
    const a = -Math.PI / 2 + (this.rng.next() - 0.5) * 0.7;
    // Serves after a lost life restart slower than the ramped-up rally speed.
    const v = Math.min(this.speed, 185);
    this.bvx = Math.cos(a) * v;
    this.bvy = Math.sin(a) * v;
    this.game.audio.sfx('select', 1.3);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.updateOver(dt)) return;
    const inp = this.game.input;
    if (inp.pressed('back') || inp.pressed('pause')) {
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    this.px = clamp(this.px + inp.axisX() * 270 * dt, this.pw / 2, W - this.pw / 2);
    if (this.stuck) {
      this.bx = this.px;
      this.by = PADDLE_Y - 6;
      this.stuckT += dt;
      if (inp.pressed('jump') || inp.pressed('confirm') || inp.pressed('attack') || this.stuckT > 3) this.launch();
    } else {
      // Four sub-steps keep a fast ball from tunnelling through a brick.
      const steps = 4;
      for (let i = 0; i < steps && !this.over && !this.stuck; i++) this.stepBall(dt / steps);
      this.trail.push({ x: this.bx, y: this.by });
      if (this.trail.length > 8) this.trail.shift();
    }
    if (this.t >= BREAKOUT_SECONDS || this.remaining() === 0) this.finish();
  }

  private remaining(): number {
    let n = 0;
    for (const row of this.bricks) for (const b of row) if (b.alive) n++;
    return n;
  }

  private stepBall(dt: number): void {
    this.bx += this.bvx * dt;
    this.by += this.bvy * dt;
    if (this.bx < 4) { this.bx = 4; this.bvx = Math.abs(this.bvx); }
    if (this.bx > W - 4) { this.bx = W - 4; this.bvx = -Math.abs(this.bvx); }
    if (this.by < 4) { this.by = 4; this.bvy = Math.abs(this.bvy); }
    // Paddle: where the ball lands steers it (edges bounce wide, centre goes straight up).
    if (this.bvy > 0 && this.by >= PADDLE_Y - 4 && this.by <= PADDLE_Y + 3 && Math.abs(this.bx - this.px) <= this.pw / 2 + 3) {
      const off = clamp((this.bx - this.px) / (this.pw / 2), -1, 1);
      const a = -Math.PI / 2 + off * 1.0;
      this.bvx = Math.cos(a) * this.speed;
      this.bvy = Math.sin(a) * this.speed;
      this.by = PADDLE_Y - 5;
      this.game.audio.sfx('step', 1.2);
    }
    // Bricks
    const col = Math.floor((this.bx - BR_X0) / BR_W);
    const row = Math.floor((this.by - BR_Y0) / BR_H);
    if (row >= 0 && row < BR_ROWS && col >= 0 && col < BR_COLS) {
      const b = this.bricks[row][col];
      if (b.alive) {
        // Bounce on the axis the ball is nearer to the brick's edge on.
        const cx = BR_X0 + col * BR_W + BR_W / 2;
        const cy = BR_Y0 + row * BR_H + BR_H / 2;
        const dx = Math.abs(this.bx - cx) / (BR_W / 2);
        const dy = Math.abs(this.by - cy) / (BR_H / 2);
        if (dx > dy) this.bvx = (this.bx > cx ? 1 : -1) * Math.abs(this.bvx);
        else this.bvy = (this.by > cy ? 1 : -1) * Math.abs(this.bvy);
        b.hp--;
        const color = BR_COLORS[row];
        if (b.hp <= 0) {
          b.alive = false;
          const gain = row === 0 ? 2 : 1;
          this.score += gain;
          this.particles.burst(cx, cy, [color, '#fff'], 10, 80);
          this.popups.add(cx, cy - 4, `+${gain}`, color);
          this.game.audio.sfx('coin', 0.8 + row * 0.12);
          // The ball speeds up as the wall thins, up to a cap.
          this.destroyed++;
          this.speed = Math.min(235, 150 + this.destroyed * 2.2);
          const mag = Math.hypot(this.bvx, this.bvy) || 1;
          this.bvx = (this.bvx / mag) * this.speed;
          this.bvy = (this.bvy / mag) * this.speed;
        } else this.game.audio.sfx('hit', 1.5);
      }
    }
    if (this.by > H + 6) {
      this.lives--;
      this.stuck = true;
      this.stuckT = 0;
      this.bx = this.px;
      this.by = PADDLE_Y - 6;
      this.bvx = 0;
      this.bvy = 0;
      this.trail.length = 0;
      this.game.audio.sfx('hurt');
      this.game.fx.shake(2);
      if (this.lives <= 0) this.finish();
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.drawBackdrop(ctx, '255,111,63');
    for (let r = 0; r < BR_ROWS; r++) {
      for (let c = 0; c < BR_COLS; c++) {
        const b = this.bricks[r][c];
        if (!b.alive) continue;
        const x = BR_X0 + c * BR_W, y = BR_Y0 + r * BR_H, color = BR_COLORS[r];
        rect(ctx, x + 2, y + 3, BR_W - 2, BR_H - 2, 'rgba(0,0,0,0.35)');
        rect(ctx, x + 1, y + 1, BR_W - 2, BR_H - 2, color);
        rect(ctx, x + 1, y + 1, BR_W - 2, 2, 'rgba(255,255,255,0.45)');
        rect(ctx, x + 1, y + BR_H - 3, BR_W - 2, 2, 'rgba(0,0,0,0.25)');
        if (b.hp > 1) rect(ctx, x + 3, y + 5, BR_W - 6, 2, 'rgba(255,255,255,0.7)');
      }
    }
    // Ball trail and ball
    for (let i = 0; i < this.trail.length; i++) {
      ctx.globalAlpha = (i + 1) / this.trail.length * 0.35;
      rect(ctx, this.trail[i].x - 2, this.trail[i].y - 2, 4, 4, '#3fe0ff');
    }
    ctx.globalAlpha = 1;
    glow(ctx, this.bx, this.by, 14, '63,224,255', 0.45);
    rect(ctx, this.bx - 3, this.by - 3, 6, 6, '#ffffff');
    // Paddle shadow + cartridge paddle
    rect(ctx, this.px - this.pw / 2 + 2, PADDLE_Y + 6, this.pw, 4, 'rgba(0,0,0,0.4)');
    rect(ctx, this.px - this.pw / 2, PADDLE_Y, this.pw, 7, '#2a2a3a');
    rect(ctx, this.px - this.pw / 2, PADDLE_Y, this.pw, 2, '#c0c0d0');
    rect(ctx, this.px - 8, PADDLE_Y + 2, 16, 4, '#ff3fa4');
    for (let i = 0; i < 5; i++) rect(ctx, this.px - 12 + i * 5, PADDLE_Y + 6, 2, 2, '#ffcf3f');
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    const left = Math.max(0, BREAKOUT_SECONDS - this.t);
    drawText(ctx, `SCORE ${this.score}`, 8, 8, '#ffcf3f');
    for (let i = 0; i < 3; i++) drawText(ctx, '\u2665', W - 40 + i * 9, 8, i < this.lives ? '#ff3f6b' : '#40303a');
    bar(ctx, W / 2 - 50, 8, 100, 5, left / BREAKOUT_SECONDS, left < 15 ? '#ff3f3f' : '#7dff6b', '#102010', '#ffffff55');
    if (this.stuck && !this.over) drawText(ctx, this.game.input.label('Z LAUNCHES THE BALL (AUTO IN 3S)'), W / 2, PADDLE_Y - 30, '#fff', { align: 'center' });
    if (this.t < 4) drawText(ctx, this.game.input.label('ARROWS MOVE \u2022 TOP ROW TAKES TWO HITS \u2022 ESC ENDS THE ROUND'), W / 2, H - 12, '#fff', { align: 'center' });
    this.drawOver(ctx, 'PTS');
  }
}

// ---- GLITCH MEMORY -------------------------------------------------------------------

const PADS = [
  { action: 'left' as const, arrow: '←', color: '#ff3fd2', x: W / 2 - 90 },
  { action: 'down' as const, arrow: '↓', color: '#3fe0ff', x: W / 2 - 30 },
  { action: 'up' as const, arrow: '↑', color: '#7dff6b', x: W / 2 + 30 },
  { action: 'right' as const, arrow: '→', color: '#ffcf3f', x: W / 2 + 90 },
];

type MemPhase = 'ready' | 'show' | 'input' | 'cheer';

export class MemoryScene extends MiniBase {
  id = 'mini-memory';
  protected readonly miniId = 'memory' as const;
  private readonly rng: Rng;
  private seq: number[] = [];
  private phase: MemPhase = 'ready';
  private timer = 1;
  private showIndex = 0;
  private inputIndex = 0;
  private lit = -1;
  private litT = 0;
  private wrongT = 0;

  constructor(game: Game) {
    super(game);
    // Reward-paying games ignore the fixed-seed setting, otherwise a pattern could be memorised and farmed.
    this.rng = new Rng(game.rng.int(1, 999999));
  }

  private nextRound(): void {
    // Round n has n + 2 steps, so round 1 is a gentle three.
    this.seq.push(this.rng.int(0, 3));
    while (this.seq.length < this.score + 3) this.seq.push(this.rng.int(0, 3));
    this.phase = 'show';
    this.showIndex = 0;
    this.timer = 0.7;
    this.inputIndex = 0;
  }

  private flash(i: number, secs = 0.28): void {
    this.lit = i;
    this.litT = secs;
    this.game.audio.sfx('select', 0.8 + i * 0.18);
    this.particles.burst(PADS[i].x, 150, [PADS[i].color, '#fff'], 8, 60);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.updateOver(dt)) return;
    const inp = this.game.input;
    if (inp.pressed('back') || inp.pressed('pause')) {
      // Leaving early ends the round and banks what you have; press again to return to the lobby.
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    this.litT = Math.max(0, this.litT - dt);
    if (this.litT === 0) this.lit = -1;
    this.wrongT = Math.max(0, this.wrongT - dt);
    this.timer -= dt;

    if (this.phase === 'ready' && this.timer <= 0) this.nextRound();
    else if (this.phase === 'show' && this.timer <= 0) {
      if (this.showIndex < this.seq.length) {
        this.flash(this.seq[this.showIndex++], 0.34);
        this.timer = Math.max(0.34, 0.62 - this.score * 0.03);
      } else {
        this.phase = 'input';
        this.timer = 0;
      }
    } else if (this.phase === 'input') {
      for (let i = 0; i < PADS.length; i++) {
        if (!inp.pressed(PADS[i].action)) continue;
        if (this.seq[this.inputIndex] === i) {
          this.flash(i, 0.2);
          this.inputIndex++;
          if (this.inputIndex >= this.seq.length) {
            this.score++;
            this.phase = 'cheer';
            this.timer = 0.9;
            this.game.audio.sfx('powerup');
            this.popups.add(W / 2, 116, `ROUND ${this.score} CLEAR!`, '#7dff6b');
          }
        } else {
          this.wrongT = 0.5;
          this.game.audio.sfx('miss');
          this.game.fx.shake(3);
          this.finish();
        }
        break;
      }
    } else if (this.phase === 'cheer' && this.timer <= 0) this.nextRound();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.drawBackdrop(ctx, '255,63,210');
    drawText(ctx, 'GLITCH MEMORY', W / 2, 20, '#ff3fd2', { align: 'center', scale: 2 });
    const prompt = this.phase === 'show' ? 'WATCH...' : this.phase === 'input' ? 'YOUR TURN!' : this.phase === 'ready' ? 'GET READY' : '';
    drawText(ctx, prompt, W / 2, 46, this.phase === 'input' ? '#7dff6b' : '#ffcf3f', { align: 'center' });
    // Progress dots: lit as you echo the pattern back
    const n = this.seq.length;
    for (let i = 0; i < n; i++) {
      const done = this.phase === 'input' ? i < this.inputIndex : this.phase === 'cheer';
      rect(ctx, W / 2 - n * 4 + i * 8, 62, 5, 5, done ? '#7dff6b' : '#ffffff33');
    }
    for (let i = 0; i < PADS.length; i++) {
      const p = PADS[i];
      const on = this.lit === i;
      const y = 130 + (on ? -3 : 0);
      if (on) glow(ctx, p.x, y + 16, 46, hexRgb(p.color), 0.55);
      rect(ctx, p.x - 24, y + 4, 48, 40, 'rgba(0,0,0,0.4)');
      frame(ctx, p.x - 26, y, 48, 40, on ? p.color : '#150c28', on ? '#ffffff' : p.color);
      drawText(ctx, p.arrow, p.x - 2, y + 11, on ? '#000' : p.color, { align: 'center', scale: 3, shadow: null });
    }
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    drawText(ctx, `ROUND ${this.score + (this.over ? 0 : 1)}   BEST ${this.game.profile.mini.memory?.best ?? 0}`, W / 2, H - 28, '#9a9ab8', { align: 'center' });
    if (this.wrongT > 0) {
      ctx.globalAlpha = this.wrongT;
      rect(ctx, 0, 0, W, H, '#ff3f3f');
      ctx.globalAlpha = 1;
    }
    if (this.t < 3) drawText(ctx, this.game.input.label('REPEAT THE PATTERN WITH THE ARROWS • ESC LEAVES'), W / 2, H - 14, '#fff', { align: 'center' });
    this.drawOver(ctx, 'ROUNDS');
  }
}

function hexRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
