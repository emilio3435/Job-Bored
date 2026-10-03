# Lane FE: Scribe editor client (R1/R2 client, F1 selection scope, F2 manual edit, copy)

Read `KICKOFF-SCRP-_SHARED.md` (ground rules and silent traps) and `SPEC-SCRP-20261003.md` §0, §2, §3, §4 and §5 in `docs/programs/scribe-polish-20261003/`. §0 overrides this file. Also read `source-evidence/SOL-REPAIR-PLAN.md` (sections R1, R2, F1, F2, client parts), `source-evidence/ASTRA-FINDINGS.md` (ASTRA-01..05, GAP-01/02) and `COPY-BRIEF.md`.

Other lanes running now:
- BE on `server/materials-*.mjs` and the integration/edit tests. It lands R0 first, then the GET open route (C1), rebase payload (C2), 503 consistency (C3), error codes (C4) and manual gate (C5).
- UX on `scribe-v2.css` and the visual spec.
- QA (Astra), read-only.

You are the **only** writer of the editor JS.

Goal: make every open proposal recoverable, every outcome truthful, and every request scoped, then add direct manual block editing and the copy brief, for both the résumé and the cover letter.

## Success means

The work is serial inside this lane, committing after each step.

**R1 client (ASTRA-01, ASTRA-02):**
- Add `api.getOpenEdit(slug)` per C1, with a stub answer only when stub mode is selected.
- On open, load, doc switch and 409 `materials_pending`, read the role's open proposal:
  - Same doc: recover it on its exact base (preview, model and nodes), then rebuild the validated marks after the iframe load.
  - Sibling doc: show the recover banner (§4 `.scribe__recover`) with **Review**/**Discard**.
  - Pending: offer **Continue**/**Stop**.
  - Stale base: offer **Discard**/**Load current**, and keep Save CAS-protected.
- Guard Send before replacing the proposal or clearing the composer. A second request while one is open keeps the first proposal and the typed text, and sends no POST.
- Close and switch never save or delete.
- Discard awaits DELETE. If it fails, keep the controls and say the changes are still open. On 404, recheck the open proposal.
- Hold a request object (`doc`, `baseRunId`, `proposalId`, `stopRequested`, `detached`, `generation`) apart from `state.proposal`.
- Stop before the ID arrives sets the intent and shows Stopping…. A late start response calls `stopEdit(id)` before anything reports finished, including after close, switch or a new editor.
- A generation guard stops late POST or SSE callbacks from mutating the next doc or editor.

**R2 client (ASTRA-03, ASTRA-04, ASTRA-05):**
- Committed 503 per C3 on accept, manual and restore resolves `textSaved:true`. Then:
  - clear the proposal, marks and autosave
  - emit `jb:scribe:saved` once
  - reload history and preview
  - remove Save
  - show "Text saved as vN. PDF unavailable." with **Refresh availability**, which re-reads versions/manifest and never re-accepts
- An ordinary 503 still fails.
- Install the exact rebased base from C2 with an exact-base helper that does **not** reuse the destructive `loadDoc`. Await the iframe load before the stream and the marks. The header, version list, diff baseline and word counts all come from the same run. A base-load failure keeps the ID and the recovery controls.
- `errorFrom` per C4: message → error → per-code copy → fallback, bounded and rendered as textContent, with status, code and fix kept. Known codes get their COPY-BRIEF action.

**F1 / GAP-02 (selection scope):** follow PLAN §F1.
- Parent-installed `selectionchange`/focus/pointer listeners go on `iframe.contentDocument` after each load and are removed on unload or close.
- Resolve node IDs only from the server node map: `data-node` intersected with the current-doc nodes.
- Show the `.scribe__scope` pill and the `.scribe__selection-actions` popover (Rewrite/Shorten/Emphasize/Ask/Edit text), which is keyboard reachable with Escape/Tab.
- Send `scope:[ids]`. A substring selects its containing block. An invalid or stale selection says "Select the text again" and never silently goes to the whole document. A locked block shows the lock.
- Changes of run, base, history or template reset the scope and disclose it.
- Historical and compare views are read-only.

**F2 / GAP-01 (manual edit):** follow PLAN §F2.
- Entry points are double-click or Edit text on an eligible block. Editing is plain text and enforced by the parent on paste/beforeinput.
- Identity, the whole locked title, credentials and hidden fields are excluded. Protect metric spans in UTF-16.
- Blur plus a 2 s debounce batches the unique-node replacements against one base into **one** `POST …/edits/manual`. Unchanged text makes zero runs.
- Show `.scribe__manual-state` (Saving/Saved/error/conflict/confirm). Keep the local draft on any failure. A new fact needs explicit confirmation, and a locked fact stays blocked. A stale draft is kept and needs an explicit Reapply.
- Manual editing pauses while an AI proposal or save is open.
- Unsaved navigation shows **Save/Discard/Stay** (`.scribe__unsaved`). Drafts live in controller memory only (D8).

**Copy:** apply COPY-BRIEF.md and list each changed string (before → after) in report §3. Never remove a lock, warning or provenance line.

**Maintained tests**, all named `SCRP-F<n> …`:
- unit tests in `tests/scribe-v2-*.test.mjs`, plus the new `tests/scribe-v2-selection.test.mjs` and `tests/scribe-v2-manual.test.mjs`
- browser regressions in `scribe-edit-journey.spec.mjs` and `scribe-v2-desk.spec.mjs`, run against the **real service through the hermetic harness**, for both docs:
  - close/reopen, switch and resubmit recovery
  - early Stop with a deferred POST
  - committed 503
  - stale rebase redlines
  - provider/unreadable/template messages
  - selection payload `b:acme:c14` / `p:p3`
  - one manual version after the debounce
- the CSP smoke spec updated for the parent-installed handlers

Migrate the scenarios of the baseline probes in `/Users/emilionunezgarcia/Job-Bored/.worktrees/scribe-editor-fix/.lane-evidence/editor-qa-20261003/probe-*.mjs`. Do not copy those files.

**Floor:** gates A, B (with the new files), C, the CSP smoke and D (SPEC §6), output pasted in LANE-REPORT §4.

**Report first line:** `DONE`, `BLOCKED: <why>`, or `DONE (uncommitted — sandbox)`.

Stop when: the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)
- `scribe-v2.js`, `scribe-v2-api.js`, `scribe-v2-versions.js`, `scribe-v2-diff.js`
- `tests/scribe-v2-*.test.mjs` (existing and new)
- `tests/e2e-journey/scribe-edit-journey.spec.mjs`, `tests/e2e-journey/scribe-v2-desk.spec.mjs`
- `tests/e2e-fixtures/hermetic-harness.mjs`: the Scribe edit-route stubs only (add `GET /edits/open`; match C1–C5)
- `tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs`
- `role-materials.js` and `materials-score.js`: only if an integration defect on the Edit / Fix this / Apply / Repair entry path needs it, in the smallest change; name it in report §3

Do NOT touch: `server/**`, `scribe-v2.css`, `tests/e2e-visual/**`, `tests/integration/**`, `index.html` load order. If you need a CSS class styled, add it to the DOM per SPEC §4 and list it in report §3. UX styles it.

## Consumes
- BE's commits, by the SHAs written in `/Users/emilionunezgarcia/Job-Bored.worktrees/scrp-be/.lane-evidence/LANE-REPORT-BE.md` §3. Start R1 at once against the C1–C5 shapes, using harness stubs.
- When the host tells you the integration branch has BE's GET open route (or when `git log feat/scribe-polish-20261003 --oneline | grep -i 'open'` shows it), run `git merge feat/scribe-polish-20261003` and switch your browser regressions to the real route. Never cherry-pick BE files by hand.

## Non-negotiables
- One open proposal per role. Stale CAS on accept, manual and restore. No auto-rebase on accept. No implicit save or delete on navigation.
- IDs come from the server node map only, never from text, order or labels. The iframe stays scriptless (`allow-same-origin`, no `allow-scripts`) and the CSP stays unchanged.
- Global scripts and their load order are unchanged. No framework. User document wording is never rewritten by UI code.
- Keep `/`, Shift+Enter, Escape, J/K/A/R/D/C, focus return, 44px touch targets at 375px, and no sideways scroll.

## Definition of Done
```
export JOBBORED_PROFILE_PATH=$PWD/.lane-evidence/scrp-env/profile.json JOBBORED_LLM_CONFIG_PATH=$PWD/.lane-evidence/scrp-env/llm.json
node --test tests/materials-nodes.test.mjs tests/materials-edit.test.mjs tests/materials-edit-factcheck-model.test.mjs tests/materials-edit-commit.test.mjs tests/materials-pipeline.test.mjs tests/integration/materials-edit-api.test.mjs
node --test tests/scribe-v2-api.test.mjs tests/scribe-v2-lifecycle.test.mjs tests/scribe-v2-carryover.test.mjs tests/scribe-v2-keyboard.test.mjs tests/scribe-v2-diff.test.mjs tests/scribe-v2-versions.test.mjs tests/scribe-v2-selection.test.mjs tests/scribe-v2-manual.test.mjs
npx playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-edit-journey.spec.mjs tests/e2e-journey/scribe-v2-desk.spec.mjs --output .lane-evidence/fe-pw
npx playwright test --config tests/e2e-smoke/playwright.config.mjs tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs --output .lane-evidence/fe-csp
npm run lint:repo && npm run typecheck:repo
git add <fence paths>; gitleaks protect --staged --redact
```

Section `SCRP-F` covers these claims. Each goes red first, then green, for both docs:
- the six recovery combinations
- the deferred-start × Stop/close/switch/new editor cases, where stale callbacks cannot mutate the next doc
- failed discard keeps the controls
- the committed 503 is reported exactly once
- an ordinary 503 still fails
- the exact rebase happens before the marks
- the three safe error messages
- selection payloads and the stale-selection refusal
- one manual version, plus the locked, new-fact, stale and paste cases

All green, pasted in §4, first line `DONE`. Commit locally, never push.
