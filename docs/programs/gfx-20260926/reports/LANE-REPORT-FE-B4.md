DONE — B4 claims green. The committed VAL-ONEFLOW-001 is still red, from a pre-existing B2 model pin outside this fence (§5). With only that pin relaxed, it passes.

## 1. Mission
Redesign Beat 4 (fit profile) into one grouped page, validate it through `fit-profile-schema.js`, and save it through `fit-profile-sync.js` so "Looks like me →" really writes `POST /profile`, or honestly says it saved locally. Commit: `be3117d7` on `feat/gfx-fe-b4` (local only, not pushed).

## 2. Claims that went red first (named with ledger IDs)
`tests/gfx-fe-b4-fit-beat.test.mjs` was run against HEAD's `oneflow-beat-fit.js` and CSS: **27 of 28 failed**. The one pass, "only a failed local save blocks the beat", pins behaviour that was already correct. Full output: `.lane-evidence/red-first-full.txt`.
- N-B4-1 ×4: empty config POSTs same-origin; local_only completes with a quiet note; server_error completes with a retry note; only a local failure blocks.
- N-B4-2 ×4: rejected stays on the beat with the server's words at the field; an unplaceable rejection still surfaces; a 61-char strength is caught inline; Add disables at 8 roles with the reason.
- N-B4-3: the first invalid field is focused, and the error clears as the user types.
- B4-8: option lists come from the schema's ENUMS.
- B4-1/9, B4-5/N-B4-6, B4-6, N-B4-3/B4-4, B4-7: section order; hard filters visible; Preferences collapsed with a count and More of / Less of; no raw JSON; labelled textarea with a counter; new headline.
- D5/N-B4-4 ×3: one salary control plus help text; the summary names a floor only when set; salaryRequired is sent only when ticked.
- B4-2/3/11, N-B4-5 ×6: drag on the handle only; no ↑↓; arrow-key reorder; Enter, comma and paste add; blur trims and dedupes; every × is labelled.
- R6 ×3: every fit selector is scoped under `.oneflow-fit`; × ≥ 24×24; `field-sizing: content`.
- **VAL-ONEFLOW-001** was red on this branch before the change: `profileWrites` 0 at spec :579.

## 3. What shipped, file and fence
- `oneflow-beat-fit.js`: rewritten render (Target → Your story → Strengths | Deal-breakers → Preferences) and one shared tag-input component.
  - Validation goes through `validateProfile`; ajv `instancePath` values are mapped back to fields.
  - `confirmFit` saves locally, then calls `syncProfile`.
  - Deleted: the copied enums, `profileApiConfigured`, `postFitProfile`, `profileUrl`, `noteLocalOnlySave`, and the raw JSON.
  - Payload and local-store contracts are unchanged; strength evidence and keywords, experiences, projects and tieBreakers pass through untouched.
- `css/oneflow.css`: only the `/* ONEFLOW:L2 */` fit block (starts :857, ends before the resume-pill comment, now at :1430). Nothing outside it changed. Everything is scoped under `.oneflow-fit`, uses jb-v2 tokens only (lint:tokens 0 new), switches from one column to two zones through `@container (min-width: 720px)`, and has one focus ring (`--jb-shadow-focus`). The one flourish is strength ranks set in the brand hand (Caveat).
- `tests/gfx-fe-b4-fit-beat.test.mjs` (new, 28 tests).
- Pins that genuinely moved (listed in the commit body):
  - `oneflow-l0-wiring`: headline.
  - `oneflow-l2-fit-beat`: layout, messages, LOCAL-ONLY now POSTs.
  - `oneflow-l6-migration`, `oneflow-l7-routed`, `oneflow-sb2-draft-persistence`: role and strength names only reached textContent through the raw JSON `<pre>`; they now read the fields' values.
  - `e2e-visual/inline-actions`: skips controls with no box, i.e. the collapsed Preferences.
- Screenshots in `.lane-evidence/shots/`:
  - before: `b4-before-{1440,375}*.png`
  - after: `b4-after-{1440,375}-{target,story,strengths,dealbreakers,prefs}.png`, `b4-after-1440-keyboard.png` (focus ring on the handle after ArrowDown), `b4-after-1440-invalid.png`
  - Keyboard and screen-reader audit in the live page: after submitting a short narrative, `document.activeElement` = `oneflow-fit-textarea`, and the audit found 0 unlabelled input/select/textarea/button (`UNLABELLED []`).

