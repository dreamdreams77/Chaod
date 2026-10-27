/**
 * NIGHTMARE MALL — top-down survival horror.
 * Find three keycards and escape while THE CLOSING-TIME MANAGER stalks the halls.
 * Resources are scarce (flashlight battery, snacks), running makes noise, lockers hide you.
 *
 * Mutation honoured: GOOD BOY PROTOCOL (pet+horror) — BYTE follows you; its bond
 * (raised in the hub) sets how long its bark stuns the Manager, and at bond 3+
 * it sniffs out nearby keycards.
 * Chaos flags honoured: lights_on + monster_haste (power surge), tiny.
 */
import type { Game } from '../game.ts';
import { ModeBase, ModeOpts } from './base.ts';
import { DirectorContext } from '../chaos/director.ts';
import { generateMall, MallMap, MW, MH, mallWalkable, nextStepToward, MALL_NOTES, MallItem } from '../procgen/mall.ts';
import { H, W, rect, clamp, hearts, bar, glow } from '../render/gfx.ts';
import { drawText } from '../render/font.ts';
import { petForm, petBarkBonus, petStage } from '../data/pet.ts';
import { drawByte, drawCass, drawFloppy, Pose } from '../render/actors.ts';

const T = 16;

type MonsterState = 'wander' | 'investigate' | 'chase' | 'stunned' | 'search';

export class MallMode extends ModeBase {
  gesture = 'topdown' as const;
  gestureHint = 'DRAG: WALK \u2022 TAP: HIDE / INTERACT \u2022 2ND FINGER HELD: RUN';
  id = 'mall';
  crt = 0.55;
  map: MallMap;
  px: number; py: number;
  facing = { x: 1, y: 0 };
  hp: number;
  battery = 1;
  keys = 0;
  hidden = false;
  hiddenLocker: MallItem | null = null;
  private lockedPopupT = -99;
  iframes = 0;
  moving = false;
  running = false;
  stepT = 0;
  // monster
  mx: number; my: number;
  mTarget: { x: number; y: number } | null = null;
  mGoal: { x: number; y: number } = { x: 0, y: 0 };
  mState: MonsterState = 'wander';
  mTimer = 0;
  sawHide = false;
  caught = 0;
  // pet
  petOn: boolean;
  petX: number; petY: number;
  trail: Array<[number, number]> = [];
  barkCd = 0;
  barkT = 0;
  camX = 0; camY = 0;
  escaped = false;
  escapeT = 0;
  dark: HTMLCanvasElement;
  dctx: CanvasRenderingContext2D;
  private sniff = false;
  private noteIndex = 0;

  constructor(game: Game, opts: ModeOpts = {}) {
    super(game, 'mall', opts);
    this.map = generateMall(this.seed);
    this.px = this.map.start.x * T + 8;
    this.py = this.map.start.y * T + 8;
    this.mx = this.map.monsterStart.x * T + 8;
    this.my = this.map.monsterStart.y * T + 8;
    this.hp = this.stats.maxHp;
    this.applyCarry();
    this.petOn = this.fusion.has('pet_companion');
    this.petX = this.px - 12;
    this.petY = this.py;
    this.dark = document.createElement('canvas');
    this.dark.width = W;
    this.dark.height = H;
    this.dctx = this.dark.getContext('2d')!;
    this.pickWanderGoal();
  }

  enter(): void {
    this.game.music('mall');
    if (!this.game.profile.lore.includes('mall_intro')) {
      this.game.profile.lore.push('mall_intro');
      this.game.say([
        { who: 'manual', name: 'THE MANUAL', text: 'The mall closed at 9. It is now 9:01. Find 3 KEYCARDS, reach the EXIT on the far right. Keycards glimmer gold in the dark, and the map remembers the ones you pass.' },
        { who: 'manual', name: 'THE MANUAL', text: 'Hold X to run (noisy!). Z hides you in a locker. ' + (this.petOn ? 'C makes BYTE bark to stun the Manager.' : 'Stay out of his light.') },
      ]);
    }
  }

