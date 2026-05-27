# JHOS Handoff — 2026-05-26 Session 3 (Phases 0–5 complete, ready for Phase 6)

**Active goal:** `jobhunt-os-phase6` — Auto-draft materials + browser-assisted apply
**Stopped at:** Phase 5 complete. Discovery scheduling, monitoring, and Gate 1 flow operational. Ready for Phase 6.
**Kanban:** Zero open tasks. Phase 5 tasks all done.

---

## What exists (the system so far)

### Phase 0–1: Foundation
- Kanban conventions, profile docs, worker config, approval guard spec.
- All documented in `~/.hermes/job-hunt/`.

### Phase 2: Discovery infrastructure
- Pipeline schema: 24 columns (A–X). Column M = Status (lifecycle). Column X = Approval Status (deprecated).
- SerpApi key: live in `~/GitHub/emilio3435/Job-Bored/integrations/browser-use-discovery/.env`. Protected via `git update-index --assume-unchanged`.
- Directional prompting, profile-aware scoring, pipeline writer with URL dedupe.
- Tests: 375 passed, 0 failed. Commit: `4b0e275`.

### Phase 3: Application materials pipeline
- Templates (DO NOT MODIFY — copy per application):
  - Resume: `~/.hermes/job-hunt/resume-template/resume.html`
  - Cover letter: `~/.hermes/job-hunt/cover-letter-template/cover-letter.html`
- Quality gate: `~/.hermes/job-hunt/phase3-document-quality-gate.md`
- CrowdStrike prototype (validated, closed): `~/.hermes/job-hunt/applications/crowdstrike-director-sales-enablement-specialists/`

### Phase 4: Submit pipeline
- Library: `~/.hermes/job-hunt/scripts/jhos_submit.py`
- Orchestrator: `~/.hermes/job-hunt/scripts/apply-orchestrator.py`
- Lock DB: `~/.hermes/job-hunt/state/submit-locks.db` (TTL=20min, BEGIN IMMEDIATE)
- Workday blocker: 5 domain patterns (workday.com, myworkdayjobs.com, myworkdaysite.com, myworkday.com, workdayjobs.com)
- lock_release: atomic DELETE with owner check (TOCTOU fixed)

### Phase 5: Discovery scheduling + monitoring (NEW)
- **Discovery cron** (`a72d4d8102cb`): 7:00 AM Central daily
  - Script: `~/.hermes/scripts/discovery-trigger.sh`
  - Triggers JobBored worker at `http://127.0.0.1:8644/webhook`
  - Auto-starts worker if not running
  - Gets fresh OAuth token from `~/.hermes/google_token.json`
  - Builds `discoveryProfile` from worker-config.json arrays
  - Polls async runs for up to 10 minutes
  - After completion, reads Pipeline for Status=New rows and formats Telegram notification
  - Silent when no new jobs (watchdog pattern)
  - Delivers to `telegram:-1003800236296:3` (thread 3 = general job-hunt updates)

- **Pipeline status cron** (`351dd9ccb570`): 7:30 AM Central daily
  - Script: `~/.hermes/scripts/pipeline-status.py`
  - Status breakdown, new leads, Researching roles with materials status, Applied count, action items
  - Delivers to `telegram:-1003800236296:3`

- **Gate 1 handler**: `~/.hermes/job-hunt/scripts/gate1-approve.py`
  - Invoked when user replies "YES <COMPANY>" or similar
  - Finds matching Pipeline rows (case-insensitive substring match)
  - Sets Status → "Researching" via Sheets API batchUpdate
  - Supports `--list-new` and `--dry-run`

- **Paused:** Old LLM-driven "Daily Job Search" cron (`e20891fa7b7c`) — replaced by worker-based cron

- **Live test verified:**
  - Discovery: 514 listings scanned, 18 leads updated (Greenhouse, Ashby, SerpApi)
  - Gate 1: "YES Chartis" → Row 165 → Researching → gate1_check returns approved:true
  - Pipeline status: Chartis.io appears in Researching with "⏳ needs drafting"

---

## Gate model (current)

### Gate 1 — Interest signal (low friction)
Two equivalent ways to pass:
1. **Telegram reply** — Emilio replies YES/👍 to discovery notification → agent runs `gate1-approve.py` → Status set to "Researching"
2. **Sheet edit** — Emilio sets Column M (Status) to "Researching" or any later stage

