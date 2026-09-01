# Lane L6 — cutover (serial; runs only after L1–L5 are merged and the floor is green)

Read GROUND-RULES.md, SUBSTRATE.md, spec §3 (architecture, migration) and §4. Fence: `app-bootstrap.js`, `discovery-status-handoff.js`, `tests/integration/*` updates, `tests/oneflow-l6-*.test.mjs`.

**Mission:** Flip boot from the legacy chain to the one-flow, with migration that guarantees no existing user ever re-onboards — deleting nothing (that is L7).

1. **Cold start:** in `app-bootstrap.js` `init()` (:151-173), when `!getSheetId()` and the stored config is not in a genuine error state: mount the demo board (`JobBoredOneFlowDemoBoard.mount()`) instead of `showSheetAccessGate("no-oauth"/"signin")`. Keep the gate's `error` mode exactly as-is for broken sheets. Auth wiring (`initAuth`) still runs so `Continue with Google` works from Beat 1.
2. **Post-auth chain:** in `discovery-status-handoff.js` `runPostAccessBootstrapOnce` (:1130-1147), replace `checkInfraSetupGate` + `checkOnboardingGate` with `await JobBoredOneFlow.maybeStart()`. The legacy functions stay defined and tested (deleted in L7); they are simply no longer called on this path — grep-proof the call sites in your report.
3. **Migration (spec §3.3, red-first tests for each row):** legacy `infraSetupComplete && onboardingComplete` → mark flow completed, never render; sheet configured only → flow opens at Beat 2 (ai); provider verified too → Beat 3; legacy profile complete but no server fit profile → Beat 4 prefilled from the discovery profile; discovery incomplete for a completed-legacy user → banner nudge only, flow stays closed.
4. **Completion side-effects:** prove via test that finishing Beat 6 writes `onboardingComplete` + `infraSetupComplete` (+ `discoverySetupComplete` when connect succeeded) so `whats-next-banner`, `isAllMandatorySetupComplete`, and every other legacy reader behave.
5. **Integration tests:** rewrite `tests/integration/onboarding-chain-convergence.test.mjs` and touch `tests/integration/greenfield-automation.test.mjs` for the new chain: cold start → demo board; sign-in → B1→B6 happy path; refresh mid-flow resumes the beat; Esc closes to the (demo) board and re-entry lands on the saved beat; skipped-connect end state shows the banner. Name spec sections in test names.

## DoD
Full floor green (pasted). A grep table in the report: every legacy gate call site and its status (still-defined / no-longer-called-from-boot). Report complete; committed locally, never pushed.

## Routed items from other lanes (orchestrator, 2026-09-01 — these three edits are granted additions to your fence)

6. **`{firstName}` source (from L4's report):** `auth-session.js` reads `/oauth2/v3/userinfo` but only keeps `email`/`picture`; capture `given_name`, expose an accessor, persist it beside the session fields. Then have Beat 1 (`oneflow-beat-google.js`) write `ctx.runtime.firstName` on sign-in. B6 already resolves `ctx.runtime.firstName` → accessor → "You're live." fallback; make the happy path real and pin it with a test.
7. **`ctx.runtime.fitProfile` (from L4's report):** B6 prefers the in-flow profile over a second `/profile` fetch; if L2's Beat 4 does not already leave the saved profile on the runtime after "Looks like me →", add that one write in `oneflow-beat-fit.js` and pin it.
8. These are the ONLY edits granted outside your original fence.
