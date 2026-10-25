/**
 * RETRO RAMPAGE — side-scrolling action platformer that mutates mid-level
 * into a horizontal shoot-'em-up, then back again.
 *
 * Mutations honoured here:
 *  - BEAT BRIDGES (platformer+rhythm): B/b platforms exist on alternating beat phases.
 *  - TRICK SHOT (shooter+puzzle): blaster shots flip switches that open secret gates.
 * Chaos flags honoured: gravity_flip, low_gravity, note_floor, giant, bouncy, reverse, enemies_racers.
 */
import type { Game } from '../game.ts';
import { ModeBase } from './base.ts';
import { DirectorContext, ActiveEvent } from '../chaos/director.ts';
import { generateRampage, RampageLevel, TILE, ROWS } from '../procgen/rampage.ts';
import { H, W, PAL, rect, clamp, approach, hearts } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { drawBit, drawCass, drawFloppy, drawHeart, Pose } from '../render/actors.ts';

interface Enemy {
  kind: 'walker' | 'flyer' | 'turret' | 'drone' | 'rock';
  x: number; y: number; w: number; h: number;
  vx: number; vy: number;
  hp: number; t: number; dir: number;
  baseY: number; cd: number; flash: number; alive: boolean;
}
interface Shot { x: number; y: number; vx: number; vy: number; friendly: boolean; life: number; bounces: number; alive: boolean }
interface Pickup { kind: 'bit' | 'floppy' | 'heart' | 'chaos' | 'checkpoint' | 'switch'; x: number; y: number; index: number; taken: boolean; t: number }

const GRAV = 900;
const RUN = 110;
const JUMP_V = 330;

export class RampageMode extends ModeBase {
  id = 'rampage';
  crt = 0.18;
  level: RampageLevel;
  tiles: string[][];
  // player
  px = 0; py = 0; pw = 10; ph = 22;
  vx = 0; vy = 0;
  onGround = false;
  facing = 1;
  coyote = 0;
  jumpBuf = 0;
  airJumps = 0;
  attackT = 0;
  attackCd = 0;
  iframes = 0;
  hp: number;
  energy: number;
  energyT = 0;
  ship = false;
  shipFire = 0;
  safeX = 0; safeY = 0;
  checkX = 0; checkY = 0;
  squash = 1;
  dead = 0;
  continues = 0;
  camX = 0;
  shmupState: 'before' | 'in' | 'after' = 'before';
  waveT = 0;
  gatesOpen = false;
  enemies: Enemy[] = [];
  shots: Shot[] = [];
  pickups: Pickup[] = [];
  stompChain = 0;
  bannerT = 0;
  exitX = 0; exitY = 0;
  won = false;
  winT = 0;
  winScore = 0;
  private lastBeatPhase = 0;

  constructor(game: Game, opts: { rematch?: boolean } = {}) {
    super(game, 'rampage', opts);
    this.level = generateRampage(this.seed, {
      beatPlatforms: this.fusion.has('beat_platforms'),
      switchShots: this.fusion.has('shots_trigger_switches'),
    });
    this.tiles = this.level.tiles.map((r) => r.slice());
    this.hp = this.stats.maxHp;
    this.energy = this.stats.energy;
    let floppyIndex = 0;
    for (const s of this.level.spawns) {
      const wx = s.x * TILE;
      const wy = s.y * TILE;
      switch (s.kind) {
        case 'P': this.px = wx + 3; this.py = wy + TILE - this.ph; break;
        case 'X': this.exitX = wx; this.exitY = wy; break;
        case 'e': this.enemies.push(this.mkEnemy('walker', wx + 1, wy + 4)); break;
        case 'f': this.enemies.push(this.mkEnemy('flyer', wx + 2, wy + 2)); break;
        case 't': this.enemies.push(this.mkEnemy('turret', wx + 1, wy + 2)); break;
        case 'o': this.pickups.push({ kind: 'bit', x: wx + 8, y: wy + 8, index: 0, taken: false, t: Math.random() }); break;
        case 'F': this.pickups.push({ kind: 'floppy', x: wx + 8, y: wy + 8, index: floppyIndex++, taken: false, t: 0 }); break;
        case 'H': this.pickups.push({ kind: 'heart', x: wx + 8, y: wy + 8, index: 0, taken: false, t: 0 }); break;
        case 'C': this.pickups.push({ kind: 'chaos', x: wx + 8, y: wy + 8, index: 0, taken: false, t: 0 }); break;
        case 'k': this.pickups.push({ kind: 'checkpoint', x: wx + 8, y: wy + 16, index: 0, taken: false, t: 0 }); break;
        case 'S': this.pickups.push({ kind: 'switch', x: wx + 8, y: wy + 8, index: 0, taken: false, t: 0 }); break;
      }
    }
    // The third floppy floats in the shmup sky.
    const sf = this.level.shmup.floppy;
    this.pickups.push({ kind: 'floppy', x: sf.x * TILE + 8, y: sf.y * TILE + 8, index: floppyIndex++, taken: false, t: 0 });
    for (const a of this.level.shmup.asteroids) this.enemies.push(this.mkEnemy('rock', a.x * TILE, a.y * TILE));
    this.safeX = this.checkX = this.px;
    this.safeY = this.checkY = this.py;
  }

  enter(): void {
    this.game.music('rampage');
  }

  private mkEnemy(kind: Enemy['kind'], x: number, y: number): Enemy {
    const sizes: Record<Enemy['kind'], [number, number, number]> = { walker: [14, 12, 2], flyer: [12, 10, 1], turret: [14, 14, 3], drone: [14, 10, 1], rock: [16, 16, 3] };
    const [w, h, hp] = sizes[kind];
    return { kind, x, y, w, h, vx: kind === 'walker' ? -30 : 0, vy: 0, hp, t: Math.random() * 6, dir: -1, baseY: y, cd: 1 + Math.random() * 2, flash: 0, alive: true };
  }

  // ---- tile helpers --------------------------------------------------------
  tileAt(tx: number, ty: number): string {
    if (tx < 0 || tx >= this.level.width) return '#';
    if (ty < 0) return '.';
    if (ty >= ROWS) return '.';
    return this.tiles[ty][tx];
  }
  beatPhase(): { phase: number; warn: boolean } {
    const per = this.fusion.param('beat_platforms', 'beatsPerPhase', 2);
    const warnBeats = this.fusion.param('beat_platforms', 'warnBeats', 0.5);
    const beat = this.game.audio.musicTime() * this.game.audio.bpm / 60;
    const phase = Math.floor(beat / per) % 2;
    const into = beat % per;
    return { phase, warn: per - into < warnBeats };
  }
  isSolid(c: string): boolean {
    return c === '#' || c === '?' || (c === 'G' && !this.gatesOpen);
  }
  isPlatform(c: string, phase: number): boolean {
    if (c === '=') return true;
    if (c === 'B') return phase === 0;
    if (c === 'b') return phase === 1;
    return false;
  }

