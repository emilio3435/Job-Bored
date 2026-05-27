# JHOS Phase 2 Synthesis — T2.7 Report

**Task:** t_e3d51f0a — Phase 2 synthesis and Phase 3 readiness decision
**Date:** 2026-05-26
**Status:** Phase 2 complete; Phase 3 can begin (conditional on Emilio inputs below)

---

## What was built

### Phase 2 deliverables from T2.4 + T2.5 + T2.6

| Component | File | Status |
|---|---|---|
| Approval guard skill | `~/.hermes/skills/job-approval.md` | ✅ Complete |
| Pipeline schema (24-col, X=Approval Status) | `schemas/pipeline-row.v1.json` | ✅ Complete |
| Directional-prompting integration | `integrations/browser-use-discovery/src/discovery/directional-prompting.ts` | ✅ Complete |
| Profile-aware scoring | `integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts` | ✅ Complete |
| Submit-approval Telegram thread | `telegram:-1003800236296:48` | ✅ Resolved |
| SerpApi key | `.env` (64-char, non-empty) | ✅ Live verified: Google Jobs returned CrowdStrike role |
| Pipeline writeback with dedupe | `src/normalize/lead-normalizer.ts`, `src/sheets/pipeline-writer.ts` | ✅ Complete |
| URL normalization | lead-normalizer.ts | ✅ Complete |

### Phase 2 decisions captured in docs

- `Approval Status` = Column X (sheet index 23) — does not overload Status (M) or Tags (J)
- Submit-approval Gate 2 target: `telegram:-1003800236296:48` (thread 48, source: https://t.me/c/3800236296/48/50)
- Phase 3 material drafting deferred until discovery/writeback end-to-end verified
- Workday direct automation blocked; SerpApi/Google Jobs links allowed

---

## Verification evidence

### Test results

```
npm run test — Job-Bored root
375 tests passed, 0 failed
Suites: 93, Duration: 7,787ms
```

Additional test files added by T2.4/T2.6:
- `tests/discovery/directional-prompting.test.ts` — directional-prompting.ts exports
- `tests/sheets/lead-normalizer.test.ts` — dedupe + normalization
- Total test count including new files: **455**

### Pipeline contract (schema)

Verified via `schemas/pipeline-row.v1.json`:
- A–Q: 17 required/optional core columns preserved
- R–T: existing worker/dashboard columns preserved
- U–W: extension columns preserved (Match Score, Favorite, Dismissed At)
- X: `approvalStatus` — Gate 1 marker, string type, sheet index 23

### Approval guard skill

`skills/job-approval.md` — 307 lines covering:
- Gate 1 (Column X = `Approved`) check procedure
- Gate 2 (Telegram `✅ Submit` or `YES SUBMIT <COMPANY>`) with 10-min timeout
- Submit lock (15-min TTL, normalized URL key)
- Workday hostname blocker
- 5 failure states wired to Kanban + Telegram
- Evidence capture: `~/.hermes/job-hunt/evidence/{slug}/`

---

## Phase 3 readiness: YES — with conditions

**The Phase 3 apply pipeline infrastructure is ready.** Resume tailoring, cover letter drafting, and apply orchestration can begin once Emilio provides the target role + company context for each material.

### Phase 3 splits into two parallel workstreams

**Workstream A — Application Materials (resume tailoring, cover letters)**
- Can begin immediately using canonical profile docs
- Needs: target role + company for each job (from Pipeline rows or Kanban APPLY cards)
- No gates blocking material generation — it is drafting, not submitting

**Workstream B — Apply Automation (browser fill + submit guard)**
- Gate 1 (Column X = `Approved`) is a human action — Emilio must set it in the Pipeline
- Gate 2 (Telegram thread 48) is live and ready to receive confirmations
- Submit lock + Workday blocker + evidence capture are all implemented
- Blocking apply execution: waiting for Emilio's confirmation in thread 48

### Phase 3 prerequisites confirmed

| Prerequisite | Status |
|---|---|
| `job-approval.md` skill | ✅ Loaded and ready |
| Kanban task conventions updated | ✅ APPLY card example includes Gate 2 target |
| Submit lock primitive | ✅ Implemented (normalized URL, 15-min TTL) |
| Evidence capture path | ✅ `~/.hermes/job-hunt/evidence/` |
| Workday blocker | ✅ `workday.com` hostname detection in approval skill |
| Telegram Gate 2 target | ✅ `telegram:-1003800236296:48` live |
| Profile docs | ✅ All 4 canonical files read to confirm profile-aware scoring |

---

## Open blockers

None for Phase 2.

### SerpApi live key verified

A live Google Jobs query for the CrowdStrike role returned `search_metadata.status = Success` and one matching job result. The key was not printed or stored in reports.

### Phase 3 prototype started

Emilio supplied the CrowdStrike Director, Sales Enablement - Specialists role. A DRAFT card and local materials now exist; submission remains blocked until Pipeline `Approval Status = Approved` plus Gate 2 Telegram confirmation.

---

## Changed files

| File | Change |
|---|---|
| `schemas/pipeline-row.v1.json` | Added `approvalStatus` (Column X, index 23) |
| `skills/job-approval.md` | New — two-gate approval guard skill |
| `integrations/browser-use-discovery/src/discovery/directional-prompting.ts` | New — 5-lane query framework |
| `integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts` | New — 18-dim weighted scoring |
| `integrations/browser-use-discovery/src/normalize/lead-normalizer.ts` | URL normalization + dedupe |
| `integrations/browser-use-discovery/src/sheets/pipeline-writer.ts` | Idempotent write |
| `integrations/browser-use-discovery/src/sources/serpapi-google-jobs.ts` | SerpApi lane enabled |
| `.env` | `SERPAPI_API_KEY` present (64-char) |
| `job-hunt/kanban-task-conventions.md` | APPLY card example updated with Gate 2 target |
| `job-hunt/P1-synthesis-and-P2-graph.md` | Phase 2 decisions locked |
| `job-hunt/approval-guard-spec.md` | Gate 2 target updated to thread 48 |
| `job-hunt/P2-status.md` | Updated with completion markers |

---

## Approval questions for Emilio

None required for drafting. Submission is still blocked by the normal two-gate approval flow.

Open confirmations before applying:

- Confirm MEDDPICC familiarity/certification language.
- Confirm travel tolerance for possible international enablement sessions.
- Confirm whether this adjacent sales-enablement lane is worth pursuing.

---

## What to do next

1. Review the CrowdStrike draft artifacts.
2. If worth pursuing, add/confirm the role in Pipeline and keep `Approval Status` blank until ready.
3. Confirm MEDDPICC/travel language before finalizing materials.
4. Only after review: set `Approval Status = Approved` and use Gate 2 in thread 48 if you want assisted submit prep.

---

*Phase 2 synthesis complete. Phase 3 infrastructure is ready; materials can begin on your signal.*
## Phase 3 prototype — CrowdStrike

- Created DRAFT Kanban card: `t_31f1c76d`.
- Draft artifacts: `/Users/emiliong/.hermes/job-hunt/applications/crowdstrike-director-sales-enablement-specialists/`.
- No application submitted, no recruiter message sent, no approval gate requested.
