# Scribe editor repair specification and implementation plan

**Status: COMPLETE planning. Verdict: FIX-THEN-GO.** Implementation remains outside this pass.

**Goal:** restore recoverable, truthful review/saving for both document editors and specify documented selection/manual capabilities as separate follow-ups.
**Success means:** ASTRA-01..05, GAP-01..02, and RISK-01 each have a disposition, evidence/source references, minimal repair, regression cases, dependencies, exact gates, and checkable acceptance.
**Stop when:** this plan is complete and reviewable. Reached.
**Constraints:** preserve tracked product code, customer drafts, fact locks, authoritative node IDs, schema/template limits, immutable history, role-level open-proposal gate, stale CAS, document-specific current versions, and sibling documents. This pass creates report/fictional scratch only; implementation, commits, push/PR/deploy remain outside scope.

Architecture: retain vanilla JS desk/API adapter, real version service and structured-op validator, filesystem proposal/run persistence, and server-rendered sandbox preview. Repair their shared lifecycle/outcome boundaries for both docs. Tech: Node 24/npm 11, Express, Node tests and hermetic Playwright/installed Chrome.
Inputs: [program SPEC](SPEC.md), [kickoff](KICKOFF-SOL.md), [Astra findings](ASTRA-FINDINGS.md), [original locked SPEC](/Users/emilionunezgarcia/Job-Bored/.worktrees/scribe-editor-fix/docs/programs/editor-20260927/SPEC.md:328).

## Proof and source boundaries

- **Confirmed:** source HEAD `3641d33fc26e20c22c7a22c15e600ccba8a7de45`, tree `e05bc82226f7e61b5c75bb510fa07b3a70c8d117`; Astra running checkout HEAD `e0f9137fb3d99c112065053c7e0c87e8fe175a01` has identical tree. Sol rechecked HEAD/tree, empty tracked status/diff.
- **Confirmed native routing:** task metadata Sol `gpt-6.1-sol`, **high** explicit user override; program `models.lock.json` snapshot. Separate OS argv assertion is inapplicable. Parent fresh capacity 2026-10-03T05:11:20Z: weekly 1% used, ordinary usage allowed; no wall.
- **Confirmed browser/service scope:** Astra used fictional data, real validation/render/history/persistence/publication with controlled model replies. PDF/critic mocked. Four live Gemini successful saves (two per doc), sibling equal; live fault/cancel/races unknown. Sol inspected source, schemas/budgets, logs/JSONs and the [misleading letter-save screenshot](pdf-unavailable-cover_letter-not-saved.png). No counted finding disputed.
- **Confirmed current limits:** featured employer **2–5** bullets (`server/materials-fit-budget.mjs:141`, `materials-nodes.mjs:153`), statement 20–55 words, letter 3–4 paragraphs. Older SPEC 2–4 is outdated; preserve five-bullet regression. Historical memory supplied concurrency cautions, independently checked in current source; its old tests are not current proof.

## Finding-to-repair matrix

