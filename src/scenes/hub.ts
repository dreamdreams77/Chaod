/**
 * THE LOBBY OF LOST SAVES — the hub world.
 * Walk around, talk to the cast, care for BYTE, shop, toggle genre mutations,
 * bias the Chaos Director, check trophies, and step into arcade-cabinet portals.
 */
import type { Game, Scene } from '../game.ts';
import { ListMenu, MenuItem } from './menu.ts';
import { H, W, PAL, rect, frame, clamp, Particles, bar, glow } from '../render/gfx.ts';
import { drawText, wrap } from '../render/font.ts';
import { drawByte, drawCass, drawCoreIcon, drawKevin, drawManual, drawPolygon, drawRex, drawDemo, PortraitId } from '../render/actors.ts';
import { GAUNTLET_LEGS, INTRO, KEVIN_LINES, MODE_INFO, lockHint, POLYGON_INTRO, REX_LINES, manualLines, isModeUnlocked, ENDING, CAST, BOSSES } from '../data/story.ts';
import { MODE_IDS, ModeId, ChaosCategory, TOTAL_FLOPPIES, xpForLevel } from '../core/save.ts';
import { SHOP, ACHIEVEMENTS, unlockAchievement } from '../data/progression.ts';
import { QUESTS, MINIS, MiniId, secretCabinetOpen } from '../data/quests.ts';
import { STARS, STAR_BITS, starCount } from '../data/mastery.ts';
import { COSMETICS, buyOrEquip } from '../data/cosmetics.ts';
import { PET_ITEMS, PET_STAGES, buyOrWearPet, petForm, petStage } from '../data/pet.ts';
import { DECOR, DECOR_SLOTS, buyOrWearDecor } from '../data/decor.ts';
import { Giver, errandFor, errandView } from '../data/errands.ts';
import { SWEEP_BITS, weekKey, weeklyFor, weeklyView } from '../data/weekly.ts';
import { dateKey, dailyFor, currentStreak, challengeUrl, DAILY_BONUS } from '../data/daily.ts';
import { Season, seasonFor } from '../data/season.ts';
import { MODIFIERS } from '../data/progression.ts';
import { Rng, formatSeed } from '../core/rng.ts';
import { startMini } from './arcade.ts';
import { MUTATIONS, MUTATION_BY_ID, GENRES, describeUnlock, isUnlockSatisfied } from '../fusion/registry.ts';

interface Thing {
  id: string;
  x: number;
  y: number;
  label: string;
  r: number;
  visible?: () => boolean;
}

const CAB_Y = 58;
/** Left edge of each of the nine cabinets (32px wide, 52px apart, centred on the 480px screen). */
const CAB_X = Array.from({ length: 9 }, (_, i) => 16 + i * 52);

/** The first-visit lobby tour: walk to each thing and use it. */
const TOUR: Array<{ target: string; text: string }> = [
  { target: 'quests', text: 'WALK TO THE QUEST BOARD AND PRESS Z. QUESTS PAY OUT AUTOMATICALLY.' },
  { target: 'byte', text: 'SAY HELLO TO BYTE. FEED IT AND IT GROWS, THEN DRESS IT UP.' },
  { target: 'lab', text: 'THE MUTATION LAB MIXES GENRES. SWITCH THEM ON AND OFF FOR BONUS BITS.' },
  { target: 'cab:rampage', text: 'PICK A CABINET. RETRO RAMPAGE IS THE GENTLEST START.' },
];

export class HubScene implements Scene {
  id = 'hub';
  crt = 0.25;
  px = 240;
  py = 196;
  facing = 1;
  moving = false;
  t = 0;
  private menu: ListMenu | null = null;
  private things: Thing[] = [];
  private near: Thing | null = null;
  private particles = new Particles(200);
  private kevinX = 120;
  private kevinDir = 1;
  private paletteFlip = 0;
  private train: { cursor: number; dir: number; zone: number; done: boolean; result: string; t: number } | null = null;
  private cabinetAnnounced: Set<ModeId>;

  constructor(private game: Game) {
    MODE_IDS.forEach((m, i) => this.things.push({ id: `cab:${m}`, x: CAB_X[i] + 16, y: CAB_Y + 30, label: MODE_INFO[m].title, r: 18 }));
    this.things.push({ id: 'core', x: 240, y: 150, label: 'CARTRIDGE CORE', r: 20 });
    this.things.push({ id: 'manual', x: 270, y: 130, label: 'THE MANUAL', r: 16 });
    this.things.push({ id: 'byte', x: 60, y: 200, label: 'BYTE (PET)', r: 18 });
    this.things.push({ id: 'shop', x: 420, y: 200, label: 'MADAME POLYGON (SHOP)', r: 18 });
    this.things.push({ id: 'lab', x: 440, y: 140, label: 'MUTATION LAB', r: 16 });
    this.things.push({ id: 'shrine', x: 40, y: 140, label: 'CHAOS SHRINE', r: 16 });
    this.things.push({ id: 'quests', x: 188, y: 168, label: 'QUEST BOARD', r: 26 });
    this.things.push({ id: 'arcade', x: 292, y: 186, label: 'MINI-GAME ARCADE', r: 18 });
    this.things.push({ id: 'daily', x: 118, y: 196, label: 'DAILY CHALLENGE', r: 22 });
    this.things.push({ id: 'trophy', x: 330, y: 236, label: 'TROPHY CASE', r: 16 });
    this.things.push({ id: 'rex', x: 150, y: 236, label: 'REX TURBO', r: 14 });
    this.things.push({ id: 'dash', x: 462, y: 192, label: 'SECRET CABINET', r: 16, visible: () => secretCabinetOpen(this.game.profile) });
    this.things.push({ id: 'kevin', x: 0, y: 112, label: 'KEVIN FROM QA', r: 14 });
    this.things.push({ id: 'demo', x: 220, y: 240, label: 'DEMO (SECRET)', r: 14, visible: () => this.game.profile.secretUnlocked });
    this.things.push({ id: 'brick', x: 380, y: 160, label: 'BRICKLORD (FREED)', r: 16, visible: () => this.game.profile.bossChoices.bricklord === 'mercy' });
    this.things.push({ id: 'static', x: 100, y: 160, label: 'DJ STATIC (FREED)', r: 16, visible: () => this.game.profile.bossChoices.static === 'mercy' });
    if (game.questSeenSig === null) game.questSeenSig = this.questSig();
    // The first lobby of a session treats everything already unlocked as known; later lobbies announce new unlocks.
    if (!game.cabinetsSeen) {
      game.cabinetsSeen = new Set(MODE_IDS.filter((m) => isModeUnlocked(m, game.profile.cleared)));
    }
    this.cabinetAnnounced = game.cabinetsSeen;
  }

  enter(): void {
    const p = this.game.profile;
    this.game.music(this.season?.track ?? (p.endingSeen ? 'ending' : 'hub'));
    if (this.season) {
      const seen = `${this.season.id}-${new Date().getUTCFullYear()}`;
      if (p.seasonSeen !== seen) {
        p.seasonSeen = seen;
        this.save();
        this.game.toast(this.season.name, this.season.greeting, this.season.color);
      }
    }
    this.game.audio.unlock();
    this.syncPetTrophies();
    if (secretCabinetOpen(p) && !p.lore.includes('secret_cab')) {
      p.lore.push('secret_cab');
      this.game.toast('SECRET CABINET', 'SOMETHING POWERED ON AT THE RIGHT EDGE', '#ff9f3f');
    }
    // Care loop: pets get hungry between adventures.
    if (!p.introDone) {
      p.introDone = true;
      this.game.saveProfile();
      this.game.say(INTRO);
    }
  }

  private save(): void {
    this.game.saveProfile();
  }

  /** Taps drive the open kiosk menu; with no menu a tap interacts with whatever you stand next to. */
  tap(x: number, y: number): boolean {
    if (this.menu) return this.menu.tap(x, y, this.game) || true;
    if (this.train) return false; // the fetch mini-game reads CONFIRM
    if (this.game.inDialog) return false;
    // Tap a person or machine to walk over and use it; tap open floor to walk there.
    let target: Thing | null = null;
    let best = 1e9;
    for (const th of this.things) {
      if (th.visible && !th.visible()) continue;
      const d = Math.hypot(th.x - x, th.y - y);
      if (d < th.r + 16 && d < best) {
        best = d;
        target = th;
      }
    }
    this.walkTo = { x: clamp(x, 14, W - 14), y: clamp(y, CAB_Y + 40, H - 12), thing: target };
    return true;
  }

  /** Today's date key and errand, refreshed every half minute rather than every frame. */
  private dayKey = dateKey();
  private errandDef = errandFor(this.dayKey);
  private dayT = 0;
  /** The lobby's season today, if any. */
  private readonly season: Season | null = seasonFor(new Date());

  private walkTo: { x: number; y: number; thing: Thing | null } | null = null;

  update(dt: number): void {
    this.t += dt;
    this.dayT += dt;
    if (this.dayT > 30) {
      this.dayT = 0;
      const k = dateKey();
      if (k !== this.dayKey) {
        this.dayKey = k;
        this.errandDef = errandFor(k);
      }
    }
    this.particles.update(dt);
    // The glowing Core sheds sparks once both shards are home (emitted per sim step, not per frame).
    if (this.game.profile.bossesDefeated.filter((b) => b === 'bricklord' || b === 'static').length >= 2 && !this.game.profile.endingSeen) {
      this.particles.emit(240, 120, 1, '#7dff6b', 30, 0.6, 2, -20);
    }
    this.paletteFlip = Math.max(0, this.paletteFlip - dt);
    const inp = this.game.input;
    // Kevin wanders
    this.kevinX += this.kevinDir * 18 * dt;
    if (this.kevinX > 200 || this.kevinX < 100) this.kevinDir *= -1;
    const kev = this.things.find((t) => t.id === 'kevin')!;
    kev.x = this.kevinX;
    // Newly powered cabinets get a little announcement
    for (const m of MODE_IDS) {
      if (!this.cabinetAnnounced.has(m) && isModeUnlocked(m, this.game.profile.cleared)) {
        this.cabinetAnnounced.add(m);
        this.game.toast('NEW CABINET', MODE_INFO[m].title, MODE_INFO[m].color);
        const th = this.things.find((x) => x.id === `cab:${m}`)!;
        this.particles.burst(th.x, th.y - 20, [MODE_INFO[m].color, '#fff'], 30, 100);
      }
    }
    if (this.train) return this.updateTrain(dt);
    if (this.menu) {
      this.menu.update(this.game);
      return;
    }
    let ax = inp.axisX(), ay = inp.axisY();
    if (ax || ay) this.walkTo = null;
    else if (this.walkTo) {
      // Tap-to-walk: head for the tapped spot (or the tapped thing, which may be wandering).
      const w = this.walkTo;
      const gx = w.thing ? w.thing.x : w.x;
      const gy = w.thing ? Math.max(w.thing.y + 8, CAB_Y + 40) : w.y;
      const dx = gx - this.px, dy = gy - this.py;
      ax = Math.abs(dx) > 3 ? Math.sign(dx) : 0;
      ay = Math.abs(dy) > 3 ? Math.sign(dy) : 0;
      if (!ax && !ay) {
        const th = w.thing;
        this.walkTo = null;
        if (th) this.interact(th);
      }
    }
    this.moving = ax !== 0 || ay !== 0;
    if (ax) this.facing = ax;
    const sp = 90;
    this.px = clamp(this.px + ax * sp * dt, 14, W - 14);
    this.py = clamp(this.py + ay * sp * dt, CAB_Y + 40, H - 12);
    this.near = null;
    let best = 1e9;
    for (const th of this.things) {
      if (th.visible && !th.visible()) continue;
      const d = Math.hypot(th.x - this.px, th.y - this.py);
      if (d < th.r + 12 && d < best) {
        best = d;
        this.near = th;
      }
    }
    // Arrived within range of the tapped thing: use it.
    if (this.walkTo?.thing && this.near === this.walkTo.thing) {
      const th = this.near;
      this.walkTo = null;
      this.interact(th);
      return;
    }
    if (this.near && (inp.pressed('jump') || inp.pressed('confirm') || inp.pressed('attack'))) this.interact(this.near);
    if (inp.pressed('pause')) this.openPauseMenu();
  }

