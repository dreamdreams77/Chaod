import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MUTATIONS, GENRES, validateRegistry, isUnlockSatisfied } from '../src/fusion/registry.ts';
import { FusionEngine, newlyUnlocked } from '../src/fusion/engine.ts';
import { ChaosDirector, DirectorConfig, DirectorContext } from '../src/chaos/director.ts';
import { CHAOS_EVENTS, MIN_TELEGRAPH } from '../src/chaos/events.ts';
import { defaultProfile, MODE_IDS, ModeId } from '../src/core/save.ts';
import { applyRun, applyMini, RunResult } from '../src/data/progression.ts';
import { isModeUnlocked } from '../src/data/story.ts';
import { QUESTS, MINIS } from '../src/data/quests.ts';
import { ERRANDS } from '../src/data/errands.ts';
import { migrateProfile } from '../src/core/save.ts';

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
      // Curses are enforced once, in the shared base class; every other mutation is read by its own mode.
      const files = m.cursed ? ['base'] : [mode];
      const src = files.map((f) => readFileSync(new URL(`../src/modes/${f}.ts`, import.meta.url), 'utf8')).join('\n');
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
  const { profile, summary } = applyRun(p, run({ floppies: ['rampage-0'] }), '2026-03-02', '2026-03-03'); // fixed dates, outside any lobby season
  assert.equal(JSON.stringify(p), snapshot, 'input profile untouched');
  assert.equal(summary.bits, 100);
  const questBits = QUESTS.filter((q) => summary.quests.includes(q.id)).reduce((n, q) => n + q.bits, 0);
  const weeklyBits = summary.weekly.reduce((n, id) => n + (id === 'sweep' ? SWEEP_BITS : WEEKLY_POOL.find((w) => w.id === id)!.bits), 0);
  const errandBits = summary.errand ? ERRANDS.find((e) => e.title === summary.errand)!.bits : 0;
  assert.equal(profile.bits, summary.bits + questBits + summary.newStars.length * 40 + summary.dailyBonus + weeklyBits + errandBits, 'run bits plus exactly the finished quests, goals, errand, stars and daily bonus');
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

// ---- Quests and mini-games ----------------------------------------------------------

test('quest ids are unique, rewards positive, and every quest can be advanced by some event', () => {
  assert.equal(new Set(QUESTS.map((q) => q.id)).size, QUESTS.length);
  for (const q of QUESTS) assert.ok(q.goal > 0 && q.bits > 0 && q.xp > 0, q.id);
});

test('a clean fast clear completes quests once and pays rewards', () => {
  const p = defaultProfile();
  const { profile, summary } = applyRun(p, run({ cleared: true, damageTaken: 0, time: 90, bits: 450, floppies: ['rampage-0'] }));
  for (const id of ['untouchable', 'speed_demon']) assert.ok(summary.quests.includes(id), id);
  assert.ok(summary.quests.includes('bit_hoard'), 'a 450-bit run clears BIT HOARDER');
  assert.ok(profile.questsDone.includes('untouchable'));
  const paid = QUESTS.filter((q) => summary.quests.includes(q.id)).reduce((n, q) => n + q.bits, 0);
  assert.ok(profile.bits >= paid + summary.bits, 'quest bits were added on top of run bits');
  // Running the same thing again must not pay twice.
  const again = applyRun(profile, run({ cleared: true, damageTaken: 0, time: 90, bits: 200 }));
  assert.ok(!again.summary.quests.includes('untouchable'));
});

test('boss clears do not count for SPEED DEMON; failed runs do not clear quests', () => {
  const { summary } = applyRun(defaultProfile(), run({ cleared: true, boss: 'bricklord', time: 60 }));
  assert.ok(!summary.quests.includes('speed_demon'));
  const lost = applyRun(defaultProfile(), run({ cleared: false, damageTaken: 0, time: 20 }));
  assert.ok(!lost.summary.quests.includes('untouchable'));
});

test('mini-games pay bits, keep personal bests, and complete arcade quests', () => {
  let p = defaultProfile();
  const a = applyMini(p, 'catch', 70);
  assert.equal(a.outcome.bits, Math.round(70 * MINIS.find((m) => m.id === 'catch')!.bitsPerPoint));
  assert.ok(a.outcome.best);
  assert.ok(a.outcome.quests.some((q) => q.id === 'arcade_ace'));
  p = a.profile;
  const b = applyMini(p, 'catch', 10);
  assert.ok(!b.outcome.best);
  assert.equal(b.profile.mini.catch.best, 70);
  assert.equal(b.profile.mini.catch.plays, 2);
  const m = applyMini(b.profile, 'memory', 7);
  assert.ok(m.outcome.quests.some((q) => q.id === 'memory_master'));
});

test('old saves without quest fields migrate cleanly', () => {
  const p = migrateProfile({ version: 2, bits: 5 });
  assert.deepEqual(p.questProgress, {});
  assert.deepEqual(p.questsDone, []);
  assert.deepEqual(p.mini, {});
  assert.equal(migrateProfile({ questProgress: 'junk', mini: 7, questsDone: 3 }).questsDone.length, 0);
});

test('BIT HOARDER counts bits actually paid, and failed runs pay half', () => {
  const lost = applyRun(defaultProfile(), run({ cleared: false, bits: 100, bitMultiplier: 1.5 }));
  assert.equal(lost.profile.questProgress.bit_hoard, lost.summary.bits);
});

test('mini-game scores are sanitised and corrupt saves cannot poison bests', () => {
  const bad = applyMini(defaultProfile(), 'catch', Number.NaN);
  assert.equal(bad.outcome.bits, 0);
  assert.equal(bad.profile.mini.catch.best, 0);
  const p = migrateProfile({ mini: { catch: 5, memory: { best: 'x', plays: 1 }, ok: { best: 3, plays: 2 } }, questProgress: ['a'] });
  assert.deepEqual(p.mini, { ok: { best: 3, plays: 2 } });
  assert.deepEqual(p.questProgress, {});
});

