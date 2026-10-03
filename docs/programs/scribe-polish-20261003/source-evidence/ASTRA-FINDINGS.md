# Scribe editor/customizer audit — Astra

## Mission

**Goal:** exercise both résumé and cover-letter editing and provide reproducible findings for the Sol planning lane, preserving customer drafts and tracked product code.

**Success means:** both documents have a coverage matrix; defects have exact steps, expected/actual behavior, frequency, severity and evidence; browser-floor output and unverified paths are explicit.

**Stop when:** significant editing paths have been exercised or identified as unavailable, evidence is saved, and this report is ready for planning. **Reached.**

**Verdict: FIX-THEN-GO.** Five confirmed defects (two P1, three P2), two separately identified capability gaps, and one intermittent focused-test failure. Ordinary grounded editing works for both documents. Passing the existing browser floor does not cover the lifecycle failures below.

## Baseline and proof boundaries

- Confirmed audited HEAD: `3641d33fc26e20c22c7a22c15e600ccba8a7de45`.
- Confirmed running-app checkout HEAD: `e0f9137fb3d99c112065053c7e0c87e8fe175a01` in `../test-pr160`.
- Confirmed both Git trees: `e05bc82226f7e61b5c75bb510fa07b3a70c8d117`.
- Native task launch pin: `gpt-6-astra`, `xhigh`, confirmed by parent task metadata. This is not a claim about a separate OS argv.
- Parent supplied native quota snapshot: 2026-10-03T05:11:20Z, weekly 1% used. No provider exhaustion occurred.
- Exploratory browser: installed Chrome, fresh contexts, 1440×1000 desktop and 375×667 phone. Static app started through `startHermeticApp`; Google/Sheets and host-acting paths fenced. Real customer app/storage was not used for editing.
- `qa-harness.mjs` runs the **real edit/version service, proposed-op validation, renderer, immutable-run persistence and publication claims** in fixture-only directories. Fictional Alex Example / Acme data is used throughout. `JOBBORED_PROFILE_PATH` and `JOBBORED_LLM_CONFIG_PATH` point inside each fixture directory. Browser requests are redirected to an ephemeral loopback API.
- Model replies are explicit mocks except `live-gemini.json`: four real Gemini requests plus their fact checks, with only fictional nodes and empty isolated profile/ledger inputs. Configured key was read in memory; credentials/request headers are not recorded. Resolved provider/model: `gemini` / `gemini-flash-latest`.
- Exploratory PDF generation/measurement and critic are mocked. Therefore HTML/text/save/history behavior is proven; printable PDF fit/quality is not. The PDF-unavailable probe injects a failure and exercises the real service fallback.
- Final `git status --short` and `git diff --stat` both returned empty. No tracked product changes, commits, pushes, PRs or deploys. All new report/probe/fixture changes are under this evidence folder. The required existing browser suite also writes its fixed `F1-*`/`F3-*` screenshots directly under `.lane-evidence/`; those existing-suite outputs are outside this dated folder.

## Coverage

Legend: **Confirmed browser** = real browser plus real isolated service with controlled model response; **Live model** = additionally called Gemini; **Focused test** = existing Node tests, not browser proof. Every “pass” below is scoped to its named checks; the complete focused floor is non-green because of RISK-01.

