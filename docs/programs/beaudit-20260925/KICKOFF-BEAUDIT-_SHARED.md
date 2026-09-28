# BEAUDIT — shared ground rules (every audit lane)

You audit one fence of the JobBored backend for the BEAUDIT program. This is a **read-only audit**: you read code, run focused test files, start local servers on loopback against fixtures, and curl `127.0.0.1`. The only file you write is your own report (plus scratch files under `.lane-evidence/`).

Program folder (absolute): `/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-integration/docs/programs/beaudit-20260925/`
- `PROGRAM-PROMPT.md` — the full program brief. Its sections "Audit lenses", "Findings schema" and "Lane report" are binding on you.
- `PRIOR-CLAIMS.md` — the prior-audit ledger. Your kickoff lists your rows; answer every one.
- `prior-audit/CRITICAL-AUDIT.md`, `prior-audit/FEATURE-WISHLIST.md` — the Aug 31 audit the ledger came from.

Pinned SHA: **`f227fbb`** (origin/main at 2026-09-25 05:26 CDT). Your worktree is a detached checkout of it. Cite every `path:line` at this SHA.

You are operating autonomously; Emilio is not watching. For reversible actions inside these rules, proceed without asking. Before ending your turn, check your last paragraph: if it is a plan, a question you can answer yourself, or a promise, do that work now. A step that fails the same way twice is a blocker for that claim: mark it INFERRED with the proving command and move on. Spawn no subagents.

## First action (before anything else)

Create `.lane-evidence/LANE-REPORT-<L>.md` in your worktree. First line `PENDING`, then five headings, each with the body `PENDING`:

1. **Mission and fence**
2. **Inventory** — the lens 1 table
3. **Findings** — schema rows ranked by severity; then the prior-claim ledger for your lane; then your top three so-whats
4. **Probes and floor** — pasted command output for every CONFIRMED row and every focused test file you ran
5. **Unverified** — every INFERRED row with the exact command that would prove it, plus anything the boundaries blocked

Update it by writing `.lane-evidence/LANE-REPORT-<L>.md.tmp` and renaming it into place (`mv`). Fill sections as you go: a lane that dies to a quota wall must leave a useful report behind. The final first line is `DONE` or `BLOCKED: <why>`.

Keep the findings register to your 25 strongest rows. Retire at about 60% of your context: finish the report, set the first line, stop.

## Hard boundaries (hold even when a proof needs them)

When a proof would cross one of these, mark the claim `INFERRED` and write the exact command Emilio would run.

- **No paid or external calls.** No real discovery run, no SerpApi, Gemini, OpenAI, OpenRouter, Anthropic, Browser Use Cloud, or any provider key in use. No outbound fetch to a real ATS or job board. Tests that stub the network are fine.
- **No writes to any real Google Sheet.** No OAuth sign-in. No Telegram send.
- **No execution** of Hermes apply, submit, filler, gate, follow-up or watcher scripts. Lane H audits them statically.
- **No launchd, systemd, Task Scheduler, Tailscale, Cloudflare, ngrok or DNS changes.** No `install-*`/`uninstall-*` script runs. No edits under `~/.hermes` or `~/.jobbored`.
- **Secrets by path and presence only.** Never print, cat, grep the value of, or paste: `.env`, `server/.env`, `~/.jobbored/**/.env`, `integrations/browser-use-discovery/service-account-key.json`, `~/.hermes/google_token.json`, `~/.grok/*`, any `*token*.json`. `test -f <path> && echo present` is the whole allowed read. If a finding is "a secret is exposed", prove it with a canary value you plant in your sandbox HOME, never with the real one.
- **Emilio's running stack:** ports `8080` (dashboard), `3847` (API), `8644` (worker), `8645` (Hermes gateway) are live. You may send `GET`/`HEAD`/`OPTIONS` to them. Never `POST`/`PUT`/`DELETE` to them, never kill or restart them.
- **No git writes.** No commit, branch, stash, checkout, reset, push or PR. Your worktree stays byte-identical to `f227fbb` outside `.lane-evidence/`.
- **No edits to product code, tests or fixtures**, even to make a probe easier. Write probe scripts under `.lane-evidence/probes/`.

## Probe servers: isolate HOME (silent trap)

`server/index.mjs` writes `~/.jobbored/profile.json`, `~/.jobbored/resume.txt` and `~/.jobbored/applications/`; the worker writes `~/.jobbored/browser-use-discovery/worker-state.sqlite` and reads `~/.jobbored/browser-use-discovery/.env`. A probe server started with your real HOME silently writes Emilio's real state. Start **every** probe server like this:

```bash
mkdir -p .lane-evidence/home
HOME="$PWD/.lane-evidence/home" PORT=<your port> LISTEN_HOST=127.0.0.1 node server/index.mjs            # API
HOME="$PWD/.lane-evidence/home" PORT=<your port> JOBBORED_API_PORT=<your API port> BROWSER_USE_DISCOVERY_PORT=<your worker port> node dev-server.mjs   # dashboard
HOME="$PWD/.lane-evidence/home" BROWSER_USE_DISCOVERY_PORT=<your port> BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=probe-secret node --experimental-strip-types integrations/browser-use-discovery/src/server.ts   # worker (entrypoint per scripts/start-discovery-worker-local.mjs:414; env names in src/config.ts:409-426)
```

Run them in the background with a log under `.lane-evidence/`, and kill them when your probe ends (`kill <pid>`; never `pkill node`, never a pattern kill). Confirm the port answered before you trust a probe result. Plant fake credentials in the sandbox HOME when a code path needs one to proceed; name them `probe-*`.

