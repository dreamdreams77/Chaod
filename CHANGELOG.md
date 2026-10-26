# Changelog

## 3.3.0 — friend challenges, records, titles, ULTRA and clear shapes
- **Friend-score challenges**: a share card's link now carries the score as well as the seed. Whoever opens it gets a FRIEND'S CHALLENGE entry on the lobby's world picker ("beat their score on the same seed"), a BEAT line during the run, and on the results screen either BEATEN! (+40 bits and the RIVAL BEATEN trophy, once per link, and only for a cleared run) or NOT YET. Old links without a score still work. Scores that are not comparable to a plain run (endless, boss rush, perks, nightmare, rematch, ULTRA) are left out of the link.
- **RECORDS & TITLES** in the lobby menu: play time, runs, daily streak and, for every world, clears, best score and time, stars, endless best and disks. Sixteen **titles** (ROOKIE TESTER to GOLD STANDARD) unlock from play, can be picked there (or left on AUTO, which wears the newest), are shown on the results screen and the share card, and announce themselves with a toast when earned.
- **BLOCK PARTY ULTRA** (on the cabinet once the world is cleared): two minutes on the clock, no line goal; reach the target score (3000 Easy, 6000 Normal, 10000 Hard) to win and be paid in full, otherwise half; after the target is passed, running out of hearts still counts as a win. It never counts as clearing the world, collects no disks and has its own best score. Its share card carries no replay link.
- **A JUKEBOX** in the lobby (between the Quest Board and the Trophy Case): all 22 tracks of the soundtrack, unlocked by clearing the world they belong to (the boss, ending and seasonal tunes by beating the boss, the reboot and visiting in season). Pick one to play it in the lobby, AUTO returns to the usual music, and the music switch is on the first row. Your pick is remembered and plays whenever you come back to the lobby.
- **CLEAR SHAPES** (Settings, accessibility): a pattern on every BLOCK PARTY piece and a different shape for each colour of bullet in PENALTY STORM and THE HIGH SCORE, so colour is never the only clue.
- Fixed in review: the friend bonus could be farmed from an edited link, ULTRA's best mixed score formulas and its clock paused during line clears.
- Tests cover the link format, the friend bonus, titles, records, ULTRA and the save migration; a scripted player was used to set ULTRA's targets.


## 3.2.0 — vibration and a sound-effects switch
- **SOUND EFFECTS** can now be switched off on its own (Settings, and the pause menu), separately from the music switch and from MUTE ALL.
- **Vibration** on phones and tablets that support it: short buzzes for damage, bombs, boss slams, parries, level-ups, disks, power-ups and goals. It is deliberately sparing (no buzz for every coin or explosion), a weak buzz never cuts off a stronger one, and it works with the sound off. Switch it on or off in Settings or the pause menu (the row only appears on a touch device that can vibrate; iPhones cannot). Turning it on gives a test buzz.
- The pause menu now lists MUSIC, SOUND FX and VIBRATION and resizes to fit.
- Checked in a bug review: the vibration row toggles on a tap, a browser that blocks vibrate() cannot crash the game, and desktop browsers that have the function but no motor no longer show a dead row.

