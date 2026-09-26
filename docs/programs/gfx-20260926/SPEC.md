# GFX: greenfield onboarding fix program (spec)

Prefix `GFX` · drafted 2026-09-26 06:35 CT · status **ACTIVE (partial): §0 D1–D10 locked 07:30 CT. B5 rescue plus blocker fixes in progress; the rest of the lanes wait for Emilio's go**

**Goal:** a brand-new user on any OS gets from a cold open to B6 "You're live" without hitting a false error, a trap, or a sentence they can't act on.

**Success means:**
- Every row in the §2 ledger is either fixed with a test that names its ID, or waived in §0.
- The SerpApi key check never shows a message that contradicts what actually happened.
- A live greenfield walkthrough (Astra, at :8080 and on the hosted origin) finishes with no P0 or P1 open.
- The integration branch is green on the full floor.

**Stop when:** integration is green and swept, and the PR and ultrareview commands are printed for Emilio. Or stop earlier if a §0 decision blocks.

## 1. Evidence base: what was compared and how far to trust it

| Source | Family | Method | Reliability |
|---|---|---|---|
| A: "Greenfield Setup Audit & Redesign Spec" (`reports/SOURCE-A-*`) | gemini | Code trace. Its "browser walkthrough" was never run | Mixed: 4 claims refuted, and it recommends a CORS relaxation that would send the key across origins (rejected, S5) |
| B: "Greenfield setup teardown" (`reports/SOURCE-B-*`) | muse | Code trace from a 6-reviewer workflow; B says itself it ran no browser; the tails of each stage were truncated | Better on copy. Its SerpApi root cause is wrong (timeout theory refuted; the 403 theory yields a different message) |
| V1–V3: three opus verifiers, one per beat group | opus | Read HEAD and the working tree for every claim. V3 also ran the dev-server at HEAD, at WT and on a pre-route build on :18080–18083, and curl-probed the Pages site | This document is built on V1–V3 |

**Nobody has run a live greenfield browser walkthrough yet.** The G-series findings about Google's own behaviour (test-user 403, the unverified-app screen, localhost ≠ 127.0.0.1, popup blocking) are *inferred*. That gap is closed by lane QA-LIVE.

### Headline scorecard

| | A | B |
|---|---|---|
| Claims checked | 27 | 44 |
| Confirmed or partly confirmed | 20 | 38 |
| Refuted | 4 (no PDF drag-drop · "warning tone" · "any non-8080 port 404s" · "Analyze resume") | 4 (tokens in memory only · ping timeout · "10 min left" misread · test-user step missing) |
| Found the real SerpApi root cause | Partly: hosted origin is right; 403 as the mechanism is wrong | No |
| New bugs found by verifiers | 34 (V1: 7 · V2: 14 · V3: 9 + 4 WT-diff blockers) | |

## 2. Why "Save & verify" fails every time (confirmed)

The message the user saw is the **HEAD/deployed** copy. At HEAD, `checkFuelKey` sends one `POST /__proxy/serpapi-check` and maps *either* a network throw *or* a non-JSON body to `no_local_server`. So the message means "nothing answered, or something other than a current JobBored dev-server answered". Four paths produce it:

