/**
 * Weekly goals: three quests drawn from a pool by the UTC week, the same for every player.
 * They reset each Monday and pay out automatically, with a bonus for finishing all three.
 * Pure functions (profile in, mutated in place) so the rules are unit-tested.
 */
import type { Profile } from '../core/save.ts';
import { Rng, seedFromString } from '../core/rng.ts';
import type { QuestEvent } from './quests.ts';

export type WeeklyMetric = 'fast' | 'clears' | 'bits' | 'rounds' | 'disks' | 'clean' | 'chaos' | 'stars' | 'plays' | 'points';

export interface WeeklyDef {
  id: string;
  title: string;
  desc: string;
  metric: WeeklyMetric;
  goal: number;
  bits: number;
  xp: number;
  /** Where PLAY NOW takes you. */
  play: 'worlds' | 'arcade';
}

export const WEEKLY_POOL: WeeklyDef[] = [
  { id: 'w_tour', title: 'WORLD TOUR', desc: 'Clear 4 worlds or bosses this week.', metric: 'clears', goal: 4, bits: 140, xp: 60, play: 'worlds' },
  { id: 'w_baron', title: 'BIT BARON', desc: 'Earn 700 bits from runs this week.', metric: 'bits', goal: 700, bits: 120, xp: 50, play: 'worlds' },
  { id: 'w_marathon', title: 'MARATHONER', desc: 'Survive 8 ENDLESS RUN rounds this week (any worlds).', metric: 'rounds', goal: 8, bits: 150, xp: 70, play: 'worlds' },
  { id: 'w_disks', title: 'DISK DETECTIVE', desc: 'Find 3 floppy disks you do not have yet.', metric: 'disks', goal: 3, bits: 110, xp: 50, play: 'worlds' },
  { id: 'w_clean', title: 'CLEAN SWEEP', desc: 'Clear 2 runs without taking damage.', metric: 'clean', goal: 2, bits: 140, xp: 60, play: 'worlds' },
  { id: 'w_chaos', title: 'CHAOS CHASER', desc: 'Witness 25 chaos events across your runs.', metric: 'chaos', goal: 25, bits: 110, xp: 50, play: 'worlds' },
  { id: 'w_stars', title: 'STAR SEEKER', desc: 'Earn 3 mastery stars.', metric: 'stars', goal: 3, bits: 130, xp: 60, play: 'worlds' },
  { id: 'w_arcade', title: 'ARCADE WEEK', desc: 'Finish 10 mini-game rounds.', metric: 'plays', goal: 10, bits: 100, xp: 40, play: 'arcade' },
  { id: 'w_points', title: 'HIGH ROLLER', desc: 'Score 250 points across mini-games.', metric: 'points', goal: 250, bits: 100, xp: 40, play: 'arcade' },
];
export const WEEKLY_BY_ID = new Map(WEEKLY_POOL.map((w) => [w.id, w]));

export const SWEEP_BITS = 100;
export const SWEEP_XP = 50;

export interface WeeklyState {
  key: string;
  progress: Record<string, number>;
  done: string[];
  swept: boolean;
}

export function emptyWeekly(): WeeklyState {
  return { key: '', progress: {}, done: [], swept: false };
}

/** The Monday (UTC) of the week a date falls in, as YYYY-MM-DD. */
export function weekKey(d: Date = new Date()): string {
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return monday.toISOString().slice(0, 10);
}

/** This week's three goals: seeded by the week, never two of the same kind. */
export function weeklyFor(key: string): WeeklyDef[] {
  const rng = new Rng(seedFromString(`chaos-weekly-${key}`));
  const pool = rng.shuffle(WEEKLY_POOL.slice());
  const out: WeeklyDef[] = [];
  for (const w of pool) {
    if (out.length < 3 && !out.some((o) => o.metric === w.metric)) out.push(w);
  }
  return out;
}

/** How much progress an event adds to a weekly goal. */
export function weeklyGain(w: { metric: WeeklyMetric }, ev: QuestEvent): number {
  if (ev.kind === 'run') {
    const r = ev.r;
    switch (w.metric) {
      case 'clears': return r.cleared ? 1 : 0;
      case 'fast': return r.cleared && !r.endless && r.time < 150 ? 1 : 0;
      case 'bits': return ev.paidBits;
      case 'rounds': return r.endless?.rounds ?? 0;
      case 'disks': return ev.newFloppies;
      case 'clean': return r.cleared && r.damageTaken === 0 ? 1 : 0;
      case 'chaos': return r.chaosSeen.length;
      case 'stars': return ev.newStars;
    }
    return 0;
  }
  if (w.metric === 'plays') return 1;
  if (w.metric === 'points') return Math.max(0, Math.floor(ev.score));
  return 0;
}

/** This week's state for display: last week's progress shows as a fresh start. */
export function weeklyView(p: Pick<Profile, 'weekly'>, today: string = weekKey()): WeeklyState {
  return p.weekly.key === today ? p.weekly : { key: today, progress: {}, done: [], swept: false };
}

/** Advances this week's goals on `p` (mutating it) and pays rewards. Returns the ids finished by this event ('sweep' for the bonus). */
export function advanceWeekly(p: Profile, ev: QuestEvent, today: string = weekKey(), payMult = 1): string[] {
  if (p.weekly.key !== today) p.weekly = { key: today, progress: {}, done: [], swept: false };
  const w = p.weekly;
  const finished: string[] = [];
  const goals = weeklyFor(today);
  for (const g of goals) {
    if (w.done.includes(g.id)) continue;
    const gain = weeklyGain(g, ev);
    if (gain <= 0) continue;
    const next = Math.min(g.goal, (w.progress[g.id] ?? 0) + gain);
    w.progress[g.id] = next;
    if (next >= g.goal) {
      w.done.push(g.id);
      p.bits += Math.round(g.bits * payMult);
      p.xp += Math.round(g.xp * payMult);
      finished.push(g.id);
    }
  }
  if (!w.swept && goals.every((g) => w.done.includes(g.id))) {
    w.swept = true;
    p.bits += SWEEP_BITS;
    p.xp += SWEEP_XP;
    finished.push('sweep');
  }
  return finished;
}
