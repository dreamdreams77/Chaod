/**
 * Shared progression: shop, achievements and the run-reward pipeline.
 * `applyRun` is pure (profile in → profile out + summary) so it is unit-tested.
 */
import { MODE_IDS, ModeId, Profile, TOTAL_FLOPPIES, levelForXp } from '../core/save.ts';
import { newlyUnlocked } from '../fusion/engine.ts';
import { MUTATION_BY_ID } from '../fusion/registry.ts';
import { QuestDef, MiniId, MINIS, advanceQuests } from './quests.ts';
import { applyDailyResult } from './daily.ts';
import { awardStars } from './mastery.ts';
import { advanceWeekly, weekKey } from './weekly.ts';
import { advanceErrand } from './errands.ts';
import { SEASON_BONUS, seasonFor } from './season.ts';
import { dateKey } from './daily.ts';

export interface ShopItem {
  id: string;
  name: string;
  cost: number;
  desc: string;
  requires?: string;
  repeatable?: boolean;
}

export const SHOP: ShopItem[] = [
  { id: 'double_jump', name: 'DOUBLE JUMP', cost: 120, desc: 'Jump again in mid-air (platformer & fighter).' },
  { id: 'armor1', name: 'HEART CONTAINER', cost: 100, desc: '+1 max health in every mode.' },
  { id: 'armor2', name: 'HEART CONTAINER II', cost: 200, desc: '+1 more max health.', requires: 'armor1' },
  { id: 'overclock', name: 'OVERCLOCK CHIP', cost: 150, desc: '+2 energy: more blaster shots, boosts and specials.' },
  { id: 'magnet', name: 'BIT MAGNET', cost: 80, desc: 'Pull nearby bits toward you.' },
  { id: 'nitro', name: 'NITRO TANK', cost: 110, desc: 'Start races with a full boost and boost longer.' },
  { id: 'treats', name: 'PET TREATS', cost: 40, desc: '+3 care for BYTE: builds bond and helps it grow. Bond powers its bark.', repeatable: true },
];

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
}
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_clear', name: 'HELLO WORLD', desc: 'Clear any world.' },
  { id: 'all_modes', name: 'GENRE FLUID', desc: 'Clear every world.' },
  { id: 'floppy5', name: 'DISK JOCKEY', desc: 'Collect 5 floppy disks.' },
  { id: 'floppy15', name: 'FULL BACKUP', desc: `Collect all ${TOTAL_FLOPPIES} floppy disks.` },
  { id: 'boss_bricklord', name: 'LINE CLEAR', desc: 'Defeat BRICKLORD MAX.' },
  { id: 'boss_static', name: 'DROP THE BEAT', desc: 'Defeat DJ STATIC.' },
  { id: 'mercy2', name: 'FREE THE FINAL LEVELS', desc: 'Set both bosses free.' },
  { id: 'purge', name: 'CTRL+ALT+DELETE', desc: 'Delete a boss.' },
  { id: 'chaos10', name: 'AGENT OF CHAOS', desc: 'Witness 10 different chaos events.' },
  { id: 'kevin', name: 'TICKET CLOSED', desc: 'Watch Kevin "fix" a rule.' },
  { id: 'fatal', name: 'BLUE SCREEN SURVIVOR', desc: 'Win a FATAL EXCEPTION.' },
  { id: 'combo50', name: 'IN THE POCKET', desc: 'Reach a 50 combo in GLITCH RHYTHM.' },
  { id: 'unseen', name: 'MALL RAT', desc: 'Escape the mall without getting caught.' },
  { id: 'no_damage', name: 'UNTOUCHABLE', desc: 'Clear a world without taking damage.' },
  { id: 'pet_max', name: 'BEST FRIENDS', desc: 'Reach bond 5 with BYTE.' },
  { id: 'pet_evolve', name: 'IT\'S EVOLVING', desc: 'Help BYTE grow into a new form.' },
  { id: 'pet_giga', name: 'GIGABYTE GOOD BOY', desc: 'Raise BYTE to GIGABYTE.' },
  { id: 'rematch', name: 'BACK FOR MORE', desc: 'Win a boss rematch.' },
  { id: 'beat_rex', name: 'NEW LAP RECORD', desc: 'Beat REX TURBO in NEON PANIC.' },
  { id: 'level5', name: 'LEVELED UP', desc: 'Reach level 5.' },
  { id: 'quad_clear', name: 'FOUR AT ONCE', desc: 'Clear four rows at once in BLOCK PARTY.' },
  { id: 'perfect_clear', name: 'SPOTLESS', desc: 'Empty the whole well in BLOCK PARTY.' },
  { id: 'bolt_all', name: 'ROBOT MASTER', desc: 'Defeat all four robot masters in BOLT BRIGADE.' },
  { id: 'bolt_fortress', name: 'FORTRESS BREAKER', desc: 'Clear the BOLT BRIGADE fortress.' },
  { id: 'secret_dash', name: 'WHO\'S A GOOD DOG', desc: 'Play DEMO DASH in the secret cabinet.' },
  { id: 'boss_highscore', name: 'NEW HIGH SCORE', desc: 'Defeat THE HIGH SCORE and complete the Manual.' },
  { id: 'perfect_score', name: 'PERFECT SCORE', desc: 'Defeat THE HIGH SCORE without being hit.' },
  { id: 'gauntlet', name: 'GAUNTLET RUNNER', desc: 'Win the whole BOSS GAUNTLET in one go.' },
  { id: 'hat_trick', name: 'HAT TRICK', desc: 'Score 3 goals in a row without being hit in PENALTY STORM.' },
  { id: 'flawless_core', name: 'PERFECT DEFENSE', desc: 'Clear CORE COMMAND without a single leak.' },
  { id: 'boss_rush', name: 'RUSH HOUR', desc: 'Beat BRICKLORD MAX and DJ STATIC back to back in BOSS RUSH.' },
  { id: 'endless5', name: 'NO END IN SIGHT', desc: 'Survive 5 rounds of an ENDLESS RUN.' },
  { id: 'nightmare', name: 'SLEEPLESS', desc: 'Clear a world in NIGHTMARE mode.' },
  { id: 'ending', name: 'REBOOT', desc: 'Restore the Cartridge Core.' },
  { id: 'secret', name: 'GOOD BOY', desc: 'Find the secret character.' },
];

