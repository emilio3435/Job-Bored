# be-data-deploy lane — handoff

**Run:** `redesign-20260424T0742Z`
**Worktree:** `../Job-Bored-wt-redesign-be-data-deploy`
**Branch:** `redesign/be-data-deploy` (off `main@a28c416`)
**Model:** `gpt-5.5`, reasoning `xhigh`.

## Task

Support the three frontend lanes with **truthful data contracts**. No frontend files unless the orchestrator explicitly requests. You are **not** applying a visual system — but read `docs/redesign/DESIGN-SYSTEM.md` so you understand what data the FE lanes need to surface (stage age, follow-up state, run status, source freshness, discovery health). In scope:

1. **Stage age** (fe-kanban). Confirm or add a derivation of "days in current stage" from Pipeline + DiscoveryRuns. Candidates: `job.statusChangedAt`, `job.lastUpdatedAt`, `job.addedAt`. If none is reliable, add a helper in `discovery-shared-helpers.js` or the parser (`parsePipelineCSV` resides in `app.js` — **do not touch app.js**; instead produce a spec + fixture that fe-kanban can implement).
2. **Follow-up state** (fe-dashboard, fe-detail-drawer). Confirm the `followup*` column set in `schemas/pipeline-row.v1.json` and the writer path. Make sure the schema covers what the new dashboard needs to surface.
3. **Run status + source freshness** (fe-dashboard). Confirm `/runs/{runId}` + the runs log JSON contract used by `runs-tab.js`. Confirm which field the dashboard should read for "last successful discovery run timestamp" and "source per lane (SerpApi / Gemini / browser-use)".
4. **Discovery health** (fe-dashboard). Confirm `curl http://127.0.0.1:8644/health` schema; extend only if the dashboard needs more than `{status, platform}`.

## Ownership (exclusive)

- `server/` (dev relay, if any endpoints touched).
- `integrations/browser-use-discovery/` (worker code, tests, config) — prefer `scripts/run-tests.mjs` where directory expansion matters.
- `schemas/` — pipeline + webhook contracts.
- `scripts/` — helpers, test runners, contract checks.
- `discovery-shared-helpers.js`, `discovery-wizard-*.js` — **only** if the data helpers for stage age / follow-up / run status live there.
- `tests/` for contract/discovery/backend.

## Forbidden (unless orchestrator grants)

- `app.js`, `style.css`, `index.html`, `runs-tab.js`, `settings-*.js`, `settings-tabs.css`.
- Resume/cover/ATS generation client surfaces (`resume-*.js`, `document-templates.js`) — though you may read them.

## Preserve (do not break)

- Webhook contract between agents and the dashboard (`AGENT_CONTRACT.md`).
- `Pipeline` sheet column order and enums (`schemas/pipeline-row.v1.json`).
- `DiscoveryRuns` sheet contract and the runs log API shape.
- Existing discovery worker test invariants.

## Verification

```bash
env -u NODE_OPTIONS node scripts/run-tests.mjs integrations/browser-use-discovery/tests/ 2>&1 | tail -30
npm run test:pipeline-contract 2>&1 | tail -20
npm run test:contract:all 2>&1 | tail -20
curl -sS http://127.0.0.1:8644/health
```

If you touch worker code, also run `integrations/browser-use-discovery/tests/` focused suites.

## Deploy notes deliverable

Fill in before handoff:
- **Env checks** — what env vars are required/optional for the new flows.
- **Rollback** — the exact `git revert` or `git checkout` for the lane's branch.
- **Backend verification** — one-liners for smoke + deep-check.
- **Do not mutate production unless explicitly approved in-thread.**

## Handoff deliverable

- [x] Changed files (list). — see Completion report → Files changed.
- [x] Tests run + results. — see Completion report → Tests + Verification addendum.
- [x] Contract diffs if any (`schemas/*.json` + changelog in `docs/CONTRACT-CHANGELOG.md`). — **none**, no changelog entry required.
- [x] Deploy notes (env, rollback, verification). — see Completion report → Deploy notes.
- [x] Known risks. — see Completion report → Known risks.
- [x] Answers to fe-dashboard / fe-kanban / fe-detail-drawer data questions. — see Completion report → Answers to FE lanes.

---

## Completion report (lane fills in)

**Files changed:**

- `discovery-shared-helpers.js` — added `parsePipelineDate`, `deriveStageAge`, `deriveFollowUpState` to `window.JobBoredDiscoveryHelpers`. No behavior change to existing URL helpers.
- `scripts/discovery-shared-helpers.mjs` — same three helpers exported for Node tests (the "COPIES" pact in the file header).
- `tests/pipeline-row-derivations.test.mjs` — new. 14 unit tests covering the fallback chain, timezone-safe, injectable `now`.
- `docs/redesign/handoffs/be-data-deploy-to-fe-kanban.md` — response to `fe-kanban-to-be-data-deploy.md` explaining why `statusChangedAt` cannot be added in this run + the derivation contract FE should consume.

No changes to: `app.js`, `style.css`, `index.html`, `schemas/*.json`, `AGENT_CONTRACT.md`, `runs-tab.js`, `integrations/browser-use-discovery/`, `server/`.

