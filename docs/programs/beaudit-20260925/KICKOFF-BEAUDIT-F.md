# Lane F — Profile and materials pipeline

Read `KICKOFF-BEAUDIT-_SHARED.md` in this folder first (boundaries, report format, silent traps, lenses, findings schema); it binds you. Then `PROGRAM-PROMPT.md` §"Lanes" row F and `PRIOR-CLAIMS.md`. Eight audit lanes (A–H) run now, each in its own worktree; none writes product code.

Goal: Audit the profile source of truth and the materials drafter → critic → repair loop: cost per application, failure modes, and overlapping rescores.

Success means:
- `.lane-evidence/LANE-REPORT-F.md` in `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-F` holds all five sections; first line `DONE`.
- Section 2 inventories every entrypoint, store, external call and background job in your fence with `path:line` at `f227fbb`, caller, reads/writes, and test file.
- Section 3 holds at most 25 schema rows with IDs `F1`, `F2` …, every P0/P1 with a runnable reproducer, then a status for every prior-claim row listed below, then three so-whats.
- Section 4 holds pasted output for every CONFIRMED row and every focused test file you ran.
- Section 5 lists every INFERRED row with its proving command, plus what the boundaries blocked.

Stop when: all eight lenses are walked for this fence and the report's first line is `DONE`, or a whole-lane blocker makes it `BLOCKED: <why>`.

## Worktree and ports
- Worktree: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-F` (detached at `f227fbb`, `node_modules` and `server/node_modules` symlinked). Work only here.
- Probe ports: `18160–18169`. Sandbox HOME: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-F/.lane-evidence/home`.

## Fence (yours to audit)
- `server/user-profile.mjs`
- `server/profile-from-resume.mjs`
- `server/profile-rescore-worker.mjs`
- `server/legacy-profile-migrator.mjs`
- `server/application-materials.mjs`
- `server/materials-*.mjs` (all ten)
- `server/index.mjs` routes `/profile*` and `/api/applications/*`
- `integrations/browser-use-discovery/src/profile/*`
- `integrations/browser-use-discovery/src/contracts/user-profile.*`
- `integrations/hermes-job-hunt/scripts/materials_watcher/*`
- `integrations/hermes-job-hunt/scripts/materials_request.py`, `materials-request.sh`
- `integrations/hermes-job-hunt/scripts/logo_resolver.py`
- `integrations/hermes-job-hunt/resume-template/`, `cover-letter-template/`, `profile/`

## Shared edges
- Lane E owns the rest of `server/index.mjs` and the LLM config the materials loop calls.
- Lane H owns the other Hermes scripts.

## Seed questions (start here, follow the evidence past them)
1. Is there one profile source of truth? Name every place a profile is stored or cached (server `~/.jobbored/profile.json`, worker `profile/*`, browser IndexedDB, Hermes `profile/`) and which wins.
2. What does the drafter → critic → repair loop cost per application (LLM calls, tokens, wall time) and how does it fail ("Missing required output(s)", empty drafts)? Reproduce each failure against a stubbed provider on a sandbox server.
3. What happens when two rescores overlap? Probe it.
4. Is the Hermes materials path (watcher, request.py) a second implementation of the server materials loop? Cite both sites.
5. Browser-local resume vs server prefill (PROFILE-02): is there still a gap?

## Prior claims you must answer (rows in `PRIOR-CLAIMS.md`)
- PROFILE-02
- PRIV-01 (materials data flow, with lane E)
- DOSSIER-01/02 (materials half, with lane E)
- Wishlist T0 Dossier evidence panel
- Wishlist T0 Role-bound Scribe (server)
- Wishlist T1-7 Materials review workspace
- Wishlist T2 Canonical candidate context
- Wishlist T3 Grounded interview prep packet
- Wishlist T3 Portable encrypted workspace

## In-flight PRs touching your fence
- #112 — scribe empty-draft guard in `resume-generation.js` (browser side of your loop)
- #120 — materials v3 schemas plus new `server/materials-delint.mjs`, `materials-fit-budget.mjs` (not on main; note overlap with your proposals)
- #117 — materials v2 design doc (docs only)

Check each with `gh pr diff <n>` (read-only). A finding the PR fixes is `IN-FLIGHT #n` with one line on the PR's approach.

## Definition of Done
Report first line `DONE`; §4 holds real pasted output; every prior-claim row above has a status; every P0/P1 has a reproducer Muse can run read-only from `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-F`. No git writes, no product edits.

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.
