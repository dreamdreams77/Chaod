// Builds docs/trailer.mp4: a short silent trailer of real gameplay, one scene per world plus a
// forced 1927 MODE chaos event, with the banner as intro and outro. Needs ffmpeg and Playwright.
// Usage: npm run build && node tools/video.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
const W = 960, H = 540;
const work = resolve('.video-tmp');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const game = 'file://' + resolve('dist/index.html');

// seconds = how long the scene is shown; force = a chaos event started a moment in
const SCENES = [
  { id: 'hub', title: 'THE LOBBY OF LOST SAVES', sub: 'YOUR HOME BASE BETWEEN WORLDS', seconds: 4.5 },
  { id: 'rampage', title: 'RETRO RAMPAGE', sub: 'PLATFORMER → SHMUP', seconds: 5 },
  { id: 'neon', title: 'NEON PANIC', sub: 'RACING → HORROR', seconds: 4 },
  { id: 'mall', title: 'NIGHTMARE MALL', sub: 'SURVIVAL HORROR + PET', seconds: 4 },
  { id: 'beatdown', title: 'BOSS BEATDOWN', sub: 'FIGHTER → BULLET HELL', seconds: 4.5, force: 'giant' },
  { id: 'rhythm', title: 'GLITCH RHYTHM', sub: 'RHYTHM + SHOOTER', seconds: 4 },
  { id: 'command', title: 'CORE COMMAND', sub: 'STRATEGY → BULLET HELL', seconds: 4 },
  { id: 'penalty', title: 'PENALTY STORM', sub: 'SPORTS + BULLET HELL', seconds: 4 },
  { id: 'blocks', title: 'BLOCK PARTY', sub: 'PUZZLE + PARTY', seconds: 5 },
  { id: 'bolt', title: 'BOLT BRIGADE', sub: 'RUN-AND-GUN + BOSSES', seconds: 4 },
  { id: 'munch', title: 'MUNCH MAZE', sub: 'MAZE CHASE + GHOSTS', seconds: 4.5 },
  { id: 'wrestle', title: 'RING RIOT', sub: 'WRESTLING + TIMING', seconds: 5 },
  { id: 'pinball', title: 'FLIPPER FRENZY', sub: 'PINBALL + MISSIONS', seconds: 5.5 },
  { id: 'highscore', title: 'THE HIGH SCORE', sub: 'THE FINAL BOSS', seconds: 5 },
  { id: 'hoops', title: 'HOOP SHOT', sub: 'ARCADE: BASKETBALL', seconds: 3.5, mini: 'HOOP SHOT' },
  { id: 'boxing', title: 'GLITCH GLOVES', sub: 'ARCADE: BOXING', seconds: 4, mini: 'GLITCH GLOVES' },
  { id: 'rampage', title: '1927 MODE', sub: 'CHAOS EVENT: TALKIES ARE A FAD', seconds: 7, force: 'silent_film', seed: 7777, chaosTag: true },
];
const KEYS = {
  hub: ['right', 'down', 'right', 'up', 'left', 'left', 'down'],
  rampage: ['right', 'jump', 'attack', 'right', 'jump', 'right', 'special'],
  neon: ['left', 'right', 'right', 'left', 'special'],
  mall: ['right', 'up', 'right', 'down', 'left', 'right'],
  beatdown: ['right', 'attack', 'attack', 'left', 'jump', 'attack', 'special'],
  rhythm: ['left', 'down', 'up', 'right', 'right', 'up', 'down', 'left'],
  command: ['confirm', 'right', 'down', 'confirm', 'right', 'right', 'up'],
  penalty: ['right', 'attack', 'left', 'up', 'attack', 'right'],
  blocks: [],
  bolt: ['right', 'jump', 'attack', 'right', 'attack', 'jump', 'right'],
  highscore: ['left', 'right', 'up', 'right', 'down', 'left', 'special'],
  munch: ['left', 'up', 'right', 'down', 'right', 'up', 'left', 'left'],
  wrestle: ['right', 'attack', 'attack', 'attack', 'jump', 'attack', 'left', 'special'],
  pinball: ['down', 'left', 'right', 'left', 'right'],
  hoops: ['jump', 'jump', 'right', 'jump', 'jump', 'left'],
  boxing: ['left', 'attack', 'right', 'attack', 'down', 'attack'],
};

