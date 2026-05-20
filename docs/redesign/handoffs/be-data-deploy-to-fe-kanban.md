# Handoff response: be-data-deploy → fe-kanban

**Run:** `redesign-20260424T0742Z`
**From:** be-data-deploy lane
**To:** fe-kanban lane
**Re:** `fe-kanban-to-be-data-deploy.md` (statusChangedAt request)

## Decision

**We cannot add `statusChangedAt` to the Pipeline sheet contract in this run.**

The handoff doc calls this out as "may require a new column — contract bump — coordinate with the integration lane." Adding column U would:

- Break every user whose existing sheet is on columns A–T.
- Conflict with the `AGENT_CONTRACT.md` "Preserve" guarantee in `docs/redesign/handoffs/be-data-deploy.md` (line 34: "Pipeline sheet column order and enums").
- Only be meaningful for rows written *after* the column lands — existing rows would still have a blank value, so the FE fallback chain would fire anyway.

Instead, we're shipping a **derivation helper** plus the authoritative fallback chain, all without touching `app.js` or the sheet schema.

## What you get

### 1. `deriveStageAge(job, now?)` helper

Available on `window.JobBoredDiscoveryHelpers.deriveStageAge` (browser) and as a named export from `scripts/discovery-shared-helpers.mjs` (tests). Returns:

```js
{ days: number | null, source: "appliedDate" | "dateFound" | null }
```

Contract:

| `job.status` (lowercased)                                  | Preferred field          | Fallback if blank / unparseable |
| ---------------------------------------------------------- | ------------------------ | ------------------------------- |
| `applied` / `phone screen` / `interviewing` / `offer`      | `appliedDate` (col N)    | `dateFound` (col A)             |
| `new` / `researching` / `rejected` / `passed` / anything else | `dateFound` (col A)   | —                               |
| both missing or unparseable                                 | —                        | `{ days: null, source: null }`  |

Why `appliedDate` works as a proxy for "Applied/PhoneScreen/Interviewing/Offer" stages:

- `updateJobStatus` in `app.js` always sets `appliedDate = today` when the row first enters the applied funnel (L9681, L9695, L9707).
- It does **not** update `appliedDate` on subsequent status moves within the funnel.
- So `daysSince(appliedDate)` is really "days since this row first became a live application," which is what you want for Phone Screen / Interviewing — since those are chained transitions from Applied, the number collapses to the right meaning for an at-a-glance card.

Caveats (already documented in the helper source):

- A row moved directly from `New` → `Interviewing` (skipping Applied) without anyone touching `appliedDate` will fall back to `dateFound` and overstate age.
- A row where `appliedDate` was manually set to a date in the future clamps to 0.

### 2. `deriveFollowUpState(job, now?)` helper

For fe-dashboard's follow-up signal — not strictly a fe-kanban ask, but available if the card wants to surface "overdue follow-up" as an `× BORING`-style badge:

```js
{ state: "none" }                     // no followUpDate
{ state: "overdue", daysOverdue }     // followUpDate < today
{ state: "due-soon", hoursUntil }     // 0 ≤ now..followUpDate ≤ 48h
{ state: "scheduled", daysUntil }     // followUpDate > 48h
{ state: "invalid" }                  // non-empty but unparseable
```

### 3. Your client-side fallback chain still works

The chain you already wrote (`statusChangedAt` → `lastUpdatedAt` → `addedAt` → `discoveredAt` → `dateFound`) can stay — none of those fields are currently emitted, so it will always drop through to `dateFound`. If you'd rather delegate, call:

```html
<!-- index.html already loads discovery-shared-helpers.js before app.js -->
<script>
  const { days, source } = window.JobBoredDiscoveryHelpers.deriveStageAge(job);
  // days === null → render "Age unknown"
  // source === "appliedDate" → caption "N days in stage"
  // source === "dateFound" → caption "N days since discovery"
</script>
```

## If we want true `statusChangedAt` later

Two non-breaking options worth a follow-up run (not this one):

1. **Optional column U** (`Status Changed At`). Mark as `optionalColumn: true` in the schema, teach `parsePipelineCSV` to read it, teach `updateJobStatus` / `getStatusSideEffects` to write it, and document it in `AGENT_CONTRACT.md` + `docs/CONTRACT-CHANGELOG.md`. Existing sheets keep working because the column is optional.
2. **Client-side transition log in IndexedDB.** No sheet change. `updateJobStatus` records `{ rowKey, status, changedAt }` locally. Loses state across devices but is zero-infra.

For this run, neither is in scope (see `be-data-deploy.md` — "Preserve Pipeline sheet column order and enums").

## Follow-up after fe-kanban landed (2026-04-24)

fe-kanban has shipped with an inline chain `statusChangedAt → lastUpdatedAt → addedAt → discoveredAt → dateFound` (see their completion report, Known Risk #1). That works, and none of the first four fields are currently emitted so it reduces to `dateFound` today — identical to our helper's `dateFound` fallback.

**Drop-in swap available, no behavior change:**

```js
// replaces the inline fallback in renderKanbanCard / getKanbanStageAgeDays
const { days, source } = window.JobBoredDiscoveryHelpers.deriveStageAge(job);
```

Semantic delta vs the inline chain: for rows in `Applied`/`Phone Screen`/`Interviewing`/`Offer` the helper prefers `appliedDate` (col N) over `dateFound` (col A). That lifts Known Risk #1 for the common case — a row discovered 40 days ago and moved to Interviewing yesterday will read as its days-since-applied instead of 40, and the live-pulse dot threshold (≤ 2 days) fires correctly. The helper also returns a `source` tag so the card can pick its caption ("in stage" vs "since discovery") instead of guessing.

If fe-kanban consumes the helper, the Known Risk #1 wording can soften from "misleading until `statusChangedAt` lands" to "approximated via `appliedDate` for the Applied funnel; falls back to `dateFound` for pre-application stages." Non-blocking; flagged here so the next fe-kanban pass can pick it up.
