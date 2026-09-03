# LANE REPORT — A · beat3-provider

Branch `feat/greenfield-beat3-provider`, cut from `7addeb4`, then merged with
`origin/main` at `58366b6` (PR #103) on the orchestrator's instruction before the
A3/A4 work landed. Commits: `d49ae09` (§4.1 seam, A1+A2), `955e70f` (merge),
`ab12fb0` (A3+A4). Nothing pushed.

## 1. What this lane was
Beat 3 must draft only with a provider Beat 2 actually verified, and the six-beat
flow must refuse to open a beat whose prerequisite is unmet — `resume` redirects to
`ai`, `payoff` redirects to `google` — while Settings and drawer deep links keep
working through `open(beatId, { returnTo: "close" })`, which closes the shell when
that beat completes instead of walking the visitor forward through the rest of setup.
The lane owns the controller gate (`onboarding-flow.js`), Beat 3's provider guard and
server-reason mapping (`oneflow-beat-resume.js`), and the legacy `/profile/from-resume`
caller in `fit-profile-wizard.js`.

## 2. Which claims went red first

### A1 + A2 — `tests/greenfield-a-gate.test.mjs` (red on the integration base)
```
  ✖ A1-RESUME-GATE: open("resume") with Beat 2 incomplete lands on the AI beat (11.311958ms)
  ✖ A1-RESUME-NOTE: the redirect explains itself in the shell's message slot (4.1515ms)
  ✖ A1-PAYOFF-GATE: open("payoff") with no Google and no sheet lands on Google (2.750542ms)
  ✔ A1-PAYOFF-SHEET: a configured sheetId satisfies the Google prerequisite (2.680833ms)
  ✔ A1-OPEN-DIRECT: beats with no prerequisite are never redirected (16.794208ms)
  ✔ A1-PILL-NOOP: open() resumes the saved beat, and the gate is a no-op there (3.178708ms)
  ✔ A1-S0-FRESH: reconcileStaleCompletion still runs before the gate (3.807208ms)
  ✖ A2-CLOSE: completing a beat opened with returnTo:"close" closes the shell (3.305833ms)
  ✖ A2-TOAST: the close is spoken (3.586833ms)
  ✔ A2-PROGRESS: the completion is still recorded (3.38975ms)
  ✔ A2-UNCHANGED: without the option, completing a beat advances as before (4.802666ms)
  ✔ A2-SCOPED: returnTo only fires for the beat it was opened with (2.963959ms)
  ✖ A2-PASSTHROUGH: goToBeat carries the option too (2.169041ms)
ℹ tests 13
ℹ pass 7
ℹ fail 6
```
The seven that were green on the base are the *unchanged-behavior* guards — the ones
that must still hold after the gate exists (a beat with no prerequisite, the resume
pill's saved beat, the S0 card's fresh-install landing, the ordinary walk-forward).
They are stated as claims precisely because the gate is the kind of change that
breaks them silently. Every claim that asserts the NEW behavior went red.

### A3 + A4 — `tests/greenfield-a-provider-guard.test.mjs` (red after the merge)
```
  ✖ A3-UNSET: nothing configured is not a provider (13.757042ms)
  ✖ A3-EMPTY-KEY: a named provider with no key is not a provider (3.041166ms)
  ✖ A3-EMPTY-LOCAL: Local with no base URL is not a provider (3.056709ms)
  ✖ A3-LOCAL-OK: Local with a base URL and no key IS a provider (2.396ms)
  ✔ A3-VERIFIED: a keyed provider is carried into the POST body (5.816625ms)
  ✖ A3-NO-FETCH: "Draft from this text" makes no /profile/from-resume call (2.382709ms)
  ✖ A3-COPY: the locked copy is what the user reads (2.606583ms)
  ✖ A3-BUTTON: the fix is one button away, and it lands on the AI beat (2.7345ms)
  ✖ A3-NOT-COMPLETE: a beat that drafted nothing is not complete (2.233625ms)
  ✖ A3-RESUME-KEPT: the pasted resume still reaches the browser store (2.892125ms)
  ✖ A4-gemini_not_configured: renders the locked copy, not the server's wording (5.727917ms)
  ✖ A4-profile_provider_not_configured: renders the locked copy, not the server's wording (3.0405ms)
  ✖ A4-GENUINE: a real provider failure still surfaces verbatim (3.141917ms)
  ✖ A4-404: the missing-resume 404 keeps its own copy (2.74525ms)
ℹ tests 14
ℹ pass 1
ℹ fail 13
```
A3-VERIFIED was green on the base — it restates the SIXBEATS-2 NEW-2 contract the
guard must not break. A4-GENUINE and A4-404 were red for a mechanical reason (no
message slot was reached at all before the guard existed), not because their copy
changed; both assert that the *non*-locked failures keep their own words.

### A4, legacy caller — `tests/fit-profile-wizard.test.mjs` (red with the change reverted)
```
  ✖ GREENFIELD A4: forwards the provider block Beat 3 sends (0.959083ms)
  ✔ GREENFIELD A4: sends no provider block when nothing usable is connected (1.638ms)
  ✔ GREENFIELD A4: survives a page where the beat module never loaded (0.729125ms)
ℹ tests 58
ℹ pass 57
ℹ fail 1
```

### All 27 claims green
```
ℹ tests 27
ℹ pass 27
ℹ fail 0
```
(Full per-test listing in `.lane-evidence/A1-A4-green.txt`.)

## 3. What shipped

**In fence**

| File | Fence | What |
|---|---|---|
| `onboarding-flow.js` | `open`, `goToBeat`, `completeBeat`, new `gateBeat`, new `BEAT_PREREQS`/`GATE_NOTES`/`RETURN_TO_TOAST`, `runtime` returnTo bookkeeping | §4.1 seam: `gateBeat` + `hasConfiguredSheet` + `renderGateNote` + `setReturnTo`; `open(beatId, options)` and `goToBeat(id, options)` carry `returnTo`; `completeBeat` closes the shell and toasts "Saved." for the beat a deep link opened. `resolveEntryBeatId` unchanged. `saveDraft`, `flushDrafts`, `handleShellClose` and the `root` export block untouched (lane B). |
| `oneflow-beat-resume.js` | `verifiedProviderConfig`, `draftOnServer`, the message-slot render | A credential (key, or base URL for Local) is now required, not a provider name; `draftOnServer` returns `{locked:true}` with the locked copy instead of firing a doomed request; the server's `*_not_configured` maps to that same locked result; new `resume_connect_ai` action → `ctx.goToBeat("ai")`; `verifiedProviderConfig` + `CONNECT_AI_COPY` exported. Paste textarea and `hydrateFromDrafts` untouched (lane B). |
| `fit-profile-wizard.js` | `fetchProfileFromResume` (`:160-180`) | Reads the one exported definition of "usable provider" and merges the same `{provider, apiKey, model, baseUrl}` block into the POST body; null-safe when the beat module never loaded. |
| `tests/greenfield-a-gate.test.mjs` | new | A1 + A2, 13 claims. |
| `tests/greenfield-a-provider-guard.test.mjs` | new | A3 + A4, 14 claims. |

**Outside the named fence — every one listed, with why.** None of these files is
another lane's fence (`tests/oneflow-l7-sweep.test.mjs:585-605` is lane C's and was
not touched).

