# Lane H — Apply and follow-up automation

Read `KICKOFF-BEAUDIT-_SHARED.md` in this folder first (boundaries, report format, silent traps, lenses, findings schema); it binds you. Then `PROGRAM-PROMPT.md` §"Lanes" row H and `PRIOR-CLAIMS.md`. Eight audit lanes (A–H) run now, each in its own worktree; none writes product code.

Goal: Statically audit the Hermes apply and follow-up automation: approval gates in front of every submit path, filler robustness, follow-up state, live vs dead scripts, and Python secret handling.

Success means:
- `.lane-evidence/LANE-REPORT-H.md` in `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-H` holds all five sections; first line `DONE`.
- Section 2 inventories every entrypoint, store, external call and background job in your fence with `path:line` at `f227fbb`, caller, reads/writes, and test file.
- Section 3 holds at most 25 schema rows with IDs `H1`, `H2` …, every P0/P1 with a runnable reproducer, then a status for every prior-claim row listed below, then three so-whats.
- Section 4 holds pasted output for every CONFIRMED row and every focused test file you ran.
- Section 5 lists every INFERRED row with its proving command, plus what the boundaries blocked.

Stop when: all eight lenses are walked for this fence and the report's first line is `DONE`, or a whole-lane blocker makes it `BLOCKED: <why>`.

## Worktree and ports
- Worktree: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-H` (detached at `f227fbb`, `node_modules` and `server/node_modules` symlinked). Work only here.
- Probe ports: `18180–18189`. Sandbox HOME: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-H/.lane-evidence/home`.

## Fence (yours to audit)
- `integrations/hermes-job-hunt/scripts/**` except the materials files lane F owns (`materials_watcher/*`, `materials_request.py`, `materials-request.sh`, `logo_resolver.py`)
- `integrations/hermes-job-hunt/approval-contract.v1.json`
- `integrations/hermes-job-hunt/approval-guard-spec.md`
- `integrations/hermes-job-hunt/kanban-task-conventions.md`
- `integrations/hermes-job-hunt/tests/`, `patches/`, `requirements.txt`, `README.md` and the HANDOFF/PLAN docs as context

## Shared edges
- Lane F owns the materials scripts. Lane D owns the Sheet side of Applied.

## Seed questions (start here, follow the evidence past them)
1. Does an approval gate stand in front of every submit path? Build a submit-path × gate table (`apply-orchestrator.py`, `jhos_submit.py`, `universal_filler.py`, `greenhouse_filler.py`, `ats_adapters/*`) with `path:line` of the check, or its absence.
2. How robust is each ATS filler (selectors, retries, CAPTCHA/login walls, partial fills)? Static read only; do not execute.
3. Where does follow-up state live (`followup_monitor.py` vs `followup-monitor.py` — two files?), and what writes it?
4. Which scripts are live (referenced by cron, launchd plists in the repo, docs, other scripts) and which are dead?
5. How does the Python side handle secrets (env, token files, logging of tokens, Telegram thread ids 48 vs 314)? Run only the Python test suite under `tests/` if it needs no network and no real tokens; otherwise INFERRED.

## Prior claims you must answer (rows in `PRIOR-CLAIMS.md`)
- APPLY-02
- APPLY-01 (automation half)
- Wishlist T1-6 Recruiter activity and interview timeline

## In-flight PRs touching your fence
- None touch your fence.

Check each with `gh pr diff <n>` (read-only). A finding the PR fixes is `IN-FLIGHT #n` with one line on the PR's approach.

## Definition of Done
Report first line `DONE`; §4 holds real pasted output; every prior-claim row above has a status; every P0/P1 has a reproducer Muse can run read-only from `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-H`. No git writes, no product edits.

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.
