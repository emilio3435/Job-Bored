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
APPLICATIONS_DIR = env_path(
    "HERMES_APPLICATIONS_DIR",
    HERMES_JOB_HUNT_HOME / "applications",
)


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

    scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
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
    if TOKEN_PATH.exists():
        try:
            return get_oauth_sheets_service()
        except Exception:
            pass
    return get_service_account_sheets_service(read_worker_env())


def get_pipeline_data(sheet_id):
    """Fetch Pipeline data via Sheets API or CSV fallback."""
    try:
        service = get_sheets_service()
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