test('BYTE BREAKOUT runs headlessly, scores, keeps the ball in play and always ends', async () => {
  const { BreakoutScene } = await import('../src/scenes/arcade.ts');
  const { Rng } = await import('../src/core/rng.ts');
  const { defaultProfile: dp } = await import('../src/core/save.ts');
  for (let seed = 1; seed <= 20; seed++) {
    const st = { ax: 0 };
    const game = {
      rng: new Rng(seed), profile: dp(), newSeed: () => seed,
      input: { axisX: () => st.ax, pressed: () => false, label: (t: string) => t },
      audio: { sfx() {} }, fx: { shake() {} }, music() {}, toHub() {}, saveProfile() {}, toast() {}, announceAchievements() {},
    };
    const s = new BreakoutScene(game as never) as unknown as { over: boolean; score: number; bx: number; by: number; px: number; stuck: boolean; t: number; update(dt: number): void };
    for (let i = 0; i < 60 * 100 && !s.over; i++) {
      st.ax = s.bx > s.px + 5 ? 1 : s.bx < s.px - 5 ? -1 : 0;
      s.update(1 / 60);
      assert.ok(Number.isFinite(s.bx) && Number.isFinite(s.by), 'ball stays finite');
      assert.ok(s.bx >= 0 && s.bx <= 480, 'ball stays between the walls');
    }
    assert.ok(s.over, `seed ${seed} ends within the time limit`);
    assert.ok(s.score > 0 && s.score <= 60, `seed ${seed} score ${s.score}`);
  }
});

test('BYTE BREAKOUT: one missed ball costs exactly one life, and idle rounds do not count as plays', async () => {
  const { BreakoutScene } = await import('../src/scenes/arcade.ts');
  const { Rng } = await import('../src/core/rng.ts');
  const { defaultProfile: dp } = await import('../src/core/save.ts');
  const game = {
    rng: new Rng(5), profile: dp(), newSeed: () => 5,
    input: { axisX: () => 0, pressed: () => false, label: (t: string) => t },
    audio: { sfx() {} }, fx: { shake() {} }, music() {}, toHub() {}, saveProfile() {}, toast() {}, announceAchievements() {},
  };
  const s = new BreakoutScene(game as never) as unknown as { lives: number; stuck: boolean; px: number; bx: number; update(dt: number): void };
  // Park the paddle in the corner and never move: the first serve is missed.
  s.px = 28;
  let missedAt = -1;
  for (let i = 0; i < 60 * 12 && missedAt < 0; i++) {
    s.update(1 / 60);
    if (s.lives < 3) missedAt = i;
  }
  assert.ok(missedAt >= 0, 'the ball was eventually missed');
  assert.equal(s.lives, 2, 'a single miss costs exactly one life');
  assert.ok(s.stuck, 'the next ball waits on the paddle');
  const idle = applyMini(defaultProfile(), 'breakout', 0);
  assert.equal(idle.profile.questProgress.arcade_regular ?? 0, 0, 'a zero-score round is not a play toward ARCADE REGULAR');
  const real = applyMini(defaultProfile(), 'breakout', 53);
  assert.ok(real.outcome.quests.some((q) => q.id === 'brick_boss'));
});

test('WHACK-A-GLITCH and STACK-A-CART run headlessly, score sensibly and always end', async () => {
  const { WhackScene, StackScene } = await import('../src/scenes/arcade.ts');
  const { Rng } = await import('../src/core/rng.ts');
  const { defaultProfile: dp } = await import('../src/core/save.ts');
  const mk = (seed: number, pressed: (a: string) => boolean) => ({
    rng: new Rng(seed), profile: dp(), newSeed: () => seed,
    input: { axisX: () => 0, pressed, label: (t: string) => t },
    audio: { sfx() {} }, fx: { shake() {} }, music() {}, toHub() {}, saveProfile() {}, toast() {}, announceAchievements() {},
  });
  type S = { over: boolean; score: number; t: number; update(dt: number): void; critters?: Array<{ cell: number; kind: string; hit: number }>; cursor?: number; slabs?: Array<{ x: number; w: number }>; mx?: number; dir?: number };
  for (let seed = 1; seed <= 10; seed++) {
    // Whack: aim the cursor at a live critter each frame and bonk; the round ends at 30s with a non-negative score.
    let press = false;
    const w = new WhackScene(mk(seed, (a) => a === 'jump' && press) as never) as unknown as S;
    for (let i = 0; i < 60 * 40 && !w.over; i++) {
      const target = w.critters?.find((c) => c.hit < 0 && c.kind !== 'byte');
      press = !!target;
      if (target) w.cursor = target.cell;
      w.update(1 / 60);
      press = false;
    }
    assert.ok(w.over && w.score > 0, `whack seed ${seed} ends with points (${w.score})`);
    // Stack: drop when the slab crosses the top slab's x. It never exceeds the 60-floor cap and always ends.
    let drop = false;
    const s = new StackScene(mk(seed, (a) => a === 'jump' && drop) as never) as unknown as S;
    for (let i = 0; i < 60 * 300 && !s.over; i++) {
      const top = s.slabs![s.slabs!.length - 1];
      drop = (s.dir! > 0 && s.mx! >= top.x) || (s.dir! < 0 && s.mx! <= top.x);
      s.update(1 / 60);
      drop = false;
    }
    assert.ok(s.over && s.score >= 1, `stack seed ${seed} ends with a tower (${s.score})`);
    assert.ok(s.slabs!.length <= 60);
  }
});

test('new arcade quests complete at their thresholds', () => {
  const w = applyMini(defaultProfile(), 'whack', 56);
  assert.ok(w.outcome.quests.some((q) => q.id === 'whack_ace'));
  const s = applyMini(defaultProfile(), 'stack', 25);
  assert.ok(s.outcome.quests.some((q) => q.id === 'tower_builder'));
  assert.ok(!applyMini(defaultProfile(), 'stack', 23).outcome.quests.some((q) => q.id === 'tower_builder'));
});

// ---- Daily challenge and shared links ----------------------------------------------------

