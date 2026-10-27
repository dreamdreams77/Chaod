/**
 * Runs the real RampageMode simulation headlessly (no canvas) to confirm the
 * level validator's jump assumptions match the actual player physics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RampageMode } from '../src/modes/rampage.ts';
import { NeonMode } from '../src/modes/neon.ts';
import { MAX_JUMP_DX, MAX_JUMP_RISE, TILE, ROWS } from '../src/procgen/rampage.ts';
import { defaultProfile, defaultSettings, type ModeId } from '../src/core/save.ts';
import { Input, DEFAULT_BINDINGS } from '../src/core/input.ts';
import type { Game } from '../src/game.ts';

function fakeGame(): Game {
  const settings = defaultSettings();
  settings.chaos = 'off';
  const noop = () => {};
  return {
    newSeed: () => 4242,
    profile: defaultProfile(),
    settings,
    input: new Input(DEFAULT_BINDINGS),
    audio: { musicTime: () => 0, bpm: 120, sfx: noop, play: noop, shiftTo: noop, duck: noop },
    fx: { freeze: noop, shake: noop, flash: noop },
    toast: noop, announceAchievements: noop, genreShift: noop, startFatal: noop, drawKevinCameo: noop, music: noop,
  } as unknown as Game;
}

function flatWorld(m: RampageMode): void {
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < m.level.width; x++) m.tiles[y][x] = y >= 14 ? '#' : '.';
  m.enemies.length = 0;
  m.pickups.length = 0;
  m.level.shmup.startCol = 100000;
  m.px = 3 * TILE;
  m.py = 14 * TILE - m.ph;
  m.bannerT = 99;
}

const STEP = 1 / 60;

test('player jump reaches the heights and distances the level validator assumes', () => {
  const g = fakeGame();
  const m = new RampageMode(g);
  flatWorld(m);
  const inp = g.input;
  // Settle on the ground
  for (let i = 0; i < 30; i++) { inp.beginFrame(); m.update(STEP); inp.endFrame(); }
  assert.ok(m.onGround, 'player stands on flat ground');
  const groundY = m.py;
  // Run up, then jump while holding jump + right
  inp.setVirtual('right', true);
  for (let i = 0; i < 30; i++) { inp.beginFrame(); m.update(STEP); inp.endFrame(); }
  const x0 = m.px;
  inp.setVirtual('jump', true);
  let apex = groundY;
  let landedX = 0;
  for (let i = 0; i < 120; i++) {
    inp.beginFrame();
    m.update(STEP);
    inp.endFrame();
    apex = Math.min(apex, m.py);
    if (i > 5 && m.onGround) { landedX = m.px; break; }
  }
  const rise = (groundY - apex) / TILE;
  const dx = (landedX - x0) / TILE;
  assert.ok(rise >= MAX_JUMP_RISE + 0.3, `jump rise ${rise.toFixed(2)} tiles must exceed validator's ${MAX_JUMP_RISE}`);
  assert.ok(dx >= MAX_JUMP_DX + 0.3, `level jump distance ${dx.toFixed(2)} tiles must exceed validator's ${MAX_JUMP_DX}`);
});

test('player never falls through solid ground over a long idle', () => {
  const g = fakeGame();
  const m = new RampageMode(g);
  flatWorld(m);
  for (let i = 0; i < 600; i++) { g.input.beginFrame(); m.update(STEP); g.input.endFrame(); }
  assert.ok(m.onGround);
  assert.equal(m.py, 14 * TILE - m.ph);
});

// ---- NIGHTMARE mode and BOSS RUSH --------------------------------------------------------

import { BeatdownMode } from '../src/modes/beatdown.ts';
import { RhythmMode } from '../src/modes/rhythm.ts';

function spyGame() {
  const g = fakeGame() as unknown as Record<string, unknown>;
  const started: Array<[string, Record<string, unknown>]> = [];
  g.startMode = (m: string, o: Record<string, unknown>) => started.push([m, o]);
  g.goto = () => {};
  g.saveProfile = () => {};
  g.rng = { int: () => 1, next: () => 0.5, pick: <T,>(a: T[]) => a[0] };
  return { game: g as unknown as Game, started };
}

test('NIGHTMARE mode: one less heart, double damage, bits pay double, chaos forced high unless off', () => {
  const base = new RampageMode(fakeGame());
  const { game } = spyGame();
  game.settings.chaos = 'normal';
  const n = new RampageMode(game, { nightmare: true });
  assert.equal(n.modifier?.id, 'nightmare');
  assert.equal(n.takenMult, 2);
  assert.equal(n.damageMult, 1, 'nightmare changes what you take, not what you deal');
  assert.equal(n.stats.maxHp, base.stats.maxHp - 1);
  assert.equal(n.director['cfg'].intensity, 'high');
  const { game: off } = spyGame();
  off.settings.chaos = 'off';
  assert.equal(new RampageMode(off, { nightmare: true }).director['cfg'].intensity, 'off', 'the accessibility setting still wins');
});

test('BOSS RUSH hands health and the running tally from Bricklord to DJ Static and pays once at the end', () => {
  const { game, started } = spyGame();
  const b = new BeatdownMode(game, { rematch: true, rush: { leg: 1 } });
  b.hp = 2;
  b.runBits = 40;
  b.time = 55;
  b.finish(true, 1000, { boss: 'bricklord' });
  assert.equal(started.length, 1, 'no results screen between the legs');
  const [mode, opts] = started[0] as [string, { rush: { leg: number; carryHp: number; bits: number; time: number; score: number } }];
  assert.equal(mode, 'rhythm');
  assert.equal(opts.rush.leg, 2);
  assert.equal(opts.rush.carryHp, 2);
  assert.equal(opts.rush.bits, 40);
  assert.equal(opts.rush.score, 1000);

  const r = new RhythmMode(game, { rematch: true, rush: { leg: 2, carryHp: 2, bits: 40, xp: 50, time: 55, damage: 1, score: 1000 } });
  assert.equal(r.hp, 2, 'health carries over');
  r.runBits = 30;
  r.time = 70;
  r.finish(true, 800, { boss: 'static' });
  assert.equal(started.length, 1, 'the second leg goes to results, not another run');
  assert.ok(game.profile.achievements.includes('boss_rush'), 'RUSH HOUR unlocked');
  assert.equal(game.profile.cleared.rhythm.bestScore, 1800, 'scores add up');

  const { game: g2 } = spyGame();
  const lost = new BeatdownMode(g2, { rematch: true, rush: { leg: 1 } });
  lost.finish(false, 10, { boss: 'bricklord' });
  assert.equal(started.length, 1, 'a loss in leg 1 ends the rush with normal results');
  assert.ok(!g2.profile.achievements.includes('boss_rush'));
});

test('ENDLESS RUN chains rounds with a growing tally, scales difficulty, and pays out when you fall', () => {
  const { game, started } = spyGame();
  game.profile.cleared.rampage.clears = 1;
  const r1 = new RampageMode(game, { endless: { round: 1 } });
  assert.equal(r1.tier, 1);
  assert.equal(r1.takenMult, 1);
  r1.hp = 1;
  r1.runBits = 50;
  r1.time = 60;
  r1.finish(true, 400);
  assert.equal(started.length, 1, 'a cleared round starts the next, no results yet');
  const [mode, o] = started[0] as [string, { endless: { round: number; carryHp: number; bits: number; score: number; seed: number } }];
  assert.equal(mode, 'rampage');
  assert.equal(o.endless.round, 2);
  assert.equal(o.endless.carryHp, 2, 'one heart is patched up between rounds');
  assert.equal(o.endless.bits, 70, 'the round bonus is banked');
  assert.equal(o.endless.score, 500);
  assert.notEqual(o.endless.seed, r1.seed, 'each round is a fresh seed');

  const r5 = new RampageMode(game, { endless: { ...o.endless, round: 5 } });
  assert.equal(r5.hp, 2, 'health carries');
  assert.ok(r5.tier > 1.4 && r5.tier <= 2);
  assert.equal(r5.takenMult, 2, 'from round 5 damage taken doubles');
  assert.ok(r5.diffMult > new RampageMode(game).diffMult);

  const bitsBefore = game.profile.bits;
  r5.runBits = 10;
  r5.finish(false, 50);
  assert.equal(started.length, 1, 'a fall ends the run with results');
  assert.equal(game.profile.endless.rampage?.rounds, 4);
  assert.equal(game.profile.cleared.rampage.clears, 1, 'endless never counts as a clear');
  assert.ok(game.profile.bits > bitsBefore);
  assert.ok(game.profile.questProgress.endless_runner >= 1, 'NO FINISH LINE: survive 3 rounds');
  assert.ok(!game.profile.achievements.includes('endless5'));
});

test('ENDLESS RUN: bank early from the pause menu and survive five rounds for the achievement', () => {
  const { game } = spyGame();
  game.profile.cleared.neon.clears = 1;
  const n = new NeonMode(game, { endless: { round: 1 } });
  assert.equal(n.canBank(), false, 'nothing banked in round one');
  const n6 = new NeonMode(game, { endless: { round: 6, bits: 200, xp: 100, time: 300, score: 2500 } });
  assert.equal(n6.canBank(), true);
  n6.bank();
  assert.equal(game.profile.endless.neon?.rounds, 5);
  assert.ok(game.profile.achievements.includes('endless5'));
  assert.equal(new RampageMode(game).canBank(), false, 'a normal run has nothing to bank');
});

// ---- CORE COMMAND ------------------------------------------------------------------------

import { CommandMode, TOWERS, WAVES, towerStat, upgradeCost } from '../src/modes/command.ts';
import { CM_CELL, CM_TOP } from '../src/procgen/command.ts';

function commandGame(difficulty: 'easy' | 'normal' | 'hard' = 'normal') {
  const { game } = spyGame();
  game.settings.chaos = 'off';
  game.settings.difficulty = difficulty;
  (game as unknown as Record<string, unknown>).genreShift = () => {};
  (game as unknown as Record<string, unknown>).say = () => {};
  return game;
}

function playCommand(game: Game, smart: boolean): CommandMode {
  const m = new CommandMode(game);
  const cover = (cx: number, cy: number, range: number) => {
    const c = { x: cx * CM_CELL + CM_CELL / 2 + 2, y: CM_TOP + cy * CM_CELL + CM_CELL / 2 };
    return m.map.path.filter((p) => Math.hypot(p.x * CM_CELL + CM_CELL / 2 + 2 - c.x, CM_TOP + p.y * CM_CELL + CM_CELL / 2 - c.y) <= range).length;
  };
  for (let i = 0; i < 60 * 60 * 15 && m.phase !== 'won' && m.phase !== 'lost'; i++) {
    if (smart && m.phase === 'build' && i % 20 === 0) {
      for (let tries = 0; tries < 6; tries++) {
        m.selected = m.towers.length % 3 === 1 ? 1 : m.towers.length % 5 === 4 ? 2 : 0;
        const def = TOWERS[m.selected];
        if (m.cash < def.cost) {
          const up = m.towers.find((t) => t.level < 3 && m.cash >= upgradeCost(TOWERS.find((d) => d.id === t.kind)!, t.level));
          if (up) m.act(up.cx, up.cy);
          break;
        }
        let best: { x: number; y: number; s: number } | null = null;
        for (let y = 0; y < 7; y++) for (let x = 0; x < 17; x++) {
          if (!m.map.free[y][x] || m.towers.some((t) => t.cx === x && t.cy === y)) continue;
          const s = cover(x, y, towerStat(def, 1).range);
          if (!best || s > best.s) best = { x, y, s };
        }
        if (best) m.act(best.x, best.y);
      }
    }
    m.update(1 / 60);
    assert.ok(m.cash >= 0 && Number.isFinite(m.cash), 'cash never goes negative');
  }
  return m;
}

test('CORE COMMAND: building nothing loses, thoughtful placement wins, and the run always ends', () => {
  const idle = playCommand(commandGame(), false);
  assert.equal(idle.phase, 'lost', 'an undefended core falls');
  let wins = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const g = commandGame('easy');
    g.newSeed = () => seed * 7;
    const m = playCommand(g, true);
    assert.ok(m.phase === 'won' || m.phase === 'lost', 'ends within the time cap');
    if (m.phase === 'won') wins++;
  }
  assert.ok(wins >= 5, `smart placement wins easy runs (${wins}/6)`);
});

test('CORE COMMAND: placing, upgrading and selling follow the cash rules', () => {
  const m = new CommandMode(commandGame());
  const free = (() => { for (let y = 0; y < 7; y++) for (let x = 0; x < 17; x++) if (m.map.free[y][x]) return { x, y }; throw new Error('no free cell'); })();
  const road = m.map.path[3];
  m.selected = 0;
  m.act(road.x, road.y);
  assert.equal(m.towers.length, 0, 'cannot build on the road');
  const start = m.cash;
  m.act(free.x, free.y);
  assert.equal(m.towers.length, 1);
  assert.equal(m.cash, start - TOWERS[0].cost);
  m.cash = 0;
  m.act(free.x, free.y);
  assert.equal(m.towers[0].level, 1, 'no upgrade without the cash');
  m.cash = 500;
  m.act(free.x, free.y);
  assert.equal(m.towers[0].level, 2);
  assert.equal(m.cash, 500 - upgradeCost(TOWERS[0], 1));
  const spent = m.towers[0].spent;
  m.sellOrSend(free.x, free.y);
  assert.equal(m.towers.length, 0);
  assert.ok(m.cash >= 500 - upgradeCost(TOWERS[0], 1) + Math.floor(spent * 0.6) - 1, 'selling refunds 60% of the investment');
  assert.equal(WAVES.length, 8);
  assert.ok(towerStat(TOWERS[2], 3).dmg > towerStat(TOWERS[2], 1).dmg);
});

test('CORE COMMAND: a final leak that empties the core is a loss, never a win, and nightmare doubles leak damage', () => {
  const g = commandGame();
  const m = new CommandMode(g) as unknown as { phase: string; wave: number; hp: number; enemies: Array<Record<string, unknown>>; queue: unknown[]; update(dt: number): void; map: { path: unknown[] } };
  m.phase = 'wave';
  m.wave = 8;
  m.hp = 1;
  m.enemies.push({ kind: 'bug', pos: m.map.path.length, hp: 5, max: 5, slow: 0, fireCd: 9, hit: 0, x: 0, y: 0 });
  m.update(1 / 60);
  assert.equal(m.phase, 'lost');
  assert.ok(!g.profile.floppies.includes('command-2'), 'no win rewards were handed out');

  const n = new CommandMode(commandGame(), { nightmare: true }) as unknown as typeof m;
  n.phase = 'wave';
  n.wave = 2;
  const before = n.hp;
  n.enemies.push({ kind: 'bug', pos: n.map.path.length, hp: 5, max: 5, slow: 0, fireCd: 9, hit: 0, x: 0, y: 0 });
  n.update(1 / 60);
  assert.equal(before - n.hp, 2, 'a bug leak costs two hearts in NIGHTMARE mode');
});

// ---- PENALTY STORM -----------------------------------------------------------------------

import { PenaltyMode } from '../src/modes/penalty.ts';
import { GOAL as PGOAL, GOALS_TO_WIN } from '../src/procgen/pitch.ts';

function penaltyGame() {
  const g = commandGame();
  (g as unknown as Record<string, unknown>).say = () => {};
  return g;
}

/** Puts the match in play with the keeper parked at `keeperX`, the ball at the player's feet. */
function readyPenalty(game: Game, keeperX: number): PenaltyMode {
  const m = new PenaltyMode(game);
  m.phase = 'play';
  m.keeper.x = keeperX;
  m.keeper.state = 'recover';
  m.keeper.holdT = 99;
  m.px = 240;
  m.py = 220;
  return m;
}

