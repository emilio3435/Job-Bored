#!/usr/bin/env python3
"""
JHOS Phase 7 — Candidate Profile & Answer Strategies

Single source of truth for the universal form filler. The candidate's
identity and personal answers are NEVER hardcoded here (BEAUDIT H8): they load
from the user's gitignored profile, and the filler fails closed without one.

Lookup order (first match wins), in `$JHOS_PROFILE_DIR` or
`$HERMES_JOB_HUNT_HOME/profile` (default `~/.hermes/job-hunt/profile`):
  1. filler-profile.json  — full control (template: filler-profile.example.json)
  2. profile.md           — the `## Contact` section of the canonical profile
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

REQUIRED_CANDIDATE_FIELDS = ("first_name", "last_name", "email")
PLACEHOLDER_RE = re.compile(r"\[[^\]]*\]|your name|you@example\.com|555-555-5555", re.IGNORECASE)


class ProfileMissingError(RuntimeError):
    """No usable local candidate profile; live filling must not start."""


# ─── Neutral answer strategies (no personal facts) ──────────────────
# Personal answers (work authorization, education, experience, languages)
# come from the local profile's "answer_strategies" and override these.

DEFAULT_ANSWER_STRATEGIES = {
    # Source / referral
    "referral_source": "Job Board",
    "how_did_you_hear": "Job Board",

    # EEO / self-identification — always decline
    "eeo_gender": "Decline to self-identify",
    "eeo_race": "Decline to self-identify",
    "eeo_ethnicity": "Decline to self-identify",
    "eeo_veteran": "I don't wish to answer",
    "eeo_disability": "I do not want to answer",

    # Salary / compensation — NEVER fill
    "salary_expectation": "__SKIP__",
    "desired_salary": "__SKIP__",
    "compensation": "__SKIP__",
}

SKIP_ONLY_KEYS = ("salary_expectation", "desired_salary", "compensation")


# ─── File paths ──────────────────────────────────────────────────────

def env_path(name, default):
    return Path(os.environ.get(name) or default).expanduser()


def jhos_root() -> Path:
    hermes_home = env_path("HERMES_HOME", Path.home() / ".hermes")
    return env_path("HERMES_JOB_HUNT_HOME", hermes_home / "job-hunt")


def profile_dir() -> Path:
    return env_path("JHOS_PROFILE_DIR", jhos_root() / "profile")


def get_application_files(app_dir: Path) -> dict:
    """Return paths to resume and cover letter PDFs in an application dir."""
    return {
        "resume_pdf": app_dir / "resume.pdf",
        "cover_letter_pdf": app_dir / "cover-letter.pdf",
        "resume_html": app_dir / "resume.html",
        "cover_letter_html": app_dir / "cover-letter.html",
    }


# ─── Loading ─────────────────────────────────────────────────────────

def _link_target(value: str) -> str:
    match = re.search(r"\]\((https?://[^)\s]+)\)", value)
    if match:
        return match.group(1)
    value = value.strip()
    if value and not value.startswith("http") and "." in value and " " not in value:
        return "https://" + value
    return value


def _contact_from_profile_md(text: str) -> dict:
    section = re.search(r"^##\s+Contact\s*$(.*?)(?=^##\s|\Z)", text, flags=re.M | re.S)
    if not section:
        return {}
    fields = {}
    for line in section.group(1).splitlines():
        m = re.match(r"\s*[-*]\s*([^:]+):\s*(.+)$", line)
        if m:
            fields[m.group(1).strip().lower()] = m.group(2).strip()
    candidate = {}
    name = fields.get("name", "")
    if name:
        parts = name.split()
        candidate["full_name"] = name
        candidate["first_name"] = parts[0]
        candidate["last_name"] = " ".join(parts[1:])
    if fields.get("email"):
        candidate["email"] = fields["email"]
    if fields.get("phone"):
        candidate["phone"] = fields["phone"]
    location = fields.get("location", "")
    if location:
        candidate["location"] = location
        city, _, state = location.partition(",")
        candidate["city"] = city.strip()
        if state.strip():
            candidate["state"] = state.strip()
    for key in ("linkedin", "portfolio", "website", "github"):
        if fields.get(key):
            candidate[key] = _link_target(fields[key])
    if "website" not in candidate and "portfolio" in candidate:
        candidate["website"] = candidate["portfolio"]
    return candidate


def _validate(candidate: dict, source: Path) -> dict:
    missing = [k for k in REQUIRED_CANDIDATE_FIELDS if not str(candidate.get(k) or "").strip()]
    if missing:
        raise ProfileMissingError(f"{source} is missing {', '.join(missing)}")
    placeholders = [k for k, v in candidate.items() if isinstance(v, str) and PLACEHOLDER_RE.search(v)]
    if placeholders:
        raise ProfileMissingError(f"{source} still has template placeholders in: {', '.join(sorted(placeholders))}")
    candidate.setdefault("full_name", f"{candidate['first_name']} {candidate['last_name']}".strip())
    return candidate


def _load_local() -> dict:
    directory = profile_dir()
    json_path = directory / "filler-profile.json"
    if json_path.exists():
        try:
            data = json.loads(json_path.read_text())
        except json.JSONDecodeError as exc:
            raise ProfileMissingError(f"{json_path} is not valid JSON: {exc}") from exc
        data = dict(data)
        data["candidate"] = _validate(dict(data.get("candidate") or {}), json_path)
        return data
    md_path = directory / "profile.md"
    if md_path.exists():
        return {"candidate": _validate(_contact_from_profile_md(md_path.read_text()), md_path)}
    raise ProfileMissingError(
        f"No candidate profile in {directory}. Copy profile/filler-profile.example.json to "
        "filler-profile.json (or fill in profile.md) before running the filler."
    )


def load_candidate() -> dict:
    """The candidate's identity. Raises ProfileMissingError when absent."""
    return dict(_load_local()["candidate"])


def get_answer_strategies() -> dict:
    strategies = dict(DEFAULT_ANSWER_STRATEGIES)
    try:
        strategies.update(_load_local().get("answer_strategies") or {})
    except ProfileMissingError:
        pass
    for key in SKIP_ONLY_KEYS:  # compensation stays blocked whatever the profile says
        strategies[key] = "__SKIP__"
    return strategies


def build_profile_context() -> str:
    """Build a compact text block the LLM reasoner uses to fill forms."""
    local = _load_local()
    lines = ["# Candidate Profile for Form Filling", ""]
    for k, v in local["candidate"].items():
        lines.append(f"- {k}: {v}")
    lines.append("")
    lines.append("# Answer Strategies")
    lines.append("Use __SKIP__ to leave a field empty. Map form questions to the closest key below.")
    lines.append("")
    for k, v in get_answer_strategies().items():
        lines.append(f"- {k}: {v}")
    if local.get("professional_summary"):
        lines.append("")
        lines.append("# Professional Summary (for open-text 'about yourself' fields)")
        lines.append(str(local["professional_summary"]))
    if local.get("why_interested"):
        lines.append("")
        lines.append("# Why Interested (for 'why this role?' open-text fields)")
        lines.append(str(local["why_interested"]))
    return "\n".join(lines)
