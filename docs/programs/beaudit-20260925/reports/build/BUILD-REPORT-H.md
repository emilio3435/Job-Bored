DONE

# BUILD-REPORT-H — Hermes safety (BEAUDIT wave 1, lane H)

Branch `feat/beaudit-w1-h` (from `feat/beaudit-build-w1` @ 37f5c38b). Head `290335c7`. Not pushed.
Model: Opus 5.5, medium effort (spec §0.9). Binding decisions: §0.6 (apply stays shelved), §0.2 (neutral examples, local gitignored files, no history rewrite).

## Claims done

| Claim | Fix | Proof (test) |
|---|---|---|
| H1 (+H17) | Gate 2: exact normalized `YES SUBMIT <COMPANY>`, must reply to the request message id, sender must be in `gate2.approverUserIds`, any other reply cancels, blank company refused before send. Interest step `interest-approve.py` (old name kept as shim): exact normalized company match, blank cells skipped. | `tests/test_gate2_telegram.py` (11), `tests/test_sheet_scripts.py::test_interest_match_*` |
| H2 | `normalize_url` ported from `normalizeLeadUrl` (anchored tracking pattern, path case kept); shared fixture `tests/fixtures/url-normalize-parity.json` pinned by both Python and TS; Gate 1 fails closed on >1 matching row. | `test_jhos_submit.py::test_normalize_url_matches_lead_normalizer_fixture[*]`, `test_gate1_*`; `tests/hermes-apply-safety.test.mjs` (TS side) |
| H3 | Applied write re-resolves the row by Link right before writing, takes Notes from the same read, aborts (no write) if the read fails or 0/>1 rows match, writes RAW. | `test_jhos_submit.py::test_applied_write_*` (4) |
| H4 | Every live click except a field interaction (opening a combobox/select, picking a `role=option`, toggling a checkbox/radio, focusing an input) passes the required-field safety gate, so empty required comboboxes can still be filled (repair round 2); field interactions never count as a submit; any other click that is not clearly Next/Continue (incl. `type=submit`, Send, Done, Confirm) is a final submit; unverified submit never triggers "retry required". | `test_universal_filler_submit.py` (classifier + fake-browser live runs; repair 2: `test_clicking_an_empty_required_combobox_to_fill_it_is_allowed`, `test_field_clicks_do_not_count_as_submit_attempts`, `test_submit_after_a_field_click_is_still_gated_on_required_fields`), `test_apply_orchestrator.py::test_unverified_submit_never_asks_for_a_retry` |
| H5 | "Verified" needs URL change or form gone AND a success marker newly present after the click; bare "thank you" removed from markers; confirmation screenshot + sha256 recorded. | `test_thank_you_text_on_an_unchanged_form_is_not_verified`, `test_generic_thank_you_after_navigation_still_needs_a_success_marker`, `test_send_click_counts_as_a_submit_and_verifies` |
| H6 | `greenhouse_filler.py` deleted; setup removes it from runtime copies. | `hermes-apply-safety.test.mjs`, `hermes-setup-refresh.test.mjs` |
| H7 | `universal_filler.py` CLI is dry-run only (`--submit` removed); `JHOS_GATE2_CONFIRMED` removed from code and `.env.example`. | `test_cli_has_no_live_mode`, `test_env_flag_is_not_a_gate2_confirmation`, `hermes-apply-safety.test.mjs` |
| H8 (+H21; F18 partial) | Filler identity loads from gitignored `profile/filler-profile.json` or `profile.md` Contact; fails closed on missing file or template placeholders; live run refuses before launching a browser. Gate 2/interest chat, thread, approver ids from gitignored `approval-contract.local.json` (tracked contract has `null`). Sheet IDs from `worker-config.json`. Neutral example templates added; nested `.gitignore` covers the local files. | `test_filler_profile.py` (8), `test_sheet_scripts.py::test_tracked_contract_holds_no_owner_ids`, `test_local_override_*`, `test_no_script_hardcodes_a_sheet_id`, `hermes-apply-safety.test.mjs` PII scan, `approval-contract.test.mjs` |
| H9 | getUpdates 409 → immediate cancel with reason, stderr log; other errors logged; `offset=-1` flush removed; `JHOS_GATE2_BOT_TOKEN` lets Gate 2 use a bot the gateway does not poll; repair 2 scopes it to `send_approval_request`/`poll_for_confirmation` only, so `_api_call` without a token (materials_request, materials notifier, research-interest pings) stays on `TELEGRAM_BOT_TOKEN`. | `test_getupdates_409_conflict_fails_fast_with_reason` (stubbed 409), `test_poll_does_not_flush_other_consumers_updates`, `test_shared_api_call_keeps_the_shared_bot_when_gate2_bot_is_set`, `test_gate2_send_and_poll_use_the_dedicated_bot`, `test_gate2_falls_back_to_the_shared_bot_without_a_dedicated_one` |
| H10 | Suite tests the repo `scripts/` (conftest: isolated HOME, non-loopback sockets blocked); new `.github/workflows/hermes-pytest.yml` (py 3.9 + 3.12); `requirements-dev.txt`. Behavior tests for H1–H5 added. | whole pytest suite; `hermes-apply-safety.test.mjs::the Hermes pytest suite runs in CI` |
| H11 | `httpx`, `playwright` added to requirements; imported lazily; `preflight_runtime()` runs before Gate 2 is sent. | `test_module_imports_without_browser_dependencies`, `test_requirements_list_the_filler_dependencies`, `test_missing_browser_dependencies_stop_before_gate2` |
| H12 | `setup:hermes` force-refreshes scripts, contract and code docs every run and deletes retired scripts; profile files and the local override keep `force:false`. | `tests/hermes-setup-refresh.test.mjs` (3) |
| H13 | Token reaches Python via env; payload and `x-discovery-secret` header go to curl via mode-600 temp files (`--data-binary @`, `-H @`); `umask 077`. | `tests/hermes-discovery-trigger-argv.test.mjs` (end-to-end with argv-recording curl/python shims) |
| H15 | `jhos_common.load_google_credentials`: no scope override, refresh written via temp + `os.replace` under a lock file; used by followup, interest, watcher, pipeline-status, discovery-trigger. | `test_token_refresh_keeps_scopes_and_writes_atomically`, `test_concurrent_token_writes_never_leave_a_torn_file`, `test_sheet_scripts_use_the_shared_token_helper` |
| H16 | All Pipeline ranges open-ended (`A:X` / `A:M`, gviz `range=A:M`). | `test_followup_reads_open_ended_range_from_the_configured_sheet` (row 550 of 600 reported), trigger range test |
| H18 | Orchestrator passes confirmation screenshot, results path, platform into `write_evidence`; metadata records `screenshot_sha256`; Gate 2 message platform derived from host. | `test_write_evidence_copies_screenshot_and_records_hash`, `test_platform_is_derived_from_the_host`, `test_evidence_holds_*`, `test_gate2_message_names_the_real_platform` |
| H19 | Deleted `greenhouse_filler.py`, `ats_adapters/`, `triage_pipeline.py`, `install-rotated-worker-keys.sh` (+ its test), `send_cancellation`/`send_success`. `followup-monitor.py` is a shim over `followup_monitor.py`. Watcher keys rows by normalized link and marks reported only after a successful send. | `test_unused_notification_helpers_are_gone`, `test_followup_twin_is_a_shim_not_a_copy`, `test_watcher_*`, `hermes-apply-safety.test.mjs` |
| H20 | `jhos_common.py` owns `.env` parsing, token, Telegram HTTP, worker-config lookup, local time. Repair round: follow-up thresholds now live in one shared file, `integrations/hermes-job-hunt/followup-thresholds.v1.json` (7/14/21) with `followup-thresholds.schema.json`; `followup_monitor.py` reads it through `jhos_common.followup_thresholds()` (refuses a missing, malformed or non-increasing file) and has no literal day numbers; `setup:hermes` ships both files to the runtime copy; `tests/hermes-followup-thresholds.test.mjs` validates the file against the schema and pins daily-brief.js `BRIEF_STALE_APPLIED_DAYS`/`BRIEF_WAITING_REPLY_MIN_DAYS` and today-data.js `STALE_APPLIED_DAYS`/`WAITING_REPLY_MIN_DAYS` equal to it, so drift on either side fails CI. | `test_env_parsing_and_telegram_http_live_in_jhos_common_only`, `test_followup_thresholds_load_from_the_shared_file`, `test_followup_thresholds_file_that_is_out_of_order_is_refused`, `test_followup_categories_follow_the_shared_thresholds`, `test_followup_monitor_has_no_hardcoded_day_thresholds`, `tests/hermes-followup-thresholds.test.mjs` (3) |
| H22 | Gate 1 failure text names Approval Status; watcher ignores `TELEGRAM_HOME_CHANNEL`, posts interest prompts to `interest.threadId` (not Gate 2), refuses when unset; `gate1-approve.py` → `interest-approve.py`; spec and kanban doc corrected. | `test_gate1_failure_text_*`, `test_watcher_posts_to_the_interest_thread_not_gate2`, `test_watcher_refuses_without_an_interest_thread`, `approval-contract.test.mjs` |
| H23 | `zoneinfo`: `JHOS_TIMEZONE`, else worker-config `timezone`, else America/Chicago. | `test_local_now_uses_chicago_dst_rules`, `test_local_timezone_can_be_configured`, `test_no_fixed_utc_minus_five_clock` |

