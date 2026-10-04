BLOCKED: keyboard-only F1/F2 acceptance fails for both documents at 1440 and 375; visual floor has 4 failures.

## Scope and verdict

**Confirmed: FIX-THEN-GO for candidate acceptance.** QA execution is complete. The former ASTRA failures pass on the candidate, as do the scoped recovery/mobile, score entry points, manual safety cases and real PDF checks. Strict keyboard-only access fails, and the visual floor is not green. No product file was changed or committed.

Candidate: `a9ed80ce379c3573b8b7b433fd8855745a97863a` (detached). Phase-1 branch retained at `c4779df4591183b0d469a59f81999f74bbfcca1e`. Baseline product: `7dfbcd535e42632cdd98af33f3891b7e5ff0ec43`. Recorded 2026-10-03T10:52:39.971230+00:00. Node v24.13.0, npm 11.19.1.

Floor commands ran A → B → C → F, plus Cap/CSP/visual. Every test/probe invocation sourced `.lane-evidence/scrp-env/env.sh`. JOBBORED_HOME stayed inside this worktree. All app instances used ephemeral loopback ports and fresh browser contexts; no serving checkout, protected port, private profile, live provider, install, push or deploy was used.

The named SPEC §0 currently contains D1–D18. D19/D20 were read from `FIX-R1.md`, and D21–D23 from `FIX-R2.md`; their candidate tests and browser cases were included. Shared storage-isolation and copy amendments were read. The independent harness is based on phase-1's real Express version/edit service plus installed Chrome, with mocked model replies, PDF sessions and critic except the explicitly real PDF checks. The committed C floor also uses `tests/e2e-fixtures/scribe-real-service.mjs`. Mocked replies are not live-provider proof.

## Ranked findings

1. **P2 QA-KBD-01 — confirmed; blocks the requested keyboard-only acceptance.** Both documents, 1440 and 375: open Edit, move out of the composer with Tab, cycle F6 through panes (Tab out of the composer whenever F6 focuses it) until `.scribe__docscroll` is focused, then Tab. The document blocks are never reached in 38 successive Tab steps. At 1440 focus moves to Versions/Compare/chips; at 375 it reaches the background “Skip to Pipeline” link before returning to the desk. Thus a keyboard user cannot select a block or start Edit text by this path. No model/edit write is triggered. The rendered iframe has `tabindex=-1`; the document region also has `tabindex=-1`, and the frame focus trap routes back to parent controls. These source anchors explain the observed behavior; the failure itself comes from real key input.
   - Evidence: `qa/candidate/keyboard-{resume,cover_letter}-{1440,375}.json`, `keyboard-final.log`; each JSON records `f6Focus.className=scribe__docscroll`, an empty reached-node list, the actual focus sequence, all rendered node IDs, and `keyboardReachableAll=false`.
   - Screenshots: `qa/candidate/keyboard-{resume,cover_letter}-{1440,375}-after-tab-cycle.png`. Full-page screenshots include background content; viewport-only mobile screenshots are separately listed below.
   - Product anchors: `scribe-v2.js:216`, `:219`, `:2141`, `:2344`. No remediation was made in this read-only lane.

2. **P2 QA-VIS-01 — confirmed red gate; inferred fixture mismatch rather than a demonstrated layout defect.** All four SCRP-U2 cells (both docs × 1440/375) fail because `.scribe__selection-actions` is hidden at `tests/e2e-visual/scribe-v2.spec.mjs:413`. The fixture clears `hidden` but not inline `display:none` installed by the candidate's selection lifecycle. Real selection invokes the lifecycle and shows the toolbar in all four independent cells and in C. Later U2 manual/unsaved contrast and geometry assertions were therefore **not reached**. Preserve the red gate; the UX owner must reconcile the fixture and rerun after CSS polish.
   - Evidence: `qa/candidate/visual.log`; four `qa/candidate/visual-pw/scribe-v2-SCRP-U2-*/error-context.md`, `test-failed-1.png`, `trace.zip`.
   - Real toolbar evidence: `qa/candidate/cap-selection-{resume,cover_letter}-{1440,375}-multi-disabled.png` and matching JSON.

**Layout observations:** confirmed no sideways overflow in measured 375px candidate cases (`scrollWidth=375`), initial visible mobile controls 44px high, text minimum 13px, and composer focus ring present in the visual gate. The two rendered PDFs are legible with no observed clipping/overlap. No separate layout defect is asserted from full-page screenshot placement. UX CSS may land after this candidate; all CSS-sensitive claims apply only to this SHA and require the planned recheck.

## Per-ID before / after

Baseline source: [QA-BASELINE.md](qa/QA-BASELINE.md). PASS below is scoped to the listed browser/service proof, not an overall release pass.

