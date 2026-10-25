/**
 * ModeBase — everything the five game modes share: seeded RNG, the Genre
 * Fusion engine, the Chaos Director, run rewards, modifiers, HUD widgets.
 */
import type { Game, Scene } from '../game.ts';
import type { GestureMode } from '../core/gestures.ts';
import { ChaosDirector, DirectorContext, ActiveEvent } from '../chaos/director.ts';
import { FusionEngine } from '../fusion/engine.ts';
import { Rng, formatSeed } from '../core/rng.ts';
import { ChaosIntensity, ModeId, playerStats } from '../core/save.ts';
import { MODIFIERS, NIGHTMARE, Modifier, RunResult } from '../data/progression.ts';
import { Particles, Popups, W, H, frame, rect, bar } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { showResults } from '../scenes/results.ts';
import { MODE_INFO, RUSH_LEGS } from '../data/story.ts';
import { petBitBonus, petStage } from '../data/pet.ts';
import { PerkDef, perkTotals } from '../data/perks.ts';

const BUMP: Record<ChaosIntensity, ChaosIntensity> = { off: 'off', low: 'normal', normal: 'high', high: 'high' };

/** What a chained run (BOSS RUSH, ENDLESS RUN) hands to its next leg: health and the running tally. */
export interface Carry {
  carryHp?: number;
  bits?: number;
  xp?: number;
  time?: number;
  damage?: number;
  score?: number;
  chaos?: string[];
  floppies?: string[];
  flags?: string[];
}

/** Adds an earlier leg's tally to a result. */
function mergeCarry(r: RunResult, c: Carry): void {
  r.bits += c.bits ?? 0;
  r.xp += c.xp ?? 0;
  r.time += c.time ?? 0;
  r.damageTaken += c.damage ?? 0;
  r.score += c.score ?? 0;
  r.chaosSeen = [...new Set([...(c.chaos ?? []), ...r.chaosSeen])];
  r.floppies = [...new Set([...(c.floppies ?? []), ...r.floppies])];
  r.flags = [...new Set([...(c.flags ?? []), ...r.flags])];
}

/** How a run was started. Every mode takes these; most flags are handled here in the base. */
export interface ModeOpts {
  rematch?: boolean;
  /** Fixed seed (shared links and the daily challenge); also forces the seeded modifier. */
  seed?: number;
  /** UTC date key when this is the daily challenge. */
  daily?: string;
  /** NIGHTMARE mode (unlocked by the ending): harder, but bits pay double. */
  nightmare?: boolean;
  /** BOSS RUSH: Bricklord (leg 1) straight into DJ Static (leg 2) with health carried over. */
  /** ENDLESS RUN: the same world again and again, a little harder each round, until you fall. */
  endless?: Carry & { round: number; seed?: number };
  /** BOSS RUSH: Bricklord (leg 1) straight into DJ Static (leg 2) with health carried over. */
  rush?: Carry & { leg: number; legs?: ModeId[] };
  /** Perks picked so far this run (see data/perks.ts). */
  perks?: string[];
}

export abstract class ModeBase implements Scene {
  abstract id: string;
  /** Current hearts; every mode keeps its own, the base reads it for BOSS RUSH hand-over. */
  abstract hp: number;
  pausable = true;
  crt = 0.3;
  /** Touchscreen gesture scheme and its on-screen help; subclasses set both. */
  gesture?: GestureMode;
  gestureHint?: string;
  readonly director: ChaosDirector;
  readonly fusion: FusionEngine;
  readonly rng: Rng;
  readonly seed: number;
  readonly modifier: Modifier | null;
  readonly particles = new Particles();
  readonly popups = new Popups();
  readonly stats: { maxHp: number; power: number; energy: number };
  /** Perks picked for this run, and what they add up to. */
  readonly perkList: PerkDef[];
  private readonly perkFx: ReturnType<typeof perkTotals>;
  runBits = 0;
  runXp = 0;
  foundFloppies: string[] = [];
  damageTaken = 0;
  runFlags = new Set<string>();
  chaosSeen = new Set<string>();
  time = 0;
  ended = false;
  private kevin: { t: number; note: string } | null = null;
  protected hintT = 0;
  resetHint(): void {
    this.hintT = 0;
  }

