#!/usr/bin/env python3
"""
Briefing orchestrator — the cron entrypoint.

Run every 3 hours from launchd. Pulls each data source, computes deltas
against the last snapshot, renders HTML, writes it to BRIEFING_OUT_DIR,
and posts a Telegram link.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Allow running as `python orchestrator.py` from anywhere.
sys.path.insert(0, str(Path(__file__).parent))

import fetchers  # noqa: E402
import notify  # noqa: E402
import render  # noqa: E402


STATE_DIR = Path(os.environ.get("BRIEFING_STATE_DIR", str(Path.home() / ".briefing" / "state")))
OUT_DIR = Path(os.environ.get("BRIEFING_OUT_DIR", str(Path.home() / "Briefings")))
PUBLIC_BASE = os.environ.get("BRIEFING_PUBLIC_BASE", "").rstrip("/")


def _load_env_file(path: Path) -> None:
    """Tiny .env loader (no python-dotenv dep)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def _window_label(now: datetime) -> str:
    if now.hour < 12:
        slot = "morning"
    elif now.hour < 17:
        slot = "afternoon"
    else:
        slot = "evening"
    return f"{now.strftime('%a')} {slot} · {now.strftime('%-I:%M %p')} MT"


def _next_briefing_time(now: datetime) -> str:
    nxt = now + timedelta(hours=3)
    return nxt.strftime("%-I:%M %p")


def _load_last_snapshot() -> dict | None:
    last_path = STATE_DIR / "last.json"
    if not last_path.exists():
        return None
    try:
        return json.loads(last_path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def _save_snapshot(data: dict, briefing_id: str) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / "last.json").write_text(json.dumps(data, default=str, indent=2))
    # Archive for history; cap to last 24.
    archive = STATE_DIR / f"{briefing_id}.json"
    archive.write_text(json.dumps(data, default=str, indent=2))
    archives = sorted(STATE_DIR.glob("[0-9]*.json"))
    for old in archives[:-24]:
        old.unlink(missing_ok=True)


def main() -> int:
    _load_env_file(Path.home() / ".briefing" / ".env")

    now = datetime.now()
    briefing_id = now.strftime("%Y%m%d-%H%M")

    print(f"[briefing {briefing_id}] fetching…")
    data = fetchers.fetch_all()

    prev = _load_last_snapshot()
    print(f"[briefing {briefing_id}] rendering (prev={'yes' if prev else 'cold start'})…")
    html = render.render(
        data=data,
        prev=prev,
        briefing_id=briefing_id,
        window_label=_window_label(now),
        next_briefing_time=_next_briefing_time(now),
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_file = OUT_DIR / f"briefing-{briefing_id}.html"
    out_file.write_text(html)

    # Latest symlink for stable URL.
    latest = OUT_DIR / "latest.html"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    latest.symlink_to(out_file.name)

    _save_snapshot(data, briefing_id)

    headline = ""
    # Cheap way to surface the headline for notify without re-rendering.
    for line in html.splitlines():
        if "data-headline" in line:
            # naive extract between > and <
            try:
                headline = line.split(">", 1)[1].rsplit("<", 1)[0].strip()
            except IndexError:
                pass
            break

    public_url = f"{PUBLIC_BASE}/latest.html" if PUBLIC_BASE else f"file://{out_file}"
    dry_run = "--dry-run" in sys.argv or os.environ.get("BRIEFING_DRY_RUN") == "1"
    if dry_run:
        sent = False
        print(f"[briefing {briefing_id}] notify=dry-run url={public_url}")
    else:
        sent = notify.send_link(public_url, headline or "Briefing ready")
        print(f"[briefing {briefing_id}] notify={'sent' if sent else 'skipped'} url={public_url}")

    print(f"[briefing {briefing_id}] wrote {out_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
