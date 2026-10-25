/**
 * CHAOS.exe entry point: wires the game together and runs a fixed-timestep loop.
 * - Simulation runs at 60 Hz regardless of display refresh (stable physics).
 * - Rendering happens once per animation frame.
 * - Background tabs pause automatically (no CPU burn, audio suspended).
 */
import { Game } from './game.ts';
import { Input, setupTouch } from './core/input.ts';
import { TouchGestures } from './core/gestures.ts';
import { setTextFilter } from './render/font.ts';
import { parseChallenge } from './data/daily.ts';
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
  game.sharedChallenge = parseChallenge(location.search);
  game.scene = game.titleFactory();
  game.scene.enter?.();

  setupTouch(document.getElementById('touch')!, input, () => resize(), () => {
    game.settings.musicOn = !game.settings.musicOn;
    game.saveSettings();
    game.toast('MUSIC', game.settings.musicOn ? 'ON' : 'OFF', '#3fe0ff');
    return game.settings.musicOn;
  });

  // Audio can only start after a user gesture.
  const unlock = () => audio.unlock();
  window.addEventListener('keydown', unlock);
  // Tapping or clicking the screen drives menus (the touch pad still works for everything).
  const logical = (e: PointerEvent): [number, number] | null => {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
  };
  // On phones every on-screen string shows the touch pad's button names (A/B/C, D-PAD, II).
  setTextFilter((t) => input.label(t));
  const gestures = new TouchGestures(input, () => game.gestureMode(), (x) => game.scene.laneAt?.(x) ?? null);
  let dragId: number | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    const p = logical(e);
    if (!p) return;
    canvas.setPointerCapture?.(e.pointerId);
    if (e.pointerType !== 'mouse') gestures.down(e.pointerId, p[0], p[1], performance.now());
    // Menus, taps and mini-game steering follow the first finger only.
    if (dragId === null) {
      dragId = e.pointerId;
      game.tap(p[0], p[1]);
      game.drag(p[0], p[1]);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = logical(e);
    if (!p) return;
    if (e.pointerType !== 'mouse') gestures.move(e.pointerId, p[0], p[1]);
    if (dragId === e.pointerId) game.drag(p[0], p[1]);
  });
  const endDrag = (id: number) => {
    if (dragId !== id) return;
    dragId = null;
    game.dragEnd();
  };
  canvas.addEventListener('pointerup', (e) => {
    gestures.up(e.pointerId, performance.now());
    endDrag(e.pointerId);
  });
  canvas.addEventListener('pointercancel', (e) => {
    gestures.up(e.pointerId, performance.now());
    endDrag(e.pointerId);
  });
  // M toggles the music from anywhere (not while a remap prompt is waiting for a key).
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || input.captureNext || Object.values(input.bindings).some((keys) => keys.includes('KeyM'))) return;
    game.settings.musicOn = !game.settings.musicOn;
    game.saveSettings();
    game.toast('MUSIC', game.settings.musicOn ? 'ON' : 'OFF', '#3fe0ff');
  });
  window.addEventListener('pointerdown', unlock);

  // Fit the screen inside the page. On touch devices the pad gets its own gutter
  // (below the screen in portrait, beside it in landscape) so nothing overlaps the game.
  const PAD = 174;
  const screen = document.getElementById('screen')!;
  const resize = () => {
    const body = document.body;
    const portrait = window.innerHeight > window.innerWidth;
    const touch = input.usingTouch;
    // Portrait: tighter side margins so the screen can use nearly the full phone width.
    body.style.paddingBottom = touch && portrait ? `calc(${PAD + 8}px + env(safe-area-inset-bottom, 0px))` : '';
    body.style.paddingLeft = touch ? (portrait ? 'max(4px, env(safe-area-inset-left, 0px))' : `max(${PAD}px, env(safe-area-inset-left, 0px))`) : '';
    body.style.paddingRight = touch ? (portrait ? 'max(4px, env(safe-area-inset-right, 0px))' : `max(${PAD}px, env(safe-area-inset-right, 0px))`) : '';
    const bs = getComputedStyle(body);
    const availW = body.clientWidth - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight);
    const availH = window.innerHeight - parseFloat(bs.paddingTop) - parseFloat(bs.paddingBottom);
    let s = Math.min(availW / W, availH / H);
    // Whole-number scales keep every game pixel the same size (no shimmer);
    // below 2x there is no room to be picky, so scale smoothly instead.
    const crisp = s >= 2;
    if (crisp) s = Math.floor(s);
    canvas.style.width = `${Math.floor(W * s)}px`;
    canvas.style.height = `${Math.floor(H * s)}px`;
    canvas.style.imageRendering = crisp ? 'pixelated' : 'auto';
    screen.style.setProperty('--s', String(s));
  };
  window.addEventListener('resize', resize);
  resize();

  // Focus loss pauses gameplay; hidden tabs suspend audio.
  const autoPause = () => {
    input.clearAll();
    gestures.cancelAll();
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

  const musicBtn = document.querySelector('#touch button[aria-label="toggle music"]');
  let last = performance.now();
  let acc = 0;
  let crashed = false;
  const frame = (now: number) => {
    if (crashed) return;
    try {
      gestures.tick(performance.now());
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
      musicBtn?.classList.toggle('off', !game.settings.musicOn);
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