| ID / rank | Disposition; before behavior | Evidence and root boundary | Repair / after behavior |
|---|---|---|---|
| ASTRA-01 P1 | **Confirmed 6/6:** close/switch/resubmit loses client access to persisted ready proposal, blocking both docs. Role gate intentional. | Six `orphan-*.json`/stranded screenshots; [resubmit](orphan-resume-resubmit.json). `scribe-v2.js:603–611,700–746,1569–1575,1632–1637`; service`:305–313,462`. | R1 persisted recovery + send guard + explicit awaited discard. Ready/partial survives navigation; existing controls or recover action always available; second prompt preserves first proposal and composer text. |
| ASTRA-02 P1 | **Confirmed 2/2:** Stop before ID sends no stop; late POST persists pending 0-op proposal; retry 409. | [résumé](early-stop-resume.json), [letter](early-stop-cover_letter.json). `scribe-v2.js:719–741,759–777`; abort signal reaches stream only. | R1 request identity/stop intent consumes late ID and calls stop before declaring completion; lost response uses persisted recovery. No blind POST abort assumption. |
| ASTRA-03 P2 | **Confirmed 2/2 injected failure:** HTML/model/v1 saved with 503; UI says Not saved/v0; duplicate accept 409. Server matches contract. | `pdf-unavailable-*.json`; service`:374–407,582–586`; API`:416–425`; desk`:1274–1291`. | R2 narrowly recognizes committed503 for accept/manual/restore; saved-text branch clears proposal/Save, updates version/preview, emits saved; persistent PDF unavailable note. |
| ASTRA-04 P2 | **Confirmed 2/2:** API retries latest base, UI header/list/diff/word baseline stays old. Stale protection passed. | `stale-*.json`/rebase screenshots; API`:479–491`; desk`:728–733,888–906,960–964`. | R2 install exact rebased listing/model/nodes/preview and await iframe load before stream/marks; v1 header and deleted text match API base. One retry; further move 409. |
| ASTRA-05 P2 | **Confirmed ≥6/6:** HTTP safe explanation discarded. Provider/malformed reply also misleadingly reported as template invalidity. | Early-stop/stale/PDF/recovery JSON pairs. API`:404–412`; service`:635–640`; edit`:300–308`; writer`:1194–1202`; desk`:1346–1353`. | R2 bounded string message→error→fallback; retain code/status/fix and recovery action. Classify provider failure vs malformed response vs real invalid model without raw payloads. |
| GAP-01 capability | **Confirmed missing 2/2:** no direct manual editor; manual API exists. Locked D7 unmet, no broken visible control. | Original SPEC`:51–53,86,187,333`; desk frame hooks`:565–578`; `happy-*.json`, focused manual API tests. | F2 authoritative plain-text block replace → blur/2 s debounce → source manual immutable run; fact/shape/CAS checks, retained local draft on failure. |
| GAP-02 capability | **Confirmed missing 2/2:** selection exists, pill/request remains all; popover absent. | Original SPEC`:81,86`; desk`:401,723`; nodes`:65–107`; selected text/scope in `happy-*.json`. | F1 authoritative selected/focused ID array, truthful pill/actions, server scope enforcement; invalid/stale selection never silently broadens. |
| RISK-01 release gate | **Confirmed intermittent:** Astra 59/60, filtered 1/1, host 60/60. **Confirmed controlled service race:** completed partial overwritten ready, two terminal statuses. Ordinary browser incidence unknown. | Strict integration assertion`:386–417`; service`:271–275,342–361,505–525`; [Astra failure](astra-targeted-floor.log), [host floor](HOST-FOCUSED-FLOOR.txt), [Sol schedule](sol-stop-measuring-result.json), [independent host schedule](HOST-STOP-RACE-PROBE.txt). | R0 claim terminal state once, recheck after awaited measuring, ordered persistence/event snapshots; winning Stop remains partial with one done. Preserve strict test. |

## Immediate repairs and ordered implementation

### R0 — Terminal ownership and ordered persistence (first)

Goal: keep a winning Stop terminal partial in memory/disk/SSE. Success means deterministic measuring interleaving yields one partial terminal with validated ops once. Stop when strict regression and existing concurrency cases pass.

**Root:** process checks pending at354, awaits measuring write355, assigns ready359 unchecked. Stop can complete in the await; processing then overwrites it. Event writes use mutable state and separate async writes, permitting inconsistent terminal journal/delivery.
**Files:** `server/materials-versions.mjs`; `tests/integration/materials-edit-api.test.mjs`. Retain publication claims and accepting/accepted states.

