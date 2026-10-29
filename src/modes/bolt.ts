/**
 * BOLT BRIGADE — a run-and-gun in the classic robot-master mould. Pick one of six robot masters on
 * the stage select, run its stage, beat it in its arena and take its weapon. Every master is weak to
 * another master's weapon (ice beats fire, fire beats leaf, leaf beats volt, volt beats tide, tide
 * beats rock, rock beats ice), and once all six are down the FORTRESS opens: all six back to back.
 * Extra lives (1UP) bring you back at the checkpoint or the boss door; energy tanks refill the lot.
 *
 * Mutation honoured: BEAT BUSTER (shooter + rhythm) — shots fired right on the beat hit harder.
 * Chaos flags honoured: low_gravity (floaty jumps), dark (BLACKOUT, you only see near yourself), jam (slow shots).
 * Controls: arrows move, Z jumps (hold for height), X shoots (hold the buster to charge), C swaps weapon, DOWN+C drinks an energy tank.
 * Touch: drag to run, drag up to jump, tap to shoot, hold to charge, a second finger swaps weapon; tap the weapon strip to pick one, tap E to drink a tank.
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import type { DirectorContext } from '../chaos/director.ts';
import {
  AttackId, BoltLevel, EnemyKind, MASTERS, MASTER_BY_ID, MasterDef, MasterId, PickupKind, ROWS, TILE, WEAPONS, WeaponId, generateBolt, solidGrid,
} from '../procgen/bolt.ts';
import { H, W, PAL, backdrop, glow, rect, bar, hearts, clamp, frame } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { drawCass } from '../render/actors.ts';
import type { Rng } from '../core/rng.ts';

type Phase = 'select' | 'run' | 'bossIntro' | 'boss' | 'dying' | 'downed' | 'won' | 'lost';

interface Foe {
  kind: EnemyKind | 'boss';
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  hp: number;
  max: number;
  t: number;
  dir: number;
  frozen: number;
  flash: number;
  home: number;
  active: boolean;
  grounded: boolean;
}

interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  weapon: WeaponId;
  friendly: boolean;
  pierce: boolean;
  life: number;
  grav: number;
  zig: number;
  /** Floor bounces left (the tide bubble). */
  bounce: number;
  hit: Foe[] | null;
}

interface Item {
  x: number;
  y: number;
  kind: PickupKind | 'floppy';
  taken: boolean;
}

interface Zap {
  x: number;
  y: number;
  kind: 'spike' | 'zap' | 'jet';
}

interface Beam {
  x: number;
  t: number;
}

const GRAV = 1000;
const RUN = 105;
const JUMP_V = -335;
/** Grace after walking off a ledge, and how early a jump press is remembered before landing. */
const COYOTE = 0.1;
const JUMP_BUFFER = 0.12;
/** Time you cannot steer after a hit, so the knockback is felt. */
const HIT_STUN = 0.28;
const MAX_LIVES = 9;
const MAX_TANKS = 4;
const PW = 10;
const PH = 20;
const MAX_WE = 28;
const CHARGE_1 = 0.55;
const CHARGE_2 = 1.1;
const BOSS_Y = 13 * TILE;

