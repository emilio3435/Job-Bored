#!/usr/bin/env python3
"""
JHOS Phase 6 — Follow-up Monitor

Checks Pipeline for Applied roles needing follow-up:
  - Applied > 7 days ago with no reply → suggest follow-up
  - Applied > 14 days ago with no reply → flag as stale
  - Applied > 21 days ago with no reply → recommend closing

Output is designed for Telegram delivery (no_agent cron script).
Silent when no action items (watchdog pattern).

Usage:
    python3 followup_monitor.py           # Print follow-up report
    python3 followup_monitor.py --update  # Also set Follow-up Date for flagged rows
"""

import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ─── Config ───────────────────────────────────────────────────────────

SHEET_ID = "1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ"
TOKEN_PATH = Path.home() / ".hermes" / "google_token.json"
CT = timezone(timedelta(hours=-5))  # Central Time
TODAY = datetime.now(CT).date()

# Column indices (0-based)
COL_TITLE = 1
COL_COMPANY = 2
COL_LINK = 4
COL_STATUS = 12
COL_APPLIED_DATE = 13
COL_FOLLOWUP_DATE = 15
COL_LAST_CONTACT = 17
COL_DID_REPLY = 18


def get_sheets_service():
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    with open(TOKEN_PATH) as f:
        token_data = json.load(f)
    creds = Credentials.from_authorized_user_info(
        token_data, ["https://www.googleapis.com/auth/spreadsheets"]
    )
    if creds.expired and creds.refresh_token:
        from google.auth.transport.requests import Request
        creds.refresh(Request())
        with open(TOKEN_PATH, "w") as f:
            json.dump(json.loads(creds.to_json()), f)
    return build("sheets", "v4", credentials=creds)


def parse_date(date_str: str):
    """Parse various date formats."""
    if not date_str:
        return None
    for fmt in ["%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"]:
        try:
            return datetime.strptime(date_str.strip(), fmt).date()
        except ValueError:
            continue
    return None


def main():
    update_mode = "--update" in sys.argv

    service = get_sheets_service()
    result = service.spreadsheets().values().get(
        spreadsheetId=SHEET_ID,
        range="Pipeline!A1:X500"
    ).execute()
    rows = result.get("values", [])

    if not rows:
        return

    # Find Applied rows
    applied_roles = []
    for i, row in enumerate(rows[1:], start=2):
        while len(row) < 24:
            row.append("")
        if row[COL_STATUS] != "Applied":
            continue

        applied_date = parse_date(row[COL_APPLIED_DATE])
        followup_date = parse_date(row[COL_FOLLOWUP_DATE])
        last_contact = row[COL_LAST_CONTACT].strip()
        did_reply = row[COL_DID_REPLY].strip().lower()

        # Skip if they replied
        if did_reply in ("yes", "true", "replied", "y"):
            continue

        days_since = (TODAY - applied_date).days if applied_date else None

        applied_roles.append({
            "row": i,
            "title": row[COL_TITLE],
            "company": row[COL_COMPANY],
            "link": row[COL_LINK],
            "applied_date": row[COL_APPLIED_DATE],
            "days_since": days_since,
            "followup_date": row[COL_FOLLOWUP_DATE],
            "last_contact": last_contact,
            "did_reply": did_reply,
        })

    if not applied_roles:
        # Silent — no Applied roles need attention
        return

    # Categorize
    needs_followup = []      # 7-14 days
    stale = []               # 14-21 days
    likely_closed = []       # 21+ days
    no_date = []             # Applied but no date

    for role in applied_roles:
        if role["days_since"] is None:
            no_date.append(role)
        elif role["days_since"] >= 21:
            likely_closed.append(role)
        elif role["days_since"] >= 14:
            stale.append(role)
        elif role["days_since"] >= 7:
            needs_followup.append(role)
        # < 7 days: too early, skip

    # If nothing needs attention, stay silent
    if not (needs_followup or stale or likely_closed or no_date):
        return

    # Build report
    lines = ["📋 **Follow-up Monitor**", f"Date: {TODAY.isoformat()}", ""]

    if likely_closed:
        lines.append("🔴 **21+ days — likely closed (consider marking Passed)**")
        for r in likely_closed:
            lines.append(f"  • {r['title']} @ {r['company']} — applied {r['applied_date']} ({r['days_since']}d ago)")
        lines.append("")

    if stale:
        lines.append("🟡 **14-21 days — follow-up overdue**")
        for r in stale:
            lines.append(f"  • {r['title']} @ {r['company']} — applied {r['applied_date']} ({r['days_since']}d ago)")
        lines.append("")

    if needs_followup:
        lines.append("🟢 **7-14 days — follow-up suggested**")
        for r in needs_followup:
            lines.append(f"  • {r['title']} @ {r['company']} — applied {r['applied_date']} ({r['days_since']}d ago)")
        lines.append("")

    if no_date:
        lines.append("⚪ **Applied but no date recorded**")
        for r in no_date:
            lines.append(f"  • {r['title']} @ {r['company']}")
        lines.append("")

    # Action items
    action_items = len(likely_closed) + len(stale) + len(needs_followup)
    lines.append(f"**{action_items} roles need attention.** Reply to act on any.")

    print("\n".join(lines))

    # Optionally update Follow-up Date
    if update_mode and (needs_followup or stale):
        updates = []
        followup_target = (TODAY + timedelta(days=3)).isoformat()
        for role in needs_followup + stale:
            if not role["followup_date"]:
                updates.append({
                    "range": f"Pipeline!P{role['row']}",
                    "values": [[followup_target]],
                })
        if updates:
            service.spreadsheets().values().batchUpdate(
                spreadsheetId=SHEET_ID,
                body={"valueInputOption": "RAW", "data": updates}
            ).execute()
            print(f"\n✅ Set Follow-up Date to {followup_target} for {len(updates)} roles.")


if __name__ == "__main__":
    main()
