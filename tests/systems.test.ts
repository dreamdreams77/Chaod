import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MUTATIONS, GENRES, validateRegistry, isUnlockSatisfied } from '../src/fusion/registry.ts';
import { FusionEngine, newlyUnlocked } from '../src/fusion/engine.ts';
import { ChaosDirector, DirectorConfig, DirectorContext } from '../src/chaos/director.ts';
import { CHAOS_EVENTS, MIN_TELEGRAPH } from '../src/chaos/events.ts';
import { defaultProfile, MODE_IDS, ModeId } from '../src/core/save.ts';
import { applyRun, RunResult } from '../src/data/progression.ts';
import { isModeUnlocked } from '../src/data/story.ts';

// ---- Genre Fusion -------------------------------------------------------------

test('mutation registry is valid', () => {
  assert.deepEqual(validateRegistry(), []);
});

test('the initial release ships at least six distinct genre fusions', () => {
  const pairs = new Set(MUTATIONS.map((m) => [...m.genres].sort().join('+')));
  assert.ok(pairs.size >= 6, `only ${pairs.size} distinct fusions`);
  const startUnlocked = MUTATIONS.filter((m) => m.unlock.kind === 'start');
  assert.ok(startUnlocked.length >= 6);
  for (const g of Object.keys(GENRES)) assert.ok(MUTATIONS.some((m) => m.genres.includes(g as never)), `genre ${g} is used`);
});

test('every mutation trait is actually read by the mode that claims it', () => {
  for (const m of MUTATIONS) {
    for (const mode of m.modes) {
      const src = readFileSync(new URL(`../src/modes/${mode}.ts`, import.meta.url), 'utf8');
      const used = m.traits.some((t) => src.includes(`has('${t}')`));
      assert.ok(used, `${m.id}: none of [${m.traits}] is checked in ${mode}.ts`);
    }
  }
});

test('fusion engine resolves per mode, honours disabled and locked mutations', () => {
  const p = defaultProfile();
  const f = new FusionEngine('rampage', p);
  assert.ok(f.has('beat_platforms'));
  assert.ok(f.has('shots_trigger_switches'));
  assert.ok(!f.has('lurker'), 'other modes\' traits are not active');
  assert.equal(f.rewardMultiplier(), 1 + 0.15 * 2);
  p.mutationsDisabled.push('beat_platforms');
  assert.ok(!new FusionEngine('rampage', p).has('beat_platforms'));
  // beat_boost is locked until NEON is cleared, even if listed as unlocked
  p.mutationsUnlocked.push('beat_boost');
  assert.ok(!new FusionEngine('neon', p).has('beat_boost'));
  p.cleared.neon.clears = 1;
  assert.ok(new FusionEngine('neon', p).has('beat_boost'));
  const f2 = new FusionEngine('neon', p);
  f2.grant('temp_trait');
  assert.ok(f2.has('temp_trait'));
  f2.revoke('temp_trait');
  assert.ok(!f2.has('temp_trait'));
});

test('newlyUnlocked reports mutations whose rules became true', () => {
  const p = defaultProfile();
  assert.deepEqual(newlyUnlocked(p).map((m) => m.id), []);
  p.bossesDefeated.push('bricklord');
  assert.deepEqual(newlyUnlocked(p).map((m) => m.id), ['rpg_drift']);
  assert.ok(isUnlockSatisfied({ kind: 'floppies', count: 2 }, { cleared: {}, bossesDefeated: [], floppies: ['a', 'b'] }));
});

// ---- Chaos Director --------------------------------------------------------------

const cfg = (over: Partial<DirectorConfig> = {}): DirectorConfig => ({ mode: 'rampage', intensity: 'normal', difficulty: 'normal', reducedFlash: false, favor: null, seed: 7, ...over });
const ctx = (over: Partial<DirectorContext> = {}): DirectorContext => ({ hpFrac: 1, safe: true, bossActive: false, segment: 'platform', ...over });

function simulate(d: ChaosDirector, seconds: number, c: DirectorContext = ctx()): void {
  for (let t = 0; t < seconds; t += 1 / 60) d.update(1 / 60, c);
}