  get gsign(): number {
    return this.director.flag('gravity_flip') ? -1 : 1;
  }
  get giant(): boolean {
    return this.director.flag('giant') && !this.ship;
  }

  directorContext(): DirectorContext {
    return {
      hpFrac: this.hp / this.stats.maxHp,
      safe: this.dead <= 0 && !this.won && this.bannerT > 2.5,
      bossActive: false,
      segment: this.ship || this.shmupState === 'in' ? 'shmup' : this.px > this.level.shmup.startCol * TILE - 200 && this.shmupState === 'before' ? 'shmup' : 'platform',
    };
  }

  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  onChaosStart(ev: ActiveEvent): void {
    if (ev.def.flags.includes('giant') || ev.extraFlags.includes('giant')) this.resize(true);
  }
  onChaosEnd(ev: ActiveEvent): void {
    if (ev.def.flags.includes('giant') || ev.extraFlags.includes('giant')) this.resize(false);
    if (ev.def.flags.includes('gravity_flip')) {
      this.vy = 0;
      // Fairness: if there is no floor under the player when gravity returns, put them back on safe ground.
      const tx = Math.floor((this.px + this.pw / 2) / TILE);
      let floor = false;
      for (let ty = Math.floor((this.py + this.ph) / TILE); ty < ROWS; ty++) {
        const c = this.tileAt(tx, ty);
        if (c === '^') break;
        if (this.isSolid(c) || c === '=' || c === 'B' || c === 'b') { floor = true; break; }
      }
      if (!floor) {
        this.px = this.safeX;
        this.py = this.safeY;
        this.popups.add(this.px, this.py - 10, 'REALITY RESTORED', '#3fe0ff');
      }
    }
  }

  /** Change hitbox size while guaranteeing the player is never left inside a wall. */
  private resize(big: boolean): void {
    const nw = big ? 20 : 10;
    const nh = big ? 44 : 22;
    const cx = this.px + this.pw / 2;
    const bottom = this.py + this.ph;
    let nx = cx - nw / 2;
    let ny = bottom - nh;
    for (let tries = 0; tries < 6 && this.overlapsSolid(nx, ny, nw, nh); tries++) ny -= 8;
    if (this.overlapsSolid(nx, ny, nw, nh)) {
      nx = cx - nw / 2;
      ny = bottom - nh;
      if (big) return; // not enough room to grow here; the event plays out cosmetically
    }
    this.px = nx;
    this.py = ny;
    this.pw = nw;
    this.ph = nh;
  }
  private overlapsSolid(x: number, y: number, w: number, h: number): boolean {
    for (let ty = Math.floor(y / TILE); ty <= Math.floor((y + h - 1) / TILE); ty++)
      for (let tx = Math.floor(x / TILE); tx <= Math.floor((x + w - 1) / TILE); tx++) if (this.isSolid(this.tileAt(tx, ty))) return true;
    return false;
  }

  // ---- update ---------------------------------------------------------------
  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    this.bannerT += dt;
    this.tickShared(dt);
    for (const p of this.pickups) p.t += dt;
    if (this.won) {
      this.winT += dt;
      if (this.winT > 1.6) this.finish(true, this.winScore);
      return;
    }

    if (this.dead > 0) {
      this.dead -= dt;
      if (this.dead <= 0) this.respawnAfterDefeat();
      return;
    }
    const { phase } = this.beatPhase();
    if (phase !== this.lastBeatPhase) {
      this.lastBeatPhase = phase;
      if (this.fusion.has('beat_platforms')) this.particles.emit(this.px + this.pw / 2, this.py + this.ph, 2, phase ? '#3fe0ff' : '#ff3fa4', 20, 0.3, 1, 0);
    }

    this.updateShmupTransitions();
    if (this.ship) this.updateShip(dt);
    else this.updatePlatformer(dt, phase);

    this.iframes = Math.max(0, this.iframes - dt);
    this.attackT = Math.max(0, this.attackT - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.energyT += dt;
    if (this.energyT > 1.1) {
      this.energyT = 0;
      this.energy = Math.min(this.stats.energy, this.energy + 1);
    }
    this.squash = approach(this.squash, 1, dt * 4);

    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updatePickups();

    // Camera
    if (this.shmupState === 'in') {
      this.camX += 70 * dt;
    } else {
      const target = this.px + this.pw / 2 - W / 2 + this.facing * 40;
      this.camX += (target - this.camX) * Math.min(1, dt * 5);
    }
    this.camX = clamp(this.camX, 0, this.level.width * TILE - W);

    // Exit
    if (!this.ship && Math.abs(this.px + this.pw / 2 - (this.exitX + 8)) < 14 && Math.abs(this.py + this.ph - (this.exitY + 16)) < 24) this.win();
  }

  private updateShmupTransitions(): void {
    const sm = this.level.shmup;
    const startX = sm.startCol * TILE;
    const endX = sm.endCol * TILE;
    if (this.shmupState === 'before' && this.px > startX + 8) {
      this.shmupState = 'in';
      this.ship = true;
      this.director.clearAll();
      if (this.pw !== 10) this.resize(false);
      this.pw = 14;
      this.ph = 10;
      this.py = 7 * TILE;
      this.vx = this.vy = 0;
      this.camX = Math.max(this.camX, startX - 40);
      this.game.genreShift('PLATFORMER', 'SHMUP', PAL.shmup.accent);
      this.game.audio.play('shmup');
      this.waveT = 1.5;
      this.resetHint();
    }
    if (this.shmupState === 'in' && this.camX + W >= endX + 40) {
      this.shmupState = 'after';
      this.ship = false;
      this.pw = 10;
      this.ph = 22;
      this.px = endX + 24;
      this.py = 2 * TILE;
      this.vx = 0;
      this.vy = 0;
      this.safeX = this.checkX = this.px;
      this.safeY = this.checkY = 12 * TILE - 22 + 16;
      this.game.genreShift('SHMUP', 'PLATFORMER', PAL.rampage.accent);
      this.game.audio.play('rampage');
      for (const e of this.enemies) if (e.kind === 'drone') e.alive = false;
    }
  }

