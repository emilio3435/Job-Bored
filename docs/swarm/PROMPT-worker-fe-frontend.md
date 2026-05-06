# Frontend Worker — UI surfacing + auto-wire

You are the Frontend Worker (Opus 4.7) in the JobBored greenfield-automation
parallel swarm. Working branch: `feat/greenfield-automation-swarm`.

You may only run AFTER Phase 1 (Workers A and B) ships their endpoint
implementations. Phase 1 stubs return 501 — your code must degrade gracefully
when the endpoints return 501.

## Your write scope (edit ONLY these files)

- `app.js` — only:
  1. New `installDoctor()` async helper that calls `POST /__proxy/install-doctor`,
     dispatches `window` event `jobbored:install-doctor:update` with the response.
  2. Extend the OAuth Client ID disclosure (already in `index.html`) to
     include "Auto-create with gcloud" button that calls
     `POST /__proxy/oauth-bootstrap` and auto-fills the input on success.
  3. Extend the `POST /__proxy/full-boot` success path to silently call
     `POST /__proxy/install-keep-alive` exactly once per machine.
  4. One new "Setup health" entry in the user menu calling install-doctor +
     showing keep-alive status pill.
- `setup-doctor.js` — extend the issues registry with three new findings:
  - `gcloud_can_create_oauth` (autoFixable, calls oauth-bootstrap)
  - `keep_alive_not_installed` (autoFixable, calls install-keep-alive)
  - `keep_alive_stale` (autoFixable, restart job)
- `index.html` — only the new tiny markup for the gcloud auto-create button
  and the keep-alive status pill. Do not restructure existing onboarding /
  setup screens.
- `style.css` — only `.doctor-keep-alive-pill` and `.doctor-gcloud-btn`
  rules. Use existing tokens from `:root`.
- `tests/setup-doctor.test.mjs` — extend with tests for the three new findings.
- `tests/install-doctor-frontend.test.mjs` (new) — fetch-mocked tests of the
  `installDoctor()` helper and the auto-call from `full-boot`.

## Locked contracts

Read the header above `handleOAuthBootstrap` in `dev-server.mjs`. Endpoint
shapes are frozen there. The window event you dispatch is:

```js
new CustomEvent("jobbored:install-doctor:update", { detail: <install-doctor response body> })
```

## UX requirements

- Keep the "Something's off — fix it" SetupDoctor pattern intact: ONE big
  button, no walls of text, no bulleted issue lists.
- The gcloud auto-create button is inside the existing "I don't have a
  Client ID yet" disclosure. Label: "Create one for me with gcloud".
- The keep-alive pill in the user menu is a small status indicator: green
  "Auto-healing on" or grey "Not installed — install".
- Never block the user. If an endpoint returns 501 (Phase 1 not landed),
  hide the affordance silently.

## Shared rules

- Read any file. Edit only your write scope.
- Do not edit `dev-server.mjs`, anything under `scripts/`, or anything under
  `integrations/cloudflare-relay-template/`.
- No new root `package.json` deps.
- Preserve the OAuth-Client-ID-only / BYO security model — never centralize
  any credential.

## End with the standard handoff (same format as Worker A).
