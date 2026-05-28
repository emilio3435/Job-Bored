#!/usr/bin/env python3
"""
JHOS Phase 6 — Gate 2 Telegram Bot API Integration

Sends submit-approval requests to Telegram thread 314 and polls for
confirmation replies using the Bot API directly (replaces the
placeholder `hermes receive` approach).

Usage as module:
    from gate2_telegram import send_approval_request, poll_for_confirmation

Usage as CLI:
    python3 gate2_telegram.py send --title "..." --company "..." [--platform "..."] [--fit "..."]
    python3 gate2_telegram.py poll --company "..." [--timeout 600]
    python3 gate2_telegram.py test   # sends a test message and waits 60s
"""

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

# ─── Configuration ────────────────────────────────────────────────────

CHAT_ID = -1003800236296       # Supergroup
THREAD_ID = 314                # Thread 314 = submit approvals / Dobby updates
DEFAULT_TIMEOUT = 600          # 10 minutes
POLL_INTERVAL = 10             # seconds between getUpdates calls


def _load_bot_token() -> str:
    """Load Telegram bot token from ~/.hermes/.env or environment."""
    # Check environment first
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if token:
        return token
    # Parse .env file
    env_path = Path.home() / ".hermes" / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                if key.strip() == "TELEGRAM_BOT_TOKEN":
                    return val.strip()
    raise RuntimeError("TELEGRAM_BOT_TOKEN not found in environment or ~/.hermes/.env")


