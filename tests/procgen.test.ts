import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNKS, CHUNK_W, ROWS, generateRampage, validateRampage } from '../src/procgen/rampage.ts';
import { generateNeon, validateNeon } from '../src/procgen/neon.ts';
import { generateMall, validateMall, nextStepToward, MW, MH } from '../src/procgen/mall.ts';
import { generateBlock, validateBlock, judge, BLOCK_BEATS } from '../src/procgen/chart.ts';
import { Rng } from '../src/core/rng.ts';

test('rampage chunks are well-formed and join cleanly', () => {
  for (const c of Object.values(CHUNKS)) {
    assert.ok(c.rows.length <= ROWS, c.id);
    for (const r of c.rows) assert.equal(r.length, CHUNK_W, `${c.id}: ${r}`);
    const pad = ROWS - c.rows.length;
    const at = (x: number, y: number) => (y < pad ? '.' : c.rows[y - pad][x]);
    for (const x of [0, CHUNK_W - 1]) {
      assert.equal(at(x, 14), '#', `${c.id} edge column ${x} needs ground at row 14`);
      for (const y of [12, 13]) assert.ok(!'#?G'.includes(at(x, y)), `${c.id} edge ${x},${y} must be open`);
    }
  }
});

test('every rampage seed is completable (with and without mutations)', () => {
  for (let seed = 0; seed < 300; seed++) {
    for (const opts of [{ beatPlatforms: true, switchShots: true }, { beatPlatforms: false, switchShots: false }]) {
      const lvl = generateRampage(seed, opts);
      const v = validateRampage(lvl);
      assert.ok(v.ok, `seed ${seed} ${JSON.stringify(opts)}: ${v.reason} plan=${lvl.plan.join(',')}`);
      assert.equal(lvl.spawns.filter((s) => s.kind === 'F').length, 2, 'two placed floppies + one in the shmup sky');
      assert.equal(lvl.spawns.filter((s) => s.kind === 'P').length, 1);
      assert.equal(lvl.spawns.filter((s) => s.kind === 'X').length, 1);
      if (!opts.beatPlatforms) assert.ok(!lvl.tiles.some((r) => r.includes('B') || r.includes('b')));
      if (!opts.switchShots) assert.ok(!lvl.spawns.some((s) => s.kind === 'S'));
    }
  }
});

test('rampage generation is reproducible from a seed', () => {
  const a = generateRampage(777, { beatPlatforms: true, switchShots: true });
  const b = generateRampage(777, { beatPlatforms: true, switchShots: true });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.plan.concat(a.spawns.map((s) => s.kind + s.x)), generateRampage(778, { beatPlatforms: true, switchShots: true }).plan.concat(['x']));
});

test('validator rejects an impossible level', () => {
  const lvl = generateRampage(1, { beatPlatforms: true, switchShots: true });
  // Carve an un-jumpable 12-tile chasm right after the start.
  for (let x = 18; x < 30; x++) for (let y = 0; y < ROWS; y++) lvl.tiles[y][x] = '.';
  assert.equal(validateRampage(lvl).ok, false);
});

test('neon tracks never fully block the road and are seed-stable', () => {
  for (let seed = 0; seed < 200; seed++) {
    const t = generateNeon(seed, (seed % 3) / 2);
    assert.ok(validateNeon(t), `seed ${seed}`);
    assert.ok(t.length > 2000);
    assert.equal(t.objects.filter((o) => o.kind === 'floppy').length, 3);
    for (const s of t.segments) assert.ok(Math.abs(s.curve) <= 5.01);
  }
  assert.deepEqual(generateNeon(5, 0.5), generateNeon(5, 0.5));
});

test('mall maps are fully connected and pathfinding works', () => {
  for (let seed = 0; seed < 200; seed++) {
    const m = generateMall(seed);
    assert.ok(validateMall(m).ok, `seed ${seed}: ${validateMall(m).reason}`);
    assert.equal(m.items.filter((i) => i.kind === 'key').length, 3);
    assert.equal(m.items.filter((i) => i.kind === 'floppy').length, 3);
    const keyStores = new Set(m.items.filter((i) => i.kind === 'key').map((k) => m.stores.findIndex((s) => k.x >= s.x0 && k.x <= s.x1 && k.y >= s.y0 && k.y <= s.y1)));
    assert.equal(keyStores.size, 3, 'keys are spread over three shops');
  }
  const m = generateMall(3);
  const step = nextStepToward(m, m.monsterStart.x, m.monsterStart.y, m.start.x, m.start.y);
  assert.ok(step && Math.abs(step.x - m.monsterStart.x) + Math.abs(step.y - m.monsterStart.y) === 1);
  assert.ok(m.tiles.length === MH && m.tiles[0].length === MW);
});

test('rhythm charts respect spacing, chord and glitch rules in every phase', () => {
  for (let seed = 0; seed < 150; seed++) {
    const rng = new Rng(seed);
    for (const phase of [1, 2, 3]) {
      for (const diff of [0, 1, 2]) {
        const notes = generateBlock(rng, 8 + seed * BLOCK_BEATS, phase, diff);
        assert.equal(validateBlock(notes, phase), null, `seed ${seed} phase ${phase}`);
        assert.ok(notes.filter((n) => n.kind !== 'glitch').length >= 4, 'at least one note per bar');
        if (phase === 1) assert.ok(!notes.some((n) => n.kind === 'glitch'), 'no glitch notes in phase 1');
        for (const n of notes) assert.ok(n.lane >= 0 && n.lane < 4);
      }
    }
  }
});

test('timing windows grade symmetrically', () => {
  assert.equal(judge(0), 'PERFECT');
  assert.equal(judge(-0.04), 'PERFECT');
  assert.equal(judge(0.08), 'GREAT');
  assert.equal(judge(-0.14), 'GOOD');
  assert.equal(judge(0.2), 'MISS');
});

test('glitch notes never stack and level plans never repeat a chunk back-to-back', () => {
  for (let seed = 0; seed < 300; seed++) {
    const notes = generateBlock(new Rng(seed), 0, 3, 2).filter((n) => n.kind === 'glitch');
    for (let i = 1; i < notes.length; i++) assert.ok(notes[i].beat - notes[i - 1].beat >= 0.5, `seed ${seed}`);
    const plan = generateRampage(seed, { beatPlatforms: true, switchShots: true }).plan;
    for (let i = 1; i < plan.length; i++) assert.notEqual(plan[i], plan[i - 1], `seed ${seed}: ${plan.join(',')}`);
  }
});
