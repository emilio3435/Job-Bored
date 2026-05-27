#!/usr/bin/env python3
"""Indeed thin workflow adapter.

Responsibilities:
  - Detect Indeed Easy Apply vs employer redirect.
  - Batch 2 will add authenticated/session-sensitive navigation.
  - UniversalFiller handles fields when an HTML application form is reached.
"""

from __future__ import annotations

from typing import Any


def detect_indeed_flow(page_state: dict[str, Any]) -> dict[str, Any]:
    """Classify Indeed page flow using extracted text and buttons."""
    text = (page_state.get("text") or "").lower()
    button_blob = " ".join(
        " ".join(str(el.get(k, "")) for k in ["label", "text", "name", "id"])
        for el in page_state.get("elements", [])
    ).lower()
    return {
        "easy_apply": "apply now" in text or "easily apply" in text or "indeed apply" in text or "apply now" in button_blob,
        "redirect_to_employer": "apply on company site" in text or "apply on employer site" in text or "company site" in button_blob,
        "login_required": "sign in" in text or "create an account" in text,
    }


def navigation_plan(page_state: dict[str, Any]) -> list[dict[str, str]]:
    """Return navigation-only Indeed actions."""
    flow = detect_indeed_flow(page_state)
    if flow["redirect_to_employer"]:
        for el in page_state.get("elements", []):
            blob = " ".join(str(el.get(k, "")) for k in ["label", "text", "name", "id"]).lower()
            if "company site" in blob and el.get("selector"):
                return [{"action": "click", "selector": el["selector"], "reason": "Open employer application site"}]
    if flow["easy_apply"]:
        for el in page_state.get("elements", []):
            blob = " ".join(str(el.get(k, "")) for k in ["label", "text", "name", "id"]).lower()
            if ("apply" in blob or "easily" in blob) and el.get("selector"):
                return [{"action": "click", "selector": el["selector"], "reason": "Start Indeed apply flow"}]
    return []
