import { ACTIONS, Bindings, DEFAULT_BINDINGS, cloneBindings } from './input.ts';
import { Wardrobe, defaultWardrobe, cleanWardrobe } from '../data/cosmetics.ts';
import { PetOutfit, defaultOutfit, cleanOutfit } from '../data/pet.ts';
import { LobbyDecor, defaultDecor, cleanDecor } from '../data/decor.ts';
import { WeeklyState, emptyWeekly, WEEKLY_BY_ID } from '../data/weekly.ts';

export type ModeId = 'rampage' | 'neon' | 'mall' | 'beatdown' | 'rhythm' | 'command' | 'penalty' | 'blocks' | 'bolt' | 'munch' | 'wrestle' | 'pinball' | 'highscore';
/** The worlds that have a lobby cabinet (and three floppy disks each). */
export const MODE_IDS: ModeId[] = ['rampage', 'neon', 'mall', 'beatdown', 'rhythm', 'command', 'penalty', 'blocks', 'bolt', 'munch', 'wrestle', 'pinball'];
/** Every mode with a record: the worlds plus the final boss, THE HIGH SCORE. */
export const ALL_MODES: ModeId[] = [...MODE_IDS, 'highscore'];
/** Every world hides three floppy disks. */
export const TOTAL_FLOPPIES = MODE_IDS.length * 3;
export type Difficulty = 'easy' | 'normal' | 'hard';
export type ChaosIntensity = 'off' | 'low' | 'normal' | 'high';
export type ChaosCategory = 'cosmetic' | 'environmental' | 'combat' | 'genre' | 'legendary';

export interface ModeRecord {
  clears: number;
  bestScore: number;
  bestTime: number; // seconds, 0 = none
}

export interface Profile {
  version: number;
  xp: number;
  level: number;
  bits: number;
  floppies: string[];
  cleared: Record<ModeId, ModeRecord>;
  bossesDefeated: string[];
  bossChoices: Record<string, 'mercy' | 'purge'>;
  abilities: string[];
  mutationsUnlocked: string[];
  mutationsDisabled: string[];
  /** `care` is lifetime care (it drives BYTE's form); `xp` is progress toward the next bond level. */
  pet: { bond: number; hunger: number; fedToday: number; trainedToday: number; xp: number; care: number; outfit: PetOutfit };
  achievements: string[];
  lore: string[];
  manualTrust: number;
  chaosFavor: ChaosCategory | null;
  introDone: boolean;
  endingSeen: boolean;
  secretUnlocked: boolean;
  character: 'cass' | 'demo';
  playTime: number;
  runsStarted: number;
  chaosEventsSeen: string[];
  /** Quest board progress by quest id, and the quests already paid out. */
  questProgress: Record<string, number>;
  questsDone: string[];
  /** Lobby mini-game personal bests and play counts. */
  mini: Record<string, { best: number; plays: number }>;
  /** Cosmetic outfits and hats (see data/cosmetics.ts). */
  wardrobe: Wardrobe;
  /** Mastery stars earned per world (see data/mastery.ts). */
  stars: Partial<Record<ModeId, string[]>>;
  /** ENDLESS RUN personal bests per world: rounds survived and best total score. */
  endless: Partial<Record<ModeId, { rounds: number; score: number }>>;
  /** Lobby decorations bought from Madame Polygon (see data/decor.ts). */
  decor: LobbyDecor;
  /** This week's goals (see data/weekly.ts). */
  weekly: WeeklyState;
  /** The track picked at the lobby jukebox (see data/jukebox.ts); empty means the usual lobby music. */
  jukebox: string;
  /** Friend challenges already beaten (mode-seed), so each seed pays once. */
  rivalsBeaten: string[];
  /** Best BLOCK PARTY ULTRA score. */
  ultraBest: number;
  /** The title chosen in RECORDS (see data/titles.ts); empty, or one not earned, means the newest earned. */
  title: string;
  /** Saved Mutation Lab builds (three slots): the mutations that were switched on. */
  loadouts: Array<{ name: string; on: string[] } | null>;
  /** The first-visit lobby tour (see scenes/hub.ts). */
  tutorial: { step: number; done: boolean };
  /** Today's lobby errand from one of the cast (see data/errands.ts). */
  errand: { key: string; progress: number; done: boolean; asked: boolean; thanked: boolean };
  /** The last lobby season that was announced, so each season is greeted once. */
  seasonSeen: string;
  /** Daily challenge record (see data/daily.ts). */
  daily: { key: string; best: number; cleared: boolean; streak: number; lastClear: string };
}