| ID | Resume before | Cover letter before | Resume candidate | Cover letter candidate | Evidence |
|---|---|---|---|---|---|
| ASTRA-01 | FAIL close/switch/resubmit 3/3; orphaned ready request | Same FAIL | PASS 3/3; original request recovered, draft preserved, discard then retry 202 | Same PASS | `orphan-{close,switch,resubmit}-{resume,cover_letter}.json`, `*-recoverable.png`, `*-retry-ready.png`; C F21/F23 |
| ASTRA-02 | FAIL early Stop before ID, pending request, retry 409 | Same FAIL | PASS null ID → late stop 200 → retry 202 | Same PASS | `early-stop-*.json`, `*-stopped.png`, `*-retry-ready.png`; C F22 |
| ASTRA-03 | FAIL committed text reported unsaved, duplicate Save | Same FAIL | PASS saved v1 copy, no Save/Refresh action, one accept, reopen text | Same PASS | `pdf-unavailable-*.json`, `*-text-saved.png`, `*-reopened.png`; C F24/F25 |
| ASTRA-04 | CAS PASS; review FAIL stale header/redline | Same | PASS stale save refused, newer text kept, review uses actual current base, save v2 | Same PASS | `stale-*.json`, `*-stale-refused.png`, `*-current-base-review.png`, `stale-corrected.log`; C F26 |
| ASTRA-05 | FAIL generic 409/503 copy; recovery cause misclassified | Same FAIL | PASS cause-specific stale/PDF/recovery and writer failure copy | Same PASS | preceding JSON + `recovery-*.json`; C F27/F28 cover network/malformed/truncated/refused/unconfigured |
| RISK-01 browser symptom | Scoped PASS controlled Stop during checking; intermittent race unknown | Same | Scoped PASS partial op retained, retry succeeds, rejected model unchanged | Same | `recovery-*.json`, `*-partial.png`; A strict service Stop regression passes |

RISK-01 is not a claim of exhaustive race freedom: the 20-run E stress gate and full root suite were not run by this QA lane.

## Six repro classes

| Class | Resume | Cover letter | Scope |
|---|---|---|---|
| Orphan close/switch/resubmit | PASS 3/3 | PASS 3/3 | Real persisted request, controls available, preserved next request, successful retry |
| Early Stop | PASS | PASS | Delayed POST, null ID at Stop, real late-ID stop request |
| PDF unavailable | PASS | PASS | Injected browser failure, real text/version persistence and truthful amended copy |
| Stale | PASS | PASS | Seeded run (D18), CAS refusal and current-base review/save |
| Recovery | PASS | PASS | Locked/malformed/transport, stop before ops/during fact checking, missing opId, unchanged rejected document |
| Mobile 375×667 | Scoped PASS | Scoped PASS | Layout, slash focus, Shift+Enter, individual acceptance/save, history, A/B compare, Escape → matching Edit; strict block keyboard path separately FAIL |

## F1 / F2 acceptance matrix

P = observed PASS; **FAIL-K** = keyboard navigation blocker above. Behavioral rows used real keyboard actions after programmatic focus/range placement; they do not qualify as complete keyboard-only journeys. Multi-block/substring ranges and clipboard payloads were intentionally injected, as in the committed C suite.

| Case | Resume 1440 | Resume 375 | Letter 1440 | Letter 375 | Evidence prefix |
|---|---|---|---|---|---|
| Selection pill + exact node-ID payload + multi-block | P | P | P | P | `cap-selection-*`, C F43 |
| Popover Tab/Shift+Tab/Escape return once node focused | P | P | P | P | C F43; `cap-selection-*` |
| Reach block + Edit text with keyboard-only navigation | **FAIL-K** | **FAIL-K** | **FAIL-K** | **FAIL-K** | `keyboard-*` |
| Stale selection refused before POST | P | P | P | P | `cap-stale-selection-*`, C F43 |
| One manual version after debounce; sibling unchanged; v0 retained | P | P | P | P | `cap-manual-*`, C F44 |
| No-change blur → zero manual requests / cleared editing state | P | P | P | P | `cap-guards-*`, `guards-final.log` |
| Locked metric refuses keyboard replacement | P | P | P | P | `cap-guards-*`, C F45 |
| Plain-text paste removes markup | P | P | P | P | `cap-guards-*`, C F45; synthetic ClipboardEvent with HTML/plain payload |
| New fact → refusal + explicit confirmation | P | P | P | P | `cap-guards-*`, `cap-batch-*` |
| Stale manual text kept; Review current read-only; explicit Reapply | P | P | P | P | `cap-guards-*`, C F45 |
| D21 all replacements quoted; confirmed ops/IDs exactly match batch | P | P | P | P | `cap-batch-*`; B F71 also checks obsolete confirmation invalidation |
| D22 repeated-token lock stays on original 38%; new prefix editable | P | P | P | P | `cap-repeated-lock-*`, `repeated-lock-corrected.log` |
| D23 hash role-close restores unsaved text and Save/Discard prompt | P | P | P | P | `cap-role-restore-*`; no refresh persistence claimed |
| Multi-block Edit text aria-disabled + explanatory title + no editor | P | P | P | P | `cap-selection-*-multi-disabled.png`, B F710 |
| Unselected/sibling AI op rejected with no saved change | P | P | P | P | C F46 is per doc, viewport-independent service guard |
| Scope/manual handlers remain scriptless and CSP-clean | P | P | P | P | CSP F47 per doc; width-independent policy |
| No sideways document/desk overflow | P | P | P | P | cap JSON metrics; mobile JSON |

