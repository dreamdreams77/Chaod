/**
 * Lobby mini-games: CART CATCH (reflex), BYTE BREAKOUT (paddle and bricks), WHACK-A-GLITCH (reaction),
 * STACK-A-CART (timing) and GLITCH MEMORY (pattern recall).
 * Small self-contained scenes; results flow through applyMini so bits, personal
 * bests and quests are handled (and tested) in one place.
 */
import { WEEKLY_BY_ID } from '../data/weekly.ts';
import type { Game, Scene } from '../game.ts';
import { H, W, PAL, Particles, Popups, backdrop, glow, rect, frame, bar, clamp, approach } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { drawCass, drawDemo, drawFloppy, drawBit } from '../render/actors.ts';
import { MiniId, MINIS } from '../data/quests.ts';
import { MiniOutcome, applyMini } from '../data/progression.ts';
import { Rng } from '../core/rng.ts';

export function startMini(game: Game, id: MiniId): void {
  const make: Record<MiniId, (g: Game) => Scene> = {
    catch: (g) => new CatchScene(g),
    breakout: (g) => new BreakoutScene(g),
    memory: (g) => new MemoryScene(g),
    whack: (g) => new WhackScene(g),
    stack: (g) => new StackScene(g),
    dash: (g) => new DashScene(g),
    hoops: (g) => new HoopScene(g),
    boxing: (g) => new BoxScene(g),
  };
  game.goto(make[id](game));
}

abstract class MiniBase implements Scene {
  abstract id: string;
  crt = 0.3;
  protected t = 0;
  protected over = false;
  protected overT = 0;
  /** Highlighted result button: 0 = PLAY AGAIN, 1 = LOBBY. */
  protected sel = 0;
  score = 0;
  protected outcome: MiniOutcome | null = null;
  protected readonly particles = new Particles(200);
  protected readonly popups = new Popups();
  protected abstract readonly miniId: MiniId;
  constructor(protected game: Game) {}

  enter(): void {
    this.game.music('arcade');
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
    if (outcome.errand) this.game.toast('ERRAND DONE', outcome.errand, '#9dff3f');
    for (const id of outcome.weekly) this.game.toast('WEEKLY GOAL', id === 'sweep' ? 'ALL THREE DONE! BONUS PAID' : WEEKLY_BY_ID.get(id)?.title ?? id, '#3fe0ff');
    this.game.audio.sfx(outcome.best ? 'levelup' : 'powerup');
  }

  /** Taps: the end panel's buttons; games add their own handling when a round is live. */
  tap(x: number, y: number): boolean {
    if (!this.over) return this.tapLive(x, y);
    if (this.overT > 0.5 && y >= 160 && y <= 192) {
      if (x < W / 2) startMini(this.game, this.miniId);
      else this.game.toHub();
    }
    return true;
  }
  protected tapLive(_x: number, _y: number): boolean {
    return true;
  }

