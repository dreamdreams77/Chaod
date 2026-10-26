/** The RECORDS screen's numbers, gathered from the profile in one place so they can be tested. */
import { ALL_MODES, ModeId, Profile } from '../core/save.ts';
import { starCount } from './mastery.ts';

export interface WorldRecord {
  mode: ModeId;
  clears: number;
  bestScore: number;
  /** Seconds, 0 when never cleared. */
  bestTime: number;
  stars: number;
  endlessRounds: number;
  floppies: number;
}

export function worldRecords(p: Profile): WorldRecord[] {
  return ALL_MODES.map((mode) => ({
    mode,
    clears: p.cleared[mode].clears,
    bestScore: p.cleared[mode].bestScore,
    bestTime: p.cleared[mode].bestTime,
    stars: starCount(p, mode),
    endlessRounds: p.endless[mode]?.rounds ?? 0,
    floppies: [0, 1, 2].filter((i) => p.floppies.includes(`${mode}-${i}`)).length,
  }));
}

/** m:ss.t, or a dash when there is no time yet. */
export function formatTime(seconds: number): string {
  if (!(seconds > 0)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** Play time as h m. */
export function formatPlayTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}H ${m % 60}M` : `${m}M`;
}
