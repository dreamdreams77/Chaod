/**
 * PENALTY STORM — sports meets bullet hell. Dribble across the pitch, dodge the keeper's
 * bullet patterns, and put six shots past him. Get hit with the ball at your feet and you lose it.
 *
 * Mutation honoured: SLAP SHOT (sports+bullet hell) — a ball in flight smashes every bullet it touches.
 * Chaos flags honoured: crosswind (bullets drift sideways), mud (everyone slows down), big_keeper.
 * Controls: arrows run, Z kicks (aim by running left or right as you shoot), hold X to sprint.
 * Touch: drag to run, tap to kick, second finger held to sprint.
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import type { DirectorContext } from '../chaos/director.ts';
import { FIELD, GOAL, GOALS_TO_WIN, PatternId, PitchPlan, Pickup, generatePitch } from '../procgen/pitch.ts';
import { H, W, PAL, glow, rect, bar, hearts, clamp, approach } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { drawCass } from '../render/actors.ts';
import type { Rng } from '../core/rng.ts';

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  hue: number;
}

type BallState = 'carried' | 'flying' | 'loose' | 'net';
interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: BallState;
}
type Phase = 'intro' | 'play' | 'goal' | 'won' | 'lost';
type KeeperState = 'patrol' | 'dive' | 'recover';

export const RUN_SPEED = 92;
export const SPRINT_SPEED = 140;
export const SHOT_SPEED = 270;
export const PATTERN_TIME = 4.5;
export const PAUSE_TIME = 0.9;
const STAMINA_MAX = 1.8;
const KEEPER_Y = GOAL.line - 8;
const BASE_KEEPER_W = 40;
const BULLET_R = 2.5;
const PLAYER_R = 4.5;
const MIN_Y = 112;
const HUES = ['#ff9f3f', '#ff3fd2', '#3fe0ff'];

export class PenaltyMode extends ModeBase {
  id = 'penalty';
  crt = 0.22;
  hp: number;
  gesture = 'topdown' as const;
  gestureHint = 'DRAG: RUN • TAP: KICK (RUN LEFT OR RIGHT TO AIM) • 2ND FINGER HELD: SPRINT';
  readonly plan: PitchPlan;
  phase: Phase = 'intro';
  px = 240;
  py = 226;
  face = 1;
  aimX = 0;
  private aimT = 0;
  stamina = STAMINA_MAX;
  private staminaLock = 0;
  iframes = 0;
  stun = 0;
  moving = false;
  ball: Ball = { x: 247, y: 224, vx: 0, vy: 0, state: 'carried' };
  goals = 0;
  saves = 0;
  hits = 0;
  cleanRun = 0;
  corners = 0;
  bullets: Bullet[] = [];
  pickups: Pickup[] = [];
  keeper = { x: 240, state: 'patrol' as KeeperState, target: 240, reactT: 0, holdT: 0, mood: 0 };
  private patI = 0;
  private patT = 0;
  private pauseT = 1.5;
  private emitT = 0;
  private spin = 0;
  private patClock = 0;
  private introT = 2.2;
  endT = 0;
  /** Volley randomness has its own stream, so a seed gives every player the same patterns whatever they do. */
  private readonly volleyRng: Rng;
  private banner: { text: string; color: string; t: number } | null = null;

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'penalty', opts);
    this.plan = generatePitch(this.seed);
    this.volleyRng = this.rng.fork(0x70c);
    this.hp = this.stats.maxHp;
    this.applyCarry();
    this.pickups = this.plan.pickups[Math.min(this.level, GOALS_TO_WIN - 1)].map((p) => ({ ...p }));
    this.patClock = this.plan.keeper.phase;
  }

  enter(): void {
    this.game.music('penalty');
    if (!this.game.profile.lore.includes('penalty_intro')) {
      this.game.profile.lore.push('penalty_intro');
      this.game.say([
        { who: 'manual', name: 'THE MANUAL', text: 'A stadium from a genre that never shipped: football, but the keeper fires bullets. Score six goals before your hearts run out.' },
        { who: 'manual', name: 'THE MANUAL', text: 'Arrows run, Z kicks. Run left or right as you shoot to aim for a corner. Hold X to sprint. Get hit and you drop the ball! On a phone: drag to run, tap to kick.' },
      ]);
    }
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: this.phase === 'play', bossActive: false };
  }

  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  /** BOSS GAUNTLET leg 3: the keeper in OVERTIME. Fewer goals to win, but his patterns start where they ended. */
  get overtime(): boolean {
    return (this.opts.rush?.leg ?? 0) >= 3;
  }
  get goalsNeeded(): number {
    return this.overtime ? 4 : GOALS_TO_WIN;
  }
  /** How far into the keeper's tricks the match is: goals scored, plus the overtime head start. */
  private get level(): number {
    return this.goals + (this.overtime ? 3 : 0);
  }

  // ---- numbers ---------------------------------------------------------------------
  get keeperWidth(): number {
    return BASE_KEEPER_W * (this.director.flag('big_keeper') ? 1.7 : 1);
  }
  /** Bullet speed dial: difficulty, ENDLESS rounds and how far the match has gone. */
  private get speedK(): number {
    return 1.12 * Math.sqrt(this.diffMult) * (1 + 0.07 * this.level) * (this.director.flag('mud') ? 0.85 : 1);
  }
  private patternsNow(): PatternId[] {
    return this.plan.rounds[Math.min(this.level, GOALS_TO_WIN - 1)];
  }
  /** Where the keeper stands while patrolling. */
  patrolX(clock = this.patClock): number {
    const k = this.plan.keeper;
    const amp = k.amp * (1 + 0.03 * this.level);
    const half = (GOAL.right - GOAL.left) / 2 - this.keeperWidth / 2 - 2;
    // The keeper leans toward where the player is, so there is never a free side to shoot at.
    const centre = 240 + (this.px - 240) * 0.35;
    return clamp(centre + Math.sin((clock * Math.PI * 2) / k.period) * amp, 240 - half, 240 + half);
  }
  /** The spot in the net a kick from here would go to. */
  aimTarget(px = this.px, aimX = this.aimX): number {
    return clamp(240 + clamp((px - 240) * 0.5 + aimX * 60, -76, 76), GOAL.left + 6, GOAL.right - 6);
  }

  // ---- simulation ------------------------------------------------------------------
  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    this.tickShared(dt);
    this.spin += dt;
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 1.6) this.banner = null;
    }
    this.iframes = Math.max(0, this.iframes - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.keeper.mood = Math.max(0, this.keeper.mood - dt);

    if (this.phase === 'won' || this.phase === 'lost') {
      this.endT += dt;
      // After the whistle nothing else counts: a shot still in the air must not turn a loss into a win.
      if (this.phase === 'won') this.updateBall(dt);
      if (this.phase === 'won' && this.endT > 2.4) {
        const score = this.goals * 400 + this.hp * 300 + Math.max(0, 3000 - Math.floor(this.time * 10)) + this.corners * 150 + this.runBits * 10;
        this.finish(true, score);
      } else if (this.phase === 'lost' && this.endT > 1.8) this.finish(false, this.goals * 250 + this.runBits * 5);
      return;
    }

    if (this.phase === 'intro') {
      this.introT -= dt;
      if (this.introT <= 0) {
        this.phase = 'play';
        this.say(this.overtime ? 'OVERTIME!' : 'KICK OFF!', '#ffcf3f');
        this.game.audio.sfx('warn');
      }
    }
    this.updatePlayer(dt);
    if (this.phase === 'play') {
      this.patClock += dt;
      this.updatePatterns(dt);
      this.updateBullets(dt);
    } else if (this.phase === 'goal') {
      this.endT += dt;
      this.patClock += dt * 0.3;
      if (this.endT > 1.9) this.kickOff();
    } else this.patClock += dt;
    this.updateKeeper(dt);
    this.updateBall(dt);
    this.updatePickups();
    if (this.hp <= 0 && (this.phase as Phase) !== 'won') {
      this.phase = 'lost';
      this.endT = 0;
      this.bullets = [];
      this.game.audio.sfx('explode');
      this.say('FULL TIME', '#ff3f5a');
    }
  }

  private say(text: string, color: string): void {
    this.banner = { text, color, t: 0 };
  }

  private updatePlayer(dt: number): void {
    const inp = this.game.input;
    const ax = inp.axisX();
    const ay = inp.axisY();
    this.moving = ax !== 0 || ay !== 0;
    const sprint = inp.held('attack') && this.moving && this.stamina > 0;
    if (sprint) {
      this.stamina = Math.max(0, this.stamina - dt);
      if (this.stamina <= 0) this.staminaLock = 0.6;
    } else {
      this.staminaLock = Math.max(0, this.staminaLock - dt);
      if (this.staminaLock <= 0) this.stamina = Math.min(STAMINA_MAX, this.stamina + 0.9 * dt);
    }
    const len = Math.hypot(ax, ay) || 1;
    const speed = (sprint ? SPRINT_SPEED : RUN_SPEED) * (this.director.flag('mud') ? 0.78 : 1);
    this.px = clamp(this.px + (ax / len) * speed * dt, FIELD.left + 6, FIELD.right - 6);
    this.py = clamp(this.py + (ay / len) * speed * dt, MIN_Y, FIELD.bottom);
    if (ax) {
      this.face = ax > 0 ? 1 : -1;
      this.aimX = this.face;
      this.aimT = 0.45;
    } else {
      this.aimT -= dt;
      if (this.aimT <= 0) this.aimX = 0;
    }
    if (this.phase === 'play' && (inp.pressed('jump') || inp.pressed('confirm'))) this.kick();
  }

  /** Shoots from the player's feet toward the aim point in the net. */
  kick(): void {
    const b = this.ball;
    if (b.state !== 'carried' || this.phase !== 'play') return;
    const tx = this.aimTarget();
    const dx = tx - b.x;
    const dy = GOAL.line - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = SHOT_SPEED * (this.director.flag('mud') ? 0.88 : 1);
    b.vx = (dx / d) * sp;
    b.vy = (dy / d) * sp;
    b.state = 'flying';
    this.game.audio.sfx('kick');
    // The keeper reads the shot, a little late and a little wrong.
    const k = this.keeper;
    k.state = 'dive';
    k.reactT = this.plan.keeper.react * (this.director.flag('big_keeper') ? 0.9 : 1) * (this.hasPerk('crackshot') ? 1.3 : 1);
    k.target = tx + this.rng.range(-9, 9);
  }

  private updatePatterns(dt: number): void {
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      return;
    }
    const set = this.patternsNow();
    this.patT += dt;
    this.emitT -= dt;
    const pat = set[this.patI % set.length];
    if (this.emitT <= 0) this.emit(pat);
    if (this.patT >= PATTERN_TIME) {
      this.patT = 0;
      this.patI++;
      // A longer breather once the keeper has run the whole set.
      this.pauseT = this.patI % set.length === 0 ? PAUSE_TIME + 0.8 : PAUSE_TIME;
      this.emitT = 0;
    }
  }

  /** Fires one volley of `pat`; sets the delay until the next one. */
  private emit(pat: PatternId): void {
    const lvl = this.level;
    const sk = this.speedK;
    const kx = this.keeper.x;
    const ky = KEEPER_Y - 6;
    const hard = this.game.settings.difficulty === 'hard' ? 1 : 0;
    const add = (x: number, y: number, ang: number, speed: number, hue = 0) => this.bullets.push({ x, y, vx: Math.cos(ang) * speed * sk, vy: Math.sin(ang) * speed * sk, age: 0, hue });
    switch (pat) {
      case 'fan': {
        const n = 7 + Math.min(lvl, 4) + hard * 2;
        const aim = Math.atan2(this.py - ky, this.px - kx);
        for (let i = 0; i < n; i++) add(kx, ky, aim + (i - (n - 1) / 2) * (1.5 / (n - 1)), 80 + 7 * lvl, 0);
        this.emitT = 0.9 - 0.04 * lvl;
        break;
      }
      case 'rain': {
        add(this.volleyRng.range(FIELD.left, FIELD.right), FIELD.top, Math.PI / 2, 92 + 7 * lvl, 2);
        // Half the drops are aimed at the player's column.
        add(clamp(this.px + this.volleyRng.range(-24, 24), FIELD.left, FIELD.right), FIELD.top, Math.PI / 2, 100 + 7 * lvl, 2);
        this.emitT = 0.2 - 0.008 * lvl;
        break;
      }
      case 'spiral': {
        this.spin += 0.62;
        add(kx, ky, this.spin, 72 + 6 * lvl, 1);
        add(kx, ky, this.spin + (Math.PI * 2) / 3, 72 + 6 * lvl, 1);
        add(kx, ky, this.spin + (Math.PI * 4) / 3, 72 + 6 * lvl, 1);
        this.emitT = 0.1 - 0.003 * lvl;
        break;
      }
      case 'ring': {
        const n = 20 + lvl * 2 + hard * 3;
        const off = this.volleyRng.range(0, Math.PI * 2);
        for (let i = 0; i < n; i++) add(kx, ky, off + (i / n) * Math.PI * 2, 68 + 6 * lvl, 0);
        this.emitT = 1.15 - 0.04 * lvl;
        break;
      }
      case 'sweep': {
        const gap = this.volleyRng.range(70, 410);
        const half = 26 - Math.min(lvl, 4) * 1.5;
        for (let x = FIELD.left; x <= FIELD.right; x += 12) if (Math.abs(x - gap) > half) add(x, FIELD.top + 4, Math.PI / 2, 62 + 5 * lvl, 2);
        this.emitT = 1.5 - 0.05 * lvl;
        break;
      }
    }
  }

  private updateBullets(dt: number): void {
    const wind = this.director.flag('crosswind') ? Math.sin(this.time * 1.3) * 34 : 0;
    const shield = this.fusion.has('ball_shield') && this.ball.state === 'flying';
    const radius = this.fusion.param('slap_shot', 'radius', 11);
    for (const b of this.bullets) {
      b.age += dt;
      b.vx += wind * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (shield && Math.hypot(b.x - this.ball.x, b.y - this.ball.y) < radius) {
        b.age = -1;
        this.particles.burst(b.x, b.y, [HUES[b.hue], '#fff'], 4, 40);
      }
    }
    // Drop spent and off-screen bullets in place (this runs every frame with hundreds of bullets).
    let keep = 0;
    for (const b of this.bullets) if (b.age >= 0 && b.x > -10 && b.x < W + 10 && b.y > FIELD.top - 14 && b.y < H + 10) this.bullets[keep++] = b;
    this.bullets.length = keep;
    if (this.iframes > 0) return;
    for (const b of this.bullets) {
      if (Math.hypot(b.x - this.px, b.y - (this.py - 7)) < BULLET_R + PLAYER_R) {
        this.hurt(b);
        break;
      }
    }
  }

  private hurt(from: Bullet): void {
    const dmg = this.damageMult;
    this.hp = Math.max(0, this.hp - dmg);
    this.hits++;
    this.cleanRun = 0;
    this.iframes = 1.4;
    this.noteDamage(dmg);
    this.popups.add(this.px, this.py - 20, `-${dmg}`, '#ff3f5a');
    from.age = -1;
    if (this.ball.state === 'carried') {
      // The ball is knocked loose, away from whatever hit you.
      const a = Math.atan2(this.ball.y - from.y, this.ball.x - from.x);
      this.ball.state = 'loose';
      this.ball.vx = Math.cos(a) * 130;
      this.ball.vy = Math.sin(a) * 130;
      this.stun = 0.5;
    }
  }

  private updateKeeper(dt: number): void {
    const k = this.keeper;
    const kp = this.plan.keeper;
    const dive = kp.dive * (1 + 0.04 * this.level);
    if (k.state === 'patrol') {
      k.x = approach(k.x, this.patrolX(), 160 * dt);
    } else if (k.state === 'dive') {
      if (k.reactT > 0) k.reactT -= dt;
      else k.x = approach(k.x, k.target, dive * dt);
    } else {
      k.holdT -= dt;
      if (k.holdT <= 0) {
        k.x = approach(k.x, this.patrolX(), 110 * dt);
        if (Math.abs(k.x - this.patrolX()) < 3) k.state = 'patrol';
      }
    }
    const half = this.keeperWidth / 2;
    k.x = clamp(k.x, GOAL.left + half - 2, GOAL.right - half + 2);
  }

  private updateBall(dt: number): void {
    const b = this.ball;
    if (b.state === 'carried') {
      b.x = this.px + this.face * 7;
      b.y = this.py - 2;
      return;
    }
    if (b.state === 'flying') {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y <= GOAL.line) this.resolveShot();
      else if (b.x < FIELD.left || b.x > FIELD.right) {
        b.state = 'loose';
        b.vx *= -0.4;
        b.vy *= 0.4;
        this.keeper.state = 'recover';
        this.keeper.holdT = 0.2;
      }
      return;
    }
    if (b.state === 'loose') {
      const damp = Math.exp(-1.7 * dt);
      b.vx *= damp;
      b.vy *= damp;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < FIELD.left) { b.x = FIELD.left; b.vx = Math.abs(b.vx) * 0.7; }
      if (b.x > FIELD.right) { b.x = FIELD.right; b.vx = -Math.abs(b.vx) * 0.7; }
      if (b.y > FIELD.bottom + 4) { b.y = FIELD.bottom + 4; b.vy = -Math.abs(b.vy) * 0.7; }
      if (b.y < GOAL.line + 6) { b.y = GOAL.line + 6; b.vy = Math.abs(b.vy) * 0.7; }
      if (this.phase === 'won' || this.phase === 'lost' || this.stun > 0) return;
      const d = Math.hypot(b.x - this.px, b.y - (this.py - 3));
      // Holding X is a first touch: the ball is drawn in when the player is close.
      if (this.game.input.held('attack') && d < 30 && d > 6) {
        b.vx += ((this.px - b.x) / d) * 520 * dt;
        b.vy += ((this.py - 3 - b.y) / d) * 520 * dt;
      }
      if (d < 9) {
        b.state = 'carried';
        b.vx = b.vy = 0;
        this.game.audio.sfx('select');
      }
    }
  }

  private resolveShot(): void {
    const b = this.ball;
    if (this.hp <= 0) {
      // The player went down while the ball was in the air: it never counts.
      b.state = 'loose';
      b.vx = b.vy = 0;
      b.y = GOAL.line + 6;
      return;
    }
    const k = this.keeper;
    b.y = GOAL.line;
    if (Math.abs(b.x - k.x) <= this.keeperWidth / 2 + 3) {
      // Saved: the ball spills back out.
      this.saves++;
      b.state = 'loose';
      b.vx = this.rng.range(-110, 110);
      b.vy = 250;
      b.y = GOAL.line + 4;
      k.state = 'recover';
      k.holdT = 0.45;
      k.mood = 0.8;
      this.say('SAVED!', '#9a9ab8');
      this.game.audio.sfx('block');
      this.particles.burst(b.x, b.y, ['#fff', '#ff9f3f'], 8, 70);
      return;
    }
    if (b.x < GOAL.left + 2 || b.x > GOAL.right - 2) {
      b.state = 'loose';
      b.vx = this.rng.range(-60, 60);
      b.vy = 120;
      b.y = GOAL.line + 4;
      k.state = 'recover';
      k.holdT = 0.2;
      this.say('WIDE!', '#9a9ab8');
      this.game.audio.sfx('miss');
      return;
    }
    this.scored(b.x);
  }

  private scored(x: number): void {
    const b = this.ball;
    b.state = 'net';
    b.vx = b.vy = 0;
    b.y = GOAL.line - 6;
    this.goals++;
    this.cleanRun++;
    const corner = Math.abs(x - 240) > 56;
    if (corner) this.corners++;
    this.keeper.state = 'recover';
    this.keeper.holdT = 2;
    this.bullets = [];
    this.addBits(12 + (corner ? 5 : 0), x, GOAL.line + 14);
    this.game.audio.sfx('whistle');
    this.game.audio.sfx('cheer');
    this.game.fx.shake(4);
    this.particles.burst(x, GOAL.line - 4, ['#fff', '#ffcf3f', '#ff9f3f'], 26, 110);
    this.say(this.goals >= this.goalsNeeded ? 'FINAL WHISTLE!' : corner ? 'TOP CORNER!' : 'GOAL!', '#7dff6b');
    if (this.cleanRun >= 3) this.runFlags.add('hat_trick');
    if (!this.overtime && this.goals === 2) this.collectFloppy(0);
    if (!this.overtime && this.goals === 4) this.collectFloppy(1);
    if (this.goals >= this.goalsNeeded) {
      this.phase = 'won';
      this.endT = 0;
      if (!this.overtime) this.collectFloppy(2);
      this.addBits(40);
      this.game.fx.flash('#7dff6b', 0.35);
      return;
    }
    this.phase = 'goal';
    this.endT = 0;
  }

  /** Back to the centre spot with a fresh set of patterns and pickups. */
  private kickOff(): void {
    this.phase = 'play';
    this.endT = 0;
    this.px = 240;
    this.py = 226;
    this.bullets = [];
    this.ball = { x: 247, y: 224, vx: 0, vy: 0, state: 'carried' };
    this.keeper.state = 'recover';
    this.keeper.holdT = 0;
    this.patI = 0;
    this.patT = 0;
    this.pauseT = 1.6;
    this.emitT = 0;
    this.iframes = 1;
    this.pickups = (this.plan.pickups[Math.min(this.level, GOALS_TO_WIN - 1)] ?? []).map((p) => ({ ...p }));
    this.say(`GOAL ${this.goals + 1} OF ${this.goalsNeeded}`, '#ffcf3f');
    this.game.audio.sfx('warn');
  }

  private updatePickups(): void {
    for (const p of this.pickups) {
      if (Math.hypot(p.x - this.px, p.y - (this.py - 4)) > 11) continue;
      if (p.kind === 'heart' && this.hp >= this.stats.maxHp) continue;
      p.x = -999;
      if (p.kind === 'bit') {
        this.addBits(3, this.px, this.py - 18);
        this.game.audio.sfx('coin');
      } else {
        this.heal(1);
        this.popups.add(this.px, this.py - 18, '+1 HEART', '#ff3f6b');
        this.game.audio.sfx('powerup');
      }
    }
    if (this.pickups.some((p) => p.x < -900)) this.pickups = this.pickups.filter((p) => p.x > -900);
  }

  // ---- drawing ---------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const pal = PAL.penalty;
    rect(ctx, 0, 0, W, H, pal.bg0);
    this.drawStands(ctx);
    this.drawPitch(ctx);
    this.drawGoal(ctx);
    for (const p of this.pickups) this.drawPickup(ctx, p);
    this.drawAim(ctx);
    // Back to front: the keeper is always furthest away; the ball sorts against the player.
    this.drawKeeper(ctx);
    const ballBehind = this.ball.y + 4 < this.py;
    if (this.ball.state !== 'net' && ballBehind) this.drawBall(ctx);
    this.drawPlayer(ctx);
    if (this.ball.state !== 'net' && !ballBehind) this.drawBall(ctx);
    for (const b of this.bullets) this.drawBullet(ctx, b);
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    this.drawHud(ctx);
  }

  private drawStands(ctx: CanvasRenderingContext2D): void {
    rect(ctx, 0, 0, W, 28, '#0a0618');
    const cheer = this.phase === 'goal' || this.phase === 'won' ? 1 : 0;
    for (let i = 0; i < 58; i++) {
      const x = i * 8 + 2;
      for (let r = 0; r < 2; r++) {
        const hop = cheer ? Math.abs(Math.sin(this.time * 9 + i)) * 3 : Math.sin(this.time * 2 + i * 1.7) > 0.9 ? 1 : 0;
        rect(ctx, x, 14 + r * 8 - hop, 4, 5, ['#ff3fd2', '#3fe0ff', '#ffcf3f', '#7dff6b', '#ff6f3f'][(i * 3 + r * 2) % 5]);
      }
    }
    rect(ctx, 0, 26, W, 2, '#ffffff22');
  }

  private drawPitch(ctx: CanvasRenderingContext2D): void {
    const pal = PAL.penalty;
    for (let y = 28, i = 0; y < H; y += 20, i++) rect(ctx, 0, y, W, 20, i % 2 ? pal.bg1 : '#0f4a24');
    glow(ctx, W / 2, 190, 260, '255,255,255', 0.05);
    const line = '#ffffffaa';
    // Touchlines, the box and the arc.
    rect(ctx, FIELD.left - 2, FIELD.top + 2, FIELD.right - FIELD.left + 4, 1, line);
    rect(ctx, FIELD.left - 2, FIELD.top + 2, 1, H - FIELD.top - 8, line);
    rect(ctx, FIELD.right + 1, FIELD.top + 2, 1, H - FIELD.top - 8, line);
    rect(ctx, 110, FIELD.top + 2, 1, 84, line);
    rect(ctx, 370, FIELD.top + 2, 1, 84, line);
    rect(ctx, 110, FIELD.top + 86, 261, 1, line);
    rect(ctx, 200, FIELD.top + 2, 1, 30, line);
    rect(ctx, 280, FIELD.top + 2, 1, 30, line);
    rect(ctx, 200, FIELD.top + 32, 81, 1, line);
    ctx.strokeStyle = line;
    ctx.beginPath();
    ctx.arc(240, FIELD.top + 70, 28, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
    rect(ctx, 239, FIELD.top + 56, 2, 2, '#fff');
    // The line the player cannot cross.
    ctx.globalAlpha = 0.18;
    for (let x = FIELD.left; x < FIELD.right; x += 12) rect(ctx, x, MIN_Y + 4, 6, 1, '#ffffff');
    ctx.globalAlpha = 1;
  }

  private drawGoal(ctx: CanvasRenderingContext2D): void {
    const l = GOAL.left, r = GOAL.right, top = GOAL.line - 24;
    rect(ctx, l, top, r - l, 24, '#0d0818');
    ctx.globalAlpha = 0.35;
    for (let x = l; x <= r; x += 8) rect(ctx, x, top, 1, 24, '#fff');
    for (let y = top; y <= GOAL.line; y += 6) rect(ctx, l, y, r - l, 1, '#fff');
    ctx.globalAlpha = 1;
    rect(ctx, l - 3, top - 2, 3, 28, '#fff');
    rect(ctx, r, top - 2, 3, 28, '#fff');
    rect(ctx, l - 3, top - 3, r - l + 6, 3, '#fff');
    if (this.ball.state === 'net') this.drawBall(ctx);
  }

  private drawPickup(ctx: CanvasRenderingContext2D, p: Pickup): void {
    const bob = Math.sin(this.time * 5 + p.x) * 1.5;
    if (p.kind === 'bit') {
      glow(ctx, p.x, p.y + bob, 9, '255,207,63', 0.4);
      rect(ctx, p.x - 3, p.y - 3 + bob, 6, 6, '#ffcf3f');
      rect(ctx, p.x - 2, p.y - 2 + bob, 2, 2, '#fff7a8');
    } else {
      glow(ctx, p.x, p.y + bob, 12, '255,63,107', 0.5);
      hearts(ctx, p.x - 5, p.y - 5 + bob, 1, 1);
    }
  }

  /** A dotted guide from the ball to where a kick from here would end up. */
  private drawAim(ctx: CanvasRenderingContext2D): void {
    if (this.ball.state !== 'carried' || this.phase !== 'play') return;
    const tx = this.aimTarget();
    const fx = this.ball.x, fy = this.ball.y;
    ctx.globalAlpha = 0.5;
    for (let i = 1; i <= 8; i++) {
      const f = i / 9 + ((this.time * 1.4) % (1 / 9));
      rect(ctx, fx + (tx - fx) * f - 1, fy + (GOAL.line - fy) * f - 1, 2, 2, '#fff');
    }
    ctx.globalAlpha = 1;
    rect(ctx, tx - 2, GOAL.line - 2, 5, 5, '#ffcf3f');
    rect(ctx, tx - 1, GOAL.line - 1, 3, 3, '#fff');
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    rect(ctx, this.px - 6, this.py - 1, 12, 3, 'rgba(0,0,0,0.35)');
    if (this.iframes > 0 && Math.floor(this.time * 10) % 2 === 0 && this.phase === 'play') return;
    drawCass(ctx, { x: this.px, y: this.py, facing: this.face, pose: this.moving ? 'run' : 'idle', t: this.time * (this.game.input.held('attack') && this.moving ? 1.6 : 1), scale: 1 }, this.game.profile.character);
  }

  private drawBall(ctx: CanvasRenderingContext2D): void {
    const b = this.ball;
    const lift = b.state === 'flying' ? 5 : 0;
    rect(ctx, b.x - 3, b.y + 1, 6, 2, 'rgba(0,0,0,0.4)');
    rect(ctx, b.x - 3, b.y - 4 - lift, 6, 6, '#fff');
    rect(ctx, b.x - 4, b.y - 3 - lift, 8, 4, '#fff');
    rect(ctx, b.x - 1, b.y - 2 - lift, 3, 3, '#222');
    if (b.state === 'flying') {
      ctx.globalAlpha = 0.3;
      rect(ctx, b.x - 2, b.y - 1 - lift - (b.vy / SHOT_SPEED) * -10, 4, 10, '#fff');
      ctx.globalAlpha = 1;
    }
  }

  private drawBullet(ctx: CanvasRenderingContext2D, b: Bullet): void {
    const c = HUES[b.hue];
    glow(ctx, b.x, b.y, 7, b.hue === 0 ? '255,159,63' : b.hue === 1 ? '255,63,210' : '63,224,255', 0.5);
    rect(ctx, b.x - 2, b.y - 2, 5, 5, c);
    rect(ctx, b.x - 1, b.y - 1, 3, 3, '#ffffff');
  }

  private drawKeeper(ctx: CanvasRenderingContext2D): void {
    const k = this.keeper;
    const wide = this.keeperWidth / BASE_KEEPER_W;
    const x = Math.round(k.x), y = KEEPER_Y;
    const w = Math.round(22 * wide);
    const dir = k.state === 'dive' && k.reactT <= 0 ? Math.sign(k.target - k.x) : 0;
    const wob = Math.sin(this.time * 7) > 0.6 ? 1 : 0;
    rect(ctx, x - w / 2 - 2, y + 8, w + 4, 3, 'rgba(0,0,0,0.4)');
    // legs and body
    rect(ctx, x - w / 2 + 2, y + 2, 5, 7, '#222');
    rect(ctx, x + w / 2 - 7, y + 2, 5, 7, '#222');
    rect(ctx, x - w / 2, y - 12, w, 15, '#ff9f3f');
    for (let i = 0; i < w; i += 6) rect(ctx, x - w / 2 + i, y - 12, 3, 15, '#c8601a');
    rect(ctx, x - w / 2, y - 12, w, 2, '#ffd08a');
    // head: a monitor with a visor
    rect(ctx, x - 7, y - 24 + wob, 14, 12, '#2a2438');
    rect(ctx, x - 6, y - 23 + wob, 12, 10, '#0d0818');
    const eye = k.mood > 0 ? '#9a9ab8' : this.phase === 'goal' ? '#3fe0ff' : '#ff3f5a';
    rect(ctx, x - 5, y - 20 + wob, 4, 3, eye);
    rect(ctx, x + 1, y - 20 + wob, 4, 3, eye);
    rect(ctx, x - 3, y - 15 + wob, 6, 1, k.mood > 0 ? '#9a9ab8' : '#3fe0ff');
    rect(ctx, x - 1, y - 28, 2, 4, '#ffcf3f');
    // gloves: up and wide on a dive, otherwise at the sides
    const gy = dir ? y - 14 : y - 6;
    const spread = dir ? 6 : 0;
    rect(ctx, x - w / 2 - 7 - spread + (dir > 0 ? 0 : -3), gy, 8, 8, '#7dff6b');
    rect(ctx, x + w / 2 - 1 + spread + (dir < 0 ? 0 : 3), gy, 8, 8, '#7dff6b');
    rect(ctx, x - w / 2 - 6 - spread + (dir > 0 ? 0 : -3), gy + 1, 6, 2, '#c8ffc0');
    rect(ctx, x + w / 2 + (dir < 0 ? 0 : 3) + spread, gy + 1, 6, 2, '#c8ffc0');
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    rect(ctx, 0, 0, W, 12, 'rgba(0,0,0,0.6)');
    hearts(ctx, 4, 2, this.hp, this.stats.maxHp);
    const x0 = 150;
    drawText(ctx, `GOALS ${this.goals}/${this.goalsNeeded}`, x0, 2, this.overtime ? '#ff6f3f' : '#7dff6b');
    drawText(ctx, `SAVED ${this.saves}`, x0 + 74, 2, '#9a9ab8');
    drawText(ctx, `BITS ${this.runBits}`, x0 + 132, 2, '#ffcf3f');
    if (this.endlessRound) drawText(ctx, `R${this.endlessRound}`, x0 + 194, 2, '#ff6f3f');
    // Sprint bar, tucked under the player's scoreboard.
    drawText(ctx, 'SPRINT', 4, H - 12, '#9a9ab8');
    bar(ctx, 38, H - 11, 50, 4, this.stamina / STAMINA_MAX, this.staminaLock > 0 ? '#ff3f5a' : '#3fe0ff', '#102030', '#ffffff55');
    this.drawChaosHud(ctx, W - 106, 14);
    if (this.banner) {
      const a = this.banner.t < 0.15 ? this.banner.t / 0.15 : this.banner.t > 1.3 ? 1 - (this.banner.t - 1.3) / 0.3 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      drawText(ctx, this.banner.text, W / 2, 118, this.banner.color, { align: 'center', scale: 3 });
      ctx.globalAlpha = 1;
    }
    if (this.phase === 'intro') drawText(ctx, 'SCORE SIX GOALS. DODGE THE KEEPER\'S BULLETS.', W / 2, 150, '#fff', { align: 'center' });
    this.drawHint(ctx, 'ARROWS RUN • Z KICK (RUN LEFT OR RIGHT TO AIM) • HOLD X SPRINT');
    this.drawSeed(ctx);
  }
}
