# UX01 lane C (Shell and Today): lane report

Branch `feat/ux01-shell-today`, cut from `feat/ux-zero-to-one` at cca3e30. Lane A's C2 merge (9cce02c) was merged in at 93587e7 before the final floor ran. Worktree `~/Job-Bored.worktrees/ux01-shell-today`. Not pushed.

## What changed for the user

- **One view at a time.** The dashboard opens on **Today**. Pipeline and Dossier are separate views, reached from the top bar, not found by scrolling 5 screens down. Choosing a view moves focus to it. **Skip to Pipeline** is the first Tab stop.
- **The dossier is a view.** Opening a role focuses its heading. Closing it returns you to the card or Today row that opened it, with focus on that control.
- **Add job is always in the bar.** It opens the link intake from any view. With an empty pipeline, Today shows three buttons: Paste a link, Add by hand and Find jobs. It no longer says "Nothing is waiting on you". The empty Brief also gets real buttons.
- **Today can be cleared.** Rows are grouped into bands: You owe an answer, Follow-up slipped, **Due in 48 h**, **Offer open**, Gone quiet and Worth a look. Each row carries the action that clears it:
  - **Done** writes Last contact and moves the follow-up a week out.
  - **Mark answered** stops a reply from nagging.
  - **Snooze** offers 2 days, a week, or a date you pick.
  - **Add to calendar** downloads an `.ics` file.
  - Each write reaches the Sheet once (before, every write went twice). The row leaves its band as soon as the write lands.
- **Every surface names the same next step.** The Brief's lead, the card strip's "Next action" and Today all read the same engine. The Brief's "last 30 days" numbers are now counted from Date Found and Applied Date. The funnel is labelled "in stage now", and the plurals are fixed.
- **Phone.** At 375 px the three views stay on screen. Sheet, Portfolio, Run history and Expired review move into a **More** menu, which closes on Escape and returns focus to its button. The account button is whole.
- The red "0" expired-review badge is gone. Landmarks no longer say "(v2)". The dossier shelf says "Ctrl K" off Apple devices.

## Changes

| Id | Status | Note |
|---|---|---|
| C5 (lane C part) | done | Top-bar Add job, Today's first-run card with three ways in (TR-22, MP-06, SS-11), and actions on the empty Brief. `welcome.js` now opens the v2 intake instead of the hidden legacy `#ingestUrlInput` and `#ingestManualModalOpenBtn` (FD-02, FR-03). "Add by hand" calls `JobBoredIngest.openManual` when lane D's API is present. Until then it opens the URL modal, whose failure path is lane D's. FD-01, FD-22 and FR-04 are lane D's (`pipeline.js`, `ingest-url-flow.js`). |
| C18 | partial | **Done:** views on the same anchors (TR-19); focus on view change; skip link (AX-12); dossier takes focus and returns it (AX-05, TA-17); pills are plain buttons with `aria-current` pointing at real region ids (AX-12); Escape and `aria-expanded` on the menu (AX-16); chrome at 375 (AX-15); no "(v2)" (AX-23); Ctrl K (AX-24). Scribe now renders only in the Dossier view (TA-09, cost part). **Left to other lanes:** TR-23 card semantics (`pipeline.js`, lane D), AX-25 stepper (`role-case.css`, lane E), and Scribe `hidden` until bound (`scribe.js`, lane E). See handoffs. |
| C20 | partial | **Done:** one engine (`today-data.js`) with Due in 48 h and Offer open bands (TR-15); Mark answered and the answered rule (TR-13); Done writes R and P once each (TR-12); Snooze and `.ics` (MP-07); Brief lead and card strip read the engine (TR-14); honest 30-day numbers (TR-18). **Left to other lanes:** the dossier People "Next move" (`role-case-model.js`, lane E) and Add to calendar inside Mark submitted (`submission-flow.js`, lane D). The APIs they need exist; see handoffs. |
| TR-21 | done | `[hidden]` rule in `flowing-chrome.css` now wins over the action display rules. |
| `jb:data:*` gating | done | Today and the Brief both listen for `jb:data:loading`, `jb:data:loaded` and `jb:data:load-failed` on `document`. Before the first signal each behaves as it did before. While loading, the Brief's empty-leads card says "Loading your pipeline…"; after a failed load with no rows it says the pipeline didn't load. Neither shows the first-run Add job / Run discovery buttons. (Fix round 1.) |