  directorContext(): DirectorContext {
    return { hpFrac: this.hp / this.stats.maxHp, safe: !this.escaped && this.mState !== 'chase', bossActive: false };
  }
  heal(n: number): void {
    this.hp = Math.min(this.stats.maxHp, this.hp + n);
  }

  private tileAt(tx: number, ty: number): string {
    if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return '#';
    return this.map.tiles[ty][tx];
  }
  private walkableAt(x: number, y: number): boolean {
    return mallWalkable(this.tileAt(Math.floor(x / T), Math.floor(y / T)));
  }

  private pickWanderGoal(): void {
    const s = this.rng.pick(this.map.stores);
    this.mGoal = { x: this.rng.int(s.x0, s.x1), y: this.rng.int(s.y0, s.y1) };
    if (!mallWalkable(this.map.tiles[this.mGoal.y][this.mGoal.x])) this.mGoal = { x: s.doorX, y: s.doorY };
  }

  update(rawDt: number): void {
    const dt = rawDt * this.speedMult;
    this.tickShared(dt);
    if (this.escaped) {
      this.escapeT += dt;
      if (this.escapeT > 1.8) {
        const score = this.runBits * 10 + this.hp * 300 + Math.max(0, 5000 - Math.floor(this.time * 20));
        if (this.caught === 0) this.runFlags.add('unseen');
        this.finish(true, score);
      }
      return;
    }
    if (this.hp <= 0) {
      this.escapeT += dt;
      if (this.escapeT > 1.6) this.finish(false, this.runBits * 10);
      return;
    }
    const inp = this.game.input;
    this.iframes = Math.max(0, this.iframes - dt);
    this.barkCd = Math.max(0, this.barkCd - dt);
    this.barkT = Math.max(0, this.barkT - dt);
    const tiny = this.director.flag('tiny');

    if (this.hidden) {
      if (inp.pressed('jump') || inp.pressed('confirm')) {
        this.hidden = false;
        this.hiddenLocker = null;
        this.game.audio.sfx('door');
      }
    } else {
      const ax = inp.axisX(), ay = inp.axisY();
      this.moving = ax !== 0 || ay !== 0;
      this.running = this.moving && inp.held('attack') && !tiny;
      if (this.moving) {
        const len = Math.hypot(ax, ay);
        this.facing = { x: ax / len, y: ay / len };
        const sp = (this.running ? 95 : 55) * (tiny ? 0.7 : 1);
        this.moveBy(this.facing.x * sp * dt, this.facing.y * sp * dt);
        this.stepT -= dt;
        if (this.stepT <= 0) {
          this.stepT = this.running ? 0.22 : 0.4;
          this.game.audio.sfx('step');
          if (this.running) this.makeNoise(this.px, this.py, 7 * T);
        }
      }
      if (inp.pressed('jump')) this.interact();
    }
    // Byte bark
    if (this.petOn && inp.pressed('special') && this.barkCd <= 0) {
      this.barkCd = this.fusion.param('pet_guardian', 'cooldown', 9);
      this.barkT = 0.6;
      this.game.audio.sfx('bark');
      const bond = this.game.profile.pet.bond;
      const d = Math.hypot(this.mx - this.petX, this.my - this.petY);
      if (d < 7 * T) {
        const stun = this.fusion.param('pet_guardian', 'baseStun', 1.5) + bond * this.fusion.param('pet_guardian', 'stunPerBond', 0.7) + petBarkBonus(petStage(this.game.profile.pet.care));
        this.mState = 'stunned';
        this.mTimer = stun;
        this.popups.add(this.mx, this.my - 24, `STUNNED ${stun.toFixed(1)}S`, '#9dff3f');
        this.director.feed(8);
      } else this.makeNoise(this.petX, this.petY, 5 * T); // a bark from afar draws attention: a lure!
    }

    // Battery drain
    const lightsOn = this.director.flag('lights_on');
    if (!lightsOn) this.battery = Math.max(0, this.battery - dt * 0.009 * this.diffMult);

    this.updatePickups();
    this.updatePet(dt);
    this.updateMonster(dt);

    // Camera
    this.camX = clamp(this.px - W / 2, 0, MW * T - W);
    this.camY = clamp(this.py - H / 2, 0, MH * T - H);

    // Exit
    const tx = Math.floor(this.px / T), ty = Math.floor(this.py / T);
    if (this.map.tiles[ty]?.[tx] === 'E') {
      if (this.keys >= 3) {
        this.escaped = true;
        this.game.audio.sfx('levelup');
        this.game.fx.flash('#fff', 0.5);
      } else if (this.time - this.lockedPopupT > 1.5) {
        this.lockedPopupT = this.time;
        this.popups.add(this.px, this.py - 20, `LOCKED: ${this.keys}/3 KEYS`, '#c9a227');
      }
    }
  }

