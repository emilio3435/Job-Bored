# Lane BE-FUEL: the local-server substrate (serial, runs alone before every other build lane)

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `SPEC.md` §0 (D1, D2, D6, D12) and the ledger rows for S1, S3, S7, S9, N1, N4, N-stale, X1, X2 and WT-N2/N3/N5/N7
- `PLAN.md` Phase 1 and the Option C section, items 6 and 7

§0 overrides this file.

**Routing note (D12):** this lane was planned for sol. Pool X is walled, so it runs on **opus**. Write it as a backend engineer would: hardened, edge-case tested, failing closed.

No other build lane is live. Two things run alongside you:
- an Option C runtime spike, which writes only `docs/programs/gfx-20260926/reports/SPIKE-*`;
- read-only Gemini explores.

**Goal:** one tested module owns "is JobBored running on this computer, and what exactly is wrong if it isn't". B5's key check, the future B1 route-to-local screen, B2, B3 and the desktop app all consume it, and the launcher can no longer silently die or leave a stale server answering.

**Success means:**
- A new `local-server.js` exposes `window.JobBoredLocalServer` with:
  - **the frozen outcome table from PLAN §R2**: `ok` (with optional `searchesLeft`; a low count is a note, never a block), `invalid_key`, `unreachable` (the server is up and SerpApi's network is down; **never** merge it into `no_local_server`), `upstream_error`, `forbidden` (shown as `wrong_origin`), `internal_error`, `no_local_server`, `stale_server`, `static_host`. Export it as a frozen object with a display key and a blocks flag for each outcome. There is no `quota` reason;
  - `pingLocalServer({ base, signal })`;
  - `classifyAnswer(response, { pageHostname })`;
  - `localServerHint(platform)`;
  - `isLoopbackPage(location)`;
  - `jobBoredOpenUrl(beat)`, which returns `jobbored://open?beat=<id>` only for an allowlisted beat id (`google, ai, resume, fit, discovery, payoff`), and otherwise null.
- `oneflow-beat-discovery.js` delegates all classification to `local-server.js`, and its duplicated logic is deleted. Every existing B5 test still passes, plus the new ones.
- **D2: remove the hosted-page handoff and presence poll from B5.** This covers the `static_host` handoff panel, the copy-key / open-local / get-the-app buttons, and `scheduleLocalServerPoll` with its onLeave wiring. FE-B1 rebuilds them on the B1 route-to-local screen, using the click-gated ping (Chrome Local Network Access).
  - On a non-loopback page, B5 shows the `static_host` message, which points to the B1 route-to-local screen.
  - D1 still holds: every blocked state shows one diagnosed fix action.
  - Keep the sessionStorage pending-key slot (C3); it is harmless and useful.
- `dev-server.mjs` `/__proxy/ping` returns **exactly the PLAN §R3 contract**: `{ ok: true, version: <package.json version>, runtime: "source" | "desktop" (desktop when JOBBORED_DESKTOP=1), routes: [<the /__proxy routes this build serves, including "serpapi-check">], desktopVersion?: <JOBBORED_DESKTOP_VERSION when set> }`. Add a contract test that pins this shape. Also:
  - Answer `OPTIONS` preflights for the exact Pages origin with `Access-Control-Allow-Private-Network: true`.
  - Cache the CNAME read at startup instead of re-reading it on every ping.
  - Keep the keyless, exact-origin, loopback-peer rules exactly as they are.
- **`stale_server` detection:**
  - The client compares the ping's `version` and `routes` with what it needs (`serpapi-check` present), and reports `stale_server` when they are missing.
  - A server so old it has no ping (404 on loopback) is still `stale_server`. That already works; keep it.
- **N4: the launcher no longer kills the dashboard when a sibling dies.**
  - `package.json` `start` stops using `concurrently -k`, or web runs independently, whichever keeps `npm start` semantics for the existing tests.
  - `start.sh` checks :8080 (or `$PORT`) before starting:
    - a current JobBored build answers the ping → say "JobBored is already running", open the URL, and exit 0;
    - an old JobBored build answers → say so and tell the user how to stop it;
    - a foreign process holds the port → name it (`lsof -nP -iTCP:<port> -sTCP:LISTEN`) and exit non-zero with a clear message.
  - `start.sh` starts the **whole** stack, discovery worker included (today `npm start` omits it; PLAN R13). Keep the C7 test green: the user-facing copy still names one start command.
  - **R4:** `start.sh` opens **`http://localhost:<port>/`**, with no `beat` and no `returnTo`, which reverts the URL from commit `028b2a2d` (keep its N5 completion guard in `onboarding-flow.js`). Update `tests/b5-start-opener.test.mjs` to pin the root URL. Also extend `BEAT_PREREQS` in `onboarding-flow.js` so `discovery` requires `fit` (a cold `?beat=discovery` lands on the first incomplete beat). Test both.
- **X2:** eslint ignores `.worktrees/` and `.muse/`, and `npm run lint:repo` is green.
- **New tests, red first:**
  - an outcome matrix that starts a REAL `dev-server.mjs` on a high port (current build);
  - a stale-server fixture (a tiny HTTP server answering 404 text/plain, and one answering `{ok:true}` without `version`);
  - a foreign static server (405 empty body, and 404 HTML);
  - a JSON 403;
  - a 500 JSON;
  - a connection refused;
  - hosted vs loopback `pageHostname` for each;
  - `jobBoredOpenUrl` rejecting unknown beats, extra params and injection strings;
  - the `start.sh` port-check branches (use its existing test hooks);
  - the ping shape contract.

Name every test with its ledger ID (`GFX-S1`, `GFX-N4`, `GFX-X2`, and so on).

**Floor:** paste all of this in §4.
- `npm run lint:repo`
- `npm run typecheck:repo`
- `node --test tests/oneflow-b5-static-handoff.test.mjs tests/oneflow-b5-pending-fuel.test.mjs tests/b5-start-opener.test.mjs tests/dev-server-ping.test.mjs tests/oneflow-b5-connect-healing.test.mjs tests/oneflow-l3-beat-discovery.test.mjs tests/sixbeats2-fuel-beat.test.mjs tests/ux01-c7-honest-setup.test.mjs` plus your new files
- the 18 onboarding-flow suites (the `oneflow-l0/l2/l6/l7`, entry-staleness, stale-completion, payoff-exit, sb2, telemetry, greenfield-b/c, gate-identity, lane-d-repair and data-integrity-resume files in `tests/`)
- `gitleaks protect --staged --redact`

**Report:** first line `DONE` or `BLOCKED: <why>`.

**Stop when:** the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)