## 3.1.0 — two new worlds: BLOCK PARTY and BOLT BRIGADE
- **BLOCK PARTY** (falling-block puzzle, opens after two cleared worlds): seven pieces from a fair bag, hold, ghost piece, wall kicks, lock delay, combos, perfect clears and a score. Clear 30 lines (24 on Easy, 40 on Hard) to win; topping out costs a heart and clears the top of the well. Fusion BOMB BLOCKS (puzzle + shooter) turns every ninth piece into a bomb. New chaos events GRAVITY SURGE, RISING TIDE and LIGHTS OUT. Keyboard, the pad, or touch: drag to slide, drag down to soft drop, flick up to drop, tap to rotate, tap HOLD to hold. Disks at 10, 20 and 30 lines.
- **BOLT BRIGADE** (run-and-gun with robot masters, opens after three cleared worlds): pick FROSTBYTE, FLAREBOT, SPROUTRON or VOLTWIRE on a stage select, run a generated stage (pits, spikes, zaps, flame jets, walkers, hoppers, turrets and flyers), beat the master in its arena and keep its weapon. Charge the buster by holding fire; every master is weak to another master's weapon (ice beats fire, fire beats leaf, leaf beats volt, volt beats ice) for triple damage. Beat all four to open the FORTRESS, where they come back to back. Fusion BEAT BUSTER (shooter + rhythm) rewards shots fired on the beat. New chaos events BLACKOUT and STATIC JAM, and MOON PHYSICS now reaches this world. Disks hide in the first three stages. Touch: drag to run and jump, tap to shoot, hold to charge, second finger swaps weapons.
- The lobby holds nine cabinets now (names shortened where needed), floppy total is 27, trophies FOUR AT ONCE, SPOTLESS, ROBOT MASTER and FORTRESS BREAKER were added.
- Found and fixed in the same release by a bug check: robot-master wins no longer count as Core shards for the Manual's story (so did THE HIGH SCORE since 3.0.0); FLAREBOT's rain attack dropped one bullet, not six; stage layouts no longer repeat between FROSTBYTE and FLAREBOT on one seed; boss patterns and drops use separate seeded streams; a touch that began between pieces no longer yanks the next piece to the wall; holding a bomb piece keeps it a bomb; GENTLE WORLD and assist mode slow BLOCK PARTY; the stage select no longer runs the clock; particles no longer fade twice as fast in the newer worlds; GLASS CANNON doubles your damage in BOLT BRIGADE.
- Both worlds work with endless runs, perks, curses, mastery stars, assist mode and the seeded challenge links, and are covered by tests and scripted-player balance runs (a bot that clears every generated BOLT stage, and one that plays BLOCK PARTY with and without mistakes).

