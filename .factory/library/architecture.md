# Architecture

## Mission scope architecture

This mission refactors discovery into an explicit **source preset pipeline** where one selected mode controls execution:

- `browser_only`
- `ats_only`
- `browser_plus_ats`

The product remains sheet-centric: Google Sheets is still the durable data plane, and discovery writes append/update rows there.

## Core components

### 1) Browser preset surface (dashboard/settings/run modal)
- Captures and persists selected source preset.
- Captures discovery intent from canonical manual fields and AI-suggestion output fields, then resolves to canonical intent before run dispatch.
- Displays the active preset before run.
- Starts discovery run and shows run status progression.
- Enforces mutual exclusivity and last-selection-wins at submit time.
- Normalizes first-visit and legacy stored state to one explicit valid preset.

### 2) Discovery webhook contract boundary
- Accepts `command-center.discovery` requests from browser.
- Validates auth (`x-discovery-secret`) and payload schema.
- Produces synchronous or async acknowledgements with run tracking (`runId`, `statusPath`).
- Canonical preset contract field is `discoveryProfile.sourcePreset` with enum:
  - `browser_only`
  - `ats_only`
  - `browser_plus_ats`
- Invalid/contradictory preset payloads return explicit `400` field errors.
- Async acknowledgements include `pollAfterMs` for status polling cadence.

### 3) Discovery config resolver
- Merges request-level selection with operational worker config (sources, runtime limits, sheet boundaries).
- Run intent is request-authoritative: preset and discovery-intent fields must be explicit in request payload.
- No silent stored-profile fallback for omitted run-intent fields.
- Resolves the effective lane set for a run from explicit preset + enabled source set.
- Supports unrestricted company scope (empty company list) without hard preflight rejection.

### 4) Discovery execution router
- Runs only the source families selected by the resolved preset.
- Emits per-source outcomes and lane-level warnings.
- Must provide explicit non-execution evidence for excluded lanes.
- Non-execution evidence is structured and measurable (stage-level detect/list invocation counters or equivalent skip telemetry).
- In unrestricted mode, discovery is not pinned to preconfigured company targets and must preserve truthful source attribution under all presets.

### 5) Run status + observability surface
- `/health` reports readiness causes (browser runtime, Gemini, Sheets credentials).
- `/runs/{runId}` reports lifecycle and per-source outcomes.
- Logs correlate readiness warnings to run-level outcomes.
- Hard preflight failures (credential/runtime blockers) fail closed before enqueue.
- Lifecycle progression remains traceable from ack -> pending/running -> terminal and recoverable after refresh/reopen.

### 6) Google Sheets writer
- Persists accepted leads as append/update mutations.
- Write execution order is sequential: `batchUpdateRows` runs first, then `appendRows`. This means update-phase failures prevent appends, and append-phase failures occur after updates are already committed (no transaction semantics).
- Preserves canonical link identity and source attribution.
- Returns writeResult counters that reconcile with observable sheet deltas.
- Local vs hosted mode preserve explicit `sheetId` boundary behavior.
- Write failures are phase-attributed (append path vs update path) via `SheetWriteError` custom error class with `phase`, `httpStatus`, `detail`, and `sheetId` fields.
- On write failure, counters are zeroed (appended: 0, updated: 0) even if partial writes succeeded; the `writeError` field provides failure details.

## End-to-end flow

1. User selects preset in browser UI.
2. Browser posts webhook request with source preset + run metadata.
3. Worker validates/authenticates request and resolves effective config.
4. Router executes only allowed lane families.
5. Worker writes results to sheet and updates run status until terminal.
6. UI surfaces terminal run outcome for the same runId.

## Invariants

- Source preset is authoritative for lane execution.
- Omitted/blank run-intent fields are rejected explicitly rather than silently inferred from stored profile defaults.
- Run dispatch resolves intent from user-visible inputs: if manual intent is blank but AI suggestions are non-blank, those values must be promoted into canonical intent fields before payload dispatch.
- Empty company config does not imply run rejection; unrestricted execution remains valid when intent and credentials are present.
- ATS is optional; it is never implicitly forced in `browser_only`.
- Async acceptance is never treated as terminal success.
- Failures (auth, readiness, source, write path) are explicit and attributable.
- Every terminal run is traceable by a stable runId from UI -> API -> status -> sheet evidence.
- UI run gating enforces minimum user intent before run dispatch (at least one of target roles or include keywords).