- Add synchronous terminal claim from pending only; use for ready/partial/failed. Stop claims partial before extra await; repeated Stop awaits same completion. Recheck after awaited processing boundaries. A ready winner before Stop still truthfully returns existing 409 proposal_not_running.
- Serialize per-proposal snapshot writes/event delivery, including terminal batch and final housekeeping. Deep-clone at enqueue, keep handles out of persisted JSON, dedupe missing validated ops by opId. One winning summary+done; queued processing cannot overwrite partial or recreate a rejected file. Flush/coordinate accept/reject under existing claims.
- Add optional `persistProposal(path,snapshot)` service dependency, default current atomic writeJson, to create deterministic tests wrapping real disk persistence. Hold measuring write; invoke Stop; observe its synchronous partial claim with a nonawaited test-only transition observer, then release measuring before awaiting Stop/processing. The observer receives only proposal ID/from/to and resolves a separate deferred signal; its return value is ignored. Do not await a persisted partial callback while the serialized writer is blocked behind measuring, because that would deadlock. Use deferred promises, not sleeps.

```js
function claimTerminal(p, next) {
  if (p.status !== "pending") return false;
  p.status = next;
  return true;
}
// Immediately after await emit(measuring):
if (!claimTerminal(proposal, "ready")) return;
// Persist/send the winning terminal batch through the same ordered queue.
```

**Tests/acceptance:** held-measuring Stop → returned/persisted partial, doneStatuses exactly[partial], no ready; all opIds unique; process exception after Stop preserves partial; repeated Stop/reconnect agrees; reject with queued writes never resurrects file. Preserve existing line417 assertion and B2 accept/reject/stale publication regressions. **Run A**, then E after complete integration. Dependency:none.

### R1 — Persisted recovery and late-start ownership (second)

Goal: every open role proposal remains reviewable or explicitly discardable across navigation/early Stop/lost response. Success means both-doc six lifecycle combinations and deferred-start variants pass while role gate stays intact. Stop when real-service/browser proof meets acceptance.

**Files:** service, `scribe-v2-api.js`, `scribe-v2.js`; API/lifecycle/carryover/integration/journey tests; API narrative original SPEC§3.2 and `docs/CONTRACT-CHANGELOG.md`. Inherit current auth/CORS/path checks.
**Choice:** persisted recovery, because files already hold doc/base/ops/status; a module cache misses refresh/restart/lost response. Automatic navigation DELETE destroys undecided work and could discard another tab's proposal. Preserve one open proposal per role.

Add narrow read route/client method `getOpenEdit()`:

```text
GET /api/applications/:slug/edits/open
200 {proposal:null}
200 {proposal:{proposalId,doc,baseRunId,instruction,scope,lockFacts:true,createdAt,
 status:"pending"|"ready"|"partial"|"accepting",ops,blocked,summary?,factCheck?,factCheckReason?}}
```

Project safe fields only; omit paths/profile/ledger/secrets/handles. Use gate eligibility: pending/accepting or nonempty ready/partial; exclude accepted/failed/rejected/empty terminal. Read performs no reject/save/process; preserve existing start TTL. Multiple conflicting open files return explicit 409 multiple_open_proposals with safe IDs/doc/status; choose no arbitrary winner. Stub extension stays explicit opt-in; live remains default.

- Startup/load/409 materials_pending reads role state. Same-doc recover loads proposal's exact base preview/model, reconstructs validated marks after iframe ready; lost local decisions reset pending with announcement, unverified confirmation remains required. If newer version exists, show stale base; Save keeps CAS, offer Discard/Load current. Never auto-rebase acceptance.
- Sibling proposal renders “Resume/Cover letter has an unfinished request” with **Review request** (explicit switch/exact-base load) and **Discard request**. Sibling stays viewable; composer preserved, send gated. Pending recovery offers Continue (attach/replay/process if necessary) and Stop. Deduplicate replayed ops by ID. Accepting shows Save in progress; active reserved publication blocks discard; stranded accepting remains explicitly discardable under existing claim.
- Guard send before replacing proposal/clearing prompt. Retain first proposal/decisions and focus review on second prompt; send no second POST. Close/switch preserves ready/partial on disk and cancels autosave. Discard awaits DELETE; failure retains controls/ownership and says the request remains open;404 rechecks open/current state.
- Capture request doc/base/identity independently of mutable `state.proposal`. Stop before ID sets intent and shows Stopping/busy. Late start result, including closed/switched controller, records ID and calls stop before declaring finished. Detach close/switch similarly; validated partial remains recoverable. Truly lost start response recovers through read route. Generation guards prevent late POST/SSE from mutating next editor/doc.

