/**
 * Shareable run cards: a PNG of the results (and a challenge link) that can go to a friend via the
 * phone's share sheet, or be saved. `buildCard` is pure; `drawCard` and `shareCard` touch the DOM.
 */
import type { RunResult } from '../data/progression.ts';
import { MODE_INFO } from '../data/story.ts';
import { MODE_IDS, ModeId, Profile } from './save.ts';
import { formatSeed } from './rng.ts';
import { challengeUrl } from '../data/daily.ts';
import { starCount } from '../data/mastery.ts';
import { H, W, backdrop, glow, rect } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';

export interface Card {
  title: string;
  color: string;
  headline: string;
  headlineColor: string;
  score: number;
  rows: Array<[string, string]>;
  /** A link that replays this exact run (worlds only); empty for the final boss. */
  link: string;
  /** One line for the share text. */
  text: string;
}

export function buildCard(r: RunResult, seed: number, p: Pick<Profile, 'stars' | 'level' | 'endless'>, base: string): Card {
  const info = MODE_INFO[r.mode];
  const stars = starCount(p, r.mode);
  const headline = r.endless ? `ENDLESS: ${r.endless.rounds} ROUND${r.endless.rounds === 1 ? '' : 'S'}` : r.cleared ? (r.boss ? 'BOSS DEFEATED' : 'WORLD CLEARED') : 'GAME OVER';
  const rows: Array<[string, string]> = [
    ['TIME', `${r.time.toFixed(1)}S`],
    ['DAMAGE TAKEN', `${r.damageTaken}`],
    ['CHAOS EVENTS', `${r.chaosSeen.length}`],
    ['SEED', formatSeed(seed)],
  ];
  if (r.mode !== 'highscore') rows.splice(2, 0, ['MASTERY', `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`]);
  if (r.challenge === 'daily') rows.push(['DAILY CHALLENGE', r.dailyKey ?? 'TODAY']);
  const link = (MODE_IDS as string[]).includes(r.mode) ? challengeUrl(base, { mode: r.mode as ModeId, seed }) : '';
  return {
    title: info.title,
    color: info.color,
    headline,
    headlineColor: r.cleared || r.endless ? '#7dff6b' : '#ff6f3f',
    score: r.score,
    rows,
    link,
    text: `${info.title} on CHAOS.EXE: ${headline}, score ${r.score}${link ? `. Beat my seed: ${link}` : ''}`,
  };
}

/** Draws the card at 480x270 logical pixels (scale the context for a bigger image). */
export function drawCard(ctx: CanvasRenderingContext2D, c: Card, level: number): void {
  backdrop(ctx, '#05020d', '#1d0f33');
  glow(ctx, W / 2, 40, 220, '255,63,164', 0.16);
  for (let i = 0; i < 30; i++) rect(ctx, (i * 53) % W, (i * 31) % H, 2, 2, '#ffffff22');
  // A plain border: frame() fills its box, which would paint over the backdrop.
  rect(ctx, 8, 8, W - 16, 2, c.color);
  rect(ctx, 8, H - 10, W - 16, 2, c.color);
  rect(ctx, 8, 8, 2, H - 16, c.color);
  rect(ctx, W - 10, 8, 2, H - 16, c.color);
  drawText(ctx, 'CHAOS.EXE', 20, 18, '#ff3fa4', { scale: 2 });
  drawText(ctx, `PLAYER LV ${level}`, W - 20, 22, '#9a9ab8', { align: 'right' });
  drawText(ctx, c.title, W / 2, 52, c.color, { align: 'center', scale: 3 });
  drawText(ctx, c.headline, W / 2, 84, c.headlineColor, { align: 'center', scale: 2 });
  drawText(ctx, `${c.score}`, W / 2, 112, '#ffffff', { align: 'center', scale: 4 });
  drawText(ctx, 'SCORE', W / 2, 146, '#9a9ab8', { align: 'center' });
  c.rows.forEach(([k, v], i) => {
    drawText(ctx, k, 120, 166 + i * 13, '#9a9ab8');
    drawText(ctx, v, 250, 166 + i * 13, '#fff');
  });
  drawText(ctx, c.link ? 'THE POST CARRIES A LINK TO PLAY THIS EXACT SEED' : 'A GAME ABOUT EVERY GENRE AT ONCE', W / 2, H - 22, '#3fe0ff', { align: 'center' });
}

export type ShareResult = 'shared' | 'saved' | 'failed';

/** Renders the card to a PNG and hands it to the share sheet, or downloads it where that is not available. */
export async function shareCard(c: Card, level: number): Promise<ShareResult> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W * 2;
    canvas.height = H * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'failed';
    ctx.imageSmoothingEnabled = false;
    ctx.scale(2, 2);
    drawCard(ctx, c, level);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return 'failed';
    const file = new File([blob], 'chaos-exe-run.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: 'CHAOS.EXE', text: c.text });
        return 'shared';
      } catch (err) {
        // Cancelling the sheet is fine; anything else (an expired tap, a blocked share) falls back to saving the picture.
        if ((err as Error)?.name === 'AbortError') return 'shared';
      }
    }
    // No share sheet (most desktops): copy the text and save the picture.
    try {
      await navigator.clipboard?.writeText(c.text);
    } catch {
      /* clipboard may be blocked; the download still works */
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chaos-exe-run.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'saved';
  } catch (err) {
    // A cancelled share sheet throws AbortError; that is not a failure.
    return (err as Error)?.name === 'AbortError' ? 'shared' : 'failed';
  }
}
