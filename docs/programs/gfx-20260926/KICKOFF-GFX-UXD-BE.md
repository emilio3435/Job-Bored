# Lane UXD-BE: instrument the discovery run so progress is observable end-to-end

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `DIAGNOSIS-disco-progress.md` (the 8m39s silent-run incident; verify its claims yourself, trust nothing)
- `SPEC.md` §0 (D1–D12)
- `LANES.md`
- `AGENT_CONTRACT.md` and `docs/CONTRACT-CHANGELOG.md` (contract invariants)

**Routing:** sol · high (pool X). You are the **independent** backend instrumentarian: the worker code is opus-written; be hardened, edge-case driven and fail-closed. No behavior change to matching, writing, or timeouts — observability only.

Your worktree is based on `feat/gfx-integration` at `dd45a692`.

**Live alongside you:** UXD-FE (opus · medium) renders live progress in the dashboard. QA-LIVE (astra · xhigh) is live on `:8080`/`:8644` with an isolated HOME — **do not message, probe, or target that session or its ports; your only sibling is UXD-FE.** Do not touch dashboard UI; that is the FE fence.

**Goal:** make the run "click" — every long phase of `runDiscovery` emits throttled, structured, queryable progress (checkpoints + log events + counters) so a dashboard can render a live run truthfully and an operator can tail one without guessing.

**Phase 0 — independent investigation + own recs (no sibling contact yet):**
1. Verify the DIAGNOSIS timeline against code: the ATS scout loop (`src/run/run-discovery.ts` ~701–862), the per-listing normalize loop (~824–847), SerpApi (~988–1085), checkpoints (352/465/920/1336), `src/run/run-abort.ts` bounds, `src/run/run-progress.ts`, the checkpoint callback in `src/webhook/handle-discovery-webhook.ts` (~229–246), and the run-status store write path + cost.
2. Write your OWN recs in your report (new §6 `BE recs (pre-align)`): per-company scout checkpoints + logs, throttled per-N-listings progress (counts, matcher calls, elapsed), SerpApi per-query checkpoints, any phase-checkpoint gaps, throttle bounds (count AND time, measured not guessed), and the exact additive `progress` payload extension you propose. Commit nothing yet.

**Phase 1 — consult UXD-FE via cmux, then align (strict gate):**
3. Find the UXD-FE lane session with the cmux CLI and exchange recs. Iterate until you agree on ONE shared progress contract: exact `progress` payload fields (additive on `DiscoveryRunProgress`), semantics of each counter, staleness/heartbeat rules, and what "no data" means.
4. Paste the identical `AGREED CONTRACT` block (fields + one example payload) into your report §6 and confirm UXD-FE's report holds the same bytes. **No Phase 2 before this.** If the sibling is unreachable after 3 tries spaced ≥10 min apart, first line `BLOCKED-ON-ALIGN`, leave your proposal in §6, and stop.

**Phase 2 — implement on the agreed contract (each item red first, tests named):**
5. **Scout instrumentation.** Per-company checkpoints + structured log events at detect/list boundaries; throttled progress inside the normalize loop (every N listings or M seconds, whichever first — measure store-write cost and keep the hot loop fast); matcher timeout/fallback keeps current behavior, only better evidenced.
6. **Lane + phase coverage.** SerpApi per-query checkpoints (logs exist; add checkpoints); verify score/exploit/learn/write checkpoints fire on all paths including empty-result and timeout-heavy runs; no checkpoint may throw out of the run (fail-closed, warn-and-continue).
7. **Payload + contract.** Extend the `GET /runs/:id` progress payload exactly as agreed, additively and backward compatible. If any contract shape moves, move schema + fixtures + docs + code together per the contract invariant, and keep `npm run test:contract:all` green.
8. **Log hygiene.** No key/secret/token material in any new event; board URLs pass through existing redaction; bounded cardinality (no per-URL unbounded series — aggregate).

**Floor:** paste all of this in §4. Run from your worktree with an isolated HOME; never bind 8080/8644/3847; never touch the real `~/.jobbored`.
- `npm run lint:repo`
- `npm run typecheck:repo`
- `npm run test:browser-use-discovery`
- `npm run test:contract:all` (required: you touch the progress payload)
- `node --test` on any root `tests/gfx-uxd-be-*.test.mjs` you add, plus any suite pinning behavior you touched
- `gitleaks protect --staged --redact`

**Report:** first line `DONE` or `BLOCKED: <why>` (+ `BLOCKED-ON-ALIGN` state above).

**Stop when:** the fence is exhausted, the floor is pasted, the report's first line is `DONE`, `AGREED CONTRACT` matches UXD-FE's, and your commits are on your branch.

## Fence

- `integrations/browser-use-discovery/src/run/**`, `src/sources/serpapi-google-jobs.ts` (additive), `src/webhook/**` (status shaping only — the method→auth→parse→strip→preflight→status→run invariant stays)
- `integrations/browser-use-discovery/tests/**` (new + touched), root `tests/gfx-uxd-be-*.test.mjs` if needed
- `schemas/**`, `examples/**`, `AGENT_CONTRACT.md`, `docs/CONTRACT-CHANGELOG.md` — only if the payload shape moves, and then all together

**Do NOT touch:**
- dashboard UI (`discovery-*.js`, `runs-tab.js`, `css/**`, `index.html`) (UXD-FE)
- `desktop/**`, `server/**` (scraper/ATS API untouched), docs outside the contract set, `.github/**`
- matching/writing/timeout behavior, the live ports, the real `~/.jobbored`, `~/Library/LaunchAgents`, the QA-LIVE session

## Non-negotiables

- Observability only: identical leads, identical writes, identical lane budgets.
- Every claim red first; no weakened test claims.
- Checkpoints never fail the run; logging never leaks secrets.
- Contract invariant: schema + fixtures + docs + code in the same commit.
- Never kill a process you didn't start.

## Definition of Done

A 500-listing scout emits company + throttled listing progress consumable from `GET /runs/:id` per the agreed contract; all phase checkpoints fire on empty/timeout-heavy paths; floor pasted in §4; first line `DONE`. Local commits.
