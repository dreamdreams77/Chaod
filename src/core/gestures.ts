/**
 * Touchscreen gestures for the worlds, layered on the same virtual buttons the on-screen
 * pad uses, so every mode works unchanged.
 *
 *   side     (platformer, fighter): drag = move, drag up = jump (held), drag down = duck/block,
 *            tap = attack, hold still = keep attacking, second finger tap = special
 *   racer    (Neon Panic): drag left/right = steer, drag down = brake, tap = boost,
 *            second finger held = drift
 *   topdown  (Nightmare Mall): drag = walk, tap = interact / hide, second finger held = run
 *   lanes    (Glitch Rhythm): every finger holds the lane it is on (chords work)
 */
import type { Action, Input } from './input.ts';

export type GestureMode = 'side' | 'racer' | 'topdown' | 'lanes';

const DEAD_X = 10;
const DEAD_Y = 14;
const FOLLOW = 40;
const TAP_MS = 250;
const TAP_MOVE = 10;
const HOLD_MS = 250;

interface Pointer {
  id: number;
  role: 'stick' | 'aux' | 'lane';
  ax: number;
  ay: number;
  x: number;
  y: number;
  t0: number;
  moved: boolean;
}

export class TouchGestures {
  private readonly pointers = new Map<number, Pointer>();
  private applied = new Set<Action>();

  constructor(
    private readonly input: Input,
    /** Current gesture mode, or null when taps should not steer (menus, dialogue, pause). */
    private readonly mode: () => GestureMode | null,
    /** Lane under a screen x, for the rhythm mode. */
    private readonly laneAt: (x: number) => Action | null,
  ) {}

  down(id: number, x: number, y: number, now: number): void {
    const mode = this.mode();
    if (!mode) return;
    const role: Pointer['role'] = mode === 'lanes' ? 'lane' : this.hasStick() ? 'aux' : 'stick';
    const p: Pointer = { id, role, ax: x, ay: y, x, y, t0: now, moved: false };
    this.pointers.set(id, p);
    // A second finger in "side" mode fires the special on touch-down.
    if (role === 'aux' && mode === 'side') this.input.pulse('special');
    this.recompute();
  }

  move(id: number, x: number, y: number): void {
    const p = this.pointers.get(id);
    if (!p || !this.mode()) return;
    p.x = x;
    p.y = y;
    if (p.role === 'stick') {
      if (Math.hypot(x - p.ax, y - p.ay) > TAP_MOVE) p.moved = true;
      // The anchor trails the finger so reversing direction never needs a long swipe back.
      if (x - p.ax > FOLLOW) p.ax = x - FOLLOW;
      if (p.ax - x > FOLLOW) p.ax = x + FOLLOW;
      if (y - p.ay > FOLLOW) p.ay = y - FOLLOW;
      if (p.ay - y > FOLLOW) p.ay = y + FOLLOW;
    }
    this.recompute();
  }

  up(id: number, now: number): void {
    const p = this.pointers.get(id);
    if (!p) return;
    this.pointers.delete(id);
    const mode = this.mode();
    if (p.role === 'stick') {
      // If another finger is still down it takes over steering from where it is.
      for (const q of this.pointers.values()) {
        if (q.role !== 'aux') continue;
        q.role = 'stick';
        q.ax = q.x;
        q.ay = q.y;
        q.moved = true; // no tap or hold-to-attack from a promoted finger
        break;
      }
    }
    if (p.role === 'stick' && mode && !p.moved && now - p.t0 < TAP_MS) {
      // A quick tap: attack in side mode, boost in the racer, interact in the mall.
      this.input.pulse(mode === 'side' ? 'attack' : 'jump');
    }
    this.recompute();
  }

  /** Called every frame: promotes a finger held still into held attack, and drops stale pointers. */
  tick(now: number): void {
    if (!this.mode()) {
      if (this.pointers.size || this.applied.size) this.cancelAll();
      return;
    }
    this.recompute(now);
  }

  cancelAll(): void {
    this.pointers.clear();
    this.recompute();
  }

  private hasStick(): boolean {
    for (const p of this.pointers.values()) if (p.role === 'stick') return true;
    return false;
  }

  private recompute(now = performance.now()): void {
    const mode = this.mode();
    const want = new Set<Action>();
    if (mode) {
      for (const p of this.pointers.values()) {
        if (p.role === 'lane') {
          // Resolved every time, so sliding between lanes (or a mirror event) re-targets the hold.
          const lane = this.laneAt(p.x);
          if (lane) want.add(lane);
        } else if (p.role === 'stick') {
          const dx = p.x - p.ax;
          const dy = p.y - p.ay;
          if (dx > DEAD_X) want.add('right');
          else if (dx < -DEAD_X) want.add('left');
          if (dy > DEAD_Y) want.add('down');
          else if (dy < -DEAD_Y && mode !== 'racer') {
            want.add('up');
            if (mode === 'side') want.add('jump');
          }
          if (mode === 'side' && !p.moved && now - p.t0 >= HOLD_MS) want.add('attack');
        } else if (mode === 'racer') want.add('special');
        else if (mode === 'topdown') want.add('attack');
      }
    }
    for (const a of this.applied) if (!want.has(a)) this.input.setVirtual(a, false);
    for (const a of want) if (!this.applied.has(a)) this.input.setVirtual(a, true);
    this.applied = want;
  }
}
