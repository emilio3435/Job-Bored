"""
Render a briefing snapshot to HTML.

Pipeline:
  data (from fetchers) + prev_snapshot → deltas → headline (LLM) → Jinja → HTML
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

TEMPLATES_DIR = Path(__file__).parent / "templates"
DEFAULT_TEMPLATE = os.environ.get("BRIEFING_TEMPLATE", "editorial.html.j2")


# ─── Delta computation ──────────────────────────────────────────────


def compute_deltas(curr: dict[str, Any], prev: dict[str, Any] | None) -> list[dict[str, str]]:
    """Flat list of {label, kind} pills. Empty list if no prior snapshot."""
    if not prev:
        return []

    deltas: list[dict[str, str]] = []

    prev_apps = {a["slug"]: a for a in (prev.get("jobs", {}).get("active") or []) if a.get("slug")}
    curr_apps = {a["slug"]: a for a in (curr.get("jobs", {}).get("active") or []) if a.get("slug")}

    for slug, app in curr_apps.items():
        if slug not in prev_apps:
            deltas.append({"label": f"New: {app['company']} {app['role']}", "kind": "new"})
        elif prev_apps[slug].get("stage") != app.get("stage"):
            deltas.append({
                "label": f"{app['company']}: {prev_apps[slug].get('stage')} → {app['stage']}",
                "kind": "changed",
            })

    prev_emails = {(e["from"], e["subject"]) for e in (prev.get("inbox", {}).get("important") or [])}
    for email in curr.get("inbox", {}).get("important") or []:
        if (email["from"], email["subject"]) not in prev_emails:
            deltas.append({"label": f"Email: {email['subject'][:48]}", "kind": "new"})

    prev_agents = {a["name"]: a for a in (prev.get("agents", {}).get("agents") or [])}
    for agent in curr.get("agents", {}).get("agents") or []:
        was_stale = prev_agents.get(agent["name"], {}).get("stale", False)
        if agent["stale"] and not was_stale:
            deltas.append({"label": f"Agent stale: {agent['name']}", "kind": "changed"})
        elif was_stale and not agent["stale"]:
            deltas.append({"label": f"Agent recovered: {agent['name']}", "kind": "resolved"})

    return deltas[:12]


# ─── Headline (Claude API, single sentence) ─────────────────────────


def generate_headline(data: dict[str, Any], deltas: list[dict[str, str]]) -> str:
    """
    Ask Claude for the single most important sentence right now.

    Bounded surface: structured JSON in, single string out. If the API
    key is missing or the call fails, fall back to a deterministic
    headline so the briefing always renders.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return _fallback_headline(data, deltas)

    try:
        from anthropic import Anthropic
    except ImportError:
        return _fallback_headline(data, deltas)

    summary = {
        "jobs_sent_today": data["jobs"]["sent_today"],
        "drafts_pending": data["jobs"]["drafts_pending"],
        "interviews_this_week": data["jobs"]["interviews_this_week"],
        "next_event": (data["calendar"]["upcoming"] or [{}])[0].get("title"),
        "next_event_time": (data["calendar"]["upcoming"] or [{}])[0].get("time"),
        "important_email_count": len(data["inbox"]["important"]),
        "reply_needed_count": sum(1 for e in data["inbox"]["important"] if e.get("requires_reply")),
        "stale_agents": [a["name"] for a in data["agents"]["agents"] if a.get("stale")],
        "deltas": [d["label"] for d in deltas],
    }

    prompt = (
        "You are writing the single headline sentence for Emilio's 3-hour personal briefing.\n"
        "Constraints:\n"
        "- One sentence, under 18 words.\n"
        "- Name the single most important thing right now. If nothing is urgent, write a calm status line.\n"
        "- No emoji. No exclamation marks. No 'Good morning/afternoon'. No restating what's on the dashboard.\n"
        "- Refer to concrete nouns (company names, event titles) where they exist.\n"
        "- Return strict JSON: {\"headline\": \"...\"}\n\n"
        f"Snapshot:\n{json.dumps(summary, indent=2)}"
    )

    try:
        client = Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=120,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        # Strip code fences if model adds them.
        if text.startswith("```"):
            text = text.split("```")[1].lstrip("json").strip()
        return json.loads(text)["headline"]
    except Exception:
        return _fallback_headline(data, deltas)


def _fallback_headline(data: dict[str, Any], deltas: list[dict[str, str]]) -> str:
    """Deterministic headline used when the LLM call is unavailable."""
    reply_needed = [e for e in data["inbox"]["important"] if e.get("requires_reply")]
    if reply_needed:
        return f"Reply waiting: {reply_needed[0]['subject'][:60]}"
    upcoming = data["calendar"]["upcoming"]
    if upcoming:
        nxt = upcoming[0]
        return f"Next up: {nxt['title']} at {nxt['time']}"
    stale = [a["name"] for a in data["agents"]["agents"] if a.get("stale")]
    if stale:
        return f"{len(stale)} agent(s) stale: {', '.join(stale)}"
    if data["jobs"]["drafts_pending"]:
        return f"{data['jobs']['drafts_pending']} application draft(s) waiting for review"
    return "All quiet — no urgent items in this window."


# ─── Render ─────────────────────────────────────────────────────────


def render(data: dict[str, Any], prev: dict[str, Any] | None,
           briefing_id: str, window_label: str, next_briefing_time: str) -> str:
    deltas = compute_deltas(data, prev)
    headline = generate_headline(data, deltas)

    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(["html", "j2"]),
    )
    template = env.get_template(DEFAULT_TEMPLATE)
    return template.render(
        headline=headline,
        deltas=deltas,
        jobs=data["jobs"],
        calendar=data["calendar"],
        inbox=data["inbox"],
        agents=data["agents"]["agents"],
        window_label=window_label,
        next_briefing_time=next_briefing_time,
        briefing_id=briefing_id,
        generated_at=datetime.now().strftime("%a %b %-d · %-I:%M %p"),
    )
