/** Pixel-art characters and pickups, drawn from rectangles. */
import { rect as r } from './gfx.ts';
import type { Look } from '../data/cosmetics.ts';

/** The player's chosen outfit and hat; set by the game whenever the wardrobe changes. */
let look: Look = { hair: '#ff3fa4', shirt: '#20c4b0', pants: '#3346a8' };
let hat = 'none';
export function setLook(l: Look, h: string): void {
  look = l;
  hat = h;
}

export type Pose = 'idle' | 'run' | 'jump' | 'attack' | 'special' | 'block' | 'hurt' | 'dizzy';
export type PortraitId = 'cass' | 'demo' | 'manual' | 'kevin' | 'rex' | 'polygon' | 'byte' | 'brick' | 'static' | 'manager' | 'core';

export interface Actor {
  x: number;
  y: number;
  facing: number;
  pose: Pose;
  t: number;
  flash?: boolean;
  scale?: number;
  squash?: number;
}

/** Runs `body` in actor-local coordinates (feet at origin, facing mirrored). */
function withActor(ctx: CanvasRenderingContext2D, a: Actor, body: () => void): void {
  ctx.save();
  ctx.translate(Math.round(a.x), Math.round(a.y));
  const s = a.scale ?? 1;
  const sq = a.squash ?? 1;
  ctx.scale((a.facing * s) / Math.sqrt(sq), s * sq);
  // Soft contact shadow; shrinks while airborne so jumps read clearly.
  const air = a.pose === 'jump' ? 0.6 : 1;
  const baseAlpha = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha * 0.28 * air;
  r(ctx, -6 * air, -1, 12 * air, 2, '#000');
  r(ctx, -4 * air, 0, 8 * air, 2, '#000');
  ctx.globalAlpha = baseAlpha;
  // A hard 1px offset shadow behind every limb reads as an outline and lifts the sprite off busy backdrops.
  ctx.shadowColor = 'rgba(8,4,16,0.75)';
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.shadowBlur = 0;
  body();
  ctx.restore();
}

export function drawCass(ctx: CanvasRenderingContext2D, a: Actor, who: 'cass' | 'demo' = 'cass'): void {
  if (who === 'demo') return drawDemo(ctx, a);
  const f = a.flash;
  const skin = f ? '#fff' : '#f2c49b';
  const hair = f ? '#fff' : look.hair;
  const shirt = f ? '#fff' : look.shirt;
  const pants = f ? '#fff' : look.pants;
  const shoe = '#ffffff';
  withActor(ctx, a, () => {
    const running = a.pose === 'run';
    const step = Math.floor(a.t * 12) % 4;
    const leg = running ? [0, 2, 0, -2][step] : 0;
    const bob = running ? (step % 2 === 0 ? -1 : 0) : a.pose === 'idle' ? (Math.floor(a.t * 2) % 2 ? 0 : -1) : 0;
    if (a.pose === 'jump') {
      r(ctx, -4, -6, 3, 4, pants);
      r(ctx, 1, -7, 3, 4, pants);
      r(ctx, -5, -3, 4, 2, shoe);
      r(ctx, 1, -4, 4, 2, shoe);
    } else {
      r(ctx, -4 + leg, -6, 3, 5, pants);
      r(ctx, 1 - leg, -6, 3, 5, pants);
      r(ctx, -5 + leg, -2, 4, 2, shoe);
      r(ctx, 1 - leg, -2, 4, 2, shoe);
    }
    r(ctx, -5, -13 + bob, 10, 8, shirt);
    r(ctx, -1, -12 + bob, 2, 6, '#fff3');
    if (a.pose === 'attack' || a.pose === 'special') {
      r(ctx, 4, -11 + bob, 7, 3, shirt);
      r(ctx, 10, -11 + bob, 2, 3, skin);
    } else if (a.pose === 'block') {
      r(ctx, 3, -14 + bob, 3, 7, shirt);
      r(ctx, 5, -15 + bob, 3, 3, skin);
    } else {
      const swing = running ? [1, 0, -1, 0][step] : 0;
      r(ctx, -7, -12 + bob + swing, 2, 6, shirt);
      r(ctx, 5, -12 + bob - swing, 2, 6, shirt);
    }
    // Form shading: the shirt and face are darker on the side away from the light.
    if (!f) {
      r(ctx, 3, -13 + bob, 2, 8, 'rgba(0,0,0,0.18)');
      r(ctx, -5, -6 + bob, 10, 1, 'rgba(0,0,0,0.2)');
    }
    r(ctx, -4, -20 + bob, 8, 7, skin);
    if (!f) r(ctx, 2, -19 + bob, 2, 5, 'rgba(120,50,40,0.18)');
    r(ctx, -5, -22 + bob, 10, 4, hair);
    if (!f) r(ctx, -3, -22 + bob, 4, 1, 'rgba(255,255,255,0.35)');
    r(ctx, -6, -20 + bob, 3, 6, hair);
    r(ctx, 1, -18 + bob, 2, 2, a.pose === 'hurt' || a.pose === 'dizzy' ? '#000' : '#1a1a2e');
    r(ctx, -5, -23 + bob, 10, 1, '#222');
    r(ctx, -6, -19 + bob, 2, 4, '#ffcf3f');
    // Hat sits on top of the hair; it is skipped on the hit-flash frame so the flash stays solid white.
    if (!f) drawHat(ctx, bob, a.t);
    if (a.pose === 'dizzy') r(ctx, -3, -26 + bob + Math.sin(a.t * 10), 2, 2, '#ffcf3f');
  });
}

