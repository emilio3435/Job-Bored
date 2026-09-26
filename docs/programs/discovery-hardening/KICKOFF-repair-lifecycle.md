# Repair lane C — MAJOR-2 and MINOR-3 from the integrated QA review (LIFECYCLE-1)

Read `docs/programs/discovery-hardening/GROUND-RULES.md`, then `.lane-evidence/qa-report.md` §MAJOR-2 and §MINOR-3. You are a FRESH lane on branch `feat/discovery-hardening-lifecycle` (HEAD `88e156b`). Same fence as Lane C: `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts`, `integrations/browser-use-discovery/tests/webhook/**`, `tests/discovery-lifecycle.test.mjs`.

**Goal:** Make the idempotency suite's narrative true and pin the failed-run redelivery shape.

**Success means:**
1. MAJOR-2: the header comment of `integrations/browser-use-discovery/tests/webhook/lifecycle-idempotency.test.ts:1-10` (and any test name or comment that says the same) states what the guard actually catches — a byte-identical redelivery of the same payload (at-least-once relay/proxy retry, manual+scheduled collision on an identical body) — and states plainly that a user re-click is NOT deduped because every dispatch path stamps a fresh `requestedAt` (`discovery-payload.js:293,372,390`, `discovery-wizard-verify.js:671`). Add one test that PROVES the re-click case starts a second run (two POSTs differing only in `requestedAt` → two runIds, two runs), so the limitation is pinned, not just described. Also fix the production comment at `handle-discovery-webhook.ts:~1364-1366` if it contradicts.
2. MINOR-3: add one test that pins the current behavior for a redelivery of a run that FAILED: first delivery → 500 `{ok:false}`, redelivery → 200 `{ok:true, kind:"completed_sync", outcome.status:"failed"}` with the same runId, no second run, no second DiscoveryRuns row. Name it so the wart is visible (e.g. `LIFECYCLE-1: a redelivery of a failed run replays its terminal outcome as completed_sync (contract has no failed-ack kind — see QA MINOR-3)`). Do NOT change the ack contract (LD-3). QA's probe `.lane-evidence/qa/qa-lifecycle-failed-redelivery.probe.ts` is the template.

**First action:** create `LANE-REPORT-repair-lifecycle.md` (five PENDING headings).

**Gate:** `npm run test:browser-use-discovery`, `npm run typecheck:browser-use-discovery`, `npm run test:contract:all`, then the full floor. ONE local commit `test(discovery-hardening/lifecycle): …`, SHA in the report. Never push.
