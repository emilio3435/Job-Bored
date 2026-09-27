# BATCHSCORE ground rules (all lanes)

Read `BATCHSCORE-SPEC.md` in this directory first. It overrides the Gemini-authored source spec wherever they disagree. The inherited rules in `docs/programs/oneflow-20260831/GROUND-RULES.md` and `docs/programs/sixbeats-20260902/GROUND-RULES-ADDENDUM.md` still apply.

## Your first action: the lane report
Create `LANE-REPORT-<lane>.md` at the worktree root before any code. Five headings, each marked `PENDING` until real content replaces it:
1. What this lane was (two sentences, from the kickoff).
2. Which claims went red first — the test names and the pasted red output.
3. What shipped — file and fence, one line per file.
4. Floor results — pasted output of every floor command, not paraphrased.
5. Anything unverified — including anything the sandbox refused (a command that errored on permissions, a port that would not bind, a commit that failed).

A lane is not done until section 4 holds real output. Lanes die to quota and sandbox refusals; a report written last is a report never written.

## Red first
Write the failing test, run it, paste the red into report section 2, then implement. A test that passes before the implementation lands is not evidence.

## Traps that fail silently (these cost hours)
- **Test placement.** The worker suite runs only these directories: `integrations/browser-use-discovery/tests/` root, and its `browser/`, `discovery/`, `sources/`, `state/`, `sheets/`, `webhook/`, `run/`, `e2e/` subdirectories. A test under `tests/normalize/` or any other new directory never runs and never fails. The dashboard suite is `npm test`, which recurses the repo-root `tests/`.
- **`node --test tests/*.test.mjs` skips the integration directory.** The real dashboard gate is `npm test`.
- **Codex sandbox and git.** A Codex lane in a worktree usually cannot commit: the worktree's git metadata lives in the main repo's `.git/worktrees`, outside the sandbox, so `git commit` fails on `index.lock`. Try once. If it fails, leave the working tree dirty, write `UNCOMMITTED — rescue commit needed` at the top of report section 3, and continue. The orchestrator commits your work with a message saying so. Never `git stash`, never `git reset`, never `git checkout -- <file>`.
- **Codex sandbox and loopback.** A suite that fails only with `EPERM` / `EADDRINUSE` on `127.0.0.1` is a sandbox refusal, not your regression. Paste it verbatim in report section 5 and say so. Do not mark tests `.skip`, do not filter them out, do not delete them.
- **Codex sandbox and `ps`.** Process inspection is blocked. Do not build a Definition of Done step on it.
- **Cache key.** The listing score cache key is `sha256(canonicalUrl | profile.updatedAt | schemaVersion)`. Nothing in this program changes it. If your change would make a cached score stale, say so in the report instead of changing the key.
- **Two runners, one repo.** The worker is TypeScript under `--experimental-strip-types`; the dashboard is plain JS. Type-only imports need `import type`. A `.ts` file that imports a runtime value with `import type` fails at runtime, not at typecheck.

## Fences
Edit only the files your kickoff names. If the work genuinely requires a line outside your fence, stop, write the exact line and why into report section 5, and continue with everything that does not depend on it. The orchestrator resolves fence disputes; lanes never negotiate them with each other.

## Style
Strict TypeScript, no `any` (use `unknown` with guards), named exports, kebab-case filenames, `interface` for object shapes, exhaustive switches with a `never` default. Match the surrounding code's style even where you would do it differently. No refactors, no comment rewrites, no formatting passes outside the lines your change needs.

## The floor (run all of it, paste all of it)
```
npm run typecheck:browser-use-discovery
npm run test:browser-use-discovery
npm run test:contract:all
npm run lint:repo
npm test
```
Run from the worktree root. If `node_modules` is missing, tell the orchestrator via report section 5; do not run `npm install` yourself.

## Ending
Commit locally (if the sandbox allows), never push, keep scratch in `.lane-evidence/`, delete nothing. Do not end your turn to check in; keep going until the Definition of Done is met or you are genuinely blocked, and say which in the report.
