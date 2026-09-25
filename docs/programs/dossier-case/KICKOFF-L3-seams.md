# Kickoff · L3 seams (claim D) — the four source adapters the Case model reads

Read `docs/programs/dossier-case/GROUND-RULES.md` first. `jb-text.js` is merged into your branch.

Execute, in this order, from `docs/superpowers/plans/2026-09-01-dossier-case-redesign.md`:

1. **Task 2** — `keywordMatch.analyzeJob(job)` + `jb:profile-match:ready` event (`keyword-profile-match.js`).
2. **Task 3** — persist ATS scorecards per job opportunity key (`materials-state.js`: `getScorecardForJob` / `setScorecardForJob`, `localStorage["jb_ats_scorecard_v1"]`, cap 100; `ats-scorecard.js` stores on success).
3. **Task 4** — `getPostingHealth(job, opts)` in `expired-review.js`.
4. **Task 5** — `role-materials.js` becomes the manifest owner: `[data-mount="materials"]` with fallback to `[data-mount="brief"]`, `commitManifest` wrapping all seven `renderManifest` call sites, `jb:materials:manifest` event, `getCurrentManifest()`.

**Mission.** After you, `role-case-model.js` (L4) can read every source it needs through stable public functions, with events to re-render on. Spec §2.2 is the contract table.

**Fence.** L3 row of the ground rules. In `role-materials.js` change ONLY mount resolution, the `commitManifest` wrapper, the event, and the public API — do not touch `renderManifest`'s card markup or the document filter (L5 owns the compact rows).

**Consumes.** Nothing from other wave-1 lanes. **Produces for L4/L5:** exact names — `analyzeJob`, `getScorecardForJob`, `setScorecardForJob`, `getJobOpportunityKey` (export it if it is not already), `getPostingHealth`, `getCurrentManifest`, events `jb:profile-match:ready` and `jb:materials:manifest {jobKey, manifest}`.

**Non-negotiables.** Find the real accessor names `refreshCandidateProfileMatchCache` touches (lines ~550–597) before stubbing them. Confirm `payload.feature`'s real name in `buildAtsScorecardRequestPayload` before wiring persistence. Confirm the module's global for expired-review from its final `root.X = {...}` line. `tests/role-materials.test.mjs` (22 cases) and `tests/role-materials-auto-draft.test.mjs` (22 cases) keep passing — retarget selectors only where the mount moved.

**Definition of Done.**
1. `node --test tests/keyword-match-analyze-job.test.mjs tests/ats-scorecard-persistence.test.mjs tests/expired-review-posting-health.test.mjs tests/role-materials-manifest-events.test.mjs tests/role-materials.test.mjs tests/role-materials-auto-draft.test.mjs tests/ats-scorecard-provider.test.mjs tests/ats-state-bus.test.mjs tests/expired-review.test.mjs tests/profile-rescore-provider.test.mjs` green.
2. Full floor green — pasted in `LANE-REPORT-L3.md` §4.
3. Four commits with the plan's messages.
