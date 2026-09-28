# Lead Shuffle: code recon (Opus agent, 2026-09-27)

Covers main `98903e29` and discat `7b49ac4c`. Read-only.

## 1. Where leads live
- **The Pipeline tab of the Google Sheet is the only lead store the dashboard reads.**
  - `loadAllData` (`sheets-read-load.js:831`) → `fetchSheetCSV("Pipeline")` (`:882`).
  - Three fetch routes: Sheets API (`:593/:603`, range `A:ZZ`), gviz JSONP (`:503/:511`), CSV export (`:708-709`).
  - Then `parsePipelineCSV` (`:760`) → caches → `setPipelineData` → `renderPipeline` / `renderBrief` (`:911-921`).
- **Accessors:**
  - `window.JobBored.getPipelineJobs()` (`app.js:224`)
  - the v2 board: `JobBoredDawn.data.getPipelineViewModel` (`dawn-data.js:940, 1695`)
- **Hosted and local read the same Sheet.** The worker only writes; its SQLite is never read for leads on main.
- **Columns A–Y** (`pipeline-columns.generated.ts:15-41`; parsed at `sheets-read-load.js:768-824`):

  | Col | Field | | Col | Field |
  |---|---|---|---|---|
  | A | dateFound | | N | appliedDate |
  | B | title | | O | notes |
  | C | company | | P | followUpDate |
  | D | location | | Q | talkingPoints |
  | E | link | | R | lastHeardFrom |
  | F | source | | S | responseFlag |
  | G | salary | | T | logoUrl |
  | H | fitScore | | U | matchScore |
  | I | priority | | V | favorite ★ |
  | J | tags | | W | dismissedAt |
  | K | fitAssessment | | X | approvalStatus (never read by the dashboard) |
  | L | contact | | Y | editLock |
  | M | status | | | |

- **Stages:** `window.JobBoredStages` (`stage-registry.js`); the fallback list is at `pipeline.js:33-39`.

## 2. "Qualified" today, and the catalog
- **Prefilter:** `runPreFilter` (`profile-aware-scorer.ts:54-93`) drops a listing on skipTitles, remote_only, or location mismatch.
- **Matcher:** `decideMatch` (`job-matcher.ts:506-531`) returns one of three outcomes:
  - **reject:** a hard reject, negative ≤ 0.05, role ≤ 0.1, or overall < 0.2;
  - **accept:** overall ≥ 0.6, role ≥ 0.5, and loc / remote / neg ≥ 0.35;
  - **uncertain:** anything else. Uncertain listings are still written.
- **Fit floor:** none on main. On discat, `BACKLOG_MIN_FIT_SCORE = 5` applies to backlog promotion only (`candidate-catalog.ts:38-44`).
- **Catalog schema** (`discovery-memory-store.ts:784-803`):
  - Columns: `sheet_id`, `fingerprint_key` (primary key with `sheet_id`), `company_key`, `title`, `url`, `source_id`, `status`, `reject_reason`, `reject_detail`, `fit_score`, `match_score`, `lead_json`, `first_seen_at`, `last_seen_at`, `seen_count`, `last_run_id`, `intent_key`.
  - Indexes: `(sheet_id, status, last_seen_at)` and `(last_seen_at)`.
  - There are no location, salary, description or display-name columns. Those live only in `lead_json`, which is kept only for backlog, written and promoted rows (`:3095-3099`); it includes `descriptionText` of at most 4,000 characters.
- **Retention:**
  - rows are deleted after 90 days;
  - the table is capped at 50k rows;
  - backlog rows expire after 14 days, and `lead_json` is nulled;
  - pruning runs after each run.
- **`GET /candidates`** (`worker-router.ts:622-711`):
  - GET only; hosted mode requires the secret;
  - `status` is checked against an enum, and `limit` is at most 1,000;
  - it has no cursor and no text search, and orders by `last_seen_at DESC`;
  - `leadPayload` is stripped from responses.
- **Reachability:**
  - Nothing in the dashboard calls it.
  - The Cloudflare relay forwards only `/runs` and `/runs/*` (`templates/cloudflare-worker/worker.js:24-26`), so hosted Pages cannot reach it without a relay change.
  - Direct local and tunnel origins can use `fetchWorkerJson(path, {withSecret})` (`discovery-status-handoff.js:666-709`).