  private updatePlatformer(dt: number, phase: number): void {
    const inp = this.game.input;
    const g = this.gsign;
    const lowG = this.director.flag('low_gravity');
    const grav = GRAV * (lowG ? 0.45 : 1) * g;
    const ax = inp.axisX();
    const speed = RUN * (this.giant ? 1.15 : 1);
    this.vx = approach(this.vx, ax * speed, (this.onGround ? 900 : 600) * dt);
    if (ax !== 0) this.facing = ax;

    this.coyote = this.onGround ? 0.1 : Math.max(0, this.coyote - dt);
    this.jumpBuf = inp.pressed('jump') ? 0.12 : Math.max(0, this.jumpBuf - dt);
    if (this.onGround) this.airJumps = this.game.profile.abilities.includes('double_jump') || this.game.profile.character === 'demo' ? 1 : 0;

    if (this.jumpBuf > 0 && (this.coyote > 0 || this.airJumps > 0)) {
      let v = JUMP_V * (this.giant ? 1.15 : 1);
      if (this.coyote <= 0) this.airJumps--;
      // NOTE HIGHWAY FLOOR: jumping exactly on the beat is a SUPER JUMP.
      if (this.director.flag('note_floor') && this.onGround) {
        const beat = this.game.audio.musicTime() * this.game.audio.bpm / 60;
        const off = Math.abs(beat - Math.round(beat)) * 60 / this.game.audio.bpm;
        if (off < 0.12) {
          v *= 1.3;
          this.popups.add(this.px, this.py - 6, 'ON BEAT!', '#ff3fd2');
          this.addBits(3);
          this.director.feed(4);
          this.game.audio.sfx('perfect');
        }
      }
      this.vy = -v * g;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuf = 0;
      this.squash = 1.3;
      this.game.audio.sfx('jump');
    }
    // Variable jump height
    if (!inp.held('jump') && this.vy * g < -120) this.vy = -120 * g;
    this.vy += grav * dt;
    const maxFall = 420;
    this.vy = clamp(this.vy, -maxFall, maxFall);

    // Attack (melee) & blaster
    if (inp.pressed('attack') && this.attackCd <= 0) {
      this.attackT = 0.16;
      this.attackCd = 0.28;
      this.game.audio.sfx('hit', 1.4);
      this.meleeHit();
    }
    if (inp.pressed('special') && this.energy > 0) {
      this.energy--;
      const up = inp.held('up');
      this.shots.push({
        x: this.px + this.pw / 2 + (up ? 0 : this.facing * 8), y: this.py + this.ph * 0.4,
        vx: up ? 0 : this.facing * 320, vy: up ? -320 : 0, friendly: true, life: 1.2, bounces: 0, alive: true,
      });
      this.game.audio.sfx('shoot');
    }

    this.moveX(this.vx * dt);
    const wasGround = this.onGround;
    this.moveY(this.vy * dt, phase);
    if (g < 0 && this.py < 0) {
      // Upside-down: the top of the world acts as a ceiling you can walk on.
      this.py = 0;
      this.vy = 0;
      this.onGround = true;
    }
    if (!wasGround && this.onGround) {
      this.squash = 0.75;
      this.game.audio.sfx('land');
      this.stompChain = 0;
    }
    if (this.onGround) {
      // Remember safe footing (solid ground only, not timed platforms).
      const fx = Math.floor((this.px + this.pw / 2) / TILE);
      const fy = g > 0 ? Math.floor((this.py + this.ph + 1) / TILE) : Math.floor((this.py - 1) / TILE);
      if (this.tileAt(fx, fy) === '#' && this.tileAt(fx - 1, fy) === '#' && this.tileAt(fx + 1, fy) === '#' && g > 0) {
        this.safeX = this.px;
        this.safeY = this.py;
      }
    }

    // Hazards
    if (this.touchesTile('^')) this.hurt(1, true);
    if (this.py > ROWS * TILE + 24 || this.py < -60) {
      this.hurt(1, false);
      if (this.hp > 0) {
        this.px = this.safeX;
        this.py = this.safeY - (this.ph - 22);
        this.vx = this.vy = 0;
        this.director.clearAll();
      }
    }
  }

  private touchesTile(c: string): boolean {
    const x0 = Math.floor((this.px + 2) / TILE), x1 = Math.floor((this.px + this.pw - 3) / TILE);
    const y0 = Math.floor((this.py + 2) / TILE), y1 = Math.floor((this.py + this.ph - 1) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.tileAt(tx, ty) === c) return true;
    return false;
  }

  private moveX(dx: number): void {
    this.px += dx;
    const y0 = Math.floor(this.py / TILE), y1 = Math.floor((this.py + this.ph - 1) / TILE);
    if (dx > 0) {
      const tx = Math.floor((this.px + this.pw - 1) / TILE);
      for (let ty = y0; ty <= y1; ty++) if (this.isSolid(this.tileAt(tx, ty))) { this.px = tx * TILE - this.pw; this.vx = 0; break; }
    } else if (dx < 0) {
      const tx = Math.floor(this.px / TILE);
      for (let ty = y0; ty <= y1; ty++) if (this.isSolid(this.tileAt(tx, ty))) { this.px = (tx + 1) * TILE; this.vx = 0; break; }
    }
    this.px = Math.max(this.camX - 4, this.px);
  }

  private moveY(dy: number, phase: number): void {
    const g = this.gsign;
    const prevTop = this.py;
    const prevBottom = this.py + this.ph;
    this.py += dy;
    this.onGround = false;
    const x0 = Math.floor((this.px + 1) / TILE), x1 = Math.floor((this.px + this.pw - 2) / TILE);
    if (dy > 0) {
      const ty = Math.floor((this.py + this.ph - 1) / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        const c = this.tileAt(tx, ty);
        const oneWay = g > 0 && this.isPlatform(c, phase) && prevBottom <= ty * TILE + 1;
        if (this.isSolid(c) || oneWay) {
          if (g < 0 && c === '?') this.breakBlock(tx, ty);
          this.py = ty * TILE - this.ph;
          if (g > 0) this.onGround = true;
          this.vy = 0;
          break;
        }
      }
    } else if (dy < 0) {
      const ty = Math.floor(this.py / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        const c = this.tileAt(tx, ty);
        const oneWay = g < 0 && this.isPlatform(c, phase) && prevTop >= (ty + 1) * TILE - 1;
        if (this.isSolid(c) || oneWay) {
          if (g > 0 && c === '?') this.breakBlock(tx, ty);
          this.py = (ty + 1) * TILE;
          if (g < 0) this.onGround = true;
          this.vy = 0;
          break;
        }
      }
    }
  }