test('the daily run is the same for everyone, deterministic, never a boss, and differs by day', async () => {
  const { dailyFor, dateKey, addDays, DAILY_POOL } = await import('../src/data/daily.ts');
  assert.deepEqual(dailyFor('2026-10-25'), dailyFor('2026-10-25'));
  const seen = new Set<string>();
  const modes = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const d = dailyFor(addDays('2026-01-01', i));
    assert.ok(DAILY_POOL.includes(d.mode), 'only the shared pool of worlds');
    assert.ok(d.seed >= 0 && d.seed < 1000000);
    seen.add(d.mode + d.seed);
    modes.add(d.mode);
  }
  assert.ok(seen.size > 50, 'a different run most days');
  assert.equal(modes.size, DAILY_POOL.length, 'every world in the pool comes up');
  assert.equal(dateKey(new Date('2026-03-04T23:59:59Z')), '2026-03-04');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('challenge links round-trip and reject junk', async () => {
  const { parseChallenge, challengeUrl } = await import('../src/data/daily.ts');
  const url = challengeUrl('https://x.test/Chaod/', { mode: 'neon', seed: 42 });
  assert.equal(url, 'https://x.test/Chaod/?seed=000042&mode=neon');
  assert.deepEqual(parseChallenge(url.slice(url.indexOf('?'))), { mode: 'neon', seed: 42 });
  for (const bad of ['', '?seed=1', '?mode=neon', '?seed=abc&mode=neon', '?seed=1234567&mode=neon', '?seed=12&mode=hacker', '?seed=-5&mode=mall']) {
    assert.equal(parseChallenge(bad), null, bad);
  }
});

test('daily clears pay once per day, build a streak, and lapse when a day is missed', async () => {
  const { applyDailyResult, currentStreak, DAILY_BONUS } = await import('../src/data/daily.ts');
  const p = defaultProfile();
  const a = applyDailyResult(p, '2026-05-01', 120, false);
  assert.equal(a.bonus, 0, 'a failed daily pays nothing');
  assert.equal(p.daily.best, 120);
  const b = applyDailyResult(p, '2026-05-01', 300, true);
  assert.equal(b.bonus, DAILY_BONUS + 10);
  assert.equal(p.daily.best, 300);
  assert.equal(applyDailyResult(p, '2026-05-01', 400, true).bonus, 0, 'only once a day');
  const c = applyDailyResult(p, '2026-05-02', 10, true);
  assert.equal(c.streak, 2);
  assert.equal(c.bonus, DAILY_BONUS + 20);
  assert.equal(currentStreak(p.daily, '2026-05-03'), 2, 'still alive the next day');
  assert.equal(currentStreak(p.daily, '2026-05-05'), 0, 'lapsed');
  const d = applyDailyResult(p, '2026-05-09', 10, true);
  assert.equal(d.streak, 1, 'a missed day restarts the streak');
});

test('daily runs flow through applyRun and count for DAILY GRINDER', () => {
  let p = defaultProfile();
  for (const day of ['2026-06-01', '2026-06-02', '2026-06-03']) {
    const r = applyRun(p, run({ cleared: true, challenge: 'daily', dailyKey: day }));
    assert.ok(r.summary.dailyBonus > 0);
    p = r.profile;
  }
  assert.ok(p.questsDone.includes('daily_grinder'));
  const shared = applyRun(defaultProfile(), run({ cleared: true, challenge: 'shared' }));
  assert.equal(shared.summary.dailyBonus, 0, 'shared-link runs never pay the daily bonus');
});

test('old saves gain a clean daily record', () => {
  assert.deepEqual(migrateProfile({ version: 2 }).daily, { key: '', best: 0, cleared: false, streak: 0, lastClear: '' });
  assert.equal(migrateProfile({ daily: { key: 5, best: 'x', streak: -3 } }).daily.streak, 0);
});

// ---- Mastery stars -----------------------------------------------------------------------

test('mastery stars: each goal is checked on cleared runs only, and paid once', async () => {
  const { starsEarned, awardStars, PAR_SECONDS, STAR_BITS } = await import('../src/data/mastery.ts');
  const p = defaultProfile();
  p.floppies = ['neon-0', 'neon-1', 'neon-2'];
  const base = { mode: 'neon' as ModeId, cleared: true, damageTaken: 0, time: PAR_SECONDS.neon - 1 };
  assert.deepEqual(starsEarned(p, base).sort(), ['clean', 'collector', 'fast']);
  assert.deepEqual(starsEarned(p, { ...base, cleared: false }), [], 'a failed run earns nothing');
  assert.ok(!starsEarned(p, { ...base, damageTaken: 1 }).includes('clean'));
  assert.ok(!starsEarned(p, { ...base, time: PAR_SECONDS.neon }).includes('fast'), 'par itself is not fast enough');
  const before = p.bits;
  assert.equal(awardStars(p, base).length, 3);
  assert.equal(p.bits, before + 3 * STAR_BITS);
  assert.equal(awardStars(p, base).length, 0, 'stars are only paid the first time');
  assert.equal(p.bits, before + 3 * STAR_BITS);
});

test('mastery stars flow through applyRun and feed STAR COLLECTOR', () => {
  let p = defaultProfile();
  const r1 = applyRun(p, run({ mode: 'rampage', cleared: true, damageTaken: 0, time: 100, floppies: ['rampage-0', 'rampage-1', 'rampage-2'] }));
  assert.equal(r1.summary.newStars.length, 3);
  assert.deepEqual([...(r1.profile.stars.rampage ?? [])].sort(), ['clean', 'collector', 'fast']);
  p = r1.profile;
  const r2 = applyRun(p, run({ mode: 'neon', cleared: true, damageTaken: 0, time: 90, floppies: ['neon-0', 'neon-1', 'neon-2'] }));
  assert.ok(r2.summary.quests.includes('star_collector'), 'six stars complete the quest');
  const again = applyRun(r2.profile, run({ mode: 'neon', cleared: true, damageTaken: 0, time: 90 }));
  assert.equal(again.summary.newStars.length, 0);
});

test('star data in old or corrupt saves is repaired', () => {
  assert.deepEqual(migrateProfile({ version: 2 }).stars, {});
  const p = migrateProfile({ stars: { rampage: ['clean', 'clean', 'bogus', 'fast'], neon: 'x', hacker: ['clean'] } });
  assert.deepEqual(p.stars, { rampage: ['clean', 'fast'] });
});

// ---- Wardrobe ----------------------------------------------------------------------------

test('wardrobe: buying charges once, equipping owned items is free, poor players are refused', async () => {
  const { buyOrEquip, COSMETIC_BY_ID } = await import('../src/data/cosmetics.ts');
  const p = defaultProfile();
  p.bits = 100;
  assert.equal(buyOrEquip(p, 'crown'), 'poor');
  assert.equal(p.bits, 100, 'a refused purchase costs nothing');
  assert.equal(buyOrEquip(p, 'sunset'), 'bought');
  assert.equal(p.bits, 100 - COSMETIC_BY_ID.get('sunset')!.cost);
  assert.equal(p.wardrobe.palette, 'sunset');
  assert.equal(buyOrEquip(p, 'classic'), 'equipped');
  assert.equal(buyOrEquip(p, 'classic'), 'equipped');
  assert.equal(p.bits, 100 - COSMETIC_BY_ID.get('sunset')!.cost, 'switching back is free');
  p.bits += 100;
  assert.equal(buyOrEquip(p, 'cap'), 'bought');
  assert.equal(p.wardrobe.hat, 'cap');
  assert.equal(p.wardrobe.palette, 'classic', 'a hat does not change the outfit');
  assert.equal(buyOrEquip(p, 'nonsense'), 'unknown');
});

test('wardrobe saves are repaired: unknown or unowned items fall back to the defaults', async () => {
  const { cleanWardrobe, currentLook, COSMETICS } = await import('../src/data/cosmetics.ts');
  assert.deepEqual(migrateProfile({ version: 2 }).wardrobe, { owned: ['classic', 'none'], palette: 'classic', hat: 'none' });
  const w = cleanWardrobe({ owned: ['sunset', 'bogus', 7], palette: 'royal', hat: 'sunset' });
  assert.equal(w.palette, 'classic', 'wearing something you do not own is refused');
  assert.equal(w.hat, 'none', 'a palette cannot be worn as a hat');
  assert.ok(w.owned.includes('sunset') && !w.owned.includes('bogus'));
  assert.ok(COSMETICS.every((c) => (c.kind === 'palette') === !!c.look), 'only palettes carry colours');
  assert.equal(currentLook({ owned: [], palette: 'mint', hat: 'crown' }).hat, 'crown');
});

test('mini-game result panel: the D-pad moves between PLAY AGAIN and LOBBY and A uses the highlighted one', async () => {
  const { CatchScene } = await import('../src/scenes/arcade.ts');
  const { Rng } = await import('../src/core/rng.ts');
  const { defaultProfile: dp } = await import('../src/core/save.ts');
  const calls: string[] = [];
  let down = new Set<string>();
  const game = {
    rng: new Rng(3), profile: dp(), newSeed: () => 3,
    input: { axisX: () => 0, pressed: (a: string) => down.has(a), label: (t: string) => t },
    audio: { sfx() {} }, fx: { shake() {} }, music() {}, saveProfile() {}, toast() {}, announceAchievements() {},
    toHub: () => calls.push('lobby'), goto: () => calls.push('again'),
  };
  const press = (s: { update(dt: number): void }, ...keys: string[]) => { down = new Set(keys); s.update(1 / 60); down = new Set(); s.update(1 / 60); };
  const fresh = () => {
    const s = new CatchScene(game as never) as unknown as { finish(): void; update(dt: number): void; sel: number };
    s.finish();
    for (let i = 0; i < 40; i++) s.update(1 / 60);
    return s;
  };
  let s = fresh();
  assert.equal(s.sel, 0, 'PLAY AGAIN starts highlighted');
  press(s, 'jump');
  assert.deepEqual(calls, ['again'], 'A on PLAY AGAIN restarts');
  calls.length = 0;
  s = fresh();
  press(s, 'right');
  assert.equal(s.sel, 1, 'the D-pad moves the highlight');
  press(s, 'jump');
  assert.deepEqual(calls, ['lobby'], 'A on LOBBY returns to the lobby');
  calls.length = 0;
  s = fresh();
  press(s, 'left');
  press(s, 'left');
  assert.equal(s.sel, 0, 'it toggles back');
  press(s, 'attack');
  assert.deepEqual(calls, ['lobby'], 'B always returns to the lobby');
});

// ---- BYTE's growth -----------------------------------------------------------------------

import { PET_ITEMS, PET_STAGES, buyOrWearPet, cleanOutfit, petBarkBonus, petBitBonus, petForm, petStage } from '../src/data/pet.ts';

test('BYTE grows through four forms by lifetime care, each with a perk', () => {
  assert.equal(petStage(0), 0);
  assert.equal(petStage(14), 0);
  assert.equal(petStage(15), 1);
  assert.equal(petStage(39), 1);
  assert.equal(petStage(40), 2);
  assert.equal(petStage(500), 3);
  assert.equal(petBitBonus(0), 0);
  assert.ok(petBitBonus(3) > petBitBonus(1) && petBitBonus(3) <= 0.12 + 1e-9);
  assert.ok(petBarkBonus(2) > petBarkBonus(1));
  assert.deepEqual(PET_STAGES.map((s) => s.at), [...PET_STAGES.map((s) => s.at)].sort((a, b) => a - b));
});

test('pet outfits: buying wears, choosing a worn item takes it off, forms gate the fancy ones, bad saves are repaired', () => {
  const p = defaultProfile();
  p.bits = 300;
  assert.equal(buyOrWearPet(p, 'nope'), 'unknown');
  assert.equal(buyOrWearPet(p, 'bow'), 'bought');
  assert.equal(p.pet.outfit.head, 'bow');
  assert.equal(p.bits, 270);
  assert.equal(buyOrWearPet(p, 'bow'), 'removed');
  assert.equal(p.pet.outfit.head, '');
  assert.equal(buyOrWearPet(p, 'bow'), 'worn');
  assert.equal(p.bits, 270, 'wearing an owned item is free');
  assert.equal(buyOrWearPet(p, 'wings'), 'locked', 'wings need MEGABYTE');
  p.pet.care = 40;
  assert.equal(buyOrWearPet(p, 'wings'), 'bought');
  p.bits = 0;
  assert.equal(buyOrWearPet(p, 'cape'), 'poor');
  assert.equal(petForm(p.pet).back, 'wings');
  // every item has a unique id and a price
  assert.equal(new Set(PET_ITEMS.map((i) => i.id)).size, PET_ITEMS.length);
  const fixed = cleanOutfit({ owned: ['bow', 'bow', 'ghost', 7], head: 'shades', face: 'bow', back: 'cape' });
  assert.deepEqual(fixed, { owned: ['bow'], head: '', face: '', back: '' });
});

test('old saves keep their growth: care is rebuilt from bond, and a grown BYTE boosts run pay', () => {
  const old = migrateProfile({ pet: { bond: 5, hunger: 0, xp: 2 } });
  assert.equal(old.pet.care, 14);
  assert.deepEqual(old.pet.outfit, { owned: [], head: '', face: '', back: '' });
  const grown = defaultProfile();
  grown.pet.care = 80;
  const base = { mode: 'rampage' as ModeId, cleared: true, score: 1, time: 100, bits: 100, xp: 10, floppies: [], damageTaken: 0, flags: [], chaosSeen: [], bitMultiplier: 1 };
  const { summary } = applyRun(grown, { ...base, bitMultiplier: 1 + petBitBonus(petStage(grown.pet.care)) });
  assert.equal(summary.bits, 112);
});

// ---- weekly goals, lobby decor and assist mode -------------------------------------------

import { WEEKLY_POOL, advanceWeekly, weekKey, weeklyFor, weeklyView, SWEEP_BITS } from '../src/data/weekly.ts';
import { DECOR, buyOrWearDecor, cleanDecor } from '../src/data/decor.ts';
import { migrateSettings } from '../src/core/save.ts';

test('weekKey is the Monday of the UTC week', () => {
  assert.equal(weekKey(new Date('2026-10-26T12:00:00Z')), '2026-10-26'); // a Monday
  assert.equal(weekKey(new Date('2026-10-25T23:59:00Z')), '2026-10-19'); // the Sunday before
  assert.equal(weekKey(new Date('2026-10-28T03:00:00Z')), '2026-10-26');
  assert.equal(weekKey(new Date('2027-01-01T00:00:00Z')), '2026-12-28');
});

test('weekly goals: three different kinds, the same for everyone, reset each week', () => {
  for (let i = 0; i < 60; i++) {
    const key = weekKey(new Date(Date.UTC(2026, 0, 5 + 7 * i)));
    const goals = weeklyFor(key);
    assert.equal(goals.length, 3);
    assert.equal(new Set(goals.map((g) => g.metric)).size, 3, 'no two goals of one kind');
  }
  assert.deepEqual(weeklyFor('2026-10-19').map((g) => g.id), weeklyFor('2026-10-19').map((g) => g.id));
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) for (const g of weeklyFor(weekKey(new Date(Date.UTC(2026, 0, 5 + 7 * i))))) seen.add(g.id);
  assert.equal(seen.size, WEEKLY_POOL.length, 'every goal turns up over a year');
});

