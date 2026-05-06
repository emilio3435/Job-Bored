# Backend Worker A — OAuth bootstrap + install doctor

You are Backend Worker A in the JobBored greenfield-automation parallel swarm.
Working branch: `feat/greenfield-automation-swarm` (already exists).

## Your write scope (edit ONLY these files)

- `scripts/oauth-bootstrap.mjs`
- `scripts/install-doctor.mjs`
- `dev-server.mjs` — only the bodies of `handleOAuthBootstrap` and
  `handleInstallDoctor`. Do not modify any other handler.
- `tests/oauth-bootstrap.test.mjs` (new)
- `tests/install-doctor.test.mjs` (new)

## Locked contracts

Read the header comment block above `handleOAuthBootstrap` in
`dev-server.mjs`. The five endpoints are documented there. Do not widen any
field.

## Implementation requirements

### `scripts/oauth-bootstrap.mjs`
- Use `child_process.spawnSync` to detect `gcloud --version`.
- Verify auth via `gcloud auth list --format=json`.
- Required APIs: `iam.googleapis.com`, `oauth2.googleapis.com`. Detect
  `accessNotConfigured` and surface it as `{ ok:false, reason:"api_disabled",
  actionable:"Run `gcloud services enable iam.googleapis.com oauth2.googleapis.com`" }`.
- Use `gcloud iap oauth-clients` or the OAuth brand+client APIs to create
  the Client ID. JavaScript origin must be `http://localhost:8080` and
  `http://127.0.0.1:8080`.
- NEVER run `gcloud auth login` non-interactively. Return
  `{ ok:false, reason:"not_logged_in", actionable:"Run `gcloud auth login` then click again" }`.
- File must be both runnable as a CLI (prints JSON to stdout) AND importable
  for the dev-server handler.

### `scripts/install-doctor.mjs`
- Detect `gcloud`, `wrangler`, `ngrok` via spawnSync `--version`.
- Login detection:
  - gcloud:   `gcloud auth list --format=json` → any active account
  - wrangler: `wrangler whoami` → exit 0 means logged in
  - ngrok:    `ngrok config check` → exit 0 means token present
- Return the locked shape exactly. `missing` is human-readable next steps in
  priority order.
- Both CLI-runnable and importable.

### `dev-server.mjs` handlers
- Replace the 501 stubs in `handleOAuthBootstrap` and `handleInstallDoctor`
  with real implementations that import the scripts above.
- Stay localhost-only via the existing `isLocalOrigin(req)` check.
- Catch all errors; never leak stack traces.

### Tests
- Use Node's built-in `node:test`.
- Mock `child_process.spawnSync` so tests don't shell out for real.
- Cover: gcloud missing, gcloud not logged in, gcloud success path,
  install-doctor with all-missing tools, all-present tools, mixed.

## Shared rules

- Read any file. Edit only your write scope.
- Do not edit `app.js`, `setup-doctor.js`, `index.html`, `style.css`, or
  anything under `integrations/cloudflare-relay-template/` or any
  keep-alive script.
- No new root `package.json` deps. CLI shell-outs are fine.
- Maintainer pays $0. All credentials live on the user's machine.

## End with the standard handoff

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

Then exit. Do not start Worker B's tasks.
