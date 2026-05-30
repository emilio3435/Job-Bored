# Debugging

Common breakages and what to check.

## "Dashboard shows no jobs"

1. **Sheet ID + OAuth**: open Settings, confirm Sheet ID and OAuth Client ID. Re-sign in.
2. **Sheet share state**: gviz reads need the sheet to be published or shared "anyone with the link". Otherwise the dashboard falls back to the Sheets API, which requires sign-in.
3. **Schema drift**: if the `Pipeline` headers don't match `schemas/pipeline-row.v1.json`, parsing silently drops rows. Run `npm run test:pipeline-contract`.

## "Run discovery does nothing"

1. **Webhook URL**: Settings → Discovery → Connection. Must be HTTPS for hosted, or `http://127.0.0.1:8644/discovery` for local.
2. **Secret**: if the worker requires one, the dashboard must send `Authorization: Bearer <secret>`.
3. **CORS**: hit the worker `/health` from `curl` and the browser. If `curl` works but the browser doesn't, you need the Cloudflare relay or a CORS-friendly receiver (Apps Script via GitHub Actions, etc.).
4. **Run status polling**: open the network tab. If you see a `202` ack but no follow-up `GET /runs/<runId>`, the dashboard parser didn't recognize `statusPath`. Inspect the body for `status_path` vs `statusPath`.

## "Dashboard hangs on load"

The script load chain in `index.html` is order-dependent. If you added a module that references `window.JobBoredUserContent` before `user-content-store.js`, the page wedges silently. Check the browser console for `Uncaught ReferenceError` early in the boot sequence.

## "OAuth pops up every refresh"

Check `command_center_force_consent_prompt` in localStorage. If it's set, OAuth always prompts for consent. Clear it.

`GIS_INIT_STUCK_MS = 8000` (`app.js:860`) is the timeout for GIS init. If GIS fails to initialize within 8s, the dashboard surfaces a sticky banner.

## "Discovery worker drops the run"

Check `run-status-store` on disk under `~/.jobbored/browser-use-discovery/state/`. If the run never reached the store, the failure is in the handler chain (method / secret / parse / strip / validate). The validator's `validationError` is the first place to look.

Tail the worker log:

```sh
tail -f ~/.jobbored/browser-use-discovery/state/worker.log
```

`logEvent` records every phase. Errors include the `runId` and phase name.

## "Scraper server returns 403 to my fetch"

`server/security-boundaries.mjs` rejects origins not in the allow-list. Set `COMMAND_CENTER_ALLOWED_ORIGINS=https://your-deployed-dashboard.example` and restart.

For local dev, the default allow-list includes `http://localhost:8080` and `http://127.0.0.1:8080`.

## "Materials request never produces files"

1. `npm run doctor:hermes` — confirms Hermes venv exists and Python deps installed.
2. Look under `~/.hermes/job-hunt/applications/<slug>/` — is there a `pending.json`? If not, the dashboard didn't reach the server. If yes but no draft files, Hermes ran but `materials-from-pending.py` failed.
3. Check `~/.hermes/job-hunt/applications/<slug>/log.txt` for the Python traceback.

## "BYO LLM returns garbage"

ATS scorecard responses are ajv-validated. If validation fails, `ats-scorecard-retry.js` retries once with the validation error injected. Two consecutive failures mean either the model is genuinely incapable or the schema-as-response-format wasn't honored. Check the network tab.

## Useful one-liners

```sh
# Reset all discovery worker state
rm -rf ~/.jobbored/browser-use-discovery/state/

# Reset only the listing-score cache
sqlite3 ~/.jobbored/browser-use-discovery/state/memory.db "DELETE FROM listing_history;"

# Inspect last 10 runs
sqlite3 ~/.jobbored/browser-use-discovery/state/memory.db \
  "SELECT run_id, status, started_at FROM runs ORDER BY started_at DESC LIMIT 10;"

# Verify webhook reachability
curl -sS https://<your-worker>/health
```

## Related

- [Workflow](workflow.md)
- [Patterns and conventions](patterns-and-conventions.md)