| File | Line(s) | Why |
|---|---|---|
| `discovery-status-handoff.js` | `resolveOneFlowEntryBeat` + new `seedMigratedBeats` | **Product regression, not a test artifact.** The §3.3 ladder routes a legacy profile past Beat 2 *after live-verifying its provider*. With the gate and nothing else, that user was bounced straight back to the AI screen they had just proved they did not need. The ladder now says what it verified through the existing `seedRuntime` migration seam (`runtime.migratedBeats`), which `gateBeat` honours. No other lane owns this file. |
| `tests/oneflow-l0-wiring.test.mjs` | 1 setup line | Opened `resume` with Beat 2 never complete — a state the gate makes unreachable. Seeds the prerequisite. No assertion changed. |
| `tests/oneflow-l1-beat-resume.test.mjs` | `openBeat` helper + PR #103's two assertions | Same seed, plus a verified provider config (A3 makes the credential load-bearing). #103's `/AI step/i` assertions become the locked §4.1 copy — see §5. |
| `tests/oneflow-l7-routed.test.mjs` | `ingestResume` + `loadWithResumeDraft` config | Enters at B3 without walking B2; now carries the prerequisite and the credential. |
| `tests/sixbeats-b3-template-escape.test.mjs` | `openBeat` helper | Same. |
| `tests/sixbeats2-beat-provider.test.mjs` | `openResume` helper; one test renamed | "omits the provider block entirely when nothing is configured" asserted that a bodyless POST *should* let the server fall back to its own env — which is exactly finding F1. Superseded by A3: it now asserts no request is made at all. The kickoff's "existing sixbeats2 assertions still pass" holds for every other test in the file, including all four NEW-2 provider-body claims. |
| `tests/oneflow-l6-harness.mjs` | `CommandCenterResumeGenerate` stub | Published only a provider NAME, never a credential, so no journey through this harness could reach Beat 3's drafting path once A3 landed. It now mirrors `resume-generate.js`'s field map off `COMMAND_CENTER_CONFIG` — which `oneflow-beat-ai.js persistProviderConfig` writes into — so `tests/integration/onboarding-chain-convergence.test.mjs` proves the B2→B3 handoff for real instead of around it. |
| `tests/fit-profile-wizard.test.mjs` | +3 tests | A4's legacy-parity claim needs that file's working `loadWizard`; there is no exported harness for `fit-profile-wizard.js`. See §5 for the limits of that suite's older "no secrets" test. |