  /** Every world in one list: the easiest path from the lobby to actually playing. */
  private worldPicker(): void {
    const p = this.game.profile;
    const items: MenuItem[] = MODE_IDS.map((m) => {
      const open = isModeUnlocked(m, p.cleared);
      const info = MODE_INFO[m];
      const need = lockHint(m);
      return {
        label: info.title,
        value: () => (open ? (p.cleared[m].clears ? `CLEARED x${p.cleared[m].clears}` : 'NEW') : 'LOCKED'),
        sub: open ? info.blurb : need,
        color: open ? info.color : undefined,
        disabled: !open,
        onSelect: () => this.cabinet(m),
      };
    });
    items.push({ label: 'BACK', onSelect: () => this.openPauseMenu() });
    this.menu = new ListMenu('PLAY A WORLD', items, () => this.openPauseMenu(), { x: 50, y: 40, w: 380, accent: '#7dff6b' });
  }

  private openPauseMenu(): void {
    this.menu = new ListMenu('LOBBY MENU', [
      { label: 'PLAY A WORLD', sub: 'Pick a world to play right now, without walking to its cabinet.', onSelect: () => this.worldPicker() },
      ...(this.game.profile.endingSeen ? [{ label: 'BOSS RUSH', sub: 'BRICKLORD MAX then DJ STATIC, back to back. Health carries over, no healing in between. Pays +50% bits.', onSelect: () => { this.menu = null; this.game.startMode('beatdown', { rematch: true, rush: { leg: 1 } }); } }] : []),
      ...(this.game.profile.bossesDefeated.includes('highscore') ? [{ label: 'BOSS GAUNTLET', sub: 'BRICKLORD MAX, DJ STATIC, the keeper in OVERTIME, then THE HIGH SCORE, with health carried over. Pays double bits.', color: '#ffcf3f', onSelect: () => { this.menu = null; this.game.startMode('beatdown', { rematch: true, rush: { leg: 1, legs: GAUNTLET_LEGS } }); } }] : []),
      { label: 'DAILY CHALLENGE', sub: 'A new seeded run every day, with a streak bonus and a shareable link.', onSelect: () => this.dailyMenu() },
      { label: 'QUEST BOARD', sub: 'Your quests and rewards.', onSelect: () => this.questMenu() },
      { label: 'MINI-GAME ARCADE', sub: 'Five quick games that pay bits.', onSelect: () => this.arcadeMenu() },
      { label: 'RESUME', onSelect: () => (this.menu = null) },
      ...(this.game.profile.tutorial.done ? [] : [{ label: 'SKIP TOUR', sub: 'Hide the first-visit tour hints.', onSelect: () => { this.game.profile.tutorial.done = true; this.save(); this.menu = null; } }]),
      { label: 'SETTINGS', onSelect: () => { this.menu = null; this.game.goto(this.game.settingsFactory(() => this.game.hubFactory())); } },
      { label: 'SAVE & QUIT TO TITLE', onSelect: () => { this.save(); this.menu = null; this.game.goto(this.game.titleFactory()); } },
    ], () => (this.menu = null), { x: W / 2 - 100, y: 80, w: 200, accent: '#3fe0ff' });
  }

  private say(who: PortraitId, name: string, text: string | string[]): void {
    const arr = Array.isArray(text) ? text : [text];
    this.game.say(arr.map((t) => ({ who, name, text: t })));
  }

  private interact(th: Thing): void {
    const p = this.game.profile;
    this.game.audio.sfx('select');
    this.tourAdvance(th.id);
    if (th.id.startsWith('cab:')) return this.cabinet(th.id.slice(4) as ModeId);
    if (this.errandTalk(th.id)) return;
    switch (th.id) {
      case 'core': return this.core();
      case 'manual': {
        const lines = manualLines({ clears: MODE_IDS.filter((m) => p.cleared[m].clears > 0).length, bosses: p.bossesDefeated, floppies: p.floppies.length, trust: p.manualTrust, ending: p.endingSeen });
        this.game.say(lines, (eff) => {
          const decided = p.lore.includes('manual_confession');
          if (!decided && eff.includes('trust+')) p.manualTrust++;
          if (!decided && eff.includes('trust-')) p.manualTrust--;
          if (eff.length && !p.lore.includes('manual_confession')) p.lore.push('manual_confession');
          this.save();
        });
        return;
      }
      case 'dash': {
        if (!p.lore.includes('dash_intro')) {
          p.lore.push('dash_intro');
          this.save();
          this.say('demo', 'DEMO', ['Woof! (This cabinet only turns on for someone who has mastered a whole world.)', 'Woof woof! (It is my game. I run. You jump. Do not tell Kevin.)']);
        }
        this.game.audio.sfx('select');
        startMini(this.game, 'dash');
        return;
      }
      case 'byte': return this.petMenu();
      case 'shop': return this.shopMenu();
      case 'lab': return this.labMenu();
      case 'shrine': return this.shrineMenu();
      case 'trophy': return this.trophyMenu();
      case 'quests': return this.questMenu();
      case 'daily': return this.dailyMenu();
      case 'arcade': return this.arcadeMenu();
      case 'rex': return this.say('rex', 'REX TURBO', REX_LINES(p.achievements.includes('beat_rex')));
      case 'kevin': {
        const line = KEVIN_LINES[Math.floor(this.t * 7) % KEVIN_LINES.length];
        this.say('kevin', 'KEVIN FROM QA', line);
        if (Math.floor(this.t * 3) % 3 === 0) {
          // Kevin "fixes" the lobby's palette. He changes the rules wherever he goes.
          this.paletteFlip = 6;
          this.game.toast('BUG #0001 FIXED', 'LOBBY COLORS "CORRECTED"', '#3fa9ff');
        }
        return;
      }
      case 'demo': {
        p.character = p.character === 'demo' ? 'cass' : 'demo';
        this.save();
        this.game.audio.sfx('bark');
        this.say('demo', 'DEMO', p.character === 'demo' ? 'WOOF! (Demo will play the next level. He has a built-in double jump.)' : 'Woof. (Demo goes back to his attract-mode loop. Cass is in charge.)');
        return;
      }
      case 'brick': return this.say('brick', 'BRICKLORD MAX', ['I am not the final level anymore. I am a lobby decoration. It is wonderful.', 'Tip: in a rematch, bait my blocks into the gaps. Complete rows hurt.']);
      case 'static': return this.say('static', 'DJ STATIC', ['Free at last! I get to play the LOBBY music now. Requests? No? Fine.', 'Psst. In my fight, a static bolt can be PARRIED right on the line.']);
    }
  }

  /** Ticks the lobby tour when the player uses the thing it is pointing at. */
  private tourAdvance(thingId: string): void {
    const p = this.game.profile;
    const tu = p.tutorial;
    if (tu.done || !p.introDone) return;
    const step = TOUR[tu.step];
    if (!step || (step.target !== thingId && !(step.target.startsWith('cab:') && thingId.startsWith('cab:')))) return;
    tu.step++;
    if (tu.step >= TOUR.length) {
      tu.done = true;
      p.bits += 50;
      this.game.toast('TOUR COMPLETE', '+50 BITS. HAVE FUN!', '#7dff6b');
      this.game.audio.sfx('levelup');
    } else this.game.toast(`TOUR ${tu.step}/${TOUR.length}`, 'NICE! ONE MORE STOP.', '#7dff6b');
    this.save();
  }

  /** The tour banner and the arrow that points at the next stop. */
  private drawTour(ctx: CanvasRenderingContext2D): void {
    const p = this.game.profile;
    const tu = p.tutorial;
    if (tu.done || !p.introDone || this.menu || this.game.inDialog) return;
    const step = TOUR[tu.step];
    if (!step) return;
    const th = this.things.find((x) => x.id === step.target);
    if (th) {
      const bob = Math.round(Math.sin(this.t * 6) * 3);
      drawText(ctx, '\u25BC', th.x, th.y - 48 + bob, '#7dff6b', { align: 'center', scale: 2 });
    }
    frame(ctx, 8, H - 40, W - 16, 24, '#0b0716ee', '#7dff6b');
    drawText(ctx, `TOUR ${tu.step + 1}/${TOUR.length}`, 14, H - 36, '#7dff6b');
    drawText(ctx, this.game.input.label(step.text), 14, H - 26, '#fff');
  }

  /** Today's errand giver talks first (once to ask, once to thank); everything else is the usual chat. */
  private errandTalk(thingId: string): boolean {
    const giver = ({ rex: 'rex', kevin: 'kevin', shop: 'polygon', manual: 'manual' } as Record<string, Giver>)[thingId];
    if (!giver) return false;
    const p = this.game.profile;
    const day = dateKey();
    const e = errandFor(day);
    if (e.giver !== giver) return false;
    const st = errandView(p, day);
    const who = { rex: ['rex', 'REX TURBO'], kevin: ['kevin', 'KEVIN FROM QA'], polygon: ['polygon', 'MADAME POLYGON'], manual: ['manual', 'THE MANUAL'] }[giver] as [PortraitId, string];
    let lines: string[] | null = null;
    if (!st.asked) {
      p.errand = { ...st, asked: true };
      lines = [...e.ask, `ERRAND: ${e.summary.toUpperCase()} REWARD ${e.bits} BITS.`];
    } else if (st.done && !st.thanked) {
      p.errand = { ...st, thanked: true };
      lines = e.thanks;
    }
    if (!lines) return false;
    this.save();
    this.game.say(lines.map((text) => ({ who: who[0], name: who[1], text })), () => {
      if (thingId === 'shop') this.shopMenu();
    });
    return true;
  }

