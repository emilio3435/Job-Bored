# Lane cA: pipeline render trigger (DS-08, TR-20 second half)

Branch `feat/ux01-cleanup-system`, cut from `feat/ux-zero-to-one` at e37f2f4. Not pushed.

## Summary

- **Done:** the v2 board and Dawn now repaint when the pipeline render announces itself, instead of when a MutationObserver sees the hidden `#jobCards` board change.
- **Not done:** gating the legacy renderers under `body.jb-v2` (DS-08). It is blocked by a file this lane does not own. `dawn-data.js` reads the legacy `.kanban-card` nodes from `document`, and every v2 surface gets its data through it: the board (`getPipelineViewModel`), the Case and materials (`getRoleViewModel`), and Dawn (`getDawnViewModel`). If the legacy board stops building DOM, all of those go blank. The hide rules for `#pipelineSection`, `.pipeline-board` and `main.main-content` are still needed, so they stay.

## Items

| Item | Status | Note |
|---|---|---|
| Emit `jb:pipeline:rendered` (on document, `detail {count}`) at the end of each pipeline render | done | `pipeline-render.js` `emitPipelineRendered(count)` sends `detail: { count, total }` from all three exits of `renderPipeline`: a board was drawn, the pipeline is empty or nothing matches the search, and the failed load with no rows. Before this change, only the first exit fired the event, through `host().notifyPipelineRendered()`, and it carried no detail. |
| Pipeline post-render keys off the event (app.js) | done | `app.js` listens for `jb:pipeline:rendered` and calls `window.JobBoredPipeline.scheduleRender()`. `pipeline.js` still keeps its own `#jobCards` observer, which is not in this lane's files. `scheduleRender` coalesces, so the two triggers do not double-render. |
| Dawn post-render keys off the event (dawn.js) | done | `observeLegacy` no longer watches `#jobCards`. It adds one `jb:pipeline:rendered` listener. It still watches `#briefStats` and `#briefHeadline`, because the legacy brief (`daily-brief.js`) is still rendered and is Dawn's source for the hero numbers. Session-expiry clears of `#jobCards` (`sheets-read-load.js showErrorState`) still reach Dawn through `jb:data:load-failed`. |
| Gate the legacy renderers under `body.jb-v2` (DS-08) | partial, blocked on ownership | See the summary and the handoffs. `?jb-v2=0` is unchanged and still works. |
| Drop `jb-v2-legacy-hide.css` rules that become dead | partial | Removed the two `[data-region="letter"]` rules: `index.html` no longer has that region and the dev server sends `no-cache`. Updated the header comment, which still named Lattice. The `#pipelineSection`, `.pipeline-board`, `main.main-content`, `.command-strip` and `#resumeGenerateModal` rules are still live and stay until the gate lands. |
| Test: v2 boot creates no legacy pipeline nodes | written, expected-fail (fix round 1) | `pipeline-rendered-event.spec.mjs` test 3, marked `test.fail`. See the fix round below. |
| Test: `?jb-v2=0` still renders the legacy board | done | `tests/e2e-smoke/pipeline-rendered-event.spec.mjs` test 2. |

## Red, then green

`tests/e2e-smoke/pipeline-rendered-event.spec.mjs` has two tests.
- Test 1 disconnects the pipeline and Dawn `#jobCards` observers, re-seeds the pipeline, and then expects:
  - one event with `count: 3`
  - 3 `.pipe-sticker` cards
  - Dawn `total` 3
  - after an empty seed, an event with `count: 0` and 0 cards
- Test 2 uses `?jb-v2=0` and expects 3 visible legacy `.kanban-card` nodes in `#jobCards .pipeline-board` and one event with `count: 3`.

The red and green runs:
- **Red on the base:** both tests failed. The event carried no `detail`, so the count came back `undefined` (log `.ux01-run/cA-red.log`).
- **Red without the wiring:** the `pipeline-render.js` change was kept and `app.js` and `dawn.js` were reverted to HEAD. Test 1 then failed at `toHaveCount(3)` on the v2 board, which proves the repaint depends on the new wiring. Test 2 passed.
- **Green:** 2 of 2 pass.

`tests/ux01-cleanup-ca.test.mjs` has 4 source pins: the event and its detail, the app.js listener, dawn.js no longer reading `#jobCards`, and no letter-region rule.

## Contracts

