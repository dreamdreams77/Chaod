"""Captures screenshots of key UI states for visual review (and the README)."""
import sys, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / "docs" / "screenshots")
out.mkdir(parents=True, exist_ok=True)
url = (root / "dist" / "index.html").as_uri()
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 960, "height": 540})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    ev = pg.evaluate
    def press(a):
        ev(f"__chaos.press('{a}',true)"); pg.wait_for_timeout(50); ev(f"__chaos.press('{a}',false)"); pg.wait_for_timeout(50)
    def shot(n): pg.screenshot(path=str(out / f"{n}.png"))
    pg.goto(url); pg.wait_for_timeout(500)
    pg.keyboard.press("Enter"); pg.wait_for_timeout(200); pg.keyboard.press("Enter"); pg.wait_for_timeout(1500)
    press("confirm"); pg.wait_for_timeout(700); shot("hub_dialog")
    for _ in range(20): press("confirm")
    ev("__chaos.game.scene.shopMenu()"); pg.wait_for_timeout(300); shot("hub_shop")
    ev("__chaos.game.scene.menu=null; __chaos.game.scene.labMenu()"); pg.wait_for_timeout(300); shot("hub_lab")
    ev("__chaos.game.scene.menu=null")
    # Rampage: beat bridge, switch room, chaos events
    ev("__chaos.start('rampage')"); pg.wait_for_timeout(1500)
    ev("(()=>{const s=__chaos.game.scene;const i=s.level.plan.indexOf('beat');s.px=(i*16+1)*16;s.py=13*16-22;s.camX=s.px-60;})()")
    pg.wait_for_timeout(900); shot("rampage_beat")
    ev("(()=>{const s=__chaos.game.scene;const i=s.level.plan.indexOf('switch_room');s.px=(i*16+5)*16;s.py=10*16-22;})()")
    pg.wait_for_timeout(900); shot("rampage_switch")
    # force specific events through the director's internal start()
    ev("""(()=>{window.__force=(id)=>{const s=__chaos.game.scene,d=s.director;d.clearAll();
      const def=__chaos.events.find(e=>e.id===id); d['start'](def,s.directorContext()); d.active[0].timer=0.01;};})()""")
    for eid in ["giant", "kevin_bug", "note_floor"]:
        ev(f"__force('{eid}')"); pg.wait_for_timeout(700); shot(f"chaos_{eid}")
    ev("__force('fatal_exception')"); pg.wait_for_timeout(700); shot("chaos_fatal")
    for _ in range(8): press("left")
    pg.wait_for_timeout(1500)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300); shot("pause")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    ev("__chaos.start('neon')"); pg.wait_for_timeout(4500)
    ev("__force('mecha_mode')"); pg.wait_for_timeout(800); shot("chaos_mecha")
    ev("__chaos.start('mall')"); pg.wait_for_timeout(1200)
    for _ in range(6): press("confirm")
    ev("__force('power_surge')"); pg.wait_for_timeout(800); shot("chaos_power_surge")
    b.close()
print("\n".join(errs) if errs else "gallery OK")
