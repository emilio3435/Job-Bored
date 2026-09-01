# Lane L8 — E2E truth pass (Playwright suites pin the new spec)

Read GROUND-RULES.md, SUBSTRATE.md, spec §4 + §5. Fence: `tests/e2e-journey/**`, `tests/e2e-smoke/**` only.

**Mission:** Both Playwright suites currently pin the DELETED credential-first onboarding (CI red on PR #81: `should keep the dashboard behind the login gate when signed out` expects `#sheetAccessGateScreen` on cold start). Rewrite them to pin the shipped one-flow spec — they are the program's last red gates.

1. Read both specs and both playwright configs fully. Keep their good bones: the network fence (`unexpectedExternal`), the fixture/server harness, the journey structure.
2. Re-pin cold start per spec §4: a zero-config visitor sees the DEMO board (watermarked cards + the invitation card with "Make it mine — 15 min, once"); the dashboard is the surface, the credential gate does NOT render (its error mode is out of E2E scope). "Poke around first" collapses to the corner pill.
3. Re-pin the journey: "Make it mine" opens the flow shell on Beat 1 with the 6-segment spine; Esc closes back to the demo board (closing is pausing); reopening lands on the saved beat. Assert normative copy verbatim from the spec for B1's headline and the invite card.
4. Smoke: whatever the old suite asserted about boot health, reassert against the new surface — page loads, no console errors, demo cards render, flow opens.
5. Run `npx playwright install chromium` if browsers are missing. DoD: `npm run test:e2e-journey` AND `npm run test:e2e-smoke` green locally (pasted), plus the standard four-command floor green. LANE-REPORT-L8.md first, as always. Commit locally, never push.
