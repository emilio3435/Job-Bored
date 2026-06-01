# Follow-up Cursor Swarm Instructions - 2026-05-31

## Orchestrator pushback

Current integration state:

- Branch: `refactor/app-js-decompose`
- Path: `/Users/emilionunezgarcia/Job-Bored`
- `app.js`: 10501 LOC
- `index.html`: 3953 LOC
- `style.css`: 13209 LOC
- Track B (`refactor/index-html-decompose`) is merged and green.
- Next merge order: C (`refactor/style-css-split`) then A (`refactor/app-js-decompose-app-config-core-followup`), then fresh app-js extraction branches.

Use `<1000 LOC` as the end-state target, not as a single worker prompt. The safe next instruction is: each worker extracts one coherent module on one owner branch, runs full `npm test`, and reports exact LOC removed. Reaching `<1000 LOC` from 10501 LOC requires multiple serialized merges and will collide if every worker edits `app.js` broadly.

## Dispatch map

| Agent / track | Path | Branch | Instruction |
|---|---|---|---|
| Track B index | `/Users/emilionunezgarcia/Job-Bored-worktrees/index-html-decompose` | `refactor/index-html-decompose` | Park. This branch is merged as `a432bd2`. |
| Track C CSS | `/Users/emilionunezgarcia/Job-Bored-worktrees/style-css-split` | `refactor/style-css-split` | Continue and make merge-ready next. |
| Track A config follow-up | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-app-config-core-followup` | `refactor/app-js-decompose-app-config-core-followup` | Rebase after C lands; run full tests; merge after C. |
| Stale core-host | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-core-host` | `refactor/app-js-decompose-core-host` | Park. Dirty old-base bridge work is already integrated. |
| Stale keyword-match | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-keyword-profile-match` | `refactor/app-js-decompose-keyword-profile-match` | Park. Dirty old-base keyword extraction is already integrated. |
| Future app-js lanes | New worktrees from current integration | Fresh `*-v2` branches | Start only after C and A are landed or explicitly sequenced by the orchestrator. |

## Prompt: Track C CSS split

Goal: Finish the CSS split branch so `style.css` is under 5000 LOC and can merge after Track B.

Success means:
- `style.css` is below 5000 LOC.
- The six `css/legacy-*.css` files contain the moved legacy sections.
- `index.html` edits are limited to `<head>` stylesheet links for the legacy CSS files.
- `tests/onboarding-profile-persistence.test.mjs` reads the correct CSS source after the move.
- `npm test` passes on `refactor/style-css-split`.

Stop when: The branch is clean, committed, and full `npm test` is green, or when the exact blocker is reported with file paths and failing output.

Start from:

```bash
cd /Users/emilionunezgarcia/Job-Bored-worktrees/style-css-split
git status --short --branch
git rebase refactor/app-js-decompose
```

Use the existing `css/legacy-*.css` files already committed on this branch. Move matching sections out of `style.css` into those files, add stable `<link>` tags in `index.html` head, and keep selectors unchanged. Run `git diff --check`, scan for conflict markers, then run full `npm test`.

## Prompt: Track A config-core follow-up

Goal: Make the config-core follow-up branch merge-ready after Track C lands.

Success means:
- The branch keeps its scope to `app.js` and `tests/settings-sheet-id-validation.test.mjs`.
- Sheet ID parsing delegates through `window.JobBoredApp.configCore`.
- `npm test` passes on `refactor/app-js-decompose-app-config-core-followup`.
- The branch is rebased onto the latest integration branch after C merges.

Stop when: The branch is clean, committed, and full `npm test` is green, or when a concrete conflict/test blocker is reported.

Start from:

```bash
cd /Users/emilionunezgarcia/Job-Bored-worktrees/appjs-app-config-core-followup
git status --short --branch
git rebase refactor/app-js-decompose
npm install --prefix server
npm test
```

Keep this branch small. It is a merge-readiness branch, not the next large extraction lane.

## Prompt: App-js discovery status lane

Goal: Extract discovery pending-setup handoff and run-status polling logic from `app.js` into one classic global module.

Success means:
- Create a fresh worktree from current `refactor/app-js-decompose`.
- Branch name: `refactor/app-js-decompose-discovery-status-handoff-v2`.
- New module: `discovery-status-handoff.js`.
- `app.js` retains thin wrappers and host wiring only for the moved logic.
- `index.html` adds one script tag in the existing app-js script sequence.
- Focused tests pass: `tests/discovery-cold-start-handoffs.test.mjs`, `tests/discovery-run-status-polling.test.mjs`, `tests/ingest-url-endpoint-resolution.test.mjs`.
- Full `npm test` passes before the branch is offered for merge.

Stop when: The branch removes a coherent status/handoff block from `app.js`, passes tests, and reports before/after `wc -l app.js`.

Use this branch setup:

```bash
git worktree add /Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-status-handoff-v2 \
  -b refactor/app-js-decompose-discovery-status-handoff-v2 \
  refactor/app-js-decompose