## Tests (a failing test first for each behaviour change)

- `tests/today-next-step-engine.test.mjs` (new, 14 tests). It had 12 failures against the pre-change engine and passes now.
- `tests/e2e-journey/shell-today.spec.mjs` (new, 7 tests). The 5 chrome tests fail on the pre-change chrome and pass now. It sets reduced motion with `page.emulateMedia` and asserts `matchMedia`.
- `tests/dawn-by-the-numbers-30d.test.mjs`: rewritten for the date-based rule, plus a lead-ranking test (TR-14).
- `tests/recruiter-strip-card.test.mjs`: engine-first Next action. The byte-identity test in `recruiter-strip-dossier.test.mjs` still passes unchanged.
- Existing tests updated for intended changes:
  - `today-queue*.test.mjs`: the counts include `due` and `offer`, and Log follow-up is now two writes, each dispatched once.
  - `critical-journey.spec.mjs`: two tests click the Pipeline view before using the board.
  - `dossier-layout.spec.mjs`: measures the flow column with a probe, because the pipeline region is hidden while the dossier is open.
- A bug found while testing: bare Sheet dates (`YYYY-MM-DD`) were parsed as UTC midnight, which moved "due tomorrow" to "today" west of Greenwich. `today-data.js` now parses them as local days.

## Files touched

`flowing-chrome.js`, `flowing-chrome.css`, `index.html` (body regions only: ids, labels, `tabindex` on the pipeline region), `today.js`, `today-data.js`, `today.css`, `dawn.js`, `dawn-data.js`, `dawn.css`, `recruiter-strip.js`, `role.js`, `welcome.js`. Tests: see above. `expired-review-ui.js` did not need a change; TR-21 was CSS only.

## Contracts touched

- **`data-region` anchors:** unchanged. Added `id="region-<name>"` and removed "(v2)" from the `aria-label`s.
- **Sheet write-back:** only through the existing `jb:role:writeback` bridge (`flowing-writes.js`). The fields used are `heardBack` (Pipeline!R), `followupAt` (Pipeline!P) and `passed` (Pipeline!M). `schemas/pipeline-row.v1.json` is unchanged. The "answered" state is derived from R and P, with no new column.
- **Read only:** `data-stable-key` (focus return), `data-action="add-job-url"` (reused to open the URL modal) and `window.JobBored.getPipelineJobs()`. After a confirmed `jb:write:succeeded`, Today patches `lastHeardFrom`, `followUpDate` or `status` on the live row.
- **Not touched:** `expandedJobKeys`, `updateJobStatus(dataIndex, stage)` and the PIPELINE-CARDS-HANDOFF selectors.

## APIs added

- `window.JobBoredFlowing.views`: `show(id, { focus, scroll })`, `current()` and `regionsOf(id)`. The id is `today`, `pipeline` or `role`. `body[data-jb-view]` carries the current view.
- `window.JobBoredFlowing.addJob`: `openUrl()`, `openManual(prefill)` and `runDiscovery()`. These are the three ways in, shared by the bar and every empty state.
- `document` event `jb:view:changed`, with `{ view }`.
- `window.JobBoredToday.data.nextStepFor(job, { now })`, which returns `{ reason, rank, headline, detail }` or `null`.
- `window.JobBoredToday.data.buildIcs({ date, title, company, jobKey, summary, description, url })`, which returns RFC 5545 text.
- `getTodayQueue` items gain `more` (secondary actions) and `dueMs`. `action.also` and `action.patch` are added on Done.
- `window.JobBoredRecruiterStrip.nextStep(data)`: the engine-first sentence for a row with a `jobKey`.

