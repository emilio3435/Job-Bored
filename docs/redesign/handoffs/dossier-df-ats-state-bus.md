# dossier-df-ats-state-bus lane — handoff

**Run ID:** `dossier-df-20260519T2030Z`
**Worktree:** `../Job-Bored-wt-dossier-df-ats-bus`
**Branch:** `dossier-df/ats-bus` (off `feat/flowing-page`)
**Model:** GPT-5.5, xhigh reasoning
**Contract source of truth:** `AGENT_CONTRACT.md` (the dossier event family addendum)

## Goal

Make `atsScorecardState` (currently module-private in `app.js`) observable via a small event bus. Implement the **producer side** of three new events plus the full-scorecard modal. The Workshop lane is the primary consumer.

## Owns (exclusive)

### app.js — three surgical edit zones, nothing else
1. **State mutation sites.** Today `atsScorecardState` is assigned in roughly six places in `app.js` (start at `app.js:13877` and follow). Every assignment must be wrapped so the new event fires after the mutation completes. Recommended pattern: introduce a small `setAtsScorecardState(next)` helper at the same scope and replace each `atsScorecardState = …` assignment with `setAtsScorecardState(…)`.
2. **New helpers block** placed adjacent to the existing `atsScorecardState` declaration:
   ```js
   function setAtsScorecardState(next) {
     atsScorecardState = next;
     dispatchAtsState();
   }
   function dispatchAtsState() {
     const detail = {
       jobKey: atsScorecardState.cacheKey || null,
       status: atsScorecardState.status,
       result: atsScorecardState.result || null,
       error: atsScorecardState.error || null,
     };
     window.dispatchEvent(new CustomEvent("jb:ats:state", { detail }));
     document.dispatchEvent(new CustomEvent("jb:ats:state", { detail }));
   }
   window.addEventListener("jb:ats:state:request", (e) => {
     const wantKey = e?.detail?.jobKey;
     if (!wantKey || wantKey === atsScorecardState.cacheKey) dispatchAtsState();
   });
   ```
3. **Modal handler.** Listen for `jb:ats:modal:open { jobKey }` on `window`. On fire, render the full ATS scorecard inside a modal. The full-scorecard markup already exists somewhere in `app.js` (search `atsScorecardState.result` consumers around `app.js:17820–17870`). Reuse that markup verbatim inside a new `.dossier-ats-modal` overlay. Close on Escape, click outside, or close button.

### New test
- `tests/ats-state-bus.test.mjs` — asserts:
  - `setAtsScorecardState` emits `jb:ats:state` with the right payload
  - `jb:ats:state:request` with matching jobKey re-emits the cached state
  - `jb:ats:state:request` with non-matching jobKey is a no-op
  - `jb:ats:modal:open` opens the modal element

## Do NOT touch

- Anything outside the `atsScorecardState` consumer block in `app.js`.
- `role.js`, `role-brief.js`, `role-workshop.js`, `role.css` (other lanes).
- `flowing-writes.js` (writeback-bridge lane).
- The ATS endpoint URL resolution at `app.js:5879–5888` — pure read.

## Event contract (frozen — do not change)

```
jb:ats:state          { jobKey, status, result?, error? }
jb:ats:state:request  { jobKey }
jb:ats:modal:open     { jobKey }
```

`status` values must match the existing `atsScorecardState.status` enum (`"idle" | "loading" | "success" | "error"` — confirm by grepping the file).

## Preserve (do not break)

- Existing ATS scorecard rendering inside the legacy drawer (if any callers still use it). Your changes are additive — the legacy consumer keeps working.
- The retry button at `app.js:18912` (`data-action="retry-ats-scorecard"`) — keep its handler intact.
- The `command-center.ats-scorecard` analytics event at `app.js:17489` — leave it alone.

## Verification

```bash
node --check app.js
npm test -- tests/ats-state-bus.test.mjs
# Manual smoke:
npm start
# In DevTools console after a role is opened:
#   monitorEvents(window, ["jb:ats:state", "jb:ats:state:request", "jb:ats:modal:open"]);
#   window.dispatchEvent(new CustomEvent("jb:ats:state:request", { detail: { jobKey: "<a real key>" }}));
# Expect a jb:ats:state event back if the state is cached.
```

## Status file

Write to `docs/redesign/status/dossier-df-ats-state-bus.json` matching the schema in `docs/redesign/status/README.md`.

## Completion report (fill in at the end)

- **Commit SHA(s):**
- **Files changed:** (expected: `app.js`, `tests/ats-state-bus.test.mjs`)
- **Exact line ranges edited in app.js:**
- **Helper function names introduced:**
- **Modal close paths verified (Escape / outside / button):**
- **Tests run + results:**
- **Known risks:**