1. **Hosted page (jobbored.elioai.app): fails 100% of the time, proven live.** The POST returns 405 with an empty content-type, so it is classified `no_local_server`. Running start.command can't fix that tab, because the fetch is relative.
2. **`concurrently -k` takes the dashboard down.** Proven from code and reproduced. `npm start` = `concurrently -k web scrape`. If :8080 is busy, the dev-server exits with EADDRINUSE and `-k` also kills the scraper. If the scraper dies (for example because :3847 is held by something else), `-k` kills web. The tab stays open against a dead or foreign :8080. **Workspace 116 hit exactly this EADDRINUSE on 8080 this morning.**
3. **Stale dev-server** started before `1cf28155` (2026-09-02). It answers `404 text/plain`, which gives the same message. Reproduced on a pre-route build.
4. **Page not served by the dev-server** (file://, Live Server, `python -m http.server`): a 404/405/501 non-JSON body, same message.

**Refuted:** a 3s ping timeout (B). HEAD has no ping, and a refused connection fails instantly. Also refuted: Origin/CSP blocking on :8080 (A); the HEAD server returns `invalid_key` in 0.57s for both the localhost and the 127.0.0.1 origin.

**Which path hit Emilio: unknown.** Nothing was listening on :8080 at 06:31, so it can't be probed now. The one-step check is DevTools → Network → status and content-type of `POST /__proxy/serpapi-check`:
- no status → path 2
- `404 text/plain` → path 3
- 405, HTML or 501 → path 1 or 4

## 3. The uncommitted B5 work on `main`

**Owner unknown.** The files were changed 05:34–05:53 today and are uncommitted in the shared checkout:

| File | Change |
|---|---|
| `oneflow-beat-discovery.js` | +440 lines: `static_host` classification, pending-fuel slot in sessionStorage, localhost presence poll, clipboard handoff |
| `dev-server.mjs` | Keyless ping allowed cross-origin, only for the exact CNAME origin and a loopback peer |
| `start.sh` | Opens `?beat=discovery` on launch |
| `user-content-store.js` | Pending-fuel store |
| `onboarding-flow.js` | `?beat=` deep link |
| tests | 4 new, 7 modified |

V3's review found good parts: sessionStorage only, key never in a URL, exact-origin keyless ping. It also found **5 blockers before merge**:

| ID | Sev | Blocker | Fix |
|---|---|---|---|
| WT-N2 | P1 | A HEAD-era server 404s the new GET ping, so a *localhost* user is told "This hosted page can't check your key" | Use `static_host` only when `location.hostname` is not loopback. On loopback say "Your JobBored server is out of date — restart it" |
| WT-N3 | P1 | The GET ping has no Origin, so auth relies on Sec-Fetch-Site. Safari < 16.4, some webviews and tailnet dashboards get 403 and stop at "ping failed", which **regresses** HEAD's working POST | Treat any JSON ping answer as "server up" and let the POST decide, or send the ping as a POST |
| WT-N5 | P1 | Every start.sh launch opens `?beat=discovery` with no completion guard and no `returnTo=close`, pushing onboarding on users who are already set up | Open `/` (the flow resumes itself), or deep-link only when the onboarding completion flag is unset |
| WT-N7 | P2 | The presence poll never stops on beat exit or flow close; up to 60×3s of `setMessage` on a stale ctx | Stop it in the beat's unmount/close hook; add a test for leaving the beat mid-poll |
| WT-copy | P2 | "(ping failed) … the start command" is vaguer than HEAD | Use the platform-aware hint from the substrate (§4 L-FUEL) |

Two further catches: an `invalid_key` draft is restored as "saved", and sessionStorage doesn't cross into the tab that start.sh opens.

## 4. Consolidated ledger: bugs, flaws and fixes

Legend. **Src:** A · B · A+B · NEW (found by a verifier). **Lane:** the §5 lane that owns the fix. **Sev:** P0 breaks the flow or lies about data · P1 misleads or blocks a path · P2 friction or copy.

### Beat 1: Google sign-in and Sheet

| ID | Sev | Src | Finding (verified) | Fix | Lane |
|---|---|---|---|---|---|
| G3 | P1 | A (partial) | The 6 Client ID steps are unlinked text; only one Console link exists (`oneflow-beat-google.js:351`) | Render `DETOUR_STEPS` as `{text, href}` with deep links: `/projectcreate`, `/apis/credentials/consent`, `/apis/library/sheets.googleapis.com`, `/apis/credentials/oauthclient`. Check the links resolve under Google's Auth Platform before shipping | FE-B1 |
| G5 | P1 | B | "Advanced → Go to JobBored" won't match an app name the user typed (`:257`, `:260`) | Step 2 says "name the app JobBored"; later "Advanced → Go to JobBored (unsafe)" | FE-B1 |
| N1 | P1 | NEW | "We ask for one permission" (`:523`), but consent asks for three, and the Sheets scope covers **all** of the user's sheets | "Google will ask to let JobBored see and edit your Google Sheets, and read your name and email. JobBored only opens the sheet it creates or the one you paste." | FE-B1 |
| N2 | P1 | NEW | Sign-in with the Sheets box unticked → `signIn({prompt:"consent"})` fires outside a user gesture (popup blocked) → B1 shows "didn't create the sheet", yet a later grant silently creates it anyway. Double-sheet risk | After sign-in, check `hasGrantedOauthScope(sheets)`; if missing, show the tick-the-box message and return. The next click calls consent synchronously. Add an in-flight guard on create | BE-CORE |
| G16 | P1 | B (worse) | `window.open(spreadsheetUrl)` after 3 awaits has no user activation, so it is popup-blocked; the notify is dropped by B1's error-only `onStatus` | Remove the `window.open` (`sheet-access-setup.js:849`). B1 renders an "Open your sheet ↗" link from `onCreated`, carried to B6 | BE-CORE (remove) + FE-B1 (link) |
| G14 | P1 | B (wider) | Docs still describe the deleted "login gate / first-run wizard": SETUP.md:57-58, :109; README:40-41, :177, :182-183, :192, :274 | One sentence everywhere: "Open http://localhost:8080 and follow the one setup flow — step 1 signs you in with Google and creates your Sheet." | FE-B1 (docs) |
| N5 | P2 | NEW | SETUP.md puts sheet creation (§1) before OAuth (§2), an impossible order | Swap §1 and §2 | FE-B1 (docs) |
| G1 | P2 | A | Detour collapsed by default | `detourOpen = !oauthClientId()` | FE-B1 |
| G2 | P2 | A+B | "genuinely tedious" | "Google calls it a Client ID. It takes about 10 minutes, and you only do it once." (keep 10; A's "3 min" isn't realistic) | FE-B1 |
| G4 | P2 | A, B | The scope step is missing. The test-user step **is** present (both reports wrong on that) | Step 2 adds "Under Data access, add …/auth/spreadsheets" | FE-B1 |
| G6 | P2 | B | Name sprawl: app key / Client ID / OAuth client across 3 files | "Client ID" everywhere. `auth-session.js:1003` → "Google sign-in isn't ready yet. Reload the page and press Continue with Google again." | FE-B1 |
| G7 | P2 | B | "there is no 'our side'" | "…JobBored has no server that sees your data." | FE-B1 |
| G10 | P2 | A (gap) | The permission matrix omits the Apps Script scopes (`script.projects`, `script.deployments`) and the Apps Script API | Add an "Optional: Apps Script webhook" row | FE-B1 (docs) |
| G11/G12 | P2 | A | localhost ≠ 127.0.0.1; missing test user → 403 access_denied (Google behaviour, inferred) | Detour foot line plus a "Having trouble?" entry for `access_denied` | FE-B1 |
| G15 | P2 | B | The created sheet's name is never shown | "…creates a sheet named “JobBored Pipeline {date}” in your Drive, owned by you." | FE-B1 |
| G17–G20 | P2 | B | Manual fallback has no header list; duplicate-rows warning worded two ways; maintainer note in the user path; README buries "connect existing" | Add the blank-sheet path plus the 25 headers from `app-config-core.js:244-270`; one warning sentence; move the maintainer note to CONTRIBUTING; split into two bullets | FE-B1 (docs) |
| G22 | P2 | B (refuted) | B's proposed "tokens in memory only" copy is false: the token is in sessionStorage | "Your sign-in lasts for this tab only; your Client ID and Sheet link are saved in this browser." | FE-B1 |
| N3 | P2 | NEW | Ad blocker on accounts.google.com → 120 s wait, then blames popups | Check `getTokenClient()` before sign-in; name the blocker | FE-B1 |
| N4 | P2 | NEW | Connect-existing shows one message for every failure reason | Map `access_denied` / `headers_unreadable` / `no_token` to specific copy | FE-B1 |
| N6/N7 | P2 | NEW | Stale header comment; `grantedOauthScopes = []` type slip (`auth-session.js:742`) | Fix both | FE-B1 / BE-CORE |
| — | — | A | Refuted: "warning tone" (it is `"info"`); "zero links" | — | — |

### Beat 2: AI provider

| ID | Sev | Src | Finding | Fix | Lane |
|---|---|---|---|---|---|
| B2-4 | **P0** | B | Privacy lie: "stored in this browser and sent only to the provider". In fact it is also POSTed to `:3847/api/llm-config` → `~/.jobbored/llm.json` (0600) with **no consent**, the `.env` write asks consent, and the key sits in plaintext localStorage | Gate the llm.json pin behind the same consent as `.env`, or disclose both. Copy: "Your key is saved in this browser. If JobBored is running on this computer, it's also saved there so drafting and scoring work. It's only ever sent to {provider}." | BE-CORE (gate) + FE-B2B3 (copy) |
| B2-1/9 | P1 | A | OpenRouter is pre-selected with "add a few dollars of credit"; Gemini sits second despite `config.example.js` defaulting to Gemini | §0 D3. Recommended: Gemini first and pre-selected, "Free tier — no card needed" | FE-B2B3 |
| B2-7 | P1 | A (worse) | "keep npm run dev running" CORS note is **false**: OpenAI and Anthropic are called browser-direct (`resume-generate.js:474,496`). SETUP.md:269 contradicts both | Drop `CORS_NOTE`. The trouble tip names network blocks and suggests OpenRouter. Fix SETUP.md | FE-B2B3 |
| B2-5 | P1 | B (worse) | A native `confirm()` exposes `integrations/browser-use-discovery/.env (BROWSER_USE_DISCOVERY_GEMINI_API_KEY)` | An inline consent row: "Also save this key for your local discovery helper…? [Save it] [Not now]". Path goes in "What changes" `<details>` | FE-B2B3 |
| N-B2-1 | P1 | NEW | Three contradictory OpenRouter stories: paid, "free account", and a "free tier above" card that doesn't exist | One story (paid default); fix the tip and link labels, and the config.example / SETUP lines | FE-B2B3 |
| N-B2-2 | P1 | NEW | `config.example.js:91` pins `openai/gpt-oss-120b:free`, which `setup.mjs` copies to config.js. That overrides the catalog default and fires the weak-model warning on the "Recommended" path (inferred) | `resumeOpenRouterModel: ""` | BE-CORE |
| B2-3 | P2 | B | "done, no extra step" is false: a confirm follows, which can fail silently on a hosted origin, and the result is never shown | Pre-announce the ask; show a ✓/✗ from `geminiWroteThrough` | FE-B2B3 |
| N-B2-3 | P2 | NEW | A failed llm.json pin is silent; on a hosted origin the consent shows for a route that doesn't exist | Skip both when the substrate ping says there is no local server; show a note on failure | BE-CORE |
| B2-2/6/8 | P2 | B | "lights up … grounded search" slop; no AIza check; aistudio root links | Copy; soft prefix warning (AIza / sk-or- / sk-ant-); `/app/apikey` everywhere | FE-B2B3 |

### Beat 3: Resume

| ID | Sev | Src | Finding | Fix | Lane |
|---|---|---|---|---|---|
| B3-4 | P1 | A (worse) | Drafting has **no timeout and no stall feedback** and can hang forever (`:546`, `:638`) | Port B2's `CHECK_TIMINGS` stall watch: seconds counter; at 30 s "Still waiting on your AI provider — free tiers can be slow…"; 90 s AbortController | FE-B2B3 |
| N-B3-1 | P1 | NEW | When the browser-direct fallback fails, it swallows the provider error (429 / bad key) and shows the wrong "couldn't reach the app / start.command" | Return `{ok:false,message}`; prefer the provider's message | FE-B2B3 |
| B3-6 | P1 | B | macOS-only start.command hint plus raw `err.message`; B2 says `npm run dev` for the same thing | Use one platform-aware sentence from the L-FUEL substrate (`localServerHint()`) in B2, B3 and B5; technical detail goes in `<details>` | FE-B2B3 (uses BE-FUEL helper) |
| B3-2 | P2 | B | `accept` includes `.doc` but there is no parser (it throws "Unsupported") | Drop `.doc`; say ".docx"; give a specific message if a .doc is dropped | FE-B2B3 |
| B3-7/8/9/10/11 | P2 | B | Unlinked "open your local JobBored"; "We'll do the typing"; ✓ baked into a label (shows while still active); "seed, not a lock"; "Draft from this text" | Copy per V2 table; ✓ from `state:"done"` | FE-B2B3 |
| N-B3-2/3/4/5 | P2 | NEW | Fake stage 2 progress; 2–3 primary buttons on failure; doubled paste advice; SETUP.md:260 describes the deleted onboarding | Two-stage list; one primary per state; de-dupe the suffix; rewrite the doc | FE-B2B3 |
| — | — | A, B | Refuted: "no PDF drag-drop" (A; dropzone plus pdf.js exist); "Analyze resume" (A); "10 min left on a 2-min beat" (B; it's time left in the whole flow; optionally relabel "~10 min to finish setup") | — | — |

### Beat 4: Fit profile ("it's hideous")

| ID | Sev | Src | Finding | Fix | Lane |
|---|---|---|---|---|---|
| N-B4-1 | **P0** | NEW | **The profile never reaches the server on a greenfield install.** `profileApiConfigured()` is false when the config URLs are empty (the defaults), so `POST /profile` is skipped even on :8080. `~/.jobbored/profile.json` is never written and drafting runs blind. This brings back SIXBEATS C3 | Resolve through `JobBoredProfileApi.getProfileApiBase()` (as B3 does); always try same-origin; surface local-only saves | BE-CORE |
| N-B4-2 | P1 | NEW | Client validation is looser than `user-profile.schema.json` (>8 roles, strength >60ch, >12 wants…). The server's 400 is **swallowed** as "saved locally" | Shared `fit-profile-schema.js` (enums, limits, validate) used by B4, wizard and editor. Never swallow a 4xx | BE-CORE (module + sync) + FE-B4 (inline errors) |
| N-B4-3 | P1 | NEW | The narrative is required but hidden behind an "edit" link; the error focuses nothing | A visible, labelled, auto-growing textarea; focus the first invalid field on error | FE-B4 |
| N-B4-4 | P1 | NEW | The salary floor is ignored unless "Reject listings without salary" is ticked (schema), yet the summary shows "$Xk floor" as if active | §0 D5. Recommended: one control ("Minimum salary [__] ☐ Also hide jobs that don't list a salary") with help text | FE-B4 |
| B4-1/9 | P1 | A+B | A 3-column grid in a modal (drops to 1 column ≤900px); hard filters (work mode, auth) hidden in an accordion while seniority is up top | Regroup in order: **Target** (roles, seniority) → **Your story** (narrative) → **Strengths** (ranked) → **Deal-breakers** (work mode, locations, auth, salary) → **Preferences** (wants, avoids, skip titles; collapsed). One column under 720px | FE-B4 |
| B4-2 | P1 | A (partial) | ↑↓× only on roles and strengths; the buttons are `2px 4px`, below the 24×24 target size | Tag input with a ≥24px ×; reorder via a drag handle plus a keyboard move menu | FE-B4 |
| B4-4 | P1 | A (worse) | The narrative preview is a one-line ellipsis of up to 1200 chars, with no label | See N-B4-3 | FE-B4 |
| B4-6 | P1 | A | Raw profile JSON `<pre>` in onboarding, rebuilt on every keystroke | Remove from B4; keep only in Settings → Fit profile → Advanced | FE-B4 |
| B4-8 | P1 | A (partial) | B4 is a second renderer with copied enums (the wizard and editor share one `.fp-*` system) | Consume `fit-profile-schema.js` now; longer term B4 renders `FitProfileForm` sections | FE-B4 |
| B4-3/5/7/11, N-B4-5/6 | P2 | A, B, NEW | Fixed `11rem` input clips; sibling `<details>`; "judge every job"; the draggable `<li>` wraps a text input; empty and duplicate chips kept on edit; the title repeats its subheads | `field-sizing: content`; promote the hard filters; "Here's how we'll match jobs to you."; drag only on the handle; trim and dedupe on blur; "Preferences: More of / Less of" | FE-B4 |

Current field inventory and data contract: `reports/V2-beat4-inventory.md`.

### Beat 5: SerpApi key, discovery, and B6

| ID | Sev | Src | Finding | Fix | Lane |
|---|---|---|---|---|---|
| S1 | **P0** | A | Hosted page: POST 405, so `no_local_server`, 100% of the time (§2 path 1) | Classify it as `static_host` (WT has this) and gate on non-loopback `location.hostname` (WT-N2) | BE-FUEL |
| N1 | **P0** | NEW | **B5 hard-blocks.** Skip is disabled until `fuelPassed`, and the handler refuses "isn't skippable". Anyone whose check can't run can never reach B6 | §0 D1 (strict): the gate stays. Every blocked state renders one diagnosed fix action; no state without an action | BE-FUEL (state) + FE-B5 (UI) |
| N4 | P1 | NEW | `concurrently -k` kills the dashboard when the scraper or a port fails (§2 path 2) | Drop `-k` for `start` (or make web independent); `start.sh` detects an existing :8080 listener, identifies whether it is a current JobBored build (ping `version`), and says what to do | BE-FUEL |
| S3/S7/S9 | P1 | A, B | One reason funnels every failure. `forbidden` and `internal_error` have no copy, so users see "SerpApi answered, but not with your account" | A typed outcome enum from the substrate: `down` · `wrong_origin` (JSON 403) · `stale_server` (loopback + 404/non-JSON) · `static_host` · `server_error` (500) · `invalid_key` · `quota` · `ok`. Each gets one fix sentence | BE-FUEL (enum) + FE-B5 (copy) |
| N-stale | P1 | NEW | A stale dev-server (§2 path 3) can't be told apart from a dead one | `GET /__proxy/ping` returns `{ok, version, routes}`; the client compares against the build version and says "restart JobBored" | BE-FUEL |
| WT-N2, N3, N5, N7 | P1–P2 | NEW | WT diff blockers (§3) | As in §3 | BE-FUEL (N2, N3, N5) + FE-B5 (N7) |
| D3 | P1 | B | Two "recommended" discovery paths at once: default `local_agent` (`discovery-readiness.js:480`) vs "Tailscale (recommended)" | §0 D4. Pick one; the readiness logic and label follow | BE-CORE (logic) + FE-B5 (label) |
| S10, D1, D4–D8 | P2 | B | Mac-only copy; "Re-scan"; "Pipeline sheet not set up" has no action; "Relay … ngrok … redeploy" jargon with no button; name drift across 3 names per path; "No webhook (manual)"; "public HTTPS endpoint" | Platform hint; "Check again"; a "Connect Sheet" action to B1; plain copy plus a Fix button; one name per path; "Skip for now" plus the consequence; "a web address you already own" | FE-B5 |
| D2 | P2 | B | `stub_only` is orphaned but still in the enums, and `recommendedFlow` can return it, so no card is marked | Delete it (map to `local_agent`) | BE-CORE |
| N8 | P2 | NEW | B6 `runNow` fires `triggerRun()` without reading the result | Await it; show the failure inline in B6 | FE-B5 |
| S6 | P2 | A | `npm start` doesn't start the discovery worker | **Superseded by PLAN R13:** the launcher starts the whole stack | BE-FUEL |
| — | — | A, B | Refuted or rejected: A's "any non-8080 port 404s"; B's 3s-timeout theory; **A's hosted-origin CORS relaxation for serpapi-check (sends the key cross-origin; rejected)**; A's "save unverified on 64-hex format" is superseded by D1's unverified state | — | — |

### Cross-cutting

| ID | Sev | Finding | Fix | Lane |
|---|---|---|---|---|
| X1 | P1 | Three different "start the server" sentences (B2 `npm run dev`, B3 start.command plus raw error, B5 "the start command") | `localServerHint(platform)` in the L-FUEL substrate is the single source | BE-FUEL → consumers |
| X2 | P1 | `npm run lint:repo` fails: eslint scans `.worktrees/feat-standalone-materials-drafter/app.js` (A's floor output) | Add `.worktrees/` to the eslint ignores. Every lane's floor depends on this, so it lands in the substrate commit | BE-FUEL (substrate commit) |
| X3 | P1 | N6: the hosted→localhost handoff moves the key but **none of the onboarding progress** (localStorage is per origin), so the user lands on an unconfigured :8080 | §0 D2 | per D2 |
| X4 | P2 | Metaphor soup: "fuel", "engine", "brain", "scout" | FE lanes keep one light metaphor per beat title and literal body copy; FE-B1 owns the voice sheet `COPY.md` | all FE |

## 5. Lanes (after §0)

Model split per Emilio (2026-09-26): **BE = sol family at xhigh** (overrides the policy default of max). **FE and orchestrator = opus family at medium; FE lanes load `/frontend-design`.** Verification follows policy: muse verifies each lane's floor, grok reviews each diff, and astra runs the live walkthrough. Family names only; IDs come from `models.lock.json` in this folder.

| Lane | Family · effort | Fence (owns) | Consumes | Order |
|---|---|---|---|---|
| **BE-FUEL** (substrate) | sol · xhigh | new `local-server.js` (ping, typed outcome enum, `localServerHint`, `isLoopbackPage`); `dev-server.mjs` ping `{version,routes}`; `scripts/lib/local-control-auth.mjs`; `start.sh`; `package.json` start scripts; eslint ignore; the fuel **state machine** in `oneflow-beat-discovery.js` (`checkFuelKey`, unverified state, skip gating) · takes over the WT diff (§0 D6) | — | **First, alone.** Dependents spawn after it merges |
| **BE-CORE** | sol · xhigh | `sheet-access-setup.js`, `auth-session.js`, `server/llm-config.mjs` + consent gate, `config.example.js`, `discovery-readiness.js`, new `fit-profile-schema.js`, new `fit-profile-sync.js` (B4's POST path) | BE-FUEL ping | Parallel with FE lanes after BE-FUEL; `fit-profile-schema.js` lands first inside the lane |
| **FE-B1** | opus · medium + /frontend-design | `oneflow-beat-google.js`, `SETUP.md`, `README.md`, `CONTRIBUTING.md`, `COPY.md` (voice sheet), the B1 section of `css/oneflow.css` | BE-CORE N2 hook, `onCreated` URL | After BE-FUEL |
| **FE-B2B3** | opus · medium + /frontend-design | `oneflow-beat-ai.js`, `oneflow-beat-resume.js`, `resume-ingest.js` accept list, the B2/B3 sections of `css/oneflow.css` | `localServerHint`, BE-CORE consent gate | After BE-FUEL |
| **FE-B4** | opus · medium + /frontend-design | `oneflow-beat-fit.js` (render only; the POST goes through `fit-profile-sync.js`), the fit section of `css/oneflow.css` (`:860-1060`) | `fit-profile-schema.js`, `fit-profile-sync.js` | After BE-CORE lands the schema module |
| **FE-B5** | opus · medium + /frontend-design | `oneflow-beat-discovery.js` **render/copy only** (not the state machine), `discovery-wizard-ui.js`, `discovery-wizard-shell.js`, `oneflow-beat-payoff.js`, the B5/B6 sections of `css/oneflow.css` | outcome enum, unverified state | After BE-FUEL |
| **QA-LIVE** | astra · xhigh (cua) | read-only; screenshots and a report | integrated branch | Last: a greenfield walkthrough on :8080 **and** hosted, Mac, 1440 and 375 |

`css/oneflow.css` is shared. Each FE lane edits only its own beat's rule blocks, and new rules are scoped under the beat root class (the jb-v2 cascade trap).

**Budget:** 6 build lanes, with at most 5 live at once (BE-FUEL runs alone first), plus muse/grok verifiers per lane and 1 astra. That stays within the 10-terminal budget.

**Floor (every lane):**
- `npm run lint:repo`
- `npm run typecheck:repo`
- `npm test` (the real gate is run-tests.mjs, including integration)
- `npm run test:contract:all`
- both Playwright suites (`tests/e2e-onboarding`, journey)

**Required new tests:**
- a `checkFuelKey` outcome matrix against real dev-server builds (current, stale and foreign-host fixtures)
- skip-unverified never sets `fuelPassed`
- the presence poll stops on beat exit
- a B4 profile POST on an empty-config greenfield

**Before spawning:**
1. A grok plan check on this spec.
2. Muse/grok/astra are policy defaults; Emilio's message named only BE and FE, so confirm them with the §0 questions.

## 0. Locked decisions (to be filled from Emilio's answers; they override anything above)

| # | Decision | Recommended | Answer |
|---|---|---|---|
| D1 | B5 when the key can't be checked | Continue, verify later | **LOCKED: Strict, must verify.** Keep the hard gate. Every failure outcome gets an accurate diagnosis plus exactly one fix action (open localhost, restart JobBored, stop the other :8080 process, fix key). N1's fix becomes: 'no dead end without an action', not 'skippable'. Coherent with D2, because hosted users never reach B5 |
| D2 | The hosted site's role in onboarding | Route to local at B1 | **LOCKED: route to local at B1.** A non-loopback page shows 'Get JobBored on your computer' before any setup. The WT presence-poll/handoff design is dropped |
| D3 | Default AI provider | Gemini | **LOCKED: Gemini** first and pre-selected |
| D4 | Recommended discovery path | Tailscale if installed, else Just this computer | Default taken (Emilio didn't override) |
| D5 | Salary-floor semantics | UI fix | Default taken (Emilio didn't override) |
| D6 | Uncommitted B5 work on main | — | **REVISED 07:25: keep, fix, move the handoff to B1.** Owner identified: the "SERP API" Muse session (workspace:113 surface:235), which built options 1–4 at Emilio's request. Rescued as-is into `0856add6` on `fix/gfx-b5-rescue` (worktree `~/Job-Bored.worktrees/gfx-b5`), 120/120 B5 tests green, gitleaks clean. Main's shared working tree is untouched. The 4 blockers (N2, N3, N5, N7) are being fixed by an inline opus agent. The handoff and presence poll move to the B1 route-to-local screen after the D8 design |
| D7 | Who fixes the B5 code | — | **LOCKED: inline opus agents from the orchestrator session** (the Agent tool can't set effort, so they run at its default rather than medium) |
| D8 | "Start JobBored" UX | — | **LOCKED: option C, a real button.** The hosted and B1 route-to-local screen offers **Open JobBored** (`jobbored://open?beat=…`), falls back to **Download JobBored for Mac**, and keeps option A's **Copy setup command** as the tertiary path (Windows/Linux, and developers) |
| D9 | Installer shape | — | **LOCKED: self-contained macOS app** that bundles its runtime and the app, registers `jobbored://`, and keeps the stack alive. No git, Node or Terminal for the user. v1 is **macOS only, universal**; Windows and Linux keep option A |
| D10 | Signing | — | **LOCKED: Emilio has a Developer ID.** Sign and notarize in CI. Emilio adds the certificate and app-specific password as CI secrets himself; no agent ever handles them. Release publishing stays Emilio's |
| D11 | Update feed + defaults | — | **LOCKED:** separate public feed repo `emilio3435/jobbored-desktop` (Emilio creates it; CI drafts there; Emilio publishes). Not in desktop v1: relay/tunnel, printToPDF. Non-Mac start hint: `./start.sh`. |
| D12 | **Quota routing (Emilio, 08:00 CT):** pool X (Codex: Sol, Astra) is walled until Tue Sep 29, 20:22; the free reset credit is **not** used. **All build lanes, backend included, run on opus (pool A) until it is drained**, and frontend lanes are **staggered** (at most 2 opus lanes live). Sol and Astra rejoin after the reset: Astra runs S4, S5 and the Phase 4 QA. muse (M) verifies and grok (K) reviews as planned. |
| D13 | Tailscale dashboards | — | **LOCKED (Emilio, 17:10): allow setup over the tailnet**, with a security review. The trusted origin is only this machine's own `*.ts.net` name, via Tailscale Serve (loopback peer), with the owner's Tailscale identity. Everything else stays loopback-only. Lane SOL-TAILNET (sol · xhigh) |
