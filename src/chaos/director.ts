/**
 * THE CHAOS DIRECTOR — controlled unpredictability.
 *
 * Rules (each is enforced in `pickEvent` / `update` and covered by tests):
 *  - Selection: weighted by event weight, the player's favoured category, and mode compatibility.
 *  - Difficulty scaling: meter fill rate and concurrency follow difficulty + intensity settings.
 *  - Cooldowns: a global gap between events and a per-event cooldown.
 *  - Minimum reaction time: every event is telegraphed for at least MIN_TELEGRAPH seconds.
 *  - Player recovery: no new events right after the player is hurt, and "harsh" events are
 *    suppressed while health is low.
 *  - Duration: events end on their own; flags vanish when they do.
 *  - Genre compatibility: mode list + blocked segments + exclusive groups.
 *  - Boss-specific events: `bossOnly` events need a boss; `bossSafe=false` events never interrupt one.
 *  - Accessibility: intensity 'off' disables the director; reduced flash removes flashy events.
 *  - Unwinnable combinations: modes mark unsafe moments (`safe=false`) and exclusive groups
 *    prevent stacking two effects that touch the same rule.
 * Players can influence it: stylish play feeds the meter, chaos orbs trigger events on demand,
 * and the hub shrine biases the category.
 */
import { Rng } from '../core/rng.ts';
import type { ChaosCategory, ChaosIntensity, Difficulty, ModeId } from '../core/save.ts';
import { CHAOS_EVENTS, ChaosEventDef, KEVIN_RULES, MIN_TELEGRAPH } from './events.ts';

export interface DirectorConfig {
  mode: ModeId;
  intensity: ChaosIntensity;
  difficulty: Difficulty;
  reducedFlash: boolean;
  favor: ChaosCategory | null;
  seed: number;
}

export interface DirectorContext {
  /** Player health as a fraction 0..1. */
  hpFrac: number;
  /** Mode reports false during scripted moments (cutscenes, phase transitions, respawns). */
  safe: boolean;
  bossActive: boolean;
  segment?: string;
}

export interface ActiveEvent {
  def: ChaosEventDef;
  phase: 'telegraph' | 'active';
  timer: number;
  /** Extra flags chosen at start (e.g. the rule Kevin "fixed"). */
  extraFlags: string[];
  note?: string;
}

const INTENSITY: Record<ChaosIntensity, { rate: number; maxActive: number; gap: number }> = {
  off: { rate: 0, maxActive: 0, gap: Infinity },
  low: { rate: 2.5, maxActive: 1, gap: 18 },
  normal: { rate: 5, maxActive: 1, gap: 10 },
  high: { rate: 9, maxActive: 2, gap: 5 },
};
const DIFF_MULT: Record<Difficulty, number> = { easy: 0.7, normal: 1, hard: 1.35 };

export class ChaosDirector {
  meter = 0;
  readonly active: ActiveEvent[] = [];
  private lastFired = new Map<string, number>();
  private clock = 0;
  private sinceLast = 0;
  private recoverLock = 0;
  private rng: Rng;
  /** Events that started this frame — modes may react (sound, spawn Kevin, etc.). */
  started: ActiveEvent[] = [];
  ended: ActiveEvent[] = [];
  /** Events cut short by clearAll(); reported on the next update so modes still run their end hooks. */
  private cleared: ActiveEvent[] = [];
  history: string[] = [];

  constructor(private cfg: DirectorConfig) {
    this.rng = new Rng(cfg.seed ^ 0xc4a05);
    this.sinceLast = -6; // a grace period at the start of every run
  }

  get enabled(): boolean {
    return this.cfg.intensity !== 'off';
  }

  /** Stylish play / risky actions feed the meter. */
  feed(amount: number): void {
    if (!this.enabled) return;
    this.meter = Math.min(100, this.meter + amount);
  }

  /** Called by modes when the player takes damage. */
  notifyHurt(): void {
    this.recoverLock = 4;
  }

  /** Player-triggered chaos (touching a chaos orb). Still respects every safety rule. */
  trigger(ctx: DirectorContext): ActiveEvent | null {
    if (!this.enabled) return null;
    const ev = this.pickEvent(ctx, true);
    return ev ? this.start(ev, ctx) : null;
  }

  flag(f: string): boolean {
    for (const a of this.active) if (a.phase === 'active' && (a.def.flags.includes(f) || a.extraFlags.includes(f))) return true;
    return false;
  }

  telegraphing(): ActiveEvent | null {
    return this.active.find((a) => a.phase === 'telegraph') ?? null;
  }

