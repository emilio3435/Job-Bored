# KICKOFF F1 — board fold · Spark 1.3 via the native muse CLI

Read `docs/programs/casefit/GROUND-RULES.md`, then spec §3.1, §3.2 (renderer half), §3.3 (renderer half), §3.7, §4, then plan §2–3 (F1 rows).

## Mission
Make the board follow its lanes and make every lane show only what earns its height: a top-aligned, lane-counted grid; eight requirements with a disclosure for the rest; evidence sentences under matched requirements; labels that say one true thing. You render the model M2 defines in spec §4 — that schema is already on your branch (M2 commit 1).

## Fence (absolute)
`role-case.js`, `role-case.css`, `role-materials.js` **only the doc-row label block around lines 715–760**, `tests/role-case-render.test.mjs`, `tests/role-case-a11y.test.mjs`, `tests/role-materials.test.mjs` (one new case for the single label). Nothing in `role.js`, nothing in the model.

## Commit 1 (T4 asserts on it — land it first)
`data-lanes="1|2|3"` stamped by the renderer from the lanes it emitted; `.case__board { align-items: start }`; column rules per count. Test: two-lane model → `data-lanes="2"` and no empty third column.

## Then, test-first
1. Requirements: first `m.theyWant.visibleCount` render; the rest inside `<div class="case__more" id="case-more-<jobKey-safe>" hidden>`; `<button type="button" class="case__more-btn" data-action="toggle-requirements" aria-expanded="false" aria-controls="…">Show all N</button>`; no button when total ≤ visibleCount; nice-to-haves inside `.case__more` when collapsed. Toggle is client state: flip `hidden` + `aria-expanded`, label becomes `Show fewer`; no event, no writeback. Bind it inside `role-case.js`'s render (delegated on the mount) — `role.js` is frozen.
2. Chips: 12 + one `+N more` chip (`data-action="toggle-stack"`, same pattern).
3. Evidence: `<span class="case__req-ev">“snippet” <i>from your resume</i></span>` under found/partial requirements that carry `evidence`; serif 12.5px, `var(--ink-soft)`, indented to the text column. None on missing/unknown.
4. `You have`: render only what the model passes; the lane already hides on `source: "none"` — add the test that proves a keyword-only model renders no lane.
5. §3.7: `placeholder="Add a date"`, `placeholder="Add salary"` (posting salary as placeholder stays); follow-up wrapped in `.case__date` with a `.case__date-empty` sibling reading `Not set`, shown only when the value is empty (pick the reliable selector and test it in the a11y suite); doc rows: `status === "missing"` prints the `not drafted` sub and **no** status pill.
6. Every new rule scoped under `body.jb-v2 [data-region="role"] .case`; `node tools/lint-tokens.mjs --quiet` prints nothing. Keyboard: the two toggles are real buttons, focus-visible ring like the other case buttons.

## Definition of Done
Items green, both Playwright suites green, floor pasted in report §4, `LANE-REPORT-F1.md` complete, commits local. Screenshots at 1240 and 720 in `.lane-evidence/`.
