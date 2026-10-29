/**
 * Mastery stars: three optional goals per world, earned on a cleared run and shown on the
 * cabinet. Pure functions so they can be tested; applyRun pays the rewards.
 */
import { ModeId, Profile } from '../core/save.ts';
import type { RunResult } from './progression.ts';

export type StarId = 'clean' | 'fast' | 'collector';

export const STAR_BITS = 40;
export const STAR_XP = 15;

export interface StarDef {
  id: StarId;
  name: string;
  desc: (mode: ModeId) => string;
}

/** Par clear times in seconds; a "fast" star needs a faster clear. */
export const PAR_SECONDS: Record<ModeId, number> = { rampage: 160, neon: 130, mall: 330, beatdown: 120, rhythm: 200, command: 300, penalty: 100, blocks: 150, bolt: 150, munch: 150, wrestle: 200, pinball: 140, highscore: 180 };

export const STARS: StarDef[] = [
  { id: 'clean', name: 'UNTOUCHED', desc: () => 'Clear it without taking damage.' },
  { id: 'fast', name: 'SPEEDY', desc: (m) => `Clear it in under ${PAR_SECONDS[m]} seconds.` },
  { id: 'collector', name: 'COLLECTOR', desc: () => 'Have all 3 floppies from this world.' },
];

/** Stars this run earns (including ones already owned); `p` must already include this run's floppies. */
export function starsEarned(p: Pick<Profile, 'floppies'>, r: Pick<RunResult, 'mode' | 'cleared' | 'damageTaken' | 'time'>): StarId[] {
  if (!r.cleared) return [];
  const out: StarId[] = [];
  if (r.damageTaken === 0) out.push('clean');
  if (r.time < PAR_SECONDS[r.mode]) out.push('fast');
  if ([0, 1, 2].every((i) => p.floppies.includes(`${r.mode}-${i}`))) out.push('collector');
  return out;
}

export function starCount(p: Pick<Profile, 'stars'>, mode: ModeId): number {
  return p.stars[mode]?.length ?? 0;
}

/** Adds new stars to the profile (mutating it) and pays the rewards; returns the stars that are new. */
export function awardStars(p: Profile, r: Pick<RunResult, 'mode' | 'cleared' | 'damageTaken' | 'time'>): StarId[] {
  const have = new Set<string>(p.stars[r.mode] ?? []);
  const fresh = starsEarned(p, r).filter((s) => !have.has(s));
  if (fresh.length) {
    p.stars[r.mode] = [...have, ...fresh] as string[];
    p.bits += STAR_BITS * fresh.length;
    p.xp += STAR_XP * fresh.length;
  }
  return fresh;
}
