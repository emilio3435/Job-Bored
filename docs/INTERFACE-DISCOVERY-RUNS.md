# Interface contract — Discovery Runs Log

**Status:** authoritative contract for the `feat/discovery-runs-log` workspace. All persistence lives in the user's Google Sheet; **no new SQLite columns, no new local files, no new hidden state.**

**Scope:** a new `DiscoveryRuns` tab in the Sheet + a worker-side append hook at every discovery run completion + a new dashboard tab/panel that reads and renders those rows.

---

## 1. Sheet tab — `DiscoveryRuns`

**Tab name:** `DiscoveryRuns` (literal, case-sensitive — matches the `Pipeline` / `Blacklist` naming convention already in `contracts.ts`).

**Header row (row 1):**

| Col | Header | Example | Notes |
| --- | --- | --- | --- |
| A | `Run At` | `2026-04-21T15:12:03Z` | ISO-8601 UTC. Sortable as text. |
| B | `Trigger` | `manual` | Enum: see §2. |
| C | `Status` | `success` | Enum: `success` / `partial` / `failure`. |
| D | `Duration (s)` | `47` | Integer seconds. |
| E | `Companies Seen` | `12` | Integer. |
| F | `Leads Written` | `3` | Integer — distinct new rows appended to Pipeline this run. |
| G | `Source` | `worker@v0.4.1` | Free-form; worker sets. |
| H | `Variation Key` | `gh-1234-abcd` | Existing concept from `DiscoveryWebhookRequestV1.variationKey`. |
| I | `Error` | `timeout on acme.com` | Blank when `status=success`. Short (< 200 chars). |

Add a `PIPELINE_DEDUPE_HEADER`-style constant to `contracts.ts`:

```ts
export const DISCOVERY_RUNS_SHEET_NAME = "DiscoveryRuns";
export const DISCOVERY_RUNS_HEADER_ROW = [
  "Run At",
  "Trigger",
  "Status",
  "Duration (s)",
  "Companies Seen",
  "Leads Written",
  "Source",
  "Variation Key",
  "Error",
] as const;
```

The worker ensures the tab + header exist on first append (create-if-missing). Reuse the Sheets API client that already writes Pipeline.

---

## 2. Trigger enum

Every discovery run MUST record one of these values in column B. The worker infers from request shape + new optional `trigger` field:

| Value | When |
| --- | --- |
| `manual` | POST `/discovery-profile` with `mode:"manual"` (the default — user clicked "Run discovery" in the UI). |
| `scheduled-local` | POST `/discovery-profile` with `mode:"refresh"` + optional body `trigger:"scheduled-local"` (launchd / systemd / schtasks). |
| `scheduled-github` | Same, with `trigger:"scheduled-github"` (GitHub Actions workflow). |
| `scheduled-appsscript` | Same, with `trigger:"scheduled-appsscript"` (Apps Script time trigger). |
| `cli` | Direct CLI invocation — a one-off `curl` or `npm run ...`. Default when `mode:"refresh"` and no `trigger` field is present. |

**Request contract extension:** add a top-level optional string field to `DiscoveryProfileRequestV1`:

```ts
/** Who/what initiated this run. Omit for UI-initiated runs (worker defaults to "manual"). */
trigger?: "manual" | "scheduled-local" | "scheduled-github" | "scheduled-appsscript" | "cli";
```

The three OS installer scripts (`templates/launchd/*.plist`, `scripts/windows/refresh.ps1`, `templates/systemd/*.service`) must be updated to include `"trigger":"scheduled-local"` in their POST body so the log reflects the origin accurately. The GitHub Actions template sends `"trigger":"scheduled-github"`.

---

## 3. Worker write hook

**Where:** one row per completed discovery run, at each of these completion points:

1. **`runDiscovery()`** (reference: `integrations/browser-use-discovery/src/run/run-discovery.ts`) — the primary Pipeline-writing path hit by POST `/discovery-webhook` (dashboard "Run discovery" button + GitHub Actions scheduled dispatch). `Leads Written` reflects `writeResult.appended`.

2. **`handleDiscoveryProfileWebhook()`** (reference: `integrations/browser-use-discovery/src/webhook/handle-discovery-profile.ts`) for `mode:"manual"` and `mode:"refresh"` completions — these are the enrichment paths hit by the UI's initial discovery setup and by local OS schedulers (launchd / systemd / Windows Task Scheduler). These paths extract a profile + refresh the stored company list via Gemini; they do **not** write Pipeline rows. Log them with `Leads Written: 0` so scheduled-local fires are still visible to the user.

