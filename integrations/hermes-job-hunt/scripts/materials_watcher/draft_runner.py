from __future__ import annotations

import os
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from string import Template
from typing import Callable

from .manifest import PendingRequest, required_outputs


ProgressCallback = Callable[[], None]


def _load_hermes_config_defaults() -> tuple[str, str, str, str]:
    """Read ~/.hermes/config.yaml for primary provider/model and first fallback.

    Falls back to (provider, model, fallback_provider, fallback_model) pulled
    from the same file when present; otherwise returns safe minimax-first defaults
    matching the standard Hermes install.
    """
    primary_provider = "minimax-oauth"
    primary_model = "MiniMax-M3"
    fallback_provider = "xai-oauth"
    fallback_model = "grok-build-0.1"

    try:
        import yaml  # type: ignore[import-untyped]
    except ImportError:
        return primary_provider, primary_model, fallback_provider, fallback_model

    config_path = Path.home() / ".hermes" / "config.yaml"
    if not config_path.is_file():
        return primary_provider, primary_model, fallback_provider, fallback_model

    try:
        with config_path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except (OSError, yaml.YAMLError):
        return primary_provider, primary_model, fallback_provider, fallback_model

    model_block = data.get("model") or {}
    if isinstance(model_block, dict):
        candidate_provider = model_block.get("provider")
        candidate_model = model_block.get("default")
        if isinstance(candidate_provider, str) and candidate_provider:
            primary_provider = candidate_provider
        if isinstance(candidate_model, str) and candidate_model:
            primary_model = candidate_model

    fallbacks = data.get("fallback_providers")
    if isinstance(fallbacks, list) and fallbacks:
        first = fallbacks[0]
        if isinstance(first, dict):
            candidate_provider = first.get("provider")
            candidate_model = first.get("model")
            if isinstance(candidate_provider, str) and candidate_provider:
                fallback_provider = candidate_provider
            if isinstance(candidate_model, str) and candidate_model:
                fallback_model = candidate_model

    return primary_provider, primary_model, fallback_provider, fallback_model


_DEFAULT_PROVIDER, _DEFAULT_MODEL, _DEFAULT_FALLBACK_PROVIDER, _DEFAULT_FALLBACK_MODEL = _load_hermes_config_defaults()


@dataclass(frozen=True)
class RunnerConfig:
    hermes_bin: str = "hermes"
    provider: str = _DEFAULT_PROVIDER
    model: str = _DEFAULT_MODEL
    fallback_provider: str = _DEFAULT_FALLBACK_PROVIDER
    fallback_model: str = _DEFAULT_FALLBACK_MODEL
    max_turns: int = 180
    dry_run: bool = False
    heartbeat_interval: int = 10
    max_attempts: int = 3
    retry_base_seconds: float = 5.0

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "RunnerConfig":
        values = env or os.environ
        return cls(
            hermes_bin=values.get("MATERIALS_WATCHER_HERMES_BIN", "hermes"),
            provider=values.get("MATERIALS_WATCHER_PROVIDER", _DEFAULT_PROVIDER),
            model=values.get("MATERIALS_WATCHER_MODEL", _DEFAULT_MODEL),
            fallback_provider=values.get("MATERIALS_WATCHER_FALLBACK_PROVIDER", _DEFAULT_FALLBACK_PROVIDER),
            fallback_model=values.get("MATERIALS_WATCHER_FALLBACK_MODEL", _DEFAULT_FALLBACK_MODEL),
            max_turns=int(values.get("MATERIALS_WATCHER_MAX_TURNS", "180")),
            dry_run=values.get("MATERIALS_WATCHER_DRY_RUN", "") == "1",
            retry_base_seconds=float(values.get("MATERIALS_WATCHER_RETRY_BASE_SECONDS", "5")),
        )


@dataclass(frozen=True)
class DraftResult:
    ok: bool
    returncode: int
    provider: str
    model: str
    log_path: Path
    error_summary: str = ""
    fallback_used: bool = False
    fallback_note: str = ""


@dataclass(frozen=True)
class ResumePageCheck:
    page_count: int | None
    warning: str | None = None


def format_fallback_note(
    *,
    primary_provider: str,
    primary_model: str,
    fallback_provider: str,
    fallback_model: str,
    primary_error: str,
) -> str:
    """Human-readable note when the primary Hermes provider fails and fallback runs."""
    return (
        f"Primary provider unavailable ({primary_provider}/{primary_model}); "
        f"used fallback {fallback_provider}/{fallback_model}: "
        f"{compact_summary(primary_error)}"
    )


