/**
 * MUNCH MAZE — a maze chase. Gobble every bit in the maze while four glitch ghosts hunt you, each in
 * its own way (NULL chases, LAG ambushes, STATIC flanks, 404 gets shy up close). Power bits turn the
 * tables for a few seconds. Three floppy disks appear as you clear the maze. Hearts are lives.
 *
 * Chaos flags honoured: ghost_rush (ghosts 30% faster), wrong_way (your controls flip).
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import type { DirectorContext } from '../chaos/director.ts';
import { DIRS, MZ_H, MZ_W, MazeMap, generateMaze, isFloor, mazeStep, neighbours } from '../procgen/maze.ts';
import { H, W, backdrop, bar, clamp, glow, hearts, rect } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { drawFloppy } from '../render/actors.ts';

const T = 16;
const OX = 20;
const OY = 15;

type GhostState = 'pen' | 'leave' | 'normal' | 'fright' | 'eaten';
type Phase = 'intro' | 'ready' | 'play' | 'dying' | 'won' | 'lost';

interface Mover {
  x: number;
  y: number;
  /** 0 up, 1 left, 2 down, 3 right; -1 when standing still. */
  dir: number;
  /** Progress (0..1) from tile (x,y) toward the next tile in `dir`. */
  p: number;
}

interface Ghost extends Mover {
  id: number;
  name: string;
  color: string;
  state: GhostState;
  releaseT: number;
  /** Turn around at the next tile (the scatter/chase switch and a power bit do this). */
  turn: boolean;
}

const GHOSTS = [
  { name: 'NULL', color: '#ff4d4d', corner: { x: MZ_W - 1, y: -2 } },
  { name: 'LAG', color: '#ff9ad9', corner: { x: 0, y: -2 } },
  { name: 'STATIC', color: '#3fe0ff', corner: { x: MZ_W - 1, y: MZ_H + 1 } },
  { name: '404', color: '#ffae42', corner: { x: 0, y: MZ_H + 1 } },
];
/** Seconds of scatter then chase, repeated; the last chase never ends. */
const WAVES = [7, 20, 7, 20, 5, 20, 5, 1e9];
const THEMES = ['#3f6fff', '#b07aff', '#ff3fa4', '#2fd8b0'];
const opposite = (d: number): number => (d + 2) % 4;

