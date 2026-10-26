/**
 * The lobby jukebox: every music track in the game, unlocked by playing the world it belongs to.
 * Pure functions over the profile; the track you pick is stored in `profile.jukebox` ('' = the lobby's usual music).
 */
import { ModeId, Profile } from '../core/save.ts';
import type { TrackId } from '../audio/audio.ts';

export interface JukeTrack {
  id: Exclude<TrackId, 'none'>;
  name: string;
  /** Shown while the track is locked. */
  hint: string;
  test: (p: Profile) => boolean;
}

const cleared = (m: ModeId) => (p: Profile): boolean => p.cleared[m].clears > 0;
const always = (): boolean => true;
const hint = (m: string): string => `Clear ${m} to unlock.`;

export const JUKEBOX: JukeTrack[] = [
  { id: 'hub', name: 'LOBBY LOUNGE', hint: '', test: always },
  { id: 'title', name: 'PRESS START', hint: '', test: always },
  { id: 'arcade', name: 'COIN-OP', hint: '', test: always },
  { id: 'rampage', name: 'RAMPAGE RUN', hint: hint('RAMPAGE RUN'), test: cleared('rampage') },
  { id: 'shmup', name: 'ASTEROID BELT', hint: hint('RAMPAGE RUN'), test: cleared('rampage') },
  { id: 'neon', name: 'NEON PANIC', hint: hint('NEON PANIC'), test: cleared('neon') },
  { id: 'neon_night', name: 'NIGHT LAP', hint: hint('NEON PANIC'), test: cleared('neon') },
  { id: 'mall', name: 'CLOSING TIME', hint: hint('NIGHTMARE MALL'), test: cleared('mall') },
  { id: 'beatdown', name: 'BRICKLORD MAX', hint: hint('BEATDOWN BRAWL'), test: cleared('beatdown') },
  { id: 'beatdown_bh', name: 'BULLET HELL BRICKS', hint: hint('BEATDOWN BRAWL'), test: cleared('beatdown') },
  { id: 'rhythm', name: 'GLITCH BEAT', hint: hint('GLITCH RHYTHM'), test: cleared('rhythm') },
  { id: 'command', name: 'CORE COMMAND', hint: hint('CORE COMMAND'), test: cleared('command') },
  { id: 'penalty', name: 'PENALTY STORM', hint: hint('PENALTY STORM'), test: cleared('penalty') },
  { id: 'blocks', name: 'BLOCK PARTY', hint: hint('BLOCK PARTY'), test: cleared('blocks') },
  { id: 'bolt', name: 'BOLT BRIGADE', hint: hint('BOLT BRIGADE'), test: cleared('bolt') },
  { id: 'bolt_boss', name: 'ROBOT MASTER', hint: hint('BOLT BRIGADE'), test: cleared('bolt') },
  { id: 'ending', name: 'REBOOT', hint: 'Restore the Cartridge Core to unlock.', test: (p) => p.endingSeen },
  { id: 'hs1', name: 'ARCADE', hint: 'Defeat THE HIGH SCORE to unlock.', test: (p) => p.bossesDefeated.includes('highscore') },
  { id: 'hs2', name: 'FIGHT NIGHT', hint: 'Defeat THE HIGH SCORE to unlock.', test: (p) => p.bossesDefeated.includes('highscore') },
  { id: 'hs3', name: 'SUDDEN DEATH', hint: 'Defeat THE HIGH SCORE to unlock.', test: (p) => p.bossesDefeated.includes('highscore') },
  { id: 'halloween', name: 'SPOOKY SAVES', hint: 'Visit the lobby in Halloween weeks.', test: (p) => p.seasonSeen.startsWith('halloween') },
  { id: 'winter', name: 'WINTER LIGHTS', hint: 'Visit the lobby in the winter lights.', test: (p) => p.seasonSeen.startsWith('winter') },
];
export const JUKE_BY_ID = new Map(JUKEBOX.map((t) => [t.id as string, t]));

/** The track the lobby should play: the chosen one if it is unlocked, else null (the lobby's usual music). */
export function jukeboxChoice(p: Profile): JukeTrack['id'] | null {
  const t = JUKE_BY_ID.get(p.jukebox);
  return t && t.test(p) ? t.id : null;
}
