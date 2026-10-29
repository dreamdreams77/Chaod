/**
 * RING RIOT — a wrestling tournament in three matches. Strike (a three-hit combo), grapple (time the
 * lock-up for a slam or a suplex), block, build hype for a finisher, then PIN the champ: wear him
 * down below 45% and hold him for the three count while he kicks out.
 *
 * Controls: arrows move, X strike, Z grapple (or pin), DOWN block, C finisher (full hype), ENTER taunt.
 * Chaos flags honoured: slippery (the canvas is slick), adrenaline (everyone is 30% faster).
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import type { DirectorContext } from '../chaos/director.ts';
import type { Rng } from '../core/rng.ts';
import { H, W, backdrop, bar, clamp, glow, hearts, rect } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';

export const RING_L = 70;
export const RING_R = 410;
const MAT_Y = 216;
const REACH = 36;

export type FState = 'idle' | 'walk' | 'strike' | 'block' | 'hurt' | 'grabwind' | 'recover' | 'lock' | 'locked' | 'thrown' | 'down' | 'getup' | 'taunt' | 'pin' | 'pinned' | 'rush';
type Phase = 'intro' | 'fight' | 'pinfall' | 'between' | 'won' | 'lost';

export interface Foe {
  name: string;
  title: string;
  hp: number;
  speed: number;
  /** Chance per decision to throw a combo when in range. */
  aggr: number;
  block: number;
  grab: number;
  /** Damage multiplier. */
  pow: number;
  /** How hard he is to hold down (0..1). */
  kick: number;
  /** Chance a grapple he starts is timed well. */
  skill: number;
  trunks: string;
  skin: string;
  mask?: string;
}

export const FOES: Foe[] = [
  { name: 'TURNBUCKLE TOM', title: 'THE LOCAL FAVOURITE', hp: 95, speed: 66, aggr: 0.5, block: 0.3, grab: 0.16, pow: 0.85, kick: 0.5, skill: 0.2, trunks: '#3fa9ff', skin: '#e0a070' },
  { name: 'MASKED MAMBO', title: 'THE HIGH FLYER', hp: 120, speed: 88, aggr: 0.6, block: 0.4, grab: 0.22, pow: 0.95, kick: 0.65, skill: 0.35, trunks: '#7dff6b', skin: '#c88a5a', mask: '#ffcf3f' },
  { name: 'BIG BYTE', title: 'THE REIGNING CHAMP', hp: 160, speed: 74, aggr: 0.68, block: 0.5, grab: 0.3, pow: 1.15, kick: 0.8, skill: 0.5, trunks: '#ff3f3f', skin: '#a8704a' },
];

export interface Fighter {
  x: number;
  face: 1 | -1;
  life: number;
  max: number;
  state: FState;
  t: number;
  stage: number;
  queued: boolean;
  hitDone: boolean;
  hype: number;
  downT: number;
  stun: number;
  /** Slide velocity (the slippery canvas, knockback). */
  vx: number;
  thinkT: number;
  blockT: number;
  flash: number;
  /** AI only: closing in or backing off. */
  mode: 'approach' | 'retreat';
  modeT: number;
}

interface Lock {
  atk: Fighter;
  vic: Fighter;
  t: number;
  escape: number;
  /** When the attacker's AI presses (0..1 along the bar); null for a human attacker. */
  aiAt: number | null;
}
interface Pin {
  atk: Fighter;
  vic: Fighter;
  t: number;
  count: number;
  pressure: number;
  /** How hard the pinner is mashing (0..1), which weakens kick-outs. */
  hold: number;
  mash: number[];
  pinnable: boolean;
}

const mk = (x: number, face: 1 | -1, max: number): Fighter => ({
  x, face, life: max, max, state: 'idle', t: 0, stage: 0, queued: false, hitDone: false, hype: 0, downT: 0, stun: 0, vx: 0, thinkT: 0.5, blockT: 0, flash: 0, mode: 'approach', modeT: 0,
});

