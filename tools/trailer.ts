/**
 * Launch-trailer image: composes the nine worlds and the final boss (real in-game captures passed in
 * by tools/trailer.mjs) into a 1920x1080 key-art banner, lettered in the game's own pixel font.
 */
import { drawText, textWidth } from '../src/render/font.ts';
import { MODE_INFO } from '../src/data/story.ts';
import type { ModeId } from '../src/core/save.ts';

const W = 1920, H = 1080;
const ORDER: ModeId[] = ['rampage', 'neon', 'mall', 'beatdown', 'rhythm', 'command', 'penalty', 'blocks', 'bolt', 'highscore'];

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

export async function compose(canvas: HTMLCanvasElement, shots: Record<string, string>, cover: string): Promise<void> {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const imgs = Object.fromEntries(await Promise.all(ORDER.map(async (m) => [m, await load(shots[m])])));
  const bg = await load(cover);

  // backdrop: the cover art, blurred and darkened, fading into near-black
  ctx.fillStyle = '#05020d'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.filter = 'blur(4px) saturate(1.3)';
  ctx.drawImage(bg, 0, 120, 640, 120, 0, 0, W, 360);
  ctx.restore();
  const fade = ctx.createLinearGradient(0, 0, 0, 420);
  fade.addColorStop(0, 'rgba(5,2,13,0.55)'); fade.addColorStop(1, '#05020d');
  ctx.fillStyle = fade; ctx.fillRect(0, 0, W, 420);
  const lower = ctx.createLinearGradient(0, 300, 0, H);
  lower.addColorStop(0, '#05020d'); lower.addColorStop(1, '#1d0f33');
  ctx.fillStyle = lower; ctx.fillRect(0, 420, W, H - 420);
  // scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 2);
  ctx.imageSmoothingEnabled = false;

  // ribbon + title block
  const ribbon = '▶ LAUNCH TRAILER';
  const rw = textWidth(ribbon, 3) + 40;
  ctx.fillStyle = '#ff3fa4'; ctx.fillRect(W / 2 - rw / 2, 36, rw, 46);
  drawText(ctx, ribbon, W / 2, 49, '#ffffff', { align: 'center', scale: 3, shadow: '#7a1a5a' });
  ctx.save();
  ctx.shadowColor = '#ff3fa4'; ctx.shadowBlur = 40;
  drawText(ctx, 'CHAOS.EXE', W / 2, 104, '#ffe23f', { align: 'center', scale: 18, shadow: '#b3126e' });
  ctx.restore();
  drawText(ctx, 'NINE GENRES. ONE CARTRIDGE. ZERO RULES.', W / 2, 262, '#3fe0ff', { align: 'center', scale: 5, shadow: '#0a3a55' });
  drawText(ctx, 'CHAOS DIRECTOR  •  ENDLESS RUNS  •  BOSS GAUNTLET  •  DAILY CHALLENGES', W / 2, 316, '#c9b8ff', { align: 'center', scale: 3 });

  // tiles: two rows of five
  const TW = 352, TH = 198, GAP = 20, X0 = (W - (5 * TW + 4 * GAP)) / 2;
  ORDER.forEach((m, i) => {
    const info = MODE_INFO[m];
    const x = X0 + (i % 5) * (TW + GAP);
    const y = 380 + Math.floor(i / 5) * (TH + 118);
    ctx.save();
    ctx.shadowColor = info.color; ctx.shadowBlur = 26;
    ctx.fillStyle = info.color; ctx.fillRect(x - 5, y - 5, TW + 10, TH + 10);
    ctx.restore();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(imgs[m], x, y, TW, TH);
    ctx.imageSmoothingEnabled = false;
    const label = m === 'highscore' ? 'FINAL BOSS' : '';
    if (label) {
      ctx.fillStyle = '#ff3f5a'; ctx.fillRect(x + TW - textWidth(label, 2) - 18, y + 8, textWidth(label, 2) + 12, 26);
      drawText(ctx, label, x + TW - 12, y + 13, '#fff', { align: 'right', scale: 2, shadow: null });
    }
    // the mall's crimson is too dark to read as text on this backdrop
    drawText(ctx, info.title, x + TW / 2, y + TH + 24, m === 'mall' ? '#ff5470' : info.color, { align: 'center', scale: 3 });
    drawText(ctx, info.genre, x + TW / 2, y + TH + 56, '#9a9ab8', { align: 'center', scale: 2 });
  });

  // footer
  ctx.fillStyle = '#ff3fa4'; ctx.fillRect(0, H - 52, W, 3);
  drawText(ctx, 'PLAY FREE IN YOUR BROWSER  •  KEYBOARD, GAMEPAD OR TOUCH  •  NO INSTALL', W / 2, H - 36, '#ffffff', { align: 'center', scale: 3 });
}
(window as unknown as { __compose: typeof compose }).__compose = compose;
