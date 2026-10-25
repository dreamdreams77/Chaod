// Production build: bundles src/main.ts with esbuild and emits
//   dist/index.html  (the game, with the script inlined — one portable file)
// The single-file output can be opened directly, hosted on GitHub Pages, or
// dropped onto any static host. No external assets are referenced.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const result = await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  sourcemap: false,
  legalComments: 'none',
  define: { __DEV__: 'false' },
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = await readFile('index.html', 'utf8');
const out = html.replace(
  /<script type="module" src="[^"]+"><\/script>/,
  () => `<script>${js}</script>`,
);
if (out === html) throw new Error('build: could not find the module script tag in index.html');
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', out);
console.log(`dist/index.html written (${(out.length / 1024).toFixed(1)} KiB)`);
