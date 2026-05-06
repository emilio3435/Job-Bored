# QA Worker — Mocks, integration test harness, docs

You are the QA Worker in the JobBored greenfield-automation parallel swarm.
Working branch: `feat/greenfield-automation-swarm`.

You can run in Phase 1 alongside Workers A and B because your write scope is
disjoint from theirs. You build the mocks they will reuse and the docs the
maintainer will publish.

## Your write scope (edit ONLY these files)

- `tests/integration/greenfield-automation.test.mjs` (new)
- `tests/mocks/gcloud.mjs` (new)
- `tests/mocks/wrangler.mjs` (new)
- `tests/mocks/ngrok-api.mjs` (new)
- `docs/AUTOMATION-GREENFIELD-PLAN.md` (new) — operator-facing one-pager
- `docs/QA-DISCOVERY-GREENFIELD-CHECKLIST.md` — append (not rewrite) new
  checklist items for the four new flows
- `README.md` — append a new "## One-line setup" section. Do not edit any
  other section.

## What to build

### Mocks
- `tests/mocks/gcloud.mjs` — exports a factory that returns a fake
  `spawnSync` returning canned responses for each gcloud subcommand path
  the workers care about (`--version`, `auth list`, `iap oauth-clients
  create`, `services enable`).
- `tests/mocks/wrangler.mjs` — same shape, for wrangler.
- `tests/mocks/ngrok-api.mjs` — exports a fake `fetch` that returns a
  configurable `/api/tunnels` response.

### Integration test
`tests/integration/greenfield-automation.test.mjs` covers four flows
end-to-end against the locked endpoint contracts (works against both the
501 stubs AND a fully implemented Phase 1):

1. OAuth auto-create happy path
2. OAuth fallback when gcloud missing
3. Install-doctor reporting all-missing then all-present
4. Keep-alive install on darwin (mocked launchctl) + uninstall idempotency

Use the existing `runOnDevServer` pattern if present in the repo, otherwise
boot the dev-server inside the test via `createDevServer`.

### Docs
- `docs/AUTOMATION-GREENFIELD-PLAN.md` — single page. Sections: What it
  does, What it costs (always $0 to maintainer), Required user accounts
  (Google, Cloudflare, ngrok — all free), Troubleshooting.
- `docs/QA-DISCOVERY-GREENFIELD-CHECKLIST.md` — append four new checklist
  items, one per flow.
- `README.md` — append section "## One-line setup" with the actual command
  the user will run (`npm run setup:auto` or similar — let the swarm prompt
  user to define it; if undefined, write a placeholder). Append only.

## Shared rules

- Read any file. Edit only your write scope. NEVER edit runtime source
  (`app.js`, `dev-server.mjs`, `scripts/*`, `setup-doctor.js`,
  `index.html`, `style.css`, anything under `integrations/`).
- No new root `package.json` deps.
- Tests must run under `npm test` without external network access.

## End with the standard handoff (same format as Worker A).
