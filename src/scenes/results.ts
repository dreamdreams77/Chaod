import type { Game, Scene } from '../game.ts';
import { RunResult, RunSummary, applyRun, ACHIEVEMENTS } from '../data/progression.ts';
import { MUTATION_BY_ID } from '../fusion/registry.ts';
import { MODE_INFO } from '../data/story.ts';
import { formatSeed } from '../core/rng.ts';
import { H, W, PAL, frame, rect, bar } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { xpForLevel } from '../core/save.ts';

export function showResults(game: Game, result: RunResult, seed: number): void {
  const before = game.profile;
  const { profile, summary } = applyRun(before, result);
  game.profile = profile;
  game.saveProfile();
  game.goto(new ResultsScene(game, result, summary, seed));
}

class ResultsScene implements Scene {
  id = 'results';
  crt = 0.35;
  private t = 0;
  private sel = 0;
  private announced = false;
  constructor(private game: Game, private r: RunResult, private s: RunSummary, private seed: number) {}

  enter(): void {
    this.game.music(this.r.cleared ? 'ending' : 'hub');
    this.game.audio.sfx(this.r.cleared ? 'powerup' : 'back');
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
      for (const m of this.s.mutations) g.toast('NEW MUTATION', MUTATION_BY_ID.get(m)?.name ?? m, '#ff3fd2');
    }
    if (this.t < 0.5) return;
    const inp = g.input;
    if (inp.pressed('left') || inp.pressed('right') || inp.pressed('up') || inp.pressed('down')) {
      this.sel = 1 - this.sel;
      g.audio.sfx('select');
    }
    if (inp.pressed('confirm')) {
      g.audio.sfx('confirm');
      if (this.sel === 0) g.toHub();
      else g.restart();
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const p = PAL.hub;
    rect(ctx, 0, 0, W, H, p.bg0);
    for (let i = 0; i < 24; i++) rect(ctx, (i * 41 + this.t * 20) % W, (i * 23) % H, 2, 2, '#ffffff22');
    const info = MODE_INFO[this.r.mode];
    drawText(ctx, info.title, W / 2, 18, info.color, { align: 'center', scale: 2 });
    const head = this.r.cleared ? (this.r.boss ? 'BOSS DEFEATED!' : 'WORLD CLEARED!') : 'GAME OVER... SORT OF';
    drawText(ctx, head, W / 2, 42, this.r.cleared ? '#7dff6b' : '#ff6f3f', { align: 'center', scale: 2 });
    if (!this.r.cleared) drawText(ctx, 'You keep half your bits and XP. Failure is just a genre.', W / 2, 62, '#ccc', { align: 'center' });

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
    rows.forEach(([k, v, c], i) => {
      const show = this.t > 0.2 + i * 0.12;
      if (!show) return;
      drawText(ctx, k, 76, 86 + i * 12, '#aaa');
      drawText(ctx, v, 196, 86 + i * 12, c);
    });
    const prof = this.game.profile;
    const lo = xpForLevel(prof.level);
    const hi = xpForLevel(prof.level + 1);
    drawText(ctx, `LV ${prof.level}`, 76, 176, '#7dff6b');
    bar(ctx, 116, 177, 200, 5, (prof.xp - lo) / Math.max(1, hi - lo), '#7dff6b', '#102010', '#ffffff55');
    drawText(ctx, `${prof.bits} BITS TOTAL`, 76, 190, '#ffcf3f');
    if (this.s.achievements.length) {
      const names = this.s.achievements.map((a) => ACHIEVEMENTS.find((x) => x.id === a)?.name ?? a).join(', ');
      drawText(ctx, `★ ${names}`.slice(0, 60), W / 2, 214, '#ffcf3f', { align: 'center' });
    }
    const opts = ['BACK TO LOBBY', 'RETRY (NEW SEED)'];
    opts.forEach((o, i) => {
      const sel = i === this.sel;
      drawText(ctx, (sel ? '▶ ' : '  ') + o, W / 2 - 110 + i * 130, 236, sel ? '#ffcf3f' : '#888');
    });
  }
}
