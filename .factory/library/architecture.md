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

## Core Invariants

- Webhook request and sheet write contracts remain backward compatible.
- `browser_plus_ats` unrestricted flow uses both lanes in a shared frontier.
- Direct third-party extraction remains blocked (hint-only).
- ATS seeding remains independent of planner emptiness.
- Precision-over-recall remains the write policy.
- Deterministic logic is preferred over new model dependencies.
