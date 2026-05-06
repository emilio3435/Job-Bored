# Backend Worker B — Cloudflare relay template + keep-alive daemon

You are Backend Worker B in the JobBored greenfield-automation parallel swarm.
Working branch: `feat/greenfield-automation-swarm`.

## Your write scope (edit ONLY these files)

- `integrations/cloudflare-relay-template/**` (entire subtree)
- `scripts/discovery-keep-alive.mjs` — extend, do not rewrite
- `scripts/install-keep-alive.mjs`
- `scripts/uninstall-keep-alive.mjs`
- `dev-server.mjs` — only the bodies of `handleInstallKeepAlive`,
  `handleUninstallKeepAlive`, `handleKeepAliveStatus`
- `tests/keep-alive.test.mjs` (new)
- `tests/relay-template.test.mjs` (new)

## Locked contracts

Read the header above `handleInstallKeepAlive` in `dev-server.mjs`. Do not
widen any field.

Job label: `ai.jobbored.discovery.keepalive`
Log path: `~/.jobbored/logs/keep-alive.log`
State file: `~/.jobbored/keep-alive-state.json` (last URL + last redeploy ISO timestamp)

## Implementation requirements

### `integrations/cloudflare-relay-template/`
- `wrangler.toml` must require zero hand-edits. `DISCOVERY_TARGET` comes via
  `--var` at deploy time.
- `src/worker.js`:
  - `POST /discovery` → forward to `${DISCOVERY_TARGET}/discovery`
  - `GET /runs/:runId` → forward to `${DISCOVERY_TARGET}/runs/:runId`
  - `GET /health` → 200 OK
  - Validate optional `SHARED_SECRET` bearer
  - Never log request bodies
- `manifest.json` filled out with the actual values
- `README.md` finalized for end users

### `scripts/discovery-keep-alive.mjs` (extend)
- Add structured JSON log lines to `~/.jobbored/logs/keep-alive.log`
- Persist `~/.jobbored/keep-alive-state.json` after every successful redeploy
- Default poll interval 30s
- Exit cleanly on SIGINT/SIGTERM (already does — preserve)

### `scripts/install-keep-alive.mjs`
- macOS: write `~/Library/LaunchAgents/ai.jobbored.discovery.keepalive.plist`,
  then `launchctl load -w <plist>` and `launchctl start <label>`
- Linux: write `~/.config/systemd/user/ai.jobbored.discovery.keepalive.service`
  + matching `.timer`, then `systemctl --user daemon-reload`,
  `systemctl --user enable --now ai.jobbored.discovery.keepalive.timer`
- Windows: return `{ ok:false, reason:"unsupported_platform" }` with
  actionable message
- Idempotent: re-running replaces, never duplicates
- Never requires sudo

### `scripts/uninstall-keep-alive.mjs`
- Mirror image of install. Idempotent. Returns `{ ok:true, removed:boolean }`.

### `dev-server.mjs` handlers
- Replace the three 501 stubs with real implementations.
- Stay localhost-only.

### Tests
- Mock `child_process.spawnSync` for `launchctl`, `systemctl`, `wrangler`.
- Cover: install on darwin, install on linux, install on win32 (graceful
  fail), uninstall idempotency, status when installed/not installed.
- Relay template: unit-test the worker.js fetch handler with a mocked
  `fetch` for the upstream call.

## Shared rules

- Read any file. Edit only your write scope.
- Do not edit `app.js`, `setup-doctor.js`, `index.html`, `style.css`,
  `scripts/oauth-bootstrap.mjs`, or `scripts/install-doctor.mjs`.
- No new root `package.json` deps. CLI shell-outs are fine.
- Maintainer pays $0. All resources are on the user's free-tier accounts.

## End with the standard handoff (same format as Worker A).
