# STATUS — app.js Remainder Teardown Swarm

> Orchestrator ledger. **Last updated:** 2026-05-31 (session 16 — C1 discovery run orchestration dispatched).
> Branch: `refactor/app-js-decompose` · Integration checkout: `/Users/emilionunezgarcia/Job-Bored`
> Orchestrator surface: **Cursor Agent (Composer 2.5 Fast)** + **Task subagents** + **git worktrees** (no cmux)

## Startup checklist (session 2)

| Step | Result |
|---|---|
| Branch | `refactor/app-js-decompose` ✓ |
| Current dirty files | `M package-lock.json` only (unstaged local npm metadata; do not mix into refactor commits) |
| Node / npm | v24.13.0 / 11.13.0 ✓ |
| Baseline `npm test` | **892 pass / 0 fail / 0 skip** (188 suites, ~7.6s) |
| `app.js` LOC (current) | **5,237** (post ingest URL flow merge; was 12,456 post Phase 5 cut #1) |
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
by `pane2-ready-ingest-url-flow`. The next implementation lane is **C1
`discovery-run-orchestration.js`** from a fresh worktree at the new integration
tip.

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

## Active pane dispatch (session 15)

All implementation worktrees were created from `6f6b93a`, then rebased to the
latest session dispatch ledger. The integration checkout remains
orchestrator-only for merges and ledger commits.

| Pane | Role | Branch | Worktree | Status | Stop condition |
|---|---|---|---|---|---|
| 1 | Discovery drawer implementation | `refactor/app-js-decompose-pane1-done-discovery-drawer` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer-v2` | **MERGED** `a51d795` | Branch parked clean at `d4366bf`; branch and post-merge gates passed |
| 2 | Ingest URL flow implementation | `refactor/app-js-decompose-pane2-ready-ingest-url-flow` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-ingest-url-flow-v2` | **MERGED** `ed11dff` | Branch parked clean at `37cc686`; branch and post-merge gates passed |
| 3 | Phase 6 core-collapse survey | `refactor/app-js-decompose-pane3-parked-core-collapse-survey` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-core-collapse-survey` | **DONE — PARKED CLEAN** `366822a` | `docs/refactor/PLAN-app-js-core-collapse-next.md` drafted with candidate lanes, dependencies, and tests |
| 4 | QA / merge-readiness review | `refactor/app-js-decompose-pane4-parked-qa-review` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-qa-review` | **DONE — PARKED CLEAN** `0209b81` | `docs/refactor/QA-session-15-checklist.md` committed with exact gate commands and current branch/path preflight |

Pane 2 was dispatched from the lower-left Cursor pane. The visible Cursor branch
badge still showed the old Apps Script deploy branch during implementation, but
the worker bootstrap and rebase ran in
`/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-ingest-url-flow-v2`; the
actual parked branch is `refactor/app-js-decompose-pane2-ready-ingest-url-flow`.
The old Apps Script deploy worktree remains clean.

## Active pane dispatch (session 16)

Parallelism rule from the Phase 6 survey remains in force: **one
implementation worktree at a time**. Support panes stay read-only until the C1
implementation branch reports a commit SHA.

| Pane | Role | Branch | Worktree | Status | Stop condition |
|---|---|---|---|---|---|
| 1 | C1 implementation — `discovery-run-orchestration.js` | `refactor/app-js-decompose-discovery-run-orchestration-v2` | `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-run-orchestration-v2` | **ACTIVE DISPATCH** | Module extracted, branch clean and committed, branch gate green, report commit SHA + LOC |
| 2 | C1 focused test/source audit | read-only until C1 commit | existing Cursor pane only | **READ-ONLY SUPPORT** | Report app.js source-text assertions and likely focused tests; no file edits |
| 3 | C2 readiness prep | read-only until C1 merge | existing survey pane only | **READ-ONLY SUPPORT** | Keep C2 notes aligned with Phase 6 plan; no file edits |
| 4 | C1 merge-readiness QA | read-only until C1 commit | existing QA pane only | **READ-ONLY SUPPORT** | Prepare to run the C1 gate checklist after pane 1 reports a commit; no file edits |

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
| 24 | `discovery-run-orchestration.js` | **ACTIVE** | Cursor pane 1 | `appjs-discovery-run-orchestration-v2` | Fresh branch `refactor/app-js-decompose-discovery-run-orchestration-v2` fast-forwarded to dispatch ledger `b05b645`; extract C1 run orchestration only |
| 25+ | discovery remainder / core collapse | pending | — | — | Continue C2–C6 in the Phase 6 survey order after C1 is inspected and merged |

## Worktrees

| Path | Branch | Purpose | Status |
|---|---|---|---|
| `/Users/emilionunezgarcia/Job-Bored` | `refactor/app-js-decompose` | integration / orchestrator | active |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-sheets-writeback` | `refactor/app-js-decompose-sheets-writeback` | Phase 4 writeback | merged `95657ad` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-sheets-read-load` | `refactor/app-js-decompose-sheets-read-load` | Phase 4 read-load | merged `c4d529b` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-pipeline-render` | `refactor/app-js-decompose-pipeline-render` | Phase 4 pipeline | merged `576782d` |
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
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-drawer-v2` | `refactor/app-js-decompose-pane1-done-discovery-drawer` | Session 15 discovery drawer | merged `a51d795`; branch clean at `d4366bf` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-ingest-url-flow-v2` | `refactor/app-js-decompose-pane2-ready-ingest-url-flow` | Session 15 ingest URL flow | merged `ed11dff`; branch clean at `37cc686` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-core-collapse-survey` | `refactor/app-js-decompose-pane3-parked-core-collapse-survey` | Session 15 Phase 6 survey | done; parked clean at `366822a` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-qa-review` | `refactor/app-js-decompose-pane4-parked-qa-review` | Session 15 QA review | done; parked clean at `0209b81` |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-run-orchestration-v2` | `refactor/app-js-decompose-discovery-run-orchestration-v2` | Session 16 C1 discovery run orchestration | active dispatch from `b05b645` |

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
| 5 | Discovery remainder | **in progress** (run tracker + relay helpers + scraper ATS config + engine state + status handoff + Apps Script deploy + discovery drawer + ingest URL flow done) |
| 5b | Index decomposition guardrail | **DONE** (`a432bd2`; **894 pass**) |
| 6 | Auth / config / core collapse | in progress; config-core follow-up merged |

## Blockers / hygiene

1. **Discovery autofill WIP** — stashed as `discovery autofill WIP (post-phase4)` (`fb7c653`); breaks 4 discovery tests until finished; keep out of module-cut commits.
2. Phase 2 leaf cuts committed: `5cd73d6`, `51f97e4`, `cf1c654`.
3. **Plan LOC table** — re-derive ranges from **5,237** LOC `app.js` before each cut.
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
18. C1 `discovery-run-orchestration.js` **dispatched** — branch `refactor/app-js-decompose-discovery-run-orchestration-v2`, worktree `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-discovery-run-orchestration-v2`, base `b05b645`.
19. Gate and merge C1 before dispatching C2 readiness.
20. After each future merge, update this status doc with the branch gate, post-merge gate, commit SHA, and new `app.js` LOC.

## `index.html` script order (post Phase 5 cut #1)

```
… → sheets-writeback → sheets-read-load → pipeline-render → discovery-run-tracker → sheet-access-setup → apps-script-relay-helpers → scraper-ats-config → discovery-engine-state → discovery-status-handoff → apps-script-deploy → discovery-drawer → ingest-url-flow → app.js?v=30
```

## Owner-only risks (unchanged)

- Leaked Gemini key/history cleanup remains outside this refactor; needs owner approval before public release.
