# n8n — Run discovery webhook

[n8n](https://n8n.io/) can POST to your own URL or to a **Command Center** discovery endpoint with **no CORS** issues when the workflow runs on your n8n instance (server-side).

## Minimal flow

1. **Webhook** (POST) or **Schedule** trigger.
2. **HTTP Request** node:
   - **Method:** POST
   - **URL:** Your Apps Script `/exec` URL or any HTTPS receiver.
   - **Body:** JSON — same shape as [AGENT_CONTRACT.md](../../AGENT_CONTRACT.md):

```json
{
  "event": "command-center.discovery",
  "schemaVersion": 1,
  "sheetId": "YOUR_SHEET_ID",
  "variationKey": "{{ $json.variationKey }}",
  "requestedAt": "{{ $now.toISO() }}",
  "discoveryProfile": {}
}
```

3. Map **`variationKey`** from **Function** or **Crypto** node (random hex) so each run differs.

## Export

We do not ship a binary `.json` workflow export here (n8n versions differ). Build the three nodes above in the UI, then **Export workflow** for your backup.

## Self-hosted

n8n **Cloud** or **self-hosted** is **your** infrastructure — consistent with [AUTOMATION_PLAN.md](../../AUTOMATION_PLAN.md) (BYO, no maintainer hosting).
