"""Submit-library behaviour — H2, H3, H18, H22, H23.

Sheets calls go through a scripted fake urlopen; nothing leaves the process.
"""

from __future__ import annotations

import hashlib
import io
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pytest

import jhos_submit as js

FIXTURE = Path(__file__).parent / "fixtures" / "url-normalize-parity.json"
HEADER_WIDTH = 24


def pipeline_row(title, company, link, *, status="", approval="", notes=""):
    row = [""] * HEADER_WIDTH
    row[1] = title
    row[2] = company
    row[4] = link
    row[12] = status
    row[14] = notes
    row[23] = approval
    return row


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeSheets:
    """Scripted Sheets values API over urllib."""

    def __init__(self, rows=None, *, fail_reads=False):
        self.rows = rows or []
        self.fail_reads = fail_reads
        self.requests = []

    def __call__(self, req, timeout=None):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        method = req.get_method() if hasattr(req, "get_method") else "GET"
        body = json.loads(req.data.decode()) if getattr(req, "data", None) else None
        self.requests.append({"url": url, "method": method, "body": body})
        if method == "GET":
            if self.fail_reads:
                raise TimeoutError("simulated Sheets read timeout")
            return FakeResponse(json.dumps({"values": [list(r) for r in self.rows]}).encode())
        return FakeResponse(json.dumps({"totalUpdatedCells": 3}).encode())

    @property
    def writes(self):
        return [r for r in self.requests if r["method"] == "POST"]


@pytest.fixture
def sheets(monkeypatch):
    def install(rows=None, **kwargs):
        fake = FakeSheets(rows, **kwargs)
        monkeypatch.setattr(urllib.request, "urlopen", fake)
        return fake

    return install


# ─── H2: normalizer parity + fail-closed lookup ──────────────────────


@pytest.mark.parametrize("case", json.loads(FIXTURE.read_text())["cases"], ids=lambda c: c["input"] or "<empty>")
def test_normalize_url_matches_lead_normalizer_fixture(case):
    assert js.normalize_url(case["input"]) == case["expected"]


def test_distinct_jobs_no_longer_share_a_key():
    assert js.normalize_url("https://jobs.example.com/posting?sid=111") != js.normalize_url(
        "https://jobs.example.com/posting?sid=222"
    )
    assert js.normalize_url("https://careers.example.com/Job/AbC123") != js.normalize_url(
        "https://careers.example.com/job/abc123"
    )


def test_gate1_does_not_inherit_another_rows_approval(sheets):
    sheets([
        pipeline_row("Other Job", "Acme", "https://jobs.example.com/posting?sid=111", approval="Approved"),
        pipeline_row("Target Job", "Acme", "https://jobs.example.com/posting?sid=222", approval=""),
    ])
    result = js.gate1_check("https://jobs.example.com/posting?sid=222", "sheet-x", "token-x")
    assert result["approved"] is False
    assert result["row_number"] == 3


def test_gate1_fails_closed_when_two_rows_match(sheets):
    sheets([
        pipeline_row("Job A", "Acme", "https://jobs.example.com/p/1", approval="Approved"),
        pipeline_row("Job A dup", "Acme", "https://jobs.example.com/p/1/", approval=""),
    ])
    result = js.gate1_check("https://jobs.example.com/p/1", "sheet-x", "token-x")
    assert result["approved"] is False
    assert "ambiguous" in result["error"].lower()


# ─── H3: the Applied write ───────────────────────────────────────────


def test_applied_write_aborts_when_the_read_fails(sheets):
    fake = sheets([pipeline_row("T", "Acme", "https://jobs.example.com/p/7", notes="keep me")], fail_reads=True)
    result = js.update_pipeline_applied("sheet-x", "token-x", "https://jobs.example.com/p/7", notes_append="Submitted via Hermes")
    assert result["success"] is False
    assert fake.writes == [], "no write may happen when existing Notes could not be read"


def test_applied_write_keeps_existing_notes_and_uses_raw(sheets):
    fake = sheets([pipeline_row("T", "Acme", "https://jobs.example.com/p/7", notes="=HYPERLINK(\"x\") keep me")])
    result = js.update_pipeline_applied("sheet-x", "token-x", "https://jobs.example.com/p/7", notes_append="Submitted via Hermes")
    assert result["success"] is True
    body = fake.writes[0]["body"]
    assert body["valueInputOption"] == "RAW"
    notes = [d for d in body["data"] if d["range"].startswith("Pipeline!O")][0]["values"][0][0]
    assert notes.startswith("=HYPERLINK(\"x\") keep me")
    assert notes.endswith("Submitted via Hermes")


