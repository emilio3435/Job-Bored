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


def env_path(name, default):
    return Path(os.environ.get(name) or default).expanduser()


HERMES_HOME = env_path("HERMES_HOME", Path.home() / ".hermes")
HERMES_JOB_HUNT_HOME = env_path("HERMES_JOB_HUNT_HOME", HERMES_HOME / "job-hunt")
DEFAULT_VENV_PYTHON = HERMES_JOB_HUNT_HOME / ".venv" / "bin" / "python"

if (
    DEFAULT_VENV_PYTHON.exists()
    and os.environ.get("HERMES_SKIP_VENV_REEXEC") != "1"
):
    if Path(sys.executable).resolve() != DEFAULT_VENV_PYTHON.resolve():
        os.environ["HERMES_SKIP_VENV_REEXEC"] = "1"
        os.execv(str(DEFAULT_VENV_PYTHON), [str(DEFAULT_VENV_PYTHON), *sys.argv])

JOBBORED_REPO = env_path("JOBBORED_REPO", Path.home() / "Job-Bored")
WORKER_CONFIG = env_path(
    "BROWSER_USE_DISCOVERY_WORKER_CONFIG",
    JOBBORED_REPO / "integrations/browser-use-discovery/state/worker-config.json",
)
WORKER_ENV = env_path(
    "BROWSER_USE_DISCOVERY_WORKER_ENV",
    JOBBORED_REPO / "integrations/browser-use-discovery/.env",
)
TOKEN_PATH = env_path("HERMES_GOOGLE_TOKEN", HERMES_HOME / "google_token.json")


def read_worker_env():
    """Read worker .env keys without echoing values."""
    if not WORKER_ENV.exists():
        return {}
    values = {}
    for raw_line in WORKER_ENV.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def resolve_env_value(worker_env, *names):
    for name in names:
        value = os.environ.get(name) or worker_env.get(name)
        if value:
            return value
    return ""


def get_oauth_sheets_service():
    """Build a Sheets service from the Hermes user OAuth token."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN_PATH.write_text(creds.to_json())
    return build("sheets", "v4", credentials=creds)


def get_service_account_sheets_service(worker_env):
    """Build a Sheets service from the discovery worker service account."""
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build

    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    service_account_json = resolve_env_value(
        worker_env,
        "BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_JSON",
        "GOOGLE_SERVICE_ACCOUNT_JSON",
    )
    if service_account_json:
        creds = Credentials.from_service_account_info(
            json.loads(service_account_json),
            scopes=scopes,
        )
        return build("sheets", "v4", credentials=creds)

    service_account_file = resolve_env_value(
        worker_env,
        "BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE",
        "GOOGLE_SERVICE_ACCOUNT_FILE",
    )
    if not service_account_file:
        raise RuntimeError("No service account fallback is configured.")

    service_account_path = Path(service_account_file).expanduser()
    if not service_account_path.is_absolute():
        service_account_path = WORKER_ENV.parent / service_account_path
    creds = Credentials.from_service_account_file(
        str(service_account_path),
        scopes=scopes,
    )
    return build("sheets", "v4", credentials=creds)


def get_sheets_service():
    """Build authenticated Google Sheets service."""
    oauth_error = None
    if TOKEN_PATH.exists():
        try:
            return get_oauth_sheets_service()
        except Exception as exc:
            oauth_error = exc

    try:
        return get_service_account_sheets_service(read_worker_env())
    except Exception as exc:
        if oauth_error:
            raise RuntimeError(
                "Google Sheets auth failed. Hermes OAuth could not refresh, "
                "and the discovery worker service-account fallback did not work."
            ) from exc
        raise


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
    try:
        service = get_sheets_service()
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
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