function runFrames(m: PenaltyMode, n: number): void {
  for (let i = 0; i < n; i++) m.update(1 / 60);
}

test('PENALTY STORM: a shot at the keeper is saved, a shot into the open side is a goal', () => {
  const g = penaltyGame();
  const saved = readyPenalty(g, 240);
  runFrames(saved, 1); // ball to the player's feet
  saved.aimX = 0;
  saved.kick();
  assert.equal(saved.ball.state, 'flying');
  saved.keeper.state = 'recover'; // keeper does not move
  runFrames(saved, 120);
  assert.equal(saved.saves, 1, 'straight at the keeper is a save');
  assert.equal(saved.goals, 0);

  const g2 = penaltyGame();
  const scored = readyPenalty(g2, 190); // keeper on the left, shoot right
  scored.px = 300;
  runFrames(scored, 1);
  scored.aimX = 1;
  scored.kick();
  runFrames(scored, 120);
  assert.equal(scored.goals, 1);
  assert.equal(scored.phase, 'goal');
  assert.ok(scored.runBits >= 12, 'goals pay bits');
});

test('PENALTY STORM: a bullet hit costs a heart and knocks the ball loose; the hearts running out loses the match', () => {
  const g = penaltyGame();
  const m = readyPenalty(g, 240);
  runFrames(m, 1);
  const hp = m.hp;
  m.bullets.push({ x: m.px, y: m.py - 7, vx: 0, vy: 0, age: 0, hue: 0 });
  runFrames(m, 1);
  assert.equal(m.hp, hp - 1);
  assert.equal(m.ball.state, 'loose', 'the ball is knocked away');
  assert.ok(m.iframes > 1, 'a hit grants a moment of safety');
  m.bullets.push({ x: m.px, y: m.py - 7, vx: 0, vy: 0, age: 0, hue: 0 });
  runFrames(m, 1);
  assert.equal(m.hp, hp - 1, 'no second hit during the safety window');
  m.hp = 1;
  m.iframes = 0;
  m.bullets.push({ x: m.px, y: m.py - 7, vx: 0, vy: 0, age: 0, hue: 0 });
  runFrames(m, 1);
  assert.equal(m.phase, 'lost');
});

