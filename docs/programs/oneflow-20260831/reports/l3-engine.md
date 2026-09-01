# LANE REPORT — L3 (engine · Beat 5: fuel + connect)

Program: ONEFLOW 2026-08-31 · Kickoff: `docs/programs/oneflow-20260831/KICKOFF-L3-engine.md`
Spec: `docs/ONE-FLOW-ONBOARDING-SPEC.md` §5 B5 (+ §10 Phase 0) · Substrate: `docs/programs/oneflow-20260831/SUBSTRATE.md`
Branch: `feat/oneflow-engine` · Commits: `7a7f003`, `9b29214` (local only, never pushed)

## 1. What this lane was

Beat B5 — the one that turns a *configured* JobBored into a *working* one.

Two panels, read in order. **Fuel** (SerpApi, required, no skip): the key is
written into the discovery worker's env, the worker is force-restarted so it
loads it, and the outcome is rendered — the silent `Save key` it replaces is
the Phase-0 defect the spec names. **Connect** (Tailscale, skippable): dimmed
and inert until the fuel passes, then one click drives the same one-click
sequence `discovery-wizard-ui.js` already ran, now with the spec's four
normative stage lines on screen while it runs.

Plus the Phase-0 repairs to the *standalone* discovery wizard in the same
files: autodetect no longer skips onboarding and no longer reports itself
through a toast the wizard covers; `Set it up for me` and `Fix setup` get real
in-flight states; and the verifier's catch-all error names a next action.

## 2. Which claims went red first (named tests)

All 33 probes were written and run red before any implementation
(`.lane-evidence/red-l3-probes.txt`: `tests 33 / pass 0 / fail 33`). The load-
bearing ones:

**`tests/oneflow-l3-beat-discovery.test.mjs`**
- `the connect panel renders dimmed and its actions are inert before the fuel passes`
- `clicking the inert connect action before fuel never touches the network`
- `skipping is impossible before the fuel passes — the key ask has no escape`
- `writes SERPAPI_API_KEY server-side, restarts the worker, and reports success in the message slot`
- `renders both stages live while the key is saved` (asserts the stage list is
  on screen *during* the fetch, not after)
- `a failed env write reports the failure and leaves the connect panel gated`
- `emits key_check {beat, source, ok, ms} for both outcomes (spec §9)`
- `renders the four normative stage lines, autodetect first, in order`
- `a blocked Tailscale keeps its honest copy and its Download/Re-check next action`
- `records skipped.discoveryConnect and emits beat_skipped {beat:'discovery_connect'}`
- `the skip carries its honest consequence verbatim`
- `renders the headline, the sub, and the fuel panel's normative framing`
  (the three missing sentences, matched verbatim)

**`tests/oneflow-l3-wizard-repairs.test.mjs`**
- `no entry point is excluded from the probe — the bypass branch is gone`
- `openDiscoverySetupWizard({entryPoint:'onboarding'}) probes the machine`
- `the verdict renders inside the wizard instead of a toast the wizard covers`
- `fires the four stages in order, each active then done`
- `hands each callback the full stage list, so a host can render ✓/◌/· live`
- `reports a blocked machine honestly, with the stage that failed`
- `suppresses the legacy wizard's own render while a caller drives it` +
  `un-suppresses afterwards` (the guard must not be a one-way latch)
- `drives the shell's setBusy with the four stage strings already written`
- `renders a live stage and disables its trigger while the probe runs` (Fix setup —
  asserts the list is up *before* the slow call)
- `keeps the taxonomy (network_error / 'Can't reach the endpoint.') and adds a remediation`

**Legacy test updated (behavior legitimately changed, spec §5 B5):**
`tests/discovery-cross-rec.test.mjs` — `the autodetect lane is BYPASSED for
entryPoint:onboarding` pinned the bypass on purpose. Rewritten in place as
`the autodetect lane runs for EVERY entry point, onboarding included (ONE-FLOW
spec §5 B5)`, keeping its assertion that the explicit `skipAutodetect` seam
survives. No other legacy test changed.

