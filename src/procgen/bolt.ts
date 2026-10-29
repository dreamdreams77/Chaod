/**
 * BOLT BRIGADE stage generator and master data. A stage is a flat-ish run of segments (flats,
 * steps, pits, spike rows, platform bridges) ending in a boss door and a fixed arena, built so
 * every gap and step is within what the player's jump can do. Seeded, validated, headless.
 */
import { Rng, seedFromString } from '../core/rng.ts';

export const TILE = 16;
export const ROWS = 17;
/** The boss arena is one screen wide, at the end of the stage. */
export const ARENA_TILES = 30;
export const MAX_GAP = 3;
export const MAX_STEP = 2;
export const MIN_GROUND = 9;
export const MAX_GROUND = 14;

export type WeaponId = 'buster' | 'ice' | 'flame' | 'leaf' | 'volt' | 'tide' | 'rock';
export type MasterId = 'frostbyte' | 'flarebot' | 'sproutron' | 'voltwire' | 'aquabyte' | 'tremorbot';
export type AttackId = 'dash' | 'arc' | 'fan' | 'column' | 'leap' | 'rain' | 'wave' | 'quake';
export type HazardKind = 'spike' | 'zap' | 'jet';
export type EnemyKind = 'walker' | 'turret' | 'flyer' | 'hopper';
/** `life` is a 1UP, `tank` an energy tank; every stage hides one of each. */
export type PickupKind = 'hp' | 'we' | 'bit' | 'life' | 'tank';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  color: string;
  damage: number;
  cost: number;
  desc: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  buster: { id: 'buster', name: 'BUSTER', color: '#3f9fff', damage: 1, cost: 0, desc: 'Hold to charge a piercing shot.' },
  ice: { id: 'ice', name: 'ICE SHARD', color: '#9fe8ff', damage: 2, cost: 1, desc: 'Three shards; freezes small foes.' },
  flame: { id: 'flame', name: 'FLAME WAVE', color: '#ff7a1a', damage: 2, cost: 1, desc: 'A short burst that pierces.' },
  leaf: { id: 'leaf', name: 'LEAF SHIELD', color: '#7dff6b', damage: 2, cost: 2, desc: 'Leaves orbit you and block shots.' },
  volt: { id: 'volt', name: 'VOLT BOLT', color: '#ffe23f', damage: 3, cost: 2, desc: 'A fast zig-zag bolt.' },
  tide: { id: 'tide', name: 'TIDE BUBBLE', color: '#5fb0ff', damage: 2, cost: 1, desc: 'A bubble that bounces along the floor.' },
  rock: { id: 'rock', name: 'BOULDER BOMB', color: '#d9a066', damage: 3, cost: 3, desc: 'A lobbed rock that bursts on impact.' },
};

export interface MasterDef {
  id: MasterId;
  name: string;
  title: string;
  color: string;
  dark: string;
  weapon: WeaponId;
  /** The weapon this master is weak to (3x damage). */
  weakTo: WeaponId;
  attacks: AttackId[];
  hazard: HazardKind;
  /** Which floppy disk (0-2) hides in this stage, if any. */
  floppy: number | null;
  /** Base hit points. */
  hp: number;
  /** Slippery floor? */
  slippery: boolean;
  /** Gravity multiplier for this stage (below 1 is floaty; jumps keep their height). */
  grav: number;
}

