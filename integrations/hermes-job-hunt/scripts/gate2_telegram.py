#!/usr/bin/env python3
"""
JHOS Phase 6 — Gate 2 Telegram Bot API Integration

Sends submit-approval requests to the Gate 2 Telegram thread from
approval-contract.v1.json and polls for confirmation replies using the
Bot API directly (replaces the placeholder `hermes receive` approach).

Usage as module:
    from gate2_telegram import send_approval_request, poll_for_confirmation

Usage as CLI:
    python3 gate2_telegram.py send --title "..." --company "..." [--platform "..."] [--fit "..."]
    python3 gate2_telegram.py poll --company "..." --after-message-id <request id> [--timeout 600]
    python3 gate2_telegram.py test   # sends a test message and waits 60s
"""

from __future__ import annotations

import json
import re
import sys
import time

import jhos_common
from approval_contract import (
    GATE2_APPROVER_USER_IDS,
    GATE2_CHAT_ID,
    GATE2_CONFIRMATION_PREFIX,
    GATE2_POLL_INTERVAL_SECONDS,
    GATE2_THREAD_ID,
    GATE2_TIMEOUT_SECONDS,
)

# ─── Configuration (approval-contract.v1.json + local override) ───────

CHAT_ID = GATE2_CHAT_ID
THREAD_ID = GATE2_THREAD_ID
APPROVER_USER_IDS = GATE2_APPROVER_USER_IDS
DEFAULT_TIMEOUT = GATE2_TIMEOUT_SECONDS
POLL_INTERVAL = GATE2_POLL_INTERVAL_SECONDS
NOT_CONFIGURED = (
    "Gate 2 Telegram chat/thread is not configured. Copy approval-contract.local.example.json "
    "to approval-contract.local.json and set gate2.chatId, gate2.threadId and gate2.approverUserIds."
)


def _load_bot_token() -> str:
    """Shared bot token (TELEGRAM_BOT_TOKEN) for every non-Gate-2 caller."""
    return jhos_common.telegram_bot_token()


def _load_gate2_bot_token() -> str:
    """Bot token for Gate 2 only. JHOS_GATE2_BOT_TOKEN (a bot the Hermes gateway
    does not poll) wins over the shared TELEGRAM_BOT_TOKEN. Scoped to the submit
    request and its confirmation poll so the materials and notification traffic
    that shares _api_call keeps using the shared bot."""
    return jhos_common.telegram_bot_token("JHOS_GATE2_BOT_TOKEN")


def _api_call(method: str, payload: dict, token: str | None = None) -> dict:
    """Make a Telegram Bot API call (also used by the materials scripts).
    Without an explicit token it uses the shared bot, never the Gate 2 bot."""
    if not token:
        token = _load_bot_token()
    return jhos_common.telegram_api_call(method, payload, token)


def normalize_confirmation(text: str) -> str:
    return " ".join((text or "").upper().split())


def expected_confirmation(company: str) -> str:
    return normalize_confirmation(f"{GATE2_CONFIRMATION_PREFIX} {company}")


# ─── Send Approval Request ──────────────────────────────────────────

def send_approval_request(
    title: str,
    company: str,
    platform: str = "Direct",
    fit_summary: str = "",
    token: str | None = None,
) -> dict:
    """Send a Gate 2 submit-approval request to the contract thread.

    Returns {ok, message_id, message_text} on success, {ok: False, error} on failure.
    Refuses (fail closed) when the company is blank or Gate 2 is not configured.
    """
    company = " ".join((company or "").split())
    if not company:
        return {"ok": False, "error": "Refusing Gate 2 request: company is blank"}
    if CHAT_ID is None or THREAD_ID is None:
        return {"ok": False, "error": NOT_CONFIGURED}
    if not token:
        token = _load_gate2_bot_token()
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
        f"Reply to this message with `{_escape_md(expected_confirmation(company))}` within 10 minutes to approve\\.",
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
            f"Reply to this message with {expected_confirmation(company)} within 10 minutes to approve.",
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
    """Wait for the exact `YES SUBMIT <COMPANY>` reply to the request message.

    Confirms only when all hold: the message is in the contract chat and thread,
    it replies to the request (`after_message_id`), its sender is in
    `approverUserIds`, and its normalized text equals the expected phrase.
    Any other reply to the request, or any other message from an approver in the
    thread, cancels. Blank company, missing request id, an empty approver list
    and a 409 getUpdates conflict all fail closed.

    Returns (confirmed, reason).
    """
    company = " ".join((company or "").split())
    if not company:
        return False, "Cancelled: company is blank, so no confirmation phrase can be matched"
    if CHAT_ID is None or THREAD_ID is None:
        return False, f"Cancelled: {NOT_CONFIGURED}"
    if after_message_id is None:
        return False, "Cancelled: no Gate 2 request message id to match replies against"
    if not APPROVER_USER_IDS:
        return False, "Cancelled: no approver user ids configured (gate2.approverUserIds)"
    if not token:
        token = _load_gate2_bot_token()

    expected = expected_confirmation(company)
    start = time.time()
    offset = None  # never flush with offset=-1: that acknowledges other consumers' updates

    while time.time() - start < timeout:
        remaining = int(timeout - (time.time() - start))
        if remaining <= 0:
            break
        params = {"timeout": min(30, remaining), "allowed_updates": ["message"]}
        if offset is not None:
            params["offset"] = offset

        result = _api_call("getUpdates", params, token)
        if not result.get("ok"):
            error = str(result.get("error") or "unknown getUpdates error")
            print(f"[gate2] getUpdates failed: {error}", file=sys.stderr)
            if result.get("status") == 409 or "HTTP 409" in error or "Conflict" in error:
                return False, (
                    "Cancelled: Telegram getUpdates returned 409 Conflict — another consumer "
                    "(likely the Hermes gateway) is polling this bot token. Set "
                    "JHOS_GATE2_BOT_TOKEN to a dedicated bot for Gate 2."
                )
            time.sleep(POLL_INTERVAL)
            continue

        for update in result.get("result", []):
            offset = update["update_id"] + 1
            msg = update.get("message") or {}
            if msg.get("chat", {}).get("id") != CHAT_ID:
                continue
            if msg.get("message_thread_id") != THREAD_ID:
                continue
            if msg.get("message_id", 0) <= after_message_id:
                continue
            sender = (msg.get("from") or {}).get("id")
            is_approver = sender in APPROVER_USER_IDS
            replies_to_request = (msg.get("reply_to_message") or {}).get("message_id") == after_message_id
            if not is_approver and not replies_to_request:
                continue  # unrelated chatter in the thread
            text = normalize_confirmation(msg.get("text") or "")
            if is_approver and replies_to_request and text == expected:
                return True, f"Confirmed: received '{expected}' from approver {sender}"
            return False, f"Cancelled: reply '{text[:60]}' from {sender} is not the exact confirmation"

    return False, f"Timeout: no '{expected}' received within {timeout}s"


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
            print(f"\nPolling for '{expected_confirmation('TestCo')}' for 60 seconds...")
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
