/**
 * Game — owns the canvas, input, audio, persistence and the active scene.
 * Scenes draw into a 480x270 layer; the game composites post-effects
 * (chaos filters, CRT, flashes, overlays) onto the visible canvas.
 */
import { Input } from './core/input.ts';
import { AudioEngine, TrackId } from './audio/audio.ts';
import { Profile, SaveStore, Settings, ModeId } from './core/save.ts';
import { Rng } from './core/rng.ts';
import { H, W, ScreenFx, drawCRT, frame, rect } from './render/gfx.ts';
import { drawText, wrap } from './render/font.ts';
import { drawPortrait, drawKevin } from './render/actors.ts';
import type { Line } from './data/story.ts';
import { ACHIEVEMENTS } from './data/progression.ts';
import type { ChaosDirector } from './chaos/director.ts';

export interface Scene {
  id: string;
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
  enter?(): void;
  exit?(): void;
  /** Gameplay scenes can be paused and restarted. */
  pausable?: boolean;
  restart?(): void;
  /** CRT overlay strength for this scene (genre-specific). */
  crt?: number;
  /** Active chaos director (for post effects + HUD). */
  director?: ChaosDirector;
  /** Called with the result of a FATAL EXCEPTION minigame. */
  onFatal?(win: boolean): void;
}

interface DialogState {
  lines: Line[];
  index: number;
  chars: number;
  choice: number;
  effects: string[];
  done: (effects: string[]) => void;
}

interface Toast {
  title: string;
  text: string;
  color: string;
  t: number;
}

interface Transition {
  t: number;
  next: Scene | null;
  banner?: { title: string; sub: string; color: string };
}

interface FatalGame {
  code: string[];
  index: number;
  t: number;
  result: 'pending' | 'win' | 'lose';
  scene: Scene;
}