export interface RunResult {
  mode: ModeId;
  cleared: boolean;
  score: number;
  time: number;
  bits: number;
  xp: number;
  floppies: string[]; // ids like "rampage-0"
  damageTaken: number;
  flags: string[]; // achievement triggers e.g. 'fatal', 'kevin', 'combo50', 'unseen', 'beat_rex'
  boss?: string;
  rematch?: boolean;
  chaosSeen: string[];
  bitMultiplier: number;
  /** Set on daily challenge runs (with the UTC date) and on runs started from a shared link. */
  challenge?: 'daily' | 'shared';
  dailyKey?: string;
  /** Set on a finished ENDLESS RUN: rounds cleared before falling (or banking). */
  endless?: { rounds: number };
}

export interface RunSummary {
  bits: number;
  xp: number;
  levelBefore: number;
  levelAfter: number;
  newFloppies: number;
  achievements: string[];
  mutations: string[];
  firstClear: boolean;
  /** Bits paid for clearing today's daily challenge, and the streak it leaves. */
  dailyBonus: number;
  dailyStreak: number;
  /** Mastery stars first earned on this run. */
  newStars: string[];
  /** Quest ids completed by this run. */
  quests: string[];
  /** Weekly goal ids finished by this run ('sweep' for the all-three bonus). */
  weekly: string[];
  /** Title of today's lobby errand if this run finished it. */
  errand: string | null;
}

