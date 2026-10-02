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
wrangler deploy \
  --var DISCOVERY_TARGET:https://abc123.ngrok-free.app \
  --var SHARED_SECRET:replace-with-a-long-random-value \
  --var ALLOWED_ORIGINS:https://your-dashboard.example
```

No hand edits to `wrangler.toml` are required.

## Shared Secret (required)

Every relayed request must send `Authorization: Bearer <SHARED_SECRET>`. The
relay fails closed: with no `SHARED_SECRET` set, `POST /discovery` and
`GET /runs/:runId` answer 401 `relay_secret_not_configured` and nothing
reaches your tunnel.

`GET /health` stays open so JobBored can detect that the relay itself is up.

## Allowed Origins

`ALLOWED_ORIGINS` is a comma-separated list of the browser origins that may
call the relay, for example your dashboard's origin. A listed origin is
echoed back in `Access-Control-Allow-Origin`; any other browser origin gets
403 before auth or relaying. There is no `*`. Requests without an `Origin`
header (curl, schedulers) are unaffected.

The relay that `npm run cloudflare-relay:deploy` publishes is
`templates/cloudflare-worker/`; it fails closed the same way with its own
`RELAY_TOKEN`.

## Privacy

The Worker does not log request bodies. It forwards the body to the user's
configured `DISCOVERY_TARGET` and returns the upstream response status and
content type to the browser.
