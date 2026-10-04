# Lane BE: server substrate for Scribe repairs (R0, R1/R2 server, F2 gate, real PDF gate)

Read `KICKOFF-SCRP-_SHARED.md` (ground rules and silent traps) and `SPEC-SCRP-20261003.md` §0, §2 and §3 (your fence and the frozen contracts) in `docs/programs/scribe-polish-20261003/`. §0 overrides this file. Also read the plan, `source-evidence/SOL-REPAIR-PLAN.md`, sections R0, R1, R2 and F2 (the server parts). Other lanes running now: FE on `scribe-v2*.js` and its tests, the hermetic harness and the journey specs; UX on `scribe-v2.css` and the visual spec; QA (Astra) read-only.

Goal: make the server edit service terminal-safe, recoverable and truthful (R0, then the server halves of R1 and R2), add the F2 manual open-proposal gate, and add a real-PDF save gate.

Success means:
- **R0 / RISK-01 (first, committed alone):** a winning Stop stays `partial` in memory, on disk and over SSE, with exactly one terminal `done`. The work follows PLAN §R0 and SPEC §3 C6: a synchronous `claimTerminal` from `pending`, a recheck after every awaited boundary, a serialized per-proposal snapshot and event queue, deep-clone at enqueue, opIds deduplicated, and reject never resurrecting a file. Deterministic barrier tests use the optional `persistProposal` dependency and a non-awaited transition observer, with deferred promises and no sleeps. Release the held writer *before* awaiting Stop. Run gate E (20 runs) after R0, logged separately, and record the count.
- **R1 server:** `GET /api/applications/:slug/edits/open` exactly per SPEC §3 C1, covering projection and exclusions, survival across a service restart (a new service instance over the same dir), sibling doc, `multiple_open_proposals`, and path/auth inheritance. No side effects. The role gate is unchanged.
- **R2 server:** the C2 rebase payload on the single stale-base retry (exact listing/model/nodes/preview for `rebasedTo`; a second move is 409). C3: verify that accept, manual and restore all emit the committed-503 shape with a valid `run.runId` and stale PDF, and fix any endpoint that does not. C4: `proposeEdits` distinguishes `provider_failed`, `unreadable_reply` and `invalid_model`, with safe messages and no raw payloads. Keep the blocked-empty retry semantics and the advisory fact-check fallback.
- **F2 gate:** manual writes return 409 `materials_pending` when the role has a persisted open proposal (C5), and keep CAS `stale_base` and the fact gates.
- **F gate:** a new `tests/e2e-journey/scribe-pdf-save.spec.mjs` uses the **real** installed-browser PDF dependency, not the fixture `pdfSession`. For each document it saves an allowed fictional edit, reads the generated PDF back, and checks the changed text, embedded fonts, page count and that the sibling artifact is unchanged. It also injects a browser failure and asserts saved HTML with the stale-PDF note. If the real dependency cannot run in your sandbox, still write the spec so it skips with an explicit reason only when the browser binary is absent. Record the run as unavailable in §5 (the host runs it).
- `docs/CONTRACT-CHANGELOG.md` gets a dated entry for C1–C5, with the exact emitted `doc` value and the error codes.
- Floor: gates A, D and E (SPEC §6) plus the new F spec, output pasted in LANE-REPORT §4.
- Report first line `DONE` | `BLOCKED: <why>` | `DONE (uncommitted — sandbox)`.

Stop when: the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)
- `server/materials-versions.mjs`: R0 terminal ownership and ordered persistence, the GET open route and service method, the rebase payload, the committed-503 consistency, the manual open-proposal guard.
- `server/materials-edit.mjs`: the `proposeEdits` error classification.
- `server/materials-writer.mjs`: only the `WriterJsonError` / `callJsonStage` classification surface, if needed.
- `schemas/materials-edit-op.v1.schema.json`: only if F2 provably needs it (it probably does not).
- `tests/integration/materials-edit-api.test.mjs`: new tests named `SCRP-B<n> …`, inserted next to the related existing tests, never at the file tail.
- `tests/materials-edit.test.mjs`, `tests/materials-edit-commit.test.mjs`: `SCRP-B<n>` cases for classification.
- `tests/e2e-journey/scribe-pdf-save.spec.mjs` (new).
- `docs/CONTRACT-CHANGELOG.md`.

Do NOT touch: `scribe-v2*.js`, `scribe-v2.css`, `tests/scribe-v2-*`, `tests/e2e-fixtures/hermetic-harness.mjs`, `tests/e2e-journey/scribe-edit-journey.spec.mjs`, `tests/e2e-journey/scribe-v2-desk.spec.mjs`, `server/index.mjs` (the routes mount in `registerMaterialsEditRoutes`). If you need a harness change for the F spec, use your own fixture inside the new spec file.

## Order and handoff points
1. R0 and its tests, then gate A and E → commit `fix(scribe): R0 …`. Write `R0 committed <sha>` into report §3 immediately; the host merges R0 early.
2. GET open (C1) → commit. Note the sha in §3 (FE consumes it).
3. Rebase payload (C2) and committed-503 consistency (C3) → commit.
4. Error classification (C4) → commit.
5. Manual gate (C5) → commit.
6. F spec → commit. CONTRACT-CHANGELOG → commit.

