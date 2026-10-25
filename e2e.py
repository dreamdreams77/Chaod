"""End-to-end campaign test: drives every world to its win state (using the
__chaos automation hook to skip the skill parts), checks progression, the
boss choices, the ending, and runs a rhythm "perfect bot" to verify judging.

Usage: python3 scripts/e2e.py [outdir]   (after `npm run build`)
"""
import sys, pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / "smoke-out")
out.mkdir(parents=True, exist_ok=True)
url = (root / "dist" / "index.html").as_uri()
errors, checks = [], []

def check(cond, msg):
    checks.append((bool(cond), msg))
    print(("PASS " if cond else "FAIL ") + msg)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 960, "height": 540})
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_timeout(600)
    ev = page.evaluate
    shot = lambda n: page.screenshot(path=str(out / f"e2e_{n}.png"))

    def press(a, ms=50):
        ev(f"__chaos.press('{a}', true)"); page.wait_for_timeout(ms); ev(f"__chaos.press('{a}', false)"); page.wait_for_timeout(40)

    def wait_scene(name, timeout=8000):
        for _ in range(timeout // 100):
            if ev("__chaos.scene()") == name and not ev("!!__chaos.game.transition"):
                return True
            page.wait_for_timeout(100)
        return False

    def drain_dialog(choice_down=0, limit=40):
        for _ in range(limit):
            if not ev("__chaos.game.inDialog"):
                return
            d = ev("(()=>{const d=__chaos.game.dialog;const l=d.lines[d.index];return {c:!!l.choices,full:d.chars>=l.text.length}})()")
            if d["c"] and d["full"]:
                for _ in range(choice_down):
                    press("down")
            press("confirm")

    def results_to_hub():
        check(wait_scene("results"), "results screen shown")
        page.wait_for_timeout(1200)
        press("confirm")
        wait_scene("hub")
        drain_dialog()

    page.keyboard.press("Enter"); page.wait_for_timeout(200); page.keyboard.press("Enter")
    wait_scene("hub"); drain_dialog()

    # 1. RETRO RAMPAGE: walk in, cross into the SHMUP genre shift, land, reach exit
    ev("__chaos.start('rampage')"); wait_scene("rampage")
    page.wait_for_timeout(1500); shot("rampage_start")
    ev("(()=>{const s=__chaos.game.scene;s.px=s.level.shmup.startCol*16+20;s.py=100;})()")
    page.wait_for_timeout(2500); shot("rampage_shmup")
    check(ev("__chaos.game.scene.ship") is True, "rampage mutates into a shmup mid-level")
    ev("(()=>{const s=__chaos.game.scene;s.camX=s.level.shmup.endCol*16-480+45;})()")
    page.wait_for_timeout(1500)
    check(ev("__chaos.game.scene.ship") is False, "shmup segment hands back to platformer")
    ev("(()=>{const s=__chaos.game.scene;s.px=s.exitX+3;s.py=s.exitY-6;s.vy=0;})()")
    page.wait_for_timeout(300); shot("rampage_exit")
    results_to_hub()
    check(ev("__chaos.game.profile.cleared.rampage.clears") == 1, "rampage clear saved")

    # 2. NEON PANIC: midnight horror shift, then finish ahead of Rex
    ev("__chaos.start('neon')"); wait_scene("neon"); page.wait_for_timeout(4200)
    ev("(()=>{const s=__chaos.game.scene;s.pos=(s.track.midnightSeg-12)*200;s.speed=5000;})()")
    page.wait_for_timeout(2500); shot("neon_midnight")
    check(ev("__chaos.game.scene.midnight") is True, "neon mutates into horror at midnight")
    ev("(()=>{const s=__chaos.game.scene;s.pos=s.finishZ-300;s.rexZ=0;s.lurkerZ=-1e6;})()")
    page.wait_for_timeout(3500)
    results_to_hub()
    check("beat_rex" in ev("__chaos.game.profile.achievements"), "beat-rex achievement")
    check("beat_boost" in ev("__chaos.game.profile.mutationsUnlocked"), "clearing neon unlocks BASS BOOST mutation")

    # 3. NIGHTMARE MALL: collect keys, escape
    ev("__chaos.start('mall')"); wait_scene("mall"); drain_dialog(); page.wait_for_timeout(1500); shot("mall")
    ev("(()=>{const s=__chaos.game.scene;s.keys=3;s.px=s.map.exit.x*16+8;s.py=s.map.exit.y*16+8;s.mx=16*3;s.my=16*3;})()")
    page.wait_for_timeout(2600)
    results_to_hub()
    check(ev("__chaos.game.profile.cleared.mall.clears") == 1, "mall clear saved")

    # 4. BOSS BEATDOWN: force phase 2 (block rain), phase 3 (bullet hell), defeat, SET FREE
    ev("__chaos.start('beatdown')"); wait_scene("beatdown"); drain_dialog(); page.wait_for_timeout(2600)
    ev("(()=>{const s=__chaos.game.scene;s.bHp=s.bMaxHp*0.6+1;s.damageBoss(2);})()")
    page.wait_for_timeout(4500); shot("beatdown_phase2")
    check(ev("__chaos.game.scene.phase") == 2, "bricklord phase 2")
    ev("(()=>{const s=__chaos.game.scene;s.bHp=s.bMaxHp*0.25+1;s.damageBoss(2);})()")
    page.wait_for_timeout(3000); shot("beatdown_bullethell")
    check(ev("__chaos.game.scene.phase") == 3, "bricklord changes genre to bullet hell")
    ev("__chaos.game.scene.damageBoss(9999)")
    page.wait_for_timeout(3200); shot("beatdown_ko")
    drain_dialog(choice_down=0)
    results_to_hub()
    check("bricklord" in ev("__chaos.game.profile.bossesDefeated"), "bricklord defeated saved")
    check(ev("__chaos.game.profile.bossChoices.bricklord") == "mercy", "mercy choice saved")

    # 5. GLITCH RHYTHM: perfect bot for ~12s, then phases + defeat, DELETE choice
    ev("__chaos.start('rhythm')"); wait_scene("rhythm"); drain_dialog()
    ev("""(()=>{const g=__chaos.game;const acts=['left','down','up','right'];
      window.__bot=setInterval(()=>{const s=g.scene;if(s.id!=='rhythm'||s.intro)return;const b=s.beatNow();
        for(const n of s.notes){if(n.judged||n.kind==='glitch')continue;const off=s.beatToSec(n.beat-b);
          if(off<0.012&&off>-0.03){const a=acts[s.perm[n.lane]];g.input.setVirtual(a,true);setTimeout(()=>g.input.setVirtual(a,false),n.kind==='hold'?s.beatToSec(n.len)*1000+60:30);}}},4);})()""")
    page.wait_for_timeout(12000); shot("rhythm_bot")
    c = ev("__chaos.game.scene.counts")
    print("rhythm bot counts", c, "combo", ev("__chaos.game.scene.maxCombo"))
    check(c["PERFECT"] + c["GREAT"] >= 8 and c["MISS"] <= 2, "rhythm judging: on-time presses grade PERFECT/GREAT")
    ev("clearInterval(window.__bot)")
    ev("(()=>{const s=__chaos.game.scene;s.bHp=s.bMaxHp*0.6+0.1;s.hitBoss(1);})()")
    page.wait_for_timeout(1500)
    ev("(()=>{const s=__chaos.game.scene;s.bHp=s.bMaxHp*0.25+0.1;s.hitBoss(1);})()")
    page.wait_for_timeout(2500); shot("rhythm_phase3")
    check(ev("__chaos.game.scene.phase") == 3 and abs(ev("__chaos.game.audio.bpm") - 138) < 1, "rhythm phase 3 doubles down on tempo")
    ev("__chaos.game.scene.hitBoss(9999)")
    page.wait_for_timeout(3000)
    drain_dialog(choice_down=1)
    results_to_hub()
    check(ev("__chaos.game.profile.bossChoices.static") == "purge", "purge choice saved")

    # 6. Ending at the Cartridge Core
    ev("__chaos.game.scene.core()")
    drain_dialog()
    check(wait_scene("ending"), "ending scene plays after two shards")
    page.wait_for_timeout(3500); shot("ending")
    check(ev("__chaos.game.profile.endingSeen") is True, "ending flag saved")
    page.keyboard.press("Enter"); wait_scene("hub"); page.wait_for_timeout(800); shot("hub_after")
    saved = ev("JSON.parse(localStorage.getItem('chaos.exe/profile'))")
    check(saved and saved["endingSeen"] and len(saved["achievements"]) >= 6, f"profile persisted ({len(saved['achievements'])} achievements)")
    browser.close()

failed = [m for ok, m in checks if not ok]
if errors:
    print("CONSOLE ERRORS:", *errors, sep="\n  ")
if failed or errors:
    sys.exit(1)
print(f"e2e OK ({len(checks)} checks)")
