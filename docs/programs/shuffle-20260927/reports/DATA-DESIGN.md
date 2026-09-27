# Lead Shuffle: data layer design research (Opus agent, 2026-09-27)

Read-only. Code claims cite main `98903e29`, or the discat branch (`feat/discovery-candidate-catalog`, tip `7b49ac4c`) where noted.

**Bottom line:**
- Shuffle draws from **both** pools, merged on one lead key:
  - the Pipeline rows the browser already loads;
  - the catalog `backlog` rows, which live only in the local worker.
- Search runs in the worker on SQLite **FTS5** (confirmed working).
- Decisions live in a new worker table, mirrored to IndexedDB for hosted mode.
- A "save" on a backlog lead goes through the existing `pipelineWriter.write`, then `markCandidatesPromoted`.

## 1. Pool and "qualified"

**The two pools:**
- **Pipeline rows.** Parsed by `sheets-read-load.js` `parsePipelineCSV`. This is the only pool hosted mode can see.
- **Catalog backlog.** Qualified leads cut by the per-run cap (discat `run-discovery.ts:1854-1858`). That is about 90 per run against about 15 written, and it is the churn supply.

**The join key.** Join on `normalizeLeadUrl(url)`, which both sides carry: the catalog `url` (`discovery-memory-store.ts:784-803`) and sheet column E (`pipeline-writer.ts:217`). `fingerprint_key` is the secondary key; the sheet has no fingerprint cell.

**Qualified** reuses the existing gates:
- the matcher is not `reject` (`uncertain` counts; `run-discovery.ts:2730-2737`);
- the lead normalized, is in company scope, and passes the exclude keywords and the profile prefilter;
- fit is ≥ 5, or unknown (unknown ranks last). `BACKLOG_MIN_FIT_SCORE = 5` is at `candidate-catalog.ts:44`.

**Revalidation.** Backlog rows are revalidated at deck time by factoring `selectBacklogPromotions`' revalidation (`candidate-catalog.ts:362-391`) into a pure `revalidateBacklogLead()`. Shuffle and promotion then never disagree.

**Pipeline rows qualify when** Status is `New`, there is no `dismissedAt`, and fit is ≥ 5 or blank.

**Hosted mode, or no worker:**
- the pool is Pipeline rows only;
- sampling and search run client-side;
- decisions are kept in IndexedDB;
- the UI says "backlog unavailable (worker offline)", never "0".

## 2. Randomizer

Weighted sampling without replacement (Efraimidis–Spirakis), a seeded PRNG (sfc32), and hard filters applied before sampling:

```
filtersHash = hash(canonical(filters))
poolVersion = max(last_seen_at over pool) + pipelineRowCount
rng = sfc32(hash(seed ?? `${sheetId}:${localDay}:${deckNo}`))
for L in qualified(pipeline ∪ backlog):
  if !passesFilters(L): excl.filtered++; continue     # source, fitMin, matchMin, remote, company, maxAgeDays, q
  d = decision[L.key]
  if d.pass (not undone): excl.passed++; continue
  if d.snoozeUntil > now: excl.snoozed++; continue
  if d.saved: continue
  if L.lastShownAt > now-72h or L.key in lastDecks(3): excl.recent++; continue
  eligible.push(L)
w(L) = fitW * matchW * freshW * newW * companyPenalty
  fitW   = fit==null ? 0.35 : clamp((fit-4)/6, 0.05, 1)
  matchW = match==null ? 0.8 : 0.6 + 0.04*match
  freshW = max(0.15, 0.5^(ageDays/7))     # 7-day half-life
  newW   = neverShown ? 1.5 : 1
  companyPenalty = max(0.1, 0.5^(passesForCompany))
wild = floor(n * 0.15)
key(L) = rng()^(1/w(L)); ordered = sort desc by key
wildcards drawn uniformly from the rest
deck = greedy interleave with caps: perCompany <= ceil(n/5), perSource <= ceil(n/2)
return {deckId: hash(seed, filtersHash, poolVersion), cards, pool:{total, eligible, excluded, drawn}}
```

**Defaults:**
- n = 10 (maximum 50);
- wildcard share 0.15;
- recent window 72 h or the last 3 decks;
- snooze 3 days.

A deck is reproducible only for the same `poolVersion`, which is echoed back so the client can say "new leads arrived".

