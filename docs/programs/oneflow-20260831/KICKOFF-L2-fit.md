# Lane L2 — fit (Beat 4 + scorer repairs)

Read GROUND-RULES.md, SUBSTRATE.md, spec §5 B4 + §10 Phase 0 (scorer items). Fence: `oneflow-beat-fit.js`; `integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts`; `server/profile-rescore-worker.mjs`; `fit-profile-wizard.js`; `fit-profile-editor.js`; CSS only inside `/* ONEFLOW:L2 */`.

**Mission:** One confirm-don't-compose review screen that writes the profile once to both stores — and kill the two silent match-killers in the scorer.

## Beat fit (B4)
- Render the three cards + expander per spec §5 B4 with the draft profile from flow state (B3 stores it; render gracefully from a template draft too). Chips edit/remove/add; strengths reorderable; narrative one italic line with inline edit; humanized seniority labels (copy the label map data from discovery-drawer.js:174-201 into your module — do not import).
- Expander: work-mode radios; location chips render ONLY when work mode is hybrid/onsite (never for `any`/`remote_only`); salary floor standalone; skip-titles; work authorization. `yearsRelevantExperience` and `starterTemplate` do not exist in this UI.
- `Looks like me →`: validate (≥1 role, ≥1 strength, narrative 20–1200) with inline messages at the offending card, then ONE write pass: `UC.saveDiscoveryProfile({targetRoles, locations…})` + POST the fit profile to `${jobBoredApiUrl}/profile` (same payload/endpoint fit-profile-wizard uses). Raw JSON behind a `details` toggle. `ctx.completeBeat({edited})`.

## Scorer repairs (Phase 0 — behavior fixes with tests-first)
- `profile-aware-scorer.ts`: location hard-reject applies ONLY when `workMode` is `hybrid_ok`/`onsite_ok` (never `any`, never `remote_only`); `salaryFloor` rejects a listing with a published salary below the floor even when `salaryRequired` is false (`salaryRequired` keeps its own no-published-salary rejection). Mirror identical logic in `server/profile-rescore-worker.mjs`.
- Run `npm run typecheck:browser-use-discovery` plus that package's own test suite if present; red-first tests for both fixes in both implementations.

## Settings-editor repairs
- `fit-profile-wizard.js` `openWizard()` (:1442-1451): fetch the existing profile and merge via `mergeStateFromProfile` before rendering — reopening must never overwrite a saved profile with a blank draft (red-first test: open→save with no edits leaves the stored profile identical). Fix the locations hint copy (:892) to match the corrected scorer. Humanize the seniority `<select>` labels (:499) with the same map.
- `fit-profile-editor.js` (:633): replace the explainer string — no "Task #6", name the button as rendered ("Rescore").

## Tests — tests/oneflow-l2-*.test.mjs + TS tests in the integration package
Both scorer fixes red-first in TS and mjs mirrors; beat validation gates; single write pass hits both stores; fetch-on-open no-overwrite; hint copy corrected.

## DoD
Full floor green including `typecheck:browser-use-discovery` (pasted). Report complete; committed locally, never pushed.
