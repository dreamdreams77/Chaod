/**
 * BLOCK PARTY's rules as pure functions: seven falling pieces, a bag that deals them fairly,
 * a board with rotation, wall kicks, locking, line clears and rising garbage. No rendering here,
 * so the whole game logic is unit-tested headlessly.
 */
import { Rng } from '../core/rng.ts';

export const COLS = 10;
/** Rows above the visible well where pieces appear. */
export const HIDDEN = 2;
export const VISIBLE = 20;
export const ROWS = VISIBLE + HIDDEN;
export const GARBAGE = 8;

export type PieceId = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECES: PieceId[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
/** Colour index stored on the board (1-7), 8 is garbage. */
export const PIECE_COLOR: Record<PieceId, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };
export const COLORS = ['', '#3fe0ff', '#ffe23f', '#b07aff', '#7dff6b', '#ff3f5a', '#3f7aff', '#ff9f3f', '#6a6a88'];

/** Base shapes in their smallest square box; rotations are derived. */
const BASE: Record<PieceId, string[]> = {
  I: ['....', 'XXXX', '....', '....'],
  O: ['XX', 'XX'],
  T: ['.X.', 'XXX', '...'],
  S: ['.XX', 'XX.', '...'],
  Z: ['XX.', '.XX', '...'],
  J: ['X..', 'XXX', '...'],
  L: ['..X', 'XXX', '...'],
};

function rotateCw(cells: Array<[number, number]>, size: number): Array<[number, number]> {
  return cells.map(([x, y]) => [size - 1 - y, x] as [number, number]);
}

function buildShapes(): Record<PieceId, Array<Array<[number, number]>>> {
  const out = {} as Record<PieceId, Array<Array<[number, number]>>>;
  for (const id of PIECES) {
    const rows = BASE[id];
    const size = rows.length;
    let cells: Array<[number, number]> = [];
    rows.forEach((r, y) => [...r].forEach((c, x) => c === 'X' && cells.push([x, y])));
    const rots: Array<Array<[number, number]>> = [];
    for (let i = 0; i < 4; i++) {
      rots.push(cells);
      cells = rotateCw(cells, size);
    }
    out[id] = rots;
  }
  return out;
}
export const SHAPES = buildShapes();

export type Board = number[][];

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

export interface Piece {
  id: PieceId;
  rot: number;
  x: number;
  y: number;
  /** A BOMB BLOCKS piece: clears the area around where it lands. */
  bomb?: boolean;
}

export function cellsOf(p: Piece): Array<[number, number]> {
  return SHAPES[p.id][((p.rot % 4) + 4) % 4].map(([cx, cy]) => [p.x + cx, p.y + cy] as [number, number]);
}

export function fits(b: Board, p: Piece): boolean {
  for (const [x, y] of cellsOf(p)) {
    if (x < 0 || x >= COLS || y >= ROWS) return false;
    if (y >= 0 && b[y][x] !== 0) return false;
  }
  return true;
}

export function spawn(id: PieceId, bomb = false): Piece {
  const width = BASE[id].length;
  return { id, rot: 0, x: Math.floor((COLS - width) / 2), y: id === 'I' ? -1 : 0, bomb };
}

/** Wall kicks to try after a rotation, nearest first. */
const KICKS: Array<[number, number]> = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1]];

/** Rotates (+1 clockwise, -1 counter-clockwise) with kicks; returns the new piece or null if every kick is blocked. */
export function rotated(b: Board, p: Piece, dir: 1 | -1): Piece | null {
  if (p.id === 'O') return p;
  const rot = (p.rot + dir + 4) % 4;
  for (const [kx, ky] of KICKS) {
    const q = { ...p, rot, x: p.x + kx, y: p.y + ky };
    if (fits(b, q)) return q;
  }
  return null;
}

export function moved(b: Board, p: Piece, dx: number, dy: number): Piece | null {
  const q = { ...p, x: p.x + dx, y: p.y + dy };
  return fits(b, q) ? q : null;
}

/** How many rows the piece can fall from where it is. */
export function dropDistance(b: Board, p: Piece): number {
  let d = 0;
  while (fits(b, { ...p, y: p.y + d + 1 })) d++;
  return d;
}

/** Writes the piece into the board; returns true if any part of it is still above the visible well (a top-out). */
export function lock(b: Board, p: Piece): boolean {
  let above = false;
  for (const [x, y] of cellsOf(p)) {
    if (y < HIDDEN) above = true;
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) b[y][x] = PIECE_COLOR[p.id];
  }
  return above;
}

/** Indices of complete rows. */
export function fullRows(b: Board): number[] {
  const out: number[] = [];
  for (let y = 0; y < ROWS; y++) if (b[y].every((c) => c !== 0)) out.push(y);
  return out;
}

/** Removes the given rows, dropping everything above. */
export function removeRows(b: Board, rows: number[]): void {
  const set = new Set(rows);
  const kept = b.filter((_, y) => !set.has(y));
  while (kept.length < ROWS) kept.unshift(new Array(COLS).fill(0));
  for (let y = 0; y < ROWS; y++) b[y] = kept[y];
}

/** Pushes `n` rows of garbage (one gap each) up from the bottom; returns true if blocks were pushed out of the top. */
export function addGarbage(b: Board, rng: Rng, n: number): boolean {
  let overflow = false;
  for (let i = 0; i < n; i++) {
    if (b[0].some((c) => c !== 0)) overflow = true;
    b.shift();
    const hole = rng.int(0, COLS - 1);
    b.push(Array.from({ length: COLS }, (_, x) => (x === hole ? 0 : GARBAGE)));
  }
  return overflow;
}

/** Clears a 5-wide, 3-tall blast around (cx, cy); returns how many blocks went. */
export function explode(b: Board, cx: number, cy: number): number {
  let n = 0;
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS && b[y][x] !== 0) {
        b[y][x] = 0;
        n++;
      }
    }
  }
  return n;
}

/** Clears the top `rows` visible rows so a topped-out well can carry on. */
export function clearTop(b: Board, rows: number): void {
  for (let y = 0; y < HIDDEN + rows; y++) b[y].fill(0);
}

/** A fair 7-bag: every piece once per seven. */
export function nextBag(rng: Rng): PieceId[] {
  return rng.shuffle(PIECES.slice());
}

/** Seconds a piece takes to fall one row at a level (a gentle curve, with a floor). */
export function fallSeconds(level: number): number {
  return Math.max(0.045, Math.pow(0.8 - (level - 1) * 0.0075, level - 1) * 0.95);
}

/** Points for clearing `n` rows at once. */
export function lineScore(n: number, level: number): number {
  return [0, 100, 300, 500, 800][Math.min(4, n)] * level;
}

/** Height of the tallest column (0 = empty well), for bots and tests. */
export function stackHeight(b: Board): number {
  for (let y = HIDDEN; y < ROWS; y++) if (b[y].some((c) => c !== 0)) return ROWS - y;
  return 0;
}
