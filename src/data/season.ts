/**
 * Lobby seasons: the Lobby of Lost Saves dresses up around the year. Pure date maths (UTC), so it
 * is the same for every player and easy to test.
 */
export type SeasonId = 'halloween' | 'winter' | 'love' | 'bloom' | 'summer';

export interface Season {
  id: SeasonId;
  name: string;
  /** One line shown when you first walk in during the season. */
  greeting: string;
  color: string;
  /** Wash laid over the lobby, as "r,g,b". */
  tint: string;
  /** Soundtrack the lobby plays (falls back to the usual lobby music). */
  track?: 'halloween' | 'winter';
}

export const SEASONS: Season[] = [
  { id: 'halloween', name: 'HALLOWEEN WEEKS', greeting: 'BATS IN THE RAFTERS. WEEKLY GOALS PAY +20%.', color: '#ff9f3f', tint: '255,120,20', track: 'halloween' },
  { id: 'winter', name: 'WINTER LIGHTS', greeting: 'SNOW ON THE CARPET. WEEKLY GOALS PAY +20%.', color: '#9fe8ff', tint: '120,190,255', track: 'winter' },
  { id: 'love', name: 'HEART WEEK', greeting: 'HEARTS EVERYWHERE. WEEKLY GOALS PAY +20%.', color: '#ff7aa8', tint: '255,80,140' },
  { id: 'bloom', name: 'SPRING BLOOM', greeting: 'PETALS DRIFT THROUGH THE LOBBY. WEEKLY GOALS PAY +20%.', color: '#ffb3d9', tint: '255,170,220' },
  { id: 'summer', name: 'SUMMER ARCADE', greeting: 'HOT NEON NIGHTS. WEEKLY GOALS PAY +20%.', color: '#ffe23f', tint: '255,200,60' },
];
export const SEASON_BY_ID = new Map(SEASONS.map((s) => [s.id, s]));

/** Which season (if any) a UTC date falls in. */
export function seasonFor(d: Date): Season | null {
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const on = (id: SeasonId) => SEASON_BY_ID.get(id)!;
  if ((m === 10 && day >= 18) || (m === 11 && day <= 2)) return on('halloween');
  if ((m === 12 && day >= 14) || (m === 1 && day <= 3)) return on('winter');
  if (m === 2 && day >= 8 && day <= 15) return on('love');
  if ((m === 3 && day >= 20) || (m === 4 && day <= 20)) return on('bloom');
  if (m === 7 || m === 8) return on('summer');
  return null;
}

/** Weekly goals pay a fifth more while the lobby is dressed up. */
export const SEASON_BONUS = 1.2;
