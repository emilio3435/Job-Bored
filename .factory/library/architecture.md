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
- Merges request-level selection with stored worker config.
- Resolves the effective lane set for a run.
- Owns deterministic fallback truth table when preset is omitted:
  - Stored explicit preset exists -> use stored preset.
  - Only grounded lane enabled -> `browser_only`.
  - Only ATS lanes enabled -> `ats_only`.
  - Mixed/legacy state -> `browser_plus_ats`.

### 4) Discovery execution router
- Runs only the source families selected by the resolved preset.
- Emits per-source outcomes and lane-level warnings.
- Must provide explicit non-execution evidence for excluded lanes.
- Non-execution evidence is structured and measurable (stage-level detect/list invocation counters or equivalent skip telemetry).

### 5) Run status + observability surface
- `/health` reports readiness causes (browser runtime, Gemini, Sheets credentials).
- `/runs/{runId}` reports lifecycle and per-source outcomes.
- Logs correlate readiness warnings to run-level outcomes.
- Hard preflight failures (credential/runtime blockers) fail closed before enqueue.
- Lifecycle progression remains traceable from ack -> pending/running -> terminal and recoverable after refresh/reopen.

### 6) Google Sheets writer
- Persists accepted leads as append/update mutations.
- Preserves canonical link identity and source attribution.
- Returns writeResult counters that reconcile with observable sheet deltas.
- Local vs hosted mode preserve explicit `sheetId` boundary behavior.
- Write failures are phase-attributed (append path vs update path).

## End-to-end flow

1. User selects preset in browser UI.
2. Browser posts webhook request with source preset + run metadata.
3. Worker validates/authenticates request and resolves effective config.
4. Router executes only allowed lane families.
5. Worker writes results to sheet and updates run status until terminal.
6. UI surfaces terminal run outcome for the same runId.

## Invariants

- Source preset is authoritative for lane execution.
- ATS is optional; it is never implicitly forced in `browser_only`.
- Async acceptance is never treated as terminal success.
- Failures (auth, readiness, source, write path) are explicit and attributable.
- Every terminal run is traceable by a stable runId from UI -> API -> status -> sheet evidence.
- First-visit and legacy-state users always resolve to a valid explicit preset.
