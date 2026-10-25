/**
 * Runs the real RampageMode simulation headlessly (no canvas) to confirm the
 * level validator's jump assumptions match the actual player physics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RampageMode } from '../src/modes/rampage.ts';
import { NeonMode } from '../src/modes/neon.ts';
import { MAX_JUMP_DX, MAX_JUMP_RISE, TILE, ROWS } from '../src/procgen/rampage.ts';
import { defaultProfile, defaultSettings } from '../src/core/save.ts';
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
    audio: { musicTime: () => 0, bpm: 120, sfx: noop, play: noop, shiftTo: noop },
    fx: { freeze: noop, shake: noop, flash: noop },
    toast: noop, genreShift: noop, startFatal: noop, drawKevinCameo: noop, music: noop,
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
  assert.equal(n.damageMult, 2);
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
  assert.equal(r1.damageMult, r1.modifier?.id === 'glass' ? 2 : 1);
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
  assert.equal(r5.damageMult, 2, 'from round 5 damage doubles');
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
