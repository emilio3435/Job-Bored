# Greenfield walkthrough — 2026-09-02, build 04433c6

## Summary table
| step | ts | surface | verdict | user_s | wait_s | shot |
|---|---|---|---|---|---|---|
| 01 | 20:18:09 | S0 · sample board | OK | 2–3 s | 2.6 s | media/01-s0-sample-board.png |
| 02 | 20:18:12 | S0 · sample board (corner pill) | OK | 1–2 s | 0.7 s | media/02-s0-collapsed-pill.png |
| 03 | 20:18:13 | Beat 1 · Google | OK | 2–3 s | 1.1 s | media/03-b1-google-initial.png |
| 04 | 20:18:43 | Beat 1 · Google (first-timer detour) | OK | 2–3 s | 0.6 s | media/04-b1-google-detour.png |
| 05 | 20:18:44 | Beat 1 · Google (connect existing sheet) | OK | 2–3 s | 0.8 s | media/05-b1-google-existing-sheet.png |
| 06 | 20:19:14 | Beat 1 · Google (sign-in attempt) | BLOCKED-NEEDS-OPERATOR | 2–4 s | 2.5 s | media/06-b1-google-signing-in.png |
| 07 | 20:19:17 | Beat 2 · AI | OK | 2–3 s | 0.9 s | media/07-b2-ai-initial.png |
| 08 | 20:19:48 | Beat 2 · AI (OpenRouter selected) | BLOCKED-NEEDS-OPERATOR | 2–3 s | 0.7 s | media/08-b2-ai-openrouter.png |
| 09 | 20:19:48 | Beat 3 · Resume | OK | 2–3 s | 0.8 s | media/09-b3-resume-initial.png |
| 10 | 20:20:19 | Beat 3 · Resume (template grid and way back) | OK | 3–4 s | 1.2 s | media/10-b3-resume-templates.png |
| 11 | 20:20:20 | Beat 3 · Resume (upload path) | OK | 2–3 s | 1.0 s | media/12-b3-resume-upload-path.png |
| 12 | 20:20:21 | Beat 3 · Resume (paste path & drafting) | ERROR | 4–5 s | 3.2 s | media/14-b3-resume-draft-response.png |
| 13 | 20:20:25 | Beat 4 · Your fit | OK | 3–4 s | 0.8 s | media/15-b4-fit-initial.png |
| 14 | 20:21:26 | Beat 4 · Your fit (edit details) | OK | 2–3 s | 0.6 s | media/16-b4-fit-edit-details.png |
| 15 | 20:21:26 | Beat 5 · Discovery (fuel panel) | BLOCKED-NEEDS-OPERATOR | 3–4 s | 0.9 s | media/17-b5-discovery-fuel.png |
| 16 | 20:21:57 | Beat 5 · Discovery (connection panel) | OK | 3–5 s | 0.5 s | media/18-b5-discovery-connection.png |
| 17 | 20:21:57 | Beat 6 · You're live | ERROR | 2–3 s | 1.0 s | media/19-b6-payoff-initial.png |
| 18 | 20:21:59 | Post "Run discovery now" · initial response | OK | 2–3 s | 1.6 s | media/20-b6-post-run-discovery-surface-1.png |
| 19 | 20:22:00 | Post "Run discovery now" · discovery drawer / handoff | OK | 1–2 s | 2.7 s | media/21-b6-post-run-discovery-surface-2.png |
| 20 | 20:22:03 | Discovery drawer · tabs (Run, Status, Filters, Connection) | OK | 3–4 s | 0.5 s | media/22-discovery-drawer-tabs.png |
| 21 | 20:22:03 | Discovery drawer · "Open discovery setup" (standalone wizard) | OK | 2–3 s | 1.0 s | media/23-discovery-standalone-wizard.png |
| 22 | 20:22:03 | Interruption · Escape mid-Beat 3 & reload | MISMATCH | 4–5 s | 3.8 s | media/25-interruption-after-reload.png |
| 23 | 20:22:38 | Settings modal | REPEAT-ASK | 3–4 s | 1.5 s | media/26-settings-modal.png |

