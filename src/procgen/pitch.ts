/**
 * PENALTY STORM match plan: the keeper's bullet patterns for each goal, his patrol and dive
 * tuning, and the coins and hearts left on the pitch. Seeded, so a seed is one exact match.
 */
import { Rng } from '../core/rng.ts';

export const PITCH_W = 480;
export const PITCH_H = 270;
/** Playing area: the keeper's end is at the top. */
export const FIELD = { left: 14, right: PITCH_W - 14, top: 30, bottom: PITCH_H - 16 };
export const GOAL = { left: 160, right: 320, line: 54 };
export const GOALS_TO_WIN = 6;

export type PatternId = 'fan' | 'rain' | 'spiral' | 'ring' | 'sweep';
export const PATTERNS: PatternId[] = ['fan', 'rain', 'spiral', 'ring', 'sweep'];
/** Gentle patterns that open a match. */
const OPENERS: PatternId[] = ['fan', 'rain'];

export interface Pickup {
  x: number;
  y: number;
  kind: 'bit' | 'heart';
}

export interface PitchPlan {
  seed: number;
  /** Patterns the keeper cycles through after kick-off number n (0 = before the first goal). */
  rounds: PatternId[][];
  keeper: { period: number; amp: number; phase: number; dive: number; react: number };
  /** Coins and hearts placed on the pitch at each kick-off. */
  pickups: Pickup[][];
}

export function generatePitch(seed: number): PitchPlan {
  const rng = new Rng(seed ^ 0x9e11);
  const rounds: PatternId[][] = [];
  let last: PatternId | null = null;
  for (let n = 0; n < GOALS_TO_WIN; n++) {
    const pool = (n === 0 ? OPENERS : PATTERNS).filter((p) => p !== last);
    const first = rng.pick(pool);
    const second = rng.pick(PATTERNS.filter((p) => p !== first && (n > 0 || OPENERS.includes(p))));
    // From the third goal on the keeper chains a third pattern before pausing.
    const set = n >= 2 ? [first, second, rng.pick(PATTERNS.filter((p) => p !== second))] : [first, second];
    rounds.push(set);
    last = set[set.length - 1];
  }
  const pickups: Pickup[][] = [];
  for (let n = 0; n < GOALS_TO_WIN; n++) {
    const list: Pickup[] = [];
    for (let i = 0; i < 3; i++) list.push({ x: Math.round(rng.range(FIELD.left + 24, FIELD.right - 24)), y: Math.round(rng.range(130, FIELD.bottom - 10)), kind: 'bit' });
    if (n === 2 || n === 4) list.push({ x: Math.round(rng.range(FIELD.left + 40, FIELD.right - 40)), y: Math.round(rng.range(150, FIELD.bottom - 10)), kind: 'heart' });
    pickups.push(list);
  }
  return {
    seed,
    rounds,
    keeper: { period: rng.range(2.2, 2.8), amp: rng.range(54, 66), phase: rng.range(0, Math.PI * 2), dive: rng.range(170, 190), react: rng.range(0.17, 0.23) },
    pickups,
  };
}

export function validatePitch(p: PitchPlan): { ok: boolean; reason?: string } {
  if (p.rounds.length !== GOALS_TO_WIN) return { ok: false, reason: 'wrong number of rounds' };
  for (const r of p.rounds) {
    if (r.length < 2 || r.length > 3) return { ok: false, reason: 'bad round length' };
    for (let i = 0; i < r.length; i++) {
      if (!PATTERNS.includes(r[i])) return { ok: false, reason: `unknown pattern ${r[i]}` };
      if (i > 0 && r[i] === r[i - 1]) return { ok: false, reason: 'a pattern repeats back to back' };
    }
  }
  if (p.rounds[0].some((x) => !OPENERS.includes(x))) return { ok: false, reason: 'the opening patterns must be gentle' };
  const k = p.keeper;
  if (k.amp > (GOAL.right - GOAL.left) / 2 - 10 || k.amp < 30) return { ok: false, reason: 'keeper patrol does not fit the goal' };
  for (const list of p.pickups) for (const c of list) if (c.x < FIELD.left || c.x > FIELD.right || c.y < 100 || c.y > FIELD.bottom) return { ok: false, reason: 'pickup off the pitch' };
  return { ok: true };
}