  /** Handles the end-of-game panel; returns true while it is showing. */
  protected updateOver(dt: number): boolean {
    if (!this.over) return false;
    this.overT += dt;
    this.particles.update(dt);
    this.popups.update(dt);
    const inp = this.game.input;
    if (this.overT <= 0.5) return true;
    // D-pad switches between PLAY AGAIN and LOBBY; A (or confirm) uses the highlighted one; B / back always goes to the lobby.
    if (inp.pressed('left') || inp.pressed('right') || inp.pressed('up') || inp.pressed('down')) {
      this.sel = 1 - this.sel;
      this.game.audio.sfx('select');
    }
    if (inp.pressed('confirm') || inp.pressed('jump')) {
      if (this.sel === 0) startMini(this.game, this.miniId);
      else this.game.toHub();
    } else if (inp.pressed('back') || inp.pressed('attack')) this.game.toHub();
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
    // Touchable buttons (keys still work: confirm = again, back = lobby).
    for (const [i, label] of ['PLAY AGAIN', 'LOBBY'].entries()) {
      const bx = i === 0 ? W / 2 - 100 : W / 2 + 6;
      const on = i === this.sel;
      frame(ctx, bx, 166, 94, 20, on ? (i === 0 ? '#0f3a2a' : '#2a2050') : '#0b0716', on ? (i === 0 ? '#7dff6b' : '#3fe0ff') : '#3a3050');
      drawText(ctx, (on ? '\u25B6 ' : '') + label, bx + 47, 172, on ? '#fff' : '#9a9ab8', { align: 'center' });
    }
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
  drag(x: number): void {
    if (!this.over) this.dragX = x;
  }
  // Lifting a finger keeps the target: the cartridge glides there, so a single tap also works.
  dragEnd(): void {}
  protected readonly miniId = 'catch' as const;
  private px = W / 2;
  private facing = 1;
  private moving = false;
  private lives = 3;
  private combo = 0;
  private spawnT = 0.6;
  private hurtT = 0;
  private dragX: number | null = null;
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
    if (inp.pressed('pause')) {
      // Leaving early ends the round and banks what you have; press again to return to the lobby.
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    const ax = inp.axisX();
    if (ax) this.dragX = null;
    const before = this.px;
    // A finger on the screen steers directly (a little quicker than the keys); otherwise arrows move.
    if (this.dragX !== null) this.px = clamp(approach(this.px, this.dragX, 330 * dt), 16, W - 16);
    else this.px = clamp(this.px + ax * 200 * dt, 16, W - 16);
    const dx = this.px - before;
    this.moving = Math.abs(dx) > 0.05;
    if (this.moving) this.facing = dx > 0 ? 1 : -1;

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
  drag(x: number): void {
    if (!this.over) this.dragX = x;
  }
  // Lifting a finger keeps the target: the cartridge glides there, so a single tap also works.
  dragEnd(): void {}
  protected tapLive(): boolean {
    this.tapLaunch = true;
    return true;
  }
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
  private dragX: number | null = null;
  private tapLaunch = false;
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
    if (inp.pressed('pause')) {
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    if (inp.axisX()) this.dragX = null;
    if (this.dragX !== null) this.px = clamp(approach(this.px, this.dragX, 360 * dt), this.pw / 2, W - this.pw / 2);
    else this.px = clamp(this.px + inp.axisX() * 270 * dt, this.pw / 2, W - this.pw / 2);
    if (!this.stuck) this.tapLaunch = false;
    if (this.stuck) {
      this.bx = this.px;
      this.by = PADDLE_Y - 6;
      this.stuckT += dt;
      if (inp.pressed('jump') || inp.pressed('confirm') || inp.pressed('attack') || this.tapLaunch || this.stuckT > 3) this.launch();
      this.tapLaunch = false;
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
    if (this.stuck && !this.over) drawText(ctx, this.game.input.label('TAP OR Z LAUNCHES THE BALL (AUTO IN 3S)'), W / 2, PADDLE_Y - 30, '#fff', { align: 'center' });
    if (this.t < 4) drawText(ctx, this.game.input.label('ARROWS MOVE \u2022 TOP ROW TAKES TWO HITS \u2022 ESC OR P ENDS THE ROUND'), W / 2, H - 12, '#fff', { align: 'center' });
    this.drawOver(ctx, 'PTS');
  }
}

// ---- WHACK-A-GLITCH ------------------------------------------------------------------

const WHACK_SECONDS = 30;
const HOLE_X = [W / 2 - 86, W / 2, W / 2 + 86];
const HOLE_Y = [112, 164, 216];

interface Critter {
  cell: number;
  kind: 'glitch' | 'gold' | 'byte';
  age: number;
  life: number;
  hit: number; // seconds since whacked, or -1
}

export class WhackScene extends MiniBase {
  id = 'mini-whack';
  protected readonly miniId = 'whack' as const;
  private readonly rng: Rng;
  private readonly critters: Critter[] = [];
  private cursor = 4;
  private combo = 0;
  private spawnT = 0.6;
  private swingT = 0;
  private pendingWhack = -1;

  constructor(game: Game) {
    super(game);
    this.rng = new Rng(game.rng.int(1, 999999));
  }

  /** Touch / click: tap a hole to bonk it. Rows are split halfway between holes, so there is no overlap. */
  protected tapLive(x: number, y: number): boolean {
    const col = clamp(Math.round((x - HOLE_X[1]) / 86) + 1, 0, 2);
    const row = clamp(Math.round((y - (HOLE_Y[0] - 12)) / 52), 0, 2);
    if (Math.abs(x - HOLE_X[col]) <= 44) {
      this.cursor = row * 3 + col;
      this.pendingWhack = this.cursor;
    }
    return true;
  }

  private whack(cell: number): void {
    this.swingT = 0.18;
    const cr = this.critters.find((c) => c.cell === cell && c.hit < 0);
    const x = HOLE_X[cell % 3], y = HOLE_Y[Math.floor(cell / 3)];
    const a = this.game.audio;
    if (!cr) {
      this.combo = 0;
      a.sfx('miss');
      return;
    }
    cr.hit = 0;
    if (cr.kind === 'byte') {
      this.score = Math.max(0, this.score - 3);
      this.combo = 0;
      a.sfx('hurt');
      this.game.fx.shake(2);
      this.popups.add(x, y - 36, 'OOPS! -3', '#3fa9ff');
      this.particles.burst(x, y - 14, ['#3fa9ff', '#fff'], 10, 70);
      return;
    }
    this.combo++;
    const gain = (cr.kind === 'gold' ? 3 : 1) * Math.min(2, 1 + Math.floor(this.combo / 10));
    this.score += gain;
    a.sfx(cr.kind === 'gold' ? 'floppy' : 'hit', 1 + Math.min(0.5, this.combo * 0.03));
    this.popups.add(x, y - 36, `+${gain}`, cr.kind === 'gold' ? '#ffcf3f' : '#7dff6b');
    this.particles.burst(x, y - 14, cr.kind === 'gold' ? ['#ffcf3f', '#fff'] : ['#ff3f6b', '#fff'], 12, 90);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.updateOver(dt)) return;
    const inp = this.game.input;
    if (inp.pressed('pause')) {
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    this.swingT = Math.max(0, this.swingT - dt);
    // Keyboard: arrows hop the hammer between holes (wrapping), A bonks.
    let cx = this.cursor % 3, cy = Math.floor(this.cursor / 3);
    if (inp.pressed('left')) cx = (cx + 2) % 3;
    if (inp.pressed('right')) cx = (cx + 1) % 3;
    if (inp.pressed('up')) cy = (cy + 2) % 3;
    if (inp.pressed('down')) cy = (cy + 1) % 3;
    this.cursor = cy * 3 + cx;
    if (inp.pressed('jump') || inp.pressed('confirm') || inp.pressed('attack')) this.whack(this.cursor);
    if (this.pendingWhack >= 0) {
      this.whack(this.pendingWhack);
      this.pendingWhack = -1;
    }

    const ramp = this.t / WHACK_SECONDS;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.62 - ramp * 0.3;
      const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !this.critters.some((k) => k.cell === c));
      if (free.length) {
        const r = this.rng.next();
        const life = 1.25 - ramp * 0.6;
        const kind: Critter['kind'] = r < 0.68 ? 'glitch' : r < 0.82 ? 'gold' : 'byte';
        this.critters.push({ cell: this.rng.pick(free), kind, age: 0, life: kind === 'gold' ? life * 0.75 : life, hit: -1 });
      }
    }
    for (const c of this.critters) {
      c.age += dt;
      if (c.hit >= 0) c.hit += dt;
      // A glitch that escapes un-bonked breaks your streak.
      if (c.hit < 0 && c.age >= c.life && c.kind !== 'byte') this.combo = 0;
    }
    for (let i = this.critters.length - 1; i >= 0; i--) {
      const c = this.critters[i];
      if (c.age >= c.life || (c.hit >= 0.3)) this.critters.splice(i, 1);
    }
    if (this.t >= WHACK_SECONDS) this.finish();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.drawBackdrop(ctx, '125,255,107');
    // Holes first, then critters rising out of them, then front lips so they emerge from the ground
    for (let c = 0; c < 9; c++) {
      const x = HOLE_X[c % 3], y = HOLE_Y[Math.floor(c / 3)];
      rect(ctx, x - 30, y + 8, 60, 12, 'rgba(0,0,0,0.5)');
      rect(ctx, x - 26, y + 10, 52, 8, '#05020d');
      const cr = this.critters.find((k) => k.cell === c);
      if (cr) {
        const rise = Math.max(0, Math.min(1, cr.age / 0.14, (cr.life - cr.age) / 0.14));
        const squish = cr.hit >= 0;
        const h = squish ? 12 : 24;
        // The body slides up out of the hole: hidden below the lip at rise 0, fully out at rise 1.
        const ty = y + 14 - (squish ? 1 : rise) * h;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - 28, y - 40, 56, 54);
        ctx.clip();
        const body = cr.kind === 'gold' ? '#ffcf3f' : cr.kind === 'byte' ? '#3fa9ff' : '#ff3f6b';
        rect(ctx, x - 14, ty, 28, h, body);
        rect(ctx, x - 14, ty, 28, 3, 'rgba(255,255,255,0.45)');
        rect(ctx, x - 9, ty + 6, 5, squish ? 2 : 6, '#000');
        rect(ctx, x + 4, ty + 6, 5, squish ? 2 : 6, '#000');
        if (cr.kind === 'byte') {
          rect(ctx, x - 2, ty - 4, 4, 5, '#fff');
          rect(ctx, x - 6, ty + h - 6, 12, 2, '#000');
        } else rect(ctx, x - 7, ty + h - 6, 14, 2, '#000');
        if (cr.kind === 'gold') glow(ctx, x, ty + h / 2, 22, '255,207,63', 0.4);
        ctx.restore();
      }
      rect(ctx, x - 30, y + 14, 60, 4, '#2a1840');
      rect(ctx, x - 30, y + 14, 60, 1, '#4a2a70');
    }
    // Cursor ring and hammer
    const cx = HOLE_X[this.cursor % 3], cy = HOLE_Y[Math.floor(this.cursor / 3)];
    ctx.globalAlpha = 0.5 + Math.sin(this.t * 8) * 0.2;
    rect(ctx, cx - 32, cy - 36, 64, 2, '#ffffff');
    rect(ctx, cx - 32, cy + 18, 64, 2, '#ffffff');
    ctx.globalAlpha = 1;
    const swing = this.swingT > 0 ? 1 : 0;
    ctx.save();
    ctx.translate(cx + 26, cy - 28 + swing * 12);
    ctx.rotate(swing ? 0.5 : -0.45);
    rect(ctx, -2, -4, 4, 28, '#8a5a2a');
    rect(ctx, -10, -14, 20, 12, '#c0c0d0');
    rect(ctx, -10, -14, 20, 3, '#ffffff');
    ctx.restore();
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    const left = Math.max(0, WHACK_SECONDS - this.t);
    drawText(ctx, `SCORE ${this.score}`, 8, 8, '#ffcf3f');
    drawText(ctx, `COMBO ${this.combo}${this.combo >= 10 ? ' x2' : ''}`, 8, 18, '#7dff6b');
    bar(ctx, W / 2 - 50, 8, 100, 5, left / WHACK_SECONDS, left < 8 ? '#ff3f3f' : '#7dff6b', '#102010', '#ffffff55');
    drawText(ctx, `${Math.ceil(left)}`, W / 2, 16, '#fff', { align: 'center' });
    if (this.t < 4) drawText(ctx, this.game.input.label('TAP A HOLE, OR ARROWS + Z \u2022 GOLD = 3 \u2022 DO NOT HIT BYTE \u2022 ESC OR P ENDS THE ROUND'), W / 2, H - 10, '#fff', { align: 'center' });
    this.drawOver(ctx, 'PTS');
  }
}