def test_applied_write_follows_the_row_after_a_sort(sheets):
    # Gate 1 saw the job on row 2; a sort moved it to row 3 during the Gate 2 wait.
    fake = sheets([
        pipeline_row("Other", "Beta", "https://jobs.example.com/p/9"),
        pipeline_row("T", "Acme", "https://jobs.example.com/p/7"),
    ])
    result = js.update_pipeline_applied(
        "sheet-x", "token-x", "https://jobs.example.com/p/7", notes_append="x", expected_row=2
    )
    assert result["success"] is True
    ranges = {d["range"] for d in fake.writes[0]["body"]["data"]}
    assert ranges == {"Pipeline!M3", "Pipeline!N3", "Pipeline!O3"}


def test_applied_write_refuses_when_the_job_is_gone(sheets):
    fake = sheets([pipeline_row("Other", "Beta", "https://jobs.example.com/p/9")])
    result = js.update_pipeline_applied("sheet-x", "token-x", "https://jobs.example.com/p/7", notes_append="x")
    assert result["success"] is False
    assert fake.writes == []


# ─── H18: evidence ───────────────────────────────────────────────────


def test_write_evidence_copies_screenshot_and_records_hash(hermes_home, tmp_path, monkeypatch):
    monkeypatch.setattr(js, "EVIDENCE_DIR", hermes_home / "evidence")
    shot = tmp_path / "universal-step-3.png"
    shot.write_bytes(b"\x89PNG fake screenshot")
    results = tmp_path / "universal-form-fill-results.json"
    results.write_text("{}")
    evidence_dir = js.write_evidence(
        "https://boards.greenhouse.io/acme/jobs/1",
        "Acme",
        "Role",
        "task-1",
        screenshot_path=str(shot),
        extra={"filler_results_path": str(results)},
    )
    meta = json.loads((evidence_dir / "metadata.json").read_text())
    assert Path(meta["screenshot"]).exists()
    assert meta["screenshot_sha256"] == hashlib.sha256(shot.read_bytes()).hexdigest()
    assert meta["filler_results_path"] == str(results)


@pytest.mark.parametrize(
    "url,platform",
    [
        ("https://boards.greenhouse.io/acme/jobs/1", "Greenhouse"),
        ("https://job-boards.greenhouse.io/acme/jobs/1", "Greenhouse"),
        ("https://jobs.lever.co/acme/1", "Lever"),
        ("https://jobs.ashbyhq.com/acme/1", "Ashby"),
        ("https://careers.example.com/jobs/1", "Direct (careers.example.com)"),
    ],
)
def test_platform_is_derived_from_the_host(url, platform):
    assert js.platform_from_url(url) == platform


# ─── H22: Gate 1 failure text ────────────────────────────────────────


def test_gate1_failure_text_names_approval_status_not_the_retired_status_rule():
    reason = js.fail_gate1("Role", "Acme", "").reason
    assert "Approval Status" in reason
    assert "beyond 'New'" not in reason
    assert "Researching" not in reason


# ─── H23: Central time with DST ──────────────────────────────────────


def test_local_now_uses_chicago_dst_rules():
    import jhos_common

    winter = jhos_common.local_now(datetime(2026, 1, 15, 5, 30, tzinfo=timezone.utc))
    assert winter.utcoffset().total_seconds() == -6 * 3600
    assert winter.date().isoformat() == "2026-01-14"
    summer = jhos_common.local_now(datetime(2026, 7, 15, 4, 30, tzinfo=timezone.utc))
    assert summer.utcoffset().total_seconds() == -5 * 3600
    assert summer.date().isoformat() == "2026-07-14"


def test_local_timezone_can_be_configured(monkeypatch):
    import jhos_common

    monkeypatch.setenv("JHOS_TIMEZONE", "America/Los_Angeles")
    t = jhos_common.local_now(datetime(2026, 1, 15, 7, 30, tzinfo=timezone.utc))
    assert t.utcoffset().total_seconds() == -8 * 3600


@pytest.fixture
def no_tz_database(monkeypatch):
    """A host with no IANA tz database: no system zoneinfo, no tzdata package (fresh Windows)."""
    import sys
    import zoneinfo

    monkeypatch.setitem(sys.modules, "tzdata", None)
    zoneinfo.reset_tzpath([])
    zoneinfo.ZoneInfo.clear_cache()
    yield
    zoneinfo.reset_tzpath()
    zoneinfo.ZoneInfo.clear_cache()


def test_local_now_survives_a_host_without_a_tz_database(no_tz_database, monkeypatch):
    import jhos_common

    monkeypatch.delenv("JHOS_TIMEZONE", raising=False)
    t = jhos_common.local_now(datetime(2026, 1, 15, 7, 30, tzinfo=timezone.utc))
    assert t.tzinfo is not None
    assert t.utcoffset() is not None


def test_runtime_requirements_install_the_tz_database():
    import jhos_common

    req = (Path(jhos_common.__file__).resolve().parents[1] / "requirements.txt").read_text()
    assert any(line.strip().startswith("tzdata") for line in req.splitlines())
