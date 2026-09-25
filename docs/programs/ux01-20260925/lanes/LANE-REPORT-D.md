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

## Verification · floor (D-r1)

Verifier: fresh Opus context (independent of the lane author), 2026-09-25, HEAD 27f46ca. Logs: `Job-Bored.worktrees/.ux01-run/D-r1-floor/<n>.log`. No retries, no flaky specs. **Green: 7/7.**

| # | Command | Result | Counts |
|---|---|---|---|
| 1 | npm run lint:repo | PASS (exit 0) | eslint clean; skills lint OK |
| 2 | npm run typecheck:repo | PASS (exit 0) | tsc browser-use-discovery + server clean; all node --check OK |
| 3 | npm test | PASS (exit 0) | 3075 tests: 3074 pass, 0 fail, 0 skipped, 1 todo |
| 4 | npm run test:contract:all | PASS (exit 0) | 12 OK lines, 0 FAIL |
| 5 | npm run test:e2e-smoke | PASS (exit 0) | 15 passed |
| 6 | npm run test:e2e-journey | PASS (exit 0) | 13 passed |
| 7 | npm run test:e2e-visual | PASS (exit 0) | 37 passed |

Note: the only ✖ in `npm test` is the `todo` test `tests/submission-record-audit.test.mjs:17` ("blocked on the canonical-ownership gate"). It dates from #75 on main, not this branch, and node does not count it as a failure.

Tails:

```
ℹ tests 3075
ℹ suites 746
ℹ pass 3074
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 14101.216583

---

  15 passed (17.8s)
EXIT=0

  13 passed (20.7s)
EXIT=0

  37 passed (1.0m)
EXIT=0
```

---

# Conformance pass (2026-09-25, after merging `feat/ux-zero-to-one`)

The branch fast-merged `feat/ux-zero-to-one` (lane C) cleanly at 15cc958. This pass closes the six must-fix gaps the conformance check found against the mockup.

## What changed for the user

- **An unreadable link reads like the mockup.** When a link can't be fetched (no worker, a timeout, a blocked site or a scrape failure), the manual form opens with a warn banner: "We couldn't read that page from here. Fill in the rest and it goes straight to your Sheet." Strangers no longer see CORS, Cloudflare, tunnel or endpoint-URL text. The transport detail goes to the console.
- **A failed move says which role and where it stayed.** If the Sheet refuses a move from any surface, a toast reads "Couldn't move <role> at <company> to <Stage>. The Sheet didn't accept it, so it is still in <Stage>." It has a **Retry** button that re-runs the same move through the planner. The generic "Update failed: <raw server text>" toast that covered it is removed for these moves.
- **The whole active pipeline fits at 1440.** Discovered, Researching, Applied, Phone screen, Interviewing and Offer share the width (193 px each at 1440; measured page scrollWidth 1440). Rejected, Passed and Expired rest as chips in a **Closed** row under the board ("Rejected 1"). A chip opens its roles in place, and it is still a drop target.
- **Resting cards are readable.** A resting card shows the company, the fit ring, the title, one "place · pay" line ("Brooklyn · $160–200k") and at most one status chip. Measured card height is 101 px (124 px with the Applied chip) at 1440 and 81 px at 375, down from 182–198 px. The source and tag chips, the salary chip and the note appear on the selected card. On a mouse or trackpad, Edit, Favorite and a compact **Move** control appear on hover or keyboard focus, and a favourited star stays visible. On touch they stay visible at 44 px.
- **Applied looks like the main action.** The confirm button is the kit's filled navy `.jb-btn--primary` (measured rgb(14,58,78) with paper text), labelled **Mark applied**, next to a secondary Cancel. The dialog has a **Sent with it** group: the role's tailored resume and cover letter, preselected. Checked files are written to Notes with the application ("Applied via Greenhouse · sent: Tailored resume (Sep 24), Cover letter (Sep 24)"). A note under it says what is written to the Sheet.

## Change status (this pass)

