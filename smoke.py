"""Browser smoke test: loads dist/index.html in headless Chromium, walks through
title -> hub -> every mode, simulates input, captures screenshots and fails on
any console error or uncaught exception.

Usage: python3 scripts/smoke.py [outdir]
Requires: pip install playwright && playwright install chromium
"""
import sys, os, pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / "smoke-out")
out.mkdir(parents=True, exist_ok=True)
url = (root / "dist" / "index.html").as_uri()

errors = []

def shot(page, name):
    page.screenshot(path=str(out / f"{name}.png"))

def hold(page, action, ms):
    page.evaluate(f"__chaos.press('{action}', true)")
    page.wait_for_timeout(ms)
    page.evaluate(f"__chaos.press('{action}', false)")

def tap(page, action, n=1, gap=120):
    for _ in range(n):
        hold(page, action, 60)
        page.wait_for_timeout(gap)

def skip_dialog(page, n=12):
    for _ in range(n):
        if not page.evaluate("__chaos.game.inDialog"):
            return
        tap(page, "confirm", 1, 80)
        tap(page, "confirm", 1, 80)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 960, "height": 540})
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(url)
    page.wait_for_timeout(800)
    shot(page, "01_title")
    page.keyboard.press("Enter")  # any key / confirm -> NEW GAME is first when no save
    page.wait_for_timeout(300)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)
    shot(page, "02_hub_intro")
    skip_dialog(page, 20)
    page.wait_for_timeout(300)
    shot(page, "03_hub")
    assert page.evaluate("__chaos.scene()") == "hub", page.evaluate("__chaos.scene()")

    def run_mode(mode, actions, seconds, label):
        page.evaluate(f"__chaos.start('{mode}')")
        page.wait_for_timeout(900)
        skip_dialog(page)
        page.wait_for_timeout(300)
        for i in range(seconds):
            for a, ms in actions:
                hold(page, a, ms)
            if i == 1:
                shot(page, f"{label}_a")
            skip_dialog(page, 3)
        shot(page, f"{label}_b")
        sc = page.evaluate("__chaos.scene()")
        page.evaluate("__chaos.hub()")
        page.wait_for_timeout(900)
        skip_dialog(page)
        return sc

    print("rampage ->", run_mode("rampage", [("right", 500), ("jump", 200), ("attack", 60), ("special", 60)], 8, "10_rampage"))
    print("neon    ->", run_mode("neon", [("right", 150), ("left", 150), ("jump", 60)], 10, "20_neon"))
    print("mall    ->", run_mode("mall", [("right", 400), ("down", 300), ("special", 60)], 6, "30_mall"))
    print("beat    ->", run_mode("beatdown", [("right", 200), ("attack", 60), ("attack", 60), ("attack", 60), ("special", 60)], 8, "40_beatdown"))
    print("rhythm  ->", run_mode("rhythm", [("left", 50), ("down", 50), ("up", 50), ("right", 50)], 8, "50_rhythm"))

    # Settings screen renders and navigates
    page.evaluate("__chaos.game.goto(__chaos.game.settingsFactory(() => __chaos.game.hubFactory()))")
    page.wait_for_timeout(800)
    tap(page, "down", 4)
    tap(page, "right", 1)
    shot(page, "60_settings")
    browser.close()

print(f"screenshots -> {out}")
if errors:
    print("ERRORS:")
    for e in errors:
        print("  ", e)
    sys.exit(1)
print("smoke OK: no console errors")
