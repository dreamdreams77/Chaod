/** Settings, control remapping and save management. Everything persists immediately. */
import type { Game, Scene } from '../game.ts';
import { ListMenu, MenuItem } from './menu.ts';
import { ACTIONS, ACTION_LABELS, DEFAULT_BINDINGS, cloneBindings, keyLabel, Action } from '../core/input.ts';
import { H, W, PAL, rect, backdrop, glow } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { ChaosIntensity, Difficulty, defaultProfile } from '../core/save.ts';
import { formatSeed } from '../core/rng.ts';
import { haptics } from '../core/haptics.ts';
import { decodeSave, encodeSave } from '../core/backup.ts';

/** Where players report problems. */
export const FEEDBACK_URL = 'https://github.com/dreamdreams77/Chaod/issues/new';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const CHAOS: ChaosIntensity[] = ['off', 'low', 'normal', 'high'];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const cyc = <T,>(arr: T[], cur: T, d: number): T => arr[(arr.indexOf(cur) + d + arr.length) % arr.length];

export class SettingsScene implements Scene {
  id = 'settings';
  crt = 0.2;
  private menu: ListMenu;
  private t = 0;
  private capture: { action: Action; slot: number } | null = null;
  private eraseArmed = 0;
  private importArmed = 0;

  constructor(private game: Game, private back: () => Scene) {
    this.menu = this.mainMenu();
  }

  private save(): void {
    this.game.saveSettings();
  }