  constructor(readonly game: Game, readonly mode: ModeId, readonly opts: ModeOpts = {}) {
    this.seed = opts.seed ?? opts.endless?.seed ?? game.newSeed();
    this.rng = new Rng(this.seed);
    const p = game.profile;
    this.fusion = new FusionEngine(mode, p);
    // Replays of cleared worlds roll a seeded challenge modifier for variety.
    const replay = p.cleared[mode].clears > 0;
    // Shared and daily runs always roll their modifier from the seed, so everyone plays the same run.
    this.modifier = opts.nightmare ? NIGHTMARE : (replay || opts.seed !== undefined || opts.endless) && !opts.rematch ? this.rng.fork(77).pick(MODIFIERS) : null;
    let intensity = game.settings.chaos;
    if (this.modifier?.id === 'chaotic') intensity = BUMP[intensity];
    if (this.endlessRound >= 3) intensity = BUMP[intensity];
    if (this.modifier?.id === 'nightmare' && intensity !== 'off') intensity = 'high';
    const perkFx = perkTotals(opts.perks);
    this.perkFx = perkFx;
    this.perkList = perkFx.defs;
    if ((perkFx.chaos || this.fusion.has('curse_static')) && intensity !== 'off') intensity = 'high';
    if (this.modifier?.id === 'calm') intensity = 'off';
    this.director = new ChaosDirector({
      mode,
      intensity,
      difficulty: game.settings.difficulty,
      reducedFlash: game.settings.reducedFlash,
      favor: p.chaosFavor,
      seed: this.seed,
    });
    const st = playerStats(p);
    if (this.modifier?.id === 'glass' || this.modifier?.id === 'nightmare') st.maxHp = Math.max(2, st.maxHp - 1);
    if (game.settings.assist) st.maxHp += 1;
    st.maxHp = Math.max(2, st.maxHp + this.perkFx.hp - (this.fusion.has('curse_frail') ? 1 : 0));
    this.stats = st;
    // A chained run carries disks, flags and chaos events forward, so nothing is found (or paid for) twice.
    const carry = opts.endless ?? opts.rush;
    if (carry) {
      this.foundFloppies = [...(carry.floppies ?? [])];
      this.runFlags = new Set(carry.flags);
      this.chaosSeen = new Set(carry.chaos);
    }
  }

  /** 0 outside ENDLESS RUN, otherwise the 1-based round. */
  get endlessRound(): number {
    return this.opts.endless?.round ?? 0;
  }
  /** How much tougher ENDLESS RUN has made things (1 = round one). Capped so late rounds stay survivable. */
  get tier(): number {
    return this.endlessRound ? Math.min(2, 1 + 0.12 * (this.endlessRound - 1)) : 1;
  }
  get diffMult(): number {
    return { easy: 0.6, normal: 1, hard: 1.4 }[this.game.settings.difficulty] * this.tier * (this.game.settings.assist ? 0.85 : 1) * this.perkFx.diff;
  }
  get damageMult(): number {
    return this.modifier?.id === 'glass' || this.modifier?.id === 'nightmare' || this.endlessRound >= 5 || this.fusion.has('curse_greed') ? 2 : 1;
  }
  hasPerk(id: string): boolean {
    return this.perkList.some((p) => p.id === id);
  }

  /** Modes call this right after setting their starting health: BOSS RUSH and ENDLESS RUN hand health over. */
  protected applyCarry(): void {
    const c = this.opts.rush?.carryHp ?? this.opts.endless?.carryHp;
    if (c !== undefined) this.hp = Math.max(1, Math.min(this.stats.maxHp, c));
  }
  get speedMult(): number {
    return (this.modifier?.id === 'turbo' ? 1.15 : 1) * this.perkFx.speed * (this.fusion.has('curse_haste') ? 1.2 : 1);
  }

  abstract directorContext(): DirectorContext;
  abstract heal(n: number): void;
  onChaosStart(_ev: ActiveEvent): void {}
  onChaosEnd(_ev: ActiveEvent): void {}

  abstract update(dt: number): void;
  abstract draw(ctx: CanvasRenderingContext2D): void;

  private roundAnnounced = false;
  tickShared(dt: number): void {
    if (this.endlessRound && !this.roundAnnounced && !this.game.inDialog) {
      this.roundAnnounced = true;
      this.game.toast(`ENDLESS ROUND ${this.endlessRound}`, this.endlessRound === 1 ? 'HOW FAR CAN YOU GET?' : this.endlessRound >= 5 ? 'DOUBLE DAMAGE. GOOD LUCK.' : 'A LITTLE TOUGHER. +1 HEART.', '#ff6f3f');
    }
    this.time += dt;
    this.hintT += dt;
    this.particles.update(dt);
    this.popups.update(dt);
    if (this.kevin) {
      this.kevin.t += dt;
      if (this.kevin.t > 4.5) this.kevin = null;
    }
    this.director.update(dt, this.directorContext());
    const tele = this.director.telegraphing();
    this.game.audio.duck(!!tele);
    if (tele && Math.floor(tele.timer * 4) !== Math.floor((tele.timer + dt) * 4)) this.game.audio.sfx('warn');
    for (const ev of this.director.started) {
      this.chaosSeen.add(ev.def.id);
      this.game.audio.sfx('chaos');
      if (ev.def.id === 'kevin_bug') {
        this.kevin = { t: 0, note: ev.note ?? 'BUG: REALITY. STATUS: WONTFIX.' };
        this.runFlags.add('kevin');
        this.addBits(15);
      } else if (ev.def.id === 'fatal_exception' && !this.ended) {
        this.game.startFatal(this);
      }
      this.onChaosStart(ev);
    }
    for (const ev of this.director.ended) this.onChaosEnd(ev);
  }

