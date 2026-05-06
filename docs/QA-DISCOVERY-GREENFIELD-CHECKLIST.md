# Discovery Greenfield QA Checklist

Use this checklist to verify the new discovery setup wizard as a brand-new
user starting from a clean browser state.

The expected greenfield path is:

1. open the discovery setup wizard from Settings or `Run discovery`,
2. choose the local agent path or a real existing endpoint,
3. let the app autofill whatever it already knows,
4. verify with the shared browser verifier,
5. keep the Apps Script stub labeled `Stub only` unless you replace it with
   real discovery logic.

## Test setup

- Use a clean browser profile or clear site storage for the dashboard origin.
- Use a fresh sheet copy with a valid `Pipeline` tab.
- Use a real Google OAuth web client that is allowed for the dashboard origin.
- Have a Cloudflare account available for the relay path.

## Clean-state reset

Before the test, remove any prior local state for the dashboard origin:

- Clear `localStorage`
- Clear `IndexedDB`
- Clear cookies/session for the site

If you are reusing an existing account, also confirm:

- Cloudflare Access is **off** for the open `workers.dev` Worker URL used by the dashboard.
- The Worker URL you use in Settings is the open `https://<worker>.<subdomain>.workers.dev` URL, not `/forward`.

## Greenfield flow

### 1. Open the wizard

Open discovery setup from one of the normal entry points.

Expected:

- The wizard opens instead of the old modal maze.
- The path selector shows the intent-first choices:
  - real HTTPS endpoint
  - local agent
  - no webhook
  - stub-only smoke test

### 2. Enter Google config

In Settings, add:

- Spreadsheet URL or Sheet ID
- Google OAuth Client ID

Expected:

- Saving a new OAuth client reloads the page so Google sign-in can initialize with that client.
- Discovery status reuse comes from the wizard snapshot, not a separate status model.

### 3. Choose local agent or existing endpoint

If you are testing the local path, continue into the local agent branch.

If you are testing an existing endpoint, paste the real public HTTPS URL.

Expected:

- Local-only URLs are rejected as browser discovery endpoints.
- Worker `/forward` is rejected as a browser discovery endpoint.
- The Apps Script stub is labeled `Stub only`, never `real ready`.

### 4. Verify the local agent path

Run `npm run discovery:bootstrap-local` from the repo root, then open the wizard on localhost.

Expected:

- The wizard autofills:
  - local webhook URL
  - `/health` URL
  - ngrok public URL when available
  - public target URL for the Worker
  - suggested Cloudflare deploy command
- If ngrok auth is missing, the wizard should give the one-time auth guidance.
- If the local gateway is down, the wizard should show a concrete remediation instead of a generic failure.
- If ngrok is already running, the wizard should auto-detect it from the local API and avoid manual paste work when possible.

### 5. Deploy the Worker

Use the relay path to deploy the browser-facing Worker URL.

Expected:

- The dashboard keeps the Worker URL as the saved discovery webhook URL.
- The browser never stores the raw localhost or ngrok URL as the final browser endpoint.
- The worker path stays separate from the real local engine.

### 6. Test the webhook

Click `Test webhook`.

Expected:

- `ok: true` is success.
- Async `202 Accepted` is also success.
- `Stub only` is a recognized success state for wiring, but it still carries a warning that the endpoint is not real discovery-ready.
- Network/CORS, Cloudflare Access, Apps Script private access, and invalid endpoints are classified separately.

### 7. Run discovery

Click `Run discovery`.

Expected:

- `Run discovery` uses the same verifier semantics as `Test webhook`.
- Async `202 Accepted` is treated as success.
- The app does not need a different success model for the browser button than it uses for the test button.

### 8. Final ready state

Expected:

- The wizard summarizes:
  - real engine
  - public tunnel
  - browser URL
- The `Run discovery` affordance is enabled only when the endpoint is actually real-ready or intentionally unverified.

## Regression checks

- Cloudflare relay is not the first step when a real endpoint is already configured.
- Apps Script stub stays marked `Stub only`.
- `Test webhook` and `Run discovery` both accept async `202 Accepted`.
- The browser verifier reports:
  - `stub_only`
  - `access_protected`
  - `apps_script_private`
  - `network_error`
  - `invalid_endpoint`
- The old modal maze is not the primary discovery entry path anymore.

## Auto-heal regression checks (Setup Doctor)

The Setup Doctor (`setup-doctor.js`) collapses common greenfield quagmires into
one-click fixes. Verify each path still works end to end:

- **ngrok rotation (Step 7 / Test the connection):**
  - When the diagnosis card shows "ngrok URL changed — relay needs redeployment",
    the primary action is labelled **"Auto-fix: redeploy relay & re-test"** on
    localhost. Clicking it must not require copying any terminal command.
  - The wizard calls `POST /__proxy/fix-setup` (provided by `dev-server.mjs`),
    waits for the relay redeploy, then automatically re-runs the verifier.
  - When `wrangler` auth is missing the user sees a single targeted toast
    ("Cloudflare auth needed — run `npx wrangler login`…").
  - On a hosted dashboard (non-localhost), the legacy copy-command card is
    still shown so users can recover manually.
- **Login gate / sheet read failure:** when the sheet read fails (403/404,
  insufficient scopes, origin_mismatch), the login gate's error mode renders
  a "Setup health" panel listing the diagnosed issue with a **Fix it for me**
  button. Clicking the button runs the matching auto-fix.
- **Pipeline tab missing or wrong headers:** the doctor detects this and offers
  a one-click repair that adds the `Pipeline` tab with the canonical header row.
- **Resume onboarding / Run setup doctor:** the user menu now exposes both
  entry points so users can re-enter onboarding or trigger a full diagnosis at
  any time.
- **Post-OAuth-save reload:** saving a new OAuth client now re-initialises
  Google Identity Services in place when possible, instead of forcing a full
  page reload. Reload remains the documented fallback if GIS has not yet
  loaded.

## Related docs

- [SETUP.md](../SETUP.md)
- [DISCOVERY-PATHS.md](./DISCOVERY-PATHS.md)
- [DISCOVERY-SETUP-WIZARD-SPEC.md](./DISCOVERY-SETUP-WIZARD-SPEC.md)
- [DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md](./DISCOVERY-SETUP-WIZARD-IMPLEMENTATION-PLAN.md)
- [templates/cloudflare-worker/README.md](../templates/cloudflare-worker/README.md)

## Greenfield automation flows

- [ ] OAuth auto-create happy path: with `gcloud` installed and logged in, trigger OAuth bootstrap and confirm the dashboard receives an OAuth client ID from the user's own Google project.
- [ ] OAuth fallback when `gcloud` is missing: remove `gcloud` from PATH, rerun OAuth bootstrap, and confirm the UI shows a concrete install/login next step instead of blocking silently.
- [ ] Install-doctor all-missing then all-present: run setup health with `gcloud`, `wrangler`, and `ngrok` unavailable, then rerun with all three installed/logged in and confirm the missing list clears.
- [ ] Keep-alive install and uninstall: on macOS, install the launchd keep-alive job with mocked or real `launchctl`, then uninstall twice and confirm the second uninstall is still a clean success.
