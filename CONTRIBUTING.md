# Contributing to CHAOS.exe

Thanks for blowing on the cartridge with us. Everything here is plain TypeScript with no runtime dependencies.

## Setup

```bash
npm install
npm run dev     # http://127.0.0.1:8000/dev.html, rebuilds on save (refresh the page)
npm run check   # typecheck + unit tests + production build — run before every PR
```

`index.html` in the repo root is **generated**: edit `index.template.html`, then run `npm run build`, which writes both `dist/index.html` and the root `index.html` (GitHub Pages serves the root file, so commit it).

Optional browser checks (Python Playwright): `npm run smoke`.

## Add a genre mutation

1. Add an entry to `MUTATIONS` in `src/fusion/registry.ts` — id, the genres it fuses, a tagline, trait names, the modes that honour it, tuning `params`, and an unlock rule.
2. In each listed mode, branch on `this.fusion.has('your_trait')` and read tuning with `this.fusion.param('your_id', 'key', default)`.
3. If it starts locked, nothing else is needed — progression unlocks it, the hub lab lists it, the level banner announces it, and it raises the bit multiplier.

The test suite fails if a mutation's traits are never read by the modes it claims, so a mutation cannot ship as a label only.

## Add a chaos event

1. Add a `ChaosEventDef` to `src/chaos/events.ts`. Choose its category, modes, duration, telegraph (≥ 1.5 s is enforced), cooldown, flags and safety properties (`group`, `bossSafe`, `harsh`, `flashy`, `blockedSegments`).
2. Read the flag in the relevant mode with `this.director.flag('your_flag')`.
3. If it changes the player's hitbox or position, handle `onChaosStart` / `onChaosEnd` so the player can never be trapped.

## Add a level chunk (Retro Rampage)

Chunks live in `src/procgen/rampage.ts`. Rows are 16 characters wide and bottom-aligned; both edge columns need ground at row 14 and open space in rows 12–13. Add the chunk to a pool in `generateRampage`. The tests validate it across hundreds of seeds.

## Add a world

Extend `ModeBase` (`src/modes/base.ts`), which gives you the seed, fusion engine, chaos director, rewards, modifiers and HUD helpers. Register it in `MODE_IDS`, `MODE_INFO`, `isModeUnlocked` and the factory in `src/main.ts`.

## Style

- Strict TypeScript, no `any` in game code.
- Gameplay randomness goes through `Rng` (seeded); `Math.random` is only for cosmetic effects.
- Keep allocations out of per-frame paths; use the pools in `render/gfx.ts`.
- All art and audio must be original and generated in code. No third-party assets, no hotlinks.
- New on-screen characters must exist in the bitmap font (`src/render/font.ts`) — a test checks this.