test('PENALTY STORM: SLAP SHOT clears bullets in the ball\'s path, and only while that mutation is on', () => {
  const clear = (disabled: boolean): number => {
    const g = penaltyGame();
    if (disabled) g.profile.mutationsDisabled.push('slap_shot');
    const m = readyPenalty(g, 240);
    runFrames(m, 1);
    m.aimX = 0;
    m.kick();
    m.keeper.state = 'recover';
    // a bullet sitting in the flight path, well ahead of the ball
    m.bullets.push({ x: m.ball.x + (m.aimTarget() - m.ball.x) * 0.3, y: m.ball.y + (PGOAL.line - m.ball.y) * 0.3, vx: 0, vy: 0, age: 0, hue: 1 });
    runFrames(m, 20);
    return m.bullets.length;
  };
  assert.equal(clear(false), 0, 'the shot smashes the bullet');
  assert.equal(clear(true), 1, 'without the mutation it passes through');
});

test('PENALTY STORM: six goals win the match with floppies and a HAT TRICK for three clean goals in a row', () => {
  const { game, started } = spyGame();
  game.settings.chaos = 'off';
  (game as unknown as Record<string, unknown>).say = () => {};
  const m = new PenaltyMode(game);
  m.phase = 'play';
  for (let i = 0; i < GOALS_TO_WIN; i++) {
    m.phase = 'play';
    m.ball.state = 'flying';
    m.ball.x = 240 + (i % 2 ? 60 : -60);
    m.ball.y = PGOAL.line;
    m.keeper.x = 240 + (i % 2 ? -60 : 60);
    m.update(1 / 60);
  }
  assert.equal(m.goals, GOALS_TO_WIN);
  assert.equal(m.phase, 'won');
  assert.ok(m.runFlags.has('hat_trick'));
  assert.equal(m.foundFloppies.length, 3);
  runFrames(m, 200);
  assert.equal(started.length, 0, 'the win goes to results, not another run');
  assert.ok(game.profile.cleared.penalty.clears === 1);
  assert.ok(game.profile.achievements.includes('hat_trick'));
});

