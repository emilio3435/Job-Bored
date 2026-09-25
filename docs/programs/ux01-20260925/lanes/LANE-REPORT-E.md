# Lane E report: Dossier & Tailor (C11–C14, C16)

Branch `feat/ux01-dossier-tailor`, cut from `feat/ux-zero-to-one` at `cca3e30`. Floor verified at head `d8a5dc3`, the last code commit; this report is committed on top of it. The branch is not pushed.

## What changed for the user

- **Drafts come from the user's own resume.** Every draft, retry and repair sends the Portfolio resume, and so does an opted-in auto-draft. With no resume on file, the dossier shows **"Add your resume first"** and never starts the draft. If the server answers `422 resume_required`, the dossier shows the same block. The Materials section says **"Drafted from <file>, added <date>"**, with a Change link. "They want" now has a working **Add your resume** button where it used to have plain text.
- **Drafting states tell the truth.**
  - If nothing is running on :3847, Draft and Tailor are disabled. The Materials section says **"Drafting server not running"** and shows `npm start`, **Retry** and **Copy command**. It no longer shows "queued".
  - One click drafts. Notes moved into an optional "Notes for the next draft" disclosure.
  - Auto-draft on a move to Researching is opt-in. When it runs, it says so in a toast, and its failures show as toasts instead of going only to the console.
  - After 3 minutes a row says **"Taking longer than usual"**.
  - The optimistic "queued" row stays until the manifest catches up.
  - A missing AI provider is **one inline line** in the dossier instead of two red toasts per open.
  - The materials queue dock hides while a dossier is open.
- **Review before you send.**
  - A document QA flagged reads **"review · N flags"** and shows the first flag, "+N more", and Repair.
  - The verdict counts flags instead of saying "both ready".
  - The QA report and the checklist open inline.
  - The score tile names what it rates: "Cover letter score · scored cover letter v3 · 2026-08-30". An older score with no recorded document reads "Draft score".
- **Scribe lives in the dossier.**
  - **Edit** on a written resume or letter opens Scribe inside the role, bound to that role, with the document's text loaded.
  - A free keyword meter updates as you type: "Covers 2 of 4 skills the posting names · missing: …".
  - The refine chips come from the missing terms, replacing the hard-coded "emphasize Python".
  - Scribe stays hidden until something is open.
  - Smaller fixes: the unscored ring draws "—", the topbar wraps at 320 px, and the refine strip stops sticking while the editor has focus.
- **Back from the posting.** If the user leaves through View posting and comes back, the dossier asks **"Did you apply to <company>?"**. Answering yes calls `JobBoredSubmission.confirmApplied`, with the source and today's date prefilled.

## Change status

| id | status | note |
|---|---|---|
| C11 | done (UI half) | The request carries `resume: {source, filename, addedAt, text}`, the gate is in place, `422 resume_required` shows the gate, and the provenance line renders. The check is feature-detected: a page with no `CommandCenterUserContent` drafts as before and lets the server decide. "Drafted from" needs the server to record `manifest.resume` (handoff 4); until then the line reads "Drafts use <file>". |
| C12 | partial | TA-03, 05, 06, 16, 18, 22 and 26, plus TR-24 and AX-22, are done. **TA-07 is not done**: the page does not yet fall back to the in-browser drafting engine when the API is absent, and there is no "Drafting on" chip. That is an engine-routing change (M) that needs `resume-generation.js` wired into the docket. The row-level Draft buttons are kept (TA-16 allowed dropping either copy), because `tests/role-materials.test.mjs` treats them as the rows' contract. |
| C13 | partial | TA-11 and TA-12 are done. TA-13 is partial: the tile names the document (`scorecard.feature`) and the date. The version shows only when the store records `scorecard.version`, which `materials-state.js` does not write yet. Keying the scorecard by `draftId + feature` and scoring server drafts from their `.txt` twin are not done. |
| C14 | partial | TA-08 binding, TA-09, TA-23 and TA-24 are done, as are MP-03 and AX-17/20/21. Not done: Refine still calls the legacy in-browser engine, not the server drafter that wrote the document (the rest of TA-08). Repair still takes no instructions (TA-10). Saving from Scribe writes to the local draft store, not back to the server's files. |
| C16 | done (UI) | Lane D's merged `confirmApplied(first, second)` accepts the positional `(jobKey, ctx)` form E calls, and honours `ctx.source` and `ctx.appliedDate`. E also passes `ctx.prefill {source, date}`. The prompt is skipped when the role is already Applied or later. |

