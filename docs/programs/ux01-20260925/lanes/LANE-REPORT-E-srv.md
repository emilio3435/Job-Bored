# UX01 lane E-srv (C11 server half): lane report

Branch `feat/ux01-sol-server`, cut from `feat/ux-zero-to-one` at cca3e30. Worktree `~/Job-Bored.worktrees/ux01-sol-server`. Not pushed.

## What changed for the user

The server used to write every "tailored" resume and cover letter from the maintainer's committed `resume-template/resume.html` and `cover-letter-template/cover-letter.html`. As a result, a stranger's documents carried Emilio's name, phone number, employers and metrics (TA-01). Now the server drafts only from the resume the dashboard sends with the request. If no resume arrives, it refuses with `422 resume_required` instead of drafting from someone else's. The finished documents use a neutral greyscale layout that shows the user's own name and contact line. Every draft records which resume it came from, and a resume that names an employer missing from the user's resume now fails QA.

## Changes

| Id | Status | Note |
|---|---|---|
| C11 (server half) | done | Request carries `resume`. Missing or blank text returns a 422. The drafter works from the user's text and stops reading the repo templates. Provenance is recorded. The critic flags invented employers. Repair redrafts from the role's snapshot. |
| C11 (dossier gate, provenance line UI) | not this lane | Lane E builds it against the contract below. |

## Request / response contract (lane E consumes this)

`POST /api/applications/:slug/request`

```jsonc
{
  "company": "Acme", "title": "Ops Analyst",
  "feature": "resume" | "cover_letter" | "both",
  "jobUrl": "https://…", "notes": "",
  "resume": {
    "source": "portfolio",          // where the dashboard got it; ≤40 chars; default "unknown"
    "filename": "jordan-rivera.pdf", // display name; may be ""
    "addedAt": "2026-09-20T15:00:00.000Z", // ISO; may be ""
    "text": "Jordan Rivera\n…"       // REQUIRED, plain text, trimmed, capped at 60 000 chars
  }
}
```

- **The resume is missing, not an object, or its text is blank** → HTTP **422**:
  `{ "error": "Add your resume before drafting.", "code": "resume_required" }`
  The body is the server's existing `sendAppError` shape (`error` + `code`). Lane E should key on `code === "resume_required"` and render the "Add your resume first" gate. The `message` field the lane notes mention is not sent, because `sendAppError` lives in `server/index.mjs`, which this lane does not own (see Handoffs).
- Slug, feature, company and title are validated first, so a bad body still returns 400.
- The body limit is `express.json({ limit: "2mb" })`, which leaves plenty of room for the resume text.
- **Success is unchanged**: `{ ok, slug, pending_path, requested_at, accepted }`.
- **Provenance while drafting**: `pending.json` gains `resume: { source, filename, addedAt }`. It holds metadata only, never the text.
- **Provenance after drafting**:
  - `qa-report.md` gains a line `Drafted from: <filename> (<source>, added <YYYY-MM-DD>)`. It falls back to `your resume` when the filename is empty.
  - `<slug>/resume-source.json` holds `{ source, filename, addedAt, text, usedAt }`. This is the per-role snapshot, and it stays in `~/.jobbored/applications/`.
- **Repair** (`POST /api/applications/:slug/repair`): `buildRepairRequestPayload` now sets `resumeFrom: "snapshot"`, so a repair redrafts from `resume-source.json`. If the role has no snapshot, repair also returns the 422 `resume_required`. A `/request` body may send `resumeFrom: "snapshot"` to get the same behaviour, but lane E should always send `resume`.

## How it works

- `server/materials-resume-source.mjs` (new) exports:
  - `normalizeResumeSource`
  - `resumeRequiredError` (statusCode 422, code `resume_required`)
  - `RESUME_REQUIRED_CODE` and `RESUME_REQUIRED_MESSAGE`
  - `readResumeSnapshot` and `writeResumeSnapshot`
  - `resumeProvenance`
  - `formatProvenanceLine`
  - `candidateNameFromText`
- `server/materials-request.mjs`:
  - `normalizeRequestBody` returns `resume` and throws the 422 when it is absent.
  - `spawnMaterialsRequest` is now `async`. It resolves the snapshot for `resumeFrom: "snapshot"` and never enqueues without a resume.
- `server/materials-drafter.mjs`:
  - `enqueue` refuses without a resume, before the pin check and before writing `pending.json`. This is defence in depth.
  - `DEFAULT_RESUME_TEMPLATE` and `DEFAULT_LETTER_TEMPLATE`, and the reads of them, are gone.
  - `readMasterResume` and `readMasterLetter` remain as **TEST-ONLY sample layouts**. In production both are absent, and the documents come from `materials-candidate-docs.mjs`.
  - The writer, editor and critic receive `resumeText`.
