# Lane G — Local ops, transport and deploy

Read `KICKOFF-BEAUDIT-_SHARED.md` in this folder first (boundaries, report format, silent traps, lenses, findings schema); it binds you. Then `PROGRAM-PROMPT.md` §"Lanes" row G and `PRIOR-CLAIMS.md`. Eight audit lanes (A–H) run now, each in its own worktree; none writes product code.

Goal: Audit the local dashboard server, `/__proxy` control plane, scripts, templates and relays: re-verify SEC-01, cross-origin mutation, worker respawn, env precedence and port collisions, and cross-platform breakage.

Success means:
- `.lane-evidence/LANE-REPORT-G.md` in `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-G` holds all five sections; first line `DONE`.
- Section 2 inventories every entrypoint, store, external call and background job in your fence with `path:line` at `f227fbb`, caller, reads/writes, and test file.
- Section 3 holds at most 25 schema rows with IDs `G1`, `G2` …, every P0/P1 with a runnable reproducer, then a status for every prior-claim row listed below, then three so-whats.
- Section 4 holds pasted output for every CONFIRMED row and every focused test file you ran.
- Section 5 lists every INFERRED row with its proving command, plus what the boundaries blocked.

Stop when: all eight lenses are walked for this fence and the report's first line is `DONE`, or a whole-lane blocker makes it `BLOCKED: <why>`.

## Worktree and ports
- Worktree: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-G` (detached at `f227fbb`, `node_modules` and `server/node_modules` symlinked). Work only here.
- Probe ports: `18170–18179`. Sandbox HOME: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-G/.lane-evidence/home`.

## Fence (yours to audit)
- `dev-server.mjs` (static serving, `/__proxy/*`, profile proxy)
- `scripts/*.mjs`, `scripts/*.sh`, `scripts/lib/*`, `scripts/windows/*`, `scripts/smoke/*`
- `templates/**`
- `integrations/cloudflare-relay-template/**`
- `start.sh`, `start.command`
- `integrations/n8n/`, `integrations/openclaw-command-center/` (docs/skill only)
- Root `package.json` scripts, `.github/workflows/*` (CI gate coverage for backend)

## Shared edges
- Lane A owns the worker's own listener; you own how it is started, kept alive and reached.
- Lane E owns the API server; you own the dev-server proxy in front of it.

## Seed questions (start here, follow the evidence past them)
1. Re-verify SEC-01: path traversal (encoded separators, malformed encodings, symlinks, dotfiles, `.env`, bootstrap state) and the bind address, against a sandbox dev-server on your port with a planted canary `.env`.
2. Which `/__proxy` mutation routes accept a cross-origin request? Probe each with a foreign `Origin` and with `Sec-Fetch-Site: cross-site`; list route × (method, origin check, auth).
3. Does the worker respawn when `:8644` dies? Trace `start-discovery-worker-local.mjs` and keep-alive statically; probe only on your own ports.
4. How do `~/.jobbored/**/.env` and repo `.env` precedence and the Hermes `:8644/:8645` collision surface to a new user? What does the log say?
5. What breaks on Windows and Linux (paths, `launchd`-only branches, shell scripts, `open`, `lsof`)?

## Prior claims you must answer (rows in `PRIOR-CLAIMS.md`)
- SEC-01
- SEC-02
- SEC-03
- SEC-05 (dashboard half)
- AUTH-01 (served headers)
- AUTH-03 (proxy half, with lane E)
- SETUP-03 (probe half)
- SETUP-04
- SETUP-05
- SETUP-09
- DISC-01
- P2-WRITESCOPE
- P2-STATIC
- TD-004
- TD-014
- TD-015
- TD-017
- Wishlist T0 Truthful setup state
- Wishlist T1-10 Setup and automation control center

## In-flight PRs touching your fence
- #111 — respawn when a reused worker on :8644 dies (`scripts/lib/discovery-worker-policy.mjs`, `start-discovery-worker-local.mjs`)
- #102 — `scripts/discovery-canary.mjs`, `scripts/assemble-index.mjs`, pages workflow
- #105, #106 — root dependency bumps
- #84 — release-please v1.0.0

Check each with `gh pr diff <n>` (read-only). A finding the PR fixes is `IN-FLIGHT #n` with one line on the PR's approach.

## Definition of Done
Report first line `DONE`; §4 holds real pasted output; every prior-claim row above has a status; every P0/P1 has a reproducer Muse can run read-only from `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-G`. No git writes, no product edits.

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.