export class Game {
  readonly layer: HTMLCanvasElement;
  readonly lctx: CanvasRenderingContext2D;
  readonly fx = new ScreenFx();
  scene: Scene;
  paused = false;
  pauseIndex = 0;
  private dialog: DialogState | null = null;
  private toasts: Toast[] = [];
  private transition: Transition | null = null;
  private shiftBanner: { from: string; to: string; color: string; t: number } | null = null;
  private fatal: FatalGame | null = null;
  time = 0;
  rng = new Rng(Date.now() >>> 0);
  /** Factory for restarting the current gameplay scene. */
  private lastStart: (() => Scene) | null = null;
  settingsReturn: (() => Scene) | null = null;
  modeFactory!: (mode: ModeId, opts: { rematch?: boolean }) => Scene;
  hubFactory!: () => Scene;
  titleFactory!: () => Scene;
  settingsFactory!: (back: () => Scene) => Scene;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly ctx: CanvasRenderingContext2D,
    readonly input: Input,
    readonly audio: AudioEngine,
    readonly store: SaveStore,
    public profile: Profile,
    public settings: Settings,
    initial: Scene,
  ) {
    this.layer = document.createElement('canvas');
    this.layer.width = W;
    this.layer.height = H;
    this.lctx = this.layer.getContext('2d')!;
    this.lctx.imageSmoothingEnabled = false;
    this.ctx.imageSmoothingEnabled = false;
    this.scene = initial;
    this.applySettings();
    initial.enter?.();
  }

  // ---- settings / persistence -------------------------------------------------
  applySettings(): void {
    const s = this.settings;
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx, muted: s.muted, musicOn: s.musicOn });
    this.fx.shakeScale = s.shake;
    this.fx.reducedFlash = s.reducedFlash;
    this.input.bindings = s.bindings;
  }
  saveSettings(): void {
    this.settings.bindings = this.input.bindings;
    this.store.saveSettings(this.settings);
    this.applySettings();
  }
  saveProfile(): void {
    this.store.saveProfile(this.profile);
  }
  newSeed(): number {
    return this.settings.fixedSeed ?? this.rng.int(0, 999999);
  }

  // ---- scene flow ------------------------------------------------------------
  goto(next: Scene, banner?: Transition['banner']): void {
    // A request during the first half of a wipe replaces the pending destination.
    if (this.transition) {
      if (this.transition.next) {
        this.transition.next = next;
        if (banner) this.transition.banner = banner;
      } else this.transition = { t: 0, next, banner };
      return;
    }
    this.transition = { t: 0, next, banner };
  }
  startMode(mode: ModeId, opts: { rematch?: boolean } = {}): void {
    this.lastStart = () => this.modeFactory(mode, opts);
    this.profile.runsStarted++;
    this.goto(this.lastStart());
  }
  restart(): void {
    if (this.lastStart) {
      this.paused = false;
      this.audio.muffle(false);
      this.goto(this.lastStart());
    }
  }
  toHub(): void {
    this.paused = false;
    this.audio.muffle(false);
    this.goto(this.hubFactory());
  }
  music(track: TrackId, tempo = 1): void {
    this.audio.play(track, tempo);
  }

  /** In-level genre transformation: brief freeze, banner, audio cue. */
  genreShift(from: string, to: string, color: string): void {
    this.shiftBanner = { from, to, color, t: 0 };
    this.fx.freeze(0.35);
    this.fx.flash(color, 0.5);
    this.audio.sfx('transition');
  }

  say(lines: Line[], done: (effects: string[]) => void = () => {}): void {
    this.dialog = { lines, index: 0, chars: 0, choice: 0, effects: [], done };
  }
  get inDialog(): boolean {
    return this.dialog !== null;
  }

  toast(title: string, text: string, color = '#ffcf3f'): void {
    this.toasts.push({ title, text, color, t: 0 });
  }
  announceAchievements(ids: string[]): void {
    for (const id of ids) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) {
        this.toast('ACHIEVEMENT!', a.name, '#ffcf3f');
        this.audio.sfx('unlock');
      }
    }
  }

  startFatal(scene: Scene): void {
    const arrows = ['↑', '↓', '←', '→'];
    const code: string[] = [];
    for (let i = 0; i < 5; i++) code.push(this.rng.pick(arrows));
    this.fatal = { code, index: 0, t: 0, result: 'pending', scene };
    this.audio.sfx('chaos');
  }

  // ---- main update ---------------------------------------------------------------
  update(dt: number): void {
    this.time += dt;
    const inp = this.input;
    this.audio.hold(this.paused || this.holdAudio);
    this.fx.update(dt);
    for (const t of this.toasts) t.t += dt;
    this.toasts = this.toasts.filter((t) => t.t < 3.2);
    if (this.shiftBanner && (this.shiftBanner.t += dt) > 1.8) this.shiftBanner = null;

    if (this.transition) {
      const tr = this.transition;
      tr.t += dt;
      const half = tr.banner ? 0.6 : 0.25;
      if (tr.next && tr.t >= half) {
        this.scene.exit?.();
        this.scene = tr.next;
        tr.next = null;
        this.paused = false;
        this.holdAudio = false;
        this.fx.reset();
        this.scene.enter?.();
      }
      if (tr.t >= half * 2) this.transition = null;
      this.audio.update(dt);
      return;
    }

    if (this.fatal) {
      this.updateFatal(dt);
      this.audio.update(dt);
      return;
    }

    if (this.dialog) {
      this.updateDialog();
      this.audio.update(dt);
      return;
    }

    if (this.scene.pausable && inp.pressed('pause')) {
      this.paused = !this.paused;
      this.pauseIndex = 0;
      this.audio.muffle(this.paused);
      this.audio.sfx(this.paused ? 'select' : 'back');
    }
    if (this.paused) {
      this.updatePause();
      return;
    }
    if (this.fx.hitstop > 0) {
      this.fx.hitstop -= dt;
      this.audio.update(dt);
      return;
    }
    this.scene.update(dt);
    this.audio.update(dt);
  }

  private updateDialog(): void {
    const d = this.dialog!;
    const line = d.lines[d.index];
    d.chars += 1.5;
    const full = d.chars >= line.text.length;
    const inp = this.input;
    if (full && line.choices) {
      if (inp.pressed('up') || inp.pressed('left')) { d.choice = (d.choice + line.choices.length - 1) % line.choices.length; this.audio.sfx('select'); }
      if (inp.pressed('down') || inp.pressed('right')) { d.choice = (d.choice + 1) % line.choices.length; this.audio.sfx('select'); }
    }
    if (inp.pressed('confirm') || inp.pressed('attack')) {
      if (!full) d.chars = line.text.length;
      else {
        if (line.choices) {
          const eff = line.choices[d.choice].effect;
          if (eff) d.effects.push(eff);
          this.audio.sfx('confirm');
        } else this.audio.sfx('select');
        d.index++;
        d.chars = 0;
        d.choice = 0;
        if (d.index >= d.lines.length) {
          this.dialog = null;
          d.done(d.effects);
        }
      }
    }
  }

  readonly pauseItems = ['RESUME', 'RESTART', 'SETTINGS', 'MUSIC', 'QUIT TO LOBBY'];
  private updatePause(): void {
    const inp = this.input;
    if (inp.pressed('up')) { this.pauseIndex = (this.pauseIndex + this.pauseItems.length - 1) % this.pauseItems.length; this.audio.sfx('select'); }
    if (inp.pressed('down')) { this.pauseIndex = (this.pauseIndex + 1) % this.pauseItems.length; this.audio.sfx('select'); }
    if (inp.pressed('back') && !inp.pressed('pause')) { this.paused = false; this.audio.muffle(false); return; }
    if (inp.pressed('confirm')) {
      this.audio.sfx('confirm');
      const item = this.pauseItems[this.pauseIndex];
      if (item === 'RESUME') { this.paused = false; this.audio.muffle(false); }
      else if (item === 'RESTART') this.restart();
      else if (item === 'MUSIC') { this.settings.musicOn = !this.settings.musicOn; this.saveSettings(); }
      else if (item === 'QUIT TO LOBBY') this.toHub();
      else if (item === 'SETTINGS') {
        const current = this.scene;
        this.paused = false;
        this.audio.muffle(false);
        // Settings return to the paused gameplay scene untouched.
        this.holdAudio = true;
        const s = this.settingsFactory(() => current);
        this.scene.exit?.();
        this.scene = s;
        s.enter?.();
      }
    }
  }

  private updateFatal(dt: number): void {
    const f = this.fatal!;
    f.t += dt;
    const inp = this.input;
    if (f.result === 'pending') {
      const map: Array<[string, 'up' | 'down' | 'left' | 'right']> = [['↑', 'up'], ['↓', 'down'], ['←', 'left'], ['→', 'right']];
      for (const [sym, act] of map) {
        if (inp.pressed(act)) {
          if (f.code[f.index] === sym) {
            f.index++;
            this.audio.sfx('select', 1 + f.index * 0.1);
            if (f.index >= f.code.length) {
              f.result = 'win';
              f.t = 0;
              this.audio.sfx('powerup');
            }
          } else {
            f.index = 0;
            this.audio.sfx('miss');
          }
        }
      }
      if (f.result === 'pending' && f.t > 6) {
        f.result = 'lose';
        f.t = 0;
      }
    } else if (f.t > 1.2) {
      const win = f.result === 'win';
      this.fatal = null;
      f.scene.onFatal?.(win);
    }
  }

  // ---- drawing -----------------------------------------------------------------
  /** Keeps the song frozen while Settings is open from the pause menu. */
  holdAudio = false;
  /** Cabinets the lobby has already shown as powered this session, so unlocks from a run get announced once. */
  cabinetsSeen: Set<ModeId> | null = null;
  private crtShown = true;

  render(): void {
    const g = this.lctx;
    g.save();
    const [sx, sy] = this.fx.offset();
    g.translate(sx, sy);
    this.scene.draw(g);
    g.restore();
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    const dir = this.scene.director;
    if (dir?.flag('vhs')) {
      // Horizontal tear: blit strips with a wobble.
      for (let y = 0; y < H; y += 6) {
        const off = Math.round(Math.sin(this.time * 9 + y * 0.15) * 3 + (Math.sin(this.time * 2.3 + y) > 0.97 ? 12 : 0));
        ctx.drawImage(this.layer, 0, y, W, 6, off, y, W, 6);
      }
    } else ctx.drawImage(this.layer, 0, 0);
    if (dir?.flag('palette_swap')) {
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (dir?.flag('silent_film')) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#f0d8b0';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 30; i++) rect(ctx, (i * 97 + this.time * 3000) % W, (i * 53 + this.time * 1700) % H, 1, 1 + (i % 3), '#0004');
    }
    if (this.settings.crt) drawCRT(ctx, this.scene.crt ?? 0.4);
    if (this.crtShown !== this.settings.crt) {
      this.crtShown = this.settings.crt;
      document.documentElement.classList.toggle('crt-off', !this.settings.crt);
    }
    this.fx.drawFlash(ctx);
    this.drawShiftBanner(ctx);
    if (this.dialog) this.drawDialog(ctx);
    if (this.fatal) this.drawFatal(ctx);
    if (this.paused) this.drawPause(ctx);
    this.drawToasts(ctx);
    if (this.transition) this.drawTransition(ctx);
  }

  private drawShiftBanner(ctx: CanvasRenderingContext2D): void {
    const b = this.shiftBanner;
    if (!b) return;
    const t = b.t;
    const slide = t < 0.25 ? (0.25 - t) * 4 * W : t > 1.5 ? (t - 1.5) * -4 * W : 0;
    ctx.save();
    ctx.translate(slide, 0);
    rect(ctx, 0, 100, W, 64, '#000c');
    rect(ctx, 0, 100, W, 2, b.color);
    rect(ctx, 0, 162, W, 2, b.color);
    drawText(ctx, 'GENRE SHIFT!', W / 2, 108, '#fff', { align: 'center', scale: 2 });
    drawText(ctx, `${b.from}  →  ${b.to}`, W / 2, 134, b.color, { align: 'center', scale: 2 });
    ctx.restore();
  }

  private drawDialog(ctx: CanvasRenderingContext2D): void {
    const d = this.dialog!;
    const line = d.lines[d.index];
    const y = H - 78;
    frame(ctx, 8, y, W - 16, 70, '#0b0716ee', '#ff3fa4');
    drawPortrait(ctx, line.who, 16, y + 8, this.time);
    drawText(ctx, line.name, 56, y + 8, '#ffcf3f');
    const shown = line.text.slice(0, Math.floor(d.chars));
    const lines = wrap(shown, 66);
    lines.slice(0, 4).forEach((l, i) => drawText(ctx, l, 56, y + 20 + i * 10, '#f4eefe'));
    if (d.chars >= line.text.length) {
      if (line.choices) {
        frame(ctx, 250, y - 30 - (line.choices.length - 2) * 11, 220, line.choices.length * 11 + 8, '#0b0716cc', '#3fe0ff');
        line.choices.forEach((c, i) => {
          const sel = i === d.choice;
          drawText(ctx, (sel ? '▶ ' : '  ') + c.label, 258, y - 26 - (line.choices!.length - 2) * 11 + i * 11, sel ? '#3fe0ff' : '#aaa');
        });
      } else if (Math.floor(this.time * 3) % 2) drawText(ctx, '▼', W - 22, y + 58, '#ff3fa4');
    }
  }

  private drawPause(ctx: CanvasRenderingContext2D): void {
    rect(ctx, 0, 0, W, H, '#0b0716b0');
    frame(ctx, W / 2 - 80, 66, 160, 140, '#1d1233', '#3fe0ff');
    drawText(ctx, 'PAUSED', W / 2, 76, '#fff', { align: 'center', scale: 2 });
    this.pauseItems.forEach((it, i) => {
      const sel = i === this.pauseIndex;
      const label = it === 'MUSIC' ? `MUSIC: ${this.settings.musicOn ? 'ON' : 'OFF'}` : it;
      drawText(ctx, (sel ? '▶ ' : '  ') + label, W / 2 - 60, 104 + i * 16, sel ? '#ffcf3f' : '#ccc');
    });
    drawText(ctx, 'ESC/P TO RESUME • M MUSIC', W / 2, 190, '#888', { align: 'center' });
  }

  private drawFatal(ctx: CanvasRenderingContext2D): void {
    const f = this.fatal!;
    rect(ctx, 0, 0, W, H, '#1030b0');
    rect(ctx, W / 2 - 70, 36, 140, 20, '#c0c0c0');
    drawText(ctx, 'CHAOS.EXE', W / 2, 40, '#1030b0', { align: 'center', scale: 2, shadow: null });
    drawText(ctx, 'A FATAL EXCEPTION 0E HAS OCCURRED AT 0028:C0011E36.', W / 2, 74, '#fff', { align: 'center', shadow: null });
    drawText(ctx, 'THE CURRENT GENRE WILL BE TERMINATED.', W / 2, 88, '#fff', { align: 'center', shadow: null });
    drawText(ctx, 'ENTER THE RECOVERY CODE FOR A JACKPOT:', W / 2, 116, '#fff', { align: 'center', shadow: null });
    f.code.forEach((c, i) => {
      const done = i < f.index;
      drawText(ctx, c, W / 2 - 60 + i * 26, 136, done ? '#7dff6b' : '#fff', { scale: 3, shadow: null });
    });
    if (f.result === 'pending') {
      const left = Math.max(0, 6 - f.t);
      rect(ctx, W / 2 - 100, 176, 200 * (left / 6), 4, '#fff');
      drawText(ctx, `${left.toFixed(1)}S`, W / 2, 186, '#fff', { align: 'center', shadow: null });
    } else {
      drawText(ctx, f.result === 'win' ? 'RECOVERED! +60 BITS +1 HEART' : 'CONTINUING ANYWAY. NO HARM DONE.', W / 2, 186, f.result === 'win' ? '#7dff6b' : '#ffcf3f', { align: 'center', shadow: null });
    }
    drawText(ctx, 'PRESS THE ARROWS SHOWN. WRONG ARROW RESTARTS THE CODE.', W / 2, 230, '#c0d0ff', { align: 'center', shadow: null });
  }

  private drawToasts(ctx: CanvasRenderingContext2D): void {
    // Toasts stack upward from the lower-left, clear of every mode's main HUD.
    this.toasts.slice(0, 3).forEach((t, i) => {
      const text = t.text.slice(0, 44);
      const w = Math.max(t.title.length, text.length) * 6 + 14;
      const slide = t.t < 0.2 ? (0.2 - t.t) * 5 * (w + 10) : t.t > 2.9 ? (t.t - 2.9) * 5 * (w + 10) : 0;
      const x = 6 - slide;
      const y = H - 48 - i * 30;
      frame(ctx, x, y, w, 26, '#0b0716ee', t.color);
      drawText(ctx, t.title, x + 7, y + 4, t.color);
      drawText(ctx, text, x + 7, y + 15, '#fff');
    });
  }

  private drawTransition(ctx: CanvasRenderingContext2D): void {
    const tr = this.transition!;
    const half = tr.banner ? 0.6 : 0.25;
    const p = tr.t < half ? tr.t / half : 1 - (tr.t - half) / half;
    // Checkerboard dissolve wipe.
    const size = 16;
    for (let y = 0; y < H; y += size) {
      for (let x = 0; x < W; x += size) {
        const k = ((x / size + y / size) % 2) * 0.15 + (x / W) * 0.85;
        if (k < p * 1.05) rect(ctx, x, y, size, size, '#0b0716');
      }
    }
    if (tr.banner && p > 0.7) {
      drawText(ctx, tr.banner.title, W / 2, H / 2 - 16, tr.banner.color, { align: 'center', scale: 3 });
      drawText(ctx, tr.banner.sub, W / 2, H / 2 + 16, '#fff', { align: 'center' });
    }
  }

  /** Kevin's cameo during a "bug fix" chaos event (shared by all modes). */
  drawKevinCameo(ctx: CanvasRenderingContext2D, t: number, note: string): void {
    if (t > 4) return;
    const x = -20 + t * 90;
    rect(ctx, 0, H - 40, W, 40, '#0008');
    drawKevin(ctx, x, H - 6, t, 1);
    frame(ctx, x + 16, H - 38, Math.min(300, note.length * 6 + 12), 16, '#fff', '#3fa9ff');
    drawText(ctx, note, x + 22, H - 34, '#1d1233', { shadow: null });
  }
}
