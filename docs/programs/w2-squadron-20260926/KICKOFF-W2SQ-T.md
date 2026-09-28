# W2SQ lane T: fold the browser preview themes into the template registry (materials slice 7)

Read `.lane-evidence/KICKOFF-W2SQ-_SHARED.md` first. It is binding.

## Outcome
Goal: one appearance system. The browser's `visual-themes.js` preview themes (`visualThemeId`) fold into the #126 template registry, so the materials preview a user sees is the same Signal, Dossier or Editorial template the server renders.
Success means: `docs/superpowers/plans/2026-09-17-materials-v3.md` **slice 7** is implemented as written. The preview uses the registry family and accent/density knobs. `visualThemeId` is retired with a one-time migration of any stored value to `materialsTemplate` (or accent) in `user-content-store.js`. Nothing in the UI offers two competing "look" pickers. Tests went red first. The floor is green, including e2e-smoke and e2e-journey.
Stop when: the report's first line reads `DONE`, or you are blocked twice on the same thing.

## Read first
- The plan, slice 7 and the "tests that change on purpose" list; the visual spec §9 (`docs/superpowers/specs/2026-09-17-materials-v3-volt-design.md`).
- `visual-themes.js`, `resume-generation.js` (~:689-690, ~:1332-1336 set `data-visual-theme`), `css/materials.css` (~:1126-1183 theme CSS), `user-content-store.js` (`DEFAULT_PREFERENCES`, `visualThemeId`, `materialsTemplate`), `materials-feature.js`, `partials/profile-materials-modal.html`, `document-templates.js`, `resume-bundle.js`, and `tests/fixtures/scribe/scribe-dom.mjs`.
- The registry list bundled in `user-content-store.js`, which a test keeps identical to `server/materials-templates.mjs`.

## Fence
- `visual-themes.js` (retire it or reduce it to a thin adapter over the registry list), `resume-generation.js` (theme and preview parts only), `css/materials.css` (theme sections), `user-content-store.js` (preferences and migration), `materials-feature.js`, `partials/profile-materials-modal.html`, `role-materials.js` (only if the preview affordance needs it), `document-templates.js`/`resume-bundle.js` (only where they reference visual themes), and tests for these.
- NOT yours: anything under `server/` (lane M), `templates/materials/**` (read it to mirror its look; do not edit it).

## Notes
- The browser preview can load the same template CSS the server uses (`templates/materials/<family>/<family>.css`) if the dev server serves it. Otherwise follow slice 7's stated approach. Keep jb-v2 cascade scoping (see the shared traps).
- Keep "PDF" in the browser path honest: if it is still `window.print()`, say so in the report.
