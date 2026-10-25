# Changelog

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
