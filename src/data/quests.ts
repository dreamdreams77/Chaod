/**
 * Quest board + mini-game rewards. Progress is stored on the profile and advanced by
 * pure functions (profile in → profile out), so everything here is unit-tested.
 */
import { Profile, levelForXp } from '../core/save.ts';
import type { RunResult } from './progression.ts';

export type MiniId = 'catch' | 'memory';

export interface MiniInfo {
  id: MiniId;
  title: string;
  blurb: string;
  /** Bits paid per point of score (rounded). */
  bitsPerPoint: number;
  /** Player-facing payout line. */
  pays: string;
  unit: string;
}

export const MINIS: MiniInfo[] = [
  { id: 'catch', title: 'CART CATCH', blurb: 'Catch bits and floppies in your cartridge. Dodge the glitch bugs. 30 seconds.', bitsPerPoint: 0.4, pays: 'Pays 2 bits per 5 points.', unit: 'PTS' },
  { id: 'memory', title: 'GLITCH MEMORY', blurb: 'Watch the lane lights, then repeat the pattern on the arrows. It only gets longer.', bitsPerPoint: 4, pays: 'Pays 4 bits per round cleared.', unit: 'ROUNDS' },
];

export interface QuestDef {
  id: string;
  title: string;
  desc: string;
  goal: number;
  bits: number;
  xp: number;
}

export const QUESTS: QuestDef[] = [
  { id: 'bit_hoard', title: 'BIT HOARDER', desc: 'Earn 400 bits from runs.', goal: 400, bits: 70, xp: 30 },
  { id: 'run_clears', title: 'GAME CLEARER', desc: 'Clear 5 worlds or bosses.', goal: 5, bits: 80, xp: 40 },
  { id: 'untouchable', title: 'UNTOUCHABLE', desc: 'Clear a run without taking damage.', goal: 1, bits: 100, xp: 50 },
  { id: 'chaos_tourist', title: 'CHAOS TOURIST', desc: 'Witness 5 different chaos events in one run (Chaos NORMAL or HIGH).', goal: 1, bits: 70, xp: 35 },
  { id: 'speed_demon', title: 'SPEED DEMON', desc: 'Clear a world (not a boss) in under 150 seconds.', goal: 1, bits: 90, xp: 45 },
  { id: 'disk_diver', title: 'DISK DIVER', desc: 'Find 4 new floppy disks.', goal: 4, bits: 60, xp: 30 },
  { id: 'arcade_regular', title: 'ARCADE REGULAR', desc: 'Play 5 lobby mini-games.', goal: 5, bits: 50, xp: 20 },
  { id: 'arcade_ace', title: 'ARCADE ACE', desc: 'Score 50+ in CART CATCH.', goal: 1, bits: 70, xp: 30 },
  { id: 'memory_master', title: 'MEMORY MASTER', desc: 'Clear 6 rounds in GLITCH MEMORY.', goal: 1, bits: 70, xp: 30 },
];

export const QUEST_BY_ID = new Map(QUESTS.map((q) => [q.id, q]));

export type QuestEvent =
  | { kind: 'run'; r: RunResult; newFloppies: number; paidBits: number }
  | { kind: 'mini'; game: MiniId; score: number };

/** How much progress an event adds to a quest. */
export function questGain(q: QuestDef, ev: QuestEvent): number {
  if (ev.kind === 'run') {
    const r = ev.r;
    switch (q.id) {
      case 'bit_hoard': return ev.paidBits;
      case 'run_clears': return r.cleared ? 1 : 0;
      case 'untouchable': return r.cleared && r.damageTaken === 0 ? 1 : 0;
      case 'chaos_tourist': return r.chaosSeen.length >= 5 ? 1 : 0;
      case 'speed_demon': return r.cleared && !r.boss && r.time < 150 ? 1 : 0;
      case 'disk_diver': return ev.newFloppies;
    }
    return 0;
  }
  switch (q.id) {
    case 'arcade_regular': return 1;
    case 'arcade_ace': return ev.game === 'catch' && ev.score >= 50 ? 1 : 0;
    case 'memory_master': return ev.game === 'memory' && ev.score >= 6 ? 1 : 0;
  }
  return 0;
}

/** Advances quests on `p` (mutating it) and pays rewards; returns the quests finished by this event. */
export function advanceQuests(p: Profile, ev: QuestEvent): QuestDef[] {
  const finished: QuestDef[] = [];
  for (const q of QUESTS) {
    if (p.questsDone.includes(q.id)) continue;
    const gain = questGain(q, ev);
    if (gain <= 0) continue;
    const next = Math.min(q.goal, (p.questProgress[q.id] ?? 0) + gain);
    p.questProgress[q.id] = next;
    if (next >= q.goal) {
      p.questsDone.push(q.id);
      p.bits += q.bits;
      p.xp += q.xp;
      p.level = levelForXp(p.xp);
      finished.push(q);
    }
  }
  return finished;
}