## 3. Existing filter and search UI, and where to mount
- **v2 board search:** `[data-pipeline-search]` (`pipeline.js:1231-1244`).
  - `filterCardsBySearch` requires all terms to match (`:787-799`).
  - The haystack is role, company, note, salary, location, tags, notes, source, status and link (`:767-785`).
  - An active search bypasses the company cap (`:1395-1412`).
- **Chips:** Favorites and Dismissed, persisted through `JobBored.get/setPipelineViewFilters` (`app.js:227-228`).
- **Cmd/Ctrl+K** focuses search (`flowing-chrome.js:677-691`).
- **Legacy (off-flag) controls:** `#searchInput`, `#sortSelect` and chips (`index.html:1146-1196`).
- **Views and mounting:**
  - `flowing-chrome.js` `PILLS` (`:34-38`) and `VIEW_REGIONS` (`:39-43`) drive `showView`, which sets `body[data-jb-view]` and emits `jb:view:changed` (`:444-465`).
  - The hide rules are at `flowing-chrome.css:617-632`.
  - **Mount:** a new `<section data-region="shuffle">`, plus a PILLS/VIEW_REGIONS entry and new hide selectors.
- **Boot contract:** `jb-v2-boot-contract.js` `SURFACE_KEYS` holds pipeline, scribe, lattice and chrome (`:18`). Either add a key, or self-activate on `body.jb-v2` the way `today.js` does.
- **Host injection:** `bridge-registry.js` `registerAllBridges(host)` (`:9`).

## 4. Actions a card can reuse
- **Move stage:**
  - `JobBored.applyPipelineStageWrite(jobKey, label)` (`app.js:229`);
  - or `jb:pipeline:move`, handled at `flowing-writes.js:628`, which writes M;
  - the adapter `pipeline-transition-adapter.js` guarantees success, `jb:pipeline:move`, or `jb:write:failed`.
- **Dismiss:** `dismissJob` (`sheets-writeback.js:442`) writes W. A soft pass must NOT use it.
- **Favorite and edit:** `toggleFavorite` (`sheets-writeback.js:385`), `editJobField` (`:580`).
- **Open The Case:** `JobBoredFlowing.openRole.set(key)`, falling back to `#role=` (`pipeline.js:1676-1686`).
- **Draft:** `POST /api/applications/:slug/request` (`server/index.mjs:904`), called from `role-materials.js:2398`.
- **Add a catalog lead to the Sheet:** today that is `JobBored.ingestJobUrl` (`app.js:235`). DATA-DESIGN proposes a worker `POST /leads/:key/save` through `pipelineWriter.write`.

## 5. Worker SQLite
- `node:sqlite` `DatabaseSync` is used in `discovery-memory-store.ts:4, 588` and `listing-score-cache.ts:17, 35`. The file is `worker-state.sqlite` (`config.ts:107`).
- No FTS is used anywhere today. DATA-DESIGN confirmed FTS5 works on Node v24.13.0.
- The run-status store is JSON files, not SQLite (`run-status-store.ts:35`).
- New routes belong in `worker-router.ts`, modelled on `handleCandidates`, with the same guard as `/runs` (main `:270-306`) and `/runs/:id` (`:308-324`).

## 6. Constraints
- **CSP:** `connect-src` already covers loopback, `*.workers.dev`, `*.ts.net`, trycloudflare and ngrok.
- **Static allowlist:** root `.js` and `.css` are served; `.sqlite` and `.db` are denied (`static-path-guard.mjs:33-69`).
- **Styling:** use the `--jb-*` tokens, and scope rules under the region root (the jb-v2 cascade trap).
- **Tests:**
  - The hermetic harness (`hermetic-harness.mjs:303`) aborts unstubbed off-origin calls, so `/leads/*` needs stubs (`/runs` is stubbed at `:444`).
  - Adding a view touches the `flowing-chrome-brand`, `hermetic-release-gate`, `v2-flow-width` and `role-shelf-css-home` tests.

## Could not verify
- Whether hosted Pages reaches a worker directly, without the relay, in real setups.
- The internals of `getPipelineViewModel`.
- Where the legacy sort handler lives.
