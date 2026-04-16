# Architecture

## Opportunity Loop Rebuild (Mission View)

This mission converts discovery execution into an explicit **scout -> score -> exploit -> learn** loop for unrestricted `browser_plus_ats` runs while preserving webhook and sheet contracts.

## System Components

### 1) Contract Boundary (Webhook + Run Status)
- Input contract remains `command-center.discovery` v1.
- Auth/preflight enforce fail-closed behavior.
- Async acceptance returns `runId` + `statusPath`.
- `/runs/{runId}` remains the status boundary for lifecycle and evidence.

### 2) Unified Opportunity Frontier
- Two lanes feed one frontier:
  - ATS lane: provider/company surfaces.
  - Browser lane: canonical employer/ATS surfaces discovered through grounded search.
- Third-party board/detail hosts are hint-only, never direct write sources.

### 3) Scout Phase
- ATS scout collects lightweight board/surface signals (not full normalization).
- Browser scout discovers canonical surfaces and resolves hints.
- Scout outputs become scored frontier candidates plus persisted scout observations.

### 4) Score + Selection Phase
- Shared scoring ranks candidates across ATS/browser lanes.
- Inputs include fit, freshness, historical outcomes, diversity, and suppression/cooldown signals.
- Shared exploration budgets gate selected exploit targets.

### 5) Exploit Phase
- Deep extraction runs only on selected exploit targets.
- Upstream vetoes apply before expensive extraction:
  - non-job/informational pages,
  - hint-only host veto,
  - mismatch/title-shape checks,
  - threshold suppression.

### 6) Learn Phase
- Persist scout observations and exploit outcomes.
- Persist yield/cooldown history and deterministic role-family memory.
- Next runs consume this memory for seeding and ranking.

### 7) Output + Telemetry
- Normalize/dedupe/write paths remain contract-compatible.
- Source summary and terminal status expose loop counters and reason attribution.
- Diagnostics must make degraded outcomes explainable.

## Security Patterns

### Webhook auth: timing-safe comparison
- `handle-discovery-webhook.ts` uses `timingSafeEqual` from `node:crypto` for webhook secret comparison.
- Buffer length is checked separately before calling `timingSafeEqual` (defense-in-depth against timing attacks).
- Three explicit auth failure categories: `no_secret_configured`, `missing_secret_header`, `secret_mismatch`.

### Webhook handler ordering invariant
The webhook handler follows a strict ordering that must be preserved:
1. Method check (POST only)
2. Auth check (before any side effects)
3. Parse request
4. Extract/redact `googleAccessToken` (destructuring removal)
5. Preflight validation (credential readiness, blank intent, sheet ID)
6. `runStatusStore.put()` (first side effect — only after all checks pass)
7. Run execution

Any reordering that moves side-effectful operations before auth/preflight checks would be a security regression.

## Provider Architecture Pattern (ATS)

The ATS provider layer uses a factory pattern introduced in `providers/shared.ts`:
- `createAtsProvider()` factory with config object
- `AtsProviderRegistry` with timeout isolation per provider
- `canonicalizeProviderSurface()` for URL normalization
- All 14 providers follow this pattern (greenhouse, lever, ashby, smartrecruiters, workday, icims, jobvite, taleo, successfactors, workable, breezy, recruitee, teamtailor, personio)
- New providers should follow the same factory pattern

## Browser Scout Policy Classification

The browser scout lane uses a 3-tier policy model defined in `career-surface-resolver.ts`:

1. **`blocked`** — Host is on the blocked list; no extraction or hint resolution attempted.
2. **`hint_only`** — Third-party job board host (LinkedIn, Indeed, ZipRecruiter, etc.); candidate is recorded as a hint but never directly extracted. Hint resolution may upgrade to canonical if a canonical employer/ATS surface is discovered.
3. **`extractable`** — Canonical employer/ATS surface eligible for extraction, subject to secondary gating via `isCanonicalExtractableCandidate()`.

The canonical extraction gate (`isCanonicalExtractableCandidate` in `grounded-search.ts`) provides an additional filter beyond the 3-tier classification: only candidates that pass both policy classification AND canonical extraction gating proceed to deep extraction. This implements the VAL-LOOP-BROWSER-004 requirement.

### Third-party host detection
- `THIRD_PARTY_JOB_BOARD_HOSTS` in `career-surface-resolver.ts` maintains the authoritative list of blocked/hint-only hosts (30+ domains).
- Test fixtures (e.g., `THIRD_PARTY_HOSTS` in `career-surface-resolver.test.ts`) may be a subset for targeted coverage; they do not need to be exhaustive but should cover the major hosts.
- The validation contract specifies 4 policy classes but the implementation uses 3 with secondary gating — this is a naming gap, not a behavioral gap.

## Memory Store Architecture

The memory store (`src/state/discovery-memory-store.ts`) uses SQLite with the following tables:
- `discovery_run_status` — Run lifecycle state (pre-existing, not modified by scout wave)
- `company_registry` — Company records with surface outcome tracking
- `career_surface_outcomes` — Surface-level outcomes per company
- `intent_coverage` — Intent-to-company coverage tracking
- `dead_link_cooldowns` — Failed URL retry cooldowns
- `listing_fingerprints` — Cross-run deduplication fingerprints
- `scout_observations` — Scout-phase observation records (run/surface identity, queryable by run and surface)

Type patterns follow a dual-declaration convention where types appear in both `contracts.ts` (with JSDoc) and the store module (without JSDoc). This is an established project pattern, not a bug.

## Core Invariants

- Webhook request and sheet write contracts remain backward compatible.
- `browser_plus_ats` unrestricted flow uses both lanes in a shared frontier.
- Direct third-party extraction remains blocked (hint-only).
- ATS seeding remains independent of planner emptiness.
- Precision-over-recall remains the write policy.
- Deterministic logic is preferred over new model dependencies.