class DraftRunner:
    def __init__(self, config: RunnerConfig, template_path: Path | None = None):
        self.config = config
        default_template = Path(__file__).parent / "prompts" / "draft-prompt.template.txt"
        self.template_path = template_path or default_template

    def build_prompt(self, request: PendingRequest, job_description: str) -> str:
        template = Template(self.template_path.read_text(encoding="utf-8"))
        outputs = "\n".join(f"- {name}" for name in required_outputs(request.feature))
        return template.safe_substitute(
            app_dir=str(request.app_dir),
            feature=request.feature,
            required_outputs=outputs,
            notes=request.notes,
            company=request.company,
            title=request.title,
            job_url=request.job_url,
            requested_at=request.requested_at,
            job_description=job_description,
        )

    def run(self, request: PendingRequest, job_description: str, heartbeat: ProgressCallback) -> DraftResult:
        log_path = request.app_dir / ".draft.log"
        rotate_logs(log_path)
        prompt = self.build_prompt(request, job_description)

        if self.config.dry_run:
            log_path.write_text("MATERIALS_WATCHER_DRY_RUN=1; hermes was not spawned.\n", encoding="utf-8")
            return DraftResult(
                ok=False,
                returncode=0,
                provider=self.config.provider,
                model=self.config.model,
                log_path=log_path,
                error_summary="Dry run enabled; no materials were drafted.",
            )

        for attempt in range(1, self.config.max_attempts + 1):
            result = self._run_once(
                request=request,
                prompt=prompt,
                provider=self.config.provider,
                model=self.config.model,
                log_path=log_path,
                heartbeat=heartbeat,
                attempt=attempt,
            )
            if result.ok:
                return result

            classification = classify_error(result.error_summary)
            if attempt == 1 and classification in {"model_not_found", "unauthorized"}:
                fallback_note = format_fallback_note(
                    primary_provider=self.config.provider,
                    primary_model=self.config.model,
                    fallback_provider=self.config.fallback_provider,
                    fallback_model=self.config.fallback_model,
                    primary_error=result.error_summary,
                )
                fallback = self._run_once(
                    request=request,
                    prompt=prompt,
                    provider=self.config.fallback_provider,
                    model=self.config.fallback_model,
                    log_path=log_path,
                    heartbeat=heartbeat,
                    attempt=1,
                    heading=fallback_note,
                )
                return DraftResult(
                    ok=fallback.ok,
                    returncode=fallback.returncode,
                    provider=fallback.provider,
                    model=fallback.model,
                    log_path=log_path,
                    error_summary=fallback.error_summary,
                    fallback_used=True,
                    fallback_note=fallback_note,
                )

            if classification == "retryable" and attempt < self.config.max_attempts:
                time.sleep(self.config.retry_base_seconds * (2 ** (attempt - 1)))
                continue
            return result

        return DraftResult(
            ok=False,
            returncode=1,
            provider=self.config.provider,
            model=self.config.model,
            log_path=log_path,
            error_summary="Hermes failed after all retry attempts.",
        )

    def _run_once(
        self,
        *,
        request: PendingRequest,
        prompt: str,
        provider: str,
        model: str,
        log_path: Path,
        heartbeat: ProgressCallback,
        attempt: int,
        heading: str | None = None,
    ) -> DraftResult:
        command = [
            self.config.hermes_bin,
            "chat",
            "--provider",
            provider,
            "-m",
            model,
            "--max-turns",
            str(self.config.max_turns),
            "--yolo",
            "-q",
            prompt,
        ]
        env = os.environ.copy()
        env["MATERIALS_WATCHER_APP_DIR"] = str(request.app_dir)
        env["MATERIALS_WATCHER_FEATURE"] = request.feature
        env["MATERIALS_WATCHER_PROVIDER"] = provider
        env["MATERIALS_WATCHER_MODEL"] = model

        with log_path.open("a", encoding="utf-8") as log:
            if heading:
                log.write(f"\n{heading}\n")
            log.write(f"\n=== hermes attempt {attempt}: provider={provider} model={model} ===\n")
            log.flush()
            log_offset = log.tell()
            process = subprocess.Popen(
                command,
                cwd=str(request.app_dir),
                stdout=log,
                stderr=subprocess.STDOUT,
                env=env,
                text=True,
            )
            next_heartbeat = time.monotonic() + self.config.heartbeat_interval
            while True:
                returncode = process.poll()
                if returncode is not None:
                    break
                if time.monotonic() >= next_heartbeat:
                    heartbeat()
                    next_heartbeat = time.monotonic() + self.config.heartbeat_interval
                time.sleep(0.5)

        tail = tail_text(log_path, start_offset=log_offset)
        classification = classify_error(tail)
        if returncode == 0 and classification == "fatal" and not looks_like_hermes_error(tail):
            return DraftResult(ok=True, returncode=returncode, provider=provider, model=model, log_path=log_path)
        return DraftResult(
            ok=False,
            returncode=returncode,
            provider=provider,
            model=model,
            log_path=log_path,
            error_summary=compact_summary(tail),
        )