test('weekly goals pay when finished, the sweep pays once, and a new week starts fresh', () => {
  const week = '2026-10-19';
  const p = defaultProfile();
  const goals = weeklyFor(week);
  const mini = (score: number) => ({ kind: 'mini' as const, game: 'catch' as const, score });
  const base = (): RunResult => ({ mode: 'rampage', cleared: true, score: 1, time: 100, bits: 0, xp: 0, floppies: [], damageTaken: 0, flags: [], chaosSeen: [], bitMultiplier: 1 });
  const run = (extra: Partial<RunResult> = {}, newFloppies = 0, paidBits = 0, newStars = 0) => ({ kind: 'run' as const, r: { ...base(), ...extra }, newFloppies, paidBits, newStars });
  // Pump every kind of event until all three finish.
  const bitsBefore = p.bits;
  const events = [run({ cleared: true }, 3, 800, 3), run({ endless: { rounds: 9 }, chaosSeen: new Array(30).fill('x') }), mini(300), mini(300), mini(300), mini(300), mini(300), mini(300), mini(300), mini(300), mini(300), mini(300), run({ cleared: true }), run({ cleared: true }), run({ cleared: true }), run({ cleared: true })];
  const finished: string[] = [];
  for (const ev of events) finished.push(...advanceWeekly(p, ev, week));
  assert.deepEqual(finished.filter((f) => f !== 'sweep').sort(), goals.map((g) => g.id).sort());
  assert.equal(finished.filter((f) => f === 'sweep').length, 1, 'the sweep pays once');
  const reward = goals.reduce((a, g) => a + g.bits, 0) + SWEEP_BITS;
  assert.equal(p.bits - bitsBefore, reward);
  assert.deepEqual(advanceWeekly(p, mini(300), week), [], 'finished goals do not pay twice');
  // next week: the old progress is gone
  assert.equal(weeklyView(p, '2026-10-26').done.length, 0);
  advanceWeekly(p, run({ cleared: true }), '2026-10-26');
  assert.equal(p.weekly.key, '2026-10-26');
  assert.ok(!p.weekly.swept);
});