test('PENALTY STORM unlocks after four cleared worlds and every procedural match is valid', async () => {
  const { isModeUnlocked } = await import('../src/data/story.ts');
  const p = defaultProfile();
  p.cleared.rampage.clears = 1;
  p.cleared.neon.clears = 1;
  p.cleared.mall.clears = 1;
  assert.equal(isModeUnlocked('penalty', p.cleared), false);
  p.cleared.beatdown.clears = 1;
  assert.equal(isModeUnlocked('penalty', p.cleared), true);
});

// ---- review fixes: chained runs and PENALTY STORM edge cases ----------------------------------

test('ENDLESS RUN adds every round to the tally, and a disk found in an earlier round is not paid for again', () => {
  const { game, started } = spyGame();
  game.profile.cleared.rampage.clears = 1;
  let m = new RampageMode(game, { endless: { round: 1 } });
  m.runBits = 100;
  m.time = 50;
  m.damageTaken = 3;
  m.collectFloppy(0);
  m.runFlags.add('kevin');
  m.finish(true, 100);
  for (let round = 2; round <= 3; round++) {
    const [, o] = started[started.length - 1] as [string, { endless: NonNullable<ConstructorParameters<typeof RampageMode>[1]>['endless'] }];
    m = new RampageMode(game, { endless: o.endless });
    assert.deepEqual(m.foundFloppies, ['rampage-0'], 'disks carry forward');
    assert.ok(m.runFlags.has('kevin'), 'flags carry forward');
    const bitsBefore = m.runBits;
    m.collectFloppy(0);
    const paid = m.runBits - bitsBefore;
    assert.ok(paid === 10 || paid === 20, `the same disk again pays only the backed-up bonus (BIT STORM may double it), got ${paid}`);
    m.runBits = 40;
    m.time = 30;
    m.finish(true, 50);
  }
  const [, last] = started[started.length - 1] as [string, { endless: { bits: number; time: number; damage: number; score: number } }];
  assert.ok(last.endless.bits >= 100 + 40 + 40, `all rounds count toward the haul (${last.endless.bits})`);
  assert.equal(last.endless.time, 50 + 30 + 30);
  assert.equal(last.endless.damage, 3);
  assert.ok(last.endless.score > 200);
  const r4 = new RampageMode(game, { endless: { ...last.endless, round: 4 } } as never);
  r4.runBits = 5;
  r4.finish(false, 10);
  assert.ok(game.profile.floppies.includes('rampage-0'), 'the disk from round one is paid out at the end');
});

test('PENALTY STORM: a shot in the air when the last heart goes never counts', () => {
  const g = penaltyGame();
  const m = readyPenalty(g, 100); // keeper far from the shot: it would be a goal
  runFrames(m, 1);
  m.px = 300;
  m.aimX = 1;
  m.kick();
  m.hp = 1;
  m.bullets.push({ x: m.px, y: m.py - 7, vx: 0, vy: 0, age: 0, hue: 0 });
  runFrames(m, 240);
  assert.equal(m.phase, 'lost');
  assert.equal(m.goals, 0);
  assert.ok(!g.profile.cleared.penalty.clears, 'no win handed out');
});

test('PENALTY STORM: the volleys are the same for a seed whatever the player does', () => {
  const volleys = (shoot: boolean): string => {
    const g = penaltyGame();
    const m = new PenaltyMode(g, { seed: 424242 });
    m.phase = 'play';
    for (let i = 0; i < 600; i++) {
      if (shoot && i % 50 === 25) { m.ball.state = 'carried'; m.kick(); }
      m.update(1 / 60);
      m.iframes = 99; // stay alive
    }
    return m.bullets.slice(0, 6).map((b) => b.vy.toFixed(1)).join(',');
  };
  assert.equal(volleys(false).split(',').length, volleys(true).split(',').length);
  // the same stream: the first emitted rain column positions are identical with and without kicks
  const first = (shoot: boolean): number => {
    const m = new PenaltyMode(penaltyGame(), { seed: 99 });
    m.phase = 'play';
    if (shoot) { m.ball.state = 'carried'; m.kick(); }
    for (let i = 0; i < 400 && m.bullets.length === 0; i++) { m.update(1 / 60); m.iframes = 99; }
    return Math.round(m.bullets[0]?.x ?? -1);
  };
  assert.equal(first(true), first(false));
});

test('ASSIST MODE adds a heart and slows the world a little, without touching rewards', () => {
  const plain = new RampageMode(spyGame().game);
  const { game } = spyGame();
  game.settings.assist = true;
  const a = new RampageMode(game);
  assert.equal(a.stats.maxHp, plain.stats.maxHp + 1);
  assert.equal(a.hp, plain.hp + 1);
  assert.ok(a.diffMult < plain.diffMult);
  assert.equal(a.damageMult, plain.damageMult);
});

// ---- THE HIGH SCORE, the gauntlet, perks and the secret dash -------------------------------

import { HighScoreMode } from '../src/modes/highscore.ts';
import { DashScene } from '../src/scenes/arcade.ts';
import { GAUNTLET_LEGS } from '../src/data/story.ts';
import { offerPerks } from '../src/data/perks.ts';
import { Rng } from '../src/core/rng.ts';

function bossGame() {
  const { game, started } = spyGame();
  game.settings.chaos = 'off';
  const g = game as unknown as Record<string, unknown>;
  g.genreShift = () => {};
  g.music = () => {};
  // The defeat scene resolves straight away with "set it free".
  g.say = (_lines: unknown, done?: (effects: string[]) => void) => done?.([]);
  return { game, started };
}

function readyBoss(game: Game, opts: ConstructorParameters<typeof HighScoreMode>[1] = {}): HighScoreMode {
  const m = new HighScoreMode(game, opts);
  m.phase = 'fight';
  return m;
}

test('THE HIGH SCORE: three phases at two thirds and one third, bombs clear the screen, guard and open change the damage', () => {
  const { game } = bossGame();
  const m = readyBoss(game);
  assert.equal(m.bossPhase, 0);
  assert.equal(m.shotDamage, 1);
  m.damageBoss(m.bMax * 0.35);
  assert.equal(m.bossPhase, 1, 'phase 2 below two thirds');
  assert.equal(m.phase, 'shift');
  assert.equal(m.shotDamage, 0.35, 'guarded');
  m.phase = 'fight';
  m.slam = 'open';
  assert.equal(m.shotDamage, 2.5, 'open takes it hard');
  m.damageBoss(m.bMax * 0.33);
  assert.equal(m.bossPhase, 2, 'phase 3 below one third');
  m.phase = 'fight';
  m.bullets.push({ x: 100, y: 100, vx: 0, vy: 0, hue: 0, grazed: false }, { x: 200, y: 120, vx: 0, vy: 0, hue: 1, grazed: false });
  const bombs = m.bombs;
  const hp = m.bHp;
  m.bomb();
  assert.equal(m.bombs, bombs - 1);
  assert.equal(m.bullets.length, 0);
  assert.ok(m.bHp < hp, 'a bomb hurts it');
  assert.ok(m.iframes > 1);
});

