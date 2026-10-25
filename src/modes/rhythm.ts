/**
 * GLITCH RHYTHM — four-lane rhythm boss fight vs DJ STATIC.
 * Timing controls the environment: your combo raises the stage, lights and FEVER.
 *
 * Mutation honoured: SHOTS ON THE ONE (rhythm+bullet hell). On-time notes fire shots up
 * the lane at DJ STATIC; misses send static bullets down the lane, which you can PARRY by
 * pressing that lane exactly as they cross the line.
 * Boss phases: (1) clean charts, (2) glitch notes you must NOT hit, (3) tempo up + denser charts.
 * Chaos flags honoured: lane_mirror (keys follow mirrored receptors), remix (faster scroll).
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import { DirectorContext, ActiveEvent } from '../chaos/director.ts';
import { generateBlock, Note, BLOCK_BEATS, judge, WINDOWS, Grade } from '../procgen/chart.ts';
import { H, W, PAL, rect, hearts, bar, clamp } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { BOSS_DEFEAT } from '../data/story.ts';
import { Rng } from '../core/rng.ts';

const LANE_X = [180, 220, 260, 300];
const JUDGE_Y = 222;
const TOP = 92;
const ARROWS = ['←', '↓', '↑', '→'];
const ACTS = ['left', 'down', 'up', 'right'] as const;
const LANE_COL = ['#ff3fd2', '#3fe0ff', '#7dff6b', '#ffcf3f'];

interface Bolt { lane: number; beat: number; alive: boolean; parried: boolean }
interface Shot { lane: number; y: number; dmg: number; alive: boolean }

export class RhythmMode extends ModeBase {
  gesture = 'lanes' as const;
  gestureHint = 'TOUCH THE LANES ON THE BEAT \u2022 AVOID RED X \u2022 PARRY BOLTS ON THE LINE';
  /** The lane (and so the arrow) nearest a touch; the whole screen is a big target. */
  laneAt(x: number): (typeof ACTS)[number] {
    let best = 0;
    for (let c = 1; c < 4; c++) if (Math.abs(LANE_X[c] - x) < Math.abs(LANE_X[best] - x)) best = c;
    return ACTS[this.perm[best]];
  }
  id = 'rhythm';
  crt = 0.45;
  notes: Note[] = [];
  bolts: Bolt[] = [];
  shots: Shot[] = [];
  nextBlock = 8;
  private lastBlock: Note[] = [];
  hp: number;
  bMaxHp: number;
  bHp: number;
  phase = 1;
  combo = 0;
  maxCombo = 0;
  counts: Record<Grade, number> = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  missStreak = 0;
  lastGrade: { g: Grade | 'GLITCH!' | 'PARRY!' | 'DROP'; t: number } | null = null;
  laneFlash = [0, 0, 0, 0];
  holding: Array<Note | null> = [null, null, null, null];
  perm = [0, 1, 2, 3]; // screen column -> lane action index
  beatBase = 0;
  tempo = 1;
  intro = true;
  won = false;
  lost = false;
  endT = 0;
  stage = 0; // 0..1 environment level driven by timing
  private chartRng: Rng;
  readonly scroll: number;

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'rhythm', opts);
    this.hp = this.stats.maxHp;
    // BOSS RUSH leg 2 and ENDLESS RUN rounds inherit whatever health the player had left (never less than one heart).
    this.applyCarry();
    this.bMaxHp = Math.round(110 * { easy: 0.8, normal: 1, hard: 1.25 }[game.settings.difficulty] * (opts.rematch ? 1.25 : 1) * (1 + 0.5 * (this.tier - 1)));
    this.bHp = this.bMaxHp;
    this.chartRng = this.rng.fork(0xbeef);
    // The GAME SPEED accessibility setting slows the song itself, so timing windows stay fair.
    this.tempo = clamp(game.settings.gameSpeed * this.speedMult, 0.5, 1.3);
    this.scroll = 150;
  }

  enter(): void {
    if (this.endlessRound > 1) {
      // ENDLESS RUN: straight back into the song, no chat.
      this.intro = false;
      this.game.audio.play('rhythm', this.tempo, true);
      this.beatBase = 0;
      return;
    }
    this.game.say(
      [
        { who: 'static', name: 'DJ STATIC', text: this.opts.rematch ? 'ENCORE! I remixed the remix. Try to keep up.' : 'LIVE FROM THE GLITCH: it\'s DJ STATIC! You want my shard? Then keep the BEAT!' },
        { who: 'manual', name: 'THE MANUAL', text: 'Press the ARROW shown on each lane as the note hits the line. Avoid the red X glitch notes!' },
      ],
      () => {
        this.intro = false;
        this.game.audio.play('rhythm', this.tempo, true);
        this.beatBase = 0;
      },
    );
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: !this.intro && !this.won && !this.lost && this.phaseChangeT <= 0, bossActive: true };
  }
  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  private phaseChangeT = 0;

  get bpm(): number {
    return this.game.audio.bpm;
  }
  /** Current song position in beats (audio clock when available). */
  beatNow(): number {
    return this.beatBase + this.game.audio.musicTime() * this.bpm / 60;
  }
  beatToSec(b: number): number {
    return b * 60 / this.bpm;
  }

  onChaosStart(ev: ActiveEvent): void {
    if (ev.def.flags.includes('lane_mirror') || ev.extraFlags.includes('lane_mirror')) this.perm = [3, 2, 1, 0];
  }
  onChaosEnd(ev: ActiveEvent): void {
    if (ev.def.flags.includes('lane_mirror') || ev.extraFlags.includes('lane_mirror')) this.perm = [0, 1, 2, 3];
  }

  update(dt: number): void {
    this.tickShared(dt);
    for (let i = 0; i < 4; i++) this.laneFlash[i] = Math.max(0, this.laneFlash[i] - dt * 4);
    if (this.lastGrade) this.lastGrade.t += dt;
    if (this.intro) return;
    if (this.won || this.lost) {
      this.endT += dt;
      if (this.lost && this.endT > 1.8) this.finish(false, this.score());
      if (this.won && this.endT > 2.2 && this.endT < 100) {
        this.endT = 100;
        this.defeatDialog();
      }
      return;
    }
    this.phaseChangeT = Math.max(0, this.phaseChangeT - dt);
    const beat = this.beatNow();
    // Generate chart blocks ahead of time
    while (this.nextBlock < beat + 12) {
      const block = generateBlock(this.chartRng, this.nextBlock, this.phase, Math.min(2, { easy: 0, normal: 1, hard: 2 }[this.game.settings.difficulty] + Math.floor((this.tier - 1) * 2)), this.lastBlock);
      this.lastBlock = block;
      this.notes.push(...block);
      this.nextBlock += BLOCK_BEATS;
    }
    this.handleInput(beat);
    this.updateMisses(beat);
    this.updateShots(dt);
    this.stage += ((this.combo >= 10 ? Math.min(1, this.combo / 40) : 0) - this.stage) * Math.min(1, dt * 2);
    // Bounded memory: drop judged notes well behind the line.
    if (this.notes.length > 200) this.notes = this.notes.filter((n) => !(n.judged && n.beat < beat - 4));
  }

  private secOffset(n: Note, beat: number): number {
    return this.beatToSec(n.beat - beat);
  }

  private handleInput(beat: number): void {
    const inp = this.game.input;
    for (let col = 0; col < 4; col++) {
      const act = ACTS[this.perm[col]];
      // Hold release
      const h = this.holding[col];
      if (h && !inp.held(act)) {
        if (beat < h.beat + (h.len ?? 0) - 0.25) {
          this.grade('DROP', col);
          this.combo = 0;
        }
        this.holding[col] = null;
      }
      if (h && beat >= h.beat + (h.len ?? 0)) {
        this.holding[col] = null;
        this.fire(col, 2);
        this.popups.add(LANE_X[col], JUDGE_Y - 30, 'HOLD!', LANE_COL[col]);
      }
      if (!inp.pressed(act)) continue;
      this.laneFlash[col] = 1;
      // Parry static bolts first
      const bolt = this.bolts.find((b) => b.alive && b.lane === col && Math.abs(this.beatToSec(b.beat - beat)) <= WINDOWS.great);
      if (bolt) {
        bolt.alive = false;
        bolt.parried = true;
        this.grade('PARRY!', col);
        this.game.audio.sfx('block');
        this.director.feed(6);
        continue;
      }
      let best: Note | null = null;
      for (const n of this.notes) {
        if (n.judged || n.lane !== col) continue;
        if (Math.abs(this.secOffset(n, beat)) > WINDOWS.good) continue;
        if (!best || Math.abs(n.beat - beat) < Math.abs(best.beat - beat)) best = n;
      }
      if (!best) continue; // ghost tapping is free
      best.judged = true;
      if (best.kind === 'glitch') {
        best.hit = true;
        this.grade('GLITCH!', col);
        this.combo = 0;
        this.damagePlayer(1);
        continue;
      }
      const g = judge(this.secOffset(best, beat));
      best.hit = true;
      this.counts[g]++;
      this.grade(g, col);
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.missStreak = 0;
      if (this.combo === 50) this.runFlags.add('combo50');
      if (this.combo % 25 === 0) {
        this.popups.add(W / 2, 120, `${this.combo} COMBO!`, '#ffcf3f');
        this.director.feed(10);
      }
      this.game.audio.sfx(g === 'PERFECT' ? 'perfect' : 'select', 1 + col * 0.12);
      const base = g === 'PERFECT' ? this.fusion.param('note_bullets', 'damagePerfect', 3) : g === 'GREAT' ? 2 : this.fusion.param('note_bullets', 'damageGood', 1);
      this.fire(col, base);
      if (best.kind === 'hold') this.holding[col] = best;
    }
  }

  private fire(col: number, dmg: number): void {
    const fever = this.combo >= 30 ? 1.5 : 1;
    const d = dmg * fever * this.stats.power * this.damageMult;
    if (this.fusion.has('note_shots')) this.shots.push({ lane: col, y: JUDGE_Y - 10, dmg: d, alive: true });
    else this.hitBoss(d * 0.8);
  }

  private hitBoss(d: number): void {
    if (this.won) return;
    this.bHp = Math.max(0, this.bHp - d);
    this.runXp += 0.3;
    if (this.bHp <= 0) {
      this.won = true;
      this.endT = 0;
      this.director.clearAll();
      this.game.audio.sfx('explode');
      this.game.fx.flash('#fff', 0.7);
      this.game.fx.shake(8);
      this.particles.burst(W / 2, 60, ['#fff', '#ff3fd2', '#3fffe0', '#888'], 80, 200);
      return;
    }
    const frac = this.bHp / this.bMaxHp;
    if (this.phase === 1 && frac <= 0.6) this.setPhase(2);
    else if (this.phase === 2 && frac <= 0.25) this.setPhase(3);
  }

  private setPhase(p: number): void {
    this.phase = p;
    this.phaseChangeT = 3;
    this.director.clearAll();
    if (p === 2) {
      this.game.toast('DJ STATIC', 'PHASE 2: GLITCH NOTES — DON\'T HIT THE X!', '#ff3f3f');
      this.game.audio.sfx('warn');
    } else {
      // Tempo up: re-base the beat clock so the chart stays in sync with the restarted song.
      const now = this.beatNow();
      const resume = Math.ceil(now) + 4;
      this.notes = this.notes.filter((n) => n.judged || n.beat < resume - 4);
      this.tempo = clamp(1.15 * this.game.settings.gameSpeed * this.speedMult, 0.5, 1.5);
      this.game.audio.shiftTo('rhythm', this.tempo);
      this.beatBase = now;
      this.nextBlock = resume;
      this.lastBlock = [];
      this.game.genreShift('RHYTHM', 'RHYTHM (DOUBLE TIME)', PAL.rhythm.accent);
    }
  }

  private grade(g: Grade | 'GLITCH!' | 'PARRY!' | 'DROP', col: number): void {
    this.lastGrade = { g, t: 0 };
    const c = g === 'PERFECT' ? '#d6ff3f' : g === 'GREAT' ? '#3fffe0' : g === 'GOOD' ? '#fff' : g === 'PARRY!' ? '#3fe0ff' : '#ff3f3f';
    this.particles.emit(LANE_X[col], JUDGE_Y, g === 'PERFECT' ? 10 : 5, c, 70, 0.4, 2, 0);
  }

  private updateMisses(beat: number): void {
    for (const n of this.notes) {
      if (n.judged) continue;
      if (this.secOffset(n, beat) < -WINDOWS.good) {
        n.judged = true;
        if (n.kind === 'glitch') continue; // correctly ignored
        n.missed = true;
        this.counts.MISS++;
        this.grade('MISS', n.lane);
        this.combo = 0;
        this.missStreak++;
        this.game.audio.sfx('miss');
        const every = { easy: 3, normal: 2, hard: 1 }[this.game.settings.difficulty];
        if (this.fusion.has('lane_bullets')) {
          // DJ Static answers misses with a bolt down that lane (parryable on the line).
          if (this.missStreak % every === 0) this.bolts.push({ lane: n.lane, beat: beat + 2, alive: true, parried: false });
        } else if (this.missStreak % (every + 1) === 0) this.damagePlayer(1);
      }
    }
    for (const b of this.bolts) {
      if (b.alive && this.beatToSec(b.beat - beat) < -WINDOWS.great) {
        b.alive = false;
        this.damagePlayer(1);
      }
    }
    if (this.bolts.length > 30) this.bolts = this.bolts.filter((b) => b.alive);
  }

  private damagePlayer(n: number): void {
    n *= this.takenMult;
    this.hp -= n;
    this.noteDamage(n);
    if (this.hp <= 0) {
      this.lost = true;
      this.endT = 0;
      this.game.audio.play('none');
    }
  }

  private updateShots(dt: number): void {
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.y -= 420 * dt;
      if (s.y < 80) {
        s.alive = false;
        this.hitBoss(s.dmg);
        this.particles.emit(LANE_X[s.lane], 70, 4, '#fff', 60, 0.3, 2, 0);
      }
    }
    if (this.shots.length > 40) this.shots = this.shots.filter((s) => s.alive);
  }

  private score(): number {
    return this.counts.PERFECT * 300 + this.counts.GREAT * 200 + this.counts.GOOD * 100 + this.maxCombo * 50;
  }

  private defeatDialog(): void {
    if (this.endlessRound) {
      this.addBits(80 + Math.floor(this.maxCombo / 2));
      this.finish(true, this.score() + this.hp * 500);
      return;
    }
    this.game.audio.play('ending');
    this.game.say(BOSS_DEFEAT.static, (effects) => {
      const p = this.game.profile;
      if (effects.includes('purge')) {
        p.bossChoices.static = 'purge';
        this.runBits += 150;
        this.runFlags.add('purge');
      } else {
        p.bossChoices.static = 'mercy';
        if (p.bossChoices.bricklord === 'mercy') this.runFlags.add('mercy2');
      }
      this.game.toast('CORE SHARD ACQUIRED', 'DJ STATIC\'S SHARD (2 OF 2)', '#ff3fd2');
      this.addBits(80 + Math.floor(this.maxCombo / 2));
      this.finish(true, this.score() + this.hp * 500, { boss: 'static' });
    });
  }

  // ---- drawing ----------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const pal = PAL.rhythm;
    const beat = this.intro ? this.time * 2 : this.beatNow();
    const pulse = 1 - (beat % 1);
    rect(ctx, 0, 0, W, H, pal.bg0);
    // Environment driven by timing: equalizer skyline grows with the combo, cracks with misses.
    for (let i = 0; i < 24; i++) {
      const x = i * 20;
      const hgt = 20 + this.stage * 90 + Math.abs(Math.sin(i * 1.7 + beat * Math.PI)) * (20 + this.stage * 50);
      rect(ctx, x + 2, H - hgt, 16, hgt, i % 2 ? pal.bg1 : pal.bg2);
      if (this.stage > 0.5) rect(ctx, x + 2, H - hgt, 16, 2, LANE_COL[i % 4]);
    }
    if (this.stage > 0.2) {
      ctx.globalAlpha = this.stage * 0.25 * (this.game.settings.reducedFlash ? 0.4 : 1);
      ctx.fillStyle = '#ff3fd2';
      ctx.beginPath(); ctx.moveTo(40, 0); ctx.lineTo(100 + Math.sin(beat) * 40, H); ctx.lineTo(160 + Math.sin(beat) * 40, H); ctx.fill();
      ctx.fillStyle = '#3fffe0';
      ctx.beginPath(); ctx.moveTo(440, 0); ctx.lineTo(320 - Math.sin(beat) * 40, H); ctx.lineTo(380 - Math.sin(beat) * 40, H); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (this.combo >= 30) drawText(ctx, 'FEVER!', 60, 90 + Math.sin(this.time * 6) * 3, '#ffcf3f', { align: 'center', scale: 2 });
    // Highway
    // Highway with depth: fades into the distance, glowing rails, faint floor reflection of the stage.
    const hw = ctx.createLinearGradient(0, TOP, 0, H);
    hw.addColorStop(0, 'rgba(5,2,16,0.35)');
    hw.addColorStop(0.55, 'rgba(18,8,48,0.7)');
    hw.addColorStop(1, 'rgba(40,16,90,0.8)');
    ctx.fillStyle = hw;
    ctx.fillRect(156, TOP, 168, H - TOP);
    ctx.globalAlpha = 0.35 + pulse * 0.25;
    rect(ctx, 154, TOP, 2, H - TOP, pal.accent);
    rect(ctx, 324, TOP, 2, H - TOP, pal.accent2);
    ctx.globalAlpha = 0.12;
    for (let i = 1; i < 4; i++) rect(ctx, 156 + i * 42, TOP, 1, H - TOP, '#ffffff');
    ctx.globalAlpha = 1;
    const remix = this.director.flag('remix') ? 1.35 : 1;
    const pps = this.scroll * remix;
    for (let col = 0; col < 4; col++) {
      const x = LANE_X[col];
      rect(ctx, x - 18, TOP, 36, H - TOP, col % 2 ? '#ffffff08' : '#ffffff04');
      // Receptors show the arrow this column currently needs (it changes under MIRROR MIX)
      const lf = this.laneFlash[col];
      rect(ctx, x - 17, JUDGE_Y - 9, 34, 18, LANE_COL[col]);
      rect(ctx, x - 15, JUDGE_Y - 7, 30, 14, lf > 0 ? LANE_COL[col] : '#0a0420');
      drawText(ctx, ARROWS[this.perm[col]], x, JUDGE_Y - 7, lf > 0 ? '#000' : LANE_COL[col], { align: 'center', shadow: null, scale: 2 });
    }
    rect(ctx, 156, JUDGE_Y - 1, 168, 2, '#ffffff' + (pulse > 0.8 ? 'ff' : '66'));
    // Notes
    if (!this.intro) {
      for (const n of this.notes) {
        if (n.judged && !(n.kind === 'hold' && this.holding[n.lane] === n)) continue;
        const dy = this.beatToSec(n.beat - beat) * pps;
        const y = JUDGE_Y - dy;
        if (y < TOP || y > H + 10) continue;
        const x = LANE_X[n.lane];
        if (n.kind === 'glitch') {
          rect(ctx, x - 12, y - 6, 24, 12, '#300');
          drawText(ctx, 'X', x, y - 3, '#ff3f3f', { align: 'center', shadow: null });
          rect(ctx, x - 12 + Math.random() * 4, y - 6, 2, 12, '#ff3f3f');
          continue;
        }
        if (n.kind === 'hold') {
          const len = this.beatToSec(n.len ?? 0) * pps;
          rect(ctx, x - 4, Math.max(TOP, y - len), 8, Math.min(len, y - TOP), LANE_COL[n.lane] + '88');
        }
        // Drop shadow + soft glow lift notes off the highway.
        ctx.globalAlpha = 0.35;
        rect(ctx, x - 14, y - 3, 28, 12, '#000');
        ctx.globalAlpha = 0.22;
        rect(ctx, x - 17, y - 9, 34, 18, LANE_COL[n.lane]);
        ctx.globalAlpha = 1;
        rect(ctx, x - 14, y - 6, 28, 12, LANE_COL[n.lane]);
        rect(ctx, x - 12, y - 4, 24, 3, '#ffffff99');
        rect(ctx, x - 14, y + 4, 28, 2, 'rgba(0,0,0,0.3)');
        drawText(ctx, ARROWS[this.perm[n.lane]], x, y - 3, '#000', { align: 'center', shadow: null });
      }
      // Static bolts (parry on the line)
      for (const b of this.bolts) {
        if (!b.alive) continue;
        const y = JUDGE_Y - this.beatToSec(b.beat - beat) * pps * 1.5;
        if (y < TOP) {
          rect(ctx, LANE_X[b.lane] - 16, TOP, 32, 4, Math.floor(this.time * 5) % 2 ? '#ff3f3f' : '#600');
          continue;
        }
        for (let k = 0; k < 4; k++) rect(ctx, LANE_X[b.lane] - 8 + Math.random() * 16, y - 8 + k * 4, 3, 3, '#fff');
        rect(ctx, LANE_X[b.lane] - 6, y - 6, 12, 12, '#ff3f3f88');
      }
      for (const s of this.shots) if (s.alive) rect(ctx, LANE_X[s.lane] - 2, s.y - 6, 4, 12, '#d6ff3f');
    }
    this.drawDJ(ctx, beat);
    if (this.lastGrade && this.lastGrade.t < 0.6) {
      const g = this.lastGrade.g;
      const c = g === 'PERFECT' ? '#d6ff3f' : g === 'GREAT' ? '#3fffe0' : g === 'GOOD' ? '#fff' : g === 'PARRY!' ? '#3fe0ff' : '#ff3f3f';
      drawText(ctx, g, 240, 160 - this.lastGrade.t * 10, c, { align: 'center', scale: 2 });
    }
    if (this.combo >= 4) drawText(ctx, `${this.combo}`, 240, 180, '#fff', { align: 'center', scale: 2 });
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    this.drawHud(ctx);
  }

  private drawDJ(ctx: CanvasRenderingContext2D, beat: number): void {
    const x = W / 2, y = 72;
    const bob = Math.floor(beat * 2) % 2;
    if (this.won && this.endT > 1) return;
    // Turntable booth
    rect(ctx, x - 60, y + 6, 120, 14, '#1a0a33');
    rect(ctx, x - 52, y + 2, 30, 6, '#222');
    rect(ctx, x + 22, y + 2, 30, 6, '#222');
    rect(ctx, x - 40 + Math.sin(beat * Math.PI) * 4, y + 3, 6, 3, '#ff3fd2');
    // TV-head body
    rect(ctx, x - 10, y - 14 + bob, 20, 18, '#2a2a3a');
    rect(ctx, x - 16, y - 40 + bob, 32, 26, '#3a3a4a');
    for (let i = 0; i < 30; i++) {
      const sx = x - 14 + ((i * 7 + Math.floor(this.time * 30)) % 28);
      const sy = y - 38 + bob + ((i * 11) % 22);
      rect(ctx, sx, sy, 2, 1, i % 4 ? '#ffffff66' : '#ff3fd2');
    }
    rect(ctx, x - 10, y - 30 + bob, 20, 5, '#000');
    rect(ctx, x - 9, y - 29 + bob, 8, 3, '#3fffe0');
    rect(ctx, x + 1, y - 29 + bob, 8, 3, '#3fffe0');
    rect(ctx, x - 2, y - 46 + bob, 1, 6, '#888');
    rect(ctx, x + 4, y - 48 + bob, 1, 8, '#888');
    if (this.director.flag('remix')) drawText(ctx, 'SCRATCH!', x, y + 26, '#ff3f3f', { align: 'center' });
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    hearts(ctx, 6, 6, this.hp, this.stats.maxHp);
    drawText(ctx, 'DJ STATIC', W / 2, 4, '#ff3fd2', { align: 'center' });
    bar(ctx, W / 2 - 80, 14, 160, 4, this.bHp / this.bMaxHp, this.phase === 3 ? '#ff3f3f' : '#ff3fd2', '#200', '#fff');
    rect(ctx, W / 2 - 80 + 160 * 0.6, 13, 1, 6, '#fff');
    rect(ctx, W / 2 - 80 + 160 * 0.25, 13, 1, 6, '#fff');
    drawText(ctx, `PHASE ${this.phase}`, 6, 16, '#fff');
    drawText(ctx, `MAX COMBO ${this.maxCombo}`, 6, 26, '#ffcf3f');
    drawText(ctx, `P ${this.counts.PERFECT}  G ${this.counts.GREAT}`, 6, 36, '#d6ff3f');
    drawText(ctx, `OK ${this.counts.GOOD}  MISS ${this.counts.MISS}`, 6, 46, '#aaa');
    drawText(ctx, `${Math.round(this.bpm)} BPM`, 6, 56, '#3fffe0');
    this.drawChaosHud(ctx, W - 106, 26);
    if (this.won && this.endT < 3) drawText(ctx, 'TRACK CLEARED!', W / 2, 110, '#d6ff3f', { align: 'center', scale: 3 });
    if (this.lost) drawText(ctx, 'RECORD SCRATCHED', W / 2, 110, '#ff3f3f', { align: 'center', scale: 2 });
    this.drawHint(ctx, 'ARROW KEYS (OR WASD) ON THE BEAT • AVOID RED X • PARRY BOLTS ON THE LINE');
    this.drawSeed(ctx);
  }
}
