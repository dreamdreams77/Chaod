/** The perk pick that comes before a run (and before every ENDLESS round): one of three, or skip. */
import type { Game, Scene } from '../game.ts';
import { PerkDef, PerkRarity } from '../data/perks.ts';
import { MODE_INFO } from '../data/story.ts';
import type { ModeId } from '../core/save.ts';
import { H, W, PAL, backdrop, frame, glow, rect } from '../render/gfx.ts';
import { drawText, wrap } from '../render/font.ts';

const COLORS: Record<PerkRarity, string> = { common: '#3fe0ff', rare: '#ffcf3f', cursed: '#ff3f6b' };
const CARD_W = 140;
const CARD_X = [20, 170, 320];
const CARD_Y = 70;
const CARD_H = 112;

export class PerkScene implements Scene {
  id = 'perks';
  crt = 0.3;
  private t = 0;
  /** 0-2 are the cards, 3 is SKIP. */
  private sel = 1;
  private done = false;

  constructor(
    private game: Game,
    private mode: ModeId,
    private offers: PerkDef[],
    private held: PerkDef[],
    private round: number,
    private pick: (perkId: string | null) => void,
  ) {
    this.sel = offers.length > 1 ? 1 : 0;
  }

  enter(): void {
    this.game.music('hub');
  }

  private choose(i: number): void {
    if (this.done || this.t < 0.35) return;
    this.done = true;
    this.game.audio.sfx(i < this.offers.length ? 'powerup' : 'back');
    this.pick(i < this.offers.length ? this.offers[i].id : null);
  }

  tap(x: number, y: number): boolean {
    if (this.t < 0.35) return true;
    for (let i = 0; i < this.offers.length; i++) {
      if (x >= CARD_X[i] && x <= CARD_X[i] + CARD_W && y >= CARD_Y && y <= CARD_Y + CARD_H) {
        if (this.sel === i) this.choose(i);
        else {
          this.sel = i;
          this.game.audio.sfx('select');
        }
        return true;
      }
    }
    if (y >= 196 && y <= 220 && x >= W / 2 - 60 && x <= W / 2 + 60) {
      if (this.sel === this.offers.length) this.choose(this.offers.length);
      else {
        this.sel = this.offers.length;
        this.game.audio.sfx('select');
      }
    }
    return true;
  }

  update(dt: number): void {
    this.t += dt;
    const inp = this.game.input;
    const n = this.offers.length;
    if (inp.pressed('left') && this.sel > 0 && this.sel <= n - 1 + 0) {
      this.sel--;
      this.game.audio.sfx('select');
    } else if (inp.pressed('right') && this.sel < n - 1) {
      this.sel++;
      this.game.audio.sfx('select');
    } else if (inp.pressed('down') && this.sel < n) {
      this.sel = n;
      this.game.audio.sfx('select');
    } else if (inp.pressed('up') && this.sel === n) {
      this.sel = Math.min(1, n - 1);
      this.game.audio.sfx('select');
    }
    if (inp.pressed('confirm') || inp.pressed('jump')) this.choose(this.sel);
    else if (inp.pressed('back') || inp.pressed('pause')) this.choose(n);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    backdrop(ctx, '#05020d', PAL.hub.bg1);
    glow(ctx, W / 2, 110, 240, '255,63,164', 0.12);
    const info = MODE_INFO[this.mode];
    drawText(ctx, this.round > 1 ? `ROUND ${this.round}: PICK A PERK` : 'PICK A PERK', W / 2, 16, '#ffcf3f', { align: 'center', scale: 2 });
    drawText(ctx, info.title, W / 2, 40, info.color, { align: 'center' });
    drawText(ctx, 'Perks last for this run only.', W / 2, 52, '#9a9ab8', { align: 'center' });
    this.offers.forEach((p, i) => {
      const sel = i === this.sel;
      const x = CARD_X[i];
      const y = CARD_Y - (sel ? 4 : 0);
      const c = COLORS[p.rarity];
      frame(ctx, x, y, CARD_W, CARD_H, sel ? '#241a42' : '#150d2a', sel ? c : '#3a3050');
      rect(ctx, x + 2, y + 2, CARD_W - 4, 12, c + (sel ? 'cc' : '55'));
      drawText(ctx, p.rarity.toUpperCase(), x + CARD_W / 2, y + 4, '#05020d', { align: 'center', shadow: null });
      drawText(ctx, p.name, x + CARD_W / 2, y + 22, '#fff', { align: 'center' });
      wrap(p.desc, 21).slice(0, 6).forEach((line, k) => drawText(ctx, line, x + 8, y + 40 + k * 10, '#d8d0f0'));
    });
    const skipSel = this.sel === this.offers.length;
    frame(ctx, W / 2 - 60, 196, 120, 24, skipSel ? '#2a2050' : '#0b0716', skipSel ? '#3fe0ff' : '#3a3050');
    drawText(ctx, (skipSel ? '▶ ' : '') + 'SKIP', W / 2, 204, skipSel ? '#fff' : '#9a9ab8', { align: 'center' });
    if (this.held.length) drawText(ctx, `HELD: ${this.held.map((p) => p.name).join(', ')}`.slice(0, 64), W / 2, 230, '#7dff6b', { align: 'center' });
    drawText(ctx, this.game.input.label('ARROWS CHOOSE • Z PICK • X SKIP'), W / 2, H - 14, '#9a9ab8', { align: 'center' });
  }
}
