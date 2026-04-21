# Runs Log — implementation handoff

**Workspace:** `feat/discovery-runs-log`
**Base:** `feat/layer5-integration` (via `main`)
**Status:** shippable. All contract surfaces landed (including Option B —
`/discovery-profile` completion logging, approved by orchestrator and
shipped as a follow-up chunk); tests green except two pre-existing
environment failures that predate this workspace (see §5).

---

## 1. What shipped

### Contract + types (`integrations/browser-use-discovery/src/contracts.ts`)
- `DISCOVERY_RUNS_SHEET_NAME = "DiscoveryRuns"`
- `DISCOVERY_RUNS_HEADER_ROW` (9 columns, matches contract §1 exactly)
- `DISCOVERY_RUN_TRIGGERS` enum + `DiscoveryRunTrigger` type
- `DiscoveryRunLogRow` type (one row shape)
- `trigger?: DiscoveryRunTrigger` added to **both** `DiscoveryProfileRequestV1`
  and `DiscoveryWebhookRequestV1`. See §6 for the reason both types carry it.

### Backend writer (new) — `src/sheets/discovery-runs-writer.ts`
- `appendDiscoveryRunRow(sheetId, row, deps)` — creates the tab + header on
  demand, truncates `error` to 200 chars, never throws. Returns
  `{ok: true, created}` / `{ok: false, reason}`.
- `createDiscoveryRunsLogger(deps)` — convenience factory bound to a
  `WorkerRuntimeConfig`, returns a `{append(sheetId, row)}` handle.
- Reuses `resolveAccessToken` from `pipeline-writer.ts` (exported fresh for
  this purpose — no duplication of the three-tier service-account / OAuth
  refresh / direct-token logic).

### runDiscovery completion hook — `src/run/run-discovery.ts`
- New optional deps: `discoveryRunsLogger?`, `discoveryRunsSource?`.
- At the end of `runDiscovery()`, builds a `DiscoveryRunLogRow` and fires the
  logger. Best-effort: failures log `discovery.runs_log.append_skipped` /
  `append_crashed` but never throw.
- Trigger precedence: `request.trigger` if present, else `"manual"` /
  `"cli"` based on the dispatcher's `trigger` arg.
- Status mapping: writeError → `failure`, lifecycle `partial` → `partial`,
  everything else → `success`.

### Webhook parsing — `src/webhook/{handle-discovery-profile,handle-discovery-webhook}.ts`
- Both webhook handlers now parse + validate `trigger` (must match the enum;
  bad values return 400). Threaded onto the parsed request so `runDiscovery`
  sees it. Logged in `request_accepted`.

### **Option B — `/discovery-profile` completion logging** (orchestrator-approved follow-up)
- `handleDiscoveryProfileWebhook` now emits a DiscoveryRuns row at every
  completion of `mode:"manual"` or `mode:"refresh"`. Covers both success
  (`ok:true` return) and the three caught-error branches (extract / discover
  / persist). `skip_company`, `status`, `schedule-save`, `schedule-status`
  are explicitly excluded — they are not discovery runs.
- Row shape (contract §3 table): `leadsWritten: 0` (this endpoint enriches
  companies; it doesn't write to Pipeline), `companiesSeen =
  companies.length` from `discoverCompaniesForProfile()`, `variationKey =
  sheetId` (no variationKey concept on this endpoint), `source =
  "worker@profile"` (overridable via `discoveryRunsSource` dep).
- Trigger: `request.trigger` if set, else `"cli"` for refresh, `"manual"`
  for manual mode.
- Duration measured from handler entry.
- Best-effort: a logger failure emits `discovery.runs_log.append_skipped` /
  `append_crashed` but never fails the handler.
- New deps on `HandleDiscoveryProfileDependencies`:
  `discoveryRunsLogger?`, `discoveryRunsSource?`, `now?`. Wired in
  `server.ts` to the shared `discoveryRunsLogger` singleton with
  `discoveryRunsSource: "worker@profile"`.

### Server bootstrap — `src/server.ts`
- `createDiscoveryRunsLogger({runtimeConfig, log: logEvent})` created once at
  startup and attached to `sharedRunDependencies` as `discoveryRunsLogger`.

### Installer artifacts
All four scheduler POST bodies now include the right trigger value so the
DiscoveryRuns log reflects who fired the run:

| File | Injected |
| --- | --- |
| `templates/launchd/com.jobbored.refresh.plist` | `"trigger":"scheduled-local"` |
| `templates/systemd/jobbored-refresh.service` | `"trigger":"scheduled-local"` |
| `scripts/windows/refresh.ps1` | `"trigger":"scheduled-local"` |
| `scripts/lib/schedule.mjs` (cron + systemd fallback body) | `"trigger":"scheduled-local"` |
| `templates/github-actions/command-center-discovery.yml` | `"trigger":"scheduled-github"` |

Existing installer tests (`tests/schedule-installers.test.mjs`) still pass —
they assert `"mode":"refresh"` with a regex, unaffected by the addition.

### Frontend
- `index.html`: new `#runsBtn` icon in the top-bar toolbar (next to Settings,
  rendered as a clock/arrow SVG). Opens a new `#runsModal` dialog with
  header, filter chips (trigger: All/Manual/Scheduled, status:
  All/Success/Failure), Reload button, status line, and a sortable 9-column
  table. Loaded via `<script src="runs-tab.js">`.
