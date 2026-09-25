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
is available. If you also pass `--sheet-id`, it runs the repo webhook verify
step after deploy.

If your real discovery engine runs on your own machine, run:

```bash
npm run discovery:bootstrap-local
```

That helper starts or reuses the local receiver and ngrok, then writes
`discovery-local-bootstrap.json` so the dashboard can autofill the local path.
Use the printed public tunnel URL as the downstream `TARGET_URL` for the relay.

## Dashboard rule

In JobBored, save the **open `workers.dev` URL** as the discovery webhook.
Do **not** save `/forward` in the dashboard path. Keep Cloudflare Access off the
open Worker URL or the browser test path will fail.

## Deployment

1. Install Wrangler and sign in:

   ```bash
   wrangler login
   ```

2. Set the downstream target:

   ```bash
   wrangler secret put TARGET_URL
   ```

   Good targets include:
   - an Apps Script `/exec` URL
   - a public ngrok URL that forwards to your local webhook

3. If the downstream webhook enforces `x-discovery-secret` (e.g. the
   browser-use discovery worker), upload the shared secret so the Worker can
   inject it for you. The browser never sees this value:

   ```bash
   wrangler secret put DISCOVERY_SECRET
   ```

   When set, the Worker attaches `x-discovery-secret: <DISCOVERY_SECRET>` to
   the upstream request. When unset, the Worker still forwards an
   `x-discovery-secret` header sent by the browser (back-compat).

4. Optional:

   ```bash
   wrangler secret put FORWARD_SECRET
   ```

   Use this only if you intentionally want to lock the Worker for manual
   testing. The JobBored dashboard still expects the open Worker URL.

5. Deploy:

   ```bash
   wrangler deploy
   ```

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
closed. Only `/`, `/webhook`, `/runs` and `/runs/<id>` are forwarded; every
other path is 404. The `?target=` query override is gone.

## Hosted mode is unsupported

Running the dashboard and discovery worker as a hosted, multi-user service is
unsupported until the hosted-mode fixes (BEAUDIT E4-E6) land. Use the local
worker with this relay.
