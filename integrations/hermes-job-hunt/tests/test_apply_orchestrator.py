"""Orchestrator wiring — H4 (no retry after a submit), H11 (preflight), H18 (evidence)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def load_orchestrator():
    spec = importlib.util.spec_from_file_location("apply_orchestrator", SCRIPTS / "apply-orchestrator.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


JOB = "https://boards.greenhouse.io/acme/jobs/42"


@pytest.fixture
def orch(tmp_path, monkeypatch):
    mod = load_orchestrator()
    js = mod.js
    app = tmp_path / "app"
    app.mkdir()
    for name in ["resume.html", "resume.pdf", "cover-letter.html", "cover-letter.pdf"]:
        (app / name).write_text("x")
    monkeypatch.setattr(js, "EVIDENCE_DIR", tmp_path / "evidence")
    monkeypatch.setattr(mod, "find_application_dir", lambda url: app)
    monkeypatch.setattr(js, "gate1_check", lambda url, s, t: {
        "approved": True, "row_number": 5, "title": "Role", "company": "Acme", "link": JOB,
    })
    monkeypatch.setattr(js, "lock_acquire", lambda url, task: (True, "ok"))
    monkeypatch.setattr(js, "lock_release", lambda url, task: (True, "ok"))
    calls = {"gate2_send": [], "notify": [], "kanban": [], "pipeline": []}
    monkeypatch.setattr(mod, "send_gate2_request", lambda *a: calls["gate2_send"].append(a) or {"sent": True, "message_id": 9})
    monkeypatch.setattr(mod, "wait_for_gate2_confirmation", lambda company, after_message_id=None: (True, "ok"))
    monkeypatch.setattr(mod, "notify_telegram", lambda m: calls["notify"].append(m))
    monkeypatch.setattr(mod, "update_kanban", lambda *a: calls["kanban"].append(a))
    monkeypatch.setattr(js, "update_pipeline_applied", lambda *a, **k: calls["pipeline"].append((a, k)) or {"success": True})

    import universal_filler as uf

    monkeypatch.setattr(uf, "preflight_runtime", lambda: {"ok": True, "missing": []})
    mod._calls = calls
    mod._app = app
    mod._uf = uf
    return mod


def fake_filler(result):
    class Filler:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def run(self):
            return result

    return Filler


def test_evidence_holds_the_confirmation_screenshot_and_filler_results(orch, monkeypatch, tmp_path):
    shot = tmp_path / "universal-step-2.png"
    shot.write_bytes(b"png")
    results_path = tmp_path / "universal-form-fill-results.json"
    results_path.write_text("{}")
    monkeypatch.setattr(orch._uf, "UniversalFiller", fake_filler({
        "submitted": True, "submission_state": "verified", "submit_attempted": True,
        "screenshots": [str(tmp_path / "early.png"), str(shot)], "results_path": str(results_path),
        "confirmation_screenshot": str(shot), "confirmation_screenshot_sha256": "abc",
    }))
    out = orch.run_orchestrator(JOB, "task-1", sheet_id="s", access_token="t")
    evidence = [s for s in out["steps"] if s["step"] == "evidence"][0]
    meta = json.loads((Path(evidence["path"]) / "metadata.json").read_text())
    assert meta["screenshot"].endswith(".png") and Path(meta["screenshot"]).exists()
    assert meta["filler_results_path"] == str(results_path)
    assert meta["platform"] == "Greenhouse"


def test_gate2_message_names_the_real_platform(orch, monkeypatch):
    monkeypatch.setattr(orch._uf, "UniversalFiller", fake_filler({"submitted": False, "error": "x"}))
    orch.run_orchestrator(JOB, "task-1", sheet_id="s", access_token="t")
    title, company, platform, _fit = orch._calls["gate2_send"][0]
    assert platform == "Greenhouse"


def test_pipeline_write_re_resolves_by_link(orch, monkeypatch):
    monkeypatch.setattr(orch._uf, "UniversalFiller", fake_filler({
        "submitted": True, "submission_state": "verified", "submit_attempted": True, "screenshots": [],
    }))
    orch.run_orchestrator(JOB, "task-1", sheet_id="s", access_token="t")
    args, kwargs = orch._calls["pipeline"][0]
    assert JOB in args
    assert kwargs.get("expected_row") == 5


def test_unverified_submit_never_asks_for_a_retry(orch, monkeypatch):
    monkeypatch.setattr(orch._uf, "UniversalFiller", fake_filler({
        "submitted": False, "submission_state": "unknown_after_submit", "submit_attempted": True,
        "manual_review": True, "error": None, "screenshots": [],
    }))
    orch.run_orchestrator(JOB, "task-1", sheet_id="s", access_token="t")
    assert orch._calls["notify"], "the human must hear about an unverified submit"
    assert not any("retry required" in m.lower() for m in orch._calls["notify"])
    assert orch._calls["pipeline"] == []


def test_missing_browser_dependencies_stop_before_gate2(orch, monkeypatch):
    monkeypatch.setattr(orch._uf, "preflight_runtime", lambda: {"ok": False, "missing": ["playwright"]})
    out = orch.run_orchestrator(JOB, "task-1", sheet_id="s", access_token="t")
    assert orch._calls["gate2_send"] == []
    assert any(s["step"] == "preflight" and not s["ok"] for s in out["steps"])
