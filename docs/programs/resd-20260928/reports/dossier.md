DONE

## 1 Mission
Dossier lane (opus · claude-opus-5-5 · medium), branch fix/resume-dossier-ui, commit 24a540e4 (local, not pushed). Show a recovery path for a failed pending record with progress.code=resume_source_review (Retry + Open Resume via existing data-action=open-resume) and show the current published run's page-budget exclusion count from manifest.selectionSummary.pageBudgetExcluded (frozen contract per orchestrator correction, 13:12 CDT).

## 2 Red-first claims
R5, 7 new tests in tests/role-materials.test.mjs (case-mount suite). Red run before implementation (key then named resumeAccounting; renamed to selectionSummary after the contract correction, re-run green):
```
ℹ fail 3
✖ failing tests:
✖ materials rows in the case mount (3.916625ms)
ℹ pass 43
✖ R5 · should offer Retry and Open Resume on a resume_source_review failure (0.303875ms)
✖ R5 · should say 'point' for a single exclusion (0.082041ms)
✖ R5 · should show the current run's page-budget exclusion count on the resume row (0.119041ms)
ℹ tests 46
```
The 4 negative/guard tests (no Open Resume for other failures, server message kept, no note for legacy/zero/no-resume, hidden beside newer request) passed at red because the feature was absent; they guard regressions. One test regex was corrected for attribute order (data-review on the msg span) after implementation; the asserted text and actions are unchanged.

## 3 Shipped fence
```

 role-case.css                 |   2 +
 role-materials.js             |  42 +++++++++++++++--
 tests/role-materials.test.mjs | 102 ++++++++++++++++++++++++++++++++++++++++++
 3 files changed, 142 insertions(+), 4 deletions(-)
```
- role-materials.js: RESUME_SOURCE_REVIEW_CODE, recovery copy (server progress.message wins), Retry + Open Resume actions only for that code; pageBudgetExcludedOf() reads selectionSummary, requires a positive integer, a resume document, and no pending resume request (any phase).
- role-case.css: one scoped rule for .case__doc-note (no styles.css exists; role-case.css owns the Case row styles).
- No server files or shared docs edited.

## 4 Floor output
`npm test -- tests/role-materials.test.mjs` (exit 0):
```
  ✔ R5 · should offer Retry and Open Resume on a resume_source_review failure (0.187958ms)
  ✔ R5 · should keep the server's own recovery message for a resume_source_review failure (0.152417ms)
  ✔ R5 · should not offer Open Resume for any other failure (0.08975ms)
  ✔ R5 · should show the current run's page-budget exclusion count on the resume row (0.079042ms)
  ✔ R5 · should say 'point' for a single exclusion (0.067167ms)
  ✔ R5 · should show no exclusion note for a legacy manifest, a zero-exclusion run, or no resume (0.205375ms)
  ✔ R5 · should hide the old run's count beside a newer failed or running resume request (0.176875ms)
ℹ tests 46
ℹ pass 46
ℹ fail 0
```
`npm run lint:repo` (exit 0):
```
> node tools/lint-tokens.mjs

lint:tokens ok: 38 sheet(s), 0 new finding(s), 0 brace error(s)
```
`npm run typecheck:repo` (exit 0; tsc browser-use-discovery + server + node --check list):
```
> command-center@0.2.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

```
`gitleaks protect --staged --redact` — run standalone (no pipe) on the staged fence immediately before the commit. The first run was piped through `tail`, so the unpushed commit was soft-reset, gitleaks re-run standalone on the identical staged diff, then recommitted with the same message:
```
$ gitleaks protect --staged --redact --no-color; echo "exit=$?"
1:13PM INF 0 commits scanned.
1:13PM INF scanned ~7665 bytes (7.66 KB) in 52.8ms
1:13PM INF no leaks found
exit=0
```

## 5 Unverified
- Worktree had no node_modules; ran `npm ci` locally in this worktree only (no shared links touched).
- Not run: full `npm run test:repo`, Playwright suites, live browser check of the note/recovery row (integration/verify own these).
- End-to-end with the account lane's real manifest.selectionSummary and the ingest lane's failed pending is unverified until integration.
- Legacy brief-only panel (non-Case mount) does not show the count or Open Resume; its failed card keeps Dismiss/Try again. Scope was the Case Dossier rows.
- Retry on resume_source_review re-fires the same request via existing handleRetry; if the source is unchanged it will fail the same way (intended; Open Resume is the fix path).