export interface Settings {
  version: number;
  master: number;
  music: number;
  /** Music on/off switch, independent of the music volume. */
  musicOn: boolean;
  sfx: number;
  /** Sound effects on/off, independent of the music switch and the volume sliders. */
  sfxOn: boolean;
  /** Vibration on/off (phones and tablets that support it). */
  vibration: boolean;
  muted: boolean;
  shake: number; // 0..1
  reducedFlash: boolean;
  crt: boolean;
  gameSpeed: number; // 0.5..1
  difficulty: Difficulty;
  chaos: ChaosIntensity;
  bindings: Bindings;
  fixedSeed: number | null;
  hints: boolean;
  /** RUN PERKS: choose one of three perks before each run. */
  perks: boolean;
  /** ASSIST MODE: one extra heart in every world and slower enemies and bullets. */
  assist: boolean;
  /** CLEAR SHAPES: patterns on blocks and distinct bullet shapes, so colour is never the only cue. */
  shapes: boolean;
  /** Phones: follow the sensor (auto) or ask to stay in landscape for a bigger screen. Never required. */
  rotate: 'auto' | 'landscape';
}

export const PROFILE_VERSION = 2;
export const SETTINGS_VERSION = 1;

export function defaultProfile(): Profile {
  const rec = (): ModeRecord => ({ clears: 0, bestScore: 0, bestTime: 0 });
  return {
    version: PROFILE_VERSION,
    xp: 0,
    level: 1,
    bits: 0,
    floppies: [],
    cleared: Object.fromEntries(ALL_MODES.map((m) => [m, rec()])) as Record<ModeId, ModeRecord>,
    bossesDefeated: [],
    bossChoices: {},
    abilities: [],
    mutationsUnlocked: ['beat_platforms', 'switch_shots', 'lurker_pursuit', 'pet_guardian', 'combo_xp', 'block_rain', 'note_bullets', 'tower_xp', 'slap_shot', 'bomb_pieces', 'beat_buster'],
    mutationsDisabled: [],
    pet: { bond: 1, hunger: 2, fedToday: 0, trainedToday: 0, xp: 0, care: 0, outfit: defaultOutfit() },
    achievements: [],
    lore: [],
    manualTrust: 0,
    chaosFavor: null,
    introDone: false,
    endingSeen: false,
    secretUnlocked: false,
    character: 'cass',
    playTime: 0,
    runsStarted: 0,
    chaosEventsSeen: [],
    questProgress: {},
    questsDone: [],
    mini: {},
    wardrobe: defaultWardrobe(),
    stars: {},
    endless: {},
    decor: defaultDecor(),
    weekly: emptyWeekly(),
    jukebox: '',
    rivalsBeaten: [],
    ultraBest: 0,
    title: '',
    loadouts: [null, null, null],
    tutorial: { step: 0, done: false },
    errand: { key: '', progress: 0, done: false, asked: false, thanked: false },
    seasonSeen: '',
    daily: { key: '', best: 0, cleared: false, streak: 0, lastClear: '' },
  };
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    master: 0.8,
    music: 0.6,
    musicOn: true,
    sfx: 0.8,
    sfxOn: true,
    vibration: true,
    muted: false,
    shake: 1,
    reducedFlash: false,
    crt: true,
    gameSpeed: 1,
    difficulty: 'normal',
    chaos: 'normal',
    bindings: cloneBindings(DEFAULT_BINDINGS),
    fixedSeed: null,
    hints: true,
    perks: true,
    assist: false,
    shapes: false,
    rotate: 'auto',
  };
}

