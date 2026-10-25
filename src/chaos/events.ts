/**
 * Chaos event catalogue. Each event is pure data; modes read the event's
 * `flags` while it is active (e.g. a platformer reads 'gravity_flip').
 */
import type { ChaosCategory, ModeId } from '../core/save.ts';

export interface ChaosEventDef {
  id: string;
  name: string;
  category: ChaosCategory;
  /** Modes where this event makes mechanical sense. */
  modes: ModeId[] | 'all';
  duration: number;
  /** Warning time before the event takes effect (never below MIN_TELEGRAPH). */
  telegraph: number;
  /** Seconds before this specific event may repeat. */
  cooldown: number;
  weight: number;
  flags: string[];
  /** Events in the same group never overlap (e.g. two gravity changes). */
  group?: string;
  /** Allowed while a boss is on screen. */
  bossSafe: boolean;
  /** Only during boss encounters (boss-specific events). */
  bossOnly?: boolean;
  /** Contains rapid flashing/jitter: excluded under reduced-flash settings. */
  flashy?: boolean;
  /** Hurts the player's odds; suppressed while the player is recovering. */
  harsh?: boolean;
  /** Segments of a mode where the event is incompatible (e.g. gravity in the shmup section). */
  blockedSegments?: string[];
  blurb: string;
}

export const MIN_TELEGRAPH = 1.5;

