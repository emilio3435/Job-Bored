# RUNHIST — persistent discovery run history with measured, expandable stats

Program folder: `docs/programs/runhist-20260927/`. Integration branch `feat/runhist-integration`, cut from `main` at `5d5b9a59`. Lanes: FE, BE, DOSSIER.

## §0 Locked decisions (Emilio, 2026-09-27 00:22 CT) — override everything below

| # | Decision |
|---|---|
| D1 | History lives on the **worker** (its on-disk run-status store) with the **Google Sheet as fallback**. New `GET /runs` list endpoint; a persisted per-run stats block; retention raised from 30 days / 200 runs to **90 days / 500 runs**. The Sheet's DiscoveryRuns tab gains one **Run ID** column so Sheet rows join worker detail and older or remote runs still list. |
| D2 | The expanded run shows all four: **funnel + fit scores**, **per-source breakdown**, **timeline**, **where it searched**. |
| D3 | FE lane: **Opus, high effort**, with the `/frontend-design` skill. BE lane: **Sol, xhigh**. |
| D4 | A separate **DOSSIER** lane investigates adding per-listing run detail to the dossier (for example overlapping listings seen on several boards or runs, which run and source found it, duplicate history). Investigation and recommendations only; no product code. |
| D5 | Render only measured numbers. A stat the worker did not measure is absent, never zero, never estimated. |

## §1 What exists (scouted 2026-09-27, file:line from `5d5b9a59`)

- Run store: `integrations/browser-use-discovery/src/state/run-status-store.ts` — one atomic JSON file per run under `run-state/` next to `worker-state.sqlite`; survives restart; boot pruning in `src/webhook/boot-recovery.ts:24-25,83-121` (30 d / 200). `listRunStatusSnapshots(dir)` (`:269-297`) exists, used at boot only.
- `GET /runs/:id` — `src/webhook/worker-router.ts:276-332`, payload type `DiscoveryRunStatusPayload` (`src/contracts.ts:1016-1051`): `lifecycle` (counts, `stageOrder[]`, `loopCounters` incl. `duplicateSuppressions`, `crossLaneDuplicates`), `writeResult` (`appended`, `updated`, `skippedDuplicates`, `skippedBlacklist`), `sources[]` (`DiscoverySourceSummary`: `querySummary`, `pagesVisited`, `leadsSeen/Accepted/Rejected`, `rejectionSummary.rejectionReasons`, `duplicateListingsSuppressed`, …), `progress` (UXD live contract). `extractionResults` is dropped by `buildCompletedRunStatus` (`run-status-store.ts:113-159`). **No list endpoint.**
- Fit scores: per lead in `src/normalize/lead-normalizer.ts:248-395` (`fitScore`/`matchScore`); **no aggregate anywhere**.
- Sheet history: `src/sheets/discovery-runs-writer.ts` (columns `contracts.ts:6-17`: Run At, Trigger, Status, Duration (s), Companies Seen, Leads New, Leads Updated, Source, Variation Key, Error — **no Run ID**); legacy header migration `src/sheets/discovery-runs-legacy.ts`; spec `docs/INTERFACE-DISCOVERY-RUNS.md`.
- Dashboard: Runs modal `partials/discovery-runs-modal.html` + `runs-tab.js` (list from Sheet `DiscoveryRuns!A2:J`, live row from localStorage `command_center_discovery_run_state`, existing 6-field expand `:566-627`); tracker `discovery-run-tracker.js`; CSS `css/runs-log.css` + inline modal `<style>` (`partials/discovery-runs-modal.html:5-74`, budget pinned by `tests/index-html-size.test.mjs`). Note: `discovery-status-handoff.js:763-775` reads `writeResult.rejectionSummary`, which the worker never sends (it is per source).

## §2 Draft stats contract (BE and FE refine; the AGREED CONTRACT supersedes this)

Terminal run status gains `runStats` (additive; absent on older runs):