Whole-locked employer/title/credential refusal is covered by C F45 for the résumé; the letter's locked metric is covered in both docs. Mobile close returns focus to the matching document's Edit button (`mobile-*.json`); desktop opener restoration passes C. Actual touch, native iOS keyboard and screen-reader speech remain unverified.

Screenshot patterns (each expands over `resume|cover_letter` and `1440|375`):
- `qa/candidate/cap-selection-{doc}-{width}-{multi-disabled,scoped-preview}.png`
- `qa/candidate/cap-stale-selection-{doc}-{width}-refused.png`
- `qa/candidate/cap-manual-{doc}-{width}-saved-one-version.png`
- `qa/candidate/cap-batch-{doc}-{width}-{every-replacement-listed,confirmed-exact-batch}.png`
- `qa/candidate/cap-repeated-lock-{doc}-{width}-original-lock-preserved.png`
- `qa/candidate/cap-role-restore-{doc}-{width}-restored-unsaved.png`
- `qa/candidate/cap-guards-{doc}-{width}-{locked-refusal,plain-paste,fact-confirm,conflict-keeps-text,review-current-readonly,reapplied}.png`
- Viewport-only mobile screenshots: `qa/candidate/mobile-{resume,cover_letter}-{doc,proposal,history,compare}.png`.

## Score-modal Fix / Apply / Repair → editor

**Confirmed 24/24 actions**, across ATS-gap/rewrite and quality-issue manifest fixtures. Every action closes the score modal, focuses/fills the Scribe composer, preserves the document, and emits zero edit/repair/regenerate POSTs. This is entry-point proof; no score/provider call was made.

| Doc | Width | Fix this | Apply | Repair | Evidence |
|---|---:|---|---|---|---|
| Resume | 1440 | PASS ×2 | PASS ×2 | PASS ×2 | `score[-quality]-resume-1440.json` |
| Resume | 375 | PASS ×2 | PASS ×2 | PASS ×2 | `score[-quality]-resume-375.json` |
| Cover letter | 1440 | PASS ×2 | PASS ×2 | PASS ×2 | `score[-quality]-cover_letter-1440.json` |
| Cover letter | 375 | PASS ×2 | PASS ×2 | PASS ×2 | `score[-quality]-cover_letter-375.json` |

Steps: role Edit → Grade → Fix this; reopen Grade → Rewrite suggestions → Apply; reopen Grade → Repair. Quality Fix/Repair exact text is asserted. Screenshots: `qa/candidate/score[-quality]-{doc}-{width}-{fix,apply,repair}-{before,after}.png`.

## Real installed-browser PDF gate and unavailable copy

**Confirmed PASS both docs.** Actual editor save → role Download menu → PDF link → browser download → Poppler reopen/text/font/page inspection → editor reopen. Model response and critic are mocked; PDF rendering uses the application's real `openPdfSession`, not the fake PDF session. Playwright's installed Chromium headless-shell launch is recorded in `real-pdf-corrected.log`; UI driving uses installed Google Chrome. The separate F service gate also passes 4/4.

| Doc | Changed saved/downloaded text | Pages | Embedded fonts | Sibling PDF bytes + sibling model | Reopen |
|---|---|---:|---:|---|---|
| Resume | Tracked shipments and resolved exceptions. | 1 | 5, all embedded | Exact equality, SHA-256 recorded | PASS |
| Cover letter | I welcome a conversation about improving your daily operations. | 1 | 6, all embedded | Exact equality, SHA-256 recorded | PASS |

PDFs: `qa/candidate/real-pdf-{resume,cover_letter}-download.pdf`. Reopened text: matching `.txt`; page render: matching `.png`; literal Poppler outputs: matching `-info.log` / `-fonts.log`; API/download/sibling hashes: `real-pdf-{doc}.json`. Both PNGs were visually inspected: no observed clipped/overlapping text, clean one-page layout. Editor screenshots: `real-pdf-{doc}-{saved,reopened}.png`.