export const CHAOS_EVENTS: ChaosEventDef[] = [
  // ---- Cosmetic -----------------------------------------------------------
  { id: 'palette_swap', name: 'PALETTE SWAP', category: 'cosmetic', modes: 'all', duration: 8, telegraph: 1.5, cooldown: 25, weight: 3, flags: ['palette_swap'], group: 'filter', bossSafe: true, blurb: 'Someone left the color dial on.' },
  { id: 'silent_film', name: '1927 MODE', category: 'cosmetic', modes: 'all', duration: 8, telegraph: 1.5, cooldown: 30, weight: 2, flags: ['silent_film'], group: 'filter', bossSafe: true, blurb: 'Talkies are a fad.' },
  { id: 'vhs_tracking', name: 'TRACKING ERROR', category: 'cosmetic', modes: 'all', duration: 6, telegraph: 1.5, cooldown: 30, weight: 2, flags: ['vhs'], group: 'filter', bossSafe: true, flashy: true, blurb: 'Adjust your tracking. Please.' },

  // ---- Environmental ------------------------------------------------------
  { id: 'gravity_flip', name: 'GRAVITY FLIP', category: 'environmental', modes: ['rampage'], duration: 6, telegraph: 2, cooldown: 35, weight: 3, flags: ['gravity_flip'], group: 'gravity', bossSafe: false, harsh: true, blockedSegments: ['shmup'], blurb: 'Down is a suggestion.' },
  { id: 'low_gravity', name: 'MOON PHYSICS', category: 'environmental', modes: ['rampage', 'beatdown', 'bolt'], duration: 10, telegraph: 1.5, cooldown: 25, weight: 3, flags: ['low_gravity'], group: 'gravity', bossSafe: true, blockedSegments: ['shmup'], blurb: 'Floaty jumps. Big air.' },
  { id: 'note_floor', name: 'NOTE HIGHWAY FLOOR', category: 'environmental', modes: ['rampage'], duration: 10, telegraph: 1.5, cooldown: 30, weight: 3, flags: ['note_floor'], bossSafe: false, blockedSegments: ['shmup'], blurb: 'Jump ON the beat for a SUPER JUMP.' },
  { id: 'fog_bank', name: 'FOG BANK', category: 'environmental', modes: ['neon'], duration: 9, telegraph: 2, cooldown: 30, weight: 3, flags: ['fog'], bossSafe: true, harsh: true, blurb: 'Draw distance: emotionally unavailable.' },
  { id: 'power_surge', name: 'POWER SURGE', category: 'environmental', modes: ['mall'], duration: 7, telegraph: 1.5, cooldown: 30, weight: 3, flags: ['lights_on', 'monster_haste'], bossSafe: true, blurb: 'Lights on! ...it can see you too.' },

  { id: 'crosswind', name: 'CROSSWIND', category: 'environmental', modes: ['penalty', 'highscore'], duration: 9, telegraph: 2, cooldown: 30, weight: 3, flags: ['crosswind'], bossSafe: true, blurb: 'A gale sweeps the pitch. Bullets drift sideways.' },
  { id: 'mud_pitch', name: 'MUD PITCH', category: 'environmental', modes: ['penalty', 'highscore'], duration: 9, telegraph: 1.5, cooldown: 30, weight: 3, flags: ['mud'], bossSafe: true, blurb: 'Heavy boots, slow bullets. Your shots lose some zip.' },

  { id: 'gravity_surge', name: 'GRAVITY SURGE', category: 'environmental', modes: ['blocks'], duration: 8, telegraph: 2, cooldown: 30, weight: 3, flags: ['surge'], bossSafe: true, harsh: true, blurb: 'Pieces fall more than twice as fast.' },
  { id: 'rising_tide', name: 'RISING TIDE', category: 'environmental', modes: ['blocks'], duration: 9, telegraph: 2, cooldown: 35, weight: 2, flags: ['tide'], bossSafe: true, harsh: true, blurb: 'Garbage rows creep up from the floor.' },
  { id: 'fog_blind', name: 'LIGHTS OUT', category: 'environmental', modes: ['blocks'], duration: 9, telegraph: 1.5, cooldown: 30, weight: 2, flags: ['blind'], bossSafe: true, blurb: 'No ghost, no next queue. Trust your hands.' },
  { id: 'blackout', name: 'BLACKOUT', category: 'environmental', modes: ['bolt'], duration: 8, telegraph: 2, cooldown: 35, weight: 3, flags: ['dark'], bossSafe: false, harsh: true, blurb: 'The lights fail. You can only see near yourself.' },
  { id: 'static_jam', name: 'STATIC JAM', category: 'combat', modes: ['bolt'], duration: 8, telegraph: 1.5, cooldown: 30, weight: 3, flags: ['jam'], bossSafe: true, harsh: true, blurb: 'Your buster shots crawl at half speed.' },

  // ---- Combat mutations ---------------------------------------------------
  { id: 'giant', name: 'MEGA MODE', category: 'combat', modes: ['rampage', 'beatdown'], duration: 8, telegraph: 1.5, cooldown: 30, weight: 3, flags: ['giant'], group: 'size', bossSafe: true, blockedSegments: ['shmup'], blurb: 'Double size. Double damage. Double hitbox.' },
  { id: 'tiny', name: 'POCKET SIZE', category: 'combat', modes: ['mall'], duration: 8, telegraph: 1.5, cooldown: 30, weight: 3, flags: ['tiny'], group: 'size', bossSafe: true, blurb: 'Too small to be seen. Too small to run fast.' },
  { id: 'bouncy_bullets', name: 'BOUNCE HOUSE', category: 'combat', modes: ['rampage', 'beatdown'], duration: 10, telegraph: 1.5, cooldown: 25, weight: 3, flags: ['bouncy'], bossSafe: true, blurb: 'Every projectile is now a springy little creature.' },
  { id: 'reverse_world', name: 'REVERSE DAY', category: 'combat', modes: ['rampage', 'neon'], duration: 8, telegraph: 2, cooldown: 30, weight: 2, flags: ['reverse'], bossSafe: false, harsh: true, blurb: 'Everyone else moves backwards.' },
  { id: 'big_keeper', name: 'MEGA KEEPER', category: 'combat', modes: ['penalty'], duration: 8, telegraph: 2, cooldown: 35, weight: 2, flags: ['big_keeper'], bossSafe: true, harsh: true, blurb: 'The keeper ate a mushroom. Wide load.' },
  { id: 'lane_mirror', name: 'MIRROR MIX', category: 'combat', modes: ['rhythm'], duration: 8, telegraph: 2, cooldown: 30, weight: 3, flags: ['lane_mirror'], bossSafe: true, harsh: true, blurb: 'Lanes flip left-to-right.' },

  // ---- Genre transformations ----------------------------------------------
  { id: 'enemies_racers', name: 'KART INVASION', category: 'genre', modes: ['rampage'], duration: 8, telegraph: 2, cooldown: 40, weight: 2, flags: ['enemies_racers'], bossSafe: false, blockedSegments: ['shmup'], blurb: 'All enemies are now racing karts. Stomp them for nitro.' },
  { id: 'mecha_mode', name: 'MECHA MODE', category: 'genre', modes: ['neon'], duration: 8, telegraph: 1.5, cooldown: 35, weight: 3, flags: ['mecha'], bossSafe: true, blurb: 'Your car is a fighting robot now. PUNCH the traffic.' },
  { id: 'boss_steal', name: 'MOVESET STOLEN', category: 'genre', modes: ['beatdown'], duration: 8, telegraph: 2, cooldown: 40, weight: 4, flags: ['boss_steal'], bossSafe: true, bossOnly: true, harsh: true, blurb: 'The boss copied your special. Block it!' },
  { id: 'static_remix', name: 'STATIC REMIX', category: 'genre', modes: ['rhythm'], duration: 8, telegraph: 2, cooldown: 35, weight: 3, flags: ['remix'], bossSafe: true, bossOnly: true, harsh: true, blurb: 'DJ STATIC speeds up the notes.' },

  // ---- Legendary ----------------------------------------------------------
  { id: 'kevin_bug', name: 'KEVIN FILED A BUG', category: 'legendary', modes: 'all', duration: 8, telegraph: 2, cooldown: 90, weight: 1, flags: ['kevin'], bossSafe: true, blurb: 'Kevin from QA has marked a rule as WONTFIX.' },
  { id: 'fatal_exception', name: 'FATAL EXCEPTION', category: 'legendary', modes: 'all', duration: 0, telegraph: 1.5, cooldown: 120, weight: 1, flags: ['fatal'], bossSafe: false, blurb: 'A blue screen! Type the recovery code for a jackpot.' },
];

