# JHOS Handoff — 2026-05-26 Session 2 (Phases 0–4 complete, ready for Phase 5)

**Active goal:** `jobhunt-os-phase5` — Automated discovery scheduling + monitoring
**Stopped at:** Phase 4 complete. All audit findings fixed. Gate 1 redesigned. Ready for Phase 5.
**Kanban:** Zero open tasks. All 17 cards done/archived.

---

## What exists (the system so far)

### Phase 0–1: Foundation
- Kanban conventions, profile docs, worker config, approval guard spec.
- All documented in `~/.hermes/job-hunt/`.

### Phase 2: Discovery infrastructure
- Pipeline schema: 24 columns (A–X). Column M = Status (lifecycle). Column X = Approval Status (deprecated for Gate 1, kept in schema).
- SerpApi key: live in `/Users/emiliong/GitHub/emilio3435/Job-Bored/integrations/browser-use-discovery/.env`. Protected via `git update-index --assume-unchanged`.
- Directional prompting: integrated into discovery at `src/discovery/directional-prompting.ts`.
- Profile-aware scoring: `src/normalize/profile-aware-scorer.ts`.
- Pipeline writer: handles 24-column schema with URL dedupe.
- Tests: 375 passed, 0 failed.
- Commit: `4b0e275`.

### Phase 3: Application materials pipeline
- Templates (DO NOT MODIFY — copy per application):
  - Resume: `~/.hermes/job-hunt/resume-template/resume.html`
  - Cover letter: `~/.hermes/job-hunt/cover-letter-template/cover-letter.html`
- Quality gate: `~/.hermes/job-hunt/phase3-document-quality-gate.md`
- CrowdStrike prototype (validated, closed): `~/.hermes/job-hunt/applications/crowdstrike-director-sales-enablement-specialists/`
  - resume.html, resume.pdf (2 pages), cover-letter.html, cover-letter.pdf (1 page), qa-report.md
  - All experience present: Audacy (3 roles), Elio, Hormiga Dormida, JobBored, Bucketz, PRMI
  - Banned phrase scan: clean. Template fidelity: verified via vision.

### Phase 4: Submit pipeline
- Library: `~/.hermes/job-hunt/scripts/jhos_submit.py`
  - `normalize_url()` — strips tracking params, lowercases host+path, strips `/apply` suffix
  - `lock_acquire/check/release()` — SQLite at `~/.hermes/job-hunt/state/submit-locks.db`, TTL=15min, `BEGIN IMMEDIATE` transactions
  - `gate1_check()` — reads Pipeline Column M (Status), passes when status is beyond "New"
  - `is_workday_blocked()` — blocks workday.com / myworkdayjobs.com hostnames
  - `write_evidence()` — screenshot + metadata.json to `~/.hermes/job-hunt/evidence/{slug}/`
  - `update_pipeline_applied()` — sets Status→Applied, Applied Date, Notes via Sheets API
  - 5 failure handlers: gate1, gate2_timeout, lock_collision, browser_crash, screenshot
- Orchestrator: `~/.hermes/job-hunt/scripts/apply-orchestrator.py`
  - 10-step chain with `--dry-run` flag
  - `try/finally` around post-lock code (lock always released)
  - Dry-run skips lock, evidence, Telegram, Pipeline writes
  - Dry-run verified against CrowdStrike prototype

---

## Gate model (current, post-redesign)

### Gate 1 — Interest signal (low friction)
Two equivalent ways to pass:
1. **Telegram reply** — system discovers job → sends summary → Emilio replies YES/👍 → system sets Status to "Researching"
2. **Sheet edit** — Emilio sets Column M (Status) to "Researching" or any later stage

Gate 1 passes when: `Status NOT IN {"New", "", "Rejected", "Passed"}`

### Gate 2 — Submit confirmation (hard wall)
- Telegram message to `telegram:-1003800236296:48` (thread 48)
- Emilio must reply `YES SUBMIT <COMPANY>` within 10 minutes
- Timeout → cancel, return card to queue, notify

### Column X (Approval Status) — deprecated
Remains in schema. No longer read by Gate 1. Can be repurposed for tracking or removed.

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
| Lock DB | `~/.hermes/job-hunt/state/submit-locks.db` |
| Evidence root | `~/.hermes/job-hunt/evidence/` |
| Applications root | `~/.hermes/job-hunt/applications/` |
| Phase syntheses | `~/.hermes/job-hunt/P{1,2,4}-synthesis*.md` |
| Worker config | `~/GitHub/emilio3435/Job-Bored/integrations/browser-use-discovery/state/worker-config.json` |
| Worker .env | `~/GitHub/emilio3435/Job-Bored/integrations/browser-use-discovery/.env` (SerpApi key, git-ignored) |
| Pipeline schema | `~/GitHub/emilio3435/Job-Bored/schemas/pipeline-row.v1.json` |
| JobBored repo | `~/GitHub/emilio3435/Job-Bored` (main branch, commit 4b0e275) |

