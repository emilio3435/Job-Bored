from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VALID_FEATURES = {"resume", "cover_letter", "both"}
VALID_PHASES = ("queued", "drafting", "rendering_pdf", "verifying", "complete", "failed")
TERMINAL_PHASES = {"complete", "failed"}

PHASE_ORDER = {
    "queued": 0,
    "drafting": 1,
    "rendering_pdf": 2,
    "verifying": 3,
    "complete": 4,
    "failed": 99,
}

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$")


class ManifestError(Exception):
    """Base error for pending.json handling."""


class PendingParseError(ManifestError):
    """Raised when pending.json cannot be parsed as JSON."""


class PendingValidationError(ManifestError):
    """Raised when pending.json is parseable but invalid."""


class ProgressRegressionError(ManifestError):
    """Raised when a progress update tries to move backward."""


@dataclass(frozen=True)
class PendingRequest:
    path: Path
    app_dir: Path
    raw: dict[str, Any]
    slug: str
    company: str
    title: str
    feature: str
    job_url: str
    notes: str
    requested_at: str
    telegram_message_id: int | None
    source: str


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_utc(value: str) -> datetime | None:
    try:
        normalized = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_dotenv(path: Path | None = None) -> dict[str, str]:
    env_path = path or Path.home() / ".hermes" / ".env"
    values = load_env_file(env_path)
    for key, value in values.items():
        os.environ.setdefault(key, value)
    return values


def load_pending(path: Path) -> PendingRequest:
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise PendingParseError(f"Invalid JSON in {path}: {exc}") from exc
    except OSError as exc:
        raise PendingParseError(f"Unable to read {path}: {exc}") from exc
    return validate_pending(raw, path)


def validate_pending(raw: Any, path: Path | None = None) -> PendingRequest:
    if not isinstance(raw, dict):
        raise PendingValidationError("pending.json must contain a JSON object")

    required = [
        "slug",
        "company",
        "title",
        "feature",
        "job_url",
        "notes",
        "requested_at",
        "source",
    ]
    missing = [field for field in required if field not in raw]
    if missing:
        raise PendingValidationError(f"Missing required field(s): {', '.join(missing)}")

    slug = _require_str(raw, "slug", non_empty=True)
    if not SLUG_RE.match(slug) or "/" in slug or ".." in slug:
        raise PendingValidationError(f"Invalid slug: {slug!r}")
    if path is not None and path.parent.name != slug:
        raise PendingValidationError(f"Slug {slug!r} does not match folder {path.parent.name!r}")

    company = _require_str(raw, "company", non_empty=True)
    title = _require_str(raw, "title", non_empty=True)
    feature = _require_str(raw, "feature", non_empty=True)
    if feature not in VALID_FEATURES:
        raise PendingValidationError(f"Invalid feature: {feature!r}")

    job_url = _require_str(raw, "job_url", non_empty=False)
    notes = _require_str(raw, "notes", non_empty=False)
    if len(notes) > 4000:
        raise PendingValidationError("notes exceeds 4000 characters")
    requested_at = _require_str(raw, "requested_at", non_empty=True)
    source = _require_str(raw, "source", non_empty=True)
    telegram_message_id = raw.get("telegram_message_id")
    if telegram_message_id is not None and not isinstance(telegram_message_id, int):
        raise PendingValidationError("telegram_message_id must be an integer or null")

    pending_path = path or Path(slug) / "pending.json"
    return PendingRequest(
        path=pending_path,
        app_dir=pending_path.parent,
        raw=raw,
        slug=slug,
        company=company,
        title=title,
        feature=feature,
        job_url=job_url,
        notes=notes,
        requested_at=requested_at,
        telegram_message_id=telegram_message_id,
        source=source,
    )


def _require_str(raw: dict[str, Any], field: str, *, non_empty: bool) -> str:
    value = raw.get(field)
    if not isinstance(value, str):
        raise PendingValidationError(f"{field} must be a string")
    if non_empty and not value.strip():
        raise PendingValidationError(f"{field} must not be empty")
    return value


