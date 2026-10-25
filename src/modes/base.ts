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
import { MODIFIERS, Modifier, RunResult } from '../data/progression.ts';
import { Particles, Popups, W, H, frame, rect, bar } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { showResults } from '../scenes/results.ts';
import { MODE_INFO } from '../data/story.ts';

const BUMP: Record<ChaosIntensity, ChaosIntensity> = { off: 'off', low: 'normal', normal: 'high', high: 'high' };

export abstract class ModeBase implements Scene {
  abstract id: string;
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

  constructor(readonly game: Game, readonly mode: ModeId, readonly opts: { rematch?: boolean } = {}) {
    this.seed = game.newSeed();
    this.rng = new Rng(this.seed);
    const p = game.profile;
    this.fusion = new FusionEngine(mode, p);
    // Replays of cleared worlds roll a seeded challenge modifier for variety.
    const replay = p.cleared[mode].clears > 0;
    this.modifier = replay && !opts.rematch ? this.rng.fork(77).pick(MODIFIERS) : null;
    let intensity = game.settings.chaos;
    if (this.modifier?.id === 'chaotic') intensity = BUMP[intensity];
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
    if (this.modifier?.id === 'glass') st.maxHp = Math.max(2, st.maxHp - 1);
    this.stats = st;
  }

  get diffMult(): number {
    return { easy: 0.6, normal: 1, hard: 1.4 }[this.game.settings.difficulty];
  }
  get damageMult(): number {
    return this.modifier?.id === 'glass' ? 2 : 1;
  }
  get speedMult(): number {
    return this.modifier?.id === 'turbo' ? 1.15 : 1;
  }

  abstract directorContext(): DirectorContext;
  abstract heal(n: number): void;
  onChaosStart(_ev: ActiveEvent): void {}
  onChaosEnd(_ev: ActiveEvent): void {}

  abstract update(dt: number): void;
  abstract draw(ctx: CanvasRenderingContext2D): void;

  tickShared(dt: number): void {
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
    if (!this.foundFloppies.includes(id)) this.foundFloppies.push(id);
    this.game.audio.sfx('floppy');
    const owned = this.game.profile.floppies.includes(id);
    this.game.toast('FLOPPY DISK!', owned ? 'ALREADY BACKED UP (+10)' : `${MODE_INFO[this.mode].title} ${index + 1}/3`, '#3fe0ff');
    this.addBits(owned ? 10 : 25);
    this.runXp += owned ? 0 : 15;
  }

  finish(cleared: boolean, score: number, extra: Partial<RunResult> = {}): void {
    if (this.ended) return;
    this.ended = true;
    const result: RunResult = {
      mode: this.mode,
      cleared,
      score,
      time: this.time,
      bits: this.runBits,
      xp: this.runXp + (cleared ? 40 : 10),
      floppies: this.foundFloppies,
      damageTaken: this.damageTaken,
      flags: [...this.runFlags],
      chaosSeen: [...this.chaosSeen],
      bitMultiplier: this.fusion.rewardMultiplier() + (this.modifier?.bitBonus ?? 0),
      rematch: this.opts.rematch,
      ...extra,
    };
    showResults(this.game, result, this.seed);
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
    if (this.modifier) drawText(ctx, `MOD: ${this.modifier.name}`, x, y + 18, '#b07aff');
  }

  drawHint(ctx: CanvasRenderingContext2D, text: string, touchText = this.gestureHint): void {
    if (!this.game.settings.hints || this.hintT > 7) return;
    const a = this.hintT > 6 ? 7 - this.hintT : 1;
    ctx.globalAlpha = Math.max(0, a);
    rect(ctx, 0, H - 14, W, 14, '#000c');
    const shown = this.game.input.usingTouch && touchText ? touchText : this.game.input.label(text);
    drawText(ctx, shown, W / 2, H - 11, '#fff', { align: 'center' });
    ctx.globalAlpha = 1;
  }

  drawSeed(ctx: CanvasRenderingContext2D): void {
    // The control hint strip occupies the same row; show the seed once it fades.
    if (this.game.settings.hints && this.hintT <= 7) return;
    drawText(ctx, `SEED ${formatSeed(this.seed)}`, W - 6, H - 10, '#ffffff55', { align: 'right', shadow: null });
  }

  restart(): void {
    this.game.restart();
  }
}
