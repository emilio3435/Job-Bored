#!/usr/bin/env python3
"""gate1-approve.py — Handle Gate 1 approval from Telegram.

When Emilio replies "YES <COMPANY>" or similar to a discovery notification,
this script finds the matching Pipeline row and sets Status → Researching.

Usage:
    python3 gate1-approve.py "DISH TV"
    python3 gate1-approve.py "dish tv"    # case-insensitive
    python3 gate1-approve.py --list-new   # list companies with Status=New

Reads from:
    - worker-config.json for sheetId
    - google_token.json for OAuth

Writes to:
    - Pipeline Column M (Status) → "Researching"
"""

import argparse
import json
import os
import sys
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
WORKER_CONFIG = Path.home() / "GitHub/emilio3435/Job-Bored/integrations/browser-use-discovery/state/worker-config.json"
TOKEN_PATH = HERMES_HOME / "google_token.json"


def get_sheets_service():
    """Build authenticated Google Sheets service."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN_PATH.write_text(creds.to_json())
    return build("sheets", "v4", credentials=creds)


def get_sheet_id():
    """Read sheetId from worker-config.json."""
    config = json.loads(WORKER_CONFIG.read_text())
    sheet_id = config.get("sheetId", "")
    if not sheet_id:
        print("ERROR: sheetId is empty in worker-config.json", file=sys.stderr)
        sys.exit(1)
    return sheet_id


def read_pipeline(service, sheet_id):
    """Read Pipeline data and return (headers, rows)."""
    result = service.spreadsheets().values().get(
        spreadsheetId=sheet_id,
        range="Pipeline!A1:M500"
    ).execute()
    rows = result.get("values", [])
    if len(rows) < 2:
        return [], []
    return rows[0], rows[1:]


def find_company_rows(headers, rows, company_name):
    """Find all rows matching the company name (case-insensitive)."""
    col_map = {h.strip(): i for i, h in enumerate(headers)}
    company_col = col_map.get("Company", 2)
    status_col = col_map.get("Status", 12)
    title_col = col_map.get("Title", 1)

    matches = []
    target = company_name.strip().lower()
    for row_idx, row in enumerate(rows):
        company = row[company_col].strip() if len(row) > company_col else ""
        if target in company.lower() or company.lower() in target:
            status = row[status_col].strip() if len(row) > status_col else ""
            title = row[title_col].strip() if len(row) > title_col else "?"
            # row_idx+2 because 1-indexed + header row
            matches.append({
                "row_num": row_idx + 2,
                "title": title,
                "company": company,
                "status": status,
            })
    return matches


def approve_rows(service, sheet_id, row_numbers):
    """Set Status=Researching for the given row numbers."""
    body = {
        "valueInputOption": "RAW",
        "data": [
            {
                "range": f"Pipeline!M{row_num}",
                "values": [["Researching"]],
            }
            for row_num in row_numbers
        ],
    }
    service.spreadsheets().values().batchUpdate(
        spreadsheetId=sheet_id, body=body
    ).execute()


def list_new_companies(headers, rows):
    """List unique companies with Status=New."""
    col_map = {h.strip(): i for i, h in enumerate(headers)}
    company_col = col_map.get("Company", 2)
    status_col = col_map.get("Status", 12)
    title_col = col_map.get("Title", 1)
    score_col = col_map.get("Fit Score", 7)

    companies = {}
    for row in rows:
        status = row[status_col].strip() if len(row) > status_col else ""
        if status in ("New", ""):
            company = row[company_col].strip() if len(row) > company_col else "?"
            title = row[title_col].strip() if len(row) > title_col else "?"
            score = row[score_col].strip() if len(row) > score_col else ""
            if company not in companies:
                companies[company] = []
            companies[company].append({"title": title, "score": score})
    return companies


def main():
    parser = argparse.ArgumentParser(description="Gate 1 approval handler")
    parser.add_argument("company", nargs="?", help="Company name to approve")
    parser.add_argument("--list-new", action="store_true", help="List companies with Status=New")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be updated without writing")
    args = parser.parse_args()

    sheet_id = get_sheet_id()
    service = get_sheets_service()
    headers, rows = read_pipeline(service, sheet_id)

    if args.list_new:
        companies = list_new_companies(headers, rows)
        if not companies:
            print("No companies with Status=New.")
            return
        # Sort by highest fit score
        sorted_companies = sorted(
            companies.items(),
            key=lambda x: max(int(r["score"]) if r["score"].isdigit() else 0 for r in x[1]),
            reverse=True,
        )
        for company, roles in sorted_companies:
            scores = [r["score"] for r in roles if r["score"]]
            best = max(int(s) for s in scores) if scores else "?"
            print(f"  {company} ({len(roles)} role{'s' if len(roles)>1 else ''}, best score: {best})")
            for r in roles[:3]:
                print(f"    - {r['title']}")
            if len(roles) > 3:
                print(f"    ... +{len(roles)-3} more")
        return

    if not args.company:
        parser.error("Company name is required (or use --list-new)")

    matches = find_company_rows(headers, rows, args.company)
    if not matches:
        print(f"No Pipeline rows found matching '{args.company}'.")
        print("Use --list-new to see available companies.")
        sys.exit(1)

    # Filter to only New/blank status rows
    actionable = [m for m in matches if m["status"] in ("New", "")]
    already = [m for m in matches if m["status"] not in ("New", "")]

    if already:
        for m in already:
            print(f"  ℹ️  Row {m['row_num']}: {m['title']} — already '{m['status']}'")

    if not actionable:
        print(f"All matching rows for '{args.company}' are already past New status.")
        return

    if args.dry_run:
        print(f"DRY RUN — would set {len(actionable)} row(s) to 'Researching':")
        for m in actionable:
            print(f"  Row {m['row_num']}: {m['title']} @ {m['company']}")
        return

    row_nums = [m["row_num"] for m in actionable]
    approve_rows(service, sheet_id, row_nums)

    print(f"✅ Marked {len(actionable)} row(s) as Researching for '{args.company}':")
    for m in actionable:
        print(f"  Row {m['row_num']}: {m['title']} @ {m['company']}")


if __name__ == "__main__":
    main()
