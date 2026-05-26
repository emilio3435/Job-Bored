# GitHub Pages deployment

JobBored is static: GitHub Pages can serve `index.html`, browser scripts, schemas, and docs directly. The optional scraper and discovery worker are not hosted by Pages; they must run locally behind a public relay or on a host you control.

## Supported modes

| Mode | What works | What you configure |
| --- | --- | --- |
| Static dashboard only | Read Pipeline rows, sign in, write back to Sheets, use localStorage Settings | Sheet ID, OAuth Client ID, OAuth origin |
| Static dashboard + scheduled automation | Dashboard plus jobs written by GitHub Actions, Apps Script, n8n, or another server-side job | Same as above, plus scheduled writer secrets |
| Static dashboard + Run discovery | Browser POSTs to an HTTPS discovery endpoint or Cloudflare relay | Discovery webhook URL, CORS, optional shared secret |
| Static dashboard + Fetch posting | Browser calls a hosted HTTPS scraper | Deployed scraper URL and scraper CORS allowlist |

GitHub Pages cannot call `http://127.0.0.1` on your laptop from an HTTPS page. Use the dashboard locally for localhost-only services, or put a public HTTPS relay/host in front of them.

## Config options

`config.js` is loaded at runtime. Use one of these patterns:

1. **Settings/localStorage:** deploy without a real `config.js`, then enter Sheet ID, OAuth Client ID, webhook URLs, and provider keys in Settings. Values stay in that browser's localStorage/IndexedDB.
2. **Private fork:** commit a real `config.js` only if the repository is private.
3. **GitHub Actions-generated config:** keep `config.js` out of git, store values in GitHub secrets, and generate it during Pages deploy.

Example generated config step:

```yaml
- name: Generate config.js
  run: |
    cat > config.js <<'EOF'
    window.COMMAND_CENTER_CONFIG = {
      sheetId: "${{ secrets.COMMAND_CENTER_SHEET_ID }}",
      oauthClientId: "${{ secrets.COMMAND_CENTER_OAUTH_CLIENT_ID }}",
      discoveryWebhookUrl: "${{ secrets.COMMAND_CENTER_DISCOVERY_WEBHOOK_URL }}",
      discoveryWebhookSecret: "${{ secrets.COMMAND_CENTER_DISCOVERY_WEBHOOK_SECRET }}"
    };
    EOF
```

Do not commit real API keys, OAuth client IDs for private apps, webhook secrets, or provider keys to a public repo.

## OAuth origins

Add the exact Pages origin to your Google OAuth web client:

- User site: `https://yourname.github.io`
- Project Pages URL: still use origin `https://yourname.github.io`, not the `/repo-name` path
- Custom domain: `https://jobs.example.com`

For local development also add `http://localhost:8080` and any HTTPS local origin you use.

## Discovery and relay CORS

Browser **Run discovery** requires the receiver to allow the Pages origin with CORS and answer preflight `OPTIONS`. If your target cannot do that, put `templates/cloudflare-worker/` in front of it and set `CORS_ORIGIN` to your Pages origin.

Async status polling uses the `statusPath` returned by the discovery response. Preserve that path exactly through browser state and relays, including query parameters. Hosted Browser Use workers put a per-run `statusToken` in `statusPath` so `GET /runs/:runId` can be read by the browser without exposing the full webhook secret.

Local worker path:

1. Run `npm run discovery:worker:start-local`.
2. Expose it with ngrok.
3. Deploy the Cloudflare relay to the ngrok URL.
4. Paste the Worker URL into Settings as the Discovery webhook URL.
5. Run `npm run discovery:keep-alive` if you use a rotating ngrok URL.

Hosted worker path:

1. Deploy the Browser Use discovery worker to your own host.
2. Set its allowed origins to your Pages origin.
3. Store secrets in that host, not in public git.
4. Paste the hosted HTTPS webhook URL into Settings.

## Scraper expectations

`server/` is optional. Pages can use **Fetch posting** only when `jobPostingScrapeUrl` points at an HTTPS scraper host. Hosted scraper CORS fails closed: set `COMMAND_CENTER_ALLOWED_ORIGINS=https://yourname.github.io` on the scraper service.

For local-only Fetch posting, run `npm start` and open `http://localhost:8080` instead of the Pages URL.
