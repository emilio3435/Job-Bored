# UX01 cleanup lane cC: shell handoffs

Branch `feat/ux01-cleanup-shell`, cut from `feat/ux-zero-to-one` at e37f2f4. Built by Opus 5.5 (medium effort) on 2026-09-25. Not pushed.

This lane picks up the handoffs that lanes A, C and D left for the recruiter strip, the top bar, Today, the Brief and role.css.

## What changed for the user

- **Card strips show the real stage.** The dot on each card's recruiter strip now shows that card's stage. Before, every card showed an orange "applied" dot.
- **No more "Unknown ×4".** When nothing is known about the recruiter side, the strip shows a single Next action line. The four Unknown facts are no longer rendered at all, rather than hidden with CSS.
- **Follow-ups read relative.** A follow-up date now shows as "today", "tomorrow", "in 2 days" or "3 days overdue", with the ISO date kept in a `<time datetime>` element. When it is overdue, the strip gets `data-flag="overdue"`, the date turns amber (warn), and the Next action becomes "Follow-up N days overdue".
- **Add job always opens something.** If the top-bar link intake fails (there is no opener, it throws, or the click leaves no URL dialog open), the manual form opens in its warn state, with any known link filled in.
- **One look for the main action.** Today's row actions and the Brief's buttons now use the C3 kit values: a navy primary (`--jb-action`), the kit's secondary and ghost, a 10 px radius, 13/600 type and the shared focus ring. The Brief's primary is no longer a mint pill.
- **Less dead CSS.** The Dossier's empty shelf is now styled from `flowing-chrome.css`. The unused `.jb-role-divider` rules are deleted.

## Change status

| id | status | notes |
|---|---|---|
| TR-17 / C19 | done | `recruiter-strip.js`: the stage comes from `vm.stage` (or `job.stage`). If neither is set, the dot renders `hidden` and a microtask binds it to the mounted card's `closest("[data-stage]")`. If no card is found, the dot is removed. It is never hard-coded. When all four facts are unknown, the strip renders only the dot and the Next action line (`data-facts="none"`). If some facts are known, the unknown ones still say Unknown. |
| TR-16 / C19 | done | ISO follow-ups are shown as relative text in a `<time datetime>` element. Past-due dates set `data-flag="overdue"` on the strip root and on the `<time>`. `nextAction` now puts "Follow-up N days overdue" first. If the engine step from `today-data.js` exists, it still wins (TR-14). Dates that are not ISO are shown as written. |
| C5 | done | `flowing-chrome.js` `openAddJobUrl(url?)`: if the link intake fails, it calls `JobBoredIngest.openManual({url, tone:"warn", message})`, feature-detected. If there is no ingest API, it falls back to showing Pipeline. |
| DS-05 / C3 | partial | `today.css` and `dawn.css` rules now carry the `.jb-btn` / `.jb-btn--primary` / `--secondary` / `--ghost` values exactly, except Today keeps its 44 px (2.75rem) touch height. **Not done:** adding the `jb-btn` classes to the markup. The markup lives in `today.js` and `dawn.js`, which this lane does not own. See Handoffs. |
| DS-09 / C4 | partial | `.jb-shelf` / `.jb-hint` moved into `flowing-chrome.css`, scoped under `body.jb-v2 .jb-shelf`, using tokens-v2 names only and no hex fallbacks. The dead `.jb-role-divider` block is deleted from role.css. **role.css and its `<head>` link are kept.** The task assumed role.css held only the shelf, but that premise is false. About 1,000 live lines remain: the `.dossier` frame (rendered by role.js; `tests/role-case-a11y.test.mjs` asserts its gutter), the `.brief-materials__*` panel that role-materials.js paints into the Case's materials mount, and the `.stepper` / `.writeback` / `.chip` rules. Deleting the file would unstyle live UI. See Handoffs. |

## Tests (red first)

- `tests/recruiter-strip-card.test.mjs`: 6 new cases covering the collapse, partial unknowns, the stage from the view model, the stage from the card's `data-stage`, relative dates with the overdue flag, overdue-first next action, and unparseable dates. 5 of them failed before the change.
- `tests/recruiter-strip-dossier.test.mjs`: the byte-identical card snapshot was **re-captured on purpose** for TR-16/17, and the reason is recorded in its comment. Before: a hard-coded `stage="applied"` dot and four Unknown facts. After: the collapsed line, a hidden-until-bound dot, and a relative `<time>`. The follow-up case now pins `now` so the result is deterministic.
- `tests/e2e-journey/shell-today.spec.mjs`: "should open the manual entry, warned, when the top-bar link intake cannot open (C5)". It failed before the change and passes after.
- `tests/today-dawn-kit-buttons.test.mjs` (new, DS-05): checked red against the old CSS (0/2) and green after (2/2).
- `tests/role-shelf-css-home.test.mjs` (new, DS-09).
- Visual baselines: none refreshed. `tests/e2e-visual` has no pixel baselines for Today or the Brief. Visual before/after for DS-05: the Brief primary changes from a mint pill (radius 999, 12px/500) to a navy fill (radius 10, 13px/600). Today's actions change from radius 6 with an outline focus ring and a `--jb-line-strong` secondary border to radius 10, the `--jb-shadow-focus` ring and a `--jb-line` border.