  private moveBy(dx: number, dy: number): void {
    const r = this.director.flag('tiny') ? 3 : 5;
    const ok = (x: number, y: number) =>
      this.walkableAt(x - r, y - r) && this.walkableAt(x + r, y - r) && this.walkableAt(x - r, y + r) && this.walkableAt(x + r, y + r);
    if (ok(this.px + dx, this.py)) this.px += dx;
    if (ok(this.px, this.py + dy)) this.py += dy;
  }

  private interact(): void {
    for (const it of this.map.items) {
      if (it.kind !== 'locker' || Math.hypot(it.x * T + 8 - this.px, it.y * T + 8 - this.py) > 14) continue;
      this.hidden = true;
      this.hiddenLocker = it;
      this.px = it.x * T + 8;
      this.py = it.y * T + 8;
      this.game.audio.sfx('door');
      // If he watched you climb in, he knows.
      const d = Math.hypot(this.mx - this.px, this.my - this.py);
      this.sawHide = this.mState === 'chase' && d < 4 * T;
      if (!this.sawHide && this.mState === 'chase') {
        this.mState = 'search';
        this.mTimer = 3;
      }
      return;
    }
  }

  private makeNoise(x: number, y: number, radius: number): void {
    if (this.mState === 'chase' || this.mState === 'stunned') return;
    if (Math.hypot(this.mx - x, this.my - y) < radius) {
      this.mState = 'investigate';
      this.mGoal = { x: Math.floor(x / T), y: Math.floor(y / T) };
      this.mTimer = 6;
    }
  }

  private canSeePlayer(): boolean {
    if (this.hidden) return false;
    if (this.director.flag('tiny')) return false;
    const d = Math.hypot(this.mx - this.px, this.my - this.py);
    const lights = this.director.flag('lights_on');
    const range = (lights ? 10 : this.battery > 0 ? 6 : 3.5) * T * (1 + this.keys * 0.12);
    if (d > range) return false;
    // Line of sight (walls block, shelves do not)
    const steps = Math.ceil(d / 6);
    for (let i = 1; i < steps; i++) {
      const x = this.mx + (this.px - this.mx) * (i / steps);
      const y = this.my + (this.py - this.my) * (i / steps);
      const c = this.tileAt(Math.floor(x / T), Math.floor(y / T));
      if (c === '#') return false;
    }
    return true;
  }

