# LANE REPORT — B · `beat3-drafts` (claims B1–B4)

Branch `feat/greenfield-beat3-drafts`, cut from the integration base `7addeb4`
(main @ `b5bc7fe` + the program docs). Committed locally; never pushed.

---

## 1. What this lane was

GREENFIELD finding F2: a resume pasted into Beat 3 was lost on Escape + reload,
because the only save path was the textarea's `input` listener, the IndexedDB
write behind it was debounced 400 ms, and `handleShellClose` fired
`flushDrafts()` without awaiting it — so every route out of the beat had a
window in which the typed text existed only in a transaction nobody was waiting
on. This lane closes that window with spec §4.2's synchronous localStorage
mirror (`jb_oneflow_draft_resumeText`, `{ text, at }`), saves on `input` /
`change` / `paste`, awaits the flush on close, flushes on `pagehide`, prefers
the mirror on hydrate, and clears it only from the flow's single reset path.

---

## 2. Which claims went red first

Both new suites were run against the base implementation of
`onboarding-flow.js`, `oneflow-beat-resume.js` and `user-content-store.js`
(the three files restored to `7addeb4` for the run, then restored). Full
output in `.lane-evidence/red-b1-b3.txt` and `.lane-evidence/red-b4.txt`.

### B1–B3 — `node --test tests/greenfield-b-draft-mirror.test.mjs`

```
ℹ tests 13
ℹ pass 1
ℹ fail 12

✖ failing tests:
✖ B1-EVENTS-SAVE: input, change and paste each call saveDraft("resumeText", …)
✖ B1-MIRROR-SYNC: the mirror holds { text, at } before the 400 ms debounce fires
✖ B1-MIRROR-SYNC-STATE: the IndexedDB copy is still empty at that moment
✖ B1-MIRROR-CAP: the mirror caps at 100 000 chars, like the store it shadows
✖ B1-CONTROLLER-MIRRORS: flow.saveDraft mirrors even when the beat is not on screen
✖ B2-EXPORT: root.flushDrafts is a function
✖ B2-CLOSE-AWAITS: handleShellClose lands the draft BEFORE the pause toast
✖ B2-PAGEHIDE: a pagehide event flushes the pending drafts
✖ B3-MIRROR-ONLY: an empty drafts bag and a full mirror renders the mirror text
✖ B3-MIRROR-WINS: with both present the mirror wins — it is never staler
✖ B3-CLEAR: clearOnboardingFlowState removes the mirror key
✖ B3-CLEAR-ONLY-THERE: a beat transition does not clear the mirror
```

The assertion messages, in order:

```
AssertionError: F2: a resume that arrived by paste or by a programmatic set was never saved — only typing was
AssertionError: jb_oneflow_draft_resumeText must exist synchronously after the event
AssertionError: the unload paths need the flush the controller kept private
AssertionError: F2: the close path fired flushDrafts() and never waited for it
AssertionError: §4.2: one pagehide listener, registered once
AssertionError: the reload repro: IndexedDB never got the last burst, the mirror did
AssertionError: precondition: the mirror is written
```

The one green-before-implementation test is `B3-DRAFTS-STILL-WORK`, which is a
deliberate regression guard on the existing drafts-bag hydrate, not a claim.

### B4 — `npx playwright test --config tests/e2e-visual/playwright.config.mjs greenfield-b3-reload`

```
Running 4 tests using 1 worker

  ✘  1 greenfield-b3-reload.spec.mjs:109:5 › a Beat 3 resume typed with locator.type() › should survive Escape and a reload (typed with locator.type()) (2.0s)
  ✘  2 greenfield-b3-reload.spec.mjs:109:5 › a Beat 3 resume set programmatically with locator.fill() › should survive Escape and a reload (set programmatically with locator.fill()) (1.5s)
  ✘  3 greenfield-b3-reload.spec.mjs:156:3 › the Beat 3 resume under prefers-reduced-motion › should survive Escape and a reload with motion suppressed (6.2s)
  ✘  4 greenfield-b3-reload.spec.mjs:191:3 › the mirror's clearing rule › should be cleared by the flow's reset path and by nothing else (1.5s)

  Error: jb_oneflow_draft_resumeText must hold the text before anything else
  expect(received).not.toBeNull()
  Received: null

  4 failed
```

### Then green

```
tests/greenfield-b-draft-mirror.test.mjs   ℹ tests 13  ℹ pass 13  ℹ fail 0
tests/e2e-visual/greenfield-b3-reload.spec.mjs   4 passed (7.4s)
```

---

## 3. What shipped

| File | Fence | Change |
|---|---|---|
| `onboarding-flow.js` | `saveDraft`, new mirror helpers beside `flushDrafts`, `handleShellClose`, the `root` export block | `DRAFT_MIRROR_KEY = "jb_oneflow_draft_resumeText"` + `DRAFT_MIRROR_TEXT_MAX = 100000`; `mirrorStorage` / `writeDraftMirror` / `readDraftMirror` / `ensureUnloadFlush`; `saveDraft` writes the mirror synchronously for `resumeText` **before** the debounce and registers the one-time `pagehide` flush; `handleShellClose` is now `async` and `await`s `flushDrafts()` before the pause toast; exports `flushDrafts`, `writeDraftMirror`, `readDraftMirror`. |
| `oneflow-beat-resume.js` | `hydrateFromDrafts`, the paste textarea block, new mirror helpers | `writePasteMirror` / `readPasteMirror` delegate to the controller; the paste box records on `input`, `change` and `paste` (the paste handler re-reads on the next turn, since the clipboard lands after the handler returns); `hydrateFromDrafts` reads the mirror first and falls back to the drafts bag. |
| `user-content-store.js` | `clearOnboardingFlowState` only | removes `jb_oneflow_draft_resumeText` from localStorage after resetting the flow state — the single reset path §4.2 names. |
| `tests/greenfield-b-draft-mirror.test.mjs` | new | 13 probes, B1–B3. |
| `tests/e2e-visual/greenfield-b3-reload.spec.mjs` | new | 4 real-browser probes, B4: `locator.type()`, `locator.fill()`, reduced motion, and the clearing rule. |
| `tests/oneflow-l0-controller.test.mjs`, `tests/oneflow-sb2-draft-persistence.test.mjs`, `tests/sixbeats-b3-close-pauses.test.mjs` | **outside the fence — see §5** | one awaited tick added after each `close()` / Escape, because the close path now awaits the flush before it toasts, pills, and emits. No assertion was changed or weakened. |

