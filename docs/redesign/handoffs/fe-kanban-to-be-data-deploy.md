# Handoff: fe-kanban → be-data-deploy

**Run:** `redesign-20260424T0742Z`
**From:** fe-kanban lane
**To:** be-data-deploy lane

## Ask

Add a **`statusChangedAt`** field to each pipeline row emitted by `parsePipelineCSV(...)` (app.js ~L10100+).

## Why

The kanban card needs to surface **"days in current stage"** as one of its five at-a-glance signals (per `docs/redesign/handoffs/fe-kanban.md` item 4: "how long it's been there"). Today, `parsePipelineCSV` only emits `dateFound` (the date the row first appeared). Using `dateFound` as the stage-age source is wrong: it never updates when a user moves a job from `New` → `Applied` → `Interviewing`, so a job that's been in Interviewing for 2 days but was discovered 40 days ago would read "40 days" instead of "2 days".

## Desired shape

| Field             | Type                    | Source                                                                                                                               |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `statusChangedAt` | `Date \| null`          | Most recent timestamp at which `status` changed. If the sheet does not track this, fall back to `lastUpdatedAt` or `dateFound`.       |
| `lastUpdatedAt`   | `Date \| null` (optional) | Last-modified date for the whole row (any column). Useful as a softer fallback.                                                     |

If the Sheet has no column for either, please at minimum emit `statusChangedAt: job.dateFound` as a stub so the client can transition without a null-check churn later.

## Current fallback chain (client-side, already in place)

`renderKanbanCard` reads (in priority order):

1. `job.statusChangedAt`
2. `job.lastUpdatedAt`
3. `job.addedAt`
4. `job.discoveredAt`
5. `job.dateFound`

If none are present, the card renders "Age unknown" and does not break. So this is non-blocking for the fe-kanban redesign — but the number shown will be misleading until `statusChangedAt` is emitted.

## Contract impact

- **Sheet schema:** may require a new column (e.g. column `U — Status Changed At`) per `AGENT_CONTRACT.md`. That's a contract bump — coordinate with the integration lane.
- **No schema change option:** derive `statusChangedAt` at read time by tracking status transitions in a client-side store (IndexedDB) — also acceptable, and keeps the Sheet contract stable.

## Non-asks (fe-kanban will handle)

- Formatting "N days" / "Today" / "1 day" — already in `getKanbanStageAge(job)`.
- Fallback to "Age unknown" on missing data — already handled.
