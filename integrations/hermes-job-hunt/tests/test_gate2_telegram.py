"""Gate 2 (final submit confirmation) behaviour — H1, H9.

Every Telegram call is replaced by a scripted fake; nothing leaves the process.
"""

from __future__ import annotations

import pytest

import gate2_telegram as g2

CHAT = -1000000000001
THREAD = 7
REQUEST_ID = 500
APPROVER = 111
STRANGER = 222


@pytest.fixture(autouse=True)
def contract(monkeypatch):
    monkeypatch.setattr(g2, "CHAT_ID", CHAT)
    monkeypatch.setattr(g2, "THREAD_ID", THREAD)
    monkeypatch.setattr(g2, "APPROVER_USER_IDS", frozenset({APPROVER}), raising=False)
    monkeypatch.setattr(g2, "POLL_INTERVAL", 0)


def msg(text, *, sender=APPROVER, reply_to=REQUEST_ID, message_id=None, chat=CHAT, thread=THREAD):
    msg.counter += 1
    m = {
        "message_id": message_id or REQUEST_ID + msg.counter,
        "chat": {"id": chat},
        "message_thread_id": thread,
        "from": {"id": sender, "first_name": f"user{sender}"},
        "text": text,
    }
    if reply_to is not None:
        m["reply_to_message"] = {"message_id": reply_to}
    return m


msg.counter = 0


class FakeTelegram:
    """Scripted getUpdates: each call returns the next batch, then empty."""

    def __init__(self, batches):
        self.batches = list(batches)
        self.calls = []

    def __call__(self, method, payload, token=None):
        self.calls.append((method, dict(payload)))
        if method != "getUpdates":
            return {"ok": True, "result": {"message_id": REQUEST_ID}}
        if not self.batches:
            return {"ok": True, "result": []}
        batch = self.batches.pop(0)
        if isinstance(batch, dict):
            return batch
        return {
            "ok": True,
            "result": [{"update_id": 1000 + i, "message": m} for i, m in enumerate(batch)],
        }


def poll(monkeypatch, batches, company="Meta", timeout=2):
    fake = FakeTelegram(batches)
    monkeypatch.setattr(g2, "_api_call", fake)
    confirmed, reason = g2.poll_for_confirmation(
        company, timeout=timeout, after_message_id=REQUEST_ID, token="test-token"
    )
    return confirmed, reason, fake


def test_exact_reply_from_approver_confirms(monkeypatch):
    confirmed, reason, _ = poll(monkeypatch, [[msg("yes submit meta")]])
    assert confirmed is True, reason


def test_reply_naming_another_company_does_not_confirm(monkeypatch):
    # H1: "YES SUBMIT METABASE" used to approve a Meta submission.
    confirmed, reason, _ = poll(monkeypatch, [[msg("YES SUBMIT METABASE")]])
    assert confirmed is False
    assert "cancel" in reason.lower()


def test_blank_company_never_confirms_and_is_never_sent(monkeypatch):
    confirmed, reason, _ = poll(monkeypatch, [[msg("YES SUBMIT ACME")]], company="  ")
    assert confirmed is False
    fake = FakeTelegram([])
    monkeypatch.setattr(g2, "_api_call", fake)
    sent = g2.send_approval_request("Role", "   ")
    assert sent["ok"] is False
    assert fake.calls == []


def test_non_approver_cannot_confirm(monkeypatch):
    confirmed, _, _ = poll(monkeypatch, [[msg("YES SUBMIT META", sender=STRANGER)]])
    assert confirmed is False


def test_no_then_yes_stays_cancelled(monkeypatch):
    # Spec: any other reply cancels the pending submission.
    confirmed, reason, _ = poll(monkeypatch, [[msg("NO"), msg("YES SUBMIT META")]])
    assert confirmed is False
    assert "cancel" in reason.lower()


def test_confirmation_must_reply_to_the_request_message(monkeypatch):
    confirmed, _, _ = poll(monkeypatch, [[msg("YES SUBMIT META", reply_to=None)]])
    assert confirmed is False
    confirmed, _, _ = poll(monkeypatch, [[msg("YES SUBMIT META", reply_to=REQUEST_ID - 3)]])
    assert confirmed is False


def test_empty_approver_allowlist_fails_closed(monkeypatch):
    monkeypatch.setattr(g2, "APPROVER_USER_IDS", frozenset(), raising=False)
    confirmed, reason, fake = poll(monkeypatch, [[msg("YES SUBMIT META")]])
    assert confirmed is False
    assert "approver" in reason.lower()


def test_missing_request_id_fails_closed(monkeypatch):
    fake = FakeTelegram([[msg("YES SUBMIT META")]])
    monkeypatch.setattr(g2, "_api_call", fake)
    confirmed, _ = g2.poll_for_confirmation("Meta", timeout=1, after_message_id=None, token="t")
    assert confirmed is False


def test_getupdates_409_conflict_fails_fast_with_reason(monkeypatch, capsys):
    # H9: a second getUpdates consumer (the Hermes gateway) makes Telegram
    # answer 409. That must surface as a Gate 2 failure, not a silent retry
    # loop until timeout.
    conflict = {"ok": False, "error": "HTTP 409: Conflict: terminated by other getUpdates request"}
    confirmed, reason, fake = poll(monkeypatch, [conflict, conflict, conflict], timeout=30)
    assert confirmed is False
    assert "409" in reason
    assert len([c for c in fake.calls if c[0] == "getUpdates"]) <= 2
    assert "409" in capsys.readouterr().err


def test_poll_does_not_flush_other_consumers_updates(monkeypatch):
    # H9: offset=-1 acknowledged and dropped the gateway's pending updates.
    _, _, fake = poll(monkeypatch, [[msg("YES SUBMIT META")]])
    assert all(payload.get("offset") != -1 for method, payload in fake.calls)


def test_unused_notification_helpers_are_gone():
    # H19: send_cancellation / send_success had no callers.
    assert not hasattr(g2, "send_cancellation")
    assert not hasattr(g2, "send_success")