/** A ring of six: ice beats fire, fire beats leaf, leaf beats volt, volt beats tide, tide beats rock, rock beats ice. */
export const MASTERS: MasterDef[] = [
  { id: 'frostbyte', name: 'FROSTBYTE', title: 'The Freezer Burn', color: '#9fe8ff', dark: '#1a4a66', weapon: 'ice', weakTo: 'rock', attacks: ['dash', 'arc', 'leap'], hazard: 'spike', floppy: 0, hp: 26, slippery: true, grav: 1 },
  { id: 'flarebot', name: 'FLAREBOT', title: 'The Overheated', color: '#ff7a1a', dark: '#5a1a0a', weapon: 'flame', weakTo: 'ice', attacks: ['arc', 'leap', 'rain'], hazard: 'jet', floppy: 1, hp: 26, slippery: false, grav: 1 },
  { id: 'sproutron', name: 'SPROUTRON', title: 'The Overgrown', color: '#7dff6b', dark: '#1a4a1a', weapon: 'leaf', weakTo: 'flame', attacks: ['fan', 'leap', 'dash'], hazard: 'spike', floppy: 2, hp: 28, slippery: false, grav: 1 },
  { id: 'voltwire', name: 'VOLTWIRE', title: 'The Short Circuit', color: '#ffe23f', dark: '#4a4a0a', weapon: 'volt', weakTo: 'leaf', attacks: ['column', 'dash', 'fan'], hazard: 'zap', floppy: null, hp: 28, slippery: false, grav: 1 },
  { id: 'aquabyte', name: 'AQUABYTE', title: 'The Flood', color: '#3f8fff', dark: '#0a2a5a', weapon: 'tide', weakTo: 'volt', attacks: ['wave', 'arc', 'fan'], hazard: 'jet', floppy: null, hp: 30, slippery: false, grav: 0.78 },
  { id: 'tremorbot', name: 'TREMORBOT', title: 'The Landslide', color: '#d9a066', dark: '#4a2e14', weapon: 'rock', weakTo: 'tide', attacks: ['quake', 'dash', 'leap'], hazard: 'spike', floppy: null, hp: 32, slippery: false, grav: 1 },
];
export const MASTER_BY_ID = new Map(MASTERS.map((m) => [m.id, m]));

export interface Plat {
  x: number;
  y: number;
  w: number;
}
export interface Spawn {
  x: number;
  y: number;
}
export interface BoltLevel {
  seed: number;
  master: MasterId;
  /** Tiles across, including the boss arena. */
  width: number;
  /** Row of the top of the ground in each column; ROWS means a pit. */
  ground: number[];
  platforms: Plat[];
  hazards: Array<Spawn & { kind: HazardKind }>;
  enemies: Array<Spawn & { kind: EnemyKind }>;
  pickups: Array<Spawn & { kind: PickupKind }>;
  floppy: Spawn | null;
  checkpoint: number;
  /** First tile of the boss arena (the door sits just before it). */
  arenaX: number;
}

/** Builds the tile grid (true = solid) for collision. */
export function solidGrid(l: BoltLevel): boolean[][] {
  const g = Array.from({ length: ROWS }, () => new Array(l.width).fill(false));
  for (let x = 0; x < l.width; x++) for (let y = l.ground[x]; y < ROWS; y++) g[y][x] = true;
  for (const p of l.platforms) for (let x = p.x; x < p.x + p.w; x++) if (x >= 0 && x < l.width && p.y >= 0 && p.y < ROWS) g[p.y][x] = true;
  return g;
}