  private breakBlock(tx: number, ty: number): void {
    if (this.tiles[ty][tx] !== '?') return;
    this.tiles[ty][tx] = '.';
    this.particles.burst(tx * TILE + 8, ty * TILE + 8, ['#c98b4a', '#ffcf3f', '#fff'], 18, 90);
    this.popups.add(tx * TILE + 8, ty * TILE, 'SECRET!', '#3fe0ff');
    this.addBits(5);
    this.game.audio.sfx('unlock');
    this.director.feed(8);
  }

  private meleeHit(): void {
    const reach = this.giant ? 26 : 16;
    const hx = this.facing > 0 ? this.px + this.pw : this.px - reach;
    const hy = this.py + 2;
    const hh = this.ph - 4;
    for (const e of this.enemies) {
      if (!e.alive || e.kind === 'rock') continue;
      if (hx < e.x + e.w && hx + reach > e.x && hy < e.y + e.h && hy + hh > e.y) this.damageEnemy(e, (this.giant ? 2 : 1) * this.stats.power * this.damageMult, this.facing);
    }
    // Melee can also crack secret blocks.
    const tx = Math.floor((hx + reach / 2) / TILE);
    for (let ty = Math.floor(hy / TILE); ty <= Math.floor((hy + hh) / TILE); ty++) if (this.tileAt(tx, ty) === '?') this.breakBlock(tx, ty);
  }

  private damageEnemy(e: Enemy, dmg: number, dir: number): void {
    e.hp -= dmg;
    e.flash = 0.12;
    e.vx += dir * 60;
    this.game.audio.sfx('hit');
    this.game.fx.freeze(0.03);
    if (e.hp <= 0) {
      e.alive = false;
      this.particles.burst(e.x + e.w / 2, e.y + e.h / 2, ['#ff3fa4', '#ffcf3f', '#fff'], 14, 100);
      const value = e.kind === 'turret' ? 8 : e.kind === 'rock' ? 2 : 4;
      this.addBits(value, e.x + e.w / 2, e.y);
      this.runXp += 3;
      this.director.feed(this.onGround ? 3 : 6); // airborne kills are stylish
      this.game.fx.shake(2);
    }
  }

  private hurt(n: number, knock: boolean): void {
    if (this.iframes > 0 || this.dead > 0) return;
    this.hp -= n;
    this.iframes = 1.2;
    this.noteDamage(n);
    if (knock) {
      this.vy = -220 * this.gsign;
      this.vx = -this.facing * 120;
    }
    if (this.hp <= 0) {
      this.dead = 1.4;
      this.particles.burst(this.px + this.pw / 2, this.py + this.ph / 2, ['#ff3fa4', '#20c4b0', '#f2c49b', '#fff'], 40, 160);
      this.game.audio.sfx('explode');
      this.director.clearAll();
    }
  }

  private respawnAfterDefeat(): void {
    this.continues++;
    if (this.continues > 3) {
      this.finish(false, this.runBits * 10);
      return;
    }
    // Recovery: respawn at the last checkpoint, pay a small bit toll.
    const toll = Math.floor(this.runBits * 0.2);
    this.runBits -= toll;
    this.game.toast(`CONTINUE ${this.continues}/3`, toll ? `-${toll} BITS TOLL` : 'FREE OF CHARGE', '#ff6f3f');
    this.hp = this.stats.maxHp;
    this.pw = 10;
    this.ph = 22;
    this.px = this.checkX;
    this.py = this.checkY;
    this.vx = this.vy = 0;
    this.iframes = 2;
    if (this.shmupState === 'in') {
      // Defeated mid-shmup: skip ahead to the landing to keep things moving.
      this.camX = this.level.shmup.endCol * TILE - W + 41;
    }
  }

  // ---- SHMUP segment -----------------------------------------------------------
  private updateShip(dt: number): void {
    const inp = this.game.input;
    const sp = 140;
    this.px += inp.axisX() * sp * dt + 70 * dt;
    this.py += inp.axisY() * sp * dt;
    this.px = clamp(this.px, this.camX + 6, this.camX + W - 30);
    this.py = clamp(this.py, TILE + 2, (ROWS - 1) * TILE - this.ph - 2);
    this.facing = 1;
    this.shipFire -= dt;
    if ((inp.held('attack') || inp.held('special')) && this.shipFire <= 0) {
      this.shipFire = 0.14;
      this.shots.push({ x: this.px + this.pw, y: this.py + 4, vx: 380, vy: 0, friendly: true, life: 1.4, bounces: 0, alive: true });
      if (this.energy > 0 && inp.held('special')) {
        // Spread shot uses energy.
        this.energy -= 0.25;
        this.shots.push({ x: this.px + this.pw, y: this.py + 4, vx: 360, vy: -90, friendly: true, life: 1.2, bounces: 0, alive: true });
        this.shots.push({ x: this.px + this.pw, y: this.py + 4, vx: 360, vy: 90, friendly: true, life: 1.2, bounces: 0, alive: true });
      }
      this.game.audio.sfx('shoot', 1.2);
    }
    // Waves of drones in seeded formations.
    this.waveT -= dt;
    if (this.waveT <= 0) {
      this.waveT = 2.4 / this.diffMult;
      const n = this.rng.int(3, 5);
      const yBase = this.rng.int(3, 11) * TILE;
      const pattern = this.rng.int(0, 2);
      for (let i = 0; i < n; i++) {
        const e = this.mkEnemy('drone', this.camX + W + 10 + i * 22, yBase + (pattern === 1 ? i * 10 - 20 : 0));
        e.baseY = e.y;
        e.vx = -90 - this.rng.int(0, 30);
        e.t = i * 0.5;
        e.dir = pattern;
        this.enemies.push(e);
      }
    }
    this.particles.emit(this.px, this.py + 5, 1, '#3fffcf', 30, 0.3, 2, 0);
  }