Unavailable fault: exact amended string observed for both docs, **“Text saved as v1. PDF unavailable — it’s rebuilt on your next save.”** No Refresh action, no duplicate Save, reopened text persisted. Evidence `pdf-unavailable-*.json`, screenshots above; F B16 additionally proves unavailable PDF deletion leaves the sibling PDF intact.

## Live provider

**host-run** for both documents, per the Phase-2 kickoff message. This lane made zero live-provider requests and did not inspect credentials. The required two fictional requests per doc, visible preview, accepted save, persistence, provenance and sibling equality remain for the host's sample. No lane claim of live-provider acceptance.

## Evidence integrity and harness corrections

`qa/candidate/evidence-integrity.json` inventories 58 final custom case files, 162 top-level screenshots, four explicit keyboard acceptance failures, zero remaining runner errors, zero unexpected external browser requests, zero host-acting requests and zero page errors. Counts apply to those custom probes, not every process on the machine. Full floor outputs and visual failures are separate. Browser wrapper exit 0 does not override a false JSON outcome; see `process-exits.json`.

Initial probe errors remain in logs and are not product findings:
- Import path corrected once after copying the runner; no install.
- Stale redline assertion initially included accessibility “deleted/end deleted” wrapper text. The correction extracts only the replacement text nodes; the original concurrent-text comparison stays strict (`repros.log` → `stale-corrected.log`).
- Repeated-lock probe queried desk geometry after it deliberately closed the desk. Lock assertions already passed; the final probe permits absent desk geometry only after close (`capabilities.log` → `repeated-lock-corrected.log`).
- PDF fixture `res.download` rejected a hidden `.lane-evidence` path, returning 404. The fixture now sends those same generated bytes with an attachment header. The corrected UI download and byte-equality checks pass (`real-pdf.log` → `real-pdf-corrected.log`).
- Guard probe initially expected a lock-error status to clear as though it were an unchanged editing status, then retained a prior text range during focus setup. The final probe separately exercises a no-change edit and clears the setup range before choosing the next node; all original lock/paste/fact/CAS assertions remain (`guards*.log`).
- Early keyboard scripts stopped cycling F6 when it focused the textarea, where F6 is intentionally ignored. The final script Tabs out before continuing and verifies focus actually reached the document region. The keyboard failure persists with this valid precondition (`keyboard-final.log`).

## Commands and literal outputs

Every command below has this prefix:

```sh
source .lane-evidence/scrp-env/env.sh
```

No name filter was applied to A/B/C/F/Cap/CSP/visual. A/B/Cap explicitly report skipped 0. Playwright reports 61+4+6 cases passed with no skipped case, and visual 13 passed +4 failed out of17; its list reporter omits a zero-skip line. D/E/full root, lint/typecheck/contracts, formal diff review and secret-staging gate were not run in this evidence-only QA lane; no files were staged.

### A

```sh
node --test tests/materials-nodes.test.mjs tests/materials-edit.test.mjs tests/materials-edit-factcheck-model.test.mjs tests/materials-edit-commit.test.mjs tests/materials-pipeline.test.mjs tests/integration/materials-edit-api.test.mjs
```

Literal summary excerpt; full log [floor-A.log](qa/candidate/floor-A.log):

```text
ℹ tests 126
ℹ suites 4
ℹ pass 126
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2828.611083
```

### B

```sh
node --test tests/scribe-v2-api.test.mjs tests/scribe-v2-lifecycle.test.mjs tests/scribe-v2-carryover.test.mjs tests/scribe-v2-keyboard.test.mjs tests/scribe-v2-diff.test.mjs tests/scribe-v2-versions.test.mjs tests/scribe-v2-selection.test.mjs tests/scribe-v2-manual.test.mjs
```

Literal summary excerpt; full log [floor-B.log](qa/candidate/floor-B.log):

```text
ℹ tests 276
ℹ suites 42
ℹ pass 276
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 426.942334
```

### C

```sh
npx --no-install playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-edit-journey.spec.mjs tests/e2e-journey/scribe-v2-desk.spec.mjs --output .lane-evidence/qa/candidate/floor-C-pw
```

Literal output; full log [floor-C.log](qa/candidate/floor-C.log):

