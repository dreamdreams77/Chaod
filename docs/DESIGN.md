# CHAOS.exe — Game Design Document

## 1. Pillars

1. **Every genre can collide with every other genre** — and a collision must change the rules, not just the paint.
2. **Controlled unpredictability.** Surprises are telegraphed, fair, and recoverable.
3. **Curiosity over grind.** Progress comes from trying things: new worlds, mutations, secrets, choices.
4. **Failure is entertaining.** Fast restarts, partial rewards, jokes on the game-over screen.
5. **Original everything.** Genre conventions as inspiration; no borrowed characters, music, levels or logos.

## 2. The world

The **Cartridge Core** is an ancient machine that kept every gaming reality in its own cartridge. **The Great Genre Crash** shattered the boundaries. The player falls in while blowing dust off it.

**The mystery** (revealed through the Manual, mall notes and boss dialogue):
- *Why did the Core fail?* The Manual tore out its own pages — the bosses begged it to. They were tired of being final levels.
- *Who benefits?* **THE HIGH SCORE**, an entity made of every initials-entry ever typed, which promised the bosses freedom and hid the last page so that nobody can ever beat its record.
- *Are the bosses villains?* No — they are trying to escape their roles. Each boss asks to be **set free** or **deleted**; the choice changes the hub, the ending text and an achievement.

### Cast

| Character | Role | Gameplay hook |
|---|---|---|
| **CASS ETTE** | Protagonist; a 90s save-file tester | Shared stats/level across every genre |
| **THE MANUAL** | Mysterious guide; sentient booklet missing pages | Delivers the mystery in short lines; a trust choice changes the ending |
| **BYTE** | Ally; virtual pet blob | Feed/train in the hub; bond powers its bark in the horror world |
| **REX TURBO** | Rival racer stuck on "lap 3 of 3" since 1996 | Rubber-banded opponent in NEON PANIC; dialogue changes when beaten |
| **MADAME POLYGON** | Ally; 3D fortune teller trapped in 2D | Shop |
| **KEVIN FROM QA** | Recurring comedic character | His appearances literally change a rule of the current level (legendary chaos event) |
| **DEMO** | Secret character; the developer's dog | Playable skin with built-in double jump |

### Bosses (roadmap of five, two playable now)

| Boss | World | Status |
|---|---|---|
| **BRICKLORD MAX**, the falling-block golem | BOSS BEATDOWN | Playable |
| **DJ STATIC**, the glitch selector | GLITCH RHYTHM | Playable |
| **THE LURKER**, the thing in the rear-view | NEON PANIC | Appears as the midnight pursuer; full encounter in Part 2 |
| **THE CLOSING-TIME MANAGER**, mini-boss retired | NIGHTMARE MALL | Appears as the stalker; full encounter in Part 2 |
| **THE HIGH SCORE** | Final boss | Playable (from the Core after the reboot) |

NPC archetypes: arcade cabinets that talk through their attract screens, the freed bosses as lobby residents, the stalker, the rival, the shopkeeper, the QA tester.

## 3. Core loop

1. Walk the **Lobby of Lost Saves** and pick a cabinet.
2. The world announces its genre and active mutations.
3. Play; the **Chaos Director** and a scripted **genre shift** change the rules mid-run.
4. Clear it (or fail and keep half the rewards).
5. Results: bits, XP, floppies, achievements, newly unlocked mutations.
6. Spend bits at Madame Polygon, care for BYTE, tune the Mutation Lab and Chaos Shrine.
7. New cabinets power on; the Manual reveals more; bosses give Core Shards.
8. Two shards → the Core reboots → ending → rematches, modifiers, seeds and secrets remain.

Unlock gating is curiosity-based, not grind-based: RETRO RAMPAGE opens NEON PANIC and NIGHTMARE MALL; any two clears open both boss cabinets.

## 4. Genre Fusion engine

Data lives in `src/fusion/registry.ts`. A **Mutation** fuses two or more genres, switches on named **traits**, lists the modes that honour it, carries tuning `params`, and an unlock rule. Modes ask `fusion.has('trait')` and branch. The engine (`engine.ts`) only decides *what is on*; behaviour stays in the modes, which keeps the abstraction small.

| Mutation | Fusion | What actually changes |
|---|---|---|
| BEAT BRIDGES | Platformer + Rhythm | Pink/cyan platforms are solid only on alternating 2-beat phases of the live music clock; they flicker half a beat before vanishing. |
| TRICK SHOT | Shooter + Puzzle | Shot-only switches open gates to secret rooms; without it, those routes stay sealed. |
| NIGHT DRIVE | Racing + Horror | After midnight THE LURKER's speed = base + fear; fear grows with crashes and slow driving, shrinks with boosting. When near, it places shadow barriers in your lane and catching you costs health and speed. |
| BASS BOOST | Racing + Rhythm | Boosts within ±110 ms of a beat are 1.6× stronger. |
| DRIFT ENCOUNTERS | Racing + RPG | A 1.4 s drift drops time to 15% and opens an ATTACK / DEFEND / MAGIC command menu. |
| GOOD BOY PROTOCOL | Virtual pet + Horror | BYTE follows you. Bark stun = 1.5 s + 0.7 s × bond; a bark from afar lures the stalker; bond 3+ sniffs keycards. |
| GRINDCORE | Fighter + RPG | Each hit gives XP scaled by combo length; level-ups mid-fight add 15% damage and heal. |
| LINE CLEAR KO | Puzzle + Fighter | Falling blocks target your column and stack in a 9-wide grid; a full row deals heavy damage. You "place" blocks by baiting drops, then dodging. |
| SHOTS ON THE ONE | Rhythm + Bullet hell | Hits fire up the lane at the boss; misses send bolts down that lane, parryable on the judgement line. |

