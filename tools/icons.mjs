// Builds the app icons (icons/*.png), the inline favicon SVG (printed) and the social preview
// image (docs/og.png, 1200x630) from a 16x16 pixel cartridge. Usage: node tools/icons.mjs
import { writeFileSync, readFileSync } from 'node:fs';

const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'));
// k outline, p cartridge body, P darker body, l label, y yellow, m magenta, c cyan, g contacts
const ART = [
  '................',
  '..kkkkkkkkkkkk..',
  '.kppppppppppppk.',
  '.kpkkkkkkkkkkpk.',
  '.kpklllllyylkpk.',
  '.kpkllllyyllkpk.',
  '.kpklllyyyylkpk.',
  '.kpkllllyyllkpk.',
  '.kpklllyylllkpk.',
  '.kpkmmmmmmmmkpk.',
  '.kpkkkkkkkkkkpk.',
  '.kppppppppppppk.',
  '..kkkkkkkkkkkk..',
  '...kgggkkgggk...',
  '...kgggkkgggk...',
  '..kkkkkkkkkkkk..',
];
const PAL = { k: '#05020d', p: '#8a5cf0', P: '#5a3aa8', l: '#1d0f33', y: '#ffe23f', m: '#ff3fa4', c: '#3fe0ff', g: '#ffcf3f' };
// make every row 16 wide (the label rows are drawn 15-16 wide above)
const rows = ART.map((r) => r.padEnd(16, '.').slice(0, 16));

const rects = [];
rows.forEach((r, y) => [...r].forEach((ch, x) => { if (PAL[ch]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${PAL[ch]}"/>`); }));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join('')}</svg>`;
writeFileSync('icons/icon.svg', svg);
console.log('favicon data URI:\ndata:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27'));

const browser = await chromium.launch();
const page = await browser.newPage();
const png = async (size, bg, pad) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:${bg};display:grid;place-items:center;height:100vh"><img src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}" style="width:${size - pad * 2}px;height:${size - pad * 2}px;image-rendering:pixelated"></body>`);
  return page.screenshot();
};
writeFileSync('icons/icon-192.png', await png(192, '#0b0716', 20));
writeFileSync('icons/icon-512.png', await png(512, '#0b0716', 56));
writeFileSync('icons/maskable-512.png', await png(512, '#0b0716', 110)); // extra safe-zone padding for round masks
writeFileSync('icons/apple-touch-icon.png', await png(180, '#0b0716', 20));

// social preview: cover art behind the title, in the game's pixel font
const { build } = await import('esbuild');
const bundle = await build({
  stdin: { contents: `import { drawText, textWidth } from './src/render/font.ts'; window.__og = (c, bg, icon) => { const ctx = c.getContext('2d'); c.width = 1200; c.height = 630;
    ctx.fillStyle = '#05020d'; ctx.fillRect(0, 0, 1200, 630);
    ctx.filter = 'blur(3px) saturate(1.3)'; ctx.drawImage(bg, 0, 60, 640, 336, 0, 0, 1200, 630); ctx.filter = 'none';
    ctx.fillStyle = 'rgba(5,2,13,0.62)'; ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < 630; y += 4) ctx.fillRect(0, y, 1200, 2);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(icon, 80, 195, 240, 240);
    ctx.save(); ctx.shadowColor = '#ff3fa4'; ctx.shadowBlur = 30;
    drawText(ctx, 'CHAOS.EXE', 350, 170, '#ffe23f', { scale: 14, shadow: '#b3126e' }); ctx.restore();
    drawText(ctx, 'TWELVE GAMES. ONE CARTRIDGE.', 354, 300, '#3fe0ff', { scale: 5, shadow: '#0a3a55' });
    drawText(ctx, 'ZERO RULES.', 354, 350, '#3fe0ff', { scale: 5, shadow: '#0a3a55' });
    drawText(ctx, 'FREE IN YOUR BROWSER', 354, 440, '#ffffff', { scale: 4 });
    drawText(ctx, 'PLATFORMER \\u2022 RACING \\u2022 HORROR \\u2022 FIGHTER \\u2022 RHYTHM \\u2022 STRATEGY', 600, 540, '#c9b8ff', { align: 'center', scale: 2 }); drawText(ctx, 'SPORTS \\u2022 PUZZLE \\u2022 RUN-AND-GUN \\u2022 MAZE \\u2022 WRESTLING \\u2022 PINBALL', 600, 574, '#c9b8ff', { align: 'center', scale: 2 }); };`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'iife', write: false, logLevel: 'warning',
});
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent('<body style="margin:0"><canvas id="c"></canvas></body>');
await page.addScriptTag({ content: bundle.outputFiles[0].text });
const cover = 'data:image/png;base64,' + readFileSync('docs/cover.png').toString('base64');
const icon = 'data:image/png;base64,' + readFileSync('icons/icon-512.png').toString('base64');
await page.evaluate(async ([c, i]) => {
  const load = (s) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = s; });
  window.__og(document.getElementById('c'), await load(c), await load(i));
}, [cover, icon]);
writeFileSync('docs/og.png', await page.locator('#c').screenshot());
await browser.close();
console.log('icons/ and docs/og.png written');