No new files were added to `index.html`, so the script-order trap does not apply.

## 4. Floor results

Run from the worktree root on `866886e`. All five green. `node_modules` was
already present and Playwright's chromium was already installed — no `npm ci`, no
`npx playwright install`. Full captures in `.lane-evidence/floor-*.txt`.

### `npm test`
```
ℹ tests 3068
ℹ suites 742
ℹ pass 3067
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 13803.59075
```
Exit code 0. The single `todo` is `tests/submission-record-audit.test.mjs`
("persists and can remove the canonical submission evidence record" — *blocked on
the canonical-ownership gate; no legal Sheet column or IndexedDB store*). It is
marked `todo` in the source, loads nothing this lane touched, and fails identically
on the integration base.

### `npm run lint:repo`
```
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```
Exit code 0; `eslint .` printed nothing.

### `npm run typecheck:repo`
```
> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
```
Exit code 0; both `tsc --noEmit` runs and all 80-odd `node --check` passes silent.

### `npm run test:e2e-smoke`
```
Running 7 tests using 1 worker

  ✓  1 tests/e2e-smoke/boot-smoke.spec.mjs:93:1 › greenfield boot produces zero console errors (3.5s)
  ✓  2 tests/e2e-smoke/boot-smoke.spec.mjs:102:1 › every <script src> in the served HTML returns 200 (351ms)
  ✓  3 tests/e2e-smoke/boot-smoke.spec.mjs:128:1 › screen S0 — the demo board — is the cold-start surface, credential gate hidden (339ms)
  ✓  4 tests/e2e-smoke/boot-smoke.spec.mjs:144:1 › demo cards render watermarked, with a fit score and a why-it-fits line (361ms)
  ✓  5 tests/e2e-smoke/boot-smoke.spec.mjs:161:1 › JobBoredOneFlow.open() renders a beat, and its primary action is hittable (419ms)
  ✓  6 tests/e2e-smoke/boot-smoke.spec.mjs:182:1 › requestDiscoverySetup() renders the wizard shell with a usable primary action (458ms)
  ✓  7 tests/e2e-smoke/case-dossier.spec.mjs:227:1 › The Case renders in a real browser from seeded pipeline data (5.9s)

  7 passed (12.0s)
```

### `npm run test:e2e-visual`
```
  ✓  32 tests/e2e-visual/shell-structure.spec.mjs:55:5 › the one shell at 390×844 › should carry a header strip with the flow's title and its Close control (390×844) (685ms)
  ✓  33 tests/e2e-visual/shell-structure.spec.mjs:98:5 › the one shell at 390×844 › should show exactly one progress indicator on every beat (390×844) (4.5s)
  ✓  34 tests/e2e-visual/shell-structure.spec.mjs:166:5 › the one shell at 390×844 › should never scroll sideways on any beat (390×844) (4.4s)
  ✓  35 tests/e2e-visual/shell-structure.spec.mjs:201:5 › the one shell at 390×844 › should keep the shell inside the viewport it was given (390×844) (871ms)
  ✓  36 tests/e2e-visual/shell-structure.spec.mjs:228:3 › the one shell on a phone — claim C7 › should keep every beat's actions reachable without scrolling (4.6s)
  ✓  37 tests/e2e-visual/shell-structure.spec.mjs:310:3 › the one shell on a phone — claim C7 › should dock the footer at the bottom of the viewport, not the bottom of the card (1.1s)

  37 passed (1.0m)
```
The first e2e-visual run of this lane failed 12 of 37 — the gate redirected the
visual gate's cold-start jump into `resume` and `payoff`, so those specs measured
geometry on the wrong screen. `866886e` fixes the helper, not the claims; the run
above is after that fix.