## Upstream merge (feat/casefit): blocked, reported

`git merge --no-edit feat/casefit` **conflicted** in `role-case-model.js`, `role-case.css`, `role-case.js` and `role-materials.js`. I aborted it as instructed. This lane is built on `feat/ux-zero-to-one` without casefit. **When casefit lands, those four files will conflict with this branch**, and someone who owns both sides has to resolve them.

## Integration check (unverified in CI)

`feat/ux-zero-to-one` moved on after I cut this branch (lane A C2/C3, lane D). A throwaway trial merge of the two came out as follows:

- `git merge-tree`: no conflicts.
- Lane A's `lint:tokens`: `ok: 35 sheet(s), 0 new finding(s), 0 brace error(s)`.
- The shared client tests (`ux01-*`, `role-*`, `scribe*`, `submission*`, `run-status-honesty`, `enrichment-self-heal`): 470 pass, 0 fail, 1 todo.

The full floor was **not** run on the merged tree. That tree had no `server/node_modules`, so the server tests could not run there.

## Files touched

Owned: `role-case.js`, `role-case-model.js`, `role-case.css`, `role-materials.js`, `materials-queue.js`, `materials-queue.css`, `scribe.js`, `scribe-state.js`, `scribe-score-adapter.js`, `scribe.css`, `posting-enrichment.js`.

Tests:

- New: `tests/ux01-e-case.test.mjs`, `tests/ux01-e-materials.test.mjs`, `tests/ux01-e-scribe.test.mjs`, `tests/ux01-e-surfaces.test.mjs`.
- Updated for the intended change: `tests/role-case-a11y.test.mjs` (score label), `tests/role-case-render.test.mjs` (resume hint), `tests/role-materials-auto-draft.test.mjs` (the harness opts in to auto-draft).

**Outside my ownership:** `tests/e2e-journey/critical-journey.spec.mjs`. Its materials test drove the removed notes form, and a stranger's harness has no resume. It now seeds a resume with `CommandCenterUserContent.setPrimaryResume`, types into the notes disclosure, and drafts in one click. The rest of that test is unchanged.

## Contracts touched

- **Kept:** `data-action="resume-cover"` / `"resume-tailor"`, `data-mount="materials"`, the `data-doc` rows, and `materials-repair` / `-retry` / `-dismiss` / `-preview` / `-download`. `expandedJobKeys`, `updateJobStatus`, `schemas/pipeline-row.v1.json` and the PIPELINE-CARDS-HANDOFF selectors are untouched.
- **Added data-actions:** `open-resume`, `materials-server-retry`, `materials-copy-command`, `materials-open-md`, `materials-edit`. There is also a new `data-mount="scribe"` slot in the Case canvas.
- **Events:** `jb:materials:manifest` is now also dispatched with `reason: "state"`, and `manifest` may be null, when the server goes down or comes back, or when the resume summary changes. role.js re-renders on it. Nothing else listens.
- **Materials API:** the `/request` body gains `resume`, per the server sub-lane contract. The `/repair` body also gains `resume`; this is not in that contract (handoff 4). `422 {code: "resume_required"}` is handled.
- **Visual baselines:** none refreshed. No snapshot moved, and all 37 visual tests pass.

## APIs added

- `JobBoredRoleMaterials`:
  - `getServerState()` returns `""`, `"up"` or `"down"`.
  - `getResumeSummary()` returns `undefined`, `null` or `{filename, addedAt}`.
  - `isAutoDraftEnabled()` and `AUTO_DRAFT_STORAGE_KEY` (`"jobBored:autoDraft:v1"`, value `"on"`); `COMMAND_CENTER_CONFIG.autoDraftOnResearching === true` also opts in.
  - `noteViewPosting(jobKey)` and `answerReturnPrompt(yes)`.
- `JobBoredPostingEnrichment.getProviderNotice()` returns the inline notice, or `""` once a provider is configured.
- `JB_SCRIBE.openDocument({jobKey, feature, company, title, filename, text, terms?})`, plus `closeDocument()` and `remount()`.
- `JobBoredScribeState.bindDocument(doc)` and `clearDocument()`.
- `JobBoredScribeScore.keywordCoverage(text, terms)` returns `{matched, missing, total}`.

## Handoffs