## 3. What shipped, file-and-fence

| File | Fence | What |
|---|---|---|
| `oneflow-beat-discovery.js` | L3 (whole file) | B5: fuel panel, connect panel, the gate between them, skip, advanced `details`, `key_check` telemetry, test seam `window.JobBoredOneFlowBeatDiscovery._internal`. |
| `discovery-wizard-ui.js` | L3 | `TAILSCALE_AUTO_STAGES` + `createTailscaleStageReporter` + `renderTailscaleStagesInWizard`; `runDiscoveryTailscaleAutoSetup` reports its four phases; exported `runTailscaleAutoSetup({onStage})` and `verifyDiscoveryEndpointForFlow({url,secret})`; a render-suppression depth counter so a flow-driven call keeps the legacy wizard off the screen; the autodetect bypass removed and its verdict routed into the wizard's opening message; `Fix setup` busy state. |
| `discovery-wizard-verify.js` | L3 | the `network_error` catch-all keeps `"Can't reach the endpoint."` and its taxonomy, and gains a three-step `remediation` + `suggestedCommand`. |
| `css/oneflow.css` | inside `/* ONEFLOW:L3 */` only | panel/field/dimmed/advanced styles. Nothing outside the fence was touched. |
| `tests/oneflow-l3-harness.mjs`, `tests/oneflow-l3-beat-discovery.test.mjs`, `tests/oneflow-l3-wizard-repairs.test.mjs` | L3 | 36 probes. The harness reuses the L0 fakes (`tests/oneflow-l0-harness.mjs`) rather than forking them. |
| `tests/discovery-cross-rec.test.mjs` | one test, per §2 | the superseded bypass assertion. |

No new browser JS file was created, so `typecheck:repo` needed no edit —
`oneflow-beat-discovery.js` was already registered by L0. `index.html` was not
touched (SUBSTRATE locked decision 2). The beat lands **dark**: nothing calls
`JobBoredOneFlow.maybeStart()` yet; L6 owns the cutover.

### Two design decisions worth naming

1. **Render suppression, not a second code path.** B5 drives the *same*
   `runDiscoveryTailscaleAutoSetup` and the *same*
   `handleDiscoveryWizardVerification` the standalone wizard uses — one truth
   about what "connected" means, one persistence path. Both share
   `handleDiscoveryWizardVerification`, which re-enters `renderDiscoverySetupWizard`
   on several branches and would have painted the legacy wizard over the flow
   shell. A depth counter around the two exported entry points suppresses only
   those renders; `un-suppresses afterwards` locks that it is not a latch.
2. **Footer actions, mutated in place.** The shell snapshots a step's `actions`
   array before the body renders but normalizes each descriptor after, so the
   gate is applied by mutating the three descriptor objects in `syncActions()`.
   The gate is *also* re-checked inside `handleAction` — a `disabled` attribute
   is a hint, not a guarantee.

## 4. Floor results — PASTED output

```
$ npm test
ℹ tests 2492
ℹ suites 598
ℹ pass 2491
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 8307.239458
exit: 0

$ npm run lint:repo
OK integrations/openclaw-command-center/SKILL.md
exit: 0

$ npm run typecheck:repo
(no output = clean) exit: 0

$ npm run test:contract:all
OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
exit: 0
```