export class BoltMode extends ModeBase {
  id = 'bolt';
  crt = 0.22;
  hp: number;
  gestureHint = 'DRAG: RUN, UP: JUMP • TAP: SHOOT, HOLD: CHARGE • 2ND FINGER: SWAP WEAPON';
  phase: Phase = 'select';
  master: MasterDef = MASTERS[0];
  level: BoltLevel;
  private grid: boolean[][];
  px = 40;
  py = 13 * TILE;
  vx = 0;
  vy = 0;
  face = 1;
  onGround = false;
  iframes = 0;
  coyote = 0;
  jumpHeld = false;
  charge = 0;
  weapon: WeaponId = 'buster';
  we = MAX_WE;
  shield = 0;
  /** Spare lives (shown as 1UP xN) and energy tanks in the bag. */
  lives = 2;
  tanks = 0;
  private stun = 0;
  private jumpBuf = 0;
  private leafHit = 0;
  private ownedKey = -1;
  private beatenCache: MasterId[] = [];
  private ownedCache: WeaponId[] = ['buster'];
  foes: Foe[] = [];
  shots: Shot[] = [];
  items: Item[] = [];
  hazards: Zap[] = [];
  beams: Beam[] = [];
  boss: Foe | null = null;
  bossIntroT = 0;
  private bossQueue: MasterDef[] = [];
  private bossAtk: AttackId = 'dash';
  private bossState: 'idle' | 'tell' | 'do' = 'idle';
  private bossT = 1;
  private bossN = 0;
  fortress = false;
  private camX = 0;
  private spawnX = 40;
  private spawnY = 13 * TILE;
  private locked = false;
  private selIndex = 0;
  private endT = 0;
  private pitFalls = 0;
  private shootAnim = 0;
  private banner: { text: string; color: string; t: number } | null = null;
  /** Separate streams: boss patterns must not depend on kills (drops) or particles (fx). */
  private readonly bossRng: Rng;
  private readonly dropRng: Rng;
  private readonly fxRng: Rng;
  kills = 0;
  private lastFootstep = 0;

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'bolt', opts);
    this.hp = this.stats.maxHp;
    this.applyCarry();
    const spare = this.opts.nightmare ? 0 : { easy: 3, normal: 2, hard: 1 }[this.game.settings.difficulty] + (this.game.settings.assist ? 1 : 0);
    this.lives = Math.max(0, spare - (this.endlessRound >= 5 ? 1 : 0));
    this.tanks = clamp(Math.floor(this.game.profile.boltTanks || 0), 0, MAX_TANKS);
    this.bossRng = this.rng.fork(0xb055);
    this.dropRng = this.rng.fork(0xd20b);
    this.fxRng = this.rng.fork(0xf1e5);
    // ENDLESS and chained runs skip the stage select: the master comes from the seed.
    const owned = this.beaten();
    this.selIndex = Math.max(0, MASTERS.findIndex((m) => !owned.includes(m.id)));
    this.level = generateBolt(this.seed, MASTERS[this.selIndex].id);
    this.grid = solidGrid(this.level);
    if (this.endlessRound || opts.rush) this.begin(MASTERS[(this.seed + this.endlessRound) % MASTERS.length], false);
  }

  /** Master ids beaten so far (they persist between runs, so their weapons do too). */
  private beaten(): MasterId[] {
    this.refreshOwned();
    return this.beatenCache;
  }
  get ownedWeapons(): WeaponId[] {
    this.refreshOwned();
    return this.ownedCache;
  }
  /** The beaten masters and their weapons only change when a master falls: rebuilt then, not every frame. */
  private refreshOwned(): void {
    const defeated = this.game.profile.bossesDefeated;
    if (this.ownedKey === defeated.length) return;
    this.ownedKey = defeated.length;
    this.beatenCache = MASTERS.map((m) => m.id).filter((id) => defeated.includes(id));
    this.ownedCache = ['buster', ...this.beatenCache.map((id) => MASTER_BY_ID.get(id)!.weapon)];
  }
  get fortressOpen(): boolean {
    return this.beaten().length >= MASTERS.length;
  }

  enter(): void {
    this.game.music(this.phase === 'select' ? 'hub' : 'bolt');
    if (!this.game.profile.lore.includes('bolt_intro')) {
      this.game.profile.lore.push('bolt_intro');
      this.game.say([
        { who: 'manual', name: 'THE MANUAL', text: 'Six robot masters run this brigade. Pick a stage, run to the boss door and beat the master to take its weapon. Grab 1UPs and energy tanks on the way.' },
        { who: 'manual', name: 'THE MANUAL', text: 'Z jumps (hold to go higher), X shoots (hold the buster to charge), C swaps weapons, DOWN plus C drinks an energy tank. Every master is weak to another master\'s weapon. On a phone: drag to run and jump, tap to shoot, tap the weapon strip or the E.' },
      ]);
    }
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: this.phase === 'run' || this.phase === 'boss', bossActive: this.phase === 'boss' };
  }

  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  // ---- stage select and start ----------------------------------------------------------
  /** Starts a stage (or the FORTRESS when `master` is null in fortress mode). */
  begin(master: MasterDef, announce = true): void {
    this.master = master;
    this.level = generateBolt(this.seed, master.id);
    this.grid = solidGrid(this.level);
    this.foes = [];
    this.items = [];
    this.hazards = [];
    this.shots = [];
    this.beams = [];
    this.boss = null;
    this.locked = false;
    this.weapon = 'buster';
    this.we = MAX_WE;
    const l = this.level;
    this.px = 3 * TILE;
    this.py = l.ground[3] * TILE;
    this.spawnX = this.px;
    this.spawnY = this.py;
    this.camX = 0;
    const scale = Math.sqrt(this.diffMult);
    for (const e of l.enemies) {
      const def = { walker: [2, 12, 12], turret: [3, 12, 12], flyer: [1, 12, 10], hopper: [3, 12, 12] }[e.kind];
      const hp = Math.max(1, Math.round(def[0] * scale));
      this.foes.push({ kind: e.kind, x: e.x * TILE + 8, y: (e.y + 1) * TILE, vx: 0, vy: 0, w: def[1], h: def[2], hp, max: hp, t: this.fxRng.range(0, 2), dir: -1, frozen: 0, flash: 0, home: (e.y + 1) * TILE, active: false, grounded: false });
    }
    for (const p of l.pickups) this.items.push({ x: p.x * TILE + 8, y: p.y * TILE + 8, kind: p.kind, taken: false });
    if (l.floppy && master.floppy !== null) this.items.push({ x: l.floppy.x * TILE + 8, y: l.floppy.y * TILE + 8, kind: 'floppy', taken: false });
    for (const h of l.hazards) this.hazards.push({ x: h.x, y: h.y, kind: h.kind });
    this.phase = 'run';
    this.gesture = 'side'; // touch gestures only once a stage is running (the select screen uses taps)
    if (announce) {
      this.game.music('bolt');
      this.say(master.name, master.color);
    }
  }

  /** The FORTRESS: all six masters in a row in one arena. */
  beginFortress(): void {
    this.fortress = true;
    this.begin(MASTERS[0], false);
    this.bossQueue = MASTERS.slice();
    this.px = this.level.arenaX * TILE + 40;
    this.py = 13 * TILE;
    this.spawnX = this.px;
    this.locked = true;
    this.camX = this.level.arenaX * TILE;
    this.foes = [];
    this.items = [];
    this.hazards = [];
    this.weapon = 'buster';
    this.nextFortressBoss();
    this.game.music('bolt_boss');
  }

  private nextFortressBoss(): void {
    const m = this.bossQueue.shift();
    if (!m) {
      this.win();
      return;
    }
    this.master = m;
    this.spawnBoss(m);
  }

  private say(text: string, color: string): void {
    this.banner = { text, color, t: 0 };
  }

  // ---- simulation ------------------------------------------------------------------
  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    if (this.phase === 'select') {
      // Browsing the stage cards costs nothing: no clock, no chaos meter.
      this.updateSelect();
      return;
    }
    this.tickShared(dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.shootAnim = Math.max(0, this.shootAnim - dt);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 1.8) this.banner = null;
    }
    if (this.phase === 'won' || this.phase === 'lost') {
      this.endT += dt;
      if (this.phase === 'won' && this.endT > 2.4) this.finishWin();
      else if (this.phase === 'lost' && this.endT > 1.8) this.finish(false, this.kills * 40 + Math.floor((this.boss ? 1 - this.boss.hp / this.boss.max : 0) * 600));
      return;
    }
    if (this.phase === 'downed') {
      this.endT += dt;
      if (this.endT > 1.4) this.respawn();
      return;
    }
    if (this.phase === 'dying') {
      this.endT += dt;
      if (this.boss && Math.floor(this.endT * 14) !== Math.floor((this.endT - dt) * 14)) this.particles.burst(this.boss.x + (this.fxRng.next() - 0.5) * 26, this.boss.y - 20 + (this.fxRng.next() - 0.5) * 30, [this.master.color, '#fff'], 6, 90);
      this.updateShots(dt);
      if (this.endT > 2) {
        if (this.fortress) {
          this.phase = 'boss';
          this.boss = null;
          this.heal(1);
          this.endT = 0;
          this.nextFortressBoss();
        } else this.win();
      }
      return;
    }
    if (this.phase === 'bossIntro') {
      this.bossIntroT += dt;
      this.updatePlayer(dt, false);
      if (this.boss) this.boss.hp = Math.min(this.boss.max, Math.floor((this.bossIntroT / 1.6) * this.boss.max));
      if (this.bossIntroT > 1.8) {
        if (this.boss) this.boss.hp = this.boss.max;
        this.phase = 'boss';
        this.bossT = 0.6;
      }
      return;
    }
    this.updatePlayer(dt, true);
    this.updateHazards(dt);
    this.updateFoes(dt);
    if (this.boss) this.updateBoss(dt);
    this.updateShots(dt);
    this.updateItems();
    // Only a living run can die (a win that lands on the same frame as the last hit stands).
    if (this.hp <= 0 && ((this.phase as Phase) === 'run' || (this.phase as Phase) === 'boss')) this.lose();
  }

  private updateSelect(): void {
    const inp = this.game.input;
    const n = MASTERS.length + (this.fortressOpen ? 1 : 0);
    // Two columns of masters: left/right change column, up/down change row; the FORTRESS card is below.
    const last = MASTERS.length;
    let i = this.selIndex;
    if (inp.pressed('left')) i = i === last ? i : i % 2 === 1 ? i - 1 : i + 1;
    else if (inp.pressed('right')) i = i === last ? i : i % 2 === 0 ? i + 1 : i - 1;
    else if (inp.pressed('up')) i = i === last ? last - 2 : i >= 2 ? i - 2 : i;
    else if (inp.pressed('down')) i = i < last - 2 ? i + 2 : this.fortressOpen ? last : i;
    if (i !== this.selIndex && i < n) {
      this.selIndex = i;
      this.game.audio.sfx('select');
    }
    if (inp.pressed('confirm') || inp.pressed('jump')) this.pick(this.selIndex);
    else if (inp.pressed('back') || inp.pressed('pause')) this.game.toHub();
  }

  private pick(i: number): void {
    this.game.audio.sfx('confirm');
    if (i === MASTERS.length && this.fortressOpen) this.beginFortress();
    else this.begin(MASTERS[i]);
  }

  tap(x: number, y: number): boolean {
    if (this.phase === 'run' || this.phase === 'boss') {
      // Touch HUD: tap a weapon in the strip to pick it, tap the E to drink a tank.
      if (y >= 34 && y <= 48) {
        const own = this.ownedWeapons;
        const i = Math.floor((x - 6) / 13);
        if (i >= 0 && i < own.length && own[i] !== this.weapon) {
          this.weapon = own[i];
          this.charge = 0;
          this.game.audio.sfx('select');
          return true;
        }
      }
      if (y >= 11 && y <= 25 && x >= W / 2 + 24 && x <= W / 2 + 70) return this.useTank();
      return false;
    }
    if (this.phase !== 'select') return false;
    const cards = this.cardRects();
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        if (this.selIndex === i) this.pick(i);
        else {
          this.selIndex = i;
          this.game.audio.sfx('select');
        }
        return true;
      }
    }
    return true;
  }

  private cardRects(): Array<{ x: number; y: number; w: number; h: number }> {
    const out = MASTERS.map((_, i) => ({ x: 24 + (i % 2) * 220, y: 32 + Math.floor(i / 2) * 62, w: 212, h: 58 }));
    if (this.fortressOpen) out.push({ x: 24, y: 220, w: 432, h: 24 });
    return out;
  }

  // ---- tiles -----------------------------------------------------------------------
  private solid(tx: number, ty: number): boolean {
    if (tx < 0 || tx >= this.level.width) return true;
    if (ty < 0 || ty >= ROWS) return false;
    return this.grid[ty][tx];
  }

  private boxHitsSolid(cx: number, feet: number, w: number, h: number): boolean {
    const x0 = Math.floor((cx - w / 2) / TILE);
    const x1 = Math.floor((cx + w / 2 - 0.01) / TILE);
    const y0 = Math.floor((feet - h) / TILE);
    const y1 = Math.floor((feet - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.solid(tx, ty)) return true;
    return false;
  }

  /** Moves a box with simple tile collision; returns which sides it hit. */
  private moveBox(o: { x: number; y: number; vx: number; vy: number }, w: number, h: number, dt: number): { floor: boolean; wall: boolean; ceil: boolean } {
    const hit = { floor: false, wall: false, ceil: false };
    o.x += o.vx * dt;
    if (this.boxHitsSolid(o.x, o.y, w, h)) {
      o.x -= o.vx * dt;
      // step in 1px increments toward the wall so the box rests against it
      const dir = Math.sign(o.vx) || 1;
      for (let i = 0; i < 4 && !this.boxHitsSolid(o.x + dir, o.y, w, h); i++) o.x += dir;
      o.vx = 0;
      hit.wall = true;
    }
    o.y += o.vy * dt;
    if (this.boxHitsSolid(o.x, o.y, w, h)) {
      if (o.vy > 0) {
        o.y = Math.floor(o.y / TILE) * TILE;
        hit.floor = true;
      } else {
        o.y = Math.ceil((o.y - h) / TILE) * TILE + h;
        hit.ceil = true;
      }
      o.vy = 0;
    }
    return hit;
  }

  // ---- player ----------------------------------------------------------------------
  /** Floaty stages (the flood) stretch the air time; the FORTRESS keeps one gravity for all six masters. */
  private get stageGrav(): number {
    return this.fortress ? 1 : this.master.grav;
  }
  private get gravity(): number {
    return GRAV * this.stageGrav * (this.director.flag('low_gravity') ? 0.55 : 1);
  }

  private updatePlayer(dt: number, armed: boolean): void {
    const inp = this.game.input;
    this.stun = Math.max(0, this.stun - dt);
    const stunned = this.stun > 0;
    const ax = armed && !stunned ? inp.axisX() : 0;
    const target = ax * RUN;
    const accel = this.master.slippery && this.phase === 'run' ? 380 : 1900;
    if (stunned) this.vx -= Math.sign(this.vx) * Math.min(Math.abs(this.vx), 160 * dt); // the knockback fades, it is not cancelled
    else this.vx = this.vx < target ? Math.min(target, this.vx + accel * dt) : Math.max(target, this.vx - accel * dt);
    if (ax) this.face = ax > 0 ? 1 : -1;
    this.coyote = this.onGround ? COYOTE : Math.max(0, this.coyote - dt);
    // A jump pressed a hair before landing is remembered, so it never feels eaten.
    if (armed && !stunned && (inp.pressed('jump') || inp.pressed('confirm') || (inp.pressed('up') && this.game.input.usingTouch))) this.jumpBuf = JUMP_BUFFER;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    if (armed && !stunned && this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = JUMP_V * Math.sqrt(this.stageGrav) * (this.director.flag('low_gravity') ? 0.78 : 1);
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuf = 0;
      this.jumpHeld = true;
      this.game.audio.sfx('jump');
    }
    if (this.jumpHeld && !(inp.held('jump') || inp.held('confirm') || inp.held('up')) && this.vy < -130) this.vy = -130;
    if (this.vy >= 0) this.jumpHeld = false;
    this.vy = Math.min(480, this.vy + this.gravity * dt);
    const body = { x: this.px, y: this.py, vx: this.vx, vy: this.vy };
    const wantVx = this.vx;
    const wantY = this.py + this.vy * dt;
    const hit = this.moveBox(body, PW, PH, dt);
    if (hit.wall && !hit.floor && this.vy <= 40 && wantVx !== 0) {
      // Clipped the corner of a ledge by a few pixels: hop up onto it instead of snagging.
      const dir = Math.sign(wantVx);
      for (let k = 1; k <= 5; k++) if (!this.boxHitsSolid(body.x + dir * 2, body.y - k, PW, PH)) {
        body.x += dir * 2;
        body.y -= k;
        body.vx = wantVx;
        hit.wall = false;
        break;
      }
    }
    if (hit.ceil && this.vy < 0) {
      // Bumped the underside of a block with the edge of the head: slide round the corner.
      for (let n = 1; n <= 4; n++) {
        const free = [n, -n].find((d) => !this.boxHitsSolid(body.x + d, wantY, PW, PH));
        if (free !== undefined) {
          body.x += free;
          body.y = wantY;
          body.vy = this.vy;
          break;
        }
      }
    }
    this.px = body.x;
    this.py = body.y;
    this.vy = body.vy;
    this.vx = body.vx;
    if (hit.wall) this.vx = 0;
    const wasAir = !this.onGround;
    this.onGround = hit.floor || (this.vy === 0 && this.boxHitsSolid(this.px, this.py + 1, PW, PH));
    if (this.onGround && wasAir) this.game.audio.sfx('land');
    // stage and arena bounds
    if (this.locked) this.px = clamp(this.px, this.level.arenaX * TILE + 10, this.level.width * TILE - 10);
    else this.px = clamp(this.px, 8, this.level.width * TILE - 8);
    // camera
    if (this.locked) this.camX += (this.level.arenaX * TILE - this.camX) * Math.min(1, dt * 6);
    else {
      // Ease towards the player with a little look-ahead, so the picture glides instead of jittering.
      const want = clamp(this.px - 190 + this.face * 22, 0, (this.level.width - 30) * TILE);
      this.camX += (want - this.camX) * Math.min(1, dt * 7);
    }
    // the run: checkpoint, the door and pits
    if (this.phase === 'run') {
      if (this.px > this.level.checkpoint * TILE && this.spawnX < this.level.checkpoint * TILE) {
        this.spawnX = this.level.checkpoint * TILE;
        this.spawnY = this.level.ground[this.level.checkpoint] * TILE;
        this.popups.add(this.px, this.py - 30, 'CHECKPOINT', '#7dff6b');
        this.game.audio.sfx('powerup');
      }
      if (this.px > (this.level.arenaX - 1) * TILE && !this.locked) this.startBoss();
      if (this.py > (ROWS + 2) * TILE) this.fallInPit();
    }
    if (!armed) return;
    // weapons
    if (inp.pressed('special')) {
      // DOWN + C drinks a tank when one would do some good; otherwise C just swaps weapons.
      if (inp.held('down') && this.tanks > 0 && this.hp < this.stats.maxHp) this.useTank();
      else this.swapWeapon();
    }
    this.updateShooting(dt);
    if (this.shield > 0) {
      this.shield -= dt;
      this.leafHit = Math.max(0, this.leafHit - dt);
    }
    // standing in a hazard tile or touching a foe
    if (this.iframes <= 0) {
      for (const h of this.hazards) if (this.hazardActive(h) && this.overlapsHazard(h)) {
        this.hurt(1, h.x * TILE + 8);
        break;
      }
    }
  }

  private fallInPit(): void {
    this.pitFalls++;
    this.director.clearAll();
    this.hurt(1, this.px, true);
    this.px = this.spawnX;
    this.py = this.spawnY;
    this.vx = this.vy = 0;
    this.iframes = 1.6;
    this.camX = clamp(this.px - 190, 0, (this.level.width - 30) * TILE);
  }

  swapWeapon(): void {
    const own = this.ownedWeapons;
    if (own.length < 2) return;
    this.weapon = own[(own.indexOf(this.weapon) + 1) % own.length];
    this.charge = 0;
    this.game.audio.sfx('select');
    this.popups.add(this.px, this.py - 34, WEAPONS[this.weapon].name, WEAPONS[this.weapon].color);
  }

  private updateShooting(dt: number): void {
    const inp = this.game.input;
    const w = this.weapon;
    if (w === 'buster') {
      if (inp.held('attack')) this.charge += dt;
      // A tap is a quick shot; releasing after a hold fires the charged shot.
      if (inp.pressed('attack') && this.shotsOut() < 3) this.fireBuster(0);
      if (inp.released('attack')) {
        if (this.charge >= CHARGE_1) this.fireBuster(this.charge >= CHARGE_2 ? 2 : 1);
        this.charge = 0;
      }
      if (!inp.held('attack')) this.charge = 0;
    } else if (inp.pressed('attack')) this.fireSpecial(w);
  }

  private shotsOut(): number {
    let n = 0;
    for (const s of this.shots) if (s.friendly && s.weapon === 'buster' && s.dmg <= 1.5) n++;
    return n;
  }

  /** Right on the beat: BEAT BUSTER shots hit a little harder. */
  private beatBonus(): number {
    if (!this.fusion.has('beat_shots')) return 0;
    const bpm = this.game.audio.bpm || 120;
    const beat = (this.game.audio.musicTime() * bpm) / 60;
    const off = (Math.abs(beat - Math.round(beat)) * 60) / bpm;
    if (off > this.fusion.param('beat_buster', 'window', 0.09)) return 0;
    this.particles.burst(this.px + this.face * 10, this.py - 12, ['#ffe23f', '#fff'], 4, 60);
    return this.fusion.param('beat_buster', 'bonus', 1);
  }

  private fireBuster(level: 0 | 1 | 2): void {
    const jam = this.director.flag('jam') ? 0.5 : 1;
    const dmg = [1, 2, 4][level] + this.beatBonus();
    const r = [3, 5, 8][level];
    this.shots.push({ x: this.px + this.face * 9, y: this.py - 12, vx: this.face * 260 * jam, vy: 0, r, dmg: dmg * this.stats.power * this.damageMult, weapon: 'buster', friendly: true, pierce: level === 2, life: 1.2, grav: 0, zig: 0, bounce: 0, hit: level === 2 ? [] : null });
    this.shootAnim = 0.2;
    this.game.audio.sfx(level ? 'boost' : 'shoot', level ? 1.4 : 1);
  }

  private fireSpecial(w: WeaponId): void {
    const def = WEAPONS[w];
    if (this.we < def.cost) {
      this.game.audio.sfx('miss');
      this.popups.add(this.px, this.py - 30, 'NO ENERGY', '#ff3f6b');
      return;
    }
    this.we -= def.cost;
    this.shootAnim = 0.25;
    const f = this.face;
    const jam = this.director.flag('jam') ? 0.5 : 1;
    const base = { x: this.px + f * 9, y: this.py - 12, friendly: true, weapon: w, life: 1.2, grav: 0, zig: 0, bounce: 0, hit: null as Foe[] | null, pierce: false };
    const pow = this.stats.power * this.damageMult;
    if (w === 'ice') {
      for (const a of [-0.16, 0, 0.16]) this.shots.push({ ...base, vx: f * 210 * jam, vy: a * 210, r: 3, dmg: 2 * pow });
      this.game.audio.sfx('shoot', 1.6);
    } else if (w === 'flame') {
      this.shots.push({ ...base, vx: f * 190 * jam, vy: 0, r: 7, dmg: 2 * pow, life: 0.4, pierce: true, hit: [] });
      this.game.audio.sfx('explode', 2);
    } else if (w === 'volt') {
      this.shots.push({ ...base, vx: f * 330 * jam, vy: 0, r: 4, dmg: 3 * pow, zig: 1, life: 0.9 });
      this.game.audio.sfx('chaos', 1.5);
    } else if (w === 'tide') {
      this.shots.push({ ...base, vx: f * 150 * jam, vy: -70, r: 4, dmg: 2 * pow, grav: 520, bounce: 4, life: 2 });
      this.game.audio.sfx('jump', 1.8);
    } else if (w === 'rock') {
      this.shots.push({ ...base, vx: f * 125 * jam, vy: -190, r: 6, dmg: 3 * pow, grav: 640, life: 1.8 });
      this.game.audio.sfx('slam', 1.3);
    } else if (w === 'leaf') {
      this.shield = 4.5;
      this.game.audio.sfx('powerup');
    }
  }

  // ---- hazards and foes -------------------------------------------------------------
  private hazardActive(h: Zap): boolean {
    const t = this.time;
    if (h.kind === 'zap') return Math.floor(t / 1.2 + h.x * 0.37) % 2 === 0;
    if (h.kind === 'jet') return (t + h.x * 0.53) % 2.4 > 1.5;
    return true;
  }

  private overlapsHazard(h: Zap): boolean {
    const hx = h.x * TILE, hy = h.y * TILE;
    const height = h.kind === 'jet' ? TILE * 3 : TILE;
    const top = hy + TILE - height;
    return this.px + PW / 2 > hx + 2 && this.px - PW / 2 < hx + TILE - 2 && this.py > top + 2 && this.py - PH < hy + TILE;
  }

  private updateHazards(_dt: number): void {}

  private wakeRange(): number {
    return 340;
  }

  private updateFoes(dt: number): void {
    const scale = Math.sqrt(this.diffMult);
    for (const f of this.foes) {
      if (f.hp <= 0) continue;
      f.flash = Math.max(0, f.flash - dt);
      if (!f.active && Math.abs(f.x - this.px) < this.wakeRange()) f.active = true;
      if (!f.active) continue;
      if (f.frozen > 0) {
        f.frozen -= dt;
        continue;
      }
      f.t += dt;
      const body = { x: f.x, y: f.y, vx: f.vx, vy: f.vy };
      if (f.kind === 'walker') {
        f.vx = f.dir * 28 * scale;
        f.vy = Math.min(300, f.vy + GRAV * this.stageGrav * dt);
        const ahead = f.x + f.dir * (f.w / 2 + 2);
        const below = Math.floor((f.y + 2) / TILE);
        if (this.solid(Math.floor(ahead / TILE), Math.floor((f.y - 4) / TILE)) || (f.grounded && !this.solid(Math.floor(ahead / TILE), below))) f.dir *= -1;
      } else if (f.kind === 'hopper') {
        f.vy = Math.min(300, f.vy + GRAV * this.stageGrav * dt);
        if (f.grounded) {
          f.vx = 0;
          if (f.t > 1.5) {
            f.t = 0;
            f.vy = -250 * Math.sqrt(this.stageGrav);
            f.vx = Math.sign(this.px - f.x) * 60 * scale;
          }
        }
      } else if (f.kind === 'turret') {
        f.vy = Math.min(300, f.vy + GRAV * this.stageGrav * dt);
        if (f.t > 2 / scale && Math.abs(f.x - this.px) < 220) {
          f.t = 0;
          const a = Math.atan2(this.py - 10 - (f.y - 6), this.px - f.x);
          this.foeShot(f.x, f.y - 6, Math.cos(a) * 95 * scale, Math.sin(a) * 95 * scale);
          this.game.audio.sfx('shoot', 0.7);
        }
      } else if (f.kind === 'flyer') {
        const tx = this.px, ty = this.py - 24 + Math.sin(f.t * 3) * 10;
        const d = Math.hypot(tx - f.x, ty - f.y) || 1;
        f.vx = ((tx - f.x) / d) * 50 * scale;
        f.vy = ((ty - f.y) / d) * 36 * scale;
        body.x += f.vx * dt;
        body.y += f.vy * dt;
        f.x = body.x;
        f.y = body.y;
      }
      if (f.kind !== 'flyer') {
        body.vx = f.vx;
        body.vy = f.vy;
        const hit = this.moveBox(body, f.w, f.h, dt);
        f.x = body.x;
        f.y = body.y;
        f.vx = body.vx;
        f.vy = body.vy;
        f.grounded = hit.floor;
        if (hit.wall && f.kind === 'walker') f.dir *= -1;
        if (f.y > (ROWS + 2) * TILE) f.hp = 0;
      }
      // contact with the player: the leaf shield bites, anything else bites back
      if (Math.abs(f.x - this.px) < (f.w + PW) / 2 && f.y > this.py - PH && f.y - f.h < this.py) {
        if (this.shield > 0) this.leafTouch(f);
        else if (this.iframes <= 0) this.hurt(1, f.x);
      }
    }
  }

  private leafTouch(f: Foe): void {
    if (this.leafHit > 0) return;
    this.leafHit = f === this.boss ? 0.8 : 0.35; // a master shrugs the leaves off more slowly than a bug
    if (f === this.boss && this.bossInvulnerable()) return;
    this.damageFoe(f, 1 * this.stats.power * this.damageMult, 'leaf');
    this.particles.burst(f.x, f.y - f.h / 2, ['#7dff6b', '#e8ffd8'], 4, 60);
  }

  private foeShot(x: number, y: number, vx: number, vy: number, grav = 0, r = 3): void {
    this.shots.push({ x, y, vx, vy, r, dmg: 1, weapon: 'buster', friendly: false, pierce: false, life: 4, grav, zig: 0, bounce: 0, hit: null });
  }

  private updateShots(dt: number): void {
    let keep = 0;
    for (const s of this.shots) {
      s.life -= dt;
      s.vy += s.grav * dt;
      if (s.zig) {
        s.zig += dt * 22;
        s.y += Math.sin(s.zig) * 90 * dt;
      }
      const oy = s.y;
      let impact = false;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      let alive = s.life > 0 && s.x > this.camX - 40 && s.x < this.camX + W + 40 && s.y < (ROWS + 1) * TILE && s.y > -140;
      if (alive && this.solid(Math.floor(s.x / TILE), Math.floor(s.y / TILE)) && !(s.friendly && s.weapon === 'flame')) {
        if (s.bounce > 0 && !this.solid(Math.floor(s.x / TILE), Math.floor(oy / TILE))) {
          // A tide bubble rebounds off floors and ceilings and only dies on walls.
          s.y = oy;
          s.vy = s.vy > 0 ? -Math.max(Math.abs(s.vy) * 0.8, 150) : Math.abs(s.vy) * 0.5;
          s.bounce--;
        } else {
          alive = false;
          impact = true;
        }
      }
      if (alive) {
        if (s.friendly) alive = this.friendlyShotHits(s);
        else alive = this.foeShotHits(s);
        impact = !alive;
      }
      // A boulder only bursts where it lands (not when it times out or leaves the screen).
      if (impact && s.friendly && s.weapon === 'rock') this.rockBlast(s);
      if (alive) this.shots[keep++] = s;
    }
    this.shots.length = keep;
  }

  /** A boulder bursts where it lands: everything within a short radius takes the hit. */
  private rockBlast(s: Shot): void {
    this.particles.burst(s.x, s.y, ['#d9a066', '#ffffff', '#8a5a2a'], 14, 120);
    this.game.audio.sfx('explode', 1.4);
    this.game.fx.shake(1);
    if (this.boss && this.phase === 'boss') this.blastHit(s, this.boss);
    for (const f of this.foes) this.blastHit(s, f);
  }

  private blastHit(s: Shot, f: Foe): void {
    if (f.hp <= 0) return;
    const dx = Math.max(0, Math.abs(s.x - f.x) - f.w / 2);
    const dy = Math.max(0, f.y - f.h - s.y, s.y - f.y);
    if (Math.hypot(dx, dy) <= 30) this.damageFoe(f, s.dmg, 'rock');
  }

  private shotTouches(s: Shot, f: Foe): boolean {
    return Math.abs(s.x - f.x) < (f.w + s.r * 2) / 2 && s.y > f.y - f.h - s.r && s.y < f.y + s.r;
  }

  /** Returns whether the shot keeps flying. Bodies are solid to shots: nothing passes through a master. */
  private friendlyShotHits(s: Shot): boolean {
    const b = this.boss;
    if (b && b.hp > 0 && !s.hit?.includes(b) && this.shotTouches(s, b)) {
      if (this.bossInvulnerable()) {
        // The master is not fightable yet (the warning): shots ping off its body.
        this.particles.burst(s.x, s.y, ['#ffffff', '#8a9ab8'], 3, 50);
        return false;
      }
      if (s.weapon === 'rock') return false; // the blast does the damage
      this.damageFoe(b, s.dmg, s.weapon);
      if (!s.pierce) return false;
      s.hit?.push(b);
    }
    for (const f of this.foes) {
      if (f.hp <= 0 || s.hit?.includes(f) || !this.shotTouches(s, f)) continue;
      if (s.weapon === 'rock') return false;
      this.damageFoe(f, s.dmg, s.weapon);
      if (s.weapon === 'ice') f.frozen = 1.4;
      if (!s.pierce) return false;
      s.hit?.push(f);
    }
    return true;
  }

  private foeShotHits(s: Shot): boolean {
    if (this.shield > 0 && Math.hypot(s.x - this.px, s.y - (this.py - 10)) < 24) {
      this.particles.burst(s.x, s.y, ['#7dff6b', '#fff'], 4, 50);
      return false;
    }
    if (this.iframes <= 0 && Math.abs(s.x - this.px) < PW / 2 + s.r && s.y > this.py - PH - s.r && s.y < this.py + s.r) {
      this.hurt(1, s.x);
      return false;
    }
    return true;
  }

  private bossInvulnerable(): boolean {
    return this.phase !== 'boss' || !this.boss;
  }

  /** Applies damage; a master hit by the weapon it is weak to takes three times as much. */
  damageFoe(f: Foe, amount: number, weapon: WeaponId): void {
    const weak = f === this.boss && MASTER_BY_ID.get(this.master.id)?.weakTo === weapon;
    const dmg = amount * (weak ? 3 : 1);
    const before = f.hp;
    f.hp -= dmg;
    f.flash = 0.12;
    if (f === this.boss) for (const th of [0.75, 0.5, 0.25]) if (before / f.max > th && f.hp / f.max <= th && f.hp > 0) this.dropHeart();
    this.game.audio.sfx('hit', weak ? 0.7 : 1.2);
    if (weak) this.popups.add(f.x, f.y - f.h - 6, 'WEAK!', '#ffe23f');
    this.particles.burst(f.x, f.y - f.h / 2, [weak ? '#ffe23f' : '#fff', '#3f9fff'], weak ? 10 : 4, 70);
    if (f.hp > 0) return;
    if (f === this.boss) {
      this.bossDown();
      return;
    }
    this.kills++;
    this.addBits(f.kind === 'turret' || f.kind === 'hopper' ? 3 : 2, f.x, f.y - f.h);
    this.particles.burst(f.x, f.y - f.h / 2, ['#ffcf3f', '#ff6f3f', '#fff'], 10, 90);
    this.game.audio.sfx('explode', 2);
    if (this.dropRng.chance(0.22)) this.items.push({ x: f.x, y: f.y - 8, kind: this.dropRng.chance(0.5) ? 'we' : 'bit', taken: false });
  }

  /** A heart falls into the arena as a master weakens, so a long fight is not a pure attrition race. */
  private dropHeart(): void {
    const x = this.level.arenaX * TILE + this.bossRng.range(60, 360);
    this.items.push({ x, y: 13 * TILE - 40, kind: 'hp', taken: false });
    this.popups.add(x, 13 * TILE - 56, 'HEART!', '#ff3f6b');
  }

  private hurt(n: number, fromX: number, silent = false): void {
    if (this.iframes > 0 && !silent) return;
    const dmg = n * this.takenMult;
    this.hp = Math.max(0, this.hp - dmg);
    this.iframes = 1.8;
    this.noteDamage(dmg);
    this.popups.add(this.px, this.py - 26, `-${dmg}`, '#ff3f5a');
    if (!silent) {
      this.vx = Math.sign(this.px - fromX || -this.face) * 105;
      this.vy = -150;
      this.onGround = false;
      this.stun = HIT_STUN;
      this.jumpBuf = 0;
      this.jumpHeld = false;
    }
    this.charge = 0;
  }

  private lose(): void {
    this.endT = 0;
    this.shots.length = 0;
    this.beams = [];
    this.game.audio.sfx('explode');
    if (this.lives > 0) {
      // A spare life: back to the checkpoint (or the boss door, with the master topped up again).
      this.lives--;
      this.phase = 'downed';
      this.director.clearAll();
      this.particles.burst(this.px, this.py - 10, ['#ffffff', '#3f9fff', '#9fe8ff'], 18, 130);
      this.say(this.lives > 0 ? `LIFE LOST: ${this.lives} LEFT` : 'LAST LIFE', '#ff3f5a');
      return;
    }
    this.phase = 'lost';
    this.say('MISSION FAILED', '#ff3f5a');
  }

  private respawn(): void {
    this.hp = this.stats.maxHp;
    this.we = MAX_WE;
    this.iframes = 2.2;
    this.stun = 0;
    this.jumpBuf = 0;
    this.shield = 0;
    this.charge = 0;
    this.vx = this.vy = 0;
    this.onGround = false;
    if (this.locked) {
      this.px = this.level.arenaX * TILE + 40;
      this.py = BOSS_Y;
      this.spawnBoss(this.master);
    } else {
      this.px = this.spawnX;
      this.py = this.spawnY;
      this.camX = clamp(this.px - 190, 0, (this.level.width - 30) * TILE);
      this.phase = 'run';
    }
    this.game.audio.sfx('powerup');
  }

  /** Drinks an energy tank: all hearts and all weapon energy. */
  useTank(): boolean {
    const ok = this.tanks > 0 && this.hp < this.stats.maxHp && (this.phase === 'run' || this.phase === 'boss');
    if (!ok) {
      if (this.phase === 'run' || this.phase === 'boss') this.game.audio.sfx('miss');
      return false;
    }
    this.tanks--;
    this.game.profile.boltTanks = this.tanks;
    this.hp = this.stats.maxHp;
    this.we = MAX_WE;
    this.popups.add(this.px, this.py - 34, 'E-TANK!', '#3f9fff');
    this.particles.burst(this.px, this.py - 12, ['#3f9fff', '#ffffff'], 10, 80);
    this.game.audio.sfx('levelup');
    return true;
  }

  private updateItems(): void {
    for (const it of this.items) {
      if (it.taken || Math.abs(it.x - this.px) > 11 || it.y < this.py - PH - 6 || it.y > this.py + 6) continue;
      if (it.kind === 'hp' && this.hp >= this.stats.maxHp) continue;
      it.taken = true;
      if (it.kind === 'bit') {
        this.addBits(3, it.x, it.y - 8);
        this.game.audio.sfx('coin');
      } else if (it.kind === 'hp') {
        this.heal(1);
        this.popups.add(it.x, it.y - 10, '+1 HEART', '#ff3f6b');
        this.game.audio.sfx('powerup');
      } else if (it.kind === 'we') {
        this.we = Math.min(MAX_WE, this.we + 10);
        this.popups.add(it.x, it.y - 10, '+ENERGY', '#3f9fff');
        this.game.audio.sfx('powerup');
      } else if (it.kind === 'life') {
        if (this.lives < MAX_LIVES) {
          this.lives++;
          this.popups.add(it.x, it.y - 10, '1UP!', '#7dff6b');
        } else {
          this.addBits(20, it.x, it.y - 8);
          this.popups.add(it.x, it.y - 10, 'LIVES FULL', '#7dff6b');
        }
        this.game.audio.sfx('levelup');
      } else if (it.kind === 'tank') {
        if (this.tanks < MAX_TANKS) {
          this.tanks++;
          this.game.profile.boltTanks = this.tanks;
          this.popups.add(it.x, it.y - 10, 'E-TANK!', '#3f9fff');
          this.game.toast('ENERGY TANK', 'DOWN + C (OR TAP THE E) REFILLS HEARTS AND WEAPON ENERGY', '#3f9fff');
        } else {
          this.addBits(20, it.x, it.y - 8);
          this.popups.add(it.x, it.y - 10, 'TANKS FULL', '#3f9fff');
        }
        this.game.audio.sfx('levelup');
      } else {
        this.collectFloppy(this.master.floppy ?? 0);
      }
    }
  }

  // ---- the boss --------------------------------------------------------------------
  private startBoss(): void {
    this.locked = true;
    this.phase = 'bossIntro';
    this.bossIntroT = 0;
    this.foes = this.foes.filter((f) => Math.abs(f.x - this.px) > 9999);
    this.shots.length = 0;
    this.director.clearAll();
    this.game.music('bolt_boss');
    this.say(`WARNING: ${this.master.name}`, this.master.color);
    this.game.audio.sfx('warn');
    this.spawnBoss(this.master);
    this.phase = 'bossIntro';
  }

  private spawnBoss(m: MasterDef): void {
    const hp = Math.max(8, Math.round(m.hp * 3 * Math.sqrt(this.diffMult) * (this.opts.rematch ? 1.2 : 1)));
    const ax = this.level.arenaX * TILE;
    this.boss = { kind: 'boss', x: ax + 20 * TILE, y: BOSS_Y, vx: 0, vy: 0, w: 28, h: 38, hp: 1, max: hp, t: 0, dir: -1, frozen: 0, flash: 0, home: BOSS_Y, active: true, grounded: true };
    this.bossIntroT = 0;
    this.bossState = 'idle';
    this.bossT = 1;
    this.bossN = 0;
    this.phase = 'bossIntro';
    this.beams = [];
    this.shots = this.shots.filter((s) => s.friendly);
    this.say(`WARNING: ${m.name}`, m.color);
  }

  private updateBoss(dt: number): void {
    const b = this.boss!;
    if (this.phase !== 'boss') return;
    b.flash = Math.max(0, b.flash - dt);
    const m = this.master;
    const sk = Math.sqrt(this.diffMult);
    b.t += dt;
    this.bossT -= dt;
    const ax0 = this.level.arenaX * TILE + 16;
    const ax1 = this.level.width * TILE - 16;
    // physics
    b.vy = Math.min(420, b.vy + GRAV * this.stageGrav * dt);
    const body = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
    const hit = this.moveBox(body, b.w, b.h, dt);
    b.x = clamp(body.x, ax0, ax1);
    b.y = body.y;
    b.vy = body.vy;
    b.vx = hit.wall ? 0 : body.vx;
    b.grounded = hit.floor;
    if (b.grounded && this.bossState !== 'do') b.vx *= 0.8;
    // contact
    if (Math.abs(b.x - this.px) < (b.w + PW) / 2 && b.y > this.py - PH && b.y - b.h < this.py) {
      // The master's body hurts to touch, unless the leaf shield is up: then the leaves bite it instead.
      if (this.shield > 0) this.leafTouch(b);
      else if (this.iframes <= 0) this.hurt(1, b.x);
    }
    if (this.bossState === 'idle' && this.bossT <= 0) {
      const set = m.attacks;
      this.bossAtk = set[this.bossRng.int(0, set.length - 1)];
      this.bossState = 'tell';
      this.bossT = this.bossAtk === 'column' ? 1 : 0.6;
      b.dir = Math.sign(this.px - b.x) || -1;
      if (this.bossAtk === 'column') {
        this.beams = [{ x: clamp(this.px, ax0 + 10, ax1 - 10), t: 0 }, { x: this.bossRng.range(ax0 + 20, ax1 - 20), t: 0 }];
        if (this.diffMult > 1.1) this.beams.push({ x: this.bossRng.range(ax0 + 20, ax1 - 20), t: 0 });
        this.game.audio.sfx('warn');
      }
    } else if (this.bossState === 'tell' && this.bossT <= 0) {
      this.bossState = 'do';
      this.runAttack(this.bossAtk, sk);
    } else if (this.bossState === 'do') {
      this.bossAttackTick(dt, sk);
    }
    for (const bm of this.beams) bm.t += dt;
  }

  private runAttack(a: AttackId, sk: number): void {
    const b = this.boss!;
    const toward = Math.sign(this.px - b.x) || -1;
    b.dir = toward;
    this.bossN++;
    if (a === 'dash') {
      b.vx = toward * 230 * sk;
      this.bossT = 0.8;
    } else if (a === 'arc') {
      for (let i = 0; i < 3; i++) this.foeShot(b.x, b.y - 24, toward * (70 + i * 45) * sk, -230 - i * 20, 520, 4);
      this.bossT = 0.5;
      this.game.audio.sfx('shoot', 0.6);
    } else if (a === 'fan') {
      for (let i = -1; i <= 1; i++) this.foeShot(b.x, b.y - 22, toward * 105 * sk, i * 34, 0, 3);
      this.bossT = 0.5;
      this.game.audio.sfx('shoot', 0.6);
    } else if (a === 'leap') {
      b.vy = -340 * Math.sqrt(this.stageGrav);
      b.vx = toward * 110 * sk;
      this.bossT = 0.85;
    } else if (a === 'rain') {
      for (let i = 0; i < 6; i++) this.foeShot(this.bossRng.range(this.level.arenaX * TILE + 20, this.level.width * TILE - 20), -10 - i * 18, 0, 90 * sk, 0, 3);
      this.bossT = 1.2;
      this.game.audio.sfx('warn');
    } else if (a === 'wave') {
      // A low surge to jump and a slower bubble above it that only catches a jumper.
      this.foeShot(b.x, BOSS_Y - 7, toward * 130 * sk, 0, 0, 7);
      this.foeShot(b.x, BOSS_Y - 27, toward * 60 * sk, 0, 0, 4);
      this.bossT = 0.9;
      this.game.audio.sfx('shoot', 0.5);
    } else if (a === 'quake') {
      // The ground shakes and boulders fall in a row around where you stand.
      const lo = this.level.arenaX * TILE + 26, hi = this.level.width * TILE - 26;
      for (let i = -2; i <= 2; i++) this.foeShot(clamp(this.px + i * 34 + this.bossRng.range(-8, 8), lo, hi), -10 - Math.abs(i) * 24, 0, 115 * sk, 0, 4);
      this.bossT = 1.2;
      this.game.audio.sfx('slam');
      this.game.fx.shake(4);
    } else if (a === 'column') {
      this.bossT = 0.4;
      this.game.audio.sfx('slam');
      this.game.fx.shake(3);
    }
  }

  private bossAttackTick(_dt: number, _sk: number): void {
    const b = this.boss!;
    if (this.bossAtk === 'column') {
      // The beams hurt for their strike window.
      for (const bm of this.beams) if (bm.t > 0 && this.iframes <= 0 && Math.abs(this.px - bm.x) < 12) this.hurt(1, bm.x);
    }
    if (this.bossAtk === 'leap' && b.grounded && this.bossT < 0.5 && b.vy === 0) {
      // landing shockwave along the floor, low enough to jump
      if (this.bossN % 1 === 0 && !this.shots.some((s) => !s.friendly && s.y > BOSS_Y - 10 && s.vy === 0)) {
        this.foeShot(b.x - 10, BOSS_Y - 6, -120, 0, 0, 3);
        this.foeShot(b.x + 10, BOSS_Y - 6, 120, 0, 0, 3);
        this.game.audio.sfx('slam');
        this.game.fx.shake(2);
      }
    }
    if (this.bossT <= 0) {
      this.bossState = 'idle';
      this.beams = [];
      this.bossT = 1.3 + this.bossRng.range(0, 0.7);
    }
  }

  private bossDown(): void {
    const b = this.boss!;
    this.phase = 'dying';
    this.endT = 0;
    this.director.clearAll();
    this.beams = [];
    this.shots.length = 0;
    this.game.audio.sfx('explode');
    this.game.fx.flash('#ffffff', 0.5);
    this.game.fx.shake(6);
    this.addBits(30, b.x, b.y - 40);
    this.say(this.fortress ? `${this.master.name} DOWN` : 'STAGE CLEAR', this.master.color);
  }

  private win(): void {
    this.phase = 'won';
    this.endT = 0;
    this.shots.length = 0;
    this.boss = this.fortress ? null : this.boss;
    this.game.audio.sfx('levelup');
    if (!this.fortress) {
      const w = WEAPONS[this.master.weapon];
      this.say(`GOT ${w.name}`, w.color);
    } else this.say('FORTRESS CLEARED', '#ffe23f');
  }

  private finishWin(): void {
    const score = Math.floor(this.kills * 40 + this.hp * 300 + this.lives * 250 + Math.max(0, 3000 - this.time * 10) + this.runBits * 10);
    if (this.fortress) {
      this.runFlags.add('bolt_fortress');
      this.addBits(120);
      this.finish(true, score + 2000, { boss: 'fortress' });
      return;
    }
    const first = !this.game.profile.bossesDefeated.includes(this.master.id);
    if (first) this.game.toast('NEW WEAPON', `${WEAPONS[this.master.weapon].name}: ${WEAPONS[this.master.weapon].desc}`, WEAPONS[this.master.weapon].color);
    this.addBits(first ? 50 : 20);
    this.finish(true, score, { boss: this.master.id });
  }

  // ---- drawing ---------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'select') {
      this.drawSelect(ctx);
      return;
    }
    this.drawWorld(ctx);
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    this.drawHud(ctx);
  }

  private drawSelect(ctx: CanvasRenderingContext2D): void {
    const pal = PAL.bolt;
    backdrop(ctx, '#05101e', pal.bg1);
    for (let i = 0; i < 18; i++) rect(ctx, (i * 71 + this.time * 10) % W, (i * 43) % H, 2, 2, '#ffffff22');
    drawText(ctx, 'STAGE SELECT', W / 2, 10, '#ffe23f', { align: 'center', scale: 2 });
    const owned = this.beaten();
    const cards = this.cardRects();
    cards.forEach((c, i) => {
      const sel = i === this.selIndex;
      if (i === MASTERS.length) {
        frame(ctx, c.x, c.y, c.w, c.h, sel ? '#2a2a0a' : '#0b0716', sel ? '#ffe23f' : '#4a4a20');
        drawText(ctx, 'THE FORTRESS: ALL SIX MASTERS BACK TO BACK', c.x + c.w / 2, c.y + 8, sel ? '#ffe23f' : '#a8a860', { align: 'center' });
        return;
      }
      const m = MASTERS[i];
      const done = owned.includes(m.id);
      frame(ctx, c.x, c.y, c.w, c.h, sel ? '#10243e' : '#0a1626', sel ? m.color : '#2a4468');
      this.drawRobot(ctx, c.x + 34, c.y + 52, m, this.time, done ? 0.6 : 1, 1);
      drawText(ctx, m.name, c.x + 72, c.y + 6, done ? '#9a9ab8' : m.color);
      drawText(ctx, `WEAPON: ${WEAPONS[m.weapon].name}`, c.x + 72, c.y + 17, WEAPONS[m.weapon].color);
      const weakOwned = owned.includes(MASTERS.find((x) => x.weapon === m.weakTo)?.id as MasterId);
      drawText(ctx, weakOwned ? `WEAK TO: ${WEAPONS[m.weakTo].name}` : 'WEAKNESS: ???', c.x + 72, c.y + 28, weakOwned ? '#ffe23f' : '#5a6a88');
      drawText(ctx, done ? '★ DEFEATED' : m.floppy !== null ? `DISK ${this.game.profile.floppies.includes(`bolt-${m.floppy}`) ? '■' : '□'} HIDDEN` : m.title, c.x + 72, c.y + 42, done ? '#7dff6b' : '#7a8aa8');
    });
    drawText(ctx, `1UP x${this.lives}   E-TANK x${this.tanks}`, W - 6, 14, '#9a9ab8', { align: 'right' });
    drawText(ctx, this.game.input.label(this.fortressOpen ? 'ARROWS CHOOSE • Z GO • X BACK' : `DEFEAT ALL SIX TO OPEN THE FORTRESS (${owned.length}/6) • ARROWS CHOOSE • Z GO • X BACK`), W / 2, H - 14, '#9a9ab8', { align: 'center' });
  }

  /** The robot masters (and the select portraits): a chunky body with a crest per master. */
  private drawRobot(ctx: CanvasRenderingContext2D, x: number, feet: number, m: MasterDef, t: number, alpha = 1, scale = 1, flash = false): void {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(feet));
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    const c = flash ? '#ffffff' : m.color;
    const d = flash ? '#cccccc' : m.dark;
    const bob = Math.round(Math.sin(t * 4) * 1);
    rect(ctx, -9, -8, 7, 8, d);
    rect(ctx, 2, -8, 7, 8, d);
    rect(ctx, -12, -22 + bob, 24, 16, c);
    rect(ctx, -12, -22 + bob, 24, 3, 'rgba(255,255,255,0.35)');
    rect(ctx, -14, -20 + bob, 3, 10, d);
    rect(ctx, 11, -20 + bob, 3, 10, d);
    rect(ctx, -9, -34 + bob, 18, 13, c);
    rect(ctx, -7, -30 + bob, 14, 6, '#05101e');
    rect(ctx, -5, -29 + bob, 3, 3, '#ffffff');
    rect(ctx, 2, -29 + bob, 3, 3, '#ffffff');
    if (m.id === 'frostbyte') for (let i = -1; i <= 1; i++) rect(ctx, i * 5 - 1, -40 + bob - Math.abs(i) * -1, 3, 6, '#dff8ff');
    else if (m.id === 'flarebot') {
      rect(ctx, -3, -41 + bob, 6, 7, '#ffcf3f');
      rect(ctx, -1, -45 + bob, 3, 5, '#ff7a1a');
    } else if (m.id === 'sproutron') {
      rect(ctx, -6, -40 + bob, 5, 6, '#3aa84a');
      rect(ctx, 1, -42 + bob, 5, 8, '#7dff6b');
    } else if (m.id === 'aquabyte') {
      // a dorsal fin and a bubble helmet
      rect(ctx, -2, -43 + bob, 4, 9, '#bfe3ff');
      rect(ctx, -5, -39 + bob, 10, 5, '#5fb0ff');
      rect(ctx, 5, -33 + bob, 3, 3, '#ffffffaa');
    } else if (m.id === 'tremorbot') {
      // a blocky rock crown
      rect(ctx, -8, -40 + bob, 6, 7, '#8a5a2a');
      rect(ctx, -2, -43 + bob, 6, 10, '#c8955a');
      rect(ctx, 4, -39 + bob, 5, 6, '#8a5a2a');
    } else {
      rect(ctx, -1, -42 + bob, 2, 8, '#ffffff');
      rect(ctx, -3, -44 + bob, 6, 3, '#ffe23f');
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawWorld(ctx: CanvasRenderingContext2D): void {
    const m = this.master;
    const cam = Math.round(this.camX);
    // sky and parallax
    backdrop(ctx, m.dark, '#05101e');
    const far = cam * 0.25;
    for (let i = 0; i < 9; i++) {
      const bx = ((i * 83 - far) % (W + 80) + W + 80) % (W + 80) - 40;
      const bh = 40 + ((i * 37) % 60);
      ctx.globalAlpha = 0.25;
      rect(ctx, bx, 190 - bh, 46, bh, m.color);
      ctx.globalAlpha = 0.5;
      rect(ctx, bx + 6, 190 - bh + 6, 4, 4, '#ffffff');
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(-cam, 0);
    // tiles
    const t0 = Math.max(0, Math.floor(cam / TILE) - 1);
    const t1 = Math.min(this.level.width - 1, t0 + 33);
    for (let tx = t0; tx <= t1; tx++) {
      for (let ty = Math.max(0, this.level.ground[tx]); ty < ROWS; ty++) {
        if (!this.grid[ty][tx]) continue;
        this.drawTile(ctx, tx, ty, ty === this.level.ground[tx]);
      }
    }
    for (const p of this.level.platforms) {
      if (p.x + p.w < t0 || p.x > t1) continue;
      for (let x = p.x; x < p.x + p.w; x++) this.drawTile(ctx, x, p.y, true);
    }
    // the boss door and arena wall
    const ax = this.level.arenaX * TILE;
    if (this.locked || this.phase === 'bossIntro') {
      rect(ctx, ax + 2, 8 * TILE, 8, 5 * TILE, '#8a9ab8');
      rect(ctx, ax + 2, 8 * TILE, 3, 5 * TILE, '#c8d8f0');
    } else {
      rect(ctx, ax - 10, 9 * TILE + 2, 6, 4 * TILE - 2, '#4a5a78');
      rect(ctx, ax - 10, 9 * TILE + 2, 2, 4 * TILE - 2, '#7a8aa8');
    }
    // hazards
    for (const h of this.hazards) this.drawHazard(ctx, h);
    // items
    for (const it of this.items) {
      if (it.taken) continue;
      const bob = Math.sin(this.time * 5 + it.x) * 2;
      if (it.kind === 'bit') {
        rect(ctx, it.x - 3, it.y - 3 + bob, 6, 6, '#ffcf3f');
        rect(ctx, it.x - 2, it.y - 2 + bob, 2, 2, '#fff7a8');
      } else if (it.kind === 'hp') {
        glow(ctx, it.x, it.y + bob, 12, '255,63,107', 0.5);
        hearts(ctx, it.x - 5, it.y - 5 + bob, 1, 1);
      } else if (it.kind === 'life') {
        glow(ctx, it.x, it.y + bob, 14, '125,255,107', 0.6);
        rect(ctx, it.x - 6, it.y - 6 + bob, 12, 12, '#1a4a1a');
        rect(ctx, it.x - 5, it.y - 5 + bob, 10, 10, '#7dff6b');
        rect(ctx, it.x - 3, it.y - 2 + bob, 2, 3, '#05101e');
        rect(ctx, it.x + 1, it.y - 2 + bob, 2, 3, '#05101e');
        drawText(ctx, '1UP', it.x - 8, it.y - 16 + bob, '#7dff6b');
      } else if (it.kind === 'tank') {
        glow(ctx, it.x, it.y + bob, 14, '63,159,255', 0.6);
        rect(ctx, it.x - 6, it.y - 7 + bob, 12, 14, '#0b2a5a');
        rect(ctx, it.x - 5, it.y - 6 + bob, 10, 12, '#cfe8ff');
        rect(ctx, it.x - 5, it.y - 1 + bob, 10, 7, '#3f9fff');
        drawText(ctx, 'E', it.x - 2, it.y - 4 + bob, '#ffffff');
      } else if (it.kind === 'we') {
        glow(ctx, it.x, it.y + bob, 10, '63,159,255', 0.5);
        rect(ctx, it.x - 4, it.y - 4 + bob, 8, 8, '#3f9fff');
        rect(ctx, it.x - 2, it.y - 2 + bob, 4, 4, '#ffffff');
      } else {
        glow(ctx, it.x, it.y + bob, 14, '63,224,255', 0.6);
        rect(ctx, it.x - 6, it.y - 6 + bob, 12, 12, '#3fe0ff');
        rect(ctx, it.x - 4, it.y - 6 + bob, 8, 4, '#0b1a2a');
        rect(ctx, it.x - 3, it.y + 1 + bob, 6, 4, '#ffffff');
      }
    }
    // foes
    for (const f of this.foes) if (f.hp > 0 && f.x > cam - 30 && f.x < cam + W + 30) this.drawFoe(ctx, f);
    if (this.boss && this.boss.hp > 0 || this.phase === 'bossIntro') {
      const b = this.boss!;
      if (b) this.drawBossSprite(ctx, b);
    }
    // beams
    for (const bm of this.beams) {
      const strike = bm.t > 0 ? true : false;
      const tele = this.bossState === 'tell';
      ctx.globalAlpha = tele ? 0.3 + Math.sin(this.time * 18) * 0.15 : 0.9;
      rect(ctx, bm.x - 12, 0, 24, 13 * TILE, strike && !tele ? '#ffe23f' : '#ff3f5a55');
      ctx.globalAlpha = 1;
    }
    // shots
    for (const s of this.shots) {
      const col = s.friendly ? WEAPONS[s.weapon].color : '#ff6f6f';
      glow(ctx, s.x, s.y, s.r * 2.6, s.friendly ? '63,159,255' : '255,80,80', 0.5);
      rect(ctx, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2, col);
      rect(ctx, s.x - s.r + 1, s.y - s.r + 1, Math.max(1, s.r * 2 - 2), Math.max(1, s.r * 2 - 2), '#ffffff');
    }
    // leaf shield
    if (this.shield > 0) {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 5 + (i * Math.PI * 2) / 3;
        const lx = this.px + Math.cos(a) * 20, ly = this.py - 10 + Math.sin(a) * 14;
        rect(ctx, lx - 3, ly - 3, 7, 7, '#7dff6b');
        rect(ctx, lx - 1, ly - 1, 3, 3, '#e8ffd8');
      }
    }
    // player
    const blink = this.iframes > 0 && this.stun <= 0 && Math.floor(this.time * 10) % 2 === 0;
    if (!blink && this.phase !== 'lost' && this.phase !== 'downed') {
      const pose = this.stun > 0 ? 'hurt' : !this.onGround ? 'jump' : this.shootAnim > 0 ? 'attack' : Math.abs(this.vx) > 6 ? 'run' : 'idle';
      if (this.charge >= CHARGE_1) glow(ctx, this.px, this.py - 12, 18 + (this.charge >= CHARGE_2 ? 8 : 0), this.charge >= CHARGE_2 ? '255,255,255' : '63,159,255', 0.5 + Math.sin(this.time * 24) * 0.2);
      drawCass(ctx, { x: Math.round(this.px), y: Math.round(this.py), facing: this.face, pose, t: this.time, scale: 1 }, this.game.profile.character);
    }
    ctx.restore();
    // BLACKOUT: only a circle around the player is visible
    if (this.director.flag('dark')) {
      const g = ctx.createRadialGradient(this.px - cam, this.py - 10, 24, this.px - cam, this.py - 10, 96);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.94)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  private drawTile(ctx: CanvasRenderingContext2D, tx: number, ty: number, top: boolean): void {
    const m = this.master;
    const x = tx * TILE, y = ty * TILE;
    rect(ctx, x, y, TILE, TILE, m.dark);
    rect(ctx, x + 1, y + 1, TILE - 2, TILE - 2, ty % 2 ? '#14304e' : '#112a44');
    if (top) {
      rect(ctx, x, y, TILE, 4, m.color);
      rect(ctx, x, y, TILE, 1, '#ffffff66');
    }
    rect(ctx, x + 6, y + 8, 4, 2, 'rgba(255,255,255,0.06)');
  }

  private drawHazard(ctx: CanvasRenderingContext2D, h: Zap): void {
    const x = h.x * TILE, y = h.y * TILE;
    if (h.kind === 'spike') {
      for (let i = 0; i < 4; i++) {
        rect(ctx, x + i * 4, y + 10, 4, 6, '#c8d8f0');
        rect(ctx, x + i * 4 + 1, y + 6, 2, 4, '#ffffff');
      }
    } else if (h.kind === 'zap') {
      const on = this.hazardActive(h);
      rect(ctx, x + 2, y + 12, 12, 4, '#4a4a60');
      if (on) {
        glow(ctx, x + 8, y + 8, 14, '255,226,63', 0.6);
        for (let i = 0; i < 3; i++) rect(ctx, x + 3 + i * 4 + ((Math.floor(this.time * 20) + i) % 2), y + 3 + (i % 2) * 4, 3, 9, '#ffe23f');
      }
    } else {
      rect(ctx, x + 2, y + 12, 12, 4, this.master.id === 'aquabyte' ? '#1a3a5a' : '#4a2a20');
      const on = this.hazardActive(h);
      const warn = !on && (this.time + h.x * 0.53) % 2.4 > 1.1;
      const water = this.master.id === 'aquabyte';
      if (on) {
        glow(ctx, x + 8, y - 8, 22, water ? '63,159,255' : '255,122,26', 0.6);
        rect(ctx, x + 3, y - TILE * 2, 10, TILE * 3, water ? '#3f8fff' : '#ff7a1a');
        rect(ctx, x + 5, y - TILE * 2 + 6, 6, TILE * 3 - 6, water ? '#bfe8ff' : '#ffcf3f');
      } else if (warn) rect(ctx, x + 6, y + 6, 4, 6, water ? '#3f8fff' : '#ff7a1a');
    }
  }

  private drawFoe(ctx: CanvasRenderingContext2D, f: Foe): void {
    const flash = f.flash > 0;
    const frozen = f.frozen > 0;
    const body = flash ? '#ffffff' : frozen ? '#9fe8ff' : { walker: '#ff6f3f', hopper: '#b07aff', turret: '#8a8aa8', flyer: '#ff3fd2' }[f.kind as EnemyKind];
    const x = Math.round(f.x), y = Math.round(f.y);
    if (f.kind === 'walker') {
      rect(ctx, x - 6, y - 10, 12, 10, body);
      rect(ctx, x - 6, y - 10, 12, 2, 'rgba(255,255,255,0.4)');
      rect(ctx, x + f.dir * 2 - 1, y - 7, 2, 2, '#000');
      rect(ctx, x - 5 + (Math.floor(f.t * 6) % 2) * 6, y - 1, 4, 2, '#222');
    } else if (f.kind === 'hopper') {
      const squash = f.grounded ? 2 : 0;
      rect(ctx, x - 6, y - 10 + squash, 12, 10 - squash, body);
      rect(ctx, x - 4, y - 8 + squash, 3, 3, '#ffffff');
      rect(ctx, x + 1, y - 8 + squash, 3, 3, '#ffffff');
    } else if (f.kind === 'turret') {
      rect(ctx, x - 6, y - 8, 12, 8, body);
      rect(ctx, x - 3, y - 12, 6, 5, '#555570');
      const a = Math.atan2(this.py - 10 - (y - 8), this.px - x);
      rect(ctx, x + Math.cos(a) * 6 - 1, y - 9 + Math.sin(a) * 6 - 1, 3, 3, '#ff3f3f');
    } else {
      rect(ctx, x - 5, y - 8, 10, 6, body);
      const flap = Math.floor(f.t * 12) % 2;
      rect(ctx, x - 9, y - 9 + flap * 3, 5, 2, body);
      rect(ctx, x + 4, y - 9 + flap * 3, 5, 2, body);
      rect(ctx, x - 2, y - 6, 2, 2, '#fff');
    }
    if (f.hp < f.max) bar(ctx, x - 6, y - 16, 12, 2, f.hp / f.max, '#7dff6b', '#300', '#00000000');
  }

  private drawBossSprite(ctx: CanvasRenderingContext2D, b: Foe): void {
    this.drawRobot(ctx, b.x, b.y, this.master, this.time, b.hp <= 0 ? 0.4 : 1, 1, b.flash > 0);
    if (this.phase === 'boss' && this.bossState === 'tell') {
      ctx.globalAlpha = 0.5 + Math.sin(this.time * 30) * 0.3;
      rect(ctx, b.x - 14, b.y - 40, 28, 3, '#ff3f5a');
      ctx.globalAlpha = 1;
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    hearts(ctx, 6, 6, this.hp, this.stats.maxHp);
    // weapon energy meter and name
    const w = WEAPONS[this.weapon];
    drawText(ctx, w.name, 6, 18, w.color);
    if (this.weapon !== 'buster') bar(ctx, 6, 28, 70, 4, this.we / MAX_WE, w.color, '#08121e', '#ffffff55');
    else if (this.charge > 0.1) bar(ctx, 6, 28, 70, 4, Math.min(1, this.charge / CHARGE_2), this.charge >= CHARGE_2 ? '#ffffff' : '#3f9fff', '#08121e', '#ffffff55');
    // the weapon strip: tap one to pick it (C cycles)
    const own = this.ownedWeapons;
    own.forEach((id, i) => {
      const cur = id === this.weapon;
      rect(ctx, 6 + i * 13, 37, 11, 9, cur ? '#ffffff' : '#2a4468');
      rect(ctx, 7 + i * 13, 38, 9, 7, WEAPONS[id].color);
      if (!cur) rect(ctx, 7 + i * 13, 38, 9, 7, 'rgba(5,16,30,0.45)');
    });
    if (own.length > 1 || this.tanks > 0) drawText(ctx, this.game.input.label(own.length > 1 ? 'C: SWAP' : 'DOWN+C: E-TANK'), 6, 50, '#7a8aa8');
    drawText(ctx, `BITS ${this.runBits}`, W / 2 - 40, 6, '#ffcf3f');
    drawText(ctx, `1UP x${this.lives}`, W / 2 - 40, 16, '#7dff6b');
    drawText(ctx, `E x${this.tanks}`, W / 2 + 28, 16, this.tanks > 0 && this.hp < this.stats.maxHp ? '#9fd0ff' : '#3f6fa8');
    drawText(ctx, this.master.name, W / 2 + 40, 6, this.master.color);
    this.drawChaosHud(ctx, W - 106, 16);
    // boss bar
    if (this.boss && (this.phase === 'boss' || this.phase === 'bossIntro' || this.phase === 'dying')) {
      const b = this.boss;
      bar(ctx, W - 20, 28, 8, 100, 0, '#000', '#000', '#ffffff55');
      const frac = clamp(b.hp / b.max, 0, 1);
      rect(ctx, W - 19, 29 + 98 * (1 - frac), 6, 98 * frac, this.master.color);
      rect(ctx, W - 19, 29, 6, 1, '#ffffff55');
    }
    if (this.banner) {
      const a = this.banner.t < 0.2 ? this.banner.t / 0.2 : this.banner.t > 1.5 ? 1 - (this.banner.t - 1.5) / 0.3 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      drawText(ctx, this.banner.text, W / 2, 96, this.banner.color, { align: 'center', scale: 2 });
      ctx.globalAlpha = 1;
    }
    this.drawHint(ctx, 'ARROWS RUN • Z JUMP • X SHOOT (HOLD TO CHARGE) • C SWAP WEAPON');
    this.drawSeed(ctx);
  }
}