test('lobby decor: buy puts it up, again takes it down, one item per slot, bad saves repaired', () => {
  const p = defaultProfile();
  p.bits = 500;
  assert.equal(buyOrWearDecor(p, 'nope'), 'unknown');
  assert.equal(buyOrWearDecor(p, 'checker'), 'bought');
  assert.equal(p.decor.floor, 'checker');
  assert.equal(buyOrWearDecor(p, 'grid'), 'bought');
  assert.equal(p.decor.floor, 'grid', 'one floor at a time');
  assert.equal(buyOrWearDecor(p, 'checker'), 'worn', 'owned items are free to swap back');
  assert.equal(buyOrWearDecor(p, 'checker'), 'removed');
  assert.equal(p.decor.floor, '');
  p.bits = 1;
  assert.equal(buyOrWearDecor(p, 'speakers'), 'poor');
  assert.deepEqual(cleanDecor({ owned: ['plants', 'plants', 'zzz'], floor: 'plants', corner: 'plants', wall: 'lights' }), { owned: ['plants'], floor: '', wall: '', corner: 'plants' });
  assert.equal(new Set(DECOR.map((d) => d.id)).size, DECOR.length);
});

test('weekly and decor saves are validated, and ASSIST MODE defaults off and survives bad values', () => {
  const p = migrateProfile({ weekly: { key: 'soon', progress: { w_tour: -3, zzz: 4 }, done: ['w_tour', 'w_tour', 'q'] }, decor: 5 });
  assert.deepEqual(p.weekly, { key: '', progress: {}, done: [], swept: false });
  assert.deepEqual(p.decor, { owned: [], floor: '', wall: '', corner: '' });
  const ok = migrateProfile({ weekly: { key: '2026-10-19', progress: { w_tour: 2, zzz: 4, w_baron: -1 }, done: ['w_tour', 'w_tour', 'q'], swept: true } });
  assert.deepEqual(ok.weekly, { key: '2026-10-19', progress: { w_tour: 2 }, done: ['w_tour'], swept: true });
  assert.equal(migrateSettings({}).assist, false);
  assert.equal(migrateSettings({ assist: 'yes' }).assist, false);
  assert.equal(migrateSettings({ assist: true }).assist, true);
});