```js
var request = {doc: st.doc, baseRunId: st.currentRunId,
  proposalId: null, stopRequested: false, detached: false};
// Stop: set request.stopRequested even before ID; preserve busy until settlement.
// Start success, even after UI teardown:
request.proposalId = res.proposalId;
if (request.stopRequested || request.detached) return ctl.api.stopEdit(res.proposalId);
// Otherwise hydrate exact request base, verify identity, attach SSE.
```

A POST fetch abort does not undo server persistence; observe late ID and stop it. Failed stop remains recoverable, not “Stopped.” Zero-op partial already does not gate retry; nonempty partial still requires review/discard.
**Tests/acceptance:** service projection/exclusions/restart/sibling/multiple opens/path/auth; role still rejects second start until explicit discard. Browser both docs×close/reopen/switch/resubmit, no implicit save/delete, restored choices require review, failed DELETE retains controls. Deferred POST×Stop/close/switch/new editor; stale callbacks cannot mutate next doc, failed stop recoverable. **Run A+B+C**, materials contract. Dependency:R0 plus exact-base hydration shared with R2.

### R2 — Truthful saved outcomes, rebase and diagnostics (third)

Goal: show actual committed state and actual proposal baseline. Success means both-doc special 503 saves, stale retry redlines, safe explanations/actions agree with service. Stop when transport/UI and real-service fault regressions pass.

**Files:** API, desk, `scribe-v2-versions.js` restore messaging, narrow `server/materials-edit.mjs` writer classification; API/carryover/versions/edit/integration/journey tests. Keep current server503 contract.

**Committed503:** allow special outcome only on accept/manual/restore calls, with status503, exact browser_unavailable code, valid nonempty runId, pdf stale, endpoint-appropriate metadata (n/versions if present). Parse once and resolve `{...body,textSaved:true,httpStatus:503}`; ordinary 503 without run still rejects. Reuse saved branch: clear proposal/marks/autosave, emit saved once, reload current history/preview, remove Save, display “Text saved as vN. PDF unavailable.” Restore appends truthful saved version; real restore failure keeps proposal unchanged.
There is no proven artifact-only recovery route/scheduler. Replace “PDF catches up” promise with **Refresh availability** (read manifest/files); PDF download stays unavailable while stale. Separate later artifact retry may render exact saved model under publication claim without reaccept/extra edit version; immediate repair does not invent that API.

**Complete rebase:** preserve one proposal-creation retry. Supply `{rebasedTo,rebase:{listing,model,nodes,preview:{html,words,pageBudget}}}` for exact listing.currentRunId. Keep attempted doc/body immutable. Desk exact-base helper preserves pending proposal, installs listing/current ID/nodes, clears old review and awaits iframe onload before SSE/replayed ops. `loadDoc` currently clears proposal, so do not reuse it destructively. Base load failure retains created ID/recovery controls. Second concurrent move returns409; no loop/accept rebase. Scoped follow-up requests whose nodes disappear require reselection, never scope all. Header, history, baseWords and deleted text derive from exact same run.

**Diagnostics:** bounded string body.message→body.error→fallback; retain status/code/safe fix, render textContent. Known states get actions: materials_pending→Review/Discard request; stale save→“A newer version exists. Changes not saved”/Review current/Discard; committed browser unavailable→Text saved/PDF unavailable/Refresh; server unreachable→Retry/local startup guidance; locked/out_of_scope/shape retain truthful guards. Objects, raw provider payloads/headers/paths/stacks stay out of UI/logs.
`callJsonStage` wraps provider/parse failure in WriterJsonError.code/.call; `proposeEdits` currently maps all to invalid_model. Separate non-parse provider error into safe editor/SSE failure, malformed/absent ops into unreadable-response wording, actual applyOps invalid_model into template explanation. Keep blocked empty safe/retry semantics and advisory token-check fallback on fact-check failure.

