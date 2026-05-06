# Greenfield Automation Swarm — Execution Plan

Working branch: `feat/greenfield-automation-swarm`

## Mission

Implement four free-tier-only automation improvements that keep JobBored 100%
BYO/OSS:

1. Auto-create OAuth Client ID via `gcloud` CLI (when present)
2. One-line install script for `wrangler login` + ngrok auth + worker boot
3. Silent ngrok rotation auto-redeploy as a launchd/systemd-user job
4. Pre-configured "zero-config" Cloudflare relay template

## Roster

| Role | Model | Workspace |
|------|-------|-----------|
| Orchestrator | GPT-5.5 xhigh (you) | Main session |
| Backend Worker A — OAuth + install-doctor | GPT-5.5 xhigh | `worker-a` |
| Backend Worker B — Relay + keep-alive | GPT-5.5 xhigh | `worker-b` |
| Frontend Worker — UI + auto-wire | Opus 4.7 (Factory Droid) | `worker-fe` |
| QA Worker — Mocks + integration + docs | GPT-5.5 xhigh | `worker-qa` |

## Phases

- **Phase 0 (done):** orchestrator stubs five HTTP handlers, scaffolds files,
  saves these prompts. Branch created.
- **Phase 1 (parallel):** Worker A, Worker B, QA Worker run together.
- **Phase 2:** Frontend Worker runs alone after Phase 1 endpoints are live.
- **Phase 3:** Orchestrator merges and runs full validation.

## Locked endpoint contracts

See `dev-server.mjs` header comments above the five new handlers
(`handleOAuthBootstrap`, `handleInstallDoctor`, `handleInstallKeepAlive`,
`handleUninstallKeepAlive`, `handleKeepAliveStatus`). Workers must not widen
these contracts.

## Ownership map (write scopes)

### Backend Worker A
- `scripts/oauth-bootstrap.mjs`
- `scripts/install-doctor.mjs`
- `dev-server.mjs` — only `handleOAuthBootstrap` and `handleInstallDoctor`
- `tests/oauth-bootstrap.test.mjs`
- `tests/install-doctor.test.mjs`

### Backend Worker B
- `integrations/cloudflare-relay-template/**`
- `scripts/discovery-keep-alive.mjs` (extend, not rewrite)
- `scripts/install-keep-alive.mjs`
- `scripts/uninstall-keep-alive.mjs`
- `dev-server.mjs` — only the three keep-alive handlers
- `tests/keep-alive.test.mjs`
- `tests/relay-template.test.mjs`

### Frontend Worker
- `app.js` — only `installDoctor()` helper, OAuth disclosure auto-create
  button, post-`full-boot` keep-alive auto-call, and one user-menu entry
- `setup-doctor.js` — three new findings only
- `index.html` — new tiny markup only
- `style.css` — `.doctor-keep-alive-pill`, `.doctor-gcloud-btn` only
- `tests/setup-doctor.test.mjs` — extend with three new findings
- `tests/install-doctor-frontend.test.mjs`

### QA Worker
- `tests/integration/greenfield-automation.test.mjs`
- `tests/mocks/{gcloud,wrangler,ngrok-api}.mjs`
- `docs/AUTOMATION-GREENFIELD-PLAN.md`
- `docs/QA-DISCOVERY-GREENFIELD-CHECKLIST.md` — append-only
- `README.md` — append "One-line setup" section only

## Shared rules (binding for every worker)

- Read any file you need; edit only your write scope.
- Do not revert changes you did not make.
- If you need a locked contract changed, stop and leave an integration note
  in your handoff. Do not change it yourself.
- Stay localhost-only via `isLocalOrigin(req)` for all new HTTP handlers.
- Add no new runtime deps to root `package.json` for the dashboard. CLI
  scripts may shell out to `gcloud`, `wrangler`, `ngrok`, `launchctl`,
  `systemctl`.
- Maintainer pays $0. Every flow runs on the user's free-tier accounts.

## Handoff format

Every worker must end with:

```
Files changed:
- ...

Exports / entrypoints added:
- ...

Assumptions made:
- ...

Integration notes for orchestrator:
- ...

Blocked-by / contract conflicts:
- ...

Suggested tests:
- ...
```

## Merge gates (Phase 3)

- [ ] No worker edited outside its declared scope (verified via `git diff --stat`)
- [ ] All five new endpoints respond correctly + degrade gracefully when CLIs missing
- [ ] `gcloud` path returns clean failure when `gcloud` not installed
- [ ] Keep-alive job installs on macOS (launchd) and Linux (systemd-user); uninstall idempotent
- [ ] Relay template deploys via `wrangler deploy` with zero hand-edits
- [ ] Frontend SetupDoctor auto-fixes the three new findings in one click each
- [ ] No new runtime deps in root `package.json`
- [ ] All 261 existing tests still pass + new tests pass
- [ ] No code path sends user creds to any maintainer host
- [ ] Greenfield walkthrough on a clean machine: ≤4 clicks, 0 copy/paste