  private cabinet(mode: ModeId): void {
    const p = this.game.profile;
    const info = MODE_INFO[mode];
    if (!isModeUnlocked(mode, p.cleared)) {
      const need = lockHint(mode);
      this.say('kevin', 'KEVIN FROM QA', `This cabinet is OUT OF ORDER. ${need} I filed a ticket.`);
      return;
    }
    const rec = p.cleared[mode];
    const isBoss = mode === 'beatdown' || mode === 'rhythm';
    const bossId = mode === 'beatdown' ? 'bricklord' : 'static';
    const items: MenuItem[] = [
      { label: rec.clears ? 'PLAY (NEW SEED + MODIFIER)' : 'PLAY', sub: info.blurb, onSelect: () => { this.menu = null; this.game.startMode(mode); } },
    ];
    if (isBoss && p.bossesDefeated.includes(bossId)) items.push({ label: 'BOSS REMATCH (HARDER)', sub: 'Tougher boss, faster patterns, a rematch trophy.', onSelect: () => { this.menu = null; this.game.startMode(mode, { rematch: true }); } });
    const floppies = [0, 1, 2].map((i) => (p.floppies.includes(`${mode}-${i}`) ? '■' : '□')).join(' ');
    if (rec.clears) {
      const e = p.endless[mode];
      items.push({ label: 'ENDLESS RUN', value: () => (e ? `BEST ${e.rounds} ROUND${e.rounds === 1 ? '' : 'S'}` : 'NEW'), sub: 'Round after round on fresh seeds, a bit tougher each time. Heal 1 heart between rounds; pause to bank your haul. Pays more the further you get.', color: '#ff6f3f', onSelect: () => { this.menu = null; this.game.startMode(mode, { endless: { round: 1 } }); } });
    }
    if (p.endingSeen) items.push({ label: 'NIGHTMARE MODE', sub: 'One less heart, double damage, chaos cranked, bits pay double. For those who rebooted the Core.', color: '#ff3f6b', onSelect: () => { this.menu = null; this.game.startMode(mode, { nightmare: true }); } });
    items.push({ label: `BEST ${rec.bestScore}  CLEARS ${rec.clears}`, value: () => `DISKS ${floppies}`, disabled: true });
    const have = new Set(p.stars[mode] ?? []);
    for (const s of STARS) {
      items.push({ label: `${have.has(s.id) ? '\u2605' : '\u2606'} ${s.name}`, value: () => (have.has(s.id) ? 'EARNED' : 'TODO'), sub: `${s.desc(mode)} Worth ${STAR_BITS} bits.`, color: have.has(s.id) ? '#ffcf3f' : '#9a9ab8', onSelect: () => {} });
    }
    const muts = MUTATIONS.filter((m) => m.modes.includes(mode));
    for (const m of muts) {
      const on = p.mutationsUnlocked.includes(m.id) && !p.mutationsDisabled.includes(m.id) && isUnlockSatisfied(m.unlock, p);
      items.push({ label: `  ${m.name}`, value: () => (on ? 'ON' : p.mutationsUnlocked.includes(m.id) ? 'OFF' : 'LOCKED'), disabled: true });
    }
    items.push({ label: 'BACK', onSelect: () => (this.menu = null) });
    this.menu = new ListMenu(`${info.title} — ${info.genre}`, items, () => (this.menu = null), { x: 50, y: 40, w: 380, accent: info.color });
  }

  private core(): void {
    const p = this.game.profile;
    const shards = p.bossesDefeated.filter((b) => b === 'bricklord' || b === 'static').length;
    if (shards >= 2 && !p.endingSeen) {
      this.game.say(ENDING, () => {
        p.endingSeen = true;
        const got: string[] = [];
        unlockAchievement(p, 'ending', got);
        this.game.announceAchievements(got);
        this.save();
        this.game.goto(new EndingScene(this.game), { title: 'REBOOTING', sub: 'GENRE BOUNDARIES 41% RESTORED', color: '#7dff6b' });
      });
      return;
    }
    if (p.endingSeen) {
      this.coreMenu();
      return;
    }
    const lines = [`CORE SHARDS: ${shards}/2. DEFEAT THE BOSSES OF BOSS BEATDOWN AND GLITCH RHYTHM.`, `FLOPPY DISKS BACKED UP: ${p.floppies.length}/${TOTAL_FLOPPIES}.`];
    this.say('core', 'CARTRIDGE CORE', lines);
  }

  /** After the reboot the Core offers the last fight. */
  private coreMenu(): void {
    const p = this.game.profile;
    const beaten = p.bossesDefeated.includes('highscore');
    const fate = p.bossChoices.highscore;
    const items: MenuItem[] = [
      {
        label: beaten ? 'REMATCH THE HIGH SCORE' : 'CHALLENGE THE HIGH SCORE',
        sub: beaten ? 'The board is quiet now. Fight it again for bits, a harder run and a better score.' : 'The last page of the Manual is behind its panel. Three phases of bullet hell: ARCADE, FIGHT NIGHT and SUDDEN DEATH.',
        color: '#ffcf3f',
        onSelect: () => { this.menu = null; this.game.startMode('highscore', beaten ? { rematch: true } : {}); },
      },
      {
        label: 'CORE STATUS',
        sub: beaten ? 'The Manual is complete.' : 'CORE: 41% STABLE. ONE PAGE MISSING.',
        onSelect: () => this.card('CARTRIDGE CORE', beaten ? `CORE STATUS: 100% STABLE. THE MANUAL IS COMPLETE.${fate === 'mercy' ? ' THE BOARD WAS SET FREE.' : fate === 'purge' ? ' YOU TOOK THE CROWN.' : ''}` : 'CORE STATUS: 41% STABLE. ONE PAGE MISSING. THE HIGH SCORE HOLDS IT.', () => this.coreMenu(), [
          ['FLOPPIES', `${p.floppies.length}/${TOTAL_FLOPPIES}`],
          ['HIGH SCORE', beaten ? 'DEFEATED' : 'AT LARGE'],
        ]),
      },
      { label: 'BACK', onSelect: () => (this.menu = null) },
    ];
    this.menu = new ListMenu('CARTRIDGE CORE', items, () => (this.menu = null), { x: 70, y: 70, w: 340, accent: '#ffcf3f' });
  }

  private petMenu(keepIndex?: number): void {
    const pet = this.game.profile.pet;
    const keep = keepIndex ?? this.menu?.index;
    const stage = petStage(pet.care);
    const next = PET_STAGES[stage + 1];
    const items: MenuItem[] = [
      { label: 'FEED', value: () => (pet.hunger > 0 ? `HUNGRY ${'●'.repeat(pet.hunger)}` : 'FULL'), sub: 'BYTE gets hungry after each adventure. Feeding builds bond.', onSelect: () => this.feed() },
      { label: 'PLAY FETCH (TRAIN)', value: () => (pet.trainedToday ? 'TIRED' : 'READY'), sub: 'Press Z when the ball is in the green zone. Builds bond.', disabled: pet.trainedToday > 0, onSelect: () => { this.menu = null; this.train = { cursor: 0, dir: 1, zone: 0.35 + Math.random() * 0.3, done: false, result: '', t: 0 }; } },
      { label: `BOND ${pet.bond}/5`, value: () => (pet.bond >= 5 ? 'MAX' : `CARE ${pet.xp}/3`), disabled: true, sub: 'Bond powers GOOD BOY PROTOCOL: a longer bark stun in NIGHTMARE MALL. Bond 3+ sniffs keys.' },
      { label: `FORM: ${PET_STAGES[stage].name}`, value: () => (next ? `CARE ${pet.care}/${next.at}` : 'FULLY GROWN'), disabled: true, sub: `${PET_STAGES[stage].perk}${next ? ` Next form at ${next.at} care.` : ''}` },
      { label: 'DRESS UP', value: () => `${pet.outfit.owned.length}/${PET_ITEMS.length} ITEMS`, sub: 'Hats, shades, scarves and wings for BYTE. Bought with bits, worn everywhere BYTE shows up.', onSelect: () => this.petDressMenu() },
      { label: 'BACK', onSelect: () => (this.menu = null) },
    ];
    this.menu = new ListMenu('BYTE — VIRTUAL PET', items, () => (this.menu = null), { x: 90, y: 60, w: 300, accent: '#9dff3f' });
    if (keep !== undefined) this.menu.index = Math.min(keep, items.length - 1);
  }

  /** One buy-or-wear row, shared by BYTE's DRESS UP and the lobby DECOR menus. */
  private wearRow(o: { name: string; cost: number; owned: boolean; worn: boolean; lock?: string; act: () => string; poor: string; reopen: () => void }): MenuItem {
    return {
      label: o.name,
      value: () => (o.worn ? 'WORN' : o.owned ? 'OWNED' : o.lock ?? `${o.cost} BITS`),
      color: o.worn ? '#ffcf3f' : undefined,
      disabled: !!o.lock && !o.owned,
      sub: o.worn ? 'Press to take it off.' : o.owned ? 'Press to put it on.' : o.lock ? o.lock : `Buy for ${o.cost} bits and put it on.`,
      onSelect: () => {
        const res = o.act();
        if (res === 'poor') {
          this.game.audio.sfx('miss');
          this.game.toast('MADAME POLYGON', o.poor, '#b07aff');
          return;
        }
        this.game.audio.sfx(res === 'bought' ? 'powerup' : 'select');
        if (res === 'bought') {
          this.particles.burst(60, 190, ['#9dff3f', '#ffcf3f', '#fff'], 14, 60);
          this.game.toast('NEW PURCHASE', o.name, '#b07aff');
        }
        this.save();
        o.reopen();
      },
    };
  }

  private petDressMenu(keep?: number): void {
    const p = this.game.profile;
    const o = p.pet.outfit;
    const stage = petStage(p.pet.care);
    const row = (it: (typeof PET_ITEMS)[number]): MenuItem => {
      const owned = o.owned.includes(it.id);
      const locked = !owned && stage < (it.minStage ?? 0);
      return this.wearRow({
        name: it.name, cost: it.cost, owned, worn: o[it.slot] === it.id,
        lock: locked ? `NEEDS ${PET_STAGES[it.minStage!].name}` : undefined,
        act: () => buyOrWearPet(p, it.id),
        poor: 'BYTE LOVES IT. YOUR WALLET DOES NOT.',
        reopen: () => this.petDressMenu(this.menu?.index),
      });
    };
    const items: MenuItem[] = [
      { label: '\u2014 HEAD \u2014', disabled: true },
      ...PET_ITEMS.filter((i) => i.slot === 'head').map(row),
      { label: '\u2014 FACE \u2014', disabled: true },
      ...PET_ITEMS.filter((i) => i.slot === 'face').map(row),
      { label: '\u2014 BACK \u2014', disabled: true },
      ...PET_ITEMS.filter((i) => i.slot === 'back').map(row),
      { label: 'BACK', onSelect: () => this.leaveDressUp() },
    ];
    this.menu = new ListMenu(`DRESS UP BYTE \u2014 ${p.bits} BITS`, items, () => this.leaveDressUp(), { x: 60, y: 20, w: 360, rows: 13, accent: '#9dff3f' });
    this.menu.index = keep ?? 1;
  }

  private decorMenu(keep?: number): void {
    const p = this.game.profile;
    const d = p.decor;
    const heads = { floor: 'FLOOR', wall: 'WALL', corner: 'CORNERS' } as const;
    const items: MenuItem[] = [];
    for (const slot of DECOR_SLOTS) {
      items.push({ label: `\u2014 ${heads[slot]} \u2014`, disabled: true });
      for (const it of DECOR.filter((x) => x.slot === slot)) {
        items.push(this.wearRow({
          name: it.name, cost: it.cost, owned: d.owned.includes(it.id), worn: d[slot] === it.id,
          act: () => buyOrWearDecor(p, it.id),
          poor: 'LOVELY TASTE. NOT ENOUGH BITS, DEAR.',
          reopen: () => this.decorMenu(this.menu?.index),
        }));
      }
    }
    items.push({ label: 'BACK', onSelect: () => { this.menu = null; this.shopMenu(); } });
    this.menu = new ListMenu(`LOBBY DECOR \u2014 ${p.bits} BITS`, items, () => { this.menu = null; this.shopMenu(); }, { x: 60, y: 20, w: 360, rows: 13, accent: '#b07aff' });
    this.menu.index = keep ?? 1;
  }

  /** Back to BYTE's menu with the cursor on DRESS UP (the dress menu's own cursor must not leak across). */
  private leaveDressUp(): void {
    this.menu = null;
    this.petMenu(4);
  }