```text
Running 61 tests using 1 worker

(node:35427) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓   1 tests/e2e-journey/scribe-edit-journey.spec.mjs:158:1 › should take a resume from Edit through review, save, stop, compare and bring back (4.3s)
  ✓   2 tests/e2e-journey/scribe-edit-journey.spec.mjs:343:5 › SCRP-F21 ASTRA-01 resume close recovers a real persisted proposal (1.5s)
  ✓   3 tests/e2e-journey/scribe-edit-journey.spec.mjs:343:5 › SCRP-F21 ASTRA-01 resume switch recovers a real persisted proposal (1.5s)
  ✓   4 tests/e2e-journey/scribe-edit-journey.spec.mjs:343:5 › SCRP-F21 ASTRA-01 resume resubmit recovers a real persisted proposal (1.2s)
  ✓   5 tests/e2e-journey/scribe-edit-journey.spec.mjs:367:5 › SCRP-F22 ASTRA-02 resume deferred POST then Stop stops the late ID (1.4s)
  ✓   6 tests/e2e-journey/scribe-edit-journey.spec.mjs:367:5 › SCRP-F22 ASTRA-02 resume deferred POST then close stops the late ID (1.3s)
  ✓   7 tests/e2e-journey/scribe-edit-journey.spec.mjs:367:5 › SCRP-F22 ASTRA-02 resume deferred POST then switch stops the late ID (1.5s)
  ✓   8 tests/e2e-journey/scribe-edit-journey.spec.mjs:367:5 › SCRP-F22 ASTRA-02 resume deferred POST then new editor stops the late ID (1.3s)
  ✓   9 tests/e2e-journey/scribe-edit-journey.spec.mjs:387:3 › SCRP-F23 ASTRA-01 resume failed discard retains controls (1.3s)
  ✓  10 tests/e2e-journey/scribe-edit-journey.spec.mjs:399:3 › SCRP-F24 ASTRA-03 resume real committed 503 saves text exactly once (1.5s)
  ✓  11 tests/e2e-journey/scribe-edit-journey.spec.mjs:420:3 › SCRP-F25 ASTRA-03 resume ordinary 503 stays unsaved and retryable (1.4s)
  ✓  12 tests/e2e-journey/scribe-edit-journey.spec.mjs:343:5 › SCRP-F21 ASTRA-01 cover_letter close recovers a real persisted proposal (1.4s)
  ✓  13 tests/e2e-journey/scribe-edit-journey.spec.mjs:343:5 › SCRP-F21 ASTRA-01 cover_letter switch recovers a real persisted proposal (1.5s)
  ✓  14 tests/e2e-journey/scribe-edit-journey.spec.mjs:343:5 › SCRP-F21 ASTRA-01 cover_letter resubmit recovers a real persisted proposal (1.1s)
  ✓  15 tests/e2e-journey/scribe-edit-journey.spec.mjs:367:5 › SCRP-F22 ASTRA-02 cover_letter deferred POST then Stop stops the late ID (1.4s)
  ✓  16 tests/e2e-journey/scribe-edit-journey.spec.mjs:367:5 › SCRP-F22 ASTRA-02 cover_letter deferred POST then close stops the late ID (1.3s)
  ✓  17 tests/e2e-journey/scribe-edit-journey.spec.mjs:367:5 › SCRP-F22 ASTRA-02 cover_letter deferred POST then switch stops the late ID (1.4s)
  ✓  18 tests/e2e-journey/scribe-edit-journey.spec.mjs:367:5 › SCRP-F22 ASTRA-02 cover_letter deferred POST then new editor stops the late ID (1.2s)
  ✓  19 tests/e2e-journey/scribe-edit-journey.spec.mjs:387:3 › SCRP-F23 ASTRA-01 cover_letter failed discard retains controls (1.4s)
  ✓  20 tests/e2e-journey/scribe-edit-journey.spec.mjs:399:3 › SCRP-F24 ASTRA-03 cover_letter real committed 503 saves text exactly once (1.5s)
  ✓  21 tests/e2e-journey/scribe-edit-journey.spec.mjs:420:3 › SCRP-F25 ASTRA-03 cover_letter ordinary 503 stays unsaved and retryable (1.4s)
  ✓  22 tests/e2e-journey/scribe-edit-journey.spec.mjs:457:5 › SCRP-F43 GAP-02 resume 1440 substring, multi-block, keyboard, payload and stale refusal (1.8s)
  ✓  23 tests/e2e-journey/scribe-edit-journey.spec.mjs:502:5 › SCRP-F44 GAP-01 resume 1440 one debounced manual version keeps v0 and sibling (3.5s)
  ✓  24 tests/e2e-journey/scribe-edit-journey.spec.mjs:528:5 › SCRP-F45 GAP-01 resume 1440 metric refusal, plain paste, confirm, conflict and unsaved choices (4.8s)
  ✓  25 tests/e2e-journey/scribe-edit-journey.spec.mjs:457:5 › SCRP-F43 GAP-02 resume 375 substring, multi-block, keyboard, payload and stale refusal (1.9s)
  ✓  26 tests/e2e-journey/scribe-edit-journey.spec.mjs:502:5 › SCRP-F44 GAP-01 resume 375 one debounced manual version keeps v0 and sibling (3.6s)
  ✓  27 tests/e2e-journey/scribe-edit-journey.spec.mjs:528:5 › SCRP-F45 GAP-01 resume 375 metric refusal, plain paste, confirm, conflict and unsaved choices (4.9s)
  ✓  28 tests/e2e-journey/scribe-edit-journey.spec.mjs:583:3 › SCRP-F46 GAP-02 resume server rejects unselected and sibling ops without a save (1.3s)
  ✓  29 tests/e2e-journey/scribe-edit-journey.spec.mjs:457:5 › SCRP-F43 GAP-02 cover_letter 1440 substring, multi-block, keyboard, payload and stale refusal (1.9s)
  ✓  30 tests/e2e-journey/scribe-edit-journey.spec.mjs:502:5 › SCRP-F44 GAP-01 cover_letter 1440 one debounced manual version keeps v0 and sibling (3.7s)
  ✓  31 tests/e2e-journey/scribe-edit-journey.spec.mjs:528:5 › SCRP-F45 GAP-01 cover_letter 1440 metric refusal, plain paste, confirm, conflict and unsaved choices (4.8s)
  ✓  32 tests/e2e-journey/scribe-edit-journey.spec.mjs:457:5 › SCRP-F43 GAP-02 cover_letter 375 substring, multi-block, keyboard, payload and stale refusal (2.8s)
  ✓  33 tests/e2e-journey/scribe-edit-journey.spec.mjs:502:5 › SCRP-F44 GAP-01 cover_letter 375 one debounced manual version keeps v0 and sibling (3.7s)
  ✓  34 tests/e2e-journey/scribe-edit-journey.spec.mjs:528:5 › SCRP-F45 GAP-01 cover_letter 375 metric refusal, plain paste, confirm, conflict and unsaved choices (4.8s)
  ✓  35 tests/e2e-journey/scribe-edit-journey.spec.mjs:583:3 › SCRP-F46 GAP-02 cover_letter server rejects unselected and sibling ops without a save (1.4s)
  ✓  36 tests/e2e-journey/scribe-edit-journey.spec.mjs:604:3 › SCRP-F56 GAP-01 resume pending sibling recovery retains the manual draft and gates Continue (4.3s)
  ✓  37 tests/e2e-journey/scribe-edit-journey.spec.mjs:604:3 › SCRP-F56 GAP-01 cover_letter pending sibling recovery retains the manual draft and gates Continue (4.0s)
  ✓  38 tests/e2e-journey/scribe-edit-journey.spec.mjs:634:3 › SCRP-F27 R1 #10 resume real-service locked fact uses fixed blocked copy (1.1s)
  ✓  39 tests/e2e-journey/scribe-edit-journey.spec.mjs:634:3 › SCRP-F27 R1 #10 cover_letter real-service locked fact uses fixed blocked copy (1.1s)
  ✓  40 tests/e2e-journey/scribe-edit-journey.spec.mjs:649:3 › SCRP-F58 resume phone recovery Review reveals the document (1.6s)
  ✓  41 tests/e2e-journey/scribe-edit-journey.spec.mjs:649:3 › SCRP-F58 cover_letter phone recovery Review reveals the document (1.7s)
  ✓  42 tests/e2e-journey/scribe-v2-desk.spec.mjs:189:1 › should open the desk from a role's Edit button and return focus on close (4.4s)
  ✓  43 tests/e2e-journey/scribe-v2-desk.spec.mjs:289:1 › should fit a phone: one pane at a time, 44px targets, no sideways scroll (1.9s)
  ✓  44 tests/e2e-journey/scribe-v2-desk.spec.mjs:344:1 › should call the live routes, not the fixtures, when no stub flag is set (1.6s)
  ✓  45 tests/e2e-journey/scribe-v2-desk.spec.mjs:379:1 › should view, compare and bring back versions at 1440 and 390 (3.7s)
  ✓  46 tests/e2e-journey/scribe-v2-desk.spec.mjs:536:3 › SCRP-F26 ASTRA-04 resume real stale retry uses the exact current redline base (1.8s)
  ✓  47 tests/e2e-journey/scribe-v2-desk.spec.mjs:576:5 › SCRP-F27 ASTRA-05 resume real blocked provider_failed has safe copy and a retry (1.5s)
  ✓  48 tests/e2e-journey/scribe-v2-desk.spec.mjs:576:5 › SCRP-F27 ASTRA-05 resume real blocked unreadable_reply has safe copy and a retry (1.4s)
  ✓  49 tests/e2e-journey/scribe-v2-desk.spec.mjs:576:5 › SCRP-F27 ASTRA-05 resume real blocked invalid_model has safe copy and a retry (1.3s)
  ✓  50 tests/e2e-journey/scribe-v2-desk.spec.mjs:597:5 › SCRP-F28 ASTRA-05 resume real SSE error http_429 is bounded and actionable (1.1s)
  ✓  51 tests/e2e-journey/scribe-v2-desk.spec.mjs:597:5 › SCRP-F28 ASTRA-05 resume real SSE error writer_truncated is bounded and actionable (1.1s)
  ✓  52 tests/e2e-journey/scribe-v2-desk.spec.mjs:597:5 › SCRP-F28 ASTRA-05 resume real SSE error writer_blocked is bounded and actionable (1.2s)
  ✓  53 tests/e2e-journey/scribe-v2-desk.spec.mjs:597:5 › SCRP-F28 ASTRA-05 resume real SSE error llm_unconfigured is bounded and actionable (1.2s)
  ✓  54 tests/e2e-journey/scribe-v2-desk.spec.mjs:536:3 › SCRP-F26 ASTRA-04 cover_letter real stale retry uses the exact current redline base (1.5s)
  ✓  55 tests/e2e-journey/scribe-v2-desk.spec.mjs:576:5 › SCRP-F27 ASTRA-05 cover_letter real blocked provider_failed has safe copy and a retry (1.5s)
  ✓  56 tests/e2e-journey/scribe-v2-desk.spec.mjs:576:5 › SCRP-F27 ASTRA-05 cover_letter real blocked unreadable_reply has safe copy and a retry (1.5s)
  ✓  57 tests/e2e-journey/scribe-v2-desk.spec.mjs:576:5 › SCRP-F27 ASTRA-05 cover_letter real blocked invalid_model has safe copy and a retry (1.7s)
  ✓  58 tests/e2e-journey/scribe-v2-desk.spec.mjs:597:5 › SCRP-F28 ASTRA-05 cover_letter real SSE error http_429 is bounded and actionable (1.1s)
  ✓  59 tests/e2e-journey/scribe-v2-desk.spec.mjs:597:5 › SCRP-F28 ASTRA-05 cover_letter real SSE error writer_truncated is bounded and actionable (1.2s)
  ✓  60 tests/e2e-journey/scribe-v2-desk.spec.mjs:597:5 › SCRP-F28 ASTRA-05 cover_letter real SSE error writer_blocked is bounded and actionable (1.1s)
  ✓  61 tests/e2e-journey/scribe-v2-desk.spec.mjs:597:5 › SCRP-F28 ASTRA-05 cover_letter real SSE error llm_unconfigured is bounded and actionable (1.1s)

  61 passed (2.1m)
```