function drawHat(ctx: CanvasRenderingContext2D, bob: number, t: number): void {
  switch (hat) {
    case 'cap':
      r(ctx, -5, -25 + bob, 10, 3, '#ff3f3f');
      r(ctx, 3, -23 + bob, 5, 1, '#b02020');
      r(ctx, -1, -26 + bob, 3, 1, '#ff3f3f');
      break;
    case 'antenna':
      r(ctx, 0, -29 + bob, 1, 6, '#9a9ab8');
      r(ctx, -1, -31 + bob, 3, 2, Math.floor(t * 3) % 2 ? '#3fe0ff' : '#ff3fa4');
      break;
    case 'halo':
      r(ctx, -4, -28 + bob + Math.round(Math.sin(t * 3)), 8, 1, '#fff3a0');
      r(ctx, -5, -27 + bob + Math.round(Math.sin(t * 3)), 1, 1, '#ffcf3f');
      r(ctx, 4, -27 + bob + Math.round(Math.sin(t * 3)), 1, 1, '#ffcf3f');
      break;
    case 'crown':
      r(ctx, -4, -27 + bob, 8, 4, '#ffd23f');
      r(ctx, -4, -29 + bob, 2, 2, '#ffd23f');
      r(ctx, -1, -30 + bob, 2, 3, '#ffd23f');
      r(ctx, 2, -29 + bob, 2, 2, '#ffd23f');
      r(ctx, -1, -25 + bob, 2, 2, '#ff3f6b');
      break;
  }
}

/** The secret character: a small dog. */
export function drawDemo(ctx: CanvasRenderingContext2D, a: Actor): void {
  const fur = a.flash ? '#fff' : '#c98b4a';
  withActor(ctx, a, () => {
    const s = Math.floor(a.t * 12) % 2;
    const run = a.pose === 'run';
    r(ctx, -7, -9, 12, 6, fur);
    r(ctx, 3, -14, 7, 7, fur);
    r(ctx, 4, -16, 2, 3, '#7a4a20');
    r(ctx, 8, -11, 2, 2, '#000');
    r(ctx, 9, -9, 3, 2, '#3a2010');
    r(ctx, -10, -11 + (Math.floor(a.t * 8) % 2), 4, 2, fur);
    r(ctx, -6, -3, 2, 3 - (run && s ? 1 : 0), fur);
    r(ctx, 2, -3, 2, 3 - (run && !s ? 1 : 0), fur);
    r(ctx, -2, -9, 4, 2, '#ff3fa4');
  });
}

/** BYTE, the virtual pet; colour tracks bond level. */
export function drawByte(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, bond: number, mood: 'happy' | 'sad' | 'alert' = 'happy'): void {
  const hop = Math.abs(Math.sin(t * 6)) * 3;
  const body = bond >= 4 ? '#7dff6b' : bond >= 2 ? '#3fe0ff' : '#9a9ab8';
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y - hop));
  r(ctx, -5, -8, 10, 8, body);
  r(ctx, -4, -9, 8, 1, body);
  r(ctx, -3, -6, 2, 2, '#000');
  r(ctx, 1, -6, 2, 2, '#000');
  if (mood === 'happy') r(ctx, -2, -3, 4, 1, '#000');
  else if (mood === 'alert') r(ctx, -1, -3, 2, 2, '#000');
  else r(ctx, -2, -2, 4, 1, '#000');
  r(ctx, 0, -12, 1, 3, '#fff');
  r(ctx, -1, -13, 3, 2, bond >= 4 ? '#ffcf3f' : '#ff3fa4');
  ctx.restore();
}

