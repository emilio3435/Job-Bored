#!/usr/bin/env python3
"""pipeline-status.py — Daily Pipeline status summary for Telegram.

Reads the Pipeline Sheet and produces a compact status report.
Designed as a no_agent cron script — stdout is delivered verbatim.
Empty stdout = silent (no notification).

Usage:
    python3 pipeline-status.py
"""

import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
WORKER_CONFIG = Path.home() / "GitHub/emilio3435/Job-Bored/integrations/browser-use-discovery/state/worker-config.json"
TOKEN_PATH = HERMES_HOME / "google_token.json"
APPLICATIONS_DIR = HERMES_HOME / "job-hunt" / "applications"


def get_pipeline_data(sheet_id):
    """Fetch Pipeline data via Sheets API or CSV fallback."""
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build

        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH))
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            TOKEN_PATH.write_text(creds.to_json())
        service = build("sheets", "v4", credentials=creds)
        result = service.spreadsheets().values().get(
            spreadsheetId=sheet_id, range="Pipeline!A1:M500"
        ).execute()
        return result.get("values", [])
    except Exception:
        import csv, io, urllib.request
        url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet=Pipeline&range=A1:M500"
        resp = urllib.request.urlopen(url, timeout=30).read().decode()
        return list(csv.reader(io.StringIO(resp)))


def main():
    config = json.loads(WORKER_CONFIG.read_text())
    sheet_id = config.get("sheetId", "")
    if not sheet_id:
        print("ERROR: sheetId empty in worker-config.json")
        sys.exit(1)

    rows = get_pipeline_data(sheet_id)
    if len(rows) < 2:
        sys.exit(0)  # Silent — no data

    headers = rows[0]
    col_map = {h.strip(): i for i, h in enumerate(headers)}

    date_col = col_map.get("Date Found", 0)
    title_col = col_map.get("Title", 1)
    company_col = col_map.get("Company", 2)
    score_col = col_map.get("Fit Score", 7)
    status_col = col_map.get("Status", 12)

    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    status_counts = Counter()
    new_today = []
    researching = []
    applied = []

    for row in rows[1:]:
        status = row[status_col].strip() if len(row) > status_col else ""
        date = row[date_col].strip() if len(row) > date_col else ""
        title = row[title_col].strip() if len(row) > title_col else "?"
        company = row[company_col].strip() if len(row) > company_col else "?"
        score = row[score_col].strip() if len(row) > score_col else ""

        bucket = status if status else "New"
        status_counts[bucket] += 1

        if bucket == "New" and date in (today, yesterday):
            new_today.append({"title": title, "company": company, "score": score})

        if bucket == "Researching":
            # Check if application folder exists
            slug = f"{company}-{title}".lower().replace(" ", "-").replace("/", "-")[:60]
            has_materials = any(APPLICATIONS_DIR.glob(f"*{company.lower().replace(' ', '-')}*"))
            researching.append({"title": title, "company": company, "has_materials": has_materials})

        if bucket == "Applied":
            applied.append({"title": title, "company": company})

    # Build report
    lines = []
    lines.append(f"📊 Pipeline Status — {today}")
    lines.append("")

    # Status breakdown
    total = sum(status_counts.values())
    lines.append(f"Total: {total} roles tracked")
    for status in ["New", "Researching", "Applied", "Phone Screen", "Interviewing", "Offer", "Expired", "Passed", "Rejected"]:
        count = status_counts.get(status, 0)
        if count > 0:
            lines.append(f"  {status}: {count}")
    lines.append("")

    # New in last 24h
    if new_today:
        lines.append(f"🆕 {len(new_today)} discovered in last 24h:")
        new_today.sort(key=lambda j: int(j["score"]) if j["score"].isdigit() else 0, reverse=True)
        for j in new_today[:5]:
            s = f" (score {j['score']})" if j["score"] else ""
            lines.append(f"  • {j['title']} @ {j['company']}{s}")
        if len(new_today) > 5:
            lines.append(f"  ... +{len(new_today) - 5} more")
        lines.append("")

    # Researching (awaiting materials/review)
    if researching:
        lines.append(f"🔬 {len(researching)} in Researching:")
        for j in researching:
            mat = " ✅ materials ready" if j["has_materials"] else " ⏳ needs drafting"
            lines.append(f"  • {j['title']} @ {j['company']}{mat}")
        lines.append("")

    # Applied
    if applied:
        lines.append(f"📨 {len(applied)} Applied:")
        for j in applied[:5]:
            lines.append(f"  • {j['title']} @ {j['company']}")
        if len(applied) > 5:
            lines.append(f"  ... +{len(applied) - 5} more")
        lines.append("")

    # Action items
    actions = []
    new_count = status_counts.get("New", 0)
    if new_count > 10:
        actions.append(f"📋 {new_count} roles awaiting review — reply YES <COMPANY> to approve")
    needs_drafting = [r for r in researching if not r["has_materials"]]
    if needs_drafting:
        actions.append(f"📝 {len(needs_drafting)} Researching role(s) need materials drafted")

    if actions:
        lines.append("Action items:")
        for a in actions:
            lines.append(f"  {a}")

    print("\n".join(lines))


if __name__ == "__main__":
    main()