Repair round 3 (H4/H5 follow-up, commit 93d68756): the live loop stops right after an unverified submit attempt and reports `unknown_after_submit`, so no second submit click can happen; `is_field_interaction_click` reads the ARIA role first (combobox, listbox, option, checkbox, radio, switch), so a `<button type="button" role="combobox">` is a field click, while `type=submit`/`image` and submit-like labels stay gated.

Repair round 4 (review findings): commit d0721c02 adds `input` to `FIELD_CLICK_KINDS`, so focusing an `<input>` with no type attribute (page_state_extractor.js reports kind='input') is a field click and no longer trips the submission gate before the field is filled (H4). Commit 290335c7: `local_timezone()` tries the configured zone, then America/Chicago, then falls back to the host clock's current offset instead of raising `ZoneInfoNotFoundError`; `requirements.txt` now declares `tzdata>=2024.1` so hosts without a system tz database (fresh Windows) get real DST rules (H23).

## Claims deferred or partial

- **H8 / F18 (partial)**: `resume-template/**` and `cover-letter-template/**` are outside this fence; the owner identity in those templates is untouched. `scripts/materials_watcher/notifier.py:11-12` (outside fence) still hardcodes the owner's Telegram chat and thread ids. Owner: lane M / F. `scripts/materials_request.py` reads `g2.CHAT_ID/THREAD_ID`, which are now `None` until `approval-contract.local.json` exists, so materials notifications stop on a machine without the local file (fail closed).
- **H9 (residual)**: confirmation through the Hermes gateway (inline-button callback or relay) is not built; the fix fails fast and explains the 409 and offers a dedicated-bot token. Needs the gateway, which is outside the repo.
- **H11 (residual)**: setup does not run `playwright install chromium` (a ~150 MB download on every `setup:hermes` while apply is shelved). The preflight names the command before Gate 2.
- **H12 (residual)**: "report drift in doctor:hermes" needs `scripts/doctor.mjs`, outside this fence (lane O).
- **H20 (residual, narrowed)**: one shared config and schema now exist and Hermes reads them; the browser constants in `daily-brief.js:31-32` and `today-data.js:35-36` still hold their own literals because those files are outside this fence. They are pinned equal to the shared file by `tests/hermes-followup-thresholds.test.mjs`, so they cannot drift silently. Making the browser load the JSON at run time is a follow-up for the owner of those files.

