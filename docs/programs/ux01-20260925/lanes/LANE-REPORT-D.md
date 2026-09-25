# UX01 lane D: Board & Apply

Branch `feat/ux01-board-apply`, cut from `feat/ux-zero-to-one` at cca3e30. Built by Opus 5.5 on 2026-09-25. Not pushed.

## What changed for the user

- **Moves stick.** Every stage move goes through one planner: board drag, the "Move to stage" menu, the dossier stepper and Today. The Sheet row and the app update together, and the card lands in its new column. Each move shows "Moved <role> to <Stage>" with an **Undo** button.
- **A failed move says so.** If the Sheet refuses a move, the card goes back to its column with correct counts. A message names the stage it stayed in and offers **Retry**. Cancelling the Applied dialog now says "Kept in <stage>", not "write failed".
- **Applied saves what you typed.** The Applied date, follow-up date, source and receipt all reach the Sheet; the source and receipt are written to Notes. The write happens as soon as you confirm, with no 10-second hold that a closed tab could lose. The dialog asks "Did you apply to <Company>?", and the confirmation names the role and offers Undo.
- **Dragging a card no longer opens its dossier.**
- **The stage menu opens above everything.** It draws in the browser's top layer, so the next card can't cover it. Every item can be clicked or tapped.
- **The whole pipeline is visible.** Every stage that holds a role is open, and several can be open at once. An empty stage rests as a thin rail.
- **The board works on a phone.** Below 760 px the board is a grouped list with full-width cards, and a Board/List toggle that each device remembers.
- **Cards are shorter.** A card at rest shows company, role, fit, one line of facts and the salary. The note and the recruiter strip appear when you select it. Touch targets are at least 44 px on touch screens.
- **Keyboard and screen-reader users get real controls.** The role title is a real "Open dossier: <role> at <company>" button. A focused card shows a focus ring, and cards are no longer dimmed.
- **Adding a job from a URL can't dead-end.** If no ingest worker is connected, it times out, or the network fails, the manual form opens with the URL filled in and appends the row straight to the Sheet. The URL dialog also has an "Add manually" button and no longer names Gemini.

## Change status

| id | status | notes |
|---|---|---|
| C5 (lane D part) | done | FD-01: a worker or network failure opens `JobBoredIngest.openManual` prefilled, and the row is written directly to the Sheet. FD-02: "Add manually" in the URL dialog. FD-22: provider-neutral copy, no "Manual add" eyebrow, spinner hidden on error. Lane C owns the top-bar "Add job" and the empty states (FD-03, TR-22, MP-06). |
| C15 | partial | TR-06 = TA-04 done: date, follow-up, source and receipt all written. TA-19 done: immediate write with Undo. AX-03 done: a cancel resolves `cancelled` and the menu says "Move cancelled; still in <stage>". **TA-21 not done** (preselecting the sent resume and letter): it needs the materials manifest (lane E) and was cut for time. |
| C16 (lane D part) | done | `JobBoredSubmission.confirmApplied({dataIndex, prefill:{source, date}})`. Lane E renders the return-from-posting prompt. |
| C17 | done, 2 partial | Done: TR-01, 02, 03, 04, 05, 07, 10, 25, AX-02, 04, 10, 13, 14. **TR-11 partial:** moves are unified, but the dossier's terminal chip (role-case.js:200, lane E) is untouched. **SS-07 partial:** a failed board move names the stage and offers Retry, but `sheets-writeback.js` still shows its own generic "Update failed" toast (lane F). |
| C19 | done, 1 partial | Done: TR-08, TR-09, TR-16 (via compact cards), AX-01, AX-19 (board controls), MP-09. **TR-17 partial:** resting cards hide the recruiter strip in CSS. Collapsing its "Unknown ×4" facts and binding the hard-coded stage dot belong in `recruiter-strip.js` (lane C). |

## Files touched

