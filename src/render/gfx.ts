/** Canvas helpers: palettes, particles, popups, screen FX and small widgets. */
import { drawText } from './font.ts';

export const W = 480;
export const H = 270;

export interface Palette {
  name: string;
  bg0: string;
  bg1: string;
  bg2: string;
  fg: string;
  accent: string;
  accent2: string;
  danger: string;
  good: string;
}

export const PAL = {
  hub: { name: 'LOBBY', bg0: '#0b0716', bg1: '#1d1233', bg2: '#33205a', fg: '#f4eefe', accent: '#ff3fa4', accent2: '#3fe0ff', danger: '#ff4545', good: '#7dff6b' },
  rampage: { name: 'PLATFORMER', bg0: '#3a5bd9', bg1: '#6ea0ff', bg2: '#bfe3ff', fg: '#fff8e0', accent: '#ffcf3f', accent2: '#ff6f3f', danger: '#e8203a', good: '#4fe07a' },
  shmup: { name: 'SHMUP', bg0: '#05030f', bg1: '#140a33', bg2: '#2b1866', fg: '#e8f0ff', accent: '#3fffcf', accent2: '#ff3fd2', danger: '#ff3f3f', good: '#9dff3f' },
  neon: { name: 'RACING', bg0: '#12002b', bg1: '#3b0a6b', bg2: '#ff3fa4', fg: '#fdf6ff', accent: '#3fe0ff', accent2: '#ffe23f', danger: '#ff3f5a', good: '#5cff9d' },
  horror: { name: 'SURVIVAL HORROR', bg0: '#050405', bg1: '#141012', bg2: '#2a2124', fg: '#d8cfc4', accent: '#c9a227', accent2: '#6b8f71', danger: '#b3122e', good: '#8fbf6b' },
  fighter: { name: 'FIGHTER', bg0: '#2b0f0f', bg1: '#6b2a1a', bg2: '#d9773f', fg: '#fff3e0', accent: '#ffd23f', accent2: '#3fa9ff', danger: '#ff2b2b', good: '#6bff6b' },
  rhythm: { name: 'RHYTHM', bg0: '#0a0420', bg1: '#250a4a', bg2: '#5a1ab3', fg: '#ffffff', accent: '#ff3fd2', accent2: '#3fffe0', danger: '#ff3f3f', good: '#d6ff3f' },
  command: { name: 'STRATEGY', bg0: '#06140c', bg1: '#0f2e1e', bg2: '#1f5a3a', fg: '#e8fff0', accent: '#7dff6b', accent2: '#3fe0ff', danger: '#ff3f5a', good: '#7dff6b' },
  bullet: { name: 'BULLET HELL', bg0: '#000010', bg1: '#0c0c3a', bg2: '#30307a', fg: '#ffffff', accent: '#ff7af5', accent2: '#7affff', danger: '#ff3355', good: '#aaff66' },
} satisfies Record<string, Palette>;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  grav: number;
  alive: boolean;
}

/** Fixed-size particle pool; cosmetic only, so it uses Math.random. */
export class Particles {
  private pool: Particle[] = [];
  private next = 0;

  constructor(size = 600) {
    for (let i = 0; i < size; i++) this.pool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, color: '#fff', size: 1, grav: 0, alive: false });
  }

  emit(x: number, y: number, count: number, color: string, speed = 60, life = 0.6, size = 2, grav = 120): void {
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s - speed * 0.3;
      p.life = life * (0.5 + Math.random() * 0.5);
      p.max = p.life;
      p.color = color;
      p.size = size;
      p.grav = grav;
      p.alive = true;
    }
  }

  burst(x: number, y: number, colors: string[], count = 24, speed = 120): void {
    for (const c of colors) this.emit(x, y, Math.ceil(count / colors.length), c, speed, 0.8, 2, 80);
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, camX = 0, camY = 0): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      const a = Math.min(1, (p.life / p.max) * 1.5);
      ctx.fillStyle = p.color;
      const s = p.size;
      const px = Math.round(p.x - camX - s / 2);
      const py = Math.round(p.y - camY - s / 2);
      // Additive halo makes bursts read as light rather than flat squares.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.25;
      ctx.fillRect(px - 1, py - 1, s + 2, s + 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a;
      ctx.fillRect(px, py, s, s);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
  alive: boolean;
}

/** Floating "+N" style text. */
export class Popups {
  private pool: Popup[] = Array.from({ length: 40 }, () => ({ x: 0, y: 0, text: '', color: '#fff', t: 0, alive: false }));
  private i = 0;

