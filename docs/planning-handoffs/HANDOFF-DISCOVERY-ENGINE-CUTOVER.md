# Handoff: browser-use discovery cutover is live, but still machine-dependent

**Audience:** An implementation agent taking over discovery-engine hardening after the browser-use cutover.

**Goal:** Keep the current browser-use discovery path working, then remove the remaining machine-local and credential fragility so `Run discovery` is not dependent on one laptop session.

---

## 1. Current live state

The active browser-facing discovery path is now:

- browser
- Cloudflare Worker
- ngrok
- local browser-use worker

Current live URL:

- `https://jobbored-discovery-relay-6d6dab.jobbored.workers.dev`

Current downstream target:

- `https://6932-99-62-49-146.ngrok-free.app/webhook`

Current local receiver:

- `http://127.0.0.1:8644/webhook`

Current local health endpoint:

- `http://127.0.0.1:8644/health`

Healthy response at handoff:

```json
{"status":"ok","service":"browser-use-discovery-worker","mode":"local","asyncAckByDefault":true}
```

Important:

- Hermes is **not** the active live discovery engine anymore.
- Hermes previously reclaimed port `8644`; that gateway process was stopped so the browser-use worker could own the port again.
- If `8644` starts returning `{"status":"ok","platform":"webhook"}`, Hermes has taken the port back.

---

## 2. What changed locally in this session

These changes are local and uncommitted.

### Worker startup and config

- [package.json](../../package.json)
  - `npm run discovery:worker:start-local` now starts the browser-use server in `local` mode on `127.0.0.1:8644`
  - it uses:
    - `integrations/browser-use-discovery/state/worker-config.json`
    - `integrations/browser-use-discovery/state/worker-state.sqlite`

- [.gitignore](../../.gitignore)
  - ignores `integrations/browser-use-discovery/state/`

### Sheets credential support

- [integrations/browser-use-discovery/src/config.ts](../../integrations/browser-use-discovery/src/config.ts)
  - added:
    - `googleOAuthTokenJson`
    - `googleOAuthTokenFile`
  - local mode now falls back to `~/.hermes/google_token.json` if no explicit Sheets credential is configured

- [integrations/browser-use-discovery/src/sheets/pipeline-writer.ts](../../integrations/browser-use-discovery/src/sheets/pipeline-writer.ts)
  - supports Google OAuth token JSON / file
  - refreshes OAuth access tokens using `refresh_token`, `client_id`, and `client_secret`
  - upgrades legacy Pipeline sheets whose required leading headers match but optional trailing headers are blank

- [integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts](../../integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts)
  - preflight credential checks now accept the OAuth token inputs too

- [integrations/browser-use-discovery/.env.example](../../integrations/browser-use-discovery/.env.example)
- [integrations/browser-use-discovery/README.md](../../integrations/browser-use-discovery/README.md)
  - document the new OAuth token env vars and the local fallback behavior

### Bootstrap helper behavior

- [scripts/bootstrap-local-discovery.mjs](../../scripts/bootstrap-local-discovery.mjs)
  - honors explicit `--engine browser_use_worker`
  - reuses the existing relay worker name when available
  - preserves the browser-use `/webhook` target in generated local bootstrap state instead of slipping back to the Hermes `/webhooks/...` route

### Local worker state used during cutover

There is a local ignored config file at:

- `integrations/browser-use-discovery/state/worker-config.json`

It was populated for real runs with:

- sheet id `1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ`
- companies:
  - Scale AI
  - Figma
  - Stripe
  - Notion

That file is intentionally not tracked in git.

---

## 3. Verification completed

### Syntax / tests

- `node --check scripts/bootstrap-local-discovery.mjs`
- `npm run test:browser-use-discovery`
  - passing at handoff: `25` tests

### Local health

- `curl -i -s http://127.0.0.1:8644/health`
  - returned HTTP `200`
  - service `browser-use-discovery-worker`
  - mode `local`

### Bootstrap state

[discovery-local-bootstrap.json](../../discovery-local-bootstrap.json) was regenerated and now points to browser-use:

- local webhook:
  - `http://127.0.0.1:8644/webhook`
