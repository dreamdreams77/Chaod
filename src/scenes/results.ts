import type { Game, Scene } from '../game.ts';
import { RunResult, RunSummary, applyRun, ACHIEVEMENTS, FRIEND_BONUS } from '../data/progression.ts';
import { MUTATION_BY_ID } from '../fusion/registry.ts';
import { MODE_INFO } from '../data/story.ts';
import { formatSeed } from '../core/rng.ts';
import { H, W, PAL, frame, rect, bar, backdrop, glow } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { xpForLevel } from '../core/save.ts';
import { QUEST_BY_ID } from '../data/quests.ts';
import { STARS, STAR_BITS } from '../data/mastery.ts';
import { buildCard, shareCard } from '../core/share.ts';
import { activeTitle, unlockedTitles } from '../data/titles.ts';
import { WEEKLY_BY_ID } from '../data/weekly.ts';

export function showResults(game: Game, result: RunResult, seed: number): void {
  const before = game.profile;
  const { profile, summary } = applyRun(before, result);
  game.profile = profile;
  game.saveProfile();
  const had = new Set(unlockedTitles(before).map((t) => t.id));
  for (const t of unlockedTitles(profile)) if (!had.has(t.id)) game.toast('NEW TITLE', t.name, '#ffcf3f');
  game.goto(new ResultsScene(game, result, summary, seed));
}

class ResultsScene implements Scene {
  id = 'results';
  crt = 0.35;
  private t = 0;
  private sel = 0;
  private announced = false;
  private title: string;
  constructor(private game: Game, private r: RunResult, private s: RunSummary, private seed: number) {
    this.title = activeTitle(game.profile).name;
  }

  enter(): void {
    this.game.music(this.r.cleared ? 'ending' : 'hub');
    this.game.audio.sfx(this.r.cleared ? 'powerup' : 'back');
  }

  /** Tap an option to choose it: left = back to the lobby, right = retry. */
  tap(x: number, y: number): boolean {
    if (this.t < 0.5) return true;
    if (y >= 226) {
      this.sel = x < 195 ? 0 : x < 285 ? 1 : 2;
      this.game.input.pulse('confirm');
    }
    return true;
  }

