# Apps Script dashboard deploy implementation plan

**Status:** Proposed  
**Updated:** 2026-04-08  
**Supersedes:** [planning-handoffs/HANDOFF-APPS-SCRIPT-DASHBOARD-DEPLOY.md](./planning-handoffs/HANDOFF-APPS-SCRIPT-DASHBOARD-DEPLOY.md)

## Decision summary

**Recommendation:** proceed with a **static, browser-only MVP** for **creating and deploying** the existing Apps Script stub from the dashboard, with one explicit gate:

1. **Phase 0 must prove** the current web app origin can call `script.googleapis.com` from the browser with Google Identity Services and an end-user OAuth token.
2. If that gate passes, ship an MVP that:
   - creates a **new standalone script project** in the user’s Google Drive,
   - uploads the repo’s existing [`integrations/apps-script/Code.gs`](../integrations/apps-script/Code.gs) and [`integrations/apps-script/appsscript.json`](../integrations/apps-script/appsscript.json),
   - creates or updates a **Web app deployment**,
   - reads the returned `/exec` URL,
   - persists that URL into dashboard settings, and
   - stores script metadata locally for future re-deploys.
3. If that gate fails, **do not build a maintainer-hosted relay** for this feature as part of the current scope. Keep the existing manual `clasp` / Apps Script editor path and document the blocker.

## Feasibility conclusion

### What is feasible

The deployment flow is feasible **in principle** without introducing a backend:

- Google publishes an official **Apps Script API JavaScript quickstart** for a browser-based web app, which is strong evidence that browser-side calls to the Apps Script API are supported in at least the intended Google-auth setup.
- Google Identity Services supports **incremental authorization** via `include_granted_scopes`, and the existing app already uses GIS in [`app.js`](../app.js).
- The Apps Script API exposes the exact resources the product needs:
  - `projects.create`
  - `projects.updateContent`
  - `projects.versions.create`
  - `projects.deployments.create`
  - `projects.deployments.update`
- Deployment responses include `entryPoints[].webApp.url`, so the dashboard can retrieve the `/exec` URL directly after deploy.

### What is not solved by this feature

This feature does **not** solve the existing **browser -> webhook `/exec` CORS** problem:

- The deploy flow talks to `script.googleapis.com`.
- The Run discovery button and Test webhook still talk to the deployed **web app URL**.
- Those are separate surfaces with separate browser behavior.

Result: users may successfully deploy a script from the dashboard and still hit the same `/exec` browser/CORS limitation already documented in:

- [`integrations/apps-script/README.md`](../integrations/apps-script/README.md)
- [`docs/DISCOVERY-PATHS.md`](./DISCOVERY-PATHS.md)
- [`index.html`](../index.html) setup and Test webhook copy

### MVP feasibility verdict

**Go** for a browser-only MVP **only if** a Phase 0 spike confirms `script.googleapis.com` works from the current browser app with GIS tokens from the existing OAuth client.  
**No-go** if that spike fails.

## Product decisions

### MVP scope

The MVP should support:

- Signed-in user requests extra Apps Script deploy permissions from Settings.
- Dashboard creates **one new standalone Apps Script project** in the user’s Drive.
- Dashboard uploads the repo stub as-is.
- Dashboard creates a Web app deployment with:
  - `executeAs: USER_DEPLOYING`
  - `access: ANYONE_ANONYMOUS`
- Dashboard stores the `/exec` URL into settings automatically.
- Dashboard stores deployment metadata locally so the same browser can **re-deploy** later without creating another project.

### Explicit MVP non-goals

The MVP should **not** support:

- Binding to arbitrary pre-existing script IDs.
- Editing user-managed script projects not created by the dashboard.
- Automating `SHEET_ID` or `ENABLE_TEST_ROW` script properties.
- Eliminating the current `/exec` CORS caveat for Run discovery.
- Introducing maintainer infrastructure.

### Why `ANYONE_ANONYMOUS`

Current product behavior assumes the discovery webhook can be called by:

