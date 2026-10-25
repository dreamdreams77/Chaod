/**
 * Vibration feedback for phones and tablets. A few sound cues that mean "you felt that" (damage,
 * bombs, boss slams, level-ups, goals) are mapped to short buzzes; everything else stays quiet so a
 * long fight is not one continuous drone. It does nothing without a touch screen and vibration
 * support (desktops, iPhones) or when switched off.
 */
import type { SfxName } from '../audio/audio.ts';

type Pattern = number | number[];

/** Milliseconds on, off, on... */
export const HAPTIC_PATTERNS: Partial<Record<SfxName, Pattern>> = {
  hurt: 70,
  bomb: 110,
  slam: 60,
  block: 14,
  kick: 12,
  floppy: [20, 30, 20],
  powerup: 22,
  perk: [18, 24, 18],
  levelup: [30, 40, 30, 40, 70],
  whistle: [40, 40, 90],
  chaos: [40, 40, 40],
  unlock: [20, 30, 45],
  card: 16,
};

function total(p: Pattern): number {
  return Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : p;
}

export class Haptics {
  enabled = true;
  /** When the buzz in progress ends, and how strong (long) it is. */
  private busyUntil = 0;
  private busyPower = 0;

  /** True on a device that can actually buzz: a touch screen whose browser has the vibration API. */
  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && (navigator.maxTouchPoints ?? 0) > 0;
  }

  /** The buzz for a sound cue, if it has one. A weaker cue never cuts off a stronger buzz that is still running. */
  cue(name: SfxName, now = typeof performance !== 'undefined' ? performance.now() : 0): void {
    if (!this.enabled || !this.supported) return;
    const p = HAPTIC_PATTERNS[name];
    if (p === undefined) return;
    const power = total(p);
    if (now < this.busyUntil && power <= this.busyPower) return;
    this.busyUntil = now + power;
    this.busyPower = power;
    this.vibrate(p);
  }

  /** A fixed pattern, used by the switch so you can feel what it does. */
  test(): void {
    if (this.supported) this.vibrate([60, 60, 120]);
  }

  /** Stops any buzz in progress (switching it off). */
  stop(): void {
    this.busyUntil = 0;
    this.busyPower = 0;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') this.vibrate(0);
  }

  private vibrate(p: Pattern): void {
    try {
      navigator.vibrate(p);
    } catch {
      /* some browsers throw before the first tap; the next one will work */
    }
  }
}

export const haptics = new Haptics();
