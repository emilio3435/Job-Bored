# LANE REPORT — verify-green (claims E1–E6 + VAL-ONEFLOW-001)

## 1. What this lane was
Make every test in `tests/e2e-onboarding/` green against the fully merged greenfield
integration branch by fixing the TESTS, not the product. Lanes A–F have landed and the
product is the reference; the two Codex lanes that authored these specs could not run
Playwright, which is why the specs miss.

## 2. Which claims went red first
Reproduced the orchestrator's base red on this branch before touching anything
(`.lane-evidence/verify-green-red-base.txt`, identical to
`.lane-evidence/integration-onboarding-run.txt`): **5 failed, 2 passed (2.3m)**.

```
  ✘  1 tests/e2e-onboarding/greenfield-onboarding.spec.mjs:503:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install (1.5m)
  ✘  2 tests/e2e-onboarding/greenfield-remediation.spec.mjs:195:1 › E1 Beat 3 is gated on Beat 2 (17.7s)
  ✘  3 tests/e2e-onboarding/greenfield-remediation.spec.mjs:250:1 › E2 Pasted resume survives Escape and reload (1.9s)
  ✓  4 tests/e2e-onboarding/greenfield-remediation.spec.mjs:281:1 › E3 Drawer setup lands in OneFlow (1.8s)
  ✓  5 tests/e2e-onboarding/greenfield-remediation.spec.mjs:295:1 › E4 Beat 1 never punts to Settings (884ms)
  ✘  6 tests/e2e-onboarding/greenfield-remediation.spec.mjs:311:1 › E5 Payoff is honest (16.4s)
  ✘  7 tests/e2e-onboarding/greenfield-remediation.spec.mjs:339:1 › E6 Settings shows receipts (2.1s)
```

Each red, and the diagnosis that made it green:

| id | Red | Diagnosis (verified in source, not assumed) |
|---|---|---|
| VAL-ONEFLOW-001 | `page.waitForFunction` timeout at `stageHarnessAuth` (90s) | The predicate waited on `JobBoredApp.core.host.initAuth`. `bridge-registry.js` splits the host by consumer: `initAuth` is published on `app.bootstrap.host` (`:212`); `app.core.host` (`:481`) never gets it. The wait could not terminate. |
| E1 | `locator('#oneFlowMount button').filter({ hasText: /connect ai/i })` not found | The shell stamps beat actions with `data-action-id` (`discovery-wizard-shell.js:990-992`). The action is `resume_connect_ai` labelled "Connect an AI provider" (`oneflow-beat-resume.js:48,58`) — no substring "connect ai". |
| E2 | strict-mode violation on `getByText(PAUSE_TOAST)` → 2 elements | Every toast is spoken twice: the visible `#toastContainer` span and the singleton visually-hidden live region `jb-a11y.js announce()` (`:132`) writes to. |
| E5 | `payoff_connect_google` not found; the shell was on Beat 1 with `[data-gate-note="google"]` | Two causes. (a) `saveOnboardingFlowState` writes straight to the store, but `onboarding-flow.js hydrate()` (`:254`) is memoised per load, so the gate never saw `completedBeats: ["google"]`. (b) Blanking only `core.host.getSheetId` leaves `core.getSHEET_ID` answering `""`, which makes `sheetConfigured()` return **false** (`:514-536`) — and a false answer makes the persisted Beat 1 receipt *stale*, so `reconcileStaleCompletion()` (`:543`) wipes `completedBeats` before `gateBeat` runs. |
| E6 | strict-mode violation on `getByText("Saved.")` → 2 elements | Same toast/live-region duplication as E2. E6 had already reached "Saved.", so the return-to-close seam was fine. |

## 3. What shipped
Tests only. No product file, no harness file (`tests/e2e-fixtures/hermetic-harness.mjs`
is untouched — no harness fix was required).

| File | Fence | Change |
|---|---|---|
| `tests/e2e-onboarding/greenfield-remediation.spec.mjs` | in fence | Added a `toast()` helper scoping toast assertions to `#toastContainer` (E2, E6); E1 selects `resume_connect_ai` by action id; E5 reboots after the store write and drops all three Sheet getters so `sheetConfigured()` answers "unknown" instead of "no". |
| `tests/e2e-onboarding/greenfield-onboarding.spec.mjs` | in fence | `stageHarnessAuth` now drives lane C's Beat 1 detour through visible controls (open `<details>`, fill `#oneFlowOauthClientIdInput`, "Save Client ID", assert the success line) and waits on the real `bootstrap.host.initAuth` seam; added an `action()` helper; replaced the three-way "any payoff primary" locator with the specific primary this walk earns plus proof that neither readiness detour renders. Dropped the now-unused `AUTH` constant. |

## 4. Floor results

`npm run test:e2e-onboarding` (`.lane-evidence/verify-green-final.txt`):

```
> command-center@0.1.0 test:e2e-onboarding
> playwright test --config tests/e2e-onboarding/playwright.config.mjs


Running 7 tests using 1 worker

  ✓  1 tests/e2e-onboarding/greenfield-onboarding.spec.mjs:520:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install (5.2s)
  ✓  2 tests/e2e-onboarding/greenfield-remediation.spec.mjs:204:1 › E1 Beat 3 is gated on Beat 2 (2.6s)
  ✓  3 tests/e2e-onboarding/greenfield-remediation.spec.mjs:259:1 › E2 Pasted resume survives Escape and reload (4.8s)
  ✓  4 tests/e2e-onboarding/greenfield-remediation.spec.mjs:292:1 › E3 Drawer setup lands in OneFlow (1.8s)
  ✓  5 tests/e2e-onboarding/greenfield-remediation.spec.mjs:306:1 › E4 Beat 1 never punts to Settings (1.2s)
  ✓  6 tests/e2e-onboarding/greenfield-remediation.spec.mjs:322:1 › E5 Payoff is honest (1.6s)
  ✓  7 tests/e2e-onboarding/greenfield-remediation.spec.mjs:366:1 › E6 Settings shows receipts (2.4s)

  7 passed (20.6s)
EXIT:0
```