- a normal browser `fetch`,
- a terminal smoke test,
- GitHub Actions or other server-side callers.

That maps most closely to `ANYONE_ANONYMOUS`. `ANYONE` or `DOMAIN` can be added later as an advanced option, but they are not the safe default for the current BYO webhook contract.

### Why create a new standalone project

`projects.updateContent` replaces the project contents wholesale. Supporting arbitrary existing script IDs in v1 would create a high risk of overwriting user code. The dashboard should only manage projects it created itself.

## Current repo baseline

The plan should be implemented against the current static architecture:

- [`app.js`](../app.js)
  Current GIS sign-in, token persistence, settings save, discovery webhook test, and Run discovery live here.
- [`index.html`](../index.html)
  Settings UI already contains the Discovery webhook URL field, setup guide, and Test webhook affordances.
- [`user-content-store.js`](../user-content-store.js)
  IndexedDB-backed local settings store already persists discovery profile and agent checklist; this is the right place for Apps Script deployment metadata.
- [`integrations/apps-script/Code.gs`](../integrations/apps-script/Code.gs)
  Current source of truth for the webhook stub.
- [`integrations/apps-script/appsscript.json`](../integrations/apps-script/appsscript.json)
  Current manifest with explicit Sheets scope.

## Recommended architecture

### 1. Keep the existing Sheets sign-in flow

Do not broaden the app’s **persisted** primary token by default.

Current behavior in [`app.js`](../app.js) persists a GIS access token to localStorage for Sheets write-back. Expanding that same token to include Apps Script project and deployment scopes would materially increase the blast radius of any XSS or token leak.

### 2. Add a second, ephemeral deploy token flow

Add a dedicated GIS token request helper for Apps Script deployment operations:

- requested scopes:
  - `https://www.googleapis.com/auth/script.projects`
  - `https://www.googleapis.com/auth/script.deployments`
- do **not** persist this token
- request it only from a user gesture in Settings
- use it only for calls to `script.googleapis.com`

Implementation note:

- keep the existing persisted Sheets token for Sheets reads/writes,
- create a separate one-shot GIS token client for deploy actions,
- avoid sharing the deploy token with generic app state.

### 3. Use raw `fetch`, not `gapi`, for MVP

The repo already uses direct `fetch` against Google APIs and does not load `gapi`. Adding the Google API JS client would add another external dependency and likely require an API key path the current app does not need.

For MVP, use:

- `fetch("https://script.googleapis.com/v1/...")`
- `Authorization: Bearer <deploy token>`
- small helper functions for Google API error parsing

If the Phase 0 spike shows `fetch` is problematic but the official quickstart path works, revisit `gapi` as a fallback only then.

### 4. Load stub assets from the deployed site itself

Do not duplicate the Apps Script stub contents into JS constants.

At deploy time, the dashboard should fetch:

- `integrations/apps-script/Code.gs`
- `integrations/apps-script/appsscript.json`

as same-origin static assets, then upload them to Apps Script via `projects.updateContent`.

Implementation details:

- use `cache: "no-store"` for these fetches,
- compute a `stubHash` from the fetched contents using `crypto.subtle.digest`,
- store the hash in local metadata so re-deploy can tell whether content changed.

### 5. Persist deployment state in IndexedDB

Add an `appsScriptDeployState` record to [`user-content-store.js`](../user-content-store.js), not to `config.js` and not only to localStorage.

Suggested shape:

```json
{
  "managedBy": "command-center",
  "origin": "https://your-dashboard-origin",
  "ownerEmail": "user@example.com",
  "scriptId": "SCRIPT_ID",
  "deploymentId": "DEPLOYMENT_ID",
  "webAppUrl": "https://script.google.com/macros/s/.../exec",
  "executeAs": "USER_DEPLOYING",
  "access": "ANYONE_ANONYMOUS",
  "projectTitle": "Command Center discovery webhook",
  "lastVersionNumber": 3,
  "stubHash": "sha256-...",
  "lastDeployedAt": "2026-04-08T12:34:56.000Z"
}
```