  // ---- enemies / shots / pickups -------------------------------------------------
  private updateEnemies(dt: number): void {
    const reverse = this.director.flag('reverse') ? -1 : 1;
    const karts = this.director.flag('enemies_racers');
    const pcx = this.px + this.pw / 2;
    const pcy = this.py + this.ph / 2;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // Sleep far-away enemies (bounded work per frame).
      if (e.x < this.camX - 120 || e.x > this.camX + W + 120) continue;
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);
      switch (e.kind) {
        case 'walker': {
          const spd = (karts ? 150 : 30) * this.diffMult ** 0.5;
          e.vx = approach(e.vx, e.dir * spd * reverse, 300 * dt);
          const nx = e.x + e.vx * dt;
          const ahead = e.vx > 0 ? nx + e.w : nx;
          const footY = Math.floor((e.y + e.h + 2) / TILE);
          const tx = Math.floor(ahead / TILE);
          const wall = this.isSolid(this.tileAt(tx, Math.floor((e.y + e.h - 2) / TILE)));
          const floor = this.tileAt(tx, footY);
          const ledge = !(this.isSolid(floor) || floor === '=' || floor === 'B' || floor === 'b');
          if (wall || (ledge && !karts)) e.dir *= -1;
          else e.x = nx;
          if (karts && ledge) e.y += 0; // karts fly off ledges into the void
          break;
        }
        case 'flyer': {
          const toward = Math.sign(pcx - e.x) * reverse;
          e.x += toward * 35 * dt;
          e.y = e.baseY + Math.sin(e.t * 2.5) * 20;
          break;
        }
        case 'turret': {
          e.cd -= dt;
          if (e.cd <= 0 && Math.abs(pcx - e.x) < 260) {
            e.cd = 2.2 / this.diffMult;
            const a = Math.atan2(pcy - (e.y + 4), pcx - (e.x + 7));
            this.shots.push({ x: e.x + 7, y: e.y + 4, vx: Math.cos(a) * 130 * reverse, vy: Math.sin(a) * 130 * reverse, friendly: false, life: 3, bounces: 0, alive: true });
            this.game.audio.sfx('shoot', 0.6);
          }
          break;
        }
        case 'drone': {
          e.x += e.vx * dt * reverse;
          e.y = e.baseY + (e.dir === 0 ? Math.sin(e.t * 3) * 24 : e.dir === 2 ? Math.cos(e.t * 2) * 40 : 0);
          e.cd -= dt;
          if (e.cd <= 0) {
            e.cd = 2.5 + this.rng.next() * 2;
            this.shots.push({ x: e.x, y: e.y + 5, vx: -150, vy: (pcy - e.y) * 0.4, friendly: false, life: 3, bounces: 0, alive: true });
          }
          if (e.x < this.camX - 40) e.alive = false;
          break;
        }
        case 'rock':
          break;
      }
      // Contact
      const overlap = this.px < e.x + e.w && this.px + this.pw > e.x && this.py < e.y + e.h && this.py + this.ph > e.y;
      if (overlap && this.dead <= 0) {
        const g = this.gsign;
        const stomp = !this.ship && e.kind !== 'turret' && e.kind !== 'rock' && this.vy * g > 40 && (g > 0 ? this.py + this.ph - e.y < 10 : e.y + e.h - this.py < 10);
        if (stomp) {
          this.damageEnemy(e, 99, 0);
          this.vy = -260 * g;
          this.stompChain++;
          this.director.feed(4 + this.stompChain * 2);
          if (this.stompChain > 1) this.popups.add(e.x, e.y - 8, `CHAIN x${this.stompChain}`, '#ff3fd2');
          if (karts) {
            this.popups.add(e.x, e.y - 16, 'NITRO!', '#3fe0ff');
            this.vx = this.facing * 260;
          }
        } else if (this.giant && e.kind !== 'rock') {
          this.damageEnemy(e, 99, this.facing);
        } else {
          this.hurt(1, true);
        }
      }
    }
    // Keep the array bounded: drop dead drones.
    if (this.enemies.length > 200) this.enemies = this.enemies.filter((e) => e.alive || e.kind !== 'drone');
  }

  private updateShots(dt: number): void {
    const bouncy = this.director.flag('bouncy');
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.life -= dt;
      if (s.life <= 0) { s.alive = false; continue; }
      if (bouncy && !this.ship) s.vy += 300 * dt;
      const nx = s.x + s.vx * dt;
      const ny = s.y + s.vy * dt;
      const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
      const c = this.tileAt(tx, ty);
      if (this.isSolid(c)) {
        if (c === '?' && s.friendly) this.breakBlock(tx, ty);
        if (bouncy && s.bounces < 4) {
          s.bounces++;
          if (this.isSolid(this.tileAt(Math.floor(s.x / TILE), ty))) s.vy = -s.vy * 0.9; else s.vx = -s.vx;
          this.game.audio.sfx('select', 0.5 + s.bounces * 0.2);
          continue;
        }
        s.alive = false;
        this.particles.emit(s.x, s.y, 4, s.friendly ? '#3fffcf' : '#ff3f3f', 40, 0.2, 1, 0);
        continue;
      }
      s.x = nx;
      s.y = ny;
      if (s.friendly) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (s.x > e.x && s.x < e.x + e.w && s.y > e.y - 2 && s.y < e.y + e.h + 2) {
            this.damageEnemy(e, this.stats.power * this.damageMult, Math.sign(s.vx));
            s.alive = false;
            break;
          }
        }
        // TRICK SHOT: shots flip switches.
        if (s.alive && this.fusion.has('shots_trigger_switches')) {
          for (const p of this.pickups) {
            if (p.kind === 'switch' && !p.taken && Math.abs(s.x - p.x) < 10 && Math.abs(s.y - p.y) < 14) {
              p.taken = true;
              s.alive = false;
              this.gatesOpen = true;
              this.game.audio.sfx('door');
              this.game.fx.flash('#3fffcf', 0.3);
              this.popups.add(p.x, p.y - 10, 'GATE OPEN!', '#3fffcf');
              this.director.feed(10);
            }
          }
        }
      } else {
        const hit = s.x > this.px && s.x < this.px + this.pw && s.y > this.py && s.y < this.py + this.ph;
        if (hit) {
          s.alive = false;
          this.hurt(1, false);
        }
      }
      if (s.x < this.camX - 40 || s.x > this.camX + W + 40) s.alive = false;
    }
    if (this.shots.length > 64) this.shots = this.shots.filter((s) => s.alive);
  }

  private updatePickups(): void {
    const magnet = this.game.profile.abilities.includes('magnet');
    const cx = this.px + this.pw / 2, cy = this.py + this.ph / 2;
    for (const p of this.pickups) {
      if (p.taken || p.kind === 'switch') continue;
      if (magnet && p.kind === 'bit') {
        const d = Math.hypot(cx - p.x, cy - p.y);
        if (d < 60) {
          p.x += (cx - p.x) * 0.12;
          p.y += (cy - p.y) * 0.12;
        }
      }
      const r = p.kind === 'checkpoint' ? 12 : 10;
      if (Math.abs(cx - p.x) < this.pw / 2 + r && Math.abs(cy - p.y) < this.ph / 2 + r) {
        switch (p.kind) {
          case 'bit': p.taken = true; this.addBits(2); this.game.audio.sfx('coin'); break;
          case 'floppy': p.taken = true; this.collectFloppy(p.index); this.particles.burst(p.x, p.y, ['#3fe0ff', '#fff'], 20, 80); break;
          case 'heart': p.taken = true; this.heal(2); this.game.audio.sfx('powerup'); this.popups.add(p.x, p.y, '+♥♥', '#ff3f6b'); break;
          case 'chaos': {
            const ev = this.director.trigger(this.directorContext());
            if (ev) {
              p.taken = true;
              this.popups.add(p.x, p.y - 10, 'CHAOS SUMMONED', '#ff3fa4');
              this.game.audio.sfx('chaos');
              this.addBits(10);
            }
            break;
          }
          case 'checkpoint':
            if (!p.taken) {
              p.taken = true;
              this.checkX = p.x - 5;
              this.checkY = p.y - 22;
              this.heal(1);
              this.popups.add(p.x, p.y - 30, 'CHECKPOINT', '#7dff6b');
              this.game.audio.sfx('powerup');
            }
            break;
        }
      }
    }
  }

  private win(): void {
    this.won = true;
    this.game.audio.sfx('levelup');
    this.particles.burst(this.exitX + 8, this.exitY, ['#ffcf3f', '#ff3fa4', '#3fe0ff', '#7dff6b'], 60, 160);
    this.winScore = this.runBits * 10 + Math.max(0, 3000 - Math.floor(this.time * 15)) + this.foundFloppies.length * 500 + this.hp * 200;
  }

  // ---- draw ---------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const inShmup = this.shmupState === 'in';
    const pal = inShmup ? PAL.shmup : PAL.rampage;
    const camX = Math.round(this.camX);
    this.drawBackground(ctx, pal, camX, inShmup);
    const { phase, warn } = this.beatPhase();
    const noteFloor = this.director.flag('note_floor');
    const x0 = Math.floor(camX / TILE) - 1, x1 = x0 + Math.ceil(W / TILE) + 2;
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const c = this.tileAt(tx, ty);
        if (c === '.') continue;
        const sx = tx * TILE - camX, sy = ty * TILE;
        this.drawTile(ctx, c, sx, sy, tx, ty, phase, warn, noteFloor, inShmup);
      }
    }
    // Exit cabinet
    {
      const ex = this.exitX - camX, ey = this.exitY;
      rect(ctx, ex - 4, ey - 16, 24, 32, '#1d1233');
      rect(ctx, ex - 2, ey - 14, 20, 12, `hsl(${(this.time * 120) % 360},90%,60%)`);
      drawText(ctx, 'EXIT', ex + 8, ey - 26, '#fff', { align: 'center' });
    }
    // Pickups
    for (const p of this.pickups) {
      if (p.taken && p.kind !== 'switch' && p.kind !== 'checkpoint') continue;
      const sx = p.x - camX;
      if (sx < -20 || sx > W + 20) continue;
      switch (p.kind) {
        case 'bit': drawBit(ctx, sx, p.y, p.t); break;
        case 'floppy': drawFloppy(ctx, sx, p.y, p.t); break;
        case 'heart': drawHeart(ctx, sx, p.y + Math.sin(p.t * 3) * 2); break;
        case 'chaos': {
          const r = 6 + Math.sin(p.t * 6) * 2;
          rect(ctx, sx - r, p.y - r, r * 2, r * 2, `hsl(${(p.t * 200) % 360},100%,60%)`);
          drawText(ctx, '?', sx, p.y - 3, '#000', { align: 'center', shadow: null });
          break;
        }
        case 'checkpoint':
          rect(ctx, sx - 1, p.y - 28, 2, 28, '#ddd');
          rect(ctx, sx + 1, p.y - 28, 12, 8, p.taken ? '#7dff6b' : '#888');
          break;
        case 'switch': {
          rect(ctx, sx - 6, p.y - 7, 12, 14, '#333');
          rect(ctx, sx - 4, p.y - 5, 8, 10, p.taken ? '#3fffcf' : (Math.floor(p.t * 3) % 2 ? '#ff3f3f' : '#a02020'));
          if (!p.taken) drawText(ctx, 'SHOOT', sx, p.y - 18, '#3fffcf', { align: 'center' });
          break;
        }
      }
    }
    // Enemies
    const karts = this.director.flag('enemies_racers');
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const sx = e.x - camX;
      if (sx < -30 || sx > W + 30) continue;
      this.drawEnemy(ctx, e, sx, karts);
    }
    // Shots
    for (const s of this.shots) {
      if (!s.alive) continue;
      const sx = s.x - camX;
      if (this.director.flag('bouncy')) {
        rect(ctx, sx - 3, s.y - 3, 6, 6, s.friendly ? '#7dff6b' : '#ff7af5');
        rect(ctx, sx - 1, s.y - 2, 1, 1, '#000');
        rect(ctx, sx + 1, s.y - 2, 1, 1, '#000');
      } else {
        rect(ctx, sx - 3, s.y - 1, 6, 3, s.friendly ? '#3fffcf' : '#ff3f3f');
        rect(ctx, sx - 1, s.y, 2, 1, '#fff');
      }
    }
    // Player
    if (this.dead <= 0 && !(this.iframes > 0 && Math.floor(this.time * 20) % 2)) {
      const cx = this.px + this.pw / 2 - camX;
      if (this.ship) this.drawShip(ctx, cx, this.py + this.ph / 2);
      else {
        const pose: Pose = this.attackT > 0 ? 'attack' : !this.onGround ? 'jump' : Math.abs(this.vx) > 10 ? 'run' : 'idle';
        const g = this.gsign;
        ctx.save();
        if (g < 0) {
          ctx.translate(0, this.py * 2 + this.ph);
          ctx.scale(1, -1);
        }
        drawCass(ctx, { x: cx, y: this.py + this.ph, facing: this.facing, pose, t: this.time, squash: this.squash, scale: this.giant ? 2 : 1 }, this.game.profile.character);
        ctx.restore();
        if (this.attackT > 0) {
          const reach = this.giant ? 26 : 16;
          const ax = this.facing > 0 ? this.px + this.pw - camX : this.px - reach - camX;
          ctx.globalAlpha = 0.7;
          rect(ctx, ax, this.py + this.ph * 0.3, reach, 3, '#fff');
          rect(ctx, ax + 2, this.py + this.ph * 0.3 - 3, reach - 4, 2, '#ffcf3f');
          ctx.globalAlpha = 1;
        }
      }
    }
    this.particles.draw(ctx, camX, 0);
    this.popups.draw(ctx, camX, 0);
    this.drawHud(ctx, pal);
  }

  private drawBackground(ctx: CanvasRenderingContext2D, pal: typeof PAL.rampage, camX: number, shmup: boolean): void {
    if (shmup) {
      rect(ctx, 0, 0, W, H, pal.bg0);
      for (let i = 0; i < 80; i++) {
        const sp = (i % 3) + 1;
        const x = ((i * 137 - camX * sp * 0.3) % W + W) % W;
        rect(ctx, x, (i * 59) % H, sp, 1, i % 7 ? '#ffffff88' : pal.accent2);
      }
      return;
    }
    // Sky bands (limited palette, no gradients — very 16-bit)
    const bands = [pal.bg0, '#4a6fe0', '#5a85ea', pal.bg1, '#8ab8ff', pal.bg2];
    bands.forEach((c, i) => rect(ctx, 0, i * 30, W, 30, c));
    rect(ctx, 0, 180, W, H - 180, pal.bg2);
    // Sun and distant mountains (slowest parallax layer).
    rect(ctx, 372, 26, 28, 28, '#fff3b0');
    rect(ctx, 376, 22, 20, 36, '#fff3b0');
    rect(ctx, 368, 30, 36, 20, '#fff3b0');
    for (let x = 0; x < W; x += 4) {
      const wx = x + camX * 0.08;
      const peak = 62 + Math.abs(Math.sin(wx * 0.011)) * 46 + Math.sin(wx * 0.047) * 4;
      rect(ctx, x, 190 - peak, 4, peak + 80, '#93b4f4');
      if (peak > 96) rect(ctx, x, 190 - peak, 4, 4, '#ffffff');
    }
    // Far hills
    for (let x = 0; x < W; x += 4) {
      const wx = x + camX * 0.2;
      const hgt = 40 + Math.sin(wx * 0.013) * 18 + Math.sin(wx * 0.031) * 8;
      rect(ctx, x, 200 - hgt, 4, hgt + 70, '#7a9cf0');
    }
    for (let x = 0; x < W; x += 4) {
      const wx = x + camX * 0.45;
      const hgt = 28 + Math.sin(wx * 0.02 + 1) * 14;
      rect(ctx, x, 222 - hgt, 4, hgt + 50, '#5ab06a');
      rect(ctx, x, 222 - hgt, 4, 2, '#7fd08a');
      // Pine silhouettes riding the near hills.
      if (Math.floor(wx / 4) % 11 === 0) {
        rect(ctx, x, 222 - hgt - 6, 4, 6, '#2f7a45');
        rect(ctx, x - 2, 222 - hgt - 2, 8, 3, '#2f7a45');
        rect(ctx, x + 1, 222 - hgt - 10, 2, 4, '#2f7a45');
      }
    }
    // Clouds
    for (let i = 0; i < 6; i++) {
      const x = ((i * 130 - camX * 0.1 + this.time * 6) % (W + 80) + W + 80) % (W + 80) - 40;
      const y = 20 + (i * 37) % 70;
      rect(ctx, x, y, 34, 8, '#ffffff');
      rect(ctx, x + 6, y - 5, 18, 6, '#ffffff');
    }
  }

  private drawTile(ctx: CanvasRenderingContext2D, c: string, sx: number, sy: number, tx: number, ty: number, phase: number, warn: boolean, noteFloor: boolean, shmup: boolean): void {
    switch (c) {
      case '#':
      case '?': {
        if (shmup) {
          rect(ctx, sx, sy, TILE, TILE, '#2b1866');
          rect(ctx, sx, sy, TILE, 1, '#5a3fb0');
          break;
        }
        const top = this.tileAt(tx, ty - 1) !== '#' && this.tileAt(tx, ty - 1) !== '?';
        rect(ctx, sx, sy, TILE, TILE, (tx + ty) % 2 ? '#a0603a' : '#b06a40');
        rect(ctx, sx + 3, sy + 9, 2, 2, '#7a4428');
        rect(ctx, sx + 11, sy + 4, 2, 2, '#7a4428');
        // Depth shading: dirt darkens toward the bottom, and open sides catch light.
        rect(ctx, sx, sy + TILE - 3, TILE, 3, 'rgba(0,0,0,0.14)');
        if (this.tileAt(tx - 1, ty) !== '#' && this.tileAt(tx - 1, ty) !== '?') rect(ctx, sx, sy, 1, TILE, 'rgba(255,255,255,0.18)');
        if (top) {
          let grass = '#4fe07a';
          if (noteFloor) {
            const lane = Math.floor(tx % 4);
            const beat = this.game.audio.musicTime() * this.game.audio.bpm / 60;
            const pulse = 1 - (beat % 1);
            grass = ['#ff3fd2', '#3fffe0', '#ffcf3f', '#7dff6b'][lane];
            ctx.globalAlpha = 0.4 + pulse * 0.6;
          }
          rect(ctx, sx, sy, TILE, 4, grass);
          rect(ctx, sx, sy + 4, TILE, 1, '#2a8a4a');
          ctx.globalAlpha = 1;
        }
        if (c === '?') {
          rect(ctx, sx + 6, sy + 5, 1, 6, '#5a3020');
          rect(ctx, sx + 7, sy + 8, 3, 1, '#5a3020');
        }
        break;
      }
      case '=':
        rect(ctx, sx, sy, TILE, 5, '#ffcf3f');
        rect(ctx, sx, sy + 5, TILE, 2, '#a07a10');
        break;
      case 'B':
      case 'b': {
        const mine = c === 'B' ? 0 : 1;
        const on = phase === mine;
        const col = c === 'B' ? '#ff3fd2' : '#3fffe0';
        if (on) {
          const blink = warn && Math.floor(this.time * 16) % 2 === 0;
          rect(ctx, sx, sy, TILE, 6, blink ? '#ffffff' : col);
          rect(ctx, sx + 2, sy + 2, TILE - 4, 2, '#ffffff88');
        } else {
          ctx.globalAlpha = 0.35;
          for (let i = 0; i < TILE; i += 4) rect(ctx, sx + i, sy, 2, 1, col);
          for (let i = 0; i < TILE; i += 4) rect(ctx, sx + i + 2, sy + 5, 2, 1, col);
          ctx.globalAlpha = 1;
        }
        break;
      }
      case '^':
        for (let i = 0; i < 4; i++) {
          rect(ctx, sx + i * 4 + 1, sy + 8, 3, 8, '#ccd');
          rect(ctx, sx + i * 4 + 2, sy + 4, 1, 4, '#eef');
        }
        break;
      case 'G':
        if (!this.gatesOpen) {
          rect(ctx, sx, sy, TILE, TILE, '#2a2a3a');
          for (let i = 1; i < TILE; i += 4) rect(ctx, sx + i, sy, 2, TILE, '#3fffcf');
        }
        break;
    }
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, sx: number, karts: boolean): void {
    const fl = e.flash > 0;
    const y = e.y;
    switch (e.kind) {
      case 'walker':
        if (karts) {
          rect(ctx, sx - 2, y + 4, e.w + 4, 6, fl ? '#fff' : '#ff3f3f');
          rect(ctx, sx, y + 9, 4, 4, '#222');
          rect(ctx, sx + e.w - 4, y + 9, 4, 4, '#222');
          rect(ctx, sx + 4, y, 6, 5, '#ffe23f');
        } else {
          // GLITCHLING: a little corrupted sprite with mismatched halves
          const step = Math.floor(e.t * 8) % 2;
          rect(ctx, sx, y + 2, e.w, e.h - 4, fl ? '#fff' : '#8a3fd9');
          rect(ctx, sx + e.w / 2, y + 2, e.w / 2, e.h - 4, fl ? '#fff' : '#3fd98a');
          rect(ctx, sx + 3, y + 4, 2, 2, '#fff');
          rect(ctx, sx + 9, y + 4, 2, 2, '#fff');
          rect(ctx, sx + 2, y + e.h - 2, 3, 2 + step, '#222');
          rect(ctx, sx + e.w - 5, y + e.h - 2, 3, 3 - step, '#222');
        }
        break;
      case 'flyer': {
        const wing = Math.floor(e.t * 10) % 2;
        rect(ctx, sx + 2, y + 2, 8, 8, fl ? '#fff' : '#2b2bd9');
        rect(ctx, sx + 4, y + 2, 4, 3, '#c0c0d0');
        rect(ctx, sx - 3, y + (wing ? 0 : 4), 5, 3, '#ff3fa4');
        rect(ctx, sx + 10, y + (wing ? 0 : 4), 5, 3, '#ff3fa4');
        break;
      }
      case 'turret':
        rect(ctx, sx, y + 4, e.w, e.h - 4, fl ? '#fff' : '#555');
        rect(ctx, sx + 4, y, 6, 6, '#ff3f3f');
        rect(ctx, sx + 5, y + 1, 2, 2, e.cd < 0.5 ? '#fff' : '#600');
        break;
      case 'drone':
        rect(ctx, sx, y + 2, e.w, 6, fl ? '#fff' : '#ff3fd2');
        rect(ctx, sx + 4, y, 6, 10, fl ? '#fff' : '#a02090');
        rect(ctx, sx + 2, y + 4, 2, 2, '#ffe23f');
        break;
      case 'rock':
        rect(ctx, sx + 1, y + 1, 14, 14, fl ? '#fff' : '#6a5a7a');
        rect(ctx, sx + 3, y + 3, 4, 4, '#857596');
        rect(ctx, sx + 9, y + 9, 3, 3, '#4a3f5a');
        break;
    }
  }

  private drawShip(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    rect(ctx, x - 7, y - 3, 14, 6, '#20c4b0');
    rect(ctx, x + 4, y - 1, 6, 2, '#fff');
    rect(ctx, x - 5, y - 6, 6, 3, '#ff3fa4');
    rect(ctx, x - 5, y + 3, 6, 3, '#ff3fa4');
    rect(ctx, x - 10, y - 1, 3, 2, Math.floor(this.time * 20) % 2 ? '#ffcf3f' : '#ff6f3f');
    rect(ctx, x - 1, y - 2, 3, 2, '#f2c49b');
  }

  private drawHud(ctx: CanvasRenderingContext2D, pal: typeof PAL.rampage): void {
    rect(ctx, 0, 0, W, 20, '#0008');
    hearts(ctx, 6, 3, this.hp, this.stats.maxHp);
    for (let i = 0; i < this.stats.energy; i++) rect(ctx, 6 + i * 7, 13, 5, 4, i < Math.floor(this.energy) ? '#3fffcf' : '#234');
    drawText(ctx, `BITS ${this.runBits}`, 80, 3, '#ffcf3f');
    drawText(ctx, `DISKS ${this.foundFloppies.length}/3`, 80, 12, '#3fe0ff');
    const prog = clamp(this.px / (this.exitX || 1), 0, 1);
    rect(ctx, 170, 8, 120, 3, '#ffffff33');
    rect(ctx, 170 + this.level.shmup.startCol * TILE / (this.exitX || 1) * 120, 6, 2, 7, PAL.shmup.accent);
    rect(ctx, 168 + prog * 120, 5, 5, 9, pal.accent);
    if (this.modifier) drawText(ctx, this.modifier.name, 230, 13, '#b07aff', { align: 'center' });
    this.drawChaosHud(ctx);
    if (this.bannerT < 4) {
      const lines = this.fusion.bannerLines();
      lines.forEach((l, i) => drawText(ctx, l.text, W / 2, 60 + i * 10, l.color, { align: 'center' }));
      if (lines.length) drawText(ctx, 'ACTIVE MUTATIONS', W / 2, 48, '#fff', { align: 'center' });
    }
    if (this.dead > 0) {
      drawText(ctx, this.continues >= 3 ? 'GAME OVER' : 'OUCH! REBOOTING...', W / 2, 120, '#ff3f6b', { align: 'center', scale: 2 });
    }
    if (this.shmupState === 'in') this.drawHint(ctx, 'SHMUP! ARROWS FLY • HOLD X FIRE • HOLD C SPREAD SHOT');
    else this.drawHint(ctx, 'ARROWS MOVE • Z JUMP • X ATTACK • C BLASTER (UP+C SHOOTS UP) • ESC PAUSE');
    this.drawSeed(ctx);
  }
}