/** Upgrades older save shapes and fills any missing fields with defaults. */
export function migrateProfile(raw: unknown): Profile {
  const base = defaultProfile();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Profile> & { version?: number; mutationsEnabled?: string[] };
  const p: Profile = { ...base, ...r, version: PROFILE_VERSION } as Profile;
  // v1 stored a positive list of enabled mutations; v2 stores the disabled ones.
  if ((r.version ?? 1) < 2 && Array.isArray(r.mutationsEnabled)) {
    p.mutationsDisabled = p.mutationsUnlocked.filter((m) => !r.mutationsEnabled!.includes(m));
    delete (p as unknown as Record<string, unknown>).mutationsEnabled;
  }
  // Field-by-field checks so a hand-edited or half-written save can never crash a run or poison a score with NaN.
  const num = (v: unknown, fallback: number, min = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fallback);
  // Plain fields the spread above would otherwise pass through unchecked (an imported code can hold anything).
  p.manualTrust = Math.floor(num(r.manualTrust, base.manualTrust, -99));
  p.chaosFavor = (['cosmetic', 'environmental', 'combat', 'genre', 'legendary'] as const).find((c) => c === r.chaosFavor) ?? null;
  p.character = r.character === 'demo' ? 'demo' : 'cass';
  p.playTime = Math.min(num(r.playTime, 0), 1e9);
  p.runsStarted = Math.min(Math.floor(num(r.runsStarted, 0)), 1e7);
  p.introDone = r.introDone === true;
  p.endingSeen = r.endingSeen === true;
  p.secretUnlocked = r.secretUnlocked === true;
  p.cleared = { ...base.cleared };
  for (const m of ALL_MODES) {
    const c = ((r.cleared ?? {}) as Record<string, Partial<ModeRecord> | null>)[m];
    p.cleared[m] = { clears: Math.floor(num(c?.clears, 0)), bestScore: num(c?.bestScore, 0), bestTime: num(c?.bestTime, 0) };
  }
  const pt = (r.pet ?? {}) as Partial<Profile['pet']>;
  const bond = num(pt.bond, base.pet.bond);
  const petXp = num(pt.xp, 0);
  // Saves from before BYTE could grow: assume the care that got the bond where it is.
  p.pet = { bond, hunger: num(pt.hunger, base.pet.hunger), fedToday: num(pt.fedToday, 0), trainedToday: num(pt.trainedToday, 0), xp: petXp, care: num(pt.care, Math.max(0, bond - 1) * 3 + Math.min(petXp, 2)), outfit: cleanOutfit(pt.outfit) };
  p.bossChoices = {};
  if (r.bossChoices && typeof r.bossChoices === 'object' && !Array.isArray(r.bossChoices)) {
    for (const [k, v] of Object.entries(r.bossChoices)) if (v === 'mercy' || v === 'purge') p.bossChoices[k] = v;
  }
  p.questProgress = {};
  if (r.questProgress && typeof r.questProgress === 'object' && !Array.isArray(r.questProgress)) {
    for (const [k, v] of Object.entries(r.questProgress)) if (Number.isFinite(v) && v >= 0) p.questProgress[k] = v;
  }
  p.wardrobe = cleanWardrobe(r.wardrobe);
  p.stars = {};
  if (r.stars && typeof r.stars === 'object' && !Array.isArray(r.stars)) {
    for (const m of ALL_MODES) {
      const v = (r.stars as Record<string, unknown>)[m];
      if (Array.isArray(v)) p.stars[m] = v.filter((x): x is string => x === 'clean' || x === 'fast' || x === 'collector').filter((x, i, a) => a.indexOf(x) === i);
    }
  }
  p.endless = {};
  if (r.endless && typeof r.endless === 'object' && !Array.isArray(r.endless)) {
    for (const m of ALL_MODES) {
      const e = (r.endless as Record<string, { rounds?: unknown; score?: unknown } | null>)[m];
      if (e && Number.isFinite(e.rounds) && Number.isFinite(e.score)) p.endless[m] = { rounds: Math.max(0, Math.floor(e.rounds as number)), score: Math.max(0, e.score as number) };
    }
  }
  p.decor = cleanDecor(r.decor);
  p.loadouts = [0, 1, 2].map((i) => {
    const l = (Array.isArray(r.loadouts) ? r.loadouts[i] : null) as { name?: unknown; on?: unknown } | null | undefined;
    if (!l || typeof l !== 'object' || !Array.isArray(l.on)) return null;
    return { name: typeof l.name === 'string' ? l.name.slice(0, 12) : `BUILD ${i + 1}`, on: l.on.filter((x): x is string => typeof x === 'string').slice(0, 40) };
  });
  // Players who already have progress do not need the lobby tour.
  const tu = (r.tutorial ?? {}) as Partial<Profile['tutorial']>;
  p.tutorial = {
    step: Number.isFinite(tu.step) ? Math.max(0, Math.min(9, Math.floor(tu.step as number))) : 0,
    done: typeof tu.done === 'boolean' ? tu.done : r.introDone === true || (r.runsStarted ?? 0) > 0,
  };
  const er = (r.errand ?? {}) as Partial<Profile['errand']>;
  p.errand = {
    key: typeof er.key === 'string' ? er.key.slice(0, 10) : '',
    progress: Number.isFinite(er.progress) ? Math.max(0, er.progress as number) : 0,
    done: er.done === true,
    asked: er.asked === true,
    thanked: er.thanked === true,
  };
  p.jukebox = typeof r.jukebox === 'string' ? r.jukebox.slice(0, 16) : '';
  p.rivalsBeaten = Array.isArray(r.rivalsBeaten) ? (r.rivalsBeaten as unknown[]).filter((k): k is string => typeof k === 'string' && k.length < 40).slice(-300) : [];
  p.ultraBest = typeof r.ultraBest === 'number' && r.ultraBest > 0 ? Math.min(Math.floor(r.ultraBest), 9_999_999) : 0;
  p.title = typeof r.title === 'string' ? r.title.slice(0, 16) : '';
  p.seasonSeen = typeof r.seasonSeen === 'string' ? r.seasonSeen.slice(0, 16) : '';
  const wk = (r.weekly ?? {}) as Partial<WeeklyState>;
  p.weekly = emptyWeekly();
  if (typeof wk.key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wk.key)) {
    p.weekly.key = wk.key;
    p.weekly.swept = wk.swept === true;
    if (Array.isArray(wk.done)) p.weekly.done = wk.done.filter((id, i, a): id is string => typeof id === 'string' && WEEKLY_BY_ID.has(id) && a.indexOf(id) === i);
    if (wk.progress && typeof wk.progress === 'object' && !Array.isArray(wk.progress)) {
      for (const [k, v] of Object.entries(wk.progress)) if (WEEKLY_BY_ID.has(k) && Number.isFinite(v) && (v as number) >= 0) p.weekly.progress[k] = v as number;
    }
  }
  const dr = (r.daily ?? {}) as Partial<Profile['daily']>;
  p.daily = {
    key: typeof dr.key === 'string' ? dr.key.slice(0, 10) : '',
    best: Number.isFinite(dr.best) ? Math.max(0, dr.best as number) : 0,
    cleared: dr.cleared === true,
    streak: Number.isFinite(dr.streak) ? Math.max(0, Math.floor(dr.streak as number)) : 0,
    lastClear: typeof dr.lastClear === 'string' ? dr.lastClear.slice(0, 10) : '',
  };
  p.mini = {};
  if (r.mini && typeof r.mini === 'object' && !Array.isArray(r.mini)) {
    for (const [k, v] of Object.entries(r.mini)) {
      const best = (v as { best?: unknown } | null)?.best;
      const plays = (v as { plays?: unknown } | null)?.plays;
      if (Number.isFinite(best) && Number.isFinite(plays)) p.mini[k] = { best: Math.max(0, best as number), plays: Math.max(0, plays as number) };
    }
  }
  for (const k of ['floppies', 'bossesDefeated', 'abilities', 'mutationsUnlocked', 'mutationsDisabled', 'achievements', 'lore', 'chaosEventsSeen', 'questsDone'] as const) {
    // Lists of ids: keep only short strings (an imported or hand-edited save may hold anything).
    p[k] = Array.isArray(p[k]) ? (p[k] as unknown[]).filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, 2000) : base[k].slice();
  }
  for (const m of base.mutationsUnlocked) if (!p.mutationsUnlocked.includes(m)) p.mutationsUnlocked.push(m);
  p.bits = Math.min(Math.floor(num(p.bits, 0)), 1e9);
  p.xp = Math.min(Math.floor(num(p.xp, 0)), 1e9);
  p.level = levelForXp(p.xp);
  return p;
}

