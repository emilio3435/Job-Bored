# Discovery webhook examples

**New to discovery?** Read **[docs/DISCOVERY-PATHS.md](../docs/DISCOVERY-PATHS.md)** (webhook optional; alternatives). **Apps Script:** **[integrations/apps-script/WALKTHROUGH.md](../integrations/apps-script/WALKTHROUGH.md)**.

These JSON files are **sample POST bodies** for **Run discovery**: when a user clicks that action and a discovery webhook URL is set, the dashboard POSTs JSON like this to your endpoint. See the full contract in [../AGENT_CONTRACT.md](../AGENT_CONTRACT.md) (interface **B — Discovery webhook**).

| File                                             | Purpose                                             |
| ------------------------------------------------ | --------------------------------------------------- |
| `discovery-webhook-request.v1.json`              | Minimal body; empty `discoveryProfile`.             |
| `discovery-webhook-request.v1-with-profile.json` | Same shape with example `discoveryProfile` strings. |
| `discovery-webhook-request.v1.1-idempotency.json` | Contract v1.1: the minimal body plus an optional `idempotencyKey`. |

**Schema:** [../schemas/discovery-webhook-request.v1.schema.json](../schemas/discovery-webhook-request.v1.schema.json)

## Any receiver (Apps Script, webhook.site, a local echo)

These commands send **no credentials**. Use them for any receiver that is not your Cloudflare relay; for the relay, see [Your Cloudflare relay](#your-cloudflare-relay) below.

### Automated check (repo script)

From the **repository root**, after you have an HTTPS webhook URL (e.g. Apps Script `/exec`):

```bash
npm run test:discovery-webhook -- --url "$RECEIVER_URL" --sheet-id "YOUR_SHEET_ID"
```

This POSTs `examples/discovery-webhook-request.v1.json` (with your `sheetId` and a fresh `variationKey`) and exits **0** only if the response JSON has `"ok": true`. See `scripts/verify-discovery-webhook.mjs`.

### Try with curl

Set `RECEIVER_URL` to a [webhook.site](https://webhook.site) unique URL or your local receiver.

```bash
curl -sS -X POST "$RECEIVER_URL" \
  -H 'Content-Type: application/json' \
  -d @examples/discovery-webhook-request.v1.json
```

```bash
curl -sS -X POST "$RECEIVER_URL" \
  -H 'Content-Type: application/json' \
  -d @examples/discovery-webhook-request.v1-with-profile.json
```

**Local echo (Node one-liner):** in another terminal, listen and print the body:

```bash
node -e "require('http').createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(b);r.writeHead(200);r.end('ok')})}).listen(8765)"
```

Then: `RECEIVER_URL=http://127.0.0.1:8765` and run the `curl` lines above from the repo root (paths stay `examples/...`).

## Your Cloudflare relay

A Cloudflare relay deployed with `npm run cloudflare-relay:deploy` answers **`401`** to any request without its per-dashboard relay token, sent as **`Authorization: Bearer <RELAY_TOKEN>`**. The deploy script mints that token and keeps it only in the owner-only file `.jobbored-relay/credential.json` at the repository root (field `relayToken`); it is never written to `discovery-local-bootstrap.json`.

**Send the token only to your relay URL.** It is a live credential: any other receiver that sees it (webhook.site, Apps Script, a local echo, a log) can replay it against your relay. The commands in this section post only to `RELAY_URL`, which you load from the same credential file:

```bash
RELAY_URL="$(node -p "require('./.jobbored-relay/credential.json').workerUrl")"
RELAY_TOKEN="$(node -p "require('./.jobbored-relay/credential.json').relayToken")"
```

The request body does not change; the bearer is transport only. See the relay-auth line of the receiver checklist in [../AGENT_CONTRACT.md](../AGENT_CONTRACT.md).

### Automated check (repo script)

```bash
RELAY_TOKEN="$RELAY_TOKEN" npm run test:discovery-webhook -- --url "$RELAY_URL" --sheet-id "YOUR_SHEET_ID"
```

When `RELAY_TOKEN` (or `--relay-token`) is set, the script sends it as `Authorization: Bearer`, so set it only when `--url` is your relay.

### Try with curl

```bash
curl -sS -X POST "$RELAY_URL" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -d @examples/discovery-webhook-request.v1.json
```

```bash
curl -sS -X POST "$RELAY_URL" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -d @examples/discovery-webhook-request.v1-with-profile.json
```

Without the bearer the relay answers `401`.