  private updateMonster(dt: number): void {
    const haste = this.director.flag('monster_haste') ? 1.3 : 1;
    const escal = 1 + this.keys * 0.1;
    const dm = Math.sqrt(this.diffMult);
    if (this.mState === 'stunned') {
      this.mTimer -= dt;
      if (this.mTimer <= 0) {
        this.mState = 'search';
        this.mTimer = 2;
      }
      return;
    }
    if (this.canSeePlayer()) {
      if (this.mState !== 'chase') {
        this.game.audio.sfx('warn');
        this.popups.add(this.mx, this.my - 26, '!', '#ff2040');
      }
      this.mState = 'chase';
      this.mTimer = 3;
    }
    let speed = 38;
    let goal = this.mGoal;
    switch (this.mState) {
      case 'chase':
        speed = 70;
        goal = this.hidden && this.hiddenLocker ? { x: this.hiddenLocker.x, y: this.hiddenLocker.y } : { x: Math.floor(this.px / T), y: Math.floor(this.py / T) };
        this.mTimer -= dt;
        if (this.mTimer <= 0 && !this.canSeePlayer()) {
          this.mState = 'search';
          this.mTimer = 4;
          this.mGoal = { x: Math.floor(this.px / T), y: Math.floor(this.py / T) };
        }
        if (this.hidden && !this.sawHide) {
          this.mState = 'search';
          this.mTimer = 3;
        }
        break;
      case 'investigate':
      case 'search':
        speed = 50;
        this.mTimer -= dt;
        if (this.mTimer <= 0) {
          this.mState = 'wander';
          this.pickWanderGoal();
        }
        break;
      case 'wander': {
        const mtx = Math.floor(this.mx / T), mty = Math.floor(this.my / T);
        if (mtx === this.mGoal.x && mty === this.mGoal.y) this.pickWanderGoal();
        break;
      }
    }
    speed *= haste * escal * dm;
    // Step along the BFS path toward the goal, re-planning at tile centres.
    if (!this.mTarget) {
      const step = nextStepToward(this.map, Math.floor(this.mx / T), Math.floor(this.my / T), goal.x, goal.y);
      if (step) this.mTarget = step;
      else if (this.mState === 'wander') this.pickWanderGoal();
    }
    if (this.mTarget) {
      const tx = this.mTarget.x * T + 8, ty = this.mTarget.y * T + 8;
      const dx = tx - this.mx, dy = ty - this.my;
      const d = Math.hypot(dx, dy);
      if (d < speed * dt + 0.5) {
        this.mx = tx;
        this.my = ty;
        this.mTarget = null;
      } else {
        this.mx += (dx / d) * speed * dt;
        this.my += (dy / d) * speed * dt;
      }
    }
    // Catch
    const dist = Math.hypot(this.mx - this.px, this.my - this.py);
    if (dist < 12 && this.iframes <= 0 && (!this.hidden || this.sawHide)) {
      const dmg = this.takenMult;
      this.hp -= dmg;
      this.caught++;
      this.iframes = 2;
      this.noteDamage(dmg);
      this.hidden = false;
      this.hiddenLocker = null;
      this.sawHide = false;
      this.mState = 'stunned';
      this.mTimer = 2.2; // he pauses to write you a citation
      this.popups.add(this.px, this.py - 20, 'CITATION ISSUED', '#b3122e');
      if (this.hp <= 0) {
        this.escapeT = 0;
        this.game.audio.sfx('explode');
      }
    }
  }

  private updatePet(dt: number): void {
    if (!this.petOn) return;
    this.trail.push([this.px, this.py]);
    if (this.trail.length > 14) this.trail.shift();
    const [tx, ty] = this.trail[0];
    this.petX += (tx - this.petX) * Math.min(1, dt * 6);
    this.petY += (ty - this.petY) * Math.min(1, dt * 6);
    this.sniff = false;
    if (this.game.profile.pet.bond >= 3) {
      for (const it of this.map.items) if (!it.taken && it.kind === 'key' && Math.hypot(it.x * T - this.px, it.y * T - this.py) < 7 * T) this.sniff = true;
    }
  }

  private updatePickups(): void {
    for (const it of this.map.items) {
      if (it.taken || it.kind === 'locker') continue;
      const near = Math.hypot(it.x * T + 8 - this.px, it.y * T + 8 - this.py);
      if (it.kind === 'key' && near < 8 * T) it.seen = true; // the minimap remembers keycards you have been close to
      if (near > 11) continue;
      switch (it.kind) {
        case 'key':
          it.taken = true;
          this.keys++;
          this.addBits(15);
          this.runXp += 10;
          this.game.audio.sfx('unlock');
          this.game.toast('KEYCARD', `${this.keys}/3 — HE IS GETTING FASTER`, '#c9a227');
          this.director.feed(10);
          if (this.keys === 3) this.game.toast('ALL KEYS', 'RUN TO THE EXIT (FAR RIGHT)!', '#7dff6b');
          break;
        case 'battery': it.taken = true; this.battery = Math.min(1, this.battery + 0.4); this.game.audio.sfx('powerup'); this.popups.add(this.px, this.py - 16, 'BATTERY +40%', '#c9a227'); break;
        case 'snack': it.taken = true; this.heal(1); this.game.audio.sfx('coin'); this.popups.add(this.px, this.py - 16, 'MALL PRETZEL +♥', '#ff3f6b'); break;
        case 'floppy': {
          it.taken = true;
          const idx = this.map.items.filter((x) => x.kind === 'floppy').indexOf(it);
          this.collectFloppy(idx);
          break;
        }
        case 'note': {
          it.taken = true;
          const text = MALL_NOTES[(this.seed + this.noteIndex++) % MALL_NOTES.length];
          const loreId = `mall_note_${MALL_NOTES.indexOf(text)}`;
          if (!this.game.profile.lore.includes(loreId)) this.game.profile.lore.push(loreId);
          this.game.say([{ who: 'cass', name: 'A NOTE', text }]);
          this.runXp += 5;
          break;
        }
        case 'chaos':
          if (this.director.trigger(this.directorContext())) {
            it.taken = true;
            this.addBits(10);
          }
          break;
      }
    }
  }

