# DISCAT — discovery candidate catalog, yield steering, rejection learning

Program: DISCAT · opened 2026-09-27 00:20 CT · orchestrator: Opus (seat 1)
Integration branch: `feat/discovery-candidate-catalog` (from main 5d5b9a59)
Integration worktree: `~/Job-Bored.worktrees/discat`
Evidence: `project_jobbored_discovery_candidate_drop.md` (run_09ec4fb1: 1994 seen → 1665 filtered → 324 → 105 deduped → 15 written; 90 qualified leads discarded by the cap).

## Goal
Discovery keeps and uses everything it sees: every unique listing is catalogued with its fate; qualified overflow is reused; past yield steers which boards get read; rejections and near-misses feed learning and are visible to the user.

## Success means
- C1 (commit 1): after a run, `candidate_catalog` holds one row per unique listing seen (rejected, deduped, capped, written), and `listing_fingerprints` is populated. Capped qualified leads are `backlog`; the next run fills unused write slots from fresh backlog before new leads. Catalog is bounded (retention).
- C2 (commit 2): ATS company order uses prior yield; zero-yield boards cool down with an exploration slot; the same (source, board) is listed at most once per run.
- C3 (commit 3): headline near-misses increment `role_families.near_miss_count`; per-run filter stats (which exclude keywords / title mismatches removed how many) are persisted and served; the dashboard shows a one-line hint when one filter removes a large share.
- Floor green after each commit: `npm run typecheck:browser-use-discovery`, `node scripts/run-tests.mjs integrations/browser-use-discovery/tests` (baseline 985/985), root `npm test`, plus the Playwright smoke suite if commit 3 touches frontend.

## Stop when
Three commits on the integration branch, floor green on the tip, Sol verification report in, gitleaks clean, and PR/ultrareview commands printed for Emilio. Never push.

## §0 locked decisions (orchestrator defaults 2026-09-27; Emilio may overrule)
| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Where the catalog lives | Worker SQLite (`worker-state.sqlite`), new table `candidate_catalog`; keyed on the existing `computeListingFingerprint` primary key. No new Sheets tab. | 2k rows/run would flood the sheet; the memory store already owns cross-run state. |
| D2 | Catalog statuses | `rejected` (with reason + detail), `duplicate`, `backlog` (qualified, capped), `written`, `promoted` (backlog later written), `expired`. | Every drop point in the funnel gets a named fate. |
| D3 | Backlog reuse | Next run: after its own selection, fill remaining `maxLeadsPerRun` slots from backlog rows ≤14 days old, same sheet, not already written, highest score first. | "Using them" without raising the cap. |
| D4 | Retention | Prune rows whose `last_seen_at` is >90 days, hard cap 50k rows (oldest first), at run end. | Bounded disk. |
| D5 | Read surface | `GET /candidates?status=&limit=` on the worker, same auth as other worker GETs. | Lets the dashboard / Emilio inspect it; no UI in C1. |
| D6 | Yield steering (C2) | Order ATS companies by written/seen yield from `intent_coverage` (unknown = prior of 0.5 × mean known yield, fallback constant when no history; amended 00:58 after Sol review, since a flat 0.5 would outrank every proven board at real yields ≈0.01). Cooldown: ≥2 runs, ≥150 listings seen, 0 written → skip 7 days; always keep 1 cooled company per run as an exploration slot. | Stop re-reading Scale AI every run without freezing the list. |
| D7 | Board de-dup (C2) | Dedupe ATS list calls by (sourceId, board token) before fetching; log `ats_board_duplicate_skipped`. | Scale AI was listed ~5× in one run. |
| D8 | Near-miss learning (C3) | A `headline_mismatch` whose title shares a role-family base with the target roles counts as a near miss; no auto-widening of filters. | Learn signal without silently loosening filters. |
| D9 | Filter hint (C3) | Persist per-run filter stats; hint when one exclude keyword removes ≥25% of seen listings. Copy states the fact and the keyword; no auto-change. | User decides. |
| D10 | Out of scope | AI-matcher call cap (`job-matcher.ts:282`), `maxLeadsPerRun` value, company-planner target choice. | Noted as follow-ups; adversarial investigation may re-rank. |

## Lanes and model mix
| Domain | Family | Locked id | Bucket used% | Why |
|---|---|---|---|---|
| C1 catalog (backend, substrate) | opus (in-session subagent) | claude-opus-5-5 | Claude seat 1: unknown (Ant Hill down) | Emilio routed builds to inline Opus subagents |
| C2 yield steering | opus (in-session subagent) | claude-opus-5-5 | same | same |
| C3 rejection learning + hint | opus (in-session subagent) | claude-opus-5-5 | same | same |
| Verify C1–C3 | sol (cmux, headless) | gpt-6-sol | Codex weekly 11% (05:15Z) | Writer family never verifies; Muse off per Emilio 2026-09-25 |
| Investigation I1–I3 | bench/Luna max (cmux, headless, read-only) | gpt-6-luna | Codex weekly 11% | Emilio routed |
| Adversarial synthesis | astra (cmux, headless, read-only) | gpt-6-astra | Codex weekly 11% | Emilio routed |

Effort note: Emilio asked for Opus at medium; the Agent tool has no per-call effort and no medium-pinned general agent exists, so builders run at the session's effort.

Sequencing: C1 lands alone (substrate). C2 and C3 build in parallel worktrees off C1, then the orchestrator cherry-picks C2 then C3 onto the integration branch, re-running the floor after each.
