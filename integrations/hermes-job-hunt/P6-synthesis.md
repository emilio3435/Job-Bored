# JHOS Phase 6 Synthesis

**Date:** 2026-05-27
**Phase:** 6 — Auto-draft materials, Gate 2 implementation, browser-assisted apply, follow-up automation
**Status:** Complete

---

## What Phase 6 delivered

### T6.0 — Pipeline triage
- Triaged 116 stale "New" rows → 73 New / 33 Expired (>14 days old) / 10 Passed (fit score ≤4)
- Pipeline now has 73 active leads instead of 116
- Reusable triage script: `~/.hermes/job-hunt/scripts/triage_pipeline.py`
- Report: `~/.hermes/job-hunt/evidence/t6.0-triage-report.md`

### T6.1a — Chartis.io application materials
- Full package for Senior Digital Marketing Consultant (Fit 9, Match 10)
- JD fetched from chartis.io/careers via Rippling ATS (Teal was Cloudflare-blocked)
- Consulting-first positioning, all voice rules followed, QA passed
- Files at `~/.hermes/job-hunt/applications/chartis-senior-digital-marketing-consultant/`:
  - job-description.md, job-analysis.md
  - resume.html (28KB) + resume.pdf (354KB) — 2 pages
  - cover-letter.html (13KB) + cover-letter.pdf (293KB) — 1 page
  - qa-report.md
- Flagged: seniority mismatch (JD asks 4-6+, Emilio has 10+), LinkedIn/Bing Ads not claimed

### T6.1b — CrowdStrike assessment
- "C-Serv" was a truncated company name → actually CrowdStrike (row 115)
- Listing still active on CrowdStrike Workday portal (R27297, posted 30+ days ago)
- Workday = auto-submit blocked per policy. Manual apply if desired.
- Prototype materials exist from Phase 3
- Pipeline row updated with correct company name, Workday URL, and assessment notes

### T6.2 — Gate 2 Telegram implementation
- Built `gate2_telegram.py`: standalone module using Telegram Bot API directly
  - `send_approval_request()` → sendMessage to thread 48
  - `poll_for_confirmation()` → getUpdates with long polling
  - `send_cancellation()` / `send_success()` for lifecycle notifications
  - CLI: `python3 gate2_telegram.py send|poll|test`
- Patched `apply-orchestrator.py`:
  - `send_gate2_request()` → delegates to gate2_telegram
  - `wait_for_gate2_confirmation()` → delegates to gate2_telegram (passes after_message_id for precision)
  - `notify_telegram()` → delegates to gate2_telegram
- Live test: sent test message to thread 48, message_id 51 confirmed
- Replaces the broken `hermes receive` placeholder

### T6.3 — Greenhouse form filler
- Built `greenhouse_filler.py`: Playwright-based Greenhouse ATS form filler
  - Fills standard fields: name, email, phone, location, LinkedIn, website
  - Uploads resume.pdf and cover-letter.pdf
  - Handles custom questions (authorized to work, sponsorship, start date, referral, EEO)
  - Screenshots at each stage for evidence
  - Dry-run mode supported
  - CLI: `python3 greenhouse_filler.py --url <url> --app-dir <path> [--dry-run]`
- Wired into `apply-orchestrator.py` Step 7:
  - Auto-detects ATS from URL hostname
  - Greenhouse → greenhouse_filler
  - Other ATS → "unsupported, manual submit required"
- Greenhouse is the most common ATS in the pipeline (22 listings)

### T6.4 — Follow-up automation
- Built `followup_monitor.py`: scans Applied roles for follow-up needs
  - 7-14 days: suggest follow-up (🟢)
  - 14-21 days: overdue (🟡)
  - 21+ days: likely closed (🔴)
  - No applied date: flagged (⚪)
  - Silent when nothing needs attention (watchdog pattern)
- Cron job `8544befd3eed`: "Follow-up Monitor (Applied Roles)"
  - Schedule: Mon/Wed/Fri at 8:00 AM CT
  - Delivers to thread 3
  - no_agent script (zero tokens)
- Current findings: Yelp 23d, CMI 21d (both likely closed), Greenlight no date

