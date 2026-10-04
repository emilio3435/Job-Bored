BLOCKED: QA-KBD-01 passes all four cells, but 375px timed Stop/recovery probes remain incomplete; an additional desktop cover-letter Edit-opener keyboard check failed twice.

## Verdict and scope

**Confirmed: QA-KBD-01 is fixed on candidate `3fea865654eb16860f245f4cda7a9c6c02b8886d`.** D24 metric-edge inserts are refused locally in both documents at both widths. UX-FE-1 passes during editing, blur, error retention, and restoration at 375px. The requested committed browser floors pass: journey **66/66**, visual **21/21**, CSP **6/6**.

**BLOCKED / FIX-THEN-GO for an unqualified “nothing regressed” acceptance.** Four expanded mobile Stop/recovery probes did not complete. Their failure does not establish a product root cause. An extra keyboard prelude outside the Phase-2 desk journey also failed twice: Tab did not reach the cover-letter Edit opener at 1440px. Its baseline status is unknown. These limits are separate from the now-passing D25 journey inside Scribe.

Read: integration worktree `docs/programs/scribe-polish-20261003/FIX-R3.md` (D24, D25, UX-FE-1), and this worktree's `.lane-evidence/QA-REPORT.md`. Detached with `git checkout --detach 3fea8656`. Node v24.13.0, npm 11.19.1. Recorded 2026-10-03T12:16:51.170970+00:00. No tracked files changed, no commit, no serving checkout or protected ports 8080/3847/8644 used.

All test/probe commands sourced `.lane-evidence/scrp-env/env.sh`. JOBBORED_HOME remained under this QA worktree. Custom fixtures use the real local Express edit/version service, installed Google Chrome, ephemeral loopback ports, fresh contexts, and fictional content. Model replies, critic, and custom PDF generation are mocked; this is not live-provider or real-PDF acceptance. The committed journey fixture also uses the real edit service. Every evidence path below is relative to this report unless stated otherwise.

## Remaining red evidence

1. **QA-P3-STOP — acceptance incomplete, both docs at 375.** The early-Stop probe delays the initial POST by 1200ms, submits from Chat, and tries to reach Stop before the ID arrives. The Stop visibility assertion times out. The recovery probe retries locked/malformed/transport cases successfully, then cannot click Stop in its 700ms delayed “before ops” case. Both paths end with a ready suggestion, one final POST 202, and no stop request; the later timed-Stop/retry assertions were not reached. Explicitly selecting Chat did not resolve this in the second valid attempt, so this probe stopped at the retry limit. **Confirmed:** probe failures and missing stop calls. **Unknown:** timing/setup versus a product visibility issue; whether this differs from Phase 2 (whose timed-Stop probes ran at desktop width).
   - Final: `qa/phase3/early-stop-{resume,cover_letter}-375.json`, `recovery-{resume,cover_letter}-375.json`, matching `-error.png`, `repros-mobile-corrected.log`, `recovery-mobile-corrected.log`.
   - Prior attempts: `qa/phase3/repros-mobile-segments/` and `qa/phase3/recovery-mobile-initial/`.
   - Recovery runner exit 0 is not a pass: it catches failures into JSON. The inventory counts both recovery JSON errors as failures.

2. **QA-P3-OPENER — confirmed additional keyboard barrier, baseline unknown.** Before opening Scribe, an extra all-keyboard role-page prelude attempted 90 Tabs to the cover-letter Edit button at 1440px. It failed twice, including after asserting the opener was visible. The recorded sequence reaches cover-letter Grade/Download and then returns to résumé controls or the role title; it never reaches the required opener. No third attempt or product workaround was made. This check extends beyond Phase 2's setup, which clicks Edit before beginning keyboard-only traversal. **It does not negate the four passing in-desk journeys below.** Whether it is new on this candidate is unverified.
   - First: `qa/phase3/keyboard-opener-initial/keyboard-cover_letter-1440.json` and `-error.png`.
   - Second: `qa/phase3/keyboard-role-prelude/keyboard-cover_letter-1440.json`, `-error.png`, `keyboard-opener-corrected.log`.

