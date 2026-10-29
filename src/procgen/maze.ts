/**
 * MUNCH MAZE generator: a left-right symmetric maze on a 21x15 tile grid with a central ghost pen,
 * one wrap-around tunnel row, no dead ends and four power pellets. Built from a 10x7 grid of cells
 * (the odd tiles) whose walls are carved by a depth-first search on the left half and mirrored.
 */
import { Rng } from '../core/rng.ts';

export const MZ_W = 21;
export const MZ_H = 15;

export interface MazeMap {
  seed: number;
  /** '#' wall, '.' pellet, 'o' power pellet, ' ' floor, '=' the pen door (ghosts only). */
  tiles: string[][];
  start: { x: number; y: number };
  /** Where the ghosts begin: the first outside the pen, the others inside it. */
  ghostStarts: Array<{ x: number; y: number }>;
  /** The tile just outside the pen door, where ghosts head when they leave. */
  door: { x: number; y: number };
  /** Where a floppy disk appears. */
  bonus: { x: number; y: number };
  /** The row whose edge tiles wrap around. */
  tunnelRow: number;
  pellets: number;
  /** Colour theme index (the lobby palette cycles through these). */
  theme: number;
}

export const DIRS = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
] as const;

export function isFloor(c: string): boolean {
  return c === '.' || c === 'o' || c === ' ';
}

/** Retries a handful of times so a bad layout never reaches the player. */
export function generateMaze(seed: number): MazeMap {
  const rng = new Rng(seed ^ 0x3a2e11);
  for (let attempt = 0; attempt < 30; attempt++) {
    const m = build(rng, seed);
    if (validateMaze(m).ok) return m;
  }
  throw new Error('maze generation failed');
}

const CW = 10;
const CH = 7;
const isPen = (cx: number, cy: number): boolean => cy === 3 && (cx === 4 || cx === 5);