- `server/materials-candidate-docs.mjs` (new): `renderCandidateResume` and `renderCandidateLetter` build a neutral layout from the writer JSON. Their output keeps the hooks the quality and critic checks read: `article.page`, `data-section` summary/experience/education/skills, `article[data-role]`, `h2.company-name`, and the letter's `data-slot` names. All text is HTML-escaped, and the layout uses no brand fonts, assets or colour tokens.
- `server/materials-writer.mjs`:
  - The prompt names the candidate's resume as "the only source of facts".
  - The schema gains `resume.header {name, headline, contact[]}`, per-role `company/title/dates/location`, `education[]` and `skills[]`.
  - The sample role id `audacy-dsm` is replaced with `employer-slug`.
- `server/materials-critic.mjs`: a new `invented_employer` check (severity fail) flags every `h2.company-name` in the composed resume that does not appear in `sourceResumeText`.

## Tests (the failing test came first)

`tests/materials-resume-required.test.mjs` (13 tests) was written before the code and failed at import. It now passes. It covers:
- the 422 on a missing resume, blank text or a non-object resume
- that a bad slug still returns 400
- pass-through of the normalized resume
- the snapshot marker on repair, a 422 without a snapshot, and loading the snapshot when there is one
- a drafter enqueue without a resume, which rejects and writes no `pending.json`
- that the writer receives the user's text, and the output HTML contains `Jordan Rivera` and `Northwind Logistics` but no `Emilio`, `Nunez`, `Audacy` or `emiliobuilds`
- provenance in `pending.json`, `resume-source.json` and `qa-report.md`
- the critic's `invented_employer` check

`tests/materials-drafter.test.mjs` and `tests/materials-request-endpoint.test.mjs` now send a stand-in `resume` in their payloads. Their assertions are unchanged.

## Files touched

- server/materials-resume-source.mjs (new)
- server/materials-candidate-docs.mjs (new)
- server/materials-request.mjs
- server/materials-drafter.mjs
- server/materials-writer.mjs
- server/materials-critic.mjs
- server/materials-repair.mjs
- tests/materials-resume-required.test.mjs (new)
- tests/materials-drafter.test.mjs
- tests/materials-request-endpoint.test.mjs

## Contracts touched

- The HTTP contract `POST /api/applications/:slug/request` now requires `resume`. This is a breaking change for clients that do not send it, so lane E must ship the dashboard half together with this branch.
- `pending.json` gains a `resume` provenance object (additive).
- New per-role file: `resume-source.json`.
- None of the Sheet write-back contracts were touched: `data-action`, `data-stable-key`, `expandedJobKeys`, `updateJobStatus`, the PIPELINE-CARDS selectors and `pipeline-row.v1`.

## APIs added

- `server/materials-resume-source.mjs` exports: `RESUME_REQUIRED_CODE`, `RESUME_REQUIRED_MESSAGE`, `RESUME_SNAPSHOT_FILE`, `resumeRequiredError`, `normalizeResumeSource`, `resumeProvenance`, `formatProvenanceLine`, `writeResumeSnapshot`, `readResumeSnapshot` and `candidateNameFromText`.
- `server/materials-candidate-docs.mjs` exports: `candidateHeader`, `renderCandidateResume` and `renderCandidateLetter`.

## Baselines refreshed

None. This lane changed no UI.

## Upstream merge

`git merge --no-edit feat/casefit` conflicted in `role-case-model.js`, `role-case.css`, `role-case.js` and `role-materials.js`. None of these are server files, and none are owned by this lane. The merge was aborted, and this branch builds on `feat/ux-zero-to-one` alone. The server files merge cleanly with casefit, because casefit does not touch `server/materials-*`.

## Handoffs

1. **Lane E: `role-materials.js`** (docket request body, around lines 2089–2113)
   - Add `resume: { source, filename, addedAt, text }` from `UserContent`'s active resume.
   - On a 422 with `code === "resume_required"`, render the "Add your resume first" block that opens `#materialsModal` at Resume. Lane E should check before sending as well.
   - The provenance line can read `pending.resume` while drafting and `qa-report.md`'s `Drafted from:` line afterwards.
   - The auto-draft path (`autoDraftMove`, TA-03) must also send `resume`, or it will now get a 422.
