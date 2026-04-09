# Browser Use Discovery Worker v1 Architecture

Concise, robust v1 architecture for making JobBored's `Run discovery` trigger a real browser-backed discovery engine.

This plan assumes these product decisions are locked:
- support both local and hosted modes
- core v1 sources are Greenhouse, Lever, and Ashby
- worker writes directly to Google Sheets
- support both manual and scheduled discovery
- tougher sites are second-layer adapters, not v1 core
- discovery input is company list + keywords
- priorities are setup simplicity and breadth of sources
- target audience is general JobBored users

## 1. What we are building

A user-owned discovery worker that:
- accepts JobBored discovery webhook requests
- resolves company names to career boards
- uses Browser Use where browser automation adds real value
- extracts matching jobs from supported ATS sources
- normalizes them into JobBored Pipeline rows
- dedupes by job link
- writes rows directly into the user's Google Sheet

Simple product promise:
- user enters target companies + keywords
- user clicks `Run discovery` or turns on a schedule
- matching jobs appear in JobBored

## 2. V1 goals and non-goals

### Goals
- make `Run discovery` produce real leads, not just webhook wiring
- keep the dashboard contract stable for v1
- make hosted the simplest path for general users
- keep local mode available for advanced/privacy-minded users
- support broad coverage across Greenhouse, Lever, and Ashby via one worker codebase

### Non-goals
- maintainer-hosted multi-tenant discovery service
- first-pass support for tougher/auth-heavy sources
- reusing browser OAuth tokens from the dashboard inside the worker
- fuzzy dedupe across unrelated URLs in v1
- forcing users to know ATS URLs ahead of time

## 3. Product constraints from JobBored

The design must preserve these repo-level rules:
- JobBored remains a static dashboard
- the dashboard sends the existing discovery webhook contract
- dedupe remains column E `Link`
- direct sheet writes are allowed and preferred for the worker
- Apps Script stub remains stub-only and never pretends to be real discovery
- manual and scheduled discovery are both valid product paths
- infrastructure remains user-owned

## 4. High-level system design

Recommended package subtree:

`integrations/browser-use-discovery/`
- `src/contracts.ts`
- `src/config.ts`
- `src/browser/session.ts`
- `src/browser/source-adapters.ts`
- `src/normalize/lead-normalizer.ts`
- `src/sheets/pipeline-writer.ts`
- `src/run/run-discovery.ts`
- `src/webhook/handle-discovery-webhook.ts`
- `tests/...`
- `README.md`

Core components:

1. Webhook receiver
- accepts browser-triggered `Run discovery` requests
- validates the existing request contract
- creates a `runId`
- enqueues or dispatches a run
- returns `200` or `202` quickly

2. Run dispatcher
- unifies manual and scheduled runs into one execution pipeline
- builds one `DiscoveryRun` object with effective settings
- enforces one active run per config unless queueing is explicitly allowed

3. Profile/config store
- stores worker-side company list + keyword defaults
- keyed by sheet identity or worker workspace
- merges runtime webhook hints on top of stored config
- exists because current webhook contract does not yet carry company list

4. Company resolver
- takes company names from config
- resolves each to a supported board URL when possible
- caches company -> ATS board mapping
- uses Browser Use for board discovery and verification when needed

5. Query planner
- expands companies + keywords into adapter tasks
- uses `variationKey` to vary run order/query combinations
- enforces per-run caps and source limits

6. Source adapter registry
- v1 adapters:
  - Greenhouse
  - Lever
  - Ashby
- each adapter exposes:
  - detect/resolve support
  - list jobs
  - normalize raw jobs
  - Browser Use fallback path if light interaction is needed

7. Browser Use session manager
- owns browser session lifecycle, timeout, retries, and cleanup
- isolates browsing by company or source batch
- keeps browser usage bounded instead of making every step fully autonomous

8. Lead normalizer + filter
- maps raw source output into one internal lead shape
- applies keyword/title/location filters
- computes simple fit score and priority for v1

9. Dedupe + merge engine
- dedupes within a run
- dedupes against existing Pipeline rows by normalized Link
- prepares append vs update batches

