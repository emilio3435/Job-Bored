BLOCKED: the local commit is complete, but the original worktree index cannot unstage the ignored report

## 1 Mission
The account fence now records a count-only `selectionSummary` with `{ selected, featured, earlier, pageBudgetExcluded }` in the saved resume run and manifest. The current API manifest copies only a valid summary from its matching published resume run. The one-page limits are unchanged. Local commit: `4f0a97eae6a2edeb8575ae9e13690b6eb0ecd0ab` (`fix: account for selected resume evidence`). No push, PR, merge, or deployment occurred.

## 2 Red-first claims
R4 was red before implementation. `npm test -- tests/materials-pipeline.test.mjs` reported `tests 18`, `pass 14`, `fail 4`: the new nine-claim and two-employer assertions saw `selectionSummary: undefined`; the missing/unknown/duplicate-ID assertion did not throw; and the published run lacked `selectionSummary`. `npm test -- tests/application-materials.test.mjs` reported `tests 56`, `pass 55`, `fail 1` because the manifest lacked the current-run summary. Dependencies were restored with `npm ci --offline` before these red runs.

## 3 Shipped fence
`buildOutline` validates every selected claim ID and partitions selected IDs exactly once across featured, earlier, or `page_budget`; a missing, unknown, duplicate, or unaccounted selected ID fails. `runPipeline` passes the count-only summary to publication and clears it on letter-only publication. `buildRunRecord` persists it, and the strict run schema accepts only four nonnegative integer counts while legacy runs may omit the field. `buildManifest` exposes it only for a matching current resume run with a resume document. Fictional tests cover nine selected / five featured / four excluded, two employers within budget, bad IDs, current/stale/letter-only/legacy manifests, and rejection of extra summary fields. The commit contains exactly these seven code, schema, and test files; it does not contain `.lane-evidence/LANE-REPORT-account.md`.

## 4 Floor output
`npm test -- tests/materials-pipeline.test.mjs`: exit 0; `tests 18`, `pass 18`, `fail 0`.

`npm test -- tests/application-materials.test.mjs`: exit 0; `tests 56`, `pass 56`, `fail 0`.

`npm run lint:repo`: exit 0; `eslint .`, `OK integrations/openclaw-command-center/SKILL.md`, `lint:tokens ok: 38 sheet(s), 0 new finding(s), 0 brace error(s)`.

`npm run typecheck:repo`: exit 0; `tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json`, `tsc --noEmit --project server/tsconfig.json`, and the repository syntax checks passed.

`npm run test:contract:all`: exit 0; discovery and ATS schemas passed; `materials budget contract: no drift`; pipeline row and update contracts passed; integration skill link passed.

`gitleaks protect --staged --redact` with `GIT_INDEX_FILE` set to the intended commit index: exit 0; `0 commits scanned`, `scanned ~8950 bytes (8.95 KB)`, `no leaks found`.

Additional targeted checks: `npm test -- tests/materials-stages.test.mjs` = 8/8 passed; `npm test -- tests/materials-proof-fixes.test.mjs` = 8/8 passed; `git diff --cached --check` on the intended commit index = exit 0.

## 5 Unverified
The kickoff fence states: "Fence: `server/materials-outline.mjs`, `server/materials-pipeline.mjs`, `server/application-materials.mjs`, dedicated tests under `tests/materials-pipeline.test.mjs` and `tests/application-materials.test.mjs` (new focused tests allowed). Do not edit ingestion, drafter, Dossier UI, or shared docs. Start from the spec's count shape; the Dossier lane consumes it." The needed two-file extension was explicitly approved before editing those files.

The ordinary worktree index path `/Users/emilionunezgarcia/Job-Bored/.git/worktrees/RESD-account/index` is read-only in this session: two `git restore --staged .lane-evidence/LANE-REPORT-account.md` attempts and a harmless metadata touch returned `Operation not permitted`. A temporary, writable Git index excluded the ignored report and was used for the secret scan, tree, and local commit. The branch now points to that commit, and its committed tree has no report, but the original worktree index still shows the report staged plus stale entries for three changed files. That index cleanup is blocked in this session. Browser, PDF, live-provider, and integration-branch full-repository checks are outside this lane and were not run.

## Integration-owner addendum

CONFIRMED: The original index issue was cleared in the worktree, and `git status --short` is clean. Independent review found a real post-fit bug: a selected claim removed by final page fitting was still counted as featured. A fictional five-selected case failed first, then `6c7b5de0` changed the summary to count only claims present in the final fitted resume (`2 featured`, `0 earlier`, `3 pageBudgetExcluded`). The reviewer rechecked experience and earlier lines, blank removals, duplicate IDs, accepted and rejected repair passes, and count-only schema validation; no further concrete defect was found. `npm test -- tests/application-materials.test.mjs tests/materials-pipeline.test.mjs` passed 76/76. Both account commits were merged into the integration branch locally. The lane's original BLOCKED header records its own earlier state, not the integrated state.
