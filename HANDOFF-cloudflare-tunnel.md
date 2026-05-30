# HANDOFF — Cloudflare Tunnel transport (3-tier) for local discovery

**Goal:** Finish the 3-tier public-URL transport so a greenfield user gets a working tunnel with zero third-party signups by default, and a user with a Cloudflare domain gets a stable URL with no keepalive resync.

**Success means:** `npm run typecheck:repo` is clean; new + existing tests pass; the bootstrap selects the right transport (named > quick > ngrok) and persists it; the keepalive no-ops on a stable transport; `cloudflared` survives reboot via a launchd/systemd autostart service; SETUP.md documents the 3 tiers. Nothing live is created/installed and nothing is committed/pushed without the user's explicit say-so.

**Stop when:** all six remaining deliverables below are implemented, unit-tested (subprocesses mocked), and `typecheck:repo` + the relevant test files pass — then report what's done and what (if anything) still needs live verification.

---

## Where to start

- Branch: **`feat/seamless-discovery-coexistence`** (this WIP commit is the tip). Build on it.
- Read these first — they are the patterns to mirror:
  - `scripts/lib/discovery-transport.mjs` — the pure core you'll call (already done + tested).
  - `scripts/bootstrap-local-discovery.mjs` — the `--tunnel` flag + 3-tier selection is wired in; you finish the state payload.
  - `scripts/install-discovery-worker-autostart.mjs` + `scripts/uninstall-discovery-worker-autostart.mjs` — **clone these** for the tunnel autostart (cross-platform launchd/systemd, `spawnSyncImpl` injection, port read from `discovery-local-bootstrap.json`).
  - `scripts/discovery-keep-alive.mjs` — `runKeepAliveCheck` is where the stable-transport no-op goes.
  - `tests/discovery-transport.test.mjs`, `tests/discovery-worker-autostart.test.mjs`, `tests/wrangler-resilience.test.mjs` — the test style (`spawnSyncImpl` recorder, temp homes, fetch mocks).

## What's already done (in this WIP commit)

- **`scripts/lib/discovery-transport.mjs`** — pure, tested core. API:
  - `selectTransport({preference, cloudflaredInstalled, namedTunnelConfigured, ngrokAvailable})` → `"cloudflare_named" | "cloudflare_quick" | "ngrok"`
  - `normalizeTransportPreference(raw)` → canonical kind | `"auto"` | `""`
  - `detectCloudflared({spawnSyncImpl})` → `{installed, version?}`
  - `parseQuickTunnelUrl(text)` → `https://<x>.trycloudflare.com` | `""`
  - `isStableTransport(kind)` → `true` only for `cloudflare_named`
  - `buildQuickTunnelCommand(port)` / `buildNamedTunnelCommand(name)` → `{command, args}`
  - Constants: `TRANSPORT_CLOUDFLARE_NAMED|_QUICK|NGROK`, `TUNNEL_HOSTNAME_ENV_KEY` (the env var holding the named-tunnel stable hostname).
- **`scripts/bootstrap-local-discovery.mjs`** — `--tunnel auto|cloudflare-named|cloudflare-quick|ngrok` flag parsed; transport selected before the ngrok step; quick-tunnel spawns `cloudflared tunnel --url ...` and polls its log for the URL; named-tunnel reads the hostname from the env key; **ngrok path preserved unchanged as the fallback**; downstream pipeline still gets `ngrok = {ngrokPublicUrl, startedNgrok}` so relay/state code is untouched.
- **`tests/discovery-transport.test.mjs`** — 8 passing unit tests for the core.

## Remaining deliverables (in priority order)

1. **Persist the transport in bootstrap state.** In `bootstrap-local-discovery.mjs` `main()`, add `transport: { kind, publicUrl, stable }` to the `payload` written by `writeBootstrapState`. `kind` = the selected transport, `publicUrl` = the chosen public URL, `stable` = `isStableTransport(kind)`. (The agent stopped right here.) Keep populating `ngrokPublicUrl`/`publicTargetUrl` from the same URL.
2. **Keepalive no-op on stable.** In `scripts/discovery-keep-alive.mjs` `runKeepAliveCheck`, after reading the bootstrap state, if `transport.stable === true` return early `{ok:true, redeployed:false, reason:"stable_transport"}` and `appendJsonLog` it. Rotating transports (quick/ngrok) keep the existing resync. Add a test asserting **no** `wrangler`/`npx` call happens when stable.
3. **`cloudflared` autostart service.** New `scripts/install-discovery-tunnel-autostart.mjs` + `uninstall-...`, cloned from the worker-autostart pair. Label `ai.jobbored.discovery.tunnel`. The service command comes from `buildQuickTunnelCommand(port)` (quick) or `buildNamedTunnelCommand(name)` (named), chosen from the bootstrap state's `transport.kind`. launchd `KeepAlive{SuccessfulExit=false}` + systemd `Restart=on-failure`; logs `~/.jobbored/logs/discovery-tunnel.log`. Export install/uninstall/status + render fns; test via `spawnSyncImpl`.
4. **`package.json`** — add `discovery:tunnel:autostart:install|uninstall|status`; add both new scripts to `typecheck:repo`. (Optionally `discovery:tunnel:start`.)
5. **Tests** — bootstrap integration (transport selection + quick-tunnel URL-poll path, mocking the spawned cloudflared output); the keepalive no-op (item 2); tunnel-autostart render/install. Mirror existing test patterns.
6. **`SETUP.md`** — a short "Public URL: 3 ways" section: named (stable, needs a Cloudflare domain) / quick (zero-signup default) / ngrok (fallback), and how to pick via `--tunnel` or env.

Then: optional **dev-server endpoint + dashboard control** for one-click tunnel autostart (mirror `/__proxy/install-worker-autostart` + the "Discovery worker on boot" button). Lower priority; can be a follow-up.

## Locked design decisions (do not re-litigate)

- Default for greenfield = **cloudflare_quick** (anonymous, no signup; rotates, so keepalive stays for this tier).
- **named** tunnel = the only stable tier (no rotation, keepalive off); requires the user's Cloudflare domain — **read** the config, never create it.
- **ngrok** = fallback only; never removed or regressed.
- The free-port worker coexistence + worker-autostart already shipped on this branch (commit `81c0fd4`) — don't touch them.

## Hard constraints

- Do **not** run `cloudflared`/`ngrok`/`wrangler` live, create tunnels, or install launchd/systemd services. Unit tests inject `spawnSyncImpl` (and `fetch` where needed).
- Do **not** `git commit`/`push` without the user explicitly asking (the harness enforces this).
- Surgical changes; match each file's conventions; preserve the ngrok fallback exactly.

## Verify

```
npm run typecheck:repo
node --test tests/discovery-transport.test.mjs tests/discovery-coexistence-port.test.mjs \
  tests/discovery-worker-autostart.test.mjs tests/wrangler-resilience.test.mjs \
  tests/discovery-bootstrap-secret.test.mjs
```

## Gotchas

- **Agent token ceiling (~100k):** the two prior agents stalled near ~100k subagent tokens mid-task. Work in priority order, finish + checkpoint each deliverable, don't try to land all six in one shot.
- **wrangler nag:** `wrangler --json` prints a "Cloudflare agent skills available" notice to stdout; the deploy script already handles it via `extractWranglerJson` + `CI=1`. The keepalive already falls back to `npx wrangler` on ENOENT. Reuse those, don't reinvent.
- **Live verification is the user's step:** the named tier needs their Cloudflare domain + a configured `cloudflared` named tunnel; the quick tier needs `cloudflared` installed. Leave live testing to them with explicit consent.
