from __future__ import annotations

import argparse
import json
import logging
import os
import queue
import signal
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from watchdog.events import FileSystemEventHandler, FileCreatedEvent, FileModifiedEvent, FileMovedEvent
from watchdog.observers import Observer

from .draft_runner import DraftResult, DraftRunner, RunnerConfig, check_resume_page_count
from .manifest import (
    PendingParseError,
    PendingRequest,
    PendingValidationError,
    TERMINAL_PHASES,
    archive_pending,
    load_dotenv,
    load_env_file,
    load_pending,
    pending_fingerprint,
    update_progress,
    utc_now,
    verify_outputs,
    write_pending_error,
)
from .notifier import TelegramNotifier


LOGGER = logging.getLogger("materials_watcher")

QUEUED_MESSAGE = "Waiting in the drafting queue…"
RENDERING_MESSAGE = "Polishing the PDFs…"
VERIFYING_MESSAGE = "Double-checking the outputs…"
COMPLETE_MESSAGE = "Done! Files synced to dobby."
MISSING_JD_MESSAGE = "Missing job-description.md — drop it in the folder and re-click."


class Notifier(Protocol):
    def send_success(
        self,
        request: PendingRequest,
        app_dir: Path,
        *,
        provider: str,
        model: str,
        resume_pages: int | None = None,
    ) -> dict: ...

    def send_failure(self, request: PendingRequest | None, app_dir: Path, summary: str) -> dict: ...


@dataclass(frozen=True)
class WatcherConfig:
    root: Path
    concurrency: int = 1
    dry_run: bool = False

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "WatcherConfig":
        values = env or os.environ
        root = Path(values.get("MATERIALS_WATCHER_ROOT", "~/.hermes/job-hunt/applications")).expanduser()
        concurrency = int(values.get("MATERIALS_WATCHER_CONCURRENCY", "1"))
        return cls(
            root=root,
            concurrency=max(1, concurrency),
            dry_run=values.get("MATERIALS_WATCHER_DRY_RUN", "") == "1",
        )


class PendingEventHandler(FileSystemEventHandler):
    def __init__(self, watcher: "MaterialsWatcher"):
        self.watcher = watcher

    def on_created(self, event: FileCreatedEvent) -> None:
        self._maybe_signal(Path(event.src_path), event.is_directory)

    def on_modified(self, event: FileModifiedEvent) -> None:
        self._maybe_signal(Path(event.src_path), event.is_directory)

    def on_moved(self, event: FileMovedEvent) -> None:
        self._maybe_signal(Path(event.dest_path), event.is_directory)

    def _maybe_signal(self, path: Path, is_directory: bool) -> None:
        if is_directory:
            return
        if path.name == "pending.json":
            self.watcher.signal_pending(path)


