/**
 * Lobby errands: each day one of the cast asks for a small favour. The errand and who asks are
 * the same for every player that day; progress is counted from your runs and mini-games and
 * paid automatically. Pure functions (profile mutated in place) so the rules are tested.
 */
import type { Profile } from '../core/save.ts';
import { seedFromString } from '../core/rng.ts';
import type { QuestEvent } from './quests.ts';
import { WeeklyMetric, weeklyGain } from './weekly.ts';

export type Giver = 'rex' | 'kevin' | 'polygon' | 'manual';

export interface ErrandDef {
  id: string;
  giver: Giver;
  title: string;
  /** What the giver says when you first talk to them that day. */
  ask: string[];
  /** And when you come back after finishing. */
  thanks: string[];
  metric: WeeklyMetric;
  goal: number;
  bits: number;
  xp: number;
  /** One line for the Quest Board. */
  summary: string;
}

export const ERRANDS: ErrandDef[] = [
  { id: 'rex_fast', giver: 'rex', title: 'RACE ME', metric: 'fast', goal: 1, bits: 70, xp: 30, summary: 'Clear any world in under 150 seconds.',
    ask: ['Hey, sprite. Lap three of three, forever. You know what I would love? Someone fast.', 'Clear any world in under 150 seconds today and I will tell everyone you are almost as quick as me.'],
    thanks: ['Under 150! Okay. Okay! That was almost as fast as me. Almost. Here, take the winnings.'] },
  { id: 'rex_endless', giver: 'rex', title: 'LONG HAUL', metric: 'rounds', goal: 2, bits: 80, xp: 35, summary: 'Survive 2 ENDLESS RUN rounds.',
    ask: ['I have been stuck on one lap for thirty years. I respect anyone who can keep going.', 'Survive two ENDLESS rounds in any world today. Show me what staying power looks like.'],
    thanks: ['Two rounds and still standing. You and I are the same kind of crazy. Take this.'] },
  { id: 'kevin_chaos', giver: 'kevin', title: 'REPRODUCE THE BUG', metric: 'chaos', goal: 8, bits: 70, xp: 30, summary: 'Witness 8 chaos events.',
    ask: ['Ticket #0002: "weird stuff keeps happening". I need steps to reproduce.', 'Go play with the Chaos Director on and watch eight events. Do not fix anything. Just witness.'],
    thanks: ['Eight events logged. Status: WORKS AS INTENDED. Thanks, here is a bounty.'] },
  { id: 'kevin_disk', giver: 'kevin', title: 'LOST AND FOUND', metric: 'disks', goal: 1, bits: 90, xp: 35, summary: 'Find a floppy disk you do not have yet.',
    ask: ['Someone filed a ticket for a missing backup. I think it is one of the floppies hiding in the worlds.', 'Find one you do not have yet today. I will close the ticket and owe you one.'],
    thanks: ['Found it! Ticket closed. Reason: FIXED BY SOMEONE ELSE. Here is your bounty.'] },
  { id: 'polygon_bits', giver: 'polygon', title: 'SHOPPING FUND', metric: 'bits', goal: 250, bits: 80, xp: 30, summary: 'Earn 250 bits from runs.',
    ask: ['Darling, the shop is quiet and my crystal ball says you will be rich today.', 'Earn 250 bits from your runs and I will add a little bonus on top of it.'],
    thanks: ['The ball was right! 250 bits earned, and a bonus from me. Spend it wisely. Or not.'] },
  { id: 'polygon_points', giver: 'polygon', title: 'ARCADE FORTUNE', metric: 'points', goal: 120, bits: 70, xp: 30, summary: 'Score 120 points in mini-games.',
    ask: ['I see a high score in your future. In the little arcade, I think.', 'Score 120 points across the mini-games today and the stars will agree with me.'],
    thanks: ['120 points! The stars aligned. Here is a little something from the cosmos.'] },
  { id: 'manual_clean', giver: 'manual', title: 'A CLEAN PAGE', metric: 'clean', goal: 1, bits: 90, xp: 40, summary: 'Clear a run without taking damage.',
    ask: ['I have a theory that a perfect run leaves a perfect page behind. I would love to read one.', 'Clear any run today without taking damage. Not a scratch.'],
    thanks: ['Not a scratch! A beautiful page. I have written you into the margin. Take this.'] },
  { id: 'manual_star', giver: 'manual', title: 'GOLD STAR', metric: 'stars', goal: 1, bits: 90, xp: 40, summary: 'Earn a mastery star.',
    ask: ['Each world has optional goals marked with stars. I like stars. They are tidy.', 'Earn one new mastery star today and I will be very pleased.'],
    thanks: ['A new star! Tidy. Delightful. This is for you.'] },
];
export const ERRAND_BY_ID = new Map(ERRANDS.map((e) => [e.id, e]));

/** Today's errand: the same for everyone on a given UTC date. */
export function errandFor(day: string): ErrandDef {
  return ERRANDS[seedFromString(`chaos-errand-${day}`) % ERRANDS.length];
}

export type ErrandState = Profile['errand'];

/** The state for display: yesterday's progress shows as a fresh start. */
export function errandView(p: Pick<Profile, 'errand'>, day: string): ErrandState {
  return p.errand.key === day ? p.errand : { key: day, progress: 0, done: false, asked: false, thanked: false };
}

/** Advances today's errand on `p` (mutating it); returns it when this event finished it. */
export function advanceErrand(p: Profile, ev: QuestEvent, day: string): ErrandDef | null {
  if (p.errand.key !== day) p.errand = { key: day, progress: 0, done: false, asked: false, thanked: false };
  const e = errandFor(day);
  if (p.errand.done) return null;
  const gain = weeklyGain(e, ev);
  if (gain <= 0) return null;
  p.errand.progress = Math.min(e.goal, p.errand.progress + gain);
  if (p.errand.progress < e.goal) return null;
  p.errand.done = true;
  p.bits += e.bits;
  p.xp += e.xp;
  return e;
}
