# Lane BE-CORE: profile sync, schema, Google sheet-create hardening, readiness, and worker env

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `SPEC.md` §0 and the ledger rows named below
- `PLAN.md` Phase 2 and **§R**, which overrides the rows: R7–R10, R13, R16, R18, R24
- `reports/V2-beat4-inventory.md`, for the profile contract
- `reports/VERDICT-grok-plan-check.md` items 7–10

**Routing (D12):** planned for sol; runs on **opus**. Write it as a backend engineer would: hardened, edge-case tested, failing closed.

**Live alongside you:** BE-FUEL (`local-server.js`, the `dev-server.mjs` ping, `start.sh`, `package.json`, eslint, `oneflow-beat-discovery.js`, `onboarding-flow.js` `BEAT_PREREQS`). Its fence does not overlap yours. Don't touch its files.

**Goal:** close the backend half of the P0 and P1 bugs behind a greenfield user's sheet creation, profile save and discovery readiness. Each one gets a small, well-tested module or function that the FE lanes then wire in.

**Success means (every item is red first, and its test is named with its ledger ID):**
1. **N-B4-1 (P0) + N-B4-2.**
   - New `fit-profile-sync.js` (vanilla IIFE, `window.JobBoredFitProfileSync`): `syncProfile(payload, { fetchImpl })` → `{ ok, synced, status, reason, message }`.
     - It resolves the base through `window.JobBoredProfileApi.getProfileApiBase()`. **`""` means a same-origin `POST /profile`, never skip** (R7).
     - Network failure, and 404/405 from a static host, → `{ ok:true, synced:false, reason:"local_only" }`, with the message: "Saved on this device. Start JobBored on your computer to use it for drafting."
     - **Any 4xx carrying a JSON error body → `{ ok:false, reason:"rejected", message:<the server's message> }`. Never swallowed.**
     - 5xx → `{ ok:false, reason:"server_error" }`.
   - FE-B4 wires `confirmFit` to it later; you only build and test the module.
2. **N-B4-2 / R8.**
   - New `fit-profile-schema.js` (`window.JobBoredFitProfileSchema`). It exposes the enums (seniority, work mode, work auth), the limits, and `validateProfile(profile)`, which returns per-field errors.
   - Its source of truth is `integrations/browser-use-discovery/src/contracts/user-profile.schema.json`: 1–8 roles of ≤80 characters, narrative 20–1200, 1–8 strengths of 2–60 characters, evidence ≤400, keywords ≤20, wants/avoids ≤12 each of 2–200 characters, locations ≤20, skip titles ≤30, and so on.
   - Add a **drift test** that loads the JSON schema and asserts every limit matches.
   - Make `fit-profile-wizard.js` and `fit-profile-editor.js` use it for validation only, replacing their loose copies. Don't touch their rendering.
3. **B1-N2 + G16.** In `sheet-access-setup.js`:
   - Starter-sheet create returns a typed result: `{ ok:false, reason:"scope_missing" }` when the Sheets scope wasn't granted. It must **not** call `signIn({prompt:"consent"})` outside a user gesture; B1 will call consent synchronously on the next click.
   - An **in-flight guard** stops the pending-resume create and a second click from making two sheets. Test it with concurrent calls.
   - **Remove both `window.open` calls** (`:849`, `:867`). `onCreated(created)` already passes `spreadsheetUrl`, and FE-B1 renders the link.
   - `verifyExistingSheetAccess` keeps returning `reason` (`access_denied` / `headers_unreadable` / `no_token`); document it as a contract for FE-B1's B1-N4 copy.
4. **R10.** In `auth-session.js`:
   - G6: the toast at `:1002-1005` reads "Google sign-in isn't ready yet. Reload the page and press Continue with Google again."
   - B1-N7: `grantedOauthScopes = ""` at `:742`.
   - B1-N3 support: expose `isGoogleSignInReady()` (true when the GIS token client exists) so FE-B1 can name an ad-blocker instead of waiting 120 s.
   - `installKeepAliveOnce` (`:1288-1304`): a `{ ok:true, managedBy:"desktop" }` answer does **not** set `jb:install-keep-alive:installedAt`. Record `managedBy` so the pill can say "Managed by JobBored app". Test both paths.
