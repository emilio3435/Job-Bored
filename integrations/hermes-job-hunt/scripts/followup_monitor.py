#!/usr/bin/env python3
"""
JHOS Phase 6 — Follow-up Monitor

Checks Pipeline for Applied roles needing follow-up. The day thresholds come
from ../followup-thresholds.v1.json (shared with the browser's daily brief):
  - waitingReplyMinDays with no reply → suggest follow-up
  - staleAppliedDays with no reply → flag as stale
  - likelyClosedDays with no reply → recommend closing

Output is designed for Telegram delivery (no_agent cron script).
Silent when no action items (watchdog pattern).

Usage:
    python3 followup_monitor.py           # Print follow-up report
    python3 followup_monitor.py --update  # Also set Follow-up Date for flagged rows

The Sheet ID comes from the discovery worker-config.json (never hardcoded),
the Google token from the shared Hermes token via jhos_common, and "today"
from the user's timezone with real DST rules.
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jhos_common  # noqa: E402

# ─── Config ───────────────────────────────────────────────────────────

PIPELINE_RANGE = "Pipeline!A:X"  # open-ended: no row cap

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
    # Loads the shared token with its own scopes and writes refreshes atomically.
    return jhos_common.oauth_sheets_service()


def today():
    return jhos_common.local_today()


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


def main(argv=None, service=None):
    argv = sys.argv[1:] if argv is None else argv
    update_mode = "--update" in argv
    TODAY = today()
    sheet_id = jhos_common.sheet_id_from_worker_config()

    service = service or get_sheets_service()
    result = service.spreadsheets().values().get(
        spreadsheetId=sheet_id,
        range=PIPELINE_RANGE,
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

    # Categorize against the shared thresholds (H20)
    limits = jhos_common.followup_thresholds()
    follow_days = limits["waitingReplyMinDays"]
    stale_days = limits["staleAppliedDays"]
    closed_days = limits["likelyClosedDays"]
    needs_followup = []      # follow_days .. stale_days
    stale = []               # stale_days .. closed_days
    likely_closed = []       # closed_days+
    no_date = []             # Applied but no date

    for role in applied_roles:
        if role["days_since"] is None:
            no_date.append(role)
        elif role["days_since"] >= closed_days:
            likely_closed.append(role)
        elif role["days_since"] >= stale_days:
            stale.append(role)
        elif role["days_since"] >= follow_days:
            needs_followup.append(role)
        # below follow_days: too early, skip

    # If nothing needs attention, stay silent
    if not (needs_followup or stale or likely_closed or no_date):
        return

    # Build report
    lines = ["📋 **Follow-up Monitor**", f"Date: {TODAY.isoformat()}", ""]

    if likely_closed:
        lines.append(f"🔴 **{closed_days}+ days — likely closed (consider marking Passed)**")
        for r in likely_closed:
            lines.append(f"  • {r['title']} @ {r['company']} — applied {r['applied_date']} ({r['days_since']}d ago)")
        lines.append("")

    if stale:
        lines.append(f"🟡 **{stale_days}-{closed_days} days — follow-up overdue**")
        for r in stale:
            lines.append(f"  • {r['title']} @ {r['company']} — applied {r['applied_date']} ({r['days_since']}d ago)")
        lines.append("")

    if needs_followup:
        lines.append(f"🟢 **{follow_days}-{stale_days} days — follow-up suggested**")
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
                spreadsheetId=sheet_id,
                body={"valueInputOption": "RAW", "data": updates}
            ).execute()
            print(f"\n✅ Set Follow-up Date to {followup_target} for {len(updates)} roles.")


if __name__ == "__main__":
    main()