Use this state for:

- re-deploying the same managed project,
- showing “Open script” / “Re-deploy” UI,
- detecting cross-account mismatch,
- avoiding duplicate project creation.

### 6. Auto-save the webhook URL without forcing a full page reload

The deploy flow should behave like an end-to-end setup action, not like a half-step that asks the user to manually save afterward.

After a successful deploy:

- set the `Discovery webhook URL` field value in the open Settings modal,
- persist `discoveryWebhookUrl` to the same local config override store used by settings,
- update `window.COMMAND_CENTER_CONFIG.discoveryWebhookUrl` in memory,
- keep the modal open,
- surface `Test webhook` and `Run discovery` as the next step.

Do **not** route this through the current “save and reload” settings path for the MVP success case.

## API sequence

### Required OAuth scopes

- Existing app:
  - `https://www.googleapis.com/auth/spreadsheets`
  - `https://www.googleapis.com/auth/userinfo.email`
- New deploy-only scopes:
  - `https://www.googleapis.com/auth/script.projects`
  - `https://www.googleapis.com/auth/script.deployments`

### Deploy sequence

1. Fetch [`integrations/apps-script/Code.gs`](../integrations/apps-script/Code.gs) and [`integrations/apps-script/appsscript.json`](../integrations/apps-script/appsscript.json) from the current site.
2. Request an ephemeral Apps Script deploy token with the two new scopes.
3. If no local `scriptId` exists:
   - call `POST /v1/projects`
   - body: `{ "title": "Command Center discovery webhook" }`
4. Call `PUT /v1/projects/{scriptId}/content` with the full file set.
5. Call `POST /v1/projects/{scriptId}/versions`.
6. If no local `deploymentId` exists:
   - call `POST /v1/projects/{scriptId}/deployments`
7. Else:
   - call `PUT /v1/projects/{scriptId}/deployments/{deploymentId}`
8. Read the returned `Deployment` object.
9. Find the `WEB_APP` entry point and extract `webApp.url`.
10. Persist:
    - local deploy metadata in IndexedDB,
    - `discoveryWebhookUrl` in the existing local settings override.
11. Offer:
    - `Copy URL`
    - `Open script`
    - `Test webhook`

### Notes on the Apps Script API contract

- `projects.updateContent` overwrites the project contents. Use it only for dashboard-managed projects.
- `projects.deployments.create` needs a version number, so `projects.versions.create` is part of the required path.
- Deployment update is the right re-deploy path once a deployment exists.

## UX plan

### Entry point

Add a new action beside the existing Discovery webhook controls in [`index.html`](../index.html):

- primary button:
  - `Deploy Google Apps Script stub`
- secondary actions after first success:
  - `Re-deploy`
  - `Open script`
  - `Copy URL`

### Button gating

Disable deploy until:

- OAuth client ID is present,
- Sheet ID is present,
- GIS has loaded.

If the user is signed out, clicking the button should:

- open the existing Google sign-in flow first for Sheets,
- then continue into the Apps Script consent prompt.

### Consent copy

Show a short pre-consent explainer before the extra scope prompt:

> Deploy a Google Apps Script webhook in your Google account. This creates a new script project in your Drive, uploads the repo’s existing stub, deploys it as a web app, and saves the `/exec` URL here. No maintainer server hosts or owns your webhook.

### Progress states

Use a visible progress block inside Settings:

1. Requesting permission
2. Creating script project
3. Uploading stub files
4. Creating version
5. Deploying web app
6. Saving webhook URL

### Success state

After success, show:

- the `/exec` URL,
- a note that **Run discovery may still hit browser/CORS limits**,
- `Test webhook`,
- `Open setup guide`,
- `Open script`.

### Failure states

Handle these explicitly:

- popup blocked
- consent denied
- Apps Script API not enabled on the OAuth project
- OAuth client misconfigured for the current origin
- deployment response missing a `WEB_APP` entry point
- user changed accounts between sign-in and deploy
- local metadata points to a script owned by a different account
- browser API call blocked

