DONE: E1, G2, G3, A1, G4, G10 fixed; E17 deferred to lanes Q, L, O, B (harness-level tests only, E4 is todo-only scaffolding); repair round r8 closed all three findings; floor green at 3962886a

# BUILD-REPORT-P (BEAUDIT lane P, Perimeter) - branch fix/beaudit-w0-p

## Claims done
- E1 (+G2): one loopback Host guard (`checkLoopbackRequestHost`, `isAllowedLoopbackHost`, `isLoopbackAddress` in server/security-boundaries.mjs) run first on the API (server/index.mjs) and the dev-server (every route: static, /__proxy/*, /profile proxy). A foreign Host gets 403 HOST_NOT_ALLOWED. Commit c7094b7 (+36eb47d types).
- E17: rebinding test; `resolveAllowedBrowserOrigin` gets `loopbackPort` and never derives same-origin from a non-loopback Host on a loopback listener.
- A1: worker parses the URL in a guard (400 for `//`, `//x`, `//host/path`) and the whole request callback runs under a catch-all that answers 500 and never rethrows. Commit b19f9a3.
- G3: static serving is an allowlist (`isServableRelativePath`) enforced in `resolvePublicFile`; Host half via the E1 guard. Commit (G3 commit on branch).
- G4: autodetect POSTs `/__proxy/full-boot?skip_tunnel=1`. Commit (G4).
- G10: CSP built from config.js `*Url` origins (`extractConfigConnectOrigins`), rebuilt when config.js changes; style-src admits accounts.google.com/gsi/style. Commit 56efd9f.

## Claims deferred / partial
- Worker Host guard (lane note "shared by ... worker listeners"): NOT applied to :8644. Tailscale funnel, ngrok and cloudflared forward to 127.0.0.1 with the public Host, so a strict loopback Host allowlist would break the webhook transport. Needs a configured tunnel-host allowlist in the worker runtime config (outside this fence: worker config module). The helper is exported and ready.
- G4 "explicit buttons that show the write scope": UI lives in discovery-wizard-ui.js (outside fence). Only the silent path is closed.
- G10: a custom AI base URL stored only in browser storage (not config.js) is invisible to the server and is still blocked by CSP.

## Tests added (red then green)
- tests/beaudit-p-loopback-host-guard.test.mjs - red: dev-server /profile with Host evil.example -> 200 (expected 403); API /api/llm-config with rebound Host -> 200 (expected 403). Evidence .lane-evidence/red/e1-g2.txt. Green 5/5.
- tests/beaudit-p-worker-raw-path.test.mjs - red: "no response for //" (worker died). .lane-evidence/red/a1.txt. Green 1/1.
- tests/beaudit-p-static-allowlist.test.mjs - red: missing export (allowlist absent). .lane-evidence/red/g3.txt. Green 2/2.
- tests/discovery-autodetect.test.mjs (new G4 describe) - red: skip_tunnel absent. .lane-evidence/red/g4.txt. Green 17/17. Existing exact-URL matches changed to prefix matches (pinned URL changed).
- tests/beaudit-p-csp-config-origins.test.mjs - red: missing export. .lane-evidence/red/g10.txt. Green 3/3.

## Floor (worktree bbuild-p, HEAD 56efd9f)
- npm run lint:repo: exit 0
- npm run typecheck:repo: exit 0
- npm test: exit 0 - tests 3070, pass 3069, fail 0 (1 known todo-marked "canonical submission evidence record", same on base)
- npm run test:browser-use-discovery: exit 0 - tests 741, pass 741, fail 0
- npm run test:contract:all: exit 0 (5 sub-scripts)
- npm run test:e2e-smoke: 9 passed
- npm run test:e2e-journey: 13 passed

## Unverified
- First `npm test` run failed 2 tests in tests/e2e/profile-flow-smoke.test.mjs (profile file not written; 404 on from-resume); the file passes alone and the full rerun passed. Cause not established (suspected parallel-load flake). 
- server/security-boundaries.d.mts edited (declaration companion of the fenced file) to keep typecheck green.
- No second-vendor review or Muse verification has run on this lane.


## Repair round r1 (HEAD 613228d)
- static-path-guard: AGENT_CONTRACT.md explicitly servable (PUBLIC_ROOT_DOCUMENTS); other root .md still refused. Commit 5db12ed.
- security-boundaries: portless Host defaults to 443 on https (socket.encrypted / requestProtocol), 80 on http. Commit 5db12ed.
- Red evidence: red/repair-r1.txt (isAllowedLoopbackHost("localhost",443,"https") false; TLS gate 403; AGENT_CONTRACT.md false). Green: 10/10 in the two test files.
- dev-server.mjs: dashboardSecurityHeaders and its serveStatic call sites reverted (commit 613228d). G10 config.js connect-src wiring DEFERRED to the lane that owns static response headers; extractConfigConnectOrigins remains exported and tested. GSI style-src still ships via buildContentSecurityPolicy defaults.
- security-boundaries.d.mts: NOT reverted. Reverting yields `server/index.mjs(22,3): TS2305 no exported member 'checkLoopbackRequestHost'` and `(198,5): TS2353 'loopbackPort'`. Blocker: needs fence expansion. The optional `scheme` parameter is not declared there (no edits made beyond HEAD).

## Floor r1 (logs r1-*.log)
- lint:repo exit 0; typecheck:repo exit 0
- npm test exit 0: tests 3073, pass 3072, fail 0 (1 todo, same as base)
- test:browser-use-discovery exit 0: tests 741, pass 741, fail 0
- test:contract:all exit 0
- test:e2e-smoke exit 0: 9 passed (needs PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright because HOME is overridden; first run without it failed 9 on missing browser executable)
- test:e2e-journey exit 0: 13 passed (same note)


## Round r2 (HEAD 32ccf15) - fence expanded to .d.mts, dashboardSecurityHeaders, worker config tunnel allowlist
The r1 blocker is cleared: server/security-boundaries.d.mts is now in the fence and carries the guard declarations, plus the `scheme` argument and the `options` object.

### Claims done this round
- G10, now complete: `dashboardSecurityHeaders(configPath)` is restored and exported in dev-server.mjs. Every static response's connect-src admits the origins config.js names, and it is rebuilt when the path or mtime changes. Commit db9d728.
- E1 worker half, now complete: the worker runs `checkLoopbackRequestHost(request, { allowedHosts })` before URL parsing. `allowedHosts` defaults to the tunnel-provider domains (*.ts.net, *.ngrok-free.app, *.ngrok-free.dev, *.ngrok.app, *.ngrok.io, *.trycloudflare.com) plus BROWSER_USE_DISCOVERY_ALLOWED_HOSTS. New shared helper `isAllowedTunnelHost`. Commit 32ccf15.

### Tests added r2 (red then green)
- tests/beaudit-p-csp-config-origins.test.mjs (+2 tests). Red: "dev-server must build its CSP from config.js (dashboardSecurityHeaders)", pass 3 / fail 2 (red/g10-r2.txt). Green: pass 5 / fail 0 (red/g10-r2-green.txt).
- tests/beaudit-p-worker-host-guard.test.mjs (3 tests, port 19004). Red: missing export `isAllowedTunnelHost`, plus a behavioural probe where the pre-fix worker answered `Host: rebind.attacker.test` with 200 (red/e1-worker.txt). Green: pass 3 / fail 0.

### Claims deferred (still open)
- G4 "explicit buttons that show the write scope": the UI is in discovery-wizard-ui.js, which is outside the fence. Only the silent autodetect path is closed (skip_tunnel=1).
- G10: a custom AI base URL kept only in browser storage, and never written to config.js, is invisible to the server and still blocked by CSP.

### Floor r2 (fresh HOME per command; logs r2-*.log; PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright)
- lint:repo exit 0 (eslint clean; lint:skills OK)
- typecheck:repo exit 0 (browser-use-discovery + server tsc clean)
- npm test exit 0: tests 3078, pass 3077, fail 0, todo 1 (the known "canonical submission evidence record", same as base)
- test:browser-use-discovery exit 0: tests 741, pass 741, fail 0
- test:contract:all exit 0 (every OK line, no failures)
- test:e2e-smoke exit 0: 9 passed
- test:e2e-journey exit 0: 13 passed

### Unverified r2
- The first r2 npm test run failed 1 test because of a port clash: my new worker test used 19002, which the API rebound test also uses. I moved the new test to 19004, and the full npm test rerun passed. The other six floor commands ran before that one-line test-port change, and it cannot affect them.
- Real tunnels (Tailscale funnel, ngrok, cloudflared) were not exercised, per the no-network rule. The assumption that each one forwards its public Host is inferred, not tested. A user on a custom tunnel domain must set BROWSER_USE_DISCOVERY_ALLOWED_HOSTS, or webhooks will get 403.
- No Muse verification and no second-vendor review has run on this lane.


## Repair round r3 (HEAD 27e1bcc) - Muse / second-vendor findings
### Claims done this round
- config.ts:431 named tunnel: `BROWSER_USE_DISCOVERY_TUNNEL_HOSTNAME` (bare, name:port, or URL) is normalized to its lowercase hostname and joins the worker `allowedHosts`. Commit 54adcc8.
- server/index.mjs:182 hosted mode: when LISTEN_HOST is not loopback (REQUIRE_API_AUTH), the Host check is skipped and the token gate protects the API, unless the new `JOBBORED_API_ALLOWED_HOSTS` (comma list, exact or *.suffix) is set. In that case it runs with those trusted hosts. On a loopback listener the same list extends the loopback allowlist. Commit 27e1bcc.
- browser-csp-policy.mjs:122 quoted keys: `extractConfigConnectOrigins` accepts bare, "double"- and 'single'-quoted `*Url` keys. A mismatched quote pair is ignored. Commit 2b783f3.

### Tests added r3 (red then green)
- tests/beaudit-p-csp-config-origins.test.mjs "quoted config keys". Red: `actual: [] expected: [ 'https://api.example.com' ]`. Green: 6/6 in the file.
- tests/beaudit-p-worker-host-guard.test.mjs "named-tunnel hostname". Red: `discovery.example.com must admit discovery.example.com: ["*.ts.net",...,"*.trycloudflare.com"]`. Green: 4/4 in the file.
- tests/beaudit-p-loopback-host-guard.test.mjs "hosted API behind a loopback reverse proxy" (ports 19005-19007, 3 tests). Red: all 3 got `{"error":"Host not allowed for this local server.","code":"HOST_NOT_ALLOWED"}`. Green: 10/10 in the file. This includes the 401 check without a token and the 403 for a Host outside JOBBORED_API_ALLOWED_HOSTS.
- No existing assertion was changed.

### Floor r3 (fresh HOME per run; logs floor-repair.log, floor-repair-e2e.log)
- lint:repo exit 0
- typecheck:repo exit 0
- npm test exit 0: tests 3083, pass 3082, fail 0, todo 1 (known, same as base)
- test:browser-use-discovery exit 0: tests 741, pass 741, fail 0
- test:contract:all exit 0 (12 OK lines, no failures)
- test:e2e-smoke exit 0: 9 passed
- test:e2e-journey exit 0: 13 passed
- The first e2e run in floor-repair.log exited 1 for both suites with `browserType.launch: Executable doesn't exist at <fresh HOME>/Library/Caches/ms-playwright/...`. That is the environment issue already noted in r1. Rerunning with PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright and a fresh HOME passed both suites.

### Unverified r3
- `JOBBORED_API_ALLOWED_HOSTS` is not yet documented in AGENTS.md, server/ats-env.example or render.yaml, because those files are outside the fence. The integration runner or the docs lane should add it.
- A hosted listener with no trusted hosts configured does no Host check. It relies on JOBBORED_API_TOKEN, and it answers 503 when the token is unset.
- The real cloudflared named tunnel was not exercised (no network).

## Repair round r4 (HEAD 03de363) - Muse / second-vendor findings
### Claims done this round
- dev-server.mjs:2366 Tailscale dashboard: the request gate now calls `checkLoopbackRequestHost(req, { allowedHosts: JOBBORED_DASHBOARD_ALLOWED_HOSTS, tunnelHosts: ["*.ts.net"] })`. A loopback-proxied `GET /` with Host `mac.tailnet.ts.net` gets 200. `rebind.attacker.test:<port>` and `ts.net.attacker.test` still get 403 HOST_NOT_ALLOWED. Tailscale owns DNS under ts.net, so a rebinding page cannot aim one of those names at 127.0.0.1.
- server/security-boundaries.mjs:146 non-loopback allowlist: `checkLoopbackRequestHost` now takes two lists. `allowedHosts` is the operator allowlist and binds on every socket. With localAddress 192.0.2.10, Host untrusted.example and allowedHosts ["api.example.com"], it returns 403. `tunnelHosts` extends the loopback allowlist only. The worker now passes its tunnel patterns as `tunnelHosts`, so the worker's behavior is unchanged. The API keeps passing JOBBORED_API_ALLOWED_HOSTS as `allowedHosts`, so a configured list now binds on remote and container sockets.
- Commit 03de363. No existing test changed.

### Tests added r4 (red then green)
- tests/beaudit-p-trusted-hosts-repair.test.mjs (5 tests). Red (repair2-red.txt): pass 2 / fail 3. The tailnet GET / got `actual: 403, expected: 200`. The non-loopback untrusted Host returned `{ ok: true }` (expected ok:false). The tunnelHosts option was unknown, so the loopback tunnel Host got 403. Green (repair2-green.txt, together with the loopback-host-guard and worker-host-guard files): pass 19 / fail 0.

### Floor r4 (fresh HOME per command; logs floor-r2-*.log; e2e with PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright)
- lint:repo exit 0
- typecheck:repo exit 0
- npm test exit 0: tests 3088, pass 3087, fail 0, todo 1 (known, same as base)
- test:browser-use-discovery exit 0: tests 741, pass 741, fail 0
- test:contract:all exit 0 (12 OK lines, no failures)
- test:e2e-smoke exit 0: 9 passed
- test:e2e-journey exit 0: 13 passed. The first e2e run without PLAYWRIGHT_BROWSERS_PATH failed 9 and 13 tests on a missing browser executable under the fresh HOME. That is the same environment issue as earlier rounds.

### Unverified r4
- A real Tailscale serve was not exercised (no network). The Host that serve forwards is inferred from the advertised `https://<dnsName>` dashboard URL.
- Other tunnels (ngrok, cloudflared) are not default dashboard names. Users add them through JOBBORED_DASHBOARD_ALLOWED_HOSTS. That env var and JOBBORED_API_ALLOWED_HOSTS are still undocumented, because the docs files are outside the fence.
- A tailnet Host now reaches /__proxy/* and /profile on the dev-server again, as it did before E1. Those routes keep their own loopback-peer and origin checks.
- The non-loopback enforcement was tested at the helper level only. An integration test would need a non-loopback interface, which the no-network rule excludes.

## Round r5 (HEAD f4543ce): resumed after interruption
The review's two blocking findings (dev-server.mjs:2366 Tailscale Host, security-boundaries.mjs:146 non-loopback allowlist) were already fixed in r4 (03de363). The Muse run VERIFY-P-r2 was killed by SIGTERM before it returned a verdict, so this lane has no independent verification yet.

### Claims done this round
- G10 non-blocking review gap: `startDevServer`/`createDevServer` take an optional `dashboardConfigPath` (the default is still ROOT/config.js) that reaches `dashboardSecurityHeaders`. Commit f4543ce. No existing assertion changed.

### Tests added r5 (red then green)
- tests/beaudit-p-csp-config-origins.test.mjs "the served connect-src names the origins a synthetic config.js declares". Red (red/g10-r5-red.txt): the served connect-src lacked `https://jobbored-api-abc123.a.run.app` because the option was ignored. Green (red/g10-r5-green.txt): tests 7, pass 7, fail 0.

### Floor r5 (fresh HOME per command; logs r5-*.log; PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright)
- lint:repo exit 0
- typecheck:repo exit 0
- npm test exit 0: tests 3089, pass 3088, fail 0, todo 1 (known, same as base)
- test:browser-use-discovery exit 0: tests 741, pass 741, fail 0
- test:contract:all exit 0 (every line OK)
- test:e2e-smoke exit 0: 9 passed
- test:e2e-journey exit 0: 13 passed

### Still deferred / unverified
- G4 write-scope buttons (discovery-wizard-ui.js, outside the fence).
- G10: a custom AI base URL kept only in browser storage stays outside the CSP.
- JOBBORED_API_ALLOWED_HOSTS, JOBBORED_DASHBOARD_ALLOWED_HOSTS and BROWSER_USE_DISCOVERY_ALLOWED_HOSTS are undocumented (the docs are outside the fence).
- No completed Muse verification. The audit reproducers were not re-run this round.

## Repair round r6 (HEAD 1e1df89) - E17 STILL-BROKEN (1/6 closed)
### Claims done this round
- E17 items (2)-(6) now have runnable tests in tests/beaudit-p-e17-claim-coverage.test.mjs, with a new fixture tests/fixtures/gemini-url-context-camelcase.json. Commit 1e1df89. No existing test changed.
  - (2) E4 caller coverage: scans the root browser files that call the API. Today that is 13 files: discovery-drawer, fit-profile-backcompat, fit-profile-editor, fit-profile-wizard, materials-queue, oneflow-beat-ai, oneflow-beat-fit, oneflow-beat-resume, pipeline, posting-enrichment, role-materials, scraper-ats-config and settings-modal. The test requires every one of them to use applyHostedApiAuth or apiFetch(). The scanner has its own hard test with positive and negative samples.
  - (3) E2 local pin: the test boots the API on 19008 and POSTs the pin `provider:"local"` exactly as onboarding builds it (hard: 200). It then requires /health to report atsProvider openai_compatible and configured, and requires /api/ats-scorecard to reach a fake local model on 19009.
  - (4) E5 docker boot: the test copies server/ through server/.dockerignore into a temp /app and boots it (hard: no .env files, /health 200). It then requires POST /profile with the starter template to return 2xx with no fs path, and /api/brand-logos to return a non-500 with no fs path.
  - (5) E7 scrape-route validation shape: missing url, file: scheme and private target each get a hard check for a 400 JSON response with a string `error` and no HTML. The test also requires a string `code` on each, and a JSON 404 for an unknown /api route.
  - (6) E9 casing: a lowerCamelCase `urlContextMetadata` fixture. A hard snake_case control passes through the same harness, so casing is the only variable. The test requires the server scraper and job-posting-insights.js to accept the camelCase response.

### Claims deferred (fix outside the fence)
- The fixes behind E17 (2)-(6) belong to other lanes (spec §3): E4 to wave-2 lane B, E2 and E9 to wave-1 lane Q, E5 to wave-2 lane O, and E7 to wave-1 lane L. The target assertions are node:test `todo`s. Each one runs and fails now for the claimed reason, and none of them fails the floor. `BEAUDIT_E17_STRICT=1` makes them hard. The integration runner should set it, or remove the todo markers, once those lanes merge.

### Tests added r6 (red then green)
- red/e17-r6-strict-red.txt (BEAUDIT_E17_STRICT=1): tests 20, pass 9, fail 11. The failures are:
  - E4: 13 callers never attach the token.
  - E2: atsProvider 'gemini' and scorecard 503.
  - E5: POST /profile returns `write_failed` with ENOENT on `<tmp>/integrations/.../user-profile.schema.json`, which leaks the path. /api/brand-logos leaks `templateRoot`.
  - E7: `code` undefined x3, and the unknown route gives text/html.
  - E9: the camelCase response is rejected with "Hosted page is a careers listing", while the snake_case control passes. The browser copy has no urlContextMetadata.
- red/e17-r6-todo.txt (default mode): tests 20, pass 9, fail 0, todo 11.
- This round's "green" is the hard harness only. The 11 targets go green when the owning lanes land.

### Floor r6 (fresh HOME per command; logs r6-*.log; PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright)
- lint:repo exit 0
- typecheck:repo exit 0
- npm test exit 0: tests 3109, pass 3097, fail 0, todo 12 (1 known base todo + 11 E17 targets)
- test:browser-use-discovery exit 0: tests 741, pass 741, fail 0
- test:contract:all exit 0 (12 OK lines, 0 failure lines)
- test:e2e-smoke exit 0: 9 passed
- test:e2e-journey exit 0: 13 passed

### Unverified r6
- The camelCase fixture is synthetic. It follows the REST reference and was not recorded from a live Gemini call, because the lane has no network.
- The docker test simulates the build context. It does not run docker, and it does not check python3 in node:20-alpine.
- E4 coverage is a static scan, not a behavioral check per caller.
- No Muse verification of this round.

## Repair round r7 (HEAD 1e1df89, unchanged) - E17 STILL-BROKEN again: BLOCKED
Muse's finding is correct: in strict mode, tests 20, pass 9, fail 11. Rerun this round (red/e17-r7-strict.txt) gives the same 11 failures:
- E4: the 13 browser callers never attach the hosted token. Fix: apiFetch() at those call sites, in the 13 root *.js files. Owner: wave-2 lane B.
- E2: /health reports atsProvider "gemini" after a `local` pin, and the scorecard never reaches the local model. Fix: a shared provider normalizer in server/ats-scorecard.mjs (around line 826) and llm-config.mjs. Owner: wave-1 lane Q.
- E5: POST /profile leaks an ENOENT path, because server/user-profile.mjs:29 reads a schema that sits outside server/, and /api/brand-logos leaks templateRoot. Fix: vendor the schema, change the Dockerfile and the logo routes. Owner: wave-2 lane O.
- E7: the scrape route returns { error } with no code (server/index.mjs:269 route handler, not middleware), and an unknown /api route returns HTML. Owner: wave-1 lane L (TD-010 E7, contracts and schemas).
- E9: server/shared/gemini-url-context-scrape.mjs and job-posting-insights.js reject the camelCase urlContextMetadata. Owner: wave-1 lane Q.
All five fixes are in files outside lane P's fence, and spec §3 assigns them to other lanes. None of those lane branches exists yet: `git branch --list '*beaudit*'` shows only chore/beaudit-20260925, fix/beaudit-p0-containment, fix/beaudit-w0-p and fix/beaudit-w0-r. The part of E17 that lane P can own is the tests and the rebinding fix. Both are done, and the default-mode harness passes (9 pass, 11 todo). Strict mode goes green only after lanes Q, L, O and B merge.
There were no code changes this round, so nothing was committed. The floor was not rerun, and the r6 floor at this same HEAD stands.
Decision needed from the orchestrator, pick one: (a) accept E17 as done at the harness level and move the strict run to the post-merge integration gate *(recommended)*; (b) widen lane P's fence to those five files, which conflicts with lanes Q, L, O and B; (c) hold E17 open until those lanes merge.

## Repair round r8 (HEAD 3962886a) - Muse / second-vendor findings
### Claims done this round
- BLOCKING worker Host guard in hosted mode (server.ts handleWorkerRequest): the loopback Host guard now runs only when runtimeConfig.runMode === "local". A hosted worker (RUN_MODE=hosted, HOST=0.0.0.0) behind a loopback reverse proxy answers its public Host and is gated by the webhook secret. Commit f5773a8.
- BLOCKING API Origin vs trusted Hosts (security-boundaries.mjs resolveAllowedBrowserOrigin): new option trustedHosts. server/index.mjs passes JOBBORED_API_ALLOWED_HOSTS. A trusted Host skips the loopback-rebinding short-circuit and still needs an exact same-origin match (scheme and port included). .d.mts declares the option. Commit f5773a8.
- E17 harness (tests/beaudit-p-e17-claim-coverage.test.mjs): AUTH_ROUTE_PATTERN source grep removed. The E4 target is now `it.todo` with no body. It claims no coverage and names the behavior test lane B must write: a recording fetch, the hosted token header, and a no-token negative control. The caller inventory stays. Commit 3962886.

### Claims deferred
- E17 remains deferred to lanes Q (E2, E9), L (E7), O (E5) and B (E4), per this round's instruction. Their target assertions stay as node:test todos. The E4 todo does not execute.

### Tests added r8 (red then green)
- tests/beaudit-p-hosted-proxy-trusted-origin.test.mjs (ports 19000, 19003):
  - A hosted worker with Host worker.example.com: /health is not 403, /runs/x without a secret gets 401 (the secret gate), and /runs/x with a valid secret gets 404 (past both gates).
  - resolveAllowedBrowserOrigin unit: same origin passes. These are refused: a cross-origin page, a different scheme, a different port, an omitted port, an untrusted rebound Host, and a request without trust.
  - Loopback API with JOBBORED_API_ALLOWED_HOSTS=api.example.com: a same-origin Origin is not 403, and the cross-origin control http://evil.test gets 403.
  - Red: red/repair-r8.txt (403 HOST_NOT_ALLOWED; '' vs origin; 403 Origin not allowed). Green: 22/22 across the four guard test files.
- tests/beaudit-p-worker-host-guard.test.mjs changed. It now sets BROWSER_USE_DISCOVERY_RUN_MODE=local, because the worker's default run mode is hosted and the guard is now local-only. This is the rebinding negative test, and it still passes (rebound Host gets 403, loopback name on another port gets 403).

### Floor r8 (fresh HOME per command; logs r3-*.log in .lane-evidence; e2e with PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright)
- lint:repo exit 0
- typecheck:repo exit 0
- npm test exit 0: tests 3112, pass 3100, fail 0, todo 12
- test:browser-use-discovery exit 0: tests 741, pass 741, fail 0
- test:contract:all exit 0: 12 OK lines, 0 FAIL
- test:e2e-smoke exit 0: 9 passed
- test:e2e-journey exit 0: 13 passed

### Unverified r8
- The first e2e run without PLAYWRIGHT_BROWSERS_PATH failed 9 and 13 tests on a missing browser executable under the fresh HOME. This is the known environment issue, and the rerun with the path set passed.
- The floor ran against the working tree just before the two commits. The commits contain exactly those files.
- A hosted worker bound to 127.0.0.1 no longer has the Host guard. It relies on the webhook secret, as the finding asked.