## Baselines refreshed

None. The visual suite asserts structure and has no pixel baselines. Screenshots for review are in the session scratchpad (`today-1440.png`, `today-375.png`, `more-375.png`).

## Handoffs

| Lane | File | Change | API |
|---|---|---|---|
| D | `pipeline.js:954` | TR-23: drop `role="button"` from `.pipe-sticker`; make the title a real button with the label "Open dossier" instead of "open letter". | Keep `data-stable-key` on the article; lane C's focus return targets `.pipe-sticker[data-stable-key]`. |
| D | `ingest-url-flow.js` | Provide `JobBoredIngest.openManual({ url, title, company, location })`. Optionally add `JobBoredIngest.openAddJob()` to open the URL intake without the pipeline region. | The chrome feature-detects both. Without them it switches to Pipeline and clicks `[data-action="add-job-url"]`. |
| D | `flowing-writes.js:543` | `if (!jobKey …) return` drops a numeric `0`. Today sends string keys, but other callers may not. `writeColumn` does not update `pipelineData`, so Today patches its own rows. | none |
| D | `submission-flow.js` | MP-07: add Add to calendar in Mark submitted. | `JobBoredToday.data.buildIcs({ date, title, company, jobKey, summary })` |
| E | `role-case-model.js:135` | TR-14: the People "Next move" should read `JobBoredRecruiterStrip.nextStep({ jobKey, contact, reply, followUp })` so it says what Today says. | `nextStep` (added) |
| E | `scribe.js` | TA-09: keep `[data-region="scribe"]` hidden until `binding.bound`. The region already renders only in the Dossier view. | none |
| E | `role-case.css:152` | AX-25: wrap the stage stepper at 375. | none |
| F | `app-bootstrap.js` / `sheets-*` | Emit `jb:data:loading` before the first load, then `jb:data:loaded` or `jb:data:load-failed` on `document`. Today and the Brief show "Loading your pipeline…" and never show empty copy after a failed load. | events |
| owner of `flowing-store.js` | `flowing-store.js:182` | Optional. `setOpen(key)` sends no event when `key` is already open. The chrome now covers this by wrapping `openRole.set` (fix round 1), so nothing is broken. A `jb:role:reopened` event from the store would let the chrome drop the wrapper. | `jb:role:reopened` `{ jobKey }` (proposed) |
| A | `jb-v2-legacy-hide.css:84-89` | That sheet sets every region to `display:block !important` behind `:has(#dashboard…)`. The view rule therefore needs `!important` and one extra type selector to win. When C4 retires or renames the sheet, the view rule in `flowing-chrome.css` can drop both. | none |

## Floor (worktree root, after the lane A C2 merge, HEAD 93587e7 plus this report)

Logs are in `~/Job-Bored.worktrees/.ux01-run/C-f-*.log`. The baseline before any change was the same suites, all green (3057 unit, 11 smoke, 13 journey, 37 visual).

```
npm run lint:repo          lint:tokens ok: 35 sheet(s), 0 new finding(s), 0 brace error(s)   EXIT 0
npm run typecheck:repo     > tsc --noEmit --project server/tsconfig.json                     EXIT 0
npm test                   ℹ tests 3082 · ℹ pass 3081 · ℹ fail 0 · ℹ skipped 0 · ℹ todo 1  EXIT 0
npm run test:contract:all  OK integrations/openclaw-command-center/SKILL.md                  EXIT 0
npm run test:e2e-smoke     11 passed (15.2s)                                                 EXIT 0
npm run test:e2e-journey   20 passed (25.1s)                                                 EXIT 0
npm run test:e2e-visual    37 passed (1.0m)                                                  EXIT 0
```

