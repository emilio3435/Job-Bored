# Lane DS08: v2 renderer cutover (DS-08, second half of TR-20, C4)

Branch `feat/ux01-cleanup-system`. Not pushed.

Commits:
- `696468bf` merges `feat/ux-zero-to-one` (lanes cC and cD). The merge was clean, with no conflicts.
- `b66d2e3c` is the cutover itself.
- The commit after it is this report.

Logs are in `~/Job-Bored.worktrees/.ux01-run/DS08/`.

## Summary

**Done.** When `body.jb-v2` is set, the legacy renderer builds no `#jobCards` / `.kanban-card` DOM. Every v2 surface now reads the rows:
- the board
- the Case
- Dawn, including its hero numbers
- the recents meta
- the write-back link lookup

`?jb-v2=0` still renders the legacy board. `JB_V2.disable()` at runtime draws the legacy board that the gate skipped, and `JB_V2.enable()` removes it again.

## How the readers moved

- `pipeline-render.js` splits the card's data-* attributes into `kanbanCardAttrPairs(job)`: raw `[name, value]` pairs.
  - `renderKanbanCard` escapes those pairs into the legacy `<article>`, so its output does not change.
  - `kanbanCardModel(job)` hands the same pairs to v2 as data.
  - `getBoardCardModels()` returns the cards the legacy board would draw, in its order: search, sort, the dismissed and favorites filters, stage lanes, and the per-company cap. They are built from `core().getPipelineData()`, which are the rows `window.JobBored.getPipelineJobs()` returns.
  - Because both paths use one attribute source, the board and v2 cannot drift. A unit test pins this: the model attrs deep-equal the attributes parsed from the rendered article.
- `dawn-data.js` gets its cards from `_cardRecords(doc, opts)`.
  - On the live page (no `opts.doc`) it reads `getBoardCardModels()`, through the same `getAttribute` / title / company / tag accessors a `.kanban-card` offers. So `_readCard`, the role parsers, and the enrichment parsers are unchanged.
  - With an explicit `opts.doc` (the unit tests and the self-test), or on a page without pipeline-render.js, it still reads `.kanban-card` nodes. That fallback is what keeps the existing synthetic-DOM tests valid.
  - This covers `jobsFromCards`, `getPipelineViewModel`, `_findCardByStableKey` (role and letter view models) and the hero (`readHero`, which falls back to `readHeroFromDom`).
- `daily-brief.js` gains `getBriefStats(jobs?)`, the four stat-card numbers. `renderBrief` now draws `#briefStats` from that same function. Dawn's hero reads it and repeats the sub-lines word for word.
- `flowing-store.js lookupJobMeta` reads `getPipelineJobs()[key]` and is exposed as `JobBoredFlowing.lookupJobMeta`. It falls back to the DOM card only when app.js is not present.
- `flowing-writes.js` gains `readJobLinkFromApp`, which is tried before the DOM link in `resolveSheetRow` step 3.
- `pipeline.js observeLegacy` no longer observes `#jobCards`. `app.js` repaints the board when `jb:pipeline:rendered` fires, and only the body class is still observed.
- `pipeline-controller.js`: `notifyPipelineRendered` was dead (it had no callers and sent an event with no detail). It is removed along the whole chain: app-compat.js, app.js, bridge-registry.js and pipeline-controller.js.
  - `markJobViewed` keeps its `.kanban-card` class toggle, which applies to the legacy view only. There is a comment on it.
- `role.js` and `stage-registry.js` had stale comments only. They are updated.

## Steps

| Step | Status | Note |
|---|---|---|
| 0. Merge `feat/ux-zero-to-one` | done | `696468bf`, no conflicts. It carries git's default message with no trailer lines, because `git merge --no-edit` wrote it. I did not amend it, because the rules say never rewrite a commit. |
| 1. Move readers to rows; remove the pipeline.js `#jobCards` observer; update `pipeline-edit-affordance.test.mjs:145` | done | The pin now asserts three things: no `#jobCards` lookup in pipeline.js, app.js repaints on the event, and the body is observed for its class only, never its subtree. |
| 2. `case-dossier.spec.mjs:237`, `case-people-writeback.spec.mjs:364` | done | Both now wait for `[data-region="pipeline"] .pipe-sticker[data-stable-key=…]` to be attached. |
| 3. Gate `renderPipeline` under `body.jb-v2`, still emit, re-render on `JB_V2.disable()` | done | Under v2 it clears `#jobCards` and sets `legacyBoardSkipped`, then calls `emitPipelineRendered(data.length)`. A body-class MutationObserver (`watchV2Flag`) redraws on disable and drops the board on enable. `tests/ux01-cleanup-ca.test.mjs` expects one more `emitPipelineRendered(` call: 5 instead of 4, because this is the fourth render exit. |
| 4. Remove `test.fail` from proof test 3; drop dead hide rules | done, with two deviations (see below) | Test 3 passes unmarked. The new test 4 checks the disable/enable round trip. The `#pipelineSection` and `.pipeline-board` rules are removed. |

### Deviation: two hide rules stay

