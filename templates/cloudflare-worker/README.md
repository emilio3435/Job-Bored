# Cloudflare Worker - browser-safe POST relay

Use this when the dashboard must POST JSON from the browser to a webhook that
does not reliably serve browser CORS, or when you want one browser-facing URL
in front of a downstream webhook you control.

The Worker runs in **your** Cloudflare account. It forwards requests to the
real downstream endpoint you set as `TARGET_URL`.

## Fast path

From the repo root:

```bash
npm run cloudflare-relay:deploy -- --target-url "https://script.google.com/macros/s/.../exec" --cors-origin "https://your-dashboard.example"
```

The helper deploys the Worker, uploads `TARGET_URL`, tries `wrangler login`
automatically in an interactive terminal if auth is missing, and can reuse or
create the account-level `workers.dev` subdomain when `CLOUDFLARE_API_TOKEN`
is available. It also mints the per-dashboard relay token the Worker requires
(see [Deployment](#deployment)). If you also pass `--sheet-id`, it verifies
the deploy with that token.

If your real discovery engine runs on your own machine, run:

```bash
npm run discovery:bootstrap-local
```

That helper starts or reuses the local receiver and ngrok, then writes
`discovery-local-bootstrap.json` so the dashboard can autofill the local path.
Use the printed public tunnel URL as the downstream `TARGET_URL` for the relay.

## Dashboard rule

In JobBored, save the `workers.dev` Worker URL as the discovery webhook. Do
**not** save `/forward`. Keep Cloudflare Access off that URL, because the
browser cannot complete an Access login on a `fetch`. The Worker is still
locked: it answers 401 to any caller without this dashboard's relay token (see
[Caller authentication](#caller-authentication-beaudit-g1)).

## Deployment

Deploy with the helper. It is the only path that mints the relay token,
uploads it as the Worker's `RELAY_TOKEN` secret, and hands it to your local
dashboard. A Worker set up by hand with `wrangler deploy` has no token, so it
answers 401 to every request (it fails closed), and the dashboard has no
credential to send.

1. Sign in to Cloudflare (the helper also runs `wrangler login` for you in an
   interactive terminal):

   ```bash
   npx wrangler login
   ```

2. Deploy from the repo root:

   ```bash
   npm run cloudflare-relay:deploy -- \
     --target-url "https://your-tunnel.example/webhook" \
     --discovery-secret "<the worker's x-discovery-secret>" \
     --sheet-id "<your sheet id>"
   ```

   - `--target-url` is the downstream webhook: an Apps Script `/exec` URL or
     a public tunnel URL that forwards to your local worker.
   - `--discovery-secret` is optional. Pass it when the downstream enforces
     `x-discovery-secret` (the browser-use discovery worker does); the Worker
     then injects it upstream and the browser never sees it.
   - `--sheet-id` is optional. With it the helper verifies the deploy by
     POSTing a discovery request with the relay token.

3. The helper prints the Worker URL and stores the token in one git-ignored,
   owner-only file: `.jobbored-relay/credential.json` (mode 0600). The `relay`
   block of `discovery-local-bootstrap.json` gets the Worker URL and lock flag
   but never the token, because that file is not owner-only.

4. Start the dashboard with `npm run dev` and open it on `localhost`. It reads
   the token from the loopback-only route `GET /__proxy/discovery-relay-token`
   and sends it as `Authorization: Bearer <token>` to the Worker origin only.
   Setup shows **Relay locked** once it holds the token.

### Existing Workers deployed by hand

If you deployed this Worker yourself before the relay was locked, keep its
name and URL by passing that name to the helper:

```bash
npm run cloudflare-relay:deploy -- --worker-name "<your existing worker name>" \
  --target-url "<the same TARGET_URL>"
```

The helper redeploys the same Worker, so the `workers.dev` URL saved in the
dashboard does not change. It mints a `RELAY_TOKEN`, uploads it, and writes
the local credential above. The dev server reads that credential on every
request, so a running dashboard picks the token up on its next relay request
without a restart. Secrets you already
set (`DISCOVERY_SECRET`, `REFRESH_SHEET_ID`) stay on the Worker. If you had
set `FORWARD_SECRET`, delete it with `npx wrangler secret delete
FORWARD_SECRET --name "<your existing worker name>"`: the Worker accepts it as
a legacy bearer only when `RELAY_TOKEN` is unset, and the dashboard never
holds it.

Redeploying later keeps the same token, so the dashboard's cached bearer
stays valid. Pass `--rotate-token` to mint a new one; the dashboard re-reads
the token after the Worker's first 401 and retries once.

The dashboard only picks up the token on the machine that ran the deploy
(through `localhost`). Hosted dashboards are unsupported; see below.

## Behavior

- `OPTIONS` returns CORS preflight handling.
- `POST` forwards the body and `Content-Type` to `TARGET_URL`.
- `scheduled()` posts a `command-center.discovery` payload to
  `<TARGET_URL origin>/webhook` with `trigger:"scheduled-cloudflare"` when
  `REFRESH_SHEET_ID` is set.
- The response status and body come back from the downstream webhook.

## Environment

| Binding / var      | Type   | Purpose                                                                    |
| ------------------ | ------ | -------------------------------------------------------------------------- |
| `TARGET_URL`       | Secret | HTTPS downstream webhook. Required.                                        |
| `DISCOVERY_SECRET` | Secret | Optional. When set, injected as `x-discovery-secret` on the upstream POST. |
| `REFRESH_SHEET_ID` | Secret | Required for Cloudflare Cron discovery. Used as the webhook `sheetId`.     |
| `RELAY_TOKEN`      | Secret | Required. Per-dashboard bearer minted by `deploy-cloudflare-relay.mjs`; callers send `Authorization: Bearer <token>` or `X-Relay-Token`. Without it the relay answers 401. |
| `FORWARD_SECRET`   | Secret | Legacy name for the same bearer; accepted when `RELAY_TOKEN` is unset. |
| `CORS_ORIGIN`      | Var    | Optional browser origin. Defaults to `*` when omitted.                     |

## Notes

- The browser-facing Worker URL is what JobBored saves in Settings.
- The downstream target is the real webhook behind the relay.
- If the downstream is Apps Script, keep treating the Apps Script stub as
  stub-only until it actually writes Pipeline rows.

## Caller authentication (BEAUDIT G1)

The relay is locked. Every request must carry the per-dashboard `RELAY_TOKEN`
as `Authorization: Bearer <token>` (or `X-Relay-Token`); anonymous calls get
401 and never reach your worker, and a relay with no token configured fails
closed. The relay forwards POST to `/` (TARGET_URL itself), `/webhook`,
`/discovery`, `/discovery-profile`, `/ingest-url` and `/cleanup-expired`, and
GET to `/runs` and `/runs/<id>`. Every other path is 404 (for example
`/pipeline-update` and `/health`), and any other method on an allowed path is
405. The `?target=` query override is gone.

`deploy-cloudflare-relay.mjs` writes the token into the relay block of
`discovery-local-bootstrap.json`. The static-file server denies that file, so a
local dashboard fetches the token from the loopback-guarded dev-server route
`GET /__proxy/discovery-relay-token`, which returns only
`{ ok, relay: { workerUrl, relayToken, relayLocked } }`. A redeploy of the same
Worker keeps the existing token so a dashboard's cached bearer stays valid; pass
`--rotate-token` to mint a new one. When the relay answers 401 the dashboard
re-reads the token once and retries. Deploy verification sends the bearer
itself. To check a locked relay by hand, run `npm run test:discovery-webhook`
with `RELAY_TOKEN` set (or pass `--relay-token`); without it the relay answers
401.

## Hosted mode is unsupported

Running the dashboard and discovery worker as a hosted, multi-user service is
unsupported until the hosted-mode fixes (BEAUDIT E4-E6) land. Use the local
worker with this relay.