**What each action feeds back:**
- **Save:** removes the lead from the pool and promotes it (§5).
- **Pass:** takes an optional reason: `wrong_role | seniority | location | comp | company | seen | other`.
  - A `company` reason increments that company's penalty.
  - `wrong_role` passes go to a new per-role-family counter. Do NOT reuse `role_families.near_miss_count` (`discovery-memory-store.ts:2205`), which counts rejected-but-close listings, the opposite signal.
- **No automatic filter changes.** Show hints only (as in the discat D8/D9 decisions), e.g. "you passed 6 of 8 'Sales Engineer' leads — add an exclude keyword?"

## 3. Decision state

**Where it lives:**
- The worker SQLite table is the source of truth.
- IndexedDB holds a mirror and the hosted fallback: a new store in `user-content-store.js:7`. Mind the Clear-settings `deleteDatabase` wedge.
- Only terminal outcomes reach the Sheet: a save becomes a Pipeline row, or column V ★ on an existing row.
- **A soft pass never writes column W ("Dismissed At").** The writer treats a W-set identity as blacklisted (`pipeline-writer.ts:521-524`). An explicit "Dismiss" keeps the existing `jb:closure:change` path (AGENT_CONTRACT:261).

**Schema:**

```sql
CREATE TABLE shuffle_decisions (
  sheet_id TEXT, lead_key TEXT, fingerprint_key TEXT, origin TEXT,  -- 'pipeline'|'backlog'
  decision TEXT,                     -- 'shown'|'saved'|'passed'|'snoozed'
  reason TEXT DEFAULT '', snooze_until TEXT,
  shown_count INT DEFAULT 0, last_shown_at TEXT, last_deck_id TEXT,
  decided_at TEXT, undone_at TEXT, updated_at TEXT NOT NULL, device_id TEXT,
  PRIMARY KEY (sheet_id, lead_key));
```

**Rules:**
- Undo sets `undone_at` and restores the prior decision.
- A pass never deletes a lead and never changes catalog `status`.
- Retention: `shown`-only rows for 30 days, decisions for 180 days.
- Multi-device: last-writer-wins on `updated_at`. The client queues decisions like the favorites pending map (`sheets-writeback.js:349-390`) and flushes them on connect.
- Hosted mode has no cross-device pass or snooze; say so in the UI.

## 4. Text search

**FTS5 is available.** Node is pinned `>=24 <25` (`package.json:7-9`), and `.nvmrc` is 24. On v24.13.0, `fts5` with `porter unicode61` and `bm25()` both ran under `node:sqlite`. Nothing in the worker uses FTS today; `DatabaseSync` appears only at `discovery-memory-store.ts:624` and `listing-score-cache.ts:35`.

**The index:**
- `lead_fts(title, company, location, tags, fit_assessment, source, lead_key UNINDEXED, sheet_id UNINDEXED)`, with `tokenize='unicode61 remove_diacritics 2'` and `prefix='2 3'`.
- It is maintained inside `record()`'s transaction and deleted on prune or expire.
- Ranking: `bm25(lead_fts, 5, 3, 1, 2, 0.5, 0)`, with fit as the tie-break.
- Query hygiene: tokenize, then emit `"tok"*` joined with AND, so FTS syntax cannot be injected.

**Fallbacks:**
- If a boot probe finds no FTS5, a LIKE query with AND-ed tokens replaces it.
- Pipeline rows are searched in the browser over the rows already loaded, and the results are merged by `lead_key`.

**API:**
- `GET /leads/search?q=&sheetId=&origin=&limit=` (1–100, default 25)
- `GET /leads/shuffle?sheetId=&n=&seed=&fitMin=&matchMin=&remote=&company=&source=&maxAgeDays=&q=&exclude=`
- `POST /leads/decisions`
- `POST /leads/:key/save`

**Guard:**
- Copy `handleCandidates` (discat `worker-router.ts:625-665`): method check, the Host/Origin check (`:212`, `:258`), and `hasValidWebhookSecret` in hosted mode.
- The POSTs always need `x-discovery-secret`.
- Return a whitelisted projection, never `descriptionText` or `lead_json`.

## 5. Ever-churning

**Where new leads come from.** Each run's `persistRunCandidateCatalog` (`candidate-catalog.ts:482-549`) adds backlog rows, and the sheet gains rows. The client already polls `GET /runs` (#135). When a run turns terminal, it refetches and shows "N new since this deck" (from `poolVersion`).

