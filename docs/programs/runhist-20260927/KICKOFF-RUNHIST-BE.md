# Lane BE — measure every discovery run and keep its history

Read `KICKOFF-RUNHIST-_SHARED.md` and `SPEC-RUNHIST-20260927.md` §0–§3 first. §0 overrides this file. Your sibling right now is FE (opus, runs modal UI, workspace `RUNHIST · FE · …`); DOSSIER (grok, read-only research) may read your report. Do not touch dashboard UI.

Routing: sol · xhigh (pool X). Worktree `/Users/emilionunezgarcia/Job-Bored.worktrees/runhist-be` on `feat/runhist-be`, based on `5d5b9a59`.

Goal: every discovery run persists a measured `runStats` block and is listable from the worker, and each Sheet history row carries its Run ID, so the dashboard can show durable, truthful run history.

Success means:
- A completed run's `GET /runs/:id` carries `runStats` per the AGREED CONTRACT: funnel (searched, seen, processed, duplicates in-run and vs Sheet, rejected with top reasons, candidates, written, updated), fit aggregate (count, avg, median, min, max, scale, histogram), per-source breakdown, per-phase timeline, matcher calls, and bounded "where it searched" labels.
- New `GET /runs` lists newest-first summaries with cursor pagination; it survives a worker restart.
- Retention is 90 days / 500 runs (boot pruning), documented in `AGENT_CONTRACT.md`.
- DiscoveryRuns Sheet rows carry a Run ID column; existing tabs with the old header migrate without data loss (extend `discovery-runs-legacy.ts`); readers of the old 10-column shape keep working.
- Stats computation and persistence never throw out of a run and never change matching, writing, or timeout behavior (identical leads and writes).
- Floor green and pasted; report first line `DONE`.

Stop when: the fence is exhausted and the floor is pasted, or you are blocked.

## Phases

- **Phase 0:** verify SPEC §1 against the code yourself; find where each stat is (or is not) measured today, including fit scores and Sheet-duplicate counts; write your own recs in report §6 `BE recs (pre-align)`, including anything in SPEC §2 that is wrong or unmeasurable. Commit nothing yet.
- **Phase 1:** align with FE per the shared alignment gate; identical `AGREED CONTRACT` block in both reports. No Phase 2 before it.
- **Phase 2:** implement red-first, one logical commit per change: (a) stats accumulator + `runStats` on terminal status, (b) `GET /runs` + retention, (c) Sheet Run ID column + migration, (d) contract set (schema, example, `AGENT_CONTRACT.md`, `docs/CONTRACT-CHANGELOG.md`, `docs/INTERFACE-DISCOVERY-RUNS.md`) moved with the code.

## Fence (yours alone)

- `integrations/browser-use-discovery/src/run/**`, `src/state/run-status-store.ts`, `src/webhook/worker-router.ts`, `src/webhook/boot-recovery.ts`, `src/webhook/handle-discovery-webhook.ts` (status shaping only; the method→auth→parse→strip→preflight→status→run order stays), `src/sheets/discovery-runs-*.ts`, `src/contracts.ts`, `src/normalize/lead-normalizer.ts` (read the score out only; no scoring change)
- `integrations/browser-use-discovery/tests/**` (new + touched)
- `schemas/run-status.v1.schema.json`, `examples/run-status.v1.json`, `AGENT_CONTRACT.md`, `docs/CONTRACT-CHANGELOG.md`, `docs/INTERFACE-DISCOVERY-RUNS.md`

Do NOT touch: any root dashboard JS/CSS/HTML, `server/**`, `desktop/**`, `.github/**`, the live ports, the real `~/.jobbored`.

## Non-negotiables

- Observability only: identical leads, identical writes, identical budgets and timeouts.
- Absent means not measured (D5); never write 0 for an unmeasured stat.
- No key, token, or credentialed URL in any persisted field; `searched` holds labels only, bounded.
- Contract invariant: schema + example + docs + code in the same commit; `npm run test:contract:all` green.
- Never kill a process you didn't start.

## Definition of Done

```
npm run lint:repo
npm run typecheck:repo
npm run test:browser-use-discovery
npm run test:contract:all
node --test <any root tests you touch>
gitleaks protect --staged --redact
```

Your worker tests cover, red first: stats present and correct on a fixture run (including an empty-result run and a timeout-heavy run), fit aggregate math, `GET /runs` ordering + pagination + restart survival, 90d/500 pruning, Sheet Run ID write + legacy migration. All green, pasted in §4, first line `DONE`. Commit locally, never push.
