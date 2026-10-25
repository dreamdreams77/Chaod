/**
 * CORE COMMAND — tower defence that turns into a bullet-hell siege.
 * Build towers beside the glitch road and stop eight waves reaching the Cartridge Core.
 * From wave 5 SPITTERS pepper your towers with stun shots.
 *
 * Mutation honoured: VETERAN TOWERS (strategy+rpg) — towers earn XP from kills and level up by themselves.
 * Controls: arrows move the cursor, Z places or upgrades, X changes tower type,
 * C sells the tower under the cursor or sends the next wave early. Tap works too.
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import type { DirectorContext } from '../chaos/director.ts';
import { generateCommand, CommandMap, CM_COLS, CM_ROWS, CM_CELL, CM_TOP } from '../procgen/command.ts';
import { H, W, PAL, backdrop, glow, rect, frame, bar, hearts, clamp } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { drawCoreIcon } from '../render/actors.ts';

export type TowerKind = 'blaster' | 'wave' | 'laser';
export type EnemyKind = 'bug' | 'runner' | 'tank' | 'spitter' | 'boss';

export interface TowerDef {
  id: TowerKind;
  name: string;
  cost: number;
  range: number;
  rate: number;
  dmg: number;
  color: string;
  blurb: string;
}

export const TOWERS: TowerDef[] = [
  { id: 'blaster', name: 'BLASTER', cost: 50, range: 72, rate: 2.8, dmg: 1, color: '#ffcf3f', blurb: 'Fast shots' },
  { id: 'wave', name: 'WAVE', cost: 70, range: 58, rate: 1.2, dmg: 0.5, color: '#3fe0ff', blurb: 'Slows foes' },
  { id: 'laser', name: 'LASER', cost: 110, range: 104, rate: 0.7, dmg: 4, color: '#ff3fd2', blurb: 'Pierces 3' },
];

interface EnemyDef {
  hp: number;
  speed: number;
  leak: number;
  cash: number;
  color: string;
  size: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  bug: { hp: 5, speed: 38, leak: 1, cash: 3, color: '#ff3f6b', size: 9 },
  runner: { hp: 3, speed: 74, leak: 1, cash: 3, color: '#ffe23f', size: 8 },
  tank: { hp: 28, speed: 26, leak: 2, cash: 10, color: '#b07aff', size: 13 },
  spitter: { hp: 10, speed: 34, leak: 1, cash: 7, color: '#3fffcf', size: 10 },
  boss: { hp: 320, speed: 18, leak: 3, cash: 50, color: '#ff6f3f', size: 20 },
};

/** [count, kind, seconds between spawns] groups, played one after another. */
export const WAVES: Array<Array<[number, EnemyKind, number]>> = [
  [[8, 'bug', 1.2]],
  [[10, 'bug', 1], [4, 'runner', 0.7]],
  [[10, 'runner', 0.6], [8, 'bug', 0.9]],
  [[4, 'tank', 2.2], [10, 'bug', 0.8]],
  [[6, 'runner', 0.5], [4, 'spitter', 1.6], [8, 'bug', 0.7]],
  [[6, 'tank', 1.8], [5, 'spitter', 1.4]],
  [[8, 'bug', 0.5], [6, 'runner', 0.4], [4, 'tank', 1.5], [6, 'spitter', 1.0]],
  [[5, 'tank', 1.5], [6, 'spitter', 1.0], [1, 'boss', 1], [10, 'runner', 0.5]],
];

export const WAVE_COUNT = WAVES.length;
const BUILD_SECONDS = 12;
const START_CASH = 120;
/** Global toughness dial for every enemy, tuned against scripted players (see CHANGELOG). */
const HP_SCALE = 1.75;

interface Tower {
  cx: number;
  cy: number;
  kind: TowerKind;
  level: number;
  cd: number;
  kills: number;
  stun: number;
  spent: number;
  flash: number;
}

interface Enemy {
  kind: EnemyKind;
  pos: number; // fractional index along the path
  hp: number;
  max: number;
  slow: number;
  fireCd: number;
  hit: number;
  x: number;
  y: number;
}

interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
  color: string;
  width: number;
}

interface Spit {
  x: number;
  y: number;
  tx: number;
  ty: number;
  target: Tower;
  t: number;
}

type Phase = 'build' | 'wave' | 'won' | 'lost';

export function towerStat(def: TowerDef, level: number): { range: number; rate: number; dmg: number } {
  return { range: def.range * (1 + 0.12 * (level - 1)), rate: def.rate * (1 + 0.15 * (level - 1)), dmg: def.dmg * (1 + 0.5 * (level - 1)) };
}

export function upgradeCost(def: TowerDef, level: number): number {
  return Math.ceil(def.cost * 0.7 * level);
}

export class CommandMode extends ModeBase {
  id = 'command';
  crt = 0.22;
  hp: number;
  readonly map: CommandMap;
  towers: Tower[] = [];
  enemies: Enemy[] = [];
  cash = START_CASH;
  wave = 0;
  phase: Phase = 'build';
  buildT = BUILD_SECONDS + 6;
  cursor = { x: 4, y: 3 };
  selected = 0;
  kills = 0;
  leaks = 0;
  endT = 0;
  private queue: Array<{ t: number; kind: EnemyKind }> = [];
  private clock = 0;
  private beams: Beam[] = [];
  private spits: Spit[] = [];
  private moveT = 0;
  private leakedThisWave = false;
  private pendingTap: { x: number; y: number } | null = null;

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'command', opts);
    this.map = generateCommand(this.seed);
    this.hp = this.stats.maxHp;
    this.applyCarry();
  }

  enter(): void {
    this.game.music('hub');
    if (!this.game.profile.lore.includes('command_intro')) {
      this.game.profile.lore.push('command_intro');
      this.game.say([
        { who: 'manual', name: 'THE MANUAL', text: 'The glitches are marching on the CARTRIDGE CORE. Build towers beside their road and stop all eight waves.' },
        { who: 'manual', name: 'THE MANUAL', text: 'Z places or upgrades a tower. X changes the type. C sells a tower, or sends the next wave early. Tap works too!' },
      ]);
    }
  }

  directorContext(): DirectorContext {
    const boss = this.enemies.some((e) => e.kind === 'boss');
    return { hpFrac: this.hp / this.stats.maxHp, safe: (this.phase === 'build' || this.phase === 'wave') && !boss, bossActive: boss };
  }

  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  // ---- geometry ------------------------------------------------------------------
  private cellCenter(cx: number, cy: number): { x: number; y: number } {
    return { x: cx * CM_CELL + CM_CELL / 2 + 2, y: CM_TOP + cy * CM_CELL + CM_CELL / 2 };
  }

  private pathPoint(pos: number): { x: number; y: number } {
    const p = this.map.path;
    const i = clamp(Math.floor(pos), 0, p.length - 1);
    const j = Math.min(i + 1, p.length - 1);
    const f = clamp(pos - i, 0, 1);
    const a = this.cellCenter(p[i].x, p[i].y);
    const b = this.cellCenter(p[j].x, p[j].y);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  private towerAt(cx: number, cy: number): Tower | undefined {
    return this.towers.find((t) => t.cx === cx && t.cy === cy);
  }

  // ---- player actions -------------------------------------------------------------
  /** Place a tower on an empty buildable cell, or upgrade the one standing there. */
  act(cx: number, cy: number): void {
    const a = this.game.audio;
    const at = this.cellCenter(cx, cy);
    const existing = this.towerAt(cx, cy);
    if (existing) {
      const def = TOWERS.find((d) => d.id === existing.kind)!;
      if (existing.level >= 3) {
        this.popups.add(at.x, at.y - 14, 'MAX LEVEL', '#9a9ab8');
        return;
      }
      const cost = upgradeCost(def, existing.level);
      if (this.cash < cost) {
        a.sfx('miss');
        this.popups.add(at.x, at.y - 14, `NEED ${cost}`, '#ff3f6b');
        return;
      }
      this.cash -= cost;
      existing.spent += cost;
      existing.level++;
      a.sfx('powerup');
      this.popups.add(at.x, at.y - 14, `LV ${existing.level}`, def.color);
      this.particles.burst(at.x, at.y, [def.color, '#fff'], 10, 60);
      return;
    }
    if (cx < 0 || cy < 0 || cx >= CM_COLS || cy >= CM_ROWS || !this.map.free[cy][cx]) {
      a.sfx('miss');
      return;
    }
    const def = TOWERS[this.selected];
    if (this.cash < def.cost) {
      a.sfx('miss');
      this.popups.add(at.x, at.y - 14, `NEED ${def.cost}`, '#ff3f6b');
      return;
    }
    this.cash -= def.cost;
    this.towers.push({ cx, cy, kind: def.id, level: 1, cd: 0.3, kills: 0, stun: 0, spent: def.cost, flash: 0 });
    a.sfx('coin');
    this.particles.burst(at.x, at.y, [def.color, '#fff'], 8, 50);
  }

  /** C: sell the tower under the cursor for 60% of what was spent, otherwise send the next wave now. */
  sellOrSend(cx: number, cy: number): void {
    const t = this.towerAt(cx, cy);
    if (t) {
      const refund = Math.floor(t.spent * 0.6);
      this.cash += refund;
      this.towers = this.towers.filter((x) => x !== t);
      const at = this.cellCenter(cx, cy);
      this.popups.add(at.x, at.y - 14, `+${refund}`, '#ffcf3f');
      this.game.audio.sfx('coin');
      return;
    }
    this.sendWave();
  }

  sendWave(): void {
    if (this.phase !== 'build') return;
    // Sending early is rewarded with whatever build time was left.
    this.cash += Math.floor(this.buildT);
    this.startWave();
  }

  private cycleTower(d = 1): void {
    this.selected = (this.selected + d + TOWERS.length) % TOWERS.length;
    this.game.audio.sfx('select');
  }

  // ---- waves ---------------------------------------------------------------------
  private startWave(): void {
    this.phase = 'wave';
    this.clock = 0;
    this.leakedThisWave = false;
    this.queue = [];
    let t = 0.4;
    for (const [count, kind, gap] of WAVES[this.wave]) {
      for (let i = 0; i < count; i++) {
        this.queue.push({ t, kind });
        t += gap / Math.sqrt(this.diffMult);
      }
      t += 1.4;
    }
    this.wave++;
    this.game.audio.sfx('warn');
    if (this.wave === 5) {
      this.game.genreShift('STRATEGY', 'BULLET HELL', PAL.command.accent);
      this.game.toast('SPITTERS INCOMING', 'THEY STUN TOWERS WITH SHOTS', '#3fffcf');
    }
  }

  private spawn(kind: EnemyKind): void {
    const def = ENEMIES[kind];
    // Tougher on higher difficulties and in boss rematches.
    const hp = Math.max(1, Math.round(def.hp * HP_SCALE * Math.sqrt(this.diffMult) * (this.opts.rematch ? 1.3 : 1)));
    const p = this.pathPoint(0);
    this.enemies.push({ kind, pos: 0, hp, max: hp, slow: 0, fireCd: 1 + this.rng.next(), hit: 0, x: p.x, y: p.y });
  }

  private waveCleared(): void {
    const n = this.wave;
    const bonus = 20 + 8 * n + (this.leakedThisWave ? 0 : 15);
    this.cash += bonus;
    this.addBits(this.leakedThisWave ? 8 : 14);
    this.popups.add(W / 2, 70, `WAVE ${n} CLEARED  +${bonus}`, '#7dff6b');
    this.game.audio.sfx('powerup');
    if (n === 3) this.collectFloppy(0);
    if (n === 6) this.collectFloppy(1);
    if (n >= WAVE_COUNT) {
      this.phase = 'won';
      this.endT = 0;
      this.collectFloppy(2);
      this.addBits(40);
      this.game.audio.sfx('levelup');
      this.game.fx.flash('#7dff6b', 0.35);
      return;
    }
    this.phase = 'build';
    this.buildT = BUILD_SECONDS;
  }

  // ---- simulation ------------------------------------------------------------------
  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    this.tickShared(dt);
    const inp = this.game.input;

    if (this.phase === 'won' || this.phase === 'lost') {
      this.endT += dt;
      if (this.phase === 'won' && this.endT > 2.2) {
        const score = this.kills * 15 + this.hp * 400 + WAVE_COUNT * 100 + Math.max(0, 4000 - Math.floor(this.time * 8)) + this.runBits * 10;
        if (this.leaks === 0) this.runFlags.add('flawless_core');
        this.finish(true, score, {});
      } else if (this.phase === 'lost' && this.endT > 1.8) this.finish(false, this.kills * 10 + this.wave * 50, {});
      return;
    }

    // Cursor: edge presses, with key repeat while held.
    this.moveT -= dt;
    let dx = 0, dy = 0;
    if (inp.pressed('left')) dx = -1;
    else if (inp.pressed('right')) dx = 1;
    else if (inp.pressed('up')) dy = -1;
    else if (inp.pressed('down')) dy = 1;
    else if (this.moveT <= 0 && (inp.axisX() || inp.axisY())) {
      dx = inp.axisX();
      dy = dx ? 0 : inp.axisY();
    }
    if (dx || dy) {
      this.cursor.x = clamp(this.cursor.x + dx, 0, CM_COLS - 1);
      this.cursor.y = clamp(this.cursor.y + dy, 0, CM_ROWS - 1);
      this.moveT = inp.pressed('left') || inp.pressed('right') || inp.pressed('up') || inp.pressed('down') ? 0.28 : 0.09;
    }
    if (inp.pressed('jump') || inp.pressed('confirm')) this.act(this.cursor.x, this.cursor.y);
    if (inp.pressed('attack')) this.cycleTower(1);
    if (inp.pressed('special')) this.sellOrSend(this.cursor.x, this.cursor.y);
    if (this.pendingTap) {
      this.handleTap(this.pendingTap.x, this.pendingTap.y);
      this.pendingTap = null;
    }

    if (this.phase === 'build') {
      this.buildT -= dt;
      if (this.buildT <= 0) this.startWave();
    } else {
      this.clock += dt;
      while (this.queue.length && this.queue[0].t <= this.clock) this.spawn(this.queue.shift()!.kind);
    }

    this.updateEnemies(dt);
    this.updateTowers(dt);
    for (const b of this.beams) b.t -= dt;
    this.beams = this.beams.filter((b) => b.t > 0);
    for (const s of this.spits) {
      s.t += dt * 2.2;
      if (s.t >= 1 && s.target.stun < 2.5) s.target.stun = 2.5;
    }
    this.spits = this.spits.filter((s) => s.t < 1);

    // Loss is decided first, so a final leak can never be scored as a win in the same frame.
    if (this.hp <= 0) {
      this.phase = 'lost';
      this.endT = 0;
      this.game.audio.sfx('explode');
    } else if (this.phase === 'wave' && this.queue.length === 0 && this.enemies.length === 0) this.waveCleared();
  }

  private updateEnemies(dt: number): void {
    const last = this.map.path.length - 1;
    for (const e of this.enemies) {
      const def = ENEMIES[e.kind];
      e.hit = Math.max(0, e.hit - dt);
      e.slow = Math.max(0, e.slow - dt);
      e.pos += (def.speed * (e.slow > 0 ? 0.5 : 1) * dt) / CM_CELL;
      const p = this.pathPoint(e.pos);
      e.x = p.x;
      e.y = p.y;
      if (e.kind === 'spitter' && this.wave >= 1) {
        e.fireCd -= dt;
        if (e.fireCd <= 0) {
          // Shoot the nearest tower that is still working.
          let target: Tower | null = null;
          let best = 80;
          for (const t of this.towers) {
            if (t.stun > 0) continue;
            const c = this.cellCenter(t.cx, t.cy);
            const d = Math.hypot(c.x - e.x, c.y - e.y);
            if (d < best) {
              best = d;
              target = t;
            }
          }
          if (target) {
            const c = this.cellCenter(target.cx, target.cy);
            this.spits.push({ x: e.x, y: e.y, tx: c.x, ty: c.y, target, t: 0 });
          }
          e.fireCd = 2.2;
        }
      }
    }
    for (const e of this.enemies) {
      if (e.pos < last) continue;
      const leak = ENEMIES[e.kind].leak;
      const dmg = leak * this.damageMult;
      e.hp = 0;
      this.leaks += leak;
      this.leakedThisWave = true;
      this.hp = Math.max(0, this.hp - dmg);
      this.noteDamage(dmg);
      this.popups.add(e.x - 10, e.y - 12, `-${dmg}`, '#ff3f5a');
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  private updateTowers(dt: number): void {
    const veteran = this.fusion.has('tower_levels');
    const per = this.fusion.param('tower_xp', 'killsPerLevel', 6);
    const maxLv = this.fusion.param('tower_xp', 'maxLevel', 4);
    for (const t of this.towers) {
      t.cd -= dt;
      t.stun = Math.max(0, t.stun - dt);
      t.flash = Math.max(0, t.flash - dt);
      if (t.stun > 0 || t.cd > 0) continue;
      const def = TOWERS.find((d) => d.id === t.kind)!;
      const st = towerStat(def, t.level);
      const c = this.cellCenter(t.cx, t.cy);
      // Aim at the enemy furthest along the road that is in range.
      let target: Enemy | null = null;
      for (const e of this.enemies) {
        if (e.hp <= 0 || Math.hypot(e.x - c.x, e.y - c.y) > st.range) continue;
        if (!target || e.pos > target.pos) target = e;
      }
      if (!target) continue;
      t.cd = 1 / st.rate;
      t.flash = 0.1;
      let killed = 0;
      if (def.id === 'wave') {
        // Pulse: slows and chips everything in range.
        for (const e of this.enemies) if (Math.hypot(e.x - c.x, e.y - c.y) <= st.range) { e.slow = 1.4; killed += this.damage(e, st.dmg) ? 1 : 0; }
        this.beams.push({ x1: c.x, y1: c.y, x2: c.x, y2: c.y, t: 0.18, color: def.color, width: st.range });
      } else if (def.id === 'laser') {
        const ang = Math.atan2(target.y - c.y, target.x - c.x);
        let hits = 0;
        for (const e of this.enemies.slice().sort((a, b) => b.pos - a.pos)) {
          const along = (e.x - c.x) * Math.cos(ang) + (e.y - c.y) * Math.sin(ang);
          const off = Math.abs(-(e.x - c.x) * Math.sin(ang) + (e.y - c.y) * Math.cos(ang));
          if (along > 0 && along <= st.range && off < 9 && hits < 3) {
            hits++;
            killed += this.damage(e, st.dmg) ? 1 : 0;
          }
        }
        this.beams.push({ x1: c.x, y1: c.y, x2: c.x + Math.cos(ang) * st.range, y2: c.y + Math.sin(ang) * st.range, t: 0.12, color: def.color, width: 3 });
      } else {
        killed += this.damage(target, st.dmg) ? 1 : 0;
        this.beams.push({ x1: c.x, y1: c.y, x2: target.x, y2: target.y, t: 0.07, color: def.color, width: 1 });
      }
      if (killed) {
        t.kills += killed;
        if (veteran && t.level < maxLv && t.kills >= per * t.level) {
          t.level++;
          this.popups.add(c.x, c.y - 14, `LV ${t.level}!`, def.color);
          this.game.audio.sfx('levelup');
          this.particles.burst(c.x, c.y, [def.color, '#fff'], 10, 60);
        }
      }
    }
  }

  /** Returns true when this hit killed the enemy. */
  private damage(e: Enemy, amount: number): boolean {
    if (e.hp <= 0) return false;
    e.hp -= amount;
    e.hit = 0.1;
    if (e.hp > 0) return false;
    const def = ENEMIES[e.kind];
    this.kills++;
    this.cash += def.cash;
    if (e.kind === 'tank' || e.kind === 'boss') this.addBits(e.kind === 'boss' ? 25 : 3, e.x, e.y);
    else if (this.kills % 5 === 0) this.addBits(1);
    this.particles.burst(e.x, e.y, [def.color, '#fff'], e.kind === 'boss' ? 30 : 6, e.kind === 'boss' ? 130 : 60);
    this.game.audio.sfx('hit', e.kind === 'boss' ? 0.6 : 1.4);
    if (e.kind === 'boss') this.game.fx.shake(5);
    return true;
  }

  // ---- touch -------------------------------------------------------------------------
  tap(x: number, y: number): boolean {
    this.pendingTap = { x, y };
    return true;
  }

  private barRects(): Array<{ x: number; w: number; action: 'tower' | 'sell' | 'send'; index: number }> {
    const out: Array<{ x: number; w: number; action: 'tower' | 'sell' | 'send'; index: number }> = TOWERS.map((_, i) => ({ x: 8 + i * 92, w: 88, action: 'tower' as const, index: i }));
    out.push({ x: 8 + 3 * 92 + 4, w: 70, action: 'sell', index: 0 });
    out.push({ x: 8 + 3 * 92 + 78, w: 110, action: 'send', index: 0 });
    return out;
  }

  private handleTap(x: number, y: number): void {
    if (y >= H - 40) {
      for (const r of this.barRects()) {
        if (x >= r.x && x <= r.x + r.w) {
          if (r.action === 'tower') {
            this.selected = r.index;
            this.game.audio.sfx('select');
          } else if (r.action === 'sell') {
            if (this.towerAt(this.cursor.x, this.cursor.y)) this.sellOrSend(this.cursor.x, this.cursor.y);
            else this.popups.add(W / 2, H - 60, 'TAP A TOWER FIRST', '#9a9ab8');
          } else this.sendWave();
        }
      }
      return;
    }
    const cx = Math.floor((x - 2) / CM_CELL);
    const cy = Math.floor((y - CM_TOP) / CM_CELL);
    if (cx < 0 || cy < 0 || cx >= CM_COLS || cy >= CM_ROWS) return;
    // First tap moves the cursor and shows the range; tapping the same cell again acts.
    if (this.cursor.x === cx && this.cursor.y === cy) this.act(cx, cy);
    else {
      this.cursor = { x: cx, y: cy };
      this.game.audio.sfx('select');
    }
  }

  // ---- drawing ---------------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const pal = PAL.command;
    backdrop(ctx, pal.bg0, pal.bg1);
    glow(ctx, W / 2, 120, 220, '125,255,107', 0.08);
    // Build grid
    for (let y = 0; y < CM_ROWS; y++) {
      for (let x = 0; x < CM_COLS; x++) {
        const px = x * CM_CELL + 2, py = CM_TOP + y * CM_CELL;
        if (this.map.free[y][x]) {
          rect(ctx, px, py, CM_CELL - 1, CM_CELL - 1, (x + y) % 2 ? '#0d2a1a' : '#0f3220');
          rect(ctx, px, py, CM_CELL - 1, 1, 'rgba(255,255,255,0.05)');
        }
      }
    }
    // Road
    for (let i = 0; i < this.map.path.length; i++) {
      const c = this.map.path[i];
      const px = c.x * CM_CELL + 2, py = CM_TOP + c.y * CM_CELL;
      rect(ctx, px, py, CM_CELL - 1, CM_CELL - 1, '#2a2438');
      rect(ctx, px, py, CM_CELL - 1, 2, '#3a3350');
      // Chevron pointing along the road, drifting forward so the direction reads at a glance.
      const n = this.map.path[Math.min(i + 1, this.map.path.length - 1)];
      const d = { x: n.x - c.x, y: n.y - c.y };
      const m = this.cellCenter(c.x, c.y);
      const off = ((this.time * 12) % 8) - 4;
      ctx.globalAlpha = 0.35;
      rect(ctx, m.x + d.x * off - 1, m.y + d.y * off - 1, 3, 3, '#ff3fa4');
      ctx.globalAlpha = 1;
    }
    // Core at the end of the road
    const end = this.cellCenter(this.map.path[this.map.path.length - 1].x, this.map.path[this.map.path.length - 1].y);
    glow(ctx, end.x, end.y, 30, '125,255,107', 0.35);
    drawCoreIcon(ctx, end.x, end.y + 2, this.time, 1);
    // Cursor range ring
    const cur = this.cellCenter(this.cursor.x, this.cursor.y);
    const hovered = this.towerAt(this.cursor.x, this.cursor.y);
    const hoverDef = hovered ? TOWERS.find((d) => d.id === hovered.kind)! : TOWERS[this.selected];
    const hoverRange = towerStat(hoverDef, hovered?.level ?? 1).range;
    ctx.strokeStyle = hoverDef.color + '88';
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, hoverRange, 0, Math.PI * 2);
    ctx.stroke();
    // Towers
    for (const t of this.towers) {
      const def = TOWERS.find((d) => d.id === t.kind)!;
      const c = this.cellCenter(t.cx, t.cy);
      rect(ctx, c.x - 9, c.y + 6, 18, 4, 'rgba(0,0,0,0.4)');
      const base = t.stun > 0 ? '#555566' : def.color;
      rect(ctx, c.x - 9, c.y - 8, 18, 16, '#1a1030');
      rect(ctx, c.x - 8, c.y - 7, 16, 14, base);
      rect(ctx, c.x - 8, c.y - 7, 16, 3, 'rgba(255,255,255,0.4)');
      rect(ctx, c.x - 3, c.y - 2, 6, 6, t.flash > 0 ? '#ffffff' : '#1a1030');
      for (let i = 0; i < t.level; i++) rect(ctx, c.x - 7 + i * 5, c.y + 8, 4, 2, '#ffffff');
      if (t.stun > 0) drawText(ctx, 'ZZ', c.x, c.y - 18, '#3fffcf', { align: 'center' });
    }
    // Enemies
    for (const e of this.enemies) {
      const def = ENEMIES[e.kind];
      const s = def.size;
      rect(ctx, e.x - s / 2 + 1, e.y + s / 2 - 1, s, 3, 'rgba(0,0,0,0.4)');
      rect(ctx, e.x - s / 2, e.y - s / 2, s, s, e.hit > 0 ? '#ffffff' : def.color);
      rect(ctx, e.x - s / 2, e.y - s / 2, s, 2, 'rgba(255,255,255,0.4)');
      rect(ctx, e.x - s / 4 - 1, e.y - 1, 2, 2, '#000');
      rect(ctx, e.x + s / 4 - 1, e.y - 1, 2, 2, '#000');
      if (e.slow > 0) rect(ctx, e.x - s / 2, e.y + s / 2, s, 1, '#3fe0ff');
      if (e.hp < e.max) bar(ctx, e.x - s / 2, e.y - s / 2 - 4, s, 2, e.hp / e.max, '#7dff6b', '#300', '#00000000');
    }
    // Shots
    for (const b of this.beams) {
      ctx.globalAlpha = Math.min(1, b.t * 10);
      if (b.x1 === b.x2 && b.y1 === b.y2) {
        ctx.strokeStyle = b.color;
        ctx.beginPath();
        ctx.arc(b.x1, b.y1, b.width * (1 - b.t * 3), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width;
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.globalAlpha = 1;
    }
    for (const s of this.spits) {
      const x = s.x + (s.tx - s.x) * s.t, y = s.y + (s.ty - s.y) * s.t;
      glow(ctx, x, y, 8, '63,255,207', 0.6);
      rect(ctx, x - 2, y - 2, 4, 4, '#ffffff');
    }
    // Cursor cell
    ctx.globalAlpha = 0.6 + Math.sin(this.time * 8) * 0.2;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(this.cursor.x * CM_CELL + 2.5, CM_TOP + this.cursor.y * CM_CELL + 0.5, CM_CELL - 2, CM_CELL - 2);
    ctx.globalAlpha = 1;
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    this.drawHud(ctx);
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    rect(ctx, 0, 0, W, 24, 'rgba(0,0,0,0.55)');
    hearts(ctx, 6, 3, this.hp, this.stats.maxHp);
    drawText(ctx, `WAVE ${Math.min(this.wave + (this.phase === 'build' ? 1 : 0), WAVE_COUNT)}/${WAVE_COUNT}`, 150, 4, '#7dff6b');
    drawText(ctx, `$ ${this.cash}`, 150, 13, '#ffcf3f');
    drawText(ctx, `BITS ${this.runBits}`, 240, 4, '#ffcf3f');
    drawText(ctx, `KILLS ${this.kills}`, 240, 13, '#3fe0ff');
    if (this.phase === 'build') drawText(ctx, `BUILD TIME ${Math.ceil(this.buildT)}`, W - 8, 4, '#fff', { align: 'right' });
    else if (this.phase === 'wave') drawText(ctx, `${this.enemies.length + this.queue.length} LEFT`, W - 8, 4, '#ff6f3f', { align: 'right' });
    this.drawChaosHud(ctx, W - 106, 13);
    // Bottom bar: tower picker and SEND WAVE (all tappable)
    rect(ctx, 0, H - 40, W, 40, 'rgba(0,0,0,0.6)');
    for (const r of this.barRects()) {
      if (r.action === 'tower') {
        const def = TOWERS[r.index];
        const sel = r.index === this.selected;
        frame(ctx, r.x, H - 36, r.w, 30, sel ? '#173a26' : '#0b0716', sel ? def.color : '#3a3050');
        drawText(ctx, def.name, r.x + 5, H - 32, def.color);
        drawText(ctx, `$${def.cost}`, r.x + r.w - 4, H - 32, this.cash >= def.cost ? '#ffcf3f' : '#ff3f6b', { align: 'right' });
        drawText(ctx, def.blurb, r.x + 5, H - 21, '#9a9ab8');
      } else if (r.action === 'sell') {
        const on = !!this.towerAt(this.cursor.x, this.cursor.y);
        frame(ctx, r.x, H - 36, r.w, 30, '#0b0716', on ? '#ff3f6b' : '#3a3050');
        drawText(ctx, 'SELL', r.x + r.w / 2, H - 28, on ? '#ff3f6b' : '#555', { align: 'center' });
      } else {
        const ready = this.phase === 'build';
        frame(ctx, r.x, H - 36, r.w, 30, ready ? '#3a2a0a' : '#0b0716', ready ? '#ffcf3f' : '#3a3050');
        drawText(ctx, ready ? 'SEND WAVE' : 'IN PROGRESS', r.x + r.w / 2, H - 28, ready ? '#ffcf3f' : '#555', { align: 'center' });
      }
    }
    const t = this.towerAt(this.cursor.x, this.cursor.y);
    if (t) {
      const def = TOWERS.find((d) => d.id === t.kind)!;
      const up = t.level >= 3 ? 'MAX' : `UPGRADE $${upgradeCost(def, t.level)}`;
      drawText(ctx, `${def.name} LV${t.level}  ${up}  SELL $${Math.floor(t.spent * 0.6)}`, W / 2, 30, '#fff', { align: 'center' });
    }
    if (this.phase === 'won') drawText(ctx, 'CORE DEFENDED!', W / 2, 110, '#7dff6b', { align: 'center', scale: 3 });
    if (this.phase === 'lost') drawText(ctx, 'THE CORE FELL...', W / 2, 110, '#ff3f5a', { align: 'center', scale: 3 });
    this.drawHint(ctx, 'ARROWS MOVE \u2022 Z PLACE / UPGRADE \u2022 X CHANGE TOWER \u2022 C SELL OR SEND WAVE', 'TAP A CELL TO AIM, TAP AGAIN TO PLACE OR UPGRADE \u2022 PICK TOWERS BELOW', H - 54);
    this.drawSeed(ctx, H - 46);
  }
}