  private mainMenu(): ListMenu {
    const s = this.game.settings;
    const items: MenuItem[] = [
      { label: 'MASTER VOLUME', value: () => pct(s.master), onAdjust: (d) => { s.master = clamp01(s.master + d * 0.1); this.save(); } },
      { label: 'MUSIC', value: () => (s.musicOn ? 'ON' : 'OFF'), sub: 'Turns the soundtrack on or off; sound effects stay. Press M anywhere to toggle.', onAdjust: () => { s.musicOn = !s.musicOn; this.save(); } },
      { label: 'SOUND EFFECTS', value: () => (s.sfxOn ? 'ON' : 'OFF'), sub: 'Turns every sound effect on or off; the music has its own switch.', onAdjust: () => this.game.toggleSfx() },
      { label: 'VIBRATION', value: () => (haptics.supported ? (s.vibration ? 'ON' : 'OFF') : 'N/A'), sub: haptics.supported ? 'Short buzzes for hits, bombs, boss slams and goals. Switching it on gives a test buzz.' : 'This browser cannot vibrate (iPhones and most computers cannot).', onAdjust: () => this.game.toggleVibration() },
      { label: 'MUSIC VOLUME', value: () => pct(s.music), onAdjust: (d) => { s.music = clamp01(s.music + d * 0.1); this.save(); } },
      { label: 'SFX VOLUME', value: () => pct(s.sfx), onAdjust: (d) => { s.sfx = clamp01(s.sfx + d * 0.1); this.save(); this.game.audio.sfx('coin'); } },
      { label: 'MUTE ALL', value: () => (s.muted ? 'ON' : 'OFF'), onAdjust: () => { s.muted = !s.muted; this.save(); } },
      { label: 'DIFFICULTY', value: () => s.difficulty.toUpperCase(), sub: 'Easy: weaker enemies, gentler chaos. Hard: faster bosses, more chaos.', onAdjust: (d) => { s.difficulty = cyc(DIFFS, s.difficulty, d); this.save(); } },
      { label: 'RUN PERKS', value: () => (s.perks ? 'ON' : 'OFF'), sub: 'Pick one of three perks before each run and each endless round. OFF skips the pick.', onAdjust: () => { s.perks = !s.perks; this.save(); } },
      { label: 'ASSIST MODE', value: () => (s.assist ? 'ON' : 'OFF'), sub: 'One extra heart in every world and slightly slower enemies and bullets. Rewards stay the same.', onAdjust: () => { s.assist = !s.assist; this.save(); } },
      { label: 'CLEAR SHAPES', value: () => (s.shapes ? 'ON' : 'OFF'), sub: 'Adds patterns to BLOCK PARTY pieces and a different shape for each bullet colour in PENALTY STORM and THE HIGH SCORE, so colour is never the only clue.', onAdjust: () => { s.shapes = !s.shapes; this.save(); } },
      { label: 'GAME SPEED', value: () => pct(s.gameSpeed), sub: 'Slows the whole simulation for more reaction time. Rhythm songs slow down to match.', onAdjust: (d) => { s.gameSpeed = Math.min(1, Math.max(0.5, Math.round((s.gameSpeed + d * 0.1) * 10) / 10)); this.save(); } },
      { label: 'CHAOS DIRECTOR', value: () => s.chaos.toUpperCase(), sub: 'How often surprise events happen. OFF disables them entirely.', onAdjust: (d) => { s.chaos = cyc(CHAOS, s.chaos, d); this.save(); } },
      { label: 'SCREEN SHAKE', value: () => pct(s.shake), onAdjust: (d) => { s.shake = clamp01(s.shake + d * 0.25); this.save(); } },
      { label: 'REDUCED FLASHING', value: () => (s.reducedFlash ? 'ON' : 'OFF'), sub: 'Caps flash intensity and removes flickery chaos events.', onAdjust: () => { s.reducedFlash = !s.reducedFlash; this.save(); } },
      { label: 'CRT SCANLINES', value: () => (s.crt ? 'ON' : 'OFF'), onAdjust: () => { s.crt = !s.crt; this.save(); } },
      { label: 'CONTROL HINTS', value: () => (s.hints ? 'ON' : 'OFF'), onAdjust: () => { s.hints = !s.hints; this.save(); } },
      {
        label: 'FIXED SEED', value: () => (s.fixedSeed === null ? 'RANDOM' : formatSeed(s.fixedSeed)),
        sub: 'Set a seed to replay or share an exact procedural run. LEFT/RIGHT change it, CONFIRM toggles.',
        onAdjust: (d) => { s.fixedSeed = s.fixedSeed === null ? 1000 : Math.max(0, Math.min(999999, s.fixedSeed + d * 1)); this.save(); },
        onSelect: () => { s.fixedSeed = s.fixedSeed === null ? this.game.rng.int(0, 999999) : null; this.save(); },
      },
      { label: 'REMAP CONTROLS', onSelect: () => (this.menu = this.remapMenu()) },
      { label: 'EXPORT SAVE', sub: 'Copies your whole save as one line of text. Paste it into IMPORT SAVE on another device or browser to carry your progress.', onSelect: () => void this.exportSave() },
      { label: 'IMPORT SAVE', value: () => (this.importArmed > 0 ? 'PRESS AGAIN' : ''), sub: 'Replaces this save with one you copied from EXPORT SAVE. Press twice; the code is read from the clipboard.', onSelect: () => void this.importSave() },
      { label: 'REPORT A BUG / FEEDBACK', sub: 'Opens the GitHub issues page in a new tab.', onSelect: () => { window.open(FEEDBACK_URL, '_blank', 'noopener'); } },
      { label: 'ERASE SAVE DATA', color: '#ff6f3f', value: () => (this.eraseArmed > 0 ? 'PRESS AGAIN' : ''), onSelect: () => this.erase() },
      { label: 'BACK', onSelect: () => this.leave() },
    ];
    return new ListMenu('SETTINGS', items, () => this.leave(), { x: 70, y: 18, w: 340, rows: 15, accent: '#3fe0ff' });
  }