`npm test` ends by printing a `deepStrictEqual` diff from a test that reports expected output. It did the same on the untouched baseline, and the run exits 0 with 0 failures. The one `todo` is pre-existing.

Not verified: a live signed-in run against a real Sheet. Everything above ran through the hermetic harness with fictional rows.

## Verification · floor (C-r1)

Verifier: fresh Opus context, independent of the lane author. Workspace `ux01-shell-today` at HEAD 5ab8a57 (branch feat/ux01-shell-today), 2026-09-25. Logs: `Job-Bored.worktrees/.ux01-run/C-r1-floor/<n>.log`. No retries needed; no flaky specs.

| # | Command | Result | Counts |
|---|---|---|---|
| 1 | `npm run lint:repo` | PASS (exit 0) | eslint clean; lint:skills OK; lint:tokens 35 sheets, 0 new findings |
| 2 | `npm run typecheck:repo` | PASS (exit 0) | tsc (browser-use-discovery, server) + all node --check clean |
| 3 | `npm test` | PASS (exit 0) | 3082 tests: 3081 pass, 0 fail, 1 todo |
| 4 | `npm run test:contract:all` | PASS (exit 0) | 12 OK checks |
| 5 | `npm run test:e2e-smoke` | PASS (exit 0) | 11 passed |
| 6 | `npm run test:e2e-journey` | PASS (exit 0) | 20 passed |
| 7 | `npm run test:e2e-visual` | PASS (exit 0) | 37 passed |

Note on #3: the one todo is `persists and can remove the canonical submission evidence record` (tests/submission-record-audit.test.mjs:78), marked todo "blocked on the canonical-ownership gate"; its assertion trace prints but it does not count as a failure.

### Tails

```
[1]  lint:tokens ok: 35 sheet(s), 0 new finding(s), 0 brace error(s) EXIT=0 
[2] EXIT=0
[3]
ℹ tests 3082
ℹ suites 745
ℹ pass 3081
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
EXIT=0
[4]  OK integrations/openclaw-command-center/SKILL.md EXIT=0 
[5]   11 passed (13.9s) EXIT=0 
[6]   20 passed (24.7s) EXIT=0 
[7]   37 passed (1.0m) EXIT=0 
```

## Fix round 1 (independent review findings)

All four findings were correct. Each got a failing test first, then a root-cause fix.

| Finding | Root cause | Fix | Test (red before, green after) |
|---|---|---|---|
| `role.js:560`: the pencil loses focus a tick after it opens the dossier | `focusHeading` ran on every `jb:role:opened` and moved focus to the heading without checking where focus already was. The pencil (`pipeline.js:1517-1518`) puts focus in the title input synchronously, before that tick runs. | `focusHeading` returns early when focus is already inside the role region. A caller that placed focus there did it on purpose. | `shell-today.spec.mjs` "should keep focus in the title input when the card pencil opens the dossier". It was red: after the tick the textarea was "inactive". |
| `flowing-chrome.js:453`: re-opening the role that is already open does nothing | The view follows `jb:role:opened`, and the store sends that only when the key changes. A view pill leaves `openRole` set, so opening the same role again changed nothing and sent no event. | The chrome owns the views, so at mount it wraps `JobBoredFlowing.openRole.set`. A set to the key that is already open, made while another view shows, captures the opener and shows the Dossier view with focus. Callers are unchanged: pipeline cards, the pencil, Today's `openRoleFallback`, and the Brief's `open-dossier`. `pipeline.js` and `flowing-store.js` are not edited. | "should show the dossier again when the role already open is opened from another view" covers the card click again after a pill, then `openRole.set` from Today. It was red: the dossier stayed hidden. |
| `today-data.js:263`: Snooze has no effect on a reply row with Last contact blank | `replyAnswered` needed both R and P, and Snooze writes only P. | With R blank, the reference point is today. A Follow-up Date after today means answered or snoozed. A past or blank one leaves the reply owed. Snooze still writes only P, so it never records a contact that did not happen. | `today-next-step-engine.test.mjs` "should take a snoozed reply out of the reply band when Last contact is blank" was red. It has a companion test for a past follow-up that stays owed, and an e2e test that goes through Snooze, then "In 2 days", with one P write. |
| `dawn.js:156`: the Brief's empty-leads card ignores `jb:data:*` | Only `today.js` listened for the load contract. | `dawn.js` keeps the same `dataState`, bound on `document` at load. The empty-leads card shows a loading or failed status in those states, with no first-run buttons. `.brief-leads-empty__hint` in `dawn.css` uses tokens only. | "should not call a loading or failed pipeline empty in the Brief" was red: the copy said "No active roles" while loading. |