- `runs-tab.js`: standalone IIFE, attaches `window.JobBoredRunsLog =
  { fetchDiscoveryRuns, parseDiscoveryRunsValues, sortRuns, filterRuns }`.
  - `fetchDiscoveryRuns(sheetId, accessToken, {fetchImpl?})` — direct Sheets
    API GET `values/DiscoveryRuns!A2:I?valueRenderOption=UNFORMATTED_VALUE`,
    newest-first, caps at 200 rows, handles `missing_tab` / `empty` / `401`
    explicitly.
  - 60-second auto-refresh while the modal is open; stops on close.
  - Click column header to sort (toggles asc/desc).
  - Escape closes the modal; overlay click closes.
- `app.js`: one tiny addition — exposes
  `window.JobBored.getAccessToken()` and `window.JobBored.getSheetId()` so
  `runs-tab.js` can read the live token/id without grabbing internal
  symbols. Guarded with `typeof window !== "undefined"` so the auth
  slice-in-vm test harness (`oauth-session-storage-boundary.test.mjs`)
  still works.
- `style.css`: tokens-only styling for the runs modal, filter chips,
  status-color-coded table rows, and success/partial/failure badges.
  Uses `--space-*`, `--text-*`, `--radius-*`, `--surface*`, `--accent`.

---

## 2. Tests

### New tests (all green)
- `integrations/browser-use-discovery/tests/sheets/discovery-runs-writer.test.ts` — **7 tests**
  - append when tab exists + header matches
  - create tab + header when tab is missing (400 → addSheet → PUT header → append)
  - returns `ok:false` when the append fails (does NOT throw)
  - truncates long error strings to ≤200 chars
  - returns `ok:false` gracefully when no Google credential is configured
  - blanks the error cell when status=success even if row.error is set
  - `createDiscoveryRunsLogger` round-trip
- `integrations/browser-use-discovery/tests/webhook/discovery-profile-trigger.test.ts` — **7 tests**
  - accepts `trigger:"scheduled-local"` and logs it on request_accepted
  - rejects unknown trigger value with 400
  - omits trigger when not provided
  - **(Option B)** manual success logs a DiscoveryRuns row with
    `leadsWritten:0`, correct trigger, status, source, variationKey, duration
  - **(Option B)** refresh without explicit trigger defaults to `"cli"`
  - **(Option B)** company-discovery throw produces a failure row and the
    handler still returns 502 to the client
  - **(Option B)** mode:status / schedule-status / skip_company do NOT fire
    the runs logger
- `integrations/browser-use-discovery/tests/webhook/run-discovery-runs-log.test.ts` — **4 tests**
  - logger is called with the right sheetId + row (trigger round-trip from
    `request.trigger` through to logged row)
  - falls back to dispatcher trigger when request.trigger is absent
  - run still completes when logger returns `ok:false`
  - run still completes when logger throws
- `tests/runs-tab.test.mjs` — **16 tests** across 4 describe blocks
  - parseDiscoveryRunsValues: shape mapping, skip-incomplete-rows, type guards
  - sortRuns: string + numeric sort, asc/desc
  - filterRuns: all×all, scheduled matches both local+github, status filters
  - fetchDiscoveryRuns: signed-out, missing-tab, empty-tab, happy path
    (newest-first), 401 → unauthorized, URL + Bearer header shape

### Self-gate results

**Backend:** `env -u NODE_OPTIONS node scripts/run-tests.mjs integrations/browser-use-discovery/tests/`
```
tests 435 | pass 434 | fail 1
```
The one failure is **pre-existing** and unrelated to this workspace:
`tests/e2e/operator-prereqs.test.ts` reads `state/worker-config.json` as a
fixture; that directory is gitignored and doesn't exist in a fresh worktree.

**Top-level:** `env -u NODE_OPTIONS node --test tests/*.test.mjs`
```
tests 217 | pass 216 | fail 1
```
The one failure is **pre-existing**: `tests/repo-validation-surface.test.mjs`
asserts `npm run test:repo` but `package.json` has `npm run
test:browser-use-discovery` (drift introduced by commit
`9246562 refactor(validation): add local TLS dashboard surface for ATS
checks` on the base branch).

---

## 3. Manual smoke notes

I can't drive a browser from this environment, so the UI was exercised only
via the unit tests above. Before shipping, please:

1. Start the dev server locally and open the dashboard.
2. Click the new clock/refresh icon in the top-bar toolbar — `#runsModal`
   should open with the filter chips + empty status line.
