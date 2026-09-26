"""Load the versioned JHOS approval contract.

Send, poll, and Gate 1 checks must read this module instead of hardcoding
Telegram thread IDs or a competing Gate 1 rule.

The tracked contract carries no owner IDs. Each user's Telegram chat, threads
and approver allowlist come from ``approval-contract.local.json`` (gitignored),
found next to the contract or at ``$JHOS_APPROVAL_CONTRACT_LOCAL``. Missing IDs
stay ``None`` and every sender fails closed on them.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "approval-contract.v1.json"
LOCAL_OVERRIDE_NAME = "approval-contract.local.json"


def local_override_path() -> Path:
    explicit = os.environ.get("JHOS_APPROVAL_CONTRACT_LOCAL")
    if explicit:
        return Path(explicit).expanduser()
    return CONTRACT_PATH.parent / LOCAL_OVERRIDE_NAME


def _merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for key, value in override.items():
        if key.startswith("_"):
            continue
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def load_approval_contract() -> dict:
    contract = json.loads(CONTRACT_PATH.read_text())
    local = local_override_path()
    if local.exists():
        override = json.loads(local.read_text())
        # Only the per-user routing may be overridden; gate rules stay versioned.
        allowed = {
            "gate2": {"chatId", "threadId", "approverUserIds"},
            "interest": {"chatId", "threadId"},
        }
        for section, keys in allowed.items():
            values = {k: v for k, v in (override.get(section) or {}).items() if k in keys}
            contract[section] = _merge(contract.get(section, {}), values)
    return contract


def _int_or_none(value):
    if value is None or value == "":
        return None
    return int(value)


def gate2_target(chat_id, thread_id) -> str | None:
    if chat_id is None or thread_id is None:
        return None
    return f"telegram:{chat_id}:{thread_id}"


_CONTRACT = load_approval_contract()

VERSION = str(_CONTRACT["version"])
GATE1_COLUMN_ID = _CONTRACT["gate1"]["columnId"]
GATE1_HEADER_LABEL = _CONTRACT["gate1"]["headerLabel"]
GATE1_LETTER = _CONTRACT["gate1"]["letter"]
GATE1_SHEET_INDEX = int(_CONTRACT["gate1"]["sheetIndex"])
GATE1_PASS_VALUE = _CONTRACT["gate1"]["passValue"]
GATE1_FAIL_CLOSED = bool(_CONTRACT["gate1"]["failClosed"])
GATE2_CHAT_ID = _int_or_none(_CONTRACT["gate2"].get("chatId"))
GATE2_THREAD_ID = _int_or_none(_CONTRACT["gate2"].get("threadId"))
GATE2_APPROVER_USER_IDS = frozenset(int(u) for u in _CONTRACT["gate2"].get("approverUserIds") or [])
GATE2_TARGET = gate2_target(GATE2_CHAT_ID, GATE2_THREAD_ID)
GATE2_TIMEOUT_SECONDS = int(_CONTRACT["gate2"]["timeoutSeconds"])
GATE2_POLL_INTERVAL_SECONDS = int(_CONTRACT["gate2"]["pollIntervalSeconds"])
GATE2_CONFIRMATION_PREFIX = _CONTRACT["gate2"]["confirmationPrefix"]
INTEREST_CHAT_ID = _int_or_none((_CONTRACT.get("interest") or {}).get("chatId"))
INTEREST_THREAD_ID = _int_or_none((_CONTRACT.get("interest") or {}).get("threadId"))