## Files touched

Owned: `recruiter-strip.js`, `recruiter-strip.css`, `flowing-chrome.js`, `flowing-chrome.css`, `today.css`, `dawn.css`, `role.css`. Tests: the five files listed above. Not touched: `index.html` (the role.css link stays, for the reason in the DS-09 row).

## Contracts

Untouched: `data-action`, `data-stable-key`, `expandedJobKeys`, `updateJobStatus(dataIndex, stage)` and `schemas/pipeline-row.v1.json`. The `JobBoredRecruiterStrip` API (`renderCompact`, `nextAction`, `nextStep`) keeps its shape. `nextAction` gains an overdue branch that applies only when the input carries `daysLate > 0`, so role-case-model's callers are unaffected. `JobBoredFlowing.addJob.openUrl` now takes an optional `url`.

## Handoffs

| to | file | ask |
|---|---|---|
| D (pipeline owner) | `pipeline.js` ~1138 | Pass `stage: stageKey` to `renderCompact` so the dot is bound synchronously instead of through the microtask. Also consider mirroring the strip's `data-flag="overdue"` onto the `.pipe-sticker` (TR-16 asks for the flag on the card; this lane can only set it inside the strip). |
| C / Today owner | `today.js` | Add `jb-btn jb-btn--primary` (or `--secondary` / `--ghost`) next to `today-item__action*`. After that, today.css can shrink to the touch-height override. |
| C / Brief owner | `dawn.js` 88, 89, 195, 196 | Add `jb-btn jb-btn--primary` / `jb-btn jb-btn--secondary` to `.brief-btn*`. |
| E (dossier) | `role.css` → `role-case.css` / a `role-materials.css` | Move the live `.dossier` frame rule (and update the role-case-a11y assertion), the `.brief-materials__*` panel and the `.stepper` / `.writeback` / `.chip` rules. Then delete role.css and its `index.html` `<head>` link (DS-09 completion). |
| A (tokens) | `tools/lint-tokens.baseline.json` | role.css's colour count dropped (the shelf and divider hex fallbacks are gone). Run `npm run lint:tokens -- --update-baseline` to lock in the lower count. |

## Floor

All seven commands ran in this worktree on the final code commit. Logs are in `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/cC/`.

```
npm run lint:repo          lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)   EXIT 0
npm run typecheck:repo     tsc --noEmit --project server/tsconfig.json                         EXIT 0
npm test                   ℹ tests 3070 · pass 3069 · fail 0 · cancelled 0 · skipped 0 · todo 1   EXIT 0
npm run test:contract:all  OK integrations/openclaw-command-center/SKILL.md                    EXIT 0
npm run test:e2e-smoke     17 passed (20.4s)                                                   EXIT 0
npm run test:e2e-journey   26 passed (29.4s)                                                   EXIT 0
npm run test:e2e-visual    37 passed (1.0m)                                                    EXIT 0
```

The `npm test` log ends with an `ERR_ASSERTION` block. That block is stderr from a test that expects a failure; the summary is 0 failures. The one `todo` was already there before this lane.

## Verification · floor (cC-r1)

An independent Opus verifier ran this in a fresh context at commit `b480cc2f`, with a clean tree. All seven commands ran in order with no retries, no `--grep`, no `--shard` and no `--update-snapshots`. Logs are in `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/cC-r1/`.

| command | result | counts |
|---|---|---|
| `npm run lint:repo` | EXIT 0 | lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s) |
| `npm run typecheck:repo` | EXIT 0 | browser-use-discovery and server tsc are clean, and every `node --check` passes |
| `npm test` | EXIT 0 | tests 3070 · pass 3069 · fail 0 · cancelled 0 · skipped 0 · todo 1 |
| `npm run test:contract:all` | EXIT 0 | ends `OK integrations/openclaw-command-center/SKILL.md` |
| `npm run test:e2e-smoke` | EXIT 0 | 17 passed (17.8s) |
| `npm run test:e2e-journey` | EXIT 0 | 26 passed (28.6s) |
| `npm run test:e2e-visual` | EXIT 0 | 37 passed (60.0s) |