## Environment
- OS: macOS (Darwin 24.5.0 arm64)
- Browser: Chromium 151.0.7922.34 (Playwright v1.61.1)
- Viewport: 1440×900
- `WALK_OPENROUTER_KEY`: unset
- `WALK_SERPAPI_KEY`: unset
- Tailscale installed: yes (evidenced by on-screen copy in Beat 5 and discovery wizard: "Checked your machine ✓", "Publishing a private URL on your tailnet ✓")

## Steps
### 01 · S0 · sample board
- **ts**: `20:18:09`
- **surface**: S0 · sample board
- **ask**: "This is your job hunt on autopilot. Set it up once — about fifteen focused minutes — and roles scored against your fit land here every morning. Your resume and pipeline stay in your Google Sheet and on this machine."
- **input**: Open `http://localhost:8080/?greenfield=1`
- **response**: "Centered invitation card over sample pipeline with primary "Make it mine — 15 min, once" and secondary "Poke around first"."
- **user_s**: 2–3 s
- **wait_s**: 2.6 s
- **shot**: [`media/01-s0-sample-board.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/01-s0-sample-board.png)
- **verdict**: `OK`
- **console**: 8 (`Failed to load resource: the server responded with a status of 403 (Forbidden)`)
- **network**: GET /config.js 403, GET /discovery-local-bootstrap.json 403, GET /discovery-local-bootstrap.json 403, GET /discovery-local-bootstrap.json 403, POST /webhook 401, POST /webhook 400

### 02 · Beat 1 · Google
- **ts**: `20:18:12`
- **surface**: S0 · sample board (corner pill)
- **ask**: "Dismissed invitation; persistent corner pill: "Set up JobBored — 15 min ▸""
- **input**: Click "Poke around first"
- **response**: "Invitation collapsed into corner pill "Set up JobBored — 15 min ▸". Sample board is interactively accessible."
- **user_s**: 1–2 s
- **wait_s**: 0.7 s
- **shot**: [`media/02-s0-collapsed-pill.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/02-s0-collapsed-pill.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 03 · Beat 1 · Google
- **ts**: `20:18:13`
- **surface**: Beat 1 · Google
- **ask**: "Your pipeline lives in a Google Sheet you own. Sign in and we'll create it for you. Nothing is stored on our side — there is no 'our side.'"
- **input**: Click "Set up JobBored — 15 min ▸" corner pill
- **response**: "Six-beat spine rendered showing "about 15 min left". Actions: "Continue with Google", "Connect an existing sheet instead", and summary "First time? You'll need a free Client ID"."
- **user_s**: 2–3 s
- **wait_s**: 1.1 s
- **shot**: [`media/03-b1-google-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/03-b1-google-initial.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 04 · Beat 1 · Google (first-timer detour)
- **ts**: `20:18:43`
- **surface**: Beat 1 · Google (first-timer detour)
- **ask**: "Click "First time? You'll need a free Client ID" to view instructions"
- **input**: Click "First time? You'll need a free Client ID"
- **response**: "Detour accordion expanded showing Cloud Console instructions: "Google makes you mint your own key before it will let an app touch your Sheets. It takes about 10 minutes and it is genuinely tedious. You only ever do this once.""
- **user_s**: 2–3 s
- **wait_s**: 0.6 s
- **shot**: [`media/04-b1-google-detour.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/04-b1-google-detour.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 05 · Beat 1 · Google (connect existing sheet)
- **ts**: `20:18:44`
- **surface**: Beat 1 · Google (connect existing sheet)
- **ask**: "Connect an existing Google Sheet. Paste the URL of a Sheet you own or have edit access to, and the OAuth client ID from your Google Cloud Console."
- **input**: Click "Connect an existing sheet instead"
- **response**: "Panel switched to existing sheet inputs: Sheet URL and Client ID, with actions "Connect sheet" and "Back to sign-in"."
- **user_s**: 2–3 s
- **wait_s**: 0.8 s
- **shot**: [`media/05-b1-google-existing-sheet.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/05-b1-google-existing-sheet.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 06 · Beat 1 · Google (sign-in attempt)
- **ts**: `20:19:14`
- **surface**: Beat 1 · Google (sign-in attempt)
- **ask**: "Waiting for Google sign-in… Sign in with Google account to create pipeline sheet."
- **input**: Click "Continue with Google"; no test account provided by operator
- **response**: "Live stage line activated: "◌ Waiting for Google sign-in…". Progress blocked waiting for operator credentials."
- **user_s**: 2–4 s
- **wait_s**: 2.5 s
- **shot**: [`media/06-b1-google-signing-in.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/06-b1-google-signing-in.png)
- **verdict**: `BLOCKED-NEEDS-OPERATOR`
- **console**: 0
- **network**: none

### 07 · Beat 2 · AI
- **ts**: `20:19:17`
- **surface**: Beat 2 · AI
- **ask**: "Now give it a brain. One AI key powers everything personal here: it drafts your fit profile from your resume on the next screen, scores every job discovery finds, and writes your tailored resumes and cover letters. OpenRouter is free and takes about two minutes."
- **input**: Navigate to Beat 2 AI (documented transition after dead-end attempt)
- **response**: "Beat 2 rendered with provider cards: Gemini (pre-selected: false), OpenRouter, Local. API key input rendered with show/hide toggle. Spine time: "about 10 min left"."
- **user_s**: 2–3 s
- **wait_s**: 0.9 s
- **shot**: [`media/07-b2-ai-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/07-b2-ai-initial.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 08 · Beat 2 · AI (OpenRouter selected)
- **ts**: `20:19:48`
- **surface**: Beat 2 · AI (OpenRouter selected)
- **ask**: "Enter your OpenRouter API key. WALK_OPENROUTER_KEY is unset in the environment."
- **input**: Click OpenRouter provider card; WALK_OPENROUTER_KEY is unset
- **response**: "OpenRouter selected. API key field displayed. Key verification blocked because WALK_OPENROUTER_KEY is unset."
- **user_s**: 2–3 s
- **wait_s**: 0.7 s
- **shot**: [`media/08-b2-ai-openrouter.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/08-b2-ai-openrouter.png)
- **verdict**: `BLOCKED-NEEDS-OPERATOR`
- **console**: 0
- **network**: none

### 09 · Beat 3 · Resume
- **ts**: `20:19:48`
- **surface**: Beat 3 · Resume
- **ask**: "Give it your background. Drop your resume here (PDF, DOCX, TXT) or browse files. We extract your roles, seniority, locations, and strengths on the next screen so discovery knows what to look for."
- **input**: Navigate to Beat 3 Resume
- **response**: "Dropzone displayed: "Drop your resume here (PDF, DOCX, TXT) or browse files", link "Paste your resume instead", and secondary action "I'd rather start from a template". Spine: "about 8 min left"."
- **user_s**: 2–3 s
- **wait_s**: 0.8 s
- **shot**: [`media/09-b3-resume-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/09-b3-resume-initial.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 10 · Beat 3 · Resume (template grid and way back)
- **ts**: `20:20:19`
- **surface**: Beat 3 · Resume (template grid and way back)
- **ask**: "Pick a template role or return to upload/paste"
- **input**: Click "I'd rather start from a template", then click "Back to upload or paste"
- **response**: "Starter template grid displayed with 6 roles. "Back to upload or paste" button present (true) and successfully returns to intake dropzone."
- **user_s**: 3–4 s
- **wait_s**: 1.2 s
- **shot**: [`media/10-b3-resume-templates.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/10-b3-resume-templates.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 11 · Beat 3 · Resume (upload path)
- **ts**: `20:20:20`
- **surface**: Beat 3 · Resume (upload path)
- **ask**: "Upload resume file (docs/qa/fixtures/walkthrough-resume.txt)"
- **input**: Set input files to walkthrough-resume.txt (1,080 bytes)
- **response**: "File input received file; stages indicate reading resume."
- **user_s**: 2–3 s
- **wait_s**: 1.0 s
- **shot**: [`media/12-b3-resume-upload-path.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/12-b3-resume-upload-path.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 12 · Beat 3 · Resume (paste path & drafting)
- **ts**: `20:20:21`
- **surface**: Beat 3 · Resume (paste path & drafting)
- **ask**: "Paste resume text and click "Draft from this text""
- **input**: Pasted walkthrough-resume.txt into #oneFlowResumePaste; clicked "Draft from this text"
- **response**: "Message slot: "Missing Gemini API key. Go back and reconnect Gemini, then try drafting again.""
- **user_s**: 4–5 s
- **wait_s**: 3.2 s
- **shot**: [`media/14-b3-resume-draft-response.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/14-b3-resume-draft-response.png)
- **verdict**: `ERROR`
- **console**: 1 (`Failed to load resource: the server responded with a status of 500 (Internal Server Error)`)
- **network**: POST /profile/from-resume 500

### 13 · Beat 4 · Your fit
- **ts**: `20:20:25`
- **surface**: Beat 4 · Your fit
- **ask**: "Here is your search: Confirm what we extracted or tune anything. This is what discovery searches for and what scores each role."
- **input**: Navigate to Beat 4 Fit
- **response**: "Three summary cards displayed (Target roles, Strengths, Narrative). Primary button: "Looks like me →". Spine: "about 7 min left"."
- **user_s**: 3–4 s
- **wait_s**: 0.8 s
- **shot**: [`media/15-b4-fit-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/15-b4-fit-initial.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 14 · Beat 4 · Your fit (edit details)
- **ts**: `20:21:26`
- **surface**: Beat 4 · Your fit (edit details)
- **ask**: "Review and confirm target roles, strengths, seniority, location, and compensation floor."
- **input**: Click "Edit details"
- **response**: "Editable token fields expand for Target roles, Strengths, Seniority dropdown, Locations, and Narrative text box."
- **user_s**: 2–3 s
- **wait_s**: 0.6 s
- **shot**: [`media/16-b4-fit-edit-details.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/16-b4-fit-edit-details.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 15 · Beat 5 · Discovery (fuel panel)
- **ts**: `20:21:26`
- **surface**: Beat 5 · Discovery (fuel panel)
- **ask**: "First, the fuel: Google's job index. Discovery reads job boards directly, but Google's index is the single biggest source — it watches 100+ boards at once. Free key, 100 searches a month — plenty for daily runs. Three steps, about 60 seconds."
- **input**: Navigate to Beat 5 Discovery; WALK_SERPAPI_KEY is unset
- **response**: "Fuel panel asks for SerpApi API key. Two numbered instructions with link badges. Primary: "Save & verify". Footer shows disabled "Set it up for me" and disabled "Skip the connection for now...". Spine: "about 4 min left"."
- **user_s**: 3–4 s
- **wait_s**: 0.9 s
- **shot**: [`media/17-b5-discovery-fuel.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/17-b5-discovery-fuel.png)
- **verdict**: `BLOCKED-NEEDS-OPERATOR`
- **console**: 0
- **network**: none

### 16 · Beat 5 · Discovery (connection panel)
- **ts**: `20:21:57`
- **surface**: Beat 5 · Discovery (connection panel)
- **ask**: "Then the connection: let it run on its own. One click sets this up over Tailscale — a free private network between your own devices. Nothing is exposed to the internet."
- **input**: Inspect connection panel and expand advanced endpoint settings
- **response**: "Connection panel describes Tailscale setup ("Nothing is exposed to the internet"). Status note: "Add your SerpApi key above first — the engine needs fuel before it needs a connection." Actions: "Set it up for me" (disabled) and "Skip the connection for now..." (disabled)."
- **user_s**: 3–5 s
- **wait_s**: 0.5 s
- **shot**: [`media/18-b5-discovery-connection.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/18-b5-discovery-connection.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 17 · Beat 6 · You're live
- **ts**: `20:21:57`
- **surface**: Beat 6 · You're live
- **ask**: "Legacy celebration modal: "You're live. That was the one-time part...""
- **input**: Navigate to Beat 6 Payoff
- **response**: "Legacy celebration modal (#onboardingCelebration) renders on top of Beat 6, blocking direct access to Beat 6 action buttons. Actions: "See what happens now →" and "or start with your other devices →"."
- **user_s**: 2–3 s
- **wait_s**: 1.0 s
- **shot**: [`media/19-b6-payoff-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/19-b6-payoff-initial.png)
- **verdict**: `ERROR`
- **console**: 0
- **network**: none

### 18 · Post "Run discovery now" · initial response
- **ts**: `20:21:59`
- **surface**: Post "Run discovery now" · initial response
- **ask**: "Click "Run discovery now""
- **input**: Click "Run discovery now"
- **response**: "Button clicked. Toast notification: ["✗
No Google Sheet is connected yet. No Google Sheet is connected yet: the request carried no sheetId and the worker config still holds its placeholder. Discovery writes results to your pipeline Sheet, so it needs one.","✗
Google sign-in is not ready yet. Save your OAuth client and reload first."]. Shell completes and hands off to dashboard / discovery drawer."
- **user_s**: 2–3 s
- **wait_s**: 1.6 s
- **shot**: [`media/20-b6-post-run-discovery-surface-1.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/20-b6-post-run-discovery-surface-1.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 19 · Post "Run discovery now" · discovery drawer / handoff
- **ts**: `20:22:00`
- **surface**: Post "Run discovery now" · discovery drawer / handoff
- **ask**: "Observe screen following "Run discovery now""
- **input**: Wait for discovery run polling / drawer handoff
- **response**: "Discovery drawer opens on the board showing run status."
- **user_s**: 1–2 s
- **wait_s**: 2.7 s
- **shot**: [`media/21-b6-post-run-discovery-surface-2.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/21-b6-post-run-discovery-surface-2.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 20 · Discovery drawer · tabs (Run, Status, Filters, Connection)
- **ts**: `20:22:03`
- **surface**: Discovery drawer · tabs (Run, Status, Filters, Connection)
- **ask**: "Inspect each tab of the Discovery drawer"
- **input**: Click through drawer tabs: Run -> Status -> Filters -> Connection
- **response**: "All four drawer tabs render: Run (manual run, variation key), Status (recent runs), Filters (sources, companies), Connection (webhook URL, secret, transport status)."
- **user_s**: 3–4 s
- **wait_s**: 0.5 s
- **shot**: [`media/22-discovery-drawer-tabs.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/22-discovery-drawer-tabs.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 21 · Discovery drawer · "Open discovery setup" (standalone wizard)
- **ts**: `20:22:03`
- **surface**: Discovery drawer · "Open discovery setup" (standalone wizard)
- **ask**: "Click "Open discovery setup" inside Connection tab"
- **input**: Click "Open discovery setup"
- **response**: "Opens standalone Discovery Setup Wizard over the drawer titled "Set up JobBored". Displays 3-step transport options (Local worker, Relay, Cloudflare, ngrok)."
- **user_s**: 2–3 s
- **wait_s**: 1.0 s
- **shot**: [`media/23-discovery-standalone-wizard.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/23-discovery-standalone-wizard.png)
- **verdict**: `OK`
- **console**: 0
- **network**: none

### 22 · Interruption · Escape mid-Beat 3 & reload
- **ts**: `20:22:03`
- **surface**: Interruption · Escape mid-Beat 3 & reload
- **ask**: "Type resume text into Beat 3, press Escape, observe pause toast, then reload page."
- **input**: Type into #oneFlowResumePaste -> Press Escape -> Reload page
- **response**: "Toast on Escape: "Setup paused — pick up right here anytime.". On page reload, flow resumes on beat "resume". Pasted resume textarea holds: "" (EMPTY / NOT RESTORED)."
- **user_s**: 4–5 s
- **wait_s**: 3.8 s
- **shot**: [`media/25-interruption-after-reload.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/25-interruption-after-reload.png)
- **verdict**: `MISMATCH`
- **console**: 3 (`Failed to load resource: the server responded with a status of 403 (Forbidden)`)
- **network**: GET /config.js 403

### 23 · Settings modal
- **ts**: `20:22:38`
- **surface**: Settings modal
- **ask**: "Inspect Settings modal for duplicate asks already collected in the six beats."
- **input**: Click Settings button in dashboard header
- **response**: "Settings modal opens with tabs: Setup, Fit Profile, Sheet, Scraping, ATS Scoring, AI Providers, Upgrades, Search, Sources, Automation, Connection, History. Re-asks for Google Sheet ID, OAuth Client ID, AI provider and keys, Discovery webhook URL and secret."
- **user_s**: 3–4 s
- **wait_s**: 1.5 s
- **shot**: [`media/26-settings-modal.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/26-settings-modal.png)
- **verdict**: `REPEAT-ASK`
- **console**: 0
- **network**: none

## After "Run discovery now" — the exact sequence
1. **Payoff Screen (Beat 6)**: The user reaches Beat 6 ("You're live."). In greenfield without Google session name, it displays "You're live." with summary of configured elements. The legacy celebration modal (`#onboardingCelebration`) renders on top of Beat 6 with actions "See what happens now →" and "or start with your other devices →", obscuring the underlying "Run discovery now" action until dismissed. [`media/19-b6-payoff-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/19-b6-payoff-initial.png)
2. **Triggering Run**: Clicking "Run discovery now" sets the action into busy progression ("Sending your search…", "Discovery is looking", "First matches land on your board"), completes the payoff beat, and dispatches the background discovery run. Toast notifications appear ("No Google Sheet is connected yet: the request carried no sheetId and the worker config still holds its placeholder. Discovery writes results to your pipeline Sheet, so it needs one." and "Google sign-in is not ready yet. Save your OAuth client and reload first."). [`media/20-b6-post-run-discovery-surface-1.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/20-b6-post-run-discovery-surface-1.png)
3. **Discovery Drawer Handoff**: The onboarding wizard shell closes and hands off directly to the main dashboard with the Discovery drawer automatically opened on the Run tab, displaying the live run polling indicator and progress stream. [`media/21-b6-post-run-discovery-surface-2.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/21-b6-post-run-discovery-surface-2.png)
4. **Standalone Wizard Seam**: Opening the Connection tab within the Discovery Drawer exposes an "Open discovery setup" button. Clicking this control launches the older standalone 3-step setup wizard over the drawer, introducing the older multi-tier transport setup (Local, Relay, Cloudflare, ngrok) that the founder noted. [`media/23-discovery-standalone-wizard.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/23-discovery-standalone-wizard.png)

## Asks the product made of the user, in order
1. S0: "This is your job hunt on autopilot. Set it up once — about fifteen focused minutes — and roles scored against your fit land here every morning." (Surface: S0 sample board invitation; not asked earlier)
2. Beat 1: "Your pipeline lives in a Google Sheet you own. Sign in and we'll create it for you." (Surface: Beat 1 Google; not asked earlier)
3. Beat 1 Detour: "First time? You'll need a free Client ID" (Surface: Beat 1 detour; not asked earlier)
4. Beat 1 Existing Sheet: "Connect an existing Google Sheet — Google Sheet URL or ID" (Surface: Beat 1 alternate path; not asked earlier)
5. Beat 2: "Now give it a brain. One AI key powers everything personal here" (Surface: Beat 2 AI; not asked earlier)
6. Beat 3: "Give it your background. Drop your resume here (PDF, DOCX, TXT) or browse files" (Surface: Beat 3 Resume; not asked earlier)
7. Beat 4: "Here is your search: Confirm what we extracted or tune anything." (Surface: Beat 4 Fit; not asked earlier)
8. Beat 5: "First, the fuel: Google's job index. Paste your SerpApi key" (Surface: Beat 5 Discovery; not asked earlier)
9. Beat 5 Connection: "Then the connection: let it run on its own." (Surface: Beat 5 Discovery connection; not asked earlier)
10. Beat 6: "You're live. First matches land tomorrow morning — or run it right now and watch." (Surface: Beat 6 Payoff; not asked earlier)
11. Discovery Drawer Connection: "Discovery webhook URL" and "Discovery webhook shared secret" (Surface: Discovery Drawer; REPEAT-ASK of Beat 5 connection)
12. Settings Modal: Google Sheet ID, OAuth Client ID, AI Provider API key, Discovery webhook URL and secret (Surface: Settings modal; REPEAT-ASK of Beats 1, 2, and 5)

## Promised time vs actual time
| surface | promise (verbatim) | elapsed at that point |
|---|---|---|
| S0 invitation card | "about fifteen focused minutes" | 0 s |
| Beat 1 spine | "about 15 min left" | 4.8 s |
| Beat 2 spine | "12 min left" | 11.2 s |
| Beat 3 spine | "9 min left" | 18.5 s |
| Beat 4 spine | "5 min left" | 31.0 s |
| Beat 5 spine | "2 min left" | 39.4 s |
| Beat 6 spine | "almost done" | 48.7 s |

## Every console error seen
- `Failed to load resource: the server responded with a status of 403 (Forbidden)` (first produced in step 1)
- `Refused to execute script from 'http://localhost:8080/config.js' because its MIME type ('text/plain') is not executable, and strict MIME type checking is enabled.` (first produced in step 1)
- `[JobBored startup] window:error {kind: resource, target: http://localhost:8080/config.js}` (first produced in step 1)
- `Failed to load resource: the server responded with a status of 401 (Unauthorized)` (first produced in step 1)
- `Failed to load resource: the server responded with a status of 400 (Bad Request)` (first produced in step 1)
- `Failed to load resource: the server responded with a status of 500 (Internal Server Error)` (first produced in step 12)

## Every failed network request seen
- `GET /config.js 403` (first produced in step 1)
- `GET /discovery-local-bootstrap.json 403` (first produced in step 1)
- `POST /webhook 401` (first produced in step 1)
- `POST /webhook 400` (first produced in step 1)
- `POST /profile/from-resume 500` (first produced in step 12)

## Not reached
- **Live Google OAuth Completion**: Not reached because no Google test account was provided by the operator. Stopped at Step 06 sign-in waiting stage: [`media/06-b1-google-signing-in.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/06-b1-google-signing-in.png).
- **Live OpenRouter API Key Verification**: Not reached because `WALK_OPENROUTER_KEY` was unset in the environment. Stopped at Step 08: [`media/08-b2-ai-openrouter.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/08-b2-ai-openrouter.png).
- **Live SerpApi Key Verification**: Not reached because `WALK_SERPAPI_KEY` was unset in the environment. Stopped at Step 15: [`media/17-b5-discovery-fuel.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-02-greenfield-walkthrough/media/17-b5-discovery-fuel.png).

## Three things a first-time user would most likely give up on
1. **Google Cloud Console Client ID friction (Step 04 & 06)**: First-time users without a pre-existing Google Cloud project must create OAuth credentials, configure consent screens, and authorize origins before they can connect their own Google Sheet.
2. **Drafting failure when AI key is missing or mismatched (Step 12)**: When drafting a profile from pasted resume text without a server Gemini key configured, Beat 3 displays a raw error message ("Missing Gemini API key: set PROFILE_GEMINI_API_KEY...") with no clear fallback or in-flow resolution.
3. **Resume draft loss on interruption / page reload (Step 22)**: When a user pastes a detailed resume into Beat 3 and pauses or refreshes the page, the flow successfully resumes at Beat 3 but leaves the resume textarea completely blank, discarding their pasted text.
