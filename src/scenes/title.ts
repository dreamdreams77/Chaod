/** Title screen, controls reference and credits. */
import type { Game, Scene } from '../game.ts';
import { ListMenu, MenuItem } from './menu.ts';
import { H, W, rect, frame, backdrop, glow } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { drawCass, drawByte, drawManual, drawKevin, drawRex, drawPolygon } from '../render/actors.ts';
import { defaultProfile } from '../core/save.ts';
import { keyLabel } from '../core/input.ts';
import { CAST, BOSSES } from '../data/story.ts';

type Panel = 'menu' | 'controls' | 'credits' | 'confirmNew';

export class TitleScene implements Scene {
  id = 'title';
  crt = 0.5;
  private t = 0;
  private menu!: ListMenu;
  private panel: Panel = 'menu';
  private code = '';
  private started = false;

  constructor(private game: Game) {
    this.build();
  }

  private build(): void {
    const has = this.game.store.hasProfile();
    const items: MenuItem[] = [];
    if (has) items.push({ label: 'CONTINUE', sub: this.saveSummary(), onSelect: () => this.continueGame() });
    items.push({ label: 'NEW GAME', sub: has ? 'Starts over. Your settings are kept.' : 'Fall into the Cartridge Core.', onSelect: () => (has ? (this.panel = 'confirmNew') : this.newGame()) });
    items.push({ label: 'SETTINGS', sub: 'Audio, accessibility, difficulty, chaos, seeds, controls.', onSelect: () => this.game.goto(this.game.settingsFactory(() => new TitleScene(this.game))) });
    items.push({ label: 'CONTROLS', onSelect: () => (this.panel = 'controls') });
    items.push({ label: 'CREDITS', onSelect: () => (this.panel = 'credits') });
    this.menu = new ListMenu('', items, null, { x: W / 2 - 90, y: 150, w: 180, rows: 6, accent: '#ff3fa4' });
  }

  private saveSummary(): string {
    const p = this.game.store.loadProfile();
    const clears = Object.values(p.cleared).filter((c) => c.clears > 0).length;
    return `LV ${p.level} • ${clears}/5 WORLDS • ${p.floppies.length}/15 DISKS • ${p.bits} BITS`;
  }

  enter(): void {
    this.game.music('title');
  }

  private newGame(): void {
    this.game.profile = defaultProfile();
    this.game.saveProfile();
    this.game.goto(this.game.hubFactory(), { title: 'CHAOS.EXE', sub: 'LOADING THE MULTIVERSE...', color: '#ff3fa4' });
  }
  private continueGame(): void {
    this.game.profile = this.game.store.loadProfile();
    this.game.goto(this.game.hubFactory());
  }

  tap(x: number, y: number): boolean {
    if (this.panel === 'menu') {
      // The first tap only starts the music, like pressing any key.
      if (!this.started) {
        this.started = true;
        this.game.audio.unlock();
        this.game.music('title');
      } else this.menu.tap(x, y, this.game);
      return true;
    }
    return false;
  }

