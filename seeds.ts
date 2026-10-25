/**
 * Prints the procedural content for a few showcase seeds, so designers can see
 * how curated structure + seeded variation combine. Run: npm run seeds [seed...]
 */
import { generateRampage, validateRampage } from '../src/procgen/rampage.ts';
import { generateNeon } from '../src/procgen/neon.ts';
import { generateMall } from '../src/procgen/mall.ts';
import { generateBlock } from '../src/procgen/chart.ts';
import { Rng, formatSeed } from '../src/core/rng.ts';

const args = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const seeds = args.length ? args : [1990, 64, 777777];

for (const seed of seeds) {
  console.log(`\n=== SEED ${formatSeed(seed)} ===`);
  const lvl = generateRampage(seed, { beatPlatforms: true, switchShots: true });
  const count = (k: string) => lvl.spawns.filter((s) => s.kind === k).length;
  console.log(`RETRO RAMPAGE  plan: ${lvl.plan.join(' → ')}`);
  console.log(`               ${lvl.width} tiles wide, ${count('e')} walkers, ${count('f')} flyers, ${count('t')} turrets, ${count('o')} bits, ${lvl.shmup.asteroids.length} asteroids, valid=${validateRampage(lvl).ok}`);
  const track = generateNeon(seed, 0.5);
  const kinds = (k: string) => track.objects.filter((o) => o.kind === k).length;
  const sharp = track.segments.filter((s) => Math.abs(s.curve) > 3).length;
  console.log(`NEON PANIC     ${track.length} segments, midnight at ${track.midnightSeg}, ${kinds('cone') + kinds('barrier')} obstacles, ${kinds('boost')} boost pads, ${sharp} hairpin segments, ${track.traffic.length} cars`);
  const mall = generateMall(seed);
  const keyShops = mall.items.filter((i) => i.kind === 'key').map((k) => mall.stores.find((s) => k.x >= s.x0 && k.x <= s.x1 && k.y >= s.y0 && k.y <= s.y1)?.name ?? '?');
  console.log(`NIGHTMARE MALL keycards in: ${keyShops.join(', ')}`);
  const block = generateBlock(new Rng(seed), 8, 2, 1);
  const lanes = ['←', '↓', '↑', '→'];
  console.log(`GLITCH RHYTHM  phase-2 block: ${block.map((n) => (n.kind === 'glitch' ? 'X' : lanes[n.lane]) + '@' + n.beat).join(' ')}`);
}