- Owned: `pipeline.js`, `pipeline.css`, `pipeline-render.js`, `pipeline-controller.js`, `pipeline-transitions.js`, `pipeline-transition-adapter.js`, `flowing-writes.js`, `submission-flow.js`, `jb-a11y.js`, `jb-a11y.css`, `ingest-url-flow.js`.
- Tests (new): `tests/ux01-board-apply.test.mjs` (17 unit probes, all red before the change) and `tests/e2e-smoke/board-apply.spec.mjs` (4 browser checks).
- Tests (updated to the new behaviour): `tests/pipeline-transition-adapter.test.mjs`, `tests/submission-confirm-gate.test.mjs`, `tests/pipeline-filter-controls.test.mjs`, `tests/pipeline-collapse-scroll.test.mjs`, `tests/e2e-journey/critical-journey.spec.mjs`. The journey now clicks "Expand Discovered" only if the rail is still collapsed; C19 opens a non-empty Discovered column on its own.
- `partials/ingest-manual-modal.html` was not changed. `stage-registry.js` was not changed.

## Contracts touched

- **`data-action`:** `move-to-stage`, `add-job-url` and `stage-step` keep their names. New attributes: `data-card-action="open"` (the card-title button), `data-pipeline-view`, `data-pipeline-url-manual`. The legacy `stage-step` binding now matches only buttons that carry `data-index` (TR-25).
- **`data-stable-key`:** stays on the `.pipe-sticker` article. The article lost `role="button"` and `tabindex="0"`, and its focus target is now `.pipe-sticker__open`.
- **PIPELINE-CARDS-HANDOFF selectors:** `.pipe-sticker`, `.pipe-col[data-stage]` and `.pipe-col__toggle` are unchanged. `.pipe-board` no longer has `role="list"` (AX-14), and columns stay named regions ("Discovered column").
- **`updateJobStatus(dataIndex, stage)`:** signature unchanged and not edited. `confirmApplied` now calls it only when no planner row can be resolved (no adapter host).
- **`schemas/pipeline-row.v1.json`:** unchanged. Writes use only the existing columns M, N, O and P, plus the rollback of the same cells.
- **`jb:write:succeeded {kind:"pipeline:move"}`:** the transition adapter is a new emitter. Payload: `{jobKey, kind, fromStage, toStage, status, source}`; an Undo also sends `undo:true`. This means a board move from Discovered to Researching now reaches role-materials' auto-draft trigger, the same way `updateJobStatus` moves always did.
- **`jb:write:failed` reasons:** `cancelled`, `undone` and `write_failed` are the ones the board reads.
- **`expandedJobKeys`:** not touched.
- **localStorage:** new keys `jb_pipelineColumns.v2` (explicit open/closed choice per stage) and `jb_pipelineView` (`board` or `list`). The old `jb_pipelineCollapsedColumns` is no longer read, on purpose: it stored the old Researching-only layout.

## APIs added (for other lanes)

```js
// ingest-url-flow.js — lane C (top-bar "Add job", empty states), lane B (C10 capture)
window.JobBoredIngest.openManual({ url, title, company, location, message?, direct? }) // -> boolean (false when the modal is absent)
window.JobBoredIngest.isTransportFailure(err)                                           // -> boolean

// submission-flow.js — lane E (C16 "Did you apply to <company>?" prompt)
window.JobBoredSubmission.confirmApplied({ dataIndex, fromStage?, prefill: { source?, date?, followUpDate?, receiptNote? } })
//   -> Promise<{ confirmed, cancelled?, evidence, result?, code? }>
// The original confirmApplied(jobKey, ctx) shape still works.

// pipeline-transition-adapter.js — any surface that moves a role
window.JobBoredPipelineTransitionAdapter.move({ jobKey, fromStage, toStage, note?, confirmation?, announce?, handOff? })
//   success result carries undo(); an Applied move with no confirmation opens the dialog and resolves { ok:false, cancelled:true } on cancel.

// pipeline-controller.js
window.JobBoredApp.pipelineController.applyPipelineCellPatches(dataIndex, patches) // mirrors M/N/O/P/R/W cells into pipelineData, then re-renders
```