1. **Lane F (Settings):** add an "Auto-draft on Researching" toggle that writes localStorage `jobBored:autoDraft:v1 = "on"`, or read `JobBoredRoleMaterials.AUTO_DRAFT_STORAGE_KEY`. Until then, auto-draft is off for everyone.
2. **Owner of `role.js` (unassigned in SPEC §5):** add the Scribe editor to `EDIT_SURFACE_SELECTOR`, so a Case re-render waits while the user types in Scribe. Scribe refocuses after a remount, but the caret position is lost.
3. **Lane D:** keep the positional `confirmApplied(jobKey, ctx)` form. Also consider having `flowing-writes.moveStage` forward `detail.prefill`: without `JobBoredSubmission`, E's fallback dispatches `jb:pipeline:move` with `prefill`.
4. **Server sub-lane:** record `resume: {filename, addedAt}` in the manifest, so the line can read "Drafted from". Accept or ignore `resume` on `/repair`. The sub-lane had no commits on `feat/ux01-sol-server` when I built this, so E follows the contract as written in the kickoff.
5. **Lane A kit:** move `.case__gate`, `.case__notice`, `.case-return` and their buttons onto `.jb-banner` / `.jb-btn` now that C3 has landed. The kit had not landed when this lane started.
6. **Remaining work (C12/C13/C14 partials):** TA-07 engine choice, TA-13 draft-id keying, TA-08 server-engine refine, TA-10 Repair instructions.

## Not verified

- **Browser runs:** the server-down state, the resume gate, the review row, Open QA report, Scribe Edit-in-dossier and the C16 prompt are covered by vm unit tests only. The hermetic fence serves no `.html` or `.md` material files and no 422, so no Playwright run drove them. The one-click draft with a seeded resume, and the inline provider notice, were exercised in a real browser (journey and smoke).
- **Real server:** the 422 path has not been run against a real server, because the server half is on another branch.

## Floor (worktree root, head d8a5dc3)

Logs are in `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/E-*.log`.

```
npm run lint:repo          → OK integrations/openclaw-command-center/SKILL.md · EXIT 0
npm run typecheck:repo     → > tsc --noEmit --project server/tsconfig.json · EXIT 0
npm test                   → ℹ tests 3092 · ℹ pass 3091 · ℹ fail 0 · ℹ cancelled 0 · ℹ todo 1 · EXIT 0
                             (the todo is the one already on the base: "persists and can remove the canonical
                              submission evidence record # blocked on the canonical-ownership gate")
npm run test:contract:all  → OK integrations/openclaw-command-center/SKILL.md · EXIT 0
npm run test:e2e-smoke     → 11 passed (15.7s) · EXIT 0
npm run test:e2e-journey   → 13 passed (18.7s) · EXIT 0
npm run test:e2e-visual    → 37 passed (1.0m) · EXIT 0
```

The first smoke run failed. The resume read could re-render the Case while the materials fetch was in flight, and the rows then painted into a detached mount. The regression test for this fails without the fix and passes with it. Fixed in `d8a5dc3`; smoke and visual were then re-run green.

## Verification · floor (E-r1)

Independent Opus verifier, fresh context, run 2026-09-25 on `feat/ux01-dossier-tailor` at `26c9660`. All seven commands ran in order from the workspace root. None was retried or filtered, and no spec was re-run. Logs are in `Job-Bored.worktrees/.ux01-run/E-r1-floor/<n>.log`.

| # | Command | Result | Counts |
|---|---|---|---|
| 1 | `npm run lint:repo` | PASS (exit 0) | eslint + skills lint clean |
| 2 | `npm run typecheck:repo` | PASS (exit 0) | all tsc projects clean |
| 3 | `npm test` | PASS (exit 0) | 3092 tests · 3091 pass · 0 fail · 0 skipped · 1 todo |
| 4 | `npm run test:contract:all` | PASS (exit 0) | all schema/contract checks OK |
| 5 | `npm run test:e2e-smoke` | PASS (exit 0) | 11 passed (14.8s) |
| 6 | `npm run test:e2e-journey` | PASS (exit 0) | 13 passed (20.2s) |
| 7 | `npm run test:e2e-visual` | PASS (exit 0) | 37 passed (60.0s) |

Flaky: none. One note: the node runner prints a "failing tests" block for one **todo** test. It is not counted as a failure (fail 0, todo 1) and the command exits 0. The test is `tests/submission-record-audit.test.mjs:17`, "persists and can remove the canonical submission evidence record", and it is marked `# blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store`. Its body currently fails `deepStrictEqual` (actual `[]`, expected one evidence record).

```
ℹ tests 3092
ℹ suites 753
ℹ pass 3091
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
  11 passed (14.8s)   # e2e-smoke
  13 passed (20.2s)   # e2e-journey
  37 passed (60.0s)   # e2e-visual
```
