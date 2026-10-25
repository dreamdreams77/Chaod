// Development server: esbuild watch + serve with live rebuilds.
// Open the printed URL; refresh after saving a file.
import { context } from 'esbuild';

const ctx = await context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  sourcemap: true,
  outdir: 'dev-out/src',
  define: { __DEV__: 'true' },
  logLevel: 'info',
});
await ctx.watch();
// Serve the repo root so index.html loads /src/main.js from dev-out via servedir mapping.
const { hosts, port } = await ctx.serve({ servedir: '.', fallback: 'index.html' });
console.log(`\n  CHAOS.exe dev server → http://${hosts[0] === '0.0.0.0' ? 'localhost' : hosts[0]}:${port}/dev.html\n`);
