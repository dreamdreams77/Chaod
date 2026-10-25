/**
 * BOSS BEATDOWN — one-on-one fighter vs BRICKLORD MAX, who gets bored of
 * fighting games at low health and turns the battle into a bullet hell.
 *
 * Mutations honoured:
 *  - GRINDCORE (fighter+rpg): combo hits earn XP mid-fight; level ups raise damage instantly.
 *  - LINE CLEAR KO (puzzle+fighter): falling blocks stack in a 9-wide grid; completing a row
 *    crushes the boss. Blocks target the player's column, so you "place" them by baiting drops.
 * Chaos flags honoured: low_gravity, giant, bouncy, boss_steal (boss copies your special).
 */
import type { Game } from '../game.ts';
import { ModeBase } from './base.ts';
import { DirectorContext } from '../chaos/director.ts';
import { H, W, PAL, rect, clamp, approach, hearts, bar } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { drawCass, Pose } from '../render/actors.ts';
import { BOSS_DEFEAT } from '../data/story.ts';

const FLOOR = 230;
const LEFT = 24;
const RIGHT = 456;
const COLS = 9;
const CW = (RIGHT - LEFT) / COLS; // 48
const MAX_STACK = 3;
const BCOL = ['#ff3f3f', '#3fa9ff', '#ffd23f', '#7dff6b', '#b07aff', '#ff6f3f'];

type BossMove = 'idle' | 'walk' | 'stomp' | 'punch' | 'throw' | 'stuck' | 'dizzy' | 'float' | 'tired' | 'dead' | 'steal';

interface Proj { x: number; y: number; vx: number; vy: number; r: number; kind: 'block' | 'wave' | 'bullet' | 'shock' | 'pwave' | 'pshot'; alive: boolean; bounces: number; color: string }
interface Faller { col: number; y: number; vy: number; warn: number; color: string; alive: boolean }

export class BeatdownMode extends ModeBase {
  id = 'beatdown';
  crt = 0.25;
  // player
  px = 100; py = FLOOR; vx = 0; vy = 0;
  facing = 1;
  onGround = true;
  airJumps = 0;
  hp: number;
  energy: number;
  energyT = 0;
  iframes = 0;
  blocking = false;
  combo = 0;
  comboT = 0;
  attackT = 0;
  attackKind = 0;
  hitstun = 0;
  fightXp = 0;
  fightLevel = 1;
  // boss
  bx = 360; by = FLOOR; bvx = 0; bvy = 0;
  bFacing = -1;
  bMaxHp: number;
  bHp: number;
  bMove: BossMove = 'idle';
  bT = 1.5;
  bFlash = 0;
  stun = 0;
  phase = 1;
  attackHit = false;
  patternT = 0;
  spiral = 0;
  // world
  grid: (string | null)[][] = []; // [row][col], row 0 = floor level
  fallers: Faller[] = [];
  projs: Proj[] = [];
  rainT = 3;
  intro = 2.2;
  deadT = 0;
  won = false;
  lines = 0;
  readonly rematchMult: number;

  constructor(game: Game, opts: { rematch?: boolean } = {}) {
    super(game, 'beatdown', opts);
    this.hp = this.stats.maxHp;
    this.energy = this.stats.energy;
    this.rematchMult = opts.rematch ? 1.25 : 1;
    this.bMaxHp = Math.round(140 * { easy: 0.75, normal: 1, hard: 1.3 }[game.settings.difficulty] * this.rematchMult);
    this.bHp = this.bMaxHp;
    for (let r = 0; r < MAX_STACK; r++) this.grid.push(new Array(COLS).fill(null));
  }