  onFatal(win: boolean): void {
    if (this.ended) return;
    if (win) {
      this.addBits(60);
      this.heal(1);
      this.runFlags.add('fatal');
      this.game.fx.flash('#7dff6b', 0.4);
    }
  }

  /** Adds run bits; x/y are world coordinates for the floating "+N" popup. */
  addBits(n: number, x?: number, y?: number): void {
    const v = this.modifier?.id === 'rich' ? n * 2 : n;
    this.runBits += v;
    if (x !== undefined && y !== undefined) this.popups.add(x, y, `+${v}`, '#ffcf3f');
  }

  noteDamage(n: number): void {
    this.damageTaken += n;
    this.director.notifyHurt();
    this.game.audio.sfx('hurt');
    this.game.fx.shake(4);
    this.game.fx.flash('#ff2040', 0.25);
  }

  collectFloppy(index: number): void {
    const id = `${this.mode}-${index}`;
    const alreadyHad = this.foundFloppies.includes(id);
    if (!alreadyHad) this.foundFloppies.push(id);
    this.game.audio.sfx('floppy');
    const owned = alreadyHad || this.game.profile.floppies.includes(id);
    this.game.toast('FLOPPY DISK!', owned ? 'ALREADY BACKED UP (+10)' : `${MODE_INFO[this.mode].title} ${index + 1}/3`, '#3fe0ff');
    this.addBits(owned ? 10 : 25);
    this.runXp += owned ? 0 : 15;
  }

  finish(cleared: boolean, score: number, extra: Partial<RunResult> = {}): void {
    if (this.ended) return;
    this.ended = true;
    const rush = this.opts.rush;
    if (this.opts.nightmare && cleared) this.runFlags.add('nightmare');
    const legs = rush?.legs ?? RUSH_LEGS;
    if (rush && cleared && rush.leg < legs.length) {
      // BOSS RUSH / GAUNTLET: no results yet. The next boss is up, with this health and the tally so far.
      const perks = this.opts.perks;
      this.game.startMode(
        legs[rush.leg],
        { rematch: true, perks, rush: { leg: rush.leg + 1, legs, carryHp: this.hp, bits: (rush.bits ?? 0) + this.runBits, xp: (rush.xp ?? 0) + this.runXp + 40, time: (rush.time ?? 0) + this.time, damage: (rush.damage ?? 0) + this.damageTaken, score: (rush.score ?? 0) + score, chaos: [...this.chaosSeen], floppies: [...this.foundFloppies], flags: [...this.runFlags] } },
        // RETRY after a loss in a later leg starts the whole run again, so no leg's tally is ever paid twice.
        { mode: legs[0], opts: { rematch: true, perks, rush: { leg: 1, legs } } },
      );
      return;
    }
    const end = this.opts.endless;
    if (end && cleared) {
      // ENDLESS RUN: bank this round, patch up a little and go again on a fresh seed.
      this.addBits(20 * end.round);
      const next = {
        round: end.round + 1,
        seed: (this.seed + 104729 * end.round) % 1000000,
        carryHp: Math.min(this.stats.maxHp, this.hp + 1 + this.perkFx.heal),
        bits: (end.bits ?? 0) + this.runBits,
        xp: (end.xp ?? 0) + this.runXp + 30,
        time: (end.time ?? 0) + this.time,
        damage: (end.damage ?? 0) + this.damageTaken,
        score: (end.score ?? 0) + score + 100 * end.round,
        chaos: [...this.chaosSeen],
        floppies: [...this.foundFloppies],
        flags: [...this.runFlags],
      };
      this.game.startMode(this.mode, { endless: next, perks: this.opts.perks }, { mode: this.mode, opts: { endless: { round: 1 } } });
      return;
    }
    const result: RunResult = {
      mode: this.mode,
      cleared,
      score,
      time: this.time,
      bits: this.runBits,
      xp: Math.round((this.runXp + (cleared ? 40 : 10)) * this.perkFx.xp * (this.fusion.has('curse_frail') ? 2 : 1)),
      floppies: this.foundFloppies,
      damageTaken: this.damageTaken,
      flags: [...this.runFlags],
      chaosSeen: [...this.chaosSeen],
      bitMultiplier: this.fusion.rewardMultiplier() + (this.modifier?.bitBonus ?? 0) + petBitBonus(petStage(this.game.profile.pet.care)) + this.perkFx.bits + (this.fusion.has('curse_greed') ? 0.5 : 0),
      rematch: this.opts.rematch,
      challenge: this.opts.daily ? 'daily' : this.opts.seed !== undefined ? 'shared' : undefined,
      dailyKey: this.opts.daily,
      ...extra,
    };
    if (end) {
      mergeCarry(result, end);
      result.endless = { rounds: end.round - 1 };
      result.boss = undefined;
      result.rematch = false;
    }
    if (rush && rush.leg === legs.length && rush.leg > 1) {
      mergeCarry(result, rush);
      result.bitMultiplier += legs.length > 2 ? 1 : 0.5;
      if (cleared) result.flags = [...result.flags, legs.length > 2 ? 'gauntlet' : 'boss_rush'];
    }
    showResults(this.game, result, this.seed);
  }

