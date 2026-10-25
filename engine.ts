/**
 * FusionEngine — resolves which mutations are live for a run and answers trait
 * queries from game modes. Deliberately tiny: modes own their behaviour; the
 * engine only decides *what is on*.
 */
import type { ModeId, Profile } from '../core/save.ts';
import { GENRES, GenreId, MUTATIONS, MutationDef, isUnlockSatisfied } from './registry.ts';

export class FusionEngine {
  readonly active: MutationDef[];
  private traits = new Set<string>();
  /** Mutations forced on mid-run by scripted genre shifts or chaos events. */
  private temp = new Set<string>();

  constructor(readonly mode: ModeId, profile: Pick<Profile, 'mutationsUnlocked' | 'mutationsDisabled' | 'cleared' | 'bossesDefeated' | 'floppies'>) {
    this.active = MUTATIONS.filter(
      (m) =>
        m.modes.includes(mode) &&
        isUnlockSatisfied(m.unlock, profile) &&
        profile.mutationsUnlocked.includes(m.id) &&
        !profile.mutationsDisabled.includes(m.id),
    );
    for (const m of this.active) for (const t of m.traits) this.traits.add(t);
  }

  has(trait: string): boolean {
    return this.traits.has(trait) || this.temp.has(trait);
  }

  param(mutationId: string, key: string, fallback: number): number {
    const m = this.active.find((x) => x.id === mutationId);
    const v = m?.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  /** Temporarily grant a trait (e.g. a chaos event turns the floor into a note highway). */
  grant(trait: string): void {
    this.temp.add(trait);
  }
  revoke(trait: string): void {
    this.temp.delete(trait);
  }

  /** Each active mutation adds +15% to bit rewards: risk is rewarded. */
  rewardMultiplier(): number {
    return 1 + 0.15 * this.active.length;
  }

  genresInPlay(base: GenreId): GenreId[] {
    const s = new Set<GenreId>([base]);
    for (const m of this.active) for (const g of m.genres) s.add(g);
    return [...s];
  }

  bannerLines(): Array<{ text: string; color: string }> {
    return this.active.map((m) => ({
      text: `${m.genres.map((g) => GENRES[g].name).join(' + ')}: ${m.name}`,
      color: GENRES[m.genres[1]].color,
    }));
  }
}

/** Mutations that become newly unlockable given a profile; used after each run. */
export function newlyUnlocked(profile: Profile): MutationDef[] {
  return MUTATIONS.filter((m) => !profile.mutationsUnlocked.includes(m.id) && isUnlockSatisfied(m.unlock, profile));
}