export function generateBolt(seed: number, master: MasterId): BoltLevel {
  const m = MASTER_BY_ID.get(master)!;
  const rng = new Rng(seed ^ seedFromString(master) ^ 0xb017);
  const body = 100 + rng.int(0, 16);
  const width = body + ARENA_TILES;
  const ground: number[] = new Array(width).fill(13);
  const platforms: Plat[] = [];
  const hazards: BoltLevel['hazards'] = [];
  const enemies: BoltLevel['enemies'] = [];
  const pickups: BoltLevel['pickups'] = [];
  let floppy: Spawn | null = null;
  let row = 13;
  let x = 10; // the first ten columns are a flat start
  let sinceEnemy = 0;
  const setFlat = (from: number, len: number) => {
    for (let i = 0; i < len && from + i < body; i++) ground[from + i] = row;
  };
  // Segments must finish before the run-up to the arena, so nothing is ever cut off mid-pit.
  const NEED: Record<string, number> = { flat: 12, step: 9, pit: 8, spikes: 11, bridge: 23, climb: 12, stairs: 17, canyon: 15, gauntlet: 16 };
  const limit = body - 14;
  while (x < limit - 4) {
    let kind = rng.weighted(['flat', 'flat', 'step', 'pit', 'spikes', 'bridge', 'climb', 'stairs', 'canyon', 'gauntlet'], () => 1) as string;
    if (x + NEED[kind] > limit) kind = 'flat';
    if (kind === 'flat') {
      const len = Math.max(2, Math.min(rng.int(6, 12), limit - x));
      setFlat(x, len);
      // enemies and bits on the flat
      if (rng.chance(0.75) && len >= 7) {
        const e = rng.pick<EnemyKind>(['walker', 'walker', 'hopper', 'turret', 'flyer']);
        enemies.push({ x: x + Math.floor(len / 2), y: e === 'flyer' ? row - 4 - rng.int(0, 2) : row - 1, kind: e });
        sinceEnemy = 0;
      } else sinceEnemy++;
      if (rng.chance(0.5)) for (let i = 0; i < 3; i++) pickups.push({ x: x + 2 + i, y: row - 2, kind: 'bit' });
      if (m.hazard === 'jet' && len >= 8 && rng.chance(0.6)) hazards.push({ x: x + len - 3, y: row - 1, kind: 'jet' });
      x += len;
    } else if (kind === 'step') {
      const d = (rng.chance(0.5) ? -1 : 1) * rng.int(1, MAX_STEP);
      const next = Math.max(MIN_GROUND, Math.min(MAX_GROUND, row + d));
      row = next;
      const len = rng.int(5, 9);
      setFlat(x, len);
      if (rng.chance(0.4)) enemies.push({ x: x + 3, y: row - 1, kind: rng.pick<EnemyKind>(['walker', 'turret']) });
      x += len;
    } else if (kind === 'pit') {
      const gap = rng.int(2, MAX_GAP);
      for (let i = 0; i < gap; i++) ground[x + i] = ROWS;
      // a bit trail over the gap rewards the jump
      for (let i = 0; i < gap; i++) pickups.push({ x: x + i, y: row - 3 - (i === 1 ? 1 : 0), kind: 'bit' });
      x += gap;
      setFlat(x, 5);
      x += 5;
    } else if (kind === 'spikes') {
      const len = rng.int(2, 3);
      setFlat(x, len + 8); // room to land and take off again after the hop
      const hk: HazardKind = m.hazard === 'jet' ? 'spike' : m.hazard;
      for (let i = 0; i < len; i++) hazards.push({ x: x + 3 + i, y: row - 1, kind: hk });
      x += len + 8;
    } else if (kind === 'bridge') {
      // A long pit crossed on three floating platforms: every hop is within MAX_GAP and MAX_STEP.
      const w = 3;
      const gaps = [2, 3, 2];
      const total = gaps.reduce((a, b) => a + b, 0) + w * 3 + 2;
      for (let i = 0; i < total; i++) ground[x + i] = ROWS;
      let px = x + 1;
      let py = row;
      for (let i = 0; i < 3; i++) {
        px += gaps[i] - (i === 0 ? 1 : 0);
        py = Math.max(MIN_GROUND + 1, Math.min(MAX_GROUND, py + (i === 1 ? -1 : i === 2 ? 1 : 0)));
        platforms.push({ x: px, y: py, w });
        pickups.push({ x: px + 1, y: py - 2, kind: 'bit' });
        px += w;
      }
      x += total;
      setFlat(x, 5);
      x += 5;
    } else if (kind === 'stairs') {
      // Four one-row steps, up or down (whichever stays on the map), with a gunner waiting at the far end.
      let dir = rng.chance(0.5) ? -1 : 1;
      const room = (d: number) => (d < 0 ? row - MIN_GROUND : MAX_GROUND - row);
      if (room(dir) < room(-dir)) dir = -dir;
      const steps = Math.min(4, room(dir));
      setFlat(x, 2);
      x += 2;
      for (let i = 0; i < steps; i++) {
        row += dir;
        setFlat(x, 3);
        if (i === 1) pickups.push({ x: x + 1, y: row - 2, kind: 'bit' });
        x += 3;
      }
      setFlat(x, 2);
      enemies.push({ x: x - 2, y: row - 1, kind: rng.pick<EnemyKind>(['turret', 'walker', 'hopper']) });
      x += 2;
      sinceEnemy = 0;
    } else if (kind === 'canyon') {
      // Two pits with a small island between them: two hops in a row, no room to dawdle.
      const g1 = rng.int(2, MAX_GAP);
      for (let i = 0; i < g1; i++) ground[x + i] = ROWS;
      x += g1;
      setFlat(x, 2);
      pickups.push({ x, y: row - 2, kind: 'bit' });
      pickups.push({ x: x + 1, y: row - 2, kind: 'bit' });
      x += 2;
      const g2 = rng.int(2, MAX_GAP);
      for (let i = 0; i < g2; i++) ground[x + i] = ROWS;
      x += g2;
      setFlat(x, 6);
      x += 6;
    } else if (kind === 'gauntlet') {
      // A long flat with a crowd: a walker, a hopper and a turret in a row.
      setFlat(x, 14);
      enemies.push({ x: x + 3, y: row - 1, kind: 'walker' });
      enemies.push({ x: x + 7, y: row - 1, kind: 'hopper' });
      enemies.push({ x: x + 12, y: row - 1, kind: 'turret' });
      for (let i = 0; i < 3; i++) pickups.push({ x: x + 5 + i, y: row - 2, kind: 'bit' });
      x += 14;
      sinceEnemy = 0;
    } else {
      // A raised nook with a prize, reached by two stacked platforms beside the flat.
      const len = 12;
      setFlat(x, len);
      platforms.push({ x: x + 3, y: row - 3, w: 3 });
      platforms.push({ x: x + 7, y: row - 5, w: 3 });
      pickups.push({ x: x + 8, y: row - 7, kind: rng.pick(['hp', 'we', 'bit'] as const) });
      x += len;
    }
    if (sinceEnemy > 3) {
      enemies.push({ x: x - 4, y: row - 5, kind: 'flyer' });
      sinceEnemy = 0;
    }
  }
  // The approach to the boss door: a short flat, then gentle steps back down (or up) to the arena's level.
  const arenaX = body;
  for (let i = x; i < Math.min(x + 2, arenaX - 6); i++) ground[i] = row;
  x += 2;
  while (row !== 13 && x + 3 <= arenaX - 6) {
    row += Math.sign(13 - row) * Math.min(MAX_STEP, Math.abs(13 - row));
    for (let i = x; i < x + 3; i++) ground[i] = row;
    x += 3;
  }
  for (let i = x; i < arenaX - 6; i++) ground[i] = row;
  // Arena: a clean flat at one height.
  for (let i = arenaX - 6; i < width; i++) ground[i] = 13;
  // Platforms may not float inside the arena approach, and need headroom: two clear rows between a
  // platform's underside and the ground below it (the player is just over one tile tall).
  const keep = platforms.filter((p) => {
    if (p.x + p.w >= arenaX - 6) return false;
    for (let c = p.x; c < p.x + p.w; c++) if (ground[c] < ROWS && ground[c] - (p.y + 1) < 2 && ground[c] > p.y) return false;
    return true;
  });
  platforms.length = 0;
  platforms.push(...keep);
  // The checkpoint sits near the middle, slid onto solid ground.
  let cp = Math.floor(body / 2);
  while (cp < body - 8 && (ground[cp] >= ROWS || ground[cp + 1] >= ROWS || ground[cp - 1] >= ROWS)) cp++;
  // Pickups: a heart before the checkpoint and one near the door, weapon energy twice.
  const spot = (at: number): number => {
    let c = at;
    while (c < body - 8 && ground[c] >= ROWS) c++;
    return c;
  };
  for (const [at, kind] of [[Math.floor(body * 0.3), 'hp'], [Math.floor(body * 0.62), 'we'], [Math.floor(body * 0.85), 'hp'], [Math.floor(body * 0.45), 'we']] as const) {
    const c = spot(at);
    pickups.push({ x: c, y: ground[c] - 2, kind });
  }
  // Hidden prizes: one 1UP and one energy tank per stage, up on platforms when there are any.
  const floppyNook = m.floppy !== null ? platforms.filter((p) => p.y <= MAX_GROUND - 4 && p.x > 12 && p.x < arenaX - 10).sort((a, b) => a.y - b.y)[0] : undefined;
  const perches = platforms.filter((p) => p !== floppyNook && p.x > 14 && p.x + p.w < arenaX - 10).sort((a, b) => a.y - b.y);
  const perch = (n: number, edge: 'left' | 'right', fallbackAt: number, kind: 'life' | 'tank'): void => {
    const p = perches[n];
    if (p) {
      pickups.push({ x: edge === 'left' ? p.x : p.x + p.w - 1, y: p.y - 2, kind });
      return;
    }
    // No platform to perch on: a spot on level ground, a jump up unless a platform already fills that tile.
    let c = spot(Math.floor(body * fallbackAt));
    const onPlatform = (cx: number, cy: number) => platforms.some((q) => q.y === cy && cx >= q.x && cx < q.x + q.w);
    while (c < body - 8 && onPlatform(c, ground[c] - 3)) c = spot(c + 1);
    pickups.push({ x: c, y: ground[c] - (onPlatform(c, ground[c] - 3) ? 2 : 3), kind });
  };
  perch(0, 'left', 0.72, 'life');
  perch(1, 'right', 0.38, 'tank');
  if (m.floppy !== null) {
    // The disk floats over a pit-bridge or nook if there is one, else on a high platform near the middle.
    const nook = floppyNook;
    if (nook) floppy = { x: nook.x + 1, y: nook.y - 2 };
    else {
      // Over a stretch of level ground, so the platform always has headroom.
      let c = spot(Math.floor(body * 0.7));
      const flatHere = (at: number) => [0, 1, 2, 3, 4].every((i) => ground[at + i] === ground[at] && ground[at] < ROWS);
      while (c < body - 12 && !flatHere(c)) c++;
      platforms.push({ x: c + 1, y: ground[c] - 4, w: 3 });
      floppy = { x: c + 2, y: ground[c] - 6 };
    }
  }
  // Every stage has something to shoot: top up with walkers on level ground if the dice were kind.
  for (let c = 18; enemies.filter((e) => e.x > 11 && e.x < arenaX - 8).length < 5 && c < arenaX - 14; c += 7) {
    const level = [0, 1, 2, 3].every((i) => ground[c + i] === ground[c] && ground[c] < ROWS) && !platforms.some((p) => c + 1 >= p.x - 1 && c + 1 <= p.x + p.w);
    if (level) enemies.push({ x: c + 1, y: ground[c] - 1, kind: 'walker' });
    else enemies.push({ x: c + 1, y: 7 + (c % 3), kind: 'flyer' });
  }
  // Drop anything that ended up inside the ground or off the stage.
  const inGround = (s: Spawn) => s.x < 0 || s.x >= width || s.y >= ground[Math.max(0, Math.min(width - 1, s.x))] || s.y < 0;
  return {
    seed,
    master,
    width,
    ground,
    platforms,
    hazards: hazards.filter((h) => !inGround(h) && h.x < arenaX - 8),
    enemies: enemies.filter((e) => e.x > 11 && e.x < arenaX - 8 && (e.kind === 'flyer' || !inGround(e))),
    pickups: pickups.filter((p) => p.x >= 0 && p.x < arenaX - 4 && p.y >= 0 && p.y < ROWS),
    floppy,
    checkpoint: cp,
    arenaX,
  };
}

