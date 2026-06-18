# Design — Pipeline write-seam (local-first)

**Date:** 2026-06-18
**Status:** draft for review
**Scope:** Build #1 of the "close the back-of-funnel loop" effort. A single, contract-defined message that lets an external agent write pipeline progressions into JobBored's pipeline, so the agent stops maintaining a parallel tracker.

---

## Context

JobBored is a front-of-funnel command center: discover → score → draft materials → apply, backed by a user-owned Google Sheet (`Pipeline` tab = source of truth). Once a job is applied to, the product goes dark — interview progression, recruiter replies, and follow-ups are tracked outside it.

Today the user supplements JobBored with a Claude scheduled-task agent. Its `job-opportunity-watcher` sweeps Gmail hourly, classifies recruiter/ATS mail, and maintains its **own** `job-opportunity-tracker` artifact — a second pipeline, disconnected from JobBored's. Two sources of truth drift apart.

The root cause is that JobBored exposes no programmatic way to update a pipeline row. This spec adds that one capability: **the seam**.

## Goal

Let an external agent post a pipeline progression to JobBored and have the matching `Pipeline` row update (and the dashboard card move), through a defined, authenticated, idempotent message — running entirely local-first.

## In scope

1. **A `pipeline-update` message** — upsert one pipeline row by job identity, carrying: `stage`, `lastContact`, `note`, `contact`, `didTheyReply`.
2. **An endpoint that receives it** — a new `mode` on the existing discovery worker webhook, reusing its auth, envelope, and the existing Sheets writer.
3. **Contract artifacts** — schema, example fixture, `AGENT_CONTRACT.md` entry, `CONTRACT-CHANGELOG.md` note, and a contract test (the repo is contract-gated).
4. **Agent-side wiring (config, not repo)** — the watcher's prompt gains a step that POSTs a `pipeline-update` whenever it records a new development.

## Out of scope (deferred)

- The **read/dedupe** endpoint (`GET pipeline` for the scan) — fast-follow, same contract surface.
- Interview cockpit (`prep`) and `debrief` capture as product features.
- Consolidating `tailor`/materials into the product; retiring the scan.
- **Hosted / multi-tenant auth.** Local-first only. Each user runs their own worker against their own Sheet, BYO agent.
- Productizing Gmail sensing inside JobBored (stays in the BYO agent — OAuth/CASA wall).

## Architecture

```
[ BYO agent: watcher ]                         (Gmail sensing stays here)
        │  POST mode:"pipeline-update"  (x-discovery-secret)
        ▼
[ discovery worker @ 127.0.0.1:8644 ]          (already runs locally per user)
   handle-discovery-profile.ts  ── new mode ──►  pipeline-writer.ts (update path)
        │                                              │
        ▼                                              ▼
   {ok:true, updated:true, ...}                  Google Sheet — Pipeline tab (one source of truth)
                                                       ▲
                                                       │  read (existing OAuth)
                                                [ JobBored dashboard UI: card moves ]
```

The seam lives on the **discovery worker**, not net-new infrastructure. It reuses:

- `integrations/browser-use-discovery/src/webhook/handle-discovery-profile.ts` — the `mode`-based envelope, `x-discovery-secret` auth, and `{ok, message}` error shape (the same pattern `manual`/`refresh`/`skip_company`/`status`/`schedule-save` already follow).
- `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts` — the security order invariant (method → secret → parse → validate → side effect).
- `integrations/browser-use-discovery/src/sheets/pipeline-writer.ts` — already does header validation, dedupe by job URL, and **append/update** writes. The row-update path largely exists; this build calls it with progression fields.
- `schemas/pipeline-row.v1.json` — the authoritative `Pipeline` row shape and `status` enum, reused to validate `stage`.

## The contract

### Request — `mode: "pipeline-update"` on `POST /discovery-profile`

```json
{
  "event": "discovery.profile.request",
  "schemaVersion": 1,
  "mode": "pipeline-update",
  "sheetId": "<required>",
  "job": {
    "url": "<job posting URL — primary identity key>",
    "company": "<fallback identity>",
    "title": "<fallback identity>"
  },
  "fields": {
    "stage": "Interview",
    "lastContact": "2026-06-18",
    "note": "recruiter replied; draft ready",
    "contact": "Jane Doe <jane@acme.com>",
    "didTheyReply": "Y"
  }
}
```