  update(dt: number): void {
    this.t += dt;
    const inp = this.game.input;
    if (inp.anyKeyThisFrame && !this.started) {
      this.started = true;
      this.game.audio.unlock();
      this.game.music('title');
    }
    // Secret: type GOODBOY on the title screen.
    if (inp.typed) {
      this.code = (this.code + inp.typed).slice(-7);
      if (this.code === 'GOODBOY') {
        const p = this.game.store.hasProfile() ? this.game.store.loadProfile() : defaultProfile();
        if (!p.secretUnlocked) {
          p.secretUnlocked = true;
          if (!p.achievements.includes('secret')) p.achievements.push('secret');
          this.game.store.saveProfile(p);
          this.game.profile = p;
          this.game.toast('SECRET UNLOCKED', 'DEMO THE DOG WAITS IN THE LOBBY', '#c98b4a');
          this.game.audio.sfx('bark');
          this.build();
        }
      }
    }
    if (this.panel === 'menu') this.menu.update(this.game);
    else if (this.panel === 'confirmNew') {
      if (inp.pressed('confirm')) this.newGame();
      else if (inp.pressed('back')) this.panel = 'menu';
    } else if (inp.pressed('back') || inp.pressed('confirm')) {
      this.panel = 'menu';
      this.game.audio.sfx('back');
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const t = this.t;
    // Background: a stack of genre "cartridges" scrolling in a CRT-blue void
    backdrop(ctx, '#05020d', '#1d0f33');
    glow(ctx, W / 2, 70, 190, '255,63,164', 0.22 + Math.sin(t * 1.5) * 0.04);
    glow(ctx, W / 2, 210, 150, '63,224,255', 0.12);
    for (let i = 0; i < 12; i++) {
      const y = ((i * 31 + t * 18) % (H + 40)) - 40;
      const x = (i * 97) % W;
      const cols = ['#ffcf3f', '#3fe0ff', '#b3122e', '#ff6f3f', '#ff3fd2', '#7dff6b'];
      ctx.globalAlpha = 0.18;
      rect(ctx, x, y, 34, 26, cols[i % cols.length]);
      rect(ctx, x + 4, y + 4, 26, 12, '#000');
      ctx.globalAlpha = 1;
    }
    // Perspective grid floor, fading out toward the horizon
    backdrop(ctx, 'rgba(255,63,164,0.18)', 'rgba(255,63,164,0)', 205, 20);
    for (let i = 0; i < 12; i++) {
      const y = 210 + i * i * 0.6 + ((t * 20) % 10) * (i / 12);
      rect(ctx, 0, y, W, 1, '#ff3fa455');
    }
    for (let i = -10; i <= 10; i++) {
      ctx.strokeStyle = '#ff3fa433';
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * 10, 210);
      ctx.lineTo(W / 2 + i * 60, H);
      ctx.stroke();
    }
    // Logo with chromatic glitch
    const gl = Math.sin(t * 7) > 0.92 ? 3 : 0;
    drawText(ctx, 'CHAOS.EXE', W / 2 - gl, 36, '#3fe0ff', { align: 'center', scale: 6, shadow: null });
    drawText(ctx, 'CHAOS.EXE', W / 2 + gl, 36, '#ff3fa4', { align: 'center', scale: 6, shadow: null });
    drawText(ctx, 'CHAOS.EXE', W / 2, 34, '#fff', { align: 'center', scale: 6, shadow: '#1d1233' });
    drawText(ctx, 'THE 90S GAMING MULTIVERSE', W / 2, 84, '#ffcf3f', { align: 'center', scale: 2 });
    // Cast parade
    const y = 140;
    drawCass(ctx, { x: 70, y, facing: 1, pose: 'run', t, scale: 2 });
    drawByte(ctx, 104, y, t, 4);
    drawManual(ctx, 396, y - 10, t);
    drawKevin(ctx, 430, y, t, -1);
    drawRex(ctx, 40, y, t, 1);
    drawPolygon(ctx, 450, y + 2, t);

    if (this.panel === 'menu') {
      this.menu.draw(ctx, t);
      if (!this.started && Math.floor(t * 2) % 2) drawText(ctx, 'PRESS ANY KEY', W / 2, 136, '#fff', { align: 'center' });
    } else if (this.panel === 'confirmNew') {
      frame(ctx, W / 2 - 130, 150, 260, 54, '#1d1233', '#ff6f3f');
      drawText(ctx, 'START OVER? YOUR SAVE WILL BE ERASED.', W / 2, 162, '#ff6f3f', { align: 'center' });
      drawText(ctx, 'CONFIRM = YES   BACK = NO', W / 2, 182, '#fff', { align: 'center' });
    } else if (this.panel === 'controls') this.drawControls(ctx);
    else this.drawCredits(ctx);
    drawText(ctx, 'V1.0 • ORIGINAL GAME • MIT LICENSE', W / 2, H - 10, '#ffffff55', { align: 'center', shadow: null });
  }

  private drawControls(ctx: CanvasRenderingContext2D): void {
    const b = this.game.input.bindings;
    const k = (a: keyof typeof b) => b[a].map(keyLabel).join('/');
    frame(ctx, 30, 100, W - 60, 160, '#0b0716f0', '#3fe0ff');
    const lines: Array<[string, string]> = [
      ['MOVE', `${k('left')} ${k('right')} ${k('up')} ${k('down')}`],
      ['JUMP / BOOST / INTERACT', k('jump')],
      ['ATTACK / RUN (MALL)', k('attack')],
      ['SPECIAL (BLASTER, DRIFT, BARK)', k('special')],
      ['BLOCK (FIGHTER)', k('down')],
      ['PAUSE', k('pause')],
      ['MENUS', `ARROWS + ${k('confirm')} / ${k('back')}`],
    ];
    lines.forEach(([a, v], i) => {
      drawText(ctx, a, 44, 112 + i * 14, '#ffcf3f');
      drawText(ctx, v.slice(0, 34), W - 44, 112 + i * 14, '#fff', { align: 'right' });
    });
    drawText(ctx, 'EVERY KEY CAN BE REMAPPED IN SETTINGS. TOUCH BUTTONS APPEAR ON TOUCHSCREENS.', W / 2, 220, '#9a9ab8', { align: 'center' });
    drawText(ctx, 'EACH WORLD SHOWS ITS OWN CONTROLS WHEN IT STARTS.', W / 2, 232, '#9a9ab8', { align: 'center' });
  }

  private drawCredits(ctx: CanvasRenderingContext2D): void {
    frame(ctx, 20, 96, W - 40, 166, '#0b0716f0', '#ff3fa4');
    const rows = [
      'CHAOS.EXE: THE 90S GAMING MULTIVERSE — AN ORIGINAL GAME',
      'CODE, DESIGN, PIXELS & SYNTH MUSIC: GENERATED AT RUNTIME',
      'NO EXTERNAL ASSETS: EVERY SPRITE IS RECTANGLES, EVERY SONG IS MATH',
      '',
      ...Object.values(CAST).slice(0, 4).map((c) => `${c.name} — ${c.role.toUpperCase()}`),
      ...BOSSES.slice(0, 2).map((b) => `${b.name} — ${b.title.toUpperCase()}`),
      '',
      'BUILT WITH TYPESCRIPT + ESBUILD + HTML5 CANVAS + WEB AUDIO',
      'THANK YOU FOR PLAYING. BLOW ON YOUR CARTRIDGES RESPONSIBLY.',
    ];
    rows.forEach((r, i) => drawText(ctx, r, W / 2, 106 + i * 12, i < 3 ? '#ffcf3f' : '#ddd', { align: 'center' }));
  }
}
