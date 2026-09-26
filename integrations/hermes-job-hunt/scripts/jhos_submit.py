#!/usr/bin/env python3
"""
JHOS Phase 4 — Submit Pipeline Library

All submit-pipeline primitives in one module:
  - URL normalization (parity with lead-normalizer.ts normalizeLeadUrl;
    pinned by tests/fixtures/url-normalize-parity.json)
  - Submit lock (SQLite-backed, TTL=15min)
  - Gate 1 check (Pipeline Approval Status via Google Sheets API)
  - Workday hostname blocker
  - Evidence writer (screenshot + metadata)
  - Pipeline row updater (Applied Date + Notes)

Usage:
  import jhos_submit as js
  js.gate1_check(job_url, config)
  js.lock_acquire(job_url, task_id)
  js.is_workday_blocked(url)
  js.write_evidence(slug, screenshot_path, metadata)
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import parse_qsl, quote_plus, urlparse, urlsplit, urlunsplit

import jhos_common
from approval_contract import (
    GATE1_HEADER_LABEL,
    GATE1_PASS_VALUE,
    GATE2_TARGET,
    GATE2_TIMEOUT_SECONDS,
)

# ─── Constants ────────────────────────────────────────────────────────
def env_path(name, default):
    return Path(os.environ.get(name) or default).expanduser()


HERMES_HOME = env_path("HERMES_HOME", Path.home() / ".hermes")
JHOS_ROOT = env_path("HERMES_JOB_HUNT_HOME", HERMES_HOME / "job-hunt")
STATE_DIR = JHOS_ROOT / "state"
EVIDENCE_DIR = JHOS_ROOT / "evidence"
LOCK_DB = STATE_DIR / "submit-locks.db"
LOCK_TTL_SECONDS = 1200  # 20 minutes (covers Gate 2 wait + browser fill)

# Tracking params to strip — the same anchored pattern as
# lead-normalizer.ts SAFE_TRACKING_PARAM_PATTERN. Keep the two in sync; the
# shared fixture tests/fixtures/url-normalize-parity.json pins both.
TRACKING_PARAM_RE = re.compile(
    r"^(utm_.+|ref|source|src|gh_src|lever-source|fbclid|gclid|trk)$",
    re.IGNORECASE,
)

# Column indices (0-based) matching pipeline-row.v1.json
COL_TITLE = 1         # B: Title
COL_COMPANY = 2       # C: Company
COL_LINK = 4          # E: Link (job URL)
COL_STATUS = 12       # M: Status
COL_APPLIED_DATE = 13 # N: Applied Date
COL_NOTES = 14        # O: Notes
COL_APPROVAL = 23     # X: Approval Status

COLUMN_COUNT = 24     # A through X


# ─── URL Normalization ────────────────────────────────────────────────
def _form_encode(value: str) -> str:
    """application/x-www-form-urlencoded, as URLSearchParams serializes it."""
    return quote_plus(value, safe="*").replace("~", "%7E")


def normalize_url(raw: str) -> str:
    """Normalize a job URL exactly like normalizeLeadUrl in lead-normalizer.ts.

    Lowercases only the scheme and host, drops credentials, the fragment,
    default ports and anchored tracking params, and trims trailing slashes.
    Path case and every other query param are kept, so distinct postings
    never collapse to one key.
    """
    raw = (raw or "").strip()
    if not raw:
        return ""
    try:
        parts = urlsplit(raw)
        if not parts.scheme or not parts.netloc or parts.hostname is None:
            raise ValueError("not an absolute URL")
        scheme = parts.scheme.lower()
        host = parts.hostname.lower()
        if ":" in host:
            host = f"[{host}]"
        port = parts.port
        if (scheme == "https" and port == 443) or (scheme == "http" and port == 80):
            port = None
        netloc = host if port is None else f"{host}:{port}"
        pairs = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not TRACKING_PARAM_RE.match(k)]
        query = "&".join(f"{_form_encode(k)}={_form_encode(v)}" for k, v in pairs)
        path = re.sub(r"/+$", "", parts.path) or "/"
        return urlunsplit((scheme, netloc, path, query, ""))
    except ValueError:
        return re.sub(r"/+$", "", raw)


def url_to_slug(url: str) -> str:
    """Convert a URL to a filesystem-safe slug."""
    normalized = normalize_url(url)
    parsed = urlparse(normalized)
    slug = f"{parsed.netloc}{parsed.path}"
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", slug)
    slug = slug.strip("-").lower()
    return slug[:120] if slug else "unknown"


# ─── Workday Blocker ─────────────────────────────────────────────────
def is_workday_blocked(url: str) -> tuple[bool, str]:
    """Check if a URL is a Workday domain that should be blocked from submit.
    Returns (blocked: bool, reason: str).
    """
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        return False, ""
    if any(pat in host for pat in ("workday.com", "myworkdayjobs.com", "myworkdaysite.com", "myworkday.com", "workdayjobs.com")):
        return True, f"Workday hostname detected: {host}. Direct Workday automation is blocked per approval-guard-spec."
    return False, ""


# ─── Submit Lock (SQLite) ────────────────────────────────────────────
def _lock_db_conn() -> sqlite3.Connection:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(LOCK_DB))
    conn.execute("""
        CREATE TABLE IF NOT EXISTS submit_locks (
            lock_key TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            acquired_at REAL NOT NULL,
            ttl_seconds INTEGER NOT NULL DEFAULT 900
        )
    """)
    conn.commit()
    return conn


def lock_acquire(job_url: str, task_id: str, ttl: int = LOCK_TTL_SECONDS) -> tuple[bool, str]:
    """Try to acquire a submit lock. Returns (acquired, message)."""
    key = normalize_url(job_url)
    if not key:
        return False, "Empty URL"
    conn = _lock_db_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        now = time.time()
        row = conn.execute("SELECT owner, acquired_at, ttl_seconds FROM submit_locks WHERE lock_key = ?", (key,)).fetchone()
        if row:
            owner, acquired_at, lock_ttl = row
            if now - acquired_at < lock_ttl:
                if owner == task_id:
                    conn.commit()
                    return True, f"Lock already held by this task ({task_id})"
                conn.rollback()
                return False, f"Lock held by {owner} (acquired {int(now - acquired_at)}s ago, TTL {lock_ttl}s)"
            # Expired — take it
            conn.execute("DELETE FROM submit_locks WHERE lock_key = ?", (key,))
        conn.execute(
            "INSERT INTO submit_locks (lock_key, owner, acquired_at, ttl_seconds) VALUES (?, ?, ?, ?)",
            (key, task_id, now, ttl),
        )
        conn.commit()
        return True, f"Lock acquired by {task_id}"
    except sqlite3.IntegrityError:
        conn.rollback()
        return False, f"Lock race: another process acquired {key} simultaneously"
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        return False, f"Lock error: {e}"
    finally:
        conn.close()


def lock_check(job_url: str) -> dict:
    """Check if a lock exists for a URL."""
    key = normalize_url(job_url)
    conn = _lock_db_conn()
    try:
        row = conn.execute("SELECT owner, acquired_at, ttl_seconds FROM submit_locks WHERE lock_key = ?", (key,)).fetchone()
        if not row:
            return {"locked": False}
        owner, acquired_at, ttl = row
        now = time.time()
        if now - acquired_at >= ttl:
            return {"locked": False, "expired": True}
        return {"locked": True, "owner": owner, "remaining_seconds": int(ttl - (now - acquired_at))}
    finally:
        conn.close()


def lock_release(job_url: str, task_id: str) -> tuple[bool, str]:
    """Release a submit lock. Only the owner can release. Atomic DELETE."""
    key = normalize_url(job_url)
    conn = _lock_db_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        cur = conn.execute("DELETE FROM submit_locks WHERE lock_key = ? AND owner = ?", (key, task_id))
        conn.commit()
        if cur.rowcount > 0:
            return True, f"Lock released by {task_id}"
        # Check if lock exists but is owned by someone else
        row = conn.execute("SELECT owner FROM submit_locks WHERE lock_key = ?", (key,)).fetchone()
        if not row:
            return True, "No lock to release"
        return False, f"Lock owned by {row[0]}, not {task_id}"
    except Exception as e:
        conn.rollback()
        return False, f"lock_release error: {e}"
    finally:
        conn.close()


# ─── Gate 1: Pipeline Approval Status (approval-contract.v1.json) ────
def _read_pipeline_rows(sheet_id: str, access_token: str) -> list[list[str]]:
    """Read Pipeline!A2:X. Raises on any read failure (callers fail closed)."""
    import urllib.request

    api_url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/Pipeline!A2:X"
    req = urllib.request.Request(api_url, headers={"Authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    rows = []
    for row in data.get("values", []):
        row = list(row)
        while len(row) < COLUMN_COUNT:
            row.append("")
        rows.append(row)
    return rows


def find_rows_by_link(rows: list[list[str]], job_url: str) -> list[tuple[int, list[str]]]:
    """Return (sheet_row_number, row) for every row whose Link normalizes to job_url."""
    normalized = normalize_url(job_url)
    return [
        (i + 2, row)  # 1-indexed, header is row 1
        for i, row in enumerate(rows)
        if normalized and normalize_url(row[COL_LINK]) == normalized
    ]


def gate1_check(job_url: str, sheet_id: str, access_token: str) -> dict:
    """Read Pipeline Approval Status (Column X).

    Gate 1 passes only when exactly one row matches the job URL and its
    approvalStatus == Approved. Fail closed otherwise (read error, no row,
    or more than one row).
    Returns {approved, row_number, status, approvalStatus, title, company, link}.
    """
    normalized = normalize_url(job_url)
    if not normalized:
        return {"approved": False, "error": "Empty URL"}
    try:
        rows = _read_pipeline_rows(sheet_id, access_token)
    except Exception as e:
        return {"approved": False, "error": f"Sheets API error: {e}"}

    matches = find_rows_by_link(rows, job_url)
    if not matches:
        return {"approved": False, "error": "Job URL not found in Pipeline", "searched_url": normalized}
    if len(matches) > 1:
        return {
            "approved": False,
            "error": f"Ambiguous: {len(matches)} Pipeline rows match this job URL (rows {[n for n, _ in matches]})",
            "searched_url": normalized,
        }
    row_number, row = matches[0]
    status = (row[COL_STATUS] or "").strip()
    approval_status = (row[COL_APPROVAL] or "").strip()
    approved = approval_status == GATE1_PASS_VALUE
    return {
        "approved": approved,
        "row_number": row_number,
        "status": status,
        "approvalStatus": approval_status,
        "title": row[COL_TITLE],
        "company": row[COL_COMPANY],
        "link": row[COL_LINK],
        "gate1_reason": (
            f"Approval Status '{approval_status}' permits submit"
            if approved
            else f"Approval Status '{approval_status}' does not permit submit (requires '{GATE1_PASS_VALUE}')"
        ),
    }


# ─── Platform ────────────────────────────────────────────────────────
_PLATFORM_HOSTS = (
    ("greenhouse.io", "Greenhouse"),
    ("lever.co", "Lever"),
    ("ashbyhq.com", "Ashby"),
    ("smartrecruiters.com", "SmartRecruiters"),
    ("workable.com", "Workable"),
    ("bamboohr.com", "BambooHR"),
    ("jobvite.com", "Jobvite"),
    ("icims.com", "iCIMS"),
    ("recruitee.com", "Recruitee"),
    ("myworkdayjobs.com", "Workday"),
    ("workday.com", "Workday"),
)


def platform_from_url(url: str) -> str:
    """Name the application platform from the job URL's host."""
    host = (urlsplit(url or "").hostname or "").lower()
    for suffix, name in _PLATFORM_HOSTS:
        if host == suffix or host.endswith("." + suffix):
            return name
    return f"Direct ({host})" if host else "Direct"