- new `local-server.js` (vanilla IIFE, same idiom as the beats); it is loaded by `index.html` **before** the beats. Ask the orchestrator for the script tag in §5; don't edit `index.html`
- `oneflow-beat-discovery.js`: the state machine, classification, and removal of the handoff and poll. Keep render/copy changes to what the removal needs; FE-B5 restyles later
- `onboarding-flow.js`: `BEAT_PREREQS` (R4), plus undoing the B5 `onLeave` poll wiring if it becomes dead code. Keep the N5 deep-link guard. Don't touch `maybeStart`/`open`; the R11 pre-flow gate belongs to FE-B1
- `dev-server.mjs`: the ping handler and the preflight only
- `scripts/lib/local-control-auth.mjs`: only if the preflight needs it
- `start.sh`, `start.command` (if needed), `package.json` scripts
- the eslint config
- `tests/`: new files named `gfx-be-fuel-*.test.mjs`, plus updates to the B5 tests that pinned removed handoff behaviour (say so in the commit body)

**Do NOT touch:**
- `sheet-access-setup.js`, `auth-session.js`, `server/**`, `fit-*`: those belong to BE-CORE
- the other beats' files and CSS: FE lanes
- `desktop/**`: DESK-A
- `scripts/lib/paths.mjs`, `scripts/start-*-local.mjs`: DESK-B

## Consumes

- Branch base: `feat/gfx-integration` at `02df63f7`, which already holds the rescued B5 work and fixes N2, N3, N5, N7 and C7.
- The Gemini test-infra map, `reports/GEMINI-test-infra.md`, when it lands. Don't wait for it.

## Non-negotiables

- The SerpApi key is never sent cross-origin and never appears in a URL or log.
- The ping stays keyless and exact-origin.
- D1 strict: no state renders without exactly one action.
- Fail closed: anything unrecognised is `down` or `stale_server`, never `ok`.
- Tests that start servers use high ports and always clean up, in `after` hooks. No test may bind 8080, 8644 or 3847 (PLAN R16).
- Every child spawn uses argv arrays, never a shell string (PLAN R18).

## Definition of Done

The floor above, all green and pasted in §4, first line `DONE`. Local commits only, one per logical change, with ledger IDs in the body.

---

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.

Goal: the kickoff's mission. Success means: the fence's checkable results, with the floor command's output pasted in the report. Stop when: the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.
Constraints: stay inside the fence; anything outside it goes in the report, not in the diff. Reuse existing utilities; add no test file that mirrors the implementation. Change or fix requests are authorized in scope, including local commits: make the change and validate it without asking. Ask only for external writes, destructive actions, or a scope expansion.
Output: prose report, five sections, first line DONE or BLOCKED plus the reason.
