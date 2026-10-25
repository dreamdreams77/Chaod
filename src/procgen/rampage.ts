/**
 * RETRO RAMPAGE level generator: curated 16-column chunks stitched together by a
 * seeded plan, plus a reachability validator whose jump limits are deliberately
 * smaller than the real player physics (checked by tests/physics.test.ts).
 *
 * Legend: # solid  ? breakable  = one-way platform  B/b beat platforms  ^ spikes
 *         G gate  P start  X exit  e walker  f flyer  t turret  o bit  F floppy
 *         H heart  C chaos orb  k checkpoint  S switch
 */
import { Rng } from '../core/rng.ts';

export const TILE = 16;
export const ROWS = 17;
export const CHUNK_W = 16;
/** Longest gap (tiles) and tallest step (tiles) the validator assumes a player can clear. */
export const MAX_JUMP_DX = 4;
export const MAX_JUMP_RISE = 3;
const SHMUP_LEN = 56;

export interface Chunk {
  id: string;
  diff: number;
  rows: string[];
}

export interface Spawn {
  kind: string;
  x: number;
  y: number;
}

export interface RampageLevel {
  seed: number;
  width: number;
  tiles: string[][];
  spawns: Spawn[];
  shmup: { startCol: number; endCol: number; floppy: { x: number; y: number }; asteroids: Array<{ x: number; y: number }> };
  plan: string[];
}

export interface RampageOpts {
  beatPlatforms: boolean;
  switchShots: boolean;
}

const GROUND = ['################', '################', '################'];

function chunk(id: string, diff: number, rows: string[]): Chunk {
  return { id, diff, rows };
}

export const CHUNKS: Record<string, Chunk> = {
  start: chunk('start', 0, [
    '................',
    '..........o.o...',
    '..P.............',
    ...GROUND,
  ]),
  flat: chunk('flat', 1, [
    '......o.o.o.....',
    '................',
    '.....=====......',
    '................',
    '...e.......e....',
    ...GROUND,
  ]),
  steps: chunk('steps', 1, [
    '..........o.....',
    '.........###....',
    '.....o..........',
    '....###.........',
    '..............e.',
    ...GROUND,
  ]),
  gap: chunk('gap', 1, [
    '......o.o.......',
    '................',
    '................',
    '#####...########',
    '#####...########',
    '#####^^^########',
  ]),
  beat: chunk('beat', 2, [
    '................',
    '....o...o...o...',
    '................',
    '....BB..bb..BB..',
    '................',
    '###..........###',
    '###..........###',
    '###^^^^^^^^^^###',
  ]),
  switch_room: chunk('switch_room', 2, [
    '##########......',
    '#F.o.o..oG......',
    '#........G......',
    '##########===...',
    '................',
    '.....===........',
    '..............S.',
    '..e.............',
    '###########...##',
    '###########...##',
    '###########^^^##',
  ]),
  tower: chunk('tower', 2, [
    '.......F........',
    '......===.......',
    '................',
    '...===...===....',
    '..........o.....',
    '..===.......===.',
    '.........f......',
    '.............e..',
    ...GROUND,
  ]),
  spikes: chunk('spikes', 2, [
    '....o..o..o.....',
    '................',
    '...====..====...',
    '................',
    '................',
    '####^^^^^^^^####',
    '################',
    '################',
  ]),
  turret: chunk('turret', 3, [
    '.............t..',
    '............####',
    '.....o.o........',
    '....=====.......',
    '................',
    '.e.....e.....e..',
    ...GROUND,
  ]),
  islands: chunk('islands', 3, [
    '......o....o....',
    '.....##...##....',
    '................',
    '..##.....f...##.',
    '................',
    '##............##',
    '##............##',
    '##^^^^^^^^^^^^##',
  ]),
  shrine: chunk('shrine', 1, [
    '.......C........',
    '................',
    '......===.......',
    '...o........o...',
    '................',
    ...GROUND,
  ]),
  rest: chunk('rest', 1, [
    '................',
    '.......H........',
    '......###.......',
    '.ko.o......o.o..',
    ...GROUND,
  ]),
  secret_wall: chunk('secret_wall', 2, [
    '################',
    '#..o..o..o..o..#',
    '#......H.......#',
    '##############?#',
    '................',
    '.....e....e.....',
    ...GROUND,
  ]),
  goal: chunk('goal', 0, [
    '................',
    '...o.o.o........',
    '............X...',
    ...GROUND,
  ]),};