## Baselines refreshed

None. The visual suite asserts geometry, not screenshots, and it passed without changes. No snapshot moved.

## Handoffs

| to | file | change |
|---|---|---|
| Lane C | `recruiter-strip.js` | TR-17: collapse to one "Next action" line when every fact is unknown, and bind `<jb-stage-dot>` to the card's `data-stage` (it is hard-coded to `applied`). TR-16: relative follow-up dates and `data-flag="overdue"`. |
| Lane C | top bar and empty states | Call `JobBoredIngest.openManual({})`, feature-detected. |
| Lane E | `role-case.js` | C16 prompt: call `confirmApplied({dataIndex, prefill:{source: row.source, date: today}})` on `visibilitychange` after View posting. TR-11: make Rejected, Passed and Expired reachable from the terminal chip. TA-21: record the sent materials. |
| Lane F | `sheets-writeback.js` | SS-07: `updateMultipleCells` shows its own "Update failed" toast next to the board's named Retry toast. Suppress it for planner writes (`applyCells`), or add the role name and Retry. The legacy `updateJobStatus` still drops typed Applied evidence; only the no-adapter fallback reaches it. |
| Lane A | `index.html` head | Bump the `?v=` cache busters for `pipeline.js`, `pipeline.css`, `pipeline-transitions.js`, `pipeline-transition-adapter.js`, `submission-flow.js`, `flowing-writes.js`, `jb-a11y.js`, `jb-a11y.css` and `ingest-url-flow.js`. Delete `mark-submitted.js` in C4; nothing calls it now. Once the lane A kit exists, move the board chips and buttons onto `.jb-btn`/`.jb-chip`. This lane used only existing tokens and added no colour literals. |

## Verification

- 17 unit probes in `tests/ux01-board-apply.test.mjs` were red before any implementation: 0 pass, 17 fail on cca3e30 plus the new test file. They are green now.
- **Unverified:** the 4 browser checks in `tests/e2e-smoke/board-apply.spec.mjs` pass on this branch, but were never run against the base commit. A throwaway base worktree was blocked by the destructive-command hook, and I did not work around it.
- Not checked on real devices: touch drag, and the popover menu in Safari. Both were driven only in headless Chromium.

### Floor (final run on 21d8401, tails from `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/D-final-*.log`)

```text
$ npm run lint:repo
> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
exit 0

$ npm run typecheck:repo
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
exit 0

$ npm run test
ℹ tests 3075
ℹ pass 3074
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
exit 0

$ npm run test:contract:all
> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
exit 0

$ npm run test:e2e-smoke
  ✓  14 tests/e2e-smoke/hermetic-fence.spec.mjs:46:1 › should never let an unstubbed /__proxy/start-discovery-worker reach the server (329ms)
  ✓  15 tests/e2e-smoke/hermetic-fence.spec.mjs:70:1 › should answer every host-mutating /__proxy and /profile path in the fence (295ms)
  15 passed (16.8s)
exit 0

$ npm run test:e2e-journey
  ✓  12 tests/e2e-journey/critical-journey.spec.mjs:586:1 › should pause to a live corner pill for a visitor who poked around first (493ms)
  ✓  13 tests/e2e-journey/critical-journey.spec.mjs:623:1 › should serve the dashboard's own /profile from the local API, never a static 404 (326ms)
  13 passed (21.0s)
exit 0

$ npm run test:e2e-visual
  ✓  36 tests/e2e-visual/shell-structure.spec.mjs:228:3 › the one shell on a phone — claim C7 › should keep every beat's actions reachable without scrolling (4.7s)
  ✓  37 tests/e2e-visual/shell-structure.spec.mjs:310:3 › the one shell on a phone — claim C7 › should dock the footer at the bottom of the viewport, not the bottom of the card (1.1s)
  37 passed (1.0m)
exit 0

```

The one `todo` is the existing `tests/submission-record-audit.test.mjs` gate ("blocked on the canonical-ownership gate"), unchanged by this lane.
