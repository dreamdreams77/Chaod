/**
 * CORE COMMAND map generator: a winding enemy path across a small grid, from the left
 * edge to the Cartridge Core on the right. Everything off the path is buildable.
 */
import { Rng } from '../core/rng.ts';

export const CM_COLS = 17;
export const CM_ROWS = 7;
export const CM_CELL = 28;
export const CM_TOP = 28;

export interface Cell {
  x: number;
  y: number;
}

export interface CommandMap {
  seed: number;
  /** Ordered path cells from the spawn (column 0) to the core (last column). */
  path: Cell[];
  /** Buildable cells (everything off the path). */
  free: boolean[][];
}

/** A random walk that always moves right and sometimes takes a vertical detour; never touches itself. */
export function generateCommand(seed: number): CommandMap {
  const rng = new Rng(seed ^ 0x5eed);
  for (let attempt = 0; attempt < 40; attempt++) {
    const path: Cell[] = [];
    const used = new Set<number>();
    const key = (x: number, y: number) => y * CM_COLS + x;
    let x = 0;
    let y = rng.int(1, CM_ROWS - 2);
    const push = (cx: number, cy: number): boolean => {
      if (used.has(key(cx, cy))) return false;
      used.add(key(cx, cy));
      path.push({ x: cx, y: cy });
      return true;
    };
    push(x, y);
    let ok = true;
    while (x < CM_COLS - 1 && ok) {
      // Run right a few cells, then take a vertical detour of 2-5 cells.
      const run = rng.int(2, 3);
      for (let i = 0; i < run && x < CM_COLS - 1; i++) {
        x++;
        if (!push(x, y)) ok = false;
      }
      if (x >= CM_COLS - 1) break;
      const dir = y <= 1 ? 1 : y >= CM_ROWS - 2 ? -1 : rng.chance(0.5) ? 1 : -1;
      const len = rng.int(2, 4);
      for (let i = 0; i < len && ok; i++) {
        const ny = y + dir;
        if (ny < 0 || ny >= CM_ROWS) break;
        y = ny;
        if (!push(x, y)) ok = false;
      }
    }
    if (!ok || path[path.length - 1].x !== CM_COLS - 1 || path.length < 24) continue;
    const free = Array.from({ length: CM_ROWS }, () => Array.from({ length: CM_COLS }, () => true));
    for (const c of path) free[c.y][c.x] = false;
    return { seed, path, free };
  }
  // A plain serpentine fallback so a bad seed can never fail to produce a map.
  const path: Cell[] = [];
  for (let x = 0; x < CM_COLS; x++) path.push({ x, y: 3 });
  const free = Array.from({ length: CM_ROWS }, () => Array.from({ length: CM_COLS }, () => true));
  for (const c of path) free[c.y][c.x] = false;
  return { seed, path, free };
}

export function validateCommand(m: CommandMap): { ok: boolean; reason?: string } {
  if (m.path.length < 10) return { ok: false, reason: 'path too short' };
  if (m.path[0].x !== 0) return { ok: false, reason: 'does not start at the left edge' };
  if (m.path[m.path.length - 1].x !== CM_COLS - 1) return { ok: false, reason: 'does not reach the core' };
  const seen = new Set<number>();
  for (let i = 0; i < m.path.length; i++) {
    const c = m.path[i];
    if (c.x < 0 || c.x >= CM_COLS || c.y < 0 || c.y >= CM_ROWS) return { ok: false, reason: 'off the grid' };
    const k = c.y * CM_COLS + c.x;
    if (seen.has(k)) return { ok: false, reason: 'path crosses itself' };
    seen.add(k);
    if (i > 0 && Math.abs(c.x - m.path[i - 1].x) + Math.abs(c.y - m.path[i - 1].y) !== 1) return { ok: false, reason: 'path is not contiguous' };
    if (m.free[c.y][c.x]) return { ok: false, reason: 'path cell marked buildable' };
  }
  let freeCount = 0;
  for (const row of m.free) for (const f of row) if (f) freeCount++;
  if (freeCount < 30) return { ok: false, reason: 'too little room to build' };
  return { ok: true };
}
