/**
 * NEON PANIC — pseudo-3D arcade racer (original segment-projection renderer).
 *
 * Mutations honoured:
 *  - NIGHT DRIVE (racing+horror): at midnight the course becomes a horror chase.
 *    THE LURKER pursues; hesitation and crashes feed it, boosting starves it,
 *    and when close it drops shadow barriers onto the road ahead.
 *  - BASS BOOST (racing+rhythm): boosting on the beat is a stronger PERFECT boost.
 *  - DRIFT ENCOUNTERS (racing+rpg): long drifts trigger a turn-based SKILL CHECK.
 * Chaos flags honoured: fog, reverse, mecha, palette/film/vhs (global).
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import { DirectorContext } from '../chaos/director.ts';
import { generateNeon, NeonTrack, SEG_LEN, LANES, TrackObj } from '../procgen/neon.ts';
import { H, W, PAL, rect, clamp, approach, hearts, bar, glow } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';

const ROAD_W = 2000;
const CAM_H = 1000;
const DEPTH = 1 / Math.tan((100 / 2) * Math.PI / 180);
const PLAYER_Z = CAM_H * DEPTH;
const MAX_SPEED = SEG_LEN * 30;

interface Proj { x: number; y: number; w: number; scale: number; clip: number; camZ: number }

type SkillCheck = { t: number; sel: number } | null;

export class NeonMode extends ModeBase {
  gesture = 'racer' as const;
  gestureHint = 'DRAG: STEER, DOWN: BRAKE \u2022 TAP: BOOST \u2022 2ND FINGER HELD: DRIFT';
  id = 'neon';
  crt = 0.35;
  track: NeonTrack;
  pos = 0;
  px = 0; // -1..1 lateral
  speed = 0;
  hp: number;
  boost = 1; // 0..1 meter
  boostT = 0;
  drift = 0;
  drifting = false;
  steer = 0;
  rexZ = 0;
  rexX = 0.4;
  lurkerZ = -4000;
  fear = 0;
  midnight = false;
  finished = false;
  finishT = 0;
  won = false;
  skyX = 0;
  shield = false;
  skill: SkillCheck = null;
  punchT = 0;
  crashT = 0;
  heartbeatT = 0;
  readonly finishZ: number;
  private proj: Proj[] = [];
  private countdown = 3.2;
  private sabotageT = 4;
  private shadowObjs: TrackObj[] = [];

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'neon', opts);
    this.track = generateNeon(this.seed, game.settings.difficulty === 'hard' ? 1 : game.settings.difficulty === 'easy' ? 0 : 0.5);
    this.hp = this.stats.maxHp;
    this.finishZ = (this.track.length - 80) * SEG_LEN;
    if (game.profile.abilities.includes('nitro')) this.boost = 1;
    else this.boost = 0.5;
    for (let i = 0; i < 160; i++) this.proj.push({ x: 0, y: 0, w: 0, scale: 0, clip: 0, camZ: 0 });
  }

  enter(): void {
    this.game.music('neon');
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: this.countdown <= 0 && !this.finished && !this.skill, bossActive: false, segment: this.midnight ? 'night' : 'day' };
  }
  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  private seg(i: number) {
    return this.track.segments[clamp(i, 0, this.track.length - 1)];
  }

  update(rawDt: number): void {
    const dt0 = rawDt * this.speedMult;
    // A turn-based SKILL CHECK slows time to a crawl while the player picks a command.
    const dt = this.skill ? dt0 * 0.15 : dt0;
    this.tickShared(dt);
    const skillActive = !!this.skill;
    if (this.skill) this.updateSkill(dt0);
    const inp = this.game.input;

    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt0;
      if (Math.ceil(this.countdown) !== before) this.game.audio.sfx(this.countdown <= 0 ? 'boost' : 'warn');
      return;
    }
    if (this.finished) {
      this.finishT += dt0;
      this.speed = approach(this.speed, 0, MAX_SPEED * dt0 * 0.5);
      this.pos += this.speed * dt0;
      if (this.finishT > 2.2) this.end();
      return;
    }

    const mecha = this.director.flag('mecha');
    const segIdx = Math.floor((this.pos + PLAYER_Z) / SEG_LEN);
    const seg = this.seg(segIdx);
    const speedPct = this.speed / MAX_SPEED;
    const damagePenalty = 1 - 0.05 * (this.stats.maxHp - this.hp);
    let top = MAX_SPEED * damagePenalty * (mecha ? 0.8 : 1);

    // Boost
    this.boostT = Math.max(0, this.boostT - dt);
    if (!skillActive && inp.pressed('jump') && this.boost >= 0.34 && this.boostT <= 0.2) {
      this.boost -= 0.34;
      let power = 1;
      if (this.fusion.has('beat_boost')) {
        const beat = this.game.audio.musicTime() * this.game.audio.bpm / 60;
        const off = Math.abs(beat - Math.round(beat)) * 60 / this.game.audio.bpm;
        const win = this.fusion.param('beat_boost', 'windowMs', 110) / 1000;
        if (off <= win) {
          power = this.fusion.param('beat_boost', 'perfectMult', 1.6);
          this.popups.add(W / 2, H - 70, 'PERFECT BOOST!', '#ff3fd2');
          this.game.audio.sfx('perfect');
          this.director.feed(6);
        } else this.popups.add(W / 2, H - 70, 'OFF-BEAT', '#888');
      }
      this.boostT = 1.1 * power * (this.game.profile.abilities.includes('nitro') ? 1.3 : 1);
      this.game.audio.sfx('boost');
      this.fear = Math.max(0, this.fear - 0.1);
    }
    if (this.boostT > 0) top *= 1.4;
    this.boost = Math.min(1, this.boost + dt * 0.05);

    // Throttle / brake
    const gas = !inp.held('down');
    const brake = inp.held('down');
    if (gas) this.speed = approach(this.speed, top, (this.boostT > 0 ? MAX_SPEED : MAX_SPEED / 4.5) * dt);
    if (brake) this.speed = approach(this.speed, 0, MAX_SPEED * 1.2 * dt);

    // Steering & drifting (hold C while turning)
    const steerIn = inp.axisX();
    this.drifting = inp.held('special') && steerIn !== 0 && speedPct > 0.5;
    const steerRate = (this.drifting ? 3.4 : 2.4) * (mecha ? 0.7 : 1);
    this.steer = approach(this.steer, steerIn, dt * 8);
    this.px += this.steer * dt * steerRate * Math.max(0.3, speedPct);
    this.px -= seg.curve * speedPct * speedPct * dt * (this.drifting ? 0.9 : 1.6);
    if (this.drifting) {
      this.drift += dt;
      if (this.drift > 0.4) this.particles.emit(W / 2 + (Math.random() - 0.5) * 30, H - 22, 1, this.drift > 1 ? '#3fe0ff' : '#fff', 30, 0.4, 2, -40);
      if (this.fusion.has('drift_skillcheck') && this.drift > this.fusion.param('rpg_drift', 'driftNeeded', 1.4) && !this.skill) {
        this.skill = { t: 0, sel: 1 };
        this.drift = 0;
        this.game.audio.sfx('warn');
      }
    } else if (this.drift > 0) {
      if (this.drift > 0.6) {
        this.boostT = Math.max(this.boostT, Math.min(1, this.drift * 0.6));
        this.popups.add(W / 2, H - 70, this.drift > 1.2 ? 'SUPER MINI-TURBO' : 'MINI-TURBO', '#3fe0ff');
        this.game.audio.sfx('boost', 1.3);
        this.director.feed(this.drift * 4);
      }
      this.drift = 0;
    }
    // Off-road slows you down
    if (Math.abs(this.px) > 1) {
      this.speed = approach(this.speed, MAX_SPEED * 0.3, MAX_SPEED * dt);
      if (Math.random() < 0.3) this.particles.emit(W / 2, H - 20, 1, '#5ab06a', 40, 0.4, 2, 0);
    }
    this.px = clamp(this.px, -2.2, 2.2);
    this.pos += this.speed * dt;
    this.skyX += seg.curve * speedPct * dt * 30;

    // Mecha punches
    this.punchT = Math.max(0, this.punchT - dt);
    if (mecha && inp.pressed('attack') && this.punchT <= 0) {
      this.punchT = 0.3;
      this.game.audio.sfx('hit', 0.8);
      const reach = segIdx + 6;
      for (const o of this.allObjects()) {
        if (!o.taken && (o.kind === 'cone' || o.kind === 'barrier') && o.seg >= segIdx && o.seg <= reach && Math.abs(o.lane - this.px) < 0.5) {
          o.taken = true;
          this.addBits(5);
          this.popups.add(W / 2, H - 90, 'SMASH!', '#ffcf3f');
          this.game.fx.shake(3);
        }
      }
      for (const c of this.track.traffic) {
        const cs = Math.floor(c.z / SEG_LEN);
        if (cs >= segIdx && cs <= reach && Math.abs(c.lane - this.px) < 0.5) {
          c.z += SEG_LEN * 80;
          this.addBits(8);
          this.popups.add(W / 2, H - 90, 'KO!', '#ff3fa4');
        }
      }
    }

    this.collide(segIdx);
    this.updateTraffic(dt, segIdx);
    this.updateRex(dt);
    this.updateMidnight(dt, segIdx);
    this.crashT = Math.max(0, this.crashT - dt);

    if (this.pos >= this.finishZ) {
      this.finished = true;
      this.won = this.pos >= this.rexZ;
      this.game.audio.sfx(this.won ? 'levelup' : 'powerup');
      this.game.fx.flash('#fff', 0.4);
      if (this.won) this.runFlags.add('beat_rex');
    }
  }

  private allObjects(): TrackObj[] {
    return this.shadowObjs.length ? this.track.objects.concat(this.shadowObjs) : this.track.objects;
  }

  private collide(segIdx: number): void {
    for (const o of this.allObjects()) {
      if (o.taken || o.seg !== segIdx) continue;
      if (Math.abs(o.lane - this.px) > 0.3) continue;
      switch (o.kind) {
        case 'cone':
        case 'barrier':
          o.taken = true;
          this.crash(o.kind === 'barrier' ? 0.35 : 0.6, 1);
          break;
        case 'boost':
          o.taken = true;
          this.boostT = Math.max(this.boostT, 0.9);
          this.game.audio.sfx('boost');
          break;
        case 'bit': o.taken = true; this.addBits(2); this.game.audio.sfx('coin'); break;
        case 'heart': o.taken = true; this.heal(1); this.game.audio.sfx('powerup'); break;
        case 'floppy': {
          o.taken = true;
          const idx = this.track.objects.filter((x) => x.kind === 'floppy').indexOf(o);
          this.collectFloppy(Math.max(0, idx));
          break;
        }
        case 'chaos':
          if (this.director.trigger(this.directorContext())) {
            o.taken = true;
            this.addBits(10);
          }
          break;
      }
    }
  }

  private crash(speedKeep: number, dmg: number): void {
    if (this.crashT > 0) return;
    this.crashT = 0.8;
    this.speed *= speedKeep;
    if (this.shield) {
      this.shield = false;
      this.popups.add(W / 2, H - 80, 'SHIELD BLOCKED!', '#3fe0ff');
      this.game.audio.sfx('block');
      return;
    }
    this.hp -= dmg;
    this.noteDamage(dmg);
    this.fear += this.fusion.param('lurker_pursuit', 'fearGain', 0.06);
    if (this.hp <= 0) {
      this.finished = true;
      this.won = false;
      this.particles.burst(W / 2, H - 30, ['#ff3f3f', '#ffcf3f', '#333'], 40, 150);
      this.game.audio.sfx('explode');
    }
  }

  private updateTraffic(dt: number, segIdx: number): void {
    const rev = this.director.flag('reverse');
    for (const c of this.track.traffic) {
      c.z += (rev ? -c.speed : c.speed) * dt;
      if (c.z < 0) c.z += (this.track.length - 200) * SEG_LEN;
      if (c.z > (this.track.length - 100) * SEG_LEN) c.z = 200 * SEG_LEN;
      const cs = Math.floor(c.z / SEG_LEN);
      if (cs === segIdx && Math.abs(c.lane - this.px) < 0.35) {
        if (this.speed > (rev ? 0 : c.speed)) {
          this.crash(0.5, 1);
          c.z += SEG_LEN * 3;
        }
      }
    }
  }

  private updateRex(dt: number): void {
    // Rubber-banded rival that stays beatable but never trivial.
    const gap = this.rexZ - this.pos;
    const d = { easy: 0.84, normal: 0.9, hard: 0.95 }[this.game.settings.difficulty];
    const band = clamp(1 - gap / 40000, 0.85, 1.12);
    this.rexZ += MAX_SPEED * d * band * dt;
    this.rexX = Math.sin(this.time * 0.4) * 0.5;
  }

  private updateMidnight(dt: number, segIdx: number): void {
    if (!this.fusion.has('lurker')) return;
    if (!this.midnight && segIdx >= this.track.midnightSeg) {
      this.midnight = true;
      this.lurkerZ = this.pos - 9000;
      this.game.genreShift('RACING', 'SURVIVAL HORROR', PAL.horror.danger);
      this.game.audio.play('neon_night');
      this.game.toast('MIDNIGHT', 'THE LURKER IS AWAKE. DON\'T SLOW DOWN.', '#b3122e');
    }
    if (!this.midnight) return;
    // The Lurker: base speed scales with fear; it gets faster when you hesitate.
    const hesitating = this.speed < MAX_SPEED * 0.6;
    if (hesitating) this.fear = Math.min(1, this.fear + dt * 0.08);
    else this.fear = Math.max(0, this.fear - dt * 0.02);
    const base = this.fusion.param('lurker_pursuit', 'lurkerBase', 0.92) * { easy: 0.92, normal: 1, hard: 1.05 }[this.game.settings.difficulty];
    this.lurkerZ += MAX_SPEED * (base + this.fear * 0.35) * dt;
    const dist = this.pos - this.lurkerZ;
    if (dist < 4000) {
      this.heartbeatT -= dt;
      if (this.heartbeatT <= 0) {
        this.heartbeatT = 0.3 + dist / 4000;
        this.game.audio.sfx('heartbeat');
      }
      // It reshapes the road ahead: shadow barriers appear in your lane.
      this.sabotageT -= dt;
      if (this.sabotageT <= 0) {
        this.sabotageT = 3.5;
        const seg = Math.floor((this.pos + PLAYER_Z) / SEG_LEN) + 60;
        const lane = LANES.reduce((a, b) => (Math.abs(b - this.px) < Math.abs(a - this.px) ? b : a));
        if (!this.allObjects().some((o) => o.seg === seg)) this.shadowObjs.push({ seg, lane, kind: 'barrier' });
        if (this.shadowObjs.length > 20) this.shadowObjs.shift();
      }
    }
    if (dist <= 0) {
      this.crash(0.3, 1);
      this.lurkerZ = this.pos - 6000;
      this.game.fx.flash('#000', 0.8);
      this.popups.add(W / 2, H / 2, 'IT GOT YOU', '#b3122e');
    }
  }

  private updateSkill(dt: number): void {
    const s = this.skill!;
    s.t += dt;
    const inp = this.game.input;
    if (inp.pressed('left')) s.sel = 0;
    if (inp.pressed('up')) s.sel = 1;
    if (inp.pressed('right')) s.sel = 2;
    if (inp.pressed('jump') || inp.pressed('attack') || s.t > 4) {
      const choice = ['ATTACK', 'DEFEND', 'MAGIC'][s.sel];
      if (choice === 'ATTACK') {
        // Ram the nearest car ahead for loot.
        const segIdx = Math.floor((this.pos + PLAYER_Z) / SEG_LEN);
        const target = this.track.traffic.filter((c) => c.z / SEG_LEN > segIdx).sort((a, b) => a.z - b.z)[0];
        if (target) target.z += SEG_LEN * 100;
        this.addBits(20);
        this.popups.add(W / 2, H / 2, 'CRITICAL HIT! +20', '#ffcf3f');
      } else if (choice === 'DEFEND') {
        this.shield = true;
        this.popups.add(W / 2, H / 2, 'SHIELD UP', '#3fe0ff');
      } else {
        this.boostT = 1.6;
        this.popups.add(W / 2, H / 2, 'HASTE!', '#ff3fd2');
      }
      this.runXp += 5;
      this.game.audio.sfx('confirm');
      this.skill = null;
    }
  }

  private end(): void {
    if (this.ended) return;
    if (this.hp > 0) this.addBits(this.won ? 40 : 15);
    const score = Math.floor(this.runBits * 10 + (this.won ? 2000 : 500) + Math.max(0, 4000 - this.time * 20));
    this.finish(this.hp > 0, score);
  }

  // ---- rendering ------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const night = this.midnight;
    const fog = this.director.flag('fog');
    const lurkDist = this.midnight ? this.pos - this.lurkerZ : 99999;
    // Sky
    if (night) {
      const bands = ['#050008', '#0a0010', '#14001a', '#220016', '#300010'];
      bands.forEach((c, i) => rect(ctx, 0, i * 26, W, 26, c));
      rect(ctx, 360, 30, 22, 22, '#e8e0d0');
      rect(ctx, 366, 34, 8, 8, '#c8c0b0');
    } else {
      const bands = ['#12002b', '#2a0050', '#4a0a70', '#7a1a80', '#b02a80', '#ff3fa4'];
      bands.forEach((c, i) => rect(ctx, 0, i * 22, W, 22, c));
      // Striped synth sun
      const sx = W / 2 - (this.skyX * 2) % 40;
      for (let y = 0; y < 44; y += 2) {
        const r = Math.sqrt(44 * 44 - (44 - y) * (44 - y));
        if (y % 8 < 6 || y < 20) rect(ctx, sx - r, 60 + y, r * 2, 2, y < 22 ? '#ffe23f' : '#ff6f3f');
      }
    }
    if (!night) {
      // Stars twinkle in the upper sky; a second, paler mountain range sits behind the first.
      for (let i = 0; i < 40; i++) {
        const sx = (i * 97) % W;
        const sy = (i * 53) % 60;
        if ((i + Math.floor(this.time * 2)) % 5) rect(ctx, sx, sy, 1, 1, '#ffffffaa');
      }
      for (let x = 0; x < W; x += 3) {
        const wx = x + this.skyX * 2;
        const h = 30 + Math.abs(Math.sin(wx * 0.011 + 2)) * 30;
        rect(ctx, x, 134 - h, 3, h, '#5a1a8a');
      }
    }
    // Mountains (parallax shifts with curves)
    for (let x = 0; x < W; x += 3) {
      const wx = x + this.skyX * 4;
      const h = 22 + Math.abs(Math.sin(wx * 0.017)) * 26 + Math.sin(wx * 0.05) * 5;
      rect(ctx, x, 134 - h, 3, h, night ? '#1a0a14' : '#3b0a6b');
    }
    rect(ctx, 0, 134, W, H - 134, night ? '#080406' : '#1a0033');

    // Road
    const baseSeg = Math.floor(this.pos / SEG_LEN);
    const basePct = (this.pos % SEG_LEN) / SEG_LEN;
    const s0 = this.seg(baseSeg);
    const s1 = this.seg(baseSeg + 1);
    const playerY = s0.y + (s1.y - s0.y) * basePct;
    const camY = playerY + CAM_H;
    let x = 0;
    let dx = -s0.curve * basePct;
    let maxy = H;
    const drawDist = fog ? 45 : 150;
    for (let n = 0; n < drawDist; n++) {
      const i = baseSeg + n;
      const pr = this.proj[n];
      pr.clip = maxy;
      if (i >= this.track.length - 1) { pr.scale = 0; continue; }
      const sA = this.seg(i);
      const sB = this.seg(i + 1);
      const z1 = i * SEG_LEN - this.pos;
      const z2 = (i + 1) * SEG_LEN - this.pos;
      const camX1 = this.px * ROAD_W - x;
      const camX2 = this.px * ROAD_W - x - dx;
      x += dx;
      dx += sA.curve;
      if (z1 <= DEPTH) { pr.scale = 0; continue; }
      const sc1 = DEPTH / z1, sc2 = DEPTH / z2;
      const X1 = W / 2 - sc1 * camX1 * W / 2, Y1 = H / 2 - sc1 * (sA.y - camY) * H / 2, W1 = sc1 * ROAD_W * W / 2;
      const X2 = W / 2 - sc2 * camX2 * W / 2, Y2 = H / 2 - sc2 * (sB.y - camY) * H / 2, W2 = sc2 * ROAD_W * W / 2;
      pr.x = X1; pr.y = Y1; pr.w = W1; pr.scale = sc1; pr.camZ = z1;
      if (Y2 >= Y1 || Y2 >= maxy) continue;
      const alt = Math.floor(i / 3) % 2 === 0;
      const fogA = fog ? Math.min(1, n / drawDist) : night ? Math.min(1, n / 90) : 0;
      const grass = night ? (alt ? '#0c0a08' : '#100c0a') : alt ? '#2a0a4a' : '#22083d';
      const rumble = night ? (alt ? '#b3122e' : '#300') : alt ? '#3fe0ff' : '#ff3fa4';
      const road = night ? (alt ? '#141012' : '#181416') : alt ? '#2a2440' : '#26203a';
      this.quad(ctx, 0, Y1, W, 0, Y2, W, grass);
      if (!night && alt && !fog) rect(ctx, 0, Y1, W, 1, 'rgba(63,224,255,0.16)'); // receding neon grid
      this.quad(ctx, X1, Y1, W1 * 1.12, X2, Y2, W2 * 1.12, rumble);
      this.quad(ctx, X1, Y1, W1, X2, Y2, W2, road);
      if (alt) {
        for (const ln of [-1 / 3, 1 / 3]) this.quad(ctx, X1 + ln * W1 * 2, Y1, W1 * 0.02, X2 + ln * W2 * 2, Y2, W2 * 0.02, night ? '#5a4a3a' : '#ffffff');
      }
      if (i >= this.finishZ / SEG_LEN && i <= this.finishZ / SEG_LEN + 2) {
        for (let k = 0; k < 8; k++) this.quad(ctx, X1 - W1 + (k + 0.5) * W1 / 4, Y1, W1 / 8, X2 - W2 + (k + 0.5) * W2 / 4, Y2, W2 / 8, k % 2 ? '#fff' : '#000');
      }
      if (fogA > 0) {
        ctx.globalAlpha = fogA * (fog ? 0.9 : 0.85);
        rect(ctx, 0, Y2, W, Y1 - Y2 + 1, fog ? '#8a7aa0' : '#000');
        ctx.globalAlpha = 1;
      }
      maxy = Y2;
    }

    // Horizon glow melts the far road into the sky (aerial perspective).
    {
      const hz = ctx.createLinearGradient(0, 110, 0, 190);
      hz.addColorStop(0, night ? 'rgba(179,18,46,0)' : 'rgba(255,63,164,0)');
      hz.addColorStop(0.35, night ? 'rgba(179,18,46,0.22)' : 'rgba(255,63,164,0.3)');
      hz.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hz;
      ctx.fillRect(0, 110, W, 80);
    }
    // Sprites back to front
    const objs = this.allObjects();
    const startIdx = baseSeg;
    for (let n = drawDist - 1; n >= 1; n--) {
      const i = startIdx + n;
      const pr = this.proj[n];
      if (!pr.scale) continue;
      for (const o of objs) if (o.seg === i && !o.taken) this.drawObj(ctx, o, pr, night);
      for (const c of this.track.traffic) {
        if (Math.floor(c.z / SEG_LEN) === i) {
          const sx = pr.x + pr.scale * c.lane * ROAD_W * W / 2;
          this.drawCar(ctx, sx, pr.y, pr.scale * 520 * W / 2, `hsl(${c.hue},80%,55%)`, pr.clip, this.director.flag('reverse'));
        }
      }
      if (Math.floor((this.rexZ + PLAYER_Z) / SEG_LEN) === i) {
        const sx = pr.x + pr.scale * this.rexX * ROAD_W * W / 2;
        this.drawCar(ctx, sx, pr.y, pr.scale * 560 * W / 2, '#ff6f3f', pr.clip, false, true);
      }
    }
    if (fog && !night) {
      ctx.globalAlpha = 0.25;
      rect(ctx, 0, 0, W, H, '#8a7aa0');
      ctx.globalAlpha = 1;
    }

    // Player
    this.drawPlayer(ctx);
    // Horror vignette as the Lurker closes in
    if (night && lurkDist < 5000) {
      const a = clamp(1 - lurkDist / 5000, 0, 0.75);
      ctx.globalAlpha = a;
      rect(ctx, 0, 0, W, 30, '#000');
      rect(ctx, 0, H - 30, W, 30, '#000');
      rect(ctx, 0, 0, 40, H, '#000');
      rect(ctx, W - 40, 0, 40, H, '#000');
      ctx.globalAlpha = 1;
    }
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    this.drawHud(ctx, lurkDist);
    if (this.skill) this.drawSkill(ctx);
    if (this.countdown > 0) {
      const n = Math.ceil(this.countdown);
      drawText(ctx, n > 3 ? '' : n >= 1 ? `${n}` : 'GO!', W / 2, 90, '#ffe23f', { align: 'center', scale: 4 });
      if (this.countdown > 2) {
        this.fusion.bannerLines().forEach((l, i) => drawText(ctx, l.text, W / 2, 140 + i * 10, l.color, { align: 'center' }));
      }
    }
    if (this.finished) {
      const msg = this.hp <= 0 ? 'WRECKED!' : this.won ? '1ST PLACE!' : '2ND PLACE';
      drawText(ctx, msg, W / 2, 100, this.won ? '#ffe23f' : '#fff', { align: 'center', scale: 3 });
    }
  }

  private quad(ctx: CanvasRenderingContext2D, x1: number, y1: number, w1: number, x2: number, y2: number, w2: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1 - w1, y1);
    ctx.lineTo(x2 - w2, y2);
    ctx.lineTo(x2 + w2, y2);
    ctx.lineTo(x1 + w1, y1);
    ctx.closePath();
    ctx.fill();
  }

  private drawObj(ctx: CanvasRenderingContext2D, o: TrackObj, pr: Proj, night: boolean): void {
    const sx = pr.x + pr.scale * o.lane * ROAD_W * W / 2;
    const s = pr.scale * W / 2;
    const y = pr.y;
    if (y > pr.clip + 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, pr.clip);
    ctx.clip();
    // Ground shadow anchors each object to the road; pickups also get a soft halo.
    if (o.kind !== 'boost') {
      const sw = (o.kind === 'barrier' ? 520 : o.kind === 'cone' ? 240 : 220) * s;
      rect(ctx, sx - sw / 2, y - sw * 0.03, sw, Math.max(1, sw * 0.07), 'rgba(0,0,0,0.38)');
    }
    if (o.kind === 'bit' || o.kind === 'heart' || o.kind === 'floppy' || o.kind === 'chaos') {
      const hw = (o.kind === 'bit' ? 120 : 240) * s;
      if (hw > 3) glow(ctx, sx, y - hw * 1.1, hw * 1.6, o.kind === 'heart' ? '255,63,107' : o.kind === 'bit' ? '255,207,63' : o.kind === 'floppy' ? '63,224,255' : '255,63,210', 0.35);
    }
    switch (o.kind) {
      case 'cone': {
        const w = 220 * s, h = 300 * s;
        ctx.fillStyle = '#ff6f3f';
        ctx.beginPath();
        ctx.moveTo(sx - w / 2, y); ctx.lineTo(sx, y - h); ctx.lineTo(sx + w / 2, y); ctx.fill();
        rect(ctx, sx - w * 0.3, y - h * 0.45, w * 0.6, h * 0.12, '#fff');
        break;
      }
      case 'barrier': {
        const w = 520 * s, h = 220 * s;
        const shadow = this.shadowObjs.includes(o);
        rect(ctx, sx - w / 2, y - h, w, h, shadow ? '#000' : night ? '#5a1010' : '#ffcf3f');
        if (shadow) {
          rect(ctx, sx - w * 0.2, y - h * 0.7, w * 0.08, h * 0.15, '#ff2040');
          rect(ctx, sx + w * 0.12, y - h * 0.7, w * 0.08, h * 0.15, '#ff2040');
        } else for (let k = 0; k < 4; k++) rect(ctx, sx - w / 2 + k * w / 4, y - h, w / 8, h, '#222');
        break;
      }
      case 'boost': {
        const w = 500 * s, h = 60 * s;
        rect(ctx, sx - w / 2, y - h, w, h, Math.floor(this.time * 5) % 2 ? '#3fe0ff' : '#ff3fd2');
        drawText(ctx, '>>', sx, y - h - 8, '#fff', { align: 'center', scale: Math.max(1, Math.round(s * 300)) });
        break;
      }
      case 'bit': {
        const w = 120 * s;
        rect(ctx, sx - w / 2, y - w * 2, w, w * 1.2, '#ffcf3f');
        break;
      }
      case 'heart': {
        const w = 200 * s;
        rect(ctx, sx - w / 2, y - w * 1.6, w, w, '#ff3f6b');
        break;
      }
      case 'floppy': {
        const w = 260 * s;
        rect(ctx, sx - w / 2, y - w * 1.6, w, w, '#2b2bd9');
        rect(ctx, sx - w / 4, y - w * 1.6, w / 2, w / 3, '#c0c0d0');
        rect(ctx, sx - w / 3, y - w * 1.0, w * 0.66, w / 3, '#fff');
        break;
      }
      case 'chaos': {
        const w = 260 * s;
        rect(ctx, sx - w / 2, y - w * 1.6, w, w, `hsl(${(this.time * 200) % 360},100%,60%)`);
        break;
      }
    }
    ctx.restore();
  }

  private drawCar(ctx: CanvasRenderingContext2D, sx: number, y: number, w: number, color: string, clip: number, oncoming: boolean, rex = false): void {
    if (w < 2) return;
    const h = w * 0.55;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, clip);
    ctx.clip();
    rect(ctx, sx - w * 0.55, y - h * 0.1, w * 1.1, Math.max(1, h * 0.2), 'rgba(0,0,0,0.4)');
    rect(ctx, sx - w / 2, y - h, w, h * 0.7, color);
    rect(ctx, sx - w * 0.35, y - h * 1.25, w * 0.7, h * 0.6, color);
    rect(ctx, sx - w * 0.28, y - h * 1.15, w * 0.56, h * 0.35, '#1a1030');
    rect(ctx, sx - w / 2, y - h * 0.3, w * 0.18, h * 0.3, '#111');
    rect(ctx, sx + w * 0.32, y - h * 0.3, w * 0.18, h * 0.3, '#111');
    const lights = oncoming ? '#ffffcc' : '#ff2040';
    rect(ctx, sx - w * 0.45, y - h * 0.6, w * 0.15, h * 0.12, lights);
    rect(ctx, sx + w * 0.3, y - h * 0.6, w * 0.15, h * 0.12, lights);
    if (rex && w > 30) drawText(ctx, 'REX', sx, y - h * 1.6, '#ffe23f', { align: 'center' });
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const x = W / 2 + this.steer * 6;
    const y = H - 14 + (this.crashT > 0 ? Math.sin(this.time * 60) * 2 : 0);
    const tilt = this.steer * (this.drifting ? 6 : 3);
    if (this.director.flag('mecha')) {
      // Giant fighting robot (rear view)
      const punch = this.punchT > 0.15;
      rect(ctx, x - 22, y - 46, 44, 30, '#20c4b0');
      rect(ctx, x - 12, y - 60, 24, 14, '#20c4b0');
      rect(ctx, x - 8, y - 56, 16, 5, '#ff3fa4');
      rect(ctx, x - 34, y - 44 - (punch ? 14 : 0), 12, punch ? 30 : 22, '#178f80');
      rect(ctx, x + 22, y - 44, 12, 22, '#178f80');
      rect(ctx, x - 18, y - 16, 12, 16, '#3346a8');
      rect(ctx, x + 6, y - 16, 12, 16, '#3346a8');
      if (punch) drawText(ctx, 'POW!', x - 30, y - 80, '#ffcf3f', { scale: 2 });
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt * Math.PI / 180);
    rect(ctx, -30, -18, 60, 14, '#20c4b0');
    rect(ctx, -22, -30, 44, 12, '#20c4b0');
    rect(ctx, -18, -28, 36, 7, '#0b0716');
    rect(ctx, -6, -34, 12, 8, '#ff3fa4'); // Cass's hair
    rect(ctx, -32, -6, 12, 7, '#111');
    rect(ctx, 20, -6, 12, 7, '#111');
    rect(ctx, -28, -14, 10, 3, this.boostT > 0 ? '#ffe23f' : '#ff2040');
    rect(ctx, 18, -14, 10, 3, this.boostT > 0 ? '#ffe23f' : '#ff2040');
    if (this.shield) {
      ctx.globalAlpha = 0.35;
      rect(ctx, -36, -40, 72, 44, '#3fe0ff');
      ctx.globalAlpha = 1;
    }
    if (this.hp < this.stats.maxHp) for (let k = 0; k < this.stats.maxHp - this.hp; k++) rect(ctx, -10 + k * 7, -40 - ((this.time * 30 + k * 7) % 14), 4, 4, '#555a');
    ctx.restore();
    if (this.boostT > 0) {
      rect(ctx, x - 26, y - 6, 8, 6 + Math.random() * 8, '#ffcf3f');
      rect(ctx, x + 18, y - 6, 8, 6 + Math.random() * 8, '#ffcf3f');
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D, lurkDist: number): void {
    rect(ctx, 0, 0, W, 22, '#0008');
    hearts(ctx, 6, 3, this.hp, this.stats.maxHp);
    drawText(ctx, 'BOOST', 6, 13, '#3fe0ff');
    bar(ctx, 40, 14, 50, 4, this.boost, '#3fe0ff', '#012', '#ffffff55');
    for (let i = 1; i < 3; i++) rect(ctx, 40 + i * 50 / 3, 13, 1, 6, '#fff8');
    const kmh = Math.round(this.speed / MAX_SPEED * 280);
    drawText(ctx, `${kmh} KM/H`, 104, 3, '#fff');
    const ahead = this.pos >= this.rexZ;
    drawText(ctx, ahead ? 'POS 1/2' : 'POS 2/2', 104, 13, ahead ? '#7dff6b' : '#ff6f3f');
    drawText(ctx, `BITS ${this.runBits}`, 168, 3, '#ffcf3f');
    drawText(ctx, `DISKS ${this.foundFloppies.length}/3`, 168, 13, '#3fe0ff');
    // Course progress with Rex and Lurker markers
    const total = this.finishZ;
    const bx = 240, bw = 120;
    rect(ctx, bx, 9, bw, 3, '#ffffff33');
    rect(ctx, bx + this.track.midnightSeg * SEG_LEN / total * bw, 6, 1, 8, '#b3122e');
    rect(ctx, bx + clamp(this.rexZ / total, 0, 1) * bw - 2, 5, 4, 4, '#ff6f3f');
    rect(ctx, bx + clamp(this.pos / total, 0, 1) * bw - 2, 11, 4, 4, '#20c4b0');
    if (this.midnight) rect(ctx, bx + clamp(this.lurkerZ / total, 0, 1) * bw - 2, 14, 4, 4, '#000');
    this.drawChaosHud(ctx);
    // Rear-view mirror with the Lurker's eyes
    if (this.midnight) {
      const mx = W / 2 - 40, my = 26;
      rect(ctx, mx, my, 80, 20, '#222');
      rect(ctx, mx + 2, my + 2, 76, 16, '#0a0608');
      const near = clamp(1 - lurkDist / 9000, 0, 1);
      const ew = 2 + near * 8;
      const blink = Math.floor(this.time * 2) % 5 === 0;
      if (!blink) {
        rect(ctx, W / 2 - 6 - ew, my + 10 - ew / 3, ew, Math.max(1, ew / 2), '#ff2040');
        rect(ctx, W / 2 + 6, my + 10 - ew / 3, ew, Math.max(1, ew / 2), '#ff2040');
      }
      if (lurkDist < 3000) drawText(ctx, 'IT\'S RIGHT BEHIND YOU', W / 2, my + 24, '#ff2040', { align: 'center' });
    }
    if (this.drifting) drawText(ctx, `DRIFT ${this.drift.toFixed(1)}`, W / 2, H - 50, this.drift > 1 ? '#3fe0ff' : '#fff', { align: 'center' });
    this.drawHint(ctx, 'LEFT/RIGHT STEER • DOWN BRAKE • Z BOOST • HOLD C + TURN TO DRIFT');
    this.drawSeed(ctx);
  }

  private drawSkill(ctx: CanvasRenderingContext2D): void {
    rect(ctx, 0, 0, W, H, '#0008');
    rect(ctx, 80, 70, W - 160, 110, '#1d1233');
    rect(ctx, 80, 70, W - 160, 2, '#7dff6b');
    drawText(ctx, 'DRIFT ENCOUNTER! CHOOSE A COMMAND', W / 2, 80, '#7dff6b', { align: 'center' });
    const opts = [['← ATTACK', 'RAM A CAR FOR BITS'], ['↑ DEFEND', 'SHIELD NEXT CRASH'], ['→ MAGIC', 'LONG HASTE BOOST']];
    opts.forEach(([a, b], i) => {
      const sel = this.skill!.sel === i;
      const x = 120 + i * 90;
      rect(ctx, x - 40, 100, 80, 50, sel ? '#3a2a6a' : '#140a2a');
      drawText(ctx, a, x, 110, sel ? '#ffcf3f' : '#fff', { align: 'center' });
      drawText(ctx, b.slice(0, 13), x, 124, '#aaa', { align: 'center' });
      drawText(ctx, b.slice(13), x, 134, '#aaa', { align: 'center' });
    });
    drawText(ctx, 'Z TO CONFIRM', W / 2, 162, '#fff', { align: 'center' });
  }
}