`data-action`, `data-stable-key`, `expandedJobKeys`, `updateJobStatus(dataIndex, stage)` and `schemas/pipeline-row.v1.json` are unchanged. The event name `jb:pipeline:rendered` is unchanged. It gained a `detail`, and the existing listeners (role.js, role-materials.js, today.js, oneflow-demo-board.js) ignore that detail. The event now also fires on empty renders. The listeners either re-render idempotently or check for real rows first (`oneflow-demo-board.js onPipelineRendered`).

## Handoffs

| To | File | Change |
|---|---|---|
| dawn-data owner (board lanes D/E) | `dawn-data.js` `jobsFromCards`, `getPipelineViewModel`, `_findCardByStableKey`, `readHeroFromDom` | Build the view models from `window.JobBored.getPipelineJobs()` (and the brief numbers from the same rows) instead of `document.querySelectorAll(".kanban-card[data-stable-key]")` and `#briefStats`. This is the single blocker for DS-08. |
| After that, this lane or lane A | `pipeline-render.js renderPipeline`, `daily-brief.js renderBrief`, `jb-v2-legacy-hide.css` | Skip building `#jobCards` / the brief when `body.jb-v2` is set, but still call `emitPipelineRendered`. Re-render the legacy board when `JB_V2.disable()` removes the class. Then drop the `#pipelineSection`, `.pipeline-board`, `main.main-content` and `.command-strip` hide rules, and add the "no `.kanban-card` under v2" browser check. |
| Board lane | `pipeline.js observeLegacy` (≈2172) | Remove the `#jobCards` MutationObserver. app.js now drives the repaint. `tests/pipeline-edit-affordance.test.mjs:145` pins that observer and has to change with it. |
| Board / Case lanes | `tests/e2e-smoke/case-dossier.spec.mjs:237`, `tests/e2e-journey/case-people-writeback.spec.mjs:364` | Both wait for a legacy `.kanban-card` to be attached as the "seeded" signal. Switch them to `.pipe-sticker` or the event before the gate lands. |
| pipeline-controller owner | `pipeline-controller.js notifyPipelineRendered` | pipeline-render.js no longer calls it, and nothing else does. Delete it, or have it forward `detail`. |
| flowing-store owner | `flowing-store.js:164 lookupJobMeta` | Reads role and company off the legacy card. Move it to `getPipelineJobs()` before the gate. |
| Lane C | `flowing-chrome.css:566` | Its `[data-region="letter"]` rule is dead too. |

## Files touched

`pipeline-render.js` (the event only), `app.js`, `dawn.js`, `jb-v2-legacy-hide.css`, the new `tests/e2e-smoke/pipeline-rendered-event.spec.mjs` and `tests/ux01-cleanup-ca.test.mjs`, and this report. No baselines were refreshed.

## Floor

Run from the worktree root. Logs are in `~/Job-Bored.worktrees/.ux01-run/cA/`.

All 7 commands exit 0, on HEAD 9f130a2 plus this report.

```
npm run lint:repo          exit 0  lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
npm run typecheck:repo     exit 0  tsc --noEmit (browser-use-discovery, server) + node --check list, clean
npm test                   exit 0  tests 3065 · pass 3064 · fail 0 · skipped 0 · todo 1
npm run test:contract:all  exit 0  OK schema (pipeline-update request) … OK integrations/openclaw-command-center/SKILL.md
npm run test:e2e-smoke     exit 0  19 passed (18.4s)  (17 before this lane, plus the 2 new checks)
npm run test:e2e-journey   exit 0  25 passed (28.6s)
npm run test:e2e-visual    exit 0  37 passed (1.1m)   (no baseline refreshed)
```

The one `todo` is already there on the base: "persists and can remove the canonical submission evidence record", which is blocked on the canonical-ownership gate. The runner prints it under a `✖` in the failing-tests list, but it counts as a todo, not a failure.

## Verification · floor (cA-r1)

Verifier: independent Opus context, not the author. HEAD `ecaa11f6`, worktree clean before the run. Run date: 2026-09-25. Logs: `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/cA-r1/`.

**Green: yes.** All seven commands ran in order and each exited 0. Nothing was skipped, filtered, sharded, or re-run. No flaky specs.