// ---- STACK-A-CART --------------------------------------------------------------------

const STACK_H = 14;
const STACK_BASE_W = 130;
const STACK_TOP_Y = 210;

interface Slab {
  x: number;
  w: number;
}

interface Debris {
  x: number;
  y: number;
  w: number;
  vy: number;
  hue: number;
}

export class StackScene extends MiniBase {
  id = 'mini-stack';
  protected readonly miniId = 'stack' as const;
  private readonly slabs: Slab[] = [{ x: (W - STACK_BASE_W) / 2, w: STACK_BASE_W }];
  private mx = 20;
  private mw = STACK_BASE_W;
  private dir = 1;
  private streak = 0;
  private cam = 0;
  private drop = false;
  private readonly debris: Debris[] = [];

  protected tapLive(): boolean {
    this.drop = true;
    return true;
  }

  private speed(): number {
    return Math.min(300, 110 + this.slabs.length * 5);
  }

  private place(): void {
    const top = this.slabs[this.slabs.length - 1];
    const left = Math.max(this.mx, top.x);
    const right = Math.min(this.mx + this.mw, top.x + top.w);
    const ow = right - left;
    const y = this.slabY(this.slabs.length);
    const a = this.game.audio;
    if (ow <= 0) {
      // Missed the tower entirely: the whole slab falls and the run is over.
      this.debris.push({ x: this.mx, y, w: this.mw, vy: 0, hue: this.slabs.length * 23 });
      a.sfx('miss');
      this.game.fx.shake(3);
      this.finish();
      return;
    }
    const perfect = Math.abs(this.mx - top.x) <= 3;
    let slab: Slab;
    if (perfect) {
      this.streak++;
      slab = { x: top.x, w: top.w };
      // Three perfects in a row grow the slab back a little.
      if (this.streak >= 3 && slab.w < STACK_BASE_W) {
        const dw = Math.min(6, STACK_BASE_W - slab.w);
        slab = { x: top.x - dw / 2, w: slab.w + dw };
      }
      this.score += 2;
      a.sfx('perfect', 1 + Math.min(0.6, this.streak * 0.08));
      this.popups.add(W / 2, y - 24, this.streak > 1 ? `PERFECT x${this.streak}` : 'PERFECT!', '#7dff6b');
      this.particles.burst(this.mx + this.mw / 2, y, ['#7dff6b', '#fff'], 10, 80);
    } else {
      this.streak = 0;
      slab = { x: left, w: ow };
      this.score += 1;
      a.sfx('step', 0.9);
      // Slice off the overhang and let it fall away.
      if (this.mx < left) this.debris.push({ x: this.mx, y, w: left - this.mx, vy: 0, hue: this.slabs.length * 23 });
      if (this.mx + this.mw > right) this.debris.push({ x: right, y, w: this.mx + this.mw - right, vy: 0, hue: this.slabs.length * 23 });
    }
    this.slabs.push(slab);
    this.mw = slab.w;
    this.dir = this.slabs.length % 2 ? 1 : -1;
    this.mx = this.dir > 0 ? 10 : W - 10 - this.mw;
    if (this.slabs.length >= 60) this.finish();
  }

  /** World y (top of slab n) before camera scroll; slab 0 sits at the bottom. */
  private slabY(n: number): number {
    return STACK_TOP_Y - n * STACK_H + this.cam;
  }

