#!/usr/bin/env python3
"""Workday thin workflow adapter.

Responsibilities:
  - Detect login/account-creation gates and long wizard state.
  - Batch 2 will add actual navigation and session handling.
  - UniversalFiller remains responsible for fields on each wizard page.
"""

from __future__ import annotations

from typing import Any


def detect_workday_state(page_state: dict[str, Any]) -> dict[str, Any]:
    """Classify common Workday navigation states from extracted page text."""
    text = (page_state.get("text") or "").lower()
    state = {
        "is_workday": "workday" in (page_state.get("url") or "").lower() or "myworkdayjobs" in (page_state.get("url") or "").lower(),
        "login_required": any(s in text for s in ["sign in", "sign-in", "login", "log in"]),
        "create_account": any(s in text for s in ["create account", "create an account", "new account"]),
        "email_verification": any(s in text for s in ["verification code", "verify your email", "check your email"]),
        "wizard": any(s in text for s in ["my information", "my experience", "application questions", "review"]),
    }
    state["manual_review"] = state["email_verification"]
    return state


def navigation_plan(page_state: dict[str, Any]) -> list[dict[str, str]]:
    """Return conservative navigation-only actions for Workday wizard pages."""
    state = detect_workday_state(page_state)
    if state["email_verification"]:
        return [{"action": "stop", "reason": "Workday email verification required"}]
    for el in page_state.get("elements", []):
        blob = " ".join(str(el.get(k, "")) for k in ["label", "text", "name", "id"]).lower()
        if any(word in blob for word in ["save and continue", "next", "continue"]):
            if el.get("selector"):
                return [{"action": "click", "selector": el["selector"], "reason": "Advance Workday wizard"}]
    return []
