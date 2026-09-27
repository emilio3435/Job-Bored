from __future__ import annotations

import sys
import os
from pathlib import Path
from typing import Any

from .manifest import PendingRequest


# Telegram destination for MATERIALS READY/FAILED notices. Read from the
# environment so no chat id ships in the repo (H8/F18). Example:
#   MATERIALS_TELEGRAM_CHAT_ID=-1001234567890 MATERIALS_TELEGRAM_THREAD_ID=48
# Sending fails closed when the chat id is unset.
def _chat_id() -> str:
    return os.environ.get("MATERIALS_TELEGRAM_CHAT_ID", "").strip()


def _thread_id() -> int | None:
    raw = os.environ.get("MATERIALS_TELEGRAM_THREAD_ID", "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

for cert_path in (
    Path("/opt/homebrew/etc/openssl@3/cert.pem"),
    Path("/usr/local/etc/openssl@3/cert.pem"),
):
    if not os.environ.get("SSL_CERT_FILE") and cert_path.exists():
        os.environ["SSL_CERT_FILE"] = str(cert_path)
        break

from gate2_telegram import _api_call  # noqa: E402


class TelegramNotifier:
    def send_success(
        self,
        request: PendingRequest,
        app_dir: Path,
        *,
        provider: str,
        model: str,
        resume_pages: int | None = None,
    ) -> dict[str, Any]:
        lines = [
            "✅ MATERIALS READY",
            "",
            f"{request.title} @ {request.company}",
            f"Feature: {request.feature}",
            f"Model: {provider}/{model}",
        ]
        if resume_pages is not None:
            lines.append(f"resume shipped at {resume_pages} pages")
        lines.append(f"Folder: {app_dir}")
        text = "\n".join(lines)
        return self._send(text)

    def send_failure(self, request: PendingRequest | None, app_dir: Path, summary: str) -> dict[str, Any]:
        title = request.title if request else app_dir.name
        company = request.company if request else "Unknown company"
        text = "\n".join(
            [
                "❌ MATERIALS FAILED",
                "",
                f"{title} @ {company}",
                f"Folder: {app_dir}",
                f"Error: {summary[:800]}",
            ]
        )
        return self._send(text)

    def _send(self, text: str) -> dict[str, Any]:
        chat_id = _chat_id()
        if not chat_id:
            raise RuntimeError(
                "MATERIALS_TELEGRAM_CHAT_ID is not set; refusing to send to a default chat"
            )
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }
        thread_id = _thread_id()
        if thread_id is not None:
            payload["message_thread_id"] = thread_id
        return _api_call("sendMessage", payload)