Plus **scripted genre shifts** inside levels: platformer → shmup → platformer (Rampage), racing → horror (Neon), fighter → bullet hell (Beatdown), rhythm → double-time (Rhythm).

### Expansion fusions (designed, not yet built)
- **Kart racing + turn-based RPG:** collisions with rival karts open full encounter screens.
- **Dating sim + horror:** dialogue trust decides resources and which supernatural events occur.
- **Strategy + platformer:** place turrets while running the level.
- ~~**Sports + bullet hell:** score while dodging patterns.~~ Built as **PENALTY STORM**: dribble a top-down pitch, dodge the keeper's five bullet patterns, and score six goals; a hit knocks the ball loose.
- **Pet sim + survival horror (full):** an evolving monster that only your pet can fight.

## 5. The Chaos Director

`src/chaos/director.ts` + the catalogue in `events.ts`.

- **Meter:** fills over time (intensity × difficulty) and from stylish play (stomp chains, airborne kills, combos, perfect boosts, line clears).
- **Selection:** weighted random from events legal for the current mode, segment and boss state; the shrine favour multiplies a category ×3.
- **Cooldowns:** a global gap (by intensity) plus per-event cooldowns.
- **Minimum reaction time:** every event is telegraphed for ≥ 1.5 s with a banner, a countdown bar and a warning beep.
- **Recovery:** no new events for 4 s after damage; "harsh" events are suppressed at ≤ 34% health (≤ 60% on Easy).
- **Duration:** events end on their own; flags disappear with them.
- **Compatibility:** mode lists, blocked segments (e.g. no gravity flips during the shmup) and exclusive groups (never two gravity or two size effects).
- **Boss rules:** `bossOnly` events need a boss; others must be `bossSafe` to interrupt one; boss phase changes clear all events.
- **Accessibility:** intensity OFF / LOW / NORMAL / HIGH; reduced flashing removes flashy events.
- **Unwinnable prevention:** modes report `safe=false` during scripted moments; gravity returning over a pit restores you to safe ground; size changes never trap you in walls.
- **Player influence:** chaos orbs trigger an event on demand (still rule-checked); stylish play speeds the meter; shrine favour biases categories.

| Category | Events |
|---|---|
| Cosmetic | Palette Swap, 1927 Mode, Tracking Error |
| Environmental | Gravity Flip, Moon Physics, Note Highway Floor (jump on beat for super jumps), Fog Bank, Power Surge (lights on, but he's faster) |
| Combat | Mega Mode, Pocket Size (invisible to the stalker), Bounce House, Reverse Day, Mirror Mix |
| Genre transformation | Kart Invasion (enemies become racers), Mecha Mode (car becomes a fighting robot), Moveset Stolen (boss-only), Static Remix (boss-only) |
| Legendary | Kevin Filed a Bug (applies a rule change), Fatal Exception (blue-screen minigame jackpot) |

## 6. Procedural generation

Curated structure + seeded variation, always validated:

- **Rampage:** a fixed pacing plan (teach → twist → breather → genre shift → escalate → finale) filled from pools of 14 hand-authored chunks; seeded enemy thinning/extra spawns, bit placement and shmup asteroid fields that always keep a corridor. A reachability validator (tested over 300 seeds × mutation combos) proves the exit is reachable; a headless physics test confirms the validator's jump limits are within the real player's ability.
- **Neon:** sections from a curve/hill vocabulary; obstacles placed with a "never block all three lanes" rule.
- **Mall:** fixed topology (concourse + 12 shops) with seeded shop identities, doors, shelves and item placement; flood-fill guarantees reachability; keycards are spread over three shops.
- **Rhythm:** 16-beat blocks generated on the fly from the boss phase; lane-spacing, chord and glitch rules are validated.
- **Boss patterns:** attack selection and bullet patterns use the run's seeded RNG.

Run `npm run seeds -- <seed>` to see what a seed produces. Handcrafted showcase seeds: **1990**, **64**, **777777**.

## 7. Progression & economy

- **XP → level:** gentle curve; each two levels add a heart, each level adds 12% power.
- **Bits:** shop currency; ×(1 + 0.15 per active mutation + modifier bonus); failed runs pay half.
- **Floppies:** 3 per world (15 total) in optional/risky spots; all 15 unlock the secret character.
- **Shop:** double jump, heart containers, overclock (energy), bit magnet, nitro tank, pet treats.
- **Pet care:** BYTE gets hungry after each adventure; feeding and a fetch minigame build bond (1–5).
- **Replay:** new seed each run, a seeded challenge modifier on replays (Glass Cannon, Bit Storm, Turbo, Chaos Cranked, Sunday Drive), boss rematches, 20 achievements, best scores.

## 8. Presentation

- **Visuals:** 480×270 internal resolution, crisp integer scaling, original 5×7 bitmap font, procedural rectangle-art characters. Each genre has its own limited palette and treatment (sky bands for the platformer, synthwave road, near-black horror with a flashlight cone, fighter crowd of block spectators, rhythm equalizer city). CRT scanline strength varies per genre and can be turned off.
- **Audio:** procedurally composed 4-bar loops (seeded motifs, chord progressions, genre-specific scales, tempos, waveforms and drum patterns); boss and night variations; a tape-stop sweep on every genre shift; ~25 synthesized SFX; volume and mute controls; music muffles when paused.

## 9. Technical notes

Fixed 60 Hz simulation with an accumulator, rendering once per animation frame; auto-pause on blur/hidden tab with audio suspended; bounded particle/projectile pools; seeded RNG everywhere gameplay-relevant (cosmetic particles may use `Math.random`). Saves are versioned with migrations and fall back to memory if storage is blocked.