No new `<script>` tag: nothing new was added to `index.html` — all three source
changes are inside files it already loads.

---

## 4. Floor results

Run from the worktree root on the committed tree (`e81284c`).

### `npm test` — exit 0

```
ℹ tests 3046
ℹ suites 738
ℹ pass 3045
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 14561.408458
```

The single `todo` is pre-existing and untouched by this lane:
`tests/submission-record-audit.test.mjs` › “persists and can remove the
canonical submission evidence record” — `# blocked on the canonical-ownership
gate; no legal Sheet column or IndexedDB store`. It loads none of this lane's
files.

### `npm run lint:repo` — exit 0

```
> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```

### `npm run typecheck:repo` — exit 0

```
> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
```

(plus the `node --check` sweep, which includes `onboarding-flow.js`,
`oneflow-beat-resume.js` and `user-content-store.js` — all clean.)

### `npm run test:e2e-smoke` — exit 0

```
Running 7 tests using 1 worker

  ✓  1 boot-smoke.spec.mjs:93:1 › greenfield boot produces zero console errors (3.5s)
  ✓  2 boot-smoke.spec.mjs:102:1 › every <script src> in the served HTML returns 200 (491ms)
  ✓  3 boot-smoke.spec.mjs:128:1 › screen S0 — the demo board — is the cold-start surface, credential gate hidden (379ms)
  ✓  4 boot-smoke.spec.mjs:144:1 › demo cards render watermarked, with a fit score and a why-it-fits line (373ms)
  ✓  5 boot-smoke.spec.mjs:161:1 › JobBoredOneFlow.open() renders a beat, and its primary action is hittable (486ms)
  ✓  6 boot-smoke.spec.mjs:182:1 › requestDiscoverySetup() renders the wizard shell with a usable primary action (500ms)
  ✓  7 case-dossier.spec.mjs:227:1 › The Case renders in a real browser from seeded pipeline data (5.9s)

  7 passed (12.6s)
```

### `npm run test:e2e-visual` — exit 0

```
  41 passed (1.2m)
```

41 = the suite's previous 37 plus this lane's 4. Full listing in
`.lane-evidence/floor-e2e-visual.txt`.

---

## 5. Anything unverified

**Definition of Done: MET.** B1–B4 red then green, full floor pasted, committed
locally, not pushed. Nothing was skipped, filtered, or marked `.skip`.

Three things the orchestrator should know:

1. **Three test files were edited outside the fence.** Making `handleShellClose`
   `async` (claim B2, kickoff wording: "`handleShellClose` awaits `flushDrafts()`
   before the pause toast") moves the pause toast, the resume pill, and the
   `beat_abandoned` emission one turn later than the `close()` call. Seven
   existing tests asserted them synchronously and went red. The lines added are:
   - `tests/oneflow-l0-controller.test.mjs` — a local `closeSettled()` helper and
     `await closeSettled();` after two closes.
   - `tests/oneflow-sb2-draft-persistence.test.mjs` — `await settle();` after four
     `close("escape")` calls (`settle` was already imported).
   - `tests/sixbeats-b3-close-pauses.test.mjs` — a local `closeSettled()` helper
     and `await closeSettled();` after three closes.

   No assertion text, expectation, or subject was changed. This is unavoidable
   for B2 as specified: nothing else in the repo can observe the flush landing
   before the toast.

2. **The `pagehide` listener registers lazily from `saveDraft`, not from the
   shell-open path.** §4.2 says "registered once when the shell opens", but the
   shell opens in `goToBeat`, which lane A owns and is adding a gate to. It is
   registered on the first draft instead — strictly later than the shell opens,
   strictly before there is anything to lose, and still exactly once
   (`B2-PAGEHIDE` pins the count at 1). If lane A would rather it sat in
   `goToBeat`, it is a two-line move.

3. **`?greenfield=1` does not clear the mirror.** `maybeApplyGreenfieldUrlReset`
   (`config-overrides.js:536-560`) removes four named localStorage keys and drops
   the IndexedDB store directly — it never calls `clearOnboardingFlowState`, so a
   greenfield reset leaves a previous install's resume draft in the mirror.
   `config-overrides.js` is outside this lane's fence, so it was not touched. The
   exact line a fix would add, inside that function's first `try`:
   `localStorage.removeItem("jb_oneflow_draft_resumeText");`
   Impact is low: `hydrateFromDrafts` only ever fills an **empty** textarea, and
   `?greenfield=1` is a dev/dogfooding switch. Flagging rather than fixing.

Nothing was refused by the sandbox. `node_modules` and the Playwright chromium
build were both already present; neither `npm ci` nor
`npx playwright install` was needed. The commit succeeded.

Evidence files kept in `.lane-evidence/`:
`red-b1-b3.txt`, `red-b4.txt`, `green-b1-b3.txt`, `green-b4.txt`,
`floor-npm-test.txt`, `floor-lint.txt`, `floor-typecheck.txt`,
`floor-e2e-smoke.txt`, `floor-e2e-visual.txt`.
