// Builds docs/trailer.png: captures the worlds from the built game (npm run build first), then
// composes them into the launch-trailer banner. Usage: node tools/trailer.mjs [address]
// (the address defaults to the GitHub Pages site).
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
const URL_TEXT = process.argv[2] ?? 'https://dreamdreams77.github.io/Chaod/';
const ORDER = ['rampage', 'neon', 'mall', 'beatdown', 'rhythm', 'command', 'penalty', 'blocks', 'bolt', 'highscore'];
const game = 'file://' + resolve('dist/index.html');
const browser = await chromium.launch();
const shots = {};
for (const m of ORDER) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  await page.goto(game);
  await page.waitForTimeout(300);
  await page.evaluate((m) => {
    const g = __chaos.game;
    g.settings.perks = false; g.settings.musicOn = false; g.settings.chaos = 'normal';
    g.profile.tutorial.done = true; g.profile.introDone = true; g.profile.endingSeen = true;
    g.profile.lore.push('blocks_intro');
    for (const k of Object.keys(g.profile.cleared)) g.profile.cleared[k].clears = 1;
    if (['penalty', 'highscore', 'blocks', 'bolt'].includes(m)) g.startMode(m, { seed: 424242 }); else __chaos.start(m);
  }, m);
  const acts = ['right', 'jump', 'attack', 'right', 'left', 'right', 'special'];
  for (let i = 0; i < 110; i++) {
    await page.evaluate(([a, m, i]) => {
      const g = __chaos.game; g.dialog = null;
      const s = g.scene;
      // a few blocks dropped so the well is not empty
      if (m === 'blocks' && i % 6 === 0 && s.cur) { s.shift((i % 5) - 2); s.hardDrop(); }
      __chaos.press(a, true); setTimeout(() => __chaos.press(a, false), 60);
    }, [acts[i % acts.length], m, i]);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(250);
  shots[m] = 'data:image/png;base64,' + (await page.screenshot()).toString('base64');
  await page.close();
}
const out = await build({ entryPoints: ['tools/trailer.ts'], bundle: true, format: 'iife', write: false, logLevel: 'warning' });
const cover = 'data:image/png;base64,' + readFileSync('docs/cover.png').toString('base64');
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent('<body style="margin:0;background:#000"><canvas id="c"></canvas></body>');
await page.addScriptTag({ content: out.outputFiles[0].text });
await page.evaluate(([s, c, u]) => window.__compose(document.getElementById('c'), s, c, u), [shots, cover, URL_TEXT]);
writeFileSync('docs/trailer.png', Buffer.from(await page.locator('#c').screenshot().then((b) => b)));
await browser.close();
console.log('docs/trailer.png written');
