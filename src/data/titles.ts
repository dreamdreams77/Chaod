/**
 * Player titles: small bragging rights earned from play, chosen in the lobby's RECORDS menu and
 * shown on the results screen and the share card. Pure functions over the profile.
 */
import { MODE_IDS, Profile } from '../core/save.ts';
import { QUESTS } from './quests.ts';

export interface TitleDef {
  id: string;
  name: string;
  desc: string;
  test: (p: Profile) => boolean;
}

const stars = (p: Profile): number => Object.values(p.stars).reduce((n, s) => n + (s?.length ?? 0), 0);
const bestEndless = (p: Profile): number => Math.max(0, ...Object.values(p.endless).map((e) => e?.rounds ?? 0));
const cleared = (p: Profile): number => MODE_IDS.filter((m) => p.cleared[m].clears > 0).length;
const has = (p: Profile, id: string): boolean => p.achievements.includes(id);

export const TITLES: TitleDef[] = [
  { id: 'rookie', name: 'ROOKIE TESTER', desc: 'Everyone starts here.', test: () => true },
  { id: 'hopper', name: 'WORLD HOPPER', desc: 'Clear three different worlds.', test: (p) => cleared(p) >= 3 },
  { id: 'fluid', name: 'GENRE FLUID', desc: 'Clear every world.', test: (p) => cleared(p) >= MODE_IDS.length },
  { id: 'jockey', name: 'DISK JOCKEY', desc: 'Back up ten floppy disks.', test: (p) => p.floppies.length >= 10 },
  { id: 'archivist', name: 'THE ARCHIVIST', desc: 'Back up every floppy disk.', test: (p) => has(p, 'floppy15') },
  { id: 'starry', name: 'STAR COLLECTOR', desc: 'Earn twelve mastery stars.', test: (p) => stars(p) >= 12 },
  { id: 'gold', name: 'GOLD STANDARD', desc: 'Earn every mastery star in every world.', test: (p) => stars(p) >= MODE_IDS.length * 3 },
  { id: 'marathon', name: 'ENDLESS RUNNER', desc: 'Survive ten rounds of an ENDLESS RUN.', test: (p) => bestEndless(p) >= 10 },
  { id: 'robot', name: 'ROBOT MASTER', desc: 'Defeat all four robot masters.', test: (p) => has(p, 'bolt_all') },
  { id: 'stacker', name: 'LINE LEGEND', desc: 'Clear four rows at once, and empty a well.', test: (p) => has(p, 'quad_clear') && has(p, 'perfect_clear') },
  { id: 'champ', name: 'HIGH SCORER', desc: 'Defeat THE HIGH SCORE.', test: (p) => p.bossesDefeated.includes('highscore') },
  { id: 'flawless', name: 'UNTOUCHABLE', desc: 'Defeat THE HIGH SCORE without being hit.', test: (p) => has(p, 'perfect_score') },
  { id: 'whisperer', name: 'BYTE WHISPERER', desc: 'Raise BYTE to GIGABYTE.', test: (p) => has(p, 'pet_giga') },
  { id: 'streak', name: 'STREAK KEEPER', desc: 'Reach a seven-day daily streak.', test: (p) => p.daily.streak >= 7 },
  { id: 'quest', name: 'QUESTMASTER', desc: 'Finish every quest on the board.', test: (p) => p.questsDone.length >= QUESTS.length },
  { id: 'rival', name: 'RIVAL BEATER', desc: 'Beat a friend\'s score on a shared link.', test: (p) => has(p, 'rival_beaten') },
];
export const TITLE_BY_ID = new Map(TITLES.map((t) => [t.id, t]));

export function unlockedTitles(p: Profile): TitleDef[] {
  return TITLES.filter((t) => t.test(p));
}

/** The title being worn: the chosen one if it is earned, else the newest (last listed) earned title. */
export function activeTitle(p: Profile): TitleDef {
  const chosen = TITLE_BY_ID.get(p.title);
  if (chosen && chosen.test(p)) return chosen;
  const got = unlockedTitles(p);
  return got[got.length - 1] ?? TITLES[0];
}
