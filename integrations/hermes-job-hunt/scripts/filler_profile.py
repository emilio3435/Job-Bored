#!/usr/bin/env python3
"""
JHOS Phase 7 — Candidate Profile & Answer Strategies

Single source of truth for the universal form filler.
All candidate data, answer strategies, and resume/cover-letter paths live here.
"""

import os
from pathlib import Path

# ─── Candidate identity ──────────────────────────────────────────────

CANDIDATE = {
    "first_name": "Emilio",
    "last_name": "Nunez-Garcia",
    "full_name": "Emilio Nunez-Garcia",
    "email": "emilio3435@gmail.com",
    "phone": "501.366.2080",
    "location": "Denver, CO",
    "city": "Denver",
    "state": "Colorado",
    "zip": "80205",
    "country": "United States",
    "linkedin": "https://www.linkedin.com/in/emiliobuilds",
    "website": "https://emiliobuilds.com",
    "portfolio": "https://emiliobuilds.com",
    "github": "https://github.com/emilio3435",
}

# ─── Standard answer strategies ─────────────────────────────────────
# These map semantic question categories to answers.
# The LLM reasoner uses these as a lookup, not keyword matching.

ANSWER_STRATEGIES = {
    # Work authorization
    "work_authorization": "Yes",
    "legally_authorized_us": "Yes",
    "require_sponsorship": "No",
    "sponsorship_now_or_future": "No",

    # Availability
    "start_date": "Immediately",
    "available_start": "Immediately",
    "notice_period": "None — available immediately",
    "willing_to_relocate": "Open to discussion",

    # Source / referral
    "referral_source": "Job Board",
    "how_did_you_hear": "Job Board",

    # EEO / self-identification — always decline
    "eeo_gender": "Decline to self-identify",
    "eeo_race": "Decline to self-identify",
    "eeo_ethnicity": "Decline to self-identify",
    "eeo_veteran": "I am not a protected veteran",
    "eeo_disability": "I do not want to answer",

    # Salary / compensation — NEVER fill
    "salary_expectation": "__SKIP__",
    "desired_salary": "__SKIP__",
    "compensation": "__SKIP__",

    # Age / legal
    "age_18_or_older": "Yes",
    "background_check_consent": "Yes",
    "drug_test_consent": "Yes",

    # Education
    "highest_education": "Bachelor's Degree",
    "degree": "Bachelor of Arts, Economics",
    "school": "Colorado College",
    "graduation_year": "2017",

    # Experience
    "years_experience": "10+",
    "years_digital_marketing": "10+",
    "years_management": "5+",

    # Languages
    "languages": "English (native), Spanish (native/bilingual), French (proficient), Italian (proficient)",
}

# ─── Professional summary for open-text fields ──────────────────────

PROFESSIONAL_SUMMARY = (
    "Performance marketer and AI product builder with 10+ years across paid "
    "acquisition, client strategy, sales leadership, and the systems behind both. "
    "Eight years at Audacy Denver — four progressive roles from Digital Campaign "
    "Manager to Digital Sales Manager — ending with ownership of a $10M+ annual "
    "digital book that ranked top-3 nationally in Digital Marketing Solutions "
    "revenue. Founder of Elio Intelligence Suite and Hormiga Dormida: AI projects "
    "in active development on GCP spanning multi-model LLM routing, campaign "
    "forecasting, and workflow automation. Math Econ background from Colorado "
    "College. Bilingual English/Spanish."
)

# ─── Cover letter fallback for "Why this role?" type questions ───────

WHY_INTERESTED_TEMPLATE = (
    "I'm drawn to this role because it sits at the intersection of performance "
    "marketing and technology — exactly where I've spent the last decade. My "
    "experience owning a $10M+ digital book at Audacy Denver, combined with "
    "building AI-powered marketing systems as founder of Elio Intelligence Suite, "
    "gives me both the strategic perspective and hands-on technical fluency this "
    "position calls for."
)

# ─── File paths ──────────────────────────────────────────────────────

def env_path(name, default):
    return Path(os.environ.get(name) or default).expanduser()


HERMES_HOME = env_path("HERMES_HOME", Path.home() / ".hermes")
JHOS_ROOT = env_path("HERMES_JOB_HUNT_HOME", HERMES_HOME / "job-hunt")
APPLICATIONS_DIR = env_path("HERMES_APPLICATIONS_DIR", JHOS_ROOT / "applications")
PROFILE_DIR = JHOS_ROOT / "profile"


def get_application_files(app_dir: Path) -> dict:
    """Return paths to resume and cover letter PDFs in an application dir."""
    return {
        "resume_pdf": app_dir / "resume.pdf",
        "cover_letter_pdf": app_dir / "cover-letter.pdf",
        "resume_html": app_dir / "resume.html",
        "cover_letter_html": app_dir / "cover-letter.html",
    }


def build_profile_context() -> str:
    """Build a compact text block the LLM reasoner uses to fill forms."""
    lines = ["# Candidate Profile for Form Filling", ""]
    for k, v in CANDIDATE.items():
        lines.append(f"- {k}: {v}")
    lines.append("")
    lines.append("# Answer Strategies")
    lines.append("Use __SKIP__ to leave a field empty. Map form questions to the closest key below.")
    lines.append("")
    for k, v in ANSWER_STRATEGIES.items():
        lines.append(f"- {k}: {v}")
    lines.append("")
    lines.append("# Professional Summary (for open-text 'about yourself' fields)")
    lines.append(PROFESSIONAL_SUMMARY)
    lines.append("")
    lines.append("# Why Interested (for 'why this role?' open-text fields)")
    lines.append(WHY_INTERESTED_TEMPLATE)
    return "\n".join(lines)
