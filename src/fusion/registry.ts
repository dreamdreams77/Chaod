/**
 * GENRE FUSION — data registry.
 *
 * A Genre owns a set of mechanical Traits. A Mutation fuses traits from two or
 * more genres and declares which game modes know how to honour it. Modes ask
 * the FusionEngine "is trait X active?" and change their rules accordingly.
 *
 * To add a mutation: add an entry to MUTATIONS, then read its trait(s) in the
 * mode(s) listed. No other wiring is required — the hub lab, reward
 * multipliers, banners and tests pick it up automatically.
 */
import { ALL_MODES, type ModeId } from '../core/save.ts';

export type GenreId = 'platformer' | 'shooter' | 'racing' | 'horror' | 'fighter' | 'rpg' | 'rhythm' | 'puzzle' | 'pet' | 'bullethell' | 'strategy' | 'sports';

export const GENRES: Record<GenreId, { name: string; color: string; traits: string[] }> = {
  platformer: { name: 'PLATFORMER', color: '#ffcf3f', traits: ['jumping', 'gravity', 'moving_platforms', 'vertical_traversal'] },
  shooter: { name: 'SHOOTER', color: '#3fffcf', traits: ['projectiles', 'ammo', 'scrolling_waves'] },
  racing: { name: 'RACING', color: '#3fe0ff', traits: ['acceleration', 'steering', 'drifting', 'vehicle_damage'] },
  horror: { name: 'SURVIVAL HORROR', color: '#b3122e', traits: ['limited_resources', 'threat_escalation', 'hiding', 'pursuit'] },
  fighter: { name: 'FIGHTER', color: '#ff6f3f', traits: ['combos', 'blocking', 'special_attacks', 'stun'] },
  rpg: { name: 'RPG', color: '#7dff6b', traits: ['experience', 'stats', 'equipment', 'status_effects'] },
  rhythm: { name: 'RHYTHM', color: '#ff3fd2', traits: ['musical_timing', 'beat_sync', 'timing_windows', 'combo_multiplier'] },
  puzzle: { name: 'PUZZLE', color: '#b07aff', traits: ['switches', 'logic_rules', 'environment_manipulation', 'spatial_constraints'] },
  pet: { name: 'VIRTUAL PET', color: '#9dff3f', traits: ['care', 'bond', 'personality', 'training'] },
  strategy: { name: 'STRATEGY', color: '#7dff6b', traits: ['placement', 'economy', 'waves', 'upgrades'] },
  sports: { name: 'SPORTS', color: '#ff9f3f', traits: ['scoring', 'possession', 'timing_shots'] },
  bullethell: { name: 'BULLET HELL', color: '#ff7af5', traits: ['dense_patterns', 'grazing', 'dodging'] },
};

export type UnlockRule =
  | { kind: 'start' }
  | { kind: 'clear'; mode: ModeId }
  | { kind: 'boss'; boss: string }
  | { kind: 'floppies'; count: number }
  | { kind: 'ending' };

export interface MutationDef {
  id: string;
  name: string;
  genres: GenreId[];
  /** One-line description shown in the hub lab and on the in-level banner. */
  tagline: string;
  /** Gameplay traits this mutation switches on (read by modes). */
  traits: string[];
  modes: ModeId[];
  params: Record<string, number>;
  unlock: UnlockRule;
  /** CURSED mutations are opt-in: a real drawback in exchange for a bigger bit bonus. */
  cursed?: boolean;
}

