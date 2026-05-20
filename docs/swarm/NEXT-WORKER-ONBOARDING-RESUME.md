# Worker Brief: Onboarding / Resume Upload Repair

Coordinator status:

- `origin/main` is clean at `9bf44f3 Consolidate discovery targeting in profile settings`.
- PR #5 is merged. Do not work from stale greenfield, company, or settings branches.
- Your worktree is `/private/tmp/job-bored-onboarding-resume-upload`.
- Your branch is `feat/onboarding-resume-upload-repair`.

## Objective

Verify and, only if needed, repair the onboarding resume upload / resume ingest flow.

The suspected user-facing risk is that a user can choose a resume file during onboarding or Profile setup but gets weak/no feedback, stale "not ready" state, or a stalled read/generate path.

## Hard Boundaries

- Start with evidence. Reproduce in the browser before patching.
- Do not touch discovery worker internals under `integrations/browser-use-discovery/src/**`.
- Do not redesign Settings/Profile/Discovery; PR #5 already landed that lane.
- Do not edit `.env`, state DBs, logs, uploads, or local bootstrap files.
- Do not commit or push. Leave changes for coordinator review.
- Keep changes focused to browser onboarding/resume ingestion surfaces if a real issue is found.

Likely files, only if evidence points there:

- `index.html`
- `app.js`
- `resume-ingest.js`
- `settings-profile-tab.js`
- focused tests under `tests/`

## Required Checks

1. Confirm current git status before changes.
2. Run a live browser smoke from this clean worktree.
3. Exercise resume upload readiness in:
   - onboarding file input
   - Profile resume file input
4. Check whether the UI gives immediate "reading/processing" feedback and either success or actionable failure.
5. If the current behavior is already good, do not patch. Report that cleanly.
6. If patching, add focused regression coverage.

## Suggested Commands

Use Node 20 if available. If this machine still only has Node 24, say so in your report and run with the available Node.

```sh
npm ci
npm run typecheck:repo
npm test -- tests/settings-profile-schedule-card.test.mjs
PORT=18082 npm run web-only
```

Use browser-use or another live browser check against `http://127.0.0.1:18082/`.

## Report Format

Write `/private/tmp/job-bored-onboarding-resume-upload/ONBOARDING_RESUME_WORKER_REPORT.md` and include:

- branch/head
- git status before and after
- exact repro steps
- browser evidence or screenshot path
- finding: pass/no-change-needed or issue found
- files changed, if any
- tests run and results
- remaining blockers

Then stop and wait for coordinator review.
