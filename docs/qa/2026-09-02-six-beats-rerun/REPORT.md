# Six Beats rerun — 2026-09-02, build cf0da4d

Observe-only re-walk of JobBored's six-beat onboarding on `main @ cf0da4d`
("fix(sixbeats): keep the resume file input inside the shell on phones"),
driven headlessly with Playwright against `PORT=8095 node dev-server.mjs`.

Everything below is either a string that appeared on screen, a request or
response that crossed the wire, or a number measured off the live page. No
causes, no fixes, no speculation.

## Verdict table

| 09-01 finding | Surface | 09-01 tag | Now | Verdict | Evidence |
|---|---|---|---|---|---|
| **U1** — S0 is a bare kanban: no header/wordmark, no framing, invitation collapsed to a corner pill over an empty viewport | S0 | `UGLY` | Full-width header strip (`JobBored` wordmark + `SAMPLE PIPELINE — THIS IS WHAT A SET-UP JOBBORED LOOKS LIKE.`, 1440×51.4 at y=0), a framed board (1180×750 at 130,71.4), and the invitation card **on first mount** (468×221.2, centred at 486,305.9); `pillPresent: false` | **FIXED** | `s0-01-cold-start.png`, `s0-m01-cold-start-390.png` |
| **U2** — shell renders the 6-segment spine **and** a second step-rail row ("GOOGLE") beneath it | shell | `UGLY`/`MISMATCH` | Exactly one progress system present in the DOM on every beat. Counting `__spine`, `__steps`, `__step-rail`, `__progress`, `__journey`: `[".discovery-setup-wizard__spine"]` on all six beats | **FIXED** | `b1-01-google-initial.png` … `b6-01-payoff-initial.png`; per-shot `progressSystems` in every capture |
| **U3** — at 390×844 the "Add" buttons beside the role/strength inputs wrap to "Ad / d" | B4 | `UGLY` (mobile) | All six `Add` controls occupy **1 line box**. 390×844: 36.28 × 26.34 each. 1440×900: 37.45 × 27.25 each | **FIXED** | `b4-m01-fit-390.png`, `b4-01-fit-initial.png` |
| **C1** — uncaught `TypeError: Cannot read properties of null (reading 'appendChild')` on `/?greenfield=1` first paint | cold start | `ERROR` | Zero uncaught page errors across a clean cold start (FCP 152 ms, DCL 178 ms, load 195 ms, 160 requests). See §Note on C1 — an `appendChild` error *did* appear in four earlier captures and was traced to this harness's own DevTools overlay, not to the product | **FIXED** | `logs/extras.json → coldStart.pageErrors: []`; `s0-01-cold-start.png` |
| **C2** — the B3 template grid has no "Back to upload / paste" action | B3 | `MISMATCH` | `Back to upload or paste` is present and returns to the dropzone/paste screen. Present at both viewports | **FIXED** | `b3-02-resume-templates.png` → `b3-03-resume-back-to-intake.png`; `b3-m02-templates-390.png` |
| **C3** — `POST/GET /profile` resolve same-origin → 404, `profile_response_invalid`; the server fit profile never persists | B4 / B6 | `ERROR` | `Looks like me →` issues exactly one request: `POST http://localhost:8095/profile` → **200** `{"ok":true,"updatedAt":"2026-09-02T07:29:39.208Z","logoRefresh":{"ok":true}}`. No 404, no `profile_response_invalid` anywhere in any run | **FIXED** | `logs/extras.json → fitSave`; `b5-01-discovery-initial.png` (the screen it advances to) |
| **C4** — refreshing with `?greenfield=1` still in the URL re-runs the reset and lands on cold start | refresh | `MISMATCH` | The param is gone from the address bar on the very first load (`urlAfterLoad: "http://localhost:8095/"`). Refreshing inside Beat 3 resumes **at Beat 3** with the shell open (`flowState.beat: "resume"`, `completedBeats: ["google","ai"]`) | **FIXED** | `s0-01-cold-start.png` (Path C's cold start is byte-identical), `path-c-02-b3-before-refresh.png` → `path-c-03-b3-after-refresh.png` |
| **C5** — Escape drops to the board with no feedback | B4 | `CONFUSING` | Escape now raises the toast `Setup paused — pick up right here anytime.` (`.toast.toast-info`) | **FIXED** (but see NEW-6 — the promise has no matching control) | `path-c-06-b4-escaped-toast.png`, `s0-07-escape-back-to-board.png` |
| **C6** — key verification spins 1.4–3.0 s with no elapsed/timeout affordance | B2 / B5 | `FROZEN`-adjacent | The stage list is live and the primary is disabled while in flight. Sampled every 100 ms across a real check: `◌ Checking your key…` at **61 ms** → `✓ Connected — gemini-3.5-flash responded` at **1612 ms** → beat replaced at **1718 ms**. B5 fuel: `◌ Saving your key…` → `✓ Google Jobs index connected — 100 searches/mo` in 1768–1805 ms | **FIXED** for the spin; see NEW-4 (the success line is on screen ~106 ms) | `logs/timing-b2.json`; `b2-08-ai-gemini-checking.png`, `b5-03-discovery-saving.png`, `b5-04-discovery-fuel-verified.png` |
| **C7** — at 390×844 Beats 4–5 run long and the action buttons are not reachable without scrolling | B4 / B5 | `UGLY` (mobile) | At 390×844 the primary `Looks like me →` is docked and fully on screen without scrolling (y 790.4 → 832.0, viewport 844). No horizontal overflow anywhere: `document.scrollWidth === clientWidth === 390` on S0, B1, B2, B3, B4 | **FIXED** | `b4-m01-fit-390.png`, `b3-m01-resume-390.png`, `b3-m02-templates-390.png` |
| **NEW-1** — the legacy celebration modal renders on top of Beat 6 and blocks its actions | B6 | — | `#onboardingCelebration` (`role="dialog" aria-modal="true" aria-hidden="false"`, `pointer-events: auto`, `z-index: 100002`, 1440×900) covers the payoff and repeats it: "You're live." / "That was the one-time part…" / **✓ PROFILE ✓ JOB DISCOVERY ✓ OTHER DEVICES** / `See what happens now →` / `or start with your other devices →` | **NEW · BLOCKER** | `b6-01-payoff-initial.png`, `path-b-08-beat6-payoff.png`, `path-d-07-b6-adapted-payoff.png` |
| **NEW-2** — Beat 3's drafting fails on a fresh install with a raw server env error | B3 | — | `POST /profile/from-resume` → **500**; the message slot shows, verbatim: `Missing Gemini API key: set PROFILE_GEMINI_API_KEY, ATS_GEMINI_API_KEY, or GEMINI_API_KEY.` Reproduced in **all five** runs, at both viewports, with a provider key verified one beat earlier | **NEW · BLOCKER** | `b3-05-resume-drafting.png`, `b3-06-resume-draft-result.png` |
| **NEW-3** — B5's "Save & verify" reports the Google Jobs index connected without contacting SerpApi | B5 | — | The whole action is two same-origin POSTs: `/__proxy/discovery-env-key` and `/__proxy/full-boot?port=8644&skip_tunnel=1&force_restart=1`. `contactedSerpApi: false`. A 64-character all-zeros key produced `✓ Google Jobs index connected — 100 searches/mo` in **71 ms** | **NEW · MISMATCH** | `logs/extras.json → fuelSave`; `path-d-04-b5-bad-serpapi-entered.png`, `path-d-05-b5-serpapi-result.png` |
| **NEW-4** — the promised B2 success line is on screen for ~106 ms | B2 | — | `✓ Connected — gemini-3.5-flash responded` first sampled at 1612 ms; the beat is replaced at 1718 ms | **NEW · CONFUSING** | `logs/timing-b2.json` |
| **NEW-5** — an open demo-card detail makes the S0 corner pill unclickable | S0 | — | `.oneflow-demo__detail` is `position: fixed`, `z-index: 5`, 360×197.3 at (1060, 682.8); the pill is 225.6×36 at (1067.4, 768.4). `document.elementFromPoint` at the pill's centre returns `.oneflow-demo__detail-score`. The detail has no close control (`detailHasCloseButton: false`) | **NEW · BLOCKER** | `s0-03-collapsed-pill.png` |
| **NEW-6** — after Escape from a beat there is no control that returns to it | B4 → board | — | Post-Escape the page has `demoBoard: false, pill: false, invite: false`. What is offered is the legacy what's-next banner: "Finish setting up JobBored / You're connected. Job discovery and your other devices are the last two steps…" with `Turn on job discovery` and `Use JobBored on other devices`. A page reload restores the shell at the saved beat | **NEW · CONFUSING** | `path-c-06-b4-escaped-toast.png`, `path-c-07b-b4-reload-recovery.png` |
| **NEW-7** — the resume draft typed into Beat 3 is lost on refresh | B3 | — | 400 characters in `#oneFlowResumePaste` before the refresh; `""` after it, on the same resumed beat | **NEW · MISMATCH** | `path-c-02-b3-before-refresh.png` → `path-c-03-b3-after-refresh.png` |
| **NEW-8** — the pinned Gemini model 404s on every first call | B2 | — | `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-flash:generateContent` → **404** on every run, followed by `[JobBored] Gemini model "gemini-flash" was rejected; retrying with gemini-3.5-flash.` (`resume-generate.js:579`). The retry succeeds | **NEW · ERROR** (recovered) | §Every console error seen |
| **NEW-9** — B5's numbered steps glue the step marker to the previous sentence | B5 | — | On screen: `1. Create a free SerpApi account (Google login works, no card needed).1 · Create your free account ↗` and `2. Copy your API key from the dashboard — it's the first thing on the page.2 · Copy your API key ↗` | **NEW · UGLY** | `b5-01-discovery-initial.png`, `b5-04-discovery-fuel-verified.png` |
| **NEW-10** — Beat 6's sub-line renders twice | B6 | — | Beat text begins `That was the one-time part. From here, JobBored works for you.` as the shell lede **and** again as the first line of the beat body | **NEW · UGLY** | `b6-01-payoff-initial.png`, `logs/extras.json → payoff.beatLines` |
| **NEW-11** — B2's pre-selected provider is Gemini, not the OpenRouter the spec names | B2 | — | `data-provider="gemini"` carries `selected: true, aria-pressed: "true"` and the note "Recommended."; the sub reads "…Gemini Flash is the recommended pin; OpenRouter is a free alternative." Spec §5 B2 names `OpenRouter — free` as "(pre-selected, recommended)" and its sub as "OpenRouter is free and takes about two minutes." | **NEW · MISMATCH** (copy drift vs the spec) | `b2-01-ai-initial.png`; `logs/obs-path-a-desktop.json → provider-cards` |
| **NEW-12** — the "Can't reach the endpoint." error names no next action | B5 | — | Message slot text, in full: `Can't reach the endpoint.`, after `POST https://<machine>.<tailnet>.ts.net/webhook` failed at 15002 ms. Spec §8.4: "Every error names the next action" | **NEW · CONFUSING** (seen on one of two connect attempts) | recorded observation only — no surviving still; the walk that shipped its media is the *successful* second attempt (see Path A / Beat 5) |
| **NEW-13** — a 500-px-tall red toast breaks one word per line over the gate | S0 / gate | — | Toast text, verbatim: "The discovery worker needs a webhook secret. The browser-use worker fail-closes on empty or mismatched x-discovery-secret. Run \`npm run discovery:bootstrap-local\` on this machine and reload — the dashboard autofills the secret. Or paste it into Discovery drawer → Connection → Discovery webhook secret." It renders in a ~355 px column with almost every line holding a single word, covers the gate's own headline and its `Set up JobBored for this account` button, and its `Copy bootstrap command` button overlaps its own text. Seen on the Path B boot; **not** reproduced on 5/5 clean `?greenfield=1` cold starts | **NEW · UGLY** (intermittent) | `path-b-01-landing-gate.png`; `logs/toast-probe.json` (0/5) |
| **NEW-14** — after any resume, Beat 4 comes back empty and cannot be completed | B4 | — | Re-entering Beat 4 after a reload renders three empty cards, `Seniority` reset to `Any`, and three validation errors on `Looks like me →`: `Add at least one target role.` · `Add at least one strength.` · `Keep the narrative between 20 and 1200 characters.` The spine still shows `RESUME` done. The beat could not be advanced in 31.5 s of trying, and re-picking a starter template did not clear it | **NEW · BLOCKER** | `path-c-07b-b4-reload-recovery.png`, `path-c-07c-b4-confirm-after-resume.png` |

Chrome's `config.js` 403 and the "What is waiting on you" strip above the gate
are tagged `KNOWN` and are not counted as findings; both are recorded once in
§Every console error seen.

## Summary of new findings

Ranked by how far they are from the spec's own success criteria.

1. **NEW-1 · B6 · BLOCKER.** The flow's final screen ships two "You're live"
   screens at once. The one on top is the pre-SIXBEATS celebration — the
   three-circle `✓ PROFILE ✓ JOB DISCOVERY ✓ OTHER DEVICES` row with its own
   primary `See what happens now →` and an `or start with your other devices →`
   link. It is `aria-modal="true"`, `pointer-events: auto`, `z-index: 100002`,
   full-viewport, and it does not go away on its own. Beat 6's own actions
   (`Run discovery now` / `Take me to my dashboard`, and in the skipped-connect
   variant `Go to my dashboard` / `Actually — connect discovery`) sit behind it
   and cannot be clicked. Observed identically on Path A (connected), Path B
   and Path D (skipped connect). Spec §5 B6 and §7 both say this screen should
   not exist.
2. **NEW-2 · B3 · BLOCKER.** With a provider key live-verified one screen
   earlier, `Draft from this text` returns a 500 in ~0.3 s and prints the
   server's env-var names to the user. Every run reached Beat 4 only by taking
   the template fallback.
3. **NEW-3 · B5 · MISMATCH.** "Save & verify" never talks to SerpApi. A
   64-zero key is reported as `✓ Google Jobs index connected — 100 searches/mo`
   in 71 ms.
4. **NEW-5 · S0 · BLOCKER.** Open a demo card, then press "Poke around first":
   the read-only detail is fixed over the corner the pill lands in, has no
   close control, and swallows the pill's clicks. Only a reload recovers.
5. **NEW-6 · CONFUSING.** "Setup paused — pick up right here anytime." is true
   of the stored state and false of the screen: nothing on the page re-opens
   the paused beat.
6. **NEW-14 · B4 · BLOCKER.** The flow resumes at the right beat and hands
   back an empty one. Re-entering Beat 4 after a reload shows three blank cards
   and
   refuses to advance: `Add at least one target role.` / `Add at least one
   strength.` / `Keep the narrative between 20 and 1200 characters.` The only
   way past it observed in this run was a brand-new greenfield pass.
7. **NEW-7 · MISMATCH.** The same class one beat earlier: the resume text
   typed into Beat 3 does not survive the refresh that the beat itself
   survives.
8. **NEW-4, NEW-8 … NEW-13** are the smaller ones: a success line that flashes,
   a 404-then-retry on every Gemini call, glued list markers, a duplicated
   sub-line, provider copy that has drifted from the spec, a terse connect
   error, and an intermittent full-height red toast.

All ten 09-01 findings (U1, U2, U3, C1–C7) are fixed on this build. None
regressed. Two carry a caveat rather than a qualification of the fix: C5's
toast now appears but promises a re-entry the screen does not offer (NEW-6),
and C6's stages now render but the success line they end on is legible for
about a tenth of a second (NEW-4).

## Environment

| | |
|---|---|
| Repo / worktree | `/Users/emilionunezgarcia/Job-Bored.worktrees/sixbeats-qa` (worktree of `main`) |
| Commit | `cf0da4d` — `git rev-parse --short HEAD` |
| Dashboard | `PORT=8095 node dev-server.mjs` → `http://localhost:8095` (never 8080) |
| Local API | `http://127.0.0.1:3847` — **already listening** when this run started (the founder's instance, pid 57770, started from `/Users/emilionunezgarcia/Job-Bored`). `npm run start:scraper` was therefore not run: the port was occupied by the same service. `GET /health` → 200, `GET /profile` → 200 |
| Discovery worker | `http://127.0.0.1:8644` — already listening (pid 15055), `GET /health` → 200 |
| Tailscale | installed (`/usr/local/bin/tailscale`), logged in, this machine online |
| Browser | Chromium 145.0.7633.0 via Playwright 1.61.1, headless |
| Viewports | 1440×900 (all paths) and 390×844 (Path A mobile) |
| Node | v24.13.0, macOS (Darwin 27.0.0) |

### Headless adaptations (each one is a deviation from a human walkthrough)

1. **Google sign-in is faked**, using the same disposable session
   `tests/e2e-journey` stages (`tests/e2e-fixtures/hermetic-harness.mjs`):
   `command_center_config_overrides` + `command_center_oauth_session` +
   `command_center_oauth_runtime` in storage, `accounts.google.com/gsi/client`
   replaced by the harness's stub, `sheets.googleapis.com` answered with a
   headers-only Pipeline. Beat 1 is documented exactly as it paints, then
   completed through `JobBoredOneFlow.completeBeat("google")`. **Consequence:**
   the pipeline behind the flow can never receive a real row, so "did a job
   card appear" is not answerable in this run — see Path A / Beat 6.
2. **Path B's real second Google account is `BLOCKED-needs-human`.** A second
   live OAuth grant cannot be performed headlessly. Per the lane brief, Path B
   instead covers the gate's `Set up JobBored for this account` action with a
   second fake identity whose sheet answers 403.
3. **DevTools cannot be opened headlessly.** Console and network telemetry is
   painted into the page as a fixed overlay (bottom-right, "DevTools · Console
   + Network") so it is present throughout every recording; the overlay is
   hidden for the duration of each screenshot. See §Note on C1.
4. **Path D's invalid SerpApi key was never written to disk.** For that run
   only, `POST /__proxy/discovery-env-key` and `POST /__proxy/full-boot` were
   answered with the dev server's own success shape
   (`{"ok":true,"key":"SERPAPI_API_KEY","mode":"updated"}`) so a knowingly
   bogus key could not be installed into the founder's live worker env. Every
   other run wrote for real, with the key that was already there.
5. **The B2 key.** `resumeOpenRouterApiKey` in `config.js` is dead:
   `GET https://openrouter.ai/api/v1/key` with it returns **401 `{"error":
   {"message":"User not found.","code":401}}`**, and the beat says so —
   `Your OpenRouter API key is invalid. Paste a valid free key from
   https://openrouter.ai/keys.` That step is **BLOCKED-needs-human**. The walk
   continued on the provider the beat itself pre-selects, with the live
   `BROWSER_USE_DISCOVERY_GEMINI_API_KEY` from
   `~/.jobbored/browser-use-discovery/.env` (verified independently: `GET
   https://generativelanguage.googleapis.com/v1beta/models` → 200).
6. **This machine's `~/.jobbored/profile.json` was overwritten** by Beat 4's
   own `POST /profile` (the server also writes its own `.bak`). A copy taken
   before the run was held outside the repo and has been restored — see
   §Restored state.
7. **Path A's Beat 5 was walked twice**, forty minutes apart, because the first
   Tailscale connect attempt failed and the second succeeded. The media in
   `media/` is from the second walk; the first attempt's observation is
   reported as NEW-12 with its message, timing and network row but no still.

### Environment-conditioned noise (not product findings)

`http://127.0.0.1:3847/api/applications`, `/api/applications/queue` and
`/api/llm-config` are refused by CORS from origin `http://localhost:8095` — the
listening API was started by the founder's `:8080` instance. Recorded here so
the console section is complete, and excluded from the verdicts.

### Note on C1

Four capture runs logged an uncaught
`TypeError: Cannot read properties of null (reading 'appendChild')` at
`<anonymous>:15:28`. Line 15 of the harness's injected overlay is
`document.documentElement.appendChild(style)`. The overlay was hardened, and
the two runs after that (Path C's rerun and the dedicated cold-start probe,
which lists **every** request the page makes) log **zero** page errors. The C1
verdict is taken from those runs. The `appendChild` error in
`logs/obs-path-b.json`, `logs/obs-path-d.json` and `logs/obs-path-a-mobile.json` is this
harness's, and is excluded from §Every console error seen.

---

## Path A — zero-config, desktop 1440×900

Recording: `path-a-desktop.webm`.

### S0 — the demo board

- **Screenshot:** `s0-01-cold-start.png`
- **Copy on screen vs the spec (§4):**

| Slot | On screen | Spec |
|---|---|---|
| Header strip | `JobBored` · `SAMPLE PIPELINE — THIS IS WHAT A SET-UP JOBBORED LOOKS LIKE.` | (not in §4; added by lane V1 for U1) |
| Headline | `This is your job hunt on autopilot.` | `This is your job hunt on autopilot.` ✓ |
| Sub | `Set it up once — about fifteen focused minutes — and roles scored against your fit land here every morning. Your resume and pipeline stay in your Google Sheet and on this machine.` | identical ✓ |
| Primary | `Make it mine — 15 min, once` | `Make it mine — 15 min, once` ✓ |
| Secondary | `Poke around first` | `Poke around first` ✓ |
| Spine | — (S0 is the dashboard, not the shell) | — |

- **Board:** 8 demo cards across `NEW · RESEARCHING · APPLIED · PHONE SCREEN ·
  INTERVIEWING · OFFER`, each with a `DEMO` chip, a fit percentage and a
  one-line reason. Frame 1180×750; invitation 468×221.2 inside it.
- **Time:** 1713 ms from `page.goto` to a settled first screen. FCP 152 ms,
  DOMContentLoaded 178 ms, load 195 ms.
- **URL after load:** `http://localhost:8095/` — `?greenfield=1` is gone.
- **Console/network:** `GET /config.js → 403` and the MIME refusal that follows
  it (`KNOWN`). `GET http://127.0.0.1:3847/api/applications → net::ERR_FAILED`
  (CORS, environment). No uncaught errors.
- **Tag:** `OK` · **U1: FIXED** · **C1: FIXED** · **C4: FIXED**

#### Demo card detail

- **Screenshot:** `s0-02-demo-card-detail.png` (+0.8 s)
- Clicking the first card opens a read-only aside (`aria-readonly="true"`):
  `DEMO · Senior Product Designer, Design Systems · Figma · Remote — US · 2 days
  ago · Fit 94 / 100 · Design-systems ownership is the exact work in your top
  strength, at the scale you asked for. · Sample data — your own roles land here
  once you're set up.`
- **Tag:** `OK`

#### "Poke around first" with that detail still open

- **Screenshot:** `s0-03-collapsed-pill.png` (+0.9 s)
- The invitation collapses (`invitePresent: 0`) to `Set up JobBored — 15 min ▸`
  (225.6×36 at 1067.4, 768.4). The still-open detail (`position: fixed`,
  `z-index: 5`, 360×197.3 at 1060, 682.8) sits over it;
  `document.elementFromPoint` at the pill's centre returns
  `.oneflow-demo__detail-score` ("Fit 94 / 100"). The detail carries no close
  control. Thirty seconds of retried clicks on the pill did nothing.
- **Tag:** `BLOCKER` (recovers only by reloading) · **NEW-5**

#### Second load, then the documented route

- **Screenshots:** `s0-05-pill-clean.png` (the pill after "Poke around first"
  with no detail open: fully in viewport, `clickable: true`),
  `s0-06-pill-opens-flow.png` (the pill opens the shell at Beat 1, 0.9 s).
- The fresh load (2.5 s) brought the invitation back — `invitePresent: 1`,
  `pillPresent: 0`, spec §4's "a fresh page load shows the invitation card
  again, never the bare board". Its screenshot was **byte-identical** to
  `s0-01-cold-start.png`, so only the one file is kept.
- **Tag:** `OK`

#### Escape out of the flow, and a third load

- **Screenshot:** `s0-07-escape-back-to-board.png`
- Escape raises `Setup paused — pick up right here anytime.` (`.toast.toast-info`)
  and returns to the board with the pill in place. **C5: FIXED.**
- A third load paints pixel-identically to the first two; all three cold-start
  stills hashed the same, so `s0-01-cold-start.png` is the single kept file.
- **Tag:** `OK`

### Beat 1 — Connect Google

- **Screenshots:** `b1-01-google-initial.png`,
  `b1-02-google-detour-expanded.png`, `b1-03-google-existing-sheet.png`,
  `b1-04-google-back-to-signin.png`, `b1-05-google-waiting-stage.png`

| Slot | On screen | Spec §5 B1 |
|---|---|---|
| Header | `Set up JobBored` | — |
| Spine | `GOOGLE`(current) `AI` `RESUME` `YOUR FIT` `DISCOVERY` `DONE` — one row, one system | "six segments" ✓ |
| Time label | `about 15 min left` | "~3–15 min" ✓ |
| Headline | `Your pipeline lives in a Google Sheet you own.` | identical ✓ |
| Sub | `Sign in and we'll create it for you. Nothing is stored on our side — there is no 'our side.'` | identical ✓ |
| Body | `We ask for one permission: your Google Sheets. The sheet is created in your Drive, owned by you, and readable only by you.` | §8.3 privacy sentence ✓ |
| Detour | `First time? You'll need a free Client ID` → "Google makes you mint your own key before it will let an app touch your Sheets. It takes about 10 minutes and it is genuinely tedious. You only ever do this once." + `This page's origin: http://localhost:8095` + `Copy` | "honest ~10 minute estimate", "You only ever do this once" ✓ |
| Primary | `Continue with Google` | identical ✓ |
| Secondary | `Connect an existing sheet instead` | identical ✓ |

- `Connect an existing sheet instead` swaps in `Paste the link to a Sheet you
  already use. It needs a Pipeline tab; we'll check we can read it before
  connecting.` with `Connect this sheet` / `Back to sign-in`, and
  `Back to sign-in` restores the initial panel
  (`b1-04-google-back-to-signin.png`).
- `Continue with Google` renders the live stage list
  `◌ Waiting for Google sign-in… · Creating your Pipeline sheet… · Sheet ready ✓`
  (`b1-05-google-waiting-stage.png`).
- **Times:** 1.0 s to first paint; detour 0.8 s; sheet panel 0.8 s; back 0.8 s.
- **Console:** none new.
- **Tag:** `OK` · **U2: FIXED** (one spine, no second rail)
- **Headless adaptation:** the grant itself is faked here (§Environment 1).

### Beat 2 — Give it a brain

- **Screenshots:** `b2-01-ai-initial.png`, `b2-02-ai-local-selected.png`,
  `b2-03-ai-openrouter-selected.png`, `b2-04-ai-key-entered.png`,
  `b2-06-ai-openrouter-result.png`, `b2-07-ai-gemini-key-entered.png`,
  `b2-08-ai-gemini-checking.png`
- Two stills could not be taken, and the reason is itself an observation. The
  in-flight capture 600 ms after `Check & continue` on the dead OpenRouter key
  was byte-identical to the result capture — the 401 had already landed. And
  the capture aimed at B2's success state was byte-identical to
  `b3-03-resume-back-to-intake.png`: by the time it fired, the beat had
  already been replaced (NEW-4).

| Slot | On screen | Spec §5 B2 |
|---|---|---|
| Spine / time | `AI` current · `about 10 min left` | "~2 min" — the label is the flow's remainder, not the beat's |
| Headline | `Now give it a brain.` | identical ✓ |
| Sub | `One AI key powers everything personal here: it drafts your fit profile from your resume on the next screen, scores every job discovery finds, and writes your tailored resumes and cover letters. **Gemini Flash is the recommended pin; OpenRouter is a free alternative.**` | "…**OpenRouter is free and takes about two minutes.**" — **differs** (NEW-11) |
| Cards | `Gemini` **selected, "Recommended."** · `OpenRouter — free` · `OpenAI` · `Anthropic` · `Local — on your machine` | "`OpenRouter — free` (pre-selected, recommended)" — **differs** (NEW-11) |
| CORS note | OpenAI/Anthropic both read `Paid. It runs through the local server — keep npm start running.` | "runs through the local server — keep `npm start` running" ✓ |
| Steps | `1. Create a free OpenRouter account ↗ · 2. Copy your key. · 3. Paste it here.` | three numbered steps ✓ |
| Privacy | `The key is stored in this browser and sent only to the provider you picked.` | §8.3 ✓ |
| Gemini bonus | `Your Gemini key also unlocks URL import and grounded search — done, no extra step.` | identical ✓ |
| Primary | `Check & continue` | identical ✓ |

- **The authorised key fails.** With `OpenRouter — free` selected and
  `resumeOpenRouterApiKey` from `config.js` pasted, `Check & continue` returns
  in **534–583 ms** with
  `Your OpenRouter API key is invalid. Paste a valid free key from
  https://openrouter.ai/keys.` (`b2-06-ai-openrouter-result.png`), plus a
  `Having trouble?` block covering wrong-key, rate-limit and CORS. Network:
  `POST https://openrouter.ai/api/v1/chat/completions → 401`. Verified outside
  the browser: `GET https://openrouter.ai/api/v1/key` → 401 `"User not found."`
  → **BLOCKED-needs-human**; the app's behaviour here is correct and honest.
- **The live key passes.** Switching to `Gemini` clears the field; with the
  worker-env key the check runs `◌ Checking your key…` → `✓ Connected —
  gemini-3.5-flash responded` and auto-advances. Sampled at 100 ms:
  61 ms / 1612 ms / 1718 ms (NEW-4 — the success line is legible for ~106 ms).
- **Console:** `POST …/models/gemini-flash:generateContent → 404`, then
  `[JobBored] Gemini model "gemini-flash" was rejected; retrying with
  gemini-3.5-flash.` (`resume-generate.js:579`) — NEW-8. Then
  `POST http://127.0.0.1:3847/api/llm-config` CORS-blocked and
  `[JobBored] llm-config pin POST failed: Failed to fetch`
  (`oneflow-beat-ai.js:525`) — environment.
- **Tags:** `OK` (verification behaviour) · `MISMATCH` (NEW-11) ·
  `CONFUSING` (NEW-4) · `ERROR`, recovered (NEW-8) · **C6: FIXED**

### Beat 3 — Hand us your resume

- **Screenshots:** `b3-01-resume-initial.png`, `b3-02-resume-templates.png`,
  `b3-03-resume-back-to-intake.png`, `b3-04-resume-pasted.png`,
  `b3-05-resume-drafting.png`, `b3-06-resume-draft-result.png`,
  `b3-07-resume-template-picked.png`, `b3-m01-resume-390.png`,
  `b3-m02-templates-390.png`

| Slot | On screen | Spec §5 B3 |
|---|---|---|
| Spine / time | `RESUME` current · `about 8 min left` | "~1 min" |
| Headline | `Drop in your resume. We'll do the typing.` | identical ✓ |
| Sub | `From this one file we'll draft your whole fit profile — target roles, strengths, what you want, what to avoid. You'll review everything on the next screen; nothing is saved until you approve it.` | identical ✓ |
| Dropzone | `Drag your resume here — PDF, Word, or plain text.` + `Choose File` | drag/paste/browse ✓ |
| Paste | `…OR PASTE THE TEXT INSTEAD` | ✓ |
| Privacy | `Your resume stays in this browser and on this machine. We send the text to the AI provider you connected on the last screen, and nowhere else.` | §8.3 ✓ |
| Actions | `Draft from this text` · `I'd rather start from a template` | ✓ |

- **C2 is fixed.** The template grid (`Marketer`, `Engineer`, `Product
  Manager`, `Start blank`) carries `Back to upload or paste`, and it returns to
  the intake screen (`b3-02` → `b3-03`, 0.8 s). Present at 390×844 too.
- **Drafting fails (NEW-2).** 1500 characters of a synthetic resume pasted;
  `Draft from this text` → `POST http://localhost:8095/profile/from-resume`
  → **500** in 263–297 ms. The message slot
  (`discovery-setup-wizard__message--error`) reads, verbatim:

  > `Missing Gemini API key: set PROFILE_GEMINI_API_KEY, ATS_GEMINI_API_KEY, or GEMINI_API_KEY.`

  No stage line ever advanced; the promised
  `Reading your resume ✓ → Drafting target roles & strengths… → Writing your
  first-person narrative… → Draft ready ✓` never rendered. Reproduced in all
  five runs (Path A desktop, Path A mobile, Path B, Path C, Path D) with a
  provider verified one beat earlier. The same endpoint answers the same way to
  a bare `curl` on both `:8095` and `:3847`.
- **Continued via the documented fallback.** `I'd rather start from a
  template` → `Marketer` → Beat 4 in 1.2 s (`b3-07-resume-template-picked.png`).
- **Tags:** `BLOCKER` (NEW-2) · `OK` (C2, privacy copy) · **C2: FIXED**

### Beat 4 — Confirm your fit

- **Screenshots:** `b4-01-fit-initial.png`, `b4-02-fit-details-1.png`
  (`Edit details` expanded), `b4-03-fit-details-2.png` (`Raw profile JSON`
  expanded). No "saved" still exists: the capture taken 2.5 s after
  `Looks like me →` was byte-identical to `b5-01-discovery-initial.png`,
  because the beat had already advanced.

| Slot | On screen | Spec §5 B4 |
|---|---|---|
| Spine / time | `YOUR FIT` current · `about 7 min left` | "~2–3 min" |
| Headline | `Here's how we'll judge every job for you.` | identical ✓ |
| Sub | `We drafted this from your resume. Fix anything that's off — this is the one-time part that makes every match yours.` | identical ✓ |
| Card 1 | `Looking for` — role chips + `Add a target role` / `Add`, `Seniority` select showing **`Director`** (a humanised label, not a raw enum), `Anywhere` | ✓ (§5 B4.1) |
| Card 2 | `Your edge` — numbered, reorderable strengths with ↑ ↓ ×, `Add a strength` / `Add`, narrative in italics with `edit` | ✓ (§5 B4.2) |
| Card 3 | `Lean toward / away` — `Lean toward` and `Lean away` chip sets with `Add what you want` / `Add what to avoid` | ✓ (§5 B4.3) |
| Expanders | `Edit details`, `Raw profile JSON` | ✓ (§5 B4.4, "raw JSON lives behind a `details` toggle") |
| Primary | `Looks like me →` | identical ✓ |

- **U3 measurement:** six `Add` controls, each 1 line box, 37.45 × 27.25 at
  1440×900 and 36.28 × 26.34 at 390×844. **FIXED.**
- **C3 measurement:** `Looks like me →` issues exactly one request —
  `POST http://localhost:8095/profile` → **200**
  `{"ok":true,"updatedAt":"2026-09-02T07:29:39.208Z","logoRefresh":{"ok":true}}`
  — and advances to Beat 5 in 2.5 s. **FIXED.**
- **Residual UGLY at 1440×900:** chip labels are clipped without an ellipsis
  and the reorder arrow overlaps the text — on screen: `Director of Performance
  M↑`, `Senior Marketing Manage↑`, `Performanc`, `Brand & co`, `Analytics &`,
  `Channel ma`, `Mix of brand and performa`, `Agency-side account mar`. The
  three cards are also clipped at the card container's bottom edge (the
  narrative cuts mid-sentence at "role where strategy, budget,"). At 390×844
  the same chips clip but the layout is single-column and the primary is
  docked.
- **Tags:** `UGLY` (chip clipping) · `OK` (structure, copy, save) ·
  **U3: FIXED** · **C3: FIXED** · **C7: FIXED**

### Beat 5 — Turn on discovery

- **Screenshots:** `b5-01-discovery-initial.png`,
  `b5-02-discovery-key-entered.png`, `b5-03-discovery-saving.png`,
  `b5-04-discovery-fuel-verified.png`, `b5-05-discovery-connecting.png`

| Slot | On screen | Spec §5 B5 |
|---|---|---|
| Spine / time | `DISCOVERY` current · `about 4 min left` | "~4 min" ✓ |
| Headline | `Now the engine: jobs come to you.` | identical ✓ |
| Sub | `Discovery runs on this computer, searches the job boards overnight, scores each role against your fit, and drops the matches into your pipeline. Only your search terms leave this machine. Set up once; it runs itself.` | identical, all three sentences ✓ |
| Panel 1 | `First, the fuel: Google's job index.` + `Discovery reads job boards directly, but Google's index is the single biggest source — it watches 100+ boards at once. Free key, 100 searches a month — plenty for daily runs. Three steps, about 60 seconds.` | identical ✓ |
| Panel 2 | `Then the connection: let it run on its own.` + `One click sets this up over Tailscale — a free private network between your own devices. Nothing is exposed to the internet.` | ✓ |
| Gate copy | `Add your SerpApi key above first — the engine needs fuel before it needs a connection.` | "Panel 2 renders dimmed until the fuel check passes" ✓ |
| Actions | `Save & verify` · `Set it up for me` (disabled) · `Skip the connection for now — your keys are saved; jobs won't arrive on their own until you connect.` (disabled) | skip label identical to spec ✓ |

- **Panel dimming measured:** panel 2 computed `opacity: 0.55` before the fuel
  check; `Set it up for me` and the skip both start disabled and both enable
  after it. ✓
- **Fuel (NEW-3).** `Save & verify` renders `◌ Saving your key…` → `✓ Saving
  your key… / ✓ Google Jobs index connected — 100 searches/mo` and the message
  `Google Jobs index connected — 100 searches/mo.` in 1768 ms. The complete
  request list for that action is:
  `POST /__proxy/discovery-env-key` and
  `POST /__proxy/full-boot?port=8644&skip_tunnel=1&force_restart=1`.
  `contactedSerpApi: false`. Path D's 64-zero key produced the same success
  line in 71 ms.
- **Connect.** `Set it up for me` renders the four spec stages live:
  `✓ Checked your machine · ✓ Started the discovery worker · ✓ Publishing a
  private URL on your tailnet · ◌ Verifying the connection`. Two attempts, two
  outcomes:
  - **First attempt:** `POST https://<machine>.<tailnet>.ts.net/webhook` failed
    after **15002 ms**; after 34.2 s the message slot read
    `Can't reach the endpoint.` and the beat did not advance (NEW-12 — the
    error names no next action). Also seen:
    `GET /discovery-local-bootstrap.json → 403`. That attempt's stills were
    overwritten by the re-walk; the observation stands on the recorded
    message, timing and network row rather than on a surviving file.
  - **Second attempt (same build, same machine, ~40 minutes later):** the same
    four stages completed and the beat advanced to Beat 6 in **2682 ms**.
    `b5-05-discovery-connecting.png` is from this attempt; the capture taken
    at the end of it was byte-identical to `b6-01-payoff-initial.png`, since
    the beat had already advanced.
- **UGLY (NEW-9):** the numbered steps read
  `1. Create a free SerpApi account (Google login works, no card needed).1 · Create your free account ↗`
  and
  `2. Copy your API key from the dashboard — it's the first thing on the page.2 · Copy your API key ↗`.
  The connect panel is also clipped by the beat body's scroll edge while the
  three action buttons sit below the card.
- **Tags:** `MISMATCH` (NEW-3) · `UGLY` (NEW-9) · `CONFUSING` (NEW-12) ·
  `OK` (stages, dimming, copy)

### Beat 6 — You're live

- **Screenshots:** `b6-01-payoff-initial.png`, `b6-04-payoff-after-run.png`

| Slot | On screen | Spec §5 B6 |
|---|---|---|
| Spine | all six `done`, `DONE` current | ✓ |
| Headline | `You're live.` | `You're live, {firstName}.` — the fallback, since the hermetic session carries no given name |
| Sub | `That was the one-time part. From here, JobBored works for you.` — **rendered twice** (shell lede and first body line, NEW-10) | once |
| Card 1 | `YOUR SEARCH · ROLES Director of Performance Marketing · Senior Marketing Manager · YOUR EDGE Performance marketing · Brand & content · Analytics & experimentation` | ✓ |
| Card 2 | `WHAT HAPPENS NOW · ✓ AI connected — Gemini · ✓ Discovery armed — 2 sources watching, including Google's job index · ✓ Pipeline sheet connected — open it ↗ · ⏱ First matches land tomorrow morning — or run it right now and watch.` | ✓ (the `{n}` slot resolves) |
| Footer | `More power-ups — URL import, grounded search, other devices — live in Settings → Upgrades, each one click, none required.` | identical ✓ |
| Actions | `Run discovery now` · `Take me to my dashboard` | ✓ |

- Card 2 in full, this run:
  `✓ AI connected — Gemini` ·
  `✓ Discovery armed — 2 sources watching, including Google's job index` ·
  `✓ Pipeline sheet connected — open it ↗` ·
  `⏱ First matches land tomorrow morning — or run it right now and watch.`
- **NEW-1 — the screen is unusable.** `#onboardingCelebration` is mounted over
  the beat: `role="dialog"`, `aria-modal="true"`, `aria-hidden="false"`,
  `class="onboarding-celebration onboarding-celebration--in"`,
  `pointer-events: auto`, `z-index: 100002`, `opacity: 1`, `display: flex`,
  box 1440×900 at (0,0). Its content is a second, older payoff screen:
  `You're live.` / `That was the one-time part. From here, JobBored works for
  you.` / `✓ PROFILE  ✓ JOB DISCOVERY  ✓ OTHER DEVICES` /
  `See what happens now →` / `or start with your other devices →`.
  Measured with `document.elementFromPoint` at the centre of the payoff's own
  primary, sampled every 250 ms: `Run discovery now` was covered for the whole
  **29 870 ms** sample and was **still covered** at the end, with
  `#onboardingCelebration` on top.
- **Consequence for the prompt's "click Run discovery now and record until a
  job card appears or 3 minutes pass":** the click had to be forced through the
  overlay. The captures taken immediately after the celebration measurement and
  3 s after the forced click were **byte-identical to
  `b6-01-payoff-initial.png`** — nothing on the page moved — so only the one
  file is kept. Three minutes later (183 207 ms) the celebration was still up
  (`b6-04-payoff-after-run.png`), `sawCard: false`.
- **This last step is `BLOCKED-needs-human`.** The forced run surfaced
  `Google sign-in didn't finish. If the popup was blocked, allow popups for
  this page and press Continue with Google again.` and the toast `✗ Google
  sign-in is not ready yet. Save your OAuth client and reload first.` — both
  are artefacts of the faked session (§Environment 1), not product findings.
  With Google faked, `sheets.googleapis.com` also returns a headers-only
  Pipeline, so no row could reach the board regardless.
- **Tag:** `BLOCKER` (NEW-1) · `UGLY` (NEW-10)

### Post-setup board

- **Screenshot:** `b6-04-payoff-after-run.png` (the two board captures were
  byte-identical to it and were removed).
- There is no post-setup board to photograph: three minutes after `Run
  discovery now`, `#onboardingCelebration` is still the top layer and Beat 6 is
  still the surface underneath it. The board behind the shell was never
  reached in this walk.
- On the earlier run whose connect attempt failed, the shell stayed on Beat 5
  with `Can't reach the endpoint.` and never reached Beat 6 at all.
- **Tag:** `BLOCKER` (downstream of NEW-1)

---

## Path A — mobile 390×844

Recording: `path-a-mobile.webm`. Surfaces re-recorded at phone size: S0 and
Beat 4, plus the beats walked through to reach them.

- **S0** (`s0-m01-cold-start-390.png` — the full-page capture was
  byte-identical and was removed): the
  header strip wraps to two lines; the invitation is the first thing in the
  frame, both buttons on screen and full width; the board stacks to one column
  below it. `document.scrollWidth === clientWidth === 390` — no sideways
  scroll. 1634 ms to a settled screen. **Tag `OK` · U1 FIXED at phone size.**
- **Beat 1** (`b1-m01-google-390.png`): every action on screen except
  `Save Client ID`, which lives inside the collapsed detour (y 1044.2). **`OK`**
- **Beat 2** (`b2-m01-ai-390.png`): the five provider cards stack; `Check &
  continue` on screen. **`OK`**
- **Beat 3** (`b3-m01-resume-390.png`, `b3-m02-templates-390.png`): both
  actions on screen; the template grid's four cards keep their two-line
  descriptions and `Back to upload or paste` is on screen. Drafting fails
  exactly as on desktop (NEW-2). **`BLOCKER` (NEW-2) · C2 FIXED**
- **Beat 4** (`b4-m01-fit-390.png`, `b4-m02-fit-390-full.png`,
  `b4-m03-fit-390-details.png`): **C7's exact claim is fixed** — the primary
  `Looks like me →` is docked at y 790.4–832.0 inside an 844-high viewport and
  needs no scrolling; the body scrolls under it. **U3's exact claim is fixed** —
  every `Add` is one line, 36.28 × 26.34. Chip labels still clip without an
  ellipsis (`Director of Performance Ma↑`), and `Analytics & experiments` is
  cut by the docked footer. **`UGLY` (chips) · C7 FIXED · U3 FIXED**

---

## Path B — second identity

Recording: `path-b-desktop.webm`.

**The real second-account OAuth is `BLOCKED-needs-human`** (§Environment 2).
What is covered instead: the sheet-access gate in its error mode under a second
signed-in identity, and its `Set up JobBored for this account` action.

- **The gate** (`path-b-01-landing-gate.png`, 6.3 s to settle). On screen, in
  order: `JOBBORED` · `DID YOU KNOW? Your pipeline, one glance / Scan cards for
  stage, notes, and follow-ups without digging through rows.` ·
  **`Couldn't load this sheet`** · `Check the Sheet ID and permissions, then try
  again.` · `Settings` · `Reload` · **`Set up JobBored for this account`** ·
  `Signed in as a different account? Set JobBored up for it instead.`
  The `Log in with Google` button is present but `hidden`.
  Network: `GET https://sheets.googleapis.com/v4/spreadsheets/<id>/values/…` →
  403 `PERMISSION_DENIED`, then three JSONP/CSV fallbacks
  (`docs.google.com/…/gviz/tq` → failed, `…?tqx=out:csv` → 404, `…/pub?…` →
  404), then `[JobBored startup] sheets-read:load:fetch-failed
  {initialAccessResolved: false, hasAccessToken: true}`.
  **NEW-13 is visible here**: the red discovery-webhook toast is in the gate's
  DOM, one word per line, with a `Copy bootstrap command` button.
  Also on the boot: `POST http://127.0.0.1:8644/webhook → 401`.
  **Tag `UGLY` (NEW-13) · `OK` (gate copy and controls)**
- **The action** (`path-b-02-account-action.png`, `path-b-03-beat1-google.png`).
  `Set up JobBored for this account` clears the configured sheet
  (`COMMAND_CENTER_CONFIG.sheetId` is `""` afterwards) and hands the surface to
  Beat 1 in 1.4 s, headline `Your pipeline lives in a Google Sheet you own.`
  **Tag `OK`**
- **Beats 2–6 under the second identity** (`path-b-04-beat2-verified-to-beat3.png`,
  `path-b-05-beat4-fit.png`, `path-b-06-beat5-discovery.png`,
  `path-b-07-beat5-fuel-verified.png`, `path-b-08-beat6-payoff.png`). Same
  screens, same copy, same two blockers: Beat 3's draft fails with the same
  verbatim env error, and Beat 6 arrives under the celebration modal. Beat 2
  verified in 2.5 s; Beat 5 fuel in 2.6 s. The connection was skipped in this
  path so the founder's Tailscale bootstrap was not re-run.
  **Tags `BLOCKER` (NEW-2, NEW-1) · `OK` (everything else)**

---

## Path C — interruption

Recording: `path-c-desktop.webm`.

- **Cold start** (byte-identical to `s0-01-cold-start.png`): `urlAfterFirstLoad:
  "http://localhost:8095/"`, `greenfieldStillInUrl: false`. **C4's first half:
  FIXED.**
- **Interruption 1 — refresh inside Beat 3**
  (`path-c-02-b3-before-refresh.png` → `path-c-03-b3-after-refresh.png`,
  3.2 s). After the reload: `beatId: "resume"`, `shellOpen: 1`,
  `flowState: {version: 3, beat: "resume", completedBeats: ["google","ai"],
  skipped: {}, completed: false}`, URL still clean, invitation and pill both
  absent (the shell owns the screen). **C4: FIXED.**
  **NEW-7:** the 400 characters typed into `#oneFlowResumePaste` before the
  refresh are `""` after it. **Tags `OK` (resume) · `MISMATCH` (NEW-7)**
- **Interruption 2 — Escape inside Beat 4**
  (`path-c-05-b4-before-escape.png` → `path-c-06-b4-escaped-toast.png`, 0.9 s).
  The toast reads exactly `Setup paused — pick up right here anytime.`
  (`.toast-container` > `.toast.toast-info` > `.toast-icon` "i" +
  `.toast-message`). **C5: FIXED.**
  **NEW-6 — what it lands on:** `demoBoard: false`, `pill: false`,
  `invite: false`. The page is the real dashboard
  (`Job Bored · 01 BRIEF · 02 PIPELINE · 03 DOSSIER · RUN DISCOVERY · TODAY`)
  carrying the legacy what's-next banner: `Setup / Finish setting up JobBored /
  You're connected. Job discovery and your other devices are the last two steps
  — pick up where you left off.` with `Turn on job discovery`, `Use JobBored on
  other devices`, `Dismiss`, `Later`, `Don't show again`. None of those returns
  to Beat 4. (The capture taken after that inspection was byte-identical to
  `path-c-06-b4-escaped-toast.png` — the screen had not changed — so one file
  is kept.) A page reload does re-open the shell
  (`path-c-07b-b4-reload-recovery.png`: `beatId: "fit"`, `shellOpen: 1`).
  **Tags `OK` (C5 toast) · `CONFUSING` (NEW-6)**
- **NEW-14 — what the resumed Beat 4 contains.** `path-c-07b` shows the beat
  back on screen after the reload. `path-c-07c-b4-confirm-after-resume.png`
  shows what pressing `Looks like me →` there produces: `Looking for` is empty
  under `Add at least one target role.`, `Your edge` is empty under `Add at
  least one strength.` and `Keep the narrative between 20 and 1200
  characters.`, `Lean toward / away` is empty, and `Seniority` has fallen back
  to `Any`. The captured card text is exactly:
  `Looking for · Add at least one target role. · Add · Seniority · Intern Entry
  Mid Senior Staff Principal Manager Director Head VP C-level Any · Anywhere ·
  Your edge · Add at least one strength. · Add`.
  31.5 s of attempts did not advance the beat; re-entering Beat 3 and picking a
  starter template again did not clear it either.
  **Tag `BLOCKER` (NEW-14)**
- **Interruption 3 — refresh inside Beat 5**
  (`path-c-08-b5-before-refresh.png` → `path-c-09-b5-after-refresh.png`,
  3.4 s). Because of NEW-14 the interrupted walk could not be carried into
  Beat 5, so Beat 5 was reached by a fresh `?greenfield=1` pass **inside the
  same recording**. Before the refresh: `beatId: "discovery"`, 24 characters
  typed into `#oneFlowSerpApiKeyInput`. After it: `beatId: "discovery"`,
  `shellOpen: 1`, `flowState: {beat: "discovery", completedBeats:
  ["google","ai","resume","fit"], skipped: {}, completed: false}`, URL clean,
  connect panel correctly back to `opacity: 0.55` with `Add your SerpApi key
  above first — the engine needs fuel before it needs a connection.` The
  resume itself is correct. The 24 typed characters are gone
  (`keyDraftLength: 0`) — NEW-7's class again, one beat later.
  **Tags `OK` (resume) · `MISMATCH` (NEW-7)**

---

## Path D — honest failures

Recording: `path-d-desktop.webm`.

- **Beat 2, wrong OpenRouter key** (`path-d-01-b2-bad-key-entered.png` →
  `path-d-02-b2-error-state.png`). A 64-zero `sk-or-v1-…` key. In **534 ms**:
  `POST https://openrouter.ai/api/v1/chat/completions → 401`, the beat stays on
  `ai`, and the message slot reads
  `Your OpenRouter API key is invalid. Paste a valid free key from
  https://openrouter.ai/keys.` A `Having trouble?` block covers all three cases
  the spec asks for: `Wrong key: keys are easy to truncate on copy…`,
  `Rate limit or no credit: free tiers throttle…`,
  `Blocked by the browser (CORS): OpenAI and Anthropic refuse direct browser
  calls, so they run through t…`. Recovery on a live key advances normally
  (`path-d-03-b2-recovered.png`). **Tag `OK`.**
- **Beat 5, wrong SerpApi key** (`path-d-04-b5-bad-serpapi-entered.png` →
  `path-d-05-b5-serpapi-result.png`). A 64-zero key. In **71 ms** the message
  slot renders, in the **success** tone
  (`discovery-setup-wizard__message--success`),
  `Google Jobs index connected — 100 searches/mo.`, both stages tick, and both
  `Set it up for me` and the skip become enabled (`connectEnabled: true`,
  `skipEnabled: true`). No request to `serpapi.com` was made — see NEW-3 and
  §Environment 4 for the interception that kept this key off disk.
  **Tag `MISMATCH` (NEW-3).**
- **Beat 5, "Skip the connection for now"** (the still was byte-identical to
  `path-d-05-b5-serpapi-result.png` and was removed — the skip becomes enabled
  without any other change on screen). Label verbatim:
  `Skip the connection for now — your keys are saved; jobs won't arrive on
  their own until you connect.` — identical to spec §5 B5. Advances to Beat 6
  in 2.0 s. **Tag `OK`.**
- **Beat 6, skipped-connect variant** (`path-d-07-b6-adapted-payoff.png`).
  Card 2 reads `✓ AI connected — Gemini` ·
  `○ Connection is off — your AI and Google-index keys are saved; connect
  anytime from the banner below` · `✓ Pipeline sheet connected — open it ↗` ·
  `⏱ First matches land tomorrow morning — or run it right now and watch.`
  Actions: `Go to my dashboard` (primary) and `Actually — connect discovery`.
  All four strings match spec §5 B6's skipped variant. The ETA line still says
  "or run it right now and watch" on a screen with no run action.
  **The celebration modal blocks both actions (NEW-1)**: 30 s of retried clicks
  on `Go to my dashboard` were intercepted by `#onboardingCelebration` every
  time, and the run ended there. **Tags `OK` (copy) · `BLOCKER` (NEW-1).**

---

## Every console error seen (deduplicated, verbatim, with surface)

Harness-originated entries are excluded (§Note on C1). Environment-conditioned
entries are marked.

| Surface | Verbatim | Note |
|---|---|---|
| boot (every path) | `Failed to load resource: the server responded with a status of 403 (Forbidden)` — `/config.js` | `KNOWN` |
| boot | `Refused to execute script from 'http://localhost:8095/config.js' because its MIME type ('text/plain') is not executable, and strict MIME type checking is enabled.` | `KNOWN` |
| boot | `[JobBored startup] window:error {kind: resource, target: http://localhost:8095/config.js}` (`/:94:27`) | `KNOWN` |
| boot | `Access to fetch at 'http://127.0.0.1:3847/api/applications' from origin 'http://localhost:8095' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.` | environment |
| boot | `Failed to load resource: net::ERR_FAILED` — `http://127.0.0.1:3847/api/applications` | environment |
| boot (Path B) | `Failed to load resource: the server responded with a status of 401 (Unauthorized)` — `http://127.0.0.1:8644/webhook` | |
| boot (Path B) | `[JobBored] Sheets API read failed: 403 {code: 403, message: The caller does not have permission to access this spreadsheet., status: PERMISSION_DENIED}` (`sheets-read-load.js:305`) | Path B's staged 403 |
| boot (Path B) | `[JobBored] JSONP script error for Pipeline` (`sheets-read-load.js:226`) | |
| boot (Path B) | `[JobBored] JSONP failed for Pipeline: Script load failed for Pipeline` (`sheets-read-load.js:377`) | |
| boot (Path B) | `[JobBored] All fetch attempts failed for Pipeline` (`sheets-read-load.js:401`) | |
| boot (Path B) | `[JobBored startup] sheets-read:load:fetch-failed {initialAccessResolved: false, hasAccessToken: true}` | |
| B2 (every path) | `Failed to load resource: the server responded with a status of 404 ()` — `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash:generateContent?key=<redacted>` | **NEW-8** |
| B2 (every path) | `[JobBored] Gemini model "gemini-flash" was rejected; retrying with gemini-3.5-flash.` (`resume-generate.js:579`) | **NEW-8** |
| B2 (Path A, Path D) | `Failed to load resource: the server responded with a status of 401 ()` — `https://openrouter.ai/api/v1/chat/completions` | dead `config.js` key / Path D's synthetic key |
| B2 (every path) | `Access to fetch at 'http://127.0.0.1:3847/api/llm-config' from origin 'http://localhost:8095' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.` | environment |
| B2 (every path) | `[JobBored] llm-config pin POST failed: Failed to fetch` (`oneflow-beat-ai.js:525`) | environment |
| B3 (every path) | `Failed to load resource: the server responded with a status of 500 (Internal Server Error)` — `/profile/from-resume` | **NEW-2** |
| B4/B6 | `Access to fetch at 'http://127.0.0.1:3847/api/applications/queue' from origin 'http://localhost:8095' has been blocked by CORS policy…` | environment |

**Uncaught page errors from the product: none.** (`extras.json →
coldStart.pageErrors: []`, and Path C's post-fix run logs none.)

**Not seen anywhere, in any run:** `profile_response_invalid`, `GET /profile
404` — the two signatures of C3.

## Every network failure seen (deduplicated)

| Method | URL | Status | ms | Surface |
|---|---|---|---|---|
| GET | `http://localhost:8095/config.js` | 403 | 28–95 | boot, every path (`KNOWN`) |
| GET | `http://127.0.0.1:3847/api/applications` | net::ERR_FAILED | 10–77 | boot (environment) |
| GET | `http://127.0.0.1:3847/api/applications/queue` | net::ERR_FAILED | 3–10 | B4/B6 (environment) |
| POST | `http://127.0.0.1:3847/api/llm-config` | net::ERR_FAILED | 3–6 | B2 (environment) |
| GET | `http://localhost:8095/discovery-local-bootstrap.json` | 403 | 2–21 | boot / B3 / B5 |
| POST | `https://openrouter.ai/api/v1/chat/completions` | 401 | 463–583 | B2 |
| POST | `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash:generateContent` | 404 | 508–554 | B2, every path |
| POST | `http://localhost:8095/profile/from-resume` | 500 | 152–297 | B3, every path |
| POST | `http://127.0.0.1:8644/webhook` | 401 | 4 | boot (Path B) |
| GET | `https://sheets.googleapis.com/v4/spreadsheets/<id>/values/Pipeline!A%3AZZ` | 403 | 2 | boot (Path B, staged) |
| GET | `https://sheets.googleapis.com/v4/spreadsheets/<id>?fields=sheets(properties(title` | 403 | 2 | boot (Path B, staged) |
| GET | `https://sheets.googleapis.com/v4/spreadsheets/<id>/values/Pipeline!A1:Z1` | 403 | 2 | boot (Path B, staged) |
| GET | `https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:json;responseHandler:` | net failure | 882 | boot (Path B, staged) |
| GET | `https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=Pipeline` | 404 | 623 | boot (Path B, staged) |
| GET | `https://docs.google.com/spreadsheets/d/<id>/pub?gid=0&single=true&output=csv` | 404 | 192 | boot (Path B, staged) |
| POST | `https://<machine>.<tailnet>.ts.net/webhook` | net failure | **15002** | B5, first connect attempt |

Requests slower than 2 s: the tailnet webhook above (15.0 s) is the only one.

## Timing: promised "about N min left" vs actual

The label is the flow's remaining total, not the beat's own budget, so the two
columns are not the same quantity — the comparison below is the label against
the wall-clock spent on that beat in this walk.

| Beat | Label on screen | Spec §3.1 budget | Measured on Path A | Notes |
|---|---|---|---|---|
| S0 | — (S0 shows "about fifteen focused minutes" in the invitation) | — | 1.7 s to a settled screen | FCP 152 ms |
| B1 Google | `about 15 min left` | ~3–15 min | 5.2 s of interaction (detour 0.8 s, sheet panel 0.8 s, back 0.8 s, sign-in stage 1.7 s) | the OAuth detour itself is not walked here |
| B2 AI | `about 10 min left` | ~2 min | 0.5 s to the OpenRouter rejection; 1.7 s for the passing check | 61 ms → 1612 ms → 1718 ms sampled |
| B3 Resume | `about 8 min left` | ~1 min | 1.3 s to the 500; 1.2 s from template pick to Beat 4 | drafting never completed |
| B4 Your fit | `about 7 min left` | ~2–3 min | 2.5 s from `Looks like me →` to Beat 5 | reading/editing time not counted |
| B5 Discovery | `about 4 min left` | ~4 min | fuel 1.8 s; connect 34.2 s (failed) / completed on the second attempt | |
| B6 Done | `about done` | — | screen unusable (NEW-1) | |

Sum of the labelled beats' wall-clock in this walk, excluding reading time and
the Google detour: **under one minute of machine time**. The fifteen minutes
the deal promises are dominated by the two external signups and the Cloud
Console detour, none of which this headless run performs.

## Media index

Every file in `media/`, with the section that cites it.

### Recordings

| File | Path | Cited in |
|---|---|---|
| `path-a-desktop.webm` | A, 1440×900 | Path A — zero-config, desktop |
| `path-a-mobile.webm` | A, 390×844 | Path A — mobile |
| `path-b-desktop.webm` | B, 1440×900 | Path B — second identity |
| `path-c-desktop.webm` | C, 1440×900 | Path C — interruption |
| `path-d-desktop.webm` | D, 1440×900 | Path D — honest failures |

### `logs/` — the raw capture records

Eight redacted JSON files, written by the harness during the runs and shipped
so every number in this report can be re-read at source. No secret appears in
any of them (checked against all four live values on this machine).

| File | What it holds |
|---|---|
| `logs/obs-path-a-desktop.json` | Path A desktop: per-capture copy, spine state, buttons, timings, plus the run's full console/network log |
| `logs/obs-path-a-mobile.json` | Path A at 390×844, including every button's box and on-screen flag |
| `logs/obs-path-b.json` | Path B: the gate's DOM text and buttons, then Beats 1–6 |
| `logs/obs-path-c.json` | Path C: `flowState` before and after each interruption, the toast, the post-Escape page inventory |
| `logs/obs-path-d.json` | Path D: both failure messages, the "Having trouble?" text, the B6 variant |
| `logs/extras.json` | The cold-start page-error probe (C1), the `POST /profile` round trip (C3), the fuel-save request list (NEW-3), and the payoff/celebration read |
| `logs/timing-b2.json` | The 100 ms sampling of Beat 2's key check (C6, NEW-4) |
| `logs/toast-probe.json` | Five clean cold starts, toasts found: none (NEW-13) |

### Every file in `media/`

70 files: 65 screenshots and 5 recordings. Verified after the run:
**no two files in this folder are byte-identical**, every filename cited in
this report exists in it, and every file in it is cited here. Fourteen captures
that turned out byte-identical to another were deleted rather than shipped;
each deletion is called out in the section that would have cited it, because
"the screen did not change" is itself part of what was observed.

| File | Bytes | Cited in |
|---|---|---|
| `b1-01-google-initial.png` | 81,341 | Path A / Beat 1 · Verdict U2 |
| `b1-02-google-detour-expanded.png` | 154,673 | Path A / Beat 1 — first-timer detour |
| `b1-03-google-existing-sheet.png` | 79,159 | Path A / Beat 1 — existing-sheet panel |
| `b1-04-google-back-to-signin.png` | 81,353 | Path A / Beat 1 — back to sign-in |
| `b1-05-google-waiting-stage.png` | 86,087 | Path A / Beat 1 — live stage list |
| `b1-m01-google-390.png` | 54,719 | Path A mobile / Beat 1 |
| `b2-01-ai-initial.png` | 115,773 | Path A / Beat 2 · NEW-11 |
| `b2-02-ai-local-selected.png` | 110,747 | Path A / Beat 2 — Local selected |
| `b2-03-ai-openrouter-selected.png` | 109,724 | Path A / Beat 2 — OpenRouter selected |
| `b2-04-ai-key-entered.png` | 110,134 | Path A / Beat 2 — masked key field |
| `b2-06-ai-openrouter-result.png` | 116,737 | Path A / Beat 2 — the dead config.js key rejected |
| `b2-07-ai-gemini-key-entered.png` | 116,364 | Path A / Beat 2 — Gemini selected, key entered |
| `b2-08-ai-gemini-checking.png` | 109,361 | Path A / Beat 2 — live check · Verdict C6 |
| `b2-m01-ai-390.png` | 71,376 | Path A mobile / Beat 2 |
| `b3-01-resume-initial.png` | 95,918 | Path A / Beat 3 |
| `b3-02-resume-templates.png` | 95,481 | Path A / Beat 3 — template grid · Verdict C2 |
| `b3-03-resume-back-to-intake.png` | 95,935 | Path A / Beat 3 — back to intake · Verdict C2 |
| `b3-04-resume-pasted.png` | 114,969 | Path A / Beat 3 — resume pasted |
| `b3-05-resume-drafting.png` | 123,540 | Path A / Beat 3 — draft attempt · NEW-2 |
| `b3-06-resume-draft-result.png` | 123,546 | Path A / Beat 3 — the 500 · NEW-2 |
| `b3-07-resume-template-picked.png` | 159,941 | Path A / Beat 3 — template fallback into Beat 4 |
| `b3-m01-resume-390.png` | 70,723 | Path A mobile / Beat 3 |
| `b3-m02-templates-390.png` | 71,696 | Path A mobile / Beat 3 — template grid · Verdict C2, C7 |
| `b4-01-fit-initial.png` | 159,997 | Path A / Beat 4 · Verdict U3 |
| `b4-02-fit-details-1.png` | 141,744 | Path A / Beat 4 — "Edit details" |
| `b4-03-fit-details-2.png` | 138,231 | Path A / Beat 4 — "Raw profile JSON" |
| `b4-m01-fit-390.png` | 64,794 | Path A mobile / Beat 4 · Verdict C7, U3 |
| `b4-m02-fit-390-full.png` | 64,788 | Path A mobile / Beat 4 — full page |
| `b4-m03-fit-390-details.png` | 64,104 | Path A mobile / Beat 4 — expander open |
| `b5-01-discovery-initial.png` | 148,546 | Path A / Beat 5 · Verdict C3 (the screen it advances to) · NEW-9 |
| `b5-02-discovery-key-entered.png` | 147,258 | Path A / Beat 5 — SerpApi key entered |
| `b5-03-discovery-saving.png` | 134,637 | Path A / Beat 5 — fuel saving · Verdict C6 |
| `b5-04-discovery-fuel-verified.png` | 140,767 | Path A / Beat 5 — fuel verified · Verdict C6 · NEW-9 |
| `b5-05-discovery-connecting.png` | 165,217 | Path A / Beat 5 — the four Tailscale stages |
| `b6-01-payoff-initial.png` | 164,485 | Path A / Beat 6 · NEW-1, NEW-10 · Verdict U2 |
| `b6-04-payoff-after-run.png` | 178,086 | Path A / Beat 6 + post-setup board · NEW-1 |
| `path-a-desktop.webm` | 16,136,597 | Path A — zero-config, desktop |
| `path-a-mobile.webm` | 1,357,532 | Path A — mobile 390×844 |
| `path-b-01-landing-gate.png` | 347,752 | Path B / the gate · NEW-13 |
| `path-b-02-account-action.png` | 346,980 | Path B / "Set up JobBored for this account" |
| `path-b-03-beat1-google.png` | 74,343 | Path B / Beat 1 after the account action |
| `path-b-04-beat2-verified-to-beat3.png` | 91,919 | Path B / Beat 2 verified → Beat 3 |
| `path-b-05-beat4-fit.png` | 155,428 | Path B / Beat 4 |
| `path-b-06-beat5-discovery.png` | 143,867 | Path B / Beat 5 |
| `path-b-07-beat5-fuel-verified.png` | 136,056 | Path B / Beat 5 fuel verified |
| `path-b-08-beat6-payoff.png` | 164,319 | Path B / Beat 6 · NEW-1 |
| `path-b-desktop.webm` | 2,590,202 | Path B — second identity |
| `path-c-02-b3-before-refresh.png` | 113,072 | Path C / interruption 1 · Verdict C4 · NEW-7 |
| `path-c-03-b3-after-refresh.png` | 103,564 | Path C / interruption 1 · Verdict C4 · NEW-7 |
| `path-c-05-b4-before-escape.png` | 164,132 | Path C / interruption 2 — before Escape |
| `path-c-06-b4-escaped-toast.png` | 104,067 | Path C / interruption 2 — the pause toast · Verdict C5 · NEW-6 |
| `path-c-07b-b4-reload-recovery.png` | 101,415 | Path C / interruption 2 — reload recovery · NEW-6, NEW-14 |
| `path-c-07c-b4-confirm-after-resume.png` | 111,221 | Path C / Beat 4 will not confirm after a resume · NEW-14 |
| `path-c-08-b5-before-refresh.png` | 146,448 | Path C / interruption 3 — before refresh |
| `path-c-09-b5-after-refresh.png` | 153,052 | Path C / interruption 3 — after refresh · Verdict C4 · NEW-7 |
| `path-c-desktop.webm` | 5,098,300 | Path C — interruption |
| `path-d-01-b2-bad-key-entered.png` | 109,141 | Path D / Beat 2 — wrong OpenRouter key |
| `path-d-02-b2-error-state.png` | 115,987 | Path D / Beat 2 — the rejection + "Having trouble?" |
| `path-d-03-b2-recovered.png` | 94,696 | Path D / Beat 2 — recovered on a live key |
| `path-d-04-b5-bad-serpapi-entered.png` | 146,492 | Path D / Beat 5 — wrong SerpApi key · NEW-3 |
| `path-d-05-b5-serpapi-result.png` | 140,019 | Path D / Beat 5 — reported connected · NEW-3 |
| `path-d-07-b6-adapted-payoff.png` | 166,750 | Path D / Beat 6 skipped-connect variant · NEW-1 |
| `path-d-desktop.webm` | 3,332,932 | Path D — honest failures |
| `s0-01-cold-start.png` | 156,983 | Path A / S0 · Path C / Cold start · Verdict U1, C1, C4 |
| `s0-02-demo-card-detail.png` | 190,228 | Path A / S0 — demo card detail |
| `s0-03-collapsed-pill.png` | 155,773 | Path A / S0 — "Poke around first" with the detail open · NEW-5 |
| `s0-05-pill-clean.png` | 130,528 | Path A / S0 — the pill with no detail open |
| `s0-06-pill-opens-flow.png` | 85,876 | Path A / S0 — the pill opens Beat 1 |
| `s0-07-escape-back-to-board.png` | 137,025 | Path A / S0 — Escape · Verdict C5 |
| `s0-m01-cold-start-390.png` | 79,757 | Path A mobile / S0 · Verdict U1 |

## Restored state

- `~/.jobbored/profile.json` was rewritten by Beat 4's own `POST /profile`
  during the walks. The copy taken before the first run has been **restored**
  (2 359 bytes, byte-for-byte identical to the original). The server's own
  `profile.json.bak.2026-09-02T07-*` files from this session are left in place.
- `~/.jobbored/resume.txt` did not exist before this run; Beat 3 created it
  with the synthetic fixture text and it has been **deleted**.
- `~/.jobbored/browser-use-discovery/.env` received the SerpApi key it already
  held (identical value) and the Gemini key it already held; the worker was
  force-restarted by Beat 5 in the runs that saved for real. Path D's invalid
  key never reached it (§Environment 4).
- No file in the repository was modified. No git command that writes was run.