| Path | Résumé | Cover letter | Evidence / boundary |
|---|---|---|---|
| Open from document row Edit | Confirmed browser pass | Confirmed browser pass | `happy-*.json`, `happy-*-open.png` |
| Switch document tabs after saved edits | Pass | Pass | `happy-*.json`; preserves rendered sibling text |
| Direct manual text editing | Unavailable | Unavailable | GAP-01; double-click/typing made no change; zero editable document controls |
| Select text / focused-node AI scope | Unavailable | Unavailable | GAP-02; selection exists, scope stays whole document, payload `scope:"all"` |
| Whole-document composer request | Pass | Pass | Real scoped document nodes; happy/recovery/live cases |
| Shorter / tone / bullet / paragraph request | Live model pass: shorter earlier-role line, two punchier experience bullets | Live model pass: warmer last paragraph, more formal first paragraph | `live-gemini.json`; four requests, four saved results |
| Multiple sequential saved edits | Live model pass, two | Live model pass, two | `live-gemini.json`; updated text persisted and sibling unchanged each time |
| Visible proposal marks and review | Pass | Pass | `happy-*-proposal.png`, `mobile-*-proposal.png` |
| Accept all and explicit Save | Pass | Pass | `probe-happy.log`, live Gemini results |
| Individual Accept and explicit Save | Pass | Pass | `mobile-*.json` |
| Reject all / discard / next request | Pass | Pass | `recovery-*.json`; saved model remained equal to original |
| Mixed individual accept/reject and unverified Accept-all exclusion | Existing browser floor pass | Not separately repeated in letter UI | Resume floor exercises keyboard `j/k/a/r`, unverified exclusion and exact accepted IDs |
| Metric/fact lock guard | Pass: 38%→40% blocked | Pass: 38%→40% blocked | Intentional guardrail, not a defect; retry succeeded |
| Fully blocked empty proposal → retry | Pass | Pass | `recovery-*.json`; client proposal null, valid retry ready |
| Malformed provider reply → retry | Pass for safe failure/retry | Pass for safe failure/retry | `not-json` mock; diagnostic wording limitation noted under ASTRA-05 |
| Provider transport failure → retry | Pass for safe failure/retry | Pass for safe failure/retry | Explicit provider exception; diagnostic limitation under ASTRA-05 |
| Stop after proposal ID, before ops → retry | Pass | Pass | `recovery-*.json` |
| Stop during fact checking retains validated partial ops | Pass | Pass | `recovery-*.json`, `recovery-*-partial.png`; discard then retry passed |
| Stop before start response returns | **Fail ASTRA-02** | **Fail ASTRA-02** | 1.2-second delayed POST mock; server remains pending |
| Leave ready proposal via close/switch/new prompt | **Fail ASTRA-01** | **Fail ASTRA-01** | Six combinations all strand proposal |
| Save/reopen persistence | Pass | Pass | Visible text and saved model match accepted op; reopen reproduces |
| PDF-browser unavailable during save | **Fail ASTRA-03** | **Fail ASTRA-03** | Real HTML save plus 503, misleading UI state |
| Latest vs historical view | Pass | Pass | Mobile view labels historical copy read-only; current restored afterward |
| Compare | Pass at desktop and phone | Pass at desktop and phone | Side-by-side desktop; phone A/B tabs |
| Restore as new version | Pass | Pass | `happy-*.json`; v0/v1 retained, v2 appended, original text restored |
| Sibling-document preservation | Pass | Pass | Exact JSON sibling equality across happy/live saves and restore |
| Stale concurrent proposal accept | Guard passed | Guard passed | HTTP 409 `stale_base`; newer fictional actor's saved text retained |
| Retry after stale conflict | **Fail review accuracy ASTRA-04** | **Fail review accuracy ASTRA-04** | API rebases correctly; displayed version/diff remains old |
| Missing provider opId | Pass | Pass | Real validator assigns `edit-1`; visible one-op review |
| Historical single-doc scope / empty unrequested shell / document-specific current / sibling CAS | Focused tests pass | Focused tests pass | Relevant named cases in `astra-targeted-floor.log`; not newly browser-proven for every historical shape |
| Published five-bullet employer | Focused test pass | N/A | `edits a published five-bullet employer without dropping its proof` |
| Legacy two-paragraph normalization and ambiguous-shape rejection | N/A | Focused tests pass | Existing exact tests, not a separate live legacy fixture walkthrough |
| Phone layout / focus | Pass | Pass | 375px desk/scroll width 375; visible initial UI controls ≥44px; UI text ≥13px; `/`, Shift+Enter, Escape opener focus passed |
| Full PDF print/download, actual iOS keyboard, production OAuth/Sheets | Unverified | Unverified | See Unverified section |

Final artifact check inspected 19 custom browser evidence JSON files: all recorded empty unexpected-external and host-request arrays and no page errors. Credential-pattern scan found no credential matches in evidence text; this is a scoped check, not a general secret audit. Mock fixture background checklist/QA endpoints can return 404; these are not classified as product defects.

## Ranked findings

### ASTRA-01 — P1 — A ready proposal becomes inaccessible and blocks both documents

**Proof:** confirmed browser + real isolated service, mocked valid provider response. **Frequency:** 6/6 combinations: both documents × close/reopen, document switch, and second prompt without deciding the first proposal.

