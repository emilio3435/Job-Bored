# KICKOFF — lane C `edges` (claim ids C1–C5)

Read `GROUND-RULES.md`, then `GREENFIELD-SPEC.md` §1 F3–F5, §3 items 3–4, §4.3, §4.4, §5 items 4–5. Create `LANE-REPORT-edges.md` before anything else.

## Mission
The three edges of the flow stop lying: the discovery drawer's setup button lands in the six-beat flow, Beat 1 with no Client ID stays in the flow and opens the detour instead of punting to Settings, and Beat 6 adapts its primary action to what is actually ready instead of firing discovery into a missing Sheet.

## Fence (you own exactly these)
- `discovery-setup-modals.js:130-160` — the `#settingsDiscoveryOpenSetupBtn` handler only.
- `sheet-access-setup.js:620-660` — the missing-client-id branch of `handleSetupCreateStarterSheet`.
- `oneflow-beat-google.js`: `continueWithGoogle`, `renderDetour` (and the detour `<details>` open/focus behavior).
- `oneflow-beat-payoff.js`: `resolvePayoffState`, `render`, the action handlers, the "What happens now" lines.
- `tests/oneflow-l7-sweep.test.mjs:585-605` (it asserts the old drawer call — flip it).
- New tests: `tests/greenfield-c-drawer.test.mjs`, `tests/greenfield-c-google-nopunt.test.mjs`, `tests/greenfield-c-payoff.test.mjs`. Read `tests/sixbeats2-finale.test.mjs` and `tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs:121` first.

You consume lane A's `open(beatId, { returnTo: "close" })`. It may not exist yet in your branch: pass the options object anyway (a plain `open(beatId)` ignores it) and never assert on the close behavior — lane E does that on the integration branch.

## Claims (red first)
- **C1 · drawer.** Clicking `#settingsDiscoveryOpenSetupBtn` calls `window.JobBoredOneFlow.open("discovery", { returnTo: "close" })` when it exists, and falls back to the old `requestDiscoverySetup` call when it does not. `#discoverySetupWizardMount` stays empty in the first case.
- **C2 · Beat 1 no punt.** With `getOAuthClientId()` empty, `handleSetupCreateStarterSheet({ context: "wizard" })` returns `{ ok: false, reason: "missing_client_id" }` and never calls `openCommandCenterSettingsModal`. Non-wizard context is unchanged.
- **C3 · Beat 1 detour.** With no Client ID, "Continue with Google" opens the detour `<details>`, focuses the Client ID input, and renders "Paste your Client ID to continue." in the message slot. With a Client ID present the beat behaves exactly as today.
- **C4 · payoff readiness.** `resolvePayoffState` returns `readiness: { sheet, roles }`; primary id/label per §4.3 for each of the three states; `payoff_run_discovery` absent unless both true; the "What happens now" first line is the locked copy when not ready; "Take me to my dashboard" present in all states.
- **C5 · payoff actions.** `payoff_connect_google` → `ctx.goToBeat("google")`; `payoff_fix_fit` → `ctx.goToBeat("fit")`; neither dispatches a discovery run nor calls `completeBeat`.

## Non-negotiables
- Ids, labels, and copy verbatim from §4.3 / §4.4. Lane E asserts them.
- The burst (`b231c0d`) is untouched; `tests/sixbeats2-finale.test.mjs` and `tests/e2e-visual/finale-burst.spec.mjs` stay green.
- The legacy wizard is not deleted or renamed in this lane; the fallback branch keeps it reachable.

## Definition of Done
- C1–C5 red output pasted, then green.
- Full floor pasted. Commit locally, never push.
