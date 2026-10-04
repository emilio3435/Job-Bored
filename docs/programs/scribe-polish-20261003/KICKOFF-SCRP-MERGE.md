# Lane MERGE: bring origin/main into the SCRP branch

Read `KICKOFF-SCRP-_SHARED.md` first, including the storage-isolation amendment at its end. Then read `SPEC-SCRP-20261003.md` §0 (D1–D29) and `ISSUE-LEDGER.md`. All three are in this program folder. You are the only lane running.

**Goal.** Merge `origin/main` (currently 48a5bca7) into `feat/scribe-polish-20261003` with one merge commit. The result must keep both sides' intent:
- main's GRADE verdict/rescore work and the grounded lean-prose engine
- every SCRP behaviour: D29, numeric-run locks for AI ops, verbatim manual text, lossless saves, bring-back of the desk doc, regenerate of both current docs, committed-503 metadata, GET open, R0 terminal queue

**Success means:**
- Every conflict is resolved by understanding both changes. Never take one side wholesale. Expect conflicts in `server/materials-nodes.mjs`, `server/materials-regenerate.mjs`, `server/materials-versions.mjs`, `server/materials-writer.mjs`, `tests/materials-nodes.test.mjs` and `tests/materials-pipeline.test.mjs`. Write one line per file in your report saying how you combined it.
- Do not hand-merge the three binary visual snapshots (`scribe-v2-390-{chat,doc,versions}-darwin.png`). Regenerate them from the merged tree with `npx playwright test --config tests/e2e-visual/playwright.config.mjs tests/e2e-visual/scribe-v2.spec.mjs --update-snapshots -g "390"`, then rerun the whole visual spec unfiltered.
- The full floor is green on the merged tree, after `source .lane-evidence/scrp-env/env.sh` (never unset JOBBORED_HOME):
  - Gate A plus `tests/materials-regenerate.test.mjs`
  - E ×20
  - Gate B plus the capability unit files
  - Gate C (journey, desk, pdf)
  - CSP
  - Visual
  - D (`npm run test:materials-contract && npm run lint:repo && npm run typecheck:repo && npm run test:contract:all`)
  - Full `npm test`. The only allowed failures are the known set that also fails on `origin/main` itself (logo resolver under RESOLVER=off, the submission-record ownership gate, E5 Docker boot). Prove this by running `npm test` on a detached `origin/main` worktree with the same env and diffing the failing test names.
- Any test that main changed and SCRP also changed must keep both assertions. Never delete an assertion to resolve a conflict. If two pinned expectations truly contradict, write it up in §5 as `BLOCKED: <which tests, why>` and stop.
- The merge is committed with the message `merge: origin/main into feat/scribe-polish-20261003 (GRADE verdicts, lean prose)` and these trailers:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Vxz76XKQvASoqj886opQD9`
- Your report is `.lane-evidence/LANE-REPORT-MERGE.md`. Its first line is `DONE` or `BLOCKED: <why>`, and §3 contains `MERGE-DONE <sha>`.

**Stop when:** the merge is committed and the full floor is pasted, or you are blocked.

**Fence:** the merge itself, plus any follow-up fix the merge requires. Put each fix in its own commit after the merge, explaining which main change it adapts to. Never push.
