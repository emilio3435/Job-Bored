"""Final-submit classification and verification — H4, H5, H7, H11.

A scripted fake browser stands in for Playwright, and a scripted planner stands
in for the LLM, so the live-mode loop runs without a browser or network.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

import universal_filler as uf

APPLY_URL = "https://jobs.example.com/acme/apply/1"
DONE_URL = "https://jobs.example.com/acme/apply/1/thanks"


def field(selector, label, value="", *, required=True, kind="text", **extra):
    return {"selector": selector, "label": label, "required": required, "value": value,
            "visible": True, "kind": kind, "type": extra.pop("type", kind), **extra}


def button(selector, text, *, typ="button"):
    return {"selector": selector, "label": text, "text": text, "kind": "button",
            "tag": "button", "type": typ, "visible": True, "required": False}


class FakeLocator:
    def __init__(self, page, selector):
        self.page = page
        self.selector = selector

    def count(self):
        return 1

    @property
    def first(self):
        return self

    def scroll_into_view_if_needed(self, timeout=None):
        pass

    def fill(self, value, timeout=None):
        self.page.filled[self.selector] = value

    def click(self, timeout=None):
        self.page.clicked.append(self.selector)
        self.page.on_click(self.selector)

    def check(self, timeout=None):
        self.click(timeout)

    def select_option(self, **kwargs):
        pass

    def set_input_files(self, path, timeout=None):
        pass


class FakePage:
    def __init__(self, before, after, *, submit_selector, after_url):
        self.url = "about:blank"
        self.before = before
        self.after = after
        self.state = before
        self.submit_selector = submit_selector
        self.after_url = after_url
        self.clicked = []
        self.filled = {}

    def goto(self, url, **kwargs):
        self.url = url

    def screenshot(self, path, full_page=True):
        Path(path).write_bytes(f"shot of {self.url} {len(self.clicked)}".encode())

    def evaluate(self, js):
        return {**self.state, "url": self.url}

    def locator(self, selector):
        return FakeLocator(self, selector)

    def wait_for_load_state(self, *args, **kwargs):
        pass

    def on_click(self, selector):
        if selector == self.submit_selector:
            self.state = self.after
            self.url = self.after_url


class FakePlaywright:
    def __init__(self, page):
        self.page = page
        self.chromium = self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def launch(self, headless=True):
        return self

    def new_context(self, **kwargs):
        return self

    def new_page(self):
        return self.page

    def close(self):
        pass


class ScriptedPlanner:
    def __init__(self, *plans):
        self.plans = list(plans)

    def plan(self, page_state, action_history, dry_run=True):
        return self.plans.pop(0) if self.plans else [{"action": "stop", "reason": "done"}]


@pytest.fixture
def app_dir(tmp_path):
    d = tmp_path / "app"
    d.mkdir()
    (d / "resume.pdf").write_text("pdf")
    (d / "cover-letter.pdf").write_text("pdf")
    return d


@pytest.fixture(autouse=True)
def example_profile(tmp_path, monkeypatch):
    profile_dir = tmp_path / "profile"
    profile_dir.mkdir()
    example = Path(uf.__file__).resolve().parents[1] / "profile" / "filler-profile.example.json"
    (profile_dir / "filler-profile.json").write_text(example.read_text())
    monkeypatch.setenv("JHOS_PROFILE_DIR", str(profile_dir))
    return profile_dir


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(uf.time, "sleep", lambda *_: None)
    monkeypatch.setattr(uf, "random_delay", lambda: None)


def run_live(app_dir, page, planner):
    filler = uf.UniversalFiller(
        url=APPLY_URL,
        app_dir=app_dir,
        dry_run=False,
        gate2_confirmed=True,
        max_steps=3,
        reasoner=planner,
        playwright_factory=lambda: FakePlaywright(page),
    )
    return filler.run()


FILLED_FORM = {
    "title": "Apply",
    "text": "Apply for Role at Acme. Required fields are marked.",
    "elements": [field("#email", "Email", "candidate@example.com"), button("#send", "Send")],
    "validation_errors": [],
    "captcha_detected": False,
}


# ─── H4: every final click is a submit ───────────────────────────────


@pytest.mark.parametrize("label", ["Send", "Done", "Confirm", "Send my application"])
def test_final_buttons_without_the_word_submit_are_classified_as_submit(label):
    action = {"action": "click", "selector": "#b", "reason": label}
    assert uf.is_submit_like_action(action, button("#b", label)) is True


def test_type_submit_button_is_final_whatever_its_label():
    assert uf.is_submit_like_action({"action": "click", "selector": "#go"}, button("#go", "Go", typ="submit")) is True


def test_next_button_stays_navigation():
    assert uf.is_submit_like_action({"action": "click", "selector": "#n"}, button("#n", "Next")) is False


def test_send_click_counts_as_a_submit_and_verifies(app_dir):
    after = {
        "title": "Thanks",
        "text": "Application submitted. We received your application.",
        "elements": [],
        "validation_errors": [],
        "captcha_detected": False,
    }
    page = FakePage(FILLED_FORM, after, submit_selector="#send", after_url=DONE_URL)
    result = run_live(app_dir, page, ScriptedPlanner([{"action": "click", "selector": "#send", "reason": "Send"}]))
    assert result["submit_attempted"] is True
    assert result["submission_state"] == "verified"
    assert result["submitted"] is True
    assert result["confirmation_screenshot_sha256"]


def test_send_click_with_an_empty_required_field_is_blocked_before_clicking(app_dir):
    before = {**FILLED_FORM, "elements": [field("#email", "Email", ""), button("#send", "Send")]}
    page = FakePage(before, before, submit_selector="#send", after_url=DONE_URL)
    result = run_live(app_dir, page, ScriptedPlanner([{"action": "click", "selector": "#send", "reason": "Send"}]))
    assert page.clicked == []
    assert result["manual_review"] is True
    assert result["submitted"] is False


# Repair round: the H4 gate guards submission, not the clicks that fill fields.

COUNTRY_OPTION = '[role="option"]:has-text("United States")'


class ComboboxPage(FakePage):
    """Country is an empty required combobox; opening it and picking an option fills it."""

    def on_click(self, selector):
        if selector == COUNTRY_OPTION:
            self.state = {**self.state, "elements": [
                field("#country", "Country", "United States", kind="combobox", role="combobox"),
                button("#send", "Send"),
            ]}
        super().on_click(selector)


def combobox_form():
    return {**FILLED_FORM, "elements": [
        field("#country", "Country", "", kind="combobox", role="combobox",
              options=[{"label": "United States", "value": "US"}]),
        button("#send", "Send"),
    ]}


def test_clicking_an_empty_required_combobox_to_fill_it_is_allowed(app_dir):
    after = {"title": "Thanks", "text": "Application submitted. We received your application.",
             "elements": [], "validation_errors": [], "captcha_detected": False}
    page = ComboboxPage(combobox_form(), after, submit_selector="#send", after_url=DONE_URL)
    planner = ScriptedPlanner(
        [{"action": "click", "selector": "#country", "reason": "Open Country"}],
        [{"action": "click", "selector": COUNTRY_OPTION, "reason": "Pick United States"}],
        [{"action": "click", "selector": "#send", "reason": "Send"}],
    )
    result = run_live(app_dir, page, planner)
    assert page.clicked == ["#country", COUNTRY_OPTION, "#send"]
    assert result["submission_state"] == "verified"


def test_field_clicks_do_not_count_as_submit_attempts():
    assert uf.is_submit_like_action({"action": "click", "selector": "#country"},
                                    field("#country", "Country", kind="combobox", role="combobox")) is False
    assert uf.is_submit_like_action({"action": "click", "selector": "#agree"},
                                    field("#agree", "I agree", kind="checkbox")) is False
    assert uf.is_submit_like_action({"action": "click", "selector": COUNTRY_OPTION}, None) is False
    assert uf.is_submit_like_action({"action": "click", "selector": "#go"},
                                    field("#go", "Apply", kind="submit", tag="input")) is True
    assert uf.is_submit_like_action({"action": "click", "selector": "#mystery"}, None) is True


def test_submit_after_a_field_click_is_still_gated_on_required_fields(app_dir):
    page = ComboboxPage(combobox_form(), combobox_form(), submit_selector="#send", after_url=DONE_URL)
    planner = ScriptedPlanner(
        [{"action": "click", "selector": "#country", "reason": "Open Country"}],
        [{"action": "click", "selector": "#send", "reason": "Send"}],
    )
    result = run_live(app_dir, page, planner)
    assert page.clicked == ["#country"]
    assert result["submit_attempted"] is False
    assert result["submitted"] is False
    assert result["manual_review"] is True


# Repair round 2: a button-based dropdown is a field, not a submit.


def button_combobox(selector, label, value=""):
    """`<button type="button" role="combobox">` as page_state_extractor.js reports it."""
    return {"selector": selector, "label": label, "text": value or "Select...", "value": value,
            "kind": "button", "tag": "button", "type": "button", "role": "combobox",
            "visible": True, "required": True}


def test_button_with_a_field_role_is_a_field_interaction():
    for role in ["combobox", "listbox", "option", "checkbox", "radio", "switch"]:
        meta = {**button_combobox("#w", "Country"), "role": role}
        assert uf.is_field_interaction_click({"action": "click", "selector": "#w"}, meta) is True, role
        assert uf.is_submit_like_action({"action": "click", "selector": "#w"}, meta) is False, role


def test_field_role_does_not_hide_a_submit_button():
    submit_typed = {**button_combobox("#w", "Country"), "type": "submit"}
    assert uf.is_field_interaction_click({"action": "click", "selector": "#w"}, submit_typed) is False
    submit_text = {**button_combobox("#w", "Submit application"), "text": "Submit application"}
    assert uf.is_field_interaction_click({"action": "click", "selector": "#w"}, submit_text) is False
    plain = button("#send", "Send")
    assert uf.is_field_interaction_click({"action": "click", "selector": "#send"}, plain) is False


def test_opening_a_button_combobox_is_allowed_while_another_required_field_is_empty(app_dir):
    form = {**FILLED_FORM, "elements": [
        field("#email", "Email", ""),
        button_combobox("#country", "Country"),
        button("#send", "Send"),
    ]}
    page = FakePage(form, form, submit_selector="#send", after_url=DONE_URL)
    planner = ScriptedPlanner(
        [{"action": "click", "selector": "#country", "reason": "Open Country"}],
        [{"action": "click", "selector": "#send", "reason": "Send"}],
    )
    result = run_live(app_dir, page, planner)
    assert page.clicked == ["#country"]
    assert result["submit_attempted"] is False
    assert result["manual_review"] is True


# Repair round 2: an unverified submit stops the loop before any second submit.


def test_unverified_submit_is_never_clicked_twice(app_dir):
    # Inline success banner, form still on screen, URL unchanged: not verified.
    after = {**FILLED_FORM, "text": FILLED_FORM["text"] + " Application submitted."}
    page = FakePage(FILLED_FORM, after, submit_selector="#send", after_url=APPLY_URL)
    planner = ScriptedPlanner(
        [{"action": "click", "selector": "#send", "reason": "Send"}],
        [{"action": "click", "selector": "#send", "reason": "Send again"}],
        [{"action": "click", "selector": "#send", "reason": "Send again"}],
    )
    result = run_live(app_dir, page, planner)
    assert page.clicked == ["#send"]
    assert result["submit_attempted"] is True
    assert result["submitted"] is False
    assert result["submission_state"] == "unknown_after_submit"
    assert result["manual_review"] is True


# ─── H5: "Thank you" on the form is not a confirmation ───────────────


def test_thank_you_text_on_an_unchanged_form_is_not_verified(app_dir):
    before = {
        **FILLED_FORM,
        "text": "Thank you for your interest in Acme! Please complete the form.",
        "elements": [field("#email", "Email", "candidate@example.com"), button("#submit", "Submit application", typ="submit")],
    }
    # The click fails validation silently: same URL, same form, same text.
    page = FakePage(before, before, submit_selector="#submit", after_url=APPLY_URL)
    result = run_live(app_dir, page, ScriptedPlanner([{"action": "click", "selector": "#submit", "reason": "Submit application"}]))
    assert result["submit_attempted"] is True
    assert result["submitted"] is False
    assert result["submission_state"] == "unknown_after_submit"
    assert result["manual_review"] is True


def test_generic_thank_you_after_navigation_still_needs_a_success_marker(app_dir):
    after = {"title": "Acme", "text": "Thank you!", "elements": [], "validation_errors": [], "captcha_detected": False}
    page = FakePage(FILLED_FORM, after, submit_selector="#send", after_url=DONE_URL)
    result = run_live(app_dir, page, ScriptedPlanner([{"action": "click", "selector": "#send", "reason": "Send"}]))
    assert result["submission_state"] == "unknown_after_submit"


# ─── H7: the CLI cannot submit ───────────────────────────────────────


def test_cli_has_no_live_mode(app_dir, monkeypatch, capsys):
    monkeypatch.setenv("JHOS_GATE2_CONFIRMED", "1")
    with pytest.raises(SystemExit) as exc:
        uf.main(["--url", APPLY_URL, "--app-dir", str(app_dir), "--submit"])
    assert exc.value.code == 2


def test_env_flag_is_not_a_gate2_confirmation():
    source = Path(uf.__file__).read_text()
    assert "JHOS_GATE2_CONFIRMED" not in source
    env_example = Path(uf.__file__).resolve().parents[1] / ".env.example"
    assert "JHOS_GATE2_CONFIRMED" not in env_example.read_text()


# ─── H11: dependencies ───────────────────────────────────────────────


def test_module_imports_without_browser_dependencies(monkeypatch):
    for name in ["httpx", "playwright", "playwright.sync_api"]:
        monkeypatch.setitem(sys.modules, name, None)
    import importlib

    reloaded = importlib.reload(uf)
    assert hasattr(reloaded, "UniversalFiller")
    report = reloaded.preflight_runtime()
    assert report["ok"] is False
    assert {"httpx", "playwright"} <= set(report["missing"])


def test_requirements_list_the_filler_dependencies():
    req = (Path(uf.__file__).resolve().parents[1] / "requirements.txt").read_text()
    assert "httpx" in req
    assert "playwright" in req


def test_extractor_is_read_from_the_scripts_directory():
    assert uf.EXTRACTOR_PATH == Path(uf.__file__).resolve().parent / "page_state_extractor.js"


# Repair round 3: an `<input>` with no type attribute is a text field.


def untyped_input(selector, label, value=""):
    """`<input name=...>` with no type, as page_state_extractor.js reports it (kind='input')."""
    return {"selector": selector, "label": label, "value": value, "required": True,
            "visible": True, "kind": "input", "tag": "input", "type": ""}


def test_untyped_input_is_a_field_interaction():
    meta = untyped_input("#name", "Full name")
    assert uf.is_field_interaction_click({"action": "click", "selector": "#name"}, meta) is True
    assert uf.is_submit_like_action({"action": "click", "selector": "#name"}, meta) is False


def test_focusing_an_empty_untyped_input_then_filling_it_is_allowed(app_dir):
    form = {**FILLED_FORM, "elements": [untyped_input("#name", "Full name"), button("#send", "Send")]}
    page = FakePage(form, form, submit_selector="#send", after_url=DONE_URL)
    planner = ScriptedPlanner(
        [{"action": "click", "selector": "#name", "reason": "Focus Full name"}],
        [{"action": "fill", "selector": "#name", "value": "Ada Example", "reason": "Full name"}],
    )
    result = run_live(app_dir, page, planner)
    assert page.clicked == ["#name"]
    assert page.filled == {"#name": "Ada Example"}
    assert result["submit_attempted"] is False
