# STATUS — app.js Remainder Teardown Swarm

> Orchestrator ledger. **Last updated:** 2026-05-31 (session 3 — Phase 2 leaf cuts 4–6).
> Branch: `refactor/app-js-decompose` · Integration checkout: `/Users/emilionunezgarcia/Job-Bored`
> Orchestrator surface: **Cursor Agent (Composer 2.5 Fast)** + **Task subagents** + **git worktrees** (no cmux)

## Startup checklist (session 2)

| Step | Result |
|---|---|
| Branch | `refactor/app-js-decompose` ✓ |
| Pre-existing dirty files | `M app.js` (1-line discovery webhook candidate — **do not mix into module cuts**), `M package-lock.json`, untracked `docs/refactor/*` |
| Node / npm | v24.13.0 / 11.13.0 ✓ |
| Baseline `npm test` | **892 pass / 0 fail / 0 skip** (188 suites, ~7.6s) |
| `app.js` LOC (current) | **19,268** (post cuts 3–6; was 20,873 pre-swarm) |
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

## Integration commits (merged to `refactor/app-js-decompose`)

| Commit | Module | app.js delta (approx) | Tests |
|---|---|---|---|
| `4ee8a25` | `app-utils.js` | −~30 LOC body | green |
| `62e6f30` | `daily-brief.js` | −~1,000 LOC body | green |
| `9112a65` | `JobBoredApp.core.host` bridge | +~230 LOC bridge | green |
| `f215a33` | `keyword-profile-match.js` | −~511 LOC | green |
| `5cd73d6` | `profile-materials.js` | −~370 LOC | green |
| `51f97e4` | `expired-review-ui.js` | −~370 LOC | green |
| *(pending)* | `posting-enrichment.js` | −~450 LOC | 890 pass / 2 env fail |

## Extraction order progress

| Plan step | Module | Status | Worker | Worktree / branch | Notes |
|---|---|---|---|---|---|
| 0 | Pre-flight bridge / `JobBoredApp.core.host` | **DONE** (uncommitted on primary) | orchestrator | primary + worktree | +230 LOC bridge; 892 pass primary + worktree |
| 1 | `app-utils.js` | **DONE** | prior session | primary | `4ee8a25` |
| 2 | `daily-brief.js` | **DONE** | prior session | primary | `62e6f30`; `index.html` loads `daily-brief.js?v=1` |
| 3 | `keyword-profile-match.js` | **DONE** | frontend-developer | worktree → primary | `f215a33`; **~511** LOC out |
| 4 | `profile-materials.js` | **DONE** | frontend-developer | primary | `5cd73d6`; Materials modal + LinkedIn capture |
| 5 | `expired-review-ui.js` (`JobBoredApp.expiredReview`) | **DONE** | frontend-developer | primary | `51f97e4`; UI only; root `expired-review.js` unchanged |
| 6 | `posting-enrichment.js` | **DONE** (uncommitted) | frontend-developer | primary | Cache + pipeline + `jb:role:opened` listener; **519** LOC module |
| 7+ | materials / ATS / onboarding / … | pending | — | — | see PLAN §D |

## Worktrees

| Path | Branch | Purpose | Status |
|---|---|---|---|
| `/Users/emilionunezgarcia/Job-Bored` | `refactor/app-js-decompose` | integration / orchestrator | active |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-core-host` | `refactor/app-js-decompose-core-host` | Phase 1 bridge | **green / merge pending commit** |
| `/Users/emilionunezgarcia/Job-Bored-worktrees/appjs-keyword-profile-match` | `refactor/app-js-decompose-keyword-profile-match` | Cut 3 keyword-profile-match | **green / merge pending commit** |

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
| 2 | Leaf modules: keyword → profile → expired UI → enrichment | **DONE** (commit cut 6 pending) |
| 3 | Materials / ATS / onboarding / settings | pending |
| 4 | Pipeline / Sheets | pending |
| 5 | Discovery remainder | pending |
| 6 | Auth / config / core collapse | pending |

## Blockers / hygiene

1. **Uncommitted local fix** — `app.js` adds `!!transport.localWebhookUrl` to `getDiscoveryRunWebhookUrlCandidates`; keep out of module-cut commits unless owner folds it in separately.
2. Cuts 4–5 committed (`5cd73d6`, `51f97e4`); cut 6 staged locally pending commit.
3. **Plan LOC table** — line ranges in PLAN were authored at 21,648 LOC; re-derive ranges from current `app.js` before each cut.

## Next actions (orchestrator)

1. ~~Collect Phase 0 research manifests~~ **done** (all 5 ready)
1. ~~Land Phase 1 foundation bridge~~ **done** (892 pass; commit when authorized).
2. ~~Extract `keyword-profile-match.js`~~ **done** (892 pass; commit when authorized).
3. Next: Phase 3 materials / ATS / onboarding per PLAN §D; re-derive ranges from **19,268** LOC `app.js`.

## Owner-only risks (unchanged)

- Leaked Gemini key/history cleanup remains outside this refactor; needs owner approval before public release.
