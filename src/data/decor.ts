/**
 * Lobby decor: three slots (floor, wall, corners) filled from items bought with bits. Purely
 * cosmetic, drawn by the hub. Pure data and functions so it is unit-tested.
 */
import type { Profile } from '../core/save.ts';

export type DecorSlot = 'floor' | 'wall' | 'corner';
export const DECOR_SLOTS: DecorSlot[] = ['floor', 'wall', 'corner'];

export interface DecorItem {
  id: string;
  slot: DecorSlot;
  name: string;
  cost: number;
}

export const DECOR: DecorItem[] = [
  { id: 'checker', slot: 'floor', name: 'CHECKERBOARD TILES', cost: 70 },
  { id: 'grid', slot: 'floor', name: 'NEON GRID FLOOR', cost: 90 },
  { id: 'confetti', slot: 'floor', name: 'CONFETTI RUG', cost: 110 },
  { id: 'pennants', slot: 'wall', name: 'PENNANT BUNTING', cost: 60 },
  { id: 'lights', slot: 'wall', name: 'FAIRY LIGHTS', cost: 80 },
  { id: 'stars', slot: 'wall', name: 'GLOW-STAR STICKERS', cost: 100 },
  { id: 'plants', slot: 'corner', name: 'POTTED PLANTS', cost: 50 },
  { id: 'lamps', slot: 'corner', name: 'LAVA LAMPS', cost: 90 },
  { id: 'speakers', slot: 'corner', name: 'SPEAKER STACKS', cost: 130 },
];
export const DECOR_BY_ID = new Map(DECOR.map((d) => [d.id, d]));

export interface LobbyDecor {
  owned: string[];
  floor: string;
  wall: string;
  corner: string;
}

export function defaultDecor(): LobbyDecor {
  return { owned: [], floor: '', wall: '', corner: '' };
}

/** Repairs anything unknown, duplicated or unowned. */
export function cleanDecor(raw: unknown): LobbyDecor {
  const out = defaultDecor();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<LobbyDecor>;
  if (Array.isArray(r.owned)) out.owned = r.owned.filter((id, i, a): id is string => typeof id === 'string' && DECOR_BY_ID.has(id) && a.indexOf(id) === i);
  for (const slot of DECOR_SLOTS) {
    const id = r[slot];
    out[slot] = typeof id === 'string' && out.owned.includes(id) && DECOR_BY_ID.get(id)?.slot === slot ? id : '';
  }
  return out;
}

export type DecorResult = 'bought' | 'worn' | 'removed' | 'poor' | 'unknown';

/** Buys the item if needed and puts it up; choosing what is already up takes it down. Mutates the profile. */
export function buyOrWearDecor(p: Pick<Profile, 'bits' | 'decor'>, id: string): DecorResult {
  const item = DECOR_BY_ID.get(id);
  if (!item) return 'unknown';
  const d = p.decor;
  if (!d.owned.includes(id)) {
    if (p.bits < item.cost) return 'poor';
    p.bits -= item.cost;
    d.owned.push(id);
    d[item.slot] = id;
    return 'bought';
  }
  if (d[item.slot] === id) {
    d[item.slot] = '';
    return 'removed';
  }
  d[item.slot] = id;
  return 'worn';
}