## Script properties strategy

### MVP

Do not automate script properties.

Reason:

- the current stub only **optionally** uses `SHEET_ID` and `ENABLE_TEST_ROW`,
- there is no simple project-properties REST surface in the Apps Script project management API,
- the `scripts.run` route would require an **API Executable deployment** and has extra same-Cloud-project constraints,
- this adds complexity that is not necessary for getting a working `/exec` URL into settings.

### MVP UX for properties

After deploy, show a small advanced note:

- “Optional: if you want `[CC test]` rows from the stub, set `SHEET_ID` and `ENABLE_TEST_ROW` in Apps Script project settings.”

Provide:

- `Open script`
- link to [`integrations/apps-script/WALKTHROUGH.md`](../integrations/apps-script/WALKTHROUGH.md)

### Post-MVP option

Only if there is strong user demand, evaluate one of:

1. a dedicated bootstrap function invoked through `scripts.run` plus an API Executable deployment, or
2. removing reliance on script properties from the stub entirely.

This is not required for the deploy MVP.

## Security and privacy

### Least privilege

- Request Apps Script deploy scopes only from the deploy action.
- Keep the deploy token ephemeral and in-memory only.
- Keep the existing Sheets auth flow separate.

### Token handling

- Never log raw tokens.
- Never persist the deploy token.
- Reuse the existing sign-out path for primary auth; do not invent a second long-lived auth cache.

### Managed project boundary

To avoid overwriting user code:

- only re-deploy projects with local `managedBy: "command-center"` metadata,
- do not add “attach existing script ID” in MVP,
- if metadata is missing or the API returns ownership/permission errors, create a fresh project instead of guessing.

### Webhook exposure

`ANYONE_ANONYMOUS` is the right product fit for the current contract, but it means the URL is effectively a capability URL. The UI and docs should say that plainly.

## Phased roadmap

### Phase 0: feasibility gate

Goal: prove the browser app can create and deploy a script via `script.googleapis.com` using GIS.

Tasks:

- Enable Apps Script API on the Google Cloud project backing the current OAuth client.
- Add the new scopes to the OAuth consent configuration for test users.
- Run a local manual spike from the dashboard origin:
  - request deploy scopes,
  - call `projects.create`,
  - call `projects.updateContent`,
  - call `projects.versions.create`,
  - call `projects.deployments.create`.

Exit criteria:

- browser call path works end to end,
- returned deployment includes `WEB_APP` with `url`,
- no unexpected CORS failure on `script.googleapis.com`.

If this fails:

- stop the feature,
- keep the existing manual Apps Script path,
- document the blocker in the handoff and docs.

### Phase 1: auth and persistence foundation

Files:

- [`app.js`](../app.js)
- [`user-content-store.js`](../user-content-store.js)

Tasks:

- Add deploy-token request helper.
- Add granted-scope detection helpers.
- Add IndexedDB methods for `appsScriptDeployState`.
- Add helpers for updating the webhook URL in local settings without reload.

Exit criteria:

- no regression to Sheets sign-in,
- deploy token exists only in-memory,
- local deploy state can be stored and read back.

### Phase 2: deployment MVP UI

Files:

- [`index.html`](../index.html)
- [`style.css`](../style.css)
- [`app.js`](../app.js)

Tasks:

- Add deploy button, status area, and success/failure states to Settings.
- Fetch stub assets from the site.
- Implement create -> updateContent -> version -> deploy flow.
- Auto-save URL and local metadata on success.
- Add `Open script`, `Copy URL`, and `Test webhook` next steps.

Exit criteria:

- new user can go from signed-in to saved `/exec` URL without using `clasp` or script.google.com,
- same browser session can immediately use Test webhook.

### Phase 3: re-deploy and polish

Files:

- [`app.js`](../app.js)
- [`user-content-store.js`](../user-content-store.js)
- docs

Tasks:

