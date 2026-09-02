# The Case — Polish Pass Plan

**Spec:** `docs/superpowers/specs/2026-09-02-case-polish-design.md`
**Branch:** `feat/case-polish` from `origin/main`. Lanes branch from it as `feat/polish-<n>`.
**Shape:** three lanes, split strictly by file so they cannot collide. Test-first per item. Commit locally, never push.

## Lane split (fences are absolute)

| Lane | Model | Owns | Items |
|---|---|---|---|
| **P1 model-truth** | Opus 5 | `role-case-model.js`, `materials-state.js`, `tests/role-case-model.test.mjs`, `tests/ats-scorecard-persistence.test.mjs` | P0-A (scorecard key collapses query-string URLs), P0-D (corrupt store wipes 100 entries; comparator throw flips success to error), P0-E (six silent catches), P0-0 (requirement matching), P0-0c (`scoreOf` null), P0-0d (local-day counts), P0-7 (no invented severity), P0-8 (overdue stays due), P0-10 (properly-cased strengths) |
| **P2 wiring-truth** | Opus 5 | `role.js`, `role-materials.js` (incl. P1-0e error styling hook), `tests/role-case-interactions.test.mjs`, `tests/role-field-edit-render-guard.test.mjs`, `tests/role-materials.test.mjs`, `tests/role-materials-manifest-events.test.mjs` | P0-1 (Enter on chips), P0-2 (focus restore across re-render), P0-3 (optimistic `aria-pressed`), P0-0b (cross-role materials leak), P0-4 (phase words, retry above 1), P2-5 (`couldn't finish` + retry/dismiss), P2-6 (empty-state invitation) |
| **P3 surface-truth** | Opus 5 | `role-case.js`, `role-case.css`, | P0-B (stale closes pill beside "Posting open"), `tests/role-case-render.test.mjs`, new `tests/role-case-a11y.test.mjs`, `tests/dossier-provenance-labels.test.mjs` | P0-5 (materials caption), P0-6 (reply tile hides), P0-9 (`You have` hides), P0-11 (terminal label), P1-0…P1-0g (gutter, numbers-band tracks, mint + mute contrast, dead rules, hover/focus states), P1-1…P1-6 (headings, stepper semantics, chip status text, provenance `aria-hidden`, focus rings, hit targets), P2-2 (`unverified`), P2-3 (`Resume score`, conditional crimson), P2-7 (source-tag words) |

Deferred to a follow-up (touch shared contracts, not worth the risk in one pass): P0-0's analyzer-side vocabulary, P1-7 (persistent live region), P2-1 (`nextAction` stage awareness — needs a new model→strip argument), P2-4/P2-8/P2-9 (doc taxonomy, one name for profile match, record vocabulary).

## Non-negotiables (all lanes)

1. **Test-first.** Each item: a failing test naming the real input, then the fix. No assertion is ever weakened — if a fixture encoded the bug, fix the fixture and say so.
2. **The UTC trap (P1).** Both existing suites pin `NOW = 2026-09-01T12:00:00Z`, which cancels the off-by-one out. New cases must use a *local* evening time west of UTC to prove the fix.
3. **The harness trap (P2).** The interactions harness drives everything with `.click()` and has no key handling — that is why P0-1 shipped. Add real `keydown` dispatch to the stub before testing Enter.
4. **Cascade trap (P3).** Single-class CSS rules lose to `body.jb-v2 h3/p`. Every new rule scoped under `body.jb-v2 [data-region="role"] .case`. `node tools/lint-tokens.mjs --quiet` → 0 findings; raw hex only inside custom-property definitions.
5. **Frozen:** every `data-action` value, every `jb:*` event name/shape, `renderCompact` in `recruiter-strip.js`, Sheet Interface A.
6. Report first: `LANE-REPORT-P<n>.md` with the five headings, filled as work lands.

## Floor (each lane, pasted into its report)

```bash
npm test && npm run lint:js && npm run test:contract:all && npm run typecheck:server
npm run smoke:jb-v2 && node tools/lint-tokens.mjs --quiet
npm run test:e2e-smoke && npm run test:e2e-journey
```

## Fourth lane if time allows

**P4 posting-salary** (`server/shared/job-scraper-core.mjs`, `tests/job-scraper-block-text.test.mjs`): P0-C — From/Up to prefixes, nested + JobPosting-level currency, WEEK/DAY units. Independent of the other three; server-side only.

## Integration

Orchestrator runs the full floor per lane before merging, merges P1 → P2 → P3, re-runs the floor after each, then opens the PR. Nothing pushes without Emilio's word.
