#!/usr/bin/env python3
"""
JHOS Phase 4 — Submit Pipeline Library

All submit-pipeline primitives in one module:
  - URL normalization (mirrors lead-normalizer.ts)
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

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse, urlencode, parse_qs

# ─── Constants ────────────────────────────────────────────────────────
JHOS_ROOT = Path.home() / ".hermes" / "job-hunt"
STATE_DIR = JHOS_ROOT / "state"
EVIDENCE_DIR = JHOS_ROOT / "evidence"
LOCK_DB = STATE_DIR / "submit-locks.db"
LOCK_TTL_SECONDS = 1200  # 20 minutes (covers Gate 2 wait + browser fill)

# Tracking params to strip (mirrors lead-normalizer.ts SAFE_TRACKING_PARAM_PATTERN)
TRACKING_PARAM_RE = re.compile(
    r"^(utm_|ref|source|cid|fbclid|gclid|mc_|_ga|_gl|si|feature|rcid|sxsrf|ved|ei)",
    re.IGNORECASE,
)

# Column indices (0-based) matching pipeline-row.v1.json
COL_LINK = 4          # E: Link (job URL)
COL_STATUS = 12       # M: Status
COL_APPLIED_DATE = 13 # N: Applied Date
COL_NOTES = 14        # O: Notes
COL_APPROVAL = 23     # X: Approval Status

COLUMN_COUNT = 24     # A through X

GATE2_TARGET = "telegram:-1003800236296:48"
GATE2_TIMEOUT_SECONDS = 600  # 10 minutes


# ─── URL Normalization ────────────────────────────────────────────────
def normalize_url(raw: str) -> str:
    """Normalize a job URL for idempotency (mirrors normalizeLeadUrl in TS)."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlparse(raw)
        # Lowercase host
        netloc = parsed.netloc.lower()
        # Strip default ports
        host_part = parsed.hostname or ""
        port_part = parsed.port
        if (parsed.scheme == "https" and port_part == 443) or (parsed.scheme == "http" and port_part == 80):
            port_part = None
        netloc = host_part if port_part is None else f"{host_part}:{port_part}"
        # Strip tracking params
        qs = parse_qs(parsed.query, keep_blank_values=True)
        filtered = {k: v for k, v in qs.items() if not TRACKING_PARAM_RE.match(k)}
        query = urlencode(filtered, doseq=True) if filtered else ""
        # Lowercase path, strip trailing slashes and /apply suffix (spec rule 2+4)
        path = parsed.path.lower().rstrip("/") or "/"
        path = re.sub(r"/apply$", "", path) or "/"
        path = re.sub(r"/jobs/+$", "/jobs", path)
        from urllib.parse import urlunparse
        return urlunparse((parsed.scheme, netloc, path, "", query, ""))
    except Exception:
        return raw.rstrip("/")


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


# Statuses that do NOT satisfy Gate 1 — anything else passes
GATE1_BLOCK_STATUSES = {"New", "", "Rejected", "Passed"}


# ─── Gate 1: Pipeline Interest Signal ────────────────────────────────
def gate1_check(job_url: str, sheet_id: str, access_token: str) -> dict:
    """Read Pipeline and check if Status (Column M) signals interest.
    Gate 1 passes when Status is anything other than New/blank/Rejected/Passed.
    Returns {approved, row_number, status, title, company, link}.
    """
    import urllib.request
    normalized = normalize_url(job_url)
    if not normalized:
        return {"approved": False, "error": "Empty URL"}

    # Read all pipeline rows
    range_str = f"Pipeline!A2:X"
    api_url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{range_str}"
    req = urllib.request.Request(api_url, headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        return {"approved": False, "error": f"Sheets API error: {e}"}

    rows = data.get("values", [])
    for i, row in enumerate(rows):
        # Pad row to COLUMN_COUNT
        while len(row) < COLUMN_COUNT:
            row.append("")
        link = normalize_url(row[COL_LINK])
        if link == normalized:
            status = (row[COL_STATUS] or "").strip()
            approved = status not in GATE1_BLOCK_STATUSES
            return {
                "approved": approved,
                "row_number": i + 2,  # 1-indexed, header is row 1
                "status": status,
                "title": row[1],
                "company": row[2],
                "link": row[COL_LINK],
                "gate1_reason": f"Status '{status}' signals interest" if approved else f"Status '{status}' does not signal interest (must be beyond New)",
            }

    return {"approved": False, "error": "Job URL not found in Pipeline", "searched_url": normalized}


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

    now = datetime.now(timezone(timedelta(hours=-5)))  # Central Time
    ts = now.strftime("%Y-%m-%dT%H:%M:%S%z")
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
        import shutil
        shutil.copy2(screenshot_path, dest)
        metadata["screenshot"] = str(dest)
        # Rewrite with screenshot path
        meta_path.write_text(json.dumps(metadata, indent=2))

    return evidence_dir


# ─── Pipeline Row Updater ────────────────────────────────────────────
def update_pipeline_applied(
    sheet_id: str,
    access_token: str,
    row_number: int,
    notes_append: str = "",
) -> dict:
    """Update Pipeline row: set Applied Date (N) and append to Notes (O)."""
    import urllib.request

    now = datetime.now(timezone(timedelta(hours=-5)))
    date_str = now.strftime("%Y-%m-%d")

    updates = []

    # Column M (Status) → "Applied"
    updates.append({
        "range": f"Pipeline!M{row_number}",
        "values": [["Applied"]],
    })
    # Column N (Applied Date)
    updates.append({
        "range": f"Pipeline!N{row_number}",
        "values": [[date_str]],
    })
    # Column O (Notes) — append
    if notes_append:
        # Read existing notes first
        notes_url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/Pipeline!O{row_number}"
        req = urllib.request.Request(notes_url, headers={"Authorization": f"Bearer {access_token}"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                existing = json.loads(resp.read()).get("values", [[""]])[0][0]
        except Exception:
            existing = ""
        new_notes = f"{existing}\n{notes_append}".strip() if existing else notes_append
        updates.append({
            "range": f"Pipeline!O{row_number}",
            "values": [[new_notes]],
        })

    # Batch update
    body = json.dumps({
        "valueInputOption": "USER_ENTERED",
        "data": updates,
    }).encode()

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
        return {"success": True, "updated_row": row_number, "date": date_str, "response": result}
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
    return SubmitFailure(
        gate="gate1",
        reason=f"Pipeline Status is '{status}' — needs to be beyond 'New' (e.g. 'Researching') to proceed",
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