Files touched in this round: `role.js`, `flowing-chrome.js`, `today-data.js`, `dawn.js`, `dawn.css`, `tests/today-next-step-engine.test.mjs`, `tests/e2e-journey/shell-today.spec.mjs`, and this report. Contracts touched: `JobBoredFlowing.openRole.set` is wrapped with the same signature and return value, so the store's event contract is unchanged. The `jb:data:*` contract is read only. There were no Sheet writes beyond the existing `followupAt` path. Baselines refreshed: none.

### Floor (fix round 1, from the worktree root)

Logs: `~/Job-Bored.worktrees/.ux01-run/C-r1-floor-<cmd>.log`, and the summary is in `C-r1-floor-summary.log`.

```
lint:repo          exit=0   lint:tokens ok: 35 sheet(s), 0 new finding(s), 0 brace error(s)
typecheck:repo     exit=0
test               exit=0   ℹ tests 3084 · ℹ pass 3083 · ℹ fail 0 · ℹ todo 1 (pre-existing)
test:contract:all  exit=0   OK integrations/openclaw-command-center/SKILL.md
test:e2e-smoke     exit=0   11 passed (14.1s)
test:e2e-journey   exit=0   24 passed (28.8s)
test:e2e-visual    exit=0   37 passed (1.0m)
```

Not verified: a live signed-in run against a real Sheet (hermetic harness only).

## Verification · floor (C-r2)

Independent verifier (a fresh Opus context), run on 2026-09-25 against `feat/ux01-shell-today` @ `75c1789`, from the worktree root. The seven commands ran in order. Logs: `~/Job-Bored.worktrees/.ux01-run/C-r2-floor/<n>.log`. No retries were needed and no flaky tests were seen.

| # | Command | Result | Counts |
|---|---|---|---|
| 1 | `npm run lint:repo` | PASS (exit 0) | lint:tokens ok: 35 sheet(s), 0 new finding(s), 0 brace error(s) |
| 2 | `npm run typecheck:repo` | PASS (exit 0) | tsc browser-use-discovery + server clean; all node --check ok |
| 3 | `npm test` | PASS (exit 0) | tests 3084 · pass 3083 · fail 0 · skipped 0 · todo 1 |
| 4 | `npm run test:contract:all` | PASS (exit 0) | 12 OK lines, 0 FAIL |
| 5 | `npm run test:e2e-smoke` | PASS (exit 0) | 11 passed (15.5s) |
| 6 | `npm run test:e2e-journey` | PASS (exit 0) | 24 passed (31.3s) |
| 7 | `npm run test:e2e-visual` | PASS (exit 0) | 37 passed (1.0m) |

Note on #3: the runner prints one "✖ failing tests" entry. It is the `todo` test `tests/submission-record-audit.test.mjs:17`, "persists and can remove the canonical submission evidence record # blocked on the canonical-ownership gate". A todo does not count as a failure, and the run reports fail 0.

Tails:

```
[1] lint:tokens ok: 35 sheet(s), 0 new finding(s), 0 brace error(s)
[2] > tsc --noEmit --project server/tsconfig.json   (no output, exit 0)
[3] ℹ tests 3084 / ℹ suites 745 / ℹ pass 3083 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 1 / ℹ duration_ms 14020.8
[4] OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
    OK integrations/openclaw-command-center/SKILL.md
[5]   11 passed (15.5s)
[6]   ✓ 24 tests/e2e-journey/shell-today.spec.mjs:327:1 › should move a snoozed reply with no Last contact out of You owe an answer (956ms)
      24 passed (31.3s)
[7]   ✓ 37 tests/e2e-visual/shell-structure.spec.mjs:310:3 › ... dock the footer at the bottom of the viewport, not the bottom of the card (1.0s)
      37 passed (1.0m)
```

Verdict: green. All seven floor commands pass.

## Fix round 2 (independent review finding)

The finding was correct. Failing test first, then a root-cause fix.

| Finding | Root cause | Fix | Test (red before, green after) |
|---|---|---|---|
| `flowing-chrome.css:624`: Cmd/Ctrl+K does nothing on Today and the Dossier | C18 hides the pipeline region with display:none on those views. `pipeline.js:1494-1500` binds the hotkey document-wide, calls preventDefault, then focuses an input inside the hidden region, so focus lands nowhere and the browser shortcut is swallowed. Nothing showed the Pipeline view first. | `flowing-chrome.js` adds `handleSearchHotkey`, a keydown listener on `window` in the capture phase, bound in `mount` and removed in `unmount`. On Cmd/Ctrl+K (no Alt, not already defaultPrevented), when `JobBoredPipeline.focusSearch` and the pipeline region exist, it calls `showView("pipeline")` before `pipeline.js`'s bubble-phase handler runs. That handler then focuses the now-visible input as before. `pipeline.js` is not edited. | `shell-today.spec.mjs` "should focus the pipeline search on Cmd/Ctrl+K from the Today and Dossier views". It was red: the pipeline region stayed hidden after the keypress on Today. |

Files touched in this round: `flowing-chrome.js`, `tests/e2e-journey/shell-today.spec.mjs`, and this report. Contracts touched: none. The hotkey behaviour of `JobBoredPipeline.focusSearch` is unchanged and only read. Baselines refreshed: none. Handoffs: none.

### Floor (fix round 2, from the worktree root)

Log: `~/Job-Bored.worktrees/.ux01-run/lane-c-r3-floor.log`. The seven commands ran chained with &&, and the chain ended with FLOOR_EXIT=0.

```
lint:repo          exit=0   lint:tokens ok: 35 sheet(s), 0 new finding(s), 0 brace error(s)
typecheck:repo     exit=0
test               exit=0   ℹ tests 3084 · ℹ pass 3083 · ℹ fail 0 · ℹ todo 1 (pre-existing)
test:contract:all  exit=0   OK integrations/openclaw-command-center/SKILL.md
test:e2e-smoke     exit=0   11 passed (15.6s)
test:e2e-journey   exit=0   25 passed (33.8s)   (24 before, plus the new hotkey test)
test:e2e-visual    exit=0   37 passed (1.1m)
```

Not verified: the hotkey on a real macOS Chrome session with a real Sheet. Only the hermetic harness was used, where ControlOrMeta+k is the platform modifier.

## Verification · floor (C-r3)

Verifier: fresh Opus context, independent of the author. HEAD 62b7cb4 on feat/ux01-shell-today, 2026-09-25. Logs: `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/C-r3-floor/<n>.log`. No retries used; no flaky specs.

| # | Command | Result | Counts |
|---|---|---|---|
| 1 | npm run lint:repo | PASS (exit 0) | lint:tokens 35 sheets, 0 new findings |
| 2 | npm run typecheck:repo | PASS (exit 0) | tsc clean |
| 3 | npm test | PASS (exit 0) | 3084 tests, 3083 pass, 0 fail, 1 todo |
| 4 | npm run test:contract:all | PASS (exit 0) | 12 OK checks, 0 failures |
| 5 | npm run test:e2e-smoke | PASS (exit 0) | 11 passed |
| 6 | npm run test:e2e-journey | PASS (exit 0) | 25 passed |
| 7 | npm run test:e2e-visual | PASS (exit 0) | 37 passed |