The task named the `main.main-content` and `.command-strip` hide rules as dead. **They are not, so they stay.**
- `main.main-content` still contains the static legacy pipeline markup: the section header, toolbar and search, `#emptyState` and `#errorState`.
- `.command-strip.daily-brief-panel` is still drawn by `daily-brief.js renderBrief`. Gating the brief was not part of this lane.

Removing either rule would put legacy chrome on screen under v2. `tests/ds08-renderer-cutover.test.mjs` now pins both rules as still needed. `#resumeGenerateModal` stays too, because Scribe binds the same ids.

### Behaviour notes (inferred, not a regression the floor shows)

- The v2 readers now see the current rows, not the last rendered DOM. Optimistic row writes therefore reach the Case before the next legacy render. Before this change they appeared only after that render.
- `getBoardCardModels()` keeps the legacy per-company cap. This matches the old behaviour, so a card the legacy cap hid still has no Case. Dropping that cap for v2 would be a behaviour change and is left to the board owner.
- Each `getPipelineViewModel` or `getRoleViewModel` call rebuilds the models, which runs the attribute clipping once per row. Before, the legacy render did that work once. At current pipeline sizes this was not measured. It is a candidate for memoising on the render event if it ever shows up in profiles.

## Red, then green

- **Unit tests.** `tests/ds08-renderer-cutover.test.mjs` has 13 tests.
  - The 11 behaviour tests were red before any code change, each on its missing seam (log `DS08/red-unit.log`): no `getBoardCardModels`, no `getBriefStats`, no `lookupJobMeta` / `readJobLinkFromApp`, dawn-data VMs empty with no `.kanban-card` in the document, `#jobCards` still observed, no `isV2View()` gate.
  - The CSS pin was red before the rules were removed. Its companion test (the kept rules) passed.
  - After the change, all 13 pass.
- **The e2e disable test.** With `watchV2Flag()` commented out, the disable/enable test failed at `toHaveCount(3)` on the legacy cards, and the other three tests passed. That run includes the DS-08 gate test, now unmarked (log `DS08/red-disable.log`). With the watcher restored, all 4 pass, plus the Case dossier spec (log `DS08/green-proof.log`).

## Contracts

These are unchanged:
- `data-action`
- `data-stable-key`, which is still the row index on both the stickers and the legacy cards
- `expandedJobKeys`
- `updateJobStatus(dataIndex, stage)`
- `schemas/pipeline-row.v1.json`

The event name `jb:pipeline:rendered` and its `detail {count, total}` are unchanged. The legacy card HTML is byte-for-byte the same, because it is built from the same pairs. There are no raw colour literals: the only CSS change removes rules, and lint:tokens reports 0 new findings.

## Floor

Run from the worktree root on `b66d2e3c` (the same tree as this report, minus the report). Logs are in `~/Job-Bored.worktrees/.ux01-run/DS08/floor1/`. All 8 commands ran in order, with no filter, shard, retry or baseline update.

| Command | Exit | Result |
|---|---|---|
| `npm run lint:repo` | 0 | `lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)` |
| `npm run typecheck:repo` | 0 | tsc (browser-use-discovery, server) clean |
| `npm test` | 0 | tests 3098 · pass 3097 · fail 0 · skipped 0 · todo 1 |
| `npm run test:contract:all` | 0 | last line `OK integrations/openclaw-command-center/SKILL.md` |
| `npm run test:e2e-smoke` | 0 | 21 passed (19.1s). The previous 20 included the expected-fail marker. Now it is 20 real passes plus the new disable test. |
| `npm run test:e2e-journey` | 0 | 26 passed (29.3s) |
| `npm run test:e2e-visual` | 0 | 37 passed (1.0m). No baseline was refreshed. |
| `npm run test:browser-use-discovery` | 0 | tests 741 · pass 741 · fail 0 |

The one `todo` predates this lane: `tests/submission-record-audit.test.mjs` "persists and can remove the canonical submission evidence record", which is blocked on the canonical-ownership gate. The runner prints it under `✖`, but it counts as a todo, not a failure.

```
[npm test]
ℹ tests 3098
ℹ pass 3097
ℹ fail 0
ℹ skipped 0
ℹ todo 1
[test:contract:all]  OK integrations/openclaw-command-center/SKILL.md
[test:e2e-smoke]     21 passed (19.1s)
[test:e2e-journey]   26 passed (29.3s)
[test:e2e-visual]    37 passed (1.0m)
[browser-use-discovery] ℹ tests 741 · ℹ pass 741 · ℹ fail 0
[lint:repo]          lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
```

## Handoffs

| To | What |
|---|---|
| Brief owner | Gate `daily-brief.js renderBrief` under `body.jb-v2`. Dawn's hero no longer needs `#briefStats`, but `dawn.js observeLegacy` still uses `#briefStats` and `#briefHeadline` as its repaint trigger. Switch it to `jb:pipeline:rendered` first. After that, the `.command-strip` hide rule can go. |
| Board owner | Decide whether v2 keeps the legacy per-company cap inside `getBoardCardModels()`. The v2 board applies its own cap on top of it. |
| Verifier | Run an independent floor, per the program's rules. |