The row is constructed via the shared `appendDiscoveryRunRow(sheetId, row)` helper that appends via the existing Sheets client (reusing the Pipeline writer's `resolveAccessToken`).

**Non-blocking:** the append is best-effort at every call site. If the Sheets call fails, log to the worker's console + continue — **do not** fail the run or the request. A discovery run that wrote 3 leads to Pipeline but couldn't log itself is still a success from the user's POV; surfacing the failure would create an unwanted coupling.

**Where NOT to write:**
- Do not write during partial progress. One row per run, at completion only.
- Do not write to SQLite. All run history lives in the Sheet.
- Do not write per-lead events. Only run-level summaries.
- Do **not** log from the non-run `/discovery-profile` modes: `skip_company`, `status`, `schedule-save`, `schedule-status`. Those manage config, not discovery runs.

**Column semantics across the two call sites:**

| Column | `runDiscovery` path | `/discovery-profile` path |
| --- | --- | --- |
| `Leads Written` | `writeResult.appended` (real Pipeline count) | Always `0` — this endpoint enriches companies, it doesn't write leads. |
| `Companies Seen` | `config.companies.length` | `companies.length` returned by `discoverCompaniesForProfile()`. |
| `Source` | `discoveryRunsSource` (defaults to `worker`) | `worker@profile` (override via `discoveryRunsSource`). |
| `Variation Key` | `request.variationKey` | `sheetId` as fallback (the endpoint has no variationKey concept). |
| `Trigger` | `request.trigger` else derived from the dispatcher arg | `request.trigger` else `"cli"` for refresh, `"manual"` otherwise. |
| `Status` | `success` / `partial` / `failure` from lifecycle + writeError | `success` on ok:true return; `failure` on extract / discover / persist catch. |

---

## 4. Dashboard read path

**Direct Sheets read, no new webhook.** The dashboard already has OAuth and a Sheets API client (it reads Pipeline to render Kanban). Add a sibling read for `DiscoveryRuns`:

```js
async function fetchDiscoveryRuns(sheetId) {
  // GET ...values/DiscoveryRuns!A2:I?valueRenderOption=UNFORMATTED_VALUE
  // Parse each row into { runAt, trigger, status, durationS, companiesSeen, leadsWritten, source, variationKey, error }.
  // Return newest-first (sort descending by runAt).
}
```

Handle the "tab doesn't exist yet" case — if the API returns a 400 for a missing tab, render an empty state ("No runs logged yet — trigger a discovery to populate this list").

---

## 5. UI — new "Runs" panel

**Location (workspace picks; reasonable options listed):**

a. **Top-level nav tab** next to Pipeline / Daily Brief / Settings. Discoverable, matches the Sheet-tab-as-UI-tab pattern.
b. **Section inside Settings → Profile → Schedule**, below the three-tier ladder. Tighter contextual grouping but less discoverable.

**Default recommendation:** (a) — the log is a primary user surface, not a setting.

**Render:**
- Sortable table, 9 columns matching the schema.
- Default sort: newest first.
- Client-side filter chips: trigger (All / Manual / Scheduled) + status (All / Success / Failure).
- Empty state when tab is missing or row-less.
- Auto-refresh every 60s (or on tab focus) so a scheduled run that fires while the user is looking shows up without reload.

**Not in scope:**
- Drill-down into a single run's detailed logs (that's future).
- Exporting runs to CSV (user can open the Sheet directly).
- Pagination (limit to 200 most recent rows for now).

---

## 6. Test coverage

- Worker: unit test for `appendDiscoveryRunRow` (happy path + Sheets-failure-doesn't-fail-the-run).
- Worker: test that `trigger` field round-trips from request → log row.
- Worker: test that `scheduled-local` label is applied when `mode:"refresh"` + `trigger:"scheduled-local"` is received.
- UI: test `fetchDiscoveryRuns` parses rows correctly + handles empty tab + handles missing tab.
- UI: test sort + filter behavior on a mock result set.

---

## 7. Change-control

Any change to this spec during implementation: stop, ping the orchestrator, wait for updated doc. Workspaces do not amend the contract unilaterally.
