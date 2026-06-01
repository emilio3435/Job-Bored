# STATUS — app.js Remainder Teardown Swarm

> Orchestrator ledger. **Last updated:** 2026-05-31 (session 14 — Apps Script deploy merged; empty next lanes parked).
> Branch: `refactor/app-js-decompose` · Integration checkout: `/Users/emilionunezgarcia/Job-Bored`
> Orchestrator surface: **Cursor Agent (Composer 2.5 Fast)** + **Task subagents** + **git worktrees** (no cmux)

## Startup checklist (session 2)

| Step | Result |
|---|---|
| Branch | `refactor/app-js-decompose` ✓ |
| Pre-existing dirty files | `M app.js` (1-line discovery webhook candidate — **do not mix into module cuts**), `M package-lock.json`, untracked `docs/refactor/*` |
| Node / npm | v24.13.0 / 11.13.0 ✓ |
| Baseline `npm test` | **892 pass / 0 fail / 0 skip** (188 suites, ~7.6s) |
| `app.js` LOC (current) | **9,143** (post discovery status handoff; was 12,456 post Phase 5 cut #1) |
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

Shared-file rule in force: `index.html` structural changes landed with B first,
legacy CSS `<head>` links landed with C, and the scoped A config follow-up landed
after rebasing onto post-C integration. The first Phase 7 app-js lane
(`apps-script-relay-helpers.js`) landed next from a rebased worker branch, then
`scraper-ats-config.js` landed from a rebased worker branch, then
`discovery-engine-state.js` landed from a rebased worker branch, then
`discovery-status-handoff.js` landed from a rebased worker branch. Session 14
created three fresh app-js lanes from integration tip `0250251`; Apps Script
deploy landed first from a clean worker branch. The discovery drawer and ingest
URL branches contain no extraction work and are parked clean. Revive order is
**discovery-drawer → ingest-url-flow**, after rebasing or recreating each branch
from the latest integration tip.

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
| 20 | `discovery-drawer.js` | **PARKED** | none active | `appjs-discovery-drawer` | Clean branch with no diff; revive from latest integration before extracting discovery drawer, per-run profile tuning, source readiness, and AI suggestion helpers |
| 21 | `ingest-url-flow.js` | **PARKED** | none active | `appjs-ingest-url-flow` | Clean branch with no diff; revive from latest integration before extracting paste-a-job URL ingest, manual fallback modal, async status polling, and auto-enrich flow |
| 22+ | discovery remainder / core collapse | pending | — | — | Re-scan `app.js` after the three session 14 merges and choose the next cohesive lane |

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
| 5 | Discovery remainder | **in progress** (run tracker + relay helpers + scraper ATS config + engine state + status handoff + Apps Script deploy done) |
| 5b | Index decomposition guardrail | **DONE** (`a432bd2`; **894 pass**) |
| 6 | Auth / config / core collapse | in progress; config-core follow-up merged |

## Blockers / hygiene

1. **Discovery autofill WIP** — stashed as `discovery autofill WIP (post-phase4)` (`fb7c653`); breaks 4 discovery tests until finished; keep out of module-cut commits.
2. Phase 2 leaf cuts committed: `5cd73d6`, `51f97e4`, `cf1c654`.
3. **Plan LOC table** — re-derive ranges from **9,143** LOC `app.js` before each cut.
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
13. Discovery drawer and ingest URL flow branches are **parked clean** because they have no extraction commits and no branch diff to gate.
14. Revive order for the next session: **discovery-drawer → ingest-url-flow**. Each branch must start from the latest integration tip and pass `git diff --check refactor/app-js-decompose...HEAD`, exact conflict-marker scan, `node --check` for touched JS, and full `npm test` before merge.
15. After each future merge, update this status doc with the branch gate, post-merge gate, commit SHA, and new `app.js` LOC.

## `index.html` script order (post Phase 5 cut #1)

```
… → sheets-writeback → sheets-read-load → pipeline-render → discovery-run-tracker → sheet-access-setup → apps-script-relay-helpers → scraper-ats-config → discovery-engine-state → discovery-status-handoff → apps-script-deploy → [discovery-drawer] → [ingest-url-flow] → app.js?v=30
```

## Owner-only risks (unchanged)

- Leaked Gemini key/history cleanup remains outside this refactor; needs owner approval before public release.
