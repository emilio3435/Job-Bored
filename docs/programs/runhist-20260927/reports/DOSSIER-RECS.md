# DOSSIER recommendations — per-listing run detail

Research only. No product code. Base commit `5d5b9a59` on `feat/runhist-dossier`. D4: investigation only. D5: a number the worker did not measure stays absent.

**Ranked recommendation.** Render the measured prose and Match Score already stored on the Pipeline row (Phase A, dossier only). Then add four sheet cells written at Pipeline-write time — seen count, last seen day, source-id union, first and last Run ID — so a hosted dashboard can say where a listing was found and how often it was confirmed (Phase B). Leave the worker SQLite fingerprint table unwired until those cells exist; it is a local accelerator with a different key, and the dossier cannot see it. Do not hang per-listing history on the run-status JSON.

The runs modal owns run-level funnel, fit histogram, and rejection counts (RUNHIST). The Case owns one row.

---

## What The Case can say today

The rail says `via {Source}` and `Found {Date Found}` (`role-case.js:66`, `role-case.js:70`). The fit tile is the integer in column H (`role-case.js:228`, `role-case-model.js:576`). Match Score (column U) reaches the card attribute and the view-model (`pipeline-render.js:243-247`, `dawn-data.js:1635`) and is omitted from the Case model (`role-case-model.js:580-591`). Fit Assessment (column K) is clipped onto `data-fit-assessment` (`pipeline-render.js:262`) and shown in the board drawer (`pipeline-render.js:589-595`). The Case model never reads it.

Salary on the rail is the sheet cell. A scrape chip appears only when that cell is empty and the posting scrape has a salary (`role-case.js:60-65`). Discovery-written compensation therefore reads as the user's number.

---

## 1. Today's provenance — where each fact stops

At normalize time a lead carries the full set in `NormalizedLead` (`contracts.ts:673-725`):

| Fact | On the lead | Written to the Pipeline row | Shown in The Case |
|---|---|---|---|
| Source label, else source id | `sourceLabel`, `sourceId` (`contracts.ts:674-675`) | Column F (`pipeline-writer.ts:219`). `fillIfEmpty` (`pipeline-columns.generated.ts:21`) | `via …` (`role-case.js:66`) |
| Company, title, location, link | lead fields | B, C, D, E | Rail identity (`role-case-model.js:582-584`) |
| Calendar day found | `discoveredAt` ISO, then `localCalendarDay` (`pipeline-writer.ts:206`) | Column A, `fillIfEmpty` (`pipeline-columns.generated.ts:16`) | `Found …` from the raw cell (`pipeline-render.js:236`, `role-case.js:70`) |
| Fit score 1–10 | `fitScore` (`lead-normalizer.ts:390`) | Column H, overwrite (`pipeline-columns.generated.ts:23`, `pipeline-writer.ts:221`) | Fit tile (`role-case.js:228`) |
| Match score 0–10 | Matcher `overallScore` × 10 (`frontier-scorer.ts:257-261`, `run-discovery.ts:2303-2311`). Profile LLM may set it earlier (`lead-normalizer.ts:290`); the matcher overwrites it when a decision exists | Column U (`pipeline-writer.ts:209-234`) | Not rendered |
| Why it scored | LLM band, rationale, up to 4 matches, up to 3 concerns, application label, flattened to one string (`lead-normalizer.ts:952-968`). Legacy heuristic uses `buildProfileFitAssessment` (`profile-aware-scorer.ts:844-856`) | Column K, `fillIfEmpty` (`pipeline-writer.ts:224`) | Drawer only (`pipeline-render.js:589-595`) |
| Talking points | `leadAngle` or top strengths (`lead-normalizer.ts:295-296`, `975-983`) | Column Q, `fillIfEmpty` (`pipeline-writer.ts:230`) | Case prefers scrape points; sheet points are the fallback (`role-case-model.js:623`) |
| Salary text | `compensationText` from the adapter, e.g. Workday (`workday.ts:139`) | Column G, lockable (`pipeline-writer.ts:220`) | Rail salary, no origin chip (`role-case.js:63-65`) |
| Run id, variation, query, provider, external job id, canonical URL, board token, lane, surface, fingerprint, semantic key, remote bucket, company key | `metadata` (`contracts.ts:710-725`, filled `lead-normalizer.ts:410-426`) | No cell. `buildLeadRow` returns 25 cells and stops at Edit Lock (`pipeline-writer.ts:213-239`) | Absent |
| Matcher reasons and component scores on an accepted or uncertain lead | On the decision object | Dropped. `finalizeMatchDecision` copies only `matchScore` (`run-discovery.ts:2303-2311`). Reasons are copied only when the decision is `reject` (`run-discovery.ts:2316-2356`) | Absent |
| Per-strength scores | `LlmFitScoreResult.perStrength` (`user-profile.ts:154-167`). Comment says this is persisted for a breakdown UI (`user-profile.ts:147-149`) | Flattened into K and Q. Structured copy goes to local `listing_score_breakdown` only when the LLM is called and a cache exists (`profile-aware-scorer.ts:441-445`) | Absent. No browser reader of that SQLite table |
| In-run sibling boards | Known inside `duplicateGroups` (`listing-fingerprint.ts:571-577`) | The kept lead is written alone (`listing-fingerprint.ts:562`, `pipeline-writer.ts:305-307`) | Absent |
| Which existing row it matched, and on which key | `matchedOn` is `canonical_url`, `provider`, or `semantic` (`intake-identity.ts:86-121`) | Aggregate `updated` / `skippedDuplicates` only (`pipeline-writer.ts:698-704`) | Absent |

