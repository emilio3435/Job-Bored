#!/usr/bin/env python3
"""Lane H offline probe: exercises pure/stubbed code paths of the Hermes apply scripts.

No network: httpx, playwright and urllib.request.urlopen are stubbed; Telegram _api_call is stubbed.
No main() of any script is run. Run from the worktree root with a sandbox HOME:
  HOME="$PWD/.lane-evidence/home" HERMES_SKIP_VENV_REEXEC=1 python3 .lane-evidence/probes/h_probe_pure.py [case]
"""
import importlib.util
import io
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "integrations" / "hermes-job-hunt" / "scripts"
sys.path.insert(0, str(SCRIPTS))

# --- stubs: no browser, no LLM client -------------------------------------------------
httpx = types.ModuleType("httpx")
httpx.Client = object
sys.modules["httpx"] = httpx
pw = types.ModuleType("playwright")
pw_sync = types.ModuleType("playwright.sync_api")
pw_sync.Page = object
pw_sync.sync_playwright = lambda: (_ for _ in ()).throw(RuntimeError("playwright stubbed"))
sys.modules["playwright"] = pw
sys.modules["playwright.sync_api"] = pw_sync


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def case_gate1_approve_fuzzy():
    g1 = load("gate1_approve", "gate1-approve.py")
    headers = ["Date Found", "Title", "Company", "Location", "Link", "", "", "", "", "", "", "", "Status"]
    rows = [
        ["2026-09-01", "Growth Lead", "Metabase", "", "https://x/1", "", "", "", "", "", "", "", "New"],
        ["2026-09-01", "PM", "", "", "https://x/2", "", "", "", "", "", "", "", "New"],
        ["2026-09-01", "AE", "Meta", "", "https://x/3", "", "", "", "", "", "", "", "New"],
    ]
    for target in ["Meta", "Acme", "a"]:
        m = g1.find_company_rows(headers, rows, target)
        print(f"gate1-approve target={target!r} -> rows {[ (r['row_num'], r['company']) for r in m ]}")


class FakeTelegram:
    def __init__(self, texts, chat, thread, start_id=100):
        self.updates = []
        for i, (text, sender) in enumerate(texts):
            self.updates.append({
                "update_id": 1000 + i,
                "message": {"message_id": start_id + 1 + i, "chat": {"id": chat},
                            "message_thread_id": thread, "text": text, "from": {"first_name": sender}},
            })
        self.served = False

    def __call__(self, method, payload, token=None):
        if payload.get("offset") == -1:
            return {"ok": True, "result": []}
        if not self.served:
            self.served = True
            return {"ok": True, "result": self.updates}
        raise SystemExit("poll kept waiting (no confirm)")


def case_gate2_fuzzy():
    g2 = load("gate2_telegram", "gate2_telegram.py")
    scenarios = [
        ("company='Meta', reply for another company", "Meta", [("YES SUBMIT METABASE", "Emilio")]),
        ("company='' (blank Sheet cell), any YES SUBMIT", "", [("YES SUBMIT ACME", "Emilio")]),
        ("reply NO then YES (spec: any other reply cancels)", "Acme", [("NO", "Emilio"), ("YES SUBMIT ACME", "Emilio")]),
        ("any group member can approve (no sender check)", "Acme", [("YES SUBMIT ACME", "SomeoneElse")]),
    ]
    for label, company, texts in scenarios:
        g2._api_call = FakeTelegram(texts, g2.CHAT_ID, g2.THREAD_ID)
        try:
            ok, reason = g2.poll_for_confirmation(company, timeout=5, after_message_id=100, token="probe-token")
        except SystemExit as e:
            ok, reason = False, str(e)
        print(f"gate2 [{label}] -> confirmed={ok} reason={reason!r}")


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def case_notes_wipe():
    js = load("jhos_submit", "jhos_submit.py")
    import urllib.request
    sent = {}

    def fake_urlopen(req, timeout=None):
        if req.get_method() == "GET":
            raise TimeoutError("probe: transient read timeout on Notes GET")
        sent["body"] = json.loads(req.data)
        return FakeResp(b'{"totalUpdatedCells": 3}')

    urllib.request.urlopen = fake_urlopen
    res = js.update_pipeline_applied("probe-sheet", "probe-token", 7, notes_append="Submitted via Hermes")
    print("update_pipeline_applied success:", res["success"])
    for d in sent["body"]["data"]:
        print("  write", d["range"], "=", d["values"])
    print("  valueInputOption:", sent["body"]["valueInputOption"])


def case_normalize_collision():
    js = load("jhos_submit", "jhos_submit.py")
    pairs = [
        ("https://jobs.example.com/posting?sid=111", "https://jobs.example.com/posting?sid=222"),
        ("https://jobs.example.com/view?ref=REQ-1", "https://jobs.example.com/view?ref=REQ-2"),
        ("https://careers.example.com/Job/AbC123", "https://careers.example.com/job/abc123"),
    ]
    for a, b in pairs:
        na, nb = js.normalize_url(a), js.normalize_url(b)
        print(f"normalize {a} | {b} -> same_key={na == nb} key={na}")

    import urllib.request
    sheet = {"values": [
        ["2026-09-01", "Other Job", "Acme", "", "https://jobs.example.com/posting?sid=111"] + [""] * 7 + ["Researching"] + [""] * 10 + ["Approved"],
        ["2026-09-01", "Target Job", "Acme", "", "https://jobs.example.com/posting?sid=222"] + [""] * 7 + ["Researching"] + [""] * 10 + [""],
    ]}
    urllib.request.urlopen = lambda req, timeout=None: FakeResp(json.dumps(sheet).encode())
    g = js.gate1_check("https://jobs.example.com/posting?sid=222", "probe-sheet", "probe-token")
    print("gate1_check(target sid=222, NOT approved) ->", {k: g.get(k) for k in ("approved", "row_number", "title", "approvalStatus")})


def case_submit_classifier():
    uf = load("universal_filler", "universal_filler.py")
    for text in ["Submit application", "Send", "Done", "Confirm", "Send my application", "Finish"]:
        a = {"action": "click", "selector": "#btn-final"}
        print(f"is_submit_like_action(button text={text!r}) -> {uf.is_submit_like_action(a, {'text': text})}")
    pre = "Thank you for your interest in Acme! Please complete the form below."
    print("confirmation-term hit on pre-submit form text:", any(t in pre.lower() for t in uf.CONFIRMATION_TERMS))


def case_stale_gate1_text():
    js = load("jhos_submit", "jhos_submit.py")
    print("fail_gate1 reason:", js.fail_gate1("T", "C", "").reason)


CASES = {
    "gate1_approve_fuzzy": case_gate1_approve_fuzzy,
    "gate2_fuzzy": case_gate2_fuzzy,
    "notes_wipe": case_notes_wipe,
    "normalize_collision": case_normalize_collision,
    "submit_classifier": case_submit_classifier,
    "stale_gate1_text": case_stale_gate1_text,
}

if __name__ == "__main__":
    wanted = sys.argv[1:] or list(CASES)
    for name in wanted:
        print(f"--- {name}")
        CASES[name]()
