# GREENFIELD ground rules (all lanes)

Read `GREENFIELD-SPEC.md` in this directory first. It overrides `ROADMAP.md` wherever they disagree. The inherited rules in `docs/programs/sixbeats2-20260902/` and `docs/programs/batchscore-20260902/GROUND-RULES.md` still apply.

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
- **Script order.** `index.html` loads globals in a fixed order; a new global used before its script tag is `undefined` at runtime and green in every node test. If you add a file, add its `<script>` tag and say so in the report.
- **`npm test` is the gate.** `node --test tests/*.test.mjs` skips `tests/integration/`. Root tests are collected recursively from `tests/` by `scripts/run-tests.mjs`.
- **jb-v2 cascade.** Single-class CSS rules lose to `body.jb-v2 h3/p` (specificity 0,1,1). Scope component CSS under its root class or it silently never applies.
- **Playwright reduced-motion.** `test.use({ reducedMotion })` inside a `describe` never reaches the page. Use `page.emulateMedia` and assert `matchMedia`.
- **`getConfig()` nulls the whole config on a malformed `sheetId`.** Read `getEffectiveConfig()` (lane D lands it) or the raw `COMMAND_CENTER_CONFIG` when you need the other fields regardless.
- **`?greenfield=1` resets everything** and is stripped from the URL on first load. A reload without it resumes.
- **The static server 403s `config.js` in walkthroughs.** That is the harness's static server, not a product bug. Ignore it.
- **Beat 2 persists only on a verified continue.** Clicking a provider card sets in-memory state only. Any test that needs `resumeProvider` set must go through `checkAndContinue` or write the override directly.
- **Codex sandbox and git.** A Codex lane in a worktree usually cannot commit (`.git/worktrees` metadata is outside the sandbox → `index.lock`). Try once. If it fails, leave the tree dirty, write `UNCOMMITTED — rescue commit needed` at the top of report section 3, and continue. Never `git stash`, `git reset`, or `git checkout -- <file>`.
- **Codex sandbox and loopback.** A Playwright or dev-server run that fails only with `EPERM` / `EADDRINUSE` on `127.0.0.1` is a sandbox refusal, not your regression. Paste it verbatim in report section 5. Do not mark tests `.skip`, do not filter them out, do not delete them.
- **Codex sandbox and `ps`.** Process inspection is blocked. Do not build a Definition of Done step on it.

## Fences
Edit only the functions and files your kickoff names. `onboarding-flow.js` and `oneflow-beat-resume.js` are shared between lanes A and B by **function**: do not reformat, do not reorder, do not touch a function another lane owns. If the work genuinely requires a line outside your fence, stop, write the exact line and why into report section 5, and continue with everything that does not depend on it. The orchestrator resolves fence disputes; lanes never negotiate them with each other.

## Style
Match the surrounding file: classic-global IIFEs registered on `window.JobBoredOneFlow` for the beats, no ES modules in root browser scripts, named functions, kebab-case filenames. Strict TypeScript and named exports where a file is TypeScript. No refactors, no comment rewrites, no formatting passes outside the lines your change needs. Copy in the spec is locked; do not paraphrase it.

## The floor (run all of it, paste all of it)
```
npm test
npm run lint:repo
npm run typecheck:repo
npm run test:e2e-smoke
npm run test:e2e-visual
```
Run from the worktree root. If `node_modules` is missing, run `npm ci` once and say so in report section 5. If Playwright browsers are missing, `npx playwright install chromium` once and say so.

## Ending
Commit locally (if the sandbox allows), never push, keep scratch in `.lane-evidence/`, delete nothing. Do not end your turn to check in; keep going until the Definition of Done is met or you are genuinely blocked, and say which in the report.