## Tests added — red then green

Repair round 2 (review findings on universal_filler.py:789 and gate2_telegram.py:51):
- Gate 2 token scope — red (`.lane-evidence/pytest-red-r2-token.txt`): `1 failed, 13 passed` — `('sendMessage', 'gate2-bot') != ('sendMessage', 'shared-bot')` in `test_shared_api_call_keeps_the_shared_bot_when_gate2_bot_is_set`. Green: `14 passed`. Commit 797e9932.
- Field clicks — red (`.lane-evidence/pytest-red-r2-fieldclick.txt`): `3 failed, 15 passed` — `assert [] == ['#country', ...]` (the gate blocked the combobox click), `assert True is False` (combobox click classified as submit), `assert [] == ['#country']`. Green: `18 passed`. Commit e8dd5866.
- Whole Hermes suite after both: `127 passed in 0.20s` (`.lane-evidence/pytest-green-r2.txt`); changed modules import under `/usr/bin/python3` 3.9.6.

Repair round (H20): `.lane-evidence/red-h20.txt` — pytest `4 failed, 117 deselected` (no `followup_thresholds`, literal `>= 21` in followup_monitor.py); node `ENOENT ... followup-thresholds.schema.json` / `followup-thresholds.v1.json`. Green: pytest `121 passed in 0.15s`; `node --test tests/approval-contract.test.mjs tests/hermes-*.test.mjs` → `tests 20, pass 20, fail 0`.