export const MUTATIONS: MutationDef[] = [
  {
    id: 'beat_platforms',
    name: 'BEAT BRIDGES',
    genres: ['platformer', 'rhythm'],
    tagline: 'Pink & cyan platforms only exist on their half of the beat.',
    traits: ['beat_platforms'],
    modes: ['rampage'],
    params: { beatsPerPhase: 2, warnBeats: 0.5 },
    unlock: { kind: 'start' },
  },
  {
    id: 'switch_shots',
    name: 'TRICK SHOT',
    genres: ['shooter', 'puzzle'],
    tagline: 'Blaster shots flip switches that open secret gates.',
    traits: ['shots_trigger_switches'],
    modes: ['rampage'],
    params: {},
    unlock: { kind: 'start' },
  },
  {
    id: 'lurker_pursuit',
    name: 'NIGHT DRIVE',
    genres: ['racing', 'horror'],
    tagline: 'At midnight THE LURKER hunts you. Slow down and it feeds.',
    traits: ['lurker', 'midnight_shift'],
    modes: ['neon'],
    params: { lurkerBase: 0.92, fearGain: 0.06 },
    unlock: { kind: 'start' },
  },
  {
    id: 'beat_boost',
    name: 'BASS BOOST',
    genres: ['racing', 'rhythm'],
    tagline: 'Boost exactly on the beat for a PERFECT boost.',
    traits: ['beat_boost'],
    modes: ['neon'],
    params: { windowMs: 110, perfectMult: 1.6 },
    unlock: { kind: 'clear', mode: 'neon' },
  },
  {
    id: 'pet_guardian',
    name: 'GOOD BOY PROTOCOL',
    genres: ['pet', 'horror'],
    tagline: 'BYTE follows you. Its bond decides how long its bark stuns the stalker.',
    traits: ['pet_companion', 'pet_bark'],
    modes: ['mall'],
    params: { baseStun: 1.5, stunPerBond: 0.7, cooldown: 9 },
    unlock: { kind: 'start' },
  },
  {
    id: 'slap_shot',
    name: 'SLAP SHOT',
    genres: ['sports', 'bullethell'],
    tagline: 'A ball in flight smashes every bullet it touches, clearing a lane to the net.',
    traits: ['ball_shield'],
    modes: ['penalty'],
    params: { radius: 11 },
    unlock: { kind: 'start' },
  },
  {
    id: 'tower_xp',
    name: 'VETERAN TOWERS',
    genres: ['strategy', 'rpg'],
    tagline: 'Towers earn XP from kills and level up on their own, getting stronger as the wave goes on.',
    traits: ['tower_levels'],
    modes: ['command'],
    params: { killsPerLevel: 6, maxLevel: 4 },
    unlock: { kind: 'start' },
  },
  {
    id: 'combo_xp',
    name: 'GRINDCORE',
    genres: ['fighter', 'rpg'],
    tagline: 'Combo hits earn XP mid-fight. Level up and hit harder instantly.',
    traits: ['combo_xp', 'in_fight_levelup'],
    modes: ['beatdown'],
    params: { xpPerHit: 3, comboBonus: 2 },
    unlock: { kind: 'start' },
  },
  {
    id: 'block_rain',
    name: 'LINE CLEAR KO',
    genres: ['puzzle', 'fighter'],
    tagline: 'Falling blocks stack in the arena. Fill a row to crush the boss.',
    traits: ['block_rain', 'line_clear_damage'],
    modes: ['beatdown'],
    params: { lineDamage: 9 },
    unlock: { kind: 'start' },
  },
  {
    id: 'note_bullets',
    name: 'SHOTS ON THE ONE',
    genres: ['rhythm', 'bullethell'],
    tagline: 'Every on-time note fires at DJ STATIC. Misses let static bullets through.',
    traits: ['note_shots', 'lane_bullets'],
    modes: ['rhythm'],
    params: { damagePerfect: 3, damageGood: 1 },
    unlock: { kind: 'start' },
  },
  {
    id: 'rpg_drift',
    name: 'DRIFT ENCOUNTERS',
    genres: ['racing', 'rpg'],
    tagline: 'Long drifts charge a turn-based "SKILL CHECK" for bonus speed.',
    traits: ['drift_skillcheck'],
    modes: ['neon'],
    params: { driftNeeded: 1.4 },
    unlock: { kind: 'boss', boss: 'bricklord' },
  },
];

/** The four curses, available once the Core is restored and switched OFF until you opt in. Their rules live in ModeBase. */
const CURSED_MODES = ALL_MODES;
MUTATIONS.push(
  { id: 'curse_greed', name: 'PAWN SHOP', genres: ['strategy', 'horror'], tagline: 'CURSED: you take double damage, but bits pay 50% more.', traits: ['curse_greed'], modes: CURSED_MODES, params: {}, unlock: { kind: 'ending' }, cursed: true },
  { id: 'curse_haste', name: 'TURBO TERROR', genres: ['racing', 'horror'], tagline: 'CURSED: everything runs 20% faster, but bits pay more.', traits: ['curse_haste'], modes: CURSED_MODES, params: {}, unlock: { kind: 'ending' }, cursed: true },
  { id: 'curse_static', name: 'STATIC STORM', genres: ['rhythm', 'horror'], tagline: 'CURSED: chaos events at HIGH intensity, but bits pay more.', traits: ['curse_static'], modes: CURSED_MODES, params: {}, unlock: { kind: 'ending' }, cursed: true },
  { id: 'curse_frail', name: 'PAPER HEART', genres: ['pet', 'fighter'], tagline: 'CURSED: one fewer heart, but XP is doubled.', traits: ['curse_frail'], modes: CURSED_MODES, params: {}, unlock: { kind: 'ending' }, cursed: true },
);

export const MUTATION_BY_ID = new Map(MUTATIONS.map((m) => [m.id, m]));

export interface UnlockContext {
  cleared: Partial<Record<ModeId, { clears: number }>>;
  bossesDefeated: string[];
  floppies: string[];
  endingSeen?: boolean;
}

export function isUnlockSatisfied(rule: UnlockRule, c: UnlockContext): boolean {
  switch (rule.kind) {
    case 'start': return true;
    case 'clear': return (c.cleared[rule.mode]?.clears ?? 0) > 0;
    case 'boss': return c.bossesDefeated.includes(rule.boss);
    case 'floppies': return c.floppies.length >= rule.count;
    case 'ending': return c.endingSeen === true;
  }
}

export function describeUnlock(rule: UnlockRule): string {
  switch (rule.kind) {
    case 'start': return 'AVAILABLE';
    case 'clear': return `CLEAR ${rule.mode.toUpperCase()}`;
    case 'boss': return `DEFEAT ${rule.boss.toUpperCase()}`;
    case 'floppies': return `FIND ${rule.count} FLOPPIES`;
    case 'ending': return 'RESTORE THE CORE';
  }
}

/** Sanity checks used by tests and by the dev build at startup. */
export function validateRegistry(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const validModes = ALL_MODES;
  for (const m of MUTATIONS) {
    if (ids.has(m.id)) errors.push(`duplicate mutation id ${m.id}`);
    ids.add(m.id);
    if (new Set(m.genres).size < 2) errors.push(`${m.id}: a mutation must fuse at least two distinct genres`);
    for (const g of m.genres) if (!(g in GENRES)) errors.push(`${m.id}: unknown genre ${g}`);
    if (m.traits.length === 0) errors.push(`${m.id}: no traits`);
    if (m.modes.length === 0) errors.push(`${m.id}: not honoured by any mode`);
    for (const mode of m.modes) if (!validModes.includes(mode)) errors.push(`${m.id}: unknown mode ${mode}`);
  }
  return errors;
}
