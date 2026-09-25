# Discovery webhook examples

**New to discovery?** Read **[docs/DISCOVERY-PATHS.md](../docs/DISCOVERY-PATHS.md)** (webhook optional; alternatives). **Apps Script:** **[integrations/apps-script/WALKTHROUGH.md](../integrations/apps-script/WALKTHROUGH.md)**.

These JSON files are **sample POST bodies** for **Run discovery**: when a user clicks that action and a discovery webhook URL is set, the dashboard POSTs JSON like this to your endpoint. See the full contract in [../AGENT_CONTRACT.md](../AGENT_CONTRACT.md) (interface **B — Discovery webhook**).

| File                                             | Purpose                                             |
| ------------------------------------------------ | --------------------------------------------------- |
| `discovery-webhook-request.v1.json`              | Minimal body; empty `discoveryProfile`.             |
| `discovery-webhook-request.v1-with-profile.json` | Same shape with example `discoveryProfile` strings. |

**Schema:** [../schemas/discovery-webhook-request.v1.schema.json](../schemas/discovery-webhook-request.v1.schema.json)

## Relay auth (Cloudflare relay URLs)

A Cloudflare relay deployed with `npm run cloudflare-relay:deploy` answers **`401`** to any request without its per-dashboard relay token, sent as **`Authorization: Bearer <RELAY_TOKEN>`**. The deploy script mints that token and keeps it only in the owner-only file `.jobbored-relay/credential.json` at the repository root (field `relayToken`); it is never written to `discovery-local-bootstrap.json`. Load it into your shell before the commands below:

```bash
RELAY_TOKEN="$(node -p "require('./.jobbored-relay/credential.json').relayToken")"
```

The request body does not change; the bearer is transport only. A receiver that is not the relay (Apps Script `/exec`, webhook.site, the local echo below) ignores the header, so the commands below work for every URL. See the relay-auth line of the receiver checklist in [../AGENT_CONTRACT.md](../AGENT_CONTRACT.md).

## Automated check (repo script)

From the **repository root**, after you have an HTTPS webhook URL (e.g. Apps Script `/exec`, or your relay's `workers.dev` URL):

```bash
RELAY_TOKEN="$RELAY_TOKEN" npm run test:discovery-webhook -- --url "YOUR_URL" --sheet-id "YOUR_SHEET_ID"
```

This POSTs `examples/discovery-webhook-request.v1.json` (with your `sheetId` and a fresh `variationKey`) and exits **0** only if the response JSON has `"ok": true`. When `RELAY_TOKEN` (or `--relay-token`) is set, the script sends it as `Authorization: Bearer`. See `scripts/verify-discovery-webhook.mjs`.

## Try with curl

Replace `YOUR_URL` with a [webhook.site](https://webhook.site) unique URL, your local receiver, or your relay URL (set `RELAY_TOKEN` as above; without it a relay answers `401`).

```bash
curl -sS -X POST "$YOUR_URL" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -d @examples/discovery-webhook-request.v1.json
```

```bash
curl -sS -X POST "$YOUR_URL" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -d @examples/discovery-webhook-request.v1-with-profile.json
```

**Local echo (Node one-liner):** in another terminal, listen and print the body:

```bash
node -e "require('http').createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(b);r.writeHead(200);r.end('ok')})}).listen(8765)"
```

Then: `YOUR_URL=http://127.0.0.1:8765` and run the `curl` lines above from the repo root (paths stay `examples/...`).
