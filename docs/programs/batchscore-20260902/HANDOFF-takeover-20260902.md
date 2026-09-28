# Handoff: BATCHSCORE orchestration + hardening PR #102 (2026-09-02 ~23:00 CDT)

## Who takes over
A `muse-spark` session continuing orchestration in `/Users/emilionunezgarcia/Job-Bored`.
First read: `docs/programs/batchscore-20260902/BATCHSCORE-SPEC.md` (sections 1 + 4) and `docs/programs/batchscore-20260902/GROUND-RULES.md`.

## Goal (plain terms)
Discovery runs take ~25 min serially; BATCHSCORE makes them finish in under a minute via batching + concurrency, scores stretch roles against pursued roles instead of past titles, fixes a stuck-"running" terminal write, and shows live "Scoring n / N · Company" progress. Full goal/success criteria: SPEC section 1.

## Done in this session
1. **Pushed `feat/discovery-hardening` and opened PR #102** (`gh pr view 102`).
   Retitled to conventional-commit format after `pr-lint` failed on the first title.
2. **Merged `origin/main` into the hardening branch** inside its worktree
   (`/private/tmp/Job-Bored-discovery-hardening-integration`, branch `feat/discovery-hardening`).
   Two conflicts, both resolved and staged but **NOT committed, NOT pushed**:
   - `package.json` (`typecheck:repo` line): kept main's line (no `role-brief.js` — dossier program deleted that file) plus hardening's two additions (`node --check discovery-run-tracker.js`, `node --check scripts/discovery-canary.mjs`). Both files verified present; JSON validated.
   - `tests/e2e-journey/critical-journey.spec.mjs`: union of both appended blocks (hardening's SCRAPE-E2E-1 + main's SIXBEATS re-pins). Imports/helpers verified present, no duplicate consts or test names, module syntax checked.
   - `handle-discovery-webhook.ts` auto-merged cleanly.
3. **Floor in the hardening worktree, 4 of 5 green**: typecheck ✅ · worker tests 763/763 ✅ · contract ✅ · lint ✅ · **`npm test` NOT yet run**.

## Immediate next step (do this first)
```bash
cd /private/tmp/Job-Bored-discovery-hardening-integration
npm test   # last floor step; ~2500+ tests, allow up to 10 min
```
- If green: `git commit` the merge (message e.g. `merge(main): resolve package.json + critical-journey conflicts into feat/discovery-hardening`), `git push`, then `gh pr checks 102` and monitor CI to green. Push of this branch/PR is pre-approved ("push once green").
- If red: paste failures; fix only what the merge broke (dossier vs hardening interaction), do not re-litigate either program's own code.

## After #102 is green (BATCHSCORE steps, in order)
1. Merge `main` (`b5bc7fe`) into `feat/batchscore-integration` (worktree `/private/tmp/Job-Bored-batchscore-integration`, currently `@ d9d92d1`). Expect additive conflicts in package.json script-list + journey spec. Full floor, commit.
2. Floor each Wave-1 lane in its worktree (`/private/tmp/Job-Bored-batchscore-{infra,intent,concurrency}`; lane reports `LANE-REPORT-*.md` already exist there). Codex sandbox blocks commits/loopback — treat EPERM/EADDRINUSE as sandbox refusal, rescue-commit as needed.
3. Merge lanes into integration one at a time, infra → intent → concurrency, floor green each time. Lane tips: infra `ed5b17b`, intent `823744b`, concurrency `0ec4b5a`.
4. Spawn Wave 2 (batch, funnel, progress-ui kickoffs in `docs/programs/batchscore-20260902/KICKOFF-*.md`) from the green integration commit; report lane PIDs/worktrees.
5. BATCHSCORE's own PR waits until hardening's PR merges. Integration branch pushes as plain backup branch (no PR, zero CI) until then.

## Standing rules
- Floor (every merge): `npm run typecheck:browser-use-discovery` → `npm run test:browser-use-discovery` → `npm run test:contract:all` → `npm run lint:repo` → `npm test`.
- Never commit on `main`; conventional commit messages; verify before committing.
- Never push without say-so, except the hardening merge-push already approved above.
- **Do NOT touch**: the user's 9:16 PM discovery run (healthy; it is the "before" timing evidence for `evidence/LIVE-CHECK.md`); uncommitted `logos.json` change + untracked files in the main checkout (preserve; the merge work happens in worktrees).
- Subagents: default to Opus per repo CLAUDE.md model policy.

## Branch/SHA map
| Ref | SHA | Note |
|---|---|---|
| `main` / `origin/main` | `b5bc7fe` | PR #101 worker.log merged |
| `feat/discovery-hardening` (remote) | `caef84c` | PR #102 open; local merge uncommitted in its worktree |
| `feat/batchscore-integration` | `d9d92d1` | behind main, needs main merged in |
| `feat/batchscore-infra` | `ed5b17b` | Wave-1, finished green per prior transcript, floor pending re-verify |
| `feat/batchscore-intent` | `823744b` | same as above |
| `feat/batchscore-concurrency` | `0ec4b5a` | same as above |
| Open PRs | #84 release-please, #97/#98 dependabot, #102 hardening | BATCHSCORE has no PR yet by design |
