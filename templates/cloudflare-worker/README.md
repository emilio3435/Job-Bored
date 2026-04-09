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

3. Optional:

   ```bash
   wrangler secret put FORWARD_SECRET
   ```

   Use this only if you intentionally want to lock the Worker for manual
   testing. The JobBored dashboard still expects the open Worker URL.

4. Deploy:

   ```bash
   wrangler deploy
   ```

## Behavior

- `OPTIONS` returns CORS preflight handling.
- `POST` forwards the body and `Content-Type` to `TARGET_URL`.
- The response status and body come back from the downstream webhook.

## Environment

| Binding / var    | Type   | Purpose                                                                                      |
| ---------------- | ------ | -------------------------------------------------------------------------------------------- |
| `TARGET_URL`     | Secret | HTTPS downstream webhook. Required.                                                          |
| `FORWARD_SECRET` | Secret | Optional lock for `POST /forward` on private/manual tests.                                    |
| `CORS_ORIGIN`    | Var    | Optional browser origin. Defaults to `*` when omitted.                                       |

## Notes

- The browser-facing Worker URL is what JobBored saves in Settings.
- The downstream target is the real webhook behind the relay.
- If the downstream is Apps Script, keep treating the Apps Script stub as
  stub-only until it actually writes Pipeline rows.