**Tests (2026-04-24 re-run, final):**

- `env -u NODE_OPTIONS node --test tests/pipeline-row-derivations.test.mjs` → **14/14 pass**.
- `env -u NODE_OPTIONS node --test tests/runs-tab.test.mjs` → **22/22 pass** (baseline, untouched).
- `env -u NODE_OPTIONS npm run test:pipeline-contract` → **OK** (schema ↔ README ↔ app.js in sync).
- `env -u NODE_OPTIONS npm run test:contract:all` → **OK** (discovery webhook, ATS request/response, pipeline, skills).
- `env -u NODE_OPTIONS node scripts/run-tests.mjs integrations/browser-use-discovery/tests` → **434/435 pass**. One pre-existing env failure (`tests/e2e/operator-prereqs.test.ts` needs `integrations/browser-use-discovery/state/worker-config.json`, not seeded in this worktree). `git diff a28c416 -- integrations/browser-use-discovery/` is empty → not a lane regression.
- `env -u NODE_OPTIONS npm run typecheck:repo` → exit 0.

**Contract diffs:**

None. `schemas/pipeline-row.v1.json` is unchanged, `AGENT_CONTRACT.md` is unchanged, `docs/INTERFACE-DISCOVERY-RUNS.md` is unchanged, the discovery webhook schema is unchanged, and `docs/CONTRACT-CHANGELOG.md` did not need a new entry — the redesign FE lanes get everything they need by deriving from already-emitted fields.

**Deploy notes:**

- **Env checks:** No new env vars. Worker still wants `BROWSER_USE_DISCOVERY_GEMINI_API_KEY` + `SERPAPI_API_KEY` for the respective lanes; these are already documented in `integrations/browser-use-discovery/README.md` and surfaced on `/health`.
- **Rollback:** `git checkout main -- discovery-shared-helpers.js scripts/discovery-shared-helpers.mjs && rm tests/pipeline-row-derivations.test.mjs` — or simply `git revert` the lane's merge commit. There is no sheet write, no schema change, no migration to unwind.
- **Backend verification (smoke):**
  ```bash
  env -u NODE_OPTIONS node --test tests/pipeline-row-derivations.test.mjs
  env -u NODE_OPTIONS npm run test:contract:all
  curl -sS http://127.0.0.1:8644/health | python3 -m json.tool  # when worker is running
  ```
- **Backend verification (deep-check):** run `npm run test:repo` with a live network — it exercises browser-use-discovery Sheets-writer tests and the full contract suite.
- **Production mutation:** none requested, none performed.

**Known risks:**

- `deriveStageAge` under-reports for rows that skip `Applied` (e.g. moved `New` → `Interviewing` by hand) — they fall back to `dateFound` and look older than the stage actually is. Documented inline in the helper. Fix is out of scope: needs a contract bump.
- Timezone drift: the helpers normalize to local midnight to match `app.js` `parseBriefDate` behavior. A user whose laptop timezone drifts across midnight will see day counts shift by 1 at midnight. Matches existing `overdueFollowUps` behavior — no regression.
- If a future run adds optional column U (`Status Changed At`), the helpers should be updated to prefer it. Rollback of the column without rolling back the helper is still safe — the fallback chain handles blanks.
- `/health` on port 8644 on the dev machine currently returns a stub `{status, platform}` (some other process is bound). The real worker's `buildHealthPayload()` (integrations/browser-use-discovery/src/server.ts:575) returns the rich readiness object. fe-dashboard should code against the rich shape and treat the stub as a degraded-readable state.

**Answers to FE lanes:**

- **Stage age field (fe-kanban):**
  - **No** `statusChangedAt` or `lastUpdatedAt` in `parsePipelineCSV` output. Adding one needs a column-U bump; out of scope this run.
  - **Use** `window.JobBoredDiscoveryHelpers.deriveStageAge(job)` → `{ days, source }`.
  - Fallback: `appliedDate` (col N, sheet index 13) for Applied/Phone Screen/Interviewing/Offer; else `dateFound` (col A, sheet index 0).
  - Full contract + caveats in `docs/redesign/handoffs/be-data-deploy-to-fe-kanban.md`.

- **Follow-up state fields (fe-dashboard / drawer):**
  - Only `followUpDate` exists (schema col P, sheet index 15, `job.followUpDate`). No "did I send it?" flag in the sheet — that signal is indirect via status transitions (`updateJobStatus` in app.js clears `followUpDate` on Offer/Rejected/Passed).
  - **Use** `window.JobBoredDiscoveryHelpers.deriveFollowUpState(job)` → `{ state: "none"|"overdue"|"due-soon"|"scheduled"|"invalid", ... }`.
  - The existing app.js helpers `overdueFollowUps(jobs)` and `upcomingFollowUps48h(jobs)` (L11816, L11828) match this logic for list-level use.