/** Rows padded at the top to exactly ROWS. */
function padded(c: Chunk): string[] {
  const rows = c.rows.slice();
  while (rows.length < ROWS) rows.unshift('.'.repeat(CHUNK_W));
  for (const r of rows) if (r.length !== CHUNK_W) throw new Error(`chunk ${c.id} row width ${r.length}`);
  return rows;
}

const SPAWN_CHARS = 'PXeftoFHCkS';

export function generateRampage(seed: number, opts: RampageOpts): RampageLevel {
  const rng = new Rng(seed);
  const easy = ['flat', 'steps', 'gap'];
  const mid = ['spikes', 'flat', 'steps', 'secret_wall'];
  const hard = ['turret', 'islands', 'spikes'];
  const a = rng.pick(easy);
  const h1 = rng.pick(hard);
  const plan = [
    'start',
    a,
    rng.pick(easy.filter((c) => c !== a)),
    'beat',
    rng.pick(mid),
    'switch_room',
    'shrine',
    'SHMUP',
    'rest',
    'tower',
    h1,
    rng.pick(hard.filter((c) => c !== h1 && c !== 'spikes')),
    'goal',
  ];

  const cols: string[][] = [];
  const spawns: Spawn[] = [];
  let shmup: RampageLevel['shmup'] = { startCol: 0, endCol: 0, floppy: { x: 0, y: 0 }, asteroids: [] };

  for (const id of plan) {
    const base = cols.length;
    if (id === 'SHMUP') {
      const rocks: Array<{ x: number; y: number }> = [];
      for (let x = 0; x < SHMUP_LEN; x++) {
        const col: string[] = [];
        for (let y = 0; y < ROWS; y++) col.push(y === 0 || y >= ROWS - 1 ? '#' : '.');
        cols.push(col);
      }
      let lane = 8;
      for (let x = 8; x < SHMUP_LEN - 6; x += rng.int(3, 5)) {
        lane = Math.max(4, Math.min(12, lane + rng.int(-2, 2)));
        for (let y = 2; y < ROWS - 2; y++) if (Math.abs(y - lane) > 3 && rng.chance(0.35)) rocks.push({ x: base + x, y });
      }
      const fx = base + rng.int(20, SHMUP_LEN - 12);
      shmup = {
        startCol: base,
        endCol: base + SHMUP_LEN,
        floppy: { x: fx, y: rng.int(3, 13) },
        asteroids: rocks.filter((r) => Math.abs(r.x - fx) > 1),
      };
      continue;
    }
    const rows = padded(CHUNKS[id]);
    for (let x = 0; x < CHUNK_W; x++) {
      const col: string[] = [];
      for (let y = 0; y < ROWS; y++) {
        let ch = rows[y][x];
        if ((ch === 'B' || ch === 'b') && !opts.beatPlatforms) ch = '=';
        if (ch === 'S' && !opts.switchShots) ch = '.';
        if (SPAWN_CHARS.includes(ch)) {
          let keep = true;
          if (ch === 'e' || ch === 'f') keep = rng.chance(0.85);
          if (ch === 'o') keep = rng.chance(0.9);
          if (keep) spawns.push({ kind: ch, x: base + x, y });
          ch = '.';
        }
        col.push(ch);
      }
      cols.push(col);
    }
    // Harder chunks sometimes get an extra walker standing on the first free ledge.
    if (CHUNKS[id].diff >= 2 && rng.chance(0.5)) {
      const x = base + rng.int(3, 12);
      const col = cols[x];
      for (let y = 1; y < ROWS - 1; y++) {
        if (col[y] === '.' && col[y - 1] === '.' && (col[y + 1] === '#' || col[y + 1] === '=')) {
          spawns.push({ kind: 'e', x, y });
          break;
        }
      }
    }
  }

  const width = cols.length;
  const tiles: string[][] = [];
  for (let y = 0; y < ROWS; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) row.push(cols[x][y]);
    tiles.push(row);
  }
  return { seed, width, tiles, spawns, shmup, plan };
}