```jsonc
"runStats": {
  "schemaVersion": 1,
  "durationMs": 512000,
  "funnel": {                      // every field optional; absent = not measured
    "companiesSearched": 3, "boardsDetected": 39, "queriesRun": 5,
    "listingsSeen": 539, "listingsProcessed": 539,
    "duplicatesInRun": 41,         // cross-lane / in-run dedupe
    "duplicatesVsSheet": 12,       // matched existing Sheet rows (skipped)
    "rejected": 470, "rejectedTopReasons": [{"reason": "title_mismatch", "count": 210}],   // ≤ 8
    "candidates": 28,              // qualified after matching, before write
    "written": 9, "updated": 3
  },
  "fit": { "scored": 28, "avg": 6.8, "median": 7, "min": 3, "max": 9, "scale": 10,
           "histogram": [0,0,1,2,3,5,7,6,3,1] },    // counts per score bucket 1..scale
  "sources": [{ "id": "ats", "label": "Company boards", "searched": {"companies": 3, "boards": 39},
                "seen": 525, "accepted": 20, "rejected": 480, "duplicates": 25,
                "timeouts": 1, "state": "done" }],               // ≤ 8 sources
  "timeline": [{ "phase": "scout", "startedAt": "…", "durationMs": 512000 }],
  "matcherCalls": 41,
  "searched": { "companies": ["Figma", "Notion"], "queries": ["senior pm remote"],   // bounded: ≤ 50 each, labels only
                "truncated": false }
}
```

`GET /runs?limit=&before=` returns newest-first summaries: `{ ok, runs: [{ runId, status, trigger, startedAt, completedAt, durationMs, headline: { written, updated, candidates, fitAvg } }], nextBefore }`. `GET /runs/:id` returns the full status including `runStats`.

Invariants: additive and backward compatible; schema + example + `AGENT_CONTRACT.md` + `docs/CONTRACT-CHANGELOG.md` + code move in one commit; no keys, tokens, or raw URLs with credentials in `searched`; bounded cardinality; stats computation never throws out of a run (warn and omit).

## §3 Lanes

| Lane | Family · effort | Fence | Consumes |
|---|---|---|---|
| BE | sol · xhigh | worker `src/run/**` (stats accumulation), `src/state/run-status-store.ts`, `src/webhook/worker-router.ts` + `boot-recovery.ts` (list endpoint, retention), `src/sheets/discovery-runs-*.ts` + `contracts.ts` (Run ID column, legacy migration), worker tests, `schemas/run-status.v1.schema.json`, `examples/`, `AGENT_CONTRACT.md`, `docs/CONTRACT-CHANGELOG.md`, `docs/INTERFACE-DISCOVERY-RUNS.md` | AGREED CONTRACT with FE |
| FE | opus · high + /frontend-design | `runs-tab.js`, `partials/discovery-runs-modal.html`, `css/runs-log.css`, `discovery-run-tracker.js`, `discovery-status-handoff.js` (history fetch + the rejectionSummary read), new `tests/runhist-fe-*.test.mjs` | AGREED CONTRACT with BE |
| DOSSIER | grok · xhigh (research) | writes only `.lane-evidence/` in its worktree (report + `DOSSIER-RECS.md`); reads anything | BE's contract for alignment of ids |

Domain split: `history-be · flat · worker+contract · one Sol lane`, `history-fe · flat · runs modal · one Opus lane`, `dossier-research · flat · read-only · one Grok lane`.

## §4 Model mix (00:22 CT)

| Domain | Family | Locked id | Bucket used % | Why |
|---|---|---|---|---|
| Orchestration | opus | claude-opus-5-5 | A: 92% week (native `/usage`, 00:13), session 3% | this session |
| FE | opus · high | claude-opus-5-5 | A: 92% | Emilio's pick (D3); visual work |
| BE | sol · xhigh | gpt-6-sol | X: 10% week (app-server, 00:11) | Emilio's pick (D3); backend + contract |
| DOSSIER | grok · xhigh | grok-4.7-build-fast | K: unknown (GFXPKG Grok live at 23:10, so not walled) | research family per policy |

Plan check: Grok reviews this spec in parallel with the lanes' Phase 0 (lanes investigate before building, so findings fold into the AGREED CONTRACT).