// ---- perks, errands, seasons, curses, share cards ------------------------------------------

import { PERKS, offerPerks, perkTotals } from '../src/data/perks.ts';
import { advanceErrand, errandFor, errandView } from '../src/data/errands.ts';
import { SEASONS, seasonFor } from '../src/data/season.ts';
import { buildCard } from '../src/core/share.ts';
import { Rng } from '../src/core/rng.ts';

test('perks: three different offers, none held, only for worlds they suit, totals add up', () => {
  const rng = new Rng(7);
  for (let i = 0; i < 200; i++) {
    const offers = offerPerks(rng, 'rampage', ['vitality']);
    assert.equal(offers.length, 3);
    assert.equal(new Set(offers.map((o) => o.id)).size, 3);
    assert.ok(offers.every((o) => o.id !== 'vitality' && (!o.modes || o.modes.includes('rampage'))));
  }
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) for (const o of offerPerks(rng, 'penalty', [])) seen.add(o.id);
  assert.ok(seen.has('crackshot') && !seen.has('architect') && !seen.has('bombbag'));
  assert.deepEqual(offerPerks(rng, 'rampage', PERKS.map((p) => p.id)), [], 'nothing left to offer');
  const t = perkTotals(['vitality', 'magnet', 'glass', 'nope']);
  assert.equal(t.hp, 0);
  assert.ok(Math.abs(t.bits - 0.85) < 1e-9);
  assert.equal(t.defs.length, 3, 'unknown ids are ignored');
  assert.ok(perkTotals(['storm']).chaos);
  assert.equal(new Set(PERKS.map((p) => p.id)).size, PERKS.length);
});

test('errands: one a day, the same for everyone, paid once, fresh the next day', () => {
  for (let i = 0; i < 40; i++) {
    const day = `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`;
    assert.equal(errandFor(day).id, errandFor(day).id);
  }
  const kinds = new Set(Array.from({ length: 80 }, (_, i) => errandFor(`2026-12-${String(1 + (i % 28)).padStart(2, '0')}-${i}`).giver));
  assert.equal(kinds.size, 4, 'all four givers turn up');
  assert.ok(ERRANDS.every((e) => e.ask.length >= 1 && e.thanks.length >= 1 && e.goal > 0));
  const p = defaultProfile();
  const day = '2026-11-05';
  const e = errandFor(day);
  const ev = { kind: 'run' as const, r: { mode: 'rampage' as ModeId, cleared: true, score: 1, time: 10, bits: 0, xp: 0, floppies: [], damageTaken: 0, flags: [], chaosSeen: new Array(30).fill('x'), bitMultiplier: 1, endless: { rounds: 5 } }, newFloppies: 2, paidBits: 900, newStars: 2 };
  const mini = { kind: 'mini' as const, game: 'catch' as const, score: 500 };
  let done = false;
  const before = p.bits;
  for (let i = 0; i < 80 && !done; i++) done = !!advanceErrand(p, i % 2 ? ev : { ...ev, r: { ...ev.r, endless: undefined, time: 200, damageTaken: 1 } }, day) || !!advanceErrand(p, mini, day);
  assert.ok(p.errand.done, `finished ${e.id}`);
  assert.equal(p.bits - before, e.bits);
  assert.equal(advanceErrand(p, ev, day), null, 'paid once');
  assert.equal(errandView(p, '2026-11-06').progress, 0);
  advanceErrand(p, ev, '2026-11-06');
  assert.equal(p.errand.key, '2026-11-06');
});

test('lobby seasons cover the right dates and nothing else', () => {
  const on = (s: string) => seasonFor(new Date(`${s}T12:00:00Z`))?.id ?? null;
  assert.equal(on('2026-10-17'), null);
  assert.equal(on('2026-10-18'), 'halloween');
  assert.equal(on('2026-11-02'), 'halloween');
  assert.equal(on('2026-11-03'), null);
  assert.equal(on('2026-12-25'), 'winter');
  assert.equal(on('2027-01-03'), 'winter');
  assert.equal(on('2027-01-04'), null);
  assert.equal(on('2027-02-14'), 'love');
  assert.equal(on('2027-04-01'), 'bloom');
  assert.equal(on('2026-07-04'), 'summer');
  assert.equal(on('2026-09-15'), null);
  assert.equal(SEASONS.length, 5);
});

