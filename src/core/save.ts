import { Bindings, DEFAULT_BINDINGS, cloneBindings } from './input.ts';

export type ModeId = 'rampage' | 'neon' | 'mall' | 'beatdown' | 'rhythm';
export const MODE_IDS: ModeId[] = ['rampage', 'neon', 'mall', 'beatdown', 'rhythm'];
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
  pet: { bond: number; hunger: number; fedToday: number; trainedToday: number; xp: number };
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
  /** Mastery stars earned per world (see data/mastery.ts). */
  stars: Partial<Record<ModeId, string[]>>;
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
    cleared: { rampage: rec(), neon: rec(), mall: rec(), beatdown: rec(), rhythm: rec() },
    bossesDefeated: [],
    bossChoices: {},
    abilities: [],
    mutationsUnlocked: ['beat_platforms', 'switch_shots', 'lurker_pursuit', 'pet_guardian', 'combo_xp', 'block_rain', 'note_bullets'],
    mutationsDisabled: [],
    pet: { bond: 1, hunger: 2, fedToday: 0, trainedToday: 0, xp: 0 },
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
    stars: {},
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
  p.cleared = { ...base.cleared, ...(r.cleared ?? {}) };
  p.pet = { ...base.pet, ...(r.pet ?? {}) };
  p.questProgress = {};
  if (r.questProgress && typeof r.questProgress === 'object' && !Array.isArray(r.questProgress)) {
    for (const [k, v] of Object.entries(r.questProgress)) if (Number.isFinite(v) && v >= 0) p.questProgress[k] = v;
  }
  p.stars = {};
  if (r.stars && typeof r.stars === 'object' && !Array.isArray(r.stars)) {
    for (const m of MODE_IDS) {
      const v = (r.stars as Record<string, unknown>)[m];
      if (Array.isArray(v)) p.stars[m] = v.filter((x): x is string => x === 'clean' || x === 'fast' || x === 'collector').filter((x, i, a) => a.indexOf(x) === i);
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
    if (!Array.isArray(p[k])) p[k] = base[k].slice();
  }
  for (const m of base.mutationsUnlocked) if (!p.mutationsUnlocked.includes(m)) p.mutationsUnlocked.push(m);
  if (!Number.isFinite(p.bits) || p.bits < 0) p.bits = 0;
  if (!Number.isFinite(p.xp) || p.xp < 0) p.xp = 0;
  p.level = levelForXp(p.xp);
  return p;
}

export function migrateSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base, ...(raw as Partial<Settings>) };
  s.bindings = cloneBindings(s.bindings ?? base.bindings);
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
