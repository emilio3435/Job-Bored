# Discovery transport rewrites

How the dashboard reaches the discovery receiver has been rewritten three times. Each iteration solved one user problem and exposed another.

## v1: Direct browser → local worker

Concept: the dashboard, served from `localhost:8080`, calls `127.0.0.1:8644/discovery` directly.

Problem: works for local dev but fails the moment the dashboard is hosted on GitHub Pages — browsers won't let HTTPS pages call HTTP-loopback URLs. CORS becomes painful even on plain HTTP.

## v2: Apps Script as universal stub

Concept: the user deploys the `integrations/apps-script/` Web App. The dashboard always POSTs to `https://script.googleapis.com/...`. Apps Script does the actual discovery (or hands off to other services).

Problem: Apps Script is unreliable for long-running runs, has tight quotas, and CORS *still* blocks browser fetches in some Chrome versions. The stub also doesn't have access to local resources (Browser Use, SQLite, local models).

Persistent benefit: the stub is still the recommended **smoke test receiver** to confirm the dashboard ↔ webhook plumbing works. See `integrations/apps-script/WALKTHROUGH.md`.

## v3: Cloudflare relay + ngrok tunnel (current)

Concept:

```
Browser (HTTPS) → Cloudflare Worker (HTTPS) → ngrok tunnel (HTTPS) → local worker (HTTP)
```

- The Cloudflare Worker is HTTPS, deployed under the user's account, with `DISCOVERY_TARGET` pointing at the current ngrok URL.
- ngrok provides the public HTTPS endpoint for the local worker.
- `scripts/discovery-keep-alive.mjs` watches `127.0.0.1:4040` (ngrok admin) and rewrites `DISCOVERY_TARGET` when ngrok rotates the tunnel URL.

Tradeoffs:

- Works on GitHub Pages without CORS pain.
- Free at the user's expected discovery volume.
- Slightly more moving parts than v1 — three processes plus the Cloudflare Worker.

## v4 (in progress): 3-tier transport selection

`feat/seamless-discovery-coexistence` (the current working branch) introduces a 3-tier transport selector:

1. **Direct** — when local + same-machine.
2. **Tunnel** — ngrok with auto-keep-alive.
3. **Relay** — Cloudflare Worker.

The dashboard auto-selects the highest-fidelity tier that works. See `HANDOFF-cloudflare-tunnel.md` for the in-progress design.

## Files involved

- `dev-server.mjs` — `/__proxy/ngrok-tunnels` for live tunnel detection
- `scripts/bootstrap-local-discovery.mjs`
- `scripts/install-discovery-tunnel-autostart.mjs` / `uninstall-discovery-tunnel-autostart.mjs`
- `scripts/discovery-keep-alive.mjs`
- `scripts/install-cloudflare-relay.mjs`
- `integrations/cloudflare-relay-template/`
- `templates/cloudflare-worker/`

## Related

- [Discovery feature](../features/discovery.md)
- [Deployment](../deployment.md)
- [Cleanup opportunities](../cleanup-opportunities.md)