  /** Trophies for forms a save already has (older saves arrive grown without ever "evolving"). */
  private syncPetTrophies(): void {
    const p = this.game.profile;
    const stage = petStage(p.pet.care);
    const got: string[] = [];
    if (stage >= 1) unlockAchievement(p, 'pet_evolve', got);
    if (stage >= 3) unlockAchievement(p, 'pet_giga', got);
    if (got.length) {
      this.game.announceAchievements(got);
      this.save();
    }
  }

  private addCare(n: number): void {
    const p = this.game.profile;
    const pet = p.pet;
    const stageBefore = petStage(pet.care);
    pet.care += n;
    pet.xp += n;
    while (pet.xp >= 3 && pet.bond < 5) {
      pet.xp -= 3;
      pet.bond++;
      this.game.toast('BOND UP!', `BYTE BOND ${pet.bond}/5`, '#9dff3f');
      this.game.audio.sfx('levelup');
    }
    if (pet.bond >= 5) pet.xp = 0; // past max bond the counter has nothing left to fill
    const got: string[] = [];
    if (pet.bond >= 5) unlockAchievement(p, 'pet_max', got);
    const stageAfter = petStage(pet.care);
    if (stageAfter > stageBefore) {
      unlockAchievement(p, 'pet_evolve', got);
      if (stageAfter >= 3) unlockAchievement(p, 'pet_giga', got);
      this.game.audio.sfx('levelup');
      this.particles.burst(60, 190, ['#ffcf3f', '#fff', '#9dff3f'], 30, 90);
      this.game.fx.flash('#ffffff', 0.35);
      this.game.toast('BYTE EVOLVED!', `NOW A ${PET_STAGES[stageAfter].name}. ${PET_STAGES[stageAfter].perk.toUpperCase()}`, '#9dff3f');
    }
    this.game.announceAchievements(got);
    this.save();
  }

  private feed(): void {
    const pet = this.game.profile.pet;
    if (pet.hunger <= 0) {
      this.say('byte', 'BYTE', 'Bweep. (Byte is full. Go on an adventure!)');
      this.menu = null;
      return;
    }
    pet.hunger--;
    this.game.audio.sfx('coin');
    this.particles.burst(60, 190, ['#9dff3f', '#fff'], 14, 60);
    this.addCare(1);
    this.petMenu();
  }

  private updateTrain(dt: number): void {
    const tr = this.train!;
    tr.t += dt;
    if (!tr.done) {
      tr.cursor += tr.dir * dt * 0.9;
      if (tr.cursor > 1 || tr.cursor < 0) tr.dir *= -1;
      if (this.game.input.pressed('jump') || this.game.input.pressed('confirm')) {
        tr.done = true;
        tr.t = 0;
        const ok = Math.abs(tr.cursor - tr.zone) < 0.09;
        tr.result = ok ? 'GREAT CATCH! +2 CARE' : 'BYTE TRIPPED. +1 CARE';
        this.game.audio.sfx(ok ? 'powerup' : 'bark');
        this.game.profile.pet.trainedToday = 1;
        this.addCare(ok ? 2 : 1);
      }
    } else if (tr.t > 1.2) this.train = null;
  }

  private wardrobeMenu(keep?: number): void {
    const p = this.game.profile;
    const w = p.wardrobe;
    const row = (c: (typeof COSMETICS)[number]): MenuItem => {
      const owned = w.owned.includes(c.id);
      const on = c.kind === 'palette' ? w.palette === c.id : w.hat === c.id;
      return {
        label: c.name,
        value: () => (on ? 'WORN' : owned ? 'OWNED' : `${c.cost} BITS`),
        color: on ? '#ffcf3f' : undefined,
        sub: owned ? 'Press to wear it.' : `Buy for ${c.cost} bits and wear it.`,
        onSelect: () => {
          const res = buyOrEquip(p, c.id);
          if (res === 'poor') {
            this.game.audio.sfx('miss');
            this.game.toast('MADAME POLYGON', 'THAT ONE IS A LITTLE OUT OF YOUR BUDGET.', '#b07aff');
            return;
          }
          this.game.audio.sfx(res === 'bought' ? 'powerup' : 'select');
          if (res === 'bought') this.game.toast('NEW LOOK', c.name, '#b07aff');
          this.save();
          this.wardrobeMenu(this.menu?.index);
        },
      };
    };
    const items: MenuItem[] = [
      { label: '\u2014 OUTFITS \u2014', disabled: true },
      ...COSMETICS.filter((c) => c.kind === 'palette').map(row),
      { label: '\u2014 HATS \u2014', disabled: true },
      ...COSMETICS.filter((c) => c.kind === 'hat').map(row),
      { label: 'BACK', onSelect: () => { this.menu = null; this.shopMenu(); } },
    ];
    this.menu = new ListMenu(`WARDROBE \u2014 ${p.bits} BITS`, items, () => { this.menu = null; this.shopMenu(); }, { x: 60, y: 24, w: 360, rows: 13, accent: '#b07aff' });
    this.menu.index = keep ?? 1;
  }

  private shopMenu(): void {
    const p = this.game.profile;
    const keep = this.menu?.index;
    const items: MenuItem[] = [
      { label: 'WARDROBE', sub: 'Outfits and hats for Cass. Purely for style.', onSelect: () => this.wardrobeMenu() },
      { label: 'LOBBY DECOR', sub: 'Floors, wall lights and corner pieces for the Lobby of Lost Saves.', onSelect: () => this.decorMenu() },
    ];
    items.push(...SHOP.map((s) => {
      const owned = !s.repeatable && p.abilities.includes(s.id);
      const blocked = !!(s.requires && !p.abilities.includes(s.requires));
      return {
        label: s.name,
        value: () => (owned ? 'OWNED' : `${s.cost} BITS`),
        sub: s.desc,
        disabled: owned || !!blocked,
        onSelect: () => {
          if (p.bits < s.cost) {
            this.game.audio.sfx('miss');
            this.game.toast('MADAME POLYGON', 'NOT ENOUGH BITS, DEAR.', '#b07aff');
            return;
          }
          p.bits -= s.cost;
          if (s.id === 'treats') this.addCare(3);
          else p.abilities.push(s.id);
          this.game.audio.sfx('powerup');
          this.game.toast('PURCHASED', s.name, '#b07aff');
          this.save();
          this.shopMenu();
        },
      };
    }));
    items.push({ label: 'BACK', onSelect: () => (this.menu = null) });
    this.menu = new ListMenu(`MADAME POLYGON — ${p.bits} BITS`, items, () => (this.menu = null), { x: 60, y: 30, w: 360, accent: '#b07aff', footer: POLYGON_INTRO });
    if (keep !== undefined) this.menu.index = Math.min(keep, items.length - 1);
  }

  private labMenu(keep?: number): void {
    const p = this.game.profile;
    const items: MenuItem[] = [
      { label: 'LOADOUTS', value: () => `${p.loadouts.filter(Boolean).length}/3 SAVED`, sub: 'Save which mutations are switched on as a named build, and load it back later.', onSelect: () => this.loadoutMenu() },
    ];
    items.push(...MUTATIONS.map((m) => {
      const unlocked = p.mutationsUnlocked.includes(m.id) && isUnlockSatisfied(m.unlock, p);
      return {
        label: m.name,
        value: () => (!unlocked ? describeUnlock(m.unlock) : p.mutationsDisabled.includes(m.id) ? 'OFF' : 'ON'),
        sub: `${m.cursed ? 'CURSED. ' : ''}${m.genres.map((g) => GENRES[g].name).join(' + ')} • ${m.modes.length > 3 ? 'ALL WORLDS' : m.modes.map((x) => MODE_INFO[x].title).join(', ')}: ${m.tagline}`,
        color: m.cursed ? '#ff6f6f' : GENRES[m.genres[1]].color,
        disabled: !unlocked,
        onSelect: () => {
          if (p.mutationsDisabled.includes(m.id)) p.mutationsDisabled = p.mutationsDisabled.filter((x) => x !== m.id);
          else p.mutationsDisabled.push(m.id);
          this.save();
        },
      };
    }));
    items.push({ label: 'BACK', onSelect: () => (this.menu = null) });
    this.menu = new ListMenu('MUTATION LAB \u2014 EACH MUTATION: +15% BITS (CURSES +30%)', items, () => (this.menu = null), { x: 30, y: 24, w: 420, rows: 10, accent: '#ff3fd2' });
    if (keep !== undefined) this.menu.index = Math.min(keep, items.length - 1);
  }

  /** Three saved builds: which mutations are on. Loading leaves anything unlocked since then switched off. */
  private loadoutMenu(): void {
    const p = this.game.profile;
    const items: MenuItem[] = p.loadouts.map((l, i) => ({
      label: `BUILD ${'ABC'[i]}`,
      value: () => (l ? `${l.on.length} ON` : 'EMPTY'),
      sub: l ? `${l.on.length} mutations on. Pick it to load, replace or clear.` : 'Empty. Pick it to save your current setup here.',
      onSelect: () => this.loadoutSlot(i),
    }));
    items.push({ label: 'BACK', onSelect: () => this.labMenu(0) });
    this.menu = new ListMenu('LOADOUTS', items, () => this.labMenu(0), { x: 80, y: 60, w: 320, accent: '#ff3fd2' });
  }

  private loadoutSlot(i: number): void {
    const p = this.game.profile;
    const l = p.loadouts[i];
    const on = MUTATIONS.filter((m) => p.mutationsUnlocked.includes(m.id) && isUnlockSatisfied(m.unlock, p) && !p.mutationsDisabled.includes(m.id)).map((m) => m.id);
    const actions: MenuItem[] = [
      { label: l ? 'REPLACE WITH CURRENT SETUP' : 'SAVE CURRENT SETUP', sub: `Saves the ${on.length} mutations that are on right now.`, onSelect: () => { p.loadouts[i] = { name: `BUILD ${'ABC'[i]}`, on }; this.save(); this.game.toast('LOADOUT SAVED', `BUILD ${'ABC'[i]}: ${on.length} ON`, '#ff3fd2'); this.loadoutMenu(); } },
    ];
    if (l) {
      actions.unshift({
        label: 'LOAD THIS BUILD',
        sub: 'Switch to exactly these mutations.',
        onSelect: () => {
          p.mutationsDisabled = MUTATIONS.filter((m) => p.mutationsUnlocked.includes(m.id) && !l.on.includes(m.id)).map((m) => m.id);
          this.save();
          this.game.audio.sfx('powerup');
          this.game.toast('LOADOUT LOADED', `BUILD ${'ABC'[i]}`, '#ff3fd2');
          this.loadoutMenu();
        },
      });
      actions.push({ label: 'CLEAR THIS SLOT', onSelect: () => { p.loadouts[i] = null; this.save(); this.loadoutMenu(); } });
    }
    const names = l ? l.on.map((id) => MUTATION_BY_ID.get(id)?.name ?? id) : [];
    this.card(`BUILD ${'ABC'[i]}`, l ? `ON: ${names.join(', ') || 'NOTHING'}` : 'Nothing saved here yet.', () => this.loadoutMenu(), [], actions);
  }

