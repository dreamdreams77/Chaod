/**
 * GLITCH RHYTHM chart generator. Notes are produced in 4-bar blocks so the song
 * can loop for as long as the boss fight lasts, and difficulty follows the
 * boss phase. Constraints (tested): playable spacing per lane, at most two
 * simultaneous notes, and "glitch" notes never collide with real ones.
 */
import { Rng } from '../core/rng.ts';

export interface Note {
  beat: number;
  lane: number; // 0..3
  kind: 'tap' | 'glitch' | 'hold';
  len?: number; // beats, for holds
  hit?: boolean;
  missed?: boolean;
  judged?: boolean;
}

export const BLOCK_BEATS = 16;

export function minGapForPhase(phase: number): number {
  return phase >= 3 ? 0.5 : 1;
}

export function generateBlock(rng: Rng, startBeat: number, phase: number, difficulty: number): Note[] {
  const notes: Note[] = [];
  const lastInLane = [-99, -99, -99, -99];
  const minGap = minGapForPhase(phase);
  const step = phase >= 2 ? 0.5 : 1;
  const density = Math.min(0.9, 0.42 + phase * 0.12 + difficulty * 0.08);
  for (let b = 0; b < BLOCK_BEATS; b += step) {
    const beat = startBeat + b;
    const onBeat = b % 1 === 0;
    // Every bar's downbeat always has a note: charts never feel empty.
    const p = b % 4 === 0 ? 1 : onBeat ? density : density * 0.55;
    if (!rng.chance(p)) continue;
    const chord = phase >= 2 && onBeat && b % 4 === 0 && rng.chance(0.35);
    const lanes = rng.shuffle([0, 1, 2, 3]).filter((l) => beat - lastInLane[l] >= minGap);
    const count = Math.min(chord ? 2 : 1, lanes.length);
    for (let i = 0; i < count; i++) {
      const lane = lanes[i];
      const hold = phase >= 1 && !chord && onBeat && rng.chance(0.12) && b < BLOCK_BEATS - 3;
      notes.push({ beat, lane, kind: hold ? 'hold' : 'tap', len: hold ? 2 : undefined });
      lastInLane[lane] = beat + (hold ? 2 : 0);
    }
  }
  // Glitch notes (do NOT hit) from phase 2: in lanes free at that moment.
  if (phase >= 2) {
    const n = 2 + phase;
    for (let i = 0; i < n; i++) {
      const beat = startBeat + rng.int(1, BLOCK_BEATS - 1) + (rng.chance(0.5) ? 0.5 : 0);
      const lane = rng.int(0, 3);
      const clash = notes.some((x) => (x.lane === lane && Math.abs(x.beat - beat) < 1) || (x.kind === 'glitch' && Math.abs(x.beat - beat) < 0.5) || (x.kind === 'hold' && x.lane === lane && beat >= x.beat && beat <= x.beat + (x.len ?? 0) + 0.5));
      if (!clash) notes.push({ beat, lane, kind: 'glitch' });
    }
  }
  notes.sort((a, b) => a.beat - b.beat || a.lane - b.lane);
  return notes;
}

export function validateBlock(notes: Note[], phase: number): string | null {
  const minGap = minGapForPhase(phase);
  const byLane: Note[][] = [[], [], [], []];
  for (const n of notes) if (n.kind !== 'glitch') byLane[n.lane].push(n);
  for (const lane of byLane) {
    for (let i = 1; i < lane.length; i++) {
      const prevEnd = lane[i - 1].beat + (lane[i - 1].len ?? 0);
      if (lane[i].beat - prevEnd < minGap - 1e-9) return `lane spacing too tight at beat ${lane[i].beat}`;
    }
  }
  const atBeat = new Map<number, number>();
  for (const n of notes) if (n.kind !== 'glitch') atBeat.set(n.beat, (atBeat.get(n.beat) ?? 0) + 1);
  for (const [b, c] of atBeat) if (c > 2) return `more than 2 simultaneous notes at beat ${b}`;
  for (const g of notes.filter((n) => n.kind === 'glitch')) {
    if (notes.some((n) => n.kind !== 'glitch' && n.lane === g.lane && Math.abs(n.beat - g.beat) < 1)) return 'glitch collides with a real note';
  }
  return null;
}

/** Timing windows in seconds; judge() returns the grade for an offset. */
export const WINDOWS = { perfect: 0.05, great: 0.1, good: 0.15 };
export type Grade = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';
export function judge(offsetSeconds: number): Grade {
  const a = Math.abs(offsetSeconds);
  if (a <= WINDOWS.perfect) return 'PERFECT';
  if (a <= WINDOWS.great) return 'GREAT';
  if (a <= WINDOWS.good) return 'GOOD';
  return 'MISS';
}