# ─── Evidence Writer ─────────────────────────────────────────────────
def write_evidence(
    job_url: str,
    company: str,
    title: str,
    kanban_task: str,
    screenshot_path: str | None = None,
    extra: dict | None = None,
) -> Path:
    """Write submission evidence to ~/.hermes/job-hunt/evidence/{slug}/."""
    slug = url_to_slug(job_url)
    evidence_dir = EVIDENCE_DIR / slug
    evidence_dir.mkdir(parents=True, exist_ok=True)

    now = jhos_common.local_now()
    ts = now.isoformat(timespec="seconds")
    ts_file = now.strftime("%Y%m%d-%H%M%S")

    metadata = {
        "job_url": job_url,
        "normalized_url": normalize_url(job_url),
        "company": company,
        "title": title,
        "submitted_at": ts,
        "submitted_at_unix": time.time(),
        "kanban_task": kanban_task,
        **(extra or {}),
    }

    meta_path = evidence_dir / "metadata.json"
    meta_path.write_text(json.dumps(metadata, indent=2))

    if screenshot_path and Path(screenshot_path).exists():
        dest = evidence_dir / f"submit-{ts_file}.png"
        shutil.copy2(screenshot_path, dest)
        metadata["screenshot"] = str(dest)
        metadata["screenshot_sha256"] = hashlib.sha256(dest.read_bytes()).hexdigest()
        # Rewrite with screenshot path
        meta_path.write_text(json.dumps(metadata, indent=2))

    return evidence_dir