test('director produces events over time, telegraphs them, and ends them', () => {
  const d = new ChaosDirector(cfg());
  let telegraphed = 0;
  let maxActive = 0;
  for (let t = 0; t < 600; t += 1 / 60) {
    d.update(1 / 60, ctx());
    if (d.telegraphing()) telegraphed++;
    maxActive = Math.max(maxActive, d.active.filter((a) => a.phase === 'active').length);
    for (const a of d.active) if (a.phase === 'active') assert.ok(a.timer <= a.def.duration + 1e-9);
  }
  assert.ok(d.history.length >= 10, `only ${d.history.length} events in 10 minutes`);
  assert.ok(telegraphed > 0);
  assert.ok(maxActive <= 1, 'normal intensity never stacks events');
  for (const e of CHAOS_EVENTS) assert.ok(Math.max(MIN_TELEGRAPH, e.telegraph) >= MIN_TELEGRAPH);
});

test('director respects intensity off, unsafe moments, and recovery', () => {
  const off = new ChaosDirector(cfg({ intensity: 'off' }));
  simulate(off, 300);
  assert.equal(off.history.length, 0);
  assert.equal(off.trigger(ctx()), null);

  const unsafe = new ChaosDirector(cfg());
  simulate(unsafe, 300, ctx({ safe: false }));
  assert.equal(unsafe.history.length, 0);

  const hurt = new ChaosDirector(cfg());
  simulate(hurt, 20);
  hurt.clearAll();
  hurt.notifyHurt();
  assert.equal(hurt.pickEvent(ctx(), true), null, 'no new chaos right after taking damage');
});

test('director only picks compatible, legal events', () => {
  for (const mode of MODE_IDS) {
    for (const boss of [false, true]) {
      for (const lowHp of [false, true]) {
        const d = new ChaosDirector(cfg({ mode, seed: 99, reducedFlash: true, intensity: 'high' }));
        for (let i = 0; i < 400; i++) {
          d.clearAll();
          const ev = d.pickEvent(ctx({ bossActive: boss, hpFrac: lowHp ? 0.2 : 1, segment: 'shmup' }), true);
          if (!ev) continue;
          assert.ok(ev.modes === 'all' || ev.modes.includes(mode as ModeId), `${ev.id} not for ${mode}`);
          if (boss) assert.ok(ev.bossSafe, `${ev.id} interrupted a boss`);
          if (!boss) assert.ok(!ev.bossOnly, `${ev.id} is boss-only`);
          if (lowHp) assert.ok(!ev.harsh, `${ev.id} is harsh at low hp`);
          assert.ok(!ev.flashy, 'reduced flash removes flashy events');
          assert.ok(!ev.blockedSegments?.includes('shmup'), `${ev.id} blocked in shmup`);
        }
      }
    }
  }
});

test('director never stacks events from the same exclusive group', () => {
  const d = new ChaosDirector(cfg({ intensity: 'high', seed: 3 }));
  for (let t = 0; t < 900; t += 1 / 60) {
    d.update(1 / 60, ctx());
    const groups = d.active.map((a) => a.def.group).filter(Boolean);
    assert.equal(groups.length, new Set(groups).size);
  }
});

test('per-event cooldowns are respected', () => {
  const d = new ChaosDirector(cfg({ intensity: 'high', seed: 11 }));
  const fired = new Map<string, number[]>();
  let clock = 0;
  for (let t = 0; t < 1200; t += 1 / 60) {
    clock += 1 / 60;
    const before = d.history.length;
    d.update(1 / 60, ctx());
    if (d.history.length > before) {
      const id = d.history[d.history.length - 1];
      if (!fired.has(id)) fired.set(id, []);
      fired.get(id)!.push(clock);
    }
  }
  for (const [id, times] of fired) {
    const cd = CHAOS_EVENTS.find((e) => e.id === id)!.cooldown;
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= cd - 0.05, `${id} repeated too soon`);
  }
});

test('director is reproducible from its seed and favour biases category', () => {
  const a = new ChaosDirector(cfg({ seed: 42 }));
  const b = new ChaosDirector(cfg({ seed: 42 }));
  simulate(a, 400);
  simulate(b, 400);
  assert.deepEqual(a.history, b.history);
  const fav = new ChaosDirector(cfg({ seed: 5, favor: 'cosmetic', intensity: 'high' }));
  let cosmetic = 0, total = 0;
  for (let i = 0; i < 300; i++) {
    fav.clearAll();
    const ev = fav.pickEvent(ctx(), true);
    if (ev) {
      total++;
      if (ev.category === 'cosmetic') cosmetic++;
    }
  }
  assert.ok(cosmetic / total > 0.3, `favour should bias picks (${cosmetic}/${total})`);
});