## Strict keyboard-only journey: D25 / QA-KBD-01

Setup matches Phase 2: open the appropriate Edit desk through the role page. From the open desk onward the independent probe uses real key input only: **Tab / F6 to the document → ArrowDown through blocks → Enter → selection actions → Tab four times to Edit text → Enter → type → Tab out**. There is no injected focus, range, click, selection event, or controller mutation in this journey. DOM evaluations are read-only observations. Save assertions wait an additional 2300ms after v1 to catch a second debounced write.

For each cell, all rendered blocks were reached with ArrowDown, exactly one block had tabindex=0, all labels ended in “locked” or “editable”, and the focus ring was solid. ArrowUp and J/K also worked. Enter and Space focused the first selection action. Escape returned to the block, then to the document region. Résumé title/employer refusal was also observed. Saved text persisted, v0 remained pinned, the sibling model was unchanged, and the iframe remained scriptless with sandbox `allow-same-origin`.

| Document | Width | Journey | Manual POSTs | Manual versions | Pinned v0 | Evidence |
|---|---:|---|---:|---:|---|---|
| Résumé | 1440 | PASS | 1 | 1 | PASS | [JSON](qa/phase3/keyboard-resume-1440.json), [saved screenshot](qa/phase3/keyboard-resume-1440-saved-one-version.png) |
| Résumé | 375 | PASS | 1 | 1 | PASS | [JSON](qa/phase3/keyboard-resume-375.json), [saved screenshot](qa/phase3/keyboard-resume-375-saved-one-version.png) |
| Cover letter | 1440 | PASS | 1 | 1 | PASS | [JSON](qa/phase3/keyboard-cover_letter-1440.json), [saved screenshot](qa/phase3/keyboard-cover_letter-1440-saved-one-version.png) |
| Cover letter | 375 | PASS | 1 | 1 | PASS | [JSON](qa/phase3/keyboard-cover_letter-375.json), [saved screenshot](qa/phase3/keyboard-cover_letter-375-saved-one-version.png) |

Each cell additionally has `keyboard-{doc}-{width}-{block-focus,selection-actions,editing,locked-before,locked-after}.png`. The four saved screenshots and mobile lock screenshot were visually inspected. The committed independent F814 tests also pass four cells in `qa/phase3/journey.log`.

## Locked-figure edges: D24

The probe enters the metric-bearing block by keyboard, uses Select All → ArrowLeft → repeated ArrowRight to place the caret, and types `1` immediately before `38%`, then `5` immediately after it. All eight attempts retain the exact original text, show **“Figures in this line are locked.”**, and make **zero manual requests** before the later safe edit.

| Edge | Résumé 1440 | Résumé 375 | Letter 1440 | Letter 375 |
|---|---|---|---|---|
| `1` before `38%` | PASS | PASS | PASS | PASS |
| `5` after `38%` | PASS | PASS | PASS | PASS |

Evidence: the `locks` arrays in the four keyboard JSON files and their `-locked-before.png` / `-locked-after.png` screenshots. F814 supplies a second browser check in the committed journey floor. This phase does not separately claim a new server-unit floor.

## Dossier résumé at 375: UX-FE-1

**Confirmed PASS.** The edited bullet occupies the full document row in the editing, blurred, and error-retained states. The normal two-span renderer returns after retry saves v1. A forced one-shot 500 keeps the draft and creates no version; retry creates one manual version. The sibling letter is unchanged, and page scrollWidth equals 375.