  enter(): void {
    this.game.music('beatdown');
    this.game.say([
      { who: 'brick', name: 'BRICKLORD MAX', text: this.opts.rematch ? 'You again! This time I brought EXTRA rows.' : 'ANOTHER challenger? Fine. I am the FINAL LEVEL. I am ALWAYS the final level.' },
      { who: 'manual', name: 'THE MANUAL', text: 'X attacks (chain 3 for a combo). C fires a CART WAVE. Hold DOWN to block. When he slams, his core glows — punish it!' },
    ]);
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: this.intro <= 0 && this.bMove !== 'dead' && this.phase !== 0, bossActive: true };
  }
  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }
  get giant(): boolean {
    return this.director.flag('giant');
  }
  get bSpeed(): number {
    return (this.phase >= 2 ? 1.25 : 1) * this.rematchMult * Math.sqrt(this.diffMult);
  }

  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    this.tickShared(dt);
    if (this.intro > 0) {
      if (!this.game.inDialog) this.intro -= dt;
      return;
    }
    if (this.won) {
      this.deadT += dt;
      if (this.deadT < 2.5 && Math.random() < 0.5) this.particles.burst(this.bx + (Math.random() - 0.5) * 50, this.by - Math.random() * 70, BCOL, 6, 120);
      if (this.deadT > 2.5 && this.deadT < 100) {
        this.deadT = 100;
        this.defeatDialog();
      }
      this.particles.update(0);
      return;
    }
    if (this.hp <= 0) {
      this.deadT += dt;
      if (this.deadT > 1.8) this.finish(false, Math.floor((1 - this.bHp / this.bMaxHp) * 5000), { boss: undefined });
      return;
    }
    this.updatePlayer(dt);
    this.updateBoss(dt);
    this.updateRain(dt);
    this.updateProjs(dt);
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;
  }

  // ---- player ----------------------------------------------------------------------
  private updatePlayer(dt: number): void {
    const inp = this.game.input;
    const grav = 900 * (this.director.flag('low_gravity') ? 0.45 : 1);
    this.iframes = Math.max(0, this.iframes - dt);
    this.attackT = Math.max(0, this.attackT - dt);
    this.energyT += dt;
    if (this.energyT > (this.phase === 3 ? 0.6 : 1.6)) {
      this.energyT = 0;
      this.energy = Math.min(this.stats.energy, this.energy + 1);
    }
    if (this.hitstun > 0) {
      this.hitstun -= dt;
    } else {
      const ax = inp.axisX();
      this.blocking = inp.held('down') && this.onGround && this.attackT <= 0;
      const sp = this.blocking ? 0 : 120;
      this.vx = approach(this.vx, ax * sp, 1000 * dt);
      if (ax !== 0 && this.attackT <= 0) this.facing = ax;
      if (this.onGround) this.airJumps = this.game.profile.abilities.includes('double_jump') || this.game.profile.character === 'demo' ? 1 : 0;
      if (inp.pressed('jump') && (this.onGround || this.airJumps > 0)) {
        if (!this.onGround) this.airJumps--;
        this.vy = -340;
        this.onGround = false;
        this.game.audio.sfx('jump');
      }
      if (inp.pressed('attack') && this.attackT <= 0.05) this.playerAttack();
      if (inp.pressed('special') && this.energy >= 1) {
        if (this.director.flag('boss_steal')) {
          this.popups.add(this.px, this.py - 40, 'STOLEN!', '#ff3f3f');
          this.game.audio.sfx('miss');
        } else {
          this.energy -= 1;
          const up = this.phase === 3 || inp.held('up');
          this.projs.push({ x: this.px + this.facing * 10, y: this.py - 18, vx: up ? 0 : this.facing * 260, vy: up ? -300 : 0, r: 7, kind: 'pwave', alive: true, bounces: 0, color: '#3fe0ff' });
          this.attackT = 0.2;
          this.game.audio.sfx('shoot', 0.8);
        }
      }
    }
    this.vy += grav * dt;
    this.px += this.vx * dt;
    const prevY = this.py;
    this.py += this.vy * dt;
    this.px = clamp(this.px, LEFT + 8, RIGHT - 8);
    // Land on floor or stacked blocks (blocks are one-way platforms: you can never be trapped).
    this.onGround = false;
    let ground = FLOOR;
    const col = Math.floor((this.px - LEFT) / CW);
    if (col >= 0 && col < COLS) {
      const h = this.stackHeight(col);
      if (h > 0) {
        const top = FLOOR - h * CW * 0.5;
        if (prevY <= top + 1) ground = top;
      }
    }
    if (this.py >= ground) {
      this.py = ground;
      this.vy = 0;
      this.onGround = true;
    }
  }

  private stackHeight(col: number): number {
    let h = 0;
    while (h < MAX_STACK && this.grid[h][col]) h++;
    return h;
  }

  private playerAttack(): void {
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = 0.45;
    this.attackKind = (this.combo - 1) % 3;
    this.attackT = this.attackKind === 2 ? 0.28 : 0.18;
    this.game.audio.sfx('hit', 1.3 + this.attackKind * 0.15);
    const reach = (this.attackKind === 2 ? 30 : 24) * (this.giant ? 1.8 : 1);
    const hx0 = this.facing > 0 ? this.px : this.px - reach;
    const hx1 = hx0 + reach;
    const hy0 = this.py - (this.giant ? 50 : 26);
    const hy1 = this.py;
    const [bx0, by0, bx1, by1] = this.bossBox();
    if (hx0 < bx1 && hx1 > bx0 && hy0 < by1 && hy1 > by0 && this.bMove !== 'float') {
      let dmg = [3, 3, 6][this.attackKind] * this.stats.power * this.damageMult * (this.giant ? 2 : 1) * (1 + (this.fightLevel - 1) * 0.15);
      const weak = this.bMove === 'stuck' || this.bMove === 'tired';
      if (weak) dmg *= 2;
      if (this.bMove === 'dizzy') dmg *= 1.5;
      this.damageBoss(dmg, weak ? 'CORE HIT!' : this.combo >= 3 ? `${this.combo} HIT COMBO` : undefined);
      this.stun = Math.min(100, this.stun + (this.attackKind === 2 ? 14 : 7));
      if (this.stun >= 100 && this.phase !== 3 && this.bMove !== 'dizzy' && this.bMove !== 'stuck') {
        this.bMove = 'dizzy';
        this.bT = 2.5;
        this.stun = 0;
        this.popups.add(this.bx, this.by - 90, 'DIZZY!', '#ffcf3f');
      }
      // GRINDCORE: combos generate experience mid-fight.
      if (this.fusion.has('combo_xp')) {
        this.fightXp += this.fusion.param('combo_xp', 'xpPerHit', 3) + Math.min(this.combo, 6) * this.fusion.param('combo_xp', 'comboBonus', 2);
        const need = 30 * this.fightLevel;
        if (this.fightXp >= need) {
          this.fightXp -= need;
          this.fightLevel++;
          this.runXp += 10;
          this.popups.add(this.px, this.py - 50, `LEVEL UP! LV${this.fightLevel}`, '#7dff6b');
          this.game.audio.sfx('levelup');
          this.heal(1);
        }
      }
      this.director.feed(this.combo >= 3 ? 5 : 2);
      this.game.fx.freeze(this.attackKind === 2 ? 0.07 : 0.035);
      this.game.fx.shake(this.attackKind === 2 ? 4 : 2);
    }
  }

  private bossBox(): [number, number, number, number] {
    const w = 52, h = this.bMove === 'dizzy' || this.bMove === 'tired' ? 60 : 76;
    return [this.bx - w / 2, this.by - h, this.bx + w / 2, this.by];
  }

  private damageBoss(dmg: number, label?: string): void {
    if (this.bMove === 'dead') return;
    this.bHp = Math.max(0, this.bHp - dmg);
    this.bFlash = 0.1;
    this.particles.emit(this.bx, this.by - 40, 6, BCOL[Math.floor(Math.random() * BCOL.length)], 90, 0.4, 3, 200);
    if (label) this.popups.add(this.bx, this.by - 86, label, '#ffcf3f');
    this.runXp += 1;
    if (this.bHp <= 0) {
      this.bMove = 'dead';
      this.won = true;
      this.deadT = 0;
      this.game.audio.sfx('explode');
      this.game.fx.shake(10);
      this.game.fx.flash('#fff', 0.7);
      this.director.clearAll();
      this.projs.length = 0;
      this.fallers.length = 0;
      return;
    }
    const frac = this.bHp / this.bMaxHp;
    if (this.phase === 1 && frac <= 0.6) {
      this.phase = 2;
      this.director.clearAll();
      this.popups.add(this.bx, this.by - 100, 'PHASE 2: BLOCK RAIN', '#ff6f3f');
      this.game.audio.sfx('warn');
      this.rainT = 1.5;
    } else if (this.phase === 2 && frac <= 0.25) {
      this.phase = 3;
      this.director.clearAll();
      this.fallers.length = 0;
      this.bMove = 'float';
      this.bT = 6;
      this.game.genreShift('FIGHTER', 'BULLET HELL', PAL.bullet.accent);
      this.game.audio.play('beatdown_bh');
      this.game.toast('BRICKLORD MAX', '"I AM BORED OF THIS GENRE!"', '#ff7af5');
    }
  }

  private hurtPlayer(n: number, fromX: number): void {
    if (this.iframes > 0) return;
    const facingHit = Math.sign(fromX - this.px) === this.facing;
    if (this.blocking && facingHit) {
      this.game.audio.sfx('block');
      this.particles.emit(this.px + this.facing * 8, this.py - 16, 6, '#fff', 60, 0.2, 2, 0);
      this.vx = -this.facing * 80;
      this.director.feed(3);
      return;
    }
    this.hp -= n;
    this.iframes = 1;
    this.hitstun = 0.3;
    this.vx = Math.sign(this.px - fromX) * 160;
    this.vy = -160;
    this.combo = 0;
    this.noteDamage(n);
    if (this.hp <= 0) {
      this.deadT = 0;
      this.particles.burst(this.px, this.py - 12, ['#ff3fa4', '#20c4b0', '#fff'], 30, 140);
    }
  }

  // ---- boss AI ------------------------------------------------------------------------
  private updateBoss(dt: number): void {
    this.bFlash = Math.max(0, this.bFlash - dt);
    this.bT -= dt * (this.bMove === 'idle' || this.bMove === 'walk' ? this.bSpeed : 1);
    const toP = Math.sign(this.px - this.bx) || 1;
    const dist = Math.abs(this.px - this.bx);
    if (this.phase === 3) return this.updateBulletHell(dt);
    // Gravity for boss jumps
    if (this.by < FLOOR || this.bvy < 0) {
      this.bvy += 1100 * dt;
      this.by += this.bvy * dt;
      this.bx += this.bvx * dt;
      if (this.by >= FLOOR) {
        this.by = FLOOR;
        this.bvy = 0;
        this.bvx = 0;
        if (this.bMove === 'stomp') {
          // Slam: shockwaves both ways, then he is stuck (WEAKNESS)
          this.game.fx.shake(8);
          this.game.audio.sfx('explode');
          for (const d of [-1, 1]) this.projs.push({ x: this.bx + d * 30, y: FLOOR - 6, vx: d * 170 * this.bSpeed, vy: 0, r: 6, kind: 'shock', alive: true, bounces: 0, color: '#ffd23f' });
          this.bMove = 'stuck';
          this.bT = 1.3;
        }
      }
    }
    this.bx = clamp(this.bx, LEFT + 26, RIGHT - 26);
    switch (this.bMove) {
      case 'idle':
      case 'walk':
        this.bFacing = toP;
        if (dist > 70) {
          this.bMove = 'walk';
          this.bx += toP * 40 * this.bSpeed * dt;
        } else this.bMove = 'idle';
        if (this.bT <= 0) this.chooseAttack(dist);
        break;
      case 'stomp':
        break;
      case 'punch':
        // windup → lunge
        if (this.bT < 0.25 && this.bT > 0) {
          this.bx += this.bFacing * 420 * dt;
          if (!this.attackHit && Math.abs(this.px - (this.bx + this.bFacing * 30)) < 30 && this.py > this.by - 60) {
            this.attackHit = true;
            this.hurtPlayer(1, this.bx);
          }
        }
        if (this.bT <= 0) this.toIdle(0.9);
        break;
      case 'throw':
        if (this.bT <= 0) {
          const n = this.phase >= 2 ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const tx = this.px + (i - (n - 1) / 2) * 50;
            const flight = 0.9;
            this.projs.push({ x: this.bx, y: this.by - 80, vx: (tx - this.bx) / flight, vy: -320, r: 8, kind: 'block', alive: true, bounces: 0, color: BCOL[i % BCOL.length] });
          }
          this.game.audio.sfx('shoot', 0.5);
          this.toIdle(1.0);
        }
        break;
      case 'steal':
        if (this.bT <= 0) {
          this.projs.push({ x: this.bx + this.bFacing * 30, y: this.by - 30, vx: this.bFacing * 230, vy: 0, r: 8, kind: 'wave', alive: true, bounces: 0, color: '#ff3f3f' });
          this.game.audio.sfx('shoot', 0.6);
          this.toIdle(0.8);
        }
        break;
      case 'stuck':
      case 'dizzy':
        if (this.bT <= 0) this.toIdle(0.8);
        break;
      default:
        break;
    }
  }

  private toIdle(t: number): void {
    this.bMove = 'idle';
    this.bT = t;
    this.attackHit = false;
  }

  private chooseAttack(dist: number): void {
    this.attackHit = false;
    // Boss-specific chaos: while the moveset is stolen he favours your special.
    if (this.director.flag('boss_steal') && this.rng.chance(0.6)) {
      this.bMove = 'steal';
      this.bT = 0.7;
      return;
    }
    const r = this.rng.next();
    if (dist < 90 && r < 0.5) {
      this.bMove = 'punch';
      this.bT = 0.75 / this.bSpeed + 0.25;
      this.game.audio.sfx('warn');
    } else if (r < 0.75) {
      this.bMove = 'stomp';
      this.bvy = -420;
      this.bvx = (this.px - this.bx) * 0.9;
      this.by -= 1;
      this.bT = 2;
    } else {
      this.bMove = 'throw';
      this.bT = 0.7 / this.bSpeed;
      this.game.audio.sfx('warn');
    }
  }

  private updateBulletHell(dt: number): void {
    // Phase 3: floating at the top of the screen, firing patterns; lands periodically, tired.
    if (this.bMove === 'float') {
      const tx = W / 2 + Math.sin(this.time * 0.8) * 140;
      this.bx += (tx - this.bx) * Math.min(1, dt * 2);
      this.by += (110 - this.by) * Math.min(1, dt * 2);
      this.patternT -= dt;
      if (this.patternT <= 0) {
        const p = this.rng.int(0, 2);
        const speed = 75 * Math.sqrt(this.diffMult) * this.rematchMult;
        if (p === 0) {
          const n = 14;
          for (let i = 0; i < n; i++) this.bullet(this.bx, this.by - 30, (i / n) * Math.PI * 2 + this.spiral, speed);
          this.patternT = 1.3;
        } else if (p === 1) {
          for (let i = 0; i < 6; i++) this.bullet(this.bx, this.by - 30, this.spiral + i * 1.05, speed * 1.2);
          this.spiral += 0.45;
          this.patternT = 0.35;
        } else {
          const a = Math.atan2(this.py - 12 - (this.by - 30), this.px - this.bx);
          for (let i = -2; i <= 2; i++) this.bullet(this.bx, this.by - 30, a + i * 0.18, speed * 1.4);
          this.patternT = 0.9;
        }
        this.game.audio.sfx('shoot', 1.6);
      }
      if (this.bT <= 0) {
        this.bMove = 'tired';
        this.bT = 3;
        this.popups.add(this.bx, this.by - 90, 'TIRED! CORE EXPOSED', '#7dff6b');
      }
    } else if (this.bMove === 'tired') {
      this.by = approach(this.by, FLOOR, 300 * dt);
      if (this.bT <= 0) {
        this.bMove = 'float';
        this.bT = 7;
      }
    }
    // Contact with the floating boss hurts
    const [bx0, by0, bx1, by1] = this.bossBox();
    if (this.bMove === 'float' && this.px > bx0 && this.px < bx1 && this.py - 20 < by1 && this.py > by0) this.hurtPlayer(1, this.bx);
  }

  private bullet(x: number, y: number, a: number, s: number): void {
    if (this.projs.length > 320) return; // hard cap: never unbounded
    this.projs.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: 3, kind: 'bullet', alive: true, bounces: 0, color: '#ff7af5' });
  }

  // ---- block rain (puzzle) ---------------------------------------------------------------
  private updateRain(dt: number): void {
    if (this.phase !== 2) return;
    this.rainT -= dt;
    if (this.rainT <= 0) {
      this.rainT = 2.2 / this.bSpeed;
      // Bias toward the player's column so the player chooses where blocks land.
      const pc = clamp(Math.floor((this.px - LEFT) / CW), 0, COLS - 1);
      const cols = new Set<number>([pc]);
      if (this.rng.chance(0.6)) cols.add(this.rng.int(0, COLS - 1));
      for (const c of cols) this.fallers.push({ col: c, y: -20, vy: 0, warn: 1.1, color: this.rng.pick(BCOL), alive: true });
    }
    const stacking = this.fusion.has('block_rain');
    for (const f of this.fallers) {
      if (!f.alive) continue;
      if (f.warn > 0) {
        f.warn -= dt;
        continue;
      }
      f.vy += 900 * dt;
      f.y += f.vy * dt;
      const h = this.stackHeight(f.col);
      const landY = FLOOR - h * CW * 0.5;
      const bx = LEFT + f.col * CW;
      // Hits the player on the way down
      if (this.px > bx && this.px < bx + CW && f.y + CW * 0.5 > this.py - 24 && f.y < this.py) {
        this.hurtPlayer(1, this.px);
        f.alive = false;
        this.particles.burst(bx + CW / 2, f.y, [f.color], 10, 80);
        continue;
      }
      if (f.y + CW * 0.5 >= landY) {
        f.alive = false;
        this.game.audio.sfx('land');
        if (stacking && h < MAX_STACK) {
          this.grid[h][f.col] = f.color;
          this.checkLines();
        } else this.particles.burst(bx + CW / 2, landY, [f.color], 8, 60);
      }
    }
    this.fallers = this.fallers.filter((f) => f.alive);
  }

  private checkLines(): void {
    for (let r = 0; r < MAX_STACK; r++) {
      if (this.grid[r].every((c) => c)) {
        // LINE CLEAR: crush the boss.
        this.lines++;
        const dmg = this.fusion.param('block_rain', 'lineDamage', 9) * 1.6;
        this.damageBoss(dmg, 'LINE CLEAR!');
        this.game.fx.flash('#fff', 0.4);
        this.game.audio.sfx('levelup');
        this.director.feed(20);
        for (let c = 0; c < COLS; c++) this.particles.burst(LEFT + c * CW + CW / 2, FLOOR - r * CW * 0.5 - 12, [this.grid[r][c]!], 6, 100);
        this.grid.splice(r, 1);
        this.grid.push(new Array(COLS).fill(null));
        r--;
      }
    }
  }

  // ---- projectiles --------------------------------------------------------------------------
  private updateProjs(dt: number): void {
    const bouncy = this.director.flag('bouncy');
    for (const p of this.projs) {
      if (!p.alive) continue;
      if (p.kind === 'block') p.vy += 600 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'block' && p.y > FLOOR - p.r) {
        if (bouncy && p.bounces < 3) {
          p.bounces++;
          p.vy = -Math.abs(p.vy) * 0.75;
          p.y = FLOOR - p.r;
        } else {
          p.alive = false;
          this.particles.burst(p.x, FLOOR - 4, [p.color], 8, 60);
          continue;
        }
      }
      if (p.kind === 'bullet' && bouncy && (p.x < LEFT || p.x > RIGHT) && p.bounces < 2) {
        p.bounces++;
        p.vx = -p.vx;
      }
      if (p.x < -20 || p.x > W + 20 || p.y < -40 || p.y > H + 20) { p.alive = false; continue; }
      if (p.kind === 'shock' && (p.x < LEFT || p.x > RIGHT)) { p.alive = false; continue; }
      if (p.kind === 'pwave' || p.kind === 'pshot') {
        const [bx0, by0, bx1, by1] = this.bossBox();
        if (p.x > bx0 && p.x < bx1 && p.y > by0 && p.y < by1) {
          p.alive = false;
          const weak = this.bMove === 'stuck' || this.bMove === 'tired';
          this.damageBoss(5 * this.stats.power * this.damageMult * (weak ? 2 : 1) * (1 + (this.fightLevel - 1) * 0.15), weak ? 'CORE HIT!' : undefined);
          this.stun = Math.min(100, this.stun + 5);
        }
        continue;
      }
      // Enemy projectile vs player (bullets have a small, fair hitbox)
      const ph = this.giant ? 44 : 22;
      const pw = this.giant ? 18 : 8;
      const hit = p.x + p.r > this.px - pw / 2 && p.x - p.r < this.px + pw / 2 && p.y + p.r > this.py - ph && p.y - p.r < this.py - 2;
      if (hit) {
        if (p.kind === 'shock' && !this.onGround) continue;
        p.alive = false;
        this.hurtPlayer(1, p.x - p.vx * 0.01);
      }
    }
    if (this.projs.length > 80) this.projs = this.projs.filter((p) => p.alive);
  }

  // ---- defeat sequence ----------------------------------------------------------------------
  private defeatDialog(): void {
    this.game.say(BOSS_DEFEAT.bricklord, (effects) => {
      const p = this.game.profile;
      if (effects.includes('purge')) {
        p.bossChoices.bricklord = 'purge';
        this.runBits += 150;
        this.runFlags.add('purge');
      } else {
        p.bossChoices.bricklord = 'mercy';
        if (p.bossChoices.static === 'mercy') this.runFlags.add('mercy2');
      }
      this.game.toast('CORE SHARD ACQUIRED', 'BRICKLORD\'S SHARD (1 OF 2)', '#ff6f3f');
      const score = Math.floor(this.runBits * 10 + this.hp * 500 + this.lines * 800 + Math.max(0, 6000 - this.time * 30));
      this.addBits(80);
      this.finish(true, score, { boss: 'bricklord' });
    });
  }

  // ---- drawing ------------------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const bh = this.phase === 3;
    const pal = bh ? PAL.bullet : PAL.fighter;
    // Stage: a ruined puzzle-game well with a crowd of block spectators
    rect(ctx, 0, 0, W, H, pal.bg0);
    if (bh) {
      for (let i = 0; i < 70; i++) rect(ctx, (i * 71) % W, ((i * 37 + this.time * (20 + (i % 4) * 15)) % H), 1, 2, '#ffffff66');
    } else {
      for (let y = 0; y < 150; y += 10) rect(ctx, 0, y, W, 10, y % 20 ? pal.bg0 : '#3a1414');
      for (let i = 0; i < 26; i++) {
        const x = 10 + i * 18;
        const bob = Math.floor(this.time * 4 + i) % 2;
        rect(ctx, x, 150 - bob * 2, 12, 12, BCOL[i % BCOL.length] + '99');
        rect(ctx, x + 3, 153 - bob * 2, 2, 2, '#000');
        rect(ctx, x + 7, 153 - bob * 2, 2, 2, '#000');
      }
      rect(ctx, 0, 164, W, FLOOR - 164, pal.bg1);
    }
    rect(ctx, 0, FLOOR, W, H - FLOOR, bh ? '#151550' : '#4a1a10');
    for (let x = LEFT; x <= RIGHT; x += CW) rect(ctx, x, FLOOR, 1, H - FLOOR, '#ffffff22');
    rect(ctx, LEFT - 4, 0, 4, H, '#00000055');
    rect(ctx, RIGHT, 0, 4, H, '#00000055');
    // Stacked blocks
    for (let r = 0; r < MAX_STACK; r++) {
      for (let c = 0; c < COLS; c++) {
        const col = this.grid[r][c];
        if (!col) continue;
        const x = LEFT + c * CW, y = FLOOR - (r + 1) * CW * 0.5;
        rect(ctx, x + 1, y + 1, CW - 2, CW * 0.5 - 2, col);
        rect(ctx, x + 3, y + 3, CW - 6, 3, '#ffffff66');
      }
      if (this.fusion.has('block_rain') && this.phase === 2) {
        const filled = this.grid[r].filter(Boolean).length;
        if (filled > 0) drawText(ctx, `${filled}/${COLS}`, RIGHT + 6 - 30, FLOOR - (r + 1) * CW * 0.5 + 6, '#fff', { align: 'right' });
      }
    }
    // Falling block warnings + blocks
    for (const f of this.fallers) {
      const x = LEFT + f.col * CW;
      if (f.warn > 0) {
        if (Math.floor(f.warn * 10) % 2) rect(ctx, x + 2, FLOOR - this.stackHeight(f.col) * CW * 0.5 - 4, CW - 4, 4, '#ff3f3f');
        drawText(ctx, '!', x + CW / 2, 30, '#ff3f3f', { align: 'center', scale: 2 });
      } else {
        rect(ctx, x + 1, f.y, CW - 2, CW * 0.5 - 2, f.color);
      }
    }
    this.drawBoss(ctx);
    // Player
    if (!(this.iframes > 0 && Math.floor(this.time * 20) % 2) && !(this.hp <= 0 && this.deadT > 0.2)) {
      const pose: Pose = this.hp <= 0 ? 'hurt' : this.blocking ? 'block' : this.attackT > 0 ? 'attack' : !this.onGround ? 'jump' : Math.abs(this.vx) > 10 ? 'run' : 'idle';
      drawCass(ctx, { x: this.px, y: this.py, facing: this.facing, pose, t: this.time, scale: this.giant ? 2 : 1 }, this.game.profile.character);
      if (this.attackT > 0) {
        const reach = (this.attackKind === 2 ? 30 : 24) * (this.giant ? 1.8 : 1);
        ctx.globalAlpha = 0.7;
        const ax = this.facing > 0 ? this.px + 4 : this.px - reach - 4;
        rect(ctx, ax, this.py - (this.attackKind === 2 ? 26 : 14), reach, 3, this.attackKind === 2 ? '#ffcf3f' : '#fff');
        ctx.globalAlpha = 1;
      }
      if (this.blocking) rect(ctx, this.px + this.facing * 10, this.py - 24, 2, 20, '#3fe0ff');
    }
    // Projectiles
    for (const p of this.projs) {
      if (!p.alive) continue;
      if (p.kind === 'bullet') {
        rect(ctx, p.x - 3, p.y - 3, 6, 6, this.director.flag('bouncy') ? '#7dff6b' : p.color);
        rect(ctx, p.x - 1, p.y - 1, 2, 2, '#fff');
      } else if (p.kind === 'shock') {
        rect(ctx, p.x - 8, p.y - 6, 16, 8, p.color);
        rect(ctx, p.x - 5, p.y - 10, 10, 4, '#fff8');
      } else if (p.kind === 'block') {
        rect(ctx, p.x - 8, p.y - 8, 16, 16, p.color);
        rect(ctx, p.x - 6, p.y - 6, 12, 3, '#fff6');
      } else {
        rect(ctx, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2, p.color);
        rect(ctx, p.x - 2, p.y - 2, 4, 4, '#fff');
      }
    }
    this.particles.draw(ctx);
    this.popups.draw(ctx);
    this.drawHud(ctx, pal);
  }

  private drawBoss(ctx: CanvasRenderingContext2D): void {
    if (this.won && this.deadT > 1.2) return;
    const x = this.bx, y = this.by;
    const fl = this.bFlash > 0;
    const m = this.bMove;
    const shake = m === 'dead' ? (Math.random() - 0.5) * 6 : 0;
    const wind = (m === 'punch' && this.bT > 0.25) || (m === 'throw') || (m === 'steal');
    ctx.save();
    ctx.translate(x + shake, y);
    ctx.scale(this.bFacing, 1);
    const squash = m === 'stuck' || m === 'tired' ? 0.8 : m === 'dizzy' ? 0.9 : 1;
    ctx.scale(1, squash);
    // legs
    rect(ctx, -22, -18, 16, 18, fl ? '#fff' : '#3fa9ff');
    rect(ctx, 6, -18, 16, 18, fl ? '#fff' : '#3fa9ff');
    // torso of blocks
    for (let i = 0; i < 6; i++) rect(ctx, -26 + (i % 3) * 18, -54 + Math.floor(i / 3) * 18, 17, 17, fl ? '#fff' : BCOL[(i + 1) % BCOL.length]);
    // core — glows when exposed
    const exposed = m === 'stuck' || m === 'tired' || m === 'dizzy';
    rect(ctx, -6, -46, 12, 12, exposed ? (Math.floor(this.time * 12) % 2 ? '#fff' : '#7dff6b') : '#2a2a3a');
    // head
    rect(ctx, -14, -74, 28, 20, fl ? '#fff' : '#ff3f3f');
    rect(ctx, -9, -68, 6, 4, '#000');
    rect(ctx, 3, -68, 6, 4, '#000');
    if (m === 'dizzy') drawText(ctx, '@ @', 0, -70, '#ffcf3f', { align: 'center' });
    // arms
    const armY = wind ? -84 : -50;
    rect(ctx, 26, armY, 14, 14, fl ? '#fff' : '#ffd23f');
    rect(ctx, -40, -50, 14, 14, fl ? '#fff' : '#ffd23f');
    if (m === 'punch' && this.bT < 0.25) rect(ctx, 30, -50, 34, 14, '#ffd23f');
    if (m === 'throw') rect(ctx, -10, -100, 20, 20, BCOL[2]);
    ctx.restore();
    // Telegraphs: big readable warning icons
    if ((m === 'punch' && this.bT > 0.25) || m === 'throw' || m === 'steal' || (m === 'stomp' && this.bvy < 0)) {
      if (Math.floor(this.time * 10) % 2) drawText(ctx, '!', x, y - 110, '#ff3f3f', { align: 'center', scale: 3 });
    }
    if (exposed && m !== 'dizzy') drawText(ctx, 'HIT THE CORE!', x, y - 100, '#7dff6b', { align: 'center' });
  }

  private drawHud(ctx: CanvasRenderingContext2D, pal: typeof PAL.fighter): void {
    rect(ctx, 0, 0, W, 34, '#0009');
    hearts(ctx, 6, 3, this.hp, this.stats.maxHp);
    for (let i = 0; i < this.stats.energy; i++) rect(ctx, 6 + i * 9, 13, 7, 4, i < Math.floor(this.energy) ? (this.director.flag('boss_steal') ? '#ff3f3f' : '#3fe0ff') : '#234');
    drawText(ctx, 'CASS', 6, 22, '#20c4b0');
    if (this.fusion.has('combo_xp')) {
      drawText(ctx, `LV${this.fightLevel}`, 40, 22, '#7dff6b');
      bar(ctx, 66, 24, 50, 3, this.fightXp / (30 * this.fightLevel), '#7dff6b', '#020', '#ffffff44');
    }
    drawText(ctx, 'BRICKLORD MAX', W - 6, 3, '#ff6f3f', { align: 'right' });
    bar(ctx, W - 186, 13, 180, 6, this.bHp / this.bMaxHp, this.phase === 3 ? '#ff7af5' : '#ff3f3f', '#200', '#fff');
    rect(ctx, W - 186 + 180 * 0.6, 12, 1, 8, '#fff');
    rect(ctx, W - 186 + 180 * 0.25, 12, 1, 8, '#fff');
    drawText(ctx, 'STUN', W - 186, 23, '#ffcf3f');
    bar(ctx, W - 156, 24, 60, 3, this.stun / 100, '#ffcf3f', '#220', '#ffffff44');
    if (this.combo >= 2) drawText(ctx, `${this.combo} HITS!`, 140, 6, pal.accent, { scale: 2 });
    this.drawChaosHud(ctx, W / 2 - 50, 38);
    if (this.won && this.deadT < 3) drawText(ctx, 'K.O.!', W / 2, 90, '#ffcf3f', { align: 'center', scale: 4 });
    if (this.hp <= 0) drawText(ctx, 'YOU GOT CLEARED', W / 2, 100, '#ff3f6b', { align: 'center', scale: 2 });
    this.drawHint(ctx, 'X COMBO • C CART WAVE (UP+C UP) • HOLD DOWN BLOCK • Z JUMP');
    this.drawSeed(ctx);
  }
}