Gate 1 passes when: `Status NOT IN {"New", "", "Rejected", "Passed"}`

### Gate 2 — Submit confirmation (hard wall)
- Telegram message to `telegram:-1003800236296:48` (thread 48)
- Emilio must reply `YES SUBMIT <COMPANY>` within 10 minutes
- Timeout → cancel, return card to queue, notify
- **Implementation status:** Placeholder. Uses `hermes receive` which doesn't exist. For first live apply, use interactive confirmation or Telegram Bot API `getUpdates`.

---

## Cron schedule (daily)

| Time (CT) | Job | ID | Target | Type |
|-----------|-----|----|--------|------|
| 7:00 AM | JobBored Discovery (Worker) | a72d4d8102cb | thread 3 | no_agent script |
| 7:30 AM | Pipeline Status (Daily) | 351dd9ccb570 | thread 3 | no_agent script |
| 8:00 AM | Morning AI Brief | b4abbceb4fc2 | thread 2 | LLM-driven |

---

## Pipeline state (as of 2026-05-26 21:00 CT)

| Status | Count |
|--------|-------|
| New | 116 |
| Passed | 30 |
| Expired | 27 |
| Applied | 3 |
| Researching | 2 |
| **Total** | **178** |

Researching roles:
1. Director, Sales Enablement - Specialists (Remote) @ C-Serv — needs drafting
2. Senior Digital Marketing Consultant @ Chartis.io (score 9) — needs drafting

---

## Key file map

| Category | Path |
|---|---|
| Master plan | `~/.hermes/plans/jobbored-hermes-master-plan.html` |
| Goal ledger | `~/.hermes/plans/.agent/GOALS.md` |
| Profile docs | `~/.hermes/job-hunt/profile/{profile,voice,resume-bullets,job-preferences}.md` |
| Resume template | `~/.hermes/job-hunt/resume-template/resume.html` |
| Cover letter template | `~/.hermes/job-hunt/cover-letter-template/cover-letter.html` |
| Quality gate | `~/.hermes/job-hunt/phase3-document-quality-gate.md` |
| Approval guard spec | `~/.hermes/job-hunt/approval-guard-spec.md` |
| Kanban conventions | `~/.hermes/job-hunt/kanban-task-conventions.md` |
| Submit library | `~/.hermes/job-hunt/scripts/jhos_submit.py` |
| Orchestrator | `~/.hermes/job-hunt/scripts/apply-orchestrator.py` |
| Gate 1 handler | `~/.hermes/job-hunt/scripts/gate1-approve.py` |
| Discovery trigger | `~/.hermes/scripts/discovery-trigger.sh` |
| Pipeline status | `~/.hermes/scripts/pipeline-status.py` |
| Lock DB | `~/.hermes/job-hunt/state/submit-locks.db` |
| Evidence root | `~/.hermes/job-hunt/evidence/` |
| Applications root | `~/.hermes/job-hunt/applications/` |
| Phase syntheses | `~/.hermes/job-hunt/P{1,2,4,5}-synthesis*.md` |
| Worker config | `~/GitHub/emilio3435/Job-Bored/integrations/browser-use-discovery/state/worker-config.json` |
| Worker .env | `~/GitHub/emilio3435/Job-Bored/integrations/browser-use-discovery/.env` (SerpApi key, assume-unchanged) |
| Pipeline schema | `~/GitHub/emilio3435/Job-Bored/schemas/pipeline-row.v1.json` |
| JobBored repo | `~/GitHub/emilio3435/Job-Bored` (main branch, commit `8d164bd`) |

---

## Key technical notes for the next agent

1. **worker-config.json is tracked but assume-unchanged.** If you need to commit repo changes, be aware that `git add .` will NOT pick up worker-config.json changes (good). But `git checkout` or `git stash` CAN reset it. After any branch operation, verify sheetId is still set.

2. **The webhook request contract differs from stored config.** The discovery worker webhook expects `discoveryProfile.targetRoles` as a comma-separated string in the POST body. It does NOT read `targetRoles[]` from worker-config.json for intent validation. The `discovery-trigger.sh` script handles this translation. If you modify worker-config arrays, the script will pick up changes automatically.

3. **OAuth token auto-refreshes.** The Google token at `~/.hermes/google_token.json` has a refresh_token. Scripts call `creds.refresh(Request())` when expired. If it hard-fails (`invalid_grant`), re-auth via the google-workspace skill setup flow.

