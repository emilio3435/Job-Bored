# Lane E — Scraper/ATS API and AI provider layer

Read `KICKOFF-BEAUDIT-_SHARED.md` in this folder first (boundaries, report format, silent traps, lenses, findings schema); it binds you. Then `PROGRAM-PROMPT.md` §"Lanes" row E and `PRIOR-CLAIMS.md`. Eight audit lanes (A–H) run now, each in its own worktree; none writes product code.

Goal: Audit the API server's scraper, ATS scorecard, LLM config and brand-logo routes, count the AI-provider abstractions and sketch the single one, and check error shape, CORS and hosted-mode rules.

Success means:
- `.lane-evidence/LANE-REPORT-E.md` in `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-E` holds all five sections; first line `DONE`.
- Section 2 inventories every entrypoint, store, external call and background job in your fence with `path:line` at `f227fbb`, caller, reads/writes, and test file.
- Section 3 holds at most 25 schema rows with IDs `E1`, `E2` …, every P0/P1 with a runnable reproducer, then a status for every prior-claim row listed below, then three so-whats.
- Section 4 holds pasted output for every CONFIRMED row and every focused test file you ran.
- Section 5 lists every INFERRED row with its proving command, plus what the boundaries blocked.

Stop when: all eight lenses are walked for this fence and the report's first line is `DONE`, or a whole-lane blocker makes it `BLOCKED: <why>`.

## Worktree and ports
- Worktree: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-E` (detached at `f227fbb`, `node_modules` and `server/node_modules` symlinked). Work only here.
- Probe ports: `18150–18159`. Sandbox HOME: `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-E/.lane-evidence/home`.

## Fence (yours to audit)
- `server/index.mjs` routes `/health`, `/api/scrape-job`, `/api/ats-scorecard`, `/api/llm-config`, `/api/brand-logos*` (lane F owns `/profile*` and `/api/applications/*` in the same file)
- `server/job-scraper.mjs`
- `server/ats-scorecard.mjs`
- `server/ats-request-payload.mjs`
- `server/llm-config.mjs`
- `server/model-family.mjs`
- `server/brand-logos.mjs`
- `server/security-boundaries.mjs`
- `server/Dockerfile`
- `render.yaml`
- `server/tsconfig.json`, `server/package.json` (deps)

## Shared edges
- Lane C owns `server/shared/*`; you own the routes that call it.
- Lane B owns the worker's `ai/chat-provider.ts`; the browser's `callConfiguredAi` is frontend. You own the comparison of all three and the single-abstraction proposal.

## Seed questions (start here, follow the evidence past them)
1. How many AI-provider abstractions exist (server `llm-config`, worker `chat-provider`, browser `callConfiguredAi`, Hermes)? Table them: providers, key source, timeout, retry, error mapping. Sketch the one to keep.
2. Does every route return `{ error, code, detail, nextStep, retryable }`? Probe each route's error path on a sandbox server on your port.
3. Do CORS and origin rules match hosted mode (`render.yaml`, Dockerfile)? Probe OPTIONS and a cross-origin POST with a foreign Origin.
4. Does the Docker build context leak `.env*` (no `.dockerignore`)? Are upstream provider error bodies redacted? Is ambient `OPENAI_API_KEY` forwarded to arbitrary compatible base URLs?
5. Is the ATS score shown to users a real computation or a heuristic (SCRIBE-02, server half)?

## Prior claims you must answer (rows in `PRIOR-CLAIMS.md`)
- AUTH-03
- PRIV-01
- DOSSIER-01 (server half)
- DOSSIER-02 (server half)
- SCRIBE-02
- P2-DOCKER
- P2-REDACT
- P2-OPENAI-KEY
- P2-FWD-HDR
- TD-010
- TD-013
- TD-018
- SEC-04 (server scrape half, with lane C)

## In-flight PRs touching your fence
- #121 — dotenv 17 → 18 major in `server/` (read its changelog impact on `import "dotenv/config"`)
- #105, #106 — root dependency bumps

Check each with `gh pr diff <n>` (read-only). A finding the PR fixes is `IN-FLIGHT #n` with one line on the PR's approach.

## Definition of Done
Report first line `DONE`; §4 holds real pasted output; every prior-claim row above has a status; every P0/P1 has a reproducer Muse can run read-only from `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-E`. No git writes, no product edits.

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.