`sourceQuery` often is not a query. When the raw listing has none, the normalizer stores `` `${sourceLabel}:${url}` `` (`lead-normalizer.ts:413`). That string contains a URL. The RUNHIST contract forbids URLs in persisted search labels (both lanes' AGREED CONTRACT blocks).

Sheet parse is positional and stops at Edit Lock for dossier fields (`sheets-read-load.js:788-825`). There is no slot for run id or fingerprint.

---

## 2. Overlap and duplicates

Three different events get counted, and none of them is stored on the listing.

**Same run, several boards.** `dedupeFingerprintListings` unions leads that share a primary key (canonical URL or provider job id), a semantic key (`company|title|location|remote`), or a content hash (`listing-fingerprint.ts:516-536`, semantic key at `413-424`). The survivor is the higher quality score (`listing-fingerprint.ts:549`, `785-794`, weights at `715-745`). `dedupeNormalizedLeads` then counts a group as one cross-lane duplicate when the members' `sourceLane` values differ (`run-discovery.ts:2941-2952`). `duplicateSuppressions` is the number of dropped leads (`run-discovery.ts:1586-1588`). The dropped leads' source ids are discarded with the group. The sheet receives the survivor's `sourceLabel` only, and column F will not change on a later run (`fillIfEmpty`).

**Re-found on a later run, same URL or same provider job.** `findExistingIdentityMatch` looks up canonical URL, provider job key, then semantic key (`pipeline-writer.ts:138-167`). Canonical and provider matches update the row (`intake-identity.ts:107-112`). Column A and column F stay as first written. Fit score and Match Score overwrite. Link overwrites (`pipeline-columns.generated.ts:20`), so the posting URL can move to the newer board while `via` still names the first source. Nothing records "seen again", the new source id, or the new run id.

**Same title at the same company, different URL.** Semantic match returns `review` and the writer skips the lead (`intake-identity.ts:114-119`, `pipeline-writer.ts:506-511`). The existing row is not annotated. The warning string is run-level. This is an unconfirmed collision: the sheet reconstruction uses only title, company, location, URL, and the Source cell (`intake-identity.ts:74-83`). Remote bucket is inferred from title, location, description, fit text, and tags (`listing-fingerprint.ts:275-298`), and the row reconstruction does not pass description, fit text, or tags. A later semantic match is weaker than the in-memory one.

**A dormant ledger already has the shape of the answer.** `listing_fingerprints` stores fingerprint, first seen, last seen, last run id, last sheet id, write count, and `source_ids_json` (`discovery-memory-store.ts:664-681`). `upsertListingFingerprint` keeps the original `firstSeenAt`, takes the max last-seen, increments `writeCount` when `writtenAt` is set, and unions source ids (`discovery-memory-store.ts:1708-1776`). The run path never calls it. The only production function is the server adapter (`server.ts:252`), and a repo search found that definition as the only `upsertListingFingerprints(` caller. The run snapshot hardcodes `listingFingerprints: []` (`run-discovery-memory-store.ts:121`). The store's key is a sha256 of `primary::`, `url::`, `semantic::`, or `content::` (`discovery-memory-store.ts:2313-2331`). The lead's `metadata.fingerprintKey` is the raw primary key, semantic key, or content hash (`listing-fingerprint.ts:497-498`). Those keys do not join.

**What it would take to record "seen N times, first seen in run X, also on boards Y and Z".**

1. Before either dedupe drops siblings, copy their `sourceId`s onto the kept lead. One pure function beside `dedupeFingerprintListings`. That is the measured "also on Y, Z" for this run.
2. At sheet match time, on `append` and on `canonical_url` / `provider` update, union those ids into a cell, set last-seen to this run's calendar day, set last Run ID, and increment a seen count by one observation per run. First Run ID and column A stay fill-once.
3. On `semantic` review, write nothing to the row. D5: an unconfirmed collision is not a sighting.
4. Leave existing rows blank. Do not backfill `1`.

`writeResult.skippedDuplicates` cannot become that N. It adds in-batch fingerprint drops (`pipeline-writer.ts:295-309`), semantic review skips (`506-511`), links already present at append time (`647-653`), and duplicate Link rows already in the sheet (`464-467`, added at `702`). Confirmed updates go to `updated`. BE's AGREED CONTRACT omits `duplicatesVsSheet` for this reason. The dossier should use the same omission.

Hint-only boards (LinkedIn, Indeed, Google Jobs-like hosts) are classified `hint_only` and are not extract targets (`career-surface-resolver.ts:257-267`). A source-id union should contain `SUPPORTED_SOURCE_IDS` (`contracts.ts:21-54`): the ATS ids plus `grounded_web` and `serpapi_google_jobs`. A hint host is not a board the listing was written from.

---

## 3. Other per-listing facts, ranked

Value is to someone deciding whether to apply. Cost is contract surface, hosted visibility, and the risk of showing an unmeasured number.

| Rank | Fact | Value | Cost | Do this |
|---|---|---|---|---|
| 1 | Fit Assessment prose and Match Score, already on the row | High. The number is on the rail with no reason; the drawer already has the paragraph | Dossier render only. Both values are measured | Phase A |
| 2 | Seen count, last seen, source-id union, first/last Run ID | High. This is the question D4 asks | New columns after Y, writer merge, parser. One contract change | Phase B |
| 3 | In-run sibling source ids folded onto the kept lead | High, and it is what makes rank 2 true for "also on Y, Z" | A few lines at the existing dedupe, then Phase B persists them | Part of Phase B |
| 4 | Salary origin token (`ats`, `grounded`, `ingest`, `user`) | Medium. Stops a discovered salary reading as the user's | Needs a writer on the dashboard edit path too, or the token rots after an edit | Later. Phase A must not invent a chip |
| 5 | Structured per-strength breakdown | Medium once the prose is visible. The prose already includes band, rationale, matches, concerns | Full object is local SQLite and profile-relative. A sheet cell would store that judgment in Google | Only if Phase A prose is not enough. Keep it local |
| 6 | The query that found it | Low on the listing. The run modal is getting bounded query labels (`searched.queries`, ≤ 50, no URLs) | `sourceQuery` defaults to a URL (`lead-normalizer.ts:413`). Persisting it breaks the RUNHIST URL rule | Do not put it on the row. Point at the run |
| 7 | Rejection near-misses for this company | Interesting, easy to over-claim | Samples are capped at 5 per source (`run-discovery.ts:2256-2263`). Company samples are stored on an exploit outcome only when that company produced an accepted lead (`run-discovery.ts:1814-1839`). Rejected listings are not Pipeline rows | Runs modal owns `rejectedTopReasons`. A dossier line waits until a measured, company-keyed list exists, and it must say "samples" |
| 8 | Matcher reason on an accepted lead | Low next to rank 1. Uncertain leads already land on the sheet with a Match Score (`run-discovery.ts:2275-2277`) | Reasons are dropped on accept (`run-discovery.ts:2303-2311`) | Skip until someone asks why a specific Match Score happened |

---

## 4. Where to store it

**Extra Pipeline columns (recommended for anything The Case must show when the worker is down).** The dashboard reads the Pipeline tab (`sheets-read-load.js` `parsePipelineCSV`). Hosted mode has the sheet and does not have `worker-state.sqlite`. D1 keeps the sheet as the fallback for run history; the same constraint applies to a listing. Privacy matches what is already in the sheet: source name, dates, scores. Run ids are the same ids DiscoveryRuns column K will hold. Do not add query strings, board tokens, rejected-listing URLs, or profile strength names.

Cost: Interface A. New columns go after Y (`AGENT_CONTRACT.md:141` says prefer appending; the file's "optional R–T" sentence is behind the schema, which already ends at Y). `discoveryMerge` has no increment or union mode (`schemas/pipeline-row.v1.json` `discoveryMergeSemantics`). Seen count and the source-id list need an explicit merge in `mergeExistingRow`, because an overwrite of "1" would reset the count every run. Notes cannot carry this: Notes are `preserve` (`pipeline-columns.generated.ts:30`) and the reader strips old "Discovered via variationKey" automation lines (`sheets-read-load.js:732-756`). Date Found cannot become last-seen: it is `fillIfEmpty`, and The Case already uses it as first found. `AGENT_CONTRACT.md:26` still says to refresh Date Found on re-discovery; the writer follows the schema, not that sentence.

**Worker fingerprint ledger (later, local only).** The table and the merge behavior exist (`discovery-memory-store.ts:1708-1776`) and the run does not write it (`server.ts:252` is the only caller; snapshot drops the array at `run-discovery-memory-store.ts:121`). Hosted The Case cannot open the file. Retention of the SQLite file is "as long as that disk lives", which is a different lifetime from the 90-day / 500-run status store. Use it after Phase B as a local index for fingerprint, query, and score breakdown, keyed by `metadata.fingerprintKey`, not by the store's current sha256.

**Run-status sidecar (reject for per-listing history).** `buildCompletedRunStatus` keeps source summaries, rejection samples, and `writeResult`, and does not keep lead arrays (`run-status-store.ts:113-159`). RUNHIST bounds `searched` labels and forbids URLs there. Retention becomes 90 days or the newest 500 runs (both AGREED CONTRACT blocks). A dossier lookup would scan those files, miss older sightings, and miss hosted users whose worker is elsewhere. Run id on the sheet row is the join. The run document stays about the run.

---

## 5. Contract sketch — `listingSighting.v1`

Aligned to the ids both RUNHIST lanes share. Read at write time, both reports still `PENDING`, both contain a delimited AGREED CONTRACT, and the blocks are not the same. SHA-256 of each block from `AGREED CONTRACT` through the character before `END AGREED CONTRACT`: FE `bdf8b88b4aba71dadc02df5052c13b4092b98b4be4d084231456d08a3039d8a6`, BE `9f9c3b99ad828c9264d107213fc6fdb7af3fd0e57ebc4f5dbe24f5d39fbd1d3a`. Intersection used here:

- `runId` is the join key. DiscoveryRuns gains header `Run ID` as column K. `GET /runs` and `GET /runs/:id` use that id.
- `runStats.sources[].id` is a grouped lane: `ats`, `grounded_web`, `serpapi_google_jobs`. Missing counts are omitted (D5).
- `duplicatesInRun` is measured. `duplicatesVsSheet` is omitted until the writer exposes a precise count.
- Persisted search labels are bounded and contain no URLs.
- Worker snapshots prune terminal runs after 90 days or above the newest 500.
- FE's delimited block drops `sheetStatus` and timeline `label`. BE's delimited block still has both. This sketch depends on neither.

`sourceId` on a listing is finer than the lane id. `greenhouse` and `lever` both roll up to lane `ats` (`contracts.ts:21-54`). The Case line "also on Greenhouse and Lever" uses `sourceId`. The lane id is only for joining that run's `runStats.sources[]` row.

Owner: the Pipeline writer, in the same function that already decides append versus update. The Case only reads. The run-status store does not own these fields.

Sheet cells, appended after Y so A–Y stay put:

| Header | Letter | Merge | Written when |
|---|---|---|---|
| Seen Count | Z | read-modify + 1 per confirmed observation in this run | `append`, `canonical_url` update, `provider` update |
| Last Seen | AA | overwrite with this run's calendar day (`localCalendarDay`) | same |
| Source Ids | AB | union, insertion order, cap 8, machine ids from `SUPPORTED_SOURCE_IDS` | same, including sibling ids folded in this run |
| First Run ID | AC | fill if empty | same |
| Last Run ID | AD | overwrite | same |

Blank means unmeasured. The renderer draws no sighting line. It does not draw "seen once" for an old row.

`First Run ID` and `Last Run ID` use the discovery `runId` that DiscoveryRuns column K stores. Manual ingest defaults that id to `ingest_url_run` (`raw-to-single-lead.ts:22`). `GET /runs` omits ingest runs (both contracts). The Case shows the id as text, and links it only when the loaded DiscoveryRuns list contains it.

Not in v1 cells: fingerprint, semantic key, `sourceQuery`, board token, matcher reasons, rejected URLs, salary origin, per-strength scores. Fingerprint and the score breakdown stay eligible for the local ledger in Phase C.

Dossier read path, once the cells exist: `parsePipelineCSV` grows five fields (`sheets-read-load.js:788`), `pipeline-render.js` adds data attributes the way it added `data-match-score`, `dawn-data.js` copies them onto the job, `buildCaseModel` adds `identity.sightings`, and the rail adds one line under `Found`. Example when every cell is present: `Seen 4 times · greenhouse, lever · last 2026-09-27 · run run_abc`. When Seen Count is blank, that line is absent.

Contract move, one change, same rule as Pipeline columns today: `schemas/pipeline-row.v1.json`, generated `pipeline-columns.generated.ts`, README Sheet Structure, `AGENT_CONTRACT.md`, writer, browser parser, `docs/CONTRACT-CHANGELOG.md`. `npm run test:pipeline-contract`.

---

## 6. Phased plan and lane fences

**Phase A — show measured fields The Case already has.** No schema change.

- `role-case-model.js` copies `job.matchScore` into `numbers` when it is a finite number, and copies enrichment `fitAssessment` (the sheet paragraph already on `data-fit-assessment`) into a single text field.
- `role-case.js` renders the paragraph under the fit tile, tagged `from your sheet`, and renders Match Score only when the number is present.
- Salary stays unlabeled. No "from discovery" chip without an origin token.
- Fence: `role-case.js`, `role-case-model.js`, their tests. Family: opus. Does not wait for Phase B. Does not touch the worker.

**Phase B — the sighting cells.** Smallest slice that answers D4 for hosted and local.

- Fold sibling `sourceId`s onto the kept lead in `run-discovery.ts` where `dedupeNormalizedLeads` runs (`run-discovery.ts:1586`), using the groups `dedupeFingerprintListings` already returns.
- `pipeline-writer.ts` applies the Z–AD merge on append and on canonical/provider update. Semantic review stays a skip with the existing warning.
- Parser, card attributes, Case rail line from section 5.
- Fence split: sol owns `schemas/pipeline-row.v1.json`, the generated columns, `pipeline-writer.ts`, `run-discovery.ts` sibling fold, worker tests, contract docs. Opus owns `sheets-read-load.js`, `pipeline-render.js`, `dawn-data.js`, `role-case*.js`, browser tests. Sol lands the columns and a fixture row first; opus reads that fixture. Neither lane writes the SQLite ledger.
- Done when: a second run that matches by URL unions a new source id, increments Seen Count by 1, keeps Date Found and First Run ID, overwrites Last Seen and Last Run ID; a semantic-only collision changes none of those cells; a row from before the columns renders no sighting line; `test:pipeline-contract` is green.

**Phase C — local ledger, after Phase B is on the sheet.**

- Call `upsertListingFingerprint` from the write path. Pass `metadata.fingerprintKey` through, or stop using the sha256 key, so the lead and the row join.
- Store sanitized query label only when it does not contain `://`. Store the score-breakdown JSON here, not on the sheet.
- Remove the hardcoded empty array at `run-discovery-memory-store.ts:121` only when a caller reads it.
- No dossier dependency. If a later local endpoint exists, The Case may add detail when the worker answers, and renders the sheet line when it does not.
- Fence: sol, `discovery-memory-store.ts`, `server.ts` adapter, `run-discovery.ts`. No Pipeline columns.

**Phase D — only if Phase A is not enough.** Structured per-strength from the local cache, and a salary-origin token with a dashboard edit path that sets `user` when the person changes column G. Separate program. Do not start it inside Phase B.

Near-misses stay on the run (FE's `rejectedTopReasons`). A company-level sample line in The Case is a later program and must be labeled as samples with a measured count, or omitted (D5).

---

## Confidence

High on the drop points, the three match kinds, the dormant fingerprint table, and the Case render gap. Those were read at `5d5b9a59` and checked against the line dump in the lane report.

Medium on the RUNHIST id join. Both sibling reports contain an AGREED CONTRACT and the blocks differ. This sketch uses only the overlap named in section 5.

## What I could not verify

- I did not run a live discovery against a Google Sheet, so I did not watch a real row lose its metadata. The path is the writer code.
- I did not open a production Sheet or `worker-state.sqlite`, so I do not know whether any environment has rows in `listing_fingerprints`. The run source never calls the upsert.
- I did not re-read every ATS adapter's `compensationText`. Workday is one writer; grounded search is another (`grounded-search.ts:2939`). Origin is still "whatever the adapter put on the raw listing", with no origin field.
- FE and BE were still `PENDING` when this was written. If their delimited blocks are later replaced with one identical contract, re-check only the `runId` and `sources[].id` sentences in section 5.
- I did not execute `npm run lint:repo` or `npm run typecheck:repo`. This lane changes no product file.
