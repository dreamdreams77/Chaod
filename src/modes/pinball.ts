/**
 * FLIPPER FRENZY — a pinball table. Launch with the plunger, keep the ball alive with the flippers,
 * ring the bumpers, drop the targets and light the lanes. Reach the score goal before the balls run
 * out. Three missions hide the floppy disks: clear the target banks, complete the top lanes, and
 * smash the bumpers.
 *
 * Controls: LEFT / Z the left flipper, RIGHT / X the right flipper, hold DOWN and let go to launch,
 * UP nudges the table (three nudges in a row and it TILTS). Touch: left half / right half of the
 * screen are the flippers, hold the far right edge to pull the plunger.
 *
 * Chaos flags honoured: low_gravity (a floaty ball), multiball (two extra balls), bumper_boost.
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import type { DirectorContext } from '../chaos/director.ts';
import type { ActiveEvent } from '../chaos/director.ts';
import type { Action } from '../core/input.ts';
import { H, W, backdrop, bar, clamp, glow, hearts, rect } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';

export const TW = 180;
export const TH = 256;
const OX = 150;
const OY = 6;
const BALL_R = 4;
const GRAVITY = 330;
const SUBSTEPS = 10;
export const LANE_X = TW - 7;
const GOALS = { easy: 30000, normal: 50000, hard: 75000 };

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** 0 plain wall, 1 slingshot, 2 left-bank target, 3 right-bank target. */
  kind: 0 | 1 | 2 | 3;
  id: number;
}
interface Bumper {
  x: number;
  y: number;
  r: number;
  flash: number;
}
interface Flipper {
  px: number;
  py: number;
  /** +1 for the left flipper (points right), -1 for the right one. */
  side: 1 | -1;
  /** Angle from horizontal, positive pointing down. */
  a: number;
  tipX: number;
  tipY: number;
}
export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lane: boolean;
  extra: boolean;
  age: number;
}

const REST = 0.5;
const UP = -0.5;
const FLIP_LEN = 32;
const FLIP_R = 3.5;

function buildWalls(): Seg[] {
  const segs: Seg[] = [];
  const add = (ax: number, ay: number, bx: number, by: number, kind: Seg['kind'] = 0, id = 0): void => {
    segs.push({ ax, ay, bx, by, kind, id });
  };
  // the arch over the top, a circle of radius 90 around (90, 92)
  const cx = TW / 2, cy = 92, R = TW / 2;
  let px = 0, py = cy;
  for (let k = 1; k <= 16; k++) {
    const a = Math.PI - (k / 16) * Math.PI;
    const x = cx + R * Math.cos(a), y = cy - R * Math.sin(a);
    add(px, py, x, y);
    px = x;
    py = y;
  }
  // left wall, and the right wall down the plunger lane
  add(0, cy, 0, 200);
  add(TW, cy, TW, TH);
  // the plunger lane's inner wall, with a cap that turns falling balls away from the lane
  add(TW - 14, TH, TW - 14, 74);
  add(TW - 14, 74, TW - 26, 60);
  // guide rails into the flippers
  add(0, 200, 50, 226);
  add(TW - 14, 200, 116, 226);
  // slingshots (kick the ball) just above the flippers
  add(14, 168, 38, 202, 1);
  add(TW - 28, 168, TW - 52, 202, 1);
  // standup target banks on both side walls: three targets each
  for (let i = 0; i < 3; i++) {
    add(3, 108 + i * 14, 3, 120 + i * 14, 2, i);
    add(TW - 17, 108 + i * 14, TW - 17, 120 + i * 14, 3, i);
  }
  return segs;
}