export class WrestleMode extends ModeBase {
  gesture = 'side' as const;
  gestureHint = 'DRAG: MOVE / UP: GRAPPLE / DOWN: BLOCK • TAP: STRIKE • 2ND FINGER: FINISHER';
  id = 'wrestle';
  crt = 0.4;
  hp: number;
  p: Fighter;
  e: Fighter;
  foeIndex = 0;
  phase: Phase = 'intro';
  phaseT = 2.4;
  lock: Lock | null = null;
  pin: Pin | null = null;
  score = 0;
  private matchScores = 0;
  /** The foes' decisions come from the run's seed, so a shared seed is the same fight for everyone. */
  private readonly ai: Rng;
  private banner: { text: string; color: string; t: number } | null = null;
  private shakeT = 0;
  private mashes: number[] = [];
  endT = 0;
  /** Falls (pinfalls against the player) this run. */
  falls = 0;
  /** Who the last pinfall counted against. */
  private pinned: 'foe' | 'player' = 'foe';

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'wrestle', opts);
    this.ai = this.rng.fork(0x77e5);
    this.hp = this.stats.maxHp;
    this.applyCarry();
    this.p = mk(150, 1, 100);
    this.e = mk(330, -1, 1);
    this.startMatch(0);
  }

  enter(): void {
    this.game.music('wrestle');
    if (!this.game.profile.lore.includes('wrestle_intro')) {
      this.game.profile.lore.push('wrestle_intro');
      this.game.say([
        { who: 'manual', name: 'THE MANUAL', text: 'A cartridge ring, a roaring crowd, three opponents. X strikes (hit it three times for a combo), Z grapples: press X again while the marker is in the green to slam or suplex.' },
        { who: 'manual', name: 'THE MANUAL', text: 'Wear a wrestler below 45% and he can be PINNED: when he is down, stand over him and press Z, then keep mashing Z to hold him for the three count. Hold DOWN to block. C is your finisher once HYPE is full.' },
      ]);
    }
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: this.phase === 'fight', bossActive: false };
  }
  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  // ---- numbers ----------------------------------------------------------------------
  get foe(): Foe {
    return FOES[this.foeIndex];
  }
  private get speedScale(): number {
    return this.director.flag('adrenaline') ? 1.3 : 1;
  }
  private get aiScale(): number {
    return clamp(Math.pow(this.diffMult, 0.5), 0.7, 1.4);
  }

  private startMatch(i: number): void {
    this.foeIndex = i;
    const f = FOES[i];
    const hpScale = clamp(Math.pow(this.diffMult, 0.4), 0.8, 1.25);
    this.e = mk(RING_R - 70, -1, Math.round(f.hp * hpScale));
    this.p.x = RING_L + 80;
    this.p.face = 1;
    this.p.state = 'idle';
    this.p.downT = 0;
    this.p.vx = 0;
    this.p.life = Math.min(this.p.max, this.p.life + (i === 0 ? 0 : 35));
    this.lock = null;
    this.pin = null;
    this.phase = 'intro';
    this.phaseT = 2.4;
  }

  // ---- simulation -------------------------------------------------------------------
  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    this.tickShared(dt);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 1.6) this.banner = null;
    }
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.p.flash = Math.max(0, this.p.flash - dt);
    this.e.flash = Math.max(0, this.e.flash - dt);
    this.mashes = this.mashes.filter((t) => this.time - t < 1);

    if (this.phase === 'won' || this.phase === 'lost') {
      this.endT += dt;
      if (this.phase === 'won' && this.endT > 2.6) this.finish(true, this.finalScore());
      else if (this.phase === 'lost' && this.endT > 2) this.finish(false, this.score + this.matchScores);
      return;
    }
    if (this.phase === 'intro') {
      if (this.game.inDialog) return;
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'fight';
        this.say('FIGHT!', '#ffcf3f');
      }
      return;
    }
    if (this.phase === 'between') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.startMatch(this.foeIndex + 1);
      return;
    }
    if (this.phase === 'pinfall') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.afterPinfall();
      return;
    }

    // a wrestler with nothing left goes down and stays down long enough to be pinned
    for (const f of [this.p, this.e]) {
      if (f.life <= 0 && !['down', 'thrown', 'pinned', 'pin', 'getup', 'rush'].includes(f.state)) this.knockDown(f, 3.5, -f.face);
    }
    this.playerInput(dt);
    this.aiThink(dt);
    this.stepFighter(this.p, this.e, dt, true);
    this.stepFighter(this.e, this.p, dt, false);
    this.updateLock(dt);
    this.updatePin(dt);
    // everyone faces the other unless they are down or being thrown
    for (const [a, b] of [[this.p, this.e], [this.e, this.p]] as Array<[Fighter, Fighter]>) {
      if (['idle', 'walk', 'block', 'taunt', 'recover', 'grabwind'].includes(a.state)) a.face = b.x >= a.x ? 1 : -1;
    }
    this.p.x = clamp(this.p.x, RING_L, RING_R);
    this.e.x = clamp(this.e.x, RING_L, RING_R);
    // keep the two from standing inside each other
    if (!this.lock && !this.pin && Math.abs(this.p.x - this.e.x) < 14 && this.canBump(this.p) && this.canBump(this.e)) {
      const push = (14 - Math.abs(this.p.x - this.e.x)) / 2;
      const dir = this.p.x <= this.e.x ? -1 : 1;
      this.p.x += dir * push;
      this.e.x -= dir * push;
    }
    // the ring's edge
    if (this.hp <= 0 && this.phase === 'fight') this.lose();
  }

  private canBump(f: Fighter): boolean {
    return f.state !== 'down' && f.state !== 'thrown' && f.state !== 'pinned' && f.state !== 'pin';
  }

  private say(text: string, color: string): void {
    this.banner = { text, color, t: 0 };
  }

  private finalScore(): number {
    return this.score + this.matchScores + this.hp * 300 + Math.max(0, 4000 - Math.floor(this.time * 12)) + this.runBits * 10;
  }

  // ---- player ------------------------------------------------------------------------
  private canAct(f: Fighter): boolean {
    return f.state === 'idle' || f.state === 'walk';
  }

  private playerInput(dt: number): void {
    const inp = this.game.input;
    const p = this.p;
    const flip = false;
    const ax = (inp.held('right') ? 1 : 0) - (inp.held('left') ? 1 : 0);
    const pressedAny = inp.pressed('attack') || inp.pressed('jump') || inp.pressed('confirm');
    if (pressedAny) this.mashes.push(this.time);

    // kicking out of a pin / breaking a lock: mashing
    if (this.pin && this.pin.vic === p && pressedAny) this.pin.pressure += 0.2;
    if (this.lock && this.lock.vic === p && (inp.pressed('attack') || inp.pressed('jump'))) this.lock.escape += 0.24;
    if (this.pin && this.pin.atk === p && inp.pressed('jump')) this.pin.mash.push(this.time);

    if (this.lock && this.lock.atk === p && this.lock.aiAt === null && inp.pressed('attack')) {
      this.throwFrom(this.lock);
      return;
    }
    if (p.state === 'strike' && inp.pressed('attack') && p.stage < 3) p.queued = true;

    if (this.canAct(p)) {
      const slide = this.director.flag('slippery');
      const sp = 78 * this.speedScale;
      if (slide) p.vx += ax * 520 * dt;
      else p.x += ax * sp * dt;
      p.state = ax !== 0 ? 'walk' : 'idle';
      if (inp.held('down')) p.state = 'block';
      else if (inp.pressed('attack')) this.startStrike(p, 1);
      else if (inp.pressed('jump')) this.tryGrabOrPin(p, this.e);
      else if (inp.pressed('special') && p.hype >= 100) this.startRush(p);
      else if (inp.pressed('confirm')) this.startTaunt(p);
    } else if (p.state === 'block' && !inp.held('down')) p.state = 'idle';
    else if (p.state === 'block' && inp.held('down')) {
      // blocking still lets you shuffle slowly
      p.x += ax * 30 * dt;
    }
    void flip;
  }

  // ---- AI ----------------------------------------------------------------------------
  private aiThink(dt: number): void {
    const e = this.e;
    const p = this.p;
    const f = this.foe;
    const sc = this.aiScale;
    // mash out of locks and kick out of pins
    if (this.lock && this.lock.vic === e && this.ai.next() < dt * (2 + 4 * f.skill)) this.lock.escape += 0.24;
    if (e.state === 'block') {
      e.blockT -= dt;
      if (e.blockT <= 0) e.state = 'idle';
      return;
    }
    if (!this.canAct(e)) {
      // coming out of a hit he looks for an answer straight away
      e.thinkT = Math.min(e.thinkT, 0.05);
      return;
    }
    const dx = p.x - e.x;
    const dist = Math.abs(dx);
    const dir = Math.sign(dx) || 1;
    const sp = f.speed * this.speedScale * (this.director.flag('slippery') ? 0.9 : 1);
    e.thinkT -= dt;
    if (e.mode === 'retreat') {
      e.modeT -= dt;
      e.x -= dir * sp * 0.7 * dt;
      e.state = 'walk';
      if (e.modeT <= 0) e.mode = 'approach';
      if (e.thinkT > 0) return;
    } else if (e.thinkT > 0) {
      // between decisions: keep closing the distance
      if (dist > REACH - 8 && p.state !== 'down') {
        e.x += dir * sp * dt;
        e.state = 'walk';
      } else e.state = 'idle';
      // a player who starts a move right in front of him may get blocked
      const threat = p.state === 'strike' && p.t < 0.12 || p.state === 'grabwind' || p.state === 'rush';
      if (threat && dist < REACH + 8 && this.ai.next() < dt * 12 * f.block) {
        e.state = 'block';
        e.blockT = 0.45 + this.ai.next() * 0.35;
      }
      return;
    }
    e.thinkT = (0.16 + this.ai.next() * 0.24) / sc;
    // the player is down: pin if he is weak enough, otherwise give him room
    if (p.state === 'down' && dist < 44 && p.downT > 0.3 && p.life <= p.max * 0.45 && this.ai.next() < 0.85) {
      this.tryGrabOrPin(e, p);
      return;
    }
    if (p.state === 'down' || p.state === 'thrown' || p.state === 'pinned') {
      e.x += dir * sp * 0.15;
      return;
    }
    if (e.hype >= 100 && dist < 130 && this.ai.next() < 0.7) {
      this.startRush(e);
      return;
    }
    if (dist > REACH + 2) return;
    const r = this.ai.next();
    if (r < f.aggr * sc) {
      this.startStrike(e, 1);
      e.queued = this.ai.next() < 0.7; // most of his strikes are combos
    } else if (r < (f.aggr + f.grab) * sc) {
      this.tryGrabOrPin(e, p);
    } else if (r < 0.92) {
      e.mode = 'retreat';
      e.modeT = 0.25 + this.ai.next() * 0.3;
    } else this.startTaunt(e);
  }

  // ---- fighter state machine ---------------------------------------------------------
  private stepFighter(f: Fighter, o: Fighter, dt: number, human: boolean): void {
    f.t += dt;
    // slide
    if (Math.abs(f.vx) > 1) {
      f.x += f.vx * dt;
      f.vx *= this.director.flag('slippery') ? Math.pow(0.6, dt * 6) : Math.pow(0.001, dt);
    } else f.vx = 0;
    switch (f.state) {
      case 'strike': {
        const dur = [0.28, 0.28, 0.42][f.stage - 1];
        if (!f.hitDone && f.t >= 0.1) {
          f.hitDone = true;
          this.strikeHits(f, o);
        }
        if (f.t >= dur) {
          if (f.queued && f.stage < 3) this.startStrike(f, f.stage + 1);
          else {
            f.state = 'idle';
            f.stage = 0;
            f.queued = false;
          }
        }
        break;
      }
      case 'hurt':
        if (f.t >= f.stun) f.state = 'idle';
        break;
      case 'grabwind':
        if (f.t >= 0.14) {
          if (this.grabConnects(f, o)) this.beginLock(f, o);
          else {
            f.state = 'recover';
            f.t = 0;
          }
        }
        break;
      case 'recover':
      case 'getup':
        if (f.t >= (f.state === 'getup' ? 0.5 : 0.3)) f.state = 'idle';
        break;
      case 'taunt':
        if (f.t >= 0.9) f.state = 'idle';
        break;
      case 'thrown':
        if (f.t >= 0.45) {
          f.state = 'down';
          f.t = 0;
          this.game.fx.shake(5);
          this.shakeT = 0.25;
          this.game.audio.sfx('explode');
        }
        break;
      case 'down':
        f.downT -= dt;
        if (f.downT <= 0 && !(this.pin && this.pin.vic === f)) {
          f.state = 'getup';
          f.t = 0;
        }
        break;
      case 'rush': {
        const dur = 0.4;
        f.x += f.face * 260 * this.speedScale * dt;
        if (!f.hitDone && Math.abs(o.x - f.x) < 30 && !['down', 'thrown', 'pinned', 'locked'].includes(o.state)) {
          f.hitDone = true;
          const blocked = o.state === 'block';
          const dmg = (human ? 30 : 26 * this.foe.pow * this.aiScale) * (human ? this.damageMult : this.takenMult);
          this.damage(o, dmg * (blocked ? 0.4 : 1), human);
          if (!blocked) this.knockDown(o, 3.4, f.face);
          else this.stagger(o, f.face, 0.4);
          this.say('FINISHER!', '#ff3fa4');
          this.game.audio.sfx('levelup');
          this.game.fx.flash('#ffffff', 0.35);
          this.shakeT = 0.4;
          f.state = 'recover';
          f.t = 0;
        } else if (f.t >= dur) {
          f.state = 'recover';
          f.t = -0.3; // a whiffed finisher leaves you open
        }
        break;
      }
      default:
        break;
    }
    if (f.state === 'idle' || f.state === 'walk') f.stage = 0;
  }

  private startStrike(f: Fighter, stage: number): void {
    f.state = 'strike';
    f.stage = stage;
    f.t = 0;
    f.hitDone = false;
    f.queued = false;
    this.game.audio.sfx(f === this.p ? 'select' : 'step');
  }

  private strikeHits(a: Fighter, v: Fighter): void {
    const human = a === this.p;
    const dx = (v.x - a.x) * a.face;
    if (dx < -6 || dx > REACH) return;
    if (['down', 'thrown', 'pinned', 'pin', 'lock', 'locked', 'getup'].includes(v.state)) return;
    const base = [4, 5, 9][a.stage - 1];
    const raw = human ? base * this.damageMult : base * this.foe.pow * this.takenMult * this.aiScale;
    if (v.state === 'block' && v.face === -a.face) {
      this.damage(v, raw * 0.2, human);
      this.stagger(v, a.face, 0.12, 4);
      this.popups.add(v.x, MAT_Y - 44, 'BLOCKED', '#9a9ab8');
      return;
    }
    this.damage(v, raw, human);
    a.hype = Math.min(100, a.hype + 7);
    this.game.audio.sfx('hurt');
    this.particles.burst(v.x, MAT_Y - 26, ['#fff', '#ffcf3f'], 5, 70);
    if (!human) this.noteDamage(0);
    if (a.stage === 3) {
      this.knockDown(v, 1.6, a.face);
      this.popups.add(v.x, MAT_Y - 54, 'KNOCKDOWN!', '#ffcf3f');
    } else this.stagger(v, a.face, 0.22, 8);
  }

  private stagger(v: Fighter, dir: number, secs: number, push = 6): void {
    v.state = 'hurt';
    v.t = 0;
    v.stun = secs;
    v.vx += dir * push * 12;
    v.stage = 0;
    v.queued = false;
  }

  private knockDown(v: Fighter, secs: number, dir: number): void {
    v.state = 'thrown';
    v.t = 0;
    v.downT = secs;
    v.vx += dir * 140;
    v.stage = 0;
    v.queued = false;
    if (this.lock && (this.lock.vic === v || this.lock.atk === v)) this.lock = null;
  }

  private damage(v: Fighter, amt: number, byPlayer: boolean): void {
    if (amt <= 0) return;
    v.life = Math.max(0, v.life - amt);
    v.flash = 0.15;
    if (byPlayer) this.score += Math.round(amt * 10);
    if (v === this.p) {
      this.damageTaken += amt >= 1 ? 1 : 0;
      this.game.fx.shake(2);
      this.game.fx.flash('#ff2040', 0.1);
      this.director.notifyHurt();
      this.e.hype = Math.min(100, this.e.hype + amt * 0.8);
    }
  }

  // ---- grapples -----------------------------------------------------------------------
  private tryGrabOrPin(a: Fighter, v: Fighter): void {
    if (v.state === 'down' && v.downT > 0.2 && Math.abs(v.x - a.x) < 46) {
      this.beginPin(a, v);
      return;
    }
    a.state = 'grabwind';
    a.t = 0;
  }

  private grabConnects(a: Fighter, v: Fighter): boolean {
    const dx = (v.x - a.x) * a.face;
    if (dx < -4 || dx > REACH + 6) return false;
    // a grab beats a block but not a move already underway
    return ['idle', 'walk', 'block', 'taunt', 'recover', 'hurt'].includes(v.state);
  }

  private beginLock(a: Fighter, v: Fighter): void {
    a.state = 'lock';
    v.state = 'locked';
    a.t = 0;
    v.t = 0;
    a.queued = false;
    const human = a === this.p;
    this.lock = { atk: a, vic: v, t: 0, escape: 0, aiAt: human ? null : this.aiThrowAt() };
    this.game.audio.sfx('select');
  }

  private aiThrowAt(): number {
    const r = this.ai.next();
    if (r < this.foe.skill) return 0.52; // perfect
    if (r < this.foe.skill + 0.5) return 0.35 + this.ai.next() * 0.3; // good
    return this.ai.next() < 0.5 ? 0.12 : 0.9; // weak
  }

  private updateLock(dt: number): void {
    const l = this.lock;
    if (!l) return;
    l.t += dt;
    l.escape = Math.max(0, l.escape - 0.35 * dt);
    if (l.escape >= 1) {
      // broke free: both stumble apart
      this.popups.add(l.vic.x, MAT_Y - 54, 'BROKE FREE!', '#7dff6b');
      l.atk.state = 'recover';
      l.atk.t = 0;
      this.stagger(l.vic, -l.atk.face, 0.25, 4);
      l.atk.x -= l.atk.face * 8;
      this.lock = null;
      return;
    }
    if (l.aiAt !== null && l.t / 1.0 >= l.aiAt) this.throwFrom(l);
    else if (l.t >= 1.0) this.throwFrom(l);
  }

  /** The attacker commits: how close the marker is to the sweet spot decides the move. */
  private throwFrom(l: Lock): void {
    const m = clamp(l.t / 1.0, 0, 1);
    const d = Math.abs(m - 0.52);
    const human = l.atk === this.p;
    let grade: 'perfect' | 'good' | 'weak';
    if (d < 0.07) grade = 'perfect';
    else if (d < 0.25) grade = 'good';
    else grade = 'weak';
    const base = { perfect: 24, good: 14, weak: 5 }[grade];
    const dmg = human ? base * this.damageMult : base * this.foe.pow * this.takenMult * this.aiScale;
    this.damage(l.vic, dmg, human);
    this.knockDown(l.vic, { perfect: 3.6, good: 2.4, weak: 1.0 }[grade], l.atk.face);
    l.atk.state = 'recover';
    l.atk.t = 0;
    l.atk.hype = Math.min(100, l.atk.hype + { perfect: 24, good: 14, weak: 4 }[grade]);
    const text = { perfect: 'SUPLEX!', good: 'SLAM!', weak: 'SHOVE' }[grade];
    this.say(text, grade === 'perfect' ? '#ff3fa4' : '#ffcf3f');
    this.game.audio.sfx(grade === 'weak' ? 'hurt' : 'levelup');
    this.shakeT = grade === 'weak' ? 0.1 : 0.35;
    if (human && grade === 'perfect') this.runFlags.add('suplex');
    this.lock = null;
  }

  private startRush(f: Fighter): void {
    f.state = 'rush';
    f.t = 0;
    f.hitDone = false;
    f.hype = 0;
    this.game.audio.sfx('powerup');
  }

  private startTaunt(f: Fighter): void {
    f.state = 'taunt';
    f.t = 0;
    f.hype = Math.min(100, f.hype + 12);
    this.game.audio.sfx('coin');
  }

  // ---- pins ---------------------------------------------------------------------------
  private beginPin(a: Fighter, v: Fighter): void {
    a.state = 'pin';
    v.state = 'pinned';
    a.t = 0;
    v.t = 0;
    a.x = v.x - a.face * 22;
    const pinnable = v.life <= v.max * 0.45;
    this.pin = { atk: a, vic: v, t: 0, count: 0, pressure: 0, hold: 0, mash: [], pinnable };
    this.game.audio.sfx('select');
  }

  private updatePin(dt: number): void {
    const pn = this.pin;
    if (!pn) return;
    pn.t += dt;
    pn.pressure = Math.max(0, pn.pressure - 0.6 * dt);
    pn.mash = pn.mash.filter((t) => this.time - t < 1);
    pn.hold = Math.min(1, pn.mash.length / 6);
    const humanVictim = pn.vic === this.p;
    const humanAtk = pn.atk === this.p;
    // the AI victim kicks out (or not) at each count; a human victim must fill the pressure meter
    if (humanVictim && pn.pressure >= 1) return this.kickOut(pn);
    const tick = 0.9;
    if (pn.t >= (pn.count + 1) * tick) {
      pn.count++;
      this.game.audio.sfx('step');
      this.popups.add(pn.vic.x, MAT_Y - 60, `${pn.count}`, '#fff');
      if (!pn.pinnable && pn.count >= 2) {
        this.popups.add(pn.vic.x, MAT_Y - 70, 'TOO STRONG!', '#ff6f3f');
        return this.kickOut(pn);
      }
      if (!humanVictim) {
        const f = this.foe;
        const hpFrac = pn.vic.life / pn.vic.max;
        const humanHold = humanAtk ? pn.hold : 0.5;
        const kick = clamp(f.kick * (hpFrac * 1.6 + 0.25) * (1 - 0.65 * humanHold), 0.04, 0.95);
        if (this.ai.next() < kick) return this.kickOut(pn);
      }
      if (pn.count >= 3) this.pinfall(pn);
    }
  }

  private kickOut(pn: Pin): void {
    this.popups.add(pn.vic.x, MAT_Y - 70, 'KICK OUT!', '#7dff6b');
    this.game.audio.sfx('powerup');
    pn.atk.state = 'recover';
    pn.atk.t = 0;
    pn.vic.state = 'getup';
    pn.vic.t = 0;
    pn.vic.downT = 0;
    this.pin = null;
  }

  private pinfall(pn: Pin): void {
    this.pin = null;
    this.phase = 'pinfall';
    this.phaseT = 2.4;
    this.say('1... 2... 3!', '#ffcf3f');
    this.game.audio.sfx('levelup');
    this.game.fx.flash('#ffffff', 0.3);
    this.pinned = pn.vic === this.e ? 'foe' : 'player';
    if (pn.vic === this.e) {
      pn.atk.state = 'taunt';
      pn.atk.t = 0;
      const bonus = 1000 + Math.round(this.p.life * 10) + this.foeIndex * 500;
      this.matchScores += bonus;
      this.addBits(25 + this.foeIndex * 10);
      this.collectFloppy(this.foeIndex);
    } else {
      this.falls++;
      this.hp = Math.max(0, this.hp - this.takenMult);
      this.noteDamage(this.takenMult);
    }
  }

  private afterPinfall(): void {
    if (this.pinned === 'foe') {
      if (this.foeIndex >= FOES.length - 1) {
        this.phase = 'won';
        this.endT = 0;
        this.addBits(40);
        this.say('NEW CHAMPION!', '#ffcf3f');
        this.game.audio.sfx('levelup');
      } else {
        this.phase = 'between';
        this.phaseT = 1.6;
        this.say(`NEXT: ${FOES[this.foeIndex + 1].name}`, '#3fe0ff');
        this.p.state = 'idle';
      }
      return;
    }
    // the player was pinned: out of hearts it is over, otherwise he is back on his feet
    if (this.hp <= 0) return this.lose();
    this.p.life = this.p.max * 0.6;
    this.p.state = 'getup';
    this.p.t = 0;
    this.e.state = 'taunt';
    this.e.t = 0;
    this.phase = 'fight';
  }

  private lose(): void {
    if (this.phase === 'lost') return;
    this.phase = 'lost';
    this.endT = 0;
    this.say('YOU WERE COUNTED OUT', '#ff3f5a');
    this.game.audio.sfx('explode');
  }

  // ---- drawing ------------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const shake = this.shakeT > 0 ? Math.round(Math.sin(this.time * 90) * 2) : 0;
    ctx.save();
    ctx.translate(shake, 0);
    this.drawArena(ctx);
    // the one on the mat is drawn first so the standing one overlaps
    const order = this.p.state === 'down' || this.p.state === 'pinned' ? [this.p, this.e] : [this.e, this.p];
    for (const f of order) this.drawWrestler(ctx, f, f === this.p);
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    ctx.restore();
    this.drawOverlays(ctx);
    this.drawHud(ctx);
  }

  private drawArena(ctx: CanvasRenderingContext2D): void {
    backdrop(ctx, '#0a0418', '#1f0f2e');
    glow(ctx, W / 2, 70, 240, '255,107,138', 0.12 + Math.sin(this.time * 2) * 0.02);
    // the crowd: rows of heads that bob harder as the hype builds
    const hype = Math.max(this.p.hype, this.e.hype) / 100;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 40; i++) {
        const x = i * 12 + (row % 2) * 6;
        const y = 92 + row * 14 - Math.round(Math.abs(Math.sin(this.time * (2 + hype * 4) + i * 1.7 + row)) * (1 + hype * 3));
        const col = ['#3a2a52', '#4a2a42', '#2a3a5a', '#52402a'][(i * 7 + row * 3) % 4];
        rect(ctx, x, y, 8, 9, col);
        rect(ctx, x + 1, y - 5, 6, 5, ['#d9a77a', '#b8825a', '#f0c8a0', '#8a5a3a'][(i * 5 + row) % 4]);
      }
    }
    // ring apron and canvas
    rect(ctx, 0, 150, W, 120, '#14091f');
    rect(ctx, RING_L - 40, MAT_Y, RING_R - RING_L + 80, 8, '#d9d0e8');
    rect(ctx, RING_L - 40, MAT_Y + 8, RING_R - RING_L + 80, 40, '#7a1f4a');
    rect(ctx, RING_L - 40, MAT_Y + 8, RING_R - RING_L + 80, 3, '#ff6b8a');
    // posts and ropes
    for (const px of [RING_L - 34, RING_R + 34]) {
      rect(ctx, px - 3, 138, 6, MAT_Y - 138, '#5a5a6e');
      rect(ctx, px - 4, 138, 8, 4, '#ff3f5a');
    }
    for (let i = 0; i < 3; i++) {
      const y = 150 + i * 20;
      rect(ctx, RING_L - 34, y, RING_R - RING_L + 68, 2, ['#ff3f5a', '#ffffff', '#3fa9ff'][i]);
    }
  }

  private drawOverlays(ctx: CanvasRenderingContext2D): void {
    const l = this.lock;
    if (l) {
      const x = (l.atk.x + l.vic.x) / 2;
      const w = 130;
      const bx = x - w / 2, by = 128;
      rect(ctx, bx - 2, by - 2, w + 4, 12, '#000c');
      rect(ctx, bx, by, w, 8, '#2a1a3a');
      rect(ctx, bx + w * 0.27, by, w * 0.5, 8, '#2f7a3a');
      rect(ctx, bx + w * 0.45, by, w * 0.14, 8, '#7dff6b');
      const m = clamp(l.t / 1.0, 0, 1);
      rect(ctx, bx + w * m - 1, by - 3, 3, 14, '#fff');
      if (l.atk === this.p) drawText(ctx, this.game.input.label('PRESS X IN THE GREEN!'), x, by - 12, '#ffcf3f', { align: 'center' });
      else drawText(ctx, this.game.input.label('MASH X / Z TO BREAK FREE!'), x, by - 12, '#ff6f3f', { align: 'center' });
      if (l.vic === this.p) bar(ctx, bx, by + 12, w, 4, l.escape, '#7dff6b', '#102010', '#ffffff55');
    }
    const pn = this.pin;
    if (pn) {
      const x = pn.vic.x;
      drawText(ctx, `${Math.max(1, pn.count + (pn.count < 3 ? 1 : 0))}`, x, 100, '#fff', { align: 'center', scale: 4 });
      if (pn.vic === this.p) {
        bar(ctx, x - 40, 140, 80, 6, pn.pressure, '#7dff6b', '#102010', '#ffffff66');
        drawText(ctx, this.game.input.label('MASH X / Z TO KICK OUT!'), x, 128, '#ffcf3f', { align: 'center' });
      } else {
        drawText(ctx, pn.pinnable ? this.game.input.label('KEEP MASHING Z!') : 'HE IS TOO FRESH', x, 128, pn.pinnable ? '#ffcf3f' : '#ff6f3f', { align: 'center' });
        bar(ctx, x - 40, 140, 80, 6, pn.hold, '#ffcf3f', '#201a08', '#ffffff66');
      }
    }
    if (this.banner) {
      const a = this.banner.t > 1.2 ? (1.6 - this.banner.t) / 0.4 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      drawText(ctx, this.banner.text, W / 2, 62 + Math.max(0, 0.15 - this.banner.t) * 80, this.banner.color, { align: 'center', scale: 3 });
      ctx.globalAlpha = 1;
    }
    if (this.phase === 'intro') {
      const f = this.foe;
      drawText(ctx, `MATCH ${this.foeIndex + 1} OF ${FOES.length}`, W / 2, 40, '#9a9ab8', { align: 'center' });
      drawText(ctx, f.name, W / 2, 54, '#ff6b8a', { align: 'center', scale: 2 });
      drawText(ctx, f.title, W / 2, 76, '#c9b8ff', { align: 'center' });
    }
    void H;
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    const f = this.foe;
    // life bars
    drawText(ctx, 'CASS', 8, 6, '#3fe0ff');
    bar(ctx, 8, 16, 150, 8, this.p.life / this.p.max, '#3fe0ff', '#08202a', '#ffffff66');
    drawText(ctx, 'HYPE', 8, 28, this.p.hype >= 100 ? '#ff3fa4' : '#9a9ab8');
    bar(ctx, 34, 29, 80, 4, this.p.hype / 100, '#ff3fa4', '#2a0b22', '#ffffff44');
    if (this.p.hype >= 100 && Math.floor(this.time * 4) % 2 === 0) drawText(ctx, this.game.input.label('C: FINISHER!'), 120, 28, '#ff3fa4');
    hearts(ctx, 8, 38, this.hp, this.stats.maxHp);
    drawText(ctx, f.name, 8 + 150 + 60, 6, '#ff6b8a');
    bar(ctx, 218, 16, 150, 8, this.e.life / this.e.max, '#ff6b8a', '#2a0b12', '#ffffff66');
    // the 45% line: below it he can be pinned
    rect(ctx, 218 + 150 * 0.45, 14, 1, 12, '#ffffff');
    drawText(ctx, this.e.life <= this.e.max * 0.45 ? 'PIN HIM!' : 'WEAR HIM DOWN', 218, 28, this.e.life <= this.e.max * 0.45 ? '#ffcf3f' : '#9a9ab8');
    this.drawChaosHud(ctx, W - 106, 6);
    this.drawRunInfo(ctx, W - 106, 62);
    drawText(ctx, `SCORE ${this.score + this.matchScores}`, 8, 52, '#fff');
    this.drawHint(ctx, 'ARROWS MOVE • X STRIKE • Z GRAPPLE / PIN • DOWN BLOCK • C FINISHER');
    this.drawSeed(ctx);
  }

  private drawWrestler(ctx: CanvasRenderingContext2D, f: Fighter, human: boolean): void {
    const foe = this.foe;
    const trunks = human ? '#ff3fa4' : foe.trunks;
    const skin = human ? '#f0c8a0' : foe.skin;
    const x = Math.round(f.x), y = MAT_Y;
    const flash = f.flash > 0; // a solid white hit-flash, never a strobe
    const sk = flash ? '#ffffff' : skin;
    const bob = f.state === 'idle' ? Math.round(Math.sin(this.time * 4 + (human ? 0 : 2))) : 0;
    const lie = f.state === 'down' || f.state === 'pinned' || (f.state === 'thrown' && f.t > 0.2);
    ctx.save();
    if (f.state === 'thrown' && f.t <= 0.2) ctx.translate(0, -Math.round(Math.sin((f.t / 0.2) * Math.PI) * 22));
    rect(ctx, x - 12, y - 1, 24, 3, 'rgba(0,0,0,0.4)');
    if (lie) {
      // lying on the canvas: body along the mat
      rect(ctx, x - 17 * f.face, y - 9, 8, 7, sk); // head
      rect(ctx, x - 9 * f.face - (f.face < 0 ? 18 : 0), y - 9, 18, 7, sk);
      rect(ctx, x + 8 * f.face - (f.face < 0 ? 12 : 0), y - 9, 12, 7, trunks);
      rect(ctx, x + 19 * f.face - (f.face < 0 ? 10 : 0), y - 8, 10, 5, sk);
      if (!human && foe.mask) rect(ctx, x - 17 * f.face, y - 9, 8, 4, foe.mask);
    } else {
      const lean = f.state === 'hurt' ? -2 * f.face : f.state === 'lock' || f.state === 'locked' || f.state === 'pin' ? 3 * f.face : 0;
      const walk = f.state === 'walk' ? Math.floor(this.time * 10) % 2 : 0;
      // legs
      rect(ctx, x - 6, y - 14 + bob, 5, 14 - walk * 2, sk);
      rect(ctx, x + 1, y - 14 + bob, 5, 14 - (1 - walk) * 2, sk);
      rect(ctx, x - 7, y - 3, 6, 3, '#222');
      rect(ctx, x + 1, y - 3, 6, 3, '#222');
      // trunks and torso
      rect(ctx, x - 7, y - 20 + bob, 14, 8, trunks);
      rect(ctx, x - 7 + lean, y - 34 + bob, 14, 14, sk);
      rect(ctx, x - 7 + lean, y - 34 + bob, 14, 3, flash ? '#fff' : 'rgba(255,255,255,0.12)');
      // head
      rect(ctx, x - 4 + lean * 1.5, y - 44 + bob, 9, 10, sk);
      if (human) {
        rect(ctx, x - 5 + lean * 1.5, y - 46 + bob, 11, 4, '#ff3fa4'); // Cass's hair
        rect(ctx, x - 7 * f.face + lean * 1.5, y - 44 + bob, 3, 8, '#ff3fa4');
      } else if (foe.mask) {
        rect(ctx, x - 4 + lean * 1.5, y - 44 + bob, 9, 10, foe.mask);
        rect(ctx, x - 2 + lean * 1.5, y - 41 + bob, 5, 2, '#000');
      } else rect(ctx, x - 4 + lean * 1.5, y - 46 + bob, 9, 3, '#3a2210');
      // eyes
      if (!(human === false && foe.mask)) rect(ctx, x + (f.face > 0 ? 1 : -3) + lean * 1.5, y - 41 + bob, 2, 2, '#000');
      // arms
      const reach = f.state === 'strike' ? (f.t > 0.08 && f.t < 0.24 ? 16 : 5) : 0;
      if (f.state === 'strike') {
        rect(ctx, x + f.face * 6 - (f.face < 0 ? reach : 0), y - 32 + bob - (f.stage === 3 ? 6 : 0), reach + 4, 5, sk);
        if (f.stage === 3) rect(ctx, x + f.face * (6 + reach) - 2, y - 36 + bob, 5, 5, '#fff3');
      } else if (f.state === 'block') {
        rect(ctx, x + f.face * 4 - 3, y - 40 + bob, 6, 14, sk);
        rect(ctx, x + f.face * 2 - 2, y - 41 + bob, 10, 3, trunks);
      } else if (f.state === 'taunt') {
        rect(ctx, x - 12, y - 48 + bob - Math.round(Math.abs(Math.sin(this.time * 14)) * 3), 4, 14, sk);
        rect(ctx, x + 8, y - 48 + bob - Math.round(Math.abs(Math.cos(this.time * 14)) * 3), 4, 14, sk);
      } else if (f.state === 'lock' || f.state === 'locked' || f.state === 'grabwind') {
        rect(ctx, x + f.face * 5 - (f.face < 0 ? 12 : 0), y - 30 + bob, 14, 5, sk);
        rect(ctx, x + f.face * 5 - (f.face < 0 ? 12 : 0), y - 24 + bob, 14, 5, sk);
      } else if (f.state === 'rush') {
        rect(ctx, x + f.face * 6 - (f.face < 0 ? 18 : 0), y - 34, 18, 6, sk);
        rect(ctx, x - f.face * 12 - (f.face < 0 ? 6 : 0), y - 8, 8, 3, '#ffffff66'); // speed lines
      } else if (f.state === 'pin') {
        rect(ctx, x + f.face * 6 - (f.face < 0 ? 16 : 0), y - 22, 16, 5, sk);
      } else {
        rect(ctx, x - 11, y - 33 + bob, 4, 12, sk);
        rect(ctx, x + 7, y - 33 + bob, 4, 12, sk);
      }
    }
    ctx.restore();
    if (!human && this.phase === 'fight') drawText(ctx, foe.name.split(' ')[0], x, y - 62, '#ff6b8a', { align: 'center', shadow: null });
  }
}
