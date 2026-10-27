#!/usr/bin/env python3
"""Track Steam Hunters point changes for the games on one profile.

Each run snapshots every game on the profile. When a game's point value
differs from the last snapshot (i.e. Steam Hunters ran a recalculation),
it writes a report listing what went up or down and by how much.

  shtrack.py setup <steam profile URL | vanity name | SteamID64>
  shtrack.py check           # snapshot + report changes (run daily)
  shtrack.py last            # reprint the most recent report
  shtrack.py schedule [HH:MM]  # run `check` daily via launchd (default 09:00)
"""

__version__ = "0.1.0"

import json
import re
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

HOME = Path(__file__).resolve().parent
CONFIG = HOME / "config.json"
SNAPSHOTS = HOME / "snapshots"
REPORTS = HOME / "reports"
API = "https://steamhunters.com/api/steam-users/{}/licenses"
LABEL = "com.user.shtrack"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": f"shtrack/{__version__}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def resolve_steam_id(profile):
    profile = profile.strip().rstrip("/")
    m = re.search(r"(\d{17})$", profile)
    if m:
        return m.group(1)
    vanity = profile.split("/")[-1]
    xml = get(f"https://steamcommunity.com/id/{vanity}/?xml=1").decode()
    m = re.search(r"<steamID64>(\d{17})</steamID64>", xml)
    if not m:
        sys.exit(f"Couldn't resolve a Steam ID from {profile!r}")
    return m.group(1)


def fetch(steam_id):
    """{appid: {name, value, mine, unlocked, total}} for games that carry points."""
    data = json.loads(get(API.format(steam_id)))
    games = {}
    for appid, lic in data.items():
        app = lic["app"]
        if not app.get("achievementCount"):
            continue
        games[appid] = {
            "name": app.get("name") or f"App {appid}",
            "value": app.get("points", 0),
            "mine": lic.get("points", 0),
            "unlocked": lic.get("achievementUnlockCount", 0),
            "total": app["achievementCount"],
        }
    return games


def latest_snapshot():
    snaps = sorted(SNAPSHOTS.glob("*.json"))
    return (snaps[-1], json.loads(snaps[-1].read_text())) if snaps else (None, None)


def diff(old, new):
    rows = []
    for appid, g in new.items():
        o = old.get(appid)
        if o and o["value"] != g["value"]:
            rows.append({
                **g,
                "appid": appid,
                "old_value": o["value"],
                "d_value": g["value"] - o["value"],
                "old_mine": o["mine"],
                "d_mine": g["mine"] - o["mine"],
                "new_unlocks": g["unlocked"] - o["unlocked"],
            })
    return sorted(rows, key=lambda r: r["d_value"], reverse=True)


def fmt_delta(n):
    return f"{n:+,}" if n else "0"


def render(rows, old_name, stamp):
    up = [r for r in rows if r["d_value"] > 0]
    down = [r for r in rows if r["d_value"] < 0]
    my_total = sum(r["d_mine"] for r in rows)
    lines = [
        f"Steam Hunters point changes — {stamp} (vs {old_name})",
        f"{len(up)} up, {len(down)} down. Your points on these games: {fmt_delta(my_total)}",
        "",
    ]
    w = max([len(r["name"]) for r in rows] + [4])
    w = min(w, 50)
    header = f"{'Game':<{w}}  {'Value':>17}  {'Δ':>7}  {'Yours':>15}  {'Δ':>7}"
    for title, group in (("UP", up), ("DOWN", down)):
        if not group:
            continue
        lines += [title, header, "-" * len(header)]
        for r in group:
            note = f"  (+{r['new_unlocks']} unlocks)" if r["new_unlocks"] > 0 else ""
            lines.append(
                f"{r['name'][:w]:<{w}}  {r['old_value']:>7,} → {r['value']:<7,}  {fmt_delta(r['d_value']):>7}"
                f"  {r['old_mine']:>6,} → {r['mine']:<6,}  {fmt_delta(r['d_mine']):>7}{note}"
            )
        lines.append("")
    return "\n".join(lines)


def notify(msg):
    subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "Steam Hunters"'],
                   check=False, capture_output=True)


def cmd_setup(profile):
    steam_id = resolve_steam_id(profile)
    CONFIG.write_text(json.dumps({"steam_id": steam_id}, indent=1))
    print(f"Tracking SteamID {steam_id}. Taking the baseline snapshot…")
    cmd_check()


def cmd_check():
    if not CONFIG.exists():
        sys.exit("Run `shtrack.py setup <profile>` first.")
    steam_id = json.loads(CONFIG.read_text())["steam_id"]
    new = fetch(steam_id)
    if not new:
        sys.exit("Steam Hunters returned no games — is the profile public and synced on Steam Hunters?")

    SNAPSHOTS.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    old_path, old = latest_snapshot()

    if old is None:
        (SNAPSHOTS / f"{stamp}.json").write_text(json.dumps(new))
        print(f"Baseline saved: {len(new)} games with achievements.")
        return

    rows = diff(old, new)
    # Always roll the snapshot forward so your own unlocks/new games don't pile up as noise.
    (SNAPSHOTS / f"{stamp}.json").write_text(json.dumps(new))
    if not rows:
        print(f"No point value changes since {old_path.stem}.")
        return

    report = render(rows, old_path.stem, stamp)
    (REPORTS / f"{stamp}.txt").write_text(report)
    print(report)
    up = sum(r["d_value"] > 0 for r in rows)
    notify(f"Points recalculated: {up} up, {len(rows) - up} down. Run shtrack last")


def cmd_last():
    reports = sorted(REPORTS.glob("*.txt"))
    print(reports[-1].read_text() if reports else "No changes recorded yet.")


def cmd_schedule(at="09:00"):
    hour, minute = (int(x) for x in at.split(":"))
    plist = Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist"
    plist.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>{LABEL}</string>
 <key>ProgramArguments</key><array>
  <string>/usr/bin/python3</string><string>{HOME / 'shtrack.py'}</string><string>check</string>
 </array>
 <key>StartCalendarInterval</key><dict>
  <key>Hour</key><integer>{hour}</integer><key>Minute</key><integer>{minute}</integer>
 </dict>
 <key>StandardOutPath</key><string>{HOME / 'shtrack.log'}</string>
 <key>StandardErrorPath</key><string>{HOME / 'shtrack.log'}</string>
</dict></plist>
""")
    subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
    subprocess.run(["launchctl", "load", str(plist)], check=True)
    print(f"Scheduled daily at {at} (missed runs fire on next wake). Log: {HOME / 'shtrack.log'}")


def main(argv):
    cmd, *args = argv or ["check"]
    commands = {"setup": cmd_setup, "check": cmd_check, "last": cmd_last, "schedule": cmd_schedule}
    if cmd not in commands:
        sys.exit(__doc__)
    commands[cmd](*args)


if __name__ == "__main__":
    main(sys.argv[1:])