---

## Pipeline state (post-Phase 6)

| Status | Count |
|--------|-------|
| New | 73 |
| Expired | 60 |
| Passed | 40 |
| Applied | 3 |
| Researching | 2 |
| **Total** | **178** |

Researching roles:
1. CrowdStrike — Director, Sales Enablement (Workday, manual-submit only, materials exist)
2. Chartis.io — Senior Digital Marketing Consultant (materials complete, ready to submit)

---

## Cron schedule (daily)

| Time (CT) | Job | ID | Target | Type | Frequency |
|-----------|-----|----|--------|------|-----------|
| 7:00 AM | JobBored Discovery (Worker) | a72d4d8102cb | thread 3 | no_agent script | Daily |
| 7:30 AM | Pipeline Status (Daily) | 351dd9ccb570 | thread 3 | no_agent script | Daily |
| 8:00 AM | Morning AI Brief | b4abbceb4fc2 | thread 2 | LLM-driven | Daily |
| 8:00 AM | Follow-up Monitor | 8544befd3eed | thread 3 | no_agent script | M/W/F |

Paused: Daily Job Search (`e20891fa7b7c`) — replaced by worker-based discovery

---

## New files created in Phase 6

| File | Purpose |
|------|---------|
| `~/.hermes/job-hunt/scripts/gate2_telegram.py` | Gate 2 Bot API integration |
| `~/.hermes/job-hunt/scripts/greenhouse_filler.py` | Greenhouse ATS form filler (Playwright) |
| `~/.hermes/job-hunt/scripts/followup_monitor.py` | Follow-up monitor for Applied roles |
| `~/.hermes/job-hunt/scripts/triage_pipeline.py` | One-time pipeline triage (reusable) |
| `~/.hermes/scripts/followup-monitor.py` | Copy for cron access |
| `~/.hermes/job-hunt/evidence/t6.0-triage-report.md` | Triage results |
| `~/.hermes/job-hunt/applications/chartis-senior-digital-marketing-consultant/` | Full application package |

## Files modified in Phase 6

| File | Changes |
|------|---------|
| `~/.hermes/job-hunt/scripts/apply-orchestrator.py` | Gate 2 → Bot API, Step 7 → Greenhouse filler, notify → Bot API |

---

## Readiness assessment

### What works end-to-end
- Discovery → Notification → Gate 1 (YES reply) → Status=Researching → Materials drafted → PDFs rendered → QA passed → Gate 2 (Telegram confirmation) → Greenhouse form fill → Evidence capture → Pipeline update → Follow-up monitoring

### What needs live testing
1. **Gate 2 full flow**: The send/poll cycle works individually but hasn't been tested end-to-end through the orchestrator with a real submission
2. **Greenhouse filler on a real form**: Built against Greenhouse's standard structure but not tested on a live application page
3. **Follow-up cron**: Created but first scheduled run is tomorrow

### Known gaps
1. **Lever/Ashby/Rippling form fillers**: Only Greenhouse is supported. Other ATS platforms log "unsupported" and require manual submit.
2. **Workday automation**: Explicitly blocked. CrowdStrike and similar require manual apply.
3. **Auto-draft on Gate 1 pass**: The skill mentions this as a trigger (T6.1 spec), but it's currently manual — the agent drafts when asked, not automatically when Status changes to Researching. A Kanban watcher or webhook could automate this.
4. **Gemini API key**: Still expired. Grounded web discovery source returns 400.
5. **116→73 New rows**: Still a lot. May need periodic re-triage or score threshold increase.

### Recommended next steps (Phase 7)
1. **First live Greenhouse submission**: Pick a Greenhouse role from the 73 New leads, approve through Gate 1, draft materials, run the full orchestrator with `--dry-run` first, then live
2. **Auto-draft trigger**: Add a cron or webhook that detects Status=Researching and auto-initiates material drafting
3. **Lever form filler**: Second most common ATS in pipeline (after aggregator sites)
4. **Multiple resume templates**: User requested this as a future feature
5. **Interview prep automation**: When status moves to Phone Screen/Interviewing