Baseline before this lane (`.lane-evidence/baseline-npm-test.txt`): `tests 2453
/ pass 2452 / fail 0 / todo 1`. The delta is exactly the 36 probes added here
plus the 3 assertions restructured in `discovery-cross-rec`. The single `todo`
(`tests/submission-record-audit.test.mjs` — "blocked on the canonical-ownership
gate") is pre-existing and untouched by this lane; it is marked `todo`, so
`npm test` exits 0.

Full logs: `.lane-evidence/` — `baseline-npm-test.txt`, `red-l3-probes.txt`,
`floor-final.txt`, `floor-summary.txt`, `floor-lint.txt`, `floor-typecheck.txt`,
`floor-contract.txt`.

## 5. Anything unverified, including what the sandbox refused

**Nothing was refused.** Commits succeeded; no network was needed.

**Unverified because it is unverifiable in this lane (dark landing):**
- No browser run. Every claim here is held by unit probes against the real
  shell and the real wizard module in a `vm` sandbox with the L0 DOM fakes.
  The beat has never rendered in a browser because nothing boots it until L6
  flips `app-bootstrap.js`. **L6 should smoke B5 by hand once the cutover
  lands.**
- The live SerpApi write and worker restart are exercised against a fake
  `fetch`. The endpoint contract is unchanged from the enhancements wizard's
  (`/__proxy/discovery-env-key` + `/__proxy/full-boot?...&force_restart=1`),
  which `tests/enhancements-wizard.test.mjs` still covers end-to-end, so the
  shape is pinned in two places.

**Copy divergence I resolved (flagging, per ground rule 7):**
- Spec §5 B5 writes the first fuel stage as `Saving key…`; the kickoff writes
  `Saving your key…`. I shipped the **kickoff's** wording — it is the
  lane-specific, later document, and it matches the string the retired
  enhancements wizard already used. One word; trivially reversible.
- The skip control's label is the spec's **full** sentence, verbatim:
  `Skip the connection for now — your keys are saved; jobs won't arrive on
  their own until you connect.` The kickoff quotes only the first clause as
  "the normative line". I kept the whole sentence on the control so the
  consequence is attached to the click rather than sitting near it. It is a
  long ghost button; if design wants it split, the second clause moves to a
  line under the control and the test's expected label follows.
- Two strings the spec does not dictate, written to §8 voice rules and open to
  edit: the connect panel's title (`Then the connection: let it run on its
  own.`) and its one-line explanation of what Tailscale is.

**Cross-fence needs for the orchestrator (I did not edit around them):**
1. **B5 draft state does not survive a refresh.** Spec §3.2 says beat-local
   drafts persist under `onboardingFlowState`, but `normalizeOnboardingFlowState`
   in `user-content-store.js` (L0's fence) has a closed shape — `version, beat,
   completedBeats, skipped, startedAt, completed` — with nowhere to put
   `fuelPassed` or an unverified key draft. Today a refresh mid-B5 makes the
   user paste the SerpApi key again. Fix belongs in L0/L6: either a `drafts: {}`
   passthrough on the flow state, or a per-beat settings key. Small, and it
   affects B2 and B4 the same way, so it wants one decision, not three.
2. **The fuel panel does not pre-detect an already-configured worker.** The
   enhancements wizard probed `/health` and showed "SerpApi is connected".
   B5 always asks. Correct for the greenfield path §3.3 routes into the flow,
   and out of scope for this kickoff — but if L6's migration ever lands a
   partially-configured user on B5, they will be asked for a key they already
   have. Worth one `/health` read at that point.
3. `discovery-wizard-ui.js` calls `getDiscoveryWizardDefaultDrafts()` and
   `getDiscoveryWizardRuntime()` as **bare globals** (`discovery-wizard-ui.js`
   :2754, :2760) rather than through the `host()` bridge every other call uses.
   Pre-existing, works in the browser because `app-compat.js` defines them
   globally, and my harness supplies them to the sandbox. Not mine to fix —
   noting it because it is a real inconsistency in the bridge contract, and the
   next person to sandbox this file will hit it too.

**One thing to watch at integration:** `runTailscaleAutoSetup` and
`verifyDiscoveryEndpointForFlow` suppress `renderDiscoverySetupWizard` while
they run. If a future caller awaits something *else* inside that window that
expects the wizard to repaint, it will silently no-op. The counter is scoped to
those two functions and released in `finally`; `un-suppresses afterwards` is
the regression guard.