**Badges:**
- **New:** first seen within 24 h and never shown.
- **Seen again ×k:** `seen_count` is above 1.
- **Expires in d days:** `last_seen_at + 14d`, from `BACKLOG_PROMOTION_MAX_AGE_DAYS` (`candidate-catalog.ts:37`).

Expired backlog rows null `lead_json` (`discovery-memory-store.ts:3128-3132`) and drop out of the pool.

**Saving a backlog lead (verified path):**
1. Parse `lead_json` into a `NormalizedLead`.
2. Revalidate it.
3. `pipelineWriter.write(sheetId, [lead])`, as ingest-url does (`handle-ingest-url.ts:1039-1047`; the writer factory is `pipeline-writer.ts:374`, with the sheet lock at `:758-770`).
4. `resolveLeadWriteFates` (`candidate-catalog.ts:252-280`).
5. Only when the fate is `written`: `markCandidatesPromoted` (`discovery-memory-store.ts:3124-3127`; it is idempotent on `status='backlog'`), with a `runId` of the form `shuffle_<uuid>`.

A `blacklisted` or `duplicate` fate is reported to the user, and the lead stays in the backlog.

**Races.** The per-sheet lock plus the identity match turns a race between a run and a shuffle save into an update, never a duplicate row.

## 6. Risks
- **Privacy.**
  - `lead_json` holds up to 4,000 characters of description (`candidate-catalog.ts:49`); never serve it, and never serve anything from a hosted worker without the secret.
  - Pass reasons stay local.
- **Sheet quota.** Shuffle reads never hit Sheets. Saves cost a blacklist read, an identity snapshot and an append (`pipeline-writer.ts:390-460`), so batch or rate-limit them.
- **Contract.**
  - Pipeline stays A–Y.
  - Document the `/leads/*` routes in AGENT_CONTRACT, using the `api-error.v1` envelope.
  - Never repurpose W.
  - A missing value means unknown: no fit badge when fit is null.
- **DISCAT dependency.** The backlog half needs the discat branch merged, and the catalog stays empty until the first real run.
- **Hosted relay.** The Cloudflare relay forwards only the dashboard's worker routes (AGENT_CONTRACT:77), so it likely needs the new paths added to its allowlist. Not verified.
- **Tests:**
  - route tests next to `tests/webhook/candidates-route.test.ts`;
  - store and FTS tests;
  - a deterministic-deck test;
  - an undo test;
  - hermetic-harness stubs for `/leads/*`;
  - the full floor.

## Contract sketch
- **Tables:**
  - `shuffle_decisions`
  - `lead_fts` (FTS5, derived and rebuildable)
  - `shuffle_pass_stats(sheet_id, dimension, value, pass_count, save_count, updated_at)`
- **Card:** `{leadKey, fingerprintKey?, origin, title, company, location, salaryText, url, sourceLabel, fitScore|null, matchScore|null, tags[], firstSeenAt, lastSeenAt, seenCount, expiresAt?, badges[], wildcard}`
- **`GET /leads/shuffle`** returns `{ok, deckId, seed, poolVersion, filtersHash, cards[], pool:{total, eligible, excluded:{filtered, passed, snoozed, recent, companyCap}, drawn, backlogAvailable}}`
- **`GET /leads/search`** returns `{ok, q, mode:'fts5'|'like', rows:[card & {rank}]}`
- **`POST /leads/decisions`** takes `{sheetId, deckId, items:[{leadKey, decision, reason?, snoozeUntil?, undo?, at, deviceId}]}` and returns `{ok, applied, conflicts[]}`
- **`POST /leads/:leadKey/save`** takes `{sheetId}` and returns `{ok, fate, rowUrl?}`

## Could not verify
- FTS5 on every Node 24.x build; only v24.13.0 on this Mac was checked.
- Live catalog contents; pool sizes are taken from the PR-BODY's `run_09ec4fb1` figures.
- That a stored backlog payload carries `discoveredAt` and `logoUrl` through `write([lead])`.
- Where `DEFAULT_BLACKLIST_SHEET_NAME` points.
- The browser-side cost of in-memory search on large sheets, and whether the relay allowlist needs updating.
- All constants are proposed defaults, not measured.
