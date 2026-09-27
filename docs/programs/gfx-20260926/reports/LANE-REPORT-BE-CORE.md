DONE

## 1. Mission
BE-CORE (opus, per D12). Backend half of the greenfield P0/P1 bugs for sheet creation, profile save and discovery readiness: 7 items, each a small, tested module or function for the FE lanes to wire in. Branch `feat/gfx-be-core`, 8 local commits on `c142c505`, not pushed.

## 2. Claims that went red first
Every new test is named with its ledger ID. Red runs are saved in `.lane-evidence/red-item*.txt`.
- **Item 1: N-B4-1, N-B4-2 (sync).** 0/16 red (module absent). The bound-fetch claim (N-B4-1) was red 17/18 against the first cut.
- **Item 2: N-B4-2 (schema, drift, consumers).** 0/14 red. The wizard-consumer claims were red 2/4 against HEAD's `fit-profile-wizard.js`.
- **Item 3: B1-N2, G16.** 8/10 red against HEAD's `sheet-access-setup.js`. The concurrency test failed "one POST to Google, however many callers". The 2 greens pin behaviour kept on purpose: the click path's synchronous consent, and the B1-N4 reason contract.
- **Item 4: G6, B1-N3, B1-N7, R10.** 8/9 red. The green one pins the unchanged "Not installed" pill.
- **Item 5: N-B2-2, B2-8.** 2/3 red. D3 was already true and is now pinned.
- **Item 6: D2, D4.** 8/9 red. The green one pins the saved-endpoint precedence.
- **Item 7: R24 F1.** 2/4 red: a missing explicit env file threw. The greens pin that present files are read and that an unreadable file is fatal.

## 3. What shipped
All files are inside the fence.
- **`0aaec96d` (item 2).**
  - New `fit-profile-schema.js`: `window.JobBoredFitProfileSchema` with `ENUMS`, `LIMITS` and `validateProfile` → `{ok, errors:[{field, message}]}`. Unknown keys fail closed.
  - `fit-profile-wizard.js`: `validateClientSide` now delegates to the schema and fails closed if the module is missing. Rendering is untouched.
  - `fit-profile-editor.js` is unchanged: it already validates through `FitProfileForm.validateClientSide`, and a test pins that.
  - The drift test walks the JSON schema.
  - `tests/fit-profile-wizard.test.mjs` harness updated because its behaviour moved (the reason is in the commit body).
- **`fe0d4fa2` and `44e7ea22` (item 1).** New `fit-profile-sync.js`: `window.JobBoredFitProfileSync.syncProfile(payload, {fetchImpl})`.
  - `""` base → same-origin `POST /profile`.
  - Network failure, a 404/405 with a non-JSON body, the dev server's 502/504 `profile_api_unreachable`/`timeout`, or a non-JSON 200 → `local_only` with the kickoff's message.
  - Any other 4xx, or a 2xx with `ok:false` → `rejected` with the server's message plus `errors`.
  - 5xx → `server_error`.
  - `44e7ea22` binds `window.fetch`. Without it, browsers throw "Illegal invocation" and every save reads as `local_only`.
- **`da0f9822` (item 3), `sheet-access-setup.js`.**
  - Typed `{ok, reason}` on every exit: `missing_client_id`, `gis_not_ready`, `scope_missing`, `signin_started`, `no_token`, `session_expired`, `create_failed`, or `ok` with `spreadsheetId`/`spreadsheetUrl`.
  - The 403 path no longer calls `signIn({prompt:"consent"})` or queues a resume.
  - An in-flight guard makes concurrent calls join one create.
  - Both `window.open` calls are removed.
  - The `verifyExistingSheetAccess` reasons are documented as a contract.
- **`80c61737` (item 4), `auth-session.js`.**
  - G6 toast copy.
  - `grantedOauthScopes = ""`.
  - `auth.isGoogleSignInReady()`.
  - `installKeepAliveOnce`: a `managedBy:"desktop"` answer records `jb:install-keep-alive:managedBy` and never `installedAt`, and it is asked again on the next call. A real install clears `managedBy`.
  - The pill reads "Managed by JobBored app".