test('THE HIGH SCORE: grazing charges bombs, a hit costs a heart and sweeps nearby bullets, the last heart loses', () => {
  const { game } = bossGame();
  const m = readyBoss(game);
  m.iframes = 0;
  for (let i = 0; i < 46; i++) m.bullets.push({ x: m.px + 8, y: m.py - 6, vx: 0, vy: 0, hue: 0, grazed: false });
  m.bombs = 1;
  m.update(1 / 60);
  assert.equal(m.graze, 46);
  assert.equal(m.bombs, 2, '45 grazes earn a bomb');
  const hp = m.hp;
  m.bullets.push({ x: m.px, y: m.py - 6, vx: 0, vy: 0, hue: 0, grazed: false }, { x: m.px + 20, y: m.py, vx: 0, vy: 0, hue: 0, grazed: true });
  m.update(1 / 60);
  assert.equal(m.hp, hp - 1);
  assert.equal(m.bullets.filter((b) => Math.hypot(b.x - m.px, b.y - m.py) < 34).length, 0, 'the sweep clears the area');
  m.iframes = 0;
  m.hp = 1;
  m.bullets.push({ x: m.px, y: m.py - 6, vx: 0, vy: 0, hue: 0, grazed: false });
  m.update(1 / 60);
  assert.equal(m.phase, 'lost');
});

test('THE HIGH SCORE: beating it pays out once, records the Manual choice and unlocks its trophies', () => {
  const { game, started } = bossGame();
  game.profile.endingSeen = true;
  const m = readyBoss(game);
  m.damageBoss(m.bMax * 2);
  assert.equal(m.phase, 'dying');
  for (let i = 0; i < 300; i++) m.update(1 / 60);
  assert.equal(started.length, 0, 'a normal win goes to results');
  assert.equal(game.profile.bossChoices.highscore, 'mercy');
  assert.ok(game.profile.bossesDefeated.includes('highscore'));
  assert.equal(game.profile.cleared.highscore.clears, 1);
  assert.ok(game.profile.achievements.includes('boss_highscore'));
  assert.ok(game.profile.achievements.includes('perfect_score'), 'no damage taken');
});

test('the BOSS GAUNTLET chains four bosses, carries health and the tally, and pays double at the end', () => {
  const { game, started } = bossGame();
  const legs = GAUNTLET_LEGS;
  const b = new BeatdownMode(game, { rematch: true, rush: { leg: 1, legs } });
  b.hp = 3;
  b.runBits = 20;
  b.time = 30;
  b.finish(true, 100, { boss: 'bricklord' });
  let [mode, o] = started[0] as [string, { rush: { leg: number; legs: ModeId[]; carryHp: number; bits: number; score: number } }];
  assert.equal(mode, 'rhythm');
  assert.equal(o.rush.leg, 2);
  assert.equal(o.rush.carryHp, 3);
  const r = new RhythmMode(game, { rematch: true, rush: o.rush });
  r.runBits = 15;
  r.time = 40;
  r.finish(true, 200, { boss: 'static' });
  [mode, o] = started[1] as typeof started[0] & [string, typeof o];
  assert.equal(mode, 'penalty');
  assert.equal(o.rush.leg, 3);
  assert.equal(o.rush.bits, 35, 'bits add up across legs');
  assert.equal(o.rush.score, 300);
  const k = new PenaltyMode(game, { rematch: true, rush: o.rush });
  assert.ok(k.overtime);
  assert.equal(k.goalsNeeded, 4);
  k.runBits = 10;
  k.finish(true, 150);
  [mode, o] = started[2] as typeof started[0] & [string, typeof o];
  assert.equal(mode, 'highscore');
  assert.equal(o.rush.leg, 4);
  const h = new HighScoreMode(game, { rematch: true, rush: o.rush });
  assert.equal(h.hp, 3, 'health carried the whole way');
  h.runBits = 5;
  h.finish(true, 500, { boss: 'highscore' });
  assert.equal(started.length, 3, 'the last leg goes to results');
  assert.ok(game.profile.achievements.includes('gauntlet'));
  assert.ok(game.profile.cleared.highscore.bestScore >= 500 + 300 + 150);
});

test('run perks change the run: hearts, speed, bits and xp, and unknown perks are ignored', () => {
  const plain = new RampageMode(spyGame().game);
  const { game } = spyGame();
  const perked = new RampageMode(game, { perks: ['vitality', 'gentle', 'slowmo', 'bogus'] });
  assert.equal(perked.stats.maxHp, plain.stats.maxHp + 1);
  assert.ok(perked.diffMult < plain.diffMult);
  assert.ok(perked.speedMult < plain.speedMult);
  assert.ok(perked.hasPerk('gentle') && !perked.hasPerk('bogus'));
  const glass = new RampageMode(spyGame().game, { perks: ['glass', 'twin', 'glass'] });
  assert.ok(glass.stats.maxHp >= 2, 'never below two hearts');
  const rich = new RampageMode(game, { perks: ['jackpot'] });
  rich.runBits = 10;
  rich.finish(false, 5);
  assert.ok(game.profile.bits > 0);
});

test('DEMO DASH: hurdles cost lives, bones score, three hits end the run and pay out', () => {
  const { game } = spyGame();
  const d = new DashScene(game) as unknown as { update(dt: number): void; lives: number; bones: number; things: Array<{ x: number; kind: string; y: number; hit: boolean }>; over: boolean; score: number };
  d.things.push({ x: 90, kind: 'hurdle', y: H_GROUND(), hit: false });
  d.update(1 / 60);
  assert.equal(d.lives, 2);
  d.things.push({ x: 92, kind: 'bone', y: H_GROUND() - 10, hit: false });
  d.update(1 / 60);
  assert.equal(d.bones, 1);
  for (let i = 0; i < 2; i++) {
    (d as unknown as { hurtT: number }).hurtT = 0;
    d.things.push({ x: 90, kind: 'rock', y: H_GROUND(), hit: false });
    d.update(1 / 60);
  }
  assert.equal(d.lives, 0);
  assert.ok(d.over, 'the run ends');
  assert.ok(game.profile.mini.dash.plays === 1);
  assert.ok(game.profile.achievements.includes('secret_dash'));
});
function H_GROUND(): number {
  return 270 - 56;
}

