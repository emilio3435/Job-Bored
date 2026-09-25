#!/usr/bin/env python3
"""
Researching watcher (interest prompts) — paused on the main machine.

Polls the Pipeline sheet for rows that flipped to Status = Researching with
Date Found = today and posts a research-interest prompt to the INTEREST thread
from approval-contract.v1.json (+ approval-contract.local.json). It never
posts into the Gate 2 submit-approval thread, and the contract chat cannot be
overridden from the environment (BEAUDIT H22).

Rows are keyed by their normalized Link (a re-sort does not re-send) and are
marked reported only after Telegram accepts the message (a failed send is
retried next run) — BEAUDIT H19.

Silent when no new Researching rows are found (watchdog pattern). The file
name is kept for existing cron jobs.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import approval_contract  # noqa: E402
import jhos_common  # noqa: E402
from jhos_submit import normalize_url  # noqa: E402

STATE_FILE = jhos_common.job_hunt_home() / "reported-researching.json"
PIPELINE_RANGE = "Pipeline!A:M"  # open-ended: no row cap


def today_str():
    return jhos_common.local_today().isoformat()


def get_sheets_service():
    return jhos_common.oauth_sheets_service()


def load_reported():
    if STATE_FILE.exists():
        return set(json.loads(STATE_FILE.read_text()))
    return set()


def save_reported(ids):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(sorted(ids)))


def send_telegram(chat_id, thread_id, text):
    import gate2_telegram as g2

    result = g2._api_call("sendMessage", {
        "chat_id": chat_id,
        "message_thread_id": thread_id,
        "text": text,
    })
    if not result.get("ok"):
        raise RuntimeError(result.get("error") or "Telegram sendMessage failed")


def collect_new_researching(rows, reported, today):
    headers = rows[0]
    col_map = {h.strip(): i for i, h in enumerate(headers)}
    date_col = col_map.get("Date Found", 0)
    title_col = col_map.get("Title", 1)
    company_col = col_map.get("Company", 2)
    link_col = col_map.get("Link", 4)
    status_col = col_map.get("Status", 12)

    def cell(row, col):
        return row[col].strip() if len(row) > col else ""

    found = []
    for row in rows[1:]:
        if cell(row, status_col).lower() != "researching":
            continue
        date_found = cell(row, date_col)
        if date_found != today:
            continue
        link = cell(row, link_col)
        company = cell(row, company_col)
        title = cell(row, title_col) or "?"
        key = f"{normalize_url(link) or (company + '|' + title).casefold()}|{date_found}"
        if key in reported:
            continue
        found.append({"key": key, "title": title, "company": company or "?", "link": link})
    return found


def main(service=None, send=None):
    chat_id = approval_contract.INTEREST_CHAT_ID
    thread_id = approval_contract.INTEREST_THREAD_ID
    if chat_id is None or thread_id is None:
        print(
            "Interest thread not configured: set interest.chatId and interest.threadId in "
            "approval-contract.local.json. Refusing to post into the Gate 2 thread.",
            file=sys.stderr,
        )
        sys.exit(1)

    service = service or get_sheets_service()
    sheet_id = jhos_common.sheet_id_from_worker_config()
    result = service.spreadsheets().values().get(
        spreadsheetId=sheet_id,
        range=PIPELINE_RANGE,
    ).execute()
    rows = result.get("values", [])
    if len(rows) < 2:
        return

    reported = load_reported()
    new_researching = collect_new_researching(rows, reported, today_str())
    if not new_researching:
        return  # Silent — nothing new

    lines = ["🔎 Research interest — new Researching roles", ""]
    for r in new_researching:
        lines.append(f"▶ {r['title']} @ {r['company']}")
        if r["link"]:
            lines.append(f"  🔗 {r['link']}")
        lines.append("")
    lines.append("To draft materials, reply:")
    lines.append("  YES <COMPANY>")
    lines.append("Submitting still needs Approval Status = Approved and the final submit confirmation.")
    text = "\n".join(lines)

    try:
        (send or send_telegram)(chat_id, thread_id, text)
    except Exception as e:
        print(f"Telegram send failed: {e}", file=sys.stderr)
        sys.exit(1)

    # Mark reported only after the send succeeded.
    save_reported(reported | {r["key"] for r in new_researching})
    print(f"Sent interest prompt for {len(new_researching)} role(s) to thread {thread_id}")


if __name__ == "__main__":
    main()
