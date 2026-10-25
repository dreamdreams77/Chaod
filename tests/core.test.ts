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