// ---- fixes from the second big check --------------------------------------------------------

test('THE HIGH SCORE: the killing shot with others in flight leaves a clean shot list', () => {
  const { game } = bossGame();
  const m = readyBoss(game);
  m.bHp = 1;
  m.shots.push({ x: 40, y: 200 }, { x: 41, y: 200 }, { x: m.bx, y: m.by }, { x: 400, y: 150 });
  m.update(1 / 60);
  assert.equal(m.phase, 'dying');
  assert.ok(m.shots.every((s) => s && Number.isFinite(s.x)), 'no holes in the list');
});

test('a loss on a middle gauntlet leg still pays what the earlier legs earned', () => {
  const { game, started } = bossGame();
  const b = new BeatdownMode(game, { rematch: true, rush: { leg: 1, legs: GAUNTLET_LEGS } });
  b.runBits = 80;
  b.collectFloppy(0);
  b.finish(true, 100, { boss: 'bricklord' });
  const [, o] = started[0] as unknown as [string, { rush: NonNullable<ConstructorParameters<typeof BeatdownMode>[1]>['rush'] }];
  const r = new RhythmMode(game, { rematch: true, rush: o.rush });
  assert.ok(r.foundFloppies.includes('beatdown-0'), 'disks carry into the next leg');
  r.finish(false, 50);
  assert.ok(game.profile.floppies.includes('beatdown-0'), 'the disk from leg one is kept');
  assert.ok(game.profile.bits > 0);
  assert.equal(started.length, 1, 'a loss ends the run');
});

test('retrying the gauntlet starts with a fresh perk pick, not the old perks', () => {
  const { game } = bossGame();
  const restarts: Array<{ mode: string; opts: { perks?: string[]; rush?: { leg: number } } }> = [];
  (game as unknown as { startMode: (m: string, o: unknown, r: { mode: string; opts: { perks?: string[]; rush?: { leg: number } } }) => void }).startMode = (_m, _o, r) => restarts.push(r);
  const b = new BeatdownMode(game, { rematch: true, perks: ['vitality'], rush: { leg: 1, legs: GAUNTLET_LEGS } });
  b.finish(true, 10, { boss: 'bricklord' });
  assert.equal(restarts[0].mode, 'beatdown');
  assert.equal(restarts[0].opts.rush?.leg, 1);
  assert.equal(restarts[0].opts.perks, undefined);
});

test('damage taken doubles in NIGHTMARE in every kind of world, while damage dealt stays put', () => {
  const { game } = spyGame();
  game.settings.chaos = 'off';
  const m = new RampageMode(game, { nightmare: true }) as unknown as { hp: number; hurt(n: number, knock: boolean): void; takenMult: number; damageMult: number; iframes: number; dead: number };
  const hp = m.hp;
  m.iframes = 0;
  m.dead = 0;
  m.hurt(1, false);
  assert.equal(hp - m.hp, 2);
  assert.equal(m.damageMult, 1);
});

test('FIELD MEDIC is only offered in an ENDLESS RUN', () => {
  const rng = new Rng(3);
  const seen = (endless: boolean): boolean => {
    for (let i = 0; i < 300; i++) if (offerPerks(rng, 'rampage', [], endless).some((p) => p.id === 'medic')) return true;
    return false;
  };
  assert.equal(seen(false), false);
  assert.equal(seen(true), true);
});

// ---- BLOCK PARTY and BOLT BRIGADE ----------------------------------------------------------

import { BlocksMode } from '../src/modes/blocks.ts';
import { BoltMode } from '../src/modes/bolt.ts';
import { MallMode } from '../src/modes/mall.ts';
import { COLS as BLOCK_COLS, ROWS as BLOCK_ROWS } from '../src/procgen/blocks.ts';
import { MASTERS as BOLT_MASTERS_T, TILE as BOLT_TILE } from '../src/procgen/bolt.ts';

function blocksGame(difficulty: 'easy' | 'normal' | 'hard' = 'normal') {
  const { game, started } = spyGame();
  game.settings.chaos = 'off';
  game.settings.difficulty = difficulty;
  (game as unknown as Record<string, unknown>).say = () => {};
  return { game, started };
}

function blocksReady(game: Game): BlocksMode {
  const m = new BlocksMode(game);
  for (let i = 0; i < 160; i++) m.update(1 / 60);
  return m;
}

test('BLOCK PARTY: pieces move, rotate and hard-drop, the hold swaps once per piece, and a full row clears and scores', () => {
  const { game } = blocksGame();
  const m = blocksReady(game);
  assert.equal(m.phase, 'play');
  assert.ok(m.cur);
  const x0 = m.cur!.x;
  assert.ok(m.shift(-1));
  assert.equal(m.cur!.x, x0 - 1);
  const rot0 = m.cur!.rot;
  m.rotate(1);
  assert.notEqual(m.cur!.rot === rot0 && m.cur!.id !== 'O', true, 'rotation turns every piece but the O');
  const first = m.cur!.id;
  m.holdPiece();
  assert.equal(m.hold, first);
  const second = m.cur!.id;
  m.holdPiece();
  assert.equal(m.cur!.id, second, 'a second hold on the same piece does nothing');
  // set up a nearly full bottom row and drop an I flat to finish it
  for (let x = 0; x < BLOCK_COLS; x++) if (x > 3) m.board[BLOCK_ROWS - 1][x] = 8;
  m.cur = { id: 'I', rot: 0, x: 0, y: 0 };
  const score0 = m.score;
  m.hardDrop();
  assert.ok(m.score > score0, 'dropping scores');
  assert.equal(m.phase, 'clear');
  for (let i = 0; i < 40; i++) m.update(1 / 60);
  assert.equal(m.lines, 1);
  assert.equal(m.phase, 'play');
  assert.ok(m.board[BLOCK_ROWS - 1].every((c) => c === 0), 'the cleared row is gone');
});

