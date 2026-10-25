/**
 * THE HIGH SCORE — the final boss. A cabinet marquee made of every initials-entry ever typed.
 * You drift in the bottom of the arena, firing automatically, while it fills the screen with
 * bullets across three phases:
 *   1 ARCADE      (shmup)    aimed fans, rings and rain
 *   2 FIGHT NIGHT (fighter)  it guards, telegraphs column and row slams, then drops open for a counter
 *   3 SUDDEN DEATH (remix)   every pattern at once at a faster tempo
 * Graze bullets (pass close without being hit) to charge bombs. Its score counts down as it takes damage.
 *
 * Controls: arrows move, hold X for precise (slow) movement, Z or C fires a bomb. Shots are automatic.
 * Touch: drag to move, tap to bomb, hold a second finger for precise movement.
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import type { DirectorContext } from '../chaos/director.ts';
import { H, W, PAL, backdrop, glow, rect, bar, hearts, clamp } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { drawCass, drawHighScore } from '../render/actors.ts';
import { HIGHSCORE_DEFEAT, HIGHSCORE_INTRO } from '../data/story.ts';
import type { Rng } from '../core/rng.ts';

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  grazed: boolean;
}

interface Shot {
  x: number;
  y: number;
}

interface Beam {
  kind: 'col' | 'row';
  pos: number;
}

type Phase = 'intro' | 'fight' | 'shift' | 'dying' | 'won' | 'lost';
type SlamState = 'guard' | 'telegraph' | 'strike' | 'open';

export const PHASE_NAMES = ['ARCADE', 'FIGHT NIGHT', 'SUDDEN DEATH'];
const PHASE_SPLIT = [0.66, 0.33];
const ZONE_TOP = 120;
const ARENA = { left: 16, right: W - 16, bottom: H - 14 };
const HUES = ['#ffcf3f', '#ff3fd2', '#3fe0ff', '#ff3f5a'];
const GLOWS = ['255,207,63', '255,63,210', '63,224,255', '255,63,90'];
const START_BOMBS = 2;
const MAX_BOMBS = 3;
const GRAZE_PER_BOMB = 45;
const GRAZE_R = 12;
const HIT_R = 4.6;
const BOSS_Y = 54;

export class HighScoreMode extends ModeBase {
  id = 'highscore';
  crt = 0.25;
  hp: number;
  gesture = 'topdown' as const;
  gestureHint = 'DRAG: MOVE • SHOTS ARE AUTOMATIC • TAP: BOMB • 2ND FINGER HELD: PRECISE MOVE';
  phase: Phase = 'intro';
  bossPhase = 0;
  readonly bMax: number;
  bHp: number;
  bx = 240;
  by = BOSS_Y;
  px = 240;
  py = 226;
  face = 1;
  moving = false;
  iframes = 0;
  bombs = START_BOMBS;
  graze = 0;
  private grazeCharge = 0;
  private bombFlash = 0;
  bullets: Bullet[] = [];
  shots: Shot[] = [];
  beams: Beam[] = [];
  slam: SlamState = 'guard';
  private slamT = 0;
  private fireT = 0;
  private emitT = 1.5;
  private ringT = 2;
  private spin = 0;
  private cycle = 0;
  private shiftT = 0;
  endT = 0;
  private introT = 0.4;
  private bossFlash = 0;
  private banner: { text: string; color: string; t: number } | null = null;
  private readonly volleyRng: Rng;

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'highscore', opts);
    this.hp = this.stats.maxHp;
    this.applyCarry();
    if (this.hasPerk('bombbag')) this.bombs += 2;
    const d = { easy: 0.8, normal: 1, hard: 1.25 }[game.settings.difficulty];
    this.bMax = Math.round(640 * d * (1 + 0.5 * (this.tier - 1)));
    this.bHp = this.bMax;
    this.volleyRng = this.rng.fork(0x4153);
  }

  enter(): void {
    this.game.music('hs1');
    if (!this.game.profile.lore.includes('highscore_intro')) {
      this.game.profile.lore.push('highscore_intro');
      this.game.say(HIGHSCORE_INTRO, () => (this.introT = 0.6));
    }
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: this.phase === 'fight', bossActive: true };
  }

  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  /** Bullet speed dial: difficulty, ENDLESS/GAUNTLET tier and how far into the fight it is. */
  private get speedK(): number {
    return 1.08 * Math.sqrt(this.diffMult) * (1 + 0.1 * this.bossPhase);
  }

  /** Damage one shot does right now: the guard phase shrugs shots off, the open phase takes them hard. */
  get shotDamage(): number {
    if (this.bossPhase === 1) return this.slam === 'open' ? 2.5 : 0.35;
    return 1;
  }

  // ---- simulation ------------------------------------------------------------------
  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    this.tickShared(dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.bossFlash = Math.max(0, this.bossFlash - dt);
    this.bombFlash = Math.max(0, this.bombFlash - dt);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 2) this.banner = null;
    }
    this.particles.update(dt);

    if (this.phase === 'won' || this.phase === 'lost') {
      this.endT += dt;
      if (this.phase === 'lost' && this.endT > 1.8) this.finish(false, Math.floor((1 - this.bHp / this.bMax) * 8000) + this.graze * 5);
      return;
    }
    if (this.phase === 'dying') {
      this.endT += dt;
      if (Math.floor(this.endT * 12) !== Math.floor((this.endT - dt) * 12)) this.particles.burst(this.bx + (this.volleyRng.next() - 0.5) * 90, this.by + (this.volleyRng.next() - 0.5) * 30, ['#ffcf3f', '#fff', '#ff3fd2'], 8, 90);
      if (this.endT > 2.4) this.defeatDialog();
      return;
    }
    if (this.phase === 'intro') {
      if (this.game.inDialog) return;
      this.introT -= dt;
      this.updatePlayer(dt, false);
      if (this.introT <= 0) {
        this.phase = 'fight';
        this.say('ROUND 1: ARCADE', '#ffcf3f');
        this.game.audio.sfx('warn');
      }
      return;
    }
    if (this.phase === 'shift') {
      this.shiftT -= dt;
      this.updatePlayer(dt, false);
      this.updateShots(dt, false);
      if (this.shiftT <= 0) this.phase = 'fight';
      return;
    }

    this.updatePlayer(dt, true);
    this.updateBoss(dt);
    this.updateShots(dt, true);
    this.updateBullets(dt);
    if (this.hp <= 0 && (this.phase as Phase) !== 'dying') this.lose();
  }

  private say(text: string, color: string): void {
    this.banner = { text, color, t: 0 };
  }

  private updatePlayer(dt: number, armed: boolean): void {
    const inp = this.game.input;
    const ax = inp.axisX();
    const ay = inp.axisY();
    this.moving = ax !== 0 || ay !== 0;
    const focus = inp.held('attack');
    const len = Math.hypot(ax, ay) || 1;
    const speed = (focus ? 62 : 125) * (this.director.flag('mud') ? 0.8 : 1);
    this.px = clamp(this.px + (ax / len) * speed * dt, ARENA.left, ARENA.right);
    this.py = clamp(this.py + (ay / len) * speed * dt, ZONE_TOP, ARENA.bottom);
    if (ax) this.face = ax > 0 ? 1 : -1;
    if (!armed) return;
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = 0.1;
      this.shots.push({ x: this.px - 4, y: this.py - 12 }, { x: this.px + 4, y: this.py - 12 });
    }
    if (inp.pressed('jump') || inp.pressed('confirm') || inp.pressed('special')) this.bomb();
  }

  /** Clears the screen and hurts the boss; costs a bomb. */
  bomb(): void {
    if (this.bombs <= 0 || this.phase !== 'fight') return;
    this.bombs--;
    this.bombFlash = 0.5;
    this.iframes = Math.max(this.iframes, 1.2);
    this.bullets.length = 0;
    this.game.audio.sfx('bomb');
    this.game.fx.flash('#ffffff', 0.3);
    this.particles.burst(this.px, this.py, ['#fff', '#ffcf3f', '#3fe0ff'], 30, 150);
    this.damageBoss(25);
  }

  private updateShots(dt: number, armed: boolean): void {
    let keep = 0;
    let dealt = 0;
    for (const s of this.shots) {
      s.y -= 360 * dt;
      let alive = s.y > -8;
      if (alive && armed && this.phase === 'fight' && Math.abs(s.x - this.bx) < 52 && Math.abs(s.y - this.by) < 22) {
        dealt += this.shotDamage;
        alive = false;
      }
      if (alive) this.shots[keep++] = s;
    }
    this.shots.length = keep;
    // Damage lands after the pass: it can end the fight and clear this very list.
    if (dealt > 0) this.damageBoss(dealt);
  }

  /** Applies damage, handles the phase thresholds and the end of the fight. */
  damageBoss(amount: number): void {
    if (this.phase !== 'fight' || amount <= 0) return;
    this.bHp = Math.max(0, this.bHp - amount);
    this.bossFlash = 0.06;
    if (this.bHp <= 0) {
      this.phase = 'dying';
      this.endT = 0;
      this.bullets.length = 0;
      this.beams.length = 0;
      this.shots.length = 0;
      this.game.audio.sfx('explode');
      this.game.fx.flash('#ffffff', 0.5);
      return;
    }
    const frac = this.bHp / this.bMax;
    if (this.bossPhase < 2 && frac <= PHASE_SPLIT[this.bossPhase]) this.nextPhase();
  }

  private nextPhase(): void {
    this.bossPhase++;
    this.phase = 'shift';
    this.shiftT = 2.2;
    this.bullets.length = 0;
    this.beams.length = 0;
    this.slam = 'guard';
    this.slamT = 0;
    this.emitT = 1.2;
    this.ringT = 2.4;
    this.iframes = Math.max(this.iframes, 2.2);
    this.game.audio.sfx('chaos');
    this.game.fx.shake(6);
    this.game.music(this.bossPhase === 1 ? 'hs2' : 'hs3');
    this.game.genreShift(this.bossPhase === 1 ? 'SHMUP' : 'FIGHTER', this.bossPhase === 1 ? 'FIGHTER' : 'REMIX', this.bossPhase === 1 ? '#ff6f3f' : '#ff3fd2');
    this.say(`ROUND ${this.bossPhase + 1}: ${PHASE_NAMES[this.bossPhase]}`, this.bossPhase === 1 ? '#ff6f3f' : '#ff3fd2');
    this.particles.burst(this.bx, this.by, ['#fff', '#ffcf3f'], 24, 120);
  }

  private updateBoss(dt: number): void {
    const t = this.time;
    if (this.bossPhase === 1) {
      this.updateSlams(dt);
      return;
    }
    const sway = this.bossPhase === 2 ? 1.1 : 0.7;
    this.bx = 240 + Math.sin(t * sway) * (this.bossPhase === 2 ? 170 : 140);
    this.by = BOSS_Y + Math.sin(t * 1.6) * 3;
    this.emitT -= dt;
    this.ringT -= dt;
    this.spin += dt * (this.bossPhase === 2 ? 2.2 : 0);
    if (this.bossPhase === 0) {
      if (this.emitT <= 0) this.volley(['fan', 'ring', 'rain'][this.cycle++ % 3]);
    } else if (this.emitT <= 0) {
      // Everything at once, on a short fuse.
      this.volley(['spiral', 'rain', 'fan'][this.cycle++ % 3]);
    }
    if (this.bossPhase === 2 && this.ringT <= 0) {
      this.ringT = 2.6;
      this.volley('ring');
    }
  }

  /** FIGHT NIGHT: guard, telegraph a set of slams, strike, then drop open for a counter. */
  private updateSlams(dt: number): void {
    this.slamT += dt;
    this.bx += (240 + Math.sin(this.time * 0.6) * 120 - this.bx) * Math.min(1, dt * 3);
    const targetY = this.slam === 'open' ? BOSS_Y + 36 : BOSS_Y;
    this.by += (targetY - this.by) * Math.min(1, dt * 6);
    if (this.slam === 'guard') {
      this.emitT -= dt;
      if (this.emitT <= 0) this.volley('fan');
      if (this.slamT > 2.4) this.enterSlam('telegraph');
    } else if (this.slam === 'telegraph') {
      if (this.slamT > 1) this.enterSlam('strike');
    } else if (this.slam === 'strike') {
      if (this.iframes <= 0) {
        for (const b of this.beams) {
          const hit = b.kind === 'col' ? Math.abs(this.px - b.pos) < 17 : Math.abs(this.py - 4 - b.pos) < 11;
          if (hit) {
            this.hurt(null);
            break;
          }
        }
      }
      if (this.slamT > 0.45) this.enterSlam('open');
    } else if (this.slamT > 2.8) this.enterSlam('guard');
  }

  private enterSlam(next: SlamState): void {
    this.slam = next;
    this.slamT = 0;
    if (next === 'telegraph') {
      const r = this.volleyRng;
      this.beams.length = 0;
      // Two columns (one aimed at the player's lane) and a row; the arena is always crossable.
      this.beams.push({ kind: 'col', pos: clamp(this.px + r.range(-14, 14), 40, W - 40) });
      this.beams.push({ kind: 'col', pos: r.range(40, W - 40) });
      this.beams.push({ kind: 'row', pos: r.range(ZONE_TOP + 20, ARENA.bottom - 10) });
      this.game.audio.sfx('warn');
    } else if (next === 'strike') {
      this.game.audio.sfx('slam');
      this.game.fx.shake(4);
    } else if (next === 'open') {
      this.beams.length = 0;
      this.say('OPEN! HIT IT NOW', '#7dff6b');
      this.game.audio.sfx('powerup');
    } else {
      this.emitT = 0.4;
    }
  }

  /** Fires one volley and sets the delay until the next. */
  private volley(kind: string): void {
    const sk = this.speedK;
    const r = this.volleyRng;
    const add = (x: number, y: number, ang: number, speed: number, hue: number) => this.bullets.push({ x, y, vx: Math.cos(ang) * speed * sk, vy: Math.sin(ang) * speed * sk, hue, grazed: false });
    const bx = this.bx, by = this.by + 14;
    const hard = this.game.settings.difficulty === 'hard' ? 1 : 0;
    switch (kind) {
      case 'fan': {
        const n = 7 + this.bossPhase * 2 + hard * 2;
        const aim = Math.atan2(this.py - by, this.px - bx);
        for (let i = 0; i < n; i++) add(bx, by, aim + (i - (n - 1) / 2) * (1.4 / (n - 1)), this.bossPhase === 1 ? 62 : 78, 0);
        this.emitT = this.bossPhase === 0 ? 1.15 : this.bossPhase === 1 ? 1.7 : 1.0;
        break;
      }
      case 'ring': {
        const n = 20 + this.bossPhase * 4 + hard * 3;
        const off = r.range(0, Math.PI * 2);
        for (let i = 0; i < n; i++) add(bx, by, off + (i / n) * Math.PI * 2, 66, 1);
        this.emitT = this.bossPhase === 0 ? 1.1 : 0.8;
        break;
      }
      case 'rain': {
        for (let k = 0; k < 2 + this.bossPhase; k++) add(r.range(ARENA.left, ARENA.right), 22, Math.PI / 2, 90, 2);
        add(clamp(this.px + r.range(-20, 20), ARENA.left, ARENA.right), 22, Math.PI / 2, 98, 2);
        this.emitT = this.bossPhase === 0 ? 0.55 : 0.4;
        break;
      }
      case 'spiral': {
        this.spin += 0.55;
        for (let a = 0; a < 3; a++) add(bx, by, this.spin + (a * Math.PI * 2) / 3, 74, 3);
        this.emitT = 0.11;
        break;
      }
    }
  }

  private updateBullets(dt: number): void {
    const wind = this.director.flag('crosswind') ? Math.sin(this.time * 1.3) * 30 : 0;
    const slow = this.director.flag('mud') ? 0.85 : 1;
    let keep = 0;
    let struck: Bullet | null = null;
    for (const b of this.bullets) {
      b.vx += wind * dt;
      b.x += b.vx * dt * slow;
      b.y += b.vy * dt * slow;
      if (b.x < -10 || b.x > W + 10 || b.y < 6 || b.y > H + 10) continue;
      const d = Math.hypot(b.x - this.px, b.y - (this.py - 6));
      if (this.iframes <= 0 && !struck && d < HIT_R + 2) {
        struck = b;
        continue;
      }
      if (!b.grazed && d < GRAZE_R && this.iframes <= 0) {
        b.grazed = true;
        this.graze++;
        this.grazeCharge++;
        this.particles.burst(b.x, b.y, ['#fff'], 1, 30);
        if (this.grazeCharge >= GRAZE_PER_BOMB && this.bombs < MAX_BOMBS) {
          this.grazeCharge = 0;
          this.bombs++;
          this.popups.add(this.px, this.py - 22, '+BOMB', '#3fe0ff');
          this.game.audio.sfx('powerup');
        } else this.game.audio.sfx('graze');
      }
      this.bullets[keep++] = b;
    }
    this.bullets.length = keep;
    // Hurt after the pass: it sweeps the bullet list, which must not happen mid-iteration.
    if (struck) this.hurt(struck);
  }

  private hurt(from: Bullet | null): void {
    if (this.iframes > 0) return;
    const dmg = this.takenMult;
    this.hp = Math.max(0, this.hp - dmg);
    this.iframes = 1.7;
    this.noteDamage(dmg);
    this.popups.add(this.px, this.py - 22, `-${dmg}`, '#ff3f5a');
    if (from) from.grazed = true;
    // A hit sweeps the bullets nearby, so one mistake is not two.
    this.bullets = this.bullets.filter((b) => Math.hypot(b.x - this.px, b.y - this.py) > 34);
  }

  private lose(): void {
    this.phase = 'lost';
    this.endT = 0;
    this.bullets.length = 0;
    this.game.audio.sfx('explode');
    this.say('GAME OVER', '#ff3f5a');
  }

  private defeatDialog(): void {
    if (this.phase === 'won') return;
    this.phase = 'won';
    const done = (mercy: boolean) => {
      const score = Math.floor(20000 + this.hp * 3000 + this.graze * 10 + Math.max(0, 8000 - this.time * 20) + this.runBits * 10);
      if (!mercy) this.runBits += 300;
      if (this.damageTaken === 0) this.runFlags.add('perfect_score');
      this.addBits(120);
      this.finish(true, score, { boss: 'highscore' });
    };
    if (this.endlessRound || this.opts.rush) {
      done(true);
      return;
    }
    this.game.say(HIGHSCORE_DEFEAT, (effects) => {
      const p = this.game.profile;
      const mercy = !effects.includes('purge');
      p.bossChoices.highscore = mercy ? 'mercy' : 'purge';
      this.game.toast('THE LAST PAGE', 'THE MANUAL IS COMPLETE', '#ffcf3f');
      done(mercy);
    });
  }

  // ---- drawing ---------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const pal = PAL.highscore;
    backdrop(ctx, pal.bg0, pal.bg1);
    this.drawBoard(ctx);
    const col = this.bossPhase === 0 ? '255,207,63' : this.bossPhase === 1 ? '255,111,63' : '255,63,210';
    glow(ctx, this.bx, this.by, 130, col, 0.14 + Math.sin(this.time * 3) * 0.03);
    this.drawBeams(ctx);
    this.drawBoss(ctx);
    for (const s of this.shots) {
      rect(ctx, s.x - 1, s.y - 4, 2, 7, '#fff7a8');
      rect(ctx, s.x - 2, s.y - 2, 4, 2, '#ffcf3f66');
    }
    for (const b of this.bullets) this.drawBullet(ctx, b);
    this.drawPlayer(ctx);
    if (this.bombFlash > 0) {
      // REDUCED FLASHING caps the white-out, like every other screen flash.
      ctx.globalAlpha = Math.min(this.bombFlash, this.game.settings.reducedFlash ? 0.12 : 0.5);
      rect(ctx, 0, 0, W, H, '#ffffff');
      ctx.globalAlpha = 1;
    }
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    this.drawHud(ctx);
  }

  /** The leaderboard scrolling down both sides: every name that ever sat at the top. */
  private drawBoard(ctx: CanvasRenderingContext2D): void {
    const names = ['AAA', 'ZED', 'ACE', 'JOE', 'MAX', 'KAT', 'BOB', 'REX', 'ZZZ', 'XXX', 'CAS', 'DOG'];
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 10; i++) {
      const y = ((i * 28 + this.time * 14) % 300) - 20;
      const label = `${names[(i * 5) % names.length]} ${String(999000 - i * 7431).padStart(6, '0')}`;
      drawText(ctx, label, 8, y, '#ffcf3f', { shadow: null });
      drawText(ctx, label, W - 8, y, '#ffcf3f', { align: 'right', shadow: null });
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 12; i++) rect(ctx, 0, ZONE_TOP + i * 12, W, 1, 'rgba(255,255,255,0.03)');
  }

  private drawBeams(ctx: CanvasRenderingContext2D): void {
    for (const b of this.beams) {
      const strike = this.slam === 'strike';
      const pulse = 0.35 + Math.sin(this.time * 14) * 0.15;
      ctx.globalAlpha = strike ? 0.95 : pulse;
      const col = strike ? '#ffffff' : '#ff3f5a';
      if (b.kind === 'col') {
        rect(ctx, b.pos - 17, 28, 34, H - 28, strike ? '#ff6f3f' : '#ff3f5a33');
        rect(ctx, b.pos - 17, 28, 1, H - 28, col);
        rect(ctx, b.pos + 16, 28, 1, H - 28, col);
      } else {
        rect(ctx, 0, b.pos - 11, W, 22, strike ? '#ff6f3f' : '#ff3f5a33');
        rect(ctx, 0, b.pos - 11, W, 1, col);
        rect(ctx, 0, b.pos + 10, W, 1, col);
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawBoss(ctx: CanvasRenderingContext2D): void {
    const mood = this.phase === 'dying' || this.phase === 'won' ? 'dead' : this.slam === 'open' && this.bossPhase === 1 ? 'open' : this.bossPhase >= 1 ? 'angry' : 'calm';
    const shake = this.phase === 'dying' ? Math.round(Math.sin(this.endT * 60) * 3) : 0;
    ctx.save();
    ctx.translate(shake, 0);
    drawHighScore(ctx, this.bx, this.by, this.time, 104, 44, mood);
    const score = String(Math.ceil((this.bHp / this.bMax) * 999999)).padStart(6, '0');
    drawText(ctx, score, this.bx, this.by - 6, this.bossFlash > 0 ? '#fff' : mood === 'open' ? '#7dff6b' : '#ffcf3f', { align: 'center', scale: 2, shadow: null });
    if (this.bossPhase === 1 && this.slam === 'guard') drawText(ctx, 'GUARDED', this.bx, this.by + 14, '#9a9ab8', { align: 'center', shadow: null });
    ctx.restore();
  }

  private drawBullet(ctx: CanvasRenderingContext2D, b: Bullet): void {
    glow(ctx, b.x, b.y, 7, GLOWS[b.hue], 0.5);
    rect(ctx, b.x - 2, b.y - 2, 5, 5, HUES[b.hue]);
    rect(ctx, b.x - 1, b.y - 1, 3, 3, '#ffffff');
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'lost') return;
    rect(ctx, this.px - 6, this.py - 1, 12, 3, 'rgba(0,0,0,0.4)');
    const blink = this.iframes > 0 && Math.floor(this.time * 10) % 2 === 0 && this.phase === 'fight';
    if (!blink) drawCass(ctx, { x: this.px, y: this.py, facing: this.face, pose: this.moving ? 'run' : 'idle', t: this.time, scale: 1 }, this.game.profile.character);
    // The real hitbox is tiny: show it while moving precisely.
    if (this.game.input.held('attack')) {
      rect(ctx, this.px - 2, this.py - 8, 5, 5, '#ffffff');
      rect(ctx, this.px - 1, this.py - 7, 3, 3, '#ff3f5a');
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    rect(ctx, 0, 0, W, 14, 'rgba(0,0,0,0.65)');
    hearts(ctx, 4, 2, this.hp, this.stats.maxHp);
    drawText(ctx, `BOMBS ${'★'.repeat(this.bombs)}${'☆'.repeat(Math.max(0, 3 - this.bombs))}`, 118, 3, '#3fe0ff');
    drawText(ctx, `GRAZE ${this.graze}`, 218, 3, '#fff');
    drawText(ctx, `BITS ${this.runBits}`, 288, 3, '#ffcf3f');
    drawText(ctx, PHASE_NAMES[this.bossPhase], W - 6, 3, this.bossPhase === 0 ? '#ffcf3f' : this.bossPhase === 1 ? '#ff6f3f' : '#ff3fd2', { align: 'right' });
    // Boss score bar with phase ticks.
    bar(ctx, 20, 16, W - 40, 4, this.bHp / this.bMax, this.bossPhase === 1 && this.slam === 'open' ? '#7dff6b' : '#ffcf3f', '#2a1a05', '#ffffff55');
    for (const f of PHASE_SPLIT) rect(ctx, 20 + (W - 40) * f, 15, 1, 6, '#fff');
    // Graze meter next to the player's zone.
    bar(ctx, 6, H - 8, 60, 3, this.grazeCharge / GRAZE_PER_BOMB, '#3fe0ff', '#0a1a24', '#ffffff44');
    this.drawChaosHud(ctx, W - 106, 24);
    if (this.banner) {
      const a = this.banner.t < 0.2 ? this.banner.t / 0.2 : this.banner.t > 1.6 ? 1 - (this.banner.t - 1.6) / 0.4 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      drawText(ctx, this.banner.text, W / 2, 104, this.banner.color, { align: 'center', scale: 2 });
      ctx.globalAlpha = 1;
    }
    this.drawHint(ctx, 'ARROWS MOVE • HOLD X FOR PRECISE MOVEMENT • Z BOMB • SHOTS ARE AUTOMATIC');
    this.drawSeed(ctx);
  }
}