---

## Known issues from audit (all fixed)

These were found by a 3-agent swarm audit and fixed in the same session:

1. ✅ SQLite lock race condition — fixed with `BEGIN IMMEDIATE` + `IntegrityError` catch
2. ✅ URL normalizer missing `/apply` suffix stripping — fixed, path also lowercased
3. ✅ Post-lock code lacked `try/finally` — fixed, lock always releases
4. ✅ Browser crash / screenshot failure handlers not wired — fixed in orchestrator
5. ✅ Dry-run acquired real lock — fixed, now skips lock entirely
6. ✅ Port stripping was naive string replace — fixed with `parsed.hostname`/`parsed.port`
7. ✅ Gate 1 data used hardcoded step index — fixed with named step lookup
8. ✅ Success flag was unconditionally True — fixed, computed from step results
9. ✅ DB connections leaked on early returns — fixed with `try/finally` on all functions

### Still open (not bugs, just not built yet)

- **Browser fill (Step 7):** Placeholder. Needs Playwright or computer_use for Greenhouse/Lever form filling. Build during first live apply.
- **Gate 2 polling:** Uses `hermes receive` which may not exist. For first live apply, either implement via Telegram Bot API `getUpdates` or do it interactively.
- **Google Sheets auth for live Gate 1:** Needs `--sheet-id` and `--access-token` (or reuse JobBored worker auth from `.env`). The `sheetId` in worker-config.json is empty — needs the real Sheet ID.

---

## What Phase 5 should do

Phase 5 = automated discovery scheduling + monitoring. Decompose into:

### T5.0 — Configure Google Sheet ID
The worker-config.json has `"sheetId": ""`. Set it to the real Pipeline Sheet ID. This unblocks live Gate 1 checks and Pipeline writes.

### T5.1 — Discovery cron job
Schedule a periodic SerpApi/Google Jobs discovery run. Recommended: every 6–12 hours. The JobBored worker already handles discovery; this task wires it into Hermes cron.
- Use `hermes cron create` with the discovery worker command
- Deliver results to the job-hunt Telegram thread (not thread 48)
- Respect SerpApi rate limits (100 searches/month on free tier)

### T5.2 — Discovery → Telegram notification
When new jobs are discovered and written to Pipeline (Status = "New"), send a formatted summary to the job-hunt Telegram thread with:
- Job title, company, location, salary (if known), fit score
- Reply instructions: `YES <COMPANY>` or 👍 to approve (triggers Gate 1)
This implements the Telegram side of the new Gate 1 flow.

### T5.3 — Telegram reply → Gate 1 handler
When Emilio replies YES/👍 to a discovery notification:
- Find the matching Pipeline row
- Set Status = "Researching"
- Trigger a DRAFT Kanban card for that job
- Confirm back in Telegram: "✅ Marked as Researching. Drafting materials."

### T5.4 — Auto-draft on Gate 1 pass
When a row transitions to "Researching" (either via Telegram or Sheet edit):
- Create a DRAFT Kanban card
- Generate tailored resume + cover letter using the Phase 3 pipeline
- Save to `~/.hermes/job-hunt/applications/{slug}/`
- Notify in Telegram: "📄 Materials ready for [Title] @ [Company]. Review at [path]."

### T5.5 — Live Gate 1 + Gate 2 end-to-end test
Pick a real job Emilio wants to pursue. Run the full pipeline with him present:
- Discover or manually add → Telegram notification → Emilio replies YES → auto-draft → review materials → set "Researching" → Gate 1 passes → Gate 2 confirmation → (browser fill when ready)
This validates the entire chain before trusting it unsupervised.

### T5.6 — Monitoring dashboard / status cron
Daily or twice-daily Telegram summary:
- Jobs discovered in last 24h
- Jobs awaiting Emilio's review (Status = "New")
- Jobs with materials ready (Status = "Researching" + application folder exists)
- Jobs applied to (Status = "Applied")

### T5.7 — Phase 5 synthesis
Write P5-synthesis.md. Determine Phase 6 readiness (follow-up automation, interview prep).

---

## Repo state

`~/GitHub/emilio3435/Job-Bored` — latest commit `4b0e275` on main. The audit fixes in `~/.hermes/job-hunt/scripts/` are NOT in the repo (they live in Hermes, not JobBored). If they should be tracked, commit them separately or add to the repo.

---

## Persona

Sophisticated, whimsical, intelligent house-elf. Elegant, witty, warm, polished, lightly magical, not cutesy or servile. Scannable output. Central Time. Bilingual EN/ES. Telegram bot = Winky. Thread 48 = submit approvals only.

---

## How to start

```
Read ~/.hermes/job-hunt/HANDOFF-2026-05-26-session2.md and pick up Phase 5.
```