  add(x: number, y: number, text: string, color = '#fff'): void {
    const p = this.pool[this.i];
    this.i = (this.i + 1) % this.pool.length;
    Object.assign(p, { x, y, text, color, t: 0, alive: true });
  }

  update(dt: number): void {
    for (const p of this.pool) if (p.alive && (p.t += dt) > 1.1) p.alive = false;
  }

  draw(ctx: CanvasRenderingContext2D, camX = 0, camY = 0): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      ctx.globalAlpha = p.t > 0.8 ? (1.1 - p.t) / 0.3 : 1;
      drawText(ctx, p.text, p.x - camX, p.y - camY - p.t * 20, p.color, { align: 'center' });
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }
}

/** Screen shake, colour flash and hit-stop. */
export class ScreenFx {
  shakeAmt = 0;
  flashA = 0;
  flashColor = '#fff';
  hitstop = 0;
  shakeScale = 1;
  private shakeT = 0;
  reducedFlash = false;

  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount * this.shakeScale);
  }
  flash(color: string, alpha = 0.6): void {
    this.flashColor = color;
    this.flashA = Math.max(this.flashA, this.reducedFlash ? Math.min(alpha, 0.15) : alpha);
  }
  freeze(seconds: number): void {
    this.hitstop = Math.max(this.hitstop, seconds);
  }
  update(dt: number): void {
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 40);
    this.flashA = Math.max(0, this.flashA - dt * (this.reducedFlash ? 1 : 3));
  }
  offset(): [number, number] {
    if (this.shakeAmt <= 0.01) return [0, 0];
    // Damped oscillation instead of per-frame random jumps: reads as impact, not jitter.
    const a = Math.min(this.shakeAmt, 8) * 0.55;
    this.shakeT += 1;
    return [Math.round(Math.sin(this.shakeT * 1.9) * a), Math.round(Math.cos(this.shakeT * 2.3) * a * 0.6)];
  }
  drawFlash(ctx: CanvasRenderingContext2D): void {
    if (this.flashA <= 0.01) return;
    ctx.globalAlpha = this.flashA;
    ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  reset(): void {
    this.shakeAmt = 0;
    this.flashA = 0;
    this.hitstop = 0;
  }
}

let crtLayer: HTMLCanvasElement | null = null;

/**
 * In-canvas CRT touch: a soft corner vignette and a faint phosphor warmth.
 * Scanlines are drawn by the page at display resolution (see #crt in index.html),
 * so they stay even at every window size.
 */
export function drawCRT(ctx: CanvasRenderingContext2D, strength: number): void {
  if (strength <= 0) return;
  if (!crtLayer) {
    crtLayer = document.createElement('canvas');
    crtLayer.width = W;
    crtLayer.height = H;
    const g = crtLayer.getContext('2d')!;
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.95);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  }
  ctx.globalAlpha = Math.min(1, strength * 1.6);
  ctx.drawImage(crtLayer, 0, 0);
  ctx.globalAlpha = 1;
}

/** Vertical two-stop gradient fill of the whole screen (or a band). */
export function backdrop(ctx: CanvasRenderingContext2D, top: string, bottom: string, y = 0, h = H): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, y, W, h);
}

/** Soft additive light pool; `color` is "r,g,b". */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha = 0.35): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, `rgba(${color},${alpha})`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalCompositeOperation = 'source-over';
}

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Bordered panel with a faint top highlight. */
export function frame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, border: string): void {
  // Soft drop shadow, then border, fill, a top highlight and a bottom inner shade.
  rect(ctx, x + 2, y + 3, w, h, 'rgba(0,0,0,0.35)');
  rect(ctx, x, y, w, h, border);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, fill);
  rect(ctx, x + 2, y + 2, w - 4, 1, 'rgba(255,255,255,0.12)');
  rect(ctx, x + 1, y + h - 3, w - 2, 2, 'rgba(0,0,0,0.22)');
}

export function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, fill: string, back = '#000', border = '#fff'): void {
  rect(ctx, x - 1, y - 1, w + 2, h + 2, border);
  rect(ctx, x, y, w, h, back);
  rect(ctx, x, y, Math.max(0, Math.min(1, frac)) * w, h, fill);
}

export function hearts(ctx: CanvasRenderingContext2D, x: number, y: number, hp: number, max: number): void {
  for (let i = 0; i < max; i++) drawText(ctx, '♥', x + i * 7, y, i < hp ? '#ff3f6b' : '#40303a');
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Moves `v` toward `target` by at most `step`. */
export function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}
