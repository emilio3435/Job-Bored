from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

from materials_watcher.draft_runner import DraftResult, DraftRunner, RunnerConfig
from materials_watcher.manifest import atomic_write_json, utc_now
from materials_watcher.watcher import MaterialsWatcher, WatcherConfig


def _write_pending(app_dir: Path, *, phase: str) -> None:
    payload = {
        "slug": app_dir.name,
        "company": "Acme",
        "title": "Engineer",
        "feature": "resume",
        "job_url": "https://example.com/jobs/1",
        "notes": "",
        "requested_at": utc_now(),
        "source": "test",
        "progress": {
            "phase": phase,
            "message": "Done",
            "started_at": utc_now(),
            "updated_at": utc_now(),
            "attempt": 1,
            "elapsed_seconds": 0,
        },
    }
    atomic_write_json(app_dir / "pending.json", payload)


def _touch_outputs(app_dir: Path) -> None:
    for name in ("resume.html", "resume.pdf", "job-analysis.md", "qa-report.md"):
        path = app_dir / name
        path.write_bytes(b"x")


def test_startup_requeues_complete_pending_for_finalize(tmp_path: Path) -> None:
    app_dir = tmp_path / "acme-engineer"
    app_dir.mkdir()
    _write_pending(app_dir, phase="complete")
    _touch_outputs(app_dir)
    (app_dir / "job-description.md").write_text("# Role\n", encoding="utf-8")

    notifier = MagicMock()
    watcher = MaterialsWatcher(
        WatcherConfig(root=tmp_path, dry_run=False),
        DraftRunner(RunnerConfig(dry_run=True)),
        notifier=notifier,
    )

    watcher.start_workers()
    watcher.enqueue_existing(reset_nonterminal=False)
    watcher._queue.join()
    watcher._stop_event.set()
    watcher.stop()

    assert not (app_dir / "pending.json").exists()
    assert list(app_dir.glob("pending.json.done.*"))
    notifier.send_success.assert_called_once()


def test_finalize_marks_failed_when_outputs_missing(tmp_path: Path) -> None:
    app_dir = tmp_path / "acme-engineer"
    app_dir.mkdir()
    pending_path = app_dir / "pending.json"
    _write_pending(app_dir, phase="complete")
    (app_dir / "job-description.md").write_text("# Role\n", encoding="utf-8")

    from materials_watcher.manifest import load_pending

    request = load_pending(pending_path)
    notifier = MagicMock()
    watcher = MaterialsWatcher(
        WatcherConfig(root=tmp_path),
        DraftRunner(RunnerConfig(dry_run=True)),
        notifier=notifier,
    )
    watcher._finalize_successful_pending(
        pending_path,
        request,
        started_at=utc_now(),
        attempt=1,
        start_fingerprint=None,
        result=DraftResult(
            ok=True,
            returncode=0,
            provider="test",
            model="test",
            log_path=app_dir / ".draft.log",
        ),
    )

    assert pending_path.exists()
    raw = json.loads(pending_path.read_text())
    assert raw["progress"]["phase"] == "failed"
    notifier.send_failure.assert_called_once()