**Steps:**

1. Open either document using its role-row **Edit** button.
2. Request an allowed wording edit and wait for **1 change is ready**.
3. Leave it undecided. Either close/reopen Scribe, switch to the sibling document, or submit another prompt directly.
4. Send a new grounded edit request.

**Expected:** retain access to the first proposal, or offer a clear discard/recover decision before starting another. A new request must not erase the only means to reject the server's open proposal.

**Actual:** POST `/edits` returns **409**. UI says **“The materials server answered 409.”** Client `proposal` becomes null; there are **zero review controls**. Server still holds the original `ready` proposal with one operation. Switching back/reopening cannot retrieve it. No save occurred. Because the server gate is per role, requests for either document remain blocked. The resubmit variant also leaves obsolete redline marks visible after the controls disappear.

**Evidence:** `orphan-resume-close.json`, `orphan-resume-switch.json`, `orphan-resume-resubmit.json`, and matching `orphan-cover_letter-*.json`; corresponding `*-stranded.png`. Runner: `node .lane-evidence/editor-qa-20261003/probe-lifecycle.mjs`.

**Confirmed source boundary:** `scribe-v2.js:713` replaces `state.proposal`; `loadDoc` clears it; `setDoc`/`close` do not reject a ready proposal. `server/materials-versions.mjs` correctly retains its one-proposal-per-role guard. Fix planning should preserve that guard and repair client ownership/recovery.

### ASTRA-02 — P1 — Early Stop leaves a pending proposal that prevents retry

**Proof:** confirmed browser + real isolated service, controlled 1.2-second delay before the initial POST completes. **Frequency:** 2/2, once per document. Normal Stop after an ID arrives passed, so the boundary is specifically the start-response window.

**Steps:**

1. Open either document; submit a grounded edit.
2. While **Stop** is visible but the start response has not supplied a proposal ID, click **Stop**.
3. Wait for **“Stopped. No changes were proposed.”**
4. Submit another request.

**Expected:** cancel the pending start or stop/reject the newly returned ID before declaring completion; the next request should be possible.

**Actual:** `idAtStop:null`; no `/stop` request is sent. The initial POST subsequently creates a **pending, zero-op** proposal. The aborted stream does not process it. Retry receives **409** with `{error:"A proposal is already open for this role",code:"materials_pending"}`. The UI has no recovery controls.

**Evidence:** `early-stop-resume.json`, `early-stop-cover_letter.json`, matching `*-blocked.png`; `probe-early-stop.mjs` and `.log`.

**Confirmed source boundary:** `scribe-v2.js:766` only sends stop when an ID exists; its abort controller is passed to the stream, not the initial POST (`:719`, `:730`). The delayed start continuation still assigns the ID after Stop (`:728`).

### ASTRA-03 — P2 — HTML saves successfully, but a stale-PDF response is reported as “Not saved”

**Proof:** confirmed browser + real persistence with explicit PDF-browser failure injection. **Frequency:** 2/2, once per document. This does not establish that production PDF availability is currently failing.

**Steps:**

1. Generate an allowed one-op proposal, accept it, click **Save as v1**.
2. Inject `browser_unavailable` in the PDF commit dependency.
3. Read the result, click Save again, then close/reopen the editor.

**Expected:** acknowledge that text/HTML and v1 saved; distinguish PDF pending/unavailable and move review/history to the saved version. Retry should target the missing artifact, not an already accepted proposal.

**Actual:** the service persists the new HTML/model/run and returns **503** containing `run.n:1`, `run.pdf:"stale"`, `code:"browser_unavailable"`, `error:"HTML saved; PDF needs a browser."`. UI says **“Not saved: The materials server answered 503.”**, still labels v0 current, and keeps Save active. Retrying returns **409** `{error:"Proposal is not ready",code:"proposal_not_ready"}`. Reopening reveals the correctly saved v1 text.

**Evidence:** `pdf-unavailable-resume.json`, `pdf-unavailable-cover_letter.json`, `*-not-saved.png`, `*-reopened.png`; `probe-save-failure.mjs` and `.log`. JSON records both the exact 503 body and 409 retry body and verifies disk/reopened text.