test('kevin only "fixes" rules the current mode supports', () => {
  const d = new ChaosDirector(cfg({ mode: 'neon', intensity: 'high', seed: 1 }));
  for (let t = 0; t < 3000; t += 1 / 60) {
    d.update(1 / 60, ctx({ segment: 'day' }));
    for (const a of d.started) if (a.def.id === 'kevin_bug') assert.ok(a.extraFlags.every((f) => ['mecha', 'reverse'].includes(f)));
  }
});

// ---- Progression -------------------------------------------------------------------

const run = (over: Partial<RunResult> = {}): RunResult => ({
  mode: 'rampage', cleared: true, score: 1000, time: 60, bits: 100, xp: 50, floppies: [], damageTaken: 1, flags: [], chaosSeen: [], bitMultiplier: 1, ...over,
});

test('applyRun is pure and rewards clears', () => {
  const p = defaultProfile();
  const snapshot = JSON.stringify(p);
  const { profile, summary } = applyRun(p, run({ floppies: ['rampage-0'] }));
  assert.equal(JSON.stringify(p), snapshot, 'input profile untouched');
  assert.equal(profile.bits, 100);
  assert.equal(profile.cleared.rampage.clears, 1);
  assert.equal(summary.newFloppies, 1);
  assert.ok(summary.achievements.includes('first_clear'));
  assert.equal(profile.pet.hunger, 3, 'pet gets hungry after adventures');
  const again = applyRun(profile, run({ floppies: ['rampage-0'] }));
  assert.equal(again.summary.newFloppies, 0, 'floppies are only counted once');
});

test('failed runs pay half; flawless clears earn UNTOUCHABLE', () => {
  const fail = applyRun(defaultProfile(), run({ cleared: false, bits: 100, xp: 40 }));
  assert.equal(fail.summary.bits, 50);
  assert.equal(fail.profile.cleared.rampage.clears, 0);
  const flawless = applyRun(defaultProfile(), run({ damageTaken: 0 }));
  assert.ok(flawless.summary.achievements.includes('no_damage'));
});

test('clearing worlds opens cabinets and unlocks mutations', () => {
  let p = defaultProfile();
  assert.ok(!isModeUnlocked('neon', p.cleared));
  p = applyRun(p, run()).profile;
  assert.ok(isModeUnlocked('neon', p.cleared) && isModeUnlocked('mall', p.cleared));
  assert.ok(!isModeUnlocked('beatdown', p.cleared));
  const r = applyRun(p, run({ mode: 'neon' }));
  assert.ok(r.summary.mutations.includes('beat_boost'));
  assert.ok(isModeUnlocked('beatdown', r.profile.cleared) && isModeUnlocked('rhythm', r.profile.cleared));
  const boss = applyRun(r.profile, run({ mode: 'beatdown', boss: 'bricklord' }));
  assert.ok(boss.profile.bossesDefeated.includes('bricklord'));
  assert.ok(boss.summary.achievements.includes('boss_bricklord'));
  assert.ok(boss.summary.mutations.includes('rpg_drift'));
});

test('collecting all fifteen floppies unlocks the secret character', () => {
  const all = MODE_IDS.flatMap((m) => [0, 1, 2].map((i) => `${m}-${i}`));
  const { profile, summary } = applyRun(defaultProfile(), run({ floppies: all }));
  assert.ok(profile.secretUnlocked);
  assert.ok(summary.achievements.includes('floppy15') && summary.achievements.includes('secret'));
});

test('clearAll reports cut-short events on the next update so end hooks still run', () => {
  const d = new ChaosDirector(cfg());
  for (let i = 0; i < 60 * 600 && d.active.length === 0; i++) d.update(1 / 60, ctx());
  const live = d.active.slice();
  assert.ok(live.length > 0, 'precondition: an event is running');
  d.clearAll();
  d.update(1 / 60, ctx());
  for (const a of live) assert.ok(d.ended.includes(a), `${a.def.id} reported as ended`);
});
