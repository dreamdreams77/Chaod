/** 5x7 bitmap font with a per-colour glyph-strip cache. */
const GLYPHS: Record<string, string> = {
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#",
  B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".###.|#...#|#....|#....|#....|#...#|.###.",
  D: "####.|#...#|#...#|#...#|#...#|#...#|####.",
  E: "#####|#....|#....|####.|#....|#....|#####",
  F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".###.|#...#|#....|#.###|#...#|#...#|.####",
  H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
  I: ".###.|..#..|..#..|..#..|..#..|..#..|.###.",
  J: "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
  L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
  N: "#...#|#...#|##..#|#.#.#|#..##|#...#|#...#",
  O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
  P: "####.|#...#|#...#|####.|#....|#....|#....",
  Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
  R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.",
  T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.",
  X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
  Z: "#####|....#|...#.|..#..|.#...|#....|#####",
  0: ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
  1: "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  2: ".###.|#...#|....#|...#.|..#..|.#...|#####",
  3: "#####|...#.|..#..|...#.|....#|#...#|.###.",
  4: "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
  5: "#####|#....|####.|....#|....#|#...#|.###.",
  6: "..##.|.#...|#....|####.|#...#|#...#|.###.",
  7: "#####|....#|...#.|..#..|.#...|.#...|.#...",
  8: ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
  9: ".###.|#...#|#...#|.####|....#|...#.|.##..",
  " ": ".....|.....|.....|.....|.....|.....|.....",
  ".": ".....|.....|.....|.....|.....|.##..|.##..",
  ",": ".....|.....|.....|.....|.##..|..#..|.#...",
  "!": "..#..|..#..|..#..|..#..|..#..|.....|..#..",
  "?": ".###.|#...#|....#|...#.|..#..|.....|..#..",
  ":": ".....|.##..|.##..|.....|.##..|.##..|.....",
  ";": ".....|.##..|.##..|.....|.##..|..#..|.#...",
  "-": ".....|.....|.....|.###.|.....|.....|.....",
  "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
  "/": "....#|...#.|...#.|..#..|.#...|.#...|#....",
  "'": "..#..|..#..|.#...|.....|.....|.....|.....",
  '"': ".#.#.|.#.#.|.....|.....|.....|.....|.....",
  "(": "...#.|..#..|.#...|.#...|.#...|..#..|...#.",
  ")": ".#...|..#..|...#.|...#.|...#.|..#..|.#...",
  "*": ".....|#.#.#|.###.|#####|.###.|#.#.#|.....",
  "#": ".#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.",
  "%": "##..#|##..#|...#.|..#..|.#...|#..##|#..##",
  "=": ".....|.....|#####|.....|#####|.....|.....",
  "<": "...#.|..#..|.#...|#....|.#...|..#..|...#.",
  ">": ".#...|..#..|...#.|....#|...#.|..#..|.#...",
  _: ".....|.....|.....|.....|.....|.....|#####",
  "[": ".###.|.#...|.#...|.#...|.#...|.#...|.###.",
  "]": ".###.|...#.|...#.|...#.|...#.|...#.|.###.",
  $: "..#..|.####|#.#..|.###.|..#.#|####.|..#..",
  "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#",
  "@": ".###.|#...#|#.###|#.#.#|#.###|#....|.###.",
  "~": ".....|.....|.#...|#.#.#|...#.|.....|.....",
  "^": "..#..|.#.#.|#...#|.....|.....|.....|.....",
  "\u2191": "..#..|.###.|#.#.#|..#..|..#..|..#..|..#..",
  "\u2193": "..#..|..#..|..#..|..#..|#.#.#|.###.|..#..",
  "\u2190": ".....|..#..|.#...|#####|.#...|..#..|.....",
  "\u2192": ".....|..#..|...#.|#####|...#.|..#..|.....",
  "\u2665": ".....|.#.#.|#####|#####|.###.|..#..|.....",
  "\u266A": "..##.|..#.#|..#..|..#..|###..|###..|.....",
  "\u2022": ".....|.....|.###.|.###.|.###.|.....|.....",
  "\u2588": "#####|#####|#####|#####|#####|#####|#####",
  "\u2605": "..#..|..#..|#####|.###.|.#.#.|#...#|.....",
  "\u25B6": ".#...|.##..|.###.|.####|.###.|.##..|.#...",
  "\u25C0": "...#.|..##.|.###.|####.|.###.|..##.|...#.",
  "\u2014": ".....|.....|.....|#####|.....|.....|.....",
  "\u25A0": ".....|#####|#####|#####|#####|#####|.....",
  "\u25A1": ".....|#####|#...#|#...#|#...#|#####|.....",
  "\u25CF": ".....|.###.|#####|#####|#####|.###.|.....",
  "\u2606": "..#..|..#..|##.##|.#.#.|.#.#.|#...#|.....",
  "\u26A0": "..#..|..#..|.#.#.|.#.#.|#...#|#.#.#|#####",
  "\u25B2": ".....|..#..|.###.|#####|#####|.....|.....",
  "\u25BC": ".....|#####|#####|.###.|..#..|.....|.....",
  "\xD7": ".....|#...#|.#.#.|..#..|.#.#.|#...#|.....",
};
const GW = 5;
const GH = 7;
const ADVANCE = 6;

