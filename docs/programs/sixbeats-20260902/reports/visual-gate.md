# LANE REPORT — Q1 visual-gate (SIXBEATS; serial after V1, V2, B1, B2, B3)

Branch `feat/sixbeats-visual-gate`, base `868ce8c` (the integration branch with
all five lanes plus the orchestrator's same-origin `/__proxy` guard fix).
Commits `dcaad59`, `a60beb3`, `8dbffb1` — local only, never pushed.

Fence, per `KICKOFF-Q1-visual-gate.md`: `tests/e2e-journey/**`,
`tests/e2e-smoke/**`, new `tests/e2e-visual/**` (+ its `playwright.config.mjs`
and the one granted `package.json` script), plus the granted U3 fix inside
`css/oneflow.css` CORE. Nothing else in the repo was touched.

---

## 1. What this lane was

The program's visual claims were prose plus a folder of PNGs. Nothing in CI
could tell whether U1, U2, C7 or the four behavioural repairs had quietly come
back. Q1 turns them into gates:

- a **third browser suite**, `tests/e2e-visual/`, run by
  `npm run test:e2e-visual`, that asserts S0 and the shell **structurally** at
  1440×900 and 390×844 — header strip present, invitation card visible on first
  mount, exactly one progress indicator in the shell, no horizontal overflow,
  actions reachable without scrolling on mobile;
- **journey re-pins** for every claim that changed behaviour — C2's back
  action, C4's refresh-resume without the param, C5's pause toast, C3's absent
  `/profile` 404;
- the routed **U3** repair — inline action buttons breaking their own labels
  mid-word — with a bounding-box gate and a before/after pair.

**Pixel diffing is deliberately out.** Fonts rasterize differently on every
machine (and the hermetic fence stubs Google Fonts to an empty body), so a
screenshot baseline would fail for reasons that have nothing to do with the
claims. Every assertion is DOM structure, a bounding box, a scroll width, or a
computed style — the things a designer would actually check with a ruler.

### C1 re-tag, per the kickoff

B2's RCA found the cold-start `appendChild` pageerror does not reproduce, and
that the walkthrough's own media contradicts its prose at the timestamp C1
cites. I verified the app rather than the screenshots, and added **no** new C1
gate: `tests/e2e-smoke/boot-smoke.spec.mjs` already asserts *"greenfield boot
produces zero console errors"* over both `console` errors **and** uncaught
`pageerror`s on `/?greenfield=1`, which is exactly the gate C1 would want, and
B2's `tests/sixbeats-boot-null-parent-toast.test.mjs` keeps the null-guard.
`tests/e2e-smoke/**` was in my fence and needed no change.

---

## 2. Which claims went red first (named tests)

### a. The visual gate, red on the pre-lane build

`ed44f35` (code-identical to `5406698`, the build the spec names) was extracted
to scratch with `git archive`, the new suite copied in, and run there.
**18 of 24 red** — `.lane-evidence/floor/RED-ed44f35-visual.txt`:

```
  18 failed
  6 passed (1.3m)
```

The six that pass are the guards that had to be green all along (the invitation
does open on first mount in a *fresh* context at both sizes, and the pill is
visible when collapsed at both sizes) — they pin regressions rather than claims.

| Claim | Probe (red on `ed44f35`) | What the run reported |
|---|---|---|
| U1 | `S0 …should open on a header strip carrying the wordmark and the sample-pipeline eyebrow` (×2 viewports) | `expect(locator).toBeVisible()` — no `.oneflow-demo__header` node exists |
| U1 | `S0 …should sit the invitation on the framed board, not loose on the page` (×2) | `toBeVisible()` on `.oneflow-demo__frame` — there is no frame; the ask was `position: fixed` to the window |
| U1 | `S0 …should never scroll sideways` (×2) | `Cannot read properties of null (reading 'left')` — the frame box it measures cards against does not exist |
| U2 | `the one shell …should show exactly one progress indicator on every beat` (×2) | `page.evaluate: Cannot read properties of null (reading 'querySelectorAll')` — `.discovery-setup-wizard--spine`, the hook every one-flow shell rule hangs off, does not exist |
| U2 | `the one shell …should carry a header strip with the flow's title and its Close control` (×2) | same absent hook |
| U2 | `the one shell …should keep the shell inside the viewport it was given` (×2) | same absent hook |
| C7 | `the one shell on a phone …should keep every beat's actions reachable without scrolling` | no `__footer--dock` |
| C7 | `the one shell on a phone …should dock the footer at the bottom of the viewport, not the bottom of the card` | `Cannot read properties of null (reading 'bottom')` |
| U3 | `inline beat actions …should never break a control's own label across lines` (×2) | `the walk must actually reach some single-word controls` — zero controls inspected behind the absent hook |
| U3 | `inline beat actions …should keep beat 4's Add controls at their natural width beside the inputs` (×2) | zero `Add` controls found |

Read honestly: on `ed44f35` the U2/C7/U3 probes go red on **absent structure**
rather than on a measured wrong number, because V2's `--spine` hook — which
every shell and beat-content selector in this suite is scoped to — did not
exist yet. That is a real red (the gate cannot pass on a build without the
shell V2 shipped), but the *measured* red that matters for U3 is §2b below, on
the integration build where the hook exists and the button still breaks. The
`inspected > 0` guard inside the U3 probe exists precisely so a future absent
hook fails loudly instead of passing vacuously.

### b. U3, red on the *integration* build — the claim this lane fixes

The four U3 probes are the ones that were red **here**, on `868ce8c`, before
any change of mine. Captured by running the suite at commit `dcaad59` with the
CSS fix withheld (`.lane-evidence/floor/RED-u3-on-integration.txt`):

```
  4 failed
  20 passed (41.2s)
```

```
Error: beat "fit": "Add" wrapped onto 2 lines ([20.09,9.52]) —
{"text":"Add","lines":2,"lineWidths":[20.09,9.52],"width":31.38,"height":50.5,
 "lineHeight":23.25,"flexShrink":"1","overflowWrap":"anywhere","whiteSpace":"normal"}
```

That is the git history too: `dcaad59` lands the gate red on U3, `a60beb3`
turns it green.

### c. The journey re-pins, red on the pre-lane build

Same extracted tree — `.lane-evidence/floor/RED-ed44f35-journey.txt`:

```
  5 failed
  7 passed (33.9s)
```

The **seven** pre-existing journey tests stay green there and here: nothing was
loosened to make room.

| Claim | New journey test | What the run reported on `ed44f35` |
|---|---|---|
| C2 | `should give beat 3's template grid a way back, with the pasted draft intact` | `getByRole('button', { name: 'Back to upload or paste' })` — Expected 1, Received 0 |
| C4 | `should spend the greenfield param once, so a mid-setup refresh resumes instead of resetting` | `the reset param must be spent, not left in the address bar` — `.get("greenfield")` Received `"1"` |
| C5 | `should say on screen that closing the flow paused it` | `the pause has to be announced where the visitor is looking` — `#toastContainer .toast-message` element(s) not found |
| C5 | `should pause to a live corner pill for a visitor who poked around first` | same, on the route the toast's own words describe |
| C3 | `should serve the dashboard's own /profile from the local API, never a static 404` | `same-origin /profile must not fall through to the static host: {"status":404,"body":"Not found"}` — the C3 symptom, verbatim |

---

## 3. What shipped, file-and-fence

### `tests/e2e-visual/` (new — the whole directory is Q1's fence)

- **`playwright.config.mjs`** — mirrors the two existing release-gate configs
  (`testDir: "."`, `testMatch: /.*\.spec\.mjs/`, 90s timeout, serial, list
  reporter, trace/screenshot on failure). `scripts/run-tests.mjs` never picks
  up `.spec.mjs`, so the unit gate stays browser-free.
- **`visual-gate-helpers.mjs`** — the measurement vocabulary: the two
  viewports, `bootColdStart` / `openFlow` / `goToBeat`, `boxOf` /
  `boxOfLocator`, `horizontalOverflow`, `labelGeometry` (a `Range` over a
  control's contents — one client rect per line box), `isInsideViewport`,
  `isInsideBox`, and `settleLayout`.

  `settleLayout` earns its place: the shell and the board animate in, and a box
  read mid-entrance is a box of a surface that is still moving. It measured a
  dock at **850.6px** that settles at **844**. Every geometry assertion here
  would have been a coin flip without it.
- **`s0-structure.spec.mjs`** (claim U1) — 5 probes × 2 viewports: the header
  strip spans the viewport at `top ≈ 0` and carries the wordmark plus the
  verbatim kicker; the invitation is present on first mount (and the pill is
  *not*) with both normative actions wholly inside the viewport; the ask sits
  inside the frame's box; neither the document nor S0's own `overflow: auto`
  root scrolls sideways, and no card escapes the frame; collapsing leaves a
  one-line pill fully on screen with the board still standing.
- **`shell-structure.spec.mjs`** (claims U2, C7) — 4 probes × 2 viewports plus
  2 phone-only. The progress count is the literal claim: a union of every
  selector that has ever said "where you are"
  (`__spine`, `__steps`, `__step-rail`, `__progress`) must total **1** inside
  the shell on **all six beats**, with six segments, exactly one `--current`
  carrying this beat's `data-beat-id`, and no `/step \d+ of \d+/i` text
  anywhere in the shell. Then: no sideways scroll in any of the four nested
  boxes on any beat; the shell inside its viewport; and on the phone, with the
  body scrolled to the top, **every** action button of **every** beat inside
  the 390×844 viewport, the body the one `overflow-y: auto` scroller and the
  frame `visible`, the dock `position: sticky` with its bottom edge at the
  viewport bottom and staying there while the body scrolls to the end.
- **`inline-actions.spec.mjs`** (claim U3) — every button inside a beat's
  content, on all six beats, at both viewports: a label with no whitespace has
  no legitimate break opportunity, so `lines` must be `1` and the button must
  be shorter than two line boxes. Then beat 4 specifically: each `Add` is one
  line, at least as wide as its own label, `flex-shrink: 0`, and its row still
  fits inside the card.

### `package.json` — the one granted edit

`"test:e2e-visual": "playwright test --config tests/e2e-visual/playwright.config.mjs"`.
No new browser JS file, so `typecheck:repo` needed no new `node --check` entry
(ground-rules trap #2).

### `css/oneflow.css`, `/* ONEFLOW:CORE */` region only — the U3 fix

```css
.discovery-setup-wizard--spine .discovery-setup-wizard__step-content button {
  flex-shrink: 0;
  overflow-wrap: normal;
}
```

Root cause, measured rather than guessed: `css/legacy-discovery-setup-wizard.css`
sets `overflow-wrap: anywhere` on `.discovery-setup-wizard__step-content` so an
unbreakable webhook secret or shell command cannot turn a step into a
horizontal scroller. That inherits into every control a beat renders. Beat 4's
chip rows are flex rows whose input carries `width: 100%`, so the button beside
it is squeezed to min-content — and under `overflow-wrap: anywhere`,
min-content is one **character**.

It is **not** a phone-only defect: identical two-line break at 1440×900, where
beat 4's three-column grid is just as narrow. The rule is therefore unconditional
rather than inside the 480px block, and scoped to the one-flow's own `--spine`
hook, so the discovery wizard and the go-live wizard are untouched. Multi-word
labels still wrap between words, and B3's template cards (buttons whose content
is a heading plus a description) are unaffected — they are grid items, so
`flex-shrink` does not apply to them, and `overflow-wrap: normal` only removes
mid-word breaks.

### `tests/e2e-journey/critical-journey.spec.mjs` — five re-pins appended

Listed in §2c. Two details worth naming:

- **C5 asserts both routes back in.** The toast's normative line names "the
  corner pill", but S0 only shows a pill to a visitor who chose *"Poke around
  first"*; one who accepted the invitation outright still has the full
  invitation card when they pause. Both are pinned, so "pick up anytime" holds
  either way. The copy/UI mismatch is reported in §5 — it is outside my fence.
- **C3 is deterministic by construction.** `JOBBORED_API_PORT` is pointed at a
  closed port for that test alone (restored in a `finally`), so the assertion
  is `502 profile_api_unreachable` — the proxy answering — regardless of
  whether the founder's real API happens to be up on :3847. A path the server
  does *not* own is fetched in the same test and must still return
  `404 Not found`, so the pin cannot pass by way of a server that has stopped
  404ing anything. The `/profile` route is registered on the page *after* the
  hermetic fence (Playwright's last-registered route wins), which is the only
  way to reach the real server past the harness's blanket `/profile` stub;
  `route.continue()` preserves `Sec-Fetch-Site: same-origin`, which is what the
  orchestrator's `e20144c` guard needs — verified, since a stripped header
  would have returned 403, not 502.

### Screenshots — `.lane-evidence/`, 1440×900 and 390×844, DPR 2

`before` restores the two property values this lane's CORE rule changes, so the
pair is a true A/B of **this diff on this build** rather than a comparison
against a pre-V1/V2 tree that differed for a dozen other reasons.

| Claim | Before | After | What changed |
|---|---|---|---|
| U3 · 390px | `u3-before-addrow-390x844.png` | `u3-after-addrow-390x844.png` | The green "Ad / d" stack beside "Add a target role" becomes a single "Add" on one line; the button goes 32.05×48.69 → 36.28×26.34. |
| U3 · 1440px | `u3-before-addrow-1440x900.png` | `u3-after-addrow-1440x900.png` | Same break, same fix, at desktop width: 31.38×50.5 → 37.45×27.25, two line boxes → one. |
| U3 · beat 4 in context | `u3-before-beat4-390x844.png`, `u3-before-beat4-1440x900.png` | `u3-after-beat4-390x844.png`, `u3-after-beat4-1440x900.png` | The whole beat, showing every chip row's Add settling onto one line without the card's layout moving. |
| U3 · regression check | — | `u3-after-beat3-390x844.png`, `u3-after-beat3-1440x900.png` | B3's template grid with the fix in force: the four cards keep their two-line descriptions (390px: 324×81.3 each; 1440px: 185×102.3), so the rule did not flatten the one control that is *supposed* to wrap. The same frames double as C2 and C7 evidence — the docked `Back to upload or paste` sits at the bottom of the phone viewport. |

Measured by the shooter itself:

```
before 1440x900 {"text":"Add","lines":2,"lineWidths":[20.09,9.52],"width":31.38,"height":50.5}
before 390x844  {"text":"Add","lines":2,"lineWidths":[19.3,9.14],"width":32.05,"height":48.69}
after  1440x900 {"text":"Add","lines":1,"lineWidths":[29.45],"width":37.45,"height":27.25}
after  390x844  {"text":"Add","lines":1,"lineWidths":[28.28],"width":36.28,"height":26.34}
```

---

## 4. Floor results — PASTED output

```
$ npm test            # scripts/run-tests.mjs — exit 0
ℹ tests 2667
ℹ suites 644
ℹ pass 2666
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6964.661

✖ failing tests:

test at tests/submission-record-audit.test.mjs:17:1
✖ persists and can remove the canonical submission evidence record (2.004583ms) # blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store
```

(The single `todo` is the pre-existing `submission-record-audit` case the other
lanes report too. It is `todo`, not a failure — `npm test` exits 0.)

```
$ npm run lint:repo   # exit 0

> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```

```
$ npm run typecheck:repo   # exit 0
> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
```

```
$ npm run test:contract:all   # exit 0
OK schema (discovery request): examples/discovery-request.v1.json
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
```

```
$ npm run test:e2e-visual   # exit 0 — the new gate
Running 24 tests using 1 worker
  ✓   1 inline-actions.spec.mjs › inline beat actions at 1440×900 › should never break a control's own label across lines (1440×900)
  ✓   2 inline-actions.spec.mjs › inline beat actions at 1440×900 › should keep beat 4's Add controls at their natural width beside the inputs (1440×900)
  ✓   3 inline-actions.spec.mjs › inline beat actions at 390×844 › should never break a control's own label across lines (390×844)
  ✓   4 inline-actions.spec.mjs › inline beat actions at 390×844 › should keep beat 4's Add controls at their natural width beside the inputs (390×844)
  ✓   5 s0-structure.spec.mjs › S0 at 1440×900 › should open on a header strip carrying the wordmark and the sample-pipeline eyebrow (1440×900)
  ✓   6 s0-structure.spec.mjs › S0 at 1440×900 › should show the invitation card on first mount with both actions on screen (1440×900)
  ✓   7 s0-structure.spec.mjs › S0 at 1440×900 › should sit the invitation on the framed board, not loose on the page (1440×900)
  ✓   8 s0-structure.spec.mjs › S0 at 1440×900 › should never scroll sideways (1440×900)
  ✓   9 s0-structure.spec.mjs › S0 at 1440×900 › should leave a fully visible pill behind when the ask is collapsed (1440×900)
  ✓  10 s0-structure.spec.mjs › S0 at 390×844 › should open on a header strip carrying the wordmark and the sample-pipeline eyebrow (390×844)
  ✓  11 s0-structure.spec.mjs › S0 at 390×844 › should show the invitation card on first mount with both actions on screen (390×844)
  ✓  12 s0-structure.spec.mjs › S0 at 390×844 › should sit the invitation on the framed board, not loose on the page (390×844)
  ✓  13 s0-structure.spec.mjs › S0 at 390×844 › should never scroll sideways (390×844)
  ✓  14 s0-structure.spec.mjs › S0 at 390×844 › should leave a fully visible pill behind when the ask is collapsed (390×844)
  ✓  15 shell-structure.spec.mjs › the one shell at 1440×900 › should carry a header strip with the flow's title and its Close control (1440×900)
  ✓  16 shell-structure.spec.mjs › the one shell at 1440×900 › should show exactly one progress indicator on every beat (1440×900)
  ✓  17 shell-structure.spec.mjs › the one shell at 1440×900 › should never scroll sideways on any beat (1440×900)
  ✓  18 shell-structure.spec.mjs › the one shell at 1440×900 › should keep the shell inside the viewport it was given (1440×900)
  ✓  19 shell-structure.spec.mjs › the one shell at 390×844 › should carry a header strip with the flow's title and its Close control (390×844)
  ✓  20 shell-structure.spec.mjs › the one shell at 390×844 › should show exactly one progress indicator on every beat (390×844)
  ✓  21 shell-structure.spec.mjs › the one shell at 390×844 › should never scroll sideways on any beat (390×844)
  ✓  22 shell-structure.spec.mjs › the one shell at 390×844 › should keep the shell inside the viewport it was given (390×844)
  ✓  23 shell-structure.spec.mjs › the one shell on a phone — claim C7 › should keep every beat's actions reachable without scrolling
  ✓  24 shell-structure.spec.mjs › the one shell on a phone — claim C7 › should dock the footer at the bottom of the viewport, not the bottom of the card

  24 passed (41.9s)
```

```
$ npm run test:e2e-journey   # exit 0
Running 12 tests using 1 worker
  ✓   1 should open a zero-config visit on the demo board, not a credential ask (544ms)
  ✓   2 should collapse the invitation to a corner pill that still opens the flow (423ms)
  ✓   3 should enter the one shell at beat 1 with the six-beat spine when the visitor accepts (475ms)
  ✓   4 should treat closing the flow as pausing — Esc returns to the board and re-entry resumes the saved beat (701ms)
  ✓   5 should never show the one-flow to a user who already finished setup (652ms)
  ✓   6 should show queued, running, and partial discovery outcomes (2.1s)
  ✓   7 should carry completed discovery into the pipeline and ready dossier materials (8.2s)
  ✓   8 should give beat 3's template grid a way back, with the pasted draft intact (1.1s)
  ✓   9 should spend the greenfield param once, so a mid-setup refresh resumes instead of resetting (692ms)
  ✓  10 should say on screen that closing the flow paused it (491ms)
  ✓  11 should pause to a live corner pill for a visitor who poked around first (461ms)
  ✓  12 should serve the dashboard's own /profile from the local API, never a static 404 (279ms)

  12 passed (16.2s)
```

```
$ npm run test:e2e-smoke   # exit 0
Running 6 tests using 1 worker
  ✓  1 greenfield boot produces zero console errors (3.5s)
  ✓  2 every <script src> in the served HTML returns 200 (330ms)
  ✓  3 screen S0 — the demo board — is the cold-start surface, credential gate hidden (303ms)
  ✓  4 demo cards render watermarked, with a fit score and a why-it-fits line (322ms)
  ✓  5 JobBoredOneFlow.open() renders a beat, and its primary action is hittable (445ms)
  ✓  6 requestDiscoverySetup() renders the wizard shell with a usable primary action (399ms)

  6 passed (5.8s)
```

Raw logs: `.lane-evidence/floor/`.

---

## 5. Anything unverified, and what needs routing

1. **The C5 toast names chrome that is not always on screen — out of fence.**
   The normative line is *"Setup paused — pick up anytime from the corner
   pill."* But S0 only renders a pill after *"Poke around first"*; a visitor
   who accepted the invitation outright and then pressed Escape is looking at
   the full invitation card, with no pill anywhere. The promise is kept (the
   card resumes the paused beat — pinned) but the words point at something
   absent. Fix belongs in `onboarding-flow.js` (B3's close hook, copy) or
   `oneflow-demo-board.js` (V1) — both outside my fence. My tests pin the
   behaviour on both routes so either resolution stays green.

2. **`eslint .` lints `.lane-evidence/` — repo-wide, not mine to fix.**
   `eslint.config.mjs`'s `ignores` list covers `tmp/**` but not
   `.lane-evidence/**`, which the ONEFLOW ground rules mandate as the scratch
   directory. Any lane that keeps a `.mjs` probe there fails `lint:repo`
   locally with `'document' is not defined` (CI is unaffected: the directory is
   gitignored, so it does not exist there). I worked around it by moving my
   probe and shooter scripts out of the repo into the session scratchpad —
   `.lane-evidence/` here holds only PNGs and floor logs. Suggested routing:
   add `".lane-evidence/**"` beside `"tmp/**"` in `eslint.config.mjs`.

3. **`eslint.config.mjs` grants browser globals to `tests/e2e-smoke/**` only.**
   `tests/e2e-visual/**` is not in that block, so every `page.evaluate` body in
   the new suite prefixes `globalThis.` (`globalThis.document`,
   `globalThis.getComputedStyle`, …). That matches how
   `critical-journey.spec.mjs` and `hermetic-harness.mjs` already write theirs,
   so it is the codebase's convention rather than a workaround — but if the
   orchestrator prefers, adding `tests/e2e-visual/**` to that block would let
   the prefixes go.

4. **One flake observed, not reproduced.** The *first* `npm test` run of the
   session reported 5 failures, all in
   `tests/server-hosted-auth-boundary.test.mjs`, immediately after a Playwright
   run had been using loopback ports. The suite passes alone
   (`node --test tests/server-hosted-auth-boundary.test.mjs` → 5/5) and every
   subsequent `npm test` was 2666/0/1-todo. It looks like port contention, not
   a regression — no change of mine touches that surface — but it is recorded
   rather than smoothed over.

5. **`?greenfield=1` in the visual suite's `bootColdStart`.** The gate boots
   every case through the greenfield reset, which is the surface spec §4 is
   written about. It does **not** exercise a machine with a real `config.js`;
   that path stays covered by the journey's `bootSignedIn`.

6. **Not asserted: colour, type scale, spacing values.** The gate stops at
   structure and geometry on purpose. V1's own unit suite
   (`tests/sixbeats-v1-s0-visual.test.mjs`) already pins the cascade fix and
   the token usage at the CSS level, which is the right layer for that; adding
   computed-colour assertions here would duplicate it and break on any theme
   work.

7. **`npm run test:e2e-visual` is not wired into CI.** The kickoff's DoD is the
   three suites green locally, which they are. Adding the job to
   `.github/workflows/` is outside my fence — routing note for the
   orchestrator, alongside the existing advisory posture of the smoke and
   journey suites (`docs/HERMETIC-BROWSER-GATE.md`).
