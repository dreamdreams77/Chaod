/**
 * Run perks: before a run (and before every ENDLESS round) you pick one of three random perks.
 * Each is a small, stackable twist applied by ModeBase, plus a few that only make sense in one
 * world. Cursed perks pay more but cost something. Pure data and functions so they are tested.
 */
import type { ModeId } from '../core/save.ts';
import type { Rng } from '../core/rng.ts';

export type PerkRarity = 'common' | 'rare' | 'cursed';

export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  rarity: PerkRarity;
  /** Extra hearts (can be negative). */
  hp?: number;
  /** Added to the bit multiplier of the run's payout. */
  bits?: number;
  /** XP multiplier for the run. */
  xp?: number;
  /** Multiplies enemy and bullet toughness (below 1 is easier). */
  diff?: number;
  /** Multiplies the speed of the whole simulation. */
  speed?: number;
  /** Forces chaos to HIGH (unless you turned it off). */
  chaos?: boolean;
  /** Extra hearts healed between ENDLESS rounds. */
  heal?: number;
  /** Only offered in these worlds. */
  modes?: ModeId[];
  /** Only offered in an ENDLESS RUN. */
  endlessOnly?: boolean;
}

export const PERKS: PerkDef[] = [
  { id: 'vitality', name: 'SPARE HEART', desc: '+1 max heart for this run.', rarity: 'common', hp: 1 },
  { id: 'magnet', name: 'LUCKY CHARM', desc: '+25% bits from this run.', rarity: 'common', bits: 0.25 },
  { id: 'scholar', name: 'QUICK STUDY', desc: '+50% XP from this run.', rarity: 'common', xp: 1.5 },
  { id: 'gentle', name: 'GENTLE WORLD', desc: 'Enemies and bullets are 12% weaker.', rarity: 'common', diff: 0.88 },
  { id: 'slowmo', name: 'SLOW-MO', desc: 'Everything runs 10% slower.', rarity: 'common', speed: 0.9 },
  { id: 'medic', name: 'FIELD MEDIC', desc: 'ENDLESS RUN: heal 1 extra heart between rounds.', rarity: 'common', heal: 1, endlessOnly: true },
  { id: 'twin', name: 'DOUBLE HEART', desc: '+2 max hearts for this run.', rarity: 'rare', hp: 2 },
  { id: 'jackpot', name: 'JACKPOT', desc: '+60% bits and +25% XP.', rarity: 'rare', bits: 0.6, xp: 1.25 },
  { id: 'crackshot', name: 'CRACK SHOT', desc: 'PENALTY STORM: the keeper reacts 30% slower.', rarity: 'rare', modes: ['penalty'] },
  { id: 'architect', name: 'ARCHITECT', desc: 'CORE COMMAND: start with 60 extra cash.', rarity: 'rare', modes: ['command'] },
  { id: 'bombbag', name: 'BOMB BAG', desc: 'THE HIGH SCORE: start with 2 extra bombs.', rarity: 'rare', modes: ['highscore'] },
  { id: 'glass', name: 'GLASS HEART', desc: 'CURSED: one fewer heart, but +60% bits.', rarity: 'cursed', hp: -1, bits: 0.6 },
  { id: 'frenzy', name: 'FRENZY', desc: 'CURSED: everything is 15% faster, but +40% bits.', rarity: 'cursed', speed: 1.15, bits: 0.4 },
  { id: 'storm', name: 'STORM CHASER', desc: 'CURSED: chaos events at HIGH, but +35% bits.', rarity: 'cursed', chaos: true, bits: 0.35 },
];
export const PERK_BY_ID = new Map(PERKS.map((p) => [p.id, p]));

const WEIGHT: Record<PerkRarity, number> = { common: 6, rare: 3, cursed: 2 };

/** Three different perks for this world, none you already hold. */
export function offerPerks(rng: Rng, mode: ModeId, held: readonly string[], endless = false, n = 3): PerkDef[] {
  const pool = PERKS.filter((p) => !held.includes(p.id) && (!p.modes || p.modes.includes(mode)) && (!p.endlessOnly || endless));
  const out: PerkDef[] = [];
  while (out.length < n && pool.length) {
    const pick = rng.weighted(pool, (p) => WEIGHT[p.rarity]);
    if (!pick) break;
    out.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return out;
}

/** Sums what a set of perks does (unknown ids are ignored, so an old link or save cannot break a run). */
export function perkTotals(ids: readonly string[] | undefined): { defs: PerkDef[]; hp: number; bits: number; xp: number; diff: number; speed: number; chaos: boolean; heal: number } {
  const defs = (ids ?? []).map((id) => PERK_BY_ID.get(id)).filter((p): p is PerkDef => !!p);
  return {
    defs,
    hp: defs.reduce((a, p) => a + (p.hp ?? 0), 0),
    bits: defs.reduce((a, p) => a + (p.bits ?? 0), 0),
    xp: defs.reduce((a, p) => a * (p.xp ?? 1), 1),
    diff: defs.reduce((a, p) => a * (p.diff ?? 1), 1),
    speed: defs.reduce((a, p) => a * (p.speed ?? 1), 1),
    chaos: defs.some((p) => p.chaos),
    heal: defs.reduce((a, p) => a + (p.heal ?? 0), 0),
  };
}
