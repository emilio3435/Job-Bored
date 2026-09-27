# W2SQ lane D: Discovery engine

Read `.lane-evidence/KICKOFF-W2SQ-_SHARED.md` first. It is binding.

## Outcome
Goal: close BEAUDIT wave-2 lane **D** (Discovery engine) register claims in this worktree (`feat/w2sq-D`), each proven by a test that went red first.
Success means: every claim below is either fixed with a named red-then-green test, or deferred with a written reason. The floor is green. Commits are local.
Stop when: the report's first line reads `DONE`, or you are blocked twice on the same thing (`BLOCKED: <why>`).

## Claims (read each row in `.lane-evidence/ref/REGISTER.md`)
B1, B2, B3, B4, B6, B7, B8, B9, B10, B11, B12, B13, B18, C3, C4, C5, C6, C7, C10, C12, C13, C15, E3, C17, C18

Locked decisions that apply: §0.8 (see `.lane-evidence/ref/SPEC-BEAUDIT-20260925.md` §0).

## Fence (you own these; stay inside)
- integrations/browser-use-discovery/src/run/** (not run-abort.ts)
- integrations/browser-use-discovery/src/normalize/**
- integrations/browser-use-discovery/src/match/**
- integrations/browser-use-discovery/src/discovery/**
- integrations/browser-use-discovery/src/grounding/**
- integrations/browser-use-discovery/src/state/discovery-memory-store.ts, listing-score-cache.ts, run-discovery-memory-store.ts
- integrations/browser-use-discovery/src/browser/providers/**, src/browser/source-adapters.ts
- integrations/browser-use-discovery/src/sources/**
- integrations/browser-use-discovery/src/webhook/handle-ingest-url.ts (C6 and C12 only)
- server/shared/job-scraper-core.mjs, server/shared/ats-job-fetchers.mjs
- tests for these claims

## Probes to promote into tests (under `.lane-evidence/ref/probes-*`)
- B/B-frontier-saturation.mjs
- B/B-e2e-exploit-cap.mjs
- B/B-exploit-prose-bypass.mjs
- B/B-hung-llm-outlives-run-cap.mjs
- B/B-llm-calls-per-run.mjs
- B/B-memory-write-only.mjs
- B/B-provider-key-collision.mjs
- B/B-zero-lead-partial-and-optout.mjs
- B/B-allowlist-partial-unknown.mjs
- C/C-run-ats-gating.mjs
- C/C-ingest-lineage.mjs
- C/C-jobboard-hint-only.mjs
- E/probe-e-serp-sibling.mjs

## Notes from the audit plan
Memory is wired, not deleted (§0.8): a stable intent hash replaces run:<runId>, successful ATS detections write company and surface records, and exploit outcomes feed frontier priorAcceptedYield. Promote the probes to run-level tests with production-scale fixtures (C15, B19).

## Floor
Run the shared floor. Your report's section 4 must paste the tails of `npm run lint:repo`, `npm run typecheck:repo` and `npm test`, plus the worker suite and the e2e suites your claims touched.
