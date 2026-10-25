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
import { INTRO, KEVIN_LINES, MODE_INFO, POLYGON_INTRO, REX_LINES, manualLines, isModeUnlocked, ENDING, CAST, BOSSES } from '../data/story.ts';
import { MODE_IDS, ModeId, ChaosCategory, xpForLevel } from '../core/save.ts';
import { SHOP, ACHIEVEMENTS, unlockAchievement } from '../data/progression.ts';
import { QUESTS, MINIS } from '../data/quests.ts';
import { startMini } from './arcade.ts';
import { MUTATIONS, GENRES, describeUnlock, isUnlockSatisfied } from '../fusion/registry.ts';

interface Thing {
  id: string;
  x: number;
  y: number;
  label: string;
  r: number;
  visible?: () => boolean;
}

const CAB_Y = 58;

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
    const cabX = [56, 136, 216, 296, 376];
    MODE_IDS.forEach((m, i) => this.things.push({ id: `cab:${m}`, x: cabX[i] + 16, y: CAB_Y + 30, label: MODE_INFO[m].title, r: 18 }));
    this.things.push({ id: 'core', x: 240, y: 150, label: 'CARTRIDGE CORE', r: 20 });
    this.things.push({ id: 'manual', x: 270, y: 130, label: 'THE MANUAL', r: 16 });
    this.things.push({ id: 'byte', x: 60, y: 200, label: 'BYTE (PET)', r: 18 });
    this.things.push({ id: 'shop', x: 420, y: 200, label: 'MADAME POLYGON (SHOP)', r: 18 });
    this.things.push({ id: 'lab', x: 440, y: 120, label: 'MUTATION LAB', r: 16 });
    this.things.push({ id: 'shrine', x: 40, y: 120, label: 'CHAOS SHRINE', r: 16 });
    this.things.push({ id: 'quests', x: 188, y: 182, label: 'QUEST BOARD', r: 18 });
    this.things.push({ id: 'arcade', x: 292, y: 186, label: 'MINI-GAME ARCADE', r: 18 });
    this.things.push({ id: 'trophy', x: 330, y: 236, label: 'TROPHY CASE', r: 16 });
    this.things.push({ id: 'rex', x: 150, y: 236, label: 'REX TURBO', r: 14 });
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
    this.game.music(p.endingSeen ? 'ending' : 'hub');
    this.game.audio.unlock();
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

  update(dt: number): void {
    this.t += dt;
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
    const ax = inp.axisX(), ay = inp.axisY();
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
    if (this.near && (inp.pressed('jump') || inp.pressed('confirm') || inp.pressed('attack'))) this.interact(this.near);
    if (inp.pressed('pause')) this.openPauseMenu();
  }

  private openPauseMenu(): void {
    this.menu = new ListMenu('LOBBY MENU', [
      { label: 'RESUME', onSelect: () => (this.menu = null) },
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
    if (th.id.startsWith('cab:')) return this.cabinet(th.id.slice(4) as ModeId);
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
      case 'byte': return this.petMenu();
      case 'shop': return this.shopMenu();
      case 'lab': return this.labMenu();
      case 'shrine': return this.shrineMenu();
      case 'trophy': return this.trophyMenu();
      case 'quests': return this.questMenu();
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

  private cabinet(mode: ModeId): void {
    const p = this.game.profile;
    const info = MODE_INFO[mode];
    if (!isModeUnlocked(mode, p.cleared)) {
      const need = mode === 'neon' || mode === 'mall' ? 'Clear RETRO RAMPAGE first.' : 'Clear any two worlds to power this cabinet.';
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
    items.push({ label: `BEST ${rec.bestScore}  CLEARS ${rec.clears}`, value: () => `DISKS ${floppies}`, disabled: true });
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
    const lines = p.endingSeen
      ? ['CORE STATUS: 41% STABLE. ONE PAGE MISSING.', 'NEXT TARGET: THE HIGH SCORE. (PART 2 ON THE ROADMAP)']
      : [`CORE SHARDS: ${shards}/2. DEFEAT THE BOSSES OF BOSS BEATDOWN AND GLITCH RHYTHM.`, `FLOPPY DISKS BACKED UP: ${p.floppies.length}/15.`];
    this.say('core', 'CARTRIDGE CORE', lines);
  }

  private petMenu(): void {
    const pet = this.game.profile.pet;
    const keep = this.menu?.index;
    const care = pet.xp;
    const items: MenuItem[] = [
      { label: 'FEED', value: () => (pet.hunger > 0 ? `HUNGRY ${'●'.repeat(pet.hunger)}` : 'FULL'), sub: 'BYTE gets hungry after each adventure. Feeding builds bond.', onSelect: () => this.feed() },
      { label: 'PLAY FETCH (TRAIN)', value: () => (pet.trainedToday ? 'TIRED' : 'READY'), sub: 'Press Z when the ball is in the green zone. Builds bond.', disabled: pet.trainedToday > 0, onSelect: () => { this.menu = null; this.train = { cursor: 0, dir: 1, zone: 0.35 + Math.random() * 0.3, done: false, result: '', t: 0 }; } },
      { label: `BOND ${pet.bond}/5`, value: () => `CARE ${care}/3`, disabled: true, sub: 'Bond powers GOOD BOY PROTOCOL: a longer bark stun in NIGHTMARE MALL. Bond 3+ sniffs keys.' },
      { label: 'BACK', onSelect: () => (this.menu = null) },
    ];
    this.menu = new ListMenu('BYTE — VIRTUAL PET', items, () => (this.menu = null), { x: 90, y: 60, w: 300, accent: '#9dff3f' });
    if (keep !== undefined) this.menu.index = Math.min(keep, items.length - 1);
  }

  private addCare(n: number): void {
    const p = this.game.profile;
    const pet = p.pet;
    pet.xp += n;
    while (pet.xp >= 3 && pet.bond < 5) {
      pet.xp -= 3;
      pet.bond++;
      this.game.toast('BOND UP!', `BYTE BOND ${pet.bond}/5`, '#9dff3f');
      this.game.audio.sfx('levelup');
    }
    if (pet.bond >= 5) {
      const got: string[] = [];
      unlockAchievement(p, 'pet_max', got);
      this.game.announceAchievements(got);
    }
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

  private shopMenu(): void {
    const p = this.game.profile;
    const keep = this.menu?.index;
    const items: MenuItem[] = SHOP.map((s) => {
      const owned = !s.repeatable && p.abilities.includes(s.id);
      const blocked = (s.requires && !p.abilities.includes(s.requires)) || (s.id === 'treats' && p.pet.bond >= 5);
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
    });
    items.push({ label: 'BACK', onSelect: () => (this.menu = null) });
    this.menu = new ListMenu(`MADAME POLYGON — ${p.bits} BITS`, items, () => (this.menu = null), { x: 60, y: 30, w: 360, accent: '#b07aff', footer: POLYGON_INTRO });
    if (keep !== undefined) this.menu.index = Math.min(keep, items.length - 1);
  }

  private labMenu(): void {
    const p = this.game.profile;
    const items: MenuItem[] = MUTATIONS.map((m) => {
      const unlocked = p.mutationsUnlocked.includes(m.id) && isUnlockSatisfied(m.unlock, p);
      return {
        label: m.name,
        value: () => (!unlocked ? describeUnlock(m.unlock) : p.mutationsDisabled.includes(m.id) ? 'OFF' : 'ON'),
        sub: `${m.genres.map((g) => GENRES[g].name).join(' + ')} • ${m.modes.map((x) => MODE_INFO[x].title).join(', ')}: ${m.tagline}`,
        color: GENRES[m.genres[1]].color,
        disabled: !unlocked,
        onSelect: () => {
          if (p.mutationsDisabled.includes(m.id)) p.mutationsDisabled = p.mutationsDisabled.filter((x) => x !== m.id);
          else p.mutationsDisabled.push(m.id);
          this.save();
        },
      };
    });
    items.push({ label: 'BACK', onSelect: () => (this.menu = null) });
    this.menu = new ListMenu('MUTATION LAB — EACH ACTIVE MUTATION: +15% BITS', items, () => (this.menu = null), { x: 30, y: 24, w: 420, rows: 10, accent: '#ff3fd2' });
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

  private trophyMenu(): void {
    const p = this.game.profile;
    const items: MenuItem[] = [
      { label: `LEVEL ${p.level}`, value: () => `${p.xp - xpForLevel(p.level)}/${xpForLevel(p.level + 1) - xpForLevel(p.level)} XP`, disabled: true },
      { label: `FLOPPIES ${p.floppies.length}/15`, value: () => `${p.achievements.length}/${ACHIEVEMENTS.length} TROPHIES`, disabled: true },
      ...ACHIEVEMENTS.map((a) => ({ label: (p.achievements.includes(a.id) ? '★ ' : '☆ ') + a.name, sub: a.desc, color: p.achievements.includes(a.id) ? '#ffcf3f' : '#777', onSelect: () => {} })),
      { label: '— WHO\'S WHO —', disabled: true },
      ...Object.values(CAST).map((c) => ({ label: c.name, sub: c.bio, onSelect: () => {} })),
      ...BOSSES.map((b) => ({ label: `BOSS: ${b.name}`, sub: `${b.title}. ${b.bio}`, color: '#ff6f3f', onSelect: () => {} })),
      { label: 'BACK', onSelect: () => (this.menu = null) },
    ];
    this.menu = new ListMenu('TROPHY CASE & ARCHIVES', items, () => (this.menu = null), { x: 40, y: 20, w: 400, rows: 13, accent: '#ffcf3f' });
  }

  /** Changes whenever any quest advances, so the board only flags real news. */
  private questSig(): number {
    const p = this.game.profile;
    return p.questsDone.length * 100000 + Object.values(p.questProgress).reduce((a, b) => a + b, 0);
  }

  private questMenu(): void {
    const p = this.game.profile;
    this.game.questSeenSig = this.questSig();
    const done = p.questsDone.length;
    const items: MenuItem[] = [
      { label: `COMPLETED ${done}/${QUESTS.length}`, value: () => (done === QUESTS.length ? 'ALL DONE!' : ''), disabled: true },
      ...QUESTS.slice().sort((a, b) => Number(p.questsDone.includes(a.id)) - Number(p.questsDone.includes(b.id))).map((q) => {
        const ok = p.questsDone.includes(q.id);
        const prog = Math.min(q.goal, p.questProgress[q.id] ?? 0);
        return {
          label: (ok ? '\u2605 ' : '\u2606 ') + q.title,
          value: () => (ok ? 'DONE' : `${prog}/${q.goal}`),
          sub: `${q.desc} Reward: ${q.bits} bits + ${q.xp} XP.`,
          color: ok ? '#ffcf3f' : undefined,
          onSelect: () => {},
        };
      }),
      { label: 'BACK', onSelect: () => (this.menu = null) },
    ];
    this.menu = new ListMenu('QUEST BOARD \u2014 PAID AUTOMATICALLY WHEN DONE', items, () => (this.menu = null), { x: 50, y: 24, w: 380, rows: 11, accent: '#ffcf3f' });
  }

  private arcadeMenu(): void {
    const p = this.game.profile;
    const items: MenuItem[] = [
      ...MINIS.map((m) => ({
        label: m.title,
        value: () => `BEST ${p.mini[m.id]?.best ?? 0}`,
        sub: `${m.blurb} Pays ${m.bitsPerPoint} bit${m.bitsPerPoint === 1 ? '' : 's'} per ${m.unit === 'ROUNDS' ? 'round' : 'point'}.`,
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
    [56, 136, 216, 296, 376].forEach((cx, i) => {
      const on = isModeUnlocked(MODE_IDS[i], p.cleared);
      ctx.globalAlpha = on ? 0.22 + Math.sin(t * 2 + i) * 0.04 : 0.08;
      rect(ctx, cx - 6, CAB_Y + 34, 44, 4, on ? MODE_INFO[MODE_IDS[i]].color : '#8a7aa0');
      rect(ctx, cx - 2, CAB_Y + 38, 36, 3, on ? MODE_INFO[MODE_IDS[i]].color : '#8a7aa0');
      ctx.globalAlpha = 1;
    });
    // Contact shadows for the big props
    for (const [sx, sy, sw] of [[214, 160, 52], [316, 243, 28], [40, 213, 40], [404, 215, 34]]) rect(ctx, sx + 2, sy, sw, 4, 'rgba(0,0,0,0.35)');
    drawText(ctx, 'THE LOBBY OF LOST SAVES', W / 2, 8, pal.accent2, { align: 'center', scale: 2 });
    // Cabinets
    const cabX = [56, 136, 216, 296, 376];
    MODE_IDS.forEach((m, i) => this.drawCabinet(ctx, cabX[i], CAB_Y - 20, m, isModeUnlocked(m, p.cleared)));
    // Core
    const shards = p.bossesDefeated.filter((b) => b === 'bricklord' || b === 'static').length;
    rect(ctx, 214, 140, 52, 20, '#2a2a3a');
    drawCoreIcon(ctx, 240, 132, t, 2);
    for (let i = 0; i < 2; i++) rect(ctx, 226 + i * 22, 156, 6, 6, i < shards ? (i ? '#ff3fd2' : '#ff6f3f') : '#444');
    drawManual(ctx, 270, 130, t);
    // Stations
    this.drawQuestBoard(ctx);
    this.drawMiniCabinet(ctx);
    this.drawStation(ctx, 440, 120, 'LAB', '#ff3fd2');
    this.drawStation(ctx, 40, 120, 'SHRINE', '#ff3fa4');
    rect(ctx, 316, 222, 28, 22, '#3a2a10');
    rect(ctx, 318, 224, 24, 10, '#ffcf3f55');
    drawText(ctx, '★', 330, 226, '#ffcf3f', { align: 'center', shadow: null });
    // Pet corner
    rect(ctx, 40, 204, 40, 10, '#3a1a4a');
    drawByte(ctx, 60, 204, t, p.pet.bond, p.pet.hunger > 1 ? 'sad' : 'happy');
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
    drawText(ctx, `DISKS ${p.floppies.length}/15`, 160, H - 10, '#3fe0ff');
    drawText(ctx, `SHARDS ${shards}/2`, 248, H - 10, '#ff6f3f');
    drawText(ctx, this.game.input.label('Z INTERACT • ESC MENU'), W - 6, H - 10, '#9a9ab8', { align: 'right' });
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
        case 'rhythm': for (let i = 0; i < 4; i++) rect(ctx, x + 6 + i * 5, y + 10 + ((t * 30 + i * 7) % 16), 4, 2, ['#ff3fd2', '#3fe0ff', '#7dff6b', '#ffcf3f'][i]); break;
      }
    } else drawText(ctx, 'X', x + 16, y + 15, '#555', { align: 'center' });
    rect(ctx, x + 6, y + 32, 20, 4, '#333');
    rect(ctx, x + 10, y + 30, 3, 3, '#ff3f3f');
    rect(ctx, x + 18, y + 31, 3, 3, '#3fe0ff');
    const cleared = this.game.profile.cleared[m].clears > 0;
    if (cleared) drawText(ctx, '★', x + 16, y + 40, '#ffcf3f', { align: 'center', shadow: null });
    drawText(ctx, info.title.split(' ')[0], x + 16, y + 56, on ? info.color : '#555', { align: 'center' });
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
    drawByte(ctx, 110 + tr.cursor * 260, 160, this.t, this.game.profile.pet.bond);
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
      `LEVEL ${p.level} • ${p.floppies.length}/15 FLOPPIES • ${p.achievements.length}/${ACHIEVEMENTS.length} TROPHIES`,
      '',
      'TO BE CONTINUED IN PART 2: THE HIGH SCORE',
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