Red (tests written first, run against the unchanged scripts):
- pytest, whole new suite: `58 failed, 24 passed, 19 errors` (`.lane-evidence/pytest-red.txt`). Gate 2 subset with the allowlist fixture made non-raising: `8 failed, 3 passed in 42.81s` — e.g. `assert 'cancel' in "timeout: no 'yes submit meta' received within 2s"` (Metabase approves Meta path), `assert '409' in "Timeout: no 'YES SUBMIT META' received within 30s"`, offset=-1 flush asserted.
- `tests/hermes-discovery-trigger-argv.test.mjs`: `fail 3` — "Google access token appeared in a process argv", no jhos_common, "Pipeline ranges must be open-ended" (`.lane-evidence/red-h13.txt`).
- `tests/hermes-setup-refresh.test.mjs`: `pass 1, fail 2` — "runtime gate2_telegram.py must match the repo copy" (`.lane-evidence/red-h12.txt`).
- `tests/hermes-apply-safety.test.mjs` (mid-build): PII scan hits in `approval-guard-spec.md` (owner chat id) and a test email; "a CI job must run integrations/hermes-job-hunt/tests" (`.lane-evidence/red-static.txt`).

Green:
- `python -m pytest integrations/hermes-job-hunt/tests -q` → `117 passed in 0.14s` (Python 3.12, pytest 9.1.1 from the local uv cache).
- `node --test tests/approval-contract.test.mjs tests/hermes-*.test.mjs` → `tests 17, pass 17, fail 0`.
- Audit probe `h_probe_pure.py` re-run (`.lane-evidence/probes/h_probe_pure.after.out`): gate2 cases all `confirmed=False`; notes_wipe `success: False` with no write; distinct sid/case URLs no longer collide; Send/Done/Confirm classified as submit; pre-submit "thank you" no longer a hit; Gate 1 text names Approval Status.

- Repair round 3 (commit 93d68756) — red (`.lane-evidence/pytest-red-r3.txt`): `3 failed, 19 passed` — `assert ['#send', '#send', '#send'] == ['#send']` (unverified inline "Application submitted" on an unchanged form at the same URL let the planner click Send again); `AssertionError: combobox / assert False is True` (a `<button type="button" role="combobox">` classified as a non-field click); `assert [] == ['#country']` (the gate blocked opening that dropdown while Email was empty). Tests: `test_unverified_submit_is_never_clicked_twice`, `test_button_with_a_field_role_is_a_field_interaction`, `test_field_role_does_not_hide_a_submit_button`, `test_opening_a_button_combobox_is_allowed_while_another_required_field_is_empty`. Green: whole Hermes suite `131 passed in 0.19s` (`.lane-evidence/pytest-green-r3.txt`); `universal_filler` imports under `/usr/bin/python3` 3.9.6.

- Repair round 4 — untyped input (commit d0721c02). Red against the pre-fix `universal_filler.py` (`.lane-evidence/pytest-red-r3-untyped.txt`): `2 failed, 131 deselected` — `test_untyped_input_is_a_field_interaction` (`is_field_interaction_click` returned False for kind='input') and `test_focusing_an_empty_untyped_input_then_filling_it_is_allowed` (`assert [] == ['#name']`: the gate aborted on the focus click, nothing filled). Green: `133 passed`.
- Repair round 4 — tz database (commit 290335c7). Red (`.lane-evidence/pytest-red-r3-tzdata.txt`): `2 failed, 2 passed` — `ZoneInfoNotFoundError: 'No time zone found with key America/Chicago'` from `local_now()` after `zoneinfo.reset_tzpath([])` with the `tzdata` import blocked (`test_local_now_survives_a_host_without_a_tz_database`), and `test_runtime_requirements_install_the_tz_database` (no tzdata line). Green: whole Hermes suite `135 passed in 0.19s` on Python 3.13 and `135 passed in 0.32s` on Python 3.9 (via uv).

## Floor output

Repair round 4, run on the tree committed at 290335c7 (`.lane-evidence/floor-5.log`), fresh `HOME=$(mktemp -d)`, `PLAYWRIGHT_BROWSERS_PATH` set, exit 0:
```
lint:repo        eslint . clean; OK integrations/openclaw-command-center/SKILL.md
typecheck:repo   no errors
npm test         ℹ tests 3276 · pass 3264 · fail 0 · skipped 0 · todo 12
test:browser-use-discovery  ℹ tests 767 · pass 767 · fail 0 · todo 0
test:contract:all  12 OK lines, 0 failures (discovery, ATS, pipeline, pipeline-update, skills)
```


