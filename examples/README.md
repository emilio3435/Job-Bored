# Discovery webhook examples

**New to discovery?** Read **[docs/DISCOVERY-PATHS.md](../docs/DISCOVERY-PATHS.md)** (webhook optional; alternatives). **Apps Script:** **[integrations/apps-script/WALKTHROUGH.md](../integrations/apps-script/WALKTHROUGH.md)**.

These JSON files are **sample POST bodies** for **Run discovery**: when a user clicks that action and a discovery webhook URL is set, the dashboard POSTs JSON like this to your endpoint. See the full contract in [../AGENT_CONTRACT.md](../AGENT_CONTRACT.md) (interface **B — Discovery webhook**).

| File                                             | Purpose                                             |
| ------------------------------------------------ | --------------------------------------------------- |
| `discovery-webhook-request.v1.json`              | Minimal body; empty `discoveryProfile`.             |
| `discovery-webhook-request.v1-with-profile.json` | Same shape with example `discoveryProfile` strings. |

**Schema:** [../schemas/discovery-webhook-request.v1.schema.json](../schemas/discovery-webhook-request.v1.schema.json)

## Automated check (repo script)

From the **repository root**, after you have an HTTPS webhook URL (e.g. Apps Script `/exec`):

```bash
npm run test:discovery-webhook -- --url "YOUR_URL" --sheet-id "YOUR_SHEET_ID"
```

This POSTs `examples/discovery-webhook-request.v1.json` (with your `sheetId` and a fresh `variationKey`) and exits **0** only if the response JSON has `"ok": true`. See `scripts/verify-discovery-webhook.mjs`.

## Try with curl

Replace `YOUR_URL` with a [webhook.site](https://webhook.site) unique URL or your local receiver.

```bash
curl -sS -X POST "$YOUR_URL" \
  -H 'Content-Type: application/json' \
  -d @examples/discovery-webhook-request.v1.json
```

```bash
curl -sS -X POST "$YOUR_URL" \
  -H 'Content-Type: application/json' \
  -d @examples/discovery-webhook-request.v1-with-profile.json
```

**Local echo (Node one-liner):** in another terminal, listen and print the body:

```bash
node -e "require('http').createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(b);r.writeHead(200);r.end('ok')})}).listen(8765)"
```

Then: `YOUR_URL=http://127.0.0.1:8765` and run the `curl` lines above from the repo root (paths stay `examples/...`).
