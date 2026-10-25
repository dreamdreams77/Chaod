/**
 * Vibration feedback for phones and tablets. The audio engine announces every sound cue; the ones
 * that matter (hits, explosions, goals, bombs, level-ups) are mapped to short buzzes here. It does
 * nothing where the browser has no vibration support (desktops, iPhones) or when it is switched off.
 */
import type { SfxName } from '../audio/audio.ts';

type Pattern = number | number[];

/** Milliseconds on, off, on... Short and sparing: a buzz on every coin would be exhausting. */
export const HAPTIC_PATTERNS: Partial<Record<SfxName, Pattern>> = {
  hurt: 70,
  hit: 8,
  explode: 28,
  bomb: 110,
  slam: 60,
  block: 16,
  land: 6,
  kick: 14,
  boost: 16,
  floppy: [20, 30, 20],
  powerup: 22,
  perk: [18, 24, 18],
  levelup: [30, 40, 30, 40, 70],
  whistle: [40, 40, 90],
  warn: [28, 60, 28],
  chaos: [40, 40, 40],
  heartbeat: 38,
  transition: 40,
  unlock: [20, 30, 45],
  miss: 22,
  bark: 20,
  card: 16,
};

/** Never buzz more often than this, so a burst of cues is one buzz and not a drone. */
const MIN_GAP_MS = 45;

export class Haptics {
  enabled = true;
  private lastAt = -1e9;

  /** True when this browser can vibrate at all. */
  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  /** The buzz for a sound cue, if it has one. */
  cue(name: SfxName, now = typeof performance !== 'undefined' ? performance.now() : 0): void {
    if (!this.enabled) return;
    const p = HAPTIC_PATTERNS[name];
    if (p === undefined) return;
    this.buzz(p, now);
  }

  /** A fixed pattern, used by the Settings test row. */
  test(): void {
    if (this.supported) navigator.vibrate([60, 60, 120]);
  }

  private buzz(p: Pattern, now: number): void {
    if (!this.supported || now - this.lastAt < MIN_GAP_MS) return;
    this.lastAt = now;
    try {
      navigator.vibrate(p);
    } catch {
      /* some browsers throw before the first tap; ignore */
    }
  }

  /** Stops any buzz in progress (switching it off, or leaving the game). */
  stop(): void {
    if (this.supported) navigator.vibrate(0);
  }
}

export const haptics = new Haptics();