`npm run lint:repo` (`.lane-evidence/verify-green-lint.txt`):

```
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills


> command-center@0.1.0 lint:js
> eslint .


> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
EXIT:0
```

`npm test` (the real root gate; `.lane-evidence/verify-green-npm-test.txt`) — run because
these changes sit under `tests/`, even though the kickoff's DoD names only the two above:

```
ℹ tests 3156
ℹ suites 767
ℹ pass 3155
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 15837.973666
EXIT:0
```

The single `todo` is pre-existing and unrelated to this lane —
`tests/submission-record-audit.test.mjs:17` "persists and can remove the canonical
submission evidence record", marked `# blocked on the canonical-ownership gate; no legal
Sheet column or IndexedDB store". It is a `todo`, so `fail` is 0 and the gate exits 0.

`npm run test:e2e-onboarding` was run a second time end to end and passed 7/7 again
(19.5s) — no flake in the reboot-dependent E5 or the detour-driven journey.

## 5. Anything unverified / product lines this lane could not write

### 5.1 PRODUCT BUG — lane F's greenfield GIS init never runs (`oneflow-beat-google.js:377`)
Driving Beat 1's detour through visible controls (fill the Client ID, click **Save Client ID**)
saves the id and prints "Client ID saved. Continue with Google below." — but GIS is **never
initialized**, so "Continue with Google" cannot sign anyone in on a fresh install. Probed live
in the browser on this branch:

```
{"coreHostInitAuth":"undefined","coreHostApply":"function","bootstrapInitAuth":"function",
 "gisLoaded":false,"applyResult":false,
 "savedClientId":"jobbored-onboarding-e2e.apps.googleusercontent.com"}
```

`saveClientId` calls `applyOAuthClientChange`, which returns `false` on a greenfield boot
(`auth-session.js:618-625` — `gisLoaded` is still false). Lane F added the correct repair
behind that (`8be33a0`), but it goes through `call()`, which resolves against
`window.JobBoredApp.core.host` — and `bridge-registry.js` does **not** publish `initAuth`
there. `initAuth` is only on `app.bootstrap.host` (`bridge-registry.js:212`). Lane F's two
new unit tests pass because their jsdom host stub *does* expose `initAuth`.

Exact line, and the reason, for whoever owns the product fence:

```js
// bridge-registry.js — inside `app.core.host = { … }` (:481)
      initAuth: host.initAuth,
```
Reason: `oneflow-beat-google.js:377` `call("initAuth")` is a silent no-op without it, so the
greenfield Client ID save that lane F shipped does not arm GIS.

This is a product line, outside my fence, so I did not write it. The journey test therefore
drives the detour for real, asserts the save, and then arms GIS through the bridge seam that
does exist (`bootstrap.host.initAuth`), with the whole diagnosis in a comment at the call
site so the workaround disappears the moment the product line lands.

### 5.2 VAL-ONEFLOW-001 does not end on `payoff_run_now` (kickoff clause not met as written)
The kickoff asked the journey to "end on `payoff_run_now` when a Sheet and roles exist".
On this walk a Sheet and roles both exist — and the product still does not render
`payoff_run_now`, by design: `oneflow-beat-payoff.js buildActions` checks the **connect
skip first** (SIXBEATS spec §5 B6, "the primary flips with the connect skip") and only an
unskipped payoff adapts to GREENFIELD §4.3 readiness. The journey reaches Beat 6 through
Beat 5's `oneflow_discovery_skip_connect`, so the honest primary is "Go to my dashboard"
with "Actually — connect discovery" beside it.

Reaching `payoff_run_now` would require the journey to *complete* the discovery
connection, which means either the Tailscale auto path (`/__proxy/tailscale-state`,
`/__proxy/discovery-webhook-secret`, `/__proxy/discovery-state`, `/__proxy/full-boot`,
tailscale-serve, then a webhook verification) or the manual paste path
(`verifyDiscoveryEndpointForFlow` → `handleDiscoveryWizardVerification` → the shared
engine-state classifier). The journey's own fence deliberately answers every other
`/__proxy/*` with `recommendation: "needs_human"`; mocking a whole Tailscale machine and a
webhook handshake to manufacture a green primary would be asserting a fantasy, so I did not.

Instead of the previous three-way "any payoff primary is fine" locator — which could not
fail for any of the three readiness states and so tested nothing — the journey now asserts
the primary this walk actually earns **and** that neither readiness detour renders
(`payoff_connect_google` and `payoff_fix_fit` both count 0) plus the two receipt lines
("Pipeline sheet connected", "AI connected — OpenRouter"). That is strictly stronger than
what it replaced and it is true.

If the orchestrator wants the literal clause, the decision is a spec one — GREENFIELD §4.3
vs SIXBEATS §5 B6 — and it is a product change to `buildActions`, not a test change.

### 5.3 Nothing else
No sandbox refusals: Playwright ran headless, the loopback dev server bound fine, and the
commit succeeded. `.lane-evidence/` and `LANE-REPORT-*.md` are both gitignored
(`.gitignore:79-80`), so the evidence stays local by design. Committed locally; never pushed.