function build(rng: Rng, seed: number): MazeMap {
  // open passages between neighbouring cells on the left half (cx 0..4); "centre" links cx 4 and 5
  const right: boolean[][] = Array.from({ length: CW }, () => Array(CH).fill(false)); // (cx,cy)-(cx+1,cy)
  const down: boolean[][] = Array.from({ length: CW }, () => Array(CH).fill(false)); // (cx,cy)-(cx,cy+1)
  const seen: boolean[][] = Array.from({ length: CW }, () => Array(CH).fill(false));
  const inLeft = (cx: number, cy: number): boolean => cx >= 0 && cx <= 4 && cy >= 0 && cy < CH && !isPen(cx, cy);

  // depth-first carve over the left half (the pen cell is an obstacle)
  const sx = 0;
  const sy = rng.int(0, CH - 1);
  const stack: Array<[number, number]> = [[sx, sy]];
  seen[sx][sy] = true;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const opts: Array<[number, number]> = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (inLeft(nx, ny) && !seen[nx][ny]) opts.push([nx, ny]);
    }
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [nx, ny] = rng.pick(opts);
    if (nx !== cx) right[Math.min(cx, nx)][cy] = true;
    else down[cx][Math.min(cy, ny)] = true;
    seen[nx][ny] = true;
    stack.push([nx, ny]);
  }
  // the centre links (cells 4 and 5): one beside the pen's door is always open
  const centre: boolean[] = Array(CH).fill(false);
  for (let cy = 0; cy < CH; cy++) if (cy !== 3) centre[cy] = cy === 2 || rng.chance(0.5);

  const openAround = (cx: number, cy: number): number => {
    let n = 0;
    if (cx > 0 && right[cx - 1][cy]) n++;
    if (cx < 4 && right[cx][cy]) n++;
    if (cx === 4 && centre[cy]) n++;
    if (cy > 0 && down[cx][cy - 1]) n++;
    if (cy < CH - 1 && down[cx][cy]) n++;
    return n;
  };
  // braid: no dead ends (a ghost chase needs loops), plus a few extra shortcuts
  for (let pass = 0; pass < 4; pass++) {
    for (let cx = 0; cx <= 4; cx++) {
      for (let cy = 0; cy < CH; cy++) {
        if (isPen(cx, cy) || openAround(cx, cy) > 1) continue;
        const walls: Array<() => void> = [];
        if (cx > 0 && !right[cx - 1][cy] && inLeft(cx - 1, cy)) walls.push(() => (right[cx - 1][cy] = true));
        if (cx < 4 && !right[cx][cy] && inLeft(cx + 1, cy)) walls.push(() => (right[cx][cy] = true));
        if (cx === 4 && !centre[cy] && cy !== 3) walls.push(() => (centre[cy] = true));
        if (cy > 0 && !down[cx][cy - 1] && inLeft(cx, cy - 1)) walls.push(() => (down[cx][cy - 1] = true));
        if (cy < CH - 1 && !down[cx][cy] && inLeft(cx, cy + 1)) walls.push(() => (down[cx][cy] = true));
        if (walls.length) rng.pick(walls)();
      }
    }
  }
  for (let cx = 0; cx <= 4; cx++) {
    for (let cy = 0; cy < CH; cy++) {
      if (isPen(cx, cy)) continue;
      if (cx < 4 && inLeft(cx + 1, cy) && !right[cx][cy] && rng.chance(0.12)) right[cx][cy] = true;
      if (cy < CH - 1 && inLeft(cx, cy + 1) && !down[cx][cy] && rng.chance(0.12)) down[cx][cy] = true;
    }
  }

  const tiles: string[][] = Array.from({ length: MZ_H }, () => Array(MZ_W).fill('#'));
  const open = (x: number, y: number): void => {
    tiles[y][x] = '.';
    tiles[y][MZ_W - 1 - x] = '.';
  };
  for (let cx = 0; cx <= 4; cx++) {
    for (let cy = 0; cy < CH; cy++) {
      if (isPen(cx, cy)) continue;
      open(2 * cx + 1, 2 * cy + 1);
      if (cx < 4 && right[cx][cy]) open(2 * cx + 2, 2 * cy + 1);
      if (cx === 4 && centre[cy]) tiles[2 * cy + 1][10] = '.';
      if (cy < CH - 1 && down[cx][cy]) open(2 * cx + 1, 2 * cy + 2);
    }
  }
  // the pen: three tiles, a door above the middle one
  tiles[7][9] = ' ';
  tiles[7][10] = ' ';
  tiles[7][11] = ' ';
  tiles[6][10] = '=';
  // the tunnel row wraps through the outer walls
  const tunnelRow = rng.pick([3, 5, 9, 11]);
  tiles[tunnelRow][0] = ' ';
  tiles[tunnelRow][MZ_W - 1] = ' ';
  // keep the corridor beside the tunnel mouth open so it is a real shortcut
  tiles[tunnelRow][1] = '.';
  tiles[tunnelRow][MZ_W - 2] = '.';

  const start = tiles[11][10] === '.' ? { x: 10, y: 11 } : { x: 9, y: 11 };
  tiles[start.y][start.x] = ' ';
  const bonus = tiles[9][10] === '.' ? { x: 10, y: 9 } : { x: 9, y: 9 };
  tiles[bonus.y][bonus.x] = ' ';
  // power pellets in the four corners
  for (const [x, y] of [[1, 1], [MZ_W - 2, 1], [1, MZ_H - 2], [MZ_W - 2, MZ_H - 2]]) tiles[y][x] = 'o';
  let pellets = 0;
  for (const row of tiles) for (const c of row) if (c === '.' || c === 'o') pellets++;
  return {
    seed,
    tiles,
    start,
    ghostStarts: [{ x: 10, y: 5 }, { x: 10, y: 7 }, { x: 9, y: 7 }, { x: 11, y: 7 }],
    door: { x: 10, y: 5 },
    bonus,
    tunnelRow,
    pellets,
    theme: rng.int(0, 3),
  };
}

