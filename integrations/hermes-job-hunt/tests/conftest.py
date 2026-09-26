"""Shared pytest setup for the Hermes job-hunt scripts.

The suite tests the repo copy of scripts/ (never ~/.hermes/job-hunt/scripts),
runs with an isolated HOME, and refuses every non-loopback socket so no test
can reach Telegram, Google, an ATS or an LLM provider.
"""

from __future__ import annotations

import os
import socket
import sys
import tempfile
from pathlib import Path

import pytest

HERMES_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = HERMES_DIR / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# Keep module-level path constants away from the real ~/.hermes before any
# script module is imported by a test.
_SESSION_HOME = Path(tempfile.mkdtemp(prefix="hermes-pytest-home-")).resolve()
os.environ["HOME"] = str(_SESSION_HOME)
os.environ["HERMES_HOME"] = str(_SESSION_HOME / ".hermes")
os.environ["HERMES_JOB_HUNT_HOME"] = str(_SESSION_HOME / ".hermes" / "job-hunt")
os.environ["HERMES_SKIP_VENV_REEXEC"] = "1"
for _name in (
    "TELEGRAM_BOT_TOKEN",
    "JHOS_GATE2_BOT_TOKEN",
    "OPENROUTER_API_KEY",
    "JHOS_GATE2_CONFIRMED",
    "TELEGRAM_HOME_CHANNEL",
):
    os.environ.pop(_name, None)

_real_connect = socket.socket.connect
_real_create_connection = socket.create_connection


def _is_loopback(address) -> bool:
    host = address[0] if isinstance(address, tuple) else address
    return str(host) in {"127.0.0.1", "::1", "localhost"}


def _guarded_connect(self, address):  # pragma: no cover - only hit on a leak
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _is_loopback(address):
        raise RuntimeError(f"network blocked in Hermes tests: {address!r}")
    return _real_connect(self, address)


def _guarded_create_connection(address, *args, **kwargs):  # pragma: no cover
    if not _is_loopback(address):
        raise RuntimeError(f"network blocked in Hermes tests: {address!r}")
    return _real_create_connection(address, *args, **kwargs)


socket.socket.connect = _guarded_connect
socket.create_connection = _guarded_create_connection


@pytest.fixture
def hermes_home(tmp_path, monkeypatch):
    """A fresh HERMES_HOME / job-hunt root for one test."""
    home = tmp_path / "home"
    hermes = home / ".hermes"
    job_hunt = hermes / "job-hunt"
    job_hunt.mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("HERMES_HOME", str(hermes))
    monkeypatch.setenv("HERMES_JOB_HUNT_HOME", str(job_hunt))
    return job_hunt
