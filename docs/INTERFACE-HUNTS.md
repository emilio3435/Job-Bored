# Interface contract — Hunts (saved searches, scheduler, hitlist, exploration)

**Status:** HOLES 2026-10-02 contract (spec §0.5, §0.9, §0.10, §2 HUNT, §1b.3). The worker side (HUNT-W) implements it; the dashboard (HUNT-FE) builds against it. Change the doc first, then the code.

**Scope:** worker routes under `/hunts`, the in-worker hunt scheduler, the "awaiting sheet write" flow, the exploration (novelty) share every discovery run reserves, and the yield fields `GET /runs` summaries gain.

**Storage:** hunts live in the worker's SQLite state file (`worker-state.sqlite`, tables `hunts` and `hunt_runs`); the exploration ledger lives in the same file (`novelty_ledger`, `novelty_slots`). Run statuses stay in the run-state JSON snapshots (docs/INTERFACE-DISCOVERY-RUNS.md §8).

---

## 1. Transport and auth

- Every `/hunts` route requires `x-discovery-secret`, the same secret and check as `POST /webhook`, in local **and** hosted mode. The usual Host and Origin guards and CORS preflight apply.
- Methods are `GET` and `POST` only (the worker's CORS allows nothing else): updates are `POST /hunts/:id`, deletes are `POST /hunts/:id/delete`.
- Bodies are JSON, at most 2 MiB. Success bodies carry `ok: true`. Error bodies are api-error.v1 (`schemas/api-error.v1.schema.json`): `{ ok: false, message, error, code, retryable, detail?, nextStep? }`.

| Status | `code` | When |
| --- | --- | --- |
| 401 | `unauthorized` | Missing or wrong `x-discovery-secret` (body also carries `auth.category`). |
| 400 | `invalid_hunt` | A field fails validation (§2); `detail` names it. |
| 400 | `invalid_json` | The body is not a JSON object. |
| 400 | `invalid_limit` | `GET /hunts/hitlist` `limit` outside 1–50. |
| 404 | `hunt_not_found` / `run_not_found` | Unknown hunt id, or `fromRunId` names no run. |
| 409 | `hunt_exists` | A hunt with the same `searchKey` exists; body carries `huntId`. |
| 409 | `hunt_limit` | 50 hunts already saved. |
| 409 | `run_has_no_search_plan` | `fromRunId` names a run that recorded no `searchPlan`, and the body sent none. |
| 405 | `method_not_allowed` | Wrong method for the path. |

## 2. Objects

```ts
type SearchPlanQuery = {        // same strings as discoveryProfile / searchPlan.query
  targetRoles?: string; keywordsInclude?: string; locations?: string;
  remotePolicy?: string; seniority?: string; keywordsExclude?: string; sourcePreset?: string;
};

type HuntSchedule = {
  kind: "off" | "daily" | "weekdays" | "every_n_hours";
  hour: number;                 // 0–23, in `timezone`
  minute: number;               // 0–59
  everyHours?: number;          // 1–24, required for every_n_hours
};

type Hunt = {
  id: string;                   // "hunt_" + 32 hex
  name: string;                 // ≤ 120 chars; defaults to a label built from the query
  status: "active" | "paused";
  searchPlan: DiscoverySearchPlan;      // the plan as saved (contracts.ts DiscoverySearchPlan)
  tweaks: Omit<SearchPlanQuery, "sourcePreset">; // user edits; apply to future runs only
  effectivePlan: DiscoverySearchPlan;   // read-only: searchPlan with tweaks applied (what runs)
  searchKey: string;                    // read-only: normalized key of effectivePlan (§7)
  explorationShare: number;     // 0–1, default 0.3 (§6)
  schedule: HuntSchedule;       // default { kind: "off", hour: 8, minute: 0 }
  timezone: string;             // IANA; default the worker's zone
  sheetId: string;              // "" = the worker's configured Sheet
  sourceRunId: string | null;   // run it was saved from
  createdAt: string; updatedAt: string;
  nextRunAt: string | null;     // null when paused or schedule off
  queuedAt: string | null;      // due (or run-now) while another run was active; fires when idle
  lastRunAt: string | null; lastRunId: string | null;
  lastError: string | null;     // last dispatch refusal, e.g. a 400 from the run preflight
  runs: HuntRun[];              // read-only: newest first, at most 10 (the yield trend)
};

type HuntRun = {
  runId: string; trigger: "hunt" | "scheduled-hunt"; dispatchedAt: string;
  // From the run's status when the worker still has it (statuses prune after 90 days / 500 runs):
  status?: "accepted" | "running" | "completed" | "partial" | "empty" | "write_failed" | "failed";
  completedAt?: string;
  written?: number;             // new rows appended ("new")
  updated?: number;             // existing rows refreshed ("seen")
  fitAvg?: number;              // 0–10
  awaitingSheetWrite?: number;  // leads held for a browser flush (§5)
};
```

Validation (400 `invalid_hunt`): `name` ≤ 120 chars; `status` in the enum; `tweaks` keys only from the list above, strings ≤ 1000 chars; `explorationShare` a number in [0, 1]; `schedule` as typed; `timezone` a zone `Intl` accepts; `sheetId` ≤ 200 chars; the effective query must have `targetRoles` or `keywordsInclude`.

## 3. Routes

### 3.1 `GET /hunts` → 200 `{ ok: true, hunts: Hunt[] }`
Newest first.

### 3.2 `POST /hunts` → 201 `{ ok: true, hunt: Hunt }`
Saves a past search as a hunt (the "Save as hunt" toggle). Body:
```json
{ "fromRunId": "run_…", "searchPlan": { "planVersion": 1, "…": "…" },
  "name": "…", "tweaks": {}, "explorationShare": 0.3,
  "schedule": { "kind": "daily", "hour": 8, "minute": 0 },
  "timezone": "America/Chicago", "sheetId": "…", "status": "active" }
```
Send `fromRunId`, `searchPlan`, or both; at least one is required. With `fromRunId` the worker reads that run's recorded `searchPlan` (an explicit `searchPlan` wins) and `sheetId` (unless the body sends one). Only `searchPlan`-shaped fields are kept (`planVersion`, `generatedAt`, `seed`, `trigger`, `rotationKey`, `rotationIndex`, `profileHash`, `selected`, `facets`, `query`).

### 3.3 `GET /hunts/hitlist?limit=20` → 200
```ts
{ ok: true, generatedAt: string, runsConsidered: number, clusters: HitlistCluster[] }
type HitlistCluster = {
  key: string;                    // searchKey of the cluster (§7)
  label: string;                  // "product designer · remote · senior"
  searchPlan: DiscoverySearchPlan; // newest run's plan; send it to POST /hunts to save
  runCount: number; repeating: boolean;   // repeating = runCount ≥ 2
  leadsWritten: number;           // Σ headline.written ("new")
  leadsUpdated: number;           // Σ headline.updated ("seen")
  meanFit: number | null;         // mean of the runs' fitAvg, 0–10
  lastRunAt: string; lastRunId: string;
  score: number;                  // ranking score, highest first (§7)
  trend: Array<{ runId: string; at: string; written: number; updated: number; fitAvg?: number }>; // newest first, ≤ 10
  huntId: string | null;          // saved hunt with the same key
};
```
`limit` is 1–50 (default 20). Sources: the worker's run history (`GET /runs` data, newest 500), terminal runs with status `completed`, `partial`, `empty` or `write_failed` that recorded a `searchPlan`.

### 3.4 `GET /hunts/:id` → 200 `{ ok: true, hunt: Hunt }`

### 3.5 `POST /hunts/:id` → 200 `{ ok: true, hunt: Hunt }`
Partial update with any of `name`, `status`, `tweaks` (replaces the whole object; `{}` clears), `explorationShare`, `schedule`, `timezone`, `sheetId`. A change to `status`, `schedule` or `timezone` recomputes `nextRunAt` from now; pausing clears `queuedAt`.

### 3.6 `POST /hunts/:id/delete` → 200 `{ ok: true, id, deleted: true }`
Drops the hunt and its `hunt_runs` rows. The runs stay in `GET /runs`.

### 3.7 `POST /hunts/:id/run` — run now
Body (optional): `{ "googleAccessToken": "…" }`. The token is used for this run's Sheet write only and is never stored.
- Worker idle → the run is dispatched through the same handler as `POST /webhook` (§4.3) with trigger `hunt`, and the answer is that handler's ack plus `huntId`: 202 `{ ok: true, kind: "accepted_async", runId, statusPath, pollAfterMs, message, huntId }`. Poll `statusPath` as for any run. A preflight refusal comes back with its own status and `message`.
- Another run active → 202 `{ ok: true, kind: "queued", huntId, queuedAt, message }`. The scheduler starts it (trigger `hunt`) once the worker is idle. A queued run cannot carry the token, so it writes with the worker's credential or waits as "awaiting sheet write" (§5).
- Works on paused hunts too.

## 4. Scheduler

### 4.1 Semantics
- Runs inside the discovery worker while it is alive. It ticks every 60 s (`BROWSER_USE_DISCOVERY_HUNT_TICK_MS`) and also once at boot. `BROWSER_USE_DISCOVERY_HUNT_SCHEDULER=0` turns it off.
- **Due** means `status: active`, `schedule.kind` is not `off`, and `nextRunAt ≤ now`. A hunt with `queuedAt` set is also due.
- **Never overlaps.** While any discovery run is live in the worker, due hunts get `queuedAt` (kept across ticks and restarts) and nothing fires. When the worker is idle, one hunt fires per tick: queued first, then the most overdue. The run it starts makes the worker busy, so the rest wait.
- **Fire.** Trigger `scheduled-hunt` for a schedule slot, `hunt` for a queued run-now. The worker records the run in `hunt_runs`, sets `lastRunAt` and `lastRunId`, clears `queuedAt` and `lastError`, and moves `nextRunAt` to the first slot after now. Missed slots coalesce: a hunt that missed three slots while the worker was down fires once.
- **Refusal.** A non-2xx answer (e.g. 400 blank intent, 409 no Sheet) sets `lastError`, clears `queuedAt` and advances `nextRunAt`, so it never retries every minute.
- **Restarts.** All state is in SQLite. On boot the first tick fires overdue hunts once; queued hunts stay queued.

### 4.2 Slots (in `timezone`)
- `daily`: every day at `hour:minute`.
- `weekdays`: Monday–Friday at `hour:minute`.
- `every_n_hours`: every local time of day congruent to `hour:minute` modulo `everyHours` hours. For example, `everyHours: 6` at 07:00 gives 01:00, 07:00, 13:00 and 19:00.

### 4.3 The run a hunt sends
The worker posts this to its own `/webhook` handler in-process. Auth, preflight, idempotency, run status, the DiscoveryRuns row and the async lifecycle are all unchanged:
```json
{ "event": "command-center.discovery", "schemaVersion": 1,
  "sheetId": "<hunt.sheetId>", "variationKey": "hunt-<id>-<yyyymmddHHMM>",
  "requestedAt": "<now>", "trigger": "scheduled-hunt",
  "idempotencyKey": "hunt:<id>:<slot ISO>",
  "discoveryProfile": { "targetRoles": "…", "locations": "…", "remotePolicy": "…", "seniority": "…",
    "keywordsInclude": "…", "keywordsExclude": "…", "sourcePreset": "…",
    "searchPlan": "<hunt.effectivePlan, generatedAt = requestedAt>" } }
```
Run-now uses `trigger: "hunt"` and `idempotencyKey: "hunt:<id>:now:<requestedAt>"`, plus `googleAccessToken` when given. The hunt's `explorationShare` reaches the run through a worker-internal map keyed by run id; it is not a request field.

**Trigger enum.** `hunt` and `scheduled-hunt` join `DISCOVERY_RUN_TRIGGERS` (contracts.ts) and the request schema's `trigger` enum. Run statuses keep the two-value kind: `scheduled-hunt` reports `trigger: "scheduled"` and `hunt` reports `"manual"`. The DiscoveryRuns sheet records the full label.

**/webhook carries no hunt reference.** A dashboard may post a hunt's `effectivePlan` as `discoveryProfile.searchPlan` with `trigger: "hunt"` (for example, to run a tweaked hitlist search once), but such a run is not linked to a saved hunt and uses the default exploration share. To run a saved hunt, call `POST /hunts/:id/run`.

## 5. Awaiting sheet write (§0.9)
- **Credentials.** A scheduled hunt uses the same Sheet credential as `scripts/run-scheduled-discovery.mjs`: the worker's own, from its env or `.env`. That is a service-account JSON or file, an OAuth token JSON or file, or `GOOGLE_ACCESS_TOKEN`; in local mode the Hermes token file is the fallback.
- **No credential.** A run the worker dispatches for a hunt (scheduled, or run-now without a token) is not refused by the credential preflight. The run executes, its Sheet write fails, and the run ends `write_failed` with its selected leads held in worker state. HTTP never returns those leads.
- **How it shows.** That run is "awaiting sheet write". Its `GET /runs` summary carries `awaitingSheetWrite: { leads: n }`, and its `HuntRun` carries `awaitingSheetWrite: n`. The same holds for any `write_failed` run that still holds leads.
- **Flush.** On its next open, the dashboard calls the existing `POST /runs/:runId/retry-write` with `{ googleAccessToken }` for each such run. That route takes the same secret, and a 409 `write_retry_running` means another flush is under way. Success moves the run to `completed` or `partial`, and the flag disappears.
- **Run log.** A run that had no credential also could not log its DiscoveryRuns row, and the flush does not backfill that row.

## 6. Exploration share (every run)
- **Share.** Every discovery run reserves `explorationShare` of its ATS company slots for things never tried, saved hunt or not, and never fewer than 1 slot: `reserved = max(1, round(share × slots))`. The share is the hunt's own `explorationShare`, or for other runs `BROWSER_USE_DISCOVERY_EXPLORATION_SHARE`, which defaults to 0.3.
- **Never tried.** These are never-searched companies (no exploration-ledger row and no `intent_coverage` row) and never-searched career surfaces or ATS providers. Picks come first from the run's own list, then from companies in `candidate_catalog` (this Sheet), `listing_fingerprints` and `company_registry` that the run did not plan.
- **Limits still apply.** Cooldowns hold: the ATS zero-yield cooldown, `company_registry.cooldown_until`, and the allow/blocklist. Explore picks are spread through the order so they run before the low-yield tail.
- **Ledger.** Each slot is recorded as `explore` or `exploit` with its yield (`listingsSeen`, `leadsWritten`). The run's facet combination (its intent key) is one more slot: `explore` the first time it runs. The ledger tables are `novelty_ledger` and `novelty_slots`.
- **`GET /runs/:id`.** The status gains `lifecycle.exploration`:
  `{ share, reservedSlots, slotCount, slots: Array<{ index, kind: "company"|"surface"|"facet", key, label, provider?, mode: "explore"|"exploit", listingsSeen, leadsWritten }>, totals: { explore: Yield, exploit: Yield } }`, where `Yield = { slots, listingsSeen, leadsWritten }` and `slots` holds at most 200 entries.
- **`GET /runs` summaries** gain these optional fields. Each is absent when not recorded:
  - `searchPlan`: the plan the run executed (terminal runs).
  - `searchKey`: §7 key of that plan.
  - `yield`: `{ explorationShare, explore: Yield, exploit: Yield }`.
  - `awaitingSheetWrite`: `{ leads }` (§5).

## 7. Search key and hitlist ranking
**`searchKey`** is `sk_` followed by the first 16 hex characters of the sha256 of the canonical JSON of these fields:
- `roles`: `facets.roles`, or else `query.targetRoles` split.
- `locations`: `facets.locations`, or else `query.locations` split.
- `seniority`: `facets.seniority`, or else `query.seniority` split.
- `includes`: `query.keywordsInclude` split, minus that run's rotation picks `selected.skill`, `selected.industry` and `selected.companyType`.
- `excludes`: `query.keywordsExclude` split.
- `remotePolicy` and `sourcePreset`.

Lists split on `,`, `;` and newlines. Values are lowercased, trimmed and whitespace-collapsed; lists are deduped and sorted. Daily rotation therefore does not split one search into many clusters. A tweak rewrites the matching facet list, so a tweaked hunt keys as a new search.

**Ranking:** `score = (leadsWritten / runCount) × (meanFit === null ? 1 : 0.5 + meanFit / 10) × 0.5^(daysSinceLastRun / 14)`. Ties go to repeating clusters, then to the newer `lastRunAt`.

## 8. Notes for the dashboard
- `runs-tab.js` `SCHEDULED_TRIGGERS` should add `scheduled-hunt` so the Scheduled chip finds hunt runs (tests/runs-tab.test.mjs pins that list's fixture).
- A run row's "Save as hunt" toggle is on when some hunt has `sourceRunId === runId` or `searchKey ===` the run summary's `searchKey`.
- A worker that serves hunts lists `routes.hunts: "/hunts"` in `GET /health`; an older worker answers `/hunts` with 404 `not_found`.
- Show "worker offline" when `/hunts` fails at the network level. Never cache `googleAccessToken` in localStorage (§0.7).
