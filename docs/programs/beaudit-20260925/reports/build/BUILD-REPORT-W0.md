## BEAUDIT wave 0: P0 containment (incident PR, spec §0.1)

This PR closes the four P0 rows from the 2026-09-25 backend audit: E1+G2 (DNS rebinding), G1 (open Cloudflare relay), A1 (`GET //` worker crash) and C1+C2+D15 (SSRF bypass). It also lands the P1 rows G3 and G4, and the P2 rows G10, C8, C9, E8 and C16.

Branch `fix/beaudit-p0-containment`, cut from `origin/main` f227fbb, contains three lane merges. Every lane ran on Opus 5.5 at medium effort; all 2,172 model records in the run journals say `claude-opus-5-5` / `medium`. Muse (Spark 1.3) verified each lane, and astra-ro (gpt-6-astra) reviewed each diff.

| Merge | Lane | Claims | Muse | Review | Repair rounds |
|---|---|---|---|---|---|
| 4c9a375 | P, Perimeter | E1 (+G2), A1, G3, G4 (silent autodetect path), G10 (config.js connect-src) | all FIXED at 3962886 | no blocking | 4 across 3 runs |
| 1d31d58 | R, Relay auth | G1, G24 | G1 FIXED; G24 FIXED through the lane-written `tests/relay-g24-handshake.test.mjs` (the audit had no reproducer) | no blocking | 5 across 4 runs |
| 37f5c38 | X, Egress | C1 (+C2, D15), C8, C9, E8, C16 | all FIXED at 576e1d6 | no blocking | 4 across 2 runs |

### What changed

- **P, Perimeter.** One loopback Host/Origin guard is shared by the dev-server, the API and the worker. The worker applies the guard only in local run mode; hosted mode stays behind its webhook secret. The guard admits `JOBBORED_API_ALLOWED_HOSTS` and `JOBBORED_DASHBOARD_ALLOWED_HOSTS` with exact same-origin matching, and it admits Tailscale dashboard hosts. Static serving is an allowlist. Autodetect may start only the local worker (`skip_tunnel=1`). `GET //` no longer crashes the worker.
- **R, Relay auth.** The relay now requires a per-dashboard bearer: without it the relay answers 401, it fails closed, and it forwards only the dashboard routes. Deploy mints the token into `.jobbored-relay/credential.json` (mode 0600), keeps it across redeploys and accepts `--rotate-token`. Deploy also verifies the relay with the bearer, after the token upload. The dashboard reads the token from the loopback-guarded `/__proxy/discovery-relay-token` route and sends it only to the relay origin. It loads the token with a timeout, honors the caller's cancel signal, and refreshes once on a 401. The contract companions (AGENT_CONTRACT.md, CONTRACT-CHANGELOG, examples, and a schema `$comment`) move together.
- **X, Egress.** Every outbound URL goes through `safeFetch`. The agent-browser command gets a DNS check before it spawns. Credential headers are stripped on cross-origin redirects. Bodies are capped while they stream, under the caller's deadline. Gzip, zlib and raw deflate all decode. Public IPv6 literals work, and private v4 and v6 ranges stay blocked.

### Decision for Emilio

**The GitHub Actions → Cloudflare relay path is retired in the docs (lane R).** A locked relay rejects the unauthenticated GitHub workflow, so scheduled discovery now uses the relay's Cloudflare Cron (`--sheet-id`), or the workflow points at the worker or Apps Script URL. If you want the GitHub → relay path back, `settings-profile-tab.js:78` and `.github/workflows/command-center-discovery.yml` need a `COMMAND_CENTER_DISCOVERY_RELAY_TOKEN` secret.

### Deferred, accepted by the orchestrator (none is a P0 or P1 fix)

- **E17 (P2).** The harness exists; its strict targets belong to later lanes: E2 and E9 to lane Q, E7 to L, E5 to O and E4 to B. They run as `todo` (12 todos in `npm test`).
- **G4 UI.** The wizard's write-scope buttons live in `discovery-wizard-ui.js`. Only the silent autodetect path is closed.
- **G10 for Settings-saved endpoints.** The server-built CSP covers `config.js` on disk. An endpoint saved only in browser storage (`config-overrides.js`) is still missing from `connect-src`. It was missing before this PR too.
- **G24 UI.** The wizard screen does not show the relay-locked status yet. The model status and the deploy summary line do exist.
- **Docs.** The new `*_ALLOWED_HOSTS` environment variables are not yet in AGENTS.md or the env examples.

### Evidence: floor on the final merged tree (37f5c38)

Every floor command ran with `HOME` set to a fresh temp dir and `PLAYWRIGHT_BROWSERS_PATH` pointing at the real cache:

```
npm run lint:repo                   exit 0
npm run typecheck:repo              exit 0
npm test                            tests 3265, pass 3253, fail 0, todo 12
npm run test:browser-use-discovery  tests 767, pass 767, fail 0
npm run test:contract:all           exit 0
npm run test:e2e-smoke              9 passed
npm run test:e2e-journey            13 passed
gitleaks detect (origin/main..HEAD) no leaks found
```

The baseline at f227fbb was `npm test` 3057 pass + 1 todo and discovery 741/741. The floor was also run after each lane merge: after P, `npm test` 3100/0; after R, 3205/0; after X, 3253/0. e2e was 9/9 and 13/13 each time.

- Muse verdicts: `docs/programs/beaudit-20260925/verdicts/BUILD-VERDICT-{P,R,X}-r*.json`
- Reviews: `docs/programs/beaudit-20260925/verdicts/REVIEW-{P,R,X}.json`
- Lane reports: `reports/build/BUILD-REPORT-{P,R,X}.md`

### Unverified

- No live Cloudflare deploy, Telegram or Tailscale call was made. The relay was exercised through in-process tests only.
- No real hosted-proxy deployment was run; the hosted Host path is covered by a unit test.
- Codex and Muse quota were not read (no meter).

### Runs

Six Workflow runs, from `wf_b255dbc8-e08` (twice) through `wf_a177ca32-cc1`, used about 5.7M subagent tokens in total. Runs 1–3 stopped on lane fences that were too narrow, a verify runner that returned before Muse finished, and a stale lane HOME. The orchestrator fixed each of these and re-ran the affected lanes. The auto-mode classifier blocked the original script's automatic merge queue ("Merge Without Review"), so the orchestrator merged green lanes by hand on Emilio's instruction (2026-09-25 08:18). Each merge ran the floor, e2e and gitleaks on the merged tree before committing.
