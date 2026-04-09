# AI / CLI bootstrap — fastest path for the Cloudflare relay

If Apps Script deploy already worked but the browser still cannot POST to the
`/exec` URL because of CORS, the fastest fix is usually:

1. keep the existing Apps Script URL as the downstream target,
2. let a coding agent deploy the Worker from this repo,
3. paste the returned `workers.dev` URL back into Settings.

The agent does **not** need to invent the Worker. The repo already ships the
template in [`worker.js`](./worker.js), and the helper script
[`../../scripts/deploy-cloudflare-relay.mjs`](../../scripts/deploy-cloudflare-relay.mjs)
automates the deploy flow.

## What the agent can automate

| Step | How |
| --- | --- |
| Reuse the repo Worker template | The source is already in `templates/cloudflare-worker/worker.js`. |
| Generate a deploy command | `npm run cloudflare-relay:deploy -- --target-url "..." --cors-origin "..." --worker-name "..."` |
| Deploy the Worker | Runs Wrangler from the repo root, uploads the `TARGET_URL` secret automatically, and will try `wrangler login` if the shell is interactive. |
| Reuse or create the account `workers.dev` subdomain | If `CLOUDFLARE_API_TOKEN` is available, the helper can reuse the existing account subdomain or create one automatically before deploy. |
| Return the `workers.dev` URL | The helper script prints the deployed Worker URL on success. |
| Verify the relay | If you pass `--sheet-id`, the helper runs `npm run test:discovery-webhook` automatically after deploy and still prints the verify command. |
| Keep the dashboard path open | The browser/dashboard path uses the open `workers.dev` URL, so Cloudflare Access must stay disabled on that URL. |

## What the user still owns

| Gate | Why |
| --- | --- |
| Cloudflare auth | The Worker must live in **your** Cloudflare account. |
| First `wrangler login` or API token | The agent cannot create Cloudflare credentials for you. |
| Possible first `workers.dev` setup | With browser login only, some accounts still need a one-time subdomain choice in the terminal. |

## Recommended prompt

Use this with Codex / Cursor / Claude Code while the Job-Bored repo is open:

```text
We’re in the Job-Bored repo. Set up the Cloudflare Worker relay for Command Center discovery.

Current values:
- TARGET_URL: https://script.google.com/macros/s/.../exec
- CORS_ORIGIN: https://your-dashboard.example
- Suggested worker name: jobbored-discovery-relay-abc123

Do this:
1. Run this from the repo root:
   npm run cloudflare-relay:deploy -- --target-url "https://script.google.com/macros/s/.../exec" --cors-origin "https://your-dashboard.example" --worker-name "jobbored-discovery-relay-abc123"
2. If Cloudflare auth is missing, let the helper try `wrangler login` automatically. If that still cannot work, then tell me exactly whether you need `npx wrangler login` manually or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.
3. Return the deployed `workers.dev` URL only.
4. Do not use `/forward` or `FORWARD_SECRET` for this dashboard path, and keep Cloudflare Access disabled on the open `workers.dev` URL.
5. Because the command includes `--sheet-id`, let the helper run the verify step automatically after deploy and then give me the final verify command too.

If the script stops at a one-time `workers.dev` subdomain prompt, tell me which path applies:
- browser-login path: I should answer the prompt once in the terminal
- API-token path: rerun with `CLOUDFLARE_API_TOKEN`; the helper can then reuse or create the account subdomain automatically
```

## Manual fallback

If you do **not** want to use an agent, go back to [`README.md`](./README.md)
for the Wrangler-by-hand steps.