| State | Child spans | Computed columns (CSS px inside iframe) | Text starts at row left | Text width | Result |
|---|---:|---|---|---:|---|
| rendered | 2 | 51.8281px 478.109px | Renderer gutter | 404.20 | PASS |
| editing | 0 | 529.938px | Yes | 405.91 | PASS |
| blurred | 0 | 529.938px | Yes | 405.91 | PASS |
| error-kept | 0 | 529.938px | Yes | 405.91 | PASS |
| restored | 2 | 51.8281px 478.109px | Renderer gutter | 405.91 | PASS |

Row width is 529.94 CSS px inside the scaled document. During plain-text states the single column is 529.938px, versus the renderer's 51.83px gutter. Text stays one line. Evidence: [JSON](qa/phase3/dossier-resume-375.json), screenshots [editing](qa/phase3/dossier-resume-375-editing.png), [blurred](qa/phase3/dossier-resume-375-blurred.png), [error kept](qa/phase3/dossier-resume-375-error-kept.png), [restored](qa/phase3/dossier-resume-375-restored.png). Editing/error/restored screenshots were visually inspected. Committed F815 also passes and captures its own five states under `qa/phase3/journey-pw/`.

## Six repro classes

PASS is scoped to the listed browser assertions. **FAIL-P** means the probe did not complete; product root cause is unknown. The mobile class retains its defined 375×667 scope; desktop behavior is covered by the other rows and F1/F2 matrix.

| Class | Résumé 1440 | Résumé 375 | Letter 1440 | Letter 375 | Evidence in qa/phase3 |
|---|---|---|---|---|---|
| Orphan close / switch / resubmit | PASS 3/3 | PASS 3/3 | PASS 3/3 | PASS 3/3 | `orphan-{close,switch,resubmit}-{doc}-{width}.json`, screenshots |
| Early Stop before ID | PASS | **FAIL-P** | PASS | **FAIL-P** | `early-stop-{doc}-{width}.json`, `-stopped.png` or `-error.png` |
| PDF unavailable, truthful saved copy, no duplicate Save | PASS | PASS | PASS | PASS | `pdf-unavailable-{doc}-{width}.json`, saved/reopened screenshots |
| Stale CAS refusal, current-base review and retry | PASS | PASS | PASS | PASS | `stale-{doc}-{width}.json`, stale/current-base screenshots |
| Recovery: locked/malformed/transport + timed Stop + retry | PASS | **FAIL-P** after first three conditions | PASS | **FAIL-P** after first three conditions | `recovery-{doc}-{width}.json`, partial/finished/error screenshots |
| Mobile layout, slash, Shift+Enter, save, history, A/B, Escape | N/A mobile class | PASS | N/A mobile class | PASS | `mobile-{doc}.json`, doc/proposal/history/compare screenshots |

Desktop recovery includes Stop before ops, partial ops kept during fact checking, safe retry, missing opId normalization, and unchanged saved model after all rejected paths. At 375 only the locked/malformed/transport retries reached completion before the timed-Stop block. The committed C/F21–F28 regressions all pass; their green result is not substituted for incomplete independent mobile cells.

## F1 / F2 matrix

The capability probe deliberately injects focus/ranges for substring, multi-block and paste setup; it is behavioral evidence, not a second strict keyboard-only journey. Clipboard HTML/plain payloads are synthetic. The strict keyboard row uses only the separately described real key input after Edit-open setup.