test('BLOCK PARTY: reaching the line goal wins with all three disks; topping out costs a heart and clears the top', () => {
  const { game } = blocksGame();
  const m = blocksReady(game);
  m.lines = m.goal - 1;
  for (let x = 0; x < BLOCK_COLS; x++) if (x > 3) m.board[BLOCK_ROWS - 1][x] = 8;
  m.cur = { id: 'I', rot: 0, x: 0, y: 0 };
  m.hardDrop();
  for (let i = 0; i < 40; i++) m.update(1 / 60);
  assert.equal(m.phase, 'won');
  assert.equal(m.foundFloppies.length, 3);
  for (let i = 0; i < 200; i++) m.update(1 / 60);
  assert.ok(game.profile.cleared.blocks.clears === 1);

  const { game: g2 } = blocksGame();
  const t = blocksReady(g2);
  const hp = t.hp;
  for (let y = 0; y < BLOCK_ROWS; y++) for (let x = 0; x < BLOCK_COLS; x++) t.board[y][x] = x === 0 ? 0 : 8;
  t.topOut();
  assert.equal(t.hp, hp - 1);
  assert.ok(t.board[2].every((c) => c === 0), 'the top of the well is cleared');
  assert.equal(t.phase, 'play');
  t.hp = 1;
  t.topOut();
  assert.equal(t.phase, 'lost');
});

test('BLOCK PARTY ULTRA: a two-minute clock, no line goal, no disks; the target score decides win or loss', () => {
  const { game } = blocksGame();
  const m = new BlocksMode(game, { variant: 'ultra' });
  for (let i = 0; i < 160; i++) m.update(1 / 60);
  assert.equal(m.ultra, true);
  assert.equal(m.phase, 'play');
  const t0 = m.timeLeft;
  for (let i = 0; i < 60; i++) m.update(1 / 60);
  assert.ok(t0 - m.timeLeft > 0.9 && t0 - m.timeLeft < 1.1, 'the clock runs in real time');
  m.lines = 500;
  for (let x = 0; x < BLOCK_COLS; x++) if (x > 3) m.board[BLOCK_ROWS - 1][x] = 8;
  m.cur = { id: 'I', rot: 0, x: 0, y: 0 };
  m.hardDrop();
  for (let i = 0; i < 40; i++) m.update(1 / 60);
  assert.equal(m.phase, 'play', 'lines never win an ULTRA run');
  assert.equal(m.foundFloppies.length, 0, 'ULTRA collects no disks');
  m.score = m.ultraTarget;
  m.timeLeft = 0.01;
  for (let i = 0; i < 10; i++) m.update(1 / 60);
  assert.equal(m.phase, 'won');

  const { game: g2 } = blocksGame();
  const l = new BlocksMode(g2, { variant: 'ultra' });
  for (let i = 0; i < 160; i++) l.update(1 / 60);
  l.timeLeft = 0.01;
  for (let i = 0; i < 10; i++) l.update(1 / 60);
  assert.equal(l.phase, 'lost', 'time up under the target is a loss');
  for (let i = 0; i < 200; i++) l.update(1 / 60);
  assert.equal(g2.profile.cleared.blocks.clears, 0);

  // The clock keeps running through line-clear animations, and a top-out after the target still wins.
  const { game: g3 } = blocksGame();
  const c = new BlocksMode(g3, { variant: 'ultra' });
  for (let i = 0; i < 160; i++) c.update(1 / 60);
  for (let x = 0; x < BLOCK_COLS; x++) if (x > 3) c.board[BLOCK_ROWS - 1][x] = 8;
  c.cur = { id: 'I', rot: 0, x: 0, y: 0 };
  c.hardDrop();
  assert.equal(c.phase, 'clear');
  const before = c.timeLeft;
  c.update(0.1);
  assert.ok(before - c.timeLeft > 0.09, 'the clear animation does not pause the clock');
  c.score = c.ultraTarget;
  c.hp = 1;
  for (let i = 0; i < 40; i++) c.update(1 / 60);
  c.topOut();
  assert.equal(c.phase, 'won', 'out of hearts after hitting the target is still a win');
  for (let i = 0; i < 200; i++) c.update(1 / 60);
  assert.equal(g3.profile.cleared.blocks.clears, 0);
});

test('BLOCK PARTY: BOMB BLOCKS blasts around where it lands, and only with the mutation on', () => {
  const blast = (disabled: boolean): number => {
    const { game } = blocksGame();
    if (disabled) game.profile.mutationsDisabled.push('bomb_pieces');
    const m = blocksReady(game);
    for (let y = BLOCK_ROWS - 3; y < BLOCK_ROWS; y++) for (let x = 0; x < BLOCK_COLS; x++) m.board[y][x] = x === 9 ? 0 : 8;
    m.pieces = 8;
    m.cur = { id: 'O', rot: 0, x: 2, y: 0, bomb: !disabled };
    m.hardDrop();
    return m.board.flat().filter((c) => c === 8).length;
  };
  assert.ok(blast(false) < blast(true), 'the bomb removes blocks');
});

test('BOLT BRIGADE: a master falls to its weakness, weapons come from beaten masters, the fortress opens after all four', () => {
  const { game, started } = bossGame();
  const b = new BoltMode(game, { seed: 4242 });
  assert.deepEqual(b.ownedWeapons, ['buster']);
  assert.equal(b.fortressOpen, false);
  const flare = BOLT_MASTERS_T.find((m) => m.id === 'flarebot')!;
  b.begin(flare, false);
  (b as unknown as { startBoss(): void }).startBoss();
  b.update(1 / 60);
  for (let i = 0; i < 130; i++) b.update(1 / 60);
  assert.equal(b.phase, 'boss');
  const boss = b.boss!;
  const hp0 = boss.hp;
  b.damageFoe(boss, 1, 'buster');
  const buster = hp0 - boss.hp;
  boss.flash = 0;
  b.damageFoe(boss, 1, 'ice');
  assert.equal(hp0 - boss.hp - buster, 3, 'ice is three times as good against FLAREBOT');
  boss.hp = 0.5;
  boss.flash = 0;
  b.damageFoe(boss, 5, 'buster');
  assert.equal(b.phase, 'dying');
  for (let i = 0; i < 400; i++) b.update(1 / 60);
  assert.ok(game.profile.bossesDefeated.includes('flarebot'), 'beating a master is remembered');
  assert.equal(started.length, 0);
  const again = new BoltMode(game, { seed: 4243 });
  assert.deepEqual(again.ownedWeapons, ['buster', 'flame']);
  for (const m of BOLT_MASTERS_T) if (!game.profile.bossesDefeated.includes(m.id)) game.profile.bossesDefeated.push(m.id);
  assert.equal(new BoltMode(game, { seed: 1 }).fortressOpen, true);
});