  update(dt: number, ctx: DirectorContext): void {
    this.started = [];
    this.ended = this.cleared;
    this.cleared = [];
    this.clock += dt;
    this.sinceLast += dt;
    this.recoverLock = Math.max(0, this.recoverLock - dt);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.timer -= dt;
      if (a.timer <= 0) {
        if (a.phase === 'telegraph') {
          a.phase = 'active';
          a.timer = a.def.duration;
          this.started.push(a);
          if (a.def.duration <= 0) {
            // Instant events (e.g. the FATAL EXCEPTION minigame) fire once and finish.
            this.active.splice(i, 1);
            this.ended.push(a);
          }
        } else {
          this.active.splice(i, 1);
          this.ended.push(a);
        }
      }
    }
    if (!this.enabled) return;

    const I = INTENSITY[this.cfg.intensity];
    this.meter = Math.min(100, this.meter + dt * I.rate * DIFF_MULT[this.cfg.difficulty]);
    if (this.meter >= 100) {
      const ev = this.pickEvent(ctx, false);
      if (ev) {
        this.start(ev, ctx);
        this.meter = 0;
      }
    }
  }

  /** Returns a legal event or null. Exposed for tests. */
  pickEvent(ctx: DirectorContext, playerTriggered: boolean): ChaosEventDef | null {
    if (!this.enabled || !ctx.safe) return null;
    const I = INTENSITY[this.cfg.intensity];
    if (this.active.length >= I.maxActive) return null;
    if (!playerTriggered && this.sinceLast < I.gap) return null;
    if (this.recoverLock > 0) return null;
    const lowHp = ctx.hpFrac <= 0.34;
    const groups = new Set(this.active.map((a) => a.def.group).filter(Boolean));
    const candidates = CHAOS_EVENTS.filter((e) => {
      if (e.modes !== 'all' && !e.modes.includes(this.cfg.mode)) return false;
      if (e.bossOnly && !ctx.bossActive) return false;
      if (ctx.bossActive && !e.bossSafe) return false;
      if (e.flashy && this.cfg.reducedFlash) return false;
      if (e.harsh && (lowHp || this.cfg.difficulty === 'easy' && ctx.hpFrac < 0.6)) return false;
      if (e.group && groups.has(e.group)) return false;
      if (ctx.segment && e.blockedSegments?.includes(ctx.segment)) return false;
      if (this.active.some((a) => a.def.id === e.id)) return false;
      // Never stack two sources of the same flag (incl. Kevin's chosen rule): when one ends it would undo the other.
      if (this.active.some((a) => e.flags.some((f) => a.def.flags.includes(f) || a.extraFlags.includes(f)))) return false;
      const last = this.lastFired.get(e.id);
      if (last !== undefined && this.clock - last < e.cooldown) return false;
      if (e.id === 'kevin_bug' && !(KEVIN_RULES[this.cfg.mode]?.length)) return false;
      return true;
    });
    return (
      this.rng.weighted(candidates, (e) => {
        let w = e.weight;
        if (this.cfg.favor && e.category === this.cfg.favor) w *= 3;
        if (e.category === 'legendary') w *= playerTriggered ? 1.5 : 0.6;
        return w;
      }) ?? null
    );
  }

  private start(def: ChaosEventDef, ctx: DirectorContext): ActiveEvent {
    const a: ActiveEvent = { def, phase: 'telegraph', timer: Math.max(MIN_TELEGRAPH, def.telegraph), extraFlags: [] };
    if (def.id === 'kevin_bug') {
      const rules = (KEVIN_RULES[this.cfg.mode] ?? []).filter((r) => {
        // Kevin respects the same compatibility rules as everyone else.
        const conflict = this.active.some((x) => x.def.flags.includes(r.flag));
        const blockedGravity = ctx.segment === 'shmup' && (r.flag === 'low_gravity' || r.flag === 'giant');
        return !conflict && !blockedGravity;
      });
      if (rules.length) {
        const r = this.rng.pick(rules);
        a.extraFlags.push(r.flag);
        a.note = r.text;
      }
    }
    this.active.push(a);
    this.lastFired.set(def.id, this.clock);
    this.sinceLast = 0;
    this.history.push(def.id);
    if (this.history.length > 50) this.history.shift();
    return a;
  }

  /** End every event immediately (used on death/respawn and boss phase changes). */
  clearAll(): void {
    for (const a of this.active) this.cleared.push(a);
    this.active.length = 0;
  }
}