| Case | Résumé 1440 | Résumé 375 | Letter 1440 | Letter 375 | Evidence |
|---|---|---|---|---|---|
| Scope pill, exact node IDs, substring/multi-block | PASS | PASS | PASS | PASS | `cap-selection-*`; committed F43 |
| Toolbar Tab/Shift+Tab/Escape | PASS | PASS | PASS | PASS | F43; `keyboard-*` |
| Tab/F6 reach blocks, Enter → Edit text → type → Tab → one version | PASS | PASS | PASS | PASS | `keyboard-*`; F814 |
| Stale selection refused before POST | PASS | PASS | PASS | PASS | `cap-stale-selection-*` |
| One manual version, sibling unchanged, v0 retained | PASS | PASS | PASS | PASS | `cap-manual-*`; `keyboard-*`; F44 |
| No-change blur clears editing state, zero requests | PASS | PASS | PASS | PASS | `cap-guards-*` |
| Locked replacement and both adjacent digit inserts refused | PASS | PASS | PASS | PASS | `cap-guards-*`; `keyboard-*` |
| Plain-text paste strips markup | PASS | PASS | PASS | PASS | `cap-guards-*` |
| New fact refused; explicit confirmation | PASS | PASS | PASS | PASS | `cap-guards-*`, `cap-batch-*` |
| Stale manual draft kept; read-only review; explicit reapply | PASS | PASS | PASS | PASS | `cap-guards-*` |
| D21 quoted replacements and exact confirmed ops/IDs | PASS | PASS | PASS | PASS | `cap-batch-*` |
| D22 original repeated-token lock retained; new prefix editable | PASS | PASS | PASS | PASS | `cap-repeated-lock-*` |
| D23 role-close restores unsaved text and Save/Discard | PASS | PASS | PASS | PASS | `cap-role-restore-*` |
| Multi-block Edit text disabled with explanation | PASS | PASS | PASS | PASS | `cap-selection-*`; F43 |
| Unselected/sibling AI op refused with no save | PASS | PASS | PASS | PASS | F46 per document; viewport-independent server assertion |
| Scriptless iframe / CSP clean | PASS | PASS | PASS | PASS | `keyboard-*`; F47 per document, policy width-independent |
| No sideways page/desk overflow | PASS | PASS | PASS | PASS | all `cap-*.json` metrics; mobile JSON |

`*` expands to `{resume,cover_letter}-{1440,375}.json` with matching state PNGs. All 28 custom capability cases passed (`capabilities.log`). Actual touch, native mobile software keyboard, and screen-reader speech remain unverified; accessible labels and browser focus were checked.

## Commands and literal outputs

Every test/probe invocation used this prefix:

```sh
source .lane-evidence/scrp-env/env.sh
```

No name filter or skip was applied to the three committed floors below. All enumerated cases passed; Playwright's list reporter does not print a zero-skip line. A/B/F PDF, full root/discovery/contract/lint/typecheck, long stress runs, real PDF download/reopen, score entry points, and live-provider sampling were not rerun in this final keyboard/regression phase. Their Phase-2 results are not claimed as fresh Phase-3 proof.

```sh
npx --no-install playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-edit-journey.spec.mjs tests/e2e-journey/scribe-v2-desk.spec.mjs --output .lane-evidence/qa/phase3/journey-pw
```

Literal summary from [journey.log](qa/phase3/journey.log):

```text
Running 66 tests using 1 worker
  66 passed (2.2m)
```

```sh
npx --no-install playwright test --config tests/e2e-visual/playwright.config.mjs tests/e2e-visual/scribe-v2.spec.mjs --output .lane-evidence/qa/phase3/visual-pw
```

Literal output from [visual.log](qa/phase3/visual.log):

