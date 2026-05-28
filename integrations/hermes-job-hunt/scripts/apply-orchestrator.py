#!/usr/bin/env python3
"""
JHOS Phase 4 — APPLY Card Orchestrator

Chains the full apply pipeline:
  1. Validate DRAFT artifacts exist
  2. Workday hostname check
  3. Gate 1: Pipeline Approval Status = 'Approved'
  4. Acquire submit lock
  5. Gate 2: Telegram confirmation (10-min timeout)
  6. Browser-assisted fill (Greenhouse/Lever)
  7. Evidence capture (screenshot + metadata)
  8. Pipeline row update (Status→Applied, Applied Date, Notes)
  9. Lock release

Usage:
  python3 apply-orchestrator.py --job-url <URL> --task-id <kanban_id> [--dry-run]

Dry-run mode: runs all checks but does NOT submit or update Pipeline.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Add scripts dir to path
sys.path.insert(0, str(Path(__file__).parent))
import jhos_submit as js

def env_path(name, default):
    return Path(os.environ.get(name) or default).expanduser()


HERMES_HOME = env_path("HERMES_HOME", Path.home() / ".hermes")
JHOS_ROOT = env_path("HERMES_JOB_HUNT_HOME", HERMES_HOME / "job-hunt")
APPLICATIONS_DIR = env_path("HERMES_APPLICATIONS_DIR", JHOS_ROOT / "applications")


def log(msg: str, level: str = "INFO"):
    ts = datetime.now(timezone(timedelta(hours=-5))).strftime("%H:%M:%S CT")
    print(f"[{ts}] [{level}] {msg}")


def find_application_dir(job_url: str) -> Path | None:
    """Find the application folder matching this URL."""
    slug = js.url_to_slug(job_url)
    # Try direct slug match
    candidate = APPLICATIONS_DIR / slug
    if candidate.is_dir():
        return candidate
    # Search all application dirs for a matching URL in job-analysis.md or qa-report.md
    for d in APPLICATIONS_DIR.iterdir():
        if not d.is_dir():
            continue
        for f in ["job-analysis.md", "qa-report.md", "application-checklist.md"]:
            fp = d / f
            if fp.exists() and job_url in fp.read_text():
                return d
    return None


def validate_draft(app_dir: Path) -> tuple[bool, list[str]]:
    """Check that required Phase 3 DRAFT artifacts exist."""
    required = ["resume.html", "resume.pdf", "cover-letter.html", "cover-letter.pdf"]
    missing = [f for f in required if not (app_dir / f).exists()]
    return len(missing) == 0, missing


def send_gate2_request(title: str, company: str, platform: str, fit_summary: str) -> dict:
    """Send Gate 2 confirmation request to Telegram thread 48.
    Returns {sent: bool, message_id: int, message_text: str}.

    Uses Telegram Bot API directly via gate2_telegram module.
    """
    import gate2_telegram as g2
    result = g2.send_approval_request(title, company, platform, fit_summary)
    return {
        "sent": result.get("ok", False),
        "message_id": result.get("message_id"),
        "message_text": result.get("message_text", ""),
        "error": result.get("error"),
    }


def wait_for_gate2_confirmation(company: str, timeout: int = js.GATE2_TIMEOUT_SECONDS, after_message_id: int | None = None) -> tuple[bool, str]:
    """Poll for YES SUBMIT <COMPANY> reply in Telegram thread 48.

    Uses Telegram Bot API getUpdates with long polling.

    Returns (confirmed, reason).
    """
    import gate2_telegram as g2
    return g2.poll_for_confirmation(company, timeout, after_message_id)


def notify_telegram(message: str):
    """Send a notification to the Gate 2 thread."""
    import gate2_telegram as g2
    g2._api_call("sendMessage", {
        "chat_id": g2.CHAT_ID,
        "message_thread_id": g2.THREAD_ID,
        "text": message,
    })


def update_kanban(task_id: str, action: str, note: str = ""):
    """Update Kanban card status."""
    try:
        if action == "return_to_todo":
            # Reset task to todo — hermes kanban doesn't have a direct "return" command,
            # so we add a comment with the failure note
            if note:
                subprocess.run(
                    ["hermes", "kanban", "comment", task_id, note],
                    capture_output=True, text=True, timeout=15,
                )
        elif action == "complete":
            subprocess.run(
                ["hermes", "kanban", "complete", task_id],
                capture_output=True, text=True, timeout=15,
            )
        elif action == "normal_update" and note:
            subprocess.run(
                ["hermes", "kanban", "comment", task_id, note],
                capture_output=True, text=True, timeout=15,
            )
    except Exception:
        pass


def run_orchestrator(job_url: str, task_id: str, dry_run: bool = False, sheet_id: str = "", access_token: str = ""):
    """Main orchestrator entry point."""

    log(f"{'DRY RUN — ' if dry_run else ''}APPLY orchestrator starting")
    log(f"Job URL: {job_url}")
    log(f"Task ID: {task_id}")

    results = {"steps": [], "success": False, "dry_run": dry_run}

    # ── Step 1: Find application directory ──
    app_dir = find_application_dir(job_url)
    if not app_dir:
        # Try to find by slug patterns
        slug = js.url_to_slug(job_url)
        log(f"No application dir found for slug: {slug}", "ERROR")
        results["steps"].append({"step": "find_app_dir", "ok": False, "error": f"No application dir for {slug}"})
        return results

    log(f"Application dir: {app_dir}")
    results["steps"].append({"step": "find_app_dir", "ok": True, "path": str(app_dir)})

    # ── Step 2: Validate DRAFT artifacts ──
    ok, missing = validate_draft(app_dir)
    if not ok:
        log(f"Missing DRAFT artifacts: {missing}", "ERROR")
        results["steps"].append({"step": "validate_draft", "ok": False, "missing": missing})
        return results
    log("DRAFT artifacts validated")
    results["steps"].append({"step": "validate_draft", "ok": True})

    # ── Step 3: Workday blocker ──
    blocked, reason = js.is_workday_blocked(job_url)
    if blocked:
        log(f"BLOCKED: {reason}", "ERROR")
        results["steps"].append({"step": "workday_check", "ok": False, "reason": reason})
        failure = js.SubmitFailure("workday", reason, "no_change", f"🚫 {reason}")
        if not dry_run:
            notify_telegram(failure.telegram_msg)
        return results
    log("Workday check: clear")
    results["steps"].append({"step": "workday_check", "ok": True})

    # ── Step 4: Gate 1 — Pipeline Approval Status ──
    if not sheet_id or not access_token:
        log("Sheet ID or access token not provided — Gate 1 cannot be checked", "WARN")
        results["steps"].append({"step": "gate1", "ok": False, "error": "Missing sheet_id or access_token"})
        if not dry_run:
            return results
        log("Dry run: continuing without Gate 1")
    else:
        g1 = js.gate1_check(job_url, sheet_id, access_token)
        results["steps"].append({"step": "gate1", **g1})
        if not g1["approved"]:
            log(f"Gate 1 FAILED: {g1.get('gate1_reason', g1.get('error', 'unknown'))}", "ERROR")
            failure = js.fail_gate1(g1.get("title", ""), g1.get("company", ""), g1.get("status", ""))
            if not dry_run:
                update_kanban(task_id, failure.kanban_action, failure.reason)
            return results
        log(f"Gate 1 PASSED: row {g1['row_number']}, {g1['title']} @ {g1['company']}")

    # ── Step 5: Acquire submit lock ──
    if dry_run:
        log("DRY RUN: skipping lock acquisition")
        results["steps"].append({"step": "lock_acquire", "ok": True, "dry_run": True})
    else:
        lock_ok, lock_msg = js.lock_acquire(job_url, task_id)
        results["steps"].append({"step": "lock_acquire", "ok": lock_ok, "message": lock_msg})
        if not lock_ok:
            log(f"Lock FAILED: {lock_msg}", "ERROR")
            failure = js.fail_lock_collision("", "", lock_msg)
            update_kanban(task_id, failure.kanban_action, failure.reason)
            notify_telegram(failure.telegram_msg)
            return results
        log(f"Lock acquired: {lock_msg}")

    # ── Steps 6–10 are wrapped in try/finally to guarantee lock release ──
    lock_held = not dry_run
    try:
        # Find Gate 1 data for Gate 2 message
        g1_data = next((s for s in results["steps"] if s.get("step") == "gate1" and s.get("approved")), {})
        title = g1_data.get("title", "Unknown Title")
        company = g1_data.get("company", "Unknown Company")

        # ── Step 6: Gate 2 — Telegram confirmation ──
        if dry_run:
            log("DRY RUN: skipping Gate 2 Telegram confirmation")
            results["steps"].append({"step": "gate2", "ok": True, "dry_run": True})
        else:
            send_result = send_gate2_request(title, company, "Greenhouse/Lever", "See application folder for details")
            results["steps"].append({"step": "gate2_send", **send_result})

            if not send_result.get("sent"):
                log("Gate 2 send FAILED", "ERROR")
                return results

            confirmed, confirm_reason = wait_for_gate2_confirmation(company, after_message_id=send_result.get("message_id"))
            results["steps"].append({"step": "gate2_confirm", "ok": confirmed, "reason": confirm_reason})

            if not confirmed:
                log(f"Gate 2 TIMEOUT: {confirm_reason}", "ERROR")
                failure = js.fail_gate2_timeout(title, company)
                update_kanban(task_id, failure.kanban_action, f"Cancelled — {failure.reason}")
                notify_telegram(failure.telegram_msg)
                return results

            log("Gate 2 CONFIRMED")
            results["gate2_confirmed"] = True

        # ── Step 7: Browser fill ──
        browser_ok = False
        try:
            # Phase 7: ONE universal filler handles HTML application forms.
            # Thin adapters may later handle navigation quirks, but field-level
            # filling is centralized in universal_filler.
            from urllib.parse import urlparse as _urlparse
            host = _urlparse(job_url).netloc.lower()
            log(f"Browser fill: using universal_filler for host {host or 'local'}")
            import universal_filler as uf
            filler = uf.UniversalFiller(
                url=job_url,
                app_dir=app_dir,
                headless=True,
                dry_run=dry_run,
                max_steps=1 if dry_run else 8,
                gate2_confirmed=(dry_run or results.get("gate2_confirmed") is True),
            )
            fill_result = filler.run()
            if dry_run:
                browser_ok = bool(fill_result.get("dry_run_valid")) and not fill_result.get("manual_review") and not fill_result.get("error")
            else:
                browser_ok = bool(fill_result.get("submitted")) and fill_result.get("submission_state") == "verified"
            results["steps"].append({"step": "browser_fill", "ok": browser_ok, "result": fill_result})
            if not browser_ok:
                err = fill_result.get("error") or "Universal filler did not complete submission; manual review required"
                log(f"Browser fill failed/manual-review: {err}", "ERROR")
                if not dry_run:
                    if fill_result.get("submit_attempted"):
                        notify_telegram(f"⚠️ Manual verification required for {company}: submit may have been attempted but confirmation was not verified. Do not retry automatically. Error: {err}")
                    else:
                        failure = js.fail_browser_crash(title, company, err)
                        update_kanban(task_id, failure.kanban_action, failure.reason)
                        notify_telegram(failure.telegram_msg)
                return results
        except Exception as e:
            log(f"Browser fill CRASHED: {e}", "ERROR")
            if not dry_run:
                failure = js.fail_browser_crash(title, company, str(e))
                update_kanban(task_id, failure.kanban_action, failure.reason)
                notify_telegram(failure.telegram_msg)
            results["steps"].append({"step": "browser_fill", "ok": False, "error": str(e)})
            return results

        # ── Step 8: Evidence capture ──
        if dry_run:
            log("DRY RUN: skipping submission evidence write; filler may write dry-run diagnostics")
            results["steps"].append({"step": "evidence", "ok": True, "dry_run": True})
        elif browser_ok:
            try:
                evidence_dir = js.write_evidence(job_url, company, title, task_id)
                log(f"Evidence written to {evidence_dir}")
                results["steps"].append({"step": "evidence", "ok": True, "path": str(evidence_dir)})
            except Exception as e:
                log(f"Screenshot/evidence capture failed: {e}", "WARN")
                failure = js.fail_screenshot(title, company)
                notify_telegram(failure.telegram_msg)
                results["steps"].append({"step": "evidence", "ok": False, "error": str(e)})
                # Proceed anyway per spec — submit is still valid

        # ── Step 9: Pipeline update ──
        if dry_run:
            log("DRY RUN: skipping Pipeline update")
            results["steps"].append({"step": "pipeline_update", "ok": True, "dry_run": True})
        elif browser_ok and sheet_id and access_token:
            row_num = g1_data.get("row_number")
            if row_num:
                update_result = js.update_pipeline_applied(
                    sheet_id, access_token, row_num,
                    notes_append=f"Submitted {datetime.now(timezone(timedelta(hours=-5))).strftime('%Y-%m-%d %H:%M CT')} via Hermes — see evidence/ folder",
                )
                results["steps"].append({"step": "pipeline_update", **update_result})
                if update_result.get("success"):
                    log(f"Pipeline row {row_num} updated to Applied")
                else:
                    log(f"Pipeline update failed: {update_result.get('error')}", "WARN")

        # Compute success from step results
        failed_steps = [s for s in results["steps"] if not s.get("ok") and not s.get("dry_run")]
        results["success"] = len(failed_steps) == 0
        log("Orchestrator complete" + (" (DRY RUN)" if dry_run else "") + (" — with warnings" if failed_steps else ""))

    finally:
        # ── Step 10: Release lock (guaranteed) ──
        if lock_held:
            release_ok, release_msg = js.lock_release(job_url, task_id)
            log(f"Lock released: {release_msg}")
            results["steps"].append({"step": "lock_release", "ok": release_ok})

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JHOS APPLY Card Orchestrator")
    parser.add_argument("--job-url", required=True, help="Job posting URL")
    parser.add_argument("--task-id", required=True, help="Kanban task ID")
    parser.add_argument("--dry-run", action="store_true", help="Run checks without submitting")
    parser.add_argument("--sheet-id", default=os.environ.get("JHOS_SHEET_ID", ""), help="Google Sheet ID")
    parser.add_argument("--access-token", default=os.environ.get("JHOS_ACCESS_TOKEN", ""), help="Google Sheets access token")

    args = parser.parse_args()

    results = run_orchestrator(
        job_url=args.job_url,
        task_id=args.task_id,
        dry_run=args.dry_run,
        sheet_id=args.sheet_id,
        access_token=args.access_token,
    )

    print("\n" + json.dumps(results, indent=2))