export class MunchMode extends ModeBase {
  gesture = 'topdown' as const;
  gestureHint = 'DRAG: STEER • EAT EVERY BIT • POWER BITS TURN THE GHOSTS';
  id = 'munch';
  crt = 0.4;
  hp: number;
  map: MazeMap;
  /** 'o' and '.' tiles still holding a bit. */
  bits: boolean[][];
  left: number;
  total: number;
  pl: Mover;
  want = -1;
  ghosts: Ghost[] = [];
  phase: Phase = 'intro';
  phaseT = 1.6;
  score = 0;
  eatenChain = 0;
  frightT = 0;
  private wave = 0;
  private waveT = 0;
  private mouth = 0;
  private bonus: { t: number; index: number } | null = null;
  private bonusCooldown = 0;
  private eaten = 0;
  private sfxTick = 0;
  private layer: HTMLCanvasElement | null = null;
  endT = 0;

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'munch', opts);
    this.map = generateMaze(this.seed);
    this.hp = this.stats.maxHp;
    this.applyCarry();
    this.bits = this.map.tiles.map((row) => row.map((c) => c === '.' || c === 'o'));
    this.total = this.left = this.map.pellets;
    this.pl = { x: this.map.start.x, y: this.map.start.y, dir: -1, p: 0 };
    this.resetActors();
  }

  enter(): void {
    this.game.music('munch');
    if (!this.game.profile.lore.includes('munch_intro')) {
      this.game.profile.lore.push('munch_intro');
      this.game.say([
        { who: 'manual', name: 'THE MANUAL', text: 'A maze, a hungry cartridge and four glitch ghosts. Eat every bit to clear it. The big power bits make the ghosts edible for a few seconds.' },
        { who: 'manual', name: 'THE MANUAL', text: 'Arrows steer (the turn happens at the next corner). Each ghost hunts differently, so learn them. The tunnel wraps around, and ghosts are slow in it. Floppy disks appear as the maze empties.' },
      ]);
    }
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: this.phase === 'play', bossActive: false };
  }
  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  // ---- setup ------------------------------------------------------------------------
  private resetActors(): void {
    const s = this.map.start;
    this.pl = { x: s.x, y: s.y, dir: -1, p: 0 };
    this.want = -1;
    const starts = this.map.ghostStarts;
    // NULL waits just outside the door, the rest are released from the pen one by one
    const release = [0, 2.5, 6, 10];
    this.ghosts = GHOSTS.map((g, i) => ({
      id: i,
      name: g.name,
      color: g.color,
      x: starts[i].x,
      y: starts[i].y,
      dir: i === 0 ? 1 : -1,
      p: 0,
      state: i === 0 ? 'normal' : 'pen',
      releaseT: release[i],
      turn: false,
    }));
    this.frightT = 0;
    this.eatenChain = 0;
  }

  // ---- numbers ----------------------------------------------------------------------
  private get ghostSpeed(): number {
    return 4.0 * Math.pow(this.diffMult, 0.35) * (this.director.flag('ghost_rush') ? 1.3 : 1);
  }
  private get frightSeconds(): number {
    return clamp(7.5 - (this.diffMult - 1) * 3.5, 3, 10);
  }
  private scattering(): boolean {
    return this.wave % 2 === 0;
  }
  private passable(x: number, y: number, ghost: boolean): boolean {
    const c = this.map.tiles[y]?.[x];
    return c !== undefined && (isFloor(c) || (ghost && c === '='));
  }
  private open(m: Mover, dir: number, ghost: boolean): boolean {
    return neighbours(this.map, m.x, m.y, ghost).some((n) => n.dir === dir);
  }

  // ---- simulation -------------------------------------------------------------------
  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    this.tickShared(dt);
    if (this.phase === 'won' || this.phase === 'lost') {
      this.endT += dt;
      if (this.phase === 'won' && this.endT > 2.2) {
        this.finish(true, this.score + this.hp * 300 + Math.max(0, 4000 - Math.floor(this.time * 15)) + this.runBits * 10);
      } else if (this.phase === 'lost' && this.endT > 1.8) this.finish(false, this.score);
      return;
    }
    if (this.phase === 'intro') {
      if (this.game.inDialog) return;
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        this.phase = 'play';
        this.say('GO!', '#fff36b');
      }
      return;
    }
    this.readInput();
    if (this.phase === 'dying') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.hp <= 0) {
          this.phase = 'lost';
          this.endT = 0;
          this.say('GAME OVER', '#ff3f5a');
        } else {
          this.resetActors();
          this.phase = 'ready';
          this.phaseT = 1.4;
        }
      }
      return;
    }
    if (this.phase === 'ready') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.phase = 'play';
      return;
    }

    this.mouth += dt * 12;
    this.runClock(dt);
    this.movePlayer(dt);
    for (const g of this.ghosts) this.moveGhost(g, dt);
    this.collide();
    this.updateBonus(dt);
    if (this.left <= 0 && this.phase === 'play') this.win();
  }

  private say(text: string, color: string): void {
    this.popups.add(OX + 10.5 * T, OY + 8 * T - 14, text, color);
  }

  private readInput(): void {
    const inp = this.game.input;
    const flip = this.director.flag('wrong_way');
    const map: Array<[Parameters<typeof inp.pressed>[0], number]> = [['up', 0], ['left', 1], ['down', 2], ['right', 3]];
    let any = -1;
    for (const [a, d] of map) {
      const dir = flip ? opposite(d) : d;
      if (inp.pressed(a)) {
        this.want = dir;
        return;
      }
      if (inp.held(a)) any = dir;
    }
    // a held key keeps steering; releasing everything keeps the last wish (so a turn can still be taken at the corner)
    if (any >= 0) this.want = any;
  }

  /** Walks a mover along the tile grid: `choose` picks a direction at every tile centre. */
  private walk(m: Mover, speed: number, dt: number, choose: (m: Mover) => number, arrived: (m: Mover) => void): void {
    let remaining = speed * dt;
    let guard = 0;
    while (remaining > 1e-6 && guard++ < 8) {
      if (m.p === 0) {
        m.dir = choose(m);
        if (m.dir < 0) return;
      }
      const step = Math.min(remaining, 1 - m.p);
      m.p += step;
      remaining -= step;
      if (m.p >= 1 - 1e-9) {
        m.p = 0;
        m.x = (m.x + DIRS[m.dir].x + MZ_W) % MZ_W;
        m.y += DIRS[m.dir].y;
        arrived(m);
      }
    }
  }

  private movePlayer(dt: number): void {
    const m = this.pl;
    // turning back is allowed at any moment
    if (m.dir >= 0 && m.p > 0 && this.want === opposite(m.dir)) {
      m.x = (m.x + DIRS[m.dir].x + MZ_W) % MZ_W;
      m.y += DIRS[m.dir].y;
      m.dir = opposite(m.dir);
      m.p = 1 - m.p;
    }
    this.walk(m, 5.2, dt, (mv) => {
      if (this.want >= 0 && this.open(mv, this.want, false)) return this.want;
      if (mv.dir >= 0 && this.open(mv, mv.dir, false)) return mv.dir;
      return -1;
    }, (mv) => this.eatAt(mv.x, mv.y));
  }

  private eatAt(x: number, y: number): void {
    if (this.bits[y][x]) {
      const power = this.map.tiles[y][x] === 'o';
      this.bits[y][x] = false;
      this.left--;
      this.eaten++;
      this.score += power ? 50 : 10;
      if (!power) {
        if (this.eaten % 5 === 0) this.addBits(1);
        if (++this.sfxTick % 2 === 0) this.game.audio.sfx('coin');
      } else {
        this.addBits(3, OX + x * T + 8, OY + y * T);
        this.game.audio.sfx('powerup');
        this.frightT = this.frightSeconds;
        this.eatenChain = 0;
        for (const g of this.ghosts) {
          if (g.state === 'normal') {
            g.state = 'fright';
            g.turn = true;
          }
        }
        this.director.feed(6);
      }
    }
    const b = this.bonus;
    if (b && x === this.map.bonus.x && y === this.map.bonus.y) {
      this.collectFloppy(b.index);
      this.score += 500;
      this.bonus = null;
      this.bonusCooldown = 8;
    }
  }

  private runClock(dt: number): void {
    // scatter / chase waves
    this.waveT += dt;
    if (this.waveT >= WAVES[this.wave]) {
      this.waveT = 0;
      this.wave++;
      for (const g of this.ghosts) if (g.state === 'normal') g.turn = true;
    }
    if (this.frightT > 0) {
      this.frightT -= dt;
      if (this.frightT <= 0) {
        for (const g of this.ghosts) if (g.state === 'fright') g.state = 'normal';
      }
    }
    for (const g of this.ghosts) if (g.state === 'pen') {
      g.releaseT -= dt;
      if (g.releaseT <= 0) g.state = 'leave';
    }
  }

  private target(g: Ghost): { x: number; y: number } {
    if (this.scattering()) return GHOSTS[g.id].corner;
    const pl = this.pl;
    const d = pl.dir >= 0 ? DIRS[pl.dir] : { x: 0, y: 0 };
    switch (g.id) {
      case 0: return { x: pl.x, y: pl.y };
      case 1: return { x: pl.x + d.x * 4, y: pl.y + d.y * 4 };
      case 2: {
        const ahead = { x: pl.x + d.x * 2, y: pl.y + d.y * 2 };
        const n = this.ghosts[0];
        return { x: ahead.x * 2 - n.x, y: ahead.y * 2 - n.y };
      }
      default: {
        const far = Math.hypot(g.x - pl.x, g.y - pl.y) > 7;
        return far ? { x: pl.x, y: pl.y } : GHOSTS[3].corner;
      }
    }
  }

  private moveGhost(g: Ghost, dt: number): void {
    if (g.state === 'pen') return;
    const inTunnel = g.y === this.map.tunnelRow && (g.x <= 2 || g.x >= MZ_W - 3);
    let speed = this.ghostSpeed;
    if (g.state === 'fright') speed = 2.6;
    if (g.state === 'eaten') speed = 9;
    if (g.id === 0 && g.state === 'normal' && this.left < this.total * 0.18) speed *= 1.08; // NULL speeds up near the end
    if (inTunnel && g.state !== 'eaten') speed *= 0.5;
    this.walk(g, speed, dt, (m) => this.chooseGhost(g, m), (m) => {
      if (g.state === 'eaten' && m.x === 10 && m.y === 7) g.state = 'leave';
      else if (g.state === 'leave' && m.x === this.map.door.x && m.y === this.map.door.y) {
        g.state = this.frightT > 0 ? 'fright' : 'normal';
        g.turn = false;
      }
    });
  }

  private chooseGhost(g: Ghost, m: Mover): number {
    if (g.state === 'leave' || g.state === 'eaten') {
      const goal = g.state === 'eaten' ? { x: 10, y: 7 } : this.map.door;
      const step = mazeStep(this.map, m.x, m.y, goal.x, goal.y, true);
      return step ? step.dir : -1;
    }
    const opts = neighbours(this.map, m.x, m.y, false);
    if (!opts.length) return -1;
    if (g.turn) {
      g.turn = false;
      if (m.dir >= 0 && opts.some((n) => n.dir === opposite(m.dir))) return opposite(m.dir);
    }
    let cands = opts.filter((n) => m.dir < 0 || n.dir !== opposite(m.dir));
    if (!cands.length) cands = opts;
    if (g.state === 'fright') return this.rng.pick(cands).dir;
    const t = this.target(g);
    let best = cands[0];
    let bd = Infinity;
    for (const c of cands) {
      const d = (c.x - t.x) ** 2 + (c.y - t.y) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best.dir;
  }

  private pos(m: Mover): { x: number; y: number } {
    const d = m.dir >= 0 ? DIRS[m.dir] : { x: 0, y: 0 };
    return { x: m.x + d.x * m.p, y: m.y + d.y * m.p };
  }

  private collide(): void {
    const a = this.pos(this.pl);
    for (const g of this.ghosts) {
      if (g.state === 'pen' || g.state === 'eaten' || g.state === 'leave') continue;
      const b = this.pos(g);
      // across the tunnel seam the positions jump by the maze width; ignore that wrap
      if (Math.abs(a.x - b.x) > 2 || Math.hypot(a.x - b.x, a.y - b.y) > 0.6) continue;
      if (g.state === 'fright') {
        g.state = 'eaten';
        const pts = 200 * 2 ** this.eatenChain++;
        this.score += pts;
        this.addBits(2, OX + b.x * T + 8, OY + b.y * T);
        this.popups.add(OX + b.x * T + 8, OY + b.y * T - 8, `${pts}`, g.color);
        this.game.audio.sfx('explode');
        this.runFlags.add('ghost_eaten');
        this.director.feed(4);
        if (this.eatenChain >= 4) this.runFlags.add('ghost_feast');
      } else {
        this.hurt();
        return;
      }
    }
  }

  private hurt(): void {
    const dmg = this.takenMult;
    this.hp = Math.max(0, this.hp - dmg);
    this.noteDamage(dmg);
    this.phase = 'dying';
    this.phaseT = 1.3;
    this.director.clearAll();
  }

  private updateBonus(dt: number): void {
    const found = this.foundFloppies.length;
    if (this.bonus) {
      this.bonus.t -= dt;
      if (this.bonus.t <= 0) {
        this.bonus = null;
        this.bonusCooldown = 6;
      }
      return;
    }
    this.bonusCooldown = Math.max(0, this.bonusCooldown - dt);
    // a floppy appears at 25%, 50% and 75% of the maze eaten, until all three are found
    const idx = [0, 1, 2].find((i) => !this.foundFloppies.includes(`munch-${i}`));
    if (idx === undefined || found >= 3) return;
    if (this.eaten >= Math.floor(this.total * 0.25 * (idx + 1)) && this.bonusCooldown <= 0) this.bonus = { t: 14, index: idx };
  }

  private win(): void {
    this.phase = 'won';
    this.endT = 0;
    this.addBits(40);
    this.say('MAZE CLEARED!', '#7dff6b');
    this.game.audio.sfx('levelup');
    this.game.fx.flash('#7dff6b', 0.35);
    for (const g of this.ghosts) g.state = 'fright';
  }

  // ---- drawing ----------------------------------------------------------------------
  private buildLayer(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = MZ_W * T;
    c.height = MZ_H * T;
    const g = c.getContext('2d')!;
    const line = THEMES[this.map.theme % THEMES.length];
    for (let y = 0; y < MZ_H; y++) {
      for (let x = 0; x < MZ_W; x++) {
        const t = this.map.tiles[y][x];
        const px = x * T, py = y * T;
        if (t === '#') {
          rect(g, px, py, T, T, '#07061c');
          const floor = (dx: number, dy: number): boolean => {
            const n = this.map.tiles[y + dy]?.[(x + dx + MZ_W) % MZ_W];
            // the screen edge counts as wall except where the tunnel opens
            return n !== undefined && n !== '#';
          };
          if (floor(0, -1)) rect(g, px, py, T, 2, line);
          if (floor(0, 1)) rect(g, px, py + T - 2, T, 2, line);
          if (x > 0 && floor(-1, 0)) rect(g, px, py, 2, T, line);
          if (x < MZ_W - 1 && floor(1, 0)) rect(g, px + T - 2, py, 2, T, line);
        } else if (t === '=') {
          rect(g, px, py + 6, T, 3, '#ff9ad9');
        }
      }
    }
    return c;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    backdrop(ctx, '#05020d', '#120a2a');
    glow(ctx, OX + (MZ_W * T) / 2, OY + (MZ_H * T) / 2, 190, '63,111,255', 0.1);
    if (!this.layer) this.layer = this.buildLayer();
    ctx.drawImage(this.layer, OX, OY);
    this.drawBits(ctx);
    if (this.bonus) drawFloppy(ctx, OX + this.map.bonus.x * T + 8, OY + this.map.bonus.y * T + 8, this.time);
    if (this.phase !== 'dying' || this.phaseT > 0.5) for (const g of this.ghosts) this.drawGhost(ctx, g);
    this.drawPlayer(ctx);
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    this.drawHud(ctx);
  }

  private drawBits(ctx: CanvasRenderingContext2D): void {
    const blink = Math.floor(this.time * 4) % 2 === 0;
    for (let y = 0; y < MZ_H; y++) {
      for (let x = 0; x < MZ_W; x++) {
        if (!this.bits[y][x]) continue;
        const cx = OX + x * T + 8, cy = OY + y * T + 8;
        if (this.map.tiles[y][x] === 'o') {
          if (blink) rect(ctx, cx - 4, cy - 4, 8, 8, '#fff36b');
          else rect(ctx, cx - 3, cy - 3, 6, 6, '#ffe9a0');
        } else rect(ctx, cx - 1, cy - 1, 3, 3, '#ffe9a0');
      }
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const p = this.pos(this.pl);
    const cx = OX + p.x * T + 8, cy = OY + p.y * T + 8;
    if (this.phase === 'dying') {
      // the disc folds shut
      const k = clamp(this.phaseT / 1.3, 0, 1);
      this.pie(ctx, cx, cy, 6, 0, Math.PI * (1 - k) + 0.05, '#fff36b');
      return;
    }
    const face = this.pl.dir >= 0 ? this.pl.dir : this.want >= 0 ? this.want : 3;
    const ang = [-Math.PI / 2, Math.PI, Math.PI / 2, 0][face];
    const open = this.pl.dir >= 0 || this.phase === 'play' ? Math.abs(Math.sin(this.mouth)) * 0.9 : 0.5;
    this.pie(ctx, cx, cy, 6, ang, open, '#fff36b');
  }

  /** A pixel-art disc with a wedge cut out (mouth) around `ang`. */
  private pie(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, ang: number, mouth: number, color: string): void {
    ctx.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        if (mouth > 0.05) {
          let a = Math.atan2(dy, dx) - ang;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          if (Math.abs(a) < mouth && dx * dx + dy * dy > 2) continue;
        }
        ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
      }
    }
    rect(ctx, cx - 1, cy - 4, 2, 2, '#000');
  }

  private drawGhost(ctx: CanvasRenderingContext2D, g: Ghost): void {
    const p = this.pos(g);
    const x = Math.round(OX + p.x * T + 8), y = Math.round(OY + p.y * T + 8);
    const bob = g.state === 'pen' ? Math.round(Math.sin(this.time * 6 + g.id)) : 0;
    const flashing = g.state === 'fright' && this.frightT < 2 && Math.floor(this.time * 6) % 2 === 0;
    const body = g.state === 'fright' ? (flashing ? '#ffffff' : '#2a3aff') : g.color;
    if (g.state !== 'eaten') {
      rect(ctx, x - 6, y - 3 + bob, 12, 9, body);
      rect(ctx, x - 5, y - 6 + bob, 10, 3, body);
      rect(ctx, x - 3, y - 7 + bob, 6, 1, body);
      // wavy skirt
      const w = Math.floor(this.time * 8 + g.id) % 2;
      for (let i = 0; i < 4; i++) if ((i + w) % 2 === 0) rect(ctx, x - 6 + i * 3, y + 6 + bob, 3, 2, body);
    }
    if (g.state === 'fright') {
      const f = flashing ? '#2a3aff' : '#ffe9a0';
      rect(ctx, x - 3, y - 3 + bob, 2, 2, f);
      rect(ctx, x + 1, y - 3 + bob, 2, 2, f);
      for (let i = 0; i < 4; i++) rect(ctx, x - 4 + i * 3, y + 2 + bob + (i % 2), 2, 1, f);
    } else {
      const d = g.dir >= 0 ? DIRS[g.dir] : { x: 0, y: 0 };
      rect(ctx, x - 5, y - 4 + bob, 4, 4, '#fff');
      rect(ctx, x + 1, y - 4 + bob, 4, 4, '#fff');
      rect(ctx, x - 4 + d.x * 1 + 1, y - 3 + bob + d.y * 1 + 1, 2, 2, '#1a2aff');
      rect(ctx, x + 2 + d.x * 1 + 1, y - 3 + bob + d.y * 1 + 1, 2, 2, '#1a2aff');
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    const x = OX + MZ_W * T + 18;
    this.drawChaosHud(ctx, W - 106, 6);
    hearts(ctx, x, 50, this.hp, this.stats.maxHp);
    drawText(ctx, 'SCORE', x, 62, '#9a9ab8');
    drawText(ctx, `${this.score}`, x, 72, '#fff');
    drawText(ctx, 'BITS LEFT', x, 86, '#9a9ab8');
    bar(ctx, x, 96, 62, 4, 1 - this.left / this.total, '#fff36b', '#201a08', '#ffffff55');
    drawText(ctx, `${this.left}`, x + 68, 94, '#fff36b');
    this.drawRunInfo(ctx, x, 108);
    GHOSTS.forEach((gh, i) => {
      const g = this.ghosts[i];
      const state = g?.state === 'fright' ? 'SCARED' : g?.state === 'eaten' ? 'EYES' : g?.state === 'pen' ? 'WAITING' : this.scattering() ? 'SCATTER' : 'CHASE';
      drawText(ctx, gh.name, x, 168 + i * 10, gh.color);
      drawText(ctx, state, x + 40, 168 + i * 10, '#9a9ab8');
    });
    if (this.frightT > 0) bar(ctx, OX, OY - 7, MZ_W * T, 3, this.frightT / this.frightSeconds, '#3f6fff', '#080a20', '#ffffff44');
    if (this.phase === 'intro' || this.phase === 'ready') drawText(ctx, 'READY!', OX + (MZ_W * T) / 2, OY + 8 * T + 2, '#fff36b', { align: 'center', scale: 2 });
    if (this.phase === 'lost') drawText(ctx, 'GAME OVER', OX + (MZ_W * T) / 2, OY + 8 * T + 2, '#ff3f5a', { align: 'center', scale: 2 });
    this.drawHint(ctx, 'ARROWS STEER • EAT EVERY BIT • POWER BITS MAKE GHOSTS EDIBLE');
    this.drawSeed(ctx);
    void H;
  }
}
