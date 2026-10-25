/**
 * Wardrobe: purely cosmetic outfits and hats bought from Madame Polygon with bits.
 * Nothing here affects gameplay, so it is a safe bit sink for late-game players.
 */
import { Profile } from '../core/save.ts';

export type CosmeticKind = 'palette' | 'hat';

export interface Look {
  hair: string;
  shirt: string;
  pants: string;
}

export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  name: string;
  cost: number;
  /** Only for palettes. */
  look?: Look;
}

export const COSMETICS: Cosmetic[] = [
  { id: 'classic', kind: 'palette', name: 'CLASSIC CASS', cost: 0, look: { hair: '#ff3fa4', shirt: '#20c4b0', pants: '#3346a8' } },
  { id: 'sunset', kind: 'palette', name: 'SUNSET', cost: 60, look: { hair: '#ff9f3f', shirt: '#ff3f6b', pants: '#4a2a8a' } },
  { id: 'mint', kind: 'palette', name: 'MINT CHIP', cost: 60, look: { hair: '#3fe0a0', shirt: '#f4eefe', pants: '#2a6a5a' } },
  { id: 'mono', kind: 'palette', name: 'BLACK & WHITE TV', cost: 80, look: { hair: '#f4f4fa', shirt: '#6a6a7a', pants: '#2a2a3a' } },
  { id: 'royal', kind: 'palette', name: 'HIGH SCORE GOLD', cost: 140, look: { hair: '#ffd23f', shirt: '#7a3fff', pants: '#b3122e' } },
  { id: 'none', kind: 'hat', name: 'NO HAT', cost: 0 },
  { id: 'cap', kind: 'hat', name: 'ARCADE CAP', cost: 50 },
  { id: 'antenna', kind: 'hat', name: 'ANTENNA', cost: 70 },
  { id: 'halo', kind: 'hat', name: 'SAVE-POINT HALO', cost: 110 },
  { id: 'crown', kind: 'hat', name: 'CROWN OF 999999', cost: 160 },
];

export const COSMETIC_BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));

export interface Wardrobe {
  owned: string[];
  palette: string;
  hat: string;
}

export function defaultWardrobe(): Wardrobe {
  return { owned: ['classic', 'none'], palette: 'classic', hat: 'none' };
}

/** Repairs anything unknown or unowned back to the defaults. */
export function cleanWardrobe(raw: unknown): Wardrobe {
  const base = defaultWardrobe();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Wardrobe>;
  const owned = new Set<string>(base.owned);
  if (Array.isArray(r.owned)) for (const id of r.owned) if (typeof id === 'string' && COSMETIC_BY_ID.has(id)) owned.add(id);
  const pick = (id: unknown, kind: CosmeticKind, fallback: string): string => (typeof id === 'string' && owned.has(id) && COSMETIC_BY_ID.get(id)?.kind === kind ? id : fallback);
  return { owned: [...owned], palette: pick(r.palette, 'palette', 'classic'), hat: pick(r.hat, 'hat', 'none') };
}

export function currentLook(w: Wardrobe): { look: Look; hat: string } {
  return { look: COSMETIC_BY_ID.get(w.palette)?.look ?? COSMETICS[0].look!, hat: w.hat };
}

export type BuyResult = 'bought' | 'equipped' | 'poor' | 'unknown';

/** Buys the item if it is not owned yet (when affordable), then equips it. Mutates the profile. */
export function buyOrEquip(p: Pick<Profile, 'bits' | 'wardrobe'>, id: string): BuyResult {
  const item = COSMETIC_BY_ID.get(id);
  if (!item) return 'unknown';
  let result: BuyResult = 'equipped';
  if (!p.wardrobe.owned.includes(id)) {
    if (p.bits < item.cost) return 'poor';
    p.bits -= item.cost;
    p.wardrobe.owned.push(id);
    result = 'bought';
  }
  if (item.kind === 'palette') p.wardrobe.palette = id;
  else p.wardrobe.hat = id;
  return result;
}
