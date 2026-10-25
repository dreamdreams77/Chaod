/** Every non-ASCII character used in on-screen strings must exist in the bitmap font. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hasGlyph } from '../src/render/font.ts';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

test('all displayed characters have glyphs', () => {
  const missing = new Map<string, string>();
  for (const f of files(new URL('../src', import.meta.url).pathname)) {
    const src = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''))
      .join('\n');
    for (const m of src.matchAll(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g)) {
      for (const ch of m[0].slice(1, -1)) {
        if (ch.charCodeAt(0) > 127 && !hasGlyph(ch)) missing.set(ch, f);
      }
    }
  }
  assert.deepEqual([...missing.entries()], []);
});

test('no big on/off blinks faster than 6 per second (photosensitivity guard)', () => {
  const offenders: string[] = [];
  for (const f of files(new URL('../src/modes', import.meta.url).pathname)) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/Math\.floor\((?:this\.)?time \* (\d+)\) % 2/g)) if (Number(m[1]) > 12) offenders.push(`${f}:${i + 1} (${m[1]})`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('the text filter never rewrites single-character draws (glitch note "X")', async () => {
  const { setTextFilter, drawText } = await import('../src/render/font.ts');
  const drawn: string[] = [];
  const g = { drawImage() {} } as unknown as CanvasRenderingContext2D;
  (globalThis as unknown as { document: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, set fillStyle(_v: string) {} }) }) };
  setTextFilter((t) => { drawn.push(t); return t.replace(/X/g, 'B'); });
  drawText(g, 'X', 0, 0);
  drawText(g, 'HOLD X', 0, 0);
  setTextFilter(null);
  assert.deepEqual(drawn, ['HOLD X'], 'only multi-character strings reach the filter');
});
