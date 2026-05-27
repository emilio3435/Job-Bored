"""Thin ATS workflow adapters for JHOS Phase 7.

Adapters handle navigation quirks only. Field-level filling belongs to
universal_filler.UniversalFiller.
"""

from .indeed import detect_indeed_flow
from .linkedin import is_linkedin_easy_apply
from .workday import detect_workday_state

__all__ = ["detect_indeed_flow", "is_linkedin_easy_apply", "detect_workday_state"]