**Confirmed source boundary:** `server/materials-versions.mjs:586` intentionally returns 503 after the fallback publishes HTML; `scribe-v2-api.js` rejects all non-2xx responses before retaining the run, and `scribe-v2.js` handles this as a total save failure.

### ASTRA-04 — P2 — Automatic stale-base retry reviews against obsolete document text

**Proof:** confirmed browser + real concurrent version writes; mocked provider response. **Frequency:** 2/2, once per document. Stale-save protection itself passed.

**Steps:**

1. Open v0 and generate a proposal.
2. In a second fictional actor, commit a newer version that changes the same node. Résumé example: `Resolved exceptions and tracked daily shipments.` Letter example: `I welcome a conversation about your operations.`
3. Accept/save the original proposal: 409 `stale_base` correctly preserves the newer text.
4. Undo the accepted decision, Reject all, Close without saving, then submit a new request without closing the editor.
5. Observe the automatic 409 → list versions → retry on the new run.

**Expected:** load the actual current version/model before rendering new review marks, use it as the deletion/replacement baseline, and label it v1.

**Actual:** POST retries on the correct v1 run, but the header still says **v0 Current version**, `state.versions` still contains only r0, and the visible diff uses v0 text. The letter review shows removal of **“would”**, a word absent from v1; the résumé shows only removal of **“daily”** from the old sentence, hiding the actual reordered replacement. The letter chat says **+2 words** while its review bar says **−1 words**. Saving still commits the requested text as v2, so the error is materially misleading review rather than observed data loss.

**Evidence:** `stale-resume.json`, `stale-cover_letter.json`, matching `*-rebase-preview.png` and `*-rejected-stale-save.png`; `probe-stale.mjs` and `.log`.

**Confirmed source boundary:** `scribe-v2-api.js:479` retries with the latest run; `scribe-v2.js:729` assigns only `currentRunId`, leaving versions/preview/diff baseline untouched.

### ASTRA-05 — P2 — HTTP failures hide the server's explanation

**Proof:** confirmed browser + real route envelopes and source agreement with the actual server registration. **Frequency:** all observed HTTP conflict/failure cases; directly evidenced for both documents in early-Stop, stale-save and PDF-unavailable probes (at least 6/6).

**Steps:** reproduce ASTRA-02, the rejected stale save in ASTRA-04, or ASTRA-03; compare the recorded response body with the chat message.

**Expected:** show the server's specific safe explanation and relevant recovery state, such as another proposal being open, a newer version existing, or HTML already saved with PDF unavailable.

**Actual:** every case collapses to **“The materials server answered 409/503.”** The code is retained internally but the explanation is discarded. This makes different recovery situations indistinguishable.

**Evidence:** `early-stop-*.json`, `stale-*.json`, `pdf-unavailable-*.json`; matching screenshots. `scribe-v2-api.js:409` reads only `body.message`; registered server routes return `body.error` (`server/materials-versions.mjs:637`, and production `server/index.mjs:1042`/`:1182`).

**Additional confirmed diagnostic limitation, not an extra counted defect:** explicit malformed JSON and provider-transport exceptions both yielded **“Scribe returned a change the template can't hold.”** in `recovery-*.json`. Safe retry worked; the message wrongly suggests a template/content problem for the simulated provider exception. Investigate the writer error classification separately from the HTTP-envelope mismatch.

## Capability gaps — separate from broken controls

### GAP-01 — Direct manual block editing is absent

**Proof:** confirmed unavailable in both document browsers, 2/2. Double-clicking a rendered line/paragraph then typing did not change it. No input/textarea/contenteditable control exists inside either document iframe, and no **Edit text** action appeared. The composer is editable; it is not direct document editing.

**Expected-behavior provenance:** `docs/programs/editor-20260927/SPEC.md:51` proposes block editing; the locked decision at `:333` explicitly adopts **D7 direct typing saves a manual version**. `:86` names the **Edit text** selection action, and `:187` specifies `/edits/manual`. This is an unimplemented documented capability, not a malfunctioning visible Edit-text button.

**Evidence:** `happy-resume.json`, `happy-cover_letter.json`, `manual typing` results. Manual API support is independently exercised by the focused floor and the fictional concurrent-write probe. UI manual-save/blur/debounce behavior remains unsatisfied.