class MaterialsWatcher:
    def __init__(
        self,
        config: WatcherConfig,
        runner: DraftRunner,
        notifier: Notifier | None = None,
        logger: logging.Logger | None = None,
    ):
        self.config = config
        self.runner = runner
        self.notifier = notifier or TelegramNotifier()
        self.logger = logger or LOGGER
        self._queue: queue.Queue[Path] = queue.Queue()
        self._stop_event = threading.Event()
        self._state_lock = threading.Lock()
        self._queued: set[Path] = set()
        self._in_flight: set[str] = set()
        self._dirty: set[str] = set()
        self._fingerprints: dict[str, str | None] = {}
        self._workers: list[threading.Thread] = []
        self._observer: Observer | None = None

    def signal_pending(self, pending_path: Path) -> None:
        pending_path = pending_path.expanduser().resolve()
        slug = pending_path.parent.name
        if pending_path.name != "pending.json":
            return
        with self._state_lock:
            if slug in self._in_flight:
                current = pending_fingerprint(pending_path)
                if current != self._fingerprints.get(slug):
                    self._dirty.add(slug)
                    self.logger.info("Queued re-request for %s after current draft finishes", slug)
                return
            if pending_path in self._queued:
                return
            self._queued.add(pending_path)
            self._queue.put(pending_path)
            self.logger.info("Queued %s", pending_path)

    def enqueue_existing(self, *, reset_nonterminal: bool = True) -> None:
        for pending_path in sorted(self.config.root.glob("*/pending.json")):
            if self._is_terminal_pending(pending_path):
                self.logger.info("Skipping terminal pending file on startup: %s", pending_path)
                continue
            if reset_nonterminal:
                self._reset_nonterminal(pending_path)
            self.signal_pending(pending_path)

    def start_workers(self) -> None:
        for index in range(self.config.concurrency):
            worker = threading.Thread(target=self._worker_loop, name=f"materials-worker-{index + 1}", daemon=True)
            worker.start()
            self._workers.append(worker)

    def start_observer(self) -> None:
        self.config.root.mkdir(parents=True, exist_ok=True)
        handler = PendingEventHandler(self)
        observer = Observer()
        observer.schedule(handler, str(self.config.root), recursive=True)
        observer.start()
        self._observer = observer
        self.logger.info("Watching %s", self.config.root)

    def run_forever(self) -> int:
        self.start_workers()
        self.start_observer()
        self.enqueue_existing(reset_nonterminal=True)
        while not self._stop_event.is_set():
            time.sleep(0.5)
        self.stop()
        return 0

    def stop(self) -> None:
        self._stop_event.set()
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=10)
        self._queue.join()
        for worker in self._workers:
            worker.join(timeout=1)
        self.logger.info("Materials watcher stopped")

    def _worker_loop(self) -> None:
        while not self._stop_event.is_set() or not self._queue.empty():
            try:
                pending_path = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            slug = pending_path.parent.name
            with self._state_lock:
                self._queued.discard(pending_path)
                self._in_flight.add(slug)
                self._fingerprints[slug] = pending_fingerprint(pending_path)
            try:
                self.process_pending(pending_path, start_fingerprint=self._fingerprints.get(slug))
            except Exception:
                self.logger.exception("Unhandled watcher error for %s", pending_path)
            finally:
                requeue = False
                with self._state_lock:
                    self._in_flight.discard(slug)
                    self._fingerprints.pop(slug, None)
                    requeue = slug in self._dirty
                    self._dirty.discard(slug)
                if requeue and pending_path.exists():
                    self.signal_pending(pending_path)
                self._queue.task_done()

    def process_pending(self, pending_path: Path, *, start_fingerprint: str | None = None) -> None:
        pending_path = pending_path.expanduser().resolve()
        app_dir = pending_path.parent
        if not pending_path.exists():
            self.logger.info("Pending file disappeared before processing: %s", pending_path)
            return
        if self.config.dry_run:
            self.logger.info("Dry run: would process %s", pending_path)
            return

        request: PendingRequest | None = None
        started_at = utc_now()
        attempt = 1
        try:
            request = load_pending(pending_path)
            existing_progress = request.raw.get("progress") if isinstance(request.raw.get("progress"), dict) else {}
            if existing_progress.get("phase") == "failed":
                attempt = int(existing_progress.get("attempt") or 1) + 1
            elif existing_progress.get("attempt"):
                attempt = int(existing_progress.get("attempt") or 1)
            started_at = existing_progress.get("started_at") or started_at
        except PendingParseError as exc:
            summary = str(exc)
            write_pending_error(app_dir, summary=summary)
            self.logger.warning(summary)
            self.notifier.send_failure(None, app_dir, summary)
            return
        except PendingValidationError as exc:
            summary = str(exc)
            write_pending_error(app_dir, summary=summary)
            try:
                update_progress(pending_path, phase="failed", message=summary[:300], started_at=started_at, attempt=attempt)
            except Exception:
                pass
            self.logger.warning(summary)
            self.notifier.send_failure(None, app_dir, summary)
            return

        update_progress(
            pending_path,
            phase="queued",
            message=QUEUED_MESSAGE,
            started_at=started_at,
            attempt=attempt,
            allow_reset=True,
        )

        job_description_path = app_dir / "job-description.md"
        if not job_description_path.exists():
            update_progress(
                pending_path,
                phase="failed",
                message=MISSING_JD_MESSAGE,
                started_at=started_at,
                attempt=attempt,
            )
            write_pending_error(app_dir, summary=MISSING_JD_MESSAGE, request=request)
            self.notifier.send_failure(request, app_dir, MISSING_JD_MESSAGE)
            return

        job_description = job_description_path.read_text(encoding="utf-8", errors="replace")
        drafting_message = drafting_message_for(request.feature)
        update_progress(
            pending_path,
            phase="drafting",
            message=drafting_message,
            started_at=started_at,
            attempt=attempt,
        )

        def heartbeat() -> None:
            if pending_path.exists():
                update_progress(
                    pending_path,
                    phase="drafting",
                    message=drafting_message,
                    started_at=started_at,
                    attempt=attempt,
                )

        result = self.runner.run(request, job_description, heartbeat)
        update_progress(
            pending_path,
            phase="verifying",
            message=VERIFYING_MESSAGE,
            started_at=started_at,
            attempt=attempt,
        )

        ok, missing = verify_outputs(app_dir, request.feature)
        draft_error_path = app_dir / "draft_error.txt"
        if result.ok and ok and not draft_error_path.exists():
            resume_page_check = check_resume_page_count(app_dir, result.log_path)
            if result.fallback_used:
                write_pending_error(
                    app_dir,
                    summary="xAI unavailable, used MiniMax",
                    details=result.fallback_note,
                    log_path=result.log_path,
                    fallback_note=result.fallback_note,
                    request=request,
                )
            else:
                clear_pending_error(app_dir)
            update_progress(
                pending_path,
                phase="complete",
                message=COMPLETE_MESSAGE,
                started_at=started_at,
                attempt=attempt,
            )
            time.sleep(2)
            if start_fingerprint is not None and pending_path.exists():
                current = pending_fingerprint(pending_path)
                if current != start_fingerprint:
                    self.logger.info("Pending request changed during run for %s; leaving pending.json for next pass", request.slug)
                    return
            done_path = archive_pending(pending_path)
            notify_result = self.notifier.send_success(
                request,
                app_dir,
                provider=result.provider,
                model=result.model,
                resume_pages=resume_page_check.page_count,
            )
            self.logger.info("Completed %s; archived %s; Telegram result=%s", request.slug, done_path, notify_result)
            return

        summary = failure_summary(result, missing, draft_error_path)
        update_progress(
            pending_path,
            phase="failed",
            message=summary[:300],
            started_at=started_at,
            attempt=attempt,
        )
        write_pending_error(app_dir, summary=summary, details=result.error_summary, log_path=result.log_path, request=request)
        notify_result = self.notifier.send_failure(request, app_dir, summary)
        self.logger.warning("Failed %s: %s; Telegram result=%s", request.slug, summary, notify_result)

    def _reset_nonterminal(self, pending_path: Path) -> None:
        try:
            raw = json.loads(pending_path.read_text())
        except Exception:
            return
        progress = raw.get("progress") if isinstance(raw, dict) else None
        phase = progress.get("phase") if isinstance(progress, dict) else None
        if phase and phase not in {"complete", "failed"}:
            update_progress(
                pending_path,
                phase="queued",
                message=QUEUED_MESSAGE,
                started_at=utc_now(),
                attempt=int(progress.get("attempt") or 1),
                allow_reset=True,
            )

    def _is_terminal_pending(self, pending_path: Path) -> bool:
        try:
            raw = json.loads(pending_path.read_text())
        except Exception:
            return False
        progress = raw.get("progress") if isinstance(raw, dict) else None
        phase = progress.get("phase") if isinstance(progress, dict) else None
        return phase in TERMINAL_PHASES


