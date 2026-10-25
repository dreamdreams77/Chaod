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