export function migrateSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...(raw as Partial<Settings>) };
  // Each action needs a list of key-code strings; anything else falls back to that action's defaults.
  const rawBind = (s.bindings && typeof s.bindings === 'object' ? s.bindings : {}) as Record<string, unknown>;
  const cleanBind = {} as Bindings;
  for (const a of ACTIONS) {
    const v = rawBind[a];
    cleanBind[a] = Array.isArray(v) && v.every((k) => typeof k === 'string') ? (v as string[]).slice() : DEFAULT_BINDINGS[a].slice();
  }
  s.bindings = cloneBindings(cleanBind);
  s.sfxOn = s.sfxOn !== false;
  s.vibration = s.vibration !== false;
  s.assist = s.assist === true;
  s.shapes = s.shapes === true;
  s.rotate = s.rotate === 'landscape' ? 'landscape' : 'auto';
  s.perks = s.perks !== false;
  if (s.fixedSeed !== null && !(typeof s.fixedSeed === 'number' && Number.isInteger(s.fixedSeed) && s.fixedSeed >= 0 && s.fixedSeed <= 999999)) s.fixedSeed = null;
  s.master = clamp01(s.master);
  s.music = clamp01(s.music);
  if (typeof s.musicOn !== 'boolean') s.musicOn = true;
  s.sfx = clamp01(s.sfx);
  s.shake = clamp01(s.shake);
  s.gameSpeed = Math.min(1, Math.max(0.5, Number(s.gameSpeed) || 1));
  if (!['easy', 'normal', 'hard'].includes(s.difficulty)) s.difficulty = 'normal';
  if (!['off', 'low', 'normal', 'high'].includes(s.chaos)) s.chaos = 'normal';
  s.version = SETTINGS_VERSION;
  return s;
}