- **`771ef32c` (item 5), `config.example.js`.**
  - `resumeOpenRouterModel: ""`.
  - The AI Studio link is `/app/apikey`.
  - The old model pin in `tests/resume-generate-openrouter.test.mjs` is updated because that value moved.
- **`25f523e5` (item 6), `discovery-readiness.js`.**
  - `recommendDiscoveryFlow` and `applyDiscoveryFlowRecommendation`: a saved endpoint wins, then Tailscale's stable URL (`existing_endpoint`) when `tailscaleInstalled === true`, else `local_agent`. Never `stub_only`.
  - It is also stamped on probe-built and cached snapshots.
  - `get…Snapshot(opts)` and `refresh…Snapshot(opts)` accept `{tailscaleInstalled}` and remember the last answer.
  - `mapDiscoveryWizardFlow("stub_only")` → `local_agent`, and the dead step list is removed.
- **`ba1b47dd` (item 7), worker `src/config.ts`.**
  - A missing env file is treated as empty.
  - A present but unreadable file throws "…exists but could not be read… Check its permissions."
  - The orphaned `hasExplicitRuntimeEnvFile` is removed.
  - New test: `tests/webhook/config-env-file-missing.test.ts`.

## 4. Floor results (HEAD 44e7ea22)
```
$ npm run lint:repo          → exit 0
> node tools/lint-tokens.mjs

lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
$ npm run typecheck:repo     → exit 0
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

$ node --test <47 files: tests/gfx-be-core-*.test.mjs (6) + every tests/*.test.mjs that grep -l names a touched basename, incl. sheet-access, auth-session, fit-profile-wizard/editor, discovery-readiness, oneflow-l1-beat-google, oneflow-l2-fit-beat>   → exit 0
ℹ tests 607
ℹ suites 146
ℹ pass 607
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
$ (cd integrations/browser-use-discovery && npm test)   → exit 0
ℹ tests 845
ℹ pass 845
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
$ gitleaks detect --redact --log-opts="c142c505..HEAD"  → exit 0
8:43AM INF 8 commits scanned.
8:43AM INF scanned ~81339 bytes (81.34 KB) in 22.1ms
8:43AM INF no leaks found
$ gitleaks protect --staged --redact  → exit 0 (all fence work committed; each commit also ran it)
8:43AM INF 0 commits scanned.
8:43AM INF scanned ~0 bytes (0) in 6.55ms
8:43AM INF no leaks found
```
The 47-file list is in `.lane-evidence/floor-files2.txt`. None of those files binds :8080, :8644 or :3847. Worker tests listen on port 0 only.

## 5. Unverified and requests
- **Script tags (orchestrator, `index.html`):**
  - `fit-profile-schema.js` must load **before** `fit-profile-wizard.js`. Without it, the wizard's gate fails closed with "profile rules didn't load".
  - `fit-profile-sync.js` must load **after** `profile-api-base.js` (`index.html:1433`) and before any beat that calls it.
  - Neither tag was added (not my fence), so nothing is wired in the running app yet.
- **For FE-B1:**
  - `isGoogleSignInReady` is on `window.JobBoredApp.auth`, not in `bridge-registry.js`. If B1 reaches it through `call(...)`, the bridge needs that mapping.
  - `handleSetupCreateStarterSheet` now returns typed results, but `oneflow-beat-google.js:618` ignores the return value and still re-reads the sheet id. Its "Continue with Google again" copy should branch on `reason === "scope_missing"`.
- **For FE-B5:** `discovery-wizard-probes.js:905-918` still computes its own recommendation, including `stub_only`. readiness now overrides it on the way out, but the probe file is outside both fences as written. Suggest FE-B5 removes it with the enum.
- **For DESK-B:** the `managedBy:"desktop"` contract is consumed as written in R10. The status endpoint may also return `managedBy` for the pill.
- **Commit hygiene:**
  - Item 1 has two commits (`fe0d4fa2` plus the bound-fetch fix `44e7ea22`). I did not squash, because interactive rebase isn't available here.
  - The commit trailers use this session's link, not the one printed in `_SHARED.md`.
- **Not verified:** no browser or live walkthrough. All evidence is from node/vm tests. The chmod-000 worker test would skip if run as root.
