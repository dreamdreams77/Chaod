/**
 * NEON PANIC track generator: a seeded sequence of straights, bends, S-curves
 * and hills, with obstacles placed so the road is never blocked in all lanes.
 */
import { Rng } from '../core/rng.ts';

export const SEG_LEN = 200;
export const LANES = [-0.62, 0, 0.62];

export interface TrackSeg {
  curve: number;
  y: number;
}

export type TrackObjKind = 'cone' | 'barrier' | 'boost' | 'bit' | 'floppy' | 'chaos' | 'heart';

export interface TrackObj {
  seg: number;
  lane: number;
  kind: TrackObjKind;
  taken?: boolean;
}

export interface TrafficCar {
  z: number;
  lane: number;
  speed: number;
  hue: number;
}

export interface NeonTrack {
  seed: number;
  segments: TrackSeg[];
  objects: TrackObj[];
  traffic: TrafficCar[];
  midnightSeg: number;
  length: number;
}

interface Section {
  len: number;
  curve: number;
  hill: number;
}

/** `difficulty` is 0..1 and thins out the free pickups in favour of obstacles. */
export function generateNeon(seed: number, difficulty: number): NeonTrack {
  const rng = new Rng(seed ^ 24301);
  const sections: Section[] = [{ len: 60, curve: 0, hill: 0 }];
  const makers: Array<() => Section[]> = [
    () => [{ len: rng.int(40, 80), curve: 0, hill: rng.pick([0, 0, 20, -20]) }],
    () => [{ len: rng.int(50, 90), curve: rng.pick([-1, 1]) * rng.range(1.5, 3), hill: 0 }],
    () => {
      const dir = rng.pick([-1, 1]);
      return [
        { len: 45, curve: dir * 3, hill: 10 },
        { len: 45, curve: -dir * 3, hill: -10 },
      ];
    },
    () => [
      { len: 70, curve: rng.range(-1, 1), hill: rng.pick([40, -40]) },
      { len: 50, curve: 0, hill: 0 },
    ],
    () => [{ len: 80, curve: rng.pick([-1, 1]) * rng.range(4, 5), hill: 0 }],
  ];
  let total = 60;
  while (total < 2300) {
    for (const s of rng.pick(makers)()) {
      sections.push(s);
      total += s.len;
    }
  }
  sections.push({ len: 120, curve: 0, hill: 0 });

  const segments: TrackSeg[] = [];
  let y = 0;
  for (const s of sections) {
    const y0 = y;
    for (let i = 0; i < s.len; i++) {
      const k = Math.sin((i / s.len) * Math.PI);
      segments.push({ curve: s.curve * k, y });
      y = y0 + (s.hill * 30 * (1 - Math.cos((i / s.len) * Math.PI))) / 2;
    }
  }
  const length = segments.length;

  // Which lanes are blocked near each segment (±4), so no stretch ever has all three shut.
  const blocked = new Map<number, Set<number>>();
  const mark = (seg: number, lane: number): void => {
    for (let s = seg - 4; s <= seg + 4; s++) {
      if (!blocked.has(s)) blocked.set(s, new Set());
      blocked.get(s)!.add(lane);
    }
  };
  const canBlock = (seg: number, lane: number): boolean => {
    for (let s = seg - 4; s <= seg + 4; s++) {
      const set = new Set(blocked.get(s) ?? []);
      set.add(lane);
      if (set.size >= LANES.length) return false;
    }
    return true;
  };

  const objects: TrackObj[] = [];
  const density = 0.5 + difficulty * 0.25;
  for (let seg = 90; seg < length - 140; seg += rng.int(14, 26)) {
    const roll = rng.next();
    const lane = rng.int(0, 2);
    if (roll < 0.45 * density) {
      if (canBlock(seg, lane)) {
        objects.push({ seg, lane: LANES[lane], kind: rng.chance(0.6) ? 'cone' : 'barrier' });
        mark(seg, lane);
      }
    } else if (roll < 0.6) {
      objects.push({ seg, lane: LANES[lane], kind: 'boost' });
    } else {
      for (let i = 0; i < 4; i++) objects.push({ seg: seg + i * 3, lane: LANES[lane], kind: 'bit' });
    }
  }

  // Three floppies, each guarded by a barrier one lane over.
  for (const f of [0.22, 0.5, 0.8]) {
    const seg = Math.floor(length * f) + rng.int(-20, 20);
    const lane = rng.int(0, 2);
    objects.push({ seg, lane: LANES[lane], kind: 'floppy' });
    const guard = (lane + rng.int(1, 2)) % 3;
    if (canBlock(seg + 6, guard)) {
      objects.push({ seg: seg + 6, lane: LANES[guard], kind: 'barrier' });
      mark(seg + 6, guard);
    }
  }
  objects.push({ seg: Math.floor(length * 0.35), lane: 0, kind: 'chaos' });
  objects.push({ seg: Math.floor(length * 0.62), lane: LANES[rng.int(0, 2)], kind: 'heart' });
  objects.sort((a, b) => a.seg - b.seg);

  const traffic: TrafficCar[] = [];
  const cars = Math.round(14 + difficulty * 8);
  for (let i = 0; i < cars; i++) {
    traffic.push({ z: (200 + rng.next() * (length - 400)) * SEG_LEN, lane: rng.pick(LANES), speed: rng.range(1500, 3000), hue: rng.int(0, 360) });
  }

  return { seed, segments, objects, traffic, midnightSeg: Math.floor(length * 0.5), length };
}

/** True when no segment has a cone/barrier in every lane within ±4 segments. */
export function validateNeon(t: NeonTrack): boolean {
  const lanesAt = new Map<number, Set<number>>();
  for (const o of t.objects) {
    if (o.kind !== 'cone' && o.kind !== 'barrier') continue;
    for (let s = o.seg - 4; s <= o.seg + 4; s++) {
      if (!lanesAt.has(s)) lanesAt.set(s, new Set());
      lanesAt.get(s)!.add(o.lane);
    }
  }
  for (const set of lanesAt.values()) if (set.size >= LANES.length) return false;
  return true;
}
