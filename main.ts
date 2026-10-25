/**
 * CHAOS.exe entry point: wires the game together and runs a fixed-timestep loop.
 * - Simulation runs at 60 Hz regardless of display refresh (stable physics).
 * - Rendering happens once per animation frame.
 * - Background tabs pause automatically (no CPU burn, audio suspended).
 */
import { Game } from './game.ts';
import { Input, setupTouch } from './core/input.ts';
import { AudioEngine } from './audio/audio.ts';
import { SaveStore, browserKV, ModeId } from './core/save.ts';
import { W, H } from './render/gfx.ts';
import { TitleScene } from './scenes/title.ts';
import { HubScene } from './scenes/hub.ts';
import { SettingsScene } from './scenes/settings.ts';
import { RampageMode } from './modes/rampage.ts';
import { NeonMode } from './modes/neon.ts';
import { MallMode } from './modes/mall.ts';
import { BeatdownMode } from './modes/beatdown.ts';
import { RhythmMode } from './modes/rhythm.ts';
import { validateRegistry } from './fusion/registry.ts';
import { CHAOS_EVENTS } from './chaos/events.ts';
import type { Scene } from './game.ts';

const STEP = 1 / 60;

function showError(msg: string): void {
  const el = document.getElementById('err');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = `CHAOS.exe hit a real bug (not a chaos event):\n${msg}\nRefresh to continue — your save is kept.`;
}

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    showError('Canvas 2D is not available in this browser.');
    return;
  }
  const store = new SaveStore(browserKV());
  const settings = store.loadSettings();
  const profile = store.loadProfile();
  const input = new Input(settings.bindings);
  input.attach(window);
  const audio = new AudioEngine();
  const regErrors = validateRegistry();
  if (regErrors.length) console.warn('Mutation registry problems:', regErrors);

  // The initial scene needs `game`, so build it lazily.
  let game!: Game;
  const title = { id: 'boot', update() {}, draw() {} } as Scene;
  game = new Game(canvas, ctx, input, audio, store, profile, settings, title);
  game.titleFactory = () => new TitleScene(game);
  game.hubFactory = () => new HubScene(game);
  game.settingsFactory = (back) => new SettingsScene(game, back);
  game.modeFactory = (mode: ModeId, opts) => {
    switch (mode) {
      case 'rampage': return new RampageMode(game, opts);
      case 'neon': return new NeonMode(game, opts);
      case 'mall': return new MallMode(game, opts);
      case 'beatdown': return new BeatdownMode(game, opts);
      case 'rhythm': return new RhythmMode(game, opts);
    }
  };
  game.scene = game.titleFactory();
  game.scene.enter?.();

  setupTouch(document.getElementById('touch')!, input);

  // Audio can only start after a user gesture.
  const unlock = () => audio.unlock();
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);

  // Integer-ish scaling that fills the window while keeping pixels crisp.
  const resize = () => {
    // Fit inside the page's padding (side gutters, safe-area insets) without scrollbars.
    const bs = getComputedStyle(document.body);
    const rs = getComputedStyle(document.documentElement);
    const availW = document.body.clientWidth - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight);
    const availH = window.innerHeight - parseFloat(rs.paddingTop || '0') - parseFloat(rs.paddingBottom || '0');
    const sx = availW / W;
    const sy = availH / H;
    let s = Math.min(sx, sy);
    if (s >= 2) s = Math.floor(s);
    canvas.style.width = `${Math.floor(W * s)}px`;
    canvas.style.height = `${Math.floor(H * s)}px`;
  };
  window.addEventListener('resize', resize);
  resize();

  // Focus loss pauses gameplay; hidden tabs suspend audio.
  const autoPause = () => {
    input.clearAll();
    if (game.scene.pausable && !game.paused) {
      game.paused = true;
      game.pauseIndex = 0;
      audio.muffle(true);
    }
  };
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      autoPause();
      audio.suspend();
    } else audio.resume();
  });
  canvas.focus();

  let last = performance.now();
  let acc = 0;
  let crashed = false;
  const frame = (now: number) => {
    if (crashed) return;
    try {
      let elapsed = (now - last) / 1000;
      last = now;
      if (elapsed > 0.25) elapsed = 0.25; // avoid spiral of death after stalls
      acc += elapsed * game.settings.gameSpeed;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        input.beginFrame();
        game.update(STEP);
        input.endFrame();
        acc -= STEP;
        steps++;
      }
      if (steps === 5) acc = 0;
      game.profile.playTime += elapsed;
      game.render();
    } catch (e) {
      crashed = true;
      console.error(e);
      showError(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e));
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Lightweight automation hook used by the smoke tests and handy for debugging.
  (window as unknown as { __chaos: unknown }).__chaos = {
    game,
    start: (m: ModeId) => game.startMode(m),
    hub: () => game.toHub(),
    press: (a: Parameters<Input['setVirtual']>[0], down: boolean) => input.setVirtual(a, down),
    scene: () => game.scene.id,
    events: CHAOS_EVENTS,
  };
}

window.addEventListener('error', (e) => showError(String(e.message)));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