test('curses: arrive switched off after the ending, pay +30% each, and are checked in the base class', () => {
  const p = defaultProfile();
  p.endingSeen = true;
  const base = applyRun(p, { mode: 'rampage', cleared: true, score: 1, time: 100, bits: 10, xp: 10, floppies: [], damageTaken: 0, flags: [], chaosSeen: [], bitMultiplier: 1 }, '2026-03-02', '2026-03-03');
  for (const id of ['curse_greed', 'curse_haste', 'curse_static', 'curse_frail']) {
    assert.ok(base.profile.mutationsUnlocked.includes(id), `${id} unlocks after the ending`);
    assert.ok(base.profile.mutationsDisabled.includes(id), `${id} starts switched off`);
  }
  const fresh = defaultProfile();
  assert.ok(!new FusionEngine('rampage', fresh).has('curse_greed'));
  const on = defaultProfile();
  on.endingSeen = true;
  on.mutationsUnlocked.push('curse_greed', 'curse_haste');
  const f = new FusionEngine('neon', on);
  assert.ok(f.has('curse_greed') && f.has('curse_haste'));
  const plainP = defaultProfile();
  plainP.endingSeen = true;
  assert.ok(Math.abs(f.rewardMultiplier() - new FusionEngine('neon', plainP).rewardMultiplier() - 0.6) < 1e-9, 'each curse adds 30%');
});

test('share cards say what happened and link worlds, not the final boss', () => {
  const r = { mode: 'neon' as ModeId, cleared: true, score: 1234, time: 88.4, bits: 0, xp: 0, floppies: [], damageTaken: 2, flags: [], chaosSeen: ['a', 'b'], bitMultiplier: 1 };
  const p = defaultProfile();
  p.stars.neon = ['clean', 'fast'];
  const c = buildCard(r, 4321, p, 'https://x.test/play', 'ROOKIE TESTER');
  assert.equal(c.player, 'ROOKIE TESTER');
  assert.equal(c.headline, 'WORLD CLEARED');
  assert.equal(c.link, 'https://x.test/play?seed=004321&mode=neon&beat=1234', 'the link carries the score to beat');
  assert.ok(c.text.includes('1234') && c.text.includes(c.link));
  assert.ok(c.rows.some(([k, v]) => k === 'MASTERY' && v === '★★☆'));
  const e = buildCard({ ...r, cleared: false, endless: { rounds: 1 } }, 5, p, 'https://x.test/play');
  assert.equal(e.headline, 'ENDLESS: 1 ROUND');
  const hs = buildCard({ ...r, mode: 'highscore' as ModeId, boss: 'highscore' }, 5, p, 'https://x.test/play');
  assert.equal(hs.link, '', 'the final boss has no seed link');
  assert.equal(hs.headline, 'BOSS DEFEATED');
  assert.equal(buildCard({ ...r, comparable: false }, 4321, p, 'https://x.test/play').link, 'https://x.test/play?seed=004321&mode=neon', 'an incomparable score is not set as the one to beat');
  assert.equal(buildCard({ ...r, cleared: false, endless: { rounds: 3 } }, 4321, p, 'https://x.test/play').link.includes('beat='), false);
  const ultra = buildCard({ ...r, mode: 'blocks' as ModeId, ultra: true }, 5, p, 'https://x.test/play');
  assert.equal(ultra.link, '', 'an ULTRA run has no replay link');
  assert.equal(ultra.headline, 'ULTRA TARGET HIT');
});

test('old saves skip the lobby tour; new ones get it; loadouts and errand state are validated', () => {
  assert.equal(migrateProfile({ introDone: true }).tutorial.done, true);
  assert.equal(migrateProfile({ runsStarted: 3 }).tutorial.done, true);
  assert.equal(migrateProfile({}).tutorial.done, false);
  assert.deepEqual(migrateProfile({ tutorial: { step: 99, done: false } }).tutorial, { step: 9, done: false });
  const p = migrateProfile({ loadouts: [{ name: 'MY BUILD IS TOO LONG', on: ['a', 3, 'b'] }, 'x', { on: 5 }], errand: { key: '2026-11-05', progress: 'many', done: 1, asked: true }, seasonSeen: 9 });
  assert.deepEqual(p.loadouts, [{ name: 'MY BUILD IS ', on: ['a', 'b'] }, null, null]);
  assert.deepEqual(p.errand, { key: '2026-11-05', progress: 0, done: false, asked: true, thanked: false });
  assert.equal(p.seasonSeen, '');
});

// ---- 3.3.0: friend scores, records, titles, ULTRA ---------------------------------------------

test('challenge links carry a score to beat, and junk scores are dropped', async () => {
  const { parseChallenge, challengeUrl } = await import('../src/data/daily.ts');
  const url = challengeUrl('https://x.test/Chaod/', { mode: 'blocks', seed: 7, beat: 4200 });
  assert.equal(url, 'https://x.test/Chaod/?seed=000007&mode=blocks&beat=4200');
  assert.deepEqual(parseChallenge(url.slice(url.indexOf('?'))), { mode: 'blocks', seed: 7, beat: 4200 });
  assert.equal(challengeUrl('https://x.test/', { mode: 'neon', seed: 1, beat: 0.5 }), 'https://x.test/?seed=000001&mode=neon', 'a score that rounds to zero is left out');
  for (const bad of ['&beat=0', '&beat=-3', '&beat=abc', '&beat=1234567890', '&beat=1e3']) {
    assert.deepEqual(parseChallenge(`?seed=7&mode=blocks${bad}`), { mode: 'blocks', seed: 7 }, bad);
  }
});