**Probe ports:** lane position `n` (A=1, B=2, C=3, D=4, E=5, F=6, G=7, H=8) owns `181n0`–`181n9` (lane A `18110`–`18119`, lane H `18180`–`18189`). Bind nothing else.

## Traps that fail silently (read twice)

- Cite `path:line` at `f227fbb`; `main` keeps moving under you. Never cite from `~/Job-Bored` (that checkout is on another branch with local edits).
- Run root tests with `npm test -- <file>`. It runs `scripts/run-tests.mjs`, which includes `tests/integration/`. Bare `node --test tests/*.test.mjs` skips that directory without saying so.
- Run worker tests with `node --experimental-strip-types --test <file>`.
- `:8080` serves the dashboard with no API. The API is on `:3847`, and `dev-server` proxies `/profile*` to it.
- A worktree without the `node_modules` symlinks fails on import, which hides the claim under test. Before your first probe: `ls -la node_modules server/node_modules` must show two symlinks into `/Users/emilionunezgarcia/Job-Bored/`. There is no `integrations/browser-use-discovery/node_modules`; the worker resolves from the root one.
- `~/.jobbored/browser-use-discovery/.env` shadows the repo `.env` for the worker. Record which file a value came from, by path only.
- Tag a finding already fixed by an open PR as `IN-FLIGHT #n` and give that PR's approach one line (`gh pr diff <n>` is read-only and allowed). Your kickoff lists the PRs that touch your fence.
- A green test is not proof the claim is covered: check that the test asserts behavior on the path the claim is about. Many prior defects sat between individually green modules.
- `npm test` with no file argument runs all 3,058 tests; run focused files, not the whole suite. The orchestrator already ran the full baseline: 3,057 pass, 0 fail, 1 todo; worker 741/741; lint, typecheck and contracts green.

## Audit lenses (walk all eight for your fence)

1. **Inventory:** each entrypoint (HTTP route, CLI script, scheduled job, webhook handler, Apps Script function, Python script), store, external call and background job in the fence, with `path:line`, its caller, what it reads and writes, and its test file.
2. **Correctness:** trace the happy path and the top three failure paths end to end. Check idempotency, timeouts, and the structured error shape `{ error, code, detail, nextStep, retryable }` (or the fence's documented equivalent).
3. **Trust boundary:** auth, origin guard, secret handling, SSRF, path traversal, token stripping, body limits.
4. **Reliability:** restart behavior, stuck runs, partial writes, rate limits, and whether the logs let a new user diagnose the failure.
5. **Performance and cost:** count Sheets, LLM, SerpApi and fetch calls per operation; find missing caches and oversized payloads; estimate tokens per run.
6. **Simplify:** name every concern implemented in two or more of browser, `dev-server`, `server/`, worker, Hermes and Apps Script, citing both sites. Flag dead code and 1,000-line files that hide seams (name the seams).
7. **Tests:** name each claim with no test, and each test that pins implementation instead of behavior.
8. **Features:** propose two to four backend-enabled features your fence makes cheap. Tie each to a job-hunter moment (find, triage, apply, follow up, close). Where `FEATURE-WISHLIST.md` has the idea, extend it by its name.

## Findings schema (one row per root cause)

| ID | Kind | Sev | Status | Claim | Evidence | Fix / proposal | Contract | Effort | Build |
|---|---|---|---|---|---|---|---|---|---|

- **ID:** your lane letter plus a number (`A1`, `A2` …). Never reuse another lane's letter.
- **Kind:** DEFECT · OPTIMIZE · SIMPLIFY · TEST-GAP · FEATURE.
- **Sev:** P0 secret exposure, data loss or security hole · P1 broken user path or silently wrong result · P2 degraded or costly · P3 polish. FEATURE rows use Value H/M/L instead.
- **Status:** CONFIRMED (you ran it; output in §4) · INFERRED (read, not run; proving command in §5) · IN-FLIGHT #pr · PRIOR-FIXED sha · PRIOR-OPEN prior-id.
- **Evidence:** `path:line` at `f227fbb` plus the probe name (the file under `.lane-evidence/probes/`).
- **Fix / proposal:** one sentence, concrete.
- **Contract:** `none`, or the schema, fixtures, docs and code that must change together.
- **Effort:** S up to half a day · M one to two days · L more than two days.
- **Build:** sol for backend · opus for a frontend surface · gemini for bulk edits or docs.

Every P0 and P1 row needs a **reproducer**: a single command (or a script under `.lane-evidence/probes/` plus the command that runs it) that a verifier with no context can run from your worktree root and see the defect. Muse will re-run each one read-only; write them so they need no write access outside `.lane-evidence/` and no network beyond `127.0.0.1`. A reproducer that needs a server says how to start it (with the sandbox HOME) and how to stop it.

Write in plain text. Every row stands on its own, with no "see above".

## Status and stop

Run `cmux set-status lane working` when you start, `cmux set-status lane blocked` when blocked, `cmux set-status lane done` when the report says `DONE`.

Stop when every lens has been walked for your fence, every prior-claim row assigned to you has a status, every P0/P1 has a reproducer, and §4 holds real pasted output. Then set the report's first line to `DONE` and end. If you hit a blocker that stops the whole lane, first line `BLOCKED: <why>`, and stop.

Deliver what was asked, at the scope intended. Fix nothing; note adjacent issues in the report instead. Keep the report tight: rows, tables, pasted output; no narrative padding.
