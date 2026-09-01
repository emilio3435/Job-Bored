# Lane L3 — engine (Beat 5: fuel + connect)

Read GROUND-RULES.md, SUBSTRATE.md, spec §5 B5. Fence: `oneflow-beat-discovery.js`; `discovery-wizard-ui.js`; `discovery-wizard-verify.js`; CSS only inside `/* ONEFLOW:L3 */`.

**Mission:** The discovery beat — required SerpApi fuel gating a one-click Tailscale connect with live stages — plus making the standalone discovery wizard honest about work in progress.

## Beat discovery (B5)
- Headline/sub verbatim (the three missing sentences). Two panels:
- **Fuel (required):** normative copy + three deep-linked steps; masked key field; `Save & verify` → POST `/__proxy/discovery-env-key` (`SERPAPI_API_KEY`) + worker restart via the existing `/__proxy/full-boot` path, stages via `ctx.setBusy` (`Saving your key… → ✓ Google Jobs index connected — 100 searches/mo`), result via `ctx.setMessage`. Connect panel renders dimmed/inert until fuel passes. Emit `key_check {beat:"discovery", source:"serpapi", ok, ms}`. No skip on fuel.
- **Connect:** `Set it up for me` drives the Tailscale auto path. Refactor `discovery-wizard-ui.js` minimally so the sequence in `runDiscoveryTailscaleAutoSetup` (:2335-2512) is callable with stage callbacks (one exported `runTailscaleAutoSetup({onStage})`), then drive it from the beat with the four normative stage lines. Autodetect result renders as a visible first stage ("Checked your machine ✓"). Blocked states (needs_install/needs_login) keep their current honest copy + Download/Re-check, delivered through setMessage. Advanced `details` (manual URL+secret pair, SELF-HOSTING doc link). `Skip the connection for now` (normative line) → `ctx.skipBeat()` → flow records `skipped.discoveryConnect`.
- Verification stays a handshake (auth-probe header), stub endpoints keep non-completion behavior.

## Standalone discovery wizard repairs (same files, Phase 0)
- Remove the `entryPoint !== "onboarding"` autodetect bypass (:2536) and render autodetect as a visible beat inside the wizard rather than a suppressed toast (:2559).
- Give the wizard's own `Set it up for me` and `Fix setup` real in-flight states using the L0 shell `setBusy` (the four stage strings already written at :2353-2493 must reach the screen).
- `discovery-wizard-verify.js`: give the catch-all `"Can't reach the endpoint."` a concrete next action (name the first check to run), keeping the existing error taxonomy intact.

## Tests — tests/oneflow-l3-*.test.mjs
Fuel gates connect (connect inert before fuel pass); save+verify renders success and error through the message slot; skip records `discoveryConnect` and never touches the fuel requirement; autodetect bypass gone (red-first on the old branch behavior); stage callbacks fire in order; existing discovery-wizard tests updated only where behavior legitimately changed (name spec §5 B5 in the commit).

## DoD
Full floor green (pasted). Report complete; committed locally, never pushed.