```text
Running 21 tests using 1 worker

(node:13827) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓   1 tests/e2e-visual/scribe-v2.spec.mjs:184:3 › the sheet at 1440, reduced motion reduce (1.8s)
  ✓   2 tests/e2e-visual/scribe-v2.spec.mjs:184:3 › the sheet at 1440, reduced motion no-preference (1.5s)
  ✓   3 tests/e2e-visual/scribe-v2.spec.mjs:207:1 › a landed proposal at 1440: marks, rail, and a readable primary button (1.5s)
  ✓   4 tests/e2e-visual/scribe-v2.spec.mjs:235:1 › full screen at 390, one segment at a time (1.6s)
  ✓   5 tests/e2e-visual/scribe-v2.spec.mjs:385:3 › SCRP-U1 resume 1440: recovery and every status outcome (2.0s)
  ✓   6 tests/e2e-visual/scribe-v2.spec.mjs:406:3 › SCRP-U2 resume 1440: selection, manual outcomes and unsaved prompt (2.0s)
  ✓   7 tests/e2e-visual/scribe-v2.spec.mjs:385:3 › SCRP-U1 resume 375: recovery and every status outcome (2.2s)
  ✓   8 tests/e2e-visual/scribe-v2.spec.mjs:406:3 › SCRP-U2 resume 375: selection, manual outcomes and unsaved prompt (2.3s)
  ✓   9 tests/e2e-visual/scribe-v2.spec.mjs:385:3 › SCRP-U1 cover_letter 1440: recovery and every status outcome (2.0s)
  ✓  10 tests/e2e-visual/scribe-v2.spec.mjs:406:3 › SCRP-U2 cover_letter 1440: selection, manual outcomes and unsaved prompt (2.0s)
  ✓  11 tests/e2e-visual/scribe-v2.spec.mjs:385:3 › SCRP-U1 cover_letter 375: recovery and every status outcome (2.2s)
  ✓  12 tests/e2e-visual/scribe-v2.spec.mjs:406:3 › SCRP-U2 cover_letter 375: selection, manual outcomes and unsaved prompt (2.3s)
  ✓  13 tests/e2e-visual/scribe-v2.spec.mjs:427:1 › SCRP-U3 composer: 44px phone field and keyboard focus ring (1.2s)
  ✓  14 tests/e2e-visual/scribe-v2.spec.mjs:446:3 › SCRP-U4 resume 1440: live recovery rows and recovered status (1.4s)
  ✓  15 tests/e2e-visual/scribe-v2.spec.mjs:446:3 › SCRP-U4 resume 375: live recovery rows and recovered status (1.4s)
  ✓  16 tests/e2e-visual/scribe-v2.spec.mjs:446:3 › SCRP-U4 cover_letter 1440: live recovery rows and recovered status (1.4s)
  ✓  17 tests/e2e-visual/scribe-v2.spec.mjs:446:3 › SCRP-U4 cover_letter 375: live recovery rows and recovered status (1.4s)
  ✓  18 tests/e2e-visual/scribe-v2.spec.mjs:493:3 › SCRP-U5 resume 1440: live scope, multi-block hint, manual editing and unsaved navigation (2.4s)
  ✓  19 tests/e2e-visual/scribe-v2.spec.mjs:493:3 › SCRP-U5 resume 375: live scope, multi-block hint, manual editing and unsaved navigation (2.6s)
  ✓  20 tests/e2e-visual/scribe-v2.spec.mjs:493:3 › SCRP-U5 cover_letter 1440: live scope, multi-block hint, manual editing and unsaved navigation (2.3s)
  ✓  21 tests/e2e-visual/scribe-v2.spec.mjs:493:3 › SCRP-U5 cover_letter 375: live scope, multi-block hint, manual editing and unsaved navigation (2.4s)

  21 passed (40.9s)
```

```sh
npx --no-install playwright test --config tests/e2e-smoke/playwright.config.mjs tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs --output .lane-evidence/qa/phase3/csp-pw
```

Literal output from [csp.log](qa/phase3/csp.log):

```text
Running 6 tests using 1 worker

(node:13826) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  1 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:196:3 › should render the signal resume in a sandboxed srcdoc frame with no CSP violation (1.2s)
  ✓  2 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:196:3 › should render the dossier resume in a sandboxed srcdoc frame with no CSP violation (943ms)
  ✓  3 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:196:3 › should render the editorial resume in a sandboxed srcdoc frame with no CSP violation (871ms)
  ✓  4 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:253:1 › control: should see a frame violation when the srcdoc breaks img-src (426ms)
  ✓  5 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:275:3 › SCRP-F47 GAP-01/02 resume parent selection, paste and input handlers cause zero CSP violations (1.2s)
  ✓  6 tests/e2e-smoke/scribe-csp-srcdoc.spec.mjs:275:3 › SCRP-F47 GAP-01/02 cover_letter parent selection, paste and input handlers cause zero CSP violations (1.2s)

  6 passed (6.7s)
```