| Command | Exit code | Counts | Time |
|---|---|---|---|
| `npm run lint:repo` | 0 | eslint clean; lint:skills OK; lint:tokens 34 sheets, 0 new findings | 3s |
| `npm run typecheck:repo` | 0 | tsc (browser-use-discovery, server) clean; every `node --check` passed | 3s |
| `npm test` | 0 | 3065 tests / 739 suites: 3064 pass, 0 fail, 0 cancelled, 0 skipped, 1 todo | 14s |
| `npm run test:contract:all` | 0 | 12 OK contract/schema checks | 1s |
| `npm run test:e2e-smoke` | 0 | 19 passed | 21s |
| `npm run test:e2e-journey` | 0 | 25 passed | 28s |
| `npm run test:e2e-visual` | 0 | 37 passed | 61s |

Note: `npm test` prints a "failing tests" block for one test, `tests/submission-record-audit.test.mjs:17` ("persists and can remove the canonical submission evidence record"). That test is marked `# TODO` ("blocked on the canonical-ownership gate"), so its assertion error is expected and counts under todo, not fail.

### Tails

```
[npm test]
ℹ tests 3065
ℹ suites 739
ℹ pass 3064
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
[test:e2e-smoke]    19 passed (20.3s)
[test:e2e-journey]  25 passed (27.9s)
[test:e2e-visual]   37 passed (1.0m)
[lint:repo]         lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
```

## Fix round 1 (review findings)

HEAD before: `7288e23e`. Commits: `53f70ccd` (test), plus this report.

| Finding | Verdict | Status |
|---|---|---|
| `pipeline-render.js:1173`: the legacy renderer is not gated under `body.jb-v2` | Correct. | **Blocked, not fixed.** The review itself confirms the root cause is outside this lane. Consumers that still read legacy `.kanban-card` nodes from `document` (confirmed by grep on HEAD): `dawn-data.js` (`jobsFromCards`, which drives the board, Case and Dawn view models), `flowing-store.js lookupJobMeta`, `flowing-writes.js`, `role.js`, `stage-registry.js`, `pipeline-controller.js`, and the `#jobCards` observer in `pipeline.js`. Only `pipeline-render.js` (event emission only), `app.js`, `dawn.js` and the CSS are mine. Two things rule out a gate today. Gating inside `pipeline-render.js` is outside the "event emission only" grant. Gating it any other way blanks every v2 surface. There is no fix inside my files that I could stand behind. The orchestrator has to sequence it: dawn-data (and the other readers) move to `getPipelineJobs()` first, then the gate. See the Handoffs table above. |
| `pipeline-rendered-event.spec.mjs:73`: the v2 no-legacy-nodes proof is missing | Correct. | **Done as a pinned red test.** Test 3, "v2: the boot builds no legacy pipeline nodes (DS-08 gate)", boots `/?greenfield=1`, seeds 3 rows, and checks three things: 3 `.pipe-sticker` cards, event `[3]`, and **0** `#jobCards .kanban-card`. It is marked `test.fail(true, …)`. The gate lane removes that marker, and the test must then pass. If the gate lands and the marker stays, Playwright reports "expected to fail but passed" and the suite goes red, so the pin cannot rot silently. |

Red for the right reason: with the marker switched off, test 3 fails only at the last assertion, `Expected: 0 / Received: 3` (log `.ux01-run/cA-fix/red-unmarked.log`). Tests 1 and 2 pass in that run. With the marker on, the run shows 3 passed (log `.ux01-run/cA-fix/marked.log`).

Caveat: `test.fail` counts any failure as expected. A regression in the sticker or event assertions of test 3 would therefore be hidden. Test 1 covers both of those unmarked, so nothing is left unguarded.

### Floor (fix round 1)

HEAD `53f70ccd`. Logs are in `~/Job-Bored.worktrees/.ux01-run/cA-fix/`. All 7 commands ran in order, and none was filtered or re-run.

```
npm run lint:repo          exit 0  lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
npm run typecheck:repo     exit 0  tsc --noEmit --project server/tsconfig.json (clean)
npm test                   exit 0  tests 3065 · pass 3064 · fail 0 · skipped 0 · todo 1 (pre-existing submission-record todo)
npm run test:contract:all  exit 0  OK integrations/openclaw-command-center/SKILL.md (last line; all OK)
npm run test:e2e-smoke     exit 0  20 passed (18.3s)  (19 before, plus the expected-fail test 3)
npm run test:e2e-journey   exit 0  25 passed (27.6s)
npm run test:e2e-visual    exit 0  37 passed (59.2s)  (no baseline refreshed)
```