/**
 * Flood-fills every standing position reachable from the start with the
 * conservative jump limits above. The shmup section is a flight, so the player
 * re-enters at the first standable cell after it. Gates count as open.
 */
export function validateRampage(lvl: RampageLevel): { ok: boolean; reason?: string } {
  const { tiles, width } = lvl;
  const start = lvl.spawns.find((s) => s.kind === 'P');
  const exit = lvl.spawns.find((s) => s.kind === 'X');
  if (!start || !exit) return { ok: false, reason: 'missing start or exit' };

  const at = (x: number, y: number): string => (x < 0 || x >= width ? '#' : y < 0 ? '.' : y >= ROWS ? '.' : tiles[y][x]);
  const blocks = (c: string): boolean => c === '#' || c === '?';
  const open = (x: number, y: number): boolean => !blocks(at(x, y));
  const supports = (c: string): boolean => c === '#' || c === '?' || c === '=' || c === 'B' || c === 'b' || c === 'G';
  // Feet in cell (x,y), two tiles of headroom, something to stand on, no spikes underfoot.
  const standable = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 1 && y < ROWS - 1 && open(x, y) && open(x, y - 1) && at(x, y) !== '^' && supports(at(x, y + 1));

  const seen = new Set<number>();
  const key = (x: number, y: number): number => y * width + x;
  const queue: Array<[number, number]> = [];
  const push = (x: number, y: number): void => {
    if (standable(x, y) && !seen.has(key(x, y))) {
      seen.add(key(x, y));
      queue.push([x, y]);
    }
  };
  push(start.x, start.y);

  const { startCol, endCol } = lvl.shmup;
  let reachedShmup = false;
  let goal = false;
  while (queue.length) {
    const [x, y] = queue.pop()!;
    if (Math.abs(x - exit.x) <= 1 && Math.abs(y - exit.y) <= 1) goal = true;
    if (x >= startCol - 2 && startCol > 0 && x < startCol + 1) reachedShmup = true;
    // Walk and fall: step sideways, then drop until something holds.
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      if (!open(nx, y) || !open(nx, y - 1)) {
        // Walk up a one-tile step.
        if (open(nx, y - 1) && open(nx, y - 2)) push(nx, y - 1);
        continue;
      }
      for (let ny = y; ny < ROWS - 1; ny++) {
        if (!open(nx, ny) || at(nx, ny) === '^') break;
        if (standable(nx, ny)) {
          push(nx, ny);
          break;
        }
        if (supports(at(nx, ny + 1))) break;
      }
    }
    // Jump: any standable cell within the clearable box. Falls may travel a bit further.
    for (let dx = -(MAX_JUMP_DX + 1); dx <= MAX_JUMP_DX + 1; dx++) {
      for (let ty = y - MAX_JUMP_RISE; ty <= y + 8; ty++) {
        const reach = ty > y ? MAX_JUMP_DX + 1 : MAX_JUMP_DX;
        if (Math.abs(dx) > reach) continue;
        push(x + dx, ty);
      }
    }
    // The shmup flight carries the player over to the far side.
    if (reachedShmup && startCol > 0) {
      for (let y2 = 1; y2 < ROWS - 1; y2++) push(endCol, y2);
      reachedShmup = false;
    }
  }
  return goal ? { ok: true } : { ok: false, reason: 'exit unreachable' };
}