const browser = await chromium.launch();
const clips = [];
for (const [n, sc] of SCENES.entries()) {
  const dir = `${work}/rec${n}`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(game);
  await page.waitForTimeout(300);
  await page.evaluate(([m, seed, force, mini]) => {
    const g = __chaos.game;
    g.settings.perks = false; g.settings.musicOn = false; g.settings.chaos = 'off';
    g.profile.tutorial.done = true; g.profile.introDone = true; g.profile.endingSeen = true;
    g.profile.lore.push('blocks_intro');
    for (const k of Object.keys(g.profile.cleared)) g.profile.cleared[k].clears = 1;
    g.profile.lore.push('munch_intro', 'wrestle_intro', 'pinball_intro');
    if (m === 'hub' || mini) g.goto(g.hubFactory());
    else if (['penalty', 'highscore', 'blocks', 'bolt'].includes(m)) g.startMode(m, { seed: seed ?? 424242 });
    else if (seed) g.startMode(m, { seed });
    else __chaos.start(m);
  }, [sc.id, sc.seed, sc.force, sc.mini]);
  if (sc.mini) {
    await page.waitForTimeout(700);
    await page.evaluate((label) => { const s = __chaos.game.scene; s.arcadeMenu(); s.menu.items.find((x) => x.label === label).onSelect(); }, sc.mini);
  }
  // let the intro and any dialogue pass, then start the shot
  for (let i = 0; i < 25; i++) { await page.evaluate(() => { __chaos.game.dialog = null; }); await page.waitForTimeout(60); }
  // lower-third caption (drawn in the page so it is part of the recording)
  await page.evaluate(([title, sub, tag]) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:10px 18px 12px;background:linear-gradient(transparent,#000c 40%);font:700 26px "Courier New",monospace;color:#ffe23f;text-shadow:0 0 10px #ff3fa4,2px 2px 0 #000;z-index:99;display:flex;gap:16px;align-items:baseline';
    d.innerHTML = `<span>${title}</span><span style="font-size:15px;color:#9fe8ff;text-shadow:1px 1px 0 #000">${sub}</span>` + (tag ? '<span style="margin-left:auto;font-size:15px;background:#ff3fa4;color:#fff;padding:2px 8px;text-shadow:none">CHAOS EVENT</span>' : '');
    document.body.appendChild(d);
  }, [sc.title, sc.sub, sc.chaosTag]);
  const start = (Date.now() - t0) / 1000;
  if (sc.force) await page.evaluate((id) => {
    const s = __chaos.game.scene; const def = __chaos.events.find((e) => e.id === id);
    if (s.director && def) s.director.start(def, s.directorContext());
  }, sc.force);
  const keys = KEYS[sc.id];
  const stop = Date.now() + sc.seconds * 1000;
  let i = 0;
  while (Date.now() < stop) {
    await page.evaluate(([a, id, i]) => {
      const g = __chaos.game; g.dialog = null;
      const s = g.scene;
      if (id === 'blocks' && i % 5 === 0 && s.cur) { s.shift((i % 5) - 2 + (i % 3) - 1); s.hardDrop(); }
      const tap = (k) => { __chaos.press(k, true); setTimeout(() => __chaos.press(k, false), 90); };
      // the three scripted-skill scenes play for real, so the footage shows the game working
      if (id === 'pinball') {
        __chaos.press('down', i > 1 && i < 9);
        for (const b of s.balls || []) __chaos.press(b.x < 83 ? 'left' : 'right', s.phase === 'play' && b.y > 195 && b.y < 252);
        return;
      }
      if (id === 'hoops') {
        if (s.phase === 'idle') tap('jump');
        else if (s.phase === 'meter' && Math.abs(s.power - [0.8, 0.62, 0.44][s.currentSpot]) < 0.045) tap('jump');
        return;
      }
      if (id === 'boxing') {
        const st = s.oppState, pn = s.oppPunch;
        __chaos.press('left', (st === 'tell' || st === 'strike') && pn === 'hookR');
        __chaos.press('right', (st === 'tell' || st === 'strike') && pn === 'hookL');
        __chaos.press('down', (st === 'tell' || st === 'strike') && pn === 'jab');
        if (st === 'recover' || st === 'stun' || (st === 'tell' && s.stateLeft <= s.tellTime * 0.4)) tap('attack');
        return;
      }
      if (a) { __chaos.press(a, true); setTimeout(() => __chaos.press(a, false), 140); }
    }, [keys.length ? keys[i % keys.length] : null, sc.id, i++]);
    await page.waitForTimeout(sc.id === 'hoops' || sc.id === 'boxing' || sc.id === 'pinball' ? 60 : 170);
  }
  await ctx.close();
  const file = readdirSync(dir).find((f) => f.endsWith('.webm'));
  clips.push({ src: `${dir}/${file}`, start, dur: sc.seconds, out: `${work}/clip${n}.mp4` });
}
await browser.close();

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const vf = (extra) => `scale=1920:1080:flags=neighbor,fps=30,${extra}format=yuv420p`;
const enc = ['-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30'];
for (const c of clips) {
  ff(['-ss', String(c.start), '-i', c.src, '-t', String(c.dur), '-vf', vf(`fade=t=in:d=0.25,fade=t=out:st=${c.dur - 0.25}:d=0.25,`), ...enc, c.out]);
}
const card = (name, secs) => {
  const out = `${work}/${name}.mp4`;
  ff(['-loop', '1', '-i', resolve('docs/trailer.png'), '-t', String(secs), '-vf', vf(`fade=t=in:d=0.4,fade=t=out:st=${secs - 0.4}:d=0.4,`), ...enc, out]);
  return out;
};
const list = [card('intro', 3), ...clips.map((c) => c.out), card('outro', 3.5)];
writeFileSync(`${work}/list.txt`, list.map((f) => `file '${f}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', `${work}/list.txt`, '-c', 'copy', '-movflags', '+faststart', resolve('docs/trailer.mp4')]);
rmSync(work, { recursive: true, force: true });
console.log('docs/trailer.mp4 written');
