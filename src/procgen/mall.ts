/**
 * NIGHTMARE MALL map generator: a central concourse with twelve shops (six above,
 * six below), seeded loot and a validator that flood-fills the walkable tiles.
 */
import { Rng } from '../core/rng.ts';

export const MW = 50;
export const MH = 30;

export interface Store {
  name: string;
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  doorX: number;
  doorY: number;
}

export type MallItemKind = 'key' | 'floppy' | 'battery' | 'snack' | 'note' | 'chaos' | 'locker';

export interface MallItem {
  kind: MallItemKind;
  x: number;
  y: number;
  id: number;
  taken?: boolean;
}

export interface MallMap {
  seed: number;
  /** '#' wall, '.' floor, 'D' door, 's' shelf, 'E' exit. */
  tiles: string[][];
  stores: Store[];
  items: MallItem[];
  start: { x: number; y: number };
  exit: { x: number; y: number };
  monsterStart: { x: number; y: number };
}

const STORE_NAMES: Array<[string, string]> = [
  ['ARCADE ZONE', '#ff3fa4'],
  ['BE KIND VIDEO', '#3fa9ff'],
  ['FOOD COURT', '#ffcf3f'],
  ['TOY BARN', '#ff6f3f'],
  ['MIXTAPE MUSIC', '#b07aff'],
  ['PET PALACE', '#7dff6b'],
  ['GIGAHERTZ', '#3fe0ff'],
  ['CANDLE CAVE', '#ffb36b'],
  ['SNEAKER PIT', '#ff4545'],
  ['COMIC VAULT', '#ffe23f'],
  ['1-HR PHOTO', '#9dffcf'],
  ['WATERBED WORLD', '#6b8fff'],
];

export const MALL_NOTES: string[] = [
  `EMPLOYEE MEMO: Do not make eye contact with the Closing-Time Manager. He was promoted from "Mini-Boss" in 1994 and never got over it.`,
  `RECEIPT: 1x CARTRIDGE CORE CLEANING KIT. RETURNED. REASON: "THE CORE CLEANED ME".`,
  `SCRAWLED NOTE: The Manager only chases what he can hear or see. Lockers are your friend. Walking is quiet.`,
  `LOST & FOUND: One (1) page of an instruction manual. It reads: "...THE HIGH SCORE MUST NEVER BE..." The rest is torn.`,
  `SECURITY LOG: Night 3. The mall is now a survival horror game. The fountain still takes pennies.`,
];

export function mallWalkable(c: string): boolean {
  return c === '.' || c === 'D' || c === 'E';
}

/** Retries a handful of times so a bad layout never reaches the player. */
export function generateMall(seed: number): MallMap {
  const rng = new Rng(seed ^ 14865);
  for (let attempt = 0; attempt < 20; attempt++) {
    const m = build(rng, seed);
    if (validateMall(m).ok) return m;
  }
  throw new Error('mall generation failed');
}