export class PinballMode extends ModeBase {
  gesture = 'lanes' as const;
  gestureHint = 'LEFT / RIGHT HALF: FLIPPERS • HOLD THE FAR RIGHT EDGE AND LET GO TO LAUNCH';
  id = 'pinball';
  crt = 0.4;
  hp: number;
  walls = buildWalls();
  bumpers: Bumper[] = [
    { x: 48, y: 66, r: 10, flash: 0 },
    { x: 114, y: 66, r: 10, flash: 0 },
    { x: 81, y: 104, r: 10, flash: 0 },
  ];
  flippers: Flipper[] = [
    { px: 50, py: 226, side: 1, a: REST, tipX: 0, tipY: 0 },
    { px: 116, py: 226, side: -1, a: REST, tipX: 0, tipY: 0 },
  ];
  balls: Ball[] = [];
  /** Which target segments are knocked down: [left bank, right bank]. */
  targets: boolean[][] = [[false, false, false], [false, false, false]];
  lanes = [false, false, false];
  phase: 'intro' | 'serve' | 'play' | 'won' | 'lost' = 'intro';
  phaseT = 1.6;
  score = 0;
  goal: number;
  mult = 1;
  charge = 0;
  saverT = 0;
  tilt = false;
  nudges = 0;
  nudgeDecay = 0;
  // missions
  banks = 0;
  laneSets = 0;
  bumperHits = 0;
  private done = [false, false, false];
  private launchT = 0;
  private banner: { text: string; color: string; t: number } | null = null;
  private lampT = 0;
  private wasLeft = false;
  private wasRight = false;
  endT = 0;
  pullLeft = false;

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'pinball', opts);
    this.hp = this.stats.maxHp;
    this.applyCarry();
    this.goal = Math.round(GOALS[game.settings.difficulty] * (1 + (this.tier - 1) * 0.5));
    this.updateFlipperTips();
  }

  enter(): void {
    this.game.music('pinball');
    if (!this.game.profile.lore.includes('pinball_intro')) {
      this.game.profile.lore.push('pinball_intro');
      this.game.say([
        { who: 'manual', name: 'THE MANUAL', text: 'The Core filed a genre under "silver ball". Hold DOWN to pull the plunger back, let go to launch. LEFT and RIGHT (or Z and X) are the flippers.' },
        { who: 'manual', name: 'THE MANUAL', text: 'Reach the score goal before your balls run out. Three missions hide floppy disks: clear the target banks, light the top lanes, smash the bumpers. UP nudges the table, but nudge three times and it TILTS.' },
      ]);
    }
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: this.phase === 'play', bossActive: false };
  }
  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  /** Touch: the screen halves are the flippers; the far right edge is the plunger. */
  laneAt(x: number): Action | null {
    if (x > 400) return 'down';
    return x < W / 2 ? 'left' : 'right';
  }

  onChaosStart(ev: ActiveEvent): void {
    if (ev.def.flags.includes('multiball') && this.phase === 'play') {
      for (let i = 0; i < 2; i++) this.balls.push({ x: 40 + i * 70, y: 30, vx: (i ? -1 : 1) * 40, vy: 30, lane: false, extra: true, age: 0 });
      this.say('MULTIBALL!', '#ff3fa4');
    }
  }

  // ---- simulation -------------------------------------------------------------------
  private get gravity(): number {
    return GRAVITY * (this.director.flag('low_gravity') ? 0.6 : 1);
  }

  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    this.tickShared(dt);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 1.6) this.banner = null;
    }
    this.lampT += dt;
    for (const b of this.bumpers) b.flash = Math.max(0, b.flash - dt * 4);
    if (this.phase === 'won' || this.phase === 'lost') {
      this.endT += dt;
      if (this.phase === 'won' && this.endT > 2.4) this.finish(true, this.finalScore());
      else if (this.phase === 'lost' && this.endT > 2) this.finish(false, this.score);
      return;
    }
    if (this.phase === 'intro') {
      if (this.game.inDialog) return;
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.serve();
      return;
    }

    const inp = this.game.input;
    const left = (inp.held('left') || inp.held('jump')) && !this.tilt;
    const right = (inp.held('right') || inp.held('attack')) && !this.tilt;
    if ((left && !this.wasLeft) || (right && !this.wasRight)) this.game.audio.sfx('select');
    this.wasLeft = left;
    this.wasRight = right;
    this.moveFlippers(left, right, dt);
    this.saverT = Math.max(0, this.saverT - dt);
    this.nudgeDecay += dt;
    if (this.nudgeDecay > 3) {
      this.nudgeDecay = 0;
      this.nudges = Math.max(0, this.nudges - 1);
    }

    if (this.phase === 'serve') this.updatePlunger(dt, inp.held('down'), inp.pressed('special') || inp.pressed('confirm'));
    if (inp.pressed('up') && this.phase === 'play') this.nudge();
    if (this.phase === 'play' || this.phase === 'serve') this.stepBalls(dt);
    this.updateBalls();
    if (this.score >= this.goal && this.phase === 'play') this.win();
  }

  private serve(): void {
    this.phase = 'serve';
    this.balls = [{ x: LANE_X, y: TH - 14, vx: 0, vy: 0, lane: true, extra: false, age: 0 }];
    this.charge = 0;
    this.tilt = false;
    this.mult = 1;
    this.lanes = [false, false, false];
    this.nudges = 0;
  }

  private updatePlunger(dt: number, held: boolean, quick: boolean): void {
    if (quick && this.charge === 0) this.charge = 0.9;
    else if (held) this.charge = Math.min(1, this.charge + dt * 1.1);
    else if (this.charge > 0) {
      const b = this.balls[0];
      b.vy = -(340 + 250 * this.charge);
      b.vx = 0;
      b.age = 0;
      this.charge = 0;
      this.phase = 'play';
      this.launchT = 0;
      this.saverT = 8;
      this.game.audio.sfx('powerup');
      return;
    }
    const b = this.balls[0];
    if (b) b.y = TH - 14 + this.charge * 8; // the spring squeezes
  }

  private nudge(): void {
    this.nudges++;
    this.nudgeDecay = 0;
    if (this.nudges >= 4) {
      this.tilt = true;
      this.say('TILT!', '#ff3f5a');
      this.game.audio.sfx('explode');
      return;
    }
    for (const b of this.balls) {
      b.vy -= 55;
      b.vx += (this.rng.next() - 0.5) * 90;
    }
    this.game.fx.shake(2);
    this.game.audio.sfx('step');
    if (this.nudges === 3) this.popups.add(OX + TW / 2, OY + 120, 'CAREFUL...', '#ffcf3f');
  }

  private moveFlippers(left: boolean, right: boolean, dt: number): void {
    for (const f of this.flippers) {
      const want = f.side === 1 ? left : right;
      const target = want ? UP : REST;
      const speed = want ? 16 : 10;
      f.a += clamp(target - f.a, -speed * dt, speed * dt);
    }
    this.updateFlipperTips();
  }
  private prevTips: Array<[number, number]> = [[0, 0], [0, 0]];
  private updateFlipperTips(): void {
    this.flippers.forEach((f, i) => {
      this.prevTips[i] = [f.tipX, f.tipY];
      f.tipX = f.px + f.side * FLIP_LEN * Math.cos(f.a);
      f.tipY = f.py + FLIP_LEN * Math.sin(f.a);
    });
  }

  private stepBalls(dt: number): void {
    const sub = dt / SUBSTEPS;
    const tipVel = this.flippers.map((f, i) => [(f.tipX - this.prevTips[i][0]) / Math.max(dt, 1e-4), (f.tipY - this.prevTips[i][1]) / Math.max(dt, 1e-4)]);
    for (const b of this.balls) {
      b.age += dt;
      if (b.lane && this.phase === 'serve') continue;
      for (let s = 0; s < SUBSTEPS; s++) {
        b.vy += this.gravity * sub;
        const drag = 1 - 0.12 * sub;
        b.vx *= drag;
        b.vy *= drag;
        const speed = Math.hypot(b.vx, b.vy);
        if (speed > 640) {
          b.vx *= 640 / speed;
          b.vy *= 640 / speed;
        }
        b.x += b.vx * sub;
        b.y += b.vy * sub;
        this.collideWalls(b);
        this.collideBumpers(b);
        this.collideFlippers(b, tipVel);
      }
      this.sensors(b);
    }
  }

  private collideWalls(b: Ball): void {
    for (const w of this.walls) {
      const dx = w.bx - w.ax, dy = w.by - w.ay;
      const len2 = dx * dx + dy * dy;
      let t = ((b.x - w.ax) * dx + (b.y - w.ay) * dy) / len2;
      t = clamp(t, 0, 1);
      const cx = w.ax + dx * t, cy = w.ay + dy * t;
      const ox = b.x - cx, oy = b.y - cy;
      const d = Math.hypot(ox, oy);
      const rr = BALL_R + (w.kind >= 2 ? 1.5 : 1);
      if (d >= rr || d === 0) continue;
      const nx = ox / d, ny = oy / d;
      b.x += nx * (rr - d);
      b.y += ny * (rr - d);
      const vn = b.vx * nx + b.vy * ny;
      if (vn >= 0) continue;
      const e = w.kind === 1 ? 0.2 : 0.5;
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      if (w.kind === 1) {
        // slingshot: a hard kick away from the rubber
        b.vx += nx * 210;
        b.vy += ny * 210;
        this.addScore(50);
        this.game.audio.sfx('step');
      } else if (w.kind >= 2) this.hitTarget(w.kind - 2, w.id);
    }
  }

  private collideBumpers(b: Ball): void {
    const boost = this.director.flag('bumper_boost') ? 1.5 : 1;
    for (const bu of this.bumpers) {
      const ox = b.x - bu.x, oy = b.y - bu.y;
      const d = Math.hypot(ox, oy);
      const rr = BALL_R + bu.r;
      if (d >= rr || d === 0) continue;
      const nx = ox / d, ny = oy / d;
      b.x = bu.x + nx * rr;
      b.y = bu.y + ny * rr;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= 1.6 * vn * nx;
        b.vy -= 1.6 * vn * ny;
      }
      const kick = 230 * boost;
      if (b.vx * nx + b.vy * ny < kick) {
        b.vx += nx * (kick - (b.vx * nx + b.vy * ny)) * 0.6;
        b.vy += ny * (kick - (b.vx * nx + b.vy * ny)) * 0.6;
      }
      bu.flash = 1;
      this.bumperHits++;
      this.addScore(100 * (boost > 1 ? 2 : 1));
      this.game.audio.sfx('coin');
      this.director.feed(1);
      if (!this.done[2] && this.bumperHits >= 50) this.completeMission(2, 'BUMPER CARS');
    }
  }

  private collideFlippers(b: Ball, tipVel: number[][]): void {
    this.flippers.forEach((f, i) => {
      const dx = f.tipX - f.px, dy = f.tipY - f.py;
      const len2 = dx * dx + dy * dy;
      const t = clamp(((b.x - f.px) * dx + (b.y - f.py) * dy) / len2, 0, 1);
      const cx = f.px + dx * t, cy = f.py + dy * t;
      const ox = b.x - cx, oy = b.y - cy;
      const d = Math.hypot(ox, oy);
      const rr = BALL_R + FLIP_R;
      if (d >= rr || d === 0) return;
      const nx = ox / d, ny = oy / d;
      b.x += nx * (rr - d);
      b.y += ny * (rr - d);
      // the point on the flipper moves with the swing; the closer to the tip, the faster
      const vfx = tipVel[i][0] * t, vfy = tipVel[i][1] * t;
      const rvx = b.vx - vfx, rvy = b.vy - vfy;
      const vn = rvx * nx + rvy * ny;
      if (vn >= 0) return;
      const e = 0.3;
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
    });
  }

  private sensors(b: Ball): void {
    // top rollover lanes
    // (the launch itself sweeps across the lanes, so they only count once the ball is in play)
    if (b.y < 34 && b.y > 14 && b.age > 2.4) {
      for (let i = 0; i < 3; i++) {
        const lx = 55 + i * 28;
        if (!this.lanes[i] && Math.abs(b.x - lx) < 8) {
          this.lanes[i] = true;
          this.addScore(200, false);
          this.game.audio.sfx('coin');
          if (this.lanes.every(Boolean)) this.laneComplete();
        }
      }
    }
    // the ball has left the plunger lane
    if (b.lane && b.y < 70) b.lane = false;
    // a ball that rolled back down into the lane goes back to the plunger
    if (!b.lane && b.x > TW - 14 && b.y > 120 && b.vy > 0 && this.phase === 'play') {
      b.lane = true;
    }
    if (b.lane && b.x < TW - 14 && b.y > 90) b.lane = false;
    // a ball that stops dead goes back into play
    if (b.age > 3 && Math.hypot(b.vx, b.vy) < 6 && b.y < TH - 30 && !b.lane) {
      b.vx += (this.rng.next() - 0.5) * 60;
      b.vy -= 40;
    }
  }

  private updateBalls(): void {
    if (this.phase !== 'play') return;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      // wedged below the lane (it fell into the plunger lane after launch): feed it back up
      if (b.lane && b.y > TH - 16 && Math.abs(b.vy) < 2 && this.balls.length === 1 && b.age > 2) {
        this.balls = [{ x: LANE_X, y: TH - 14, vx: 0, vy: 0, lane: true, extra: false, age: 0 }];
        this.phase = 'serve';
        return;
      }
      if (b.y > TH + 14 || b.x < -10 || b.x > TW + 10 || b.y < -10) {
        if (b.y < -10 || b.x < -10 || b.x > TW + 10) {
          // never let a ball escape the table
          b.x = clamp(b.x, 10, TW - 20);
          b.y = clamp(b.y, 20, 60);
          b.vy = 40;
          continue;
        }
        this.balls.splice(i, 1);
      }
    }
    if (this.balls.length === 0) this.drain();
  }

  private drain(): void {
    if (this.saverT > 0) {
      this.say('BALL SAVED!', '#7dff6b');
      this.balls = [{ x: LANE_X, y: TH - 14, vx: 0, vy: 0, lane: true, extra: false, age: 0 }];
      this.phase = 'serve';
      this.charge = 0;
      this.tilt = false;
      return;
    }
    const dmg = this.takenMult;
    this.hp = Math.max(0, this.hp - dmg);
    this.noteDamage(dmg);
    if (this.hp <= 0) {
      this.phase = 'lost';
      this.endT = 0;
      this.say('GAME OVER', '#ff3f5a');
      return;
    }
    this.phase = 'serve';
    this.serve();
    this.say('BALL LOST', '#ff6f3f');
  }

  // ---- scoring and missions ---------------------------------------------------------
  private addScore(n: number, mult = true): void {
    this.score += Math.round(n * (mult ? this.mult : 1));
  }

  private hitTarget(bank: number, i: number): void {
    if (this.targets[bank][i]) return;
    this.targets[bank][i] = true;
    this.addScore(300);
    this.game.audio.sfx('coin');
    if (this.targets[bank].every(Boolean)) {
      this.targets[bank] = [false, false, false];
      this.banks++;
      this.addScore(1500);
      this.say('BANK CLEARED!', '#ffcf3f');
      this.game.audio.sfx('levelup');
      this.addBits(5);
      if (!this.done[0] && this.banks >= 3) this.completeMission(0, 'TARGET PRACTICE');
    }
  }

  private laneComplete(): void {
    this.lanes = [false, false, false];
    this.laneSets++;
    this.mult = Math.min(4, this.mult + 1);
    this.addScore(700, false);
    this.say(`LANES! x${this.mult}`, '#3fe0ff');
    this.game.audio.sfx('levelup');
    if (!this.done[1] && this.laneSets >= 3) this.completeMission(1, 'LANE KING');
  }

  private completeMission(i: number, name: string): void {
    this.done[i] = true;
    this.addScore(2000, false);
    this.say(`MISSION: ${name}`, '#ff3fa4');
    this.collectFloppy(i);
  }

  private say(text: string, color: string): void {
    this.banner = { text, color, t: 0 };
  }

  private finalScore(): number {
    return this.score + this.hp * 400 + Math.max(0, 3000 - Math.floor(this.time * 8)) + this.runBits * 10;
  }

  private win(): void {
    this.phase = 'won';
    this.endT = 0;
    this.addBits(40);
    this.say('JACKPOT!', '#ffcf3f');
    this.game.audio.sfx('levelup');
    this.game.fx.flash('#ffffff', 0.3);
  }

  // ---- drawing ----------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    backdrop(ctx, '#05020d', '#0d1230');
    glow(ctx, OX + TW / 2, OY + 120, 200, '107,255,216', 0.1);
    ctx.save();
    ctx.translate(OX, OY);
    this.drawTable(ctx);
    ctx.restore();
    this.drawSide(ctx);
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    if (this.banner) {
      const a = this.banner.t > 1.2 ? (1.6 - this.banner.t) / 0.4 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      drawText(ctx, this.banner.text, OX + TW / 2, OY + 130, this.banner.color, { align: 'center', scale: 2 });
      ctx.globalAlpha = 1;
    }
  }

  private drawTable(ctx: CanvasRenderingContext2D): void {
    // playfield
    ctx.fillStyle = '#0a0d26';
    ctx.beginPath();
    ctx.moveTo(0, TH);
    ctx.lineTo(0, 92);
    ctx.arc(TW / 2, 92, TW / 2, Math.PI, 0);
    ctx.lineTo(TW, TH);
    ctx.closePath();
    ctx.fill();
    // walls
    ctx.lineCap = 'round';
    for (const w of this.walls) {
      let color = '#6bffd8';
      let width = 2;
      if (w.kind === 1) {
        color = '#ff3fa4';
        width = 3;
      } else if (w.kind >= 2) {
        const lit = this.targets[w.kind - 2][w.id];
        color = lit ? '#2a3a3a' : '#ffcf3f';
        width = 4;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(w.ax, w.ay);
      ctx.lineTo(w.bx, w.by);
      ctx.stroke();
    }
    // rollover lanes: A B C
    for (let i = 0; i < 3; i++) {
      const lx = 55 + i * 28;
      const on = this.lanes[i];
      rect(ctx, lx - 5, 22, 10, 10, on ? '#3fe0ff' : '#14304a');
      drawText(ctx, 'ABC'[i], lx, 25, on ? '#05020d' : '#3fe0ff', { align: 'center', shadow: null });
    }
    // bumpers
    for (const b of this.bumpers) {
      glow(ctx, b.x, b.y, 22 + b.flash * 10, '255,63,164', 0.25 + b.flash * 0.4);
      ctx.fillStyle = b.flash > 0.3 ? '#ffffff' : '#ff3fa4';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffcf3f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r - 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    // plunger and its lane
    rect(ctx, TW - 10, TH - 6 + this.charge * 8, 6, 4, '#c8c8d8');
    rect(ctx, TW - 8, TH - 2 + this.charge * 8, 2, 2, '#888');
    // flippers
    ctx.lineWidth = FLIP_R * 2;
    ctx.strokeStyle = this.tilt ? '#555' : '#ffffff';
    for (const f of this.flippers) {
      ctx.beginPath();
      ctx.moveTo(f.px, f.py);
      ctx.lineTo(f.tipX, f.tipY);
      ctx.stroke();
      rect(ctx, f.px - 2, f.py - 2, 4, 4, '#ff3fa4');
    }
    // balls
    for (const b of this.balls) {
      glow(ctx, b.x, b.y, 10, '255,255,255', 0.25);
      ctx.fillStyle = '#e8e8f4';
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      rect(ctx, b.x - 2, b.y - 2, 2, 2, '#fff');
    }
    if (this.saverT > 0 && Math.floor(this.lampT * 3) % 2 === 0) drawText(ctx, 'BALL SAVE', TW / 2 - 7, 236, '#7dff6b', { align: 'center', shadow: null });
    if (this.phase === 'serve') drawText(ctx, this.game.input.usingTouch ? 'HOLD RIGHT EDGE' : 'HOLD DOWN, LET GO', TW / 2, 160, '#ffcf3f', { align: 'center' });
    if (this.tilt) drawText(ctx, 'TILT', TW / 2, 130, '#ff3f5a', { align: 'center', scale: 3 });
    if (this.phase === 'serve') bar(ctx, TW - 12, 150, 10, 3, this.charge, '#ffcf3f', '#201a08', '#ffffff55');
  }

  private drawSide(ctx: CanvasRenderingContext2D): void {
    const lx = 8;
    drawText(ctx, 'SCORE', lx, 8, '#9a9ab8');
    drawText(ctx, `${this.score}`, lx, 18, '#fff', { scale: 2 });
    drawText(ctx, `GOAL ${this.goal}`, lx, 38, '#6bffd8');
    bar(ctx, lx, 48, 120, 5, this.score / this.goal, '#6bffd8', '#0a2a24', '#ffffff55');
    drawText(ctx, 'BALLS', lx, 62, '#9a9ab8');
    hearts(ctx, lx, 72, this.hp, this.stats.maxHp);
    drawText(ctx, `MULTIPLIER X${this.mult}`, lx, 90, this.mult > 1 ? '#3fe0ff' : '#9a9ab8');
    drawText(ctx, 'MISSIONS', lx, 110, '#ffcf3f');
    const ms: Array<[string, number, number]> = [
      ['TARGET BANKS', this.banks, 3],
      ['TOP LANES', this.laneSets, 3],
      ['BUMPERS', this.bumperHits, 50],
    ];
    ms.forEach(([name, n, goal], i) => {
      const ok = this.done[i];
      drawText(ctx, `${ok ? '★' : '☆'} ${name}`, lx, 122 + i * 22, ok ? '#ffcf3f' : '#ddd');
      bar(ctx, lx, 132 + i * 22, 100, 4, Math.min(1, n / goal), ok ? '#ffcf3f' : '#ff3fa4', '#201020', '#ffffff44');
      drawText(ctx, ok ? 'DISK!' : `${Math.min(n, goal)}/${goal}`, lx + 106, 130 + i * 22, ok ? '#3fe0ff' : '#9a9ab8');
    });
    this.drawChaosHud(ctx, W - 106, 6);
    this.drawRunInfo(ctx, W - 106, 62);
    this.drawHint(ctx, 'LEFT / RIGHT FLIPPERS • HOLD DOWN + RELEASE: LAUNCH • UP: NUDGE');
    this.drawSeed(ctx);
    void H;
  }
}
