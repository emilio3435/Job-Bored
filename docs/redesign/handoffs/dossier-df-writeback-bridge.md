# dossier-df-writeback-bridge lane — handoff

**Run ID:** `dossier-df-20260519T2030Z`
**Worktree:** `../Job-Bored-wt-dossier-df-writeback`
**Branch:** `dossier-df/writeback` (off `feat/flowing-page`)
**Model:** GPT-5.5, xhigh reasoning
**Contract source of truth:** `AGENT_CONTRACT.md` (dossier event family addendum)

## Goal

Bridge the new `jb:role:writeback` event family to the existing Google Sheet column-write layer. The Workshop emits the events; you translate each `field` into the right sheet update by reusing existing helpers in `app.js` and `flowing-writes.js`.

## Owns (exclusive)

### flowing-writes.js — primary edit zone
Add a single new event listener block at module scope:

```js
window.addEventListener("jb:role:writeback", (e) => {
  const { jobKey, field, value } = e?.detail || {};
  if (!jobKey || !field) return;
  switch (field) {
    case "stage":       return writeStage(jobKey, value);
    case "heardBack":   return writeHeardBack(jobKey, value);
    case "reply":       return writeReply(jobKey, value);
    case "followupAt":  return writeFollowup(jobKey, value);
    case "passed":      return writePassed(jobKey, value);
    default:
      console.warn("[writeback-bridge] unknown field", field);
  }
});
```

The `write*` functions must reuse whatever sheet-write path the legacy drawer already uses for these columns. Grep `app.js` for the existing handlers:
- `stage` — already handled today via `jb:pipeline:move`; this case may simply re-dispatch as `jb:pipeline:move { jobKey, toStage: value }` rather than duplicate logic.
- `heardBack`, `reply`, `followupAt`, `passed` — search `app.js` `attachCardListeners` for `.followup-*`, `.heard-back*`, `.reply*` selectors. The existing column-write helpers are in there. Either call them directly (preferred) or replicate their column index + value logic.

If a helper doesn't exist for a given field today, build the minimum sheet-write needed by mirroring `writeNote`'s pattern (look at how `jb:role:note` is bridged today).

### app.js — only if needed
If any column-write logic is too tightly tied to DOM event handlers to call from `flowing-writes.js`, extract a pure function `writeColumn(jobKey, columnName, value)` from the existing handler and export it via `window.JobBoredApp.writeColumn`. Keep this extraction minimal.

### New test
- `tests/role-writeback-bridge.test.mjs` — asserts each of the five fields produces the expected sheet write call. Mock the sheet writer at the module boundary.

## Do NOT touch

- `role.js`, `role-brief.js`, `role-workshop.js`, `role.css`.
- `atsScorecardState` and surrounding code in `app.js` (ats-state-bus lane).
- Any test outside `tests/role-writeback-bridge.test.mjs`.

## Event contract (frozen)

```
jb:role:writeback { jobKey, field, value }
  field ∈ { "stage" | "heardBack" | "reply" | "followupAt" | "passed" }
  value:
    - field=stage       → stage key string ("researching" | "applied" | "phone-screen" | "interviewing" | "offer")
    - field=heardBack   → ISO date string (today by emitter convention)
    - field=reply       → ISO date string
    - field=followupAt  → ISO date string
    - field=passed      → boolean
```

## Preserve (do not break)

- `jb:pipeline:move`, `jb:role:note`, `jb:role:action` — all existing bridges stay as-is.
- Sheet write-back selectors in `attachCardListeners` (pipeline cards) — keep them working.
- The column-index assumptions in `schemas/pipeline-row.v1.json`. If a field maps to a column that isn't in the schema, stop and write a note in the Completion Report; do not invent columns.

## Verification

```bash
node --check flowing-writes.js app.js
npm test -- tests/role-writeback-bridge.test.mjs
# Manual smoke after Workshop lane is merged:
npm start
# Open a role, click each Workshop chip, watch the Network tab for the Sheets PATCH.
# Confirm the Pipeline sheet row updates in the expected column.
```

## Status file

Write to `docs/redesign/status/dossier-df-writeback-bridge.json` matching the schema in `docs/redesign/status/README.md`.

## Completion report (fill in at the end)

- **Commit SHA(s):** `fa7bba53116db3fe7ffa03a98f07d9e7e2748c71`
- **Files changed:** `flowing-writes.js`, `tests/role-writeback-bridge.test.mjs`
- **Field → column mapping confirmed:**
  - stage → Status, column M (`Pipeline!M{row}`)
  - heardBack → Last contact, column R (`Pipeline!R{row}`)
  - reply → Did they reply?, column S (`Pipeline!S{row}`, writes existing enum value `Yes`)
  - followupAt → Follow-up Date, column P (`Pipeline!P{row}`)
  - passed → Status, column M (`Pipeline!M{row}`, writes existing enum value `Passed`)
- **Existing helpers reused vs new ones written:** Reused `flowing-writes.js` row resolution, Sheets PUT path, `moveStage`, and write success/failure events. Added minimal `writeColumn` plus field-specific wrappers and one `window` listener for `jb:role:writeback`. No `app.js` extraction needed.
- **Tests run + results:**
  - `node --check flowing-writes.js app.js` — passed
  - `npm test -- tests/role-writeback-bridge.test.mjs` — passed (5 tests)
- **Schema impact (if any):** None. All write-back fields map to existing `schemas/pipeline-row.v1.json` columns; no schema update needed.
- **Known risks:** Manual browser smoke is deferred until the Workshop lane is merged. `reply` preserves the column S enum by writing `Yes`; the ISO event value is not persisted separately. `passed=false` is a no-op because there is no contract-safe prior stage to restore.
