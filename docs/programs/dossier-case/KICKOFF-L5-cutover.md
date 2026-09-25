# Kickoff · L5 cutover (claim F) — wire The Case, retire the Brief

Read `docs/programs/dossier-case/GROUND-RULES.md` first. Merged into your branch already: everything — `jb-text.js`, L1 derivation + guard, L2 ingestion, L3 seams, L4 model + renderer (`window.JobBoredCase`).

Execute, in this order, from `docs/superpowers/plans/2026-09-01-dossier-case-redesign.md`:

1. **Task 8** — `role.js` renders The Case (`renderDossier` → `collectDeps` + `buildCaseModel` + `render`); stepper `stage-step` → `jb:pipeline:move`; `reply` toggle, `followupAt` date, `heardBack`, `contact` writebacks (add the `contact` writer to `flowing-writes.js`, column L); `open-profile-match`; re-render on `jb:ats:state`, `jb:profile-match:ready`, `jb:materials:manifest`; `commitEditField` guards non-input surfaces. `tests/role-case-interactions.test.mjs`; retarget `role-field-edit-render-guard` to `.case__title`.
2. **Task 9** — compact document rows inside `[data-mount="materials"]` (`renderCaseRows`, all four `CASE_DOC_TYPES`, Draft buttons for missing resume/cover letter, pending phase line); `.case__doc*` CSS in `role-case.css`; legacy panel remains only for a brief-only mount.
3. **Task 10** — delete `role-brief.js`, the `.brief__*` / `.skim` / `.points` / `.brief-notes` / skeleton / shimmer blocks in `role.css`, `tests/dossier-brief-structure.test.mjs`, the `role-brief.js` script tag, the `JobBoredDossierBrief` fallback in `role.js`; update `DESIGN.md` / `AGENTS.md` references; add the `CHANGELOG.md` Unreleased line. Keep `.brief-materials__*` only if the brief-only fallback path in role-materials still renders it.

**Mission.** Opening a role renders The Case, every interaction in spec §5 works through the existing event contracts, and the Brief is gone without a trace except the changelog.

**Fence.** L5 row of the ground rules.

**Non-negotiables.** The focus guard from L1 (`[data-action="edit-field"], [data-action="notes"]`, deferred flush on blur) stays intact and its tests keep passing against the Case rail. Every `data-action` you handle matches the renderer's emitted names exactly (spec §5 table). No push. `grep -rn "JobBoredDossierBrief\|role-brief" --include=*.js --include=*.html --include=*.md .` returns only CHANGELOG history when you are done.

**Definition of Done.**
1. `node --test tests/role-case-interactions.test.mjs tests/role-field-edit-render-guard.test.mjs tests/role-writeback-bridge.test.mjs tests/dossier-workshop-events.test.mjs tests/flowing-writes-stage-resolve.test.mjs tests/role-materials.test.mjs tests/role-materials-auto-draft.test.mjs tests/role-materials-manifest-events.test.mjs tests/role-case-render.test.mjs` green.
2. Full floor green — pasted in `LANE-REPORT-L5.md` §4.
3. `npm run smoke:jb-v2` result pasted (green, or the exact failure with your read on whether it is pre-existing).
4. Three commits with the plan's messages.