def pending_fingerprint(path: Path) -> str | None:
    try:
        raw = json.loads(path.read_text())
    except Exception:
        return None
    if not isinstance(raw, dict):
        return None
    comparable = dict(raw)
    comparable.pop("progress", None)
    return json.dumps(comparable, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def required_outputs(feature: str) -> list[str]:
    shared = ["job-analysis.md", "qa-report.md"]
    if feature == "resume":
        return ["resume.html", "resume.pdf", *shared]
    if feature == "cover_letter":
        return ["cover-letter.html", "cover-letter.pdf", *shared]
    if feature == "both":
        return ["resume.html", "resume.pdf", "cover-letter.html", "cover-letter.pdf", *shared]
    raise PendingValidationError(f"Invalid feature: {feature!r}")


def verify_outputs(app_dir: Path, feature: str) -> tuple[bool, list[str]]:
    missing: list[str] = []
    for name in required_outputs(feature):
        output = app_dir / name
        if not output.exists() or output.stat().st_size <= 0:
            missing.append(name)
    return not missing, missing


def update_progress(
    pending_path: Path,
    *,
    phase: str,
    message: str,
    started_at: str | None = None,
    attempt: int | None = None,
    allow_reset: bool = False,
) -> dict[str, Any]:
    if phase not in VALID_PHASES:
        raise PendingValidationError(f"Invalid progress phase: {phase!r}")
    try:
        raw = json.loads(pending_path.read_text())
    except json.JSONDecodeError as exc:
        raise PendingParseError(f"Cannot update malformed pending.json: {exc}") from exc

    if not isinstance(raw, dict):
        raise PendingValidationError("pending.json must contain a JSON object")

    existing = raw.get("progress") if isinstance(raw.get("progress"), dict) else {}
    previous_phase = existing.get("phase")
    if (
        previous_phase in PHASE_ORDER
        and not allow_reset
        and phase != "failed"
        and PHASE_ORDER[phase] < PHASE_ORDER[previous_phase]
    ):
        raise ProgressRegressionError(f"Refusing progress regression {previous_phase!r} -> {phase!r}")

    now = utc_now()
    progress_started = started_at or existing.get("started_at") or now
    start_dt = parse_utc(progress_started)
    elapsed = 0
    if start_dt is not None:
        elapsed = max(0, int((datetime.now(timezone.utc) - start_dt).total_seconds()))

    raw["progress"] = {
        "phase": phase,
        "message": message,
        "started_at": progress_started,
        "updated_at": now,
        "attempt": int(attempt or existing.get("attempt") or 1),
        "elapsed_seconds": elapsed,
    }
    atomic_write_json(pending_path, raw)
    return raw["progress"]


def atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp_path, path)
    _fsync_dir(path.parent)


def write_pending_error(
    app_dir: Path,
    *,
    summary: str,
    details: str | None = None,
    log_path: Path | None = None,
    fallback_note: str | None = None,
    request: PendingRequest | None = None,
) -> Path:
    payload: dict[str, Any] = {
        "written_at": utc_now(),
        "summary": summary,
    }
    if details:
        payload["details"] = details[-12000:]
    if log_path:
        payload["log_path"] = str(log_path)
    if fallback_note:
        payload["fallback_note"] = fallback_note
    if request:
        payload["slug"] = request.slug
        payload["company"] = request.company
        payload["title"] = request.title
        payload["feature"] = request.feature
    error_path = app_dir / "pending_error.json"
    atomic_write_json(error_path, payload)
    return error_path


def archive_pending(pending_path: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    candidate = pending_path.with_name(f"pending.json.done.{timestamp}")
    counter = 1
    while candidate.exists():
        candidate = pending_path.with_name(f"pending.json.done.{timestamp}.{counter}")
        counter += 1
    os.replace(pending_path, candidate)
    _fsync_dir(pending_path.parent)
    return candidate


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
