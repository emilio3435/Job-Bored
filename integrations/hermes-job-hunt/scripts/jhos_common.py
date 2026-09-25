"""Shared plumbing for the Hermes job-hunt scripts (H15, H20, H23).

One place for: `.env` parsing, the local timezone, the discovery worker config
lookup, the shared Google OAuth token, and Telegram Bot API calls. Scripts
import this module instead of re-implementing each concern.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:  # fcntl is POSIX-only; Windows falls back to the atomic rename alone.
    import fcntl
except ImportError:  # pragma: no cover - exercised on Windows only
    fcntl = None

DEFAULT_TIMEZONE = "America/Chicago"


def env_path(name: str, default) -> Path:
    return Path(os.environ.get(name) or default).expanduser()


def hermes_home() -> Path:
    return env_path("HERMES_HOME", Path.home() / ".hermes")


def job_hunt_home() -> Path:
    return env_path("HERMES_JOB_HUNT_HOME", hermes_home() / "job-hunt")


# ─── .env files ──────────────────────────────────────────────────────


def read_env_file(path: Path) -> dict[str, str]:
    """Parse simple KEY=VALUE lines. Never logs values."""
    values: dict[str, str] = {}
    try:
        text = Path(path).read_text()
    except (FileNotFoundError, NotADirectoryError, PermissionError):
        return values
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        if key:
            values[key] = value.strip().strip('"').strip("'")
    return values


def env_value(name: str, *files: Path) -> str:
    """Environment first, then the first file that defines the key."""
    value = os.environ.get(name, "")
    if value:
        return value
    for path in files:
        value = read_env_file(path).get(name, "")
        if value:
            return value
    return ""


# ─── Time ────────────────────────────────────────────────────────────


def local_timezone():
    """The user's zone: $JHOS_TIMEZONE, else worker-config timezone, else Chicago."""
    from zoneinfo import ZoneInfo

    name = os.environ.get("JHOS_TIMEZONE", "").strip()
    if not name:
        try:
            name = str(json.loads(worker_config_path().read_text()).get("timezone") or "").strip()
        except Exception:
            name = ""
    try:
        return ZoneInfo(name or DEFAULT_TIMEZONE)
    except Exception:
        return ZoneInfo(DEFAULT_TIMEZONE)


def local_now(now: datetime | None = None) -> datetime:
    """Current time in the user's zone, with real DST rules (not a fixed UTC-5)."""
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(local_timezone())


def local_today():
    return local_now().date()


def tz_label(moment: datetime) -> str:
    return moment.tzname() or "local"


# ─── Discovery worker config (sheetId) ───────────────────────────────


def jobbored_repo() -> Path:
    return env_path("JOBBORED_REPO", Path.home() / "Job-Bored")


def worker_config_path() -> Path:
    """$BROWSER_USE_DISCOVERY_WORKER_CONFIG, else ~/.jobbored, else the repo state file."""
    explicit = os.environ.get("BROWSER_USE_DISCOVERY_WORKER_CONFIG")
    if explicit:
        return Path(explicit).expanduser()
    jobbored_home = env_path("JOBBORED_HOME", Path.home() / ".jobbored")
    home_config = jobbored_home / "browser-use-discovery" / "worker-config.json"
    if home_config.exists():
        return home_config
    return jobbored_repo() / "integrations" / "browser-use-discovery" / "state" / "worker-config.json"


def sheet_id_from_worker_config() -> str:
    """The user's Pipeline Sheet ID. Raises when it is missing or a placeholder."""
    path = worker_config_path()
    try:
        sheet_id = str(json.loads(path.read_text()).get("sheetId") or "").strip()
    except FileNotFoundError as exc:
        raise RuntimeError(f"worker config not found: {path}. Complete JobBored onboarding first.") from exc
    if not sheet_id or sheet_id == "YOUR_SHEET_ID_HERE":
        raise RuntimeError(f"sheetId is empty in {path}. Complete JobBored onboarding first.")
    return sheet_id


# ─── Shared Google OAuth token ───────────────────────────────────────


def google_token_path() -> Path:
    return env_path("HERMES_GOOGLE_TOKEN", hermes_home() / "google_token.json")


@contextlib.contextmanager
def _file_lock(path: Path):
    lock_path = path.with_name(path.name + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "a") as handle:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def write_token_atomic(path: Path, contents: str) -> None:
    """Write the token file via temp file + os.replace, under a lock file."""
    path = Path(path)
    with _file_lock(path):
        fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w") as handle:
                handle.write(contents)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
        except BaseException:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(tmp)
            raise


def load_google_credentials(path: Path | None = None):
    """Load the shared user token without overriding its scopes; refresh and
    persist atomically when expired."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    token_path = Path(path or google_token_path())
    creds = Credentials.from_authorized_user_file(str(token_path))
    if getattr(creds, "expired", False) and getattr(creds, "refresh_token", None):
        creds.refresh(Request())
        write_token_atomic(token_path, creds.to_json())
    return creds


def build_sheets_service(creds):
    from googleapiclient.discovery import build

    return build("sheets", "v4", credentials=creds)


def oauth_sheets_service(path: Path | None = None):
    return build_sheets_service(load_google_credentials(path))


# ─── Telegram Bot API ────────────────────────────────────────────────


def telegram_bot_token(*extra_names: str) -> str:
    """Bot token from env or ~/.hermes/.env (first name that is set wins)."""
    names = [*extra_names, "TELEGRAM_BOT_TOKEN"]
    env_file = hermes_home() / ".env"
    for name in names:
        value = env_value(name, env_file)
        if value:
            return value
    raise RuntimeError("TELEGRAM_BOT_TOKEN not found in environment or ~/.hermes/.env")


def telegram_api_call(method: str, payload: dict, token: str) -> dict:
    """POST one Bot API method. Errors come back as {ok: False, error}."""
    url = f"https://api.telegram.org/bot{token}/{method}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode() if exc.fp else ""
        return {"ok": False, "error": f"HTTP {exc.code}: {body}", "status": exc.code}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def log_err(message: str) -> None:
    print(message, file=sys.stderr)