Green: all seven commands passed.

Note: npm test lists one "✖" under "failing tests"; it is the todo-marked test "persists and can remove the canonical submission evidence record" (# blocked on the canonical-ownership gate), counted as todo 1, fail 0.

Tails:

```
[3] ℹ tests 3084
ℹ suites 745
ℹ pass 3083
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 13939.586708
[5]   11 passed (14.8s)
[6]   25 passed (30.4s)
[7]   37 passed (1.1m)
```

## Merge · feat/ux-zero-to-one into feat/ux01-shell-today (2026-09-25)

Merge commit d97fa6f. One text conflict, in `index.html` `<body>` (this lane's region): lane A's C4 deleted the lattice region and `lattice.js`; this lane had only given that section an id and label. Resolved by taking lane A's deletion. No `<head>` hunk conflicted. `tests/e2e-journey/critical-journey.spec.mjs` auto-merged. No baselines conflicted or were refreshed.

Leftover, harmless: `flowing-chrome.js` `VIEW_REGIONS.pipeline` still lists `"lattice"` and `flowing-chrome.css` still has two `[data-region="lattice"]` selectors; both are no-ops now the region is gone. Left for a tidy commit.

Contracts touched by the merge: none. data-action, data-stable-key, expandedJobKeys, updateJobStatus and schemas/pipeline-row.v1.json are unchanged by the resolution.

### Floor after the merge (HEAD d97fa6f)

Logs: `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/laneC-merge-floor-<command>.log`.

| Command | Result | Counts |
|---|---|---|
| npm run lint:repo | PASS (exit 0) | lint:tokens 34 sheets, 0 new findings |
| npm run typecheck:repo | PASS (exit 0) | clean |
| npm test | PASS (exit 0) | 3049 tests, 3048 pass, 0 fail, 1 todo |
| npm run test:contract:all | PASS (exit 0) | all OK |
| npm run test:e2e-smoke | **FAIL (exit 1)** | 11 passed, 4 failed |
| npm run test:e2e-journey | PASS (exit 0) | 25 passed |
| npm run test:e2e-visual | PASS (exit 0) | 37 passed |

Floor is **not green**. The 4 smoke failures are all of `tests/e2e-smoke/board-apply.spec.mjs` (lane D, C17/C19), each timing out on `page.locator('[data-region="pipeline"]').scrollIntoViewIfNeeded()` with "element is not visible".

Cause (confirmed): this lane's C18 makes views exclusive and Today the default, so the pipeline region is hidden until the Pipeline view is shown. Lane D's `bootBoard()` seeds rows and adds `jb-v2` but never selects the Pipeline view. Proof: adding the one line below after `document.body.classList.add("jb-v2");` in `bootBoard()` made all 4 pass (4 passed, 2.4s). That edit was reverted, not committed, because the file is lane D's.

### Handoff (lane D, or the integrator)

- File: `tests/e2e-smoke/board-apply.spec.mjs`, `bootBoard()` page.evaluate.
- Change: after `document.body.classList.add("jb-v2");` add
  `if (window.JobBoredFlowing && window.JobBoredFlowing.views) window.JobBoredFlowing.views.show("pipeline", { focus: false });`
- API used: `window.JobBoredFlowing.views.show(id, { focus })` (lane C, C18), already on this branch.

```
[test:e2e-smoke]
  4 failed
  11 passed (6.3m)
EXIT 1
[test]
ℹ tests 3049
ℹ pass 3048
ℹ fail 0
ℹ todo 1
[test:e2e-journey]  25 passed (28.9s)
[test:e2e-visual]   37 passed (1.0m)
```
