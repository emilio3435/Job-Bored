#!/usr/bin/env python3
"""LinkedIn thin workflow adapter.

Responsibilities:
  - Detect whether a page has LinkedIn Easy Apply available.
  - Leave authenticated login/session handling and modal navigation to Batch 2.
  - Never perform field-level filling here; call universal_filler inside modal pages.
"""

from __future__ import annotations

from typing import Any


def is_linkedin_easy_apply(page_state: dict[str, Any]) -> bool:
    """Return True when page state suggests LinkedIn Easy Apply is available."""
    text = (page_state.get("text") or "").lower()
    if "easy apply" in text:
        return True
    for el in page_state.get("elements", []):
        blob = " ".join(str(el.get(k, "")) for k in ["label", "text", "name", "id"]).lower()
        if "easy apply" in blob:
            return True
    return False


def navigation_plan(page_state: dict[str, Any]) -> list[dict[str, str]]:
    """Return navigation-only actions for the LinkedIn adapter."""
    for el in page_state.get("elements", []):
        blob = " ".join(str(el.get(k, "")) for k in ["label", "text", "name", "id"]).lower()
        if "easy apply" in blob and el.get("selector"):
            return [{"action": "click", "selector": el["selector"], "reason": "Open LinkedIn Easy Apply modal"}]
    return []
