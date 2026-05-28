"""
Data fetchers for the 3-hour briefing.

Each function returns a typed dict. Every fetcher must fail-soft: an
unreachable source produces an empty payload with an `_error` key, not
an exception. The orchestrator treats `_error` as a calm "stale" state
in the rendered briefing.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

# ─── Job-Bored ──────────────────────────────────────────────────────

JOBBORED_BASE = os.environ.get("JOBBORED_BASE", "http://127.0.0.1:8787")


def fetch_jobbored() -> dict[str, Any]:
    """Pull active applications from the local Job-Bored Express server."""
    try:
        with urllib.request.urlopen(f"{JOBBORED_BASE}/api/applications", timeout=5) as r:
            apps = json.loads(r.read()).get("applications", [])
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return _jobbored_empty(error=str(e))

    today = datetime.now().date().isoformat()
    week_ago_dt = datetime.now(timezone.utc) - timedelta(days=7)
    sent_today = sum(1 for a in apps if (a.get("updatedAt") or "").startswith(today)
                     and (a.get("status") or "") in ("submitted", "applied"))
    drafts_pending = sum(1 for a in apps if (a.get("status") or "") in ("draft", "pending", "generating"))
    interviews_week = sum(
        1 for a in apps
        if (a.get("status") or "") == "interview"
        and _parse_ts(a.get("updatedAt")) and _parse_ts(a.get("updatedAt")) >= week_ago_dt
    )

    recent = [a for a in apps if _parse_ts(a.get("updatedAt")) and _parse_ts(a.get("updatedAt")) >= week_ago_dt
              and (a.get("status") or "") not in ("draft", "pending", "generating")]
    responded = [a for a in recent if (a.get("status") or "") not in ("submitted", "applied")]
    rate = round(100 * len(responded) / len(recent)) if recent else None

    return {
        "sent_today": sent_today,
        "drafts_pending": drafts_pending,
        "interviews_this_week": interviews_week,
        "response_rate_7d": f"{rate}%" if rate is not None else "—",
        "active": [
            {
                "slug": a.get("slug", ""),
                "company": a.get("company") or "—",
                "role": a.get("title") or "—",
                "stage": a.get("status") or "unknown",
                "last_action": (a.get("updatedAt") or "")[:10] or "—",
                "next_action": _next_action_for_stage(a.get("status") or ""),
                "stuck": _is_stuck(a),
            }
            for a in apps[:12]
        ],
    }


def _jobbored_empty(error: str | None = None) -> dict[str, Any]:
    return {
        "_error": error,
        "sent_today": 0,
        "drafts_pending": 0,
        "interviews_this_week": 0,
        "response_rate_7d": "—",
        "active": [],
    }


def _next_action_for_stage(stage: str) -> str:
    return {
        "draft": "Review & submit",
        "pending": "Wait for generation",
        "generating": "Wait for generation",
        "submitted": "Wait for response",
        "applied": "Wait for response",
        "interview": "Prep & confirm",
        "offer": "Decide & negotiate",
        "rejected": "Archive",
    }.get(stage, "Check in")


def _is_stuck(app: dict) -> bool:
    last = _parse_ts(app.get("updatedAt"))
    if not last:
        return False
    return (datetime.now(timezone.utc) - last).days > 5


def _parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


# ─── Gmail (stub until OAuth wired) ─────────────────────────────────


def fetch_inbox() -> dict[str, Any]:
    """
    Return important emails for the briefing.

    Replace this stub with a real Gmail API call. Auth setup:
      1. Enable Gmail API in a Google Cloud project.
      2. Create an OAuth 2.0 desktop client.
      3. Run the one-time quickstart to mint a refresh token.
      4. Drop GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN into ~/.briefing/.env.
    Importance filter: start with `is:starred OR label:^io_im` then iterate.
    """
    if not os.environ.get("GOOGLE_REFRESH_TOKEN"):
        return {
            "_stub": True,
            "important": [
                {
                    "from": "recruiter@example.com",
                    "subject": "Interview availability for next week",
                    "snippet": "Hi Emilio — we'd love to schedule a follow-up call. Are you free Tues or Wed afternoon?",
                    "received": "2h ago",
                    "requires_reply": True,
                },
                {
                    "from": "calendar-notify@google.com",
                    "subject": "Tomorrow: 9am sync with design team",
                    "snippet": "Reminder for your event tomorrow at 9:00 AM Mountain.",
                    "received": "5h ago",
                    "requires_reply": False,
                },
                {
                    "from": "founders@yc.com",
                    "subject": "W26 batch updates",
                    "snippet": "Office hours signup is open. New investor intros this week.",
                    "received": "yesterday",
                    "requires_reply": False,
                },
            ],
        }
    # TODO: real Gmail fetch
    return {"important": []}


# ─── Calendar (stub until OAuth wired) ──────────────────────────────


def fetch_calendar() -> dict[str, Any]:
    """
    Return next-24h calendar events plus visible free blocks.

    Same Google OAuth as Gmail — add `calendar.readonly` to the scope list
    when you mint the refresh token.
    """
    if not os.environ.get("GOOGLE_REFRESH_TOKEN"):
        return {
            "_stub": True,
            "upcoming": [
                {
                    "time": "Today 3:00 PM",
                    "title": "Recruiter call · Stripe",
                    "duration": "30m",
                    "location": "Google Meet",
                    "prep_needed": True,
                    "conflict": False,
                },
                {
                    "time": "Today 5:30 PM",
                    "title": "Gym",
                    "duration": "60m",
                    "location": "—",
                    "prep_needed": False,
                    "conflict": False,
                },
                {
                    "time": "Tomorrow 9:00 AM",
                    "title": "Design review",
                    "duration": "45m",
                    "location": "Zoom",
                    "prep_needed": True,
                    "conflict": False,
                },
            ],
            "free_blocks": [
                {"label": "Today 4:00 – 5:30 PM"},
                {"label": "Tomorrow 10:30 AM – 12:00 PM"},
            ],
        }
    # TODO: real Calendar fetch
    return {"upcoming": [], "free_blocks": []}


# ─── Agent heartbeats over Tailscale ────────────────────────────────


def _heartbeat_sources() -> list[tuple[str, str]]:
    raw = os.environ.get("HEARTBEAT_SOURCES", "").strip()
    if not raw:
        return []
    return [(name.strip(), url.strip()) for chunk in raw.split(",")
            for name, _, url in [chunk.partition("|")] if url]


def fetch_agents() -> dict[str, Any]:
    """Pull each agent's heartbeat JSON. Stale = >5 min since heartbeat."""
    sources = _heartbeat_sources()
    if not sources:
        return {
            "_stub": True,
            "agents": [
                {"name": "hermes-job-hunt", "status": "idle", "last_heartbeat": "30s ago",
                 "current_task": "Awaiting next discovery cycle", "stale": False},
                {"name": "browser-use-discovery", "status": "running", "last_heartbeat": "1m ago",
                 "current_task": "Crawling Greenhouse boards", "stale": False},
            ],
        }

    agents = []
    now = datetime.now(timezone.utc)
    for name, url in sources:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                hb = json.loads(r.read())
            last = _parse_ts(hb.get("timestamp"))
            age = (now - last).total_seconds() if last else 99999
            agents.append({
                "name": hb.get("agent") or name,
                "status": hb.get("status", "unknown"),
                "last_heartbeat": _humanize(age),
                "current_task": hb.get("current_task") or "—",
                "stale": age > 300,
            })
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            agents.append({
                "name": name, "status": "unreachable",
                "last_heartbeat": "—", "current_task": f"error: {e}",
                "stale": True,
            })
    return {"agents": agents}


def _humanize(seconds: float) -> str:
    if seconds < 60:
        return f"{int(seconds)}s ago"
    if seconds < 3600:
        return f"{int(seconds/60)}m ago"
    if seconds < 86400:
        return f"{int(seconds/3600)}h ago"
    return f"{int(seconds/86400)}d ago"


# ─── Orchestrated fetch ─────────────────────────────────────────────


def fetch_all() -> dict[str, Any]:
    """Run every fetcher; each one fails soft."""
    return {
        "jobs": fetch_jobbored(),
        "inbox": fetch_inbox(),
        "calendar": fetch_calendar(),
        "agents": fetch_agents(),
    }