- Implement re-deploy using stored `scriptId` and `deploymentId`.
- Add `stubHash` comparison to skip no-op uploads or at least message “already current”.
- Add better recovery when local state is stale or account has changed.
- Update setup docs to present manual `clasp` as fallback, not the only path.

Exit criteria:

- dashboard-managed scripts can be updated without creating duplicates,
- stale-state errors are recoverable from the UI.

### Phase 4: optional follow-ups

Only if justified by user demand:

- access-mode selector (`ANYONE_ANONYMOUS` vs `ANYONE` / `DOMAIN`)
- script properties automation
- expert-only “use existing script ID”
- rollback or deployment history affordances

## File-by-file implementation map

### [`app.js`](../app.js)

- add deploy-token helper
- add Apps Script API client helpers
- add stub asset loading and hashing
- add deploy/re-deploy orchestration
- add non-reload settings update helper
- add UI state management for Settings deploy section

### [`user-content-store.js`](../user-content-store.js)

- add `getAppsScriptDeployState`
- add `saveAppsScriptDeployState`
- add `clearAppsScriptDeployState`
- export those on `window.CommandCenterUserContent`

### [`index.html`](../index.html)

- add deploy action block near `Discovery webhook URL`
- add progress/status region
- add success actions (`Open script`, `Copy URL`, `Re-deploy`)
- add concise consent/preflight copy

### [`style.css`](../style.css)

- add states for progress, success, warning, and inline error UI in Settings

### Docs

- keep [`integrations/apps-script/README.md`](../integrations/apps-script/README.md) and [`integrations/apps-script/AGENT-BOOTSTRAP.md`](../integrations/apps-script/AGENT-BOOTSTRAP.md) as the manual fallback
- update [`docs/README.md`](./README.md) to point to this plan
- later update user-facing setup docs after implementation ships

## Risks and fallback decisions

### Risk: browser access to `script.googleapis.com` fails in the real app

Decision:

- treat as a **hard blocker** for the static-only deploy feature,
- do not build maintainer infrastructure as a reaction,
- retain manual `clasp` / Apps Script editor setup.

### Risk: OAuth client verification burden increases

Decision:

- keep scope request narrow,
- ship to test users first,
- evaluate verification only after the deploy flow is validated and worth shipping broadly.

### Risk: `/exec` still fails from browser

Decision:

- keep existing copy and fallback paths,
- do not claim the deploy feature fixes Run discovery CORS,
- direct users to GitHub Actions or a Worker relay where appropriate.

### Risk: overwriting customized script projects

Decision:

- only manage dashboard-created projects in MVP,
- no existing-script attachment flow in v1.

## Acceptance criteria

The feature is ready when all of the following are true:

- A signed-in user can deploy the existing Apps Script stub from Settings without `clasp`.
- The dashboard saves the resulting `/exec` URL into settings automatically.
- The same user can re-deploy the same managed project later.
- The UI clearly warns that browser -> `/exec` may still hit CORS limits.
- No new long-lived Apps Script deploy token is stored in localStorage or IndexedDB.
- Manual `clasp` docs remain available as a fallback.

## Sources

- Google Apps Script API JavaScript quickstart: <https://developers.google.com/apps-script/api/quickstart/js>
- Apps Script API overview: <https://developers.google.com/apps-script/api/concepts/>
- `projects.create`: <https://developers.google.com/apps-script/api/reference/rest/v1/projects/create>
- `projects.updateContent`: <https://developers.google.com/apps-script/api/reference/rest/v1/projects/updateContent>
- `projects.versions.create`: <https://developers.google.com/apps-script/api/reference/rest/v1/projects.versions/create>
- `projects.deployments.create`: <https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments/create>
- `projects.deployments.update`: <https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments/update>
- `projects.deployments` resource (`WEB_APP`, access, execute-as, URL): <https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments>
- Apps Script authorization scopes: <https://developers.google.com/apps-script/concepts/scopes>
- Google Account Authorization JS reference (`include_granted_scopes`, token client): <https://developers.google.com/identity/oauth2/web/reference/js-reference>
