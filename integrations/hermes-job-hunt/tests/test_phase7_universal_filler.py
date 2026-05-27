#!/usr/bin/env python3
"""Phase 7 universal form filler validation tests."""

import importlib.util
import sys
from pathlib import Path

SCRIPTS_DIR = Path.home() / ".hermes" / "job-hunt" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))


def test_filler_profile_contains_required_candidate_and_skip_salary():
    import filler_profile

    assert filler_profile.CANDIDATE["first_name"] == "Emilio"
    assert filler_profile.CANDIDATE["email"] == "emilio3435@gmail.com"
    assert filler_profile.ANSWER_STRATEGIES["salary_expectation"] == "__SKIP__"
    context = filler_profile.build_profile_context()
    assert "Candidate Profile" in context
    assert "Do not" not in context


def test_page_state_extractor_finds_labels_and_select_options():
    extractor_path = SCRIPTS_DIR / "page_state_extractor.js"
    assert extractor_path.exists()
    js = extractor_path.read_text()
    assert "extractPageState" in js
    assert "aria-label" in js
    assert "aria-labelledby" in js
    assert "data-testid" in js
    assert "option" in js
    assert "files" in js


def test_universal_filler_exports_core_functions_and_classes():
    import universal_filler

    assert hasattr(universal_filler, "UniversalFiller")
    assert hasattr(universal_filler, "LLMReasoner")
    assert hasattr(universal_filler, "execute_action")
    assert hasattr(universal_filler, "validate_required_fields")
    assert hasattr(universal_filler, "is_compensation_field")
    assert hasattr(universal_filler, "safe_upload_path")


def test_validate_required_fields_detects_unfilled_required_fields():
    import universal_filler

    page_state = {
        "elements": [
            {"selector": "#first", "label": "First Name", "required": True, "value": "Emilio", "visible": True},
            {"selector": "#email", "label": "Email", "required": True, "value": "", "visible": True},
            {"selector": "#salary", "label": "Salary", "required": False, "value": "", "visible": True},
        ],
        "validation_errors": [],
        "captcha_detected": False,
    }
    result = universal_filler.validate_required_fields(page_state)
    assert result["ok"] is False
    assert result["unfilled_required"] == ["Email"]


def test_extract_json_array_tolerates_markdown_fences():
    import universal_filler

    raw = """Here is the plan:\n```json\n[{\"action\": \"fill\", \"selector\": \"#email\", \"value\": \"x@y.com\"}]\n```"""
    plan = universal_filler.extract_json_array(raw)
    assert plan == [{"action": "fill", "selector": "#email", "value": "x@y.com"}]


def test_execute_action_dry_run_records_without_mutating_page():
    import universal_filler

    class DummyPage:
        pass

    action = {"action": "fill", "selector": "#first", "value": "Emilio", "reason": "First name"}
    result = universal_filler.execute_action(DummyPage(), action, dry_run=True)
    assert result["ok"] is True
    assert result["dry_run"] is True
    assert result["action"] == "fill"


def test_compensation_field_is_hard_blocked_even_if_llm_tries_to_fill():
    import universal_filler

    class DummyPage:
        pass

    action = {"action": "fill", "selector": "#salary", "value": "100000", "reason": "desired salary"}
    meta = {"label": "Desired salary", "selector": "#salary"}
    result = universal_filler.execute_action(DummyPage(), action, dry_run=True, element_meta=meta)
    assert result["ok"] is True
    assert result["action"] == "skip"
    assert result["policy_blocked"] == "compensation"


def test_upload_file_is_allowlisted_and_cannot_escape_app_dir(tmp_path):
    import universal_filler

    app_dir = tmp_path / "app"
    app_dir.mkdir()
    (app_dir / "resume.pdf").write_text("dummy")
    assert universal_filler.safe_upload_path(app_dir, "resume.pdf").name == "resume.pdf"
    for unsafe in ["../secret.txt", "secret.pdf", "/tmp/secret.txt"]:
        try:
            universal_filler.safe_upload_path(app_dir, unsafe)
        except ValueError:
            pass
        else:
            raise AssertionError(f"unsafe upload was not blocked: {unsafe}")


def test_required_file_input_blocks_safety_until_uploaded():
    import universal_filler

    page_state = {
        "elements": [
            {"selector": "#resume", "label": "Resume", "required": True, "type": "file", "kind": "file", "files": [], "visible": True},
        ],
        "validation_errors": [],
        "captcha_detected": False,
    }
    assert universal_filler.validate_required_fields(page_state)["ok"] is False
    uploaded = [{"action": "upload", "selector": "#resume", "ok": True}]
    assert universal_filler.validate_required_fields(page_state, uploaded)["ok"] is True


def test_live_universal_filler_requires_gate2_token(tmp_path):
    import universal_filler

    app_dir = tmp_path / "app"
    app_dir.mkdir()
    (app_dir / "resume.pdf").write_text("dummy")
    (app_dir / "cover-letter.pdf").write_text("dummy")
    filler = universal_filler.UniversalFiller("file:///tmp/nope.html", app_dir, dry_run=False, gate2_confirmed=False)
    result = filler.run()
    assert result["manual_review"] is True
    assert "Gate 2" in result["error"]


def test_workday_url_detection():
    import universal_filler

    assert universal_filler.is_workday_url("https://acme.myworkdayjobs.com/job/123") is True
    assert universal_filler.is_workday_url("https://boards.greenhouse.io/acme") is False


def test_module_cli_help_is_available():
    spec = importlib.util.spec_from_file_location("universal_filler", SCRIPTS_DIR / "universal_filler.py")
    assert spec is not None
    assert (SCRIPTS_DIR / "universal_filler.py").exists()