# ─── Pipeline Row Updater ────────────────────────────────────────────
def update_pipeline_applied(
    sheet_id: str,
    access_token: str,
    job_url: str,
    notes_append: str = "",
    expected_row: int | None = None,
) -> dict:
    """Set Status=Applied, Applied Date and append Notes on the job's row.

    The row is re-resolved by Link right before writing (a sort or insert
    during the Gate 2 wait must not land Applied on another job). The same
    read supplies the existing Notes; if that read fails, nothing is written.
    Values are written RAW so user text is never parsed as a formula.
    """
    import urllib.request

    try:
        rows = _read_pipeline_rows(sheet_id, access_token)
    except Exception as e:
        return {"success": False, "error": f"Aborted: Pipeline read failed, nothing written ({e})"}
    matches = find_rows_by_link(rows, job_url)
    if len(matches) != 1:
        return {
            "success": False,
            "error": f"Aborted: {len(matches)} Pipeline rows match {normalize_url(job_url)}; nothing written",
        }
    row_number, row = matches[0]

    date_str = jhos_common.local_now().strftime("%Y-%m-%d")
    updates = [
        {"range": f"Pipeline!M{row_number}", "values": [["Applied"]]},
        {"range": f"Pipeline!N{row_number}", "values": [[date_str]]},
    ]
    if notes_append:
        existing = (row[COL_NOTES] or "").strip()
        new_notes = f"{existing}\n{notes_append}" if existing else notes_append
        updates.append({"range": f"Pipeline!O{row_number}", "values": [[new_notes]]})

    body = json.dumps({"valueInputOption": "RAW", "data": updates}).encode()
    batch_url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values:batchUpdate"
    req = urllib.request.Request(
        batch_url,
        data=body,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        return {
            "success": True,
            "updated_row": row_number,
            "row_moved": expected_row is not None and expected_row != row_number,
            "date": date_str,
            "response": result,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─── Failure State Handlers ──────────────────────────────────────────
class SubmitFailure:
    """Structured failure result for the orchestrator."""
    def __init__(self, gate: str, reason: str, kanban_action: str, telegram_msg: str):
        self.gate = gate
        self.reason = reason
        self.kanban_action = kanban_action
        self.telegram_msg = telegram_msg

    def to_dict(self):
        return {
            "failed": True,
            "gate": self.gate,
            "reason": self.reason,
            "kanban_action": self.kanban_action,
            "telegram_msg": self.telegram_msg,
        }


def fail_gate1(title: str, company: str, status: str) -> SubmitFailure:
    """`status` is the row's Approval Status value (Gate 1), not Column M."""
    return SubmitFailure(
        gate="gate1",
        reason=(
            f"Gate 1 not satisfied: Pipeline {GATE1_HEADER_LABEL} is '{status}' "
            f"— requires '{GATE1_PASS_VALUE}'"
        ),
        kanban_action="no_change",
        telegram_msg="",  # No telegram notification for gate1 fail per spec
    )

def fail_gate2_timeout(title: str, company: str) -> SubmitFailure:
    return SubmitFailure(
        gate="gate2",
        reason="No confirmation received within 10 minutes",
        kanban_action="return_to_todo",
        telegram_msg=f"⏰ Submission for {title} @ {company} expired — card returned to queue",
    )

def fail_lock_collision(title: str, company: str, lock_owner: str) -> SubmitFailure:
    return SubmitFailure(
        gate="lock",
        reason=f"Lock held by {lock_owner}",
        kanban_action="no_change",
        telegram_msg=f"⚠️ {title} @ {company} skipped — another task is already submitting",
    )

def fail_browser_crash(title: str, company: str, error: str) -> SubmitFailure:
    return SubmitFailure(
        gate="submit",
        reason=f"Browser error: {error}",
        kanban_action="return_to_todo",
        telegram_msg=f"❌ Submit failed for {title} @ {company} — evidence captured, retry required",
    )

def fail_screenshot(title: str, company: str) -> SubmitFailure:
    return SubmitFailure(
        gate="screenshot",
        reason="Screenshot capture failed (submit still valid)",
        kanban_action="normal_update",
        telegram_msg=f"✅ Applied to {title} @ {company} — screenshot evidence unavailable, verify in Pipeline",
    )


# ─── CLI Entry Point ─────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: jhos_submit.py <command> [args]")
        print("Commands: normalize, lock-acquire, lock-check, lock-release, gate1, workday-check, slug")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "normalize":
        print(normalize_url(sys.argv[2]))

    elif cmd == "slug":
        print(url_to_slug(sys.argv[2]))

    elif cmd == "lock-acquire":
        url, task = sys.argv[2], sys.argv[3]
        ok, msg = lock_acquire(url, task)
        print(json.dumps({"acquired": ok, "message": msg}))

    elif cmd == "lock-check":
        print(json.dumps(lock_check(sys.argv[2])))

    elif cmd == "lock-release":
        url, task = sys.argv[2], sys.argv[3]
        ok, msg = lock_release(url, task)
        print(json.dumps({"released": ok, "message": msg}))

    elif cmd == "gate1":
        url, sheet_id, token = sys.argv[2], sys.argv[3], sys.argv[4]
        print(json.dumps(gate1_check(url, sheet_id, token)))

    elif cmd == "workday-check":
        blocked, reason = is_workday_blocked(sys.argv[2])
        print(json.dumps({"blocked": blocked, "reason": reason}))

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
