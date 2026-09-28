# Lane FE — beautiful, measured, expandable run history

Read `KICKOFF-RUNHIST-_SHARED.md` and `SPEC-RUNHIST-20260927.md` §0–§3 first, then `DESIGN.md`, `JB-UI.md`, `JB-A11Y.md` (repo root). §0 overrides this file. **Load the `/frontend-design` skill before designing anything.** Your sibling right now is BE (sol, worker + contract, workspace `RUNHIST · BE · …`). Do not touch worker, server, or contract files.

Routing: opus · high (seat 1, pool A). Worktree `/Users/emilionunezgarcia/Job-Bored.worktrees/runhist-fe` on `feat/runhist-fe`, based on `5d5b9a59`.

Goal: the Runs view is a durable history of every discovery run, and clicking a run expands a beautiful, calm, measured account of how it went — funnel, fit scores, per-source breakdown, timeline, and where it searched — drawn only from what the worker measured.

Success means:
- History loads from the worker's `GET /runs` (per the AGREED CONTRACT) merged with the Sheet DiscoveryRuns rows (joined by Run ID; Sheet-only rows still list with their coarse fields), newest first, deduplicated, persists across reloads, with paging or "show more".
- Clicking a run expands a detail panel (lazy-loads `GET /runs/:id`) showing: the funnel (searched → seen → processed → duplicates caught in-run and vs Sheet → rejected with top reasons → candidates → written/updated), fit scores (average, median, range, small histogram), per-source rows, a phase timeline, and the companies and queries searched (bounded, with "+N more").
- Every stat absent from the payload is omitted, never shown as 0 (D5); older runs and Sheet-only rows render a clean coarse view; worker unreachable renders the Sheet history with a quiet note, no spinner of death.
- Visual quality: deliberate, minimal, jb-v2 tokens, tabular numerals, restrained motion (reduced-motion safe), keyboard and screen-reader sane (disclosure button with `aria-expanded`, panel labelled), good at 1440 and 375 px. Screenshots saved to `.lane-evidence/`.
- Fix the dead read in `discovery-status-handoff.js:763-775` (reads `writeResult.rejectionSummary`, which the worker never sends) as part of consuming the per-source rejection data.
- Floor green and pasted; report first line `DONE`.

Stop when: the fence is exhausted and the floor is pasted, or you are blocked.

## Phases

- **Phase 0:** trace today's Runs modal (`runs-tab.js`, the modal partial, `css/runs-log.css`, the tracker's localStorage row) and verify SPEC §1; write your own recs in report §6 `FE recs (pre-align)`: what to render and in what hierarchy, the payload shape you need, empty/absent/degraded rules, the join rule with the Sheet, motion and a11y plan. Commit nothing yet.
- **Phase 1:** align with BE per the shared alignment gate; identical `AGREED CONTRACT` block in both reports. No Phase 2 before it.
- **Phase 2:** implement red-first against the agreed payload (fixtures shaped exactly like the AGREED CONTRACT example), then the visuals.

## Fence (yours alone)

- `runs-tab.js`, `partials/discovery-runs-modal.html`, `css/runs-log.css`, `discovery-run-tracker.js`, `discovery-status-handoff.js`
- new `tests/runhist-fe-*.test.mjs` (unit, jsdom/vm), plus any existing suite that pins a string or selector you changed (grep with `command grep`)
- a Playwright visual spec only under `tests/e2e-visual/` if you add one, using port 0 and `installHostIsolation`

Do NOT touch: `integrations/**`, `server/**`, `schemas/**`, `examples/**`, `AGENT_CONTRACT.md`, `index.html` script tags (ask in §5 if you need one), `desktop/**`, `.github/**`, the live ports, the real `~/.jobbored`.

## Non-negotiables

- Render only what the contract delivers (D5); no invented or estimated numbers.
- Every claim red first; no weakened test claims.
- Scope all CSS under the runs root; new styles in `css/runs-log.css`.
- Reduced-motion and a11y assertions ship with the visuals.
- Never kill a process you didn't start; never bind 8080/8644/3847.

## Definition of Done

```
npm run lint:repo
npm run typecheck:repo
node --test tests/runhist-fe-*.test.mjs tests/runs-tab.test.mjs tests/discovery-run-status-polling.test.mjs tests/run-status-honesty.test.mjs tests/gfx-uxd-fe-surfaces.test.mjs tests/index-html-size.test.mjs <every other suite pinning what you changed>
gitleaks protect --staged --redact
```

Tests cover, red first: list merge + dedupe + Run ID join, lazy detail load, each stat group rendered from fixture, absent-field omission, worker-down fallback, disclosure a11y, reduced-motion. All green, pasted in §4, first line `DONE`. Commit locally, never push.

---
Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.