| id | finding | status | notes |
|---|---|---|---|
| C5 (lane D part) | FD-01, FR-04: manual fallback message | done | `pipeline.js` URL-modal failure path and every `ingest-url-flow.js` fallback use the mockup copy, `tone:"warn"`. `partials/ingest-manual-modal.html` gains `#ingestManualModalBanner.jb-banner[data-tone=warn]`. The network-failure detail (`classifyIngestNetworkFailure`) is now plain words, and the endpoint is logged to the console. |
| C17 | SS-07: failed move toast | done | `pipeline-transition-adapter.js` `reportFailure` toasts the role, target stage, stayed-in stage and Retry, unless the caller passes `announce:false` (the submission dialog does, and has its own Retry). `jb:write:failed` now carries `announced:true`, so the board's drag listener doesn't add a second toast; its own toast (for failures the adapter did not announce) now names the role too. The adapter removes `#toastContainer .toast-error` toasts whose text starts "Update failed" (see handoff to lane F). |
| C19 | TR-09: 6 columns + Closed row | done | `CLOSED_STAGES = {rejected, passed, expired}` render in `.pipe-closed` after `.pipe-shell`. The grid has six tracks: `--pipe-col-open: minmax(164px, 1fr)`, with the shell scrolling below that floor. |
| C19 | TR-16: resting card | done | New `.pipe-sticker__meta` line. `.pipe-sticker__detail` and `.pipe-sticker__salary` are hidden at rest. A `data-flag` card hides the Applied-age chip at rest. |
| C15 | TR-06/TA-04: primary button | done | `jb-a11y.js` confirm dialog: confirm = `jb-btn jb-btn--primary`, cancel = `jb-btn jb-btn--secondary`. The `jb-a11y.css` fallback is navy, not mint. Label: "Mark applied". |
| C15 | TA-21: Sent with it | done (board-side data) | `dialog.confirm` takes `checks:{label, items:[{id,label,checked}]}` and `note`. `submission-flow.js` fills it from `prefill.materials`, else from `JobBoredPipeline.materialsFor(dataIndex)` (the board's cached `/api/applications` index: ready resume and cover letter, labelled with the file date). Showing the sent files on the dossier's Applied record event is lane E's (handoff). |
| C16 (lane D part) | prefill API | done (unchanged, extended) | `prefill.materials` added. |

## APIs (consumed by other lanes)

```js
// ingest-url-flow.js — lane C (top-bar Add job, empty states), lane B (capture)
window.JobBoredIngest.openManual({ url, title, company, location, message?, direct?, tone? }) // -> boolean
//   tone:"warn" shows the message in the modal's warn banner; with no message it uses
//   "We couldn't read that page from here. Fill in the rest and it goes straight to your Sheet."

// submission-flow.js — lane E (C16 "Did you apply?" prompt)
window.JobBoredSubmission.confirmApplied({
  dataIndex, fromStage?,
  prefill: { source?, date?, followUpDate?, receiptNote?, materials?: [{ id, label, checked? }] },
}) // -> Promise<{ confirmed, cancelled?, evidence: {appliedDate, source, receiptNote, followUpDate, sent?}, result?, code? }>

// pipeline.js — new
window.JobBoredPipeline.materialsFor(dataIndex) // -> [{ id: "resume"|"cover_letter", label, checked: true }] from the cached index; [] when none

// jb-a11y.js — dialog.confirm spec additions
JobBoredA11y.dialog.confirm({ ..., checks: { label, items: [{ id, label, checked }] }, note })
//   each checkbox value reads back as "true"/"false" under its id
```

## Contracts touched

- **`data-action`:** unchanged (`move-to-stage`, `add-job-url`, `stage-step`).
- **`data-stable-key`:** unchanged, still on `.pipe-sticker`.
- **PIPELINE-CARDS-HANDOFF selectors:** `.pipe-col[data-stage]`, `.pipe-col__toggle` and `.pipe-sticker` are kept. The three closed stages are still `.pipe-col[data-stage]` sections (class `pipe-col--closed`), but they now live inside `.pipe-closed`, not `.pipe-board`. Their `.pipe-col__toggle` is the chip (`.pipe-closed__chip.jb-chip`). A consumer that assumed all nine columns are children of `.pipe-board` will now find six.
- **`jb:write:failed`:** detail gains `announced: boolean`. Existing reasons are unchanged.
- **`updateJobStatus(dataIndex, stage)`:** not touched.
- **`expandedJobKeys`:** not touched.
- **`schemas/pipeline-row.v1.json`:** unchanged. Sent files go into the existing Notes cell (O), in the same planner batch.
- **localStorage `jb_pipelineColumns.v2`:** closed stages default to closed. An explicit "open" is remembered as before.

## Files touched (this pass)

`pipeline.js`, `pipeline.css`, `pipeline-transition-adapter.js`, `submission-flow.js`, `jb-a11y.js`, `jb-a11y.css`, `ingest-url-flow.js`, `partials/ingest-manual-modal.html` (all owned).

Tests: `tests/ux01-board-apply.test.mjs` (+13 probes; 12 were red on 15cc958, and the 13th is a guard that a cancel is not an error toast). `tests/e2e-smoke/board-apply.spec.mjs` (+2 browser checks, both red on 15cc958). Updated to the new behaviour: `tests/expired-status-contract.test.mjs`, `tests/ingest-url-endpoint-resolution.test.mjs`, `tests/pipeline-collapse-scroll.test.mjs`, `tests/pipeline-discovered-column.test.mjs`.

## Baselines refreshed

None. The visual suite asserts geometry, not screenshots.

## Handoffs

| to | file | change |
|---|---|---|
| Lane F | `sheets-writeback.js` | `updateMultipleCells` still paints "Update failed: <raw text>" for planner writes. The adapter removes it by matching that copy. Please suppress it when the caller is `applyCells` (or return the error to the caller), and then the match can go. |
| Lane E | `role-case.js` | Pass exact manifest versions as `prefill.materials` when calling `confirmApplied` from the dossier. Show the "sent: …" files on the Applied record event (they are in Notes after "sent: "). |
| Lane C | top bar | Use `JobBoredIngest.openManual({url, tone:"warn"})` when a top-bar link fails. |
| Lane A | `index.html` head | Bump `?v=` for `pipeline.js`, `pipeline.css`, `pipeline-transition-adapter.js`, `submission-flow.js`, `jb-a11y.js`, `jb-a11y.css`, `ingest-url-flow.js`. |

## Residual (not must-fix, left as is)

- At 1440 the company name is uppercase mono and truncates on long names ("JUNIPER BA…"). The mockup sets it in regular body type. This was left for the kit migration.
- "Phone screen" wraps to two lines in its 193 px header.
- **Unverified:** the failed-move toast was proved by the unit probe with a real planner and adapter, not in a browser. Reproducing it in the hermetic harness needs a signed-in adapter host (`move` returned `missing_row` there).

Shots: `Job-Bored.worktrees/.ux01-run/D-conform/{board,board-hover,closed-open,manual,applied}-{1440,375}.png`.

## Floor (conformance pass, HEAD 25beca5; logs `Job-Bored.worktrees/.ux01-run/D-conf-floor/`)

```text
$ npm run lint:repo
> command-center@0.1.0 lint:tokens
> node tools/lint-tokens.mjs
lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
EXIT=0

$ npm run typecheck:repo
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
EXIT=0

$ npm run test
ℹ tests 3061
ℹ suites 737
ℹ pass 3060
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 13585.560208
EXIT=0

$ npm run test:contract:all
> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
EXIT=0

$ npm run test:e2e-smoke
  ✓  15 tests/e2e-smoke/dossier-layout.spec.mjs:293:1 › the dossier collapses to one honest column on a narrow frame (1.9s)
  ✓  16 tests/e2e-smoke/hermetic-fence.spec.mjs:46:1 › should never let an unstubbed /__proxy/start-discovery-worker reach the server (255ms)
  ✓  17 tests/e2e-smoke/hermetic-fence.spec.mjs:70:1 › should answer every host-mutating /__proxy and /profile path in the fence (280ms)
  17 passed (17.4s)
EXIT=0

$ npm run test:e2e-journey
  ✓  23 tests/e2e-journey/shell-today.spec.mjs:308:1 › should not call a loading or failed pipeline empty in the Brief (561ms)
  ✓  24 tests/e2e-journey/shell-today.spec.mjs:327:1 › should move a snoozed reply with no Last contact out of You owe an answer (589ms)
  ✓  25 tests/e2e-journey/shell-today.spec.mjs:340:1 › should focus the pipeline search on Cmd/Ctrl+K from the Today and Dossier views (741ms)
  25 passed (28.0s)
EXIT=0

$ npm run test:e2e-visual
  ✓  35 tests/e2e-visual/shell-structure.spec.mjs:201:5 › the one shell at 390×844 › should keep the shell inside the viewport it was given (390×844) (637ms)
  ✓  36 tests/e2e-visual/shell-structure.spec.mjs:228:3 › the one shell on a phone — claim C7 › should keep every beat's actions reachable without scrolling (4.5s)
  ✓  37 tests/e2e-visual/shell-structure.spec.mjs:310:3 › the one shell on a phone — claim C7 › should dock the footer at the bottom of the viewport, not the bottom of the card (1.0s)
  37 passed (1.0m)
EXIT=0

```

The unit-test total is 3061 (it was 3075 before the merge): the merged lane C tree carries a different test set. The one `todo` is the existing submission-record-audit gate.