Verdict: **green**. No test failed and none was flaky. The `npm test` log ends with an `ERR_ASSERTION` stderr block from a test that expects a failure. The summary still shows 0 failures.

## Fix round 2 (cC-r2) · review finding on recruiter-strip.js:55

**Finding (confirmed):** the stage whitelist only knew the dot token `phone`, but pipeline.js writes the canonical `data-stage="phone-screen"`. As a result, `bindStage` removed the `<jb-stage-dot>` on every Phone Screen card. A `vm.stage` or `job.stage` holding the Sheet label `Phone Screen` hit the same miss. The earlier test only used `data-stage="phone"`, so it could not catch this.

**Root-cause fix (commit `13767695`):** `stageKey()` now normalises through `root.JobBoredStages.toDotKey`, which it reads lazily at call time because script order is not guaranteed. If the registry is missing, it falls back to a local map: lowercase, collapse whitespace and underscores to `-`, then `phone-screen`/`phonescreen` → `phone`. Whitelist lookups now use `hasOwnProperty`.

**Tests written first (all 3 failed before the fix):**
- A card with `data-stage="phone-screen"` and no registry keeps its dot, with `stage="phone"`.
- A card with `data-stage="phone-screen"` and the real stage-registry.js loaded gets its dot through `toDotKey`.
- A vm stage of `Phone Screen` or `phone-screen` renders `<jb-stage-dot stage="phone"`.

Items (a) to (e) keep the status recorded above. Only (a) changed in this round, and it remains **done**.

### Floor (cC-r2), run on `13767695`

Logs are in `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/cC-r2-*.log`.

```
npm run lint:repo          lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)   EXIT 0
npm run typecheck:repo     tsc --noEmit --project server/tsconfig.json                         EXIT 0
npm test                   ℹ tests 3073 · pass 3072 · fail 0 · cancelled 0 · skipped 0 · todo 1   EXIT 0
npm run test:contract:all  OK integrations/openclaw-command-center/SKILL.md                    EXIT 0
npm run test:e2e-smoke     17 passed (17.3s)                                                   EXIT 0
npm run test:e2e-journey   26 passed (29.6s)                                                   EXIT 0
npm run test:e2e-visual    37 passed (1.0m)                                                    EXIT 0
```

As before, the `npm test` log ends with an expected-failure `ERR_ASSERTION` stderr block, and its summary shows 0 failures. No visual baseline was refreshed.

## Verification · floor (cC-r2)

An independent Opus verifier ran this in a fresh context on `3bcf9da1`, with fix commit `13767695` as its parent. It edited no product code or tests. Logs are in `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/cC-r2/`.

| command | result | counts |
|---|---|---|
| `npm run lint:repo` | EXIT 0 | lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s) |
| `npm run typecheck:repo` | EXIT 0 | browser-use-discovery and server tsc are clean |
| `npm test` | EXIT 0 | tests 3073 · suites 737 · pass 3072 · fail 0 · cancelled 0 · skipped 0 · todo 1 |
| `npm run test:contract:all` | EXIT 0 | contract, ATS, pipeline, pipeline-update and skills lint all OK |
| `npm run test:e2e-smoke` | EXIT 0 | 17 passed (17.2s) |
| `npm run test:e2e-journey` | EXIT 0 | 26 passed (28.3s) |
| `npm run test:e2e-visual` | EXIT 0 | 37 passed (59.5s) |

Verdict: **green**. Nothing failed, nothing was retried, and nothing was flaky. No `--grep`, `--shard` or `--update-snapshots` flag was used.

The `npm test` log ends with an `ERR_ASSERTION` stderr block. It comes from the todo test `tests/submission-record-audit.test.mjs:17`, which the runner marks as blocked on the canonical-ownership gate, and it is not counted as a failure.

Tails:

```
npm test:            ℹ tests 3073 ℹ pass 3072 ℹ fail 0 ℹ todo 1 ℹ duration_ms 13836
test:contract:all:   OK integrations/openclaw-command-center/SKILL.md
e2e-smoke:           ✓ 17 hermetic-fence.spec.mjs:70:1 … 17 passed (17.2s)
e2e-journey:         ✓ 26 shell-today.spec.mjs:352:1 … 26 passed (28.3s)
e2e-visual:          ✓ 37 shell-structure.spec.mjs:310:3 … 37 passed (59.5s)
```
