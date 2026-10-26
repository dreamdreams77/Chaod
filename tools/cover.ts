/**
 * Cover-art title overlay: drop in an AI-generated picture, cover its (usually misspelled) sign with
 * the game's own pixel font and download the result. Built into tools/cover.html by tools/cover.mjs.
 */
import { drawText, textWidth } from '../src/render/font.ts';

interface Opts {
  title: string; sub: string;
  x: number; y: number; w: number; h: number;
  scale: number; subScale: number;
  title1: string; panel: string; border: string; sub1: string;
  labels: string;
}
const DEFAULTS: Opts = {
  title: 'CHAOS.EXE', sub: '', x: 222, y: 166, w: 196, h: 68, scale: 4, subScale: 1,
  title1: '#ffe23f', panel: '#1a0b3a', border: '#ff3fa4', sub1: '#3fe0ff', labels: '',
};
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const ctx = canvas.getContext('2d')!;
let img: HTMLImageElement | null = null;
const o: Opts = { ...DEFAULTS };

function draw(): void {
  if (!img) { ctx.fillStyle = '#05020d'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  // panel with a neon border and glow
  ctx.save();
  ctx.shadowColor = o.border; ctx.shadowBlur = 14;
  ctx.fillStyle = o.panel; ctx.fillRect(o.x, o.y, o.w, o.h);
  ctx.restore();
  ctx.strokeStyle = o.border; ctx.lineWidth = 3; ctx.strokeRect(o.x + 1.5, o.y + 1.5, o.w - 3, o.h - 3);
  ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 1; ctx.strokeRect(o.x + 5.5, o.y + 5.5, o.w - 11, o.h - 11);
  const cx = o.x + o.w / 2;
  const lineH = 7 * o.scale;
  const subH = o.sub ? 7 * o.subScale + 6 : 0;
  const top = o.y + (o.h - lineH - subH) / 2;
  let s = o.scale;
  while (s > 1 && textWidth(o.title, s) > o.w - 14) s--; // shrink to fit the panel
  drawText(ctx, o.title, cx, top + (lineH - 7 * s) / 2, o.title1, { align: 'center', scale: s, shadow: '#7a1a5a' });
  if (o.sub) drawText(ctx, o.sub, cx, top + lineH + 6, o.sub1, { align: 'center', scale: o.subScale });
  // free labels: one per line as  x,y,scale,TEXT
  for (const line of o.labels.split('\n')) {
    const m = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,(.+)$/.exec(line);
    if (m) drawText(ctx, m[4].trim().toUpperCase(), +m[1], +m[2], '#ffffff', { align: 'center', scale: +m[3] });
  }
}

for (const k of Object.keys(DEFAULTS) as Array<keyof Opts>) {
  const el = $<HTMLInputElement>(k);
  el.value = String(DEFAULTS[k]);
  el.addEventListener('input', () => { (o as unknown as Record<string, string | number>)[k] = typeof DEFAULTS[k] === 'number' ? Number(el.value) : el.value; draw(); });
}
function load(file: File): void {
  const i = new Image();
  i.onload = () => { img = i; canvas.width = i.width; canvas.height = i.height; draw(); };
  i.src = URL.createObjectURL(file);
}
$<HTMLInputElement>('file').addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) load(f); });
document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f) load(f); });
$('save').addEventListener('click', () => { const a = document.createElement('a'); a.download = 'chaos-exe-cover.png'; a.href = canvas.toDataURL('image/png'); a.click(); });
(window as unknown as { __cover: unknown }).__cover = { load: (url: string) => { const i = new Image(); i.onload = () => { img = i; canvas.width = i.width; canvas.height = i.height; draw(); }; i.src = url; }, set: (k: keyof Opts, v: string | number) => { (o as unknown as Record<string, string | number>)[k] = v; draw(); } };
draw();
