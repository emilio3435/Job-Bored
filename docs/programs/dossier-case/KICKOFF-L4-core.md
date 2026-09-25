# Kickoff · L4 core (claim E) — the Case model and renderer

Read `docs/programs/dossier-case/GROUND-RULES.md` first — trap 3 (jb-v2 CSS cascade) is aimed at you. Merged into your branch already: `jb-text.js`, the L1 view-model fields, the L3 seams (`analyzeJob`, `getScorecardForJob`, `getPostingHealth`, `getCurrentManifest`, `JobBoredStages`).

Execute, in this order, from `docs/superpowers/plans/2026-09-01-dossier-case-redesign.md`:

1. **Task 6** — `role-case-model.js` (`buildCaseModel`, `collectDeps`, `CASE_DOC_TYPES`) + `tests/role-case-model.test.mjs` + its `index.html` script tag after `role.js`.
2. **Task 7** — `role-case.js` (`window.JobBoredCase.render`) + `role-case.css` + `tests/role-case-render.test.mjs` + its `index.html` tags. Do NOT wire it into `role.js` — L5 owns the cutover. The renderer must not be reachable from the page until L5.

**Mission.** A `CaseModel` (spec §4) assembled purely from injected deps, and a renderer that paints every block of the approved design (spec §1 diagram, §7 visual spec) from that model alone, escaping exactly once.

**Fence.** L4 row of the ground rules. If `window.JobBoredApp.core` has no accessor for a raw pipeline job by stable key, add one function (`getJobByStableKey`) where the jobs array lives and expose it on `JobBoredApp.core` — that is the one file outside your row you may touch, and say so in the report.

**Consumes.** L1 view-model fields; L3 seams; `JobBoredStages.pairs()/toKey()/toLabel()/isClosed()`. **Produces for L5:** `window.JobBoredCase.model.{buildCaseModel, collectDeps, CASE_DOC_TYPES}`, `window.JobBoredCase.render(mount, model)`, the DOM contract in spec §5 (`data-action` values verbatim), `[data-mount="materials"]` inside the moves lane, classes `case__*`.

**Non-negotiables.** Every CSS rule scoped under `body.jb-v2 [data-region="role"] .case` (trap 3). Provider label from config, never a vendor string (`grep -n Gemini role-case*.js` must be empty). Model strings pre-normalized via `JobBoredText`; renderer only escapes. Model tests use injected `deps` and the fixture in the plan verbatim — if a fixture date sorts differently than the plan expects, re-read the plan's Task 6 record-ordering note before touching the fixture.

**Definition of Done.**
1. `node --test tests/role-case-model.test.mjs tests/role-case-render.test.mjs tests/index-html-cold-start.test.mjs tests/index-html-size.test.mjs` green.
2. Full floor green — pasted in `LANE-REPORT-L4.md` §4.
3. Two commits with the plan's messages.
