"""Load the versioned JHOS approval contract.

Send, poll, and Gate 1 checks must read this module instead of hardcoding
Telegram thread IDs or a competing Gate 1 rule.
"""

from __future__ import annotations

import json
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "approval-contract.v1.json"


def load_approval_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text())


_CONTRACT = load_approval_contract()

VERSION = str(_CONTRACT["version"])
GATE1_COLUMN_ID = _CONTRACT["gate1"]["columnId"]
GATE1_HEADER_LABEL = _CONTRACT["gate1"]["headerLabel"]
GATE1_LETTER = _CONTRACT["gate1"]["letter"]
GATE1_SHEET_INDEX = int(_CONTRACT["gate1"]["sheetIndex"])
GATE1_PASS_VALUE = _CONTRACT["gate1"]["passValue"]
GATE1_FAIL_CLOSED = bool(_CONTRACT["gate1"]["failClosed"])
GATE2_CHAT_ID = int(_CONTRACT["gate2"]["chatId"])
GATE2_THREAD_ID = int(_CONTRACT["gate2"]["threadId"])
GATE2_TARGET = _CONTRACT["gate2"]["target"]
GATE2_TIMEOUT_SECONDS = int(_CONTRACT["gate2"]["timeoutSeconds"])
GATE2_POLL_INTERVAL_SECONDS = int(_CONTRACT["gate2"]["pollIntervalSeconds"])
GATE2_CONFIRMATION_PREFIX = _CONTRACT["gate2"]["confirmationPrefix"]