**Tests/acceptance:** table message/error/objects/non-JSON/fallback; special 503 accept/manual/restore positive, absent/invalid run negative, unchanged 200/409. Both-doc saved model/header v1, Save gone, one accept/saved event, sibling equality. New base same-node altered→stale reject→discard→retry: v1 header/list/exact diff and consistent words before save v2. Delay iframe load: no marks early. Base-load failure recoverable; second move409. Distinct malformed/provider/template messages, original data unchanged and retry succeeds. **Run A+B+C+D.** Dependency:R1 recovery and exact-base helper; no server contract relaxation.

## Bounded capability follow-ups (separate acceptance track)

### F1 — GAP-02 selection/focused-node scope

Goal: bind AI requests to selected/focused blocks. Success means pill, ID payload and server enforcement agree for both docs with accessible actions/scriptless preview. Stop when desktop/phone selection and rejection cases pass.
**Files:** desk/CSS, add `tests/scribe-v2-selection.test.mjs`, extend journey; reuse getModel/scope/node-ID/CSP tests. Depend on R0–R2.
Load server model/nodes with exact base. Parent-installed selectionchange/focus/pointer listeners intersect iframe data-node with authoritative current-doc map; IDs come only from server, never text/order/labels. Bind scopeIds to doc/baseRunId; parent popover Rewrite/Shorten/Emphasize/Ask fills composer and preserves IDs, Edit text enters F2. Selected substring scopes whole containing node (existing contract). Clear selection explicitly restores all; invalid/non-node selection cannot silently broaden. Locked blocks show lock; server is final authority. Rebind/tear down listeners on iframe load/close; retain sandbox allow-same-origin without allow-scripts and CSP. Run/base/history/template changes reset/disclose scope and require reselection when needed.
**Acceptance:** résumé b:acme:c14 and letter p:p3 send exact arrays; multi-block unique reading order/pill; unselected/sibling mocked op rejected with no saved change; historical/compare read-only; keyboard popup Escape/Tab,44 px controls/no sideways scroll. Test actual touch separately; desktop phone emulation is not touch hardware proof.

### F2 — GAP-01 manual block edit

Goal: satisfy locked D7 plain-text direct typing. Success means one validated manual version per debounced batch, retained draft on failure, sibling/history/facts intact. Stop when both-doc manual and conflict/fact/CSP cases pass.
**Files:** desk/CSS, manual API reuse, add `tests/scribe-v2-manual.test.mjs`, extend integration/journey. Depend on F1 entry/actions and R0–R2 state/outcomes.
Use authoritative base text, eligible block double-click/Edit text, plain-text editing installed by parent handlers in sandbox, plain-text paste/beforeinput enforcement. Start replace-only; identity/whole locked title/credentials/hidden template fields excluded. Protect metric UTF-16 spans and tokens; persist replace ops, never DOM innerHTML. Server strips/retags and rerenders.
Blur creates manual draft,2 s debounce per SPEC, batch unique-node replacements against one base; unchanged/undone text creates zero runs. UI Saving/Saved/error. Pause while AI proposal/save exists; review/discard first. Current manual route checks reserved/pending rather than persisted proposals: add role open-proposal guard for manual writes to cover second-tab ownership, preserving CAS fallback.
POST manual `{doc,baseRunId,manualOps:[{opId,op:"replace",node,text}],confirmUnverified:[opId]}`→source manual. On new-fact confirmation error retain draft and request explicit batch confirmation; keep locked facts blocked even confirmed. On stale conflict retain draft, show new base and require explicit reapply; no blind manual auto-rebase. Retry true failures with retained draft. Navigation queued/unsaved draft offers Save/Discard/Stay; forced teardown retains in session/controller memory, no background writes to another doc. Persistence beyond page refresh is a separate decision.
**Schema fences:** materials.edit-op.v1 additionalProperties false/nonempty plain text; authoritative IDs; clone/atomic applyOps; current 2–5 bullets, statement 20–55 words, letter 3–4 paragraphs; source novelty/confirmUnverified; per-document scope/publish claim; historical normalization/single-doc shells/sibling preservation. **Acceptance:** both-doc ordinary rewrite→one manualv1 after debounce, v0 retained/sibling equal; metric 38%/whole title/credential blocked; new fact unconfirmed blocked; markup paste plain; stale draft retained; special PDF503 truthful.

