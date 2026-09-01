# Discovery hardening — integration log

Orchestrator: Fable 5.1 (claude-fable-5-1), session 019LLXuxWfWVGz8sjH8ct9bL.
Integration worktree: `/private/tmp/Job-Bored-discovery-hardening-integration`
Integration branch: `feat/discovery-hardening`
Base SHA: `81e313ac8aa72345b2930aa4233f3d11ce09f221` (main, 2026-09-01)

## Unrelated user changes preserved in the main checkout (not on any lane)

- `M integrations/hermes-job-hunt/resume-template/logos.json`
- untracked: `.worktrees/`, `DOSSIER_RENDERER_INSPECTION_REPORT.md`, `diagrams/`, `docs/audits/`, `docs/cleanup/`, `docs/superpowers/plans/2026-08-31-dossier-render-resilience.md`, `docs/superpowers/specs/2026-08-31-dossier-render-resilience-design.md`, `docs/swarm/PROMPT-discovery-hardening-fable51-opus5.md`

## Lane process evidence (`ps -o args= -p <pid>`)

| Lane | cmux ws | pid | ps args (model/effort/mode) | binary | cwd |
|---|---|---|---|---|---|
| scout-browser | workspace:192 | 71039 | `--model opus --effort high --permission-mode auto` | `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.257` | integration worktree |
| qa | workspace:199 | 63777 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-qa` (cut from `a116683`) |
| repair-assets | workspace:200 | 1578 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | assets worktree (QA MINOR-4) |
| repair-lifecycle | workspace:201 | 1640 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | lifecycle worktree (QA MAJOR-2, MINOR-3) |
| repair-stable-transport | workspace:202 | 1905 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | stable-transport worktree (QA MAJOR-1) |
| repair-canary | workspace:203 | 2162 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | canary worktree (QA MINOR-6/7/8) |
| scout-worker | workspace:193 | 71067 | `--model opus --effort high --permission-mode auto` | `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.257` | integration worktree |
| assets | workspace:194 | 57753 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-assets` |
| scrape-e2e | workspace:195 | 57826 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-scrape-e2e` |
| lifecycle | workspace:196 | 58182 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-lifecycle` |
| stable-transport | workspace:197 | 58331 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-stable-transport` |
| canary | workspace:198 | 58641 | `--model opus --effort high --permission-mode auto` | `~/.local/share/claude/versions/2.1.257` | `/private/tmp/Job-Bored-discovery-hardening-canary` |

Lock SHA (spec + kickoffs, base of every lane branch): `d57fdac7afddb8dc2259c7ed4b5743e456013471`. Lanes spawned 2026-09-01 ~15:37 MT.
Note: the cmux wrapper places `--session-id`/`--settings` before the user flags, so verification scans the full arg vector (`ps -o args= -p <pid> | tr ' ' '\n' | grep -A1 ...`), not a literal `claude --model opus` match.


## Merge ledger

| # | Lane | Lane SHA | Merge SHA | Targeted gate result | Notes |
|---|---|---|---|---|---|
| 1 | A · assets | `872445e` | `d6b9799` | pages-deploy-contract + hermetic-release-gate 23/23 after merge; lane worktree: 33/33 targeted, typecheck, lint, test:repo, diff --check | clean merge |
| 2 | B · scrape-e2e | `129d0be` | `f92b3b8` | lane worktree: e2e-journey 9/9, e2e-smoke 6/6, floor green; journey+smoke re-run on the integrated HEAD in the final floor | clean merge |
| 3 | C · lifecycle | `88e156b` | `66bebe2` | worker suite 744/744 + discovery-lifecycle 5/5 after merge; lane worktree: worker typecheck, contract:all, floor green | clean merge; `src/server.ts` untouched (no wiring needed) |
| 4 | D · stable-transport | `dfbad73` | `70b966d` | 5-file targeted 65/65 after merge; lane worktree: 11-file gate 141/141, both scout probes green, floor green | clean merge; `tests/run-status-honesty.test.mjs` untouched |
| 5 | E · canary | `f35074f` | `76e04c5` | discovery-canary 20/20 + run-status-store 16/16 after merge; lane worktree: CLI exit codes, floor green | clean merge |
| 7 | repair D | `0d595b2` | `d141564` | 4-file gate 65/65; mutation of the early-return → 3 red; npm test green | QA MAJOR-1 closed |
| 8 | repair E | `852eea6` | `2726e6c` | discovery-canary 24/24; `--bogus-flag` → only `unknown_argument`; healthy fixture exit 0; npm test green | QA MINOR-6/7/8 closed; JSON report gained `worker.checked` + `runHistory` |
| 9 | repair A | `9a5fed2` | `bd19594` | 4-suite gate 39/39; real `_site` build passes guard, drifted app.js named; npm test green | QA MINOR-4 closed |
| 10 | repair C | `64490f2` | `a523663` | worker 746/746; comment-only production change; contract:all; npm test green; mutations bite | QA MAJOR-2 narrative corrected + re-click limitation pinned; MINOR-3 pinned as-is |
| 6 | integrator | — | `a7dcc4c` | — | Lane D handoff: `node --check discovery-run-tracker.js` added to `typecheck:repo` (package.json was Lane E's fence, lane closed). Lane A handoff: `index.assembled.html` added to `.gitignore`. |

## Floor runs

### Baseline on base `81e313a` (+docs commit `8f79235`), run by Fable 2026-09-01 ~15:10 MT

| Gate | Result |
|---|---|
| `npm run typecheck:repo` | green |
| `npm run lint:repo` | green |
| `npm run test:contract:all` | green |
| `npm test` (root, run-tests.mjs) | 2515 tests · 2514 pass · 0 fail · 1 todo (`tests/submission-record-audit.test.mjs` "persists and can remove the canonical submission evidence record" is marked todo "blocked on the canonical-ownership gate" and prints a diff, but does not fail) · exit 0 |
| `npm run test:browser-use-discovery` | 727 pass · 0 fail · 0 skipped |
| `npm run test:e2e-smoke` | 6 passed |
| `npm run test:e2e-journey` | 7 passed |
| `git diff --check` | clean |


### Integrated floor on `a116683` (all five lanes + integrator commit + archived reports), run by Fable 2026-09-01 16:33–16:35 MT

| Gate | Result |
|---|---|
| `npm test -- tests/pages-deploy-contract.test.mjs` | 12/12 |
| `npm run test:e2e-journey` | 9 passed (7 existing + 2 `SCRAPE-E2E-1:`) in 16.8s |
| `npm run test:e2e-smoke` | 6 passed |
| `npm run test:browser-use-discovery` | 747 pass · 0 fail · 0 skipped (727 base + 17 lifecycle-idempotency + 3 run-status-store lister) |
| `npm run test:contract:all` | all OK, no schema/contract file changed |
| `npm run typecheck:repo` | green (now includes `node --check discovery-run-tracker.js` and `scripts/discovery-canary.mjs`) |
| `npm run lint:repo` | green |
| `npm run test:repo` | root 2542 tests · 2541 pass · 0 fail · 1 pre-existing todo; worker 747/747 · exit 0 |
| `npm test` (run-tests.mjs, includes `tests/integration/`) | 2573 tests · 2572 pass · 0 fail · 0 skipped · 1 pre-existing todo · exit 0 |
| `git diff --check` | clean |
| Canary CLI, lane fixtures, fixture `/health` on 127.0.0.1:18646 | healthy → exit 0 (`worker_healthy`,`successful_run_fresh`); stale (101h-old run) → exit 1; stale (no run) → exit 1 (`no_successful_run`); unavailable (refused port) → exit 2; misconfigured (foreign service on port) → exit 3; JSON output grep for `ya29|authorization|x-discovery-secret|sheetId` → 0 hits |

Skipped: nothing. Environmental limitation: none — every command ran on this machine. Test-count deltas vs baseline: root +27 (10 ASSET-1, 5 LIFECYCLE-1 statusPath, 8 STABLE-1, 15 LIFECYCLE-1 poller, 20 CANARY-1, minus the 31 in `tests/integration/` that only `npm test` counts → see the `npm test` row: +58 total), worker +20, journey +2.

## QA adjudication (Fable, 2026-09-01 16:58 MT)

QA (`reports/qa.md`): no BLOCKER, 2 MAJOR, 10 MINOR; every claim met; floor re-run green by QA; no skipped or weakened tests; secrets clean.

| Finding | Disposition |
|---|---|
| MAJOR-1 loop-level coverage hole for `statusEndpointTerminal` (mutation-proven) | Repair lane D: loop-level test with injected timers, RED proven by mutation |
| MAJOR-2 idempotency suite narrative claims the re-click case | Repair lane C: correct narrative, pin the limitation with a test |
| MINOR-3 failed-run redelivery acks 200 `completed_sync` | Repair lane C: pin current behavior with a named test; contract change deferred to Emilio |
| MINOR-4 stamper/guard blind to single quotes and script/style preloads | Repair lane A: accept both quote styles, stamp+verify script/style preloads, fail loud |
| MINOR-5 pre-existing journey flake at `critical-journey.spec.mjs:265` | Record; pre-existing, not touched by the program; watch in CI |
| MINOR-6 argument-error canary report fabricates reasons | Repair lane E |
| MINOR-7 doc lists a reason never emitted | Repair lane E |
| MINOR-8 exit 4 untested | Repair lane E: extract `runCli`, test the internal-error path |
| MINOR-9 old webhook suite pins runId via `runDependencies.runId` | Record; sanctioned by LD-3(e), coverage rests on `lifecycle-idempotency.test.ts` |
| MINOR-10 drawer 422 "Fallback:" sentence is noise; `role=alert` set after text | Record; product copy outside every fence → Emilio follow-up |
| MINOR-11 retryable set is a superset (400/422/501 retry) | Record; deliberate fail-open, bounded |
| MINOR-12 duplicate `.gitignore` line (pre-existing) | Record |
