# Lane Q1 — visual-gate (serial; runs after V1, V2, B1, B2, B3 are merged)

Read `SIXBEATS-SPEC.md`, `GROUND-RULES-ADDENDUM.md`, both Playwright configs. Fence: `tests/e2e-journey/**`, `tests/e2e-smoke/**`, new `tests/e2e-visual/**` (+ its `playwright.config.mjs` and a `package.json` script `test:e2e-visual` — granted single edit).

**Mission:** Turn the program's visual and behavioral claims into gates CI keeps: structural screenshot assertions for S0 and the shell at 1440×900 and 390×844 (no horizontal overflow, header strip present, invitation card visible on first mount, exactly one progress indicator in the shell, actions reachable without scroll on mobile), plus journey re-pins for every claim that changed behavior (C2 back action, C4 refresh-resume without the param, C5 pause toast, C3 no `/profile` 404).

Keep pixel-diff out (fonts vary by machine); assert on DOM structure, bounding boxes, and computed styles. DoD: `npm run test:e2e-visual`, `test:e2e-journey`, `test:e2e-smoke` green locally (pasted), full floor green, report complete, committed locally, never pushed.