/** Everything a player has to be able to do, checked without playing: no gap or step beyond the jump. */
export function validateBolt(l: BoltLevel): { ok: boolean; reason?: string } {
  if (l.ground.length !== l.width) return { ok: false, reason: 'ground length' };
  if (l.arenaX < 60 || l.arenaX + ARENA_TILES !== l.width) return { ok: false, reason: 'bad arena placement' };
  for (let x = 0; x < 10; x++) if (l.ground[x] >= ROWS) return { ok: false, reason: 'the start must be solid' };
  // Walk the ground: consecutive solid columns step by at most MAX_STEP; pits are bridged or short.
  let lastSolid = 0;
  let pitStart = -1;
  for (let x = 0; x < l.width; x++) {
    const solid = l.ground[x] < ROWS;
    if (!solid && pitStart < 0) pitStart = x;
    if (solid) {
      if (pitStart >= 0) {
        const len = x - pitStart;
        if (len > MAX_GAP && !bridged(l, pitStart, x)) return { ok: false, reason: `pit of ${len} at ${pitStart} is not bridged` };
        if (Math.abs(l.ground[x] - l.ground[lastSolid]) > MAX_STEP + 0) return { ok: false, reason: `step across the pit at ${pitStart}` };
        pitStart = -1;
      } else if (Math.abs(l.ground[x] - l.ground[x - 1]) > MAX_STEP) return { ok: false, reason: `step of ${Math.abs(l.ground[x] - l.ground[x - 1])} at ${x}` };
      lastSolid = x;
    }
  }
  if (pitStart >= 0) return { ok: false, reason: 'the stage ends in a pit' };
  for (let x = l.arenaX - 2; x < l.width; x++) if (l.ground[x] !== 13) return { ok: false, reason: 'the arena must be flat' };
  if (l.checkpoint < 20 || l.checkpoint >= l.arenaX - 6) return { ok: false, reason: 'checkpoint out of range' };
  if (l.ground[l.checkpoint] >= ROWS) return { ok: false, reason: 'checkpoint over a pit' };
  for (const h of l.hazards) if (h.x >= l.arenaX - 6) return { ok: false, reason: 'hazard in the arena approach' };
  for (const p of l.platforms) for (let c = p.x; c < p.x + p.w; c++) if (l.ground[c] < ROWS && l.ground[c] > p.y && l.ground[c] - (p.y + 1) < 2) return { ok: false, reason: `platform at ${p.x} has no headroom` };
  // An island between two pits needs room to land and take off again.
  for (let x = 1; x < l.width - 1; x++) {
    if (l.ground[x] >= ROWS || l.ground[x - 1] < ROWS) continue;
    let end = x;
    while (end < l.width && l.ground[end] < ROWS) end++;
    if (end < l.width && end - x < 2) return { ok: false, reason: `an island of ${end - x} at ${x}` };
  }
  // The 1UP and the energy tank must exist and be within a jump of something to stand on.
  for (const kind of ['life', 'tank'] as const) {
    const found = l.pickups.filter((p) => p.kind === kind);
    if (found.length !== 1) return { ok: false, reason: `${found.length} ${kind} pickups` };
    const { x, y } = found[0];
    if (l.platforms.some((p) => p.y === y && x >= p.x && x < p.x + p.w) || y >= l.ground[x]) return { ok: false, reason: `the ${kind} at ${x},${y} is inside the ground` };
    const standOn = l.platforms.some((p) => x >= p.x && x < p.x + p.w && p.y > y && p.y - y <= 3) || (l.ground[x] < ROWS && l.ground[x] > y && l.ground[x] - y <= 3);
    if (!standOn) return { ok: false, reason: `the ${kind} at ${x},${y} is out of reach` };
  }
  return { ok: true };
}

/** A pit longer than MAX_GAP is fine if platforms cross it with every hop short enough. */
function bridged(l: BoltLevel, from: number, to: number): boolean {
  const ps = l.platforms.filter((p) => p.x >= from - 1 && p.x + p.w <= to + 1).sort((a, b) => a.x - b.x);
  if (ps.length === 0) return false;
  let edge = from - 1;
  let row = l.ground[Math.max(0, from - 1)];
  for (const p of ps) {
    if (p.x - edge > MAX_GAP + 1 || Math.abs(p.y - row) > MAX_STEP) return false;
    edge = p.x + p.w - 1;
    row = p.y;
  }
  return to - edge <= MAX_GAP + 1 && Math.abs(l.ground[to] - row) <= MAX_STEP;
}