## Exact gates and evidence

Executed evidence below is separate from future commands. Sol read host/Astra floors, did not rerun them. No changed tests were used to turn red green.

| Executed command / artifact | Actual retained output / proof |
|---|---|
| `npx playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-edit-journey.spec.mjs tests/e2e-journey/scribe-v2-desk.spec.mjs --output .lane-evidence/editor-qa-20261003/host-playwright` | [host](HOST-BROWSER-FLOOR.txt): Running 5 tests using 1 worker;5 passed (16.0s). [Astra](astra-floor.log) same suites5 passed (16.2s). Existing cases do not cover all failures. |
| `JOBBORED_PROFILE_PATH=<program>/isolated-floor/profile.json JOBBORED_LLM_CONFIG_PATH=<program>/isolated-floor/llm.json node --test tests/materials-nodes.test.mjs tests/materials-edit.test.mjs tests/integration/materials-edit-api.test.mjs` | [Astra full](astra-targeted-floor.log): tests 60,suites 2,pass 59,fail 1,cancelled 0,skipped 0,todo 0,duration 1061.996542ms. [host full](HOST-FOCUSED-FLOOR.txt):60/60,fail/skip/todo 0,duration 1114.266917ms. `<program>` is this report folder's absolute path. |
| Same isolated env, `node --test --test-name-pattern='service SSE emits blocked shape and Stop retains validated partial ops' tests/integration/materials-edit-api.test.mjs` | [Astra filtered](astra-stop-rerun.log):1 pass,0 fail,duration 293.179708ms. Passing reruns do not clear RISK. |
| `node .lane-evidence/editor-qa-20261003/sol-stop-measuring-probe.mjs` | [Sol output](sol-stop-measuring.log), [host independent exit0](HOST-STOP-RACE-PROBE.txt): below. |

```json
{"stopReply":"partial","persistedAfterStop":"partial","persistedAfterProcess":"ready",
 "doneEvents":["partial","ready"],"operationCount":1,"modelChanged":false}
```
Schedule probe loads a **read-only source copy**, rewrites relative imports to original URLs, injects one barrier after real measuring persistence, and supplies valid fictional proposal output. It confirms an allowed service interleaving; it does not prove natural browser frequency/live-provider incidence. Product source unchanged; fixtures inside program.

Future commands: run from source worktree; name each before execution, save fresh full logs, record filtered/skipped/unavailable status. Set isolated fictional env first:

```sh
mkdir -p .lane-evidence/editor-qa-20261003/implementation-floor
export JOBBORED_PROFILE_PATH=/Users/emilionunezgarcia/Job-Bored/.worktrees/scribe-editor-fix/.lane-evidence/editor-qa-20261003/implementation-floor/profile.json
export JOBBORED_LLM_CONFIG_PATH=/Users/emilionunezgarcia/Job-Bored/.worktrees/scribe-editor-fix/.lane-evidence/editor-qa-20261003/implementation-floor/llm.json
# A: real service, node/fact/commit/publication
node --test tests/materials-nodes.test.mjs tests/materials-edit.test.mjs tests/materials-edit-factcheck-model.test.mjs tests/materials-edit-commit.test.mjs tests/materials-pipeline.test.mjs tests/integration/materials-edit-api.test.mjs
# B: shared desk/transport/history
node --test tests/scribe-v2-api.test.mjs tests/scribe-v2-lifecycle.test.mjs tests/scribe-v2-carryover.test.mjs tests/scribe-v2-keyboard.test.mjs tests/scribe-v2-diff.test.mjs tests/scribe-v2-versions.test.mjs
# C: existing suites with new real-service-backed both-doc regressions
npx playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-edit-journey.spec.mjs tests/e2e-journey/scribe-v2-desk.spec.mjs --output .lane-evidence/editor-qa-20261003/implementation-playwright
# D: contract/syntax/lint
npm run test:materials-contract
npm run lint:repo
npm run typecheck:repo
npm run test:contract:all
# E: after full A, twenty separately logged isolated runs of strict Stop diagnostic
node --test --test-name-pattern='service SSE emits blocked shape and Stop retains validated partial ops' tests/integration/materials-edit-api.test.mjs
```

