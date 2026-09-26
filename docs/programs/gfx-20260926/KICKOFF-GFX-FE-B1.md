# Lane FE-B1: Beat 1 (Google + Sheet), the hosted-page route-to-local gate, the Open JobBored ladder, and setup docs

Read `KICKOFF-GFX-_SHARED.md` first, then:
- `SPEC.md` §0 (D1, D2, D8–D12) and **every B1 ledger row**: G1–G22, B1-N1…B1-N6, X3, X4
- `PLAN.md` §R: R4, R6, R11, R13, R21, R22
- `reports/GEMINI-copy-inventory.md`, which lists every string with file:line and the terminology-variant clusters
- `reports/VERDICT-grok-plan-check.md` items 4, 6, 11, 21

**Load the `/frontend-design` skill before designing anything.** Routing: opus · medium.

**Live alongside you:** BE-CORE, in `sheet-access-setup.js`, `auth-session.js`, `fit-profile-*.js`, `config.example.js`, `discovery-readiness.js` and the worker `config.ts`. Do not touch those files. Code against the contracts it is landing, which are listed under Consumes. The orchestrator merges BE-CORE before you.

**Goal:** a brand-new user, on any URL, reaches a signed-in, sheet-connected state without a false error, a dead end or an unexplained step. A user on the hosted site is told plainly, **before any setup starts**, that JobBored runs on their computer, and gets a real button.

**Success means (each item red first, tests named with ledger IDs):**

1. **D2 / R11: the pre-flow gate.**
   - In `onboarding-flow.js` `maybeStart`/`open`, when `JobBoredLocalServer.isLoopbackPage(location)` is false, render a **route-to-local screen** instead of B1 and write no onboarding state.
   - The screen explains in one sentence that JobBored runs on the user's computer, then offers a ladder:
     - **Open JobBored**: `location.href = JobBoredLocalServer.jobBoredOpenUrl()`, with no `beat` (R4).
     - **Download JobBored for Mac**: link to `https://github.com/emilio3435/jobbored-desktop/releases/latest`. Put the URL in one constant; the feed repo will exist before release.
     - **Copy setup command**, as a tertiary action for Windows, Linux and developers: `git clone https://github.com/emilio3435/Job-Bored.git && cd Job-Bored && ./start.sh`, with a copy button and a visible fallback text field.
   - **Detection (R21):**
     - After the Open click, and only after it (Chrome Local Network Access), poll `JobBoredLocalServer.pingLocalServer({ base: "http://localhost:8080" })` for up to about 8 s, and also listen for blur/visibility changes.
     - Ping green → "JobBored is running", plus a link to `http://localhost:8080/`.
     - No signal → reveal the Download and Copy steps prominently.
     - A denied or failed ping counts as **unknown**, never "not installed".
     - Stop polling on success, on leaving the screen, and at the timeout.
   - **Version compare (R3):** when the ping answers with a `version` older than this page's build version, show "Update JobBored" (desktop runtime) or "Run git pull" (source runtime).
   - Make it work with no network to localhost, and test the timers with injectable timings.
