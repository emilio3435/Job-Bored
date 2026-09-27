# W2SQ lane B: Browser surfaces

Read `.lane-evidence/KICKOFF-W2SQ-_SHARED.md` first. It is binding.

## Outcome
Goal: close BEAUDIT wave-2 lane **B** (Browser surfaces) register claims in this worktree (`feat/w2sq-B`), each proven by a test that went red first.
Success means: every claim below is either fixed with a named red-then-green test, or deferred with a written reason. The floor is green. Commits are local.
Stop when: the report's first line reads `DONE`, or you are blocked twice on the same thing (`BLOCKED: <why>`).

## Claims (read each row in `.lane-evidence/ref/REGISTER.md`)
E4, D11

Locked decisions that apply: §0.4 (see `.lane-evidence/ref/SPEC-BEAUDIT-20260925.md` §0).

## Fence (you own these; stay inside)
- hosted-api-auth.js, app-config-core.js
- the browser fetch sites that call the API (one apiFetch helper)
- submission-flow.js, sheets-writeback.js, pipeline-transitions.js, flowing-writes.js
- tests/ and tests/e2e-* for these claims

## Probes to promote into tests (under `.lane-evidence/ref/probes-*`)
- E/probe-e-hosted.sh
- D/p13-browser-writer-divergence.mjs

## Notes from the audit plan
Every API call goes through one apiFetch() that attaches the hosted token; the Applied flow writes its evidence through planTransition and pipeline-update v2.

## Additions to B (orchestrator)
- Error codes: lane E is unifying API error-code casing to lowercase snake_case. When your browser code matches on a code, match the lowercase form. If you add a shared `apiFetch`, make its error surface expose `code` unchanged.

## Floor
Run the shared floor. Your report's section 4 must paste the tails of `npm run lint:repo`, `npm run typecheck:repo` and `npm test`, plus the worker suite and the e2e suites your claims touched.