Require A–D unfiltered/new regressions and 20/20 E; preserve every failure. E is justified by retained intermittent failure and supplements deterministic barriers, not universal race proof. Use current hermetic start/fence and installed Chrome; migrate dated probe scenarios into maintained tests. Old probes record baseline outcomes, so running them unchanged is not repaired acceptance.
**F actual PDF:** implementation adds `tests/e2e-journey/scribe-pdf-save.spec.mjs` that calls real installed-browser PDF dependency (not fixture pdfSession), saves allowed edit per doc, downloads/reopens PDF, checks changed text/fonts/page count/sibling, injected browser failure saved HTML/stale note and supported recovery if available. Run exact new gate when it exists; mark unavailable if dependency cannot run:

```sh
npx playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-pdf-save.spec.mjs --output .lane-evidence/editor-qa-20261003/implementation-pdf
# Capability gates, only after new tests/code exist:
node --test tests/scribe-v2-selection.test.mjs tests/scribe-v2-manual.test.mjs tests/materials-render-node-ids.test.mjs tests/materials-nodes.test.mjs tests/integration/materials-edit-api.test.mjs
npx playwright test --config tests/e2e-smoke/playwright.config.mjs tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs --output .lane-evidence/editor-qa-20261003/implementation-csp
npx playwright test --config tests/e2e-visual/playwright.config.mjs tests/e2e-visual/scribe-v2.spec.mjs --output .lane-evidence/editor-qa-20261003/implementation-visual
```

## Completion checklist and review focus

- [ ] R0 strict/deterministic/full/repeated partial gates, one terminal outcome, no reject resurrection.
- [ ] R1 six lifecycle combinations + late-start variants, persisted recovery, failed discard retained, role gate unchanged, no implicit navigation save/delete.
- [ ] R2 special 503 exactly-once saved text/history/preview, ordinary failure unchanged, exact rebase before marks, specific safe diagnostics/actions, CAS/sibling/immutable history preserved.
- [ ] A–E logs with every actual case and skipped/filtered status; F PDF proof separately labeled. Different-family diff/verification review resolved before completion claim.
- [ ] F1/F2 separately gated: authoritative scope, protected/manual facts, one manual version, retained stale draft, scriptless CSP/visual/keyboard/44 px/no-scroll proof both docs.

Five review edge classes are assigned above: closed-controller late POST/SSE (R1); stale recovery after sibling-only run (R1/R2);503invalid committed metadata (R2); Stop/reject during queued persistence (R0); locked/legacy/historical scoped/manual node (F1/F2). Include explicit regression for each; preserve existing historical/sibling/five-bullet/legacy tests.
**Unknown/unverified today:** actual PDF generation/download/fit/retry; production OAuth/Sheets/customer data/CI/full-root; live-provider faults/cancel/races; Safari/Firefox/iOS/touch/keyboard/screen-reader; every legacy/historical shape in browser; external score-modal Fix/Apply/Repair/template controls. Direct manual/selection remains unsatisfied until follow-up. Four live successful samples establish those requests, not broad model quality. This pass changed no tracked product code/test/customer data and made no commit/push/PR/deploy.

Final Sol integrity check: [sol-plan-integrity.txt](sol-plan-integrity.txt). Ran `git diff --exit-code`, `git status --short`, and a Python report/path assertion (all exit 0):

```text
Finding IDs: 8/8
Required sections: present
Pending placeholders: 0
Existing gate paths: present
Tracked diff: empty (exit 0)
Tracked status: empty
Report lines: 187 before this evidence appendix
```