- public target:
  - `https://6932-99-62-49-146.ngrok-free.app/webhook`
- worker name:
  - `jobbored-discovery-relay-6d6dab`

### Relay verification

This succeeded at handoff:

```bash
npm run test:discovery-webhook -- --url 'https://jobbored-discovery-relay-6d6dab.jobbored.workers.dev' --sheet-id '1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ'
```

Result:

- `OK - endpoint returned ok: true (HTTP 202)`

### Real Pipeline writes

Two real browser-use runs were verified:

1. local worker run
   - completed with `state:"partial"`
   - `normalizedLeadCount:20`
   - `appended:20`

2. browser-facing relay run
   - completed with `state:"partial"`
   - `normalizedLeadCount:20`
   - `appended:0`
   - `updated:20`

Readback against the real Pipeline tab showed browser-use-created rows, including Stripe Greenhouse entries and populated logo URLs.

---

## 4. Why this is still not fully hardened

The cutover works, but it is still fragile in three ways.

### 1. Live traffic depends on this laptop session

The live Worker currently forwards into:

- local ngrok
- local browser-use worker on port `8644`

If this machine sleeps, reboots, loses ngrok, or the worker dies, the live discovery path will degrade.

### 2. Local worker config is not reproducible from git alone

The working config lives in:

- `integrations/browser-use-discovery/state/worker-config.json`

That is correct for secret-bearing local state, but it means another agent cannot reconstruct the exact working setup from the repo alone without re-creating that file.

### 3. Sheets auth currently relies on Hermes user OAuth fallback

The local worker is now capable of using:

- service account JSON
- raw access token
- OAuth token JSON / file

For this cutover, the practical credential path was the local Hermes token file:

- `~/.hermes/google_token.json`

That is good enough for local recovery, but it is not the right long-term credential for unattended discovery infrastructure.

---

## 5. Important repo state warning

The worktree is still dirty well beyond this handoff.

At handoff, `git status --short` included unrelated in-flight edits such as:

- [AGENT_CONTRACT.md](../../AGENT_CONTRACT.md)
- [SETUP.md](../../SETUP.md)
- [style.css](../../style.css)
- multiple files under [integrations/browser-use-discovery/](../../integrations/browser-use-discovery/)
- [schemas/pipeline-row.v1.json](../../schemas/pipeline-row.v1.json)
- [package.json](../../package.json)
- untracked:
  - `dev-server.mjs`

Do not assume a clean branch. Do not revert broadly.

---

## 6. Exact next steps for the next agent

### Step 1: preserve recoverability

If anything has restarted, first confirm the active engine again:

```bash
curl -i -s http://127.0.0.1:8644/health
```

Wanted response:

- service `browser-use-discovery-worker`

If Hermes has reclaimed the port, restart browser-use and regenerate bootstrap:

```bash
npm run discovery:bootstrap-local -- --engine browser_use_worker --worker-name 'jobbored-discovery-relay-6d6dab' --sheet-id '1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ'
```

### Step 2: replace the local OAuth fallback with a proper worker credential

Best next hardening step:

- give the browser-use worker its own stable Sheets writer credential
- prefer a service account or another explicit non-user credential path

Then verify the worker still writes successfully without depending on `~/.hermes/google_token.json`.

### Step 3: decide whether live traffic should keep depending on ngrok

Right now the relay is live, but only through this local chain.

Make an explicit call between:

- keeping the laptop/ngrok path as a temporary bridge
- moving the browser-use worker to a stable hosted runtime

### Step 4: make worker config reproducible without committing secrets

At minimum:

- document the required shape of `worker-config.json`
- or add a safer template/bootstrap flow for recreating it quickly

### Step 5: rerun end-to-end verification after any restart or credential change

Use:

```bash
npm run test:discovery-webhook -- --url 'https://jobbored-discovery-relay-6d6dab.jobbored.workers.dev' --sheet-id '1mGJ04E3f2Tp0-7ErNlb8veXjnlKz3x5a6gwyzEFvnKQ'
```

Then confirm real Pipeline writes or updates again before calling the system stable.