## 3.0.0 — THE HIGH SCORE and the big content update
- **THE HIGH SCORE**, the final boss, waits at the Cartridge Core once you have rebooted it. Three phases of bullet hell: ARCADE (aimed fans, rings and rain), FIGHT NIGHT (it guards, telegraphs column and row slams, then drops open for a counter) and SUDDEN DEATH (every pattern at once). Automatic shots, graze bullets to earn bombs, a score that counts down as it takes damage, a mercy-or-take-the-crown ending, new trophies NEW HIGH SCORE and PERFECT SCORE, and its own three music tracks. Fully playable with touch.
- **BOSS GAUNTLET** (unlocked by beating it): BRICKLORD MAX, DJ STATIC, the PENALTY STORM keeper in OVERTIME and THE HIGH SCORE back to back with health carried over; pays double bits. A loss on any later leg now pays what the earlier legs earned.
- **Run perks**: before each run and each endless round you pick one of three perks (14 of them: hearts, bits, XP, slower enemies, world-specific ones, and cursed ones that pay more and cost something) or skip. Daily and shared-seed runs never offer perks. Switch them off in Settings.
- **Mutation Lab**: three saved loadouts (BUILD A to C), and four CURSED mutations after the ending (PAWN SHOP, TURBO TERROR, STATIC STORM, PAPER HEART) that arrive switched off and pay +30% bits each.
- **Lobby errands**: each day one of Rex, Kevin, Madame Polygon or the Manual asks a favour (the same for everyone); finish it for bits and XP and talk to them again for a thank-you. A "!" marks whoever is asking.
- **A secret cabinet** (DEMO DASH, a runner for the developer's dog) powers on at the right edge of the lobby once any world has all three mastery stars.
- **Share cards**: SHARE CARD on the results screen makes a picture of the run and sends it to the phone's share sheet (or saves it, with a challenge link copied).
- **Lobby seasons** (Halloween weeks, winter lights, heart week, spring bloom, summer arcade): the lobby dresses up and plays seasonal music, and weekly goals pay 20% more.
- **A first-visit lobby tour** (four stops, skippable) for new players.
- **Sound pass**: new music for CORE COMMAND, the arcade, the boss phases and two seasons; new effects for kicks, goals, grazes, bombs, slams, perks and cards; the music dips when a chaos event is announced.
- **Fixes from a second big check**: the final boss's killing shot can no longer crash the game; double damage in NIGHTMARE, late ENDLESS rounds and PAWN SHOP now means damage you take in every world (before, it doubled the damage you deal in three of them); retrying a gauntlet no longer stacks old perks; XP perks apply to the whole run; GLITCH RHYTHM now honours speed perks, curses and the TURBO modifier; the title summary no longer counts the boss as an eighth world; the final boss respects REDUCED FLASHING for bomb flashes.

## 2.2.0 — weekly goals, lobby decor, assist mode and a big bug check
- **Weekly goals** on the Quest Board: three goals drawn from a pool of nine by the UTC week (the same for everyone, never two of a kind, reset every Monday), each paying bits and XP, plus a WEEKLY SWEEP bonus for finishing all three. They count runs, ENDLESS rounds, disks, stars, chaos events and mini-game rounds and points.
- **Lobby decor** at Madame Polygon: three floors (checkerboard, neon grid, confetti), three wall pieces (pennant bunting, fairy lights, glow stars) and three corner pairs (plants, lava lamps, speaker stacks). One item per slot; owned items swap for free.
- **ASSIST MODE** (Settings): one extra heart in every world and enemies and bullets 15% slower. Rewards are unchanged.
- Big bug check, with these fixes: ENDLESS RUN now keeps every round's bits, XP, time and damage (before, only the last two rounds counted) and no longer pays the new-disk reward again for a disk found in an earlier round; NEON PANIC and GLITCH RHYTHM get tougher in later endless rounds as promised; a PENALTY STORM shot still in the air when your last heart goes can no longer turn a loss into a win; volleys in PENALTY STORM no longer depend on what you do, so a seed is the same match for everyone; the keeper's pattern set can no longer repeat itself back to back; old saves with a very high pet counter no longer jump straight to GIGABYTE, and anyone already grown gets the evolution trophies; the BYTE menu cursor and BOND readout are right; the endless "best" reads the same everywhere; fewer per-frame allocations in PENALTY STORM, the pause menu and BYTE's sprite.

## 2.1.1 — touch detection
- Phones and tablets that only send pointer events (pen input, "desktop site" mode) are now recognised as touch on the first tap, so the on-screen pad appears and help text says A / B / C instead of Z / X / C. Before, those devices showed keyboard wording such as "HOLD X" with no X anywhere.

## 2.1.0 — endless runs, a growing BYTE and a seventh world
- **ENDLESS RUN** (cabinet menu of any cleared world): the same world again and again on fresh seeds, each round tougher (enemies, bullets and boss health scale up, chaos is cranked from round 3, damage doubles from round 5). One heart is patched up between rounds. Pause and BANK & END RUN to cash out. The payout grows with every round (full pay from round 5); personal bests are kept per world. New quest NO FINISH LINE and achievement NO END IN SIGHT.
- **BYTE evolves.** Lifetime care (feeding, fetch, treats) grows BYTE into KILOBYTE (15), MEGABYTE (40) and GIGABYTE (80), each with its own sprite, a +4% bits perk and a longer bark stun. Treats now keep working after bond 5. Outfits (hats, shades, scarf, cape, wings) are bought with bits from BYTE's new DRESS UP menu and show in the lobby, fetch and the mall. Older saves keep their growth.
- **PENALTY STORM**, the seventh world (opens after four cleared worlds): sports + bullet hell. Dribble a top-down pitch, dodge the keeper's five bullet patterns (fan, rain, spiral, ring, sweep) and score six goals; aim by running left or right as you kick. Get hit and the ball is knocked loose. New fusion SLAP SHOT (a ball in flight smashes bullets), chaos events CROSSWIND, MUD PITCH and MEGA KEEPER, the HAT TRICK achievement, mastery stars, its own music and a seeded plan per match. Balanced with scripted players.
- Floppy counts follow the number of worlds: 21 disks now (3 per world), and FULL BACKUP and the secret character need all of them. Anyone who already found the secret keeps it.
- The lobby now holds seven cabinets; the Shrine and Lab moved down a little so cabinet names are readable. The version shown on the title screen matches this log again.

## 2.0.2 — bug-check fixes
- Title screen: tapping no longer slips past the ERASE confirmation (only the YES button erases; anywhere else keeps your save), the first tap just starts the music, and the save summary counts all six worlds. Starting a new game also clears the lobby's cached quest/cabinet notices.
- Boss Rush: retrying after a loss in leg 2 restarts at leg 1, and floppies and flags earned in leg 1 carry through to the results.
- Results screen can be dismissed by tap or B; toasts age one at a time so none vanish unseen; level is recalculated after mastery-star and daily-challenge XP.
- Saves are validated field by field (records, pet, boss choices, key bindings, fixed seed) so a damaged save cannot poison scores with NaN.
- Wording: ARCADE REGULAR explains a score above zero is needed; one shared cabinet-lock hint; the daily menu cursor lands on a sensible row.

## 2.0.1 — result panel works with the D-pad
- The mini-game result panel now has a highlighted button: the D-pad (or arrow keys) switches between PLAY AGAIN and LOBBY, A uses the highlighted one, B or II still returns to the lobby, and tapping a button still works. Before, only A (always PLAY AGAIN), B and II did anything, so the arrows seemed dead.

## 2.0.0 — sixth world: CORE COMMAND
- A new cabinet in the lobby (opens after you clear three worlds; the daily challenge now uses one shared pool of worlds so everyone gets the same one each day): defend the Cartridge Core with BLASTER, WAVE and LASER towers along a seeded winding road, across eight waves ending in a boss glitch. From wave 5, SPITTERS fire stun shots at your towers (the bullet-hell turn). Cursor and keys, or tap a cell to aim and again to build; pick towers and send waves from a tappable bar.
- New fusion VETERAN TOWERS (strategy + RPG): towers earn XP from kills and level up by themselves. New mastery stars, quest and mini-profile entries apply to it like any world; the lobby now holds six cabinets.
- Balanced with scripted players: an undefended core always falls, careless placement mostly loses on Normal, sensible placement wins ~98% on Normal and ~65% on Hard.

## 1.10.0 — wardrobe
- Madame Polygon's shop has a WARDROBE: five outfits (colour schemes for Cass) and four hats (arcade cap, antenna, save-point halo, crown), bought with bits and worn everywhere, including dialogue portraits. Purely cosmetic; unowned or unknown items in a save are repaired.

## 1.9.0 — Boss Rush and Nightmare mode (after the ending)
- BOSS RUSH (lobby menu): BRICKLORD MAX straight into DJ STATIC, health carried over, bits +50%. Scores, time and damage are totalled on one results screen. New achievement RUSH HOUR.
- NIGHTMARE MODE (every cabinet): one less heart, double damage, chaos forced to high (unless you turned it off), bits pay double. New achievement SLEEPLESS.
- Both unlock when you restore the Cartridge Core.

## 1.8.0 — mastery stars
- Each world has three optional goals — UNTOUCHED (clear without damage), SPEEDY (beat the par time) and COLLECTOR (all three floppies) — shown as pips under its cabinet and listed in the cabinet menu. Each star pays 40 bits and XP once; new quest STAR COLLECTOR (6 stars).

## 1.7.0 — daily challenge and shareable runs
- DAILY CHALLENGE: a sign in the lobby (and the lobby menu) offers one seeded run a day: same world, seed and modifier for every player (UTC date). Clearing it pays a bonus that grows with your streak (up to +120 bits); your best score of the day and your streak are saved. New quest: DAILY GRINDER (clear 3 dailies).
- COPY CHALLENGE LINK builds a `?seed=…&mode=…` link; opening one adds FRIEND'S CHALLENGE to the daily menu so you play the identical run. Shared and daily runs always roll their modifier from the seed so everyone plays the same game.

## 1.6.5 — touch wording everywhere
- On phones, all on-screen text (dialogue, menus, hints, descriptions) now says the pad's button names: "HOLD X TO RUN" reads "HOLD B TO RUN", Z reads A, ESC reads II, ARROWS reads D-PAD, "ANY KEY" reads "ANY BUTTON". "RED X" (the Glitch Rhythm note) and single-letter art are left alone. Keyboard players see the original wording.

## 1.6.4 — calmer flashing
- The beat-bridge platforms in Retro Rampage warned of their change by flickering about 8 times a second; they now pulse about 3 times a second (and stay steady-bright with Reduced Flashing on). Invulnerability blinks, the INCOMING chaos warning, boss weak-point and warning marks, rhythm static bolts and Neon boost pads were all slowed to roughly 3-5 blinks a second. A test now fails if any on/off blink in a world is added faster than that.

## 1.6.3 — world quests start a world
- PLAY NOW on a world quest (BIT HOARDER, GAME CLEARER, UNTOUCHABLE, CHAOS TOURIST, SPEED DEMON, DISK DIVER) starts a world straight away (RETRO RAMPAGE for speed runs, otherwise your first uncleared world), with CHOOSE ANOTHER WORLD below it. It used to open another list first.

## 1.6.2 — quests you can play
- Every quest page now has a PLAY NOW button (the cursor starts on it): world quests open the world list, arcade quests start their mini-game directly (ARCADE ACE starts CART CATCH, BRICK BOSS starts BYTE BREAKOUT, and so on). Before, the page only had BACK to select.

## 1.6.1 — an easy way into the games
- The lobby menu (II / Esc) now starts with PLAY A WORLD, a list of every world with its status (NEW, CLEARED, LOCKED); pick one, then PLAY. It also links straight to the Quest Board and the Mini-Game Arcade, so you never have to walk anywhere to start playing.
- New players see a bouncing "START HERE" arrow over the first cabinet until they have played a run.

## 1.6.0 — two more mini-games, sturdier quest board
- WHACK-A-GLITCH (3×3 holes: bonk glitches, gold bugs are worth 3, never hit BYTE; arrows + A, or tap a hole) and STACK-A-CART (drop sliding cartridges onto a tower; perfect drops keep it wide; A or tap). Five arcade games now, twelve quests (new: GLITCH EXTERMINATOR, TOWER BUILDER), all balanced with simulated players to roughly 20-40 bits per minute.
- Quest Board rows open a detail page inside the menu (status, reward, BACK) instead of a dialogue box, so A, a tap, or II/back always works and returns to the same row. The Trophy Case uses the same pages, with readable text. The board's interact zone now covers the whole sprite.
- Mini-games end a round on ESC/P only (X is both "back" and "attack" on the keyboard, so it used to end rounds when pressed to play). Result panel buttons unchanged.
- Fixes: perfect-drop popups follow the scrolling tower; slab growth no longer drifts; critters rise out of their holes; tapping an info row no longer selects it.

## 1.5.1 — quest cards close in one press; version on the title screen
- Quest and Trophy Case info cards show their whole text at once, so one press (A, Enter or a tap) closes them and returns to the list; before, the first press only finished the typing effect, which made the board feel stuck.
- The title screen footer now shows the build version (e.g. V1.5.1) so you can tell whether your browser has the latest page.
- Touch gestures for the worlds (drag to move, drag up to jump, tap to attack/boost, lane touches in Glitch Rhythm) and their review fixes: lane slides retarget, a second finger takes over steering when the first lifts, button holds survive a tap, gestures reset when the app loses focus.

## 1.5.0 — touchscreen play without buttons (lobby and mini-games)
- Lobby: tap a person or machine to walk to it and use it, or tap open floor to walk there. The D-pad still takes over instantly.
- CART CATCH and BYTE BREAKOUT: drag a finger (or mouse) to steer, or tap a spot and the cartridge glides there; a tap also serves the ball. GLITCH MEMORY: tap the arrow pads. Result panels have PLAY AGAIN and LOBBY buttons.
- The worlds themselves still use the on-screen buttons.

## 1.4.4 — confirm works on every list row
- Pressing A / Z / Enter on a Quest Board quest or a Trophy Case entry (trophies, cast, bosses) now opens an info card with the full description, your progress and the reward, then returns to the same row. Before, those rows only showed their text at the bottom and ignored confirm.

## 1.4.3 — tap and click support
- Menus now respond to taps and mouse clicks, not only the D-pad: tap a row to select it, tap it again to activate (on sliders and toggles, the left or right half adjusts), tap outside a panel to go back, tap the panel's top or bottom edge to page. Works in the lobby kiosks and Quest Board, settings, title menu and pause menu; taps also advance dialogue, results and mini-game panels. Live gameplay ignores stray taps.

## 1.4.2 — automatic builds
- A `build` GitHub Actions workflow typechecks, tests and rebuilds the game on every push and pull request, and on `main` commits the refreshed root `index.html` so the published page can never fall behind the source.

## 1.4.1 — fix: game not loading on GitHub Pages
- The root `index.html` had become a source template pointing at `src/main.ts`, which browsers cannot run, so the published page showed an empty black screen. `npm run build` now also writes the finished game to the root `index.html`; the template lives in `index.template.html`. A test guards against committing the template as the root page again.

## 1.4.0 — third mini-game
- BYTE BREAKOUT joins the arcade: bounce the ball off your cartridge and smash a 10×5 brick wall (top row takes two hits, ball speeds up as the wall thins). Three lives, 90 seconds, 4 bits per 5 points, plus a BRICK BOSS quest (52+ points). Ten quests in total.
- Simulated players earn about 23-25 bits per minute in BYTE BREAKOUT, in line with the other mini-games.
- Review fixes found before release: one missed ball could cost several lives; serves now use a private RNG (fixed seed cannot make them repeatable); partial hits no longer speed the ball up; phantom paddle saves removed; a zero-score round no longer counts toward ARCADE REGULAR.

## 1.3.1 — reward balance
- Mini-games now pay about 20-27 bits per minute of play (measured with simulated players), below the ~45-60 bits per minute a normal run earns, so the arcade supplements the worlds without replacing them: CART CATCH 2 bits per 5 points, GLITCH MEMORY 4 bits per round.
- Quest tuning: BIT HOARDER now needs 400 paid bits (150 was one run), CHAOS TOURIST needs 5 events (Chaos NORMAL or HIGH), DISK DIVER pays 60 since floppies already pay, ARCADE ACE needs 50 points (about 1 in 3 for a decent player).

## 1.3.0 — quests and mini-games
- QUEST BOARD in the lobby: nine quests (clear without damage, speed clears, floppy hunting, chaos watching and more) that pay bits and XP automatically when finished. Progress is saved; a blinking "!" shows when something advanced.
- MINI-GAME ARCADE in the lobby: CART CATCH (30-second reflex game) and GLITCH MEMORY (growing arrow patterns). Both pay bits, track personal bests and feed the arcade quests. ESC ends a round early and banks your score.
- Review fixes: mini-games ignore the fixed-seed setting so patterns cannot be farmed; BIT HOARDER counts bits actually paid; quest rewards settle before level achievements; corrupt mini/quest save data is repaired.

## 1.2.0 — music switch
- Music can be turned on and off without touching volume: Settings → MUSIC, the pause menu, or the M key anywhere. Sound effects stay on. A ♪ button on the touch pad toggles it in one tap. The choice is saved.
- Depth: soft glow on bullet-hell bullets and light shading on the main character.

## 1.1.1 — second review pass
- Fixes: Settings opened from pause no longer lets the rhythm song run; Retro Rampage's floppy vault is no longer sealed when TRICK SHOT is off; chart blocks keep lane spacing and glitch separation across seams; the song clock advances on the game-over screen; iOS "interrupted" audio recovers; rebinding can no longer leave an action with no keys; touch users can cancel a remap with the pause button; the Manual's trust choice counts once; hub shop/pet menus keep the cursor after a purchase; hub core sparks no longer depend on refresh rate; sprite alpha is preserved for fades.
- NEW CABINET announcements now fire after a run unlocks a world (the lobby used to mark them as already seen).
- Depth: object and car shadows and pickup halos in Neon Panic, key/floppy/orb halos in Nightmare Mall.

## 1.1.0 — depth, arcade look and fixes
- Visuals: layered parallax and haze in Retro Rampage, a deeper Neon Panic horizon, wall faces and flashlight spill in Nightmare Mall, a lit hub, a deeper Boss Beatdown arena, gradient menus, sprite outlines and soft panel shadows.
- Arcade CRT is now drawn by the page at display resolution (even scanlines at any size); whole-number scaling keeps pixels uniform; screen shake is a smooth decaying wobble.
- Touch controls sit in their own gutter (below the screen in portrait, beside it in landscape) so they never cover the game.
- Fixes: chaos events cut short by death or phase changes now run their end hooks; pausing freezes the song clock; Chaos OFF is respected by the CHAOTIC modifier; FATAL EXCEPTION cannot start after a run ends; no dizzy lock or frozen blocks in Bricklord's bullet-hell phase; skill-check confirm no longer fires a boost; mall LOCKED popup throttled; key auto-repeat cannot become a rebind; events sharing a flag no longer stack.
- Repo: restored the `src/` layout and rebuilt the render and level-generation sources.

## 1.0.0 — first playable release
- Hub world (Lobby of Lost Saves) with cast, shop, virtual pet, Mutation Lab, Chaos Shrine, trophy case and the Cartridge Core.
- Five worlds: Retro Rampage (platformer → shmup), Neon Panic (racer → horror), Nightmare Mall (survival horror + pet), Boss Beatdown (fighter → bullet hell, vs Bricklord Max), Glitch Rhythm (rhythm + bullet hell, vs DJ Static).
- Genre Fusion engine with nine mutations; Chaos Director with 19 events in five categories.
- Seeded procedural levels, tracks, malls and charts with validators; shareable seeds.
- Progression: XP/levels, bits, 15 floppies, 20 achievements, abilities, boss choices, ending, rematches, replay modifiers, secret character.
- Accessibility: remapping, game speed, reduced flashing, shake slider, CRT toggle, chaos intensity, difficulty, audio controls.
- Procedural visuals and synthesized audio; zero external assets.
