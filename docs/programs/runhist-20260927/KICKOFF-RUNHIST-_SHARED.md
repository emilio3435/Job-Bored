# RUNHIST — shared ground rules (every lane)

You implement one fence of RUNHIST: persistent discovery run history with measured, expandable stats. Your first filesystem action is the report (below); then read `SPEC-RUNHIST-20260927.md` in this folder (`/Users/emilionunezgarcia/Job-Bored/docs/programs/runhist-20260927/`). Its §0 locked decisions override task and implementation choices in every kickoff; they never override the boundaries in this file.

You are operating autonomously; Emilio is not watching. For reversible actions that follow from your kickoff, proceed without asking. Before ending your turn, check your last paragraph: if it is a plan, a question you can answer yourself, or a promise, do that work now. A step that fails the same way twice is a blocker: write `BLOCKED: <why>` as the first line of your report and stop.

Repo worktree only. Commit locally on your branch. Publication (push, PR, merge, `gh release`, GitHub Pages deploys, anything under `.github/workflows`) is Emilio's; the publish guard denies it. Spawn no subagents. Change a test or fixture only when the thing it pins genuinely moved, and say so in the commit body.

## First action

Create `.lane-evidence/LANE-REPORT-<lane>.md`, first line `PENDING`, with five headings each `PENDING`:
1. Mission · 2. Claims that went red first (named) · 3. What shipped, file-and-fence · 4. Floor results (paste, do not paraphrase) · 5. Unverified / sandbox refused.
Update it by writing a temp file and renaming it into place. A lane is not done until section 4 holds real command output.

## Alignment gate (FE and BE only)

Phase 0: investigate independently and write your own recs in report §6. Phase 1: exchange recs with your sibling and agree ONE stats contract, starting from SPEC §2. Paste the identical block, delimited by a line `AGREED CONTRACT` and a line `END AGREED CONTRACT`, into both reports' §6 before any implementation. Channels, in order: `cmux send --workspace "<sibling workspace ref>" "<one line>"` + `cmux send-key --workspace <ref> Enter` (find the ref with `cmux workspace list`, titles contain `RUNHIST · FE` / `RUNHIST · BE`); if your sandbox denies the cmux socket, read and write through the sibling's report file (absolute paths are in SPEC §3's worktrees: `/Users/emilionunezgarcia/Job-Bored.worktrees/runhist-<fe|be>/.lane-evidence/LANE-REPORT-<FE|BE>.md`; write only your own). Unreachable after 3 tries ≥10 min apart: first line `BLOCKED-ON-ALIGN`, proposal left in §6, stop.

## Traps that fail SILENTLY (read twice)

- **Live ports.** Never bind :8080, :8644 or :3847 — Emilio's live stack runs there right now. Tests that start `dev-server.mjs` or the worker use an ephemeral or high port and kill it afterwards.
- **Real home.** Run every test with an isolated `HOME` (`HOME=$(mktemp -d)`); never read or write the real `~/.jobbored`. A reused isolated HOME carries files from earlier runs — use a fresh one per floor run.
- **Hermetic harness host leak.** `tests/hermetic-harness.mjs` does not fence same-origin `/profile/*` or `/__proxy/*`; Playwright specs use the `installHostIsolation` stubs.
- **jb-v2 cascade.** `body.jb-v2 h3/p` (0,1,1) beats single-class rules; scope every new rule under `#runsModal` or the runs root class, or its typography silently never applies.
- **Inline modal CSS budget.** `tests/index-html-size.test.mjs` pins the assembled index size; put new styles in `css/runs-log.css`, not the partial's inline `<style>`.
- **`grep` is a wrapper function** in this shell and silently drops matches; use `command grep` (or `rg`) when a "no match" matters.
- **`git worktree remove` deletes ignored files**; nothing you need may live only in an ignored path outside `.lane-evidence/`.
- **Codex worktree commits.** Your launch carries the `writable_roots` grant; if `git commit` is still refused, leave the work as dirt and write `DONE (uncommitted — sandbox)` as the report's first line. A sandbox that refuses loopback listeners: run what you can, paste the refusal in §5; the integrator runs the rest.
- **Quota stop.** On a `commit-and-stop` nudge, commit green work, write the report, and stop within five minutes.

## Floor (every build lane)

```
npm run lint:repo
npm run typecheck:repo
```
then exactly the suites your kickoff names, then stage your fence (`git add <paths>`) and run `gitleaks protect --staged --redact`. A suite red for a reason you did not cause: paste it in §5 with the failing claim name and continue.

## Status

`cmux set-status lane working` at start, `cmux set-status lane blocked` when blocked, `cmux set-status lane done` when the report says `DONE`.

## Commit

Conventional commits, path-spec'd to your fence. Never `git add -A`. Never add `.lane-evidence/` or `LANE-REPORT-*`. End every message with:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJ6DhaApMkaQRVDQ5KfKrd
```

## Stop

Fence exhausted, floor pasted, report first line `DONE`, and commits on your branch (or the sandbox note). Blocked: first line `BLOCKED: <why>`, and stop.