### F

```sh
npx --no-install playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-pdf-save.spec.mjs --output .lane-evidence/qa/candidate/floor-F-pw
```

Literal output; full log [floor-F.log](qa/candidate/floor-F.log):

```text
Running 4 tests using 1 worker

(node:59545) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  1 tests/e2e-journey/scribe-pdf-save.spec.mjs:52:3 › SCRP-B15 resume: allowed save produces changed text, embedded fonts and one page; sibling unchanged (3.4s)
  ✓  2 tests/e2e-journey/scribe-pdf-save.spec.mjs:84:3 › SCRP-B16 resume: browser failure saves HTML and stale-PDF QA while sibling PDF survives (1.5s)
  ✓  3 tests/e2e-journey/scribe-pdf-save.spec.mjs:52:3 › SCRP-B15 coverLetter: allowed save produces changed text, embedded fonts and one page; sibling unchanged (3.5s)
  ✓  4 tests/e2e-journey/scribe-pdf-save.spec.mjs:84:3 › SCRP-B16 coverLetter: browser failure saves HTML and stale-PDF QA while sibling PDF survives (1.6s)

  4 passed (12.6s)
```

### Cap

```sh
node --test tests/scribe-v2-selection.test.mjs tests/scribe-v2-manual.test.mjs tests/materials-render-node-ids.test.mjs
```

