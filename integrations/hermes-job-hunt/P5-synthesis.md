# JHOS Phase 5 Synthesis — Discovery Scheduling + Monitoring

**Date:** 2026-05-26
**Phase:** 5 (automated discovery scheduling + monitoring)
**Status:** Complete (T5.4 auto-draft deferred to Phase 6)
**Commit:** `8d164bd` on main (worker-config defaults)

---

## What was built

### T5.0 — Configuration
- Pipeline Sheet ID set in worker-config.json: `1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ`
- Google OAuth re-authenticated (token at `~/.hermes/google_token.json`)
- Worker-config populated: 10 targetRoles, 14 includeKeywords, 5 excludeKeywords, 3 locations, remote-first, senior
- worker-config.json protected with `git update-index --assume-unchanged` (sheetId is user-specific)

### T5.1 — Discovery cron
- Script: `~/.hermes/scripts/discovery-trigger.sh` (also at `~/.hermes/job-hunt/scripts/`)
- Cron: `a72d4d8102cb` — 7:00 AM Central daily → `telegram:-1003800236296:3`
- Worker auto-starts on port 8644 if not running
- Reads worker-config.json for sheetId and discoveryProfile fields
- Gets fresh OAuth token from google_token.json
- POSTs `DiscoveryWebhookRequestV1` with `trigger=scheduled-local`
- Polls async runs for up to 10 minutes
- After completion, reads Pipeline for New rows and formats Telegram notification
- Silent when no new jobs (watchdog pattern: empty stdout = no delivery)
- Old LLM-driven "Daily Job Search" cron paused (`e20891fa7b7c`)

### T5.2 — Telegram notification (integrated into T5.1)
- Formats top 10 new leads sorted by fit score
- Shows title, company, location, salary, score
- Includes reply instructions: "YES <COMPANY>" to approve

### T5.3 — Gate 1 reply handler
- Script: `~/.hermes/job-hunt/scripts/gate1-approve.py`
- Finds matching Pipeline rows by company name (case-insensitive, substring match)
- Sets Status → "Researching" via Sheets API batchUpdate
- Supports `--list-new` (show available companies) and `--dry-run`
- job-hunt-automation skill patched with reply pattern recognition

### T5.5 — Live end-to-end test
- Test candidate: Chartis.io "Senior Digital Marketing Consultant" (score 9)
- Gate 1 approval: `gate1-approve.py "Chartis"` → Row 165 set to Researching
- Verified in Sheet: Status = "Researching" confirmed via API
- gate1_check verified: returns `approved: true` for the Chartis URL
- Pipeline status report: shows Chartis.io in Researching with "⏳ needs drafting"
- Full chain: Discovery → Pipeline(New) → "YES Chartis" → Researching → gate1_check → approved ✓

### T5.6 — Monitoring dashboard
- Script: `~/.hermes/scripts/pipeline-status.py` (also at `~/.hermes/job-hunt/scripts/`)
- Cron: `351dd9ccb570` — 7:30 AM Central daily → `telegram:-1003800236296:3`
- Shows: status breakdown, new leads in last 24h, Researching roles with materials status, Applied roles, action items
- Silent when no data (watchdog pattern)

---

## Audit findings addressed

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| 1 | Workday blocker missed myworkdaysite.com, myworkday.com, workdayjobs.com | HIGH | Expanded to 5 domain patterns |
| 2 | Lock TTL=15min barely covers Gate2+browser fill | MEDIUM | Increased to 1200s (20 min) |
| 3 | lock_release TOCTOU race (SELECT then DELETE, no transaction) | MEDIUM | Atomic DELETE with BEGIN IMMEDIATE |
| 4 | Bare "AI" keyword too broad (matches irrelevant jobs) | MEDIUM | Replaced with "applied AI", "AI/ML", "generative AI" |
| 5 | Telegram target derivation | CLEAN | telegram:-1003800236296:3 correctly derived |
| 6 | Hardcoded secrets in tracked source | CLEAN | None found |
| 7 | Old sheet ID in cron config | CLEAN | Absent |
| 8 | remotePolicy/seniority/keywords well-formed | CLEAN | All consumed correctly by worker code |

---

## Cron schedule (daily)

| Time (CT) | Job | ID | Target |
|-----------|-----|----|--------|
| 7:00 AM | Discovery sweep | a72d4d8102cb | thread 3 |
| 7:30 AM | Pipeline status | 351dd9ccb570 | thread 3 |
| 8:00 AM | Morning AI Brief | b4abbceb4fc2 | thread 2 |

---

## Known issues / deferred

1. **T5.4 (auto-draft) deferred to Phase 6.** Auto-generating resume + cover letter on Gate 1 pass requires invoking the Phase 3 pipeline (template copy → tailoring → HTML → PDF). This is a significant integration that should be its own phase.

2. **Gemini API key expired.** The `grounded_web` discovery source returns HTTP 400. Needs key renewal.

3. **117 Pipeline rows at Status=New.** Most are from previous discovery runs. Need a one-time triage pass — either bulk review or set stale ones to "Passed".

4. **Lever source empty.** "No boards detected for lever in unrestricted scope" — needs company targets in worker-config to scrape specific Lever boards.

5. **Discovery script embedded Python.** The inline Python in discovery-trigger.sh works but the f-string escaping in bash heredoc is fragile. Future refactor: extract to a standalone Python formatter script.

6. **Gate 2 polling.** Still uses placeholder `hermes receive`. For the first live submit, use interactive confirmation or direct Telegram Bot API `getUpdates`.

---

## File map (new in Phase 5)

| File | Purpose |
|------|---------|
| `~/.hermes/scripts/discovery-trigger.sh` | Discovery cron script |
| `~/.hermes/scripts/pipeline-status.py` | Pipeline status cron script |
| `~/.hermes/job-hunt/scripts/gate1-approve.py` | Gate 1 approval handler |
| `~/.hermes/job-hunt/scripts/discovery-trigger.sh` | Discovery script (mirror) |
| `~/.hermes/job-hunt/scripts/pipeline-status.py` | Status script (mirror) |
| `~/.hermes/job-hunt/P5-synthesis.md` | This document |

---

## Phase 6 readiness

Phase 5 delivers the automated discovery-to-approval pipeline. Phase 6 should cover:

1. **Auto-draft on Gate 1 pass** (T5.4, deferred) — invoke Phase 3 pipeline when Status transitions to Researching
2. **Browser-assisted application** — Playwright/computer_use form fill for Greenhouse/Lever/Ashby
3. **Gate 2 live implementation** — Telegram Bot API polling for submit confirmation
4. **Follow-up automation** — periodic check on Applied roles, reminder nudges
5. **Interview prep** — job-specific research and talking points generation

The system is now operational for daily discovery and monitoring. The human-in-the-loop flow works: Emilio sees leads in Telegram → replies YES → Pipeline updates → materials can be drafted manually or via the agent.