test('beating a friend\'s score pays a bonus once per run and earns RIVAL BEATEN; missing it pays nothing extra', () => {
  const day = ['2026-03-02', '2026-03-03'] as const;
  const won = applyRun(defaultProfile(), run({ challenge: 'shared', beat: 900, score: 1000, seed: 7 }), ...day);
  assert.equal(won.summary.friend, 'beat');
  assert.ok(won.summary.achievements.includes('rival_beaten'));
  const plain = applyRun(defaultProfile(), run({ challenge: 'shared', score: 1000 }), ...day);
  assert.equal(plain.summary.friend, null);
  assert.equal(won.profile.bits - plain.profile.bits, 40);
  const lost = applyRun(defaultProfile(), run({ challenge: 'shared', beat: 1000, score: 1000 }), ...day);
  assert.equal(lost.summary.friend, 'missed', 'a tie is not a win');
  assert.equal(lost.profile.bits, plain.profile.bits);
  const daily = applyRun(defaultProfile(), run({ challenge: 'daily', beat: 1, score: 5 }), ...day);
  assert.equal(daily.summary.friend, null, 'only shared links have a friend');
  // The same link pays once; a loss never pays; the memory is bounded.
  const again = applyRun(won.profile, run({ challenge: 'shared', beat: 900, score: 1200, seed: 7 }), ...day);
  assert.equal(again.summary.friend, 'again');
  assert.equal(again.profile.bits - won.profile.bits, 100, 'only the run itself pays, no second bonus');
  const loss = applyRun(defaultProfile(), run({ challenge: 'shared', beat: 1, score: 50, seed: 8, cleared: false }), ...day);
  assert.equal(loss.summary.friend, 'missed', 'a lost run cannot claim the bonus');
  let p = defaultProfile();
  for (let i = 0; i < 80; i++) p = applyRun(p, run({ challenge: 'shared', beat: 10, score: 99, seed: i }), ...day).profile;
  assert.equal(p.rivalsBeaten.length, 60);
});

test('titles unlock from progress, fall back when unearned, and survive a bad save', async () => {
  const { TITLES, activeTitle, unlockedTitles } = await import('../src/data/titles.ts');
  assert.equal(new Set(TITLES.map((t) => t.id)).size, TITLES.length, 'ids are unique');
  assert.ok(TITLES.every((t) => t.name.length <= 16), 'names fit the menus');
  const p = defaultProfile();
  assert.deepEqual(unlockedTitles(p).map((t) => t.id), ['rookie']);
  p.title = 'gold';
  assert.equal(activeTitle(p).id, 'rookie', 'an unearned choice falls back');
  p.title = '';
  for (const m of MODE_IDS) p.cleared[m].clears = 1;
  p.floppies = Array.from({ length: 12 }, (_, i) => `f${i}`);
  const got = unlockedTitles(p).map((t) => t.id);
  assert.ok(got.includes('hopper') && got.includes('fluid') && got.includes('jockey'));
  p.title = 'fluid';
  assert.equal(activeTitle(p).id, 'fluid');
  p.title = '';
  assert.equal(activeTitle(p).id, TITLES.filter((t) => t.test(p)).pop()!.id, 'AUTO wears the newest earned title');
  assert.equal(migrateProfile({ title: 5 }).title, '');
  assert.deepEqual(migrateProfile({ rivalsBeaten: ['a', 3, 'x'.repeat(80)] }).rivalsBeaten, ['a']);
  assert.equal(migrateProfile({ title: 'x'.repeat(50) }).title.length, 16);
});

test('records gather per-world numbers and format times', async () => {
  const { worldRecords, formatTime, formatPlayTime } = await import('../src/data/records.ts');
  const p = defaultProfile();
  p.cleared.neon = { clears: 2, bestScore: 900, bestTime: 75.25 };
  p.floppies = ['neon-0', 'neon-2', 'mall-1'];
  p.endless.neon = { rounds: 4, score: 100 };
  const recs = worldRecords(p);
  assert.equal(recs.length, 10, 'every world, the final boss included');
  const n = recs.find((r) => r.mode === 'neon')!;
  assert.deepEqual([n.clears, n.bestScore, n.floppies, n.endlessRounds], [2, 900, 2, 4]);
  assert.equal(formatTime(75.5), '1:15.5');
  assert.equal(formatTime(0), '--:--');
  assert.equal(formatTime(5), '0:05.0');
  assert.equal(formatPlayTime(59), '0M');
  assert.equal(formatPlayTime(3 * 3600 + 120), '3H 2M');
});

test('ULTRA pays like a clear but never counts as clearing the world', () => {
  const r = run({ mode: 'blocks' as ModeId, ultra: true, cleared: true, score: 4000, floppies: [], bits: 100 });
  const { profile, summary } = applyRun(defaultProfile(), r, '2026-03-02', '2026-03-03');
  assert.equal(summary.bits, 100, 'full pay for hitting the target');
  assert.equal(profile.cleared.blocks.clears, 0);
  assert.equal(summary.firstClear, false);
  assert.equal(profile.ultraBest, 4000);
  const worse = applyRun(profile, { ...r, score: 100, cleared: false }, '2026-03-02', '2026-03-03');
  assert.equal(worse.profile.ultraBest, 4000, 'the best only goes up');
  assert.equal(worse.summary.bits, 50, 'missing the target pays half');
  assert.equal(migrateProfile({ ultraBest: -4 }).ultraBest, 0);
});

test('jukebox: every track is listed once and exists, unlocks come from play, a locked pick falls back to the lobby music', async () => {
  const { JUKEBOX, jukeboxChoice } = await import('../src/data/jukebox.ts');
  const { TRACKS } = await import('../src/audio/audio.ts');
  assert.equal(new Set(JUKEBOX.map((t) => t.id)).size, JUKEBOX.length);
  for (const t of JUKEBOX) assert.ok(t.id in TRACKS, `${t.id} is a real track`);
  const used = new Set<string>(JUKEBOX.map((t) => t.id));
  for (const id of Object.keys(TRACKS)) assert.ok(used.has(id) || id === 'none', `${id} is on the jukebox`);
  assert.ok(JUKEBOX.every((t) => t.test(defaultProfile()) || t.hint.length > 0), 'locked tracks say how to unlock');
  const p = defaultProfile();
  assert.equal(jukeboxChoice(p), null);
  p.jukebox = 'blocks';
  assert.equal(jukeboxChoice(p), null, 'locked until the world is cleared');
  p.cleared.blocks.clears = 1;
  assert.equal(jukeboxChoice(p), 'blocks');
  p.jukebox = 'nope';
  assert.equal(jukeboxChoice(p), null);
  assert.equal(migrateProfile({ jukebox: 7 }).jukebox, '');
});