export const EVENT_BY_ID = new Map(CHAOS_EVENTS.map((e) => [e.id, e]));

/** Rules Kevin can "WONTFIX" per mode; each is an existing flag that mode supports. */
export const KEVIN_RULES: Partial<Record<ModeId, Array<{ flag: string; text: string }>>> = {
  rampage: [
    { flag: 'low_gravity', text: 'BUG #4521: GRAVITY TOO STRONG. FIXED.' },
    { flag: 'giant', text: 'BUG #0007: PLAYER TOO SMALL TO SEE. FIXED.' },
    { flag: 'bouncy', text: 'BUG #1999: BULLETS NOT FUN ENOUGH. FIXED.' },
  ],
  neon: [
    { flag: 'mecha', text: 'BUG #8080: CAR LACKS FISTS. FIXED.' },
    { flag: 'reverse', text: 'BUG #2112: TRAFFIC GOING WRONG WAY. "FIXED".' },
  ],
  mall: [
    { flag: 'lights_on', text: 'BUG #0451: MALL TOO DARK. FIXED.' },
    { flag: 'tiny', text: 'BUG #1337: PLAYER HITBOX TOO HONEST. FIXED.' },
  ],
  beatdown: [
    { flag: 'low_gravity', text: 'BUG #3000: JUMPS NOT FLOATY. FIXED.' },
    { flag: 'giant', text: 'BUG #6502: HERO UNDERSIZED. FIXED.' },
  ],
  blocks: [
    { flag: 'surge', text: 'BUG #0084: PIECES FALL TOO SLOWLY. FIXED.' },
    { flag: 'blind', text: 'BUG #0610: PLAYER SEES TOO MUCH. FIXED.' },
  ],
  bolt: [
    { flag: 'low_gravity', text: 'BUG #1987: JUMPS TOO HEAVY. FIXED.' },
    { flag: 'jam', text: 'BUG #0100: SHOTS TOO FAST. "FIXED".' },
  ],
  penalty: [
    { flag: 'crosswind', text: 'BUG #1966: BALL TRAVELS IN STRAIGHT LINES. FIXED.' },
    { flag: 'mud', text: 'BUG #0090: GRASS TOO GRIPPY. "FIXED".' },
  ],
  rhythm: [
    { flag: 'lane_mirror', text: 'BUG #0101: LANES IN WRONG ORDER. FIXED.' },
  ],
};