- **Last-run + source freshness fields (fe-dashboard):**
  - **Last successful discovery run timestamp:** read the `DiscoveryRuns` sheet via `runs-tab.js` exports (`window.JobBoredRunsLog.fetchDiscoveryRuns(sheetId, accessToken)`), take the first row after default-sort (`{ key: "runAt", direction: "desc" }`), and read `runs[0].runAt`. Contract: `docs/INTERFACE-DISCOVERY-RUNS.md` §4–5. ISO-8601 UTC string, sortable as text.
  - **Source per lane (SerpApi / Gemini / browser-use):** the sheet row has only a single aggregate `source` column (col G, e.g. `worker@v0.4.1`). Per-lane source detail is not in the sheet log — it lives in the run-status payload at `GET /runs/{runId}` (worker) under `sources: DiscoverySourceSummary[]`. Each summary carries `sourceId: "serpapi_google_jobs" | "grounded_web" | "browser_use" | ...`, `leadsSeen`, `leadsAccepted`, etc. For an at-a-glance "last run used X lanes" pill, either:
    1. Prefer the run-status endpoint when `runId` is still in the worker's SQLite (recent runs) → richest data.
    2. Fall back to the sheet `source` string (always available, never structured).
  - The `/health` response (`readiness.enabledSources`, `readiness.serpApiGoogleJobs`, `readiness.groundedWeb`) tells you which lanes are *configured*, separately from what the last run *used*.

- **Discovery health JSON shape (fe-dashboard):**
  - Already rich enough for dashboard use — **no extension needed**. `buildHealthPayload()` in `integrations/browser-use-discovery/src/server.ts:575` returns:
    ```jsonc
    {
      "status": "ok",
      "service": "browser-use-discovery-worker",
      "mode": "local" | "hosted",
      "asyncAckByDefault": boolean,
      "routes": { "health", "webhook", "discovery", "discoveryProfile", "ingestUrl", "runStatus": "/runs/{runId}" },
      "readiness": {
        "ready": boolean,
        "configLoaded": boolean,
        "configuredSheetId": boolean,
        "companiesConfigured": number,
        "atsCompaniesConfigured": number,
        "modifierIntentConfigured": boolean,
        "plannerSeedReady": boolean,
        "atsSeedReady": boolean,
        "enabledSources": string[],
        "memory": { "companyRegistry", "careerSurfaces", "deadLinkCache", "listingFingerprints", "intentCoverage" },
        "planner": { ... },
        "ats": { ... },
        "sheetsCredential": { "configured", "ready", "source", "requestScopedAuthSupported", ... },
        "browserRuntime": { "configured", "available", ... },
        "groundedWeb": { "enabled", "ready", "cause?", "remediation?" },
        "serpApiGoogleJobs": { "enabled", "configured", "ready", "cause?", "remediation?" },
        "warnings": string[],
        "blockingWarnings"?: string[],
        "advisoryWarnings"?: string[]
      }
    }
    ```
  - For the fe-dashboard "source freshness" pill, the interesting fields are `readiness.enabledSources[]`, `readiness.serpApiGoogleJobs.ready`, `readiness.groundedWeb.ready`, and the top-level `readiness.ready`.
  - **Degraded response:** on the dev machine today a minimal stub `{"status":"ok","platform":"webhook"}` answers on port 8644 from a co-resident process. fe-dashboard should treat missing `readiness` as "worker not running / stub" and render a "Start worker" CTA, not crash.

## Verification addendum (2026-04-24 re-run)

- `env -u NODE_OPTIONS node scripts/run-tests.mjs integrations/browser-use-discovery/tests` → **434/435 pass**. The one failing test (`tests/e2e/operator-prereqs.test.ts`) is a pre-existing environment artifact: it reads `integrations/browser-use-discovery/state/worker-config.json` which isn't seeded in this worktree. `git diff a28c416 -- integrations/browser-use-discovery/` → empty, so the failure is not a lane regression. Flagging for operator awareness.
- `curl -sS http://127.0.0.1:8644/health` → `{"status": "ok", "platform": "webhook"}` (stub). `lsof -iTCP:8644` confirms the listener is `hermes_cli.main gateway run --replace`, **not** the redesign worker. The real `buildHealthPayload()` is untouched in `integrations/browser-use-discovery/src/server.ts`; to exercise the rich payload, stop the Hermes gateway first and boot the worker on 8644 (or configure the worker on a different port and have fe-dashboard probe both). Not a contract issue — a port-collision / dev-env artifact.
- Lane diff vs `a28c416`: `discovery-shared-helpers.js` +161, `scripts/discovery-shared-helpers.mjs` +96, `tests/pipeline-row-derivations.test.mjs` +167. 424 insertions, 0 deletions, 0 contract-file edits.

## Cross-lane note (2026-04-24)

fe-kanban landed their board with an inline fallback `statusChangedAt → lastUpdatedAt → addedAt → discoveredAt → dateFound` (none of the first four exist, so it resolves to `dateFound` today) and logged stage-age as Known Risk #1. A drop-in swap to `JobBoredDiscoveryHelpers.deriveStageAge(job)` would lift that risk for the Applied funnel (prefer `appliedDate` over `dateFound` when status ∈ Applied/Phone Screen/Interviewing/Offer) with no contract change. Appended to `be-data-deploy-to-fe-kanban.md`. Non-blocking for this run's merge.

