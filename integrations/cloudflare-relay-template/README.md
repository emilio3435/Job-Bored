# JobBored Cloudflare Discovery Relay

This template deploys a user-owned Cloudflare Worker that forwards JobBored
discovery traffic to the user's current local discovery tunnel. It is designed
for the free Cloudflare Workers tier and requires no maintainer-hosted service.

## What It Proxies

| Browser request | Upstream request |
| --- | --- |
| `POST /discovery` | `${DISCOVERY_TARGET}/discovery` |
| `GET /runs/:runId` | `${DISCOVERY_TARGET}/runs/:runId` |
| `GET /health` | local 200 OK relay health response |

`DISCOVERY_TARGET` should be the base HTTPS tunnel URL, for example
`https://abc123.ngrok-free.app`. Do not include `/discovery` or `/runs` in the
target.

## Deploy

```sh
cd integrations/cloudflare-relay-template
wrangler deploy --var DISCOVERY_TARGET:https://abc123.ngrok-free.app
```

No hand edits to `wrangler.toml` are required.

## Optional Shared Secret

To require browser callers to send `Authorization: Bearer <secret>` on relayed
requests:

```sh
wrangler deploy \
  --var DISCOVERY_TARGET:https://abc123.ngrok-free.app \
  --var SHARED_SECRET:replace-with-a-long-random-value
```

`GET /health` stays open so JobBored can detect that the relay itself is up.

## Privacy

The Worker does not log request bodies. It forwards the body to the user's
configured `DISCOVERY_TARGET` and returns the upstream response status and
content type to the browser.