/** Every pellet and the bonus tile reachable from the start, a way out of the pen, no dead ends, mirror symmetry. */
export function validateMaze(m: MazeMap): { ok: boolean; reason?: string } {
  const reach = flood(m, m.start.x, m.start.y, false);
  for (let y = 0; y < MZ_H; y++) {
    for (let x = 0; x < MZ_W; x++) {
      const c = m.tiles[y][x];
      if ((c === '.' || c === 'o') && !reach[y][x]) return { ok: false, reason: `unreachable pellet at ${x},${y}` };
    }
  }
  if (!reach[m.bonus.y][m.bonus.x]) return { ok: false, reason: 'bonus unreachable' };
  if (!reach[m.door.y][m.door.x]) return { ok: false, reason: 'pen door unreachable' };
  const fromPen = flood(m, 10, 7, true);
  if (!fromPen[m.door.y][m.door.x] || !fromPen[m.start.y][m.start.x]) return { ok: false, reason: 'ghosts cannot get out of the pen' };
  for (let y = 0; y < MZ_H; y++) {
    for (let x = 0; x < MZ_W; x++) {
      if (m.tiles[y][x] === '#' || m.tiles[y][x] === '=') continue;
      if (y === 7 && x >= 9 && x <= 11) continue;
      if (x !== MZ_W - 1 - x && m.tiles[y][MZ_W - 1 - x] === '#') {
        // symmetry except for the player's start and bonus tiles, which sit on one side
        if (!((x === m.start.x && y === m.start.y) || (x === m.bonus.x && y === m.bonus.y))) return { ok: false, reason: `asymmetric at ${x},${y}` };
      }
      if (x === 0 || x === MZ_W - 1) continue; // tunnel mouths
      if (neighbours(m, x, y, true).length < 2) return { ok: false, reason: `dead end at ${x},${y}` };
    }
  }
  return { ok: true };
}

/** Walkable neighbour tiles of (x,y), wrapping through the tunnel; the door only counts for ghosts. */
export function neighbours(m: MazeMap, x: number, y: number, ghost: boolean): Array<{ x: number; y: number; dir: number }> {
  const out: Array<{ x: number; y: number; dir: number }> = [];
  for (let d = 0; d < 4; d++) {
    const nx = (x + DIRS[d].x + MZ_W) % MZ_W;
    const ny = y + DIRS[d].y;
    if (ny < 0 || ny >= MZ_H) continue;
    // only the tunnel row connects the left and right edges
    if (Math.abs(nx - x) > 1 && y !== m.tunnelRow) continue;
    const c = m.tiles[ny][nx];
    if (isFloor(c) || (ghost && c === '=')) out.push({ x: nx, y: ny, dir: d });
  }
  return out;
}

function flood(m: MazeMap, sx: number, sy: number, ghost: boolean): boolean[][] {
  const seen = Array.from({ length: MZ_H }, () => Array(MZ_W).fill(false));
  const stack: Array<[number, number]> = [[sx, sy]];
  seen[sy][sx] = true;
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const n of neighbours(m, x, y, ghost)) {
      if (!seen[n.y][n.x]) {
        seen[n.y][n.x] = true;
        stack.push([n.x, n.y]);
      }
    }
  }
  return seen;
}

/** First step of a shortest path (BFS) from (fx,fy) to (tx,ty); null when already there or unreachable. */
export function mazeStep(m: MazeMap, fx: number, fy: number, tx: number, ty: number, ghost: boolean): { x: number; y: number; dir: number } | null {
  if (fx === tx && fy === ty) return null;
  const prev = new Int16Array(MZ_W * MZ_H).fill(-1);
  const from = fy * MZ_W + fx;
  const to = ty * MZ_W + tx;
  prev[from] = from;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === to) break;
    for (const n of neighbours(m, cur % MZ_W, (cur / MZ_W) | 0, ghost)) {
      const id = n.y * MZ_W + n.x;
      if (prev[id] === -1) {
        prev[id] = cur;
        queue.push(id);
      }
    }
  }
  if (prev[to] === -1) return null;
  let step = to;
  while (prev[step] !== from) step = prev[step];
  const x = step % MZ_W, y = (step / MZ_W) | 0;
  return { x, y, dir: neighbours(m, fx, fy, ghost).find((n) => n.x === x && n.y === y)?.dir ?? 0 };
}
