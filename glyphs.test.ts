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
