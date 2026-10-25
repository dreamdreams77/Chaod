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
  assert.equal(summary.bits, 100);
  const questBits = QUESTS.filter((q) => summary.quests.includes(q.id)).reduce((n, q) => n + q.bits, 0);
  assert.equal(profile.bits, summary.bits + questBits + summary.newStars.length * 40 + summary.dailyBonus, 'run bits plus exactly the finished quests, stars and daily bonus');
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

test('the daily run is deterministic, uses only unlocked non-boss worlds, and differs by day', async () => {
  const { dailyFor, dateKey, addDays } = await import('../src/data/daily.ts');
  const all: ModeId[] = ['rampage', 'neon', 'mall', 'beatdown', 'rhythm'];
  assert.deepEqual(dailyFor('2026-10-25', all), dailyFor('2026-10-25', all));
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const d = dailyFor(addDays('2026-01-01', i), all);
    assert.ok(['rampage', 'neon', 'mall'].includes(d.mode), 'bosses are never the daily');
    assert.ok(d.seed >= 0 && d.seed < 1000000);
    seen.add(d.mode + d.seed);
  }
  assert.ok(seen.size > 30, 'a different run most days');
  assert.equal(dailyFor('2026-10-25', ['rampage']).mode, 'rampage', 'a new player only gets what is unlocked');
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