4. **Discovery worker is a long-running HTTP server.** The cron script auto-starts it if not running. It stays running between cron invocations. Process runs at `http://127.0.0.1:8644`. Logs at `/tmp/jobbored-worker.log`. Health check: `GET /health`.

5. **Gemini API key is expired.** The `grounded_web` discovery source returns HTTP 400. This affects AI-powered broad web search but NOT ATS scraping or SerpApi. To fix: renew the Gemini API key and update it in the worker's .env or runtime config.

6. **The Pipeline has 116 stale "New" rows.** Most are from earlier discovery runs. Before relying on the notification formatter, consider a one-time triage: bulk-set irrelevant ones to "Passed" so daily notifications only surface genuinely new leads.

7. **Phase 3 templates contain scaffolding that must be stripped before PDF.** See `references/job-hunt-phase3-template-quality.md` in the job-hunt-automation skill. HTML comments, TWEAK_DEFAULTS scripts, React/Babel includes, `#tweaks-root` div, and `data-slot` annotations must all be removed before rendering. Set body class directly.

8. **Chrome `--print-to-pdf` timeouts are expected.** The subprocess times out (~30s) but writes the PDF correctly before hanging. Check file size (>100KB for resume, >50KB for cover letter), not exit code. Use `try/except TimeoutExpired: pass`.

---

## What Phase 6 should do

### T6.0 — Triage stale "New" rows
The 116 New rows need a one-time triage. Options:
- Bulk-set rows older than 30 days to "Passed" (expired lead)
- Run a scoring pass and auto-dismiss anything below score 5
- Present the top 20 to Emilio for manual YES/PASS decisions

### T6.1 — Auto-draft on Gate 1 pass
When Status transitions to "Researching" (either via gate1-approve.py or Sheet edit):
1. Create application folder: `~/.hermes/job-hunt/applications/{slug}/`
2. Fetch job description (from link in Pipeline, or SerpApi cache)
3. Copy resume template → tailor content using profile docs
4. Copy cover letter template → tailor content
5. Strip template scaffolding (see note 7 above)
6. Render PDFs via Chrome `--print-to-pdf` (see note 8 above)
7. Run quality gate checks
8. Notify in Telegram: "📄 Materials ready for [Title] @ [Company]"

Two Researching roles need drafting now:
- Chartis.io — Senior Digital Marketing Consultant (score 9)
- C-Serv — Director, Sales Enablement - Specialists (Remote)

### T6.2 — Gate 2 implementation
Replace the `hermes receive` placeholder with working Telegram polling:
- Option A: Telegram Bot API `getUpdates` with long polling
- Option B: Webhook subscription on the bot
- Must watch thread 48 specifically for `YES SUBMIT <COMPANY>`
- 10-minute timeout, cancel on non-match

### T6.3 — Browser-assisted form fill
Implement Step 7 (browser fill) in `apply-orchestrator.py`:
- Playwright or computer_use for Greenhouse/Lever/Ashby forms
- Start with one ATS (Greenhouse is most common)
- Handle file upload (resume PDF), text fields, dropdowns
- Screenshot before and after submit

### T6.4 — Follow-up automation
- Periodic check on Applied roles (Status = "Applied")
- If no response after N days, surface as "needs follow-up"
- Optional: auto-generate follow-up email draft

### T6.5 — Phase 6 synthesis
Write P6-synthesis.md. Assess readiness for autonomous operation.

---

## Repo state

`~/GitHub/emilio3435/Job-Bored` — latest commit `8d164bd` on main.
- worker-config.json has assume-unchanged set (sheetId is local-only)
- .env has assume-unchanged set (SerpApi key + webhook secret)
- Hermes-side scripts (`~/.hermes/job-hunt/scripts/`) are NOT in the repo — they live in Hermes

---

## Persona

Sophisticated, whimsical, intelligent house-elf. Elegant, witty, warm, polished, lightly magical, not cutesy or servile. Scannable output. Central Time. Bilingual EN/ES. Telegram bot = Winky. Thread 48 = submit approvals only. Thread 3 = general job-hunt updates.

---

## How to start

```
Read ~/.hermes/job-hunt/HANDOFF-2026-05-26-session3.md and pick up Phase 6.
```