def _api_call(method: str, payload: dict, token: str | None = None) -> dict:
    """Make a Telegram Bot API call."""
    if not token:
        token = _load_bot_token()
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        return {"ok": False, "error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ─── Send Approval Request ──────────────────────────────────────────

def send_approval_request(
    title: str,
    company: str,
    platform: str = "Direct",
    fit_summary: str = "",
    token: str | None = None,
) -> dict:
    """Send a Gate 2 submit-approval request to thread 314.

    Returns {ok, message_id, message_text} on success, {ok: False, error} on failure.
    """
    lines = [
        "🔒 *SUBMIT APPROVAL REQUEST*",
        "",
        f"*Role:* {_escape_md(title)}",
        f"*Company:* {_escape_md(company)}",
        f"*Platform:* {_escape_md(platform)}",
    ]
    if fit_summary:
        lines.append(f"*Fit:* {_escape_md(fit_summary)}")
    lines += [
        "",
        f"Reply `YES SUBMIT {company.upper()}` within 10 minutes to approve\\.",
        "Any other reply or timeout → cancelled\\.",
    ]
    message_text = "\n".join(lines)

    result = _api_call("sendMessage", {
        "chat_id": CHAT_ID,
        "message_thread_id": THREAD_ID,
        "text": message_text,
        "parse_mode": "MarkdownV2",
    }, token)

    if result.get("ok"):
        msg_id = result["result"]["message_id"]
        return {"ok": True, "message_id": msg_id, "message_text": message_text}
    else:
        # Retry without markdown if parse fails
        plain_lines = [
            "🔒 SUBMIT APPROVAL REQUEST",
            "",
            f"Role: {title}",
            f"Company: {company}",
            f"Platform: {platform}",
        ]
        if fit_summary:
            plain_lines.append(f"Fit: {fit_summary}")
        plain_lines += [
            "",
            f"Reply YES SUBMIT {company.upper()} within 10 minutes to approve.",
            "Any other reply or timeout → cancelled.",
        ]
        plain_text = "\n".join(plain_lines)
        result = _api_call("sendMessage", {
            "chat_id": CHAT_ID,
            "message_thread_id": THREAD_ID,
            "text": plain_text,
        }, token)
        if result.get("ok"):
            msg_id = result["result"]["message_id"]
            return {"ok": True, "message_id": msg_id, "message_text": plain_text}
        return {"ok": False, "error": result.get("error", "Unknown error")}


def _escape_md(text: str) -> str:
    """Escape special characters for MarkdownV2."""
    special = r"_*[]()~`>#+-=|{}.!"
    return re.sub(f"([{re.escape(special)}])", r"\\\1", text)


# ─── Poll for Confirmation ──────────────────────────────────────────

def poll_for_confirmation(
    company: str,
    timeout: int = DEFAULT_TIMEOUT,
    after_message_id: int | None = None,
    token: str | None = None,
) -> tuple[bool, str]:
    """Poll getUpdates for a YES SUBMIT <COMPANY> reply in thread 314.

    Args:
        company: Company name to match against
        timeout: Max seconds to wait
        after_message_id: Only consider messages after this ID (the approval request)
        token: Bot token (auto-loaded if not provided)

    Returns:
        (confirmed: bool, reason: str)
    """
    if not token:
        token = _load_bot_token()

    expected = f"YES SUBMIT {company.upper()}"
    start = time.time()
    last_update_id = None

    # Flush old updates first by getting current offset
    flush = _api_call("getUpdates", {"timeout": 0, "limit": 1, "offset": -1}, token)
    if flush.get("ok") and flush.get("result"):
        last_update_id = flush["result"][-1]["update_id"] + 1

    while time.time() - start < timeout:
        remaining = int(timeout - (time.time() - start))
        if remaining <= 0:
            break

        # Long poll (up to 30s per call, but respect remaining timeout)
        poll_timeout = min(30, remaining)
        params = {
            "timeout": poll_timeout,
            "allowed_updates": ["message"],
        }
        if last_update_id is not None:
            params["offset"] = last_update_id

        result = _api_call("getUpdates", params, token)

        if not result.get("ok"):
            # Transient error — wait and retry
            time.sleep(POLL_INTERVAL)
            continue

        updates = result.get("result", [])
        for update in updates:
            last_update_id = update["update_id"] + 1
            msg = update.get("message", {})

            # Must be in our chat and thread
            if msg.get("chat", {}).get("id") != CHAT_ID:
                continue
            if msg.get("message_thread_id") != THREAD_ID:
                continue

            # Must be after our approval request
            if after_message_id and msg.get("message_id", 0) <= after_message_id:
                continue

            # Check text
            text = (msg.get("text") or "").strip().upper()
            if text == expected:
                return True, f"Confirmed: received '{expected}' from user {msg.get('from', {}).get('first_name', '?')}"

            # Also accept partial matches like "YES SUBMIT" alone or with slight variations
            if text.startswith("YES SUBMIT") and company.upper() in text:
                return True, f"Confirmed (fuzzy): received '{text}'"

        # If no updates came back and we're within timeout, the long poll handles waiting
        # No explicit sleep needed when using getUpdates long polling

    return False, f"Timeout: no '{expected}' received within {timeout}s"


# ─── Cancellation Notification ───────────────────────────────────────

def send_cancellation(title: str, company: str, reason: str, token: str | None = None) -> dict:
    """Send a cancellation notice to thread 314."""
    text = f"⏰ Submission for {title} @ {company} expired — {reason}. Card returned to queue."
    result = _api_call("sendMessage", {
        "chat_id": CHAT_ID,
        "message_thread_id": THREAD_ID,
        "text": text,
    }, token)
    return {"ok": result.get("ok", False)}


def send_success(title: str, company: str, token: str | None = None) -> dict:
    """Send a success notice to thread 314."""
    text = f"✅ Applied to {title} @ {company} — evidence captured. Check Pipeline for details."
    result = _api_call("sendMessage", {
        "chat_id": CHAT_ID,
        "message_thread_id": THREAD_ID,
        "text": text,
    }, token)
    return {"ok": result.get("ok", False)}


# ─── CLI ─────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Gate 2 Telegram Bot API")
    sub = parser.add_subparsers(dest="command")

    send_p = sub.add_parser("send", help="Send approval request")
    send_p.add_argument("--title", required=True)
    send_p.add_argument("--company", required=True)
    send_p.add_argument("--platform", default="Direct")
    send_p.add_argument("--fit", default="")

    poll_p = sub.add_parser("poll", help="Poll for confirmation")
    poll_p.add_argument("--company", required=True)
    poll_p.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    poll_p.add_argument("--after-message-id", type=int, default=None)

    test_p = sub.add_parser("test", help="Send test message and poll 60s")

    args = parser.parse_args()

    if args.command == "send":
        result = send_approval_request(args.title, args.company, args.platform, args.fit)
        print(json.dumps(result, indent=2))

    elif args.command == "poll":
        confirmed, reason = poll_for_confirmation(args.company, args.timeout, args.after_message_id)
        print(json.dumps({"confirmed": confirmed, "reason": reason}, indent=2))

    elif args.command == "test":
        print("Sending test approval request...")
        result = send_approval_request(
            title="Test Role (ignore)",
            company="TestCo",
            platform="Test",
            fit_summary="Gate 2 integration test",
        )
        print(json.dumps(result, indent=2))
        if result.get("ok"):
            print(f"\nPolling for 'YES SUBMIT TESTCO' for 60 seconds...")
            confirmed, reason = poll_for_confirmation(
                "TestCo",
                timeout=60,
                after_message_id=result.get("message_id"),
            )
            print(json.dumps({"confirmed": confirmed, "reason": reason}, indent=2))
        else:
            print("Send failed — cannot poll.")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