function clamp01(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
}

// ---- Progression math -------------------------------------------------------

/** Total XP required to reach `level`. Gentle curve: no grinding needed for the slice. */
export function xpForLevel(level: number): number {
  return Math.round(60 * (level - 1) * (level + 2) / 2);
}
export function levelForXp(xp: number): number {
  let l = 1;
  while (l < 99 && xp >= xpForLevel(l + 1)) l++;
  return l;
}
/** Player stats derived from level & abilities (shared by every mode). */
export function playerStats(p: Profile): { maxHp: number; power: number; energy: number } {
  const armor = (p.abilities.includes('armor1') ? 1 : 0) + (p.abilities.includes('armor2') ? 1 : 0);
  return {
    maxHp: 5 + Math.floor((p.level - 1) / 2) + armor,
    power: 1 + (p.level - 1) * 0.12,
    energy: 3 + (p.abilities.includes('overclock') ? 2 : 0),
  };
}

// ---- Storage ----------------------------------------------------------------

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryKV implements KV {
  private m = new Map<string, string>();
  get(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  set(k: string, v: string) { this.m.set(k, v); }
  remove(k: string) { this.m.delete(k); }
}

/** localStorage when available, otherwise in-memory (private mode, sandboxed iframes). */
export function browserKV(): KV {
  try {
    const ls = globalThis.localStorage;
    const probe = '__chaos_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      get: (k) => { try { return ls.getItem(k); } catch { return null; } },
      set: (k, v) => { try { ls.setItem(k, v); } catch { /* quota or blocked: keep playing */ } },
      remove: (k) => { try { ls.removeItem(k); } catch { /* ignore */ } },
    };
  } catch {
    return new MemoryKV();
  }
}

const PROFILE_KEY = 'chaos.exe/profile';
const SETTINGS_KEY = 'chaos.exe/settings';

export class SaveStore {
  constructor(private kv: KV) {}
  hasProfile(): boolean {
    return this.kv.get(PROFILE_KEY) !== null;
  }
  loadProfile(): Profile {
    return migrateProfile(safeParse(this.kv.get(PROFILE_KEY)));
  }
  saveProfile(p: Profile): void {
    this.kv.set(PROFILE_KEY, JSON.stringify(p));
  }
  deleteProfile(): void {
    this.kv.remove(PROFILE_KEY);
  }
  loadSettings(): Settings {
    return migrateSettings(safeParse(this.kv.get(SETTINGS_KEY)));
  }
  saveSettings(s: Settings): void {
    this.kv.set(SETTINGS_KEY, JSON.stringify(s));
  }
}

function safeParse(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