10. Google Sheets writer
- validates the Pipeline tab header
- reads existing Link column once per run
- batch updates existing rows
- batch appends new rows
- preserves user-managed fields on existing rows

11. State store
- holds:
  - run history
  - idempotency keys
  - company -> board cache
  - degraded-source cooldowns
  - saved worker config per sheet/workspace
- recommended:
  - local mode: SQLite
  - hosted mode: Postgres/libSQL/managed SQLite-equivalent

## 5. Webhook contract usage

V1 should keep the current dashboard webhook shape unchanged:
- `event`
- `schemaVersion`
- `sheetId`
- `variationKey`
- `requestedAt`
- optional `discoveryProfile`

Receiver behavior:
- validate request shape exactly
- require `event = command-center.discovery`
- require `schemaVersion = 1`
- treat `variationKey` as both trace metadata and query-variation input
- merge `discoveryProfile` into stored worker settings
- return success quickly, preferably async-friendly

Recommended acknowledgment shape:

```json
{
  "ok": true,
  "kind": "accepted_async",
  "runId": "run_123",
  "message": "Discovery accepted — worker queued the run"
}
```

Important v1 note:
- current webhook contract does not include company list
- therefore company list should live in worker config/state, not be forced into the webhook in v1
- if JobBored later adds company list to the contract, the worker can merge that as a higher-priority override

## 6. Discovery input model

V1 effective discovery input should be built from two layers.

Layer 1: stored worker config
- company list
- include keywords
- exclude keywords
- optional role/location/remote hints
- max leads per run
- schedule settings
- enabled sources

Layer 2: runtime webhook hints
- `discoveryProfile.targetRoles`
- `locations`
- `remotePolicy`
- `seniority`
- `keywordsInclude`
- `keywordsExclude`
- `maxLeadsPerRun`

Merge rule:
- stored worker config is the default source of truth
- webhook `discoveryProfile` can narrow or override the current run
- company list stays worker-owned in v1

## 7. Source adapter design

Use a registry with one shared interface.

Suggested interface:

```ts
type SourceAdapter = {
  sourceId: "greenhouse" | "lever" | "ashby" | string;
  detect(companyContext: CompanyContext): Promise<DetectionResult>;
  listJobs(boardContext: BoardContext): Promise<RawListing[]>;
  normalize(raw: RawListing, runContext: RunContext): Promise<NormalizedLead | null>;
};
```

V1 rules:
- keep Greenhouse, Lever, and Ashby as first-class adapters
- prefer stable ATS-native patterns or structured responses when available
- use Browser Use as:
  - board discovery/verifier
  - fallback for light interaction, pagination, rendering, and extraction
- do not let site-specific scraping logic spread across the whole codebase

Second-layer adapter system:
- tougher sites live behind a second adapter tier
- second-layer adapters must not complicate core v1 flow
- each tougher adapter should carry its own readiness, auth, and degradation rules
- product UI should show them as opt-in sources later, not default sources now

## 8. End-to-end data flow

### Manual run
1. JobBored sends webhook POST
2. receiver validates request and creates `runId`
3. dispatcher loads stored worker config for the sheet/workspace
4. dispatcher merges runtime `discoveryProfile`
5. company resolver maps company names to supported ATS boards
6. query planner creates source tasks
7. adapters gather raw listings
8. normalizer filters and scores them
9. dedupe engine removes duplicates and compares against sheet links
10. Sheets writer updates/appends rows
11. run state is marked success, partial success, or failed

### Scheduled run
1. scheduler creates `runId` and internal `variationKey`
2. same pipeline runs
3. results and metrics are stored in run history

Manual and scheduled runs should share the same execution path after dispatch.

## 9. Dedupe and merge policy

Canonical dedupe key:
- column E `Link`

Dedupe levels:
1. in-run dedupe
- avoids duplicate results across companies/adapters in the same run

2. sheet dedupe
- compares normalized links against existing Pipeline rows
- updates matching rows instead of appending duplicates

Link normalization should be conservative:
- strip safe tracking params
- normalize trailing slash
- preserve source/job identifiers
- do not add fuzzy company/title dedupe in v1

## 10. Pipeline write contract

The writer should honor current JobBored expectations.

Safe v1 insert behavior:
- populate A-Q
- set `Status` to `New`