5. **N-B2-2 + B2-8.** In `config.example.js`:
   - `resumeOpenRouterModel: ""`, so the catalog default applies.
   - The AI Studio link becomes `https://aistudio.google.com/app/apikey`.
   - Gemini is the documented default (D3).
   - Pin these with a test.
6. **D2 (stub_only) + D4 / R9.** In `discovery-readiness.js`:
   - `recommendedFlow` never returns `stub_only`; map it to `local_agent`.
   - It takes a `tailscaleInstalled` input. D4: Tailscale when installed, else `local_agent`, and the label reason agrees.
   - FE-B5 removes the `stub_only` card and enum from the wizard files and passes the probe state.
7. **R24 F1 (P1).** In `integrations/browser-use-discovery/src/config.ts:847`: a `BROWSER_USE_DISCOVERY_ENV_FILE` that points to a **missing** file is treated as empty, not fatal.
   - Keep the throw for an unreadable-but-present file (permissions), with a clear message.
   - Add a worker unit test. Find the worker's test runner (`integrations/browser-use-discovery/tests/`) and run it.

**Floor:** paste all of this in §4.
- `npm run lint:repo`
- `npm run typecheck:repo`
- `node --test` on your new `tests/gfx-be-core-*.test.mjs` files, plus every existing test that covers a file you touched. Find them with `grep -l` over `tests/` for the file basenames: at least the sheet-access-setup, auth-session, fit-profile-wizard/editor, discovery-readiness, `oneflow-l1-beat-google` and `oneflow-l2-fit-beat` tests.
- the worker's test command for the `config.ts` test
- `gitleaks protect --staged --redact`

**Report:** first line `DONE` or `BLOCKED: <why>`.

**Stop when:** the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)

- new `fit-profile-sync.js`, `fit-profile-schema.js`
  - Script tags belong to the orchestrator: request them in report §5, noting that `fit-profile-sync.js` must load **after** `profile-api-base.js` (`index.html:1433`) and before any beat that uses it.
- `sheet-access-setup.js`
- `auth-session.js`
- `fit-profile-wizard.js`, `fit-profile-editor.js`: validation only
- `config.example.js`
- `discovery-readiness.js`
- `integrations/browser-use-discovery/src/config.ts` and its test
- `tests/gfx-be-core-*.test.mjs`, plus updates to existing tests only where the behaviour they pin genuinely moved (say so in the commit body)

**Do NOT touch:**
- any `oneflow-beat-*.js` (FE lanes), `onboarding-flow.js` or `local-server.js` (BE-FUEL)
- `dev-server.mjs`, `start.sh`, `package.json` (BE-FUEL, then DESK-B)
- CSS, `index.html`
- `server/llm-config.mjs`: B2-4 moved to FE-B2B3, because the POST lives in `oneflow-beat-ai.js`

## Non-negotiables

- No key or token material in a test or log.
- Sheet creation stays exactly-once under concurrency.
- A 4xx from `/profile` is always surfaced.
- Schema drift fails CI.
- Every behaviour change has a test named with its ledger ID.

## Definition of Done

The floor, green and pasted in §4, first line `DONE`. Local commits only, one per numbered item above.

---

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.

Goal: the kickoff's mission. Success means: the fence's checkable results, with the floor command's output pasted in the report. Stop when: the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.
Constraints: stay inside the fence; anything outside it goes in the report, not in the diff. Reuse existing utilities; add no test file that mirrors the implementation. Change or fix requests are authorized in scope, including local commits: make the change and validate it without asking. Ask only for external writes, destructive actions, or a scope expansion.
Output: prose report, five sections, first line DONE or BLOCKED plus the reason.
