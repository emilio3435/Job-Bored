# JHOS Phase 1 Synthesis — Execution Report

**Date:** 2026-05-26
**Status:** Phase 1 complete; Phase 2 decisions captured; Phase 2 dispatch started.

## Phase 1 completed

| Task | Output | Status |
|---|---|---|
| t_20237b30 — Kanban conventions | `/Users/emiliong/.hermes/job-hunt/kanban-task-conventions.md` | Done |
| t_4d7ab6d9 — Approval guard design | `/Users/emiliong/.hermes/job-hunt/approval-guard-spec.md` | Done |
| t_b868cfdb — Profile doc wiring audit | Cron/plan prompts verified/patched to reference canonical profile docs | Done |
| t_4b08e5ee — Worker config inspection | Config/readiness gaps mapped in Kanban run/log | Done |
| t_39abd741 — Phase 1 synthesis | This report | Done |

## Corrections applied after worker synthesis

- Approval guard spec originally referenced Column J / `Phase`; corrected because current JobBored schema has J = `Tags`, M = `Status`, and no existing `Approved` enum.
- Application submission remains blocked until the Pipeline approval marker is explicitly chosen and implemented.
- `computer_use` is enabled for controlled browser assistance, but submit actions remain blocked.
- Kanban conventions now avoid non-existent `jobbored-worker` profile assignment. Default profile orchestrates; JobBored worker executes discovery/writeback.

## Phase 2 proposed graph

1. **T2.0 — Implement approval-guard skill**
   - Build `skills/job-approval.md` or equivalent from `/Users/emiliong/.hermes/job-hunt/approval-guard-spec.md`.
   - Blocked until Emilio chooses the Pipeline approval field.

2. **T2.1 — Integrate directional-prompting into discovery**
   - Wire query/framing logic into `/Users/emiliong/GitHub/emilio3435/Job-Bored/integrations/browser-use-discovery/`.
   - Depends on approval guard spec clarity.

3. **T2.2 — Extend profile-aware scoring**
   - Use canonical profile docs and `job-preferences.md` scoring rubric.
   - Write Fit Score and Fit Assessment/Talking Points from verified profile data.

4. **T2.3 — Harden Pipeline writeback**
   - Dedupe by normalized Column E.
   - Preserve A–Q required, R–T optional, and U–W extension columns.
   - Add idempotent write behavior and failure queue if needed.

5. **T2.4 — Discovery briefing skill**
   - Telegram/Winky role cards with approval/research/draft affordances.
   - Depends on current Telegram delivery capabilities.

6. **T2.5 — Pipeline sync reusable primitive**
   - Decide whether this belongs as a Hermes skill, JobBored module, or both.

## Decisions needed before Phase 2 dispatch

1. **Pipeline approval field**
   - Current schema lacks `Approved`.
   - Options:
     - A. Add `Approved` to Column M `Status` enum.
     - B. Add an extension column after current JobBored worker/dashboard extensions, e.g. `Approval Status`.
     - C. Use an existing live-sheet approval field if one exists but is not in schema.
   - Decision: B — add `Approval Status` after current worker/dashboard extension columns, to avoid polluting lifecycle status.

2. **Gate 2 chat confirmation route**
   - Options:
     - A. Use existing Winky Telegram thread.
     - B. Create/use a dedicated submit-approval thread.
     - C. Use strict final chat phrase in the current chat until inline buttons are implemented.
   - Decision: B — use a dedicated submit-approval Telegram/Winky thread. Thread target configured: `telegram:-1003800236296:48`.

3. **SerpApi key**
   - Options:
     - A. Add SerpApi key and enable Tier 2 Google Jobs discovery.
     - B. Skip SerpApi for now and use direct ATS APIs/career pages only.
   - Decision: A — enable SerpApi/Google Jobs discovery. Secret is not present in the live environment yet, so setup is blocked until Emilio supplies/stores the key.

4. **Phase 3 overlap**
   - Options:
     - A. Start resume/cover-letter pipeline in parallel with Phase 2.
     - B. Wait until discovery/writeback end-to-end is verified.
   - Decision: B — verify discovery/writeback end-to-end before starting Phase 3 resume/cover-letter work.
