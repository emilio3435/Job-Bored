# SCRP: shared ground rules (every lane)

You implement one fence of the SCRP program (Scribe editor repairs, editing controls and UX polish). Your first filesystem action is the report described below. Then read these files in `docs/programs/scribe-polish-20261003/`:
- `SPEC-SCRP-20261003.md`. Its §0 locked decisions override task and implementation choices in every kickoff; they never override the boundaries in this file.
- `source-evidence/SOL-REPAIR-PLAN.md` (the plan): the detailed repair design.
- `source-evidence/ASTRA-FINDINGS.md`: the reproductions.

You are not alone. Three other lanes work on parallel branches from the same base, and the host merges them. Edit only your fence. Preserve every other lane's edits when you merge the integration branch into yours. Never revert a line you did not write.

You are operating autonomously, and Emilio is not watching. Proceed without asking on reversible actions that follow from your kickoff. Before ending your turn, check your last paragraph: if it is a plan, a question you can answer yourself, or a promise, do that work now. A step that fails the same way twice is a blocker: write `BLOCKED: <why>` as the first line of your report and stop.

Work in your worktree only and commit locally on your branch. Publication (push, PR, upstream merge, GitHub Pages deploy) is Emilio's, and the publish guard denies it. Spawn no subagents. Change a test or fixture only when the thing it pins genuinely moved, and say so in the commit body. Never weaken an existing assertion to turn red green. In particular, the strict Stop assertion in `tests/integration/materials-edit-api.test.mjs` stays strict.

## First action

Create `.lane-evidence/LANE-REPORT-<lane>.md` with first line `PENDING` and five headings, each `PENDING`:
1. Mission
2. Claims that went red first (named)
3. What shipped, file-and-fence
4. Floor results (paste, do not paraphrase)
5. Unverified / sandbox refused

Update it by writing a temp file and renaming it into place. A lane is not done until section 4 holds real command output. Record each red-first claim as: test name, the red output line, then the green output line.

## Traps that fail SILENTLY (read twice)

- **Isolated storage.** Before any test or probe, `export JOBBORED_PROFILE_PATH=$PWD/.lane-evidence/scrp-env/profile.json JOBBORED_LLM_CONFIG_PATH=$PWD/.lane-evidence/scrp-env/llm.json`. Without them, tests read Emilio's real `~/.jobbored` profile and LLM config.
- **Live stack and ports.** Never start or restart the live stack, never bind ports 8080, 3847 or 8644, and never touch `~/.jobbored` or `/Users/emilionunezgarcia/Job-Bored/.worktrees/test-pr160`. Browser tests go through the hermetic harness only.
- **`node --test tests/*.test.mjs` skips `tests/integration/`.** Run the integration file by name. The real gate is `npm test`.
- **Global-script load order.** The editor is plain global scripts (`scribe-v2-api.js` → `scribe-v2-diff.js` → `scribe-v2-versions.js` → `scribe-v2.js`). Adding `import`/`export` or changing the order in `index.html` breaks the app silently in the browser while node tests still pass.
- **CSS cascade.** Single-class rules lose to `body.jb-v2 h3/p` (0,1,1). Scope component rules under `.scribe` or the type rule silently never applies.
- **Sandboxed preview.** The preview iframe is `srcdoc` with `allow-same-origin` and **without** `allow-scripts`. All selection, focus and manual-edit handlers are installed by the parent on `iframe.contentDocument` after each load. A `<script>` inside the preview never runs.
- **Playwright reduced motion.** `test.use({reducedMotion})` inside a describe block never reaches the page. Use `page.emulateMedia({reducedMotion:'reduce'})` and assert `matchMedia`.
- **Fictional data only.** Use names like Alex Example and Acme. No real customer text, credentials or provider payloads go in fixtures, logs, screenshots or reports.
- **Codex worktree commits.** Your launch carries the `writable_roots` grant. If `git commit` is still refused, leave the work as dirt and write `DONE (uncommitted — sandbox)` as the report's first line. The integrator commits it.
- **Socket bind refused.** If the sandbox refuses a loopback bind in Playwright, `npm test` or the integration suite, paste the exact error in §5 and continue with the suites that run. The host reruns those suites.
- **Quota stop.** When you receive a `commit-and-stop` nudge, commit green work, write the report, and stop within five minutes.

## Floor (every lane)

Run exactly the gates your kickoff names, from SPEC §6, in this order: A, B, C, then D where named. Then stage your fence (`git add <paths>`) and run `gitleaks protect --staged --redact`. A suite that is red for a reason you did not cause goes in report §5 with the failing test name, and you continue; the integrator decides. Your first line stays `DONE` when your own claims are green.

## Status

Run `cmux set-status lane working` when you start, `cmux set-status lane blocked` when blocked, and `cmux set-status lane done` when the report says `DONE`. These may fail inside a sandbox; ignore that failure.

Leave `node_modules/` and caches in place.

## Commit

Use conventional commits, path-spec'd to your fence: `fix(scribe): …`, `feat(scribe): …`, `test(scribe): …`. Make one logical change per commit, and put the repair ID in the subject or body (for example `R0`, `ASTRA-02`, `GAP-01`). Never `git add -A`. Never add `.lane-evidence/`, `LANE-REPORT-*` or Playwright output.

## Stop

Stop when the fence is exhausted, the floor is pasted, the report's first line is `DONE`, and there are commits on your branch (or the sandbox note above applies). If blocked, write first line `BLOCKED: <why>` and stop.
