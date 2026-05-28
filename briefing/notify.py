"""
Send the briefing link to Telegram.

Reuses the bot token from ~/.hermes/.env if BRIEFING_TELEGRAM_BOT_TOKEN
isn't set, so the existing Hermes integration keeps working.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path


def _load_token() -> str | None:
    for var in ("BRIEFING_TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"):
        if os.environ.get(var):
            return os.environ[var]
    env_path = Path.home() / ".hermes" / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == "TELEGRAM_BOT_TOKEN":
                return v.strip()
    return None


def send_link(url: str, headline: str) -> bool:
    """Send a single message with the link. Returns True on success, False on any failure."""
    token = _load_token()
    if not token:
        print("[notify] No Telegram token; skipping send.")
        return False

    chat_id = int(os.environ.get("BRIEFING_CHAT_ID", "0") or 0)
    thread_id = os.environ.get("BRIEFING_THREAD_ID")

    if not chat_id:
        # Same supergroup as gate2_telegram.py; thread 314 = "submit approvals / Dobby updates".
        chat_id = -1003800236296

    text = f"<b>Briefing</b>\n{headline}\n\n<a href=\"{url}\">Open dashboard →</a>"

    payload: dict = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if thread_id:
        payload["message_thread_id"] = int(thread_id)

    try:
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            body = json.loads(r.read())
            if not body.get("ok"):
                print(f"[notify] Telegram error: {body}")
                return False
            return True
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"[notify] Telegram send failed: {e}")
        return False
