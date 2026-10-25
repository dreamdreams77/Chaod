/**
 * Shared progression: shop, achievements and the run-reward pipeline.
 * `applyRun` is pure (profile in → profile out + summary) so it is unit-tested.
 */
import { MODE_IDS, ModeId, Profile, levelForXp } from '../core/save.ts';
import { newlyUnlocked } from '../fusion/engine.ts';
import { QuestDef, MiniId, MINIS, advanceQuests } from './quests.ts';

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
  { id: 'treats', name: 'PET TREATS', cost: 40, desc: '+1 BYTE bond (max 5). Bond powers BYTE\'s bark.', repeatable: true },
];

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
}
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_clear', name: 'HELLO WORLD', desc: 'Clear any world.' },
  { id: 'all_modes', name: 'GENRE FLUID', desc: 'Clear all five worlds.' },
  { id: 'floppy5', name: 'DISK JOCKEY', desc: 'Collect 5 floppy disks.' },
  { id: 'floppy15', name: 'FULL BACKUP', desc: 'Collect all 15 floppy disks.' },
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
  { id: 'rematch', name: 'BACK FOR MORE', desc: 'Win a boss rematch.' },
  { id: 'beat_rex', name: 'NEW LAP RECORD', desc: 'Beat REX TURBO in NEON PANIC.' },
  { id: 'level5', name: 'LEVELED UP', desc: 'Reach level 5.' },
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
  /** Quest ids completed by this run. */
  quests: string[];
}

export function unlockAchievement(p: Profile, id: string, out: string[]): void {
  if (!p.achievements.includes(id) && ACHIEVEMENTS.some((a) => a.id === id)) {
    p.achievements.push(id);
    out.push(id);
  }
}

export function applyRun(profile: Profile, r: RunResult): { profile: Profile; summary: RunSummary } {
  const p: Profile = structuredCloneSafe(profile);
  const achievements: string[] = [];
  const levelBefore = p.level;
  // Failed runs still pay out partially: failure should be entertaining, not a wipe.
  const bits = Math.round(r.bits * r.bitMultiplier * (r.cleared ? 1 : 0.5));
  const xp = Math.round(r.xp * (r.cleared ? 1 : 0.5));
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
  if (r.rematch && r.cleared) unlockAchievement(p, 'rematch', achievements);
  for (const e of r.chaosSeen) if (!p.chaosEventsSeen.includes(e)) p.chaosEventsSeen.push(e);
  if (p.chaosEventsSeen.length >= 10) unlockAchievement(p, 'chaos10', achievements);
  for (const f of r.flags) unlockAchievement(p, f, achievements);
  if (MODE_IDS.every((m) => p.cleared[m].clears > 0)) unlockAchievement(p, 'all_modes', achievements);
  if (p.floppies.length >= 5) unlockAchievement(p, 'floppy5', achievements);
  if (p.floppies.length >= 15) {
    unlockAchievement(p, 'floppy15', achievements);
    if (!p.secretUnlocked) {
      p.secretUnlocked = true;
      unlockAchievement(p, 'secret', achievements);
    }
  }
  // Quest rewards count toward level-based achievements, so settle them first.
  const quests = advanceQuests(p, { kind: 'run', r, newFloppies, paidBits: bits }).map((q) => q.id);
  if (p.level >= 5) unlockAchievement(p, 'level5', achievements);
  // Virtual-pet care loop: BYTE gets hungry and ready to play again after every adventure.
  p.pet.hunger = Math.min(3, p.pet.hunger + 1);
  p.pet.trainedToday = 0;
  const muts = newlyUnlocked(p).map((m) => m.id);
  for (const m of muts) p.mutationsUnlocked.push(m);
  return { profile: p, summary: { bits, xp, levelBefore, levelAfter: p.level, newFloppies, achievements, mutations: muts, firstClear, quests } };
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

export interface MiniOutcome {
  bits: number;
  best: boolean;
  quests: QuestDef[];
  achievements: string[];
}

/** Records a finished mini-game: pays bits, tracks the personal best, advances quests. Pure. */
export function applyMini(profile: Profile, game: MiniId, rawScore: number): { profile: Profile; outcome: MiniOutcome } {
  const p: Profile = structuredCloneSafe(profile);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.floor(rawScore)) : 0;
  const info = MINIS.find((m) => m.id === game)!;
  const bits = score * info.bitsPerPoint;
  p.bits += bits;
  const rec = p.mini[game] ?? { best: 0, plays: 0 };
  const best = score > rec.best;
  p.mini[game] = { best: Math.max(rec.best, score), plays: rec.plays + 1 };
  const quests = advanceQuests(p, { kind: 'mini', game, score });
  const achievements: string[] = [];
  if (p.level >= 5) unlockAchievement(p, 'level5', achievements);
  return { profile: p, outcome: { bits, best, quests, achievements } };
}
