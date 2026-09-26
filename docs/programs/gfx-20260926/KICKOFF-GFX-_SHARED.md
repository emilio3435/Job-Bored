# GFX: shared ground rules for every lane

You implement one fence of GFX, the greenfield onboarding fix program for JobBored.

**Your first filesystem action is the report (below).** Then read, in this folder:
- `SPEC.md`: the ledger IDs and §0 decisions D1–D12
- `PLAN.md`: phases, lanes, Option C
- the Grok plan-check verdict at `reports/VERDICT-grok-plan-check.md`, if it exists

§0 overrides task and implementation choices in every kickoff. It never overrides the boundaries in this file.

You are working autonomously; Emilio is not watching. For reversible actions that follow from your kickoff, proceed without asking. Before ending your turn, check your last paragraph: if it is a plan, a question you can answer yourself, or a promise, do that work now. A step that fails the same way twice is a blocker: write `BLOCKED: <why>` as the report's first line and stop.

**Boundaries:**
- Work in your repo worktree only, and commit locally on your branch.
- Publication is Emilio's, and the publish guard denies it: push, PR, merge, `gh release`, GitHub Pages deploys, and anything under `.github/workflows` that triggers a deploy.
- Spawn no subagents.
- Change a test or fixture only when the thing it pins genuinely moved, and say so in the commit body.

## First action

Create `.lane-evidence/LANE-REPORT-<lane>.md`, first line `PENDING`, with five headings, each `PENDING`:
1. Mission
2. Claims that went red first (named with ledger IDs)
3. What shipped, file and fence
4. Floor results (paste, do not paraphrase)
5. Unverified / sandbox refused

Update it by writing a temp file and renaming it into place. The lane is not done until section 4 holds real command output.

## Traps that fail SILENTLY (read twice)

- **Live ports.** Never bind :8080, :8644 or :3847. Emilio's live dashboard, discovery worker and API run there. Tests that start `dev-server.mjs` use an ephemeral or high port (for example `PORT=18xxx`) and kill it afterwards.
- **Hermetic-harness host leak.** `tests/hermetic-harness.mjs` does NOT fence same-origin `/profile/*` or `/__proxy/*`. A local Playwright run can restart the live :8644 worker and edit `~/.jobbored/.env`. Use UX01's `installHostIsolation` stubs; `reports/GEMINI-test-infra.md` shows where they are. **Do not run the full `npm test` unless your kickoff says so.** Run the named files with `node --test <file>`.
- **The jb-v2 cascade trap.** `body.jb-v2 h3/p` has specificity (0,1,1) and beats single-class rules. Scope every new CSS rule under your beat's root class, or its typography silently never applies.
- **Shared files.** In `css/oneflow.css`, edit only your beat's blocks. `index.html` script tags belong to the orchestrator: ask for additions in report §5.
- **Key material.** Never put a SerpApi, Gemini or other key in a URL, log line, fixture or test snapshot. Tests use obviously fake keys.
- **Reduced motion in Playwright.** `test.use({reducedMotion})` inside a describe never reaches the page. Use `page.emulateMedia` and assert on `matchMedia`.
- **Quota stop.** When you receive a `commit-and-stop` nudge, commit green work, write the report, and stop within five minutes.

## Floor (every lane)

```
npm run lint:repo
npm run typecheck:repo
node --test <every test file your kickoff names, plus any you add or touch>
```

Then stage your fence (`git add <paths>`) and run `gitleaks protect --staged --redact`. If a suite is red for a reason you did not cause, paste it in report §5 with the failing claim's name and continue; the integrator decides. Your first line stays `DONE` when your own claims are green.

## Status

- Run `cmux set-status lane working` at the start.
- Run `cmux set-status lane blocked` when blocked.
- Run `cmux set-status lane done` when the report says `DONE`.

## Commit

- Conventional commits, path-spec'd to your fence, one logical change each.
- Never `git add -A`. Never add `.lane-evidence/` or `LANE-REPORT-*`.
- Name the ledger IDs in the commit body.
- End every commit message with:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DWfF7w7RrJUkP2qSf8Vqt
```

## Stop

Stop when the fence is exhausted, the floor is pasted, the report's first line is `DONE`, and your commits are on your branch. If blocked, the first line is `BLOCKED: <why>`; then stop.