Literal summary excerpt; full log [floor-Cap.log](qa/candidate/floor-Cap.log):

```text
ℹ tests 38
ℹ suites 0
ℹ pass 38
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 156.843708
```

### CSP

```sh
npx --no-install playwright test --config tests/e2e-smoke/playwright.config.mjs tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs --output .lane-evidence/qa/candidate/csp-pw
```

Literal output; full log [csp.log](qa/candidate/csp.log):

```text
Running 6 tests using 1 worker

(node:97188) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  1 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:196:3 › should render the signal resume in a sandboxed srcdoc frame with no CSP violation (1.2s)
  ✓  2 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:196:3 › should render the dossier resume in a sandboxed srcdoc frame with no CSP violation (962ms)
  ✓  3 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:196:3 › should render the editorial resume in a sandboxed srcdoc frame with no CSP violation (973ms)
  ✓  4 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:253:1 › control: should see a frame violation when the srcdoc breaks img-src (495ms)
  ✓  5 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:275:3 › SCRP-F47 GAP-01/02 resume parent selection, paste and input handlers cause zero CSP violations (1.2s)
  ✓  6 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:275:3 › SCRP-F47 GAP-01/02 cover_letter parent selection, paste and input handlers cause zero CSP violations (1.3s)

  6 passed (7.3s)
```

