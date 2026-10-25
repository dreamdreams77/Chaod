/**
 * Daily challenge and shareable seed links. Everything here is pure so it can be tested:
 * the day's run is derived from the UTC date, so every player gets the same world, seed
 * and modifier, and a link can reproduce any run exactly.
 */
import { MODE_IDS, ModeId, Profile } from '../core/save.ts';
import { seedFromString } from '../core/rng.ts';

export const DAILY_BONUS = 50;

export interface DailyRecord {
  key: string;
  best: number;
  cleared: boolean;
  streak: number;
  lastClear: string;
}

export function emptyDaily(): DailyRecord {
  return { key: '', best: 0, cleared: false, streak: 0, lastClear: '' };
}

/** UTC date as YYYY-MM-DD, so players everywhere share a "day". */
export function dateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return dateKey(d);
}

export interface Daily {
  key: string;
  mode: ModeId;
  seed: number;
}

/** Today's run. Only worlds the player has unlocked are eligible; bosses are excluded. */
export function dailyFor(key: string, eligible: ModeId[]): Daily {
  const pool = eligible.filter((m) => m !== 'beatdown' && m !== 'rhythm');
  const modes = pool.length ? pool : (['rampage'] as ModeId[]);
  const h = seedFromString(`chaos-daily-${key}`);
  return { key, mode: modes[h % modes.length], seed: seedFromString(`chaos-seed-${key}`) % 1000000 };
}

/** The streak as it stands today: it lapses if yesterday's daily was missed. */
export function currentStreak(d: DailyRecord, today: string): number {
  return d.lastClear === today || d.lastClear === addDays(today, -1) ? d.streak : 0;
}

export interface Challenge {
  mode: ModeId;
  seed: number;
}

/** Reads `?seed=123456&mode=neon` from a URL query string; null if absent or malformed. */
export function parseChallenge(search: string): Challenge | null {
  const q = new URLSearchParams(search);
  const seed = q.get('seed');
  const mode = q.get('mode');
  if (!seed || !/^\d{1,6}$/.test(seed) || !mode || !(MODE_IDS as string[]).includes(mode)) return null;
  return { mode: mode as ModeId, seed: Number(seed) };
}

export function challengeUrl(base: string, c: Challenge): string {
  return `${base}?seed=${c.seed.toString().padStart(6, '0')}&mode=${c.mode}`;
}

/** Records a finished daily run on the profile (mutating it); returns the bonus paid, if any. */
export function applyDailyResult(p: Profile, key: string, score: number, cleared: boolean): { bonus: number; streak: number } {
  if (p.daily.key !== key) p.daily = { ...p.daily, key, best: 0, cleared: false };
  p.daily.best = Math.max(p.daily.best, score);
  if (!cleared || p.daily.cleared) return { bonus: 0, streak: currentStreak(p.daily, key) };
  p.daily.cleared = true;
  p.daily.streak = p.daily.lastClear === addDays(key, -1) ? p.daily.streak + 1 : 1;
  p.daily.lastClear = key;
  const bonus = DAILY_BONUS + 10 * Math.min(p.daily.streak, 7);
  p.bits += bonus;
  p.xp += 20;
  return { bonus, streak: p.daily.streak };
}