### GAP-02 — Selection/focused-node scoping and its action popover are absent

**Proof:** confirmed unavailable, 2/2 documents. Actual selected text was captured (`and` / `improving`), but the scope pill stayed **Whole resume / Whole letter**; requests carried `scope:"all"`. No Rewrite/Shorten/Emphasize/Ask/Edit-text popover appeared. Prompts can describe a node in natural language; that is not a structured selection scope guarantee.

**Expected-behavior provenance:** SPEC `:81` requires selected-node IDs in scope and `:86` requires the popover. Current `scribe-v2.js:401` renders only the whole-document pill, and `:723` hard-codes `scope:"all"`.

**Evidence:** selection and `scopeSent` results in `happy-*.json`; corresponding proposal screenshots. Node-scoped backend rejection is covered by focused tests, not by an available UI path.

## Intentional guardrails and successful behavior

- Locked `38%` edits were blocked in both documents; the unchanged model and later valid retry were confirmed. Do not “repair” these by allowing fact drift.
- Malformed responses and fully blocked proposals did not mutate saved data; empty finished proposals no longer gated retry.
- Missing provider `opId` was normalized to `edit-1` and rendered as a reviewable change.
- Accept-all excluded unverified changes in the existing résumé browser floor; unknown-fact confirmations and scope boundaries passed their focused tests.
- Normal Stop after the proposal ID exists worked before ops and during checking; partial validated ops remained reviewable. Reject/discard preserved the original model and allowed retry.
- Concurrent stale saves were rejected before overwriting the newer model. The per-role open-proposal guard is correct; ASTRA-01/02 concern the missing client lifecycle needed to operate it.
- Document-specific latest/history, single-doc shell filtering, sibling-preserving historical edits, five-bullet résumé validation, and safe legacy-letter sentence splitting all passed their named focused tests in the non-green run. Do not broaden those fixes into schema relaxation.
- Four live Gemini edit requests persisted successfully: résumé earlier-role shortening, résumé bullet rewrites, warmer cover-letter close, formal first paragraph. Each saved sibling remained exactly equal to its pre-save value. This is a four-request functional sample, not a general model-quality or grounding guarantee.

## RISK-01 — Intermittent Stop/SSE focused-test failure

**Confirmed:** one isolated full focused run failed the existing test `service SSE emits blocked shape and Stop retains validated partial ops` at `tests/integration/materials-edit-api.test.mjs:417`. `service.stop()` returned `status:"partial"`, but the captured stream ended `done {"status":"ready"}`; the log contains duplicated proposal events. **Inferred:** race between ready completion and stop; broader user impact is unknown. Normal controlled browser Stop probes passed.

Observed runs: first focused run without explicit isolated-path env was 60/60; final explicitly isolated full run was **59/60**; one isolated name-filtered rerun was **1/1**. The initial full log was superseded before the rerun; its success was observed in tool output, not retained as the final floor artifact. The retained full focused floor is **non-green**. One filtered pass does not clear it. No test/assertion/product changes were made.

Evidence: `astra-targeted-floor.log` (full failure), `astra-stop-rerun.log` (single filtered pass). Sol should inspect and retain a deterministic regression strategy, not weaken `partial` to `ready`.

## Floor output

### Existing required browser floor — all 5 ran, 5 passed

Command:

```sh
npx playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-edit-journey.spec.mjs tests/e2e-journey/scribe-v2-desk.spec.mjs --output .lane-evidence/editor-qa-20261003/astra-playwright
```

Output from `astra-floor.log`:

```text
Running 5 tests using 1 worker

(node:485) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  1 tests/e2e-journey/scribe-edit-journey.spec.mjs:156:1 › should take a resume from Edit through review, save, stop, compare and bring back (4.0s)
  ✓  2 tests/e2e-journey/scribe-v2-desk.spec.mjs:186:1 › should open the desk from a role's Edit button and return focus on close (4.3s)
  ✓  3 tests/e2e-journey/scribe-v2-desk.spec.mjs:286:1 › should fit a phone: one pane at a time, 44px targets, no sideways scroll (1.8s)
  ✓  4 tests/e2e-journey/scribe-v2-desk.spec.mjs:341:1 › should call the live routes, not the fixtures, when no stub flag is set (1.6s)
  ✓  5 tests/e2e-journey/scribe-v2-desk.spec.mjs:376:1 › should view, compare and bring back versions at 1440 and 390 (3.7s)

  5 passed (16.2s)
```