export function unlockAchievement(p: Profile, id: string, out: string[]): void {
  if (!p.achievements.includes(id) && ACHIEVEMENTS.some((a) => a.id === id)) {
    p.achievements.push(id);
    out.push(id);
  }
}

export function applyRun(profile: Profile, r: RunResult, today: string = weekKey(), day: string = dateKey()): { profile: Profile; summary: RunSummary } {
  const p: Profile = structuredCloneSafe(profile);
  const achievements: string[] = [];
  const levelBefore = p.level;
  // Failed runs still pay out partially: failure should be entertaining, not a wipe.
  // An ENDLESS RUN never "clears"; it pays more of its haul the further it got (full pay from round 5).
  const pay = r.cleared ? 1 : r.endless ? Math.min(1, 0.5 + 0.1 * r.endless.rounds) : 0.5;
  const bits = Math.round(r.bits * r.bitMultiplier * pay);
  const xp = Math.round(r.xp * pay);
  p.bits += bits;
  p.xp += xp;
  p.level = levelForXp(p.xp);
  let newFloppies = 0;
  for (const f of r.floppies) {
    if (!p.floppies.includes(f)) {
      p.floppies.push(f);
      newFloppies++;
    }
  }
  if (r.endless) {
    const e = p.endless[r.mode] ?? { rounds: 0, score: 0 };
    p.endless[r.mode] = { rounds: Math.max(e.rounds, r.endless.rounds), score: Math.max(e.score, r.score) };
    if (r.endless.rounds >= 5) unlockAchievement(p, 'endless5', achievements);
  }
  const rec = p.cleared[r.mode];
  const firstClear = r.cleared && rec.clears === 0;
  if (r.cleared) {
    rec.clears++;
    rec.bestScore = Math.max(rec.bestScore, r.score);
    rec.bestTime = rec.bestTime === 0 ? r.time : Math.min(rec.bestTime, r.time);
    unlockAchievement(p, 'first_clear', achievements);
    if (r.damageTaken === 0) unlockAchievement(p, 'no_damage', achievements);
  }
  if (r.boss && r.cleared && !p.bossesDefeated.includes(r.boss)) p.bossesDefeated.push(r.boss);
  if (r.boss && r.cleared) unlockAchievement(p, `boss_${r.boss}`, achievements);
  if (['frostbyte', 'flarebot', 'sproutron', 'voltwire'].every((m) => p.bossesDefeated.includes(m))) unlockAchievement(p, 'bolt_all', achievements);
  if (r.rematch && r.cleared) unlockAchievement(p, 'rematch', achievements);
  for (const e of r.chaosSeen) if (!p.chaosEventsSeen.includes(e)) p.chaosEventsSeen.push(e);
  if (p.chaosEventsSeen.length >= 10) unlockAchievement(p, 'chaos10', achievements);
  for (const f of r.flags) unlockAchievement(p, f, achievements);
  if (MODE_IDS.every((m) => p.cleared[m].clears > 0)) unlockAchievement(p, 'all_modes', achievements);
  if (p.floppies.length >= 5) unlockAchievement(p, 'floppy5', achievements);
  if (p.floppies.length >= TOTAL_FLOPPIES) {
    unlockAchievement(p, 'floppy15', achievements);
    if (!p.secretUnlocked) {
      p.secretUnlocked = true;
      unlockAchievement(p, 'secret', achievements);
    }
  }
  // Quest rewards count toward level-based achievements, so settle them first.
  const newStars = awardStars(p, r);
  let dailyBonus = 0;
  let dailyStreak = 0;
  if (r.challenge === 'daily' && r.dailyKey) ({ bonus: dailyBonus, streak: dailyStreak } = applyDailyResult(p, r.dailyKey, r.score, r.cleared));
  p.level = levelForXp(p.xp); // stars and the daily bonus add XP
  const runEvent = { kind: 'run' as const, r, newFloppies, paidBits: bits, newStars: newStars.length };
  const quests = advanceQuests(p, runEvent).map((q) => q.id);
  const weekly = advanceWeekly(p, runEvent, today, seasonPay(day));
  const errand = advanceErrand(p, runEvent, day)?.title ?? null;
  p.level = levelForXp(p.xp);
  if (p.level >= 5) unlockAchievement(p, 'level5', achievements);
  // Virtual-pet care loop: BYTE gets hungry and ready to play again after every adventure.
  p.pet.hunger = Math.min(3, p.pet.hunger + 1);
  p.pet.trainedToday = 0;
  const muts = newlyUnlocked(p).map((m) => m.id);
  for (const m of muts) {
    p.mutationsUnlocked.push(m);
    // Curses are opt-in: they arrive switched off.
    if (MUTATION_BY_ID.get(m)?.cursed) p.mutationsDisabled.push(m);
  }
  return { profile: p, summary: { bits, xp, levelBefore, levelAfter: p.level, newFloppies, achievements, mutations: muts, firstClear, dailyBonus, dailyStreak, newStars, quests, weekly, errand } };
}

