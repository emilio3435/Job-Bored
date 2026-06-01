from __future__ import annotations

from pathlib import Path

from materials_watcher.draft_runner import classify_error, looks_like_hermes_error


def test_classify_error_marks_timeout_in_log_as_retryable() -> None:
    assert classify_error("completed without timeout issues") == "retryable"


def test_hermes_success_should_not_fail_on_retryable_log_noise() -> None:
    tail = "All artifacts written.\ncompleted without timeout issues\n"
    classification = classify_error(tail)
    assert classification == "retryable"
    assert not looks_like_hermes_error(tail)


def test_hermes_auth_failure_still_detected_on_zero_exit() -> None:
    tail = "Provider unauthorized: incorrect api key\n"
    assert classify_error(tail) == "unauthorized"
    assert looks_like_hermes_error(tail)


def test_draft_result_success_logic_for_zero_exit(tmp_path: Path) -> None:
    """Mirror _run_once exit-0 handling: retryable log text must not imply failure."""
    from materials_watcher.draft_runner import DraftRunner, RunnerConfig

    log_path = tmp_path / ".draft.log"
    log_path.write_text("done\ncompleted without timeout\n", encoding="utf-8")
    tail = log_path.read_text(encoding="utf-8")
    classification = classify_error(tail)
    returncode = 0

    if returncode == 0:
        if looks_like_hermes_error(tail) or classification in {"model_not_found", "unauthorized"}:
            ok = False
        else:
            ok = True
    else:
        ok = False

    assert ok is True
