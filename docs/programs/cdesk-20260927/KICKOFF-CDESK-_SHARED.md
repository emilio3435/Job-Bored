# CDESK: shared ground rules for every lane

CDESK carries the Change Desk items Emilio approved on 2026-09-27 (11:37–11:56 CT). Each lane implements one fence. The same rules apply to the EDITOR (Scribe v2) lanes, whose kickoffs point here.

**Your first filesystem action is the report (below).**

You are working autonomously; Emilio is not watching. For reversible actions that follow from your kickoff, proceed without asking. Before ending your turn, check your last paragraph: if it is a plan, a question you can answer yourself, or a promise, do that work now. A step that fails the same way twice is a blocker: write `BLOCKED: <why>` as the report's first line and stop.

**Boundaries:**
- Work in your repo worktree only, and commit locally on your branch.
- Publication is Emilio's, and the publish guard denies it: push, PR, merge, `gh release`, `gh workflow run`, GitHub Pages deploys.
- Spawn no subagents.
- Change a test or fixture only when the thing it pins genuinely moved, and say so in the commit body.
- Parallel sessions are live. Another session is building the materials overhaul (worktrees `materials-w1-*`, `w1-tailoring`) and the template polish (`feat/materials-visual-polish`). Never read from or write to those worktrees. If your fence needs a file they are changing, keep your edit minimal and additive and name it in report §5.

## First action

Create `.lane-evidence/LANE-REPORT-<lane>.md`, first line `PENDING`, with five headings, each `PENDING`:
1. Mission
2. Claims that went red first
3. What shipped, file and fence
4. Floor results (paste, do not paraphrase)
5. Unverified / sandbox refused / shared-file notes

Update it by writing a temp file and renaming it into place. The lane is not done until section 4 holds real command output.

## Traps that fail SILENTLY (read twice)

- **Live ports.** Never bind :8080, :8644 or :3847. Emilio's live dashboard, discovery worker and API run there. Tests that start servers use an ephemeral or high port and kill it afterwards.
- **Hermetic-harness host leak.** Browser suites must run through `tests/e2e-fixtures/hermetic-harness.mjs`; its `isHostPath` answers host paths with 503. Stub any new worker or API route you add in the harness, or a local run can reach the live stack.
- **HOME isolation.** Run the full suite as `HOME=$(mktemp -d) npm test` so nothing touches `~/.jobbored`.
- **The jb-v2 cascade trap.** `body.jb-v2 h3/p` has specificity (0,1,1) and beats single-class rules. Scope every new CSS rule under your component's root class, or its typography silently never applies.
- **`jb-v2-legacy-hide.css`** loads last and forces some regions `display:block !important`, which beats `[hidden]`. Check it before relying on `hidden`.
- **Tokens.** Use `tokens-v2.css` semantics (`--jb-action`, `--jb-on-accent`, `--jb-accent-ink`, type roles). Never put `--jb-ink-inverse` on mint (about 2:1). No font size under 12px. `npm run lint:tokens` fails on new literals.
- **`index.html` script and link tags belong to the orchestrator.** Ask for additions in report §5 unless your kickoff grants them.
- **Key material.** Never put a key in a URL, log line, fixture or snapshot.
- **Reduced motion in Playwright.** `test.use({reducedMotion})` inside a describe never reaches the page. Use `page.emulateMedia` and assert on `matchMedia`.
- **Worktree deps.** `node_modules` and `server/node_modules` are symlinks to the main checkout. Do not run `npm install`.
- **Quota stop.** When you receive a `commit-and-stop` nudge, commit green work, write the report, and stop within five minutes.

## Floor (every lane)

```
npm run lint:repo
npm run typecheck:repo
HOME=$(mktemp -d) npm test
npm run test:contract:all
npm run test:e2e-smoke
npm run test:e2e-journey
npm run test:e2e-onboarding
npm run test:e2e-visual
```

Your kickoff may name extra suites. A lane that skips a suite says so and names the reason. Then stage your fence (`git add <paths>`) and run `gitleaks protect --staged --redact`. If a suite is red for a reason you did not cause, prove it by running the same test on `98903e29` (`git stash`-free: use `git worktree add --detach /tmp/<lane>-base 98903e29`), paste both results in report §5, and continue; the integrator decides.

## Commit

- Conventional commits, path-spec'd to your fence, one logical change each.
- Never `git add -A`. Never add `.lane-evidence/` or `LANE-REPORT-*`.
- End every commit message with:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

## Status

Run `cmux set-status lane working` at the start, `cmux set-status lane blocked` when blocked, and `cmux set-status lane done` when the report says `DONE`.

## Stop

Stop when the fence is exhausted, the floor is pasted, the report's first line is `DONE`, and your commits are on your branch. If blocked, the first line is `BLOCKED: <why>`; then stop.