## 4. Floor results (paste, do not paraphrase)
```
$ npm run lint:repo
lint:repo exit=0
lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)

$ npm run typecheck:repo
typecheck:repo exit=0

$ node --test tests/gfx-fe-b4-fit-beat.test.mjs tests/oneflow-l2-fit-beat.test.mjs tests/gfx-be-core-fit-profile-*.test.mjs tests/oneflow-l0-*.test.mjs tests/oneflow-l6-*.test.mjs tests/oneflow-l7-*.test.mjs tests/greenfield-*.test.mjs tests/data-integrity-resume-and-saves.test.mjs tests/oneflow-sb2-draft-persistence.test.mjs
node --test exit=0
# tests 379
# suites 97
# pass 379
# fail 0
# cancelled 0
# skipped 0
# todo 0

(extra) node --test tests/oneflow-*.test.mjs tests/sixbeats*.test.mjs tests/jb-a11y-fit-profile-labels.test.mjs tests/ds08-renderer-cutover.test.mjs tests/fit-profile-wizard.test.mjs
# tests 710
# pass 710
# fail 0

$ npm run test:e2e-onboarding
  ✘  1 greenfield-onboarding.spec.mjs:539:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install (5.8s)
  ✓  2 greenfield-remediation.spec.mjs:204:1 › E1 Beat 3 is gated on Beat 2
  ✓  3 greenfield-remediation.spec.mjs:259:1 › E2 Pasted resume survives Escape and reload
  ✓  4 greenfield-remediation.spec.mjs:290:1 › E3 Drawer setup lands in OneFlow
  ✓  5 greenfield-remediation.spec.mjs:304:1 › E4 Beat 1 never punts to Settings
  ✓  6 greenfield-remediation.spec.mjs:320:1 › E5 Payoff is honest
  ✓  7 greenfield-remediation.spec.mjs:364:1 › E6 Settings shows receipts
    Error: network boundary contract violations
    + Array [ "OpenRouter check model openai/gpt-5.4-mini" ]
      at expectCleanRun (greenfield-onboarding.spec.mjs:534:74)  ← called at :620, the end of the test
  1 failed
  6 passed (14.3s)

(the same spec with ONLY the :417 model pin widened to also accept openai/gpt-5.4-mini — .lane-evidence/val/val.spec.mjs)
  ✓  1 val.spec.mjs:539:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install (5.4s)
  1 passed (5.9s)

$ npm run test:e2e-journey
  33 passed (40.9s)

$ gitleaks protect --staged --redact
INF no leaks found
gitleaks exit=0
```

## 5. Unverified / sandbox refused
- **VAL-ONEFLOW-001 is not green as committed: an outside pin, not B4.** B4 now passes :579 (`profileWrites` = 1), and the test runs to its final `expectCleanRun` at :620. There it trips a **B2** check: the spec at :417 pins the OpenRouter check model to `openai/gpt-oss-120b:free`, but `model-catalog.js:91` has recommended `openai/gpt-5.4-mini` since `3ce31667` ("recommend a model strong enough for letters", 2026-09-25, on main). Until now the earlier B4 failure hid it. The fix is outside my fence (the spec's B2 pin, or B2's default model); the integrator should pick. With only that pin widened, the whole test passes (pasted above).
- `e2e-visual/inline-actions` "never break a control's own label" (both viewports) times out in `visual-gate-helpers.mjs:106 goToBeat` on HEAD too (`.lane-evidence/visual-inline-HEAD.txt`). That's pre-existing, and not in my floor. The B4 "Add at natural width" test is green at 1440 and 390.
- Stale schema text: `user-profile.schema.json` says salaryFloor is "used only when salaryRequired=true", but the scorer (`profile-aware-scorer.ts:127-143`) applies the floor to any listed salary on its own. B4's help text and summary follow the scorer. Worth a doc fix by BE.
- Drag-and-drop by mouse is covered by the harness test (dragstart/drop events) and the handle's `draggable`. A real pointer drag in a browser was not screenshotted; keyboard reorder was.
- No `docs/COPY.md` existed in this worktree, so the copy follows the SPEC replacement strings.
- No `index.html` change was needed: the schema and sync modules already load after `profile-api-base.js` (:1434-1436).