2. **B1 detour and copy.**
   - G1: the detour is open by default when there is no Client ID.
   - G2: "Google calls it a Client ID. It takes about 10 minutes, and you only do it once." ("genuinely tedious" goes.)
   - G3: every step is linked (`console.cloud.google.com/projectcreate`, `/apis/credentials/consent`, `/apis/library/sheets.googleapis.com`, `/apis/credentials/oauthclient`), with `DETOUR_STEPS` as `{ text, href }`.
   - G4: add the scope step (`…/auth/spreadsheets`).
   - G5: "name the app JobBored" and "Advanced → Go to JobBored (unsafe)".
   - G6: say "Client ID" everywhere in your files.
   - G7: fix the "no 'our side'" copy.
   - G11: add a localhost vs 127.0.0.1 note.
   - G12: add an `access_denied` trouble line.
   - G15: name the sheet "JobBored Pipeline {date}".
   - B1-N1: the honest three-permission copy (spreadsheets covers all the user's sheets).
   - B1-N6: fix the stale header comment.
   - Use the SPEC ledger's exact replacement strings unless COPY.md improves them.
3. **B1-N2.**
   - When the sheet create returns `{ ok:false, reason:"scope_missing" }`, show "Google signed you in without Sheets access. Press Continue with Google and tick 'See, edit, create… Google Sheets'."
   - The **next click** calls `signIn({ prompt:"consent" })` synchronously, inside the user gesture.
4. **G16:** render an **"Open your sheet ↗"** link from `onCreated(created).spreadsheetUrl`, kept in flow state so B6 can reuse it. There is no `window.open` anywhere.
5. **B1-N3:** before signing in, check `app.core.host.isGoogleSignInReady()` (BE-CORE). If it is false: "Google's sign-in script hasn't loaded. If you use an ad or tracker blocker, allow accounts.google.com, then reload."
6. **B1-N4:** connect-existing maps `access_denied`, `headers_unreadable` and `no_token` to specific copy, per SPEC.
7. **X4 / voice.**
   - Write `docs/COPY.md`, a one-page voice sheet: literal body copy, at most one light metaphor per beat title, and one name per concept (Client ID; "JobBored on this computer"; the start command per R13).
   - Other FE lanes follow it.
   - `localServerHint` (R13): on Mac say "double-click start.command" until the desktop app ships; when the ping reports `runtime:"desktop"`, say "Open the JobBored app". The logic belongs in `local-server.js`, which BE-FUEL owns. If `localServerHint` doesn't take a runtime yet, request it in §5; don't edit `local-server.js`.
8. **Docs.**
   - G14: in SETUP.md and README.md, the one-flow sentence replaces every "login gate / first-run wizard" mention.
   - B1-N5: swap SETUP.md's §1 and §2.
   - G10: an optional Apps Script row (`script.projects`, `script.deployments`, the Apps Script API).
   - G17: a blank-sheet path with the 25 headers from `app-config-core.js:244-270`.
   - G18: one duplicate-rows warning.
   - G19: move the maintainer note to CONTRIBUTING.md.
   - G20: split into Create new / Connect existing bullets.
   - G22: the token-storage copy.
   - B2-8: the AI Studio deep link in SETUP.md.
   - B3 N-B3-5: rewrite the deleted-onboarding paragraph at `SETUP.md:260`.
   - A "Get JobBored" section that describes the Mac app (download), plus the copy-command path.
9. **Visual quality (`/frontend-design`).**
   - The route-to-local screen and the detour must look deliberate, not like a form dump.
   - Follow the existing jb-v2 tokens, the `DESIGN.md` direction and the one-flow shell's look.
   - Scope all CSS under the beat root classes (the jb-v2 cascade trap).
   - You own `css/oneflow.css:557-572` (the shared B1/B2/B3 rule and the privacy trio; keep B2 and B3 visually unchanged) and the B1 block from `:574`. Add a new block for the route-to-local screen.
   - Check it at 1440 and 375 px with Playwright screenshots saved to `.lane-evidence/`. Use a port-0 dev-server; never 8080.

**Floor:** paste all of this in §4.
- `npm run lint:repo`
- `npm run typecheck:repo`
- `node --test` on your new `tests/gfx-fe-b1-*.test.mjs` files, plus `tests/oneflow-l1-beat-google.test.mjs`, the greenfield-a/b/c tests, `oneflow-l0-*`, `oneflow-l6-*`, `oneflow-l7-*`, `gate-identity-switch`, `ux01-*` touching B1, and any test that pins a string you changed (grep for it)
- `npm run test:e2e-onboarding` and `npm run test:e2e-journey`. Both use port-0 servers and hermetic fences. `VAL-ONEFLOW-001` is **known red on main** because of the profile P0 (BE-CORE and FE-B4 fix it); note it, don't fix it
- `gitleaks protect --staged --redact`

**Report:** first line `DONE` or `BLOCKED: <why>`.

**Stop when:** the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)

- `oneflow-beat-google.js`
- a new `oneflow-route-local.js` (the route-to-local screen)
  - Request its script tag in §5. It loads after `local-server.js` and before `onboarding-flow.js`'s boot uses it.
- `onboarding-flow.js`: **only** the `maybeStart`/`open` pre-flow gate. BE-FUEL's `BEAT_PREREQS` and the N5 guard stay as they are
- `css/oneflow.css`: `:557-572`, the B1 block, and the new route-local block
- `SETUP.md`, `README.md`, `CONTRIBUTING.md`, new `docs/COPY.md`
- `tests/gfx-fe-b1-*.test.mjs`, plus updates to tests that pin strings you changed (say so in the commit body)

**Do NOT touch:**
- BE-CORE's files (above)
- `local-server.js`, `dev-server.mjs`, `start.sh` (BE-FUEL, merged)
- the other beats and their CSS blocks
- `index.html`

## Consumes (BE-CORE contracts; code against them, and the orchestrator merges BE-CORE first)

- `sheet-access-setup.js`:
  - the create result `{ ok:false, reason:"scope_missing" }`;
  - `onCreated(created)` with `created.spreadsheetUrl`;
  - no `window.open`;
  - the `verifyExistingSheetAccess` reasons `access_denied`, `headers_unreadable`, `no_token`.
- `auth-session.js`: `isGoogleSignInReady()` exposed on `app.core.host`. If it isn't there, fall back to checking `getTokenClient()`.
- From BE-FUEL (merged): `window.JobBoredLocalServer` (`isLoopbackPage`, `jobBoredOpenUrl`, `pingLocalServer`, `localServerHint`, `OUTCOMES`) and the ping `{ ok, version, runtime, routes, desktopVersion? }`.

## Non-negotiables

- A hosted page never writes onboarding state or asks for a key.
- The Open action never carries `returnTo`.
- The ping runs only after a click.
- No key or token appears in a URL or log.
- There is exactly one primary action per state (D1).
- CSS stays scoped.
- Screenshots at 1440 and 375 px go in `.lane-evidence/`.

## Definition of Done

The floor, green and pasted in §4, except the known-red `VAL-ONEFLOW-001`, noted. First line `DONE`. Local commits only.

---

Deliver what was asked, at the scope intended. Fix only what the kickoff names; note adjacent issues in the report instead of fixing them. Keep replies and written files short.

Goal: the kickoff's mission. Success means: the fence's checkable results, with the floor command's output pasted in the report. Stop when: the fence is exhausted and the floor is pasted, or you are blocked twice on the same thing.
Constraints: stay inside the fence; anything outside it goes in the report, not in the diff. Reuse existing utilities; add no test file that mirrors the implementation. Change or fix requests are authorized in scope, including local commits: make the change and validate it without asking. Ask only for external writes, destructive actions, or a scope expansion.
Output: prose report, five sections, first line DONE or BLOCKED plus the reason.
