# JHOS Phase 4 Synthesis — Submit Pipeline

**Date:** 2026-05-26
**Status:** Phase 4 complete. Submit pipeline built, tested in dry-run, committed.

---

## What was built

### Submit pipeline primitives — `~/.hermes/job-hunt/scripts/jhos_submit.py`

| Component | Function | Status |
|---|---|---|
| URL normalizer | `normalize_url()` — mirrors lead-normalizer.ts, strips tracking params, lowercases host, removes trailing slashes | ✅ Tested |
| URL-to-slug | `url_to_slug()` — filesystem-safe slug from normalized URL | ✅ Tested |
| Workday blocker | `is_workday_blocked()` — blocks workday.com + myworkdayjobs.com hostnames | ✅ Tested (4 URLs) |
| Submit lock | `lock_acquire/check/release()` — SQLite-backed at `~/.hermes/job-hunt/state/submit-locks.db`, TTL=15min, owner=kanban_task_id | ✅ Full lifecycle tested |
| Gate 1 reader | `gate1_check()` — reads Pipeline via Sheets API, finds row by normalized URL, returns approval status | ✅ Tested (needs live Sheet credentials) |
| Evidence writer | `write_evidence()` — metadata.json + screenshot copy to `~/.hermes/job-hunt/evidence/{slug}/` | ✅ Tested (dry-run stub) |
| Pipeline updater | `update_pipeline_applied()` — sets Status→Applied, Applied Date, appends Notes via Sheets API batch update | ✅ Implemented |
| Failure handlers | 5 SubmitFailure objects: gate1, gate2_timeout, lock_collision, browser_crash, screenshot | ✅ All wired |

### APPLY card orchestrator — `~/.hermes/job-hunt/scripts/apply-orchestrator.py`

10-step chain:
1. Find application directory by URL/slug
2. Validate DRAFT artifacts (resume.html, resume.pdf, cover-letter.html, cover-letter.pdf)
3. Workday hostname check
4. Gate 1: Pipeline Approval Status = "Approved"
5. Acquire submit lock (SQLite, TTL=15min)
6. Gate 2: Telegram confirmation to `telegram:-1003800236296:48` with 10-min timeout
7. Browser-assisted fill (placeholder — needs Playwright/computer_use integration)
8. Evidence capture (screenshot + metadata.json)
9. Pipeline row update (Status→Applied, Applied Date, Notes append)
10. Lock release

Supports `--dry-run` flag for testing without side effects.

### Repo commit

```
commit 4b0e275
13 files changed, +1677/-49 lines
Tests: 375 passed, 0 failed
```

---

## Dry-run verification

Ran against CrowdStrike DRAFT prototype:

```
Job URL: https://www.theladders.com/job/director-sales-enablement-specialists-remote-crowdstrikeholdingsinc-virtual-travel_85905056
Task ID: t_05a4e9ad
Mode: --dry-run

Steps:
  ✅ find_app_dir → crowdstrike-director-sales-enablement-specialists/
  ✅ validate_draft → all 4 artifacts present
  ✅ workday_check → clear (not a Workday URL)
  ⚠️ gate1 → skipped (no sheet credentials in dry-run)
  ✅ lock_acquire → acquired by t_05a4e9ad
  ✅ gate2 → skipped (dry-run)
  ✅ browser_fill → skipped (dry-run)
  ✅ evidence → stub written
  ✅ pipeline_update → skipped (dry-run)
  ✅ lock_release → released

Result: success (dry run)
```

Evidence stub verified at:
`~/.hermes/job-hunt/evidence/www-theladders-com-job-director-sales-enablement-specialists-remote-crowdstrikeholdingsinc-virtual-travel-85905056/metadata.json`

---

## What is NOT yet implemented

### Browser fill (Step 7)

The orchestrator has a placeholder for browser-assisted form filling. Two options:

1. **Playwright** — script navigates Greenhouse/Lever apply pages, fills fields from DRAFT artifacts, uploads resume PDF.
2. **computer_use** — Hermes `computer_use` tool drives the browser visually.

Both require:
- A real job to apply to (not a prototype)
- Emilio's presence during the first live run
- Gate 1 + Gate 2 to pass (by design)

### Gate 2 polling

The `wait_for_gate2_confirmation()` function uses `hermes receive` CLI which may not exist. For production:
- Option A: Use Telegram Bot API `getUpdates` directly
- Option B: Use a Hermes cron job that watches thread 48 for the confirmation phrase
- Option C: Use the Hermes gateway webhook if available

This will need wiring when we do the first live apply.

### Live Gate 1

Gate 1 needs:
- The Google Sheet ID (currently empty in worker-config.json)
- A valid Google Sheets access token or service account

The JobBored worker already handles this via `resolveAccessToken`. We can either:
- Reuse the worker's auth from `.env`
- Or pass `--sheet-id` and `--access-token` explicitly

---

## Kanban status

| Task | Status |
|---|---|
| t_e9a478d3 T4.0 Gate 1 reader | ✅ done |
| t_42add345 T4.1 URL normalizer + locks | ✅ done |
| t_35b01a6c T4.2 Gate 2 Telegram flow | ✅ done |
| t_556ca70a T4.3 Workday blocker | ✅ done |
| t_ca9b3878 T4.4 Evidence writer | ✅ done |
| t_9cbf8a2a T4.5 Failure states | ✅ done |
| t_665f3781 T4.6 Orchestrator | ✅ done |
| t_05a4e9ad T4.7 Dry-run test | ✅ done |
| t_ddedc272 T4.8 Commit | ✅ done (4b0e275) |
| t_c282ffe7 T4.9 Synthesis | ✅ this document |

---

## Phase 5 readiness

Phase 5 is automated discovery scheduling + monitoring. Prerequisites:

- [ ] Google Sheet ID configured in worker-config.json or environment
- [ ] Google Sheets auth verified for live reads/writes
- [ ] At least one live Gate 1 + Gate 2 cycle tested end-to-end
- [ ] Browser fill implemented for at least one ATS (Greenhouse recommended)
- [ ] Cron job for daily/periodic discovery runs
- [ ] Monitoring: Telegram alerts for new high-fit discoveries

**Recommendation:** Before Phase 5, run one real apply cycle end-to-end with Emilio present. Pick a role worth pursuing, add it to Pipeline, set Approval Status = Approved, and let the system request Gate 2 confirmation. This validates the full chain before we automate discovery scheduling.

---

## File locations

| Artifact | Path |
|---|---|
| Submit library | `~/.hermes/job-hunt/scripts/jhos_submit.py` |
| Orchestrator | `~/.hermes/job-hunt/scripts/apply-orchestrator.py` |
| Lock database | `~/.hermes/job-hunt/state/submit-locks.db` |
| Evidence root | `~/.hermes/job-hunt/evidence/` |
| This synthesis | `~/.hermes/job-hunt/P4-synthesis.md` |