  update(dt: number): void {
    this.t += dt;
    // Sliced-off pieces keep falling even while the result panel is up.
    for (const d of this.debris) {
      d.vy += 520 * dt;
      d.y += d.vy * dt;
    }
    for (let i = this.debris.length - 1; i >= 0; i--) if (this.debris[i].y > H + 40) this.debris.splice(i, 1);
    if (this.updateOver(dt)) return;
    const inp = this.game.input;
    if (inp.pressed('pause')) {
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    // Camera scrolls so the working height stays on screen.
    const want = Math.max(0, (this.slabs.length - 6) * STACK_H);
    this.cam += (want - this.cam) * Math.min(1, dt * 6);
    this.mx += this.dir * this.speed() * dt;
    if (this.mx < 10) { this.mx = 10; this.dir = 1; }
    if (this.mx + this.mw > W - 10) { this.mx = W - 10 - this.mw; this.dir = -1; }
    if (inp.pressed('jump') || inp.pressed('confirm') || inp.pressed('attack') || this.drop) {
      this.drop = false;
      this.place();
    }
  }

  private drawSlab(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, n: number): void {
    const hue = (n * 23) % 360;
    rect(ctx, x + 2, y + 3, w, STACK_H - 1, 'rgba(0,0,0,0.3)');
    rect(ctx, x, y, w, STACK_H - 1, `hsl(${hue},70%,52%)`);
    rect(ctx, x, y, w, 2, `hsl(${hue},80%,72%)`);
    rect(ctx, x, y + STACK_H - 4, w, 3, `hsl(${hue},70%,38%)`);
    if (w > 24) {
      rect(ctx, x + 6, y + 4, Math.min(w - 12, 34), 5, 'rgba(255,255,255,0.8)');
      rect(ctx, x + w - 10, y + 3, 4, STACK_H - 7, 'rgba(0,0,0,0.35)');
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.drawBackdrop(ctx, '255,207,63');
    for (let n = 0; n < this.slabs.length; n++) {
      const y = this.slabY(n);
      if (y < -STACK_H || y > H + STACK_H) continue;
      this.drawSlab(ctx, this.slabs[n].x, y, this.slabs[n].w, n);
    }
    for (const d of this.debris) this.drawSlab(ctx, d.x, d.y, d.w, Math.round(d.hue / 23));
    if (!this.over) {
      const y = this.slabY(this.slabs.length);
      // Guide line down to the tower so the drop point is easy to judge
      ctx.globalAlpha = 0.25;
      rect(ctx, this.mx, y + STACK_H, 1, 40, '#ffffff');
      rect(ctx, this.mx + this.mw - 1, y + STACK_H, 1, 40, '#ffffff');
      ctx.globalAlpha = 1;
      this.drawSlab(ctx, this.mx, y, this.mw, this.slabs.length);
    }
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    drawText(ctx, `SCORE ${this.score}`, 8, 8, '#ffcf3f');
    drawText(ctx, `FLOORS ${this.slabs.length - 1}`, 8, 18, '#3fe0ff');
    if (this.streak > 1) drawText(ctx, `PERFECT STREAK ${this.streak}`, W - 8, 8, '#7dff6b', { align: 'right' });
    if (this.t < 4) drawText(ctx, this.game.input.label('TAP OR Z TO DROP \u2022 LINE IT UP \u2022 PERFECT = 2 POINTS \u2022 ESC OR P ENDS THE ROUND'), W / 2, H - 10, '#fff', { align: 'center' });
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
  protected tapLive(x: number, y: number): boolean {
    if (y < 120 || y > 180) return true;
    const i = PADS.findIndex((p) => Math.abs(x - p.x) <= 30);
    if (i >= 0) this.tapPad = i;
    return true;
  }
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
  private tapPad = -1;

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
    if (inp.pressed('pause')) {
      // Leaving early ends the round and banks what you have; press again to return to the lobby.
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    if (this.phase !== 'input') this.tapPad = -1;
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
        if (!inp.pressed(PADS[i].action) && this.tapPad !== i) continue;
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
      this.tapPad = -1;
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

// ---- DEMO DASH (the secret cabinet) -----------------------------------------------------

interface Hazard {
  x: number;
  kind: 'hurdle' | 'rock' | 'bird' | 'bone';
  y: number;
  hit: boolean;
}

const DASH_GROUND = H - 56;
const DASH_SECONDS = 60;

export class DashScene extends MiniBase {
  id = 'mini-dash';
  protected readonly miniId = 'dash' as const;
  private readonly rng: Rng;
  private dy = 0;
  private vy = 0;
  private onGround = true;
  private holding = false;
  private lives = 3;
  private bones = 0;
  private dist = 0;
  private hurtT = 0;
  private spawnT = 1;
  private readonly things: Hazard[] = [];

  constructor(game: Game) {
    super(game);
    this.rng = new Rng(game.rng.int(1, 999999));
  }

  /** Tapping anywhere jumps (the pad's A button and Z do too). */
  protected tapLive(): boolean {
    this.jump();
    return true;
  }

  private jump(): void {
    if (!this.onGround || this.over) return;
    this.vy = -330;
    this.onGround = false;
    this.holding = true;
    this.game.audio.sfx('jump');
  }

  private get speed(): number {
    return 130 + Math.min(150, this.t * 3.2);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.updateOver(dt)) return;
    const inp = this.game.input;
    if (inp.pressed('pause')) {
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (inp.pressed('jump') || inp.pressed('confirm') || inp.pressed('up')) this.jump();
    // Holding the button a little longer jumps higher.
    if (this.holding && !inp.held('jump') && !inp.held('confirm') && !inp.held('up') && this.vy < -140) this.vy = -140;
    if (this.holding && this.vy >= 0) this.holding = false;
    this.vy += 900 * dt;
    this.dy += this.vy * dt;
    if (this.dy >= 0) {
      this.dy = 0;
      this.vy = 0;
      this.onGround = true;
      this.holding = false;
    }
    const sp = this.speed;
    this.dist += sp * dt;
    this.score = Math.floor(this.dist / 14) + this.bones * 3;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = this.rng.range(0.7, 1.5) * (150 / sp) + 0.35;
      const r = this.rng.next();
      const kind: Hazard['kind'] = r < 0.34 ? 'hurdle' : r < 0.6 ? 'rock' : r < 0.78 ? 'bird' : 'bone';
      const y = kind === 'bird' ? DASH_GROUND - 36 : kind === 'bone' ? DASH_GROUND - this.rng.range(14, 54) : DASH_GROUND;
      this.things.push({ x: W + 20, kind, y, hit: false });
      // A short trail of bones sometimes follows a hurdle: the jump pays.
      if (kind === 'hurdle' && this.rng.chance(0.6)) for (let i = 1; i <= 3; i++) this.things.push({ x: W + 20 + i * 14, kind: 'bone', y: DASH_GROUND - 40 - Math.sin(i / 4 * Math.PI) * 14, hit: false });
    }
    const dogX = 90;
    const dogY = DASH_GROUND + this.dy;
    for (const h of this.things) {
      h.x -= sp * dt;
      if (h.hit) continue;
      const dx = Math.abs(h.x - dogX);
      if (h.kind === 'bone') {
        if (dx < 12 && Math.abs(h.y - (dogY - 10)) < 14) {
          h.hit = true;
          this.bones++;
          this.game.audio.sfx('coin');
          this.popups.add(h.x, h.y - 8, '+3', '#ffcf3f');
        }
      } else if (this.hurtT <= 0) {
        const w = h.kind === 'rock' ? 10 : h.kind === 'bird' ? 9 : 7;
        const top = h.kind === 'hurdle' ? h.y - 18 : h.kind === 'rock' ? h.y - 10 : h.y - 8;
        const bottom = h.kind === 'bird' ? h.y + 4 : h.y;
        if (dx < w + 5 && dogY > top && dogY - 16 < bottom) {
          h.hit = true;
          this.lives--;
          this.hurtT = 1;
          this.game.audio.sfx('hurt');
          this.game.fx.shake(2);
          this.particles.burst(dogX, dogY - 8, ['#c98b4a', '#fff'], 10, 80);
        }
      }
    }
    for (let i = this.things.length - 1; i >= 0; i--) if (this.things[i].x < -30) this.things.splice(i, 1);
    if (this.lives <= 0 || this.t >= DASH_SECONDS) this.finish();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    this.drawBackdrop(ctx, '255,159,63');
    // ground with scrolling dashes
    rect(ctx, 0, DASH_GROUND + 2, W, H - DASH_GROUND, '#120a24');
    rect(ctx, 0, DASH_GROUND + 2, W, 1, '#ff9f3f');
    for (let x = -((this.dist) % 40); x < W; x += 40) rect(ctx, x, DASH_GROUND + 10, 18, 1, '#ff9f3f55');
    for (const h of this.things) {
      if (h.hit && h.kind === 'bone') continue;
      if (h.kind === 'hurdle') {
        rect(ctx, h.x - 7, h.y - 18, 3, 18, '#ffffff');
        rect(ctx, h.x + 4, h.y - 18, 3, 18, '#ffffff');
        rect(ctx, h.x - 8, h.y - 15, 16, 3, '#ff3f6b');
        rect(ctx, h.x - 8, h.y - 9, 16, 3, '#ffffff');
      } else if (h.kind === 'rock') {
        rect(ctx, h.x - 9, h.y - 8, 18, 8, '#6a6a88');
        rect(ctx, h.x - 6, h.y - 11, 12, 4, '#8a8aa8');
        rect(ctx, h.x - 9, h.y - 8, 18, 1, '#b0b0c8');
      } else if (h.kind === 'bird') {
        const flap = Math.floor(this.t * 8) % 2;
        rect(ctx, h.x - 6, h.y - 3, 12, 6, '#b07aff');
        rect(ctx, h.x - 8, h.y - 5 + flap * 5, 5, 3, '#8a5ad0');
        rect(ctx, h.x + 5, h.y - 1, 4, 2, '#ffcf3f');
        rect(ctx, h.x + 2, h.y - 2, 2, 2, '#fff');
      } else {
        glow(ctx, h.x, h.y, 9, '255,255,255', 0.35);
        rect(ctx, h.x - 5, h.y - 1, 10, 3, '#fffbe8');
        rect(ctx, h.x - 6, h.y - 3, 3, 3, '#fffbe8');
        rect(ctx, h.x - 6, h.y + 1, 3, 3, '#fffbe8');
        rect(ctx, h.x + 3, h.y - 3, 3, 3, '#fffbe8');
        rect(ctx, h.x + 3, h.y + 1, 3, 3, '#fffbe8');
      }
    }
    const blink = this.hurtT > 0 && Math.floor(this.t * 10) % 2 === 0;
    rect(ctx, 80, DASH_GROUND + 1, 22, 3, `rgba(0,0,0,${0.4 - Math.min(0.3, -this.dy / 200)})`);
    if (!blink) drawDemo(ctx, { x: 90, y: DASH_GROUND + this.dy, facing: 1, pose: this.onGround ? 'run' : 'jump', t: this.t * 1.4 });
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    const left = Math.max(0, DASH_SECONDS - this.t);
    drawText(ctx, `SCORE ${this.score}`, 8, 8, '#ffcf3f');
    drawText(ctx, `BONES ${this.bones}`, 8, 18, '#fffbe8');
    for (let i = 0; i < 3; i++) drawText(ctx, '\u2665', W - 40 + i * 9, 8, i < this.lives ? '#ff3f6b' : '#40303a');
    bar(ctx, W / 2 - 50, 8, 100, 5, left / DASH_SECONDS, left < 10 ? '#ff3f3f' : '#7dff6b', '#102010', '#ffffff55');
    drawText(ctx, `${Math.ceil(left)}`, W / 2, 16, '#fff', { align: 'center' });
    if (this.t < 3.5) drawText(ctx, this.game.input.label('Z OR TAP: JUMP (HOLD FOR A HIGHER JUMP) \u2022 GRAB BONES \u2022 DODGE ROCKS AND BIRDS'), W / 2, H - 14, '#fff', { align: 'center' });
    this.drawOver(ctx, 'PTS');
  }
}

function hexRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}


// ---- HOOP SHOT -----------------------------------------------------------------------

const HOOP_SECONDS = 45;
const RIM_X = 392;
const RIM_Y = 112;
const COURT_Y = 214;
/** Three shooting spots: further out pays more and has a smaller sweet spot on the meter. */
const SPOTS = [
  { x: 96, label: '3PT', pts: 3, zone: 0.8, swish: 0.034, good: 0.074 },
  { x: 188, label: '2PT', pts: 2, zone: 0.62, swish: 0.045, good: 0.095 },
  { x: 278, label: '2PT', pts: 2, zone: 0.44, swish: 0.05, good: 0.105 },
];
type ShotResult = 'swish' | 'in' | 'rim' | 'miss';

interface Shot {
  t: number;
  sx: number;
  sy: number;
  tx: number;
  result: ShotResult;
  spot: number;
  /** Which way a missed ball bounces off. */
  off: number;
}

export class HoopScene extends MiniBase {
  id = 'mini-hoops';
  protected readonly miniId = 'hoops' as const;
  private spot = 1;
  private px = SPOTS[1].x;
  private phase: 'idle' | 'meter' | 'flight' | 'after' = 'idle';
  private meter = 0;
  private dir = 1;
  private shot: Shot | null = null;
  private afterT = 0;
  private streak = 0;
  private timeLeft = HOOP_SECONDS;
  private net = 0;
  private press = false;
  private made = 0;
  private attempts = 0;
  private readonly rng: Rng;

  constructor(game: Game) {
    super(game);
    // Reward-paying games ignore the fixed-seed setting, otherwise a pattern could be memorised and farmed.
    this.rng = new Rng(game.rng.int(1, 999999));
  }

  protected tapLive(x: number, y: number): boolean {
    if (y >= 196 && this.phase === 'idle') {
      // tapping the floor picks a spot
      let best = 0;
      for (let i = 1; i < SPOTS.length; i++) if (Math.abs(SPOTS[i].x - x) < Math.abs(SPOTS[best].x - x)) best = i;
      this.spot = best;
      return true;
    }
    this.press = true;
    return true;
  }

  /** The meter value (0..1) at which the shot is released, for tests and bots. */
  get power(): number {
    return this.meter;
  }
  get currentSpot(): number {
    return this.spot;
  }

  update(dt: number): void {
    this.t += dt;
    this.px += (SPOTS[this.spot].x - this.px) * Math.min(1, dt * 12);
    this.net = Math.max(0, this.net - dt * 2);
    if (this.updateOver(dt)) return;
    const inp = this.game.input;
    if (inp.pressed('pause')) {
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    const go = inp.pressed('jump') || inp.pressed('attack') || inp.pressed('confirm') || this.press;
    this.press = false;
    if (this.phase === 'idle') {
      if (inp.pressed('left')) this.spot = Math.max(0, this.spot - 1);
      if (inp.pressed('right')) this.spot = Math.min(SPOTS.length - 1, this.spot + 1);
      if (this.timeLeft <= 0) return this.finish();
      if (go) {
        this.phase = 'meter';
        this.meter = 0;
        this.dir = 1;
        this.game.audio.sfx('select');
      }
    } else if (this.phase === 'meter') {
      const speed = 1.1 + Math.min(0.5, this.streak * 0.05);
      this.meter += this.dir * speed * dt;
      if (this.meter >= 1) {
        this.meter = 1;
        this.dir = -1;
      } else if (this.meter <= 0) {
        this.meter = 0;
        this.dir = 1;
      }
      if (go) this.release();
    } else if (this.phase === 'flight' && this.shot) {
      this.shot.t += dt / 0.85;
      if (this.shot.t >= 1) this.land();
    } else if (this.phase === 'after') {
      this.afterT -= dt;
      if (this.afterT <= 0) {
        this.phase = 'idle';
        this.shot = null;
        if (this.timeLeft <= 0) this.finish();
      }
    }
  }

  private release(): void {
    const sp = SPOTS[this.spot];
    const err = this.meter - sp.zone;
    const off = err * 220;
    let result: ShotResult;
    if (Math.abs(err) <= sp.swish) result = 'swish';
    else if (Math.abs(err) <= sp.good) result = this.rng.chance(0.55) ? 'in' : 'rim';
    else result = 'miss';
    this.shot = { t: 0, sx: this.px + 10, sy: COURT_Y - 44, tx: RIM_X + off, result, spot: this.spot, off };
    this.phase = 'flight';
    this.attempts++;
    this.game.audio.sfx('step');
  }

  private land(): void {
    const s = this.shot!;
    const sp = SPOTS[s.spot];
    this.phase = 'after';
    this.afterT = s.result === 'miss' ? 0.55 : 0.7;
    if (s.result === 'swish' || s.result === 'in') {
      this.made++;
      this.streak++;
      this.net = 1;
      let pts = sp.pts;
      let text = s.result === 'swish' ? 'SWISH!' : 'IN!';
      if (s.result === 'swish') {
        pts += 1;
        this.timeLeft = Math.min(HOOP_SECONDS + 15, this.timeLeft + 1.5);
      }
      if (this.streak >= 3) {
        pts += 1;
        text = 'ON FIRE! ' + text;
      }
      this.score += pts;
      this.popups.add(RIM_X, RIM_Y - 30, `${text} +${pts}`, s.result === 'swish' ? '#7dff6b' : '#ffcf3f');
      this.particles.burst(RIM_X, RIM_Y + 4, ['#fff', '#ffcf3f', '#ff9f3f'], 12, 90);
      this.game.audio.sfx(s.result === 'swish' ? 'perfect' : 'coin');
    } else {
      this.streak = 0;
      this.popups.add(RIM_X, RIM_Y - 26, s.result === 'rim' ? 'RIM OUT' : s.off > 0 ? 'LONG' : 'SHORT', '#ff6f3f');
      this.game.audio.sfx('miss');
    }
  }

  private ballPos(s: Shot): { x: number; y: number } {
    const t = Math.min(1, s.t);
    return { x: s.sx + (s.tx - s.sx) * t, y: s.sy + (RIM_Y - s.sy) * t - 4 * 76 * t * (1 - t) };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // gym: dark wall, floor and a glowing scoreboard
    backdrop(ctx, '#0b0618', '#2a1448');
    rect(ctx, 0, COURT_Y, W, H - COURT_Y, '#6b3a1c');
    for (let x = 0; x < W; x += 24) rect(ctx, x, COURT_Y, 1, H - COURT_Y, '#4a2812');
    rect(ctx, 0, COURT_Y, W, 3, '#c98b4a');
    // backboard, rim and net
    rect(ctx, RIM_X + 26, RIM_Y - 42, 6, 66, '#d8d8e8');
    rect(ctx, RIM_X + 26, RIM_Y - 42, 6, 4, '#ff3f5a');
    rect(ctx, RIM_X - 16, RIM_Y, 34, 3, '#ff6f3f');
    const swing = Math.sin(this.t * 20) * this.net * 2;
    for (let i = 0; i < 5; i++) rect(ctx, RIM_X - 14 + i * 7 + swing * (i % 2 ? 1 : -1), RIM_Y + 3, 1, 14 - Math.abs(2 - i) * 2, '#ddd');
    rect(ctx, RIM_X - 12, RIM_Y + 8, 26, 1, '#ddd');
    // spots on the floor
    SPOTS.forEach((sp, i) => {
      const on = i === this.spot;
      rect(ctx, sp.x - 16, COURT_Y + 6, 32, 3, on ? '#ffcf3f' : '#ffffff44');
      drawText(ctx, sp.label, sp.x, COURT_Y + 14, on ? '#ffcf3f' : '#ffffff88', { align: 'center' });
    });
    // the shooter
    drawCass(ctx, { x: this.px, y: COURT_Y + 2, facing: 1, pose: this.phase === 'meter' ? 'idle' : 'run', t: this.t, scale: 1.3 }, this.game.profile.character);
    // ball
    if (this.phase === 'flight' && this.shot) {
      const b = this.ballPos(this.shot);
      this.drawBall(ctx, b.x, b.y);
    } else if (this.phase === 'after' && this.shot) {
      const s = this.shot;
      const k = 1 - this.afterT / (s.result === 'miss' ? 0.55 : 0.7);
      if (s.result === 'swish' || s.result === 'in') this.drawBall(ctx, RIM_X + (s.tx - RIM_X) * (1 - k), RIM_Y + 4 + k * 70);
      else this.drawBall(ctx, s.tx + (s.off > 0 ? 1 : -1) * k * 60, RIM_Y + 4 + k * k * 120 - k * 30);
    } else this.drawBall(ctx, this.px + 12, COURT_Y - 40 + (this.phase === 'meter' ? -6 : 0));
    // shot meter
    if (this.phase === 'meter' || this.phase === 'idle') {
      const mx = 40, my = 70, mh = 120;
      frame(ctx, mx - 6, my - 6, 22, mh + 12, '#0b0716', '#3a3050');
      const sp = SPOTS[this.spot];
      const zy = my + mh * (1 - sp.zone);
      rect(ctx, mx, zy - mh * sp.good, 10, mh * sp.good * 2, '#2f7a3a');
      rect(ctx, mx, zy - mh * sp.swish, 10, mh * sp.swish * 2, '#7dff6b');
      if (this.phase === 'meter') {
        const y = my + mh * (1 - this.meter);
        rect(ctx, mx - 4, y - 1, 18, 3, '#ffffff');
      }
    }
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    drawText(ctx, `SCORE ${this.score}`, 8, 8, '#ffcf3f');
    drawText(ctx, `TIME ${Math.ceil(this.timeLeft)}`, W / 2, 8, this.timeLeft < 8 ? '#ff3f5a' : '#fff', { align: 'center' });
    drawText(ctx, `${this.made}/${this.attempts}`, W - 8, 8, '#3fe0ff', { align: 'right' });
    if (this.streak >= 3) drawText(ctx, 'ON FIRE!', W / 2, 20, '#ff9f3f', { align: 'center' });
    else if (this.streak > 0) drawText(ctx, `STREAK ${this.streak}`, W / 2, 20, '#9a9ab8', { align: 'center' });
    if (this.t < 6 && !this.over) drawText(ctx, this.game.input.label('LEFT / RIGHT: SPOT \u2022 Z: START THE METER, Z AGAIN IN THE GREEN'), W / 2, H - 10, '#fff', { align: 'center' });
    this.drawOver(ctx, 'PTS');
  }

  private drawBall(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    x = Math.round(x);
    y = Math.round(y);
    rect(ctx, x - 5, y - 4, 10, 8, '#ff7a1a');
    rect(ctx, x - 4, y - 5, 8, 10, '#ff7a1a');
    rect(ctx, x - 1, y - 5, 1, 10, '#6a2a08');
    rect(ctx, x - 5, y - 1, 10, 1, '#6a2a08');
    rect(ctx, x - 3, y - 4, 2, 2, '#ffb36b');
  }
}

// ---- GLITCH GLOVES -------------------------------------------------------------------

const BOX_SECONDS = 100;
type OppState = 'idle' | 'tell' | 'strike' | 'recover' | 'stun' | 'down';
type Punch = 'hookL' | 'hookR' | 'jab';

interface Boxer {
  name: string;
  hp: number;
  color: string;
  trunks: string;
  /** Seconds of warning before a punch, and the idle pause range. */
  tell: number;
  idle: [number, number];
}
const BOXERS: Boxer[] = [
  { name: 'PAPER PETE', hp: 52, color: '#7aa8ff', trunks: '#3f5fff', tell: 0.62, idle: [0.9, 1.7] },
  { name: 'TIN TINA', hp: 68, color: '#ff9ad9', trunks: '#ff3fa4', tell: 0.5, idle: [0.7, 1.4] },
  { name: 'BIG BAD BYTE', hp: 88, color: '#ff8a4a', trunks: '#ff3f3f', tell: 0.4, idle: [0.5, 1.1] },
];

export class BoxScene extends MiniBase {
  id = 'mini-boxing';
  protected readonly miniId = 'boxing' as const;
  private lane = 0;
  private laneX = 0;
  private blocking = false;
  private hearts = 4;
  private timeLeft = BOX_SECONDS;
  private punchCd = 0;
  private punchT = 0;
  private hurtT = 0;
  private round = 0;
  private opp: Boxer = BOXERS[0];
  private oppHp = BOXERS[0].hp;
  private state: OppState = 'idle';
  private stateT = 1.2;
  private punch: Punch = 'jab';
  private combo = 0;
  private koT = 0;
  private tapLane: number | null = null;
  private tapPunch = false;
  private tapBlock = 0;
  private readonly rng: Rng;

  constructor(game: Game) {
    super(game);
    this.rng = new Rng(game.rng.int(1, 999999));
    this.startRound(0);
  }

  private startRound(i: number): void {
    this.round = i;
    const base = BOXERS[i % BOXERS.length];
    const lap = Math.floor(i / BOXERS.length);
    this.opp = { ...base, hp: Math.round(base.hp * (1 + lap * 0.25)), tell: Math.max(0.28, base.tell - lap * 0.06) };
    this.oppHp = this.opp.hp;
    this.state = 'idle';
    this.stateT = 1.2;
    this.combo = 0;
    this.koT = 0;
  }

  protected tapLive(x: number, y: number): boolean {
    // thirds of the screen: left / right dodge, the middle punches (top) or blocks (bottom)
    if (x < W * 0.28) this.tapLane = -1;
    else if (x > W * 0.72) this.tapLane = 1;
    else if (y < H * 0.7) this.tapPunch = true;
    else this.tapBlock = 0.5;
    return true;
  }
  drag(x: number): void {
    if (this.over) return;
    this.tapLane = x < W * 0.35 ? -1 : x > W * 0.65 ? 1 : 0;
  }
  dragEnd(): void {
    this.tapLane = null;
  }

  /** What the opponent is doing, for tests and bots. */
  get oppState(): OppState {
    return this.state;
  }
  get oppPunch(): Punch {
    return this.punch;
  }
  get playerLane(): number {
    return this.lane;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.updateOver(dt)) return;
    const inp = this.game.input;
    if (inp.pressed('pause')) {
      this.finish();
      return;
    }
    this.particles.update(dt);
    this.popups.update(dt);
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.punchCd = Math.max(0, this.punchCd - dt);
    this.punchT = Math.max(0, this.punchT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.tapBlock = Math.max(0, this.tapBlock - dt);
    // dodge by holding left or right; a finger holds its lane
    const ax = inp.axisX();
    this.lane = ax !== 0 ? ax : this.tapLane ?? 0;
    this.blocking = inp.held('down') || this.tapBlock > 0;
    this.laneX += (this.lane * 62 - this.laneX) * Math.min(1, dt * 18);
    const wantPunch = inp.pressed('attack') || inp.pressed('jump') || inp.pressed('up') || inp.pressed('confirm') || this.tapPunch;
    this.tapPunch = false;
    if (wantPunch && this.punchCd <= 0 && !this.blocking) this.throwPunch();
    this.updateOpp(dt);
    if (this.hearts <= 0 || this.timeLeft <= 0) this.finish();
  }

  private throwPunch(): void {
    this.punchCd = 0.3;
    this.punchT = 0.18;
    const s = this.state;
    if (s === 'recover' || s === 'stun') {
      this.combo = Math.min(3, this.combo + 1);
      const dmg = 5 + this.combo * 2;
      this.hitOpp(dmg, s === 'stun' ? 'COUNTER!' : `HIT x${this.combo}`);
      // each clean hit keeps him dazed a little longer
      this.stateT = Math.max(this.stateT, 0.45);
    } else if (s === 'tell') {
      // caught him winding up: a counter punch
      this.state = 'stun';
      this.stateT = 1.3;
      this.hitOpp(10, 'COUNTER!');
      this.score += 4;
      this.game.audio.sfx('perfect');
    } else if (s === 'idle') {
      this.hitOpp(1, 'BLOCKED');
      this.stateT = Math.min(this.stateT, 0.3); // he answers a wild punch quickly
      this.combo = 0;
    } else if (s === 'strike') {
      this.combo = 0; // whiffed into his punch
    }
  }

  private hitOpp(dmg: number, text: string): void {
    this.oppHp = Math.max(0, this.oppHp - dmg);
    this.score += dmg;
    this.popups.add(W / 2, 70, text, dmg > 1 ? '#ffcf3f' : '#9a9ab8');
    this.particles.burst(W / 2, 95, ['#fff', '#ffcf3f'], 6, 80);
    this.game.audio.sfx(dmg > 1 ? 'hurt' : 'step');
    if (this.oppHp <= 0 && this.state !== 'down') {
      this.state = 'down';
      this.stateT = 2.4;
      this.score += 20 + this.round * 5;
      this.timeLeft = Math.min(BOX_SECONDS + 20, this.timeLeft + 8);
      this.hearts = Math.min(4, this.hearts + 1);
      this.popups.add(W / 2, 50, 'K.O.!', '#ff3fa4');
      this.game.audio.sfx('levelup');
      this.game.fx.flash('#ffffff', 0.3);
    }
  }

  private updateOpp(dt: number): void {
    this.stateT -= dt;
    if (this.stateT > 0) return;
    switch (this.state) {
      case 'idle':
        this.punch = this.rng.pick(['hookL', 'hookR', 'jab'] as Punch[]);
        this.state = 'tell';
        this.stateT = this.opp.tell;
        this.game.audio.sfx('warn');
        break;
      case 'tell':
        this.state = 'strike';
        this.stateT = 0.16;
        break;
      case 'strike':
        this.resolveStrike();
        break;
      case 'recover':
      case 'stun':
        this.state = 'idle';
        this.stateT = this.rng.range(this.opp.idle[0], this.opp.idle[1]);
        this.combo = 0;
        break;
      case 'down':
        this.startRound(this.round + 1);
        break;
    }
  }

  private resolveStrike(): void {
    const p = this.punch;
    // hooks come from the side and are dodged by stepping to the other side; a jab goes straight, so any step or a block avoids it
    const hit =
      p === 'hookL' ? this.lane <= 0 : p === 'hookR' ? this.lane >= 0 : this.lane === 0 && !this.blocking;
    if (hit) {
      this.hearts--;
      this.hurtT = 0.4;
      this.combo = 0;
      this.game.audio.sfx('hurt');
      this.game.fx.shake(4);
      this.popups.add(W / 2, H - 80, 'OUCH', '#ff3f5a');
      this.state = 'recover';
      this.stateT = 0.4;
    } else {
      this.score += 1;
      this.popups.add(W / 2, H - 80, p === 'jab' && this.blocking ? 'BLOCKED' : 'DODGED!', '#7dff6b');
      this.game.audio.sfx('select');
      this.state = 'recover';
      this.stateT = 1.1;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    backdrop(ctx, '#0a0418', '#2a0f2e');
    // ring: ropes and a canvas floor
    rect(ctx, 0, 150, W, H - 150, '#7a1f4a');
    for (let i = 0; i < 3; i++) rect(ctx, 0, 90 + i * 18, W, 2, ['#ff3f5a', '#ffffff', '#3fa9ff'][i]);
    this.drawOpp(ctx);
    // the player's gloves from behind
    const gx = W / 2 + this.laneX;
    const raise = this.blocking ? 26 : this.punchT > 0 ? 34 : 0;
    const flash = this.hurtT > 0 && Math.floor(this.t * 12) % 2 === 0;
    rect(ctx, gx - 12, H - 70, 24, 30, flash ? '#fff' : '#f2c49b'); // head from behind
    rect(ctx, gx - 12, H - 74, 24, 8, '#ff3fa4');
    rect(ctx, gx - 30, H - 44 - raise, 24, 24, '#ff3f5a');
    rect(ctx, gx + 6, H - 44 - raise - (this.punchT > 0 ? 18 : 0), 24, 24, '#ff3f5a');
    rect(ctx, gx - 28, H - 42 - raise, 20, 6, 'rgba(255,255,255,0.35)');
    rect(ctx, gx - 14, H - 40, 28, 40, '#3fa9ff');
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    // HUD
    drawText(ctx, this.opp.name, 8, 8, this.opp.color);
    bar(ctx, 8, 18, 150, 6, this.oppHp / this.opp.hp, this.opp.color, '#1a0a1a', '#ffffff66');
    drawText(ctx, `SCORE ${this.score}`, W - 8, 8, '#ffcf3f', { align: 'right' });
    drawText(ctx, `TIME ${Math.ceil(this.timeLeft)}`, W - 8, 18, this.timeLeft < 10 ? '#ff3f5a' : '#fff', { align: 'right' });
    for (let i = 0; i < 4; i++) rect(ctx, 8 + i * 12, H - 20, 9, 9, i < this.hearts ? '#ff3f5a' : '#3a2a3a');
    drawText(ctx, `ROUND ${this.round + 1}`, W / 2, 8, '#9a9ab8', { align: 'center' });
    if (this.t < 7 && !this.over) drawText(ctx, this.game.input.label('LEFT / RIGHT DODGE \u2022 DOWN BLOCK \u2022 Z PUNCH WHEN HE OPENS UP'), W / 2, H - 10, '#fff', { align: 'center' });
    this.drawOver(ctx, 'PTS');
  }

  private drawOpp(ctx: CanvasRenderingContext2D): void {
    const o = this.opp;
    const cx = W / 2;
    const down = this.state === 'down';
    const sway = this.state === 'idle' ? Math.round(Math.sin(this.t * 3) * 3) : 0;
    const y0 = down ? 118 : 56;
    const x = cx + sway;
    const dazed = this.state === 'recover' || this.state === 'stun';
    rect(ctx, x - 22, y0 + 30, 44, 56, o.color); // torso
    rect(ctx, x - 22, y0 + 76, 44, 12, o.trunks);
    rect(ctx, x - 16, y0 + 86, 12, 22, o.color);
    rect(ctx, x + 4, y0 + 86, 12, 22, o.color);
    rect(ctx, x - 13, y0, 26, 28, '#f0c8a0'); // head
    rect(ctx, x - 14, y0 - 4, 28, 8, o.trunks);
    // face: eyes narrow in the tell, spiral when stunned
    if (this.state === 'stun' || down) {
      drawText(ctx, down ? 'X X' : '@ @', x, y0 + 9, '#000', { align: 'center', shadow: null });
    } else {
      const eye = this.state === 'tell' ? '#ff2040' : '#000';
      rect(ctx, x - 8, y0 + 9, 5, this.state === 'tell' ? 3 : 5, eye);
      rect(ctx, x + 3, y0 + 9, 5, this.state === 'tell' ? 3 : 5, eye);
    }
    rect(ctx, x - 6, y0 + 20, 12, 2, dazed ? '#ff6f6f' : '#7a3a3a');
    if (down) return;
    // gloves: the one that is about to punch pulls back and glows; on the strike it swings in
    const glove = (side: number, kind: 'guard' | 'tell' | 'strike'): void => {
      const flash = kind === 'tell' && Math.floor(this.t * 12) % 2 === 0;
      let gx = x + side * 36, gy = y0 + 46, size = 20;
      if (kind === 'tell') {
        gx = x + side * 52;
        gy = y0 + 34;
        size = 22;
      } else if (kind === 'strike') {
        gx = x + side * 14;
        gy = y0 + 92;
        size = 38;
      }
      rect(ctx, gx - size / 2, gy - size / 2, size, size, flash ? '#ffcf3f' : '#e03030');
      rect(ctx, gx - size / 2 + 2, gy - size / 2 + 2, size / 3, size / 4, 'rgba(255,255,255,0.4)');
    };
    const p = this.punch;
    const attacking = this.state === 'tell' || this.state === 'strike';
    const kind = this.state === 'strike' ? 'strike' : 'tell';
    // a hook "L" comes from the left side of the screen, so it needs a step to the right
    glove(-1, attacking && (p === 'hookL' || p === 'jab') ? kind : 'guard');
    glove(1, attacking && (p === 'hookR' || p === 'jab') ? kind : 'guard');
    if (this.state === 'tell') {
      const arrow = p === 'hookL' ? 'STEP RIGHT \u2192' : p === 'hookR' ? '\u2190 STEP LEFT' : 'BLOCK OR SIDESTEP';
      drawText(ctx, arrow, cx, 40, '#ff6f6f', { align: 'center' });
    }
    if (dazed) drawText(ctx, 'HE IS OPEN: PUNCH!', cx, 40, '#7dff6b', { align: 'center' });
  }
}