  private sharing = false;
  private share(): void {
    if (this.sharing) return;
    this.sharing = true;
    this.game.audio.sfx('card');
    const card = buildCard(this.r, this.seed, this.game.profile, `${location.origin}${location.pathname}`, activeTitle(this.game.profile).name);
    void shareCard(card, this.game.profile.level).then((res) => {
      this.sharing = false;
      if (res === 'shared') this.game.toast('SHARED', 'NICE RUN!', '#3fe0ff');
      else if (res === 'saved') this.game.toast('CARD SAVED', card.link ? 'LINK COPIED TOO' : 'PICTURE DOWNLOADED', '#3fe0ff');
      else this.game.toast('SHARE FAILED', 'YOUR BROWSER SAID NO', '#ff6f3f');
    });
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.game;
    if (!this.announced && this.t > 0.6) {
      this.announced = true;
      g.announceAchievements(this.s.achievements);
      if (this.s.levelAfter > this.s.levelBefore) {
        g.toast('LEVEL UP!', `LEVEL ${this.s.levelAfter}: MORE HP & POWER`, '#7dff6b');
        g.audio.sfx('levelup');
      }
      for (const st of this.s.newStars) g.toast('MASTERY STAR', `${STARS.find((x) => x.id === st)?.name ?? st}  +${STAR_BITS} BITS`, '#ffcf3f');
      for (const q of this.s.quests) g.toast('QUEST COMPLETE', QUEST_BY_ID.get(q)?.title ?? q, '#ffcf3f');
      if (this.s.errand) g.toast('ERRAND DONE', this.s.errand, '#9dff3f');
      for (const id of this.s.weekly) g.toast('WEEKLY GOAL', id === 'sweep' ? 'ALL THREE DONE! BONUS PAID' : WEEKLY_BY_ID.get(id)?.title ?? id, '#3fe0ff');
      for (const m of this.s.mutations) g.toast('NEW MUTATION', MUTATION_BY_ID.get(m)?.name ?? m, '#ff3fd2');
    }
    if (this.t < 0.5) return;
    const inp = g.input;
    if (inp.pressed('left') || inp.pressed('up')) {
      this.sel = (this.sel + 2) % 3;
      g.audio.sfx('select');
    } else if (inp.pressed('right') || inp.pressed('down')) {
      this.sel = (this.sel + 1) % 3;
      g.audio.sfx('select');
    }
    if (inp.pressed('back') || inp.pressed('attack')) {
      g.audio.sfx('back');
      g.toHub();
    } else if (inp.pressed('confirm')) {
      g.audio.sfx('confirm');
      if (this.sel === 0) g.toHub();
      else if (this.sel === 1) g.restart();
      else this.share();
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const p = PAL.hub;
    backdrop(ctx, '#05020d', p.bg1);
    glow(ctx, W / 2, 40, 200, '255,63,164', 0.14);
    for (let i = 0; i < 24; i++) rect(ctx, (i * 41 + this.t * 20) % W, (i * 23) % H, 2, 2, '#ffffff22');
    const info = MODE_INFO[this.r.mode];
    drawText(ctx, info.title, W / 2, 18, info.color, { align: 'center', scale: 2 });
    const endless = this.r.endless;
    const head = endless ? `ENDLESS: ${endless.rounds} ROUND${endless.rounds === 1 ? '' : 'S'}` : this.r.ultra ? (this.r.cleared ? 'TARGET HIT!' : 'ULTRA OVER') : this.r.cleared ? (this.r.boss ? 'BOSS DEFEATED!' : 'WORLD CLEARED!') : 'GAME OVER... SORT OF';
    drawText(ctx, head, W / 2, 42, this.r.cleared || endless ? '#7dff6b' : '#ff6f3f', { align: 'center', scale: 2 });
    if (endless) {
      const best = this.game.profile.endless[this.r.mode];
      const bestRounds = best?.rounds ?? 0;
      drawText(ctx, `BEST: ${bestRounds} ROUND${bestRounds === 1 ? '' : 'S'}.  ${endless.rounds >= 5 ? 'FULL PAYOUT!' : 'GO FIVE ROUNDS FOR THE FULL PAYOUT.'}`, W / 2, 62, '#ccc', { align: 'center' });
    } else if (this.r.ultra) {
      const best = this.game.profile.ultraBest;
      drawText(ctx, `ULTRA BEST: ${best}.${this.r.cleared ? '' : '  Half pay: reach the target score for full pay.'}`, W / 2, 62, '#ccc', { align: 'center' });
    } else if (!this.r.cleared) drawText(ctx, 'You keep half your bits and XP. Failure is just a genre.', W / 2, 62, '#ccc', { align: 'center' });

    frame(ctx, 60, 76, W - 120, 132, '#1d1233ee', '#3fe0ff');
    const rows: Array<[string, string, string]> = [
      ['SCORE', `${this.r.score}`, '#fff'],
      ['TIME', `${this.r.time.toFixed(1)}S`, '#fff'],
      ['BITS EARNED', `+${this.s.bits}  (x${this.r.bitMultiplier.toFixed(2)} MUTATIONS/MODS)`, '#ffcf3f'],
      ['XP EARNED', `+${this.s.xp}`, '#7dff6b'],
      ['NEW FLOPPIES', `${this.s.newFloppies}`, '#3fe0ff'],
      ['CHAOS EVENTS', `${this.r.chaosSeen.length}`, '#ff3fa4'],
      ['SEED', formatSeed(this.seed), '#b07aff'],
    ];
    if (this.s.friend) rows.splice(3, 0, ['FRIEND\'S SCORE', this.s.friend === 'beat' ? `${this.r.beat} \u2014 BEATEN! +${FRIEND_BONUS} BITS` : this.s.friend === 'again' ? `${this.r.beat} \u2014 BEATEN (PAID BEFORE)` : `${this.r.beat} \u2014 NOT YET`, this.s.friend === 'missed' ? '#9a9ab8' : '#7dff6b']);
    if (this.s.dailyBonus > 0) rows.splice(3, 0, ['DAILY BONUS', `+${this.s.dailyBonus} BITS  (STREAK ${this.s.dailyStreak})`, '#ffcf3f']);
    else if (this.r.challenge === 'daily') rows.splice(3, 0, ['DAILY', this.r.cleared ? 'ALREADY CLEARED TODAY' : 'CLEAR IT FOR THE BONUS', '#9a9ab8']);
    const gap = rows.length > 7 ? 11 : 12;
    rows.forEach(([k, v, c], i) => {
      const show = this.t > 0.2 + i * 0.12;
      if (!show) return;
      drawText(ctx, k, 76, 84 + i * gap, '#aaa');
      drawText(ctx, v, 196, 84 + i * gap, c);
    });
    const prof = this.game.profile;
    const lo = xpForLevel(prof.level);
    const hi = xpForLevel(prof.level + 1);
    drawText(ctx, `LV ${prof.level}`, 76, 176, '#7dff6b');
    drawText(ctx, this.title, W - 76, 176, '#ffcf3f', { align: 'right' });
    bar(ctx, 116, 177, 200, 5, (prof.xp - lo) / Math.max(1, hi - lo), '#7dff6b', '#102010', '#ffffff55');
    drawText(ctx, `${prof.bits} BITS TOTAL`, 76, 190, '#ffcf3f');
    if (this.s.achievements.length) {
      const names = this.s.achievements.map((a) => ACHIEVEMENTS.find((x) => x.id === a)?.name ?? a).join(', ');
      drawText(ctx, `★ ${names}`.slice(0, 60), W / 2, 214, '#ffcf3f', { align: 'center' });
    }
    const opts = ['LOBBY', 'RETRY', 'SHARE CARD'];
    opts.forEach((o, i) => {
      const sel = i === this.sel;
      drawText(ctx, (sel ? '▶ ' : '  ') + o, W / 2 - 130 + i * 90, 236, sel ? '#ffcf3f' : '#888');
    });
  }
}