## 5. Anything unverified

1. **One flaky pair, not reproducible.** On one `npm test` run,
   `tests/e2e/profile-flow-smoke.test.mjs` reported two failures ("POST /profile
   saves a valid profile and GET round-trips it" and "POST /profile/from-resume
   drafts a profile through OpenRouter chat JSON with no Gemini key"). Both passed
   when that file ran alone and on every subsequent full run, including the floor
   run above. Both boot the real server against the same `$HOME/.jobbored`, and PR
   #103 added a second suite that does the same
   (`tests/integration/profile-from-resume-unconfigured-provider.test.mjs`) — a
   concurrency race between them is the likely cause. This lane changed no server
   code. Flagged, not fixed.

2. **`tests/fit-profile-wizard.test.mjs` "F2B-PROFILE02-RESUME … without forwarding
   secrets" now overstates its own title.** It asserts `body.apiKey === undefined`,
   and that still holds — but only because its sandbox has neither a configured
   provider nor the beat module. On a real page with a provider verified in Beat 2,
   that caller now DOES forward the key, deliberately (SIXBEATS2 locked decision 3,
   GREENFIELD A4: the browser's verified provider beats the server's env). I left
   the test untouched — its assertions are true in its own sandbox and it is not
   mine to rewrite — and added three explicit `GREENFIELD A4` tests beside it that
   state the real contract. **Recommend the orchestrator retitle it.**

3. **PR #103's sentence is superseded, by the orchestrator's instruction.** Its two
   `oneflow-l1-beat-resume` assertions matched `/AI step/i` on "No AI provider is
   connected yet. Go back to the AI step, connect one, then try drafting again."
   They now assert the locked §4.1 copy verbatim, plus the presence of
   `[data-action-id="resume_connect_ai"]`. The server-side half of #103 (409 for
   both reason codes) is kept as-is and untouched; its hermetic route test passes
   unchanged.

4. **Tone is not locked, so I chose.** The controller's gate note renders at tone
   `info`; Beat 3's refusal renders at tone `error` (which is also what #103's
   surviving `--error` class assertion requires). §4.1 and §4.6 lock the copy and
   the ids, not the tone. Same for the connect button's label — "Connect an AI
   provider" — which no spec section locks.

5. **`data-gate-note` is deliberately transient.** It is stamped on the shell's
   message `<p>` right after `setMessage`, and the shell rebuilds that slot on any
   later `setMessage`. It marks the landing, not a persistent state — lane E should
   assert it on arrival at the redirected beat, before interacting.

6. **A2 closes through `closeShell()` ("flow-complete"), not `close()`.** A deep-link
   completion is not a pause: routing it through `handleShellClose` would emit
   `beat_abandoned`, toast "Setup paused…", and plant the resume pill. It also
   resets `flowOpenEmitted`, so a later re-entry emits `flow_opened` again.

7. **`flow_opened` telemetry now reports the LANDING beat**, not the requested one,
   so the funnel matches what the visitor saw. Nothing downstream reads it as an
   intent.

8. **No real-browser proof of the gate itself.** `npm run test:e2e-onboarding` does
   not exist yet — lane E lands it, and E1 is exactly this claim. What the floor
   does prove in a real browser is that `JobBoredOneFlow.open()` still renders a
   beat with a hittable primary action (e2e-smoke #5) and that every beat's geometry
   survives (e2e-visual, 37 passed).

9. **The `?greenfield=1` reset and the `getConfig()` null-on-bad-sheetId trap were
   both respected.** `hasConfiguredSheet()` reads `window.COMMAND_CENTER_CONFIG`
   directly rather than `getConfig()`, so a malformed sheetId cannot be misread as
   "you never connected Google". When lane D lands `getEffectiveConfig()`, that is
   the better read and this is a one-line swap.

10. **Nothing was pushed.** Four local commits on `feat/greenfield-beat3-provider`
    (`d49ae09`, merge `955e70f`, `ab12fb0`, `866886e`). No sandbox refusal was hit:
    every floor command ran, every commit succeeded, no port failed to bind.

**Definition of Done: met.** A1–A4 went red first (§2) and are green (27/27); the
full floor is green (§4); §4.1 and A1/A2 are in the first commit, A3/A4 in the
third; nothing pushed.
