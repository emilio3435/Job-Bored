# Cloudflare Relay Template (jobbored-discovery-relay)

> Owner: Backend Worker B — fill this out in swarm Phase 1.

Zero-config Cloudflare Worker that proxies dashboard discovery webhook calls
to a private local discovery worker exposed via ngrok.

User-owned, free Cloudflare Workers tier. Maintainer pays nothing.

## Required vars

| Var | Required | Purpose |
|-----|----------|---------|
| `DISCOVERY_TARGET` | yes | Live ngrok HTTPS URL of the user's local worker |
| `SHARED_SECRET` | optional | Bearer token validated on every relayed request |

## Deploy

```sh
cd integrations/cloudflare-relay-template
wrangler deploy --var DISCOVERY_TARGET:https://<user>.ngrok.app
```

Worker B should make this command produce a working relay with **zero** edits
to `wrangler.toml`.
