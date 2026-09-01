# Lane L4 — bookends (S0 demo board · Beat 6 payoff · one celebration · go-live exits)

Read GROUND-RULES.md, SUBSTRATE.md, spec §4, §5 B6, §6 (devices row). Fence: `oneflow-demo-board.js`; `oneflow-beat-payoff.js`; `onboarding-celebration.js` (stub to fill); `fixtures/demo-pipeline.json` (create); `go-live-wizard-ui.js`; `whats-next-banner.js`; the celebration-player extraction cut in `onboarding-wizard.js`; CSS only inside `/* ONEFLOW:L4 */`.

**Mission:** The two bookends that make the deal legible — value before any ask, payoff with jobs after the last one — plus the honest exits the tail never had.

## S0 — demo board
- `fixtures/demo-pipeline.json`: 8 curated rows (realistic companies/roles across stages, fit score + one-line "why it fits" each). Tasteful, deterministic, no real personal data.
- `oneflow-demo-board.js` renders a SELF-CONTAINED overlay board (locked decision: no pipeline-render.js edits) styled like the real board: watermarked `DEMO` chips, reduced opacity, read-only detail on click. On top, the invitation card with normative copy (`Make it mine — 15 min, once` → `JobBoredOneFlow.open()`; `Poke around first` → collapse to the corner pill `Set up JobBored — 15 min ▸`, session-persistent, reopens the flow). Expose `mount()/unmount()`; L6 wires when `!getSheetId()`. First real sheet row → unmount (listen for the existing data-loaded signal, call-only).

## Celebration extraction
- Move `playOnboardingCelebration` + its overlay driver + confetti (onboarding-wizard.js:137-344) into `onboarding-celebration.js` (window global, same behavior — the existing a11y/reduced-motion/inert mechanics are good, keep them and their tests pointing at the new home). `onboarding-wizard.js` keeps a thin delegating alias so the legacy chain still works until L7 deletes it. Add ONE stage config for the flow finale; the four legacy stage configs stay for now (L7 removes).

## Beat payoff (B6)
- The only celebration fires here. Render per spec: "You're live, {firstName}" (from the Google session profile; graceful fallback "You're live."), Your search card (from the saved profile), What happens now card — `✓ AI connected — {provider}` · `✓ Discovery armed — {n} sources watching, including Google's job index` (n from the discovery snapshot) · sheet line with open link · the ETA line verbatim. Skipped-connect variant per spec (keys-saved line, `Go to my dashboard` primary, `Actually — connect discovery` ghost). Footer line verbatim.
- `Run discovery now`: pre-check intent from the saved profile (it cannot bail — assert), call the existing `triggerDiscoveryRun` (call-only), close the shell, surface the existing run-progress toast/poll so first cards appear on the live board. Emit `first_results {count, ms}` when the poll first reports rows. On exit either way: `ctx.completeBeat()` → controller writes completion flags + `flow_completed`.

## Go-live honest exits (Phase 0, standalone wizard)
- `path_select` gains "I only use JobBored on this computer" → write `goLiveSetupSkipped` (add the getter/setter beside `discoverySetupSkipped` in user-content-store — granted single addition outside fence, keep it to those two functions + export lines).
- `whats-next-banner.js`: treat `goLiveSetupSkipped` like the discovery skip (:190-203 pattern) so the banner resolves for single-device users.
- Cloud path: `no-cors` probe failure warns and leaves `I added it to Google OAuth — finish` enabled (:779); Tailscale ready-step button hierarchy: finish = primary, verify = secondary (:600-612); done-step "Recommended next: turn on job discovery" renders only when discovery is incomplete (:804-807).

## Tests — tests/oneflow-l4-*.test.mjs
Fixture schema + demo board mounts/unmounts + pill round-trip; celebration extraction keeps legacy tests green (update their import surface only); payoff renders both variants from state; run-now asserts pre-checked intent; go-live skip resolves the banner; cloud finish enabled despite failed probe; done callout conditional.

## DoD
Full floor green (pasted). Report complete; committed locally, never pushed.
