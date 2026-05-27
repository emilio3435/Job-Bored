#!/usr/bin/env python3
"""
Gate 2 — Status Watcher (Researching rows)

Polls the Pipeline sheet for rows that just flipped to Status = Researching
(with Date Found = today) and posts an approval request to thread 48.

Silent when no new Researching rows are found (watchdog pattern).
"""

import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path

SHEET_ID = "1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ"
TOKEN_PATH = Path.home() / ".hermes" / "google_token.json"
STATE_FILE = Path.home() / ".hermes" / "job-hunt" / "reported-researching.json"
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_HOME_CHANNEL", "-1003800236296")
TELEGRAM_THREAD_ID = 48  # submit-approval thread
CT = timezone(timedelta(hours=-5))  # Central Time
TODAY = datetime.now(CT).strftime("%Y-%m-%d")


def get_sheets_service():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN_PATH.write_text(creds.to_json())
    return build("sheets", "v4", credentials=creds)


def load_reported():
    if STATE_FILE.exists():
        return set(json.loads(STATE_FILE.read_text()))
    return set()


def save_reported(ids):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(sorted(ids)))


def send_telegram(text):
    url = (
        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"
        f"/sendMessage?chat_id={TELEGRAM_CHAT_ID}&text={urllib.parse.quote(text)}"
        f"&message_thread_id={TELEGRAM_THREAD_ID}"
    )
    req = urllib.request.Request(url)
    try:
        urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        raise Exception(f"HTTP {e.code}: {body}")


def main():
    service = get_sheets_service()
    result = service.spreadsheets().values().get(
        spreadsheetId=SHEET_ID,
        range="Pipeline!A1:M500",
    ).execute()
    rows = result.get("values", [])

    if len(rows) < 2:
        sys.exit(0)

    headers = rows[0]
    col_map = {h.strip(): i for i, h in enumerate(headers)}

    date_col = col_map.get("Date Found", 0)
    title_col = col_map.get("Title", 1)
    company_col = col_map.get("Company", 2)
    link_col = col_map.get("Link", 4)
    status_col = col_map.get("Status", 12)

    reported = load_reported()
    new_researching = []

    for i, row in enumerate(rows[1:], start=2):
        if len(row) <= status_col:
            continue
        status = row[status_col].strip() if len(row) > status_col else ""
        date_found = row[date_col].strip() if len(row) > date_col else ""

        if status.lower() != "researching":
            continue
        if date_found != TODAY:
            continue

        row_id = f"{i}|{date_found}"
        if row_id in reported:
            continue

        title = row[title_col].strip() if len(row) > title_col else "?"
        company = row[company_col].strip() if len(row) > company_col else "?"
        link = row[link_col].strip() if len(row) > link_col else ""

        new_researching.append({
            "row": i,
            "row_id": row_id,
            "title": title,
            "company": company,
            "link": link,
        })

    if not new_researching:
        sys.exit(0)  # Silent — nothing new

    # Mark all as reported before sending (idempotency)
    save_reported(reported | {r["row_id"] for r in new_researching})

    # Format message (HTML to avoid Markdown entity parsing issues)
    lines = ["🟡 Approval Request — Gate 2", ""]
    for r in new_researching:
        lines.append(f"▶ {r['title']} @ {r['company']}")
        if r["link"]:
            lines.append(f"  🔗 {r['link']}")
        lines.append("")

    lines.append("To submit for research, reply:")
    lines.append("  YES <COMPANY>")
    lines.append("or change Status → Applied / Phone Screen / Interviewing / etc.")

    text = "\n".join(lines)
    try:
        send_telegram(text)
    except Exception as e:
        print(f"Telegram send failed: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Sent approval request for {len(new_researching)} role(s) to thread {TELEGRAM_THREAD_ID}")


if __name__ == "__main__":
    main()