  private shrineMenu(): void {
    const p = this.game.profile;
    const cats: Array<ChaosCategory | null> = [null, 'cosmetic', 'environmental', 'combat', 'genre', 'legendary'];
    const desc: Record<string, string> = {
      none: 'The Director chooses freely.',
      cosmetic: 'Mostly harmless visual chaos.',
      environmental: 'Gravity, fog, power surges, musical floors.',
      combat: 'Size changes, bouncy bullets, reversed worlds.',
      genre: 'Whole-genre swaps: karts, mechas, stolen movesets.',
      legendary: 'Kevin. Blue screens. Jackpots. Use with caution.',
    };
    const items: MenuItem[] = cats.map((c) => ({
      label: (c ?? 'NO FAVOR').toUpperCase(),
      value: () => (p.chaosFavor === c ? '★' : ''),
      sub: desc[c ?? 'none'],
      onSelect: () => {
        p.chaosFavor = c;
        this.save();
        this.game.audio.sfx('chaos');
      },
    }));
    items.push({ label: 'BACK', onSelect: () => (this.menu = null) });
    this.menu = new ListMenu('CHAOS SHRINE — BIAS THE DIRECTOR (x3 WEIGHT)', items, () => (this.menu = null), { x: 60, y: 40, w: 360, accent: '#ff3fa4', footer: 'Chaos orbs in levels summon an event on demand.' });
  }

  /**
   * Detail page for list rows with nothing to "do": a small menu of text lines plus BACK, shown in
   * place of the list (no dialogue involved, so A, a tap or II/back always returns to the same row).
   */
  private card(name: string, text: string, reopen: (at?: number) => void, rows: Array<[string, string]> = [], actions: MenuItem[] = []): void {
    const at = this.menu?.index;
    const back = () => reopen(at);
    const items: MenuItem[] = [
      ...wrap(text, 52).map((line) => ({ label: line, disabled: true, color: '#ddd' })),
      ...rows.map(([label, value]) => ({ label, value: () => value, disabled: true })),
      ...actions,
      { label: 'BACK', onSelect: back },
    ];
    this.menu = new ListMenu(name, items, back, { x: 60, y: 50, w: 360, accent: '#ffcf3f' });
    // The cursor starts on the first thing you can do (PLAY NOW if there is one), not on the text.
    this.menu.index = actions.length ? items.length - 1 - actions.length : items.length - 1;
  }

  private trophyMenu(keep?: number): void {
    const p = this.game.profile;
    const items: MenuItem[] = [
      { label: `LEVEL ${p.level}`, value: () => `${p.xp - xpForLevel(p.level)}/${xpForLevel(p.level + 1) - xpForLevel(p.level)} XP`, disabled: true },
      { label: `FLOPPIES ${p.floppies.length}/${TOTAL_FLOPPIES}`, value: () => `${p.achievements.length}/${ACHIEVEMENTS.length} TROPHIES`, disabled: true },
      ...ACHIEVEMENTS.map((a) => ({ label: (p.achievements.includes(a.id) ? '★ ' : '☆ ') + a.name, sub: a.desc, color: p.achievements.includes(a.id) ? '#ffcf3f' : '#777', onSelect: () => this.card(a.name, `${a.desc} ${p.achievements.includes(a.id) ? 'Earned!' : 'Not earned yet.'}`, (at) => this.trophyMenu(at)) })),
      { label: '— WHO\'S WHO —', disabled: true },
      ...Object.values(CAST).map((c) => ({ label: c.name, sub: c.bio, onSelect: () => this.card(c.name, c.bio, (at) => this.trophyMenu(at)) })),
      ...BOSSES.map((b) => ({ label: `BOSS: ${b.name}`, sub: `${b.title}. ${b.bio}`, color: '#ff6f3f', onSelect: () => this.card(b.name, `${b.title}. ${b.bio}`, (at) => this.trophyMenu(at)) })),
      { label: 'BACK', onSelect: () => (this.menu = null) },
    ];
    this.menu = new ListMenu('TROPHY CASE & ARCHIVES', items, () => (this.menu = null), { x: 40, y: 20, w: 400, rows: 13, accent: '#ffcf3f' });
    if (keep !== undefined) this.menu.index = Math.min(keep, items.length - 1);
  }

  /** Changes whenever any quest advances, so the board only flags real news. */
  private questSig(): number {
    const p = this.game.profile;
    const w = weeklyView(p);
    return errandView(p, dateKey()).progress * 10 + p.questsDone.length * 100000 + Object.values(p.questProgress).reduce((a, b) => a + b, 0) + w.done.length * 1000 + Object.values(w.progress).reduce((a, b) => a + b, 0);
  }

  /** The world a world-quest should start: the fastest one for speed runs, else the first you have not cleared. */
  private questWorld(id: string): ModeId {
    const p = this.game.profile;
    if (id === 'speed_demon') return 'rampage';
    const open = MODE_IDS.filter((m) => isModeUnlocked(m, p.cleared));
    return open.find((m) => p.cleared[m].clears === 0 && m !== 'beatdown' && m !== 'rhythm') ?? open.find((m) => p.cleared[m].clears === 0) ?? 'rampage';
  }

  /** PLAY NOW starts the game for this quest right away; world quests also offer a world list. */
  private questActions(id: string, play: 'worlds' | 'arcade' | 'daily' | MiniId, ok: boolean): MenuItem[] {
    const verb = ok ? 'PLAY AGAIN' : 'PLAY NOW';
    if (play === 'worlds') {
      const m = this.questWorld(id);
      return [
        { label: `${verb}: ${MODE_INFO[m].title}`, sub: MODE_INFO[m].blurb, onSelect: () => { this.menu = null; this.game.startMode(m); } },
        { label: 'CHOOSE ANOTHER WORLD', sub: 'Pick any unlocked world.', onSelect: () => this.worldPicker() },
      ];
    }
    if (play === 'arcade') return [{ label: verb, sub: 'Open the mini-game arcade.', onSelect: () => this.arcadeMenu() }];
    if (play === 'daily') return [{ label: verb, sub: 'Open today\'s daily challenge.', onSelect: () => this.dailyMenu() }];
    const title = MINIS.find((x) => x.id === play)?.title ?? 'the game';
    return [{ label: `${verb}: ${title}`, sub: `Start ${title}.`, onSelect: () => { this.menu = null; startMini(this.game, play); } }];
  }

  private questMenu(keep?: number): void {
    const p = this.game.profile;
    this.game.questSeenSig = this.questSig();
    const done = p.questsDone.length;
    const items: MenuItem[] = [
      { label: '\u2014 TODAY\'S ERRAND \u2014', disabled: true },
      (() => {
        const e = errandFor(dateKey());
        const st = errandView(p, dateKey());
        const prog = Math.min(e.goal, st.progress);
        const play = e.metric === 'points' ? 'arcade' : 'worlds';
        return {
          label: (st.done ? '\u2605 ' : '\u2606 ') + e.title,
          value: () => (st.done ? 'DONE' : `${prog}/${e.goal}`),
          sub: `${e.summary} From ${e.giver === 'polygon' ? 'MADAME POLYGON' : e.giver === 'kevin' ? 'KEVIN' : e.giver === 'rex' ? 'REX' : 'THE MANUAL'}. Reward: ${e.bits} bits + ${e.xp} XP.`,
          color: st.done ? '#9dff3f' : '#c8ffb0',
          onSelect: () => this.card(e.title, e.summary, (at) => this.questMenu(at), [['FROM', e.giver.toUpperCase()], ['STATUS', st.done ? 'COMPLETE' : `${prog} / ${e.goal}`], ['REWARD', `${e.bits} BITS + ${e.xp} XP`]], this.questActions(e.id, play, st.done)),
        };
      })(),
      { label: '\u2014 THIS WEEK (RESETS MONDAY) \u2014', disabled: true },
      ...weeklyFor(weekKey()).map((w) => {
        const st = weeklyView(p);
        const ok = st.done.includes(w.id);
        const prog = Math.min(w.goal, st.progress[w.id] ?? 0);
        return {
          label: (ok ? '\u2605 ' : '\u2606 ') + w.title,
          value: () => (ok ? 'DONE' : `${prog}/${w.goal}`),
          sub: `${w.desc} Reward: ${w.bits} bits + ${w.xp} XP.`,
          color: ok ? '#3fe0ff' : '#9fe8ff',
          onSelect: () => this.card(w.title, w.desc, (at) => this.questMenu(at), [
            ['STATUS', ok ? 'COMPLETE' : `${prog} / ${w.goal}`],
            ['REWARD', `${w.bits} BITS + ${w.xp} XP`],
          ], this.questActions(w.id, w.play, ok)),
        };
      }),
      { label: 'WEEKLY SWEEP', value: () => (weeklyView(p).swept ? 'PAID' : `ALL THREE: +${SWEEP_BITS} BITS`), disabled: true, sub: 'Finish all three weekly goals for a bonus.' },
      { label: '\u2014 QUESTS \u2014', disabled: true },
      { label: `COMPLETED ${done}/${QUESTS.length}`, value: () => (done === QUESTS.length ? 'ALL DONE!' : ''), disabled: true },
      ...QUESTS.slice().sort((a, b) => Number(p.questsDone.includes(a.id)) - Number(p.questsDone.includes(b.id))).map((q) => {
        const ok = p.questsDone.includes(q.id);
        const prog = Math.min(q.goal, p.questProgress[q.id] ?? 0);
        return {
          label: (ok ? '\u2605 ' : '\u2606 ') + q.title,
          value: () => (ok ? 'DONE' : `${prog}/${q.goal}`),
          sub: `${q.desc} Reward: ${q.bits} bits + ${q.xp} XP.`,
          color: ok ? '#ffcf3f' : undefined,
          // Confirm opens the quest card, so A / Z / Enter does something on every row.
          onSelect: () => this.card(q.title, q.desc, (at) => this.questMenu(at), [
            ['STATUS', ok ? 'COMPLETE' : `${prog} / ${q.goal}`],
            ['REWARD', `${q.bits} BITS + ${q.xp} XP`],
          ], this.questActions(q.id, q.play, ok)),
        };
      }),
      { label: 'BACK', onSelect: () => (this.menu = null) },
    ];
    this.menu = new ListMenu('QUEST BOARD \u2014 PAID AUTOMATICALLY WHEN DONE', items, () => (this.menu = null), { x: 50, y: 24, w: 380, rows: 11, accent: '#ffcf3f' });
    if (keep !== undefined) this.menu.index = Math.min(keep, items.length - 1);
  }

  /** Today's run for this player, and the modifier that seed rolls (same for everyone). */
  private todaysRun(): { key: string; mode: ModeId; seed: number; modifier: string; open: boolean } {
    const p = this.game.profile;
    const key = dateKey();
    const d = dailyFor(key);
    return { ...d, modifier: new Rng(d.seed).fork(77).pick(MODIFIERS).name, open: isModeUnlocked(d.mode, p.cleared) };
  }

  private copyLink(mode: ModeId, seed: number): void {
    const url = challengeUrl(`${location.origin}${location.pathname}`, { mode, seed });
    const done = () => this.game.toast('LINK COPIED', 'SEND IT TO A FRIEND', '#3fe0ff');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this challenge link:', url));
    else window.prompt('Copy this challenge link:', url);
  }