## Non-negotiables
- The one-open-proposal-per-role gate, stale CAS, publication claims, append-only runs, sibling equality, fact novelty, `confirmUnverified`, featured employer 2–5 bullets, statement 20–55 words, letter 3–4 paragraphs and the existing five-bullet and legacy two-paragraph tests all stay green and unchanged.
- The strict Stop test assertion (around line 386–417) is preserved verbatim; you add stricter deterministic tests beside it.
- No raw provider payloads, headers, paths or stacks in any response body or log line.
- `persistProposal` defaults to the current atomic `writeJson`, and the observer is test-only and never awaited.

## Definition of Done
```
export JOBBORED_PROFILE_PATH=$PWD/.lane-evidence/scrp-env/profile.json JOBBORED_LLM_CONFIG_PATH=$PWD/.lane-evidence/scrp-env/llm.json
# A
node --test tests/materials-nodes.test.mjs tests/materials-edit.test.mjs tests/materials-edit-factcheck-model.test.mjs tests/materials-edit-commit.test.mjs tests/materials-pipeline.test.mjs tests/integration/materials-edit-api.test.mjs
# E (20x, count passes)
for i in $(seq 1 20); do node --test --test-name-pattern='service SSE emits blocked shape and Stop retains validated partial ops' tests/integration/materials-edit-api.test.mjs > .lane-evidence/E-run-$i.log 2>&1; echo "run $i exit $?"; done
# D
npm run test:materials-contract && npm run lint:repo && npm run typecheck:server && npm run test:contract:all
# F
npx playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-pdf-save.spec.mjs --output .lane-evidence/be-pdf
git add <fence paths>; gitleaks protect --staged --redact
```
Section `SCRP-B` covers these claims, each of which goes red first and then green:
- held-measuring Stop leaves a persisted partial, and `doneStatuses` is exactly `[partial]`
- opIds are unique
- an exception in processing after Stop preserves the partial
- repeated Stop and a reconnect agree
- reject with queued writes does not resurrect the file
- GET open: projection, exclusions, restart, sibling, multiple
- the rebase payload is exact, and a second move is 409
- committed 503 on accept, manual and restore, while an ordinary 503 stays ordinary
- the three error codes
- the manual 409 `materials_pending`

All green, pasted in §4, first line `DONE`. Commit locally, never push.

## AMENDMENTS after the plan check (these override anything above)

Read SPEC §3A and `reports/VERDICT-SCRP-PLAN.md` findings 1–17, 18, 28, 31, 34, 44 and 48.

1. **Drop C2.** The rebase is a client contract, so there is no server rebase payload.
2. **New file, owned by you:** `tests/e2e-fixtures/scribe-real-service.mjs`.
   - It runs express plus `registerMaterialsEditRoutes` over a temp root on an **ephemeral** port.
   - It has injectable `propose`, `commit` and `pdfSession`, and a deferred-start knob (to hold POST /edits for ASTRA-02).
   - It seeds a fictional package (Alex Example / Acme) with both docs.
   - Export a small API so Playwright specs can start, stop and seed it, and point the page's materials base at it.
   - Commit it **immediately after R0** and write `FIXTURE committed <sha>` in report §3. FE and QA consume it.
3. **Order is now:** R0 → fixture → C1 (+C1b reprocess reset) → C3 (restore `n`/`versions`, `retryable:false` on all committed-503 bodies, rendered-doc-only PDF removal so the sibling PDF survives) → C4/C4b (classification + fixed safe SSE messages + mapping table) → C5 → F spec → CONTRACT-CHANGELOG. Write `<STEP> committed <sha>` in report §3 after each commit. The host merges each step and tells FE.
4. **Red-first scope (#44):** accept and manual 503 are already green, so the red-first claims are restore `n`/`versions`, `retryable:false`, and sibling-PDF survival. R0's red must be the strict `doneStatuses` assertion showing `[partial, ready]`.
5. **GET open is read-only.**
   - No `sweep`, no mkdir. Expired rows count as absent. A missing folder is tolerated.
   - It honors `pending.json` (add the route to the existing pending-table test at itest ~625-636).
   - Its 409 `multiple_open_proposals` is written with `res.status(409).json(...)`.
   - `blocked` is derived from `events`. Never project `events`, `targetPages` or `chips`.
6. **SSE `error` messages are fixed per-code strings.** Never send the raw `error.message`, paths or stacks.
7. **F spec** asserts API, disk and PDF only: changed text in the PDF, fonts **embedded** (not font names), page count, and the sibling PDF unchanged. For the fault case it checks the QA record line `PDF stale: browser unavailable.` and does not assert UI copy. Skip only with an explicit reason when the browser binary is absent.
8. **Gate D is `npm run test:materials-contract && npm run lint:repo && npm run typecheck:repo && npm run test:contract:all`.** Every paste must show `skipped 0`. A sandbox-skipped socket test is "not run": paste it in §5.
