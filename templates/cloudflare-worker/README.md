# Cloudflare Worker — browser-safe POST relay

Use this when the dashboard must **POST JSON from the browser** to a URL that does not send CORS headers (typical for **Google Apps Script** web apps). You deploy a **tiny Worker in your own Cloudflare account**; it adds CORS and forwards the body to your real webhook.

Payload and semantics follow **[AGENT_CONTRACT.md](../../AGENT_CONTRACT.md)** at the repo root.

## Security

This Worker runs in **your** Cloudflare account. You own routing, secrets, and any abuse risk. Prefer **`FORWARD_SECRET`** + path **`/forward`** so random visitors cannot relay traffic through your Worker. Do not commit secrets; use `wrangler secret` or the dashboard.

## Deploy

1. Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm i -g wrangler`) and log in: `wrangler login`.

2. Copy this folder somewhere (or clone the repo) and `cd` into `templates/cloudflare-worker/`.

3. Set the downstream URL (e.g. Apps Script **Deploy → Web app** `/exec` URL):

   ```bash
   wrangler secret put TARGET_URL
   ```

4. Optional — lock to `/forward` + Bearer token:

   ```bash
   wrangler secret put FORWARD_SECRET
   ```

5. Deploy:

   ```bash
   wrangler deploy
   ```

6. In Command Center settings, use your Worker URL as the discovery webhook:
   - Open mode: `https://<your-worker>.<subdomain>.workers.dev/` (any path) **or** add `?target=<url-encoded-exec-url>` for local testing only.
   - Locked mode: `https://<your-worker>.<subdomain>.workers.dev/forward` and send header `Authorization: Bearer <FORWARD_SECRET>` (dashboard must support custom headers if you use this; otherwise use the open Worker URL + `TARGET_URL` only on a private preview URL).

## Environment

| Binding / var    | Type   | Purpose                                                                                                              |
| ---------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `TARGET_URL`     | Secret | HTTPS POST destination (e.g. Apps Script `/exec`). Required unless using `?target=` (dev only).                      |
| `FORWARD_SECRET` | Secret | If set, only **`POST /forward`** is allowed; client must send `Authorization: Bearer <token>` or `X-Forward-Secret`. |
| `CORS_ORIGIN`    | Var    | Optional. Defaults to `*`. Set to your static site origin in production.                                             |

## Behavior

- **`OPTIONS`** — CORS preflight (204).
- **`POST`** — Forwards body and `Content-Type` to `TARGET_URL` (or `?target=`). Returns the **upstream status and body** (transparent relay). On success, upstreams often respond with HTTP **200** and JSON such as `{ "ok": true }` per [AGENT_CONTRACT.md](../../AGENT_CONTRACT.md).

No npm dependencies in the Worker itself; Wrangler is only the CLI you use to deploy.