  private dailyMenu(keep?: number): void {
    const p = this.game.profile;
    const t = this.todaysRun();
    const rec = p.daily.key === t.key ? p.daily : null;
    const streak = currentStreak(p.daily, t.key);
    const info = MODE_INFO[t.mode];
    const items: MenuItem[] = [
      { label: 'TODAY', value: () => `${info.title}  #${formatSeed(t.seed)}`, disabled: true, color: info.color },
      { label: 'MODIFIER', value: () => t.modifier, disabled: true },
      { label: 'BEST TODAY', value: () => (rec ? `${rec.best}${rec.cleared ? '  \u2605 CLEARED' : ''}` : '\u2014'), disabled: true },
      { label: 'STREAK', value: () => `${streak} DAY${streak === 1 ? '' : 'S'}`, disabled: true },
      {
        label: !t.open ? `LOCKED: ${lockHint(t.mode).toUpperCase().replace(/\.$/, '')}` : rec?.cleared ? 'PLAY AGAIN (NO BONUS)' : `PLAY TODAY'S RUN  +${DAILY_BONUS + 10 * Math.min(streak + 1, 7)} BITS`,
        disabled: !t.open,
        sub: 'Same world, seed and modifier for everyone today. One clear per day pays the bonus.',
        onSelect: () => { this.menu = null; this.game.startMode(t.mode, { seed: t.seed, daily: t.key }); },
      },
      { label: 'COPY CHALLENGE LINK', sub: 'Anyone who opens the link plays this exact run.', onSelect: () => this.copyLink(t.mode, t.seed) },
    ];
    const shared = this.game.sharedChallenge;
    if (shared && isModeUnlocked(shared.mode, p.cleared)) {
      items.push({
        label: `FRIEND'S CHALLENGE: ${MODE_INFO[shared.mode].title} #${formatSeed(shared.seed)}`,
        sub: 'From the link you opened. Same run as whoever sent it.',
        onSelect: () => { this.menu = null; this.game.startMode(shared.mode, { seed: shared.seed }); },
      });
    }
    items.push({ label: 'BACK', onSelect: () => (this.menu = null) });
    this.menu = new ListMenu(`DAILY CHALLENGE \u2014 ${t.key}`, items, () => (this.menu = null), { x: 40, y: 40, w: 400, accent: '#ffcf3f' });
    this.menu.index = keep ?? (t.open ? 4 : 5);
  }

  private arcadeMenu(): void {
    const p = this.game.profile;
    const items: MenuItem[] = [
      ...MINIS.filter((m) => m.id !== 'dash' || secretCabinetOpen(p)).map((m) => ({
        label: m.title,
        value: () => `BEST ${p.mini[m.id]?.best ?? 0}`,
        sub: `${m.blurb} ${m.pays}`,
        onSelect: () => { this.menu = null; startMini(this.game, m.id); },
      })),
      { label: 'BACK', onSelect: () => (this.menu = null) },
    ];
    this.menu = new ListMenu('MINI-GAME ARCADE', items, () => (this.menu = null), { x: 60, y: 60, w: 360, accent: '#3fe0ff' });
  }