3. Verify the empty-state message ("No runs logged yet — trigger a
   discovery to populate this list") renders when the sheet has no
   DiscoveryRuns tab (a brand-new sheet).
4. Trigger a discovery run (manual via the dashboard's Run discovery button,
   or via an installer script for the scheduled path). Confirm:
   - A new `DiscoveryRuns` tab appears in the sheet with the correct header.
   - A row lands with the expected trigger value (`manual`,
     `scheduled-local`, `scheduled-github`).
   - The modal auto-refreshes within 60s and the new row appears.
5. Click column headers to verify sort toggles.
6. Filter chips: click Scheduled → only scheduled-* rows visible; click
   Failure → only failure rows visible.

Regression spots worth a sanity check:
- Settings modal still opens (`#settingsBtn` is unaffected).
- Manual Run discovery still completes end-to-end (the logger is best-effort
  and guarded, but worth verifying it doesn't delay the run's ack).

---

## 4. Open contract questions

One nuance worth flagging to the orchestrator — I resolved it pragmatically
but a follow-up clarification to the contract would cement it:

### 4.1 `trigger` on DiscoveryWebhookRequestV1

Contract §2 says "add a top-level optional string field to
`DiscoveryProfileRequestV1`." However:
- `templates/github-actions/command-center-discovery.yml` POSTs to
  `/discovery-webhook` (event `command-center.discovery`, not
  `/discovery-profile`), which lands on `handle-discovery-webhook.ts` and
  deserialises to `DiscoveryWebhookRequestV1`.
- The brief's install-artifact list explicitly includes the GH Actions YAML
  and says to inject `"trigger":"scheduled-github"` into it.

To make that injection reach `runDiscovery()` I also added `trigger` to
`DiscoveryWebhookRequestV1` and extended `parseWebhookRequest` to parse it.
This is the only deviation from a strict literal read of §2. If the
orchestrator prefers the contract stay pure to `DiscoveryProfileRequestV1`,
the alternative is to accept that scheduled-github runs are labeled
`"manual"` in the log — which would misrepresent them.

**Recommendation:** update contract §2 to say "on both request types" so the
wire format is documented.

### 4.2 Local scheduled refresh logging (**Option B, resolved**)

Original concern: local installers POST to `/discovery-profile` with
`mode:"refresh"`, which enriches the company list but does not call
`runDiscovery()`. The first pass only logged from `runDiscovery()` so
scheduled-local fires were invisible in the sheet.

**Orchestrator approved Option B.** `/discovery-profile` now logs a
DiscoveryRuns row at every manual/refresh completion with `leadsWritten:0`
(since it enriches companies rather than writing leads). Contract §3 has
been updated with an explicit column-semantics table so the two row
variants are unambiguous to readers.

---

## 5. Files changed

```
 M app.js
 M index.html
 M integrations/browser-use-discovery/src/contracts.ts
 M integrations/browser-use-discovery/src/run/run-discovery.ts
 M integrations/browser-use-discovery/src/server.ts
 M integrations/browser-use-discovery/src/sheets/pipeline-writer.ts
 M integrations/browser-use-discovery/src/webhook/handle-discovery-profile.ts
 M integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts
 M scripts/lib/schedule.mjs
 M scripts/windows/refresh.ps1
 M style.css
 M templates/github-actions/command-center-discovery.yml
 M templates/launchd/com.jobbored.refresh.plist
 M templates/systemd/jobbored-refresh.service
?? integrations/browser-use-discovery/src/sheets/discovery-runs-writer.ts
?? integrations/browser-use-discovery/tests/sheets/discovery-runs-writer.test.ts
?? integrations/browser-use-discovery/tests/webhook/discovery-profile-trigger.test.ts
?? integrations/browser-use-discovery/tests/webhook/run-discovery-runs-log.test.ts
?? runs-tab.js
?? tests/runs-tab.test.mjs
```

---

## 6. Commit guidance

Brief said "commit per logical chunk. No push." — I attempted but global
rules prohibit committing without explicit user authorization, so I left the
working tree dirty for Emilio to commit himself. Suggested logical groups
(bottom-up so tests come after the code they test):

1. **contract** — `contracts.ts` + `docs/INTERFACE-DISCOVERY-RUNS.md`
2. **writer** — `src/sheets/discovery-runs-writer.ts` + `src/sheets/pipeline-writer.ts` (just the export of `resolveAccessToken`)
3. **run-discovery wiring** — `src/run/run-discovery.ts` + `src/server.ts`
4. **webhook trigger parsing** — `src/webhook/handle-discovery-profile.ts` + `src/webhook/handle-discovery-webhook.ts`
5. **installer artifacts** — the four plist/service/ps1/cron-lib/yml diffs
6. **backend tests** — the three new `tests/*.test.ts` files
7. **frontend** — `index.html` + `runs-tab.js` + `style.css` + `app.js` getter
8. **frontend tests** — `tests/runs-tab.test.mjs`

---

## 7. What was NOT touched (per brief)

- `settings-profile-tab.js` — different feature territory. ✓ unchanged.
- SQLite schema / `state/worker-state.sqlite`. ✓ unchanged.
- The Schedule card code from the prior feature. ✓ unchanged.

All log data lives exclusively in the Sheet per contract §3.
