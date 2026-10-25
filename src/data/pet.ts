/**
 * BYTE's growth: four forms earned by lifetime care, a small perk per form, and outfits
 * bought with bits. Pure data and functions (profile in, mutate in place) so it is unit-tested.
 */
import type { Profile } from '../core/save.ts';

export interface PetStage {
  name: string;
  /** Lifetime care needed to reach this form. */
  at: number;
  perk: string;
}

export const PET_STAGES: PetStage[] = [
  { name: 'BYTE', at: 0, perk: 'A curious little blob.' },
  { name: 'KILOBYTE', at: 15, perk: '+4% bits from every run. Barks stun 0.4s longer.' },
  { name: 'MEGABYTE', at: 40, perk: '+8% bits from every run. Barks stun 0.8s longer.' },
  { name: 'GIGABYTE', at: 80, perk: '+12% bits from every run. Barks stun 1.2s longer.' },
];

export function petStage(care: number): number {
  let s = 0;
  PET_STAGES.forEach((st, i) => {
    if (care >= st.at) s = i;
  });
  return s;
}

/** Extra bit multiplier a grown BYTE adds to every run. */
export function petBitBonus(stage: number): number {
  return 0.04 * Math.max(0, Math.min(3, stage));
}

/** Extra seconds a bark stuns the Manager for. */
export function petBarkBonus(stage: number): number {
  return 0.4 * Math.max(0, Math.min(3, stage));
}

export type PetSlot = 'head' | 'face' | 'back';

export interface PetItem {
  id: string;
  slot: PetSlot;
  name: string;
  cost: number;
  /** Lowest form that can wear it (a little carrot to keep caring). */
  minStage?: number;
}

export const PET_ITEMS: PetItem[] = [
  { id: 'bow', slot: 'head', name: 'RED BOW', cost: 30 },
  { id: 'party', slot: 'head', name: 'PARTY HAT', cost: 40 },
  { id: 'phones', slot: 'head', name: 'HEADPHONES', cost: 80 },
  { id: 'tophat', slot: 'head', name: 'TOP HAT', cost: 70, minStage: 1 },
  { id: 'shades', slot: 'face', name: 'SHADES', cost: 50 },
  { id: 'stache', slot: 'face', name: 'FALSE MOUSTACHE', cost: 40 },
  { id: 'monocle', slot: 'face', name: 'MONOCLE', cost: 60, minStage: 1 },
  { id: 'scarf', slot: 'back', name: 'COZY SCARF', cost: 40 },
  { id: 'cape', slot: 'back', name: 'HERO CAPE', cost: 80, minStage: 1 },
  { id: 'wings', slot: 'back', name: 'GLITCH WINGS', cost: 120, minStage: 2 },
];
export const PET_ITEM_BY_ID = new Map(PET_ITEMS.map((i) => [i.id, i]));

export interface PetOutfit {
  owned: string[];
  head: string;
  face: string;
  back: string;
}

export function defaultOutfit(): PetOutfit {
  return { owned: [], head: '', face: '', back: '' };
}

/** Repairs anything unknown or unowned. */
export function cleanOutfit(raw: unknown): PetOutfit {
  const out = defaultOutfit();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<PetOutfit>;
  if (Array.isArray(r.owned)) out.owned = r.owned.filter((id, i, a): id is string => typeof id === 'string' && PET_ITEM_BY_ID.has(id) && a.indexOf(id) === i);
  for (const slot of ['head', 'face', 'back'] as const) {
    const id = r[slot];
    out[slot] = typeof id === 'string' && out.owned.includes(id) && PET_ITEM_BY_ID.get(id)?.slot === slot ? id : '';
  }
  return out;
}

export type PetBuyResult = 'bought' | 'worn' | 'removed' | 'poor' | 'locked' | 'unknown';

/** Buys the item if needed, then wears it; choosing the item already worn takes it off. Mutates the profile. */
export function buyOrWearPet(p: Pick<Profile, 'bits' | 'pet'>, id: string): PetBuyResult {
  const item = PET_ITEM_BY_ID.get(id);
  if (!item) return 'unknown';
  const o = p.pet.outfit;
  if (!o.owned.includes(id)) {
    if (petStage(p.pet.care) < (item.minStage ?? 0)) return 'locked';
    if (p.bits < item.cost) return 'poor';
    p.bits -= item.cost;
    o.owned.push(id);
    o[item.slot] = id;
    return 'bought';
  }
  if (o[item.slot] === id) {
    o[item.slot] = '';
    return 'removed';
  }
  o[item.slot] = id;
  return 'worn';
}

/** What the sprite needs to draw BYTE. */
export function petForm(pet: Pick<Profile['pet'], 'care' | 'outfit'>): { stage: number; head: string; face: string; back: string } {
  return { stage: petStage(pet.care), head: pet.outfit.head, face: pet.outfit.face, back: pet.outfit.back };
}
