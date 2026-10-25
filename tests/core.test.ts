import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, formatSeed, seedFromString } from '../src/core/rng.ts';
import {
  MemoryKV, SaveStore, defaultProfile, defaultSettings, levelForXp, migrateProfile, migrateSettings, playerStats, xpForLevel,
} from '../src/core/save.ts';
import { Input, DEFAULT_BINDINGS } from '../src/core/input.ts';
import { composeSong, TRACKS } from '../src/audio/audio.ts';

test('rng is deterministic per seed and stays in range', () => {
  const a = new Rng(1234), b = new Rng(1234), c = new Rng(1235);
  const sa = Array.from({ length: 50 }, () => a.next());
  const sb = Array.from({ length: 50 }, () => b.next());
  const sc = Array.from({ length: 50 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  const r = new Rng(9);
  for (let i = 0; i < 5000; i++) {
    const v = r.int(-3, 7);
    assert.ok(v >= -3 && v <= 7 && Number.isInteger(v));
    const f = r.range(2, 3);
    assert.ok(f >= 2 && f < 3);
  }
});

test('rng.weighted never picks zero-weight items and returns undefined when none eligible', () => {
  const r = new Rng(5);
  for (let i = 0; i < 2000; i++) assert.notEqual(r.weighted(['a', 'b', 'c'], (x) => (x === 'b' ? 0 : 1)), 'b');
  assert.equal(r.weighted(['a'], () => 0), undefined);
  assert.throws(() => r.pick([]));
});

test('seed helpers', () => {
  assert.equal(formatSeed(42), '000042');
  assert.equal(formatSeed(1234567), '234567');
  assert.equal(seedFromString('CHAOS'), seedFromString('CHAOS'));
  assert.notEqual(seedFromString('CHAOS'), seedFromString('chaos'));
});

test('profile migration repairs garbage and upgrades v1 saves', () => {
  assert.deepEqual(migrateProfile(null).cleared, defaultProfile().cleared);
  const broken = migrateProfile({ bits: -5, xp: 'lots', floppies: 'nope', pet: { bond: 3 } });
  assert.equal(broken.bits, 0);
  assert.equal(broken.xp, 0);
  assert.deepEqual(broken.floppies, []);
  assert.equal(broken.pet.bond, 3);
  assert.equal(broken.pet.hunger, 2, 'missing pet fields are filled');
  const v1 = migrateProfile({ version: 1, xp: 500, mutationsUnlocked: ['beat_platforms', 'switch_shots'], mutationsEnabled: ['beat_platforms'] });
  assert.ok(v1.mutationsDisabled.includes('switch_shots'));
  assert.ok(!v1.mutationsDisabled.includes('beat_platforms'));
  assert.equal(v1.level, levelForXp(500), 'level is recomputed from xp');
  assert.ok(!('mutationsEnabled' in v1));
});

test('settings migration clamps values and keeps bindings complete', () => {
  const s = migrateSettings({ master: 7, gameSpeed: 0.1, difficulty: 'nightmare', chaos: 'max', bindings: { jump: ['KeyQ'] } });
  assert.equal(s.master, 1);
  assert.equal(s.gameSpeed, 0.5);
  assert.equal(s.difficulty, 'normal');
  assert.equal(s.chaos, 'normal');
  assert.deepEqual(s.bindings.jump, ['KeyQ']);
  assert.deepEqual(s.bindings.left, DEFAULT_BINDINGS.left);
});

test('save store round-trips and survives corrupt JSON', () => {
  const kv = new MemoryKV();
  const store = new SaveStore(kv);
  assert.equal(store.hasProfile(), false);
  const p = defaultProfile();
  p.bits = 99;
  store.saveProfile(p);
  assert.equal(store.loadProfile().bits, 99);
  kv.set('chaos.exe/profile', '{not json');
  assert.equal(store.loadProfile().bits, 0);
  const s = defaultSettings();
  s.reducedFlash = true;
  store.saveSettings(s);
  assert.equal(store.loadSettings().reducedFlash, true);
});

test('xp curve is monotonic and stats scale gently', () => {
  for (let l = 1; l < 30; l++) assert.ok(xpForLevel(l + 1) > xpForLevel(l));
  for (let xp = 0; xp < 5000; xp += 37) {
    const l = levelForXp(xp);
    assert.ok(xp >= xpForLevel(l) && xp < xpForLevel(l + 1));
  }
  const p = defaultProfile();
  const base = playerStats(p);
  p.abilities.push('armor1', 'armor2', 'overclock');
  const up = playerStats(p);
  assert.equal(up.maxHp, base.maxHp + 2);
  assert.equal(up.energy, base.energy + 2);
});

test('input rebinding moves a key off conflicting gameplay actions', () => {
  const inp = new Input(DEFAULT_BINDINGS);
  inp.rebind('attack', 0, 'KeyZ');
  assert.equal(inp.bindings.attack[0], 'KeyZ');
  assert.ok(!inp.bindings.jump.includes('KeyZ'), 'jump no longer uses Z');
  assert.ok(inp.bindings.confirm.includes('KeyZ'), 'menu actions may still share keys');
  inp.setVirtual('left', true);
  assert.equal(inp.pressed('left'), true);
  assert.equal(inp.axisX(), -1);
  inp.endFrame();
  assert.equal(inp.pressed('left'), false);
  assert.equal(inp.held('left'), true);
});

test('procedural songs are deterministic, loop-length and in a playable range', () => {
  for (const [id, def] of Object.entries(TRACKS)) {
    const a = composeSong(def), b = composeSong(def);
    assert.deepEqual(a, b, id);
    assert.equal(a.lead.length, 64);
    assert.equal(a.bass.length, 64);
    for (const n of [...a.lead, ...a.bass]) if (n !== null) assert.ok(n > -36 && n < 48, `${id} note ${n}`);
    assert.ok(a.lead.some((n) => n !== null), `${id} has a melody`);
  }
});

test('help text switches to touch button names only when touch is in use', () => {
  const inp = new Input(DEFAULT_BINDINGS);
  const text = 'ARROWS MOVE • Z JUMP • X ATTACK • ESC PAUSE';
  assert.equal(inp.label(text), text);
  inp.usingTouch = true;
  assert.equal(inp.label(text), 'D-PAD MOVE • A JUMP • B ATTACK • II PAUSE');
});

test('music switch defaults on, survives migration and repairs bad values', () => {
  assert.equal(migrateSettings({}).musicOn, true);
  assert.equal(migrateSettings({ musicOn: false }).musicOn, false);
  assert.equal(migrateSettings({ musicOn: 'nope' }).musicOn, true);
});

test('the repo-root index.html is the built game (GitHub Pages serves it), not the source template', async () => {
  const { readFileSync } = await import('node:fs');
  const root = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!root.includes('src="./src/main.ts"'), 'root index.html still points at the TypeScript source: run `npm run build`');
  assert.ok(root.includes('<script>'), 'root index.html has the game script inlined');
});

test('touch gestures map drags, taps and extra fingers onto the virtual buttons', async () => {
  const { TouchGestures } = await import('../src/core/gestures.ts');
  const held = new Set<string>();
  const pulses: string[] = [];
  const input = {
    setVirtual: (a: string, on: boolean) => { if (on) held.add(a); else held.delete(a); },
    pulse: (a: string) => pulses.push(a),
  };
  let mode: 'side' | 'racer' | 'topdown' | 'lanes' | null = 'side';
  const g = new TouchGestures(input as never, () => mode, (x) => (x < 240 ? 'left' : 'right'));
  // drag right, then up: holds right, then up + jump (a held jump gives full jump height)
  g.down(1, 100, 100, 0);
  g.move(1, 130, 100);
  assert.deepEqual([...held], ['right']);
  g.move(1, 130, 70);
  assert.ok(held.has('up') && held.has('jump') && held.has('right'));
  g.up(1, 100);
  assert.equal(held.size, 0, 'lifting the finger releases everything');
  assert.deepEqual(pulses, [], 'a drag is not a tap');
  // quick tap = attack; second finger = special
  g.down(2, 100, 100, 1000);
  g.up(2, 1100);
  assert.deepEqual(pulses, ['attack']);
  g.down(3, 100, 100, 2000);
  g.down(4, 200, 100, 2010);
  assert.deepEqual(pulses, ['attack', 'special']);
  g.up(4, 2100);
  g.up(3, 2200);
  // racer: tap boosts, second finger holds drift, "up" is ignored
  mode = 'racer';
  pulses.length = 0;
  g.down(5, 100, 100, 3000);
  g.up(5, 3050);
  assert.deepEqual(pulses, ['jump']);
  g.down(6, 100, 100, 4000);
  g.down(7, 150, 100, 4010);
  assert.ok(held.has('special'));
  g.move(6, 100, 60);
  assert.ok(!held.has('up'), 'the racer ignores upward drags');
  g.up(7, 4100);
  assert.ok(!held.has('special'));
  g.up(6, 4200);
  // lanes: each finger holds the lane it is on
  mode = 'lanes';
  g.down(8, 100, 100, 5000);
  g.down(9, 400, 100, 5001);
  assert.ok(held.has('left') && held.has('right'));
  // menus take over: everything is released
  mode = null;
  g.tick(5100);
  assert.equal(held.size, 0);
});

test('gestures: sliding between lanes retargets, and a second finger takes over steering when the first lifts', async () => {
  const { TouchGestures } = await import('../src/core/gestures.ts');
  const held = new Set<string>();
  const input = { setVirtual: (a: string, on: boolean) => { if (on) held.add(a); else held.delete(a); }, pulse: () => {} };
  let mode: 'side' | 'lanes' = 'lanes';
  const g = new TouchGestures(input as never, () => mode, (x) => (x < 240 ? 'left' : 'right'));
  g.down(1, 100, 100, 0);
  assert.deepEqual([...held], ['left']);
  g.move(1, 400, 100);
  assert.deepEqual([...held], ['right'], 'sliding to another lane releases the old one and presses the new one');
  g.up(1, 10);
  assert.equal(held.size, 0);
  mode = 'side';
  g.down(2, 100, 100, 100);
  g.down(3, 200, 100, 110);
  g.up(2, 200);
  g.move(3, 240, 100);
  assert.ok(held.has('right'), 'the surviving finger steers after the first one lifts');
});

test('Input.pulse adds a press edge without releasing a button the pad is already holding', () => {
  const inp = new Input(DEFAULT_BINDINGS);
  inp.setVirtual('jump', true);
  inp.endFrame();
  assert.equal(inp.pressed('jump'), false);
  inp.pulse('jump');
  assert.equal(inp.pressed('jump'), true, 'fresh press edge');
  assert.equal(inp.held('jump'), true, 'still held');
});

test('touch wording: keys become pad buttons, but "RED X" and words like XP stay', () => {
  const inp = new Input(DEFAULT_BINDINGS);
  const t = 'HOLD X TO RUN (NOISY!). Z HIDES YOU IN A LOCKER. C MAKES BYTE BARK. ESC PAUSES';
  assert.equal(inp.label(t), t, 'unchanged with a keyboard');
  inp.usingTouch = true;
  assert.equal(inp.label(t), 'HOLD B TO RUN (NOISY!). A HIDES YOU IN A LOCKER. C MAKES BYTE BARK. II PAUSES');
  assert.equal(inp.label('AVOID RED X GLITCH NOTES AND THE red X TOO'), 'AVOID RED X GLITCH NOTES AND THE red X TOO');
  assert.equal(inp.label('PRESS ANY KEY'), 'PRESS ANY BUTTON');
  assert.equal(inp.label('XP'), 'XP');
});

test('migration rejects malformed nested save fields', () => {
  const p = migrateProfile({
    cleared: { rampage: { clears: 'x', bestScore: NaN, bestTime: -4 }, neon: null },
    pet: { bond: 'lots', hunger: Infinity },
    bossChoices: { a: 'mercy', b: 'banana', c: 7 },
  });
  assert.equal(p.cleared.rampage.clears, 0);
  assert.equal(p.cleared.rampage.bestScore, 0);
  assert.equal(p.cleared.rampage.bestTime, 0);
  assert.equal(p.cleared.neon.clears, 0);
  assert.ok(Number.isFinite(p.pet.bond) && Number.isFinite(p.pet.hunger));
  assert.deepEqual(p.bossChoices, { a: 'mercy' });
  const s = migrateSettings({ bindings: { jump: 'KeyQ', attack: [1, 2], special: ['KeyE'] }, fixedSeed: 'abc' });
  assert.deepEqual(s.bindings.special, ['KeyE']);
  assert.deepEqual(s.bindings.jump, defaultSettings().bindings.jump);
  assert.deepEqual(s.bindings.attack, defaultSettings().bindings.attack);
  assert.equal(s.fixedSeed, null);
  assert.equal(migrateSettings({ fixedSeed: 123456 }).fixedSeed, 123456);
});

test('a veteran pet save does not jump to the final form on migration', () => {
  const p = migrateProfile({ pet: { bond: 5, hunger: 0, xp: 70 } });
  assert.equal(p.pet.care, 14);
});

import { Haptics, HAPTIC_PATTERNS } from '../src/core/haptics.ts';
import { AudioEngine } from '../src/audio/audio.ts';

test('settings: sound effects and vibration default on, survive bad values and can be switched off', () => {
  const d = defaultSettings();
  assert.equal(d.sfxOn, true);
  assert.equal(d.vibration, true);
  assert.equal(migrateSettings({}).sfxOn, true);
  assert.equal(migrateSettings({ sfxOn: false }).sfxOn, false);
  assert.equal(migrateSettings({ vibration: false }).vibration, false);
  assert.equal(migrateSettings({ sfxOn: 'no', vibration: 0 }).sfxOn, true, 'junk falls back to the default');
});

test('vibration: only meaningful cues buzz, a weak cue never cuts off a strong one, the switch and missing support are respected', () => {
  const calls: Array<number | number[]> = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const setNav = (value: unknown) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  try {
    setNav({ vibrate: (p: number | number[]) => (calls.push(p), true), maxTouchPoints: 5 });
    const h = new Haptics();
    assert.equal(h.supported, true);
    h.cue('levelup', 1000); // 210 ms long
    assert.equal(calls.length, 1);
    h.cue('block', 1050); // weaker, inside the running buzz: dropped
    assert.equal(calls.length, 1);
    h.cue('hurt', 1060); // 70 ms is weaker than 210 too
    assert.equal(calls.length, 1);
    h.cue('bomb', 1070); // 110 is still weaker than 210 until it ends
    assert.equal(calls.length, 1);
    h.cue('hurt', 1300); // the long buzz is over
    assert.equal(calls.length, 2);
    h.cue('levelup', 1320); // stronger than what is running: allowed to take over
    assert.equal(calls.length, 3);
    h.cue('coin', 5000);
    h.cue('explode', 5000);
    h.cue('hit', 5000);
    assert.equal(calls.length, 3, 'noisy cues (coins, explosions, hits) have no buzz');
    h.enabled = false;
    h.cue('levelup', 9000);
    assert.equal(calls.length, 3, 'switched off means silent');
    for (const p of Object.values(HAPTIC_PATTERNS)) assert.ok((Array.isArray(p) ? p.reduce((a, b) => a + b, 0) : p) <= 300, 'buzzes stay short');
    // A browser with the API but no touch screen (desktop Chrome) counts as unsupported.
    setNav({ vibrate: () => true, maxTouchPoints: 0 });
    assert.equal(new Haptics().supported, false);
    // vibrate() throwing must never escape.
    setNav({ vibrate: () => { throw new Error('blocked'); }, maxTouchPoints: 1 });
    const thrower = new Haptics();
    assert.doesNotThrow(() => thrower.cue('hurt', 1));
    assert.doesNotThrow(() => thrower.test());
    assert.doesNotThrow(() => thrower.stop());
    setNav({});
    const none = new Haptics();
    assert.equal(none.supported, false);
    assert.doesNotThrow(() => none.cue('hurt', 5000));
    assert.doesNotThrow(() => none.stop());
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});

test('sound effects off really silences them, while cues are still announced for vibration', () => {
  const a = new AudioEngine();
  const seen: string[] = [];
  a.onCue = (n) => seen.push(n);
  // A stand-in for a running Web Audio context: count the blips that would play.
  let blips = 0;
  const hack = a as unknown as { ctx: unknown; sfxBus: unknown; blip: () => void };
  hack.ctx = { state: 'running', currentTime: 1 };
  hack.sfxBus = {};
  hack.blip = () => { blips++; };
  a.setVolumes({ master: 1, music: 1, sfx: 1, muted: false, musicOn: true, sfxOn: true });
  a.sfx('coin');
  assert.ok(blips > 0, 'sound effects play when on');
  const before = blips;
  a.setVolumes({ master: 1, music: 1, sfx: 1, muted: false, musicOn: true, sfxOn: false });
  (hack as unknown as { lastCues: Map<string, number> }).lastCues.clear();
  a.sfx('coin');
  a.sfx('hurt');
  assert.equal(blips, before, 'nothing plays with sound effects off');
  assert.deepEqual(seen, ['coin', 'coin', 'hurt'], 'every cue is still announced');
});