function build(rng: Rng, seed: number): MallMap {
  const tiles: string[][] = Array.from({ length: MH }, () => Array.from({ length: MW }, () => '#'));
  const fill = (x0: number, y0: number, x1: number, y1: number, c = '.'): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y][x] = c;
  };
  fill(1, 13, MW - 2, 16);
  fill(23, 14, 26, 15, 's'); // the fountain

  const names = rng.shuffle(STORE_NAMES.slice());
  const stores: Store[] = [];
  for (let i = 0; i < 6; i++) {
    const x0 = 1 + i * 8;
    const x1 = x0 + 6;
    for (const north of [true, false]) {
      const y0 = north ? 2 : 18;
      const y1 = north ? 11 : 27;
      fill(x0, y0, x1, y1);
      const doorX = rng.int(x0 + 1, x1 - 2);
      const doorY = north ? 12 : 17;
      fill(doorX, doorY, doorX + 1, doorY, 'D');
      const [name, color] = names[stores.length];
      stores.push({ name, color, x0, y0, x1, y1, doorX, doorY });
    }
  }

  // Shelves, kept clear of the doorway.
  for (const s of stores) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const y = rng.int(s.y0 + 2, s.y1 - 2);
      const x = rng.int(s.x0 + 1, s.x1 - 3);
      const w = rng.int(2, 3);
      let ok = true;
      for (let k = 0; k < w; k++) if (tiles[y][x + k] !== '.' || (Math.abs(x + k - s.doorX) < 2 && Math.abs(y - s.doorY) < 3)) ok = false;
      if (ok) for (let k = 0; k < w; k++) tiles[y][x + k] = 's';
    }
  }

  const exit = { x: MW - 2, y: 14 };
  tiles[14][MW - 2] = 'E';
  tiles[15][MW - 2] = 'E';
  const start = { x: 2, y: 15 };

  const items: MallItem[] = [];
  let id = 0;
  const spot = (s: Store, deep = false): { x: number; y: number } => {
    for (let tries = 0; tries < 60; tries++) {
      const x = rng.int(s.x0, s.x1);
      const y = deep ? (s.y0 < 13 ? rng.int(s.y0, s.y0 + 2) : rng.int(s.y1 - 2, s.y1)) : rng.int(s.y0, s.y1);
      if (tiles[y][x] === '.' && !items.some((i) => i.x === x && i.y === y)) return { x, y };
    }
    return { x: s.x0 + 1, y: s.y0 < 13 ? s.y0 + 1 : s.y1 - 1 };
  };

  // Keys and floppies live at the back of different shops; the first two shops stay clear.
  const far = rng.shuffle(stores.slice(2));
  for (let i = 0; i < 3; i++) items.push({ kind: 'key', ...spot(far[i], true), id: id++ });
  for (let i = 0; i < 3; i++) items.push({ kind: 'floppy', ...spot(far[3 + i], true), id: id++ });
  for (let i = 0; i < 5; i++) items.push({ kind: 'battery', ...spot(rng.pick(stores)), id: id++ });
  for (let i = 0; i < 3; i++) items.push({ kind: 'snack', ...spot(rng.pick(stores)), id: id++ });
  for (let i = 0; i < 3; i++) items.push({ kind: 'note', ...spot(far[6 + i] ?? rng.pick(stores)), id: id++ });
  items.push({ kind: 'chaos', ...spot(rng.pick(stores)), id: id++ });
  for (const s of stores) items.push({ kind: 'locker', ...spot(s, true), id: id++ });
  for (const x of [10, 30, 40]) items.push({ kind: 'locker', x, y: 13, id: id++ });

  // The Manager waits in the far-east shop.
  const east = stores.reduce((a, b) => (b.x0 > a.x0 ? b : a));
  const monsterStart = { x: Math.floor((east.x0 + east.x1) / 2), y: east.y0 < 13 ? east.y0 + 2 : east.y1 - 2 };
  return { seed, tiles, stores, items, start, exit, monsterStart };
}

function flood(m: MallMap): Uint8Array {
  const seen = new Uint8Array(MW * MH);
  const stack = [m.start.y * MW + m.start.x];
  seen[stack[0]] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    const x = cur % MW;
    const y = (cur / MW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
      const n = ny * MW + nx;
      if (!seen[n] && mallWalkable(m.tiles[ny][nx])) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return seen;
}

export function validateMall(m: MallMap): { ok: boolean; reason?: string } {
  const seen = flood(m);
  for (const it of m.items) if (!seen[it.y * MW + it.x]) return { ok: false, reason: `${it.kind} unreachable at ${it.x},${it.y}` };
  if (!seen[m.exit.y * MW + m.exit.x]) return { ok: false, reason: 'exit unreachable' };
  if (!seen[m.monsterStart.y * MW + m.monsterStart.x]) return { ok: false, reason: 'monster start unreachable' };
  return { ok: true };
}

/** First step of a shortest path (BFS, capped) from (fx,fy) toward (tx,ty); null if none. */
export function nextStepToward(m: MallMap, fx: number, fy: number, tx: number, ty: number, cap = 1500): { x: number; y: number } | null {
  if (fx === tx && fy === ty) return null;
  const prev = new Int32Array(MW * MH).fill(-1);
  const from = fy * MW + fx;
  const to = ty * MW + tx;
  prev[from] = from;
  const queue = [from];
  let head = 0;
  while (head < queue.length && head < cap) {
    const cur = queue[head++];
    if (cur === to) break;
    const x = cur % MW;
    const y = (cur / MW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
      const n = ny * MW + nx;
      if (prev[n] === -1 && mallWalkable(m.tiles[ny][nx])) {
        prev[n] = cur;
        queue.push(n);
      }
    }
  }
  if (prev[to] === -1) return null;
  let step = to;
  while (prev[step] !== from) step = prev[step];
  return { x: step % MW, y: (step / MW) | 0 };
}
