/**
 * Runs the real RampageMode simulation headlessly (no canvas) to confirm the
 * level validator's jump assumptions match the actual player physics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RampageMode } from '../src/modes/rampage.ts';
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
