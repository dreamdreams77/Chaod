/** A small keyboard-driven list menu shared by the title screen, settings and hub kiosks. */
import type { Game } from '../game.ts';
import { frame, rect } from '../render/gfx.ts';
import { drawText, wrap } from '../render/font.ts';

export interface MenuItem {
  label: string;
  /** Right-aligned value text (for settings). */
  value?: () => string;
  sub?: string;
  disabled?: boolean;
  color?: string;
  onSelect?: () => void;
  /** Left/right adjustment (settings sliders, toggles). */
  onAdjust?: (dir: number) => void;
}

export class ListMenu {
  index = 0;
  scroll = 0;
  /** Where the menu was last drawn, so taps can be mapped to rows. */
  private geom: { x: number; y: number; w: number; h: number; count: number } | null = null;
  constructor(
    public title: string,
    public items: MenuItem[],
    public onBack: (() => void) | null = null,
    public opts: { x?: number; y?: number; w?: number; rows?: number; accent?: string; footer?: string } = {},
  ) {
    this.skipDisabled(1);
  }

  private skipDisabled(dir: number): void {
    for (let i = 0; i < this.items.length && this.items[this.index]?.disabled; i++) this.index = (this.index + dir + this.items.length) % this.items.length;
  }

  update(game: Game): void {
    const inp = game.input;
    const n = this.items.length;
    if (n === 0) {
      if (inp.pressed('back') || inp.pressed('confirm')) this.onBack?.();
      return;
    }
    if (inp.pressed('up')) {
      this.index = (this.index - 1 + n) % n;
      this.skipDisabled(-1);
      game.audio.sfx('select');
    }
    if (inp.pressed('down')) {
      this.index = (this.index + 1) % n;
      this.skipDisabled(1);
      game.audio.sfx('select');
    }
    const it = this.items[this.index];
    if (it?.onAdjust) {
      if (inp.pressed('left')) { it.onAdjust(-1); game.audio.sfx('select'); }
      if (inp.pressed('right')) { it.onAdjust(1); game.audio.sfx('select'); }
    }
    if (inp.pressed('confirm') && it && !it.disabled) {
      if (it.onSelect) {
        game.audio.sfx('confirm');
        it.onSelect();
      } else if (it.onAdjust) it.onAdjust(1);
    } else if (inp.pressed('back') && this.onBack) {
      game.audio.sfx('back');
      this.onBack();
    }
  }

  /**
   * Touch/mouse support. Tapping a row selects it; tapping the selected row activates it
   * (sliders and toggles adjust left or right by which half you tap). Tapping outside the
   * panel goes back; tapping the title strip or footer pages up or down. Returns true if handled.
   */
  tap(px: number, py: number, game: Game): boolean {
    const g = this.geom;
    if (!g) return false;
    const rows = this.opts.rows ?? 12;
    if (px < g.x || px > g.x + g.w || py < g.y || py > g.y + g.h) {
      if (!this.onBack) return false;
      game.audio.sfx('back');
      this.onBack();
      return true;
    }
    const n = this.items.length;
    if (n === 0) return true;
    const rel = Math.floor((py - (g.y + 21)) / 13);
    if (rel < 0) {
      this.index = Math.max(0, this.index - rows);
      game.audio.sfx('select');
      return true;
    }
    if (rel >= g.count) {
      this.index = Math.min(n - 1, this.index + rows);
      game.audio.sfx('select');
      return true;
    }
    const idx = this.scroll + rel;
    const it = this.items[idx];
    if (!it || it.disabled) return true; // info rows are not selectable by touch
    if (idx !== this.index) {
      this.index = idx;
      game.audio.sfx('select');
      return true;
    }
    if (it.disabled) return true;
    if (it.onAdjust && !it.onSelect) {
      it.onAdjust(px < g.x + g.w / 2 ? -1 : 1);
      game.audio.sfx('select');
    } else if (it.onSelect) {
      game.audio.sfx('confirm');
      it.onSelect();
    } else if (it.onAdjust) it.onAdjust(1);
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, t: number): void {
    const x = this.opts.x ?? 90;
    const y = this.opts.y ?? 40;
    const w = this.opts.w ?? 300;
    const rows = this.opts.rows ?? 12;
    const accent = this.opts.accent ?? '#3fe0ff';
    if (this.index < this.scroll) this.scroll = this.index;
    if (this.index >= this.scroll + rows) this.scroll = this.index - rows + 1;
    const visible = this.items.slice(this.scroll, this.scroll + rows);
    const hasSub = !!this.opts.footer || this.items.some((i) => i.sub);
    const h = 24 + visible.length * 13 + (hasSub ? 26 : 6);
    this.geom = { x, y, w, h, count: visible.length };
    frame(ctx, x, y, w, h, '#0b0716f0', accent);
    drawText(ctx, this.title, x + w / 2, y + 7, accent, { align: 'center' });
    rect(ctx, x + 8, y + 17, w - 16, 1, accent + '66');
    visible.forEach((it, i) => {
      const idx = i + this.scroll;
      const sel = idx === this.index;
      const yy = y + 23 + i * 13;
      if (sel) rect(ctx, x + 4, yy - 2, w - 8, 11, '#ffffff14');
      const col = it.disabled ? it.color ?? '#555' : sel ? '#ffcf3f' : it.color ?? '#ddd';
      drawText(ctx, (sel ? (Math.floor(t * 4) % 2 ? '▶' : ' ') : ' ') + ' ' + it.label, x + 8, yy, col);
      if (it.value) {
        const v = it.value();
        drawText(ctx, it.onAdjust && sel ? `◀ ${v} ▶` : v, x + w - 10, yy, sel ? '#fff' : '#9a9ab8', { align: 'right' });
      }
    });
    if (this.scroll > 0) drawText(ctx, '↑', x + w - 10, y + 7, accent);
    if (this.scroll + rows < this.items.length) drawText(ctx, '↓', x + w - 10, y + h - 10, accent);
    const sub = this.items[this.index]?.sub ?? this.opts.footer;
    if (sub) {
      const lines = wrap(sub, Math.floor((w - 16) / 6)).slice(0, 2);
      lines.forEach((l, i) => drawText(ctx, l, x + 8, y + h - 22 + i * 9, '#9a9ab8'));
    }
  }
}
