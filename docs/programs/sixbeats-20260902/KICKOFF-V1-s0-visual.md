# Lane V1 — s0-visual (claim U1: the demo board must look like the product)

Read `SIXBEATS-SPEC.md`, `GROUND-RULES-ADDENDUM.md`, the ONEFLOW ground rules, spec §4, and open `reference/six-beats-prototype.html` (screen "S0") beside `evidence/s0-as-shipped-emilio.png`. Fence: `oneflow-demo-board.js`, `css/oneflow.css` inside `/* ONEFLOW:L4 */` only, `fixtures/demo-pipeline.json` copy only.

**Mission:** Rebuild S0 so a zero-config visitor's first pixel reads as a finished product: a page header strip with the wordmark and the "Sample pipeline — this is what a set-up JobBored looks like" kicker, a framed board whose demo cards use the product's card language (paper surface, stage rail color, DEMO chip, fit score pill, "why it fits" line), and the invitation card as the visual center of gravity — prominent, on top of the board, never auto-collapsed. "Poke around first" collapses it to a designed pill (wordmark + "Set up JobBored — 15 min ▸") that reopens it.

Deliver:
1. Red-first structural probes in `tests/sixbeats-v1-*.test.mjs`: header strip present with wordmark; invitation card visible on first mount (not the pill); pill renders only after "Poke around first"; board columns carry stage classes; mobile (390 px) renders a single-column board with the invitation card above it.
2. The visual work in the fence. Keep every normative string. Reuse existing tokens/classes from `tokens-v2.css` and `jb-ui.css` where they exist; add new rules only inside the L4 region.
3. Before/after screenshots at 1440×900 and 390×844 in `.lane-evidence/`, filenames pasted into the report, with one line per claim on what changed.

DoD: probes green, full floor green (pasted), screenshots pasted, report complete, committed locally, never pushed.
