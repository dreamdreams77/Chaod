// Builds tools/cover.html: one self-contained page (the game's pixel font bundled in).
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

const out = await build({ entryPoints: ['tools/cover.ts'], bundle: true, format: 'iife', minify: true, write: false, logLevel: 'warning' });
const js = out.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const num = (id, label, v) => `<label>${label}<input id="${id}" type="number" value="${v}"></label>`;
const txt = (id, label) => `<label>${label}<input id="${id}" type="text"></label>`;
const col = (id, label) => `<label>${label}<input id="${id}" type="color"></label>`;
writeFileSync('tools/cover.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CHAOS.EXE cover title overlay</title>
<style>
body{margin:0;background:#0b0716;color:#ddd;font:14px system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:16px;padding:16px}
canvas{max-width:min(100%,640px);height:auto;border:2px solid #ff3fa4;image-rendering:auto;background:#05020d}
.panel{flex:1 1 280px;max-width:420px;display:grid;gap:8px;align-content:start}
label{display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center}
input[type=text],input[type=number],textarea{background:#150d2a;color:#fff;border:1px solid #3a3050;padding:6px;border-radius:4px;width:100%;box-sizing:border-box}
button{background:#ff3fa4;color:#fff;border:0;padding:10px;border-radius:4px;font-weight:700;cursor:pointer}
h1{font-size:16px;margin:0;color:#ffe23f}p{margin:0;color:#9a9ab8}
</style></head><body>
<canvas id="c" width="640" height="640"></canvas>
<div class="panel">
<h1>Cover title overlay</h1>
<p>Open or drop your generated picture, set the box over its misspelled sign, and save.</p>
<label>Picture<input id="file" type="file" accept="image/*"></label>
${txt('title', 'Title')}${txt('sub', 'Small line')}
${num('x', 'Box x', 0)}${num('y', 'Box y', 0)}${num('w', 'Box width', 0)}${num('h', 'Box height', 0)}
${num('scale', 'Title size', 4)}${num('subScale', 'Small line size', 1)}
${col('title1', 'Title colour')}${col('panel', 'Panel')}${col('border', 'Border')}${col('sub1', 'Small line colour')}
<label>Free labels<textarea id="labels" rows="5" placeholder="one per line: x,y,size,TEXT"></textarea></label>
<button id="save">Download PNG</button>
</div>
<script>${js}</script></body></html>`);
console.log('tools/cover.html written');