  // ---- draw ---------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const camX = Math.round(this.camX), camY = Math.round(this.camY);
    rect(ctx, 0, 0, W, H, '#050405');
    const x0 = Math.floor(camX / T), y0 = Math.floor(camY / T);
    for (let ty = y0; ty <= y0 + Math.ceil(H / T) + 1; ty++) {
      for (let tx = x0; tx <= x0 + Math.ceil(W / T) + 1; tx++) {
        const c = this.tileAt(tx, ty);
        const sx = tx * T - camX, sy = ty * T - camY;
        if (c === '#') {
          rect(ctx, sx, sy, T, T, '#1a1418');
          if (this.tileAt(tx, ty - 1) !== '#') rect(ctx, sx, sy, T, 2, '#2e262a'); // lit top edge
          if (this.tileAt(tx, ty + 1) !== '#') {
            // Wall face: lighter band over a darker base reads as height.
            rect(ctx, sx, sy + T - 6, T, 6, '#2a2124');
            rect(ctx, sx, sy + T - 6, T, 1, '#3a3034');
            rect(ctx, sx, sy + T - 2, T, 2, '#120d10');
          }
        } else {
          rect(ctx, sx, sy, T, T, (tx + ty) % 2 ? '#3a3430' : '#443d38');
          // Walls cast soft shade onto the floor beside them; polished tiles catch a faint sheen.
          if (this.tileAt(tx, ty - 1) === '#') rect(ctx, sx, sy, T, 5, 'rgba(0,0,0,0.32)');
          else rect(ctx, sx, sy, T, 1, 'rgba(255,255,255,0.04)');
          if (c === 's') {
            rect(ctx, sx + 2, sy + T - 3, T - 2, 4, 'rgba(0,0,0,0.35)');
            rect(ctx, sx + 1, sy + 2, T - 2, T - 4, '#5a4a3a');
            rect(ctx, sx + 2, sy + 4, 4, 3, `hsl(${(tx * 47) % 360},40%,40%)`);
            rect(ctx, sx + 9, sy + 4, 4, 3, `hsl(${(ty * 83) % 360},40%,40%)`);
          } else if (c === 'D') rect(ctx, sx, sy, T, 2, '#6b8f71');
          else if (c === 'E') {
            rect(ctx, sx, sy, T, T, this.keys >= 3 ? '#1f5f2a' : '#5f1f1f');
            if (ty === this.map.exit.y) drawText(ctx, 'EXIT', sx - 10, sy - 10, this.keys >= 3 ? '#7dff6b' : '#b3122e');
          }
        }
      }
    }
    // Store signs
    for (const s of this.map.stores) {
      const sx = s.doorX * T - camX, sy = s.doorY * T - camY + (s.y0 < 13 ? -8 : 16);
      if (sx < -80 || sx > W + 80) continue;
      drawText(ctx, s.name, sx + 16, sy, s.color, { align: 'center' });
    }
    // Items
    for (const it of this.map.items) {
      if (it.taken) continue;
      const sx = it.x * T + 8 - camX, sy = it.y * T + 8 - camY;
      if (sx < -16 || sy < -16 || sx > W + 16 || sy > H + 16) continue;
      if (it.kind !== 'locker') {
        ctx.globalAlpha = 0.3;
        rect(ctx, sx - 5, sy + 4, 10, 3, '#000');
        ctx.globalAlpha = 1;
      }
      if (it.kind === 'key' || it.kind === 'floppy' || it.kind === 'chaos') glow(ctx, sx, sy, 16, it.kind === 'key' ? '255,207,63' : it.kind === 'floppy' ? '63,224,255' : '255,63,210', 0.3 + Math.sin(this.time * 4) * 0.08);
      switch (it.kind) {
        case 'key': rect(ctx, sx - 5, sy - 3, 10, 7, '#c9a227'); rect(ctx, sx - 3, sy - 1, 3, 3, '#fff'); break;
        case 'battery': rect(ctx, sx - 3, sy - 5, 6, 10, '#6b8f71'); rect(ctx, sx - 1, sy - 6, 2, 1, '#ccc'); break;
        case 'snack': rect(ctx, sx - 5, sy - 3, 10, 6, '#c98b4a'); rect(ctx, sx - 2, sy - 1, 4, 2, '#7a4a20'); break;
        case 'note': rect(ctx, sx - 4, sy - 5, 8, 10, '#e8e0c8'); rect(ctx, sx - 2, sy - 2, 5, 1, '#555'); break;
        case 'floppy': drawFloppy(ctx, sx, sy, this.time); break;
        case 'chaos': rect(ctx, sx - 5, sy - 5, 10, 10, `hsl(${(this.time * 200) % 360},100%,60%)`); break;
        case 'locker':
          rect(ctx, sx - 5, sy + 6, 13, 3, 'rgba(0,0,0,0.35)');
          rect(ctx, sx - 6, sy - 10, 12, 18, this.hiddenLocker === it ? '#4a6a6a' : '#3a5a5a');
          for (let k = 0; k < 3; k++) rect(ctx, sx - 4, sy - 8 + k * 3, 8, 1, '#1a2a2a');
          break;
      }
    }
    // Monster
    this.drawManager(ctx, this.mx - camX, this.my - camY);
    // Pet
    if (this.petOn) {
      drawByte(ctx, this.petX - camX, this.petY - camY + 6, this.time, this.game.profile.pet.bond, this.mState === 'chase' ? 'alert' : 'happy', petForm(this.game.profile.pet));
      if (this.barkT > 0) drawText(ctx, 'WOOF!', this.petX - camX, this.petY - camY - 22, '#9dff3f', { align: 'center' });
      if (this.sniff && Math.floor(this.time * 3) % 2) drawText(ctx, '*SNIFF*', this.petX - camX, this.petY - camY - 14, '#c9a227', { align: 'center' });
    }
    // Player
    if (!this.hidden && !(this.iframes > 0 && Math.floor(this.time * 10) % 2)) {
      const pose: Pose = this.hp <= 0 ? 'hurt' : this.moving ? 'run' : 'idle';
      drawCass(ctx, { x: this.px - camX, y: this.py - camY + 8, facing: this.facing.x < 0 ? -1 : 1, pose, t: this.time * (this.running ? 1.5 : 0.8), scale: this.director.flag('tiny') ? 0.5 : 0.8 }, this.game.profile.character);
    }
    this.drawDarkness(ctx, camX, camY);
    this.particles.draw(ctx, camX, camY);
    this.popups.draw(ctx, camX, camY);
    this.drawHud(ctx);
  }

  private drawManager(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    if (x < -30 || y < -40 || x > W + 30 || y > H + 30) return;
    const chase = this.mState === 'chase';
    const sway = Math.sin(this.time * (chase ? 10 : 4)) * 1.5;
    rect(ctx, x - 6, y - 26, 12, 24, '#120c10');
    rect(ctx, x - 5, y - 34, 10, 9, '#1a1418');
    rect(ctx, x - 1, y - 24, 2, 10, '#b3122e'); // tie
    rect(ctx, x + 2, y - 20, 4, 3, '#c9a227'); // name tag
    rect(ctx, x - 9 + sway, y - 24, 3, 18, '#120c10');
    rect(ctx, x + 6 - sway, y - 24, 3, 18, '#120c10');
    rect(ctx, x - 5, y - 2, 4, 4, '#0a0608');
    rect(ctx, x + 1, y - 2, 4, 4, '#0a0608');
    const eye = chase ? '#ff2040' : '#ffe9a0';
    rect(ctx, x - 3, y - 31, 2, 2, eye);
    rect(ctx, x + 1, y - 31, 2, 2, eye);
    if (this.mState === 'stunned') drawText(ctx, '★ ★', x, y - 44 + Math.sin(this.time * 8) * 2, '#ffcf3f', { align: 'center' });
    if (this.mState === 'investigate' || this.mState === 'search') drawText(ctx, '?', x, y - 44, '#ffe9a0', { align: 'center' });
  }

  private drawDarkness(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.director.flag('lights_on')) return;
    const d = this.dctx;
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, H);
    d.fillStyle = 'rgba(2,1,3,0.94)';
    d.fillRect(0, 0, W, H);
    d.globalCompositeOperation = 'destination-out';
    const px = this.px - camX, py = this.py - camY;
    // Ambient bubble around the player
    const amb = d.createRadialGradient(px, py, 4, px, py, 44);
    amb.addColorStop(0, 'rgba(0,0,0,0.9)');
    amb.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = amb;
    d.fillRect(px - 48, py - 48, 96, 96);
    // Flashlight cone
    if (this.battery > 0 && !this.hidden) {
      const flick = this.battery < 0.15 && Math.random() < 0.2 ? 0.3 : 1;
      const len = (60 + this.battery * 80) * flick;
      const ang = Math.atan2(this.facing.y, this.facing.x);
      const spread = 0.5;
      const g = d.createRadialGradient(px, py, 6, px, py, len);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g;
      d.beginPath();
      d.moveTo(px, py);
      d.arc(px, py, len, ang - spread, ang + spread);
      d.closePath();
      d.fill();
    }
    // Keycards glimmer through the dark, so a shop can be searched by eye instead of by feel.
    for (const it of this.map.items) {
      if (it.kind !== 'key' || it.taken) continue;
      const kx = it.x * T + 8 - camX, ky = it.y * T + 8 - camY;
      if (kx < -30 || ky < -30 || kx > W + 30 || ky > H + 30) continue;
      const gl = d.createRadialGradient(kx, ky, 2, kx, ky, 24);
      gl.addColorStop(0, `rgba(0,0,0,${0.75 + Math.sin(this.time * 3) * 0.15})`);
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = gl;
      d.fillRect(kx - 26, ky - 26, 52, 52);
    }
    // Neon store signs and the exit glow faintly through the dark
    for (const s of this.map.stores) {
      const sx = s.doorX * T - camX + 16, sy = s.doorY * T - camY + (s.y0 < 13 ? -4 : 20);
      d.fillStyle = 'rgba(0,0,0,0.5)';
      d.fillRect(sx - 30, sy - 6, 60, 12);
    }
    const ex = this.map.exit.x * T - camX, ey = this.map.exit.y * T - camY;
    d.fillStyle = 'rgba(0,0,0,0.6)';
    d.fillRect(ex - 14, ey - 14, 40, 52);
    // The Manager's eyes are always visible in the dark.
    ctx.drawImage(this.dark, 0, 0);
    // Warm light spill: additive glow where the flashlight and the pet's glow reach.
    if (this.battery > 0 && !this.hidden) {
      const len = 60 + this.battery * 80;
      const warm = ctx.createRadialGradient(px, py, 4, px, py, len);
      warm.addColorStop(0, 'rgba(255,220,150,0.16)');
      warm.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = warm;
      ctx.beginPath();
      ctx.moveTo(px, py);
      const a = Math.atan2(this.facing.y, this.facing.x);
      ctx.arc(px, py, len, a - 0.5, a + 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    const mx = this.mx - camX, my = this.my - camY;
    const eye = this.mState === 'chase' ? '#ff2040' : '#ffe9a0';
    rect(ctx, mx - 3, my - 31, 2, 2, eye);
    rect(ctx, mx + 1, my - 31, 2, 2, eye);
    // Red edge pulse when he is close
    const dist = Math.hypot(this.mx - this.px, this.my - this.py);
    if (dist < 6 * T && !this.game.settings.reducedFlash) {
      ctx.globalAlpha = (1 - dist / (6 * T)) * (0.25 + Math.sin(this.time * 8) * 0.1);
      rect(ctx, 0, 0, W, 6, '#b3122e');
      rect(ctx, 0, H - 6, W, 6, '#b3122e');
      ctx.globalAlpha = 1;
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    rect(ctx, 0, 0, W, 22, '#000a');
    hearts(ctx, 6, 3, this.hp, this.stats.maxHp);
    drawText(ctx, 'LIGHT', 6, 13, '#c9a227');
    bar(ctx, 40, 14, 50, 4, this.battery, this.battery < 0.2 ? '#b3122e' : '#c9a227', '#110', '#ffffff44');
    drawText(ctx, `KEYS ${this.keys}/3`, 100, 3, '#c9a227');
    drawText(ctx, `DISKS ${this.foundFloppies.length}/3`, 100, 13, '#3fe0ff');
    drawText(ctx, `BITS ${this.runBits}`, 170, 3, '#ffcf3f');
    const stateText: Record<MonsterState, [string, string]> = {
      wander: ['HE IS WANDERING', '#6b8f71'], investigate: ['HE HEARD SOMETHING', '#c9a227'], search: ['HE IS SEARCHING', '#c9a227'],
      chase: ['HE SEES YOU', '#ff2040'], stunned: ['HE IS STUNNED', '#9dff3f'],
    };
    const [st, sc] = stateText[this.mState];
    drawText(ctx, st, 170, 13, sc);
    if (this.petOn) {
      drawText(ctx, 'BARK', 260, 3, '#9dff3f');
      bar(ctx, 286, 4, 30, 4, 1 - this.barkCd / this.fusion.param('pet_guardian', 'cooldown', 9), '#9dff3f', '#120', '#ffffff44');
      drawText(ctx, `BOND ${this.game.profile.pet.bond}`, 260, 13, '#9dff3f');
    }
    if (this.hidden) drawText(ctx, 'HIDING... (Z TO LEAVE)', W / 2, H - 24, '#6b8f71', { align: 'center' });
    // Minimap
    const mmx = W - 106, mmy = H - 68, s = 2;
    rect(ctx, mmx - 2, mmy - 2, MW * s + 4, MH * s + 4, '#000c');
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (mallWalkable(this.map.tiles[y][x])) rect(ctx, mmx + x * s, mmy + y * s, s, s, '#2a2428');
    rect(ctx, mmx + this.map.exit.x * s - 1, mmy + this.map.exit.y * s - 1, 4, 4, this.keys >= 3 ? '#7dff6b' : '#b3122e');
    for (const it of this.map.items) if (it.kind === 'key' && it.seen && !it.taken) rect(ctx, mmx + it.x * s, mmy + it.y * s, 3, 3, '#ffcf3f');
    rect(ctx, mmx + Math.floor(this.px / T) * s, mmy + Math.floor(this.py / T) * s, 3, 3, '#20c4b0');
    if (this.mState === 'chase') rect(ctx, mmx + Math.floor(this.mx / T) * s, mmy + Math.floor(this.my / T) * s, 3, 3, '#ff2040');
    this.drawChaosHud(ctx, W - 106, 26);
    if (this.escaped) drawText(ctx, 'YOU ESCAPED!', W / 2, 110, '#7dff6b', { align: 'center', scale: 3 });
    if (this.hp <= 0) drawText(ctx, 'MALL CLOSED. FOREVER.', W / 2, 110, '#b3122e', { align: 'center', scale: 2 });
    this.drawHint(ctx, 'ARROWS MOVE • HOLD X RUN (NOISY) • Z HIDE IN LOCKER' + (this.petOn ? ' • C BYTE BARK' : ''));
    this.drawSeed(ctx);
  }
}