### Supplemental focused floor — 60 ran, 59 passed, 1 failed, 0 skipped

Command:

```sh
JOBBORED_PROFILE_PATH=/Users/emilionunezgarcia/Job-Bored/.worktrees/scribe-editor-fix/.lane-evidence/editor-qa-20261003/isolated-floor/profile.json JOBBORED_LLM_CONFIG_PATH=/Users/emilionunezgarcia/Job-Bored/.worktrees/scribe-editor-fix/.lane-evidence/editor-qa-20261003/isolated-floor/llm.json node --test tests/materials-nodes.test.mjs tests/materials-edit.test.mjs tests/integration/materials-edit-api.test.mjs
```

Literal summary from retained full output (`astra-targeted-floor.log`):

```text
ℹ tests 60
ℹ suites 2
ℹ pass 59
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1061.996542
```

Filtered diagnostic rerun used the same isolated paths plus:

```sh
node --test --test-name-pattern='service SSE emits blocked shape and Stop retains validated partial ops' tests/integration/materials-edit-api.test.mjs
```

```text
✔ service SSE emits blocked shape and Stop retains validated partial ops (64.968875ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 293.179708
```

## Reproduction artifacts

Run scratch probes from the worktree root with Node. They create fresh fixture directories and Chrome contexts; none modifies tracked code. `probe-live.mjs` additionally requires the configured Gemini pin and makes real provider calls.

| Runner | Primary results |
|---|---|
| `probe-happy.mjs` | `happy-resume.json`, `happy-cover_letter.json`, `probe-happy.log` |
| `probe-live.mjs` | `live-gemini.json`, `probe-live.log`, four proposal/saved screenshot pairs |
| `probe-lifecycle.mjs` | six `orphan-*.json` and `*-stranded.png` files |
| `probe-recovery.mjs` | two `recovery-*.json`, partial screenshots, `probe-recovery.log` |
| `probe-early-stop.mjs` | two `early-stop-*.json`, `*-blocked.png`, `probe-early-stop.log` |
| `probe-save-failure.mjs` | two `pdf-unavailable-*.json`, before/reopened screenshots |
| `probe-stale.mjs` | two `stale-*.json`, stale-save and rebased-preview screenshots |
| `probe-mobile.mjs` | two `mobile-*.json`, document/proposal/history/compare viewport screenshots |

Some exploratory harness authoring needed selector corrections (a missing compare-heading locator and an overly broad A/B selector); those were probe mistakes, not product findings. Final mobile results completed all listed checks. Fictional fixture directories are retained under `fixtures/` for inspection; they are not customer state.

## Unverified / unsatisfied

- Direct manual UI editing and structured selection/node scope are **unsatisfied capabilities**, not browser passes (GAP-01/02).
- Actual PDF generation, download/reopened PDF contents, pagination/fit, fonts, and PDF recovery after a real browser outage were not verified. Normal exploratory PDF sessions were mocked.
- Actual mobile hardware, soft keyboard resizing, touch selection, screen-reader speech, Safari and Firefox were not exercised. Phone claims are desktop Chrome at 375×667.
- Live provider malformed/error/cancel/race cases were not induced against Gemini; these are explicitly mocked fault paths. The four live successful calls do not establish all tone/length combinations or semantic factuality across arbitrary user records.
- Three/five-bullet insertion/removal extremes, legacy two-paragraph migration, and every historical document-feature combination have focused-test proof only, not dedicated exploratory browser/live-provider proof.
- Mixed accepted/rejected/unverified batch UI was covered by the existing résumé floor, not independently repeated for cover letter. Individual accept, accept-all, reject-all, save, retry and restore were exercised for both.
- Quality-score modal → Fix/Apply/Repair entry points and template-changing controls outside this Scribe desk were not separately audited; the verified entry points are both document-row Edit buttons and document tabs.
- No production/customer draft, live OAuth/Sheets mutation, external deployment, full-root suite, CI gate, performance benchmark or accessibility certification was attempted.
- RISK-01 leaves the supplemental focused floor non-green. Existing browser floor success is limited to its five tests.