const glyphCache = new Map<string, boolean[][]>();

function glyph(ch: string): boolean[][] {
  let g = glyphCache.get(ch);
  if (!g) {
    const rows = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS['?'];
    g = rows.split('|').map((r) => r.split('').map((c) => c === '#'));
    glyphCache.set(ch, g);
  }
  return g;
}

export function hasGlyph(ch: string): boolean {
  return ch in GLYPHS || ch.toUpperCase() in GLYPHS;
}

export function textWidth(text: string, scale = 1): number {
  return text.length === 0 ? 0 : (text.length * ADVANCE - 1) * scale;
}

const stripCache = new Map<string, HTMLCanvasElement>();

function strip(text: string, color: string): HTMLCanvasElement {
  const key = color + '\0' + text;
  const hit = stripCache.get(key);
  if (hit) return hit;
  if (stripCache.size > 600) stripCache.clear();
  const c = document.createElement('canvas');
  c.width = Math.max(1, textWidth(text));
  c.height = GH;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  for (let i = 0; i < text.length; i++) {
    const px = glyph(text[i]);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (px[y][x]) g.fillRect(i * ADVANCE + x, y, 1, 1);
  }
  stripCache.set(key, c);
  return c;
}

export interface TextOpts {
  align?: 'left' | 'center' | 'right';
  scale?: number;
  /** Shadow colour; null disables it. */
  shadow?: string | null;
}

let textFilter: ((text: string) => string) | null = null;

/**
 * Installs a rewrite applied to every string drawn (used to show touch button names instead of
 * keyboard keys on phones). Single characters are left alone so glyph-only draws such as the
 * rhythm "X" glitch note are never rewritten.
 */
export function setTextFilter(fn: ((text: string) => string) | null): void {
  textFilter = fn;
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#fff', opts: TextOpts = {}): void {
  if (!text) return;
  if (textFilter && text.length > 1) text = textFilter(text);
  const scale = opts.scale ?? 1;
  const w = textWidth(text, scale);
  let px = x;
  if (opts.align === 'center') px = x - w / 2;
  else if (opts.align === 'right') px = x - w;
  px = Math.round(px);
  const py = Math.round(y);
  if (opts.shadow !== null) {
    const s = strip(text, opts.shadow ?? '#000');
    ctx.drawImage(s, px + scale, py + scale, s.width * scale, s.height * scale);
  }
  const c = strip(text, color);
  ctx.drawImage(c, px, py, c.width * scale, c.height * scale);
}

/** Word-wraps to `max` characters per line, honouring explicit newlines. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (line) {
        if ((line + ' ' + word).length <= max) line += ' ' + word;
        else {
          out.push(line);
          line = word;
        }
      } else line = word;
      while (line.length > max) {
        out.push(line.slice(0, max));
        line = line.slice(max);
      }
    }
    out.push(line);
  }
  return out;
}