Repair round 3, run on the tree committed at 93d68756 (`.lane-evidence/floor-4.log`), fresh `HOME=$(mktemp -d)`, `PLAYWRIGHT_BROWSERS_PATH` set, exit 0:
```
lint:repo        eslint . clean; OK integrations/openclaw-command-center/SKILL.md
typecheck:repo   tsc (worker, server) + node --check: no errors
npm test         ℹ tests 3276 · pass 3264 · fail 0 · skipped 0 · todo 12
test:browser-use-discovery  ℹ tests 767 · pass 767 · fail 0 · todo 0
test:contract:all  12 OK lines, 0 failures (discovery, ATS, pipeline, pipeline-update, skills)
```

Repair round 2:

Repair round 2 detail: run on the committed tree at e8dd5866 (`.lane-evidence/floor-3.log`), fresh `HOME=$(mktemp -d)`, `PLAYWRIGHT_BROWSERS_PATH` set, exit 0:
```
lint:repo        eslint . clean; OK integrations/openclaw-command-center/SKILL.md
typecheck:repo   tsc (worker, server) + node --check: no errors
npm test         ℹ tests 3276 · pass 3264 · fail 0 · skipped 0 · todo 12
test:browser-use-discovery  ℹ tests 767 · pass 767 · fail 0 · todo 0
test:contract:all  12 OK lines, 0 failures (discovery, ATS, pipeline, pipeline-update, skills)
```

Previous repair round:

Repair round, run on the working tree before commit (`.lane-evidence/floor-2.log`), fresh `HOME=$(mktemp -d)`, exit 0:
```
lint:repo        eslint . clean; OK integrations/openclaw-command-center/SKILL.md
typecheck:repo   no errors
npm test         tests 3276, pass 3264, fail 0, cancelled 0, skipped 0, todo 12
test:browser-use-discovery  tests 767, pass 767, fail 0
test:contract:all  all OK (discovery, ATS, pipeline, pipeline-update, skills)
```

Earlier round:

`HOME=$(mktemp -d) PLAYWRIGHT_BROWSERS_PATH=/Users/emilionunezgarcia/Library/Caches/ms-playwright npm run lint:repo && npm run typecheck:repo && npm test && npm run test:browser-use-discovery && npm run test:contract:all` → exit 0 (`.lane-evidence/floor-1.log`, run on the committed tree).

```
lint:repo        eslint . clean; OK integrations/openclaw-command-center/SKILL.md
typecheck:repo   tsc (worker, server) + node --check: no errors
npm test         ℹ tests 3273 · suites 783 · pass 3261 · fail 0 · cancelled 0 · skipped 0 · todo 12
test:browser-use-discovery  ℹ tests 767 · pass 767 · fail 0
test:contract:all  OK schema ×3, OK ATS ×4, OK pipeline-row ↔ README ↔ app-config-core ↔ pipeline-render, OK pipeline-update, OK SKILL.md
```
Baseline before the change: npm test 3265 tests / 3253 pass / 0 fail / 12 todo; worker 767/767. The 12 todo are other lanes' target-behavior tests.

## Unverified

- Round 4: the Hermes suite ran on 3.13 and 3.9 via uv (135 passed on each). Earlier rounds ran on 3.12 only; every changed module imports cleanly under `/usr/bin/python3` 3.9.6 (checked), and `from __future__ import annotations` was added to `jhos_submit.py` and `apply-orchestrator.py`, which previously failed to import on 3.9.
- Behavior change in round 3: after any unverified submit the filler no longer lets the planner fix validation errors and resubmit; that case now ends as unknown_after_submit for manual review (conservative by design).
- The tz fallback without any tz database uses the host's current offset, so DST transitions are not tracked on such a host; installing requirements.txt (tzdata) avoids that path.
- No live Telegram, Google Sheets, browser or worker run (forbidden). H9 is proven only with a stubbed 409.
- `hermes-pytest.yml` has not run on GitHub.
- Operator follow-up for the main machine after this merges and `setup:hermes` runs: create `~/.hermes/job-hunt/approval-contract.local.json` (gate2 chat/thread/approver ids; interest chat/thread) and, for assisted apply, `profile/filler-profile.json`. Until then Gate 2, the interest watcher and materials Telegram notifications fail closed. Hermes skills that call `gate1-approve.py` keep working through the shim.