def rotate_logs(log_path: Path, keep: int = 5) -> None:
    if keep < 1:
        return
    oldest = log_path.with_name(f"{log_path.name}.{keep}")
    if oldest.exists():
        oldest.unlink()
    for index in range(keep - 1, 0, -1):
        source = log_path.with_name(f"{log_path.name}.{index}")
        if source.exists():
            source.replace(log_path.with_name(f"{log_path.name}.{index + 1}"))
    if log_path.exists():
        log_path.replace(log_path.with_name(f"{log_path.name}.1"))


def check_resume_page_count(app_dir: Path, log_path: Path, *, max_pages: int = 2) -> ResumePageCheck:
    resume_pdf = app_dir / "resume.pdf"
    if not resume_pdf.exists():
        return ResumePageCheck(page_count=None)

    page_count = count_pdf_pages(resume_pdf)
    if page_count is None:
        return ResumePageCheck(page_count=None)
    if page_count <= max_pages:
        return ResumePageCheck(page_count=page_count)

    warning = (
        f"SOFT WARNING: resume.pdf rendered at {page_count} pages; "
        f"policy target is {max_pages} pages or fewer."
    )
    with log_path.open("a", encoding="utf-8") as log:
        log.write(f"\n{warning}\n")
    return ResumePageCheck(page_count=page_count, warning=warning)


def count_pdf_pages(pdf_path: Path) -> int | None:
    try:
        data = pdf_path.read_bytes()
    except OSError:
        return None
    if not data.startswith(b"%PDF"):
        return None

    page_objects = re.findall(rb"/Type\s*/Page\b(?!s)", data)
    if page_objects:
        return len(page_objects)

    counts = [int(match) for match in re.findall(rb"/Count\s+(\d+)", data)]
    if counts:
        return max(counts)
    return None


def tail_text(path: Path, max_bytes: int = 12000, start_offset: int | None = None) -> str:
    if not path.exists():
        return ""
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        lower_bound = start_offset if start_offset is not None else 0
        handle.seek(max(lower_bound, size - max_bytes))
        return handle.read().decode("utf-8", errors="replace")


def compact_summary(text: str, limit: int = 700) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return "Hermes exited without a useful error message."
    summary = " ".join(lines[-8:])
    if len(summary) > limit:
        return summary[: limit - 1] + "…"
    return summary


def classify_error(summary: str) -> str:
    lower = summary.lower()
    model_patterns = [
        "model not found",
        "unknown model",
        "invalid model",
        "not a recognized model",
        "model name",
    ]
    if any(pattern in lower for pattern in model_patterns):
        return "model_not_found"

    unauthorized_patterns = [
        "incorrect api key",
        "invalid api key",
        "api key provided",
        "unauthorized",
        "not logged in",
        "authentication",
        "permission denied",
        "401",
        "403",
    ]
    if any(pattern in lower for pattern in unauthorized_patterns):
        return "unauthorized"

    retryable_patterns = [
        "rate limit",
        "429",
        "500",
        "502",
        "503",
        "504",
        "temporarily unavailable",
        "timeout",
        "connection reset",
    ]
    if any(pattern in lower for pattern in retryable_patterns):
        return "retryable"

    return "fatal"


def looks_like_hermes_error(text: str) -> bool:
    lower = text.lower()
    provider_error_markers = [
        "api call failed",
        "non-retryable error",
        "non-retryable client error",
        "incorrect api key",
        "invalid api key",
        "provider unauthorized",
    ]
    if any(marker in lower for marker in provider_error_markers):
        return True
    return "aborting" in lower and ("provider:" in lower or "endpoint:" in lower)
