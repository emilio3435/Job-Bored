"""Sheet-reading cron scripts — H1/H17 (interest match), H8/H21 (IDs from local
config), H15 (token writes), H16 (no row cap), H19/H22 (watcher)."""

from __future__ import annotations

import importlib.util
import json
import sys
import threading
import types
from datetime import date, timedelta
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
HERMES_DIR = SCRIPTS.parent


def load(filename, name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FakeValues:
    def __init__(self, rows):
        self.rows = rows
        self.get_ranges = []
        self.batch_bodies = []

    def get(self, spreadsheetId, range):
        self.get_ranges.append((spreadsheetId, range))
        return types.SimpleNamespace(execute=lambda: {"values": self.rows})

    def batchUpdate(self, spreadsheetId, body):
        self.batch_bodies.append((spreadsheetId, body))
        return types.SimpleNamespace(execute=lambda: {})


class FakeService:
    def __init__(self, rows):
        self.values_api = FakeValues(rows)

    def spreadsheets(self):
        return types.SimpleNamespace(values=lambda: self.values_api)


HEADERS = ["Date Found", "Title", "Company", "Location", "Link", "Source", "Salary", "Fit Score",
           "Priority", "Tags", "Fit Assessment", "Contact", "Status", "Applied Date", "Notes",
           "Follow-up Date", "Talking Points", "Last contact", "Did they reply?"]


def row(**cells):
    r = [""] * 24
    for key, value in cells.items():
        r[HEADERS.index(key)] = value
    return r


@pytest.fixture
def worker_config(tmp_path, monkeypatch):
    cfg = tmp_path / "worker-config.json"
    cfg.write_text(json.dumps({"sheetId": "sheet-from-config", "timezone": "America/Chicago"}))
    monkeypatch.setenv("BROWSER_USE_DISCOVERY_WORKER_CONFIG", str(cfg))
    return cfg


# ─── H16 + H8/H21: follow-up monitor ─────────────────────────────────


def test_followup_reads_open_ended_range_from_the_configured_sheet(worker_config, capsys):
    import followup_monitor as fm

    today = fm.today()
    rows = [HEADERS] + [row(Title=f"Role {i}", Company=f"Co{i}", Status="New") for i in range(2, 601)]
    rows[549] = row(Title="Late Row Role", Company="LateCo", Status="Applied",
                    **{"Applied Date": (today - timedelta(days=10)).isoformat()})
    service = FakeService(rows)
    fm.main([], service=service)
    sheet_id, rng = service.values_api.get_ranges[0]
    assert sheet_id == "sheet-from-config"
    assert rng in {"Pipeline!A:X", "Pipeline!A1:X"}
    assert "Late Row Role @ LateCo" in capsys.readouterr().out


def test_followup_twin_is_a_shim_not_a_copy():
    twin = (SCRIPTS / "followup-monitor.py").read_text()
    assert "import followup_monitor" in twin or "from followup_monitor import" in twin
    assert len(twin.splitlines()) < 30


def test_no_script_hardcodes_a_sheet_id():
    import re

    for path in SCRIPTS.rglob("*"):
        if path.suffix not in {".py", ".sh"} or "materials_watcher" in path.parts:
            continue
        text = path.read_text()
        assert not re.search(r"SHEET_ID\s*=\s*[\"'][A-Za-z0-9_-]{30,}[\"']", text), path.name


# ─── H1/H17: interest approve ────────────────────────────────────────


@pytest.fixture
def interest():
    return load("interest-approve.py", "interest_approve")


def test_interest_match_is_exact_and_skips_blank_companies(interest):
    rows = [row(Title="A", Company="Metabase"), row(Title="B", Company=""), row(Title="C", Company="Meta")]
    hits = interest.find_company_rows(HEADERS, rows, "Meta")
    assert [h["company"] for h in hits] == ["Meta"]
    assert interest.find_company_rows(HEADERS, rows, "Acme") == []
    assert interest.find_company_rows(HEADERS, rows, "a") == []


def test_interest_match_normalizes_case_and_spacing(interest):
    rows = [row(Title="A", Company="  DISH   TV ")]
    assert len(interest.find_company_rows(HEADERS, rows, "dish tv")) == 1


def test_gate1_approve_name_is_a_deprecated_shim():
    shim = (SCRIPTS / "gate1-approve.py").read_text()
    assert "interest-approve.py" in shim
    assert len(shim.splitlines()) < 40


# ─── H22 + H19: the Researching watcher ──────────────────────────────


@pytest.fixture
def watcher(monkeypatch, worker_config, tmp_path):
    import approval_contract as ac

    monkeypatch.setattr(ac, "INTEREST_CHAT_ID", -1000000000009, raising=False)
    monkeypatch.setattr(ac, "INTEREST_THREAD_ID", 3, raising=False)
    monkeypatch.setattr(ac, "GATE2_CHAT_ID", -1000000000009, raising=False)
    monkeypatch.setattr(ac, "GATE2_THREAD_ID", 7, raising=False)
    monkeypatch.setenv("TELEGRAM_HOME_CHANNEL", "-1000000000666")
    mod = load("gate2-status-watcher.py", "gate2_status_watcher")
    monkeypatch.setattr(mod, "STATE_FILE", tmp_path / "reported.json")
    return mod


def researching_rows(watcher):
    today = watcher.today_str()
    return [HEADERS, row(**{"Date Found": today, "Title": "Role", "Company": "Acme",
                            "Link": "https://jobs.example.com/1", "Status": "Researching"})]


def test_watcher_posts_to_the_interest_thread_not_gate2(watcher):
    sent = []
    watcher.main(service=FakeService(researching_rows(watcher)), send=lambda chat, thread, text: sent.append((chat, thread, text)))
    chat, thread, text = sent[0]
    assert (chat, thread) == (-1000000000009, 3)
    assert "Gate 2" not in text


def test_watcher_keeps_rows_unreported_when_the_send_fails(watcher):
    def boom(*a):
        raise RuntimeError("telegram down")

    with pytest.raises(SystemExit):
        watcher.main(service=FakeService(researching_rows(watcher)), send=boom)
    assert not watcher.STATE_FILE.exists() or json.loads(watcher.STATE_FILE.read_text()) == []
    sent = []
    watcher.main(service=FakeService(researching_rows(watcher)), send=lambda *a: sent.append(a))
    assert len(sent) == 1


def test_watcher_keys_rows_by_link_so_a_resort_does_not_resend(watcher):
    sent = []
    rows = researching_rows(watcher)
    watcher.main(service=FakeService(rows), send=lambda *a: sent.append(a))
    resorted = [rows[0], row(Title="Other", Company="Beta", Status="New"), rows[1]]
    watcher.main(service=FakeService(resorted), send=lambda *a: sent.append(a))
    assert len(sent) == 1


def test_watcher_refuses_without_an_interest_thread(watcher, monkeypatch):
    import approval_contract as ac

    monkeypatch.setattr(ac, "INTEREST_THREAD_ID", None, raising=False)
    monkeypatch.setattr(ac, "INTEREST_CHAT_ID", None, raising=False)
    sent = []
    with pytest.raises(SystemExit):
        watcher.main(service=FakeService(researching_rows(watcher)), send=lambda *a: sent.append(a))
    assert sent == []


# ─── H15: one token helper, atomic writes, scopes preserved ──────────


@pytest.fixture
def fake_google(monkeypatch):
    calls = {}

    class Creds:
        def __init__(self, data):
            self.data = dict(data)
            self.expired = True
            self.refresh_token = "r"
            self.token = "old"

        @classmethod
        def from_authorized_user_file(cls, path, scopes=None):
            calls["scopes"] = scopes
            return cls(json.loads(Path(path).read_text()))

        def refresh(self, request):
            self.token = "new"
            self.expired = False

        def to_json(self):
            return json.dumps({**self.data, "token": self.token})

    google = types.ModuleType("google")
    oauth2 = types.ModuleType("google.oauth2")
    credentials = types.ModuleType("google.oauth2.credentials")
    credentials.Credentials = Creds
    auth = types.ModuleType("google.auth")
    transport = types.ModuleType("google.auth.transport")
    requests_mod = types.ModuleType("google.auth.transport.requests")
    requests_mod.Request = lambda: None
    for name, mod in {
        "google": google, "google.oauth2": oauth2, "google.oauth2.credentials": credentials,
        "google.auth": auth, "google.auth.transport": transport, "google.auth.transport.requests": requests_mod,
    }.items():
        monkeypatch.setitem(sys.modules, name, mod)
    return calls


def test_token_refresh_keeps_scopes_and_writes_atomically(tmp_path, fake_google):
    import jhos_common

    token = tmp_path / "google_token.json"
    token.write_text(json.dumps({"token": "old", "scopes": ["a", "b", "c"]}))
    creds = jhos_common.load_google_credentials(token)
    assert fake_google["scopes"] is None, "must not override the shared token's scopes"
    assert creds.token == "new"
    saved = json.loads(token.read_text())
    assert saved["scopes"] == ["a", "b", "c"]
    assert saved["token"] == "new"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["google_token.json", "google_token.json.lock"]


def test_concurrent_token_writes_never_leave_a_torn_file(tmp_path):
    import jhos_common

    token = tmp_path / "google_token.json"
    token.write_text(json.dumps({"token": "seed"}))
    errors = []

    def writer(n):
        for i in range(40):
            jhos_common.write_token_atomic(token, json.dumps({"token": f"{n}-{i}", "pad": "x" * 4000}))

    def reader():
        for _ in range(400):
            try:
                json.loads(token.read_text())
            except Exception as exc:  # pragma: no cover - the failure we guard against
                errors.append(exc)

    threads = [threading.Thread(target=writer, args=(n,)) for n in range(4)] + [threading.Thread(target=reader)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []


def test_sheet_scripts_use_the_shared_token_helper():
    for name in ["followup_monitor.py", "interest-approve.py", "gate2-status-watcher.py", "pipeline-status.py"]:
        text = (SCRIPTS / name).read_text()
        assert "jhos_common" in text, name
        assert "TOKEN_PATH.write_text" not in text, name
        assert "json.dump(json.loads(creds.to_json())" not in text, name


# ─── H8/H21: approval contract IDs come from a local override ────────


def test_tracked_contract_holds_no_owner_ids():
    contract = json.loads((HERMES_DIR / "approval-contract.v1.json").read_text())
    assert contract["gate2"]["chatId"] is None
    assert contract["gate2"]["threadId"] is None
    assert contract["gate2"]["approverUserIds"] == []


def test_local_override_supplies_gate2_ids(tmp_path, monkeypatch):
    import approval_contract as ac

    local = tmp_path / "approval-contract.local.json"
    local.write_text(json.dumps({
        "gate2": {"chatId": -1000000000001, "threadId": 7, "approverUserIds": [111]},
        "interest": {"chatId": -1000000000001, "threadId": 3},
    }))
    monkeypatch.setenv("JHOS_APPROVAL_CONTRACT_LOCAL", str(local))
    merged = ac.load_approval_contract()
    assert merged["gate2"]["chatId"] == -1000000000001
    assert merged["gate2"]["approverUserIds"] == [111]
    assert merged["gate2"]["passValue"] if "passValue" in merged["gate2"] else True
    assert merged["gate1"]["passValue"] == "Approved"
    assert merged["interest"]["threadId"] == 3


def test_gate2_send_refuses_when_ids_are_not_configured(monkeypatch):
    import gate2_telegram as g2

    monkeypatch.setattr(g2, "CHAT_ID", None)
    monkeypatch.setattr(g2, "THREAD_ID", None)
    calls = []
    monkeypatch.setattr(g2, "_api_call", lambda *a, **k: calls.append(a) or {"ok": True})
    result = g2.send_approval_request("Role", "Acme")
    assert result["ok"] is False
    assert "approval-contract.local.json" in result["error"]
    assert calls == []


# ─── H20 + H23: one implementation per concern ───────────────────────


def lane_h_scripts():
    return [p for p in SCRIPTS.glob("*.py") if p.name not in {"materials_request.py", "logo_resolver.py"}]


def test_env_parsing_and_telegram_http_live_in_jhos_common_only():
    for path in lane_h_scripts():
        if path.name == "jhos_common.py":
            continue
        text = path.read_text()
        assert 'split("=", 1)' not in text, f"{path.name} parses .env itself"
        assert "api.telegram.org" not in text, f"{path.name} calls Telegram itself"


def test_no_fixed_utc_minus_five_clock():
    for path in lane_h_scripts():
        text = path.read_text()
        assert "timedelta(hours=-5)" not in text, path.name


# ─── H20: follow-up thresholds live in one shared file ───────────────


THRESHOLDS_FILE = HERMES_DIR / "followup-thresholds.v1.json"


def test_followup_thresholds_load_from_the_shared_file():
    import jhos_common

    shared = json.loads(THRESHOLDS_FILE.read_text())
    loaded = jhos_common.followup_thresholds()
    assert loaded == {
        "waitingReplyMinDays": shared["waitingReplyMinDays"],
        "staleAppliedDays": shared["staleAppliedDays"],
        "likelyClosedDays": shared["likelyClosedDays"],
    }


def test_followup_thresholds_file_that_is_out_of_order_is_refused(tmp_path):
    import jhos_common

    bad = tmp_path / "followup-thresholds.v1.json"
    bad.write_text(json.dumps({"schemaVersion": 1, "waitingReplyMinDays": 14,
                               "staleAppliedDays": 7, "likelyClosedDays": 21}))
    with pytest.raises(ValueError):
        jhos_common.followup_thresholds(bad)


def test_followup_categories_follow_the_shared_thresholds(worker_config, monkeypatch, capsys):
    import followup_monitor as fm

    monkeypatch.setattr(fm.jhos_common, "followup_thresholds",
                        lambda path=None: {"waitingReplyMinDays": 3, "staleAppliedDays": 5,
                                           "likelyClosedDays": 9})
    today = fm.today()
    rows = [HEADERS,
            row(Title="Four Day Role", Company="A", Status="Applied",
                **{"Applied Date": (today - timedelta(days=4)).isoformat()}),
            row(Title="Six Day Role", Company="B", Status="Applied",
                **{"Applied Date": (today - timedelta(days=6)).isoformat()}),
            row(Title="Ten Day Role", Company="C", Status="Applied",
                **{"Applied Date": (today - timedelta(days=10)).isoformat()})]
    fm.main([], service=FakeService(rows))
    out = capsys.readouterr().out
    assert "3-5 days" in out and "5-9 days" in out and "9+ days" in out
    sections = out.split("\n\n")
    assert any("9+ days" in s and "Ten Day Role" in s for s in sections)
    assert any("5-9 days" in s and "Six Day Role" in s for s in sections)
    assert any("3-5 days" in s and "Four Day Role" in s for s in sections)


def test_followup_monitor_has_no_hardcoded_day_thresholds():
    text = (SCRIPTS / "followup_monitor.py").read_text()
    for literal in (">= 21", ">= 14", ">= 7", "21+ days", "14-21 days", "7-14 days"):
        assert literal not in text, f"followup_monitor.py hardcodes {literal!r}"