Safe v1 update behavior:
- preserve user-managed workflow fields on existing rows
- do not overwrite:
  - Status
  - Applied Date
  - Notes
  - Follow-up Date
  - Last contact
  - Did they reply?
- be conservative when refreshing:
  - Fit Score
  - Priority
  - Fit Assessment
  - Talking Points

This avoids clobbering user edits and keeps the worker trustworthy.

## 11. Local vs hosted deployment story

### Hosted mode
Recommended default for general users.

Why:
- simpler browser-triggered runs
- better scheduling reliability
- no need to keep a personal machine awake
- cleaner status model for general users

Requirements:
- public HTTPS worker URL
- persistent worker state
- worker-side Google Sheets credential
- Browser Use credential/config

### Local mode
Advanced option.

Why:
- privacy-sensitive setups
- easier adapter experimentation and debugging
- users who want everything on their own machine

Requirements:
- local worker runtime
- local state store
- optional tunnel/relay only if browser-triggered discovery must reach localhost from a hosted dashboard
- optional local scheduler if scheduled runs are desired

Shared rule:
- local and hosted should use the same code path and contracts
- only infrastructure and credential storage differ

## 12. Settings and setup UX

The setup wizard should optimize for setup simplicity.

Recommended v1 setup flow:

1. Choose mode
- Hosted worker (recommended)
- Local worker (advanced)
- Scheduled/manual-only path if user does not want browser-triggered discovery yet

2. Connect sheet
- paste Sheet URL or ID
- verify access
- explain that worker writes directly to this sheet

3. Connect worker credentials
- Google Sheets writer credential for worker
- Browser Use credential/state check
- show status only, never echo secrets back

4. Enter discovery inputs
- company list
- include keywords
- exclude keywords
- optional role/location/remote hints
- per-run max leads

5. Choose sources
- Greenhouse enabled
- Lever enabled
- Ashby enabled
- second-layer adapters hidden behind future/advanced controls

6. Configure schedule
- manual only
- weekdays each morning
- daily
- twice daily
- advanced/custom later

7. Verify readiness
- worker reachable
- Sheets write test passes
- Browser Use/browser health passes
- state shown as one of:
  - not configured
  - stub/test only
  - ready for manual runs
  - ready for scheduled runs
  - degraded

8. Finish summary
- mode
- sheet connected
- sources enabled
- company count
- schedule summary
- `Run now` CTA

## 13. Scheduling model

V1 should support both manual and scheduled discovery.

Recommended behavior:
- one active run at a time per worker config
- if a manual run starts during an active run:
  - either queue one follow-up run
  - or reject with a clear `already running` message
- default hosted preset:
  - weekdays in the morning in the user's timezone
- default local preset:
  - manual only unless the user explicitly enables a local scheduler

Guardrails:
- per-run job cap
- timeout per company/source batch
- degraded-source cooldown when a source repeatedly fails or hits bot walls
- partial success is allowed and should be surfaced clearly

## 14. Failure handling and observability

Failure model:
- one company failing should not fail the whole run
- one source degrading should not block the rest
- writes should be retriable separately from browsing when possible

Each run should record at minimum:
- `runId`
- trigger type
- `sheetId`
- `variationKey`
- companies scanned
- source counts
- new rows appended
- rows updated
- failures by source/company
- final state: success / partial / failed

Recommended top-level user-facing statuses:
- not configured
- stub/test only
- ready
- running
- paused
- degraded
- last run failed

## 15. Implementation order

Recommended v1 build order:
1. contracts + config + fixtures
2. state store + dedupe + Sheets writer
3. company resolver
4. Greenhouse adapter
5. Lever adapter
6. Ashby adapter
7. webhook receiver + run dispatcher
8. scheduling
9. hosted packaging + local developer path
10. QA harness and docs

## 16. Robust v1 defaults

Strong recommendations for v1:
- hosted is the recommended path
- company list + keywords is the primary input model
- direct Sheets writes are the default
- async `202 Accepted` is a valid success path
- Greenhouse/Lever/Ashby are the only built-in first-layer adapters
- tougher sites are explicitly second-layer adapters
- company list stays in worker config until the dashboard contract evolves
