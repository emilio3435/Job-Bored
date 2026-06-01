# STATUS — app.js Remainder Teardown Swarm

> Orchestrator ledger. **Last updated:** 2026-06-01 (session 26 — C6 bridge registry dispatched after C5 inspection).
> Branch: `refactor/app-js-decompose` · Integration checkout: `/Users/emilionunezgarcia/Job-Bored`
> Orchestrator surface: **Cursor Agent (Composer 2.5 Fast)** + **Task subagents** + **git worktrees** (no cmux)

## Startup checklist (session 2)

| Step | Result |
|---|---|
| Branch | `refactor/app-js-decompose` ✓ |
| Current dirty files | `M AGENTS.md`, `M CLAUDE.md`, `M package-lock.json` (unstaged local edits/metadata; do not mix into refactor commits) |
| Node / npm | v24.13.0 / 11.13.0 ✓ |
| Baseline `npm test` | **892 pass / 0 fail / 0 skip** (188 suites, ~7.6s) |
| `app.js` LOC (current) | **3,041** (post C5 app bootstrap merge; was 12,456 post Phase 5 cut #1) |
| `SetActiveBranch` | `refactor/app-js-decompose` ✓ |
| Swarm model | Cursor Task subagents per [PROMPT-app-js-remainder-cursor-swarm-orchestrator.md](./PROMPT-app-js-remainder-cursor-swarm-orchestrator.md) |

## Swarm runtime (Cursor)

| Role | subagent_type | model | Status |
|---|---|---|---|
| Orchestrator / integrator | parent Agent | Composer 2.5 Fast | **active** |
| Research | `explore` | composer-2.5-fast | Phase 0 spawned |
| Frontend implementation | `frontend-developer` | claude-opus-4-8-thinking-high | Cut 3 **done** |
| Backend / transport | `backend-developer` | gpt-5.5-extra-high | Phase 1 **done** |
| QA pre-merge | `code-reviewer` | claude-opus-4-8-thinking-high | idle |
| Worktree ops | `shell` | composer-2.5-fast | idle |
| Debug / repair | `debugger` | claude-opus-4-8-thinking-high | idle |

## Parallel refactor coordination (session 7)

Integration checkout is orchestrator-only. Dirty mixed work found on
`refactor/app-js-decompose` was preserved as
`stash@{0}: orchestrator mixed integration WIP before owner branch split`, then
replayed onto owner branches.

| Order | Track | Branch | Worktree | Status | Verification |
|---|---|---|---|---|---|
| 1 | B — index.html decompose | `refactor/index-html-decompose` | `/Users/emilionunezgarcia/Job-Bored-worktrees/index-html-decompose` | **MERGED** `a432bd2` | `npm test` = **894 pass / 0 fail** after `npm install --prefix server` |
| 2 | C — style.css split | `refactor/style-css-split` | `/Users/emilionunezgarcia/Job-Bored-worktrees/style-css-split` | **MERGED** `37241c6` | Branch gate `npm test` = **894 pass / 0 fail**; post-merge integration `npm test` = **894 pass / 0 fail**; `style.css` = **1,872 LOC** |
| 3 | A — app.js follow-up | `refactor/app-js-decompose-app-config-core-followup` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-app-config-core-followup` | **MERGED** `d2d5224` | Branch gate after rebase `npm test` = **894 pass / 0 fail**; post-merge integration `npm test` = **894 pass / 0 fail**; `git diff --check` clean; exact conflict-marker scan clean |
| 4 | A — apps-script relay helpers | `refactor/app-js-decompose-apps-script-relay-helpers` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-apps-script-relay-helpers` | **MERGED** `a2a970d` | Branch gate after rebase `npm test` = **894 pass / 0 fail**; post-merge integration `npm test` = **894 pass / 0 fail**; `app.js` = **10,194 LOC** |
| 5 | A — scraper ATS config | `refactor/app-js-decompose-scraper-ats-config` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-scraper-ats-config` | **MERGED** `2a3fcb5` | Branch gate after rebase `npm test` = **894 pass / 0 fail**; post-merge integration `npm test` = **894 pass / 0 fail**; `git diff --check` clean; exact conflict-marker scan clean; `app.js` = **10,015 LOC** |
| 6 | A — discovery engine state | `refactor/app-js-decompose-discovery-engine-state` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-engine-state` | **MERGED** `7f9a2ee` | Branch gate after rebase `npm test` = **894 pass / 0 fail**; post-merge integration `npm test` = **894 pass / 0 fail**; `git diff --check` clean; exact conflict-marker scan clean; `app.js` = **9,838 LOC** |
| 7 | A — discovery status handoff | `refactor/app-js-decompose-discovery-status-handoff` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-status-handoff` | **MERGED** `942248c` | Branch gate after rebase `npm test` = **894 pass / 0 fail**; post-merge integration `npm test` = **894 pass / 0 fail**; `node --check` clean; `git diff --check` clean; exact conflict-marker scan clean; `app.js` = **9,143 LOC** |
| 8 | A — Apps Script deploy UI | `refactor/app-js-decompose-apps-script-deploy` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-apps-script-deploy` | **MERGED** `07186fc` | Branch gate `node --check app.js`, `node --check apps-script-deploy.js`, `git diff --check`, exact conflict-marker scan, and `npm test` = **894 pass / 0 fail**; post-merge integration gate also **894 pass / 0 fail**; `app.js` = **7,898 LOC** |
| 9 | A — discovery drawer | `refactor/app-js-decompose-discovery-drawer` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer` | **PARKED CLEAN** | Blocker: no extraction commit exists; `git diff --name-only refactor/app-js-decompose...HEAD` is empty; branch is 0 commits ahead / 4 behind current integration; no `discovery-drawer.js` gate to run |
| 10 | A — ingest URL flow | `refactor/app-js-decompose-ingest-url-flow` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-ingest-url-flow` | **PARKED CLEAN** | Blocker: no extraction commit exists; `git diff --name-only refactor/app-js-decompose...HEAD` is empty; branch is 0 commits ahead / 4 behind current integration; no `ingest-url-flow.js` gate to run |
| 11 | A — pane 1 done: discovery drawer | `refactor/app-js-decompose-pane1-done-discovery-drawer` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer-v2` | **MERGED** `a51d795` | Renamed from `refactor/app-js-decompose-discovery-drawer-v2`; branch gate after rebase: `node --check app.js`, `node --check discovery-drawer.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, and `npm test` = **894 pass / 0 fail**; post-merge integration gate also **894 pass / 0 fail**; `app.js` = **6,443 LOC** |
| 12 | A — pane 2 ingest URL flow | `refactor/app-js-decompose-pane2-ready-ingest-url-flow` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-ingest-url-flow-v2` | **MERGED** `ed11dff` | Renamed from `refactor/app-js-decompose-ingest-url-flow-v2`; branch gate after rebase on `a51d795`: `node --check app.js`, `node --check ingest-url-flow.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, and `npm test` = **894 pass / 0 fail**; post-merge integration gate also **894 pass / 0 fail**; `app.js` = **5,237 LOC** |
| 13 | C1 — discovery run orchestration | `refactor/app-js-decompose-discovery-run-orchestration-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-run-orchestration-v2` | **MERGED** `e60b4fa` | Branch gate after rebase on `8c43cc3`: `node --check app.js`, `node --check discovery-run-orchestration.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, and `npm test` = **894 pass / 0 fail** after `npm install --prefix server`; post-merge integration gate also **894 pass / 0 fail**; `app.js` = **4,973 LOC** |
| 14 | C2 — discovery readiness | `refactor/app-js-decompose-discovery-readiness-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-readiness-v2` | **MERGED** `f630725` | Branch gate at `e01da2c`: `node --check app.js && node --check discovery-readiness.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, focused C2 tests = **57 pass / 0 fail**, and full `npm test` = **894 pass / 0 fail**; post-merge integration gate also **894 pass / 0 fail**; `app.js` = **4,051 LOC**, `discovery-readiness.js` = **1,133 LOC** |
| 15 | Stale WIP — core host bridge | `refactor/app-js-decompose-core-host` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-core-host` | **PARKED CLEAN** `5158a7f` | Live Cursor audit found dirty `app.js` edits on a branch 69 commits behind integration. Preserved as WIP only. Minimal parking checks passed: `node --check app.js`, `git diff --check`, exact conflict-marker scan on `app.js`, and pre-commit staged JS syntax. Blocker: overlaps the already-landed `JobBoredApp.core.host` bridge (`9112a65`) and lacks rebase/full `npm test`; do not merge without fresh review or discard if redundant |
| 16 | Stale WIP — keyword profile match | `refactor/app-js-decompose-keyword-profile-match` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-keyword-profile-match` | **PARKED CLEAN** `0a9f354` | Live Cursor audit found dirty `app.js`, `index.html`, and new `keyword-profile-match.js` edits on a branch 69 commits behind integration. Preserved as WIP only. Minimal parking checks passed: `node --check app.js && node --check keyword-profile-match.js`, `git diff --check`, exact conflict-marker scan on touched files, and pre-commit staged JS syntax. Blocker: duplicates/overlaps already-landed `keyword-profile-match.js` (`f215a33`) and lacks rebase/full `npm test`; do not merge without fresh review or discard if redundant |
| 17 | C3 — discovery setup modals | `refactor/app-js-decompose-discovery-setup-modals-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-setup-modals-v2` | **MERGED** `b0952ea` | Branch gate at `2d43e3e`: `node --check app.js && node --check discovery-setup-modals.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, and full `npm test` = **894 pass / 0 fail**; post-merge integration gate also **894 pass / 0 fail**; `app.js` = **3,233 LOC**, `discovery-setup-modals.js` = **998 LOC** |
| 18 | Hotfix — discovery AI host bridge | `refactor/app-js-decompose-discovery-ai-host-hotfix` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-ai-host-hotfix` | **MERGED** `57d4ec9` | Runtime blocker: `Uncaught ReferenceError: callDiscoveryAiGemini is not defined` at `app.js?v=30:1484`. Branch commit `f2bb57c` restored lazy host bridge wrappers to `JobBoredDiscovery.drawer` exports. Branch gate and post-merge gate passed: `node --check app.js && node --check discovery-drawer.js`, `git diff --check`, exact conflict-marker scan, and full `npm test` = **896 pass / 0 fail** |
| 19 | C4 — pipeline controller | `refactor/app-js-decompose-pipeline-controller-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-pipeline-controller-v2` | **MERGED** `e246351` | Branch gate at rebased commit `b931d48`: `node --check app.js && node --check pipeline-controller.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, focused C4 tests = **96 pass / 0 fail**, and full `npm test` = **896 pass / 0 fail** after `npm ci --prefix server`; post-merge integration gate also **896 pass / 0 fail**; `app.js` = **3,197 LOC**, `pipeline-controller.js` = **276 LOC** |
| 20 | Hotfix — discovery readiness host bridge | `refactor/app-js-decompose-discovery-readiness-host-hotfix` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-readiness-host-hotfix` | **MERGED** `5579a6c` | Branch commit `716cc7f` restored lazy host function lookup for readiness fallback helpers after the host is wired. Branch gate: `node --check app.js && node --check discovery-readiness.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, focused readiness/related tests = **42 pass / 0 fail**, and full `npm test` = **897 pass / 0 fail**; post-merge integration gate also **897 pass / 0 fail** |
| 21 | C5 — app bootstrap | `refactor/app-js-decompose-app-bootstrap-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-app-bootstrap-v2` | **MERGED** `a2b8bfe` | Worker commit `d22980e` extracted `app-bootstrap.js`, the thin `app.js` bootstrap bridge, one `index.html` script tag, and focused tests. Branch gate: `node --check app.js && node --check app-bootstrap.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, focused C5 tests = **65 pass / 0 fail**, and full `npm test` = **897 pass / 0 fail**; post-merge integration gate also **897 pass / 0 fail**; `app.js` = **3,041 LOC**, `app-bootstrap.js` = **252 LOC** |

Shared-file rule in force: `index.html` structural changes landed with B first,
legacy CSS `<head>` links landed with C, and the scoped A config follow-up landed
after rebasing onto post-C integration. The first Phase 7 app-js lane
(`apps-script-relay-helpers.js`) landed next from a rebased worker branch, then
`scraper-ats-config.js` landed from a rebased worker branch, then
`discovery-engine-state.js` landed from a rebased worker branch, then
`discovery-status-handoff.js` landed from a rebased worker branch. Session 14
created three fresh app-js lanes from integration tip `0250251`; Apps Script
deploy landed first from a clean worker branch. The discovery drawer and ingest
URL branches contain no extraction work and are parked clean. Session 15
`pane1-done-discovery-drawer` landed next from a rebased worker branch, followed
by `pane2-ready-ingest-url-flow`, then C1 `discovery-run-orchestration.js`
landed from a rebased worker branch, then C2 `discovery-readiness.js` landed
from a clean worker branch, then C3 `discovery-setup-modals.js` landed from a
clean worker branch. Session 23 landed the discovery AI host bridge hotfix from
its own worktree before any C4 merge, restoring the extracted drawer AI helpers
as exported lazy host bridge calls. C4 `pipeline-controller.js` then landed from
a worker branch rebased onto that hotfix. Session 25 then landed the discovery
readiness host bridge hotfix from its own worktree before C5 dispatch, restoring
lazy readiness helper lookup after `app.js` wires the host. C5
`app-bootstrap.js` then landed from the `bacf3f3e-041c-4ace-8bc5-ed9068be6abdv`
Cursor pane's worker branch after an orchestrator repair to the extracted host
helper call sites and a focused regression guard. Session 18 live
Cursor audit also found
two stale dirty WIP worktrees (`appjs-core-host` and
`appjs-keyword-profile-match`) from the older Phase 1/keyword lanes. Both are
now committed and clean on their owner branches, but are explicitly parked and
not merge candidates without a fresh rebase/review because the equivalent
integration work already landed earlier.

Follow-up Cursor prompts are staged in
[FOLLOWUP-CURSOR-SWARM-2026-05-31.md](./FOLLOWUP-CURSOR-SWARM-2026-05-31.md).
Use those prompts instead of a broad "keep refactoring until <1000 LOC" request.

## Integration commits (merged to `refactor/app-js-decompose`)

| Commit | Module | app.js delta (approx) | Tests |
|---|---|---|---|
| `4ee8a25` | `app-utils.js` | −~30 LOC body | green |
| `62e6f30` | `daily-brief.js` | −~1,000 LOC body | green |
| `9112a65` | `JobBoredApp.core.host` bridge | +~230 LOC bridge | green |
| `f215a33` | `keyword-profile-match.js` | −~511 LOC | green |
| `5cd73d6` | `profile-materials.js` | −~370 LOC | green |
| `51f97e4` | `expired-review-ui.js` | −~370 LOC | green |
| `6facfc2` | `materials-feature.js` | −~470 LOC | green |
| `c5748db` | `settings-modal.js` | −~617 LOC | green |
| `11b6d86` | `company-logo.js` | −~153 LOC | green |
| `947af1b` | `onboarding-wizard.js` | −~1,144 LOC | green |
| `08e5283` | `resume-generation.js` | −~1,235 LOC | green |
| `e81f74d` | `ats-scorecard.js` | −~564 LOC | green |
| `5e72f5b` | `materials-state.js` | −~273 LOC | green |
| `95657ad` | `sheets-writeback.js` | −~889 LOC | green |
| `c4d529b` | `sheets-read-load.js` | −~545 LOC | green |
| `576782d` | `pipeline-render.js` | −~1,432 LOC | green |
| *(this commit)* | `discovery-run-tracker.js` | −~330 LOC body | green (892 pass) |
| `a432bd2` | `index.html` discovery partials | N/A | green (894 pass) |
| `d2d5224` | config-core follow-up merge | −~21 LOC in `app.js` | green (894 pass) |
| `a2a970d` | `apps-script-relay-helpers.js` | −~290 LOC in `app.js` | green (894 pass) |
| `2a3fcb5` | `scraper-ats-config.js` | −179 LOC in `app.js` | green (894 pass) |
| `7f9a2ee` | `discovery-engine-state.js` | −177 LOC in `app.js` | green (894 pass) |
| `942248c` | `discovery-status-handoff.js` | −695 LOC in `app.js` | green (894 pass) |
| `07186fc` | `apps-script-deploy.js` | −1,245 LOC in `app.js` | green (894 pass) |
| `a51d795` | `discovery-drawer.js` | −1,455 LOC in `app.js` | green (894 pass) |
| `ed11dff` | `ingest-url-flow.js` | −1,206 LOC in `app.js` | green (894 pass) |
| `e60b4fa` | `discovery-run-orchestration.js` | −264 LOC in `app.js` | green (894 pass) |
| `f630725` | `discovery-readiness.js` | −922 LOC in `app.js` | green (894 pass) |
| `b0952ea` | `discovery-setup-modals.js` | −818 LOC in `app.js` | green (894 pass) |
| `57d4ec9` | discovery AI host bridge hotfix | +8 LOC in `app.js` | green (896 pass) |
| `e246351` | `pipeline-controller.js` | −44 LOC in `app.js` | green (896 pass) |
| `5579a6c` | discovery readiness host bridge hotfix | no `app.js` LOC change | green (897 pass) |
| `a2b8bfe` | `app-bootstrap.js` | −156 LOC in `app.js` | green (897 pass) |

## Active pane dispatch (session 15)

All implementation worktrees were created from `6f6b93a`, then rebased to the
latest session dispatch ledger. The integration checkout remains
orchestrator-only for merges and ledger commits.

| Pane | Role | Branch | Worktree | Status | Stop condition |
|---|---|---|---|---|---|
| 1 | Discovery drawer implementation | `refactor/app-js-decompose-pane1-done-discovery-drawer` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer-v2` | **MERGED** `a51d795` | Branch parked clean at `d4366bf`; branch and post-merge gates passed |
| 1b | Drawer AI host follow-up | `refactor/app-js-decompose-pane1-parked-drawer-ai-followup` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer-v2` | **PARKED CLEAN** `2936b44` | Preserved staged follow-up from final audit; branch gate passed (`node --check app.js`, `node --check discovery-drawer.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, `npm test` = **894 pass / 0 fail**); blocker: not merged, needs rebase/review against integration tip before landing |
| 2 | Ingest URL flow implementation | `refactor/app-js-decompose-pane2-ready-ingest-url-flow` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-ingest-url-flow-v2` | **MERGED** `ed11dff` | Branch parked clean at `37cc686`; branch and post-merge gates passed |
| 3 | Phase 6 core-collapse survey | `refactor/app-js-decompose-pane3-parked-core-collapse-survey` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-core-collapse-survey` | **DONE — PARKED CLEAN** `366822a` | `docs/refactor/PLAN-app-js-core-collapse-next.md` drafted with candidate lanes, dependencies, and tests |
| 4 | QA / merge-readiness review | `refactor/app-js-decompose-pane4-parked-qa-review` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-qa-review` | **DONE — PARKED CLEAN** `0209b81` | `docs/refactor/QA-session-15-checklist.md` committed with exact gate commands and current branch/path preflight |

Pane 2 was dispatched from the lower-left Cursor pane. The visible Cursor branch
badge still showed the old Apps Script deploy branch during implementation, but
the worker bootstrap and rebase ran in
`/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-ingest-url-flow-v2`; the
actual parked branch is `refactor/app-js-decompose-pane2-ready-ingest-url-flow`.
The old Apps Script deploy worktree remains clean.

## Pane dispatch (session 16)

Parallelism rule from the Phase 6 survey remains in force: **one
implementation worktree at a time**. C1 has landed. The drawer follow-up branch
is parked clean and C2 has not been dispatched.

| Pane | Role | Branch | Worktree | Status | Stop condition |
|---|---|---|---|---|---|
| 1 | Drawer repair pane | `refactor/app-js-decompose-pane1-parked-drawer-ai-followup` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer-v2` | **PARKED CLEAN** `2936b44` | Branch gate green; blocker: not merged, needs rebase/review against integration tip before landing |
| 2 | C1 implementation — `discovery-run-orchestration.js` | `refactor/app-js-decompose-discovery-run-orchestration-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-run-orchestration-v2` | **MERGED** `e60b4fa` | Branch parked clean at `6a02f62`; branch and post-merge gates passed |
| 3 | C2 readiness prep | read-only until C2 dispatch | existing survey pane only | **READ-ONLY SUPPORT** | Keep C2 notes aligned with Phase 6 plan; no file edits |
| 4 | QA / merge-readiness review | read-only until next implementation commit | existing QA pane only | **READ-ONLY SUPPORT** | Prepare to run the next gate checklist after a worker reports a commit; no file edits |

## Pane dispatch (session 17)

Parallelism rule from the Phase 6 survey remains in force: **one
implementation worktree at a time**. C2 owns the only editable refactor lane.

| Pane | Role | Branch | Worktree | Status | Stop condition |
|---|---|---|---|---|---|
| 1 | Drawer follow-up monitor | `refactor/app-js-decompose-pane1-parked-drawer-ai-followup` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer-v2` | **PARKED CLEAN** `2936b44` | Keep parked unless explicitly revived; branch gate remains green but it needs rebase/review against integration tip before merge |
| 2 | C2 implementation — `discovery-readiness.js` | `refactor/app-js-decompose-discovery-readiness-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-readiness-v2` | **MERGED** `f630725` | Branch clean at `e01da2c`; branch and post-merge gates passed |
| 3 | C2 readiness reviewer | read-only support | existing survey pane only | **NO USABLE REPORT** | Cursor-agent support attempt exited without output; orchestrator performed read-only boundary review locally |
| 4 | C2 QA checklist | read-only support | existing QA pane only | **PROVIDER ERROR** | Cursor-agent support attempt failed before reporting; orchestrator performed branch and post-merge gates locally |

## Pane dispatch (session 20)

Parallelism rule from the Phase 6 survey remains in force: **one
implementation worktree at a time**. C3 has landed; no C4 implementation work
starts until inspection/dispatch from the latest integration tip.
The visible pane identified during dispatch is the orchestrator pane at
`~/Job-Bored` on `refactor/app-js-decompose`; it stays integration-only and does
not receive module implementation edits. Three fresh Cursor panes were named for
C3 writer, C3 boundary review, and C3 gate checklist. The writer produced the
clean C3 worker commit; the support panes remained read-only while the
orchestrator ran independent branch and post-merge gates.

| Pane | Role | Branch | Worktree | Status | Stop condition |
|---|---|---|---|---|---|
| current pane | Orchestrator / ledger / merge controller | `refactor/app-js-decompose` | `/Users/emilionunezgarcia/Job-Bored` | **ACTIVE — INTEGRATION ONLY** | Maintain ledger and merge docs; stop for C3 inspection before C4 dispatch |
| worker lane | C3 implementation — `discovery-setup-modals.js` | `refactor/app-js-decompose-discovery-setup-modals-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-setup-modals-v2` | **MERGED** `b0952ea` | Branch clean at `2d43e3e`; branch and post-merge gates passed |
| support reviewer | C3 boundary review | read-only support | fresh Cursor support pane | **READ-ONLY SUPPORT** | No implementation edits |
| QA gate | C3 gate checklist | read-only support | fresh Cursor support pane + orchestrator shell | **LOCAL GATE COMPLETE** | Orchestrator ran branch and post-merge gates locally |

## Pane dispatch (session 22)

Parallelism rule from the Phase 6 survey remains in force: **one
implementation worktree at a time**. C4 has landed; no C5 implementation work
starts until inspection/dispatch from the latest integration tip.
The integration checkout remains ledger/merge-only and must not receive
implementation edits. Session 23 used a separate hotfix worktree to resolve the
runtime `callDiscoveryAiGemini` host bridge regression before C4 landed.

| Pane | Role | Branch | Worktree | Status | Stop condition |
|---|---|---|---|---|---|
| current pane | Orchestrator / ledger / merge controller | `refactor/app-js-decompose` | `/Users/emilionunezgarcia/Job-Bored` | **ACTIVE — INTEGRATION ONLY** | Maintain ledger and merge docs; stop for C4 inspection before C5 dispatch |
| hotfix lane | Discovery AI host bridge repair | `refactor/app-js-decompose-discovery-ai-host-hotfix` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-ai-host-hotfix` | **MERGED** `57d4ec9` | Branch clean at `f2bb57c`; branch and post-merge gates passed |
| worker lane | C4 implementation — `pipeline-controller.js` | `refactor/app-js-decompose-pipeline-controller-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-pipeline-controller-v2` | **MERGED** `e246351` | Branch clean at `b931d48`; branch and post-merge gates passed |
| support reviewer | C4 boundary review | read-only support | orchestrator shell | **LOCAL REVIEW COMPLETE** | Scope checked against the Phase 6 survey; no support edits |
| QA gate | C4 gate checklist | read-only support | orchestrator shell | **LOCAL GATE COMPLETE** | Orchestrator ran branch and post-merge gates locally |

## Pane dispatch (session 25)

Parallelism rule from the Phase 6 survey remains in force: **one
implementation worktree at a time**. The readiness host hotfix and C5 app
bootstrap extraction have both landed from their own worktrees. The candidate
Cursor pane requested by id `bacf3f3e-041c-4ace-8bc5-ed9068be6abdv` was usable
only after a fresh C5 worktree prompt with a branch/path preflight because the
visible pane contexts were stale C3/hotfix contexts.

| Pane | Role | Branch | Worktree | Status | Stop condition |
|---|---|---|---|---|---|
| current pane | Orchestrator / ledger / merge controller | `refactor/app-js-decompose` | `/Users/emilionunezgarcia/Job-Bored` | **ACTIVE — INTEGRATION ONLY** | Maintain ledger and merge docs; do not perform implementation edits in this checkout |
| hotfix lane | Discovery readiness host bridge repair | `refactor/app-js-decompose-discovery-readiness-host-hotfix` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-readiness-host-hotfix` | **MERGED** `5579a6c` | Branch clean at `716cc7f`; branch and post-merge gates passed |
| candidate pane `bacf3f3e-041c-4ace-8bc5-ed9068be6abdv` | C5 implementation — `app-bootstrap.js` | `refactor/app-js-decompose-app-bootstrap-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-app-bootstrap-v2` | **MERGED** `a2b8bfe` | Branch clean at `d22980e`; branch and post-merge gates passed |
| QA gate | C5 gate checklist | read-only support | orchestrator shell | **LOCAL GATE COMPLETE** | Branch and post-merge gates passed; stop here for C5 inspection before dispatching C6 |

## Pane dispatch (session 26)

Parallelism rule remains in force: **one editable implementation worktree at a
time**. C6 bridge registry/core-collapse is the only implementation lane. The
other three panes are support-only and have their own current-tip worktrees so
any accidental edits stay isolated from the writer and integration checkouts.

| Pane | Role | Branch | Worktree | Status | Stop condition |
|---|---|---|---|---|---|
| current pane | Orchestrator / ledger / merge controller | `refactor/app-js-decompose` | `/Users/emilionunezgarcia/Job-Bored` | **ACTIVE — INTEGRATION ONLY** | Maintain ledger and merge docs; leave local `AGENTS.md`, `CLAUDE.md`, and `package-lock.json` unstaged |
| writer pane | C6 implementation — `bridge-registry.js` | `refactor/app-js-decompose-bridge-registry-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-bridge-registry-v2` | **DISPATCH READY** | Extract bridge publication only; branch must pass full C6 gate before merge |
| boundary pane | C6 boundary review | `refactor/app-js-decompose-bridge-registry-boundary-review` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-bridge-registry-boundary-review` | **READ-ONLY SUPPORT** | Report bridge scope risks and required source-text test updates; commit nothing unless explicitly reassigned |
| source-audit pane | C6 app.js/source-text audit | `refactor/app-js-decompose-bridge-registry-source-audit` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-bridge-registry-source-audit` | **READ-ONLY SUPPORT** | Report tests that grep bridge host blocks or `app.js` symbols; commit nothing unless explicitly reassigned |
| QA gate pane | C6 gate checklist | `refactor/app-js-decompose-bridge-registry-qa` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-bridge-registry-qa` | **READ-ONLY SUPPORT** | Prepare exact branch/post-merge gate commands; run verification after writer reports a commit |

## Extraction order progress

| Plan step | Module | Status | Worker | Worktree / branch | Notes |
|---|---|---|---|---|---|
| 0 | Pre-flight bridge / `JobBoredApp.core.host` | **DONE** (uncommitted on primary) | orchestrator | primary + worktree | +230 LOC bridge; 892 pass primary + worktree |
| 1 | `app-utils.js` | **DONE** | prior session | primary | `4ee8a25` |
| 2 | `daily-brief.js` | **DONE** | prior session | primary | `62e6f30`; `index.html` loads `daily-brief.js?v=1` |
| 3 | `keyword-profile-match.js` | **DONE** | frontend-developer | worktree → primary | `f215a33`; **~511** LOC out |
| 4 | `profile-materials.js` | **DONE** | frontend-developer | primary | `5cd73d6`; Materials modal + LinkedIn capture |
| 5 | `expired-review-ui.js` (`JobBoredApp.expiredReview`) | **DONE** | frontend-developer | primary | `51f97e4`; UI only; root `expired-review.js` unchanged |
| 6 | `posting-enrichment.js` | **DONE** | frontend-developer | primary | `cf1c654`; cache + pipeline + `jb:role:opened` listener; **519** LOC module |
| 7 | Phase 3: materials-state → ats → resume-gen → onboarding | **DONE** | composer workers | primary | see commits above |
| 8 | `company-logo.js` | **DONE** | parallel worktree | `11b6d86` | cherry-picked |
| 9 | `settings-modal.js` | **DONE** | parallel worktree | `c5748db` | cherry-picked |
| 10 | `materials-feature.js` | **DONE** | parallel worktree | `6facfc2` | cherry-picked |
| 11 | `sheets-writeback.js` | **DONE** | parallel worktree | `95657ad` | cherry-picked; `JobBoredApp.sheetsWrite` |
| 12 | `sheets-read-load.js` | **DONE** | parallel worktree | `c4d529b` | cherry-picked; `JobBoredApp.sheetsRead` |
| 13 | `pipeline-render.js` | **DONE** | parallel worktree | `576782d` | cherry-picked; `JobBoredApp.pipelineRender` |
| 14 | `discovery-run-tracker.js` | **DONE** | backend-developer | primary | `JobBoredDiscovery.runTracker`; **348** LOC module; thin wrappers in app.js |
| 15 | `apps-script-relay-helpers.js` | **DONE** | Cursor worker | `appjs-apps-script-relay-helpers` | `JobBoredDiscovery.relayHelpers`; rebased to `eb2d7ed`, merged as `a2a970d` |
| 16 | `scraper-ats-config.js` | **DONE** | Cursor worker | `appjs-scraper-ats-config` | `JobBoredDiscovery.scraperAtsConfig`; rebased to `2429f3a`, merged as `2a3fcb5` |
| 17 | `discovery-engine-state.js` | **DONE** | Cursor worker | `appjs-discovery-engine-state` | `JobBoredDiscovery.engineState`; rebased to `453c97f`, merged as `7f9a2ee` |
| 18 | `discovery-status-handoff.js` | **DONE** | Cursor worker + orchestrator conflict fix | `appjs-discovery-status-handoff` | `JobBoredDiscovery.status`; rebased to `03b5bc3`, merged as `942248c` |
| 19 | `apps-script-deploy.js` | **DONE** | Cursor pane | `appjs-apps-script-deploy` | `JobBoredDiscovery.appsScriptDeploy`; merged as `07186fc`; branch and post-merge integration gates green |
| 20 | `discovery-drawer.js` | **DONE** | Cursor pane 1 | `appjs-discovery-drawer-v2` | Branch `refactor/app-js-decompose-pane1-done-discovery-drawer`; `JobBoredDiscovery.drawer`; rebased to `d4366bf`, merged as `a51d795`; branch and post-merge integration gates green |
| 21 | `ingest-url-flow.js` | **DONE** | Cursor pane 2 | `appjs-ingest-url-flow-v2` | Branch `refactor/app-js-decompose-pane2-ready-ingest-url-flow`; `JobBoredDiscovery.ingestUrlFlow`; rebased to `37cc686`, merged as `ed11dff`; branch and post-merge integration gates green |
| 22 | Phase 6 core collapse survey | **DONE** | Cursor pane 3 | `appjs-core-collapse-survey` | Branch `refactor/app-js-decompose-pane3-parked-core-collapse-survey`; `366822a`; drafted `docs/refactor/PLAN-app-js-core-collapse-next.md`; gate `git diff --check` clean; branch parked clean |
| 23 | Session 15 QA checklist | **DONE** | Cursor pane 4 | `appjs-qa-review` | Branch `refactor/app-js-decompose-pane4-parked-qa-review`; `0209b81`; drafted `docs/refactor/QA-session-15-checklist.md`; branch parked clean |
| 24 | Drawer AI host follow-up | **PARKED CLEAN** | Cursor pane 1 | `appjs-discovery-drawer-v2` | Branch `refactor/app-js-decompose-pane1-parked-drawer-ai-followup`; commit `2936b44`; branch gate green; blocker: needs rebase/review against integration tip before merge |
| 25 | `discovery-run-orchestration.js` | **DONE** | Cursor pane 2 | `appjs-discovery-run-orchestration-v2` | Branch `refactor/app-js-decompose-discovery-run-orchestration-v2`; rebased to `6a02f62`, merged as `e60b4fa`; branch and post-merge integration gates green |
| 26 | `discovery-readiness.js` | **DONE** | Cursor pane 2 | `appjs-discovery-readiness-v2` | Branch `refactor/app-js-decompose-discovery-readiness-v2`; commit `e01da2c`, merged as `f630725`; branch and post-merge integration gates green |
| 27 | Stale core host bridge WIP | **PARKED CLEAN** | live audit | `appjs-core-host` | Branch `refactor/app-js-decompose-core-host`; commit `5158a7f`; blocker: 69 commits behind and overlaps landed bridge commit `9112a65`; do not merge without rebase/review |
| 28 | Stale keyword profile match WIP | **PARKED CLEAN** | live audit | `appjs-keyword-profile-match` | Branch `refactor/app-js-decompose-keyword-profile-match`; commit `0a9f354`; blocker: 69 commits behind and overlaps landed keyword module commit `f215a33`; do not merge without rebase/review |
| 29 | `discovery-setup-modals.js` | **DONE** | Cursor worker lane | `appjs-discovery-setup-modals-v2` | Branch `refactor/app-js-decompose-discovery-setup-modals-v2`; commit `2d43e3e`, merged as `b0952ea`; branch and post-merge integration gates green |
| 30 | Discovery AI host bridge hotfix | **DONE** | orchestrator hotfix lane | `appjs-discovery-ai-host-hotfix` | Branch `refactor/app-js-decompose-discovery-ai-host-hotfix`; commit `f2bb57c`, merged as `57d4ec9`; fixed `callDiscoveryAiGemini` load-time ReferenceError by routing host bridge calls through exported `JobBoredDiscovery.drawer` helpers |
| 31 | `pipeline-controller.js` | **DONE** | worker lane | `appjs-pipeline-controller-v2` | Branch `refactor/app-js-decompose-pipeline-controller-v2`; rebased to `b931d48`, merged as `e246351`; branch and post-merge integration gates green |
| 32 | Discovery readiness host bridge hotfix | **DONE** | orchestrator hotfix lane | `appjs-discovery-readiness-host-hotfix` | Branch `refactor/app-js-decompose-discovery-readiness-host-hotfix`; commit `716cc7f`, merged as `5579a6c`; branch and post-merge gates green |
| 33 | `app-bootstrap.js` | **DONE** | Cursor pane `bacf3f3e-041c-4ace-8bc5-ed9068be6abdv` + orchestrator review | `appjs-app-bootstrap-v2` | Branch `refactor/app-js-decompose-app-bootstrap-v2`; worker commit `d22980e`, merged as `a2b8bfe`; branch and post-merge integration gates green |
| 34 | `bridge-registry.js` | **ACTIVE** | C6 writer pane | `appjs-bridge-registry-v2` | Branch `refactor/app-js-decompose-bridge-registry-v2`; fast-forwarded to dispatch ledger tip `7949d45`; extract bridge publication only |
| 35+ | thin-wrapper collapse | pending | — | — | Continue after C6 inspection; remove one-line delegates only when source-text tests no longer require symbols in `app.js` |

## Worktrees

| Path | Branch | Purpose | Status |
|---|---|---|---|
| `/Users/emilionunezgarcia/Job-Bored` | `refactor/app-js-decompose` | integration / orchestrator | active |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-sheets-writeback` | `refactor/app-js-decompose-sheets-writeback` | Phase 4 writeback | merged `95657ad` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-sheets-read-load` | `refactor/app-js-decompose-sheets-read-load` | Phase 4 read-load | merged `c4d529b` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-pipeline-render` | `refactor/app-js-decompose-pipeline-render` | Phase 4 pipeline | merged `576782d` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-core-host` | `refactor/app-js-decompose-core-host` | Stale Phase 1 core host bridge WIP | parked clean `5158a7f`; 69 commits behind integration; overlaps landed bridge `9112a65`; no full gate on current integration |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-keyword-profile-match` | `refactor/app-js-decompose-keyword-profile-match` | Stale keyword profile match WIP | parked clean `0a9f354`; 69 commits behind integration; overlaps landed keyword module `f215a33`; no full gate on current integration |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/index-html-decompose` | `refactor/index-html-decompose` | Track B index decomposition | merged `a432bd2` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/style-css-split` | `refactor/style-css-split` | Track C CSS split | merged `37241c6` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-app-config-core-followup` | `refactor/app-js-decompose-app-config-core-followup` | Track A config-core follow-up | merged `d2d5224` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-apps-script-relay-helpers` | `refactor/app-js-decompose-apps-script-relay-helpers` | Phase 7 relay helpers | merged `a2a970d` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-scraper-ats-config` | `refactor/app-js-decompose-scraper-ats-config` | Phase 7 scraper ATS config | merged `2a3fcb5` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-engine-state` | `refactor/app-js-decompose-discovery-engine-state` | Phase 7 discovery engine state | merged `7f9a2ee` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-status-handoff` | `refactor/app-js-decompose-discovery-status-handoff` | Phase 7 discovery status handoff | merged `942248c` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-apps-script-deploy` | `refactor/app-js-decompose-apps-script-deploy` | Session 14 Apps Script deploy UI | merged `07186fc` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer` | `refactor/app-js-decompose-discovery-drawer` | Session 14 discovery drawer | parked clean; no extraction commit |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-ingest-url-flow` | `refactor/app-js-decompose-ingest-url-flow` | Session 14 ingest URL flow | parked clean; no extraction commit |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer-v2` | `refactor/app-js-decompose-pane1-parked-drawer-ai-followup` | Session 15 discovery drawer follow-up | parked clean `2936b44`; branch gate **894 pass / 0 fail**; original drawer merge branch remains `refactor/app-js-decompose-pane1-done-discovery-drawer` at `d4366bf` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-ingest-url-flow-v2` | `refactor/app-js-decompose-pane2-ready-ingest-url-flow` | Session 15 ingest URL flow | merged `ed11dff`; branch clean at `37cc686` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-core-collapse-survey` | `refactor/app-js-decompose-pane3-parked-core-collapse-survey` | Session 15 Phase 6 survey | done; parked clean at `366822a` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-qa-review` | `refactor/app-js-decompose-pane4-parked-qa-review` | Session 15 QA review | done; parked clean at `0209b81` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-run-orchestration-v2` | `refactor/app-js-decompose-discovery-run-orchestration-v2` | Session 16 C1 discovery run orchestration | merged `e60b4fa`; branch clean at `6a02f62` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-readiness-v2` | `refactor/app-js-decompose-discovery-readiness-v2` | Session 17 C2 discovery readiness | merged `f630725`; branch clean at `e01da2c` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-setup-modals-v2` | `refactor/app-js-decompose-discovery-setup-modals-v2` | Session 20 C3 discovery setup modals | merged `b0952ea`; branch clean at `2d43e3e` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-pipeline-controller-v2` | `refactor/app-js-decompose-pipeline-controller-v2` | Session 22 C4 pipeline controller | merged `e246351`; branch clean at `b931d48` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-readiness-host-hotfix` | `refactor/app-js-decompose-discovery-readiness-host-hotfix` | Session 25 discovery readiness host bridge hotfix | merged `5579a6c`; branch clean at `716cc7f` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-app-bootstrap-v2` | `refactor/app-js-decompose-app-bootstrap-v2` | Session 25 C5 app bootstrap | merged `a2b8bfe`; branch clean at `d22980e` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-bridge-registry-v2` | `refactor/app-js-decompose-bridge-registry-v2` | Session 26 C6 bridge registry writer | active; fast-forwarded to `7949d45` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-bridge-registry-boundary-review` | `refactor/app-js-decompose-bridge-registry-boundary-review` | Session 26 C6 boundary review | read-only support; fast-forwarded to `7949d45` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-bridge-registry-source-audit` | `refactor/app-js-decompose-bridge-registry-source-audit` | Session 26 C6 source-text audit | read-only support; fast-forwarded to `7949d45` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-bridge-registry-qa` | `refactor/app-js-decompose-bridge-registry-qa` | Session 26 C6 QA gate | read-only support; fast-forwarded to `7949d45` |

Worktree create (orchestrator or shell subagent):

```bash
mkdir -p /Users/emilionunezgarcia/Job-Bored-worktrees
git worktree add /Users/emilionunezgarcia/Job-Bored-worktrees/appjs-<module-slug> \
  -b refactor/app-js-decompose-<module-slug> \
  refactor/app-js-decompose
```

## Research manifests (Phase 0)

| Module | Agent | Manifest | Status |
|---|---|---|---|
| `keyword-profile-match.js` | explore | [manifest complete — see agent session 2026-05-31] | **done** |
| `profile-materials.js` | explore | [manifest complete — see agent session 2026-05-31] | **done** |
| `expired-review-ui.js` | explore | [manifest complete — see agent session 2026-05-31] | **done** |
| Phase 1 bridge (`JobBoredApp.core.host`) | explore | [manifest complete — see agent session 2026-05-31] | **done** |
| `posting-enrichment.js` | explore | [manifest complete — see agent session 2026-05-31] | **done** |

## Phase timeline

| Phase | Scope | Status |
|---|---|---|
| 0 | Baseline + research manifests (cuts 3–6 + bridge) | **DONE** |
| 1 | Foundation bridge (`JobBoredApp.core.host` + accessors) | **DONE** (892 pass; uncommitted) |
| 2 | Leaf modules: keyword → profile → expired UI → enrichment | **DONE** |
| 3 | Materials / ATS / onboarding / settings / logo / feature init | **DONE** |
| 4 | Pipeline / Sheets | **DONE** (`95657ad`, `c4d529b`, `576782d`; **892 pass**) |
| 5 | Discovery remainder | **in progress** (run tracker + relay helpers + scraper ATS config + engine state + status handoff + Apps Script deploy + discovery drawer + ingest URL flow + run orchestration + readiness + setup modals done) |
| 5b | Index decomposition guardrail | **DONE** (`a432bd2`; **894 pass**) |
| 6 | Auth / config / core collapse | in progress; config-core follow-up, C4 pipeline-controller, and C5 app-bootstrap merged |

## Blockers / hygiene

1. **Discovery autofill WIP** — stashed as `discovery autofill WIP (post-phase4)` (`fb7c653`); breaks 4 discovery tests until finished; keep out of module-cut commits.
2. Phase 2 leaf cuts committed: `5cd73d6`, `51f97e4`, `cf1c654`.
3. **Plan LOC table** — re-derive ranges from **3,041** LOC `app.js` before each cut.
4. **Mixed integration WIP backup** — `stash@{0}` is retained only as a recovery snapshot after replaying files to owner branches.

## Next actions (orchestrator)

1. ~~Collect Phase 0 research manifests~~ **done** (all 5 ready)
1. ~~Land Phase 1 foundation bridge~~ **done** (892 pass; commit when authorized).
2. ~~Phase 3 + parallel batch~~ **done** (`11b6d86`, `c5748db`, `6facfc2` integrated; **892 pass**).
3. ~~Phase 4~~ **done** — writeback, read-load, pipeline-render integrated; **892 pass** at **13,140** LOC.
4. Phase 5 cut #1 **done** — `discovery-run-tracker.js`; **892 pass** at **12,456** LOC.
5. Track B index decomposition **merged** — `a432bd2`; **894 pass**.
6. Track C CSS split **merged** — `37241c6`; branch and integration **894 pass**.
7. Track A config follow-up **merged** — `d2d5224`; branch and integration **894 pass**.
8. Apps Script relay helpers **merged** — `a2a970d`; branch and integration **894 pass**.
9. Scraper ATS config **merged** — `2a3fcb5`; branch and integration **894 pass**.
10. Discovery engine state **merged** — `7f9a2ee`; branch and integration **894 pass**.
11. Discovery status handoff **merged** — `942248c`; branch and integration **894 pass**.
12. Session 14 Apps Script deploy lane **merged** — `07186fc`; branch and integration **894 pass** at **7,898** LOC.
13. Session 15 v2 branches created at integration tip `6f6b93a`, then renamed for pane clarity: `pane1-done-discovery-drawer`, `pane2-ready-ingest-url-flow`, `pane3-parked-core-collapse-survey`, and `pane4-parked-qa-review`.
14. Session 15 QA checklist complete — `0209b81` on `appjs-qa-review`; branch parked clean as `refactor/app-js-decompose-pane4-parked-qa-review`.
15. Session 15 Phase 6 survey complete — `366822a` on `appjs-core-collapse-survey`; branch parked clean as `refactor/app-js-decompose-pane3-parked-core-collapse-survey`. It recommends merging **drawer** and **ingest** first, then dispatching C1 `discovery-run-orchestration.js` from a fresh worktree at the new integration tip.
16. Session 15 discovery drawer v2 **merged** — `a51d795`; branch and integration **894 pass** at **6,443** LOC.
17. Session 15 ingest URL flow v2 **merged** — `ed11dff`; branch and integration **894 pass** at **5,237** LOC.
18. Drawer AI host follow-up **parked clean** — branch `refactor/app-js-decompose-pane1-parked-drawer-ai-followup`, worktree `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer-v2`, commit `2936b44`, branch gate **894 pass / 0 fail**. Blocker: not merged; rebase/review against integration tip before landing.
19. C1 `discovery-run-orchestration.js` **merged** — `e60b4fa`; branch and integration **894 pass** at **4,973** LOC.
20. C2 `discovery-readiness.js` **merged** — branch `refactor/app-js-decompose-discovery-readiness-v2`, worktree `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-readiness-v2`, commit `e01da2c`, merge `f630725`; branch and integration **894 pass** at **4,051** LOC.
21. Session 18 live Cursor audit parked stale dirty worktrees: `appjs-core-host` at `5158a7f` and `appjs-keyword-profile-match` at `0a9f354`. Both parse and are clean, but neither is merge-ready because both are 69 commits behind integration and overlap already-landed work.
22. C3 `discovery-setup-modals.js` **merged** — branch `refactor/app-js-decompose-discovery-setup-modals-v2`, worktree `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-setup-modals-v2`, worker commit `2d43e3e`, merge `b0952ea`; current pane remains orchestrator-only on integration.
23. C3 gate **complete** — branch gate passed `node --check app.js && node --check discovery-setup-modals.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, and full `npm test` **894 pass / 0 fail**; post-merge integration gate also **894 pass / 0 fail**.
24. C4 `pipeline-controller.js` **merged** — branch `refactor/app-js-decompose-pipeline-controller-v2`, worktree `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-pipeline-controller-v2`, worker commit `b931d48`, merge `e246351`; current pane remains orchestrator-only on integration.
25. C4 gate **complete** — branch gate passed `node --check app.js && node --check pipeline-controller.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, focused C4 tests **96 pass / 0 fail**, and full `npm test` **896 pass / 0 fail**; post-merge integration gate also **896 pass / 0 fail**.
26. Discovery readiness host bridge hotfix **merged** — branch `refactor/app-js-decompose-discovery-readiness-host-hotfix`, worktree `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-readiness-host-hotfix`, worker commit `716cc7f`, merge `5579a6c`; branch gate passed `node --check app.js && node --check discovery-readiness.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, focused readiness/related tests **42 pass / 0 fail**, and full `npm test` **897 pass / 0 fail**; post-merge integration gate also **897 pass / 0 fail**.
27. C5 `app-bootstrap.js` **merged** — branch `refactor/app-js-decompose-app-bootstrap-v2`, worktree `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-app-bootstrap-v2`, worker commit `d22980e`, merge `a2b8bfe`; branch gate passed `node --check app.js && node --check app-bootstrap.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, focused C5 tests **65 pass / 0 fail**, and full `npm test` **897 pass / 0 fail**; post-merge integration gate also **897 pass / 0 fail**; `app.js` **3,041 LOC**, `app-bootstrap.js` **252 LOC**.
28. C6 `bridge-registry.js` **dispatched** — writer branch `refactor/app-js-decompose-bridge-registry-v2`, worktree `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-bridge-registry-v2`, fast-forwarded to dispatch ledger tip `7949d45`. Support branches fast-forwarded to the same tip: boundary review, source-text audit, and QA gate. Keep C6 scope to bridge publication: `JobBoredDiscovery.*.host`, `JobBoredApp.*.host`, `JobBoredApp.core.host`, and `Object.assign(window.JobBoredApp.core, ...)`.
29. Before C6 merge, run `node --check app.js && node --check bridge-registry.js`, `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, full `npm test`, and report `wc -l app.js bridge-registry.js`.

## `index.html` script order (post Phase 5 cut #1)

```
… → sheets-writeback → sheets-read-load → pipeline-render → pipeline-controller → discovery-run-tracker → sheet-access-setup → apps-script-relay-helpers → scraper-ats-config → discovery-engine-state → discovery-readiness → discovery-status-handoff → apps-script-deploy → discovery-setup-modals → discovery-drawer → ingest-url-flow → discovery-run-orchestration → app-bootstrap.js → app.js?v=30
```

Active implementation lane: C6 `bridge-registry.js` core-collapse per the Phase
6 survey order.

## Owner-only risks (unchanged)

- Leaked Gemini key/history cleanup remains outside this refactor; needs owner approval before public release.