  private remapMenu(): ListMenu {
    const items: MenuItem[] = ACTIONS.map((a) => ({
      label: ACTION_LABELS[a],
      value: () => this.game.input.bindings[a].map(keyLabel).join(' / '),
      sub: 'CONFIRM, then press the new key. It becomes the primary key for this action.',
      onSelect: () => {
        this.capture = { action: a, slot: 0 };
        this.game.input.captureNext = (code) => {
          if (code !== 'Escape' || a === 'pause' || a === 'back') this.game.input.rebind(a, 0, code);
          this.capture = null;
          this.save();
        };
      },
    }));
    items.push({ label: 'RESET TO DEFAULTS', onSelect: () => { this.game.input.bindings = cloneBindings(DEFAULT_BINDINGS); this.save(); } });
    items.push({ label: 'BACK', onSelect: () => (this.menu = this.mainMenu()) });
    return new ListMenu('REMAP CONTROLS', items, () => (this.menu = this.mainMenu()), { x: 50, y: 20, w: 380, rows: 13, accent: '#ff3fa4' });
  }

  private async exportSave(): Promise<void> {
    const code = encodeSave(this.game.profile);
    try {
      await navigator.clipboard.writeText(code);
      this.game.toast('SAVE COPIED', 'PASTE IT INTO IMPORT SAVE', '#3fe0ff');
    } catch {
      // No clipboard access (older browsers, insecure pages): hand it over as a file instead.
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
      a.download = 'chaos-exe-save.txt';
      a.click();
      URL.revokeObjectURL(a.href);
      this.game.toast('SAVE DOWNLOADED', 'OPEN THE FILE AND COPY ALL', '#3fe0ff');
    }
  }

  private async importSave(): Promise<void> {
    if (this.importArmed <= 0) {
      this.importArmed = 3;
      return;
    }
    this.importArmed = 0;
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = window.prompt('Paste your save code here:') ?? '';
    }
    if (!text.trim()) return;
    const p = decodeSave(text);
    if (!p) {
      this.game.toast('NOT A SAVE CODE', 'COPY THE WHOLE LINE FROM EXPORT SAVE', '#ff6f3f');
      return;
    }
    this.game.profile = p;
    this.game.saveProfile();
    this.game.resetSessionCaches();
    this.game.toast('SAVE IMPORTED', `LEVEL ${p.level}, ${p.bits} BITS`, '#7dff6b');
  }

  private erase(): void {
    if (this.eraseArmed > 0) {
      this.game.store.deleteProfile();
      this.game.profile = defaultProfile();
      this.game.resetSessionCaches();
      this.game.toast('SAVE ERASED', 'A FRESH CARTRIDGE.', '#ff6f3f');
      this.eraseArmed = 0;
    } else this.eraseArmed = 3;
  }

  private leave(): void {
    this.save();
    const next = this.back();
    this.game.scene.exit?.();
    this.game.scene = next;
    // Returning to a paused gameplay scene keeps its state; menus re-enter.
    this.game.holdAudio = false;
    if (!next.pausable) next.enter?.();
    else {
      this.game.paused = true;
      this.game.pauseIndex = 0;
    }
  }

  tap(x: number, y: number): boolean {
    if (!this.capture) this.menu.tap(x, y, this.game);
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    this.eraseArmed = Math.max(0, this.eraseArmed - dt);
    this.importArmed = Math.max(0, this.importArmed - dt);
    if (this.capture) {
      // Touch pads cannot press a key, so the pause button cancels the prompt.
      if (this.game.input.usingTouch && this.game.input.pressed('back')) {
        this.game.input.captureNext = null;
        this.capture = null;
      }
      return;
    }
    this.menu.update(this.game);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    backdrop(ctx, '#05020d', PAL.hub.bg1);
    glow(ctx, W / 2, H, 220, '63,224,255', 0.1);
    for (let y = 0; y < H; y += 8) rect(ctx, 0, y, W, 1, '#ffffff06');
    this.menu.draw(ctx, this.t);
    if (this.capture) {
      rect(ctx, 0, 0, W, H, '#000a');
      drawText(ctx, `PRESS A KEY FOR: ${ACTION_LABELS[this.capture.action]}`, W / 2, H / 2 - 6, '#ffcf3f', { align: 'center' });
    }
  }
}

function clamp01(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}