### Visual

```sh
npx --no-install playwright test --config tests/e2e-visual/playwright.config.mjs tests/e2e-visual/scribe-v2.spec.mjs --output .lane-evidence/qa/candidate/visual-pw
```

Literal summary excerpt; full log [visual.log](qa/candidate/visual.log):

```text

  4 failed
    tests/e2e-visual/scribe-v2.spec.mjs:406:3 › SCRP-U2 resume 1440: selection, manual outcomes and unsaved prompt
    tests/e2e-visual/scribe-v2.spec.mjs:406:3 › SCRP-U2 resume 375: selection, manual outcomes and unsaved prompt
    tests/e2e-visual/scribe-v2.spec.mjs:406:3 › SCRP-U2 cover_letter 1440: selection, manual outcomes and unsaved prompt
    tests/e2e-visual/scribe-v2.spec.mjs:406:3 › SCRP-U2 cover_letter 375: selection, manual outcomes and unsaved prompt
  13 passed (56.2s)
```

Independent probes (full literal outputs are the matching `.log` files in `qa/candidate/`; their JSON, not wrapper exit status, determines behavior):

```sh
node .lane-evidence/qa/phase2-repros.mjs
node .lane-evidence/qa/phase2-repros.mjs stale
node .lane-evidence/qa/phase2-probe-recovery.mjs
node .lane-evidence/qa/phase2-probe-mobile.mjs
node .lane-evidence/qa/phase2-probe-score.mjs
node .lane-evidence/qa/phase2-probe-score.mjs --quality
node .lane-evidence/qa/phase2-capabilities.mjs
node .lane-evidence/qa/phase2-capabilities.mjs repeated-lock
node .lane-evidence/qa/phase2-capabilities.mjs stale-selection
node .lane-evidence/qa/phase2-capabilities.mjs guards
node .lane-evidence/qa/phase2-keyboard.mjs
DEBUG=pw:browser node .lane-evidence/qa/phase2-pdf.mjs
python3 .lane-evidence/qa/verify-candidate.py
```

PDF probe executes `pdfinfo <download.pdf>`, `pdffonts <download.pdf>`, `pdftotext <download.pdf> <download.txt>`, and `pdftoppm -scale-to 1200 -png -singlefile <download.pdf> <download-stem>` for each doc. Literal metadata/font output is retained, and extracted text and rendered pages were reopened.

Literal final integrity output:

```json
{
  "timestamp": "2026-10-03T10:49:32.131270+00:00",
  "caseFiles": 58,
  "explicitPassingChecks": 74,
  "explicitFalseChecks": [
    "keyboard-cover_letter-1440.json",
    "keyboard-cover_letter-375.json",
    "keyboard-resume-1440.json",
    "keyboard-resume-375.json"
  ],
  "runnerErrors": [],
  "unexpectedExternal": [],
  "hostRequests": [],
  "pageErrors": [],
  "screenshotCount": 162,
  "liveProvider": "host-run; zero lane live calls; no credential inspection",
  "scope": "Custom Chrome probes only; floor reports are separate."
}
```

## Reconciliation

- **Done:** detached candidate checkout; isolation before every run; all six repro classes both docs; per-ID comparison; F1/F2 behavioral and round-2 cases both widths; strict keyboard attempt with observed failure; score actions both docs/widths; real browser PDF download/reopen/fonts/pages/sibling checks; PDF-unavailable copy; screenshots; A/B/C/F/Cap/CSP/visual floors; both QA reports.
- **Blocked:** complete keyboard-only F1/F2 acceptance, demonstrated in four cells; visual U2 gate and its later contrast/geometry assertions. Product remediation belongs to the build/UX lanes. No repeated workaround is left running.
- **Host-run:** live-provider sample, explicitly delegated by the user; no credentials sought.
- **Pending host recheck:** later UX CSS and any resulting candidate SHA. This report does not cover changes after a9ed80ce.
- **Not run / unknown:** full npm test, D contracts/lint/typecheck, E 20-run stress, current WebKit compatibility, native touch/iOS/screen-reader speech, fresh native quota and independently exposed lane argv/session pin. No quota wall occurred and no subagent was spawned. Phase-1's WebKit unavailability was not promoted into a current passing claim.
- **Cancelled by scope:** commits/staging, installs, live stack/ports, external writes and publication. The phase-1 branch stays intact; product working tree is unchanged.
- **Parallel branch:** `feat/scribe-widgets-be` was not waited on or evaluated, per D11.
