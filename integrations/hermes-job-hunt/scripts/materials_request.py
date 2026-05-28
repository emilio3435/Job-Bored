#!/usr/bin/env python3
"""
materials_request.py — post a "draft my materials" request to Telegram.

This is the bridge between the JobBored dossier (Draft cover letter /
Tailor resume buttons) and the existing Hermes agent workflow you run
manually today. It does NOT generate documents itself; it:

  1. Validates input
  2. Ensures ~/.hermes/job-hunt/applications/<slug>/ exists
  3. Writes / merges <slug>/pending.json so the JobBored UI can show
     the "Generating…" status pill on the materials cards
  4. Posts a "📝 MATERIALS REQUEST" message to the same Telegram
     supergroup + thread used by gate2-status-watcher.py

Usage:
    python3 materials_request.py \
        --slug chartis-senior-digital-marketing-consultant \
        --company "Chartis" \
        --title "Senior Digital Marketing Consultant" \
        --feature cover_letter \
        [--job-url https://...] \
        [--notes "Emphasize agency work"]

Output:
    stdout: JSON object {ok, slug, telegram_message_id, pending_path}
    exit 0: request sent + pending.json written
    exit 1: validation failure
    exit 2: Telegram send failed (pending.json still written so the
            UI can show a "queued, telegram failed" hint)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Reuse the existing Telegram helper so we share the bot token loader,
# escape rules, and HTTP retries with gate2_telegram.py.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import gate2_telegram as g2  # type: ignore  # noqa: E402

APPLICATIONS_ROOT = Path.home() / ".hermes" / "job-hunt" / "applications"

SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,127}$")
FEATURES = {"resume", "cover_letter", "both"}
QUALITY_CONTRACT = {
    "version": "materials-quality.v1",
    "profile_path": "~/.hermes/job-hunt/profile/materials-quality.md",
    "resume_target": "one_page_full_or_two_page_full",
    "cover_letter_target": "one_page_325_450_words",
    "qa_required": True,
}


def validate_args(args: argparse.Namespace) -> str | None:
    """Return an error message string when args are invalid, else None."""
    if not args.slug or not SLUG_PATTERN.match(args.slug):
        return f"Invalid slug: {args.slug!r}"
    if args.feature not in FEATURES:
        return f"feature must be one of {sorted(FEATURES)}, got {args.feature!r}"
    if not args.company.strip():
        return "company is required"
    if not args.title.strip():
        return "title is required"
    return None


def merge_pending(app_dir: Path, payload: dict) -> Path:
    """Write or merge pending.json with the new request."""
    app_dir.mkdir(parents=True, exist_ok=True)
    pending_path = app_dir / "pending.json"
    existing: dict = {}
    if pending_path.exists():
        try:
            existing = json.loads(pending_path.read_text())
        except json.JSONDecodeError:
            existing = {}
    # Keep a short history so re-requests don't silently overwrite the
    # original request timestamp the UI is showing.
    history = existing.get("history") or []
    if existing.get("feature") and existing.get("requested_at"):
        history.append({
            "feature": existing.get("feature"),
            "requested_at": existing.get("requested_at"),
            "telegram_message_id": existing.get("telegram_message_id"),
            "notes": existing.get("notes", ""),
        })
    history = history[-10:]
    merged = {
        **existing,
        **payload,
        "history": history,
    }
    pending_path.write_text(json.dumps(merged, indent=2))
    return pending_path


def feature_label(feature: str) -> str:
    return {
        "resume": "TAILORED RESUME",
        "cover_letter": "COVER LETTER",
        "both": "RESUME + COVER LETTER",
    }[feature]


def build_telegram_text(slug: str, company: str, title: str, feature: str,
                        job_url: str, notes: str) -> str:
    """Compose the Telegram message. Plain text (no Markdown) to dodge
    parse-mode footguns; gate2_telegram.send_approval_request shows
    that pattern works reliably."""
    lines = [
        "📝 MATERIALS REQUEST",
        "",
        f"Feature: {feature_label(feature)}",
        f"Role:    {title}",
        f"Company: {company}",
        f"Slug:    {slug}",
    ]
    if job_url:
        lines.append(f"Link:    {job_url}")
    if notes:
        lines.append("")
        lines.append("Notes from JobBored:")
        for line in notes.splitlines():
            lines.append(f"  {line}")
    lines += [
        "",
        "Quality contract:",
        "  Read: ~/.hermes/job-hunt/profile/materials-quality.md",
        "  Resume: intentional one-page or two-page fit; repair sparse/overflow pages.",
        "  QA: record page count, page density, evidence used, omissions, and caveats.",
    ]
    lines += [
        "",
        f"Folder: ~/.hermes/job-hunt/applications/{slug}/",
        "Once drafts are saved, delete pending.json to clear the UI badge.",
    ]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--company", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--feature", required=True, choices=sorted(FEATURES))
    parser.add_argument("--job-url", default="")
    parser.add_argument("--notes", default="")
    parser.add_argument("--applications-root", default=str(APPLICATIONS_ROOT),
                        help="Override the applications dir (used in tests).")
    parser.add_argument("--no-telegram", action="store_true",
                        help="Skip the Telegram send (writes pending.json only).")
    args = parser.parse_args()

    err = validate_args(args)
    if err:
        print(json.dumps({"ok": False, "error": err}), file=sys.stderr)
        return 1

    root = Path(args.applications_root).expanduser()
    app_dir = root / args.slug
    requested_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = {
        "slug": args.slug,
        "company": args.company.strip(),
        "title": args.title.strip(),
        "feature": args.feature,
        "job_url": args.job_url.strip(),
        "notes": args.notes.strip(),
        "requested_at": requested_at,
        "source": "jobbored-dossier",
        "quality_contract": QUALITY_CONTRACT,
    }

    telegram_message_id: int | None = None
    telegram_error: str | None = None

    if not args.no_telegram:
        text = build_telegram_text(
            slug=args.slug,
            company=args.company.strip(),
            title=args.title.strip(),
            feature=args.feature,
            job_url=args.job_url.strip(),
            notes=args.notes.strip(),
        )
        try:
            result = g2._api_call("sendMessage", {
                "chat_id": g2.CHAT_ID,
                "message_thread_id": g2.THREAD_ID,
                "text": text,
            })
            if result.get("ok"):
                telegram_message_id = result["result"]["message_id"]
            else:
                telegram_error = result.get("error", "Unknown Telegram error")
        except Exception as exc:  # pragma: no cover — network errors
            telegram_error = str(exc)

    if telegram_message_id is not None:
        payload["telegram_message_id"] = telegram_message_id

    pending_path = merge_pending(app_dir, payload)

    out = {
        "ok": telegram_error is None,
        "slug": args.slug,
        "pending_path": str(pending_path),
        "telegram_message_id": telegram_message_id,
        "requested_at": requested_at,
    }
    if telegram_error:
        out["telegram_error"] = telegram_error
        # Telegram is a side-effect notifier, not the materials pipeline.
        # pending.json was written; Dobby's watcher will pick it up
        # regardless of whether the Telegram heads-up made it through.
        # Returning 0 keeps the JobBored optimistic UI intact (progress
        # card stays visible); the Telegram error is surfaced as metadata
        # so callers can show a non-blocking warning if they want.
        out["ok"] = True
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