Custom scripts live in `qa/`, outputs in `qa/phase3/`:

```sh
node .lane-evidence/qa/phase3-keyboard.mjs
node .lane-evidence/qa/phase3-capabilities.mjs
node .lane-evidence/qa/phase3-dossier.mjs
node .lane-evidence/qa/phase3-repros.mjs
node .lane-evidence/qa/phase3-repros.mjs 375
node .lane-evidence/qa/phase3-probe-recovery.mjs
node .lane-evidence/qa/phase3-probe-recovery.mjs 375
node .lane-evidence/qa/phase3-probe-mobile.mjs
python3 .lane-evidence/qa/phase3-integrity.py
```

The `375` reruns target the added mobile cells after segment-aware setup corrections. The early all-role-keyboard prelude ran `phase3-keyboard.mjs cover_letter-1440`; the final script now starts with the Phase-2 Edit-open setup. Earlier outputs remain in the named subdirectories.

Final strict keyboard output:

```text
{"doc":"resume","width":1440,"pass":true,"manualCount":1}
{"doc":"resume","width":375,"pass":true,"manualCount":1}
{"doc":"cover_letter","width":1440,"pass":true,"manualCount":1}
{"doc":"cover_letter","width":375,"pass":true,"manualCount":1}
```

## Evidence integrity and probe corrections

[Inventory and hashes](qa/phase3/evidence-integrity.json): **63 final custom JSON cases, 59 pass, four failed/incomplete mobile probes, 147 top-level screenshots, zero page errors, zero unexpected external requests, zero host-acting requests** in those cases. The additional role-opener failures are retained separately, outside the 63-case count. These counts do not describe every process on the machine. Catch-and-dump runner exit 0 never overrides a JSON error. The inventory records every process exit, including red attempts.

Preserved corrections, without product changes:
- The first keyboard run expected `Text saved as v1.` (the committed fixture's stale-PDF path), while this fixture successfully generated mocked PDFs and returned `Saved as v1`. Corrected the success-path assertion; exact one-request/version assertions were retained. Initial evidence: `keyboard-initial/`.
- Mobile extensions of desktop probes initially tried hidden Chat or Doc controls. Added explicit segment navigation. Initial evidence: `repros-initial/`, `repros-mobile-segments/`, `recovery-initial/`. Timed Stop still failed on the second valid attempt and remains red.
- D25 changes Escape: focused block → document region → close. Mobile probe now checks both steps; initial evidence: `mobile-initial/`.
- Dossier's first short sentence naturally measured 280.39px despite an already-correct 529.938px single column. The probe now asserts a single column equal to row width and text-left equal to row-left, and uses a longer grounded sentence. Initial evidence: `dossier-initial/`. No CSS was changed.
- The additional role-keyboard prelude stopped after two failures. Final requested keyboard evidence begins after Edit-open setup, exactly as in Phase 2; it is explicitly not proof of keyboard-only access to that outer opener.

## Intention reconciliation

- **Done:** read R3/Phase-2 sources; detached exact candidate; isolated environment for every test/probe; four strict in-desk keyboard journeys with JSON/screenshots; eight lock-edge refusals; Dossier edit/blur/error/restored checks; six-class re-run and F1/F2 table; visual and CSP outputs; evidence inventory; this report. Test/browser instances created by these runners were closed. No commit or tracked product edit.
- **Blocked:** unqualified regression clearance due to four incomplete mobile timed-Stop/recovery cells and the separately observed outer cover-letter opener barrier. Product cause/regression status remains unknown where noted. No repeated workaround is left running.
- **Cancelled:** further attempts at the twice-failed opener and mobile timed-Stop checks, per the retry limit. No other intended Phase-3 work was cancelled.