def drafting_message_for(feature: str) -> str:
    if feature == "resume":
        return "Winky is tailoring your resume…"
    if feature == "cover_letter":
        return "Winky is drafting your cover letter…"
    return "Winky is drafting your cover letter and tailoring your resume…"


def failure_summary(result: DraftResult, missing: list[str], draft_error_path: Path) -> str:
    if draft_error_path.exists():
        try:
            return f"Hermes wrote draft_error.txt: {draft_error_path.read_text(encoding='utf-8').strip()[:700]}"
        except OSError:
            return "Hermes wrote draft_error.txt."
    if missing:
        return f"Missing required output(s): {', '.join(missing)}"
    if result.error_summary:
        return result.error_summary[:900]
    return f"Hermes exited with code {result.returncode}."


def clear_pending_error(app_dir: Path) -> None:
    error_path = app_dir / "pending_error.json"
    try:
        error_path.unlink()
    except FileNotFoundError:
        return


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(threadName)s %(name)s: %(message)s",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Watch JobBored pending.json files and draft Hermes materials.")
    parser.add_argument("--once", action="store_true", help="Process existing pending.json files once, then exit.")
    args = parser.parse_args(argv)

    configure_logging()
    env_path = Path.home() / ".hermes" / ".env"
    load_dotenv(env_path)
    env = {**load_env_file(env_path), **os.environ}
    watcher_config = WatcherConfig.from_env(env)
    runner_config = RunnerConfig.from_env(env)
    watcher = MaterialsWatcher(watcher_config, DraftRunner(runner_config))

    def request_stop(signum: int, _frame: object) -> None:
        LOGGER.info("Received signal %s; finishing in-flight draft before exit", signum)
        watcher._stop_event.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    if args.once:
        watcher.start_workers()
        watcher.enqueue_existing(reset_nonterminal=True)
        watcher._queue.join()
        watcher._stop_event.set()
        watcher.stop()
        return 0

    return watcher.run_forever()
