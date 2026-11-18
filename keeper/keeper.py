#!/usr/bin/env python3
"""Save Points keeper — runs on the always-on Mac mini.

Keeps a separate Google Chrome profile signed in to Sony and hands Save Points a fresh
PlayStation sign-in token (NPSSO) every day, so Darren never has to paste one.

  .venv/bin/python keeper.py --login   one-time: opens a browser window, Darren signs in to PlayStation himself
  .venv/bin/python keeper.py           daily (launchd): read the token in the background and send it to Save Points

Nothing secret is printed or logged. The token goes straight from Sony's page to
Save Points' psn-connect function over HTTPS, authenticated with the connect key in keeper/.env.
"""
import json, subprocess, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROFILE = HERE / "profile"  # the keeper's own Chrome profile, separate from Darren's normal one
CHROME_PATHS = [
    "/Volumes/Samsung SSD 980 PRO 2TB/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]
LOG = HERE / "keeper.log"
TOKEN_PAGE = "https://ca.account.sony.com/api/v1/ssocookie"
SIGN_IN_PAGE = "https://www.playstation.com/en-sg/"


def chrome() -> str | None:
    """Real Google Chrome (auto-updating, trusted by Sony's sign-in); None falls back to Playwright's Chromium."""
    return next((c for c in CHROME_PATHS if Path(c).exists()), None)


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    print(line)
    with LOG.open("a") as f:
        f.write(line + "\n")


def notify(msg: str) -> None:
    subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "Save Points"'], check=False)


def env() -> dict:
    return dict(l.strip().split("=", 1) for l in (HERE / ".env").read_text().splitlines() if "=" in l)


def read_token(headless: bool = True) -> str | None:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(PROFILE), headless=headless, executable_path=chrome())
        try:
            page = ctx.new_page()
            page.goto(SIGN_IN_PAGE, wait_until="domcontentloaded", timeout=45000)  # keeps the session in use
            page.goto(TOKEN_PAGE, wait_until="domcontentloaded", timeout=45000)
            try:
                return json.loads(page.inner_text("body")).get("npsso") or None
            except (json.JSONDecodeError, ValueError):
                return None
        finally:
            ctx.close()


def send(npsso: str) -> dict:
    e = env()
    req = urllib.request.Request(
        e["SP_URL"] + "/functions/v1/psn-connect", method="POST",
        data=json.dumps({"npsso": npsso}).encode(),
        headers={"Content-Type": "application/json", "x-sp-key": e["SP_CONNECT_KEY"]},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as err:
        return {"error": f"HTTP {err.code}", **json.loads(err.read() or b"{}")}


def login() -> int:
    from playwright.sync_api import sync_playwright
    PROFILE.mkdir(exist_ok=True)
    print("A browser window will open. Sign in to PlayStation there (top-right 'Sign In').")
    print("When you see you're signed in, close that browser window.")
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(PROFILE), headless=False, executable_path=chrome(), viewport={"width": 1100, "height": 800})
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(SIGN_IN_PAGE)
        check = ctx.new_page()  # background tab that watches for a finished sign-in
        try:
            while ctx.pages:  # until signed in, or Darren closes the window
                time.sleep(4)
                try:
                    check.goto(TOKEN_PAGE, wait_until="domcontentloaded", timeout=20000)
                    if json.loads(check.inner_text("body")).get("npsso"):
                        print("Signed in. Closing the window for you.")
                        break
                except Exception:
                    pass
        except Exception:
            pass
        try:
            ctx.close()
        except Exception:
            pass
    return run()


def run() -> int:
    token = read_token()
    if not token:
        log("Not signed in to PlayStation in the keeper browser.")
        notify("PlayStation sign-in needed. Run the keeper login once.")
        return 2
    result = send(token)
    if result.get("connected"):
        log(f"Sent a fresh sign-in to Save Points (valid until {result.get('expiresAt', '?')[:10]}).")
        return 0
    log(f"Save Points did not accept the sign-in: {result.get('error', 'unknown error')}")
    notify("Couldn't refresh the PlayStation connection. Check keeper.log.")
    return 1


if __name__ == "__main__":
    sys.exit(login() if "--login" in sys.argv else run())