/** The Manual: a haunted instruction booklet. */
export function drawManual(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const yy = Math.round(y + Math.sin(t * 2) * 2);
  r(ctx, x - 8, yy - 22, 16, 20, '#e8e0c8');
  r(ctx, x - 8, yy - 22, 2, 20, '#b03030');
  r(ctx, x - 4, yy - 18, 9, 1, '#555');
  r(ctx, x - 4, yy - 15, 7, 1, '#555');
  r(ctx, x - 4, yy - 12, 9, 1, '#555');
  r(ctx, x + 3, yy - 8, 5, 6, '#0b0716');
  r(ctx, x - 3, yy - 10, 2, 2, '#000');
  r(ctx, x + 2, yy - 10, 2, 2, '#000');
  ctx.globalAlpha = 0.25 + Math.sin(t * 3) * 0.1;
  r(ctx, x - 10, yy - 24, 20, 24, '#3fe0ff');
  ctx.globalAlpha = 1;
}

/** Kevin from QA. `dir` mirrors him. */
export function drawKevin(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, dir = 1): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(dir, 1);
  const a = Math.floor(t * 4) % 2;
  r(ctx, -3, -6, 2, 6 - a, '#444');
  r(ctx, 1, -6, 2, 5 + a, '#444');
  r(ctx, -4, -14, 8, 8, '#d8d8d0');
  r(ctx, -1, -14, 2, 6, '#3fa9ff');
  r(ctx, -3, -20, 6, 6, '#e0b090');
  r(ctx, -3, -21, 6, 2, '#6b4a2a');
  r(ctx, -2, -18, 5, 1, '#000');
  r(ctx, 3, -13, 5, 7, '#a07040');
  r(ctx, 4, -12, 3, 5, '#fff');
  ctx.restore();
}

/** REX TURBO, the rival racer. */
export function drawRex(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, dir = 1): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(dir, 1);
  r(ctx, -3, -6, 2, 6, '#222');
  r(ctx, 1, -6, 2, 6, '#222');
  r(ctx, -5, -14, 10, 8, '#ff6f3f');
  r(ctx, -5, -10, 10, 1, '#fff');
  r(ctx, -5, -22, 10, 8, '#ffe23f');
  r(ctx, -4, -19, 10, 3, Math.floor(t * 3) % 2 ? '#3fe0ff' : '#2aa0c0');
  ctx.restore();
}

/** POLYGON, a wizard made of triangles. */
export function drawPolygon(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  const w = Math.sin(t * 1.5);
  const tri = (color: string, pts: Array<[number, number]>): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fill();
  };
  tri('#7a3fff', [[-9, 0], [9, 0], [0, -16]]);
  tri('#b07aff', [[0, 0], [9, 0], [0, -16]]);
  tri('#ffcf3f', [[-5 * w, -16], [5, -22], [-5, -26], [5 * w, -20]]);
  r(ctx, -2, -12, 1, 1, '#fff');
  r(ctx, 1, -12, 1, 1, '#fff');
  ctx.restore();
}

/** Spinning gold coin ("bit"). */
export function drawBit(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const w = Math.max(1, Math.round(Math.abs(Math.cos(t * 4)) * 6));
  ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 6);
  r(ctx, x - 5, y - 5, 10, 10, '#ffcf3f');
  ctx.globalAlpha = 1;
  r(ctx, x - w / 2, y - 3, w, 6, '#ffcf3f');
  if (w > 2) r(ctx, x - w / 2 + 1, y - 2, 1, 4, '#fff6c0');
}

export function drawFloppy(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const yy = Math.round(y + Math.sin(t * 3) * 2);
  ctx.globalAlpha = 0.3;
  r(ctx, x - 8, yy - 8, 16, 16, '#3fe0ff');
  ctx.globalAlpha = 1;
  r(ctx, x - 6, yy - 6, 12, 12, '#2b2bd9');
  r(ctx, x - 3, yy - 6, 6, 4, '#c0c0d0');
  r(ctx, x - 4, yy + 1, 8, 5, '#fff');
  r(ctx, x - 3, yy + 2, 6, 1, '#ff3fa4');
}