  /** Pause-menu "end run": cashes out an ENDLESS RUN early (only once at least one round is banked). */
  canBank(): boolean {
    return !this.ended && this.endlessRound > 1;
  }
  bank(): void {
    if (this.canBank()) this.finish(false, 0);
  }

  // ---- HUD helpers -----------------------------------------------------------
  drawChaosHud(ctx: CanvasRenderingContext2D, x = W - 106, y = 6): void {
    if (!this.director.enabled) return;
    drawText(ctx, 'CHAOS', x, y, '#ff3fa4');
    bar(ctx, x + 34, y + 1, 64, 5, this.director.meter / 100, '#ff3fa4', '#2a0b22', '#ffffff66');
    const tele = this.director.telegraphing();
    let row = y + 12;
    if (tele) {
      const blink = Math.floor(this.time * 5) % 2 === 0;
      frame(ctx, W / 2 - 110, 22, 220, 30, blink ? '#3a0828ee' : '#200418ee', '#ff3fa4');
      drawText(ctx, `⚠ INCOMING: ${tele.def.name}`, W / 2, 27, '#ffcf3f', { align: 'center' });
      drawText(ctx, tele.def.blurb.slice(0, 34), W / 2, 39, '#fff', { align: 'center' });
      rect(ctx, W / 2 - 100, 49, 200 * Math.max(0, tele.timer / Math.max(1.5, tele.def.telegraph)), 2, '#ff3fa4');
    }
    for (const a of this.director.active) {
      if (a.phase !== 'active' || a.def.duration <= 0) continue;
      drawText(ctx, `${a.def.name} ${Math.ceil(a.timer)}`, W - 6, row, '#ffcf3f', { align: 'right' });
      row += 9;
    }
    if (this.kevin) this.game.drawKevinCameo(ctx, this.kevin.t, this.kevin.note);
  }

  drawRunInfo(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    drawText(ctx, `BITS ${this.runBits}`, x, y, '#ffcf3f');
    drawText(ctx, `DISKS ${this.foundFloppies.length}/3`, x, y + 9, '#3fe0ff');
    if (this.endlessRound) drawText(ctx, `ENDLESS ROUND ${this.endlessRound}`, x, y + 27, '#ff6f3f');
    if (this.modifier) drawText(ctx, `MOD: ${this.modifier.name}`, x, y + 18, '#b07aff');
    if (this.perkList.length) drawText(ctx, `PERKS: ${this.perkList.map((p) => p.name).join(', ')}`.slice(0, 40), x, y + 36, '#7dff6b');
  }

  drawHint(ctx: CanvasRenderingContext2D, text: string, touchText = this.gestureHint, y = H - 14): void {
    if (!this.game.settings.hints || this.hintT > 7) return;
    const a = this.hintT > 6 ? 7 - this.hintT : 1;
    ctx.globalAlpha = Math.max(0, a);
    rect(ctx, 0, y, W, 14, '#000c');
    const shown = this.game.input.usingTouch && touchText ? touchText : this.game.input.label(text);
    drawText(ctx, shown, W / 2, y + 3, '#fff', { align: 'center' });
    ctx.globalAlpha = 1;
  }

  drawSeed(ctx: CanvasRenderingContext2D, y = H - 10): void {
    // The control hint strip occupies the same row; show the seed once it fades.
    if (this.game.settings.hints && this.hintT <= 7) return;
    drawText(ctx, `SEED ${formatSeed(this.seed)}`, W - 6, y, '#ffffff55', { align: 'right', shadow: null });
  }

  restart(): void {
    this.game.restart();
  }
}
