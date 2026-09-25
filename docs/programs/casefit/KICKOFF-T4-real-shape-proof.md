# KICKOFF T4 — real-shape proof · GPT 5.6 Sol xhigh via Codex

Read `docs/programs/casefit/GROUND-RULES.md`, then spec §1, §7, §8, then plan §2–3 (T4 rows).

## Mission
Build the fixture that would have caught this, and the assertions that make it impossible to ship again. Write red first; you go green as F1 and M2 land (the orchestrator merges their first commits into your branch when they appear — pull `feat/casefit` then).

## Fence (absolute)
`tests/e2e-fixtures/real-shape-posting.mjs` (new), `tests/e2e-smoke/case-dossier.spec.mjs` (a new `describe("real-shape posting")` only — every existing assertion untouched), `docs/programs/casefit/LIVE-CHECK.md`.

## Commit 1 (M2 and F1 import it)
The fixture: one job with 25 requirements (two carry glued header tails from spec §1, one carries `[<|"|>`), 21 stack items including `API`/`APIs`/`AI`/`AI integrations`, 3 nice-to-haves, a scorecard whose `criticalGaps` hold the truncated triplet, and a sheet `Talking Points` value that also appears on two other seeded rows. Export both the raw sheet row shape (for the app's own setter, as `case-dossier.spec.mjs` seeds today) and the enrichment payload.

## Then
1. `describe("real-shape posting")` at 1240px: tallest rendered lane ≤ 1.6 × shortest; ≤ 8 `.case__req li` visible before the toggle; clicking `[data-action="toggle-requirements"]` reveals 25 and flips `aria-expanded`; `[<|` absent from `.case` text; `data-lanes` equals the number of `.case__lane` children; no `.case__strength` equal to a single bare token; the duplicated sheet talking point is absent; screenshots to `.lane-evidence/` only. Same describe at 720px: single column, toggle still works.
2. `LIVE-CHECK.md`: a 90-second script for Emilio on his real sheet — open CSC Generation, expect the board within two screens at his window size, no fragments, evidence lines under found requirements, "Show all 25" present, Found date equals the day he ran discovery.

## Definition of Done
Suite red on base, green on the integrated head (the orchestrator confirms); floor pasted; report complete; commits local.