2. **Owner of `server/application-materials.mjs`**: expose provenance in the manifest from `resume-source.json` as `resumeSource: { source, filename, addedAt, usedAt }`, **without** `text`, so the dossier can show "Drafted from X, added D" without parsing `qa-report.md`. `resume-source.json` holds the resume text. It is already outside `ALLOWED_FILES` (verified at `application-materials.mjs:27`), so `/files/` does not serve it, and it must stay outside.
3. **Owner of `server/index.mjs`**: optionally add `message` next to `error` in `sendAppError`, if lane E wants the `{code, message}` shape named in the lane notes. It is not needed, because `error` already carries the same string.
4. **Owner of `integrations/hermes-job-hunt/{resume,cover-letter}-template/`**: label both files as the maintainer's samples in their header comments, or replace their content with placeholders (TA-01's "neutral sample"). The server no longer reads them. The Hermes skill may still read them.
5. **Noted, not fixed (out of scope):** `normalizeRequestBody` drops `jobDescription`/`jdText`. The drafter's "JD from request" branch can therefore only be reached by direct `enqueue` callers, not over HTTP. This is pre-existing; I flagged it so lane E does not rely on pasting a JD through `/request`.

## Floor (worktree root, logs under `~/Job-Bored.worktrees/.ux01-run/E-srv-*.log`)

```
lint:repo exit=0
typecheck:repo exit=0
test exit=0
test:contract:all exit=0
test:e2e-smoke exit=0
test:e2e-journey exit=0
test:e2e-visual exit=0

== npm test
ℹ tests 3071
ℹ pass 3070
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
  (the 1 todo is the pre-existing 'canonical submission evidence' todo, untouched)
== lint:repo
> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
== typecheck:repo
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
== test:contract:all
> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
== test:e2e-smoke
  ✓  10 tests/e2e-smoke/hermetic-fence.spec.mjs:46:1 › should never let an unstubbed /__proxy/start-discovery-worker reach the server (457ms)
  ✓  11 tests/e2e-smoke/hermetic-fence.spec.mjs:70:1 › should answer every host-mutating /__proxy and /profile path in the fence (278ms)
  11 passed (15.7s)
== test:e2e-journey
  ✓  12 tests/e2e-journey/critical-journey.spec.mjs:583:1 › should pause to a live corner pill for a visitor who poked around first (447ms)
  ✓  13 tests/e2e-journey/critical-journey.spec.mjs:620:1 › should serve the dashboard's own /profile from the local API, never a static 404 (272ms)
  13 passed (21.3s)
== test:e2e-visual
  ✓  36 tests/e2e-visual/shell-structure.spec.mjs:228:3 › the one shell on a phone — claim C7 › should keep every beat's actions reachable without scrolling (4.7s)
  ✓  37 tests/e2e-visual/shell-structure.spec.mjs:310:3 › the one shell on a phone — claim C7 › should dock the footer at the bottom of the viewport, not the bottom of the card (1.0s)
  37 passed (1.0m)
```


## Verification · floor (E-srv-r1)

Verifier: fresh Opus context (independent of the author). Run 2026-09-25 from the workspace root on `feat/ux01-sol-server`. Logs: `Job-Bored.worktrees/.ux01-run/E-srv-r1-floor/<n>.log`. No retries needed, no flaky specs.

| # | Command | Result | Counts |
|---|---|---|---|
| 1 | npm run lint:repo | PASS (exit 0) | eslint + skills lint clean |
| 2 | npm run typecheck:repo | PASS (exit 0) | all tsc projects clean |
| 3 | npm test | PASS (exit 0) | 3071 tests, 3070 pass, 0 fail, 0 skipped, 1 todo |
| 4 | npm run test:contract:all | PASS (exit 0) | every contract check OK |
| 5 | npm run test:e2e-smoke | PASS (exit 0) | 11 passed |
| 6 | npm run test:e2e-journey | PASS (exit 0) | 13 passed |
| 7 | npm run test:e2e-visual | PASS (exit 0) | 37 passed |

Note: the single `todo` in npm test is `tests/submission-record-audit.test.mjs:17` ("persists and can remove the canonical submission evidence record", marked todo: blocked on the canonical-ownership gate). It asserts and fails inside the todo, and node:test does not count that toward `fail`.

### Tails

```
--- 3.log
ℹ tests 3071
ℹ suites 744
ℹ pass 3070
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 13555.40525
--- 5.log

  11 passed (14.8s)
--- 6.log

  13 passed (20.1s)
--- 7.log

  37 passed (1.0m)
--- 4.log
OK integrations/openclaw-command-center/SKILL.md
```