export function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const c = '#ff3f6b';
  r(ctx, x - 3, y - 2, 2, 2, c);
  r(ctx, x + 1, y - 2, 2, 2, c);
  r(ctx, x - 4, y - 1, 8, 2, c);
  r(ctx, x - 3, y + 1, 6, 1, c);
  r(ctx, x - 1, y + 2, 2, 1, c);
}

/** The Cartridge Core. */
export function drawCoreIcon(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, scale = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  r(ctx, -6, -8, 12, 16, '#5a5a6a');
  r(ctx, -5, -7, 10, 9, '#2a2a3a');
  r(ctx, -4, -6, 8, 7, `hsl(${(t * 90) % 360},90%,60%)`);
  for (let i = 0; i < 5; i++) r(ctx, -5 + i * 2, 5, 1, 3, '#ffcf3f');
  ctx.restore();
}

function drawBrick(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const colors = ['#ff3f3f', '#3fa9ff', '#ffd23f', '#7dff6b'];
  for (let i = 0; i < 9; i++) r(ctx, x - 12 + (i % 3) * 8, y - 12 + Math.floor(i / 3) * 8, 7, 7, colors[i % 4]);
  r(ctx, x - 8, y - 4, 5, 3, '#000');
  r(ctx, x + 3, y - 4, 5, 3, '#000');
  r(ctx, x - 6, y + 6, 12, 2, Math.floor(t * 4) % 2 ? '#000' : '#300');
}

function drawStatic(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  for (let i = 0; i < 40; i++) {
    r(ctx, x - 12 + ((i * 7 + Math.floor(t * 20)) % 24), y - 12 + ((i * 13) % 24), 2, 1, i % 3 ? '#ffffff55' : '#ff3fd2');
  }
  r(ctx, x - 10, y - 4, 20, 6, '#000');
  r(ctx, x - 9, y - 3, 8, 4, '#3fffe0');
  r(ctx, x + 1, y - 3, 8, 4, '#3fffe0');
}

function drawManager(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  r(ctx, x - 9, y - 12, 18, 24, '#1a1418');
  r(ctx, x - 5, y - 4, 3, 2, '#ffe9a0');
  r(ctx, x + 2, y - 4, 3, 2, '#ffe9a0');
  r(ctx, x - 6, y + 6, 12, 1, '#b3122e');
  r(ctx, x - 3, y + 8, 6, 4, '#c9a227');
  if (Math.floor(t * 2) % 2) r(ctx, x - 9, y - 12, 18, 1, '#b3122e');
}

/** 32x32 dialogue portrait with top-left at (x, y). */
export function drawPortrait(ctx: CanvasRenderingContext2D, who: PortraitId, x: number, y: number, t: number): void {
  r(ctx, x, y, 32, 32, '#0b0716');
  r(ctx, x + 1, y + 1, 30, 30, '#1d1233');
  const cx = x + 16;
  const fy = y + 31;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 1, y + 1, 30, 30);
  ctx.clip();
  switch (who) {
    case 'cass': drawCass(ctx, { x: cx, y: fy + 14, facing: 1, pose: 'idle', t, scale: 1.8 }); break;
    case 'demo': drawDemo(ctx, { x: cx - 2, y: fy - 4, facing: 1, pose: 'idle', t, scale: 1.6 }); break;
    case 'manual': drawManual(ctx, cx, fy - 2, t); break;
    case 'kevin': ctx.translate(cx, fy + 10); ctx.scale(1.6, 1.6); drawKevin(ctx, 0, 0, 0); break;
    case 'rex': ctx.translate(cx, fy + 8); ctx.scale(1.6, 1.6); drawRex(ctx, 0, 0, t); break;
    case 'polygon': ctx.translate(cx, fy); ctx.scale(1.2, 1.2); drawPolygon(ctx, 0, 0, t); break;
    case 'byte': ctx.translate(cx, fy - 4); ctx.scale(2, 2); drawByte(ctx, 0, 0, t, 3); break;
    case 'brick': drawBrick(ctx, cx, y + 16, t); break;
    case 'static': drawStatic(ctx, cx, y + 16, t); break;
    case 'manager': drawManager(ctx, cx, y + 16, t); break;
    case 'core': drawCoreIcon(ctx, cx, y + 16, t, 2); break;
  }
  ctx.restore();
}