  // ---- drawing -------------------------------------------------------------------------
  draw(ctx: CanvasRenderingContext2D): void {
    const p = this.game.profile;
    const pal = PAL.hub;
    const t = this.t;
    // Arcade carpet
    rect(ctx, 0, 0, W, H, pal.bg0);
    for (let y = CAB_Y + 30; y < H; y += 16) {
      for (let x = 0; x < W; x += 16) {
        rect(ctx, x, y, 16, 16, (x / 16 + y / 16) % 2 ? '#1d1233' : '#1a0f2e');
        const k = (x * 7 + y * 13) % 5;
        if (k === 0) rect(ctx, x + 4, y + 6, 6, 2, '#ff3fa455');
        if (k === 2) rect(ctx, x + 8, y + 3, 2, 6, '#3fe0ff44');
        if (k === 4) rect(ctx, x + 3, y + 10, 3, 3, '#ffcf3f44');
      }
    }
    this.drawDecor(ctx, 'floor');
    // Back wall with neon trim: darker toward the ceiling, glow spilling onto the floor
    const wall = ctx.createLinearGradient(0, 0, 0, CAB_Y + 30);
    wall.addColorStop(0, '#0a0518');
    wall.addColorStop(1, '#1c1038');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, CAB_Y + 30);
    rect(ctx, 0, CAB_Y + 28, W, 2, pal.accent);
    const spill = ctx.createLinearGradient(0, CAB_Y + 30, 0, CAB_Y + 70);
    spill.addColorStop(0, 'rgba(255,63,164,0.28)');
    spill.addColorStop(1, 'rgba(255,63,164,0)');
    ctx.fillStyle = spill;
    ctx.fillRect(0, CAB_Y + 30, W, 40);
    // Light pools under each cabinet
    CAB_X.forEach((cx, i) => {
      const on = isModeUnlocked(MODE_IDS[i], p.cleared);
      ctx.globalAlpha = on ? 0.22 + Math.sin(t * 2 + i) * 0.04 : 0.08;
      rect(ctx, cx - 6, CAB_Y + 34, 44, 4, on ? MODE_INFO[MODE_IDS[i]].color : '#8a7aa0');
      rect(ctx, cx - 2, CAB_Y + 38, 36, 3, on ? MODE_INFO[MODE_IDS[i]].color : '#8a7aa0');
      ctx.globalAlpha = 1;
    });
    this.drawDecor(ctx, 'wall');
    this.drawDecor(ctx, 'corner');
    // Contact shadows for the big props
    for (const [sx, sy, sw] of [[214, 160, 52], [316, 243, 28], [40, 213, 40], [404, 215, 34]]) rect(ctx, sx + 2, sy, sw, 4, 'rgba(0,0,0,0.35)');
    drawText(ctx, 'THE LOBBY OF LOST SAVES', W / 2, 8, pal.accent2, { align: 'center', scale: 2 });
    // Cabinets
    MODE_IDS.forEach((m, i) => this.drawCabinet(ctx, CAB_X[i], CAB_Y - 20, m, isModeUnlocked(m, p.cleared)));
    // Core
    const shards = p.bossesDefeated.filter((b) => b === 'bricklord' || b === 'static').length;
    rect(ctx, 214, 140, 52, 20, '#2a2a3a');
    drawCoreIcon(ctx, 240, 132, t, 2);
    for (let i = 0; i < 2; i++) rect(ctx, 226 + i * 22, 156, 6, 6, i < shards ? (i ? '#ff3fd2' : '#ff6f3f') : '#444');
    drawManual(ctx, 270, 130, t);
    // Stations
    // New players: a bouncing arrow over the first cabinet says where to start.
    if (!this.menu && p.runsStarted === 0) {
      const bob = Math.round(Math.sin(this.t * 5) * 3);
      drawText(ctx, 'START HERE', CAB_X[0] + 16, 22 + bob, '#7dff6b', { align: 'center' });
      drawText(ctx, '\u25BC', CAB_X[0] + 16, 30 + bob, '#7dff6b', { align: 'center' });
    }
    this.drawQuestBoard(ctx);
    this.drawErrandMarker(ctx);
    this.drawSecretCabinet(ctx);
    this.drawDailySign(ctx);
    this.drawMiniCabinet(ctx);
    this.drawStation(ctx, 440, 140, 'LAB', '#ff3fd2');
    this.drawStation(ctx, 40, 140, 'SHRINE', '#ff3fa4');
    rect(ctx, 316, 222, 28, 22, '#3a2a10');
    rect(ctx, 318, 224, 24, 10, '#ffcf3f55');
    drawText(ctx, '★', 330, 226, '#ffcf3f', { align: 'center', shadow: null });
    // Pet corner
    rect(ctx, 40, 204, 40, 10, '#3a1a4a');
    drawByte(ctx, 60, 204, t, p.pet.bond, p.pet.hunger > 1 ? 'sad' : 'happy', petForm(p.pet));
    if (p.pet.hunger > 0) drawText(ctx, '♥?', 70, 182, '#9dff3f');
    // Shop
    rect(ctx, 404, 206, 34, 10, '#3a1a4a');
    drawPolygon(ctx, 420, 206, t);
    drawRex(ctx, 150, 240, t, 1);
    drawKevin(ctx, this.kevinX, 118, t, this.kevinDir);
    if (p.secretUnlocked) drawDemo(ctx, { x: 220, y: 244, facing: 1, pose: 'idle', t });
    if (p.bossChoices.bricklord === 'mercy') this.drawMiniBrick(ctx, 380, 170);
    if (p.bossChoices.static === 'mercy') this.drawMiniStatic(ctx, 100, 170);
    if (p.bossChoices.bricklord === 'purge') drawText(ctx, 'RIP BRICKLORD', 380, 168, '#555', { align: 'center' });
    if (p.bossChoices.static === 'purge') drawText(ctx, 'RIP DJ STATIC', 100, 168, '#555', { align: 'center' });
    // Player
    drawCass(ctx, { x: this.px, y: this.py, facing: this.facing, pose: this.moving ? 'run' : 'idle', t }, p.character);
    this.particles.draw(ctx);
    // Prompt
    if (this.near && !this.menu && !this.game.inDialog) {
      const w = this.near.label.length * 6 + 40;
      frame(ctx, this.near.x - w / 2, this.near.y - 52, w, 14, '#0b0716ee', '#ffcf3f');
      drawText(ctx, this.game.input.label(`Z: ${this.near.label}`), this.near.x, this.near.y - 48, '#ffcf3f', { align: 'center' });
    }
    // HUD
    rect(ctx, 0, H - 12, W, 12, '#000a');
    drawText(ctx, `LV ${p.level}`, 6, H - 10, '#7dff6b');
    bar(ctx, 36, H - 8, 40, 3, (p.xp - xpForLevel(p.level)) / Math.max(1, xpForLevel(p.level + 1) - xpForLevel(p.level)), '#7dff6b', '#020', '#ffffff44');
    drawText(ctx, `${p.bits} BITS`, 86, H - 10, '#ffcf3f');
    drawText(ctx, `DISKS ${p.floppies.length}/${TOTAL_FLOPPIES}`, 160, H - 10, '#3fe0ff');
    drawText(ctx, `SHARDS ${shards}/2`, 248, H - 10, '#ff6f3f');
    drawText(ctx, this.game.input.label('Z INTERACT • ESC MENU'), W - 6, H - 10, '#9a9ab8', { align: 'right' });
    this.drawSeason(ctx);
    this.drawTour(ctx);
    if (this.menu) {
      rect(ctx, 0, 0, W, H, '#0006');
      this.menu.draw(ctx, t);
    }
    if (this.train) this.drawTrain(ctx);
    if (this.paletteFlip > 0) {
      ctx.globalCompositeOperation = 'difference';
      rect(ctx, 0, 0, W, H, '#ffffff');
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Bought lobby decorations (see data/decor.ts), drawn in three layers. */
  private drawDecor(ctx: CanvasRenderingContext2D, layer: 'floor' | 'wall' | 'corner'): void {
    const d = this.game.profile.decor;
    const t = this.t;
    if (layer === 'floor') {
      const top = CAB_Y + 30;
      if (d.floor === 'checker') {
        for (let y = top; y < H; y += 32) for (let x = 0; x < W; x += 32) rect(ctx, x + ((y / 32) % 2 ? 16 : 0), y, 16, 16, 'rgba(255,255,255,0.05)');
      } else if (d.floor === 'grid') {
        for (let x = 0; x < W; x += 24) rect(ctx, x, top, 1, H - top, 'rgba(63,224,255,0.16)');
        for (let y = top; y < H; y += 24) rect(ctx, 0, y, W, 1, 'rgba(63,224,255,0.16)');
        const sweep = (t * 30) % (H - top);
        rect(ctx, 0, top + sweep, W, 1, 'rgba(63,224,255,0.3)');
      } else if (d.floor === 'confetti') {
        const cols = ['#ff3fa4', '#3fe0ff', '#ffcf3f', '#7dff6b', '#b07aff'];
        for (let i = 0; i < 90; i++) rect(ctx, (i * 53) % W, top + 4 + ((i * 37) % (H - top - 8)), 3, 2, cols[i % 5] + '88');
      }
      return;
    }
    if (layer === 'wall') {
      if (d.wall === 'pennants') {
        const cols = ['#ff3fa4', '#3fe0ff', '#ffcf3f', '#7dff6b'];
        for (let x = 0; x < W; x += 12) {
          const y = 26 + Math.round(Math.sin(x / 40) * 2);
          rect(ctx, x, y, 12, 1, '#ffffff88');
          rect(ctx, x + 1, y + 1, 9, 3, cols[(x / 12) % 4]);
          rect(ctx, x + 3, y + 4, 5, 2, cols[(x / 12) % 4]);
          rect(ctx, x + 5, y + 6, 1, 1, cols[(x / 12) % 4]);
        }
      } else if (d.wall === 'lights') {
        const cols = ['#ff3fa4', '#3fe0ff', '#ffcf3f', '#7dff6b'];
        for (let x = 4; x < W; x += 14) {
          const y = 28 + Math.round(Math.sin(x / 30) * 3);
          const on = (Math.floor(t * 1.2) + x / 14) % 4;
          rect(ctx, x, y - 1, 14, 1, '#ffffff33');
          glow(ctx, x + 7, y + 3, 7, '255,223,128', on === 0 ? 0.5 : 0.22);
          rect(ctx, x + 6, y + 1, 3, 3, cols[(x / 14) % 4]);
        }
      } else if (d.wall === 'stars') {
        for (let i = 0; i < 26; i++) {
          const x = (i * 61 + 13) % W;
          const y = 28 + ((i * 29) % 58);
          ctx.globalAlpha = 0.35 + Math.sin(t * 0.8 + i) * 0.25;
          rect(ctx, x, y, 3, 1, '#ffe9a8');
          rect(ctx, x + 1, y - 1, 1, 3, '#ffe9a8');
          ctx.globalAlpha = 1;
        }
      }
      return;
    }
    // corner pieces, mirrored left and right
    if (!d.corner) return;
    for (const [x, dir] of [[20, 1], [W - 20, -1]] as const) {
      const y = 252;
      if (d.corner === 'plants') {
        rect(ctx, x - 5, y - 8, 10, 8, '#8a4a2a');
        rect(ctx, x - 6, y - 9, 12, 2, '#a85a32');
        const sway = Math.round(Math.sin(t * 1.5 + x) * 1);
        for (const [lx, ly, lw] of [[-6, -18, 4], [-2, -23, 4], [2, -18, 4], [-4, -14, 8]] as const) rect(ctx, x + lx + sway, y + ly, lw, 5, '#4fe07a');
        rect(ctx, x - 1, y - 20, 2, 12, '#2a8a4a');
      } else if (d.corner === 'lamps') {
        rect(ctx, x - 4, y - 4, 8, 4, '#444458');
        rect(ctx, x - 3, y - 20, 6, 16, '#ff3fa4aa');
        rect(ctx, x - 2, y - 22, 4, 2, '#444458');
        const b = Math.sin(t * 0.7 + x) * 5;
        glow(ctx, x, y - 12 + b, 9, '255,159,63', 0.6);
        rect(ctx, x - 2, y - 14 + Math.round(b), 4, 4, '#ffcf3f');
        glow(ctx, x, y - 12, 18, '255,63,164', 0.12);
      } else if (d.corner === 'speakers') {
        const pump = Math.floor(t * 4) % 2;
        for (const [oy, h] of [[-16, 16], [-30, 14]] as const) {
          rect(ctx, x - 7, y + oy, 14, h, '#15101f');
          rect(ctx, x - 6, y + oy + 1, 12, h - 2, '#241a38');
          rect(ctx, x - 3 + dir * 0, y + oy + h / 2 - 3, 6, 6, '#0b0716');
          rect(ctx, x - 2, y + oy + h / 2 - 2, 4, 4, pump && oy === -16 ? '#ff3fa4' : '#3a2a58');
        }
      }
    }
  }

  private drawCabinet(ctx: CanvasRenderingContext2D, x: number, y: number, m: ModeId, on: boolean): void {
    const info = MODE_INFO[m];
    rect(ctx, x, y, 32, 52, '#1a1030');
    rect(ctx, x + 2, y + 2, 28, 6, on ? info.color : '#333');
    rect(ctx, x + 4, y + 10, 24, 18, '#000');
    if (on) {
      // Attract-mode screen: each cabinet animates its own genre
      const t = this.t;
      switch (m) {
        case 'rampage': rect(ctx, x + 6 + ((t * 10) % 18), y + 20, 3, 4, '#ff3fa4'); rect(ctx, x + 4, y + 24, 24, 4, '#4fe07a'); break;
        case 'neon': for (let i = 0; i < 4; i++) rect(ctx, x + 16 - i * 3, y + 14 + i * 4, 1 + i * 6, 1, '#ff3fa4'); rect(ctx, x + 14, y + 25, 4, 2, '#3fe0ff'); break;
        case 'mall': if (Math.floor(t * 2) % 3) { rect(ctx, x + 12, y + 16, 2, 2, '#ff2040'); rect(ctx, x + 17, y + 16, 2, 2, '#ff2040'); } break;
        case 'beatdown': rect(ctx, x + 8, y + 18, 5, 8, '#20c4b0'); rect(ctx, x + 18, y + 14, 7, 12, '#ff3f3f'); break;
        case 'blocks': for (let i = 0; i < 4; i++) rect(ctx, x + 9 + ((i + Math.floor(t * 2)) % 4) * 4 - (i % 2) * 0, y + 24 - i * 4, 8, 3, ['#3fe0ff', '#b07aff', '#ffe23f', '#7dff6b'][i]); rect(ctx, x + 6, y + 12 + ((t * 10) % 8), 4, 4, '#ff3f5a'); break;
        case 'bolt': rect(ctx, x + 4, y + 26, 24, 2, '#2a6aa8'); rect(ctx, x + 6 + ((t * 12) % 14), y + 17, 4, 9, '#3f9fff'); rect(ctx, x + 18 + ((t * 24) % 8), y + 20, 3, 2, '#ffe23f'); rect(ctx, x + 20, y + 14, 6, 12, '#ff7a1a'); break;
        case 'penalty': rect(ctx, x + 4, y + 10, 24, 18, '#0f4a24'); rect(ctx, x + 10, y + 11, 12, 2, '#fff'); rect(ctx, x + 12 + Math.round(Math.sin(t * 3) * 4), y + 13, 4, 3, '#ff9f3f'); rect(ctx, x + 15, y + 26 - ((t * 14) % 14), 3, 3, '#fff'); rect(ctx, x + 6 + ((t * 20) % 22), y + 18, 2, 2, '#ff3fd2'); break;
        case 'command': for (let i = 0; i < 5; i++) rect(ctx, x + 5 + i * 4, y + 22 - (i % 2) * 6, 3, 3, i % 2 ? '#7dff6b' : '#ff3f6b'); rect(ctx, x + 5, y + 25, 22, 2, '#2a2438'); rect(ctx, x + 6 + ((t * 14) % 16), y + 23, 3, 3, '#ffcf3f'); break;
        case 'rhythm': for (let i = 0; i < 4; i++) rect(ctx, x + 6 + i * 5, y + 10 + ((t * 30 + i * 7) % 16), 4, 2, ['#ff3fd2', '#3fe0ff', '#7dff6b', '#ffcf3f'][i]); break;
      }
    } else drawText(ctx, 'X', x + 16, y + 15, '#555', { align: 'center' });
    rect(ctx, x + 6, y + 32, 20, 4, '#333');
    rect(ctx, x + 10, y + 30, 3, 3, '#ff3f3f');
    rect(ctx, x + 18, y + 31, 3, 3, '#3fe0ff');
    const cleared = this.game.profile.cleared[m].clears > 0;
    if (cleared) drawText(ctx, '★', x + 16, y + 40, '#ffcf3f', { align: 'center', shadow: null });
    // Mastery stars: three pips under the screen, gold when earned.
    const stars = starCount(this.game.profile, m);
    if (on) for (let i = 0; i < 3; i++) rect(ctx, x + 8 + i * 6, y + 49, 4, 4, i < stars ? '#ffcf3f' : '#3a3050');
    drawText(ctx, info.short ?? info.title.split(' ')[0], x + 16, y + 56, on ? info.color : '#555', { align: 'center' });
  }

  /** Seasonal dress-up: a colour wash plus a few drifting things, all cheap rectangles. */
  private drawSeason(ctx: CanvasRenderingContext2D): void {
    const s = this.season;
    if (!s) return;
    const t = this.t;
    ctx.fillStyle = `rgba(${s.tint},0.06)`;
    ctx.fillRect(0, 0, W, H - 12);
    if (s.id === 'halloween') {
      for (let i = 0; i < 3; i++) {
        const x = ((t * 26 + i * 170) % (W + 60)) - 30;
        const y = 36 + i * 10 + Math.sin(t * 3 + i * 2) * 12;
        const flap = Math.floor(t * 8 + i) % 2;
        rect(ctx, x - 1, y, 3, 3, '#15101f');
        rect(ctx, x - 7, y - 2 + flap * 3, 6, 2, '#15101f');
        rect(ctx, x + 2, y - 2 + flap * 3, 6, 2, '#15101f');
      }
      for (const [px, py] of [[62, 246], [416, 248]]) {
        rect(ctx, px - 8, py - 12, 16, 12, '#ff7a1a');
        rect(ctx, px - 5, py - 14, 10, 3, '#ff9f3f');
        rect(ctx, px - 1, py - 17, 3, 4, '#3a7a2a');
        rect(ctx, px - 5, py - 9, 3, 3, '#3a1a05');
        rect(ctx, px + 2, py - 9, 3, 3, '#3a1a05');
        rect(ctx, px - 4, py - 4, 8, 2, '#3a1a05');
        glow(ctx, px, py - 7, 16, '255,160,40', 0.25 + Math.sin(t * 2.4 + px) * 0.05);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      for (let k = 1; k <= 3; k++) { ctx.moveTo(0, k * 9); ctx.lineTo(k * 11, 0); ctx.moveTo(W, k * 9); ctx.lineTo(W - k * 11, 0); }
      ctx.stroke();
    } else if (s.id === 'winter') {
      for (let i = 0; i < 42; i++) {
        const x = (i * 47 + Math.sin(t * 0.8 + i) * 8 + W) % W;
        const y = (t * (16 + (i % 4) * 5) + i * 29) % (H - 14);
        rect(ctx, x, y, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1, 'rgba(255,255,255,0.75)');
      }
    } else if (s.id === 'love') {
      for (let i = 0; i < 12; i++) {
        const x = (i * 53 + Math.sin(t * 1.4 + i) * 10 + W) % W;
        const y = H - 14 - ((t * 18 + i * 37) % (H - 20));
        ctx.globalAlpha = 0.6;
        rect(ctx, x - 2, y - 1, 2, 2, '#ff7aa8');
        rect(ctx, x + 1, y - 1, 2, 2, '#ff7aa8');
        rect(ctx, x - 2, y + 1, 5, 2, '#ff7aa8');
        rect(ctx, x - 1, y + 3, 3, 1, '#ff7aa8');
        ctx.globalAlpha = 1;
      }
    } else if (s.id === 'bloom') {
      for (let i = 0; i < 26; i++) {
        const x = ((t * 14 + i * 41) % (W + 20)) - 10;
        const y = (t * 10 + i * 23 + Math.sin(t + i) * 6) % (H - 14);
        rect(ctx, x, y, 3, 2, i % 2 ? '#ffb3d9' : '#fff0f6');
      }
    } else if (s.id === 'summer') {
      glow(ctx, W - 40, 8, 90, '255,226,63', 0.18);
      for (let i = 0; i < 14; i++) {
        const x = (i * 71 + Math.sin(t * 0.6 + i) * 18 + W) % W;
        const y = 100 + ((i * 53) % 140) + Math.sin(t * 0.9 + i * 1.7) * 8;
        ctx.globalAlpha = 0.25 + Math.max(0, Math.sin(t * 1.1 + i * 2.3)) * 0.6;
        rect(ctx, x, y, 2, 2, '#fff7a8');
        ctx.globalAlpha = 1;
      }
    }
  }

  /** The hidden sixth cabinet: it only exists once a world is fully mastered. */
  private drawSecretCabinet(ctx: CanvasRenderingContext2D): void {
    if (!secretCabinetOpen(this.game.profile)) return;
    const x = 449, y = 160;
    rect(ctx, x + 2, y + 44, 28, 4, 'rgba(0,0,0,0.35)');
    rect(ctx, x, y, 28, 44, '#1a1030');
    rect(ctx, x + 2, y + 2, 24, 5, '#ff9f3f');
    rect(ctx, x + 4, y + 9, 20, 16, '#000');
    const hop = Math.abs(Math.sin(this.t * 5)) * 4;
    rect(ctx, x + 8 + ((this.t * 14) % 8), y + 21 - hop, 5, 3, '#c98b4a');
    rect(ctx, x + 16, y + 20, 2, 5, '#ff3f6b');
    rect(ctx, x + 6, y + 28, 4, 4, '#ff3f6b');
    rect(ctx, x + 14, y + 28, 4, 4, '#3fe0ff');
    ctx.globalAlpha = 0.25 + Math.sin(this.t * 2) * 0.1;
    glow(ctx, x + 14, y + 20, 26, '255,159,63', 0.5);
    ctx.globalAlpha = 1;
    drawText(ctx, 'DASH', x + 14, y + 49, '#ff9f3f', { align: 'center' });
  }

  /** A bobbing "!" over whoever has a favour to ask, or is waiting to say thanks. */
  private drawErrandMarker(ctx: CanvasRenderingContext2D): void {
    if (this.menu || this.game.inDialog) return;
    const p = this.game.profile;
    const e = this.errandDef;
    const st = p.errand.key === this.dayKey ? p.errand : null;
    if (st?.asked && !(st.done && !st.thanked)) return;
    const id = { rex: 'rex', kevin: 'kevin', polygon: 'shop', manual: 'manual' }[e.giver];
    const th = this.things.find((x) => x.id === id);
    if (!th) return;
    const bob = Math.round(Math.sin(this.t * 4) * 2);
    drawText(ctx, st?.done ? '\u2605' : '!', th.x, th.y - 58 + bob, st?.done ? '#7dff6b' : '#9dff3f', { align: 'center', scale: 2 });
  }

  private drawQuestBoard(ctx: CanvasRenderingContext2D): void {
    const x = 188, y = 182;
    const p = this.game.profile;
    rect(ctx, x - 14, y - 2, 30, 4, 'rgba(0,0,0,0.35)');
    rect(ctx, x - 16, y - 34, 4, 34, '#3a2410');
    rect(ctx, x + 12, y - 34, 4, 34, '#3a2410');
    rect(ctx, x - 18, y - 40, 36, 26, '#6b4a2a');
    rect(ctx, x - 16, y - 38, 32, 22, '#8a6238');
    const notes = ['#ffe9a0', '#9dffcf', '#ffb3d1'];
    for (let i = 0; i < 3; i++) {
      rect(ctx, x - 13 + i * 10, y - 35 + (i % 2) * 4, 8, 10, notes[i]);
      rect(ctx, x - 12 + i * 10, y - 33 + (i % 2) * 4, 6, 1, '#7a5a20');
      rect(ctx, x - 12 + i * 10, y - 30 + (i % 2) * 4, 5, 1, '#7a5a20');
      rect(ctx, x - 10 + i * 10, y - 36 + (i % 2) * 4, 2, 2, '#ff3f3f');
    }
    drawText(ctx, 'QUESTS', x, y + 4, '#ffcf3f', { align: 'center' });
    if (this.questSig() !== this.game.questSeenSig && p.questsDone.length < QUESTS.length && Math.floor(this.t * 2) % 2) drawText(ctx, '!', x, y - 54, '#ffcf3f', { align: 'center', scale: 2 });
  }

  private drawDailySign(ctx: CanvasRenderingContext2D): void {
    const x = 118, y = 196;
    const done = this.game.profile.daily.key === dateKey() && this.game.profile.daily.cleared;
    rect(ctx, x - 12, y - 2, 26, 4, 'rgba(0,0,0,0.35)');
    rect(ctx, x - 1, y - 24, 2, 24, '#3a2410');
    rect(ctx, x - 14, y - 40, 28, 20, '#f4eefe');
    rect(ctx, x - 14, y - 40, 28, 6, done ? '#7dff6b' : '#ff3fa4');
    for (let i = 0; i < 3; i++) rect(ctx, x - 10 + i * 8, y - 29, 5, 3, '#9a9ab8');
    if (done) rect(ctx, x - 6, y - 25, 12, 3, '#7dff6b');
    drawText(ctx, 'DAILY', x, y + 4, done ? '#7dff6b' : '#ffcf3f', { align: 'center' });
    if (!done && Math.floor(this.t * 2) % 2) drawText(ctx, '!', x, y - 54, '#ffcf3f', { align: 'center', scale: 2 });
  }

  private drawMiniCabinet(ctx: CanvasRenderingContext2D): void {
    const x = 292, y = 186;
    rect(ctx, x - 14, y - 2, 30, 4, 'rgba(0,0,0,0.35)');
    rect(ctx, x - 12, y - 38, 24, 38, '#1a1030');
    rect(ctx, x - 11, y - 38, 22, 5, '#3fe0ff');
    rect(ctx, x - 9, y - 31, 18, 14, '#000');
    const blink = Math.floor(this.t * 3) % 3;
    rect(ctx, x - 7 + ((this.t * 14) % 10), y - 26, 3, 3, blink ? '#ffcf3f' : '#ff3fa4');
    rect(ctx, x - 7, y - 20, 14, 1, '#3fe0ff');
    rect(ctx, x - 7, y - 14, 14, 3, '#333');
    rect(ctx, x - 5, y - 15, 2, 2, '#ff3f3f');
    rect(ctx, x + 2, y - 15, 2, 2, '#3fe0ff');
    glow(ctx, x, y - 20, 34, '63,224,255', 0.22 + Math.sin(this.t * 3) * 0.05);
    drawText(ctx, 'MINI', x, y + 4, '#3fe0ff', { align: 'center' });
  }

  private drawStation(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string): void {
    rect(ctx, x - 12, y - 22, 24, 24, '#1a1030');
    rect(ctx, x - 9, y - 19, 18, 12, Math.floor(this.t * 3) % 2 ? color : color + '88');
    drawText(ctx, label, x, y + 4, color, { align: 'center' });
  }
  private drawMiniBrick(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const c = ['#ff3f3f', '#3fa9ff', '#ffd23f', '#7dff6b'];
    for (let i = 0; i < 4; i++) rect(ctx, x - 8 + (i % 2) * 8, y - 16 + Math.floor(i / 2) * 8, 7, 7, c[i]);
    rect(ctx, x - 6, y - 24, 12, 8, '#ff3f3f');
  }
  private drawMiniStatic(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    rect(ctx, x - 8, y - 22, 16, 12, '#3a3a4a');
    for (let i = 0; i < 8; i++) rect(ctx, x - 7 + ((i * 5 + Math.floor(this.t * 20)) % 14), y - 21 + (i * 3) % 10, 2, 1, '#fff8');
    rect(ctx, x - 4, y - 10, 8, 10, '#2a2a3a');
  }

  private drawTrain(ctx: CanvasRenderingContext2D): void {
    const tr = this.train!;
    frame(ctx, 90, 90, 300, 80, '#0b0716f0', '#9dff3f');
    drawText(ctx, 'FETCH! PRESS Z WHEN THE BALL IS IN THE ZONE', W / 2, 98, '#9dff3f', { align: 'center' });
    rect(ctx, 110, 124, 260, 8, '#222');
    rect(ctx, 110 + (tr.zone - 0.09) * 260, 124, 0.18 * 260, 8, '#2a8a2a');
    rect(ctx, 110 + tr.cursor * 260 - 3, 120, 6, 16, '#ffcf3f');
    drawByte(ctx, 110 + tr.cursor * 260, 160, this.t, this.game.profile.pet.bond, 'happy', petForm(this.game.profile.pet));
    if (tr.done) drawText(ctx, tr.result, W / 2, 146, '#fff', { align: 'center' });
  }
}

/** Ending: a short credits roll and roadmap teaser after restoring the Core. */
export class EndingScene implements Scene {
  id = 'ending';
  crt = 0.4;
  private t = 0;
  constructor(private game: Game) {}
  enter(): void {
    this.game.music('ending');
  }
  update(dt: number): void {
    this.t += dt;
    if (this.t > 3 && (this.game.input.pressed('confirm') || this.game.input.pressed('back'))) this.game.toHub();
  }
  draw(ctx: CanvasRenderingContext2D): void {
    const p = this.game.profile;
    rect(ctx, 0, 0, W, H, '#0b0716');
    for (let i = 0; i < 60; i++) rect(ctx, (i * 53) % W, (i * 97 + this.t * 15 * ((i % 3) + 1)) % H, 1, 1, '#fff8');
    drawCoreIcon(ctx, W / 2, 50, this.t, 3);
    const freed = Object.values(p.bossChoices).filter((c) => c === 'mercy').length;
    const lines = [
      'THE CARTRIDGE CORE IS 41% RESTORED.',
      '',
      freed === 2 ? 'YOU SET EVERY BOSS FREE. THE LOBBY IS NOISIER NOW.' : freed === 1 ? 'ONE BOSS WALKS FREE. ONE IS A MEMORY.' : 'THE BOSSES ARE GONE. THE LOBBY IS VERY QUIET.',
      p.manualTrust > 0 ? 'THE MANUAL WRITES A NEW PAGE: "THANK YOU."' : p.manualTrust < 0 ? 'THE MANUAL KEEPS ITS DISTANCE. FOR NOW.' : 'THE MANUAL IS STILL THINKING ABOUT WHAT YOU SAID.',
      '',
      `LEVEL ${p.level} • ${p.floppies.length}/${TOTAL_FLOPPIES} FLOPPIES • ${p.achievements.length}/${ACHIEVEMENTS.length} TROPHIES`,
      '',
      'ONE PAGE IS STILL MISSING. THE HIGH SCORE WAITS AT THE CORE.',
      '',
      'KEEP PLAYING: REMATCHES, MODIFIERS, SEEDS AND SECRETS AWAIT.',
    ];
    lines.forEach((l, i) => {
      const a = clamp((this.t - i * 0.4) * 2, 0, 1);
      ctx.globalAlpha = a;
      for (const [k, w] of wrap(l, 70).entries()) drawText(ctx, w, W / 2, 96 + i * 14 + k * 9, i === 7 ? '#ff3fa4' : '#fff', { align: 'center' });
      ctx.globalAlpha = 1;
    });
    if (this.t > 3) drawText(ctx, 'PRESS CONFIRM', W / 2, H - 14, '#ffcf3f', { align: 'center' });
  }
}