### Identity & matching

- Match the target row by `job.url` first (mirrors pipeline-writer's existing dedupe-by-URL).
- Fall back to `company` + `title` when `url` is absent.
- No match found → the worker returns `{ok:false, message:"no matching pipeline row"}` with `404`. (Build #1 updates existing rows only; creating rows from progressions is deferred — discovery already creates rows.)

### Field semantics

- **Scalar fields** (`stage`, `lastContact`, `contact`, `didTheyReply`) — set/overwrite. Naturally idempotent.
- **`note`** — append a dated entry, deduped by exact (date + text), so a re-POST of the same development adds nothing.
- **`stage`** — must be a valid value from the `Pipeline` `status` enum in `schemas/pipeline-row.v1.json`. Invalid → `400`.

### Response

```json
{ "ok": true, "updated": true, "matchedBy": "url", "row": 14 }
```

Errors mirror existing `handle-discovery-profile` handling: `{ok:false, message, detail?}` with `400` (validation), `401` (bad/missing secret), `404` (no matching row).

### Validation rules (worker enforces)

- `sheetId` — non-empty string. Required.
- `job` — requires `url`, or both `company` and `title`.
- `fields` — at least one allowed field present; unknown keys rejected.
- `stage` — within the pipeline status enum when present.

## Auth (local-first)

- Same `x-discovery-secret` header the worker already uses; the agent holds the secret the user already configured.
- The worker writes to the Sheet with its locally stored Google credential — exactly as it does for discovery runs today. No new token flow, no hosting, no OAuth wall.

## Agent-side wiring (lives in the user's agent, not the repo)

The watcher's prompt (`~/Documents/Claude/Scheduled/job-opportunity-watcher/SKILL.md`) gains one step: after it records a new development in its tracker, POST a `pipeline-update` to `http://127.0.0.1:8644/discovery-profile` with the secret. Everything else the watcher does — Gmail sweep, classification, drafting replies (never send) — is unchanged. (The repo ships an example payload + a short "drive the seam from your agent" doc; the user's reference agent is the one driving it.)

## Success criteria

- With the worker running against a test `sheetId`, a `pipeline-update` for "Acme → Interview, note X" updates the matching row (stage set, dated note appended) and returns `{ok:true, updated:true}`.
- Re-posting the identical update is idempotent: scalar fields unchanged, no duplicate note.
- Missing/invalid secret → `401`; unknown field or bad `stage` → `400`; no matching row → `404` — each with a helpful `message`.
- `npm run test:contract` passes with the new schema + fixture.

## Testing

Following the repo's contract invariants (`AGENTS.md`):

- **Schema:** `schemas/pipeline-update-request.v1.schema.json` (new), referenced from `AGENT_CONTRACT.md`.
- **Fixtures:** `examples/pipeline-update-request.v1*.json` (happy path + an invalid-stage case).
- **Worker tests:** `integrations/browser-use-discovery/tests/webhook/handle-pipeline-update.test.ts` — happy-path upsert, idempotent re-post, `401`/`400`/`404` paths, note-append dedupe.
- **Contract test:** extend `npm run test:contract` to validate the new schema/fixtures alignment.
- **Changelog:** add the message to `docs/CONTRACT-CHANGELOG.md`.

## Open questions / decisions

1. **Note-append dedupe key** — proposed (date + exact text). Confirm that matches how the watcher phrases notes, or relax to "skip if last note identical."
2. **Endpoint shape** — proposed as a `mode` on `/discovery-profile` (maximally consistent with existing modes). Alternative: a dedicated `POST /pipeline/update` route. Recommend the mode for consistency.
3. **`stage` vocabulary** — reuse the `Pipeline` status enum verbatim. The watcher tracks a multi-stage interview flow that is likely finer-grained than the sheet's `status` enum; confirm the watcher's stage names and add a small mapping table if they don't align 1:1. (Exact stage names to be read from the watcher prompt + `schemas/pipeline-row.v1.json` during planning.)
```
