# Worker E Stress QA - 2026-05-20

Scope: independent QA/stress pass for the current Job-Bored swarm result. This report is test/report only; no implementation files were edited.

## Stress Matrix

| # | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | Wrong process on 8644 returns `200 /health` | `tests/dev-server-discovery-state.test.mjs` | Pass |
| 2 | Multiple ngrok tunnels, no matching tunnel, stale tunnel | `tests/discovery-bootstrap-secret.test.mjs`, `tests/keep-alive.test.mjs`, `tests/setup-doctor.test.mjs` | Pass |
| 3 | Local dashboard 8080/8081 and hosted Worker URL | Browser smoke on `localhost:8080` and `localhost:8081`; `tests/ingest-url-endpoint-resolution.test.mjs`; added hosted status-path assertion | Mixed: browser pass, hosted status-path fail |
| 4 | Cloudflare relay CORS and secret/header forwarding | `tests/cloudflare-relay-secret-injection.test.mjs`, `tests/relay-template*.test.mjs`, polling CORS tests | Pass |
| 5 | Add URL with browser Google token only, no persistent worker credential | `tests/ingest-url-endpoint-resolution.test.mjs`; worker webhook token tests | Pass |
| 6 | Manual Add with and without URL/webhook | `tests/ingest-url-endpoint-resolution.test.mjs`, `handle-ingest-url.test.ts` | Pass |
| 7 | Async accept with/without statusPath, polling CORS/network failure, terminal local fallback | Dashboard polling/runs tests; added hosted status-path assertion | Mixed: local/fallback pass, hosted no-statusPath fail |
| 8 | Worker timeout terminalization and late completion | `handle-discovery-webhook.test.ts`, full worker suite | Pass |
| 9 | Partial Sheets update then append failure counts | `pipeline-writer.test.ts`, `run-discovery.test.ts` | Pass |
| 10 | Missing optional provider keys should not force degraded run if other lanes succeed | `run-discovery.test.ts`, `serpapi-google-jobs.test.ts` | Pass |
| 11 | Docs/package drift and setup-doctor header repair | `tests/node-contract.test.mjs`, `tests/setup-doctor.test.mjs`, manual AGENTS check | Mixed: tests pass, `AGENTS.md` stale Node 20 |
| 12 | Custom local worker port should not reset to 8644 | `package.json` script inspection, `tests/repo-validation-surface.test.mjs`, runtime targeted tests | Pass |

## Commands Run

- `npm test -- tests/ingest-url-endpoint-resolution.test.mjs tests/discovery-run-status-polling.test.mjs tests/runs-tab.test.mjs tests/discovery-drawer-payload.test.mjs tests/pipeline-filter-controls.test.mjs tests/discovery-wizard-verify.test.mjs` -> 70/70 pass.
- `npm test -- tests/dev-server-discovery-state.test.mjs tests/discovery-bootstrap-secret.test.mjs tests/keep-alive.test.mjs` -> 28/28 pass.
- `node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/handle-discovery-webhook.test.ts integrations/browser-use-discovery/tests/webhook/handle-ingest-url.test.ts integrations/browser-use-discovery/tests/webhook/credential-readiness.test.ts integrations/browser-use-discovery/tests/webhook/config.test.ts integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts integrations/browser-use-discovery/tests/webhook/routing-enforcement.test.ts integrations/browser-use-discovery/tests/webhook/handle-discovery-profile-schedule.test.ts integrations/browser-use-discovery/tests/sheets/pipeline-writer.test.ts integrations/browser-use-discovery/tests/sources/serpapi-google-jobs.test.ts` -> 197/197 pass.
- `npm test -- tests/doctor.test.mjs tests/setup-doctor.test.mjs tests/install-doctor.test.mjs tests/fix-setup-endpoint.test.mjs tests/repo-validation-surface.test.mjs tests/node-contract.test.mjs tests/schedule-installers.test.mjs tests/cloudflare-relay-secret-injection.test.mjs tests/relay-template.test.mjs tests/relay-template-get-runs.test.mjs` -> 60/60 pass.
- `npm run typecheck:repo` -> pass.
- `npm run test:contract:all` -> pass.
- `git diff --check` -> pass.
- `npm test -- tests/discovery-payload-sanitization.test.mjs tests/discovery-webhook-secret-header.test.mjs tests/oauth-session-storage-boundary.test.mjs tests/discovery-autodetect.test.mjs tests/relay-bootstrap-persist.test.mjs tests/discovery-bootstrap-secret.test.mjs tests/dev-server-https.test.mjs tests/fix-setup-endpoint.test.mjs` -> 66/66 pass.
- `npm run test:browser-use-discovery` -> 450/450 pass.
- `npm test` -> fail, 537/539 pass before the added hosted-status QA assertion; failures in `tests/draft-generation-stability.test.mjs`.
- `npm test -- tests/draft-generation-stability.test.mjs` -> fail, 23/25 pass.
- `npm test -- tests/discovery-run-status-polling.test.mjs` after adding the hosted-status assertion -> fail, 7/8 pass.

## Failures

### FE/Backend Contract: hosted async run status can be reconstructed without token

Repro:

```bash
npm test -- tests/discovery-run-status-polling.test.mjs
```

Observed: the added QA assertion fails because `app.js` allows `canSynthesizeRunStatusPath()` for `isLikelyCloudflareWorkerUrl(normalized)` and generic hosted `/webhook|/discovery|/discovery-profile` paths.

Expected: when a hosted worker omits `statusPath`, the dashboard should not synthesize tokenless `/runs/:id`. Hosted `/runs/:id` requires the returned HMAC `statusPath`/`statusToken`. Local worker behavior can remain open.

Likely owner: dashboard lane, with backend contract review.

References:

- `app.js:5676`
- `tests/discovery-run-status-polling.test.mjs:84`

### Dashboard/frontend: draft modal ATS lifecycle regressions

Repro:

```bash
npm test -- tests/draft-generation-stability.test.mjs
```

Observed failures:

- `ATS scorecard state is reset when modal opens in loading state`
- `retry-ats-scorecard button uses current active draft text`

Expected: opening the draft modal in loading state resets ATS scorecard state, and retry uses the active draft text/current session job context.

Likely owner: dashboard/frontend lane.

References:

- `tests/draft-generation-stability.test.mjs:206`
- `tests/draft-generation-stability.test.mjs:244`

### OSS/devex docs drift: AGENTS still says Node 20

Observed: `package.json`, `.node-version`, `.nvmrc`, CI, README, SETUP, and tests now require Node 24, but `AGENTS.md` still says `Use Node 20, matching CI.`

Expected: AGENTS should match the current repo runtime contract or it will direct future agents to use the wrong Node version.

Likely owner: OSS/devex lane.

Reference:

- `AGENTS.md:18`

## Browser Smoke

- `http://localhost:8080/` loaded, no console errors.
- `http://localhost:8081/` loaded, no console errors.
- Clicking `#discoveryBtn` on signed-out localhost opened the Discovery search drawer without console errors.
- Screenshots captured under `.gstack/qa-reports/screenshots/`.

## Unresolved Risks

- I did not submit real Google OAuth, Sheets writes, Cloudflare deploys, ngrok rotations, or live hosted worker requests. Those paths were covered by deterministic unit/contract tests only.
- `npm test` remains red until the two draft-generation failures are fixed. With the added hosted-status QA assertion, `tests/discovery-run-status-polling.test.mjs` is also intentionally red to expose the hosted contract gap.