/** Weekly goals pay extra while the lobby is dressed for a season. */
function seasonPay(day: string): number {
  return seasonFor(new Date(`${day}T12:00:00Z`)) ? SEASON_BONUS : 1;
}

export function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Random challenge modifiers applied to replays of cleared worlds (seeded). */
export interface Modifier {
  id: string;
  name: string;
  desc: string;
  bitBonus: number;
}
export const MODIFIERS: Modifier[] = [
  { id: 'glass', name: 'GLASS CANNON', desc: 'You deal double damage but have 1 less heart.', bitBonus: 0.4 },
  { id: 'rich', name: 'BIT STORM', desc: 'Bits are worth double.', bitBonus: 0 },
  { id: 'turbo', name: 'TURBO', desc: 'Everything is 15% faster.', bitBonus: 0.3 },
  { id: 'chaotic', name: 'CHAOS CRANKED', desc: 'The Chaos Director works overtime.', bitBonus: 0.3 },
  { id: 'calm', name: 'SUNDAY DRIVE', desc: 'No chaos events. Fewer rewards.', bitBonus: -0.3 },
];

/** NIGHTMARE mode (unlocked by the ending): a synthetic modifier the base mode understands. */
export const NIGHTMARE: Modifier = { id: 'nightmare', name: 'NIGHTMARE', desc: 'One less heart, double damage taken, chaos cranked. Bits pay double.', bitBonus: 1 };

export interface MiniOutcome {
  bits: number;
  best: boolean;
  quests: QuestDef[];
  /** Weekly goal ids finished by this round. */
  weekly: string[];
  errand: string | null;
  achievements: string[];
}

/** Records a finished mini-game: pays bits, tracks the personal best, advances quests. Pure. */
export function applyMini(profile: Profile, game: MiniId, rawScore: number, today: string = weekKey(), day: string = dateKey()): { profile: Profile; outcome: MiniOutcome } {
  const p: Profile = structuredCloneSafe(profile);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.floor(rawScore)) : 0;
  const info = MINIS.find((m) => m.id === game)!;
  const bits = Math.round(score * info.bitsPerPoint);
  p.bits += bits;
  const rec = p.mini[game] ?? { best: 0, plays: 0 };
  const best = score > rec.best;
  p.mini[game] = { best: Math.max(rec.best, score), plays: rec.plays + 1 };
  const miniEvent = { kind: 'mini' as const, game, score };
  const quests = advanceQuests(p, miniEvent);
  const weekly = advanceWeekly(p, miniEvent, today, seasonPay(day));
  const errand = advanceErrand(p, miniEvent, day)?.title ?? null;
  p.level = levelForXp(p.xp);
  const achievements: string[] = [];
  if (p.level >= 5) unlockAchievement(p, 'level5', achievements);
  if (game === 'dash') unlockAchievement(p, 'secret_dash', achievements);
  return { profile: p, outcome: { bits, best, quests, weekly, errand, achievements } };
}