cd /Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-status-handoff-v2
```

Use the old `refactor/app-js-decompose-discovery-status-handoff` branch only as a reading reference. Reimplement against current integration.

## Prompt: App-js Apps Script and relay lane

Goal: Extract Apps Script deploy, public-access probing, Cloudflare relay command helpers, and related setup-guide handlers from `app.js`.

Success means:
- Create a fresh worktree from current `refactor/app-js-decompose`.
- Branch name: `refactor/app-js-decompose-apps-script-relay-v2`.
- New module: `apps-script-relay-helpers.js` or `discovery-setup-actions.js`, whichever matches the final owned surface.
- `app.js` retains thin wrappers and host wiring only.
- `index.html` adds one script tag in the existing app-js script sequence.
- Focused tests pass for Apps Script, relay, discovery wizard verify, and setup doctor surfaces.
- Full `npm test` passes before merge handoff.

Stop when: One coherent setup/deploy/relay block is out of `app.js`, the branch is clean, and the before/after LOC delta is reported.

Use old branches `refactor/app-js-decompose-apps-script-relay-helpers` and `refactor/app-js-decompose-scraper-ats-config` as references only. Start from current integration.

## Prompt: App-js discovery drawer lane

Goal: Extract discovery drawer state, UI event binding, AI suggestion calls, subtab handling, and run button wiring from `app.js`.

Success means:
- Create a fresh worktree from current `refactor/app-js-decompose`.
- Branch name: `refactor/app-js-decompose-discovery-drawer-v2`.
- New module: `discovery-drawer.js`.
- `app.js` retains thin wrappers and initialization calls only.
- `index.html` adds one script tag after the discovery support modules and before `app.js`.
- Focused tests pass: `tests/discovery-drawer-payload.test.mjs`, `tests/discovery-payload.test.mjs`, `tests/discovery-payload-sanitization.test.mjs`.
- Full `npm test` passes before merge handoff.

Stop when: The drawer module owns its state and event binding, the branch is clean, and `app.js` LOC drops by a meaningful chunk.

Coordinate this lane after C and A are resolved because it touches `index.html` script order and many discovery call sites.

## Prompt: App-js ingest URL lane

Goal: Extract Add-from-URL and manual-ingest flow logic from `app.js` into one module.

Success means:
- Create a fresh worktree from current `refactor/app-js-decompose`.
- Branch name: `refactor/app-js-decompose-ingest-url-flow-v2`.
- New module: `ingest-url-flow.js`.
- Moved functions cover endpoint resolution, progress labels, duplicate focusing, manual modal behavior, async polling, and post-ingest refresh/enrichment hooks.
- `app.js` retains thin wrappers and host wiring only.
- `index.html` adds one script tag before `app.js`.
- Focused tests pass: `tests/ingest-url-endpoint-resolution.test.mjs`, `tests/discovery-drawer-payload.test.mjs`, and any ingest/manual-entry tests found by `rg "ingest|Add job from URL|manual" tests`.
- Full `npm test` passes before merge handoff.

Stop when: The ingest module owns the full Add-from-URL flow, the branch is clean, and the LOC delta is reported.

Coordinate this lane after discovery status/drawer lanes are sequenced, because it shares transport helpers and run-status behavior.

## Prompt: QA reviewer

Goal: Review each branch before the orchestrator merges it into `refactor/app-js-decompose`.

Success means:
- Confirm the branch owns exactly the files named in its prompt.
- Confirm `npm test` passed after server dependencies were installed in that worktree when needed.
- Confirm `git diff --check` is clean.
- Confirm conflict marker scan is clean with `rg -n "^(<<<<<<<|=======|>>>>>>>)" -g '!node_modules' -g '!server/node_modules'`.
- Report findings first with file/line references.

Stop when: The branch is marked merge-ready or blocked with exact failures.

## Prompt: stale worktree cleanup

Goal: Keep stale old-base worktrees from re-entering the integration queue.

Success means:
- `appjs-core-host` is marked parked; its dirty bridge diff is treated as already integrated.
- `appjs-keyword-profile-match` is marked parked; its dirty keyword extraction is treated as already integrated.
- Any future app-js extraction starts from current `refactor/app-js-decompose` with a `-v2` branch name.
- The status doc records parked branches separately from active merge candidates.

Stop when: The parked/stale list is documented and no worker is using those worktrees for new commits.
