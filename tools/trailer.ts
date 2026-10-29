/**
 * Launch-trailer image: composes the twelve worlds and the final boss (real in-game captures passed in
 * by tools/trailer.mjs) into a 1920x1080 key-art banner, lettered in the game's own pixel font.
 */
import { drawText, textWidth } from '../src/render/font.ts';
import { MODE_INFO } from '../src/data/story.ts';
import type { ModeId } from '../src/core/save.ts';

const W = 1920, H = 1080;
const ORDER: ModeId[] = ['rampage', 'neon', 'mall', 'beatdown', 'rhythm', 'command', 'penalty', 'blocks', 'bolt', 'munch', 'wrestle', 'pinball', 'highscore'];

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

export async function compose(canvas: HTMLCanvasElement, shots: Record<string, string>, cover: string, url: string): Promise<void> {
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
  drawText(ctx, 'TWELVE GAMES. ONE CARTRIDGE. ZERO RULES.', W / 2, 262, '#3fe0ff', { align: 'center', scale: 5, shadow: '#0a3a55' });
  drawText(ctx, 'CHAOS DIRECTOR  •  ENDLESS RUNS  •  BOSS GAUNTLET  •  DAILY CHALLENGES', W / 2, 316, '#c9b8ff', { align: 'center', scale: 3 });

  // tiles: seven across, then six centred
  const TW = 249, TH = 140, GAP = 14;
  ORDER.forEach((m, i) => {
    const info = MODE_INFO[m];
    const row = i < 7 ? 0 : 1;
    const inRow = row === 0 ? 7 : ORDER.length - 7;
    const col = row === 0 ? i : i - 7;
    const x = (W - (inRow * TW + (inRow - 1) * GAP)) / 2 + col * (TW + GAP);
    const y = 372 + row * (TH + 92);
    ctx.save();
    ctx.shadowColor = info.color; ctx.shadowBlur = 22;
    ctx.fillStyle = info.color; ctx.fillRect(x - 4, y - 4, TW + 8, TH + 8);
    ctx.restore();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(imgs[m], x, y, TW, TH);
    ctx.imageSmoothingEnabled = false;
    if (m === 'highscore') {
      const label = 'FINAL BOSS';
      ctx.fillStyle = '#ff3f5a'; ctx.fillRect(x + TW - textWidth(label, 2) - 16, y + 6, textWidth(label, 2) + 12, 22);
      drawText(ctx, label, x + TW - 10, y + 10, '#fff', { align: 'right', scale: 2, shadow: null });
    }
    // the mall's crimson is too dark to read as text on this backdrop
    drawText(ctx, info.title, x + TW / 2, y + TH + 14, m === 'mall' ? '#ff5470' : info.color, { align: 'center', scale: 2 });
    drawText(ctx, info.genre, x + TW / 2, y + TH + 38, '#9a9ab8', { align: 'center', scale: 1 });
  });
  drawText(ctx, 'PLUS THE ARCADE: CART CATCH \u2022 BYTE BREAKOUT \u2022 WHACK-A-GLITCH \u2022 STACK-A-CART \u2022 GLITCH MEMORY \u2022 HOOP SHOT \u2022 GLITCH GLOVES', W / 2, 920, '#c9b8ff', { align: 'center', scale: 2 });

  // footer: the address in a normal font (the pixel font has no lower case, and repo paths are case-sensitive)
  ctx.fillStyle = '#ff3fa4'; ctx.fillRect(0, H - 100, W, 3);
  ctx.fillStyle = '#0a0518'; ctx.fillRect(0, H - 97, W, 97);
  ctx.font = '700 40px "Courier New", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#3fe0ff';
  ctx.shadowColor = '#3fe0ff'; ctx.shadowBlur = 14;
  ctx.fillText(url, W / 2, H - 68);
  ctx.shadowBlur = 0; ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  drawText(ctx, 'PLAY FREE IN YOUR BROWSER  \u2022  KEYBOARD, GAMEPAD OR TOUCH  \u2022  NO INSTALL', W / 2, H - 36, '#ffffff', { align: 'center', scale: 3 });
}
(window as unknown as { __compose: typeof compose }).__compose = compose;