test('BOLT BRIGADE: a simple bot runs, jumps and shoots its way through every stage to the boss door', () => {
  const { game } = bossGame();
  for (const master of BOLT_MASTERS_T) {
    const b = new BoltMode(game, { seed: 99 });
    b.begin(master, false);
    const inp = game.input;
    let got = false;
    for (let i = 0; i < 60 * 70 && b.phase === 'run'; i++) {
      inp.beginFrame();
      inp.setVirtual('right', true);
      const ahead = Math.floor((b.px + 12) / BOLT_TILE);
      const pit = !(b as unknown as { solid(x: number, y: number): boolean }).solid(ahead, Math.floor((b.py + 2) / BOLT_TILE));
      const wall = (b as unknown as { solid(x: number, y: number): boolean }).solid(Math.floor((b.px + 14) / BOLT_TILE), Math.floor((b.py - 6) / BOLT_TILE));
      const haz = b.hazards.some((h) => h.kind !== 'jet' && Math.abs(h.x * BOLT_TILE + 8 - (b.px + 20)) < 22 && Math.abs(h.y * BOLT_TILE - b.py) < 20);
      inp.setVirtual('jump', (b.onGround && (pit || wall || haz)) || (!b.onGround && b.vy < 0));
      inp.setVirtual('attack', i % 10 === 0);
      b.iframes = 99;
      b.update(1 / 60);
      inp.endFrame();
      if (b.kills > 0) got = true;
    }
    inp.setVirtual('right', false);
    inp.setVirtual('jump', false);
    assert.ok(b.phase === 'bossIntro' || b.phase === 'boss', `${master.id}: the bot reaches the boss door alive (${b.phase})`);
    assert.ok(got, `${master.id}: shooting kills something on the way`);
  }
});

test('BOLT BRIGADE: falling in a pit costs a heart and puts you back on safe ground; the rain attack really drops six shots', () => {
  const { game } = bossGame();
  const b = new BoltMode(game, { seed: 5 });
  b.begin(BOLT_MASTERS_T[1], false);
  const hp = b.hp;
  b.py = 20 * BOLT_TILE;
  b.update(1 / 60);
  assert.equal(b.hp, hp - 1);
  assert.ok(b.py < 15 * BOLT_TILE, 'back on the ground');
  // six rain drops survive their first frame
  const c = new BoltMode(game, { seed: 6 });
  c.begin(BOLT_MASTERS_T[1], false);
  (c as unknown as { startBoss(): void }).startBoss();
  for (let i = 0; i < 130; i++) c.update(1 / 60);
  (c as unknown as { runAttack(a: string, sk: number): void }).runAttack('rain', 1);
  c.update(1 / 60);
  assert.equal(c.shots.filter((s) => !s.friendly).length, 6);
});

test('BOLT BRIGADE: the select screen costs no time, damage dealt follows GLASS CANNON, and stages differ between masters on one seed', () => {
  const { game } = bossGame();
  const b = new BoltMode(game, { seed: 77 });
  for (let i = 0; i < 300; i++) b.update(1 / 60);
  assert.equal(b.time, 0, 'browsing the stage cards does not run the clock');
  let same = 0;
  for (let s = 1; s <= 40; s++) {
    const x = new BoltMode(game, { seed: s * 101 });
    x.begin(BOLT_MASTERS_T[0], false);
    const y = new BoltMode(game, { seed: s * 101 });
    y.begin(BOLT_MASTERS_T[1], false);
    if (JSON.stringify(x.level.ground) === JSON.stringify(y.level.ground)) same++;
  }
  assert.ok(same <= 2, `FROSTBYTE and FLAREBOT stages are almost never alike (${same}/40)`);
});

test('BLOCK PARTY: a touch that starts between pieces does not drag the next piece to the wall, holding keeps the bomb, gentle perks slow the fall', () => {
  const { game } = blocksGame();
  const m = blocksReady(game);
  const piece = m.cur!;
  m.tap(240, 100);
  m.drag(241, 100);
  assert.equal(m.cur!.x, piece.x, 'a one-pixel wobble moves nothing');
  m.hardDrop();
  for (let i = 0; i < 40; i++) m.update(1 / 60);
  const x = m.cur?.x ?? 3;
  m.drag(242, 100);
  assert.ok(Math.abs((m.cur?.x ?? 3) - x) <= 1, 'the new piece is anchored where the finger is');
  m.dragEnd();

  const { game: g2 } = blocksGame();
  const h = blocksReady(g2);
  h.cur = { id: 'T', rot: 0, x: 3, y: 0, bomb: true };
  h.holdPiece();
  const bomb = h.cur!.bomb;
  assert.equal(bomb, false, 'the replacement is a normal piece');
  const swap = (h as unknown as { holdBomb: boolean }).holdBomb;
  assert.equal(swap, true, 'the bomb waits in the hold');

  const plain = blocksReady(blocksGame().game);
  const { game: g3 } = blocksGame();
  const gentle = new BlocksMode(g3, { perks: ['gentle'] });
  for (let i = 0; i < 160; i++) gentle.update(1 / 60);
  const fall = (x: BlocksMode) => (x as unknown as { fallInterval: number }).fallInterval;
  assert.ok(fall(gentle) > fall(plain), 'GENTLE WORLD slows the fall');
});

test('only the two story bosses count as Core shards, whatever else is in the list', async () => {
  const { manualLines } = await import('../src/data/story.ts');
  const text = (bosses: string[]) => manualLines({ clears: 3, bosses, floppies: 0, trust: 0, ending: false }).map((l) => l.text).join(' ');
  assert.ok(!text(['frostbyte', 'flarebot', 'highscore']).includes('Both shards'));
  assert.ok(text(['bricklord', 'frostbyte']).includes('One CORE SHARD'));
  assert.ok(text(['bricklord', 'static']).includes('Both shards'));
});

test('NIGHTMARE MALL: keycards you pass are remembered on the map, and the flashlight lasts longer than before', () => {
  (globalThis as unknown as Record<string, unknown>).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
  const { game } = blocksGame();
  (game as unknown as Record<string, unknown>).say = () => {};
  const m = new MallMode(game, { seed: 4242 });
  const keys = m.map.items.filter((i) => i.kind === 'key');
  assert.equal(keys.length, 3);
  assert.ok(keys.every((k) => !k.seen));
  const k = keys[0];
  m.px = k.x * 16 + 8 - 5 * 16;
  m.py = k.y * 16 + 8;
  m.mState = 'stunned';
  m.mTimer = 99;
  m.update(1 / 60);
  assert.equal(k.seen, true, 'a keycard within eight tiles is marked');
  assert.ok(keys.filter((x) => x.seen).length < 3 || keys.every((x) => Math.hypot(x.x * 16 - m.px, x.y * 16 - m.py) < 8 * 16), 'far keycards are not');
  const b0 = m.battery;
  for (let i = 0; i < 60 * 60; i++) { m.mTimer = 99; m.update(1 / 60); }
  assert.ok(m.battery > 0.4, `a minute of light leaves ${m.battery.toFixed(2)} of the battery`);
  assert.ok(b0 - m.battery < 0.6);
});
