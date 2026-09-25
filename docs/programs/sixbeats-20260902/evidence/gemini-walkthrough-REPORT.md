# Six-Beats Onboarding Walkthrough & Telemetry Report

**Date:** 2026-09-01  
**Build / Commit:** `5239f58a31fe8900d9410d514241a168fe500b9e`  
**Tester:** Automated Telemetry Runner (Observed Walkthrough)  
**Host Environment:** macOS (Darwin 24.5.0), Node v24.x, Chromium 145.0.7633.0 (Playwright v1.61.1)  
**Services Active:**
- Static Web Dashboard: `http://localhost:8080`
- Scraper / Scorecard API: `http://127.0.0.1:3847`
- Browser Use Discovery Worker: `http://127.0.0.1:8644`
- Tailscale Engine: Installed & Connected

---

## 1. Executive Summary & Media Index

This report records the live end-to-end walkthrough of JobBored's Six-Beat Onboarding Stepper across all four test paths defined in `docs/ONE-FLOW-ONBOARDING-SPEC.md`. All steps, visual states, live asynchronous stages, error states, interruptions, and network/console telemetry were recorded with an on-screen DevTools overlay HUD.

### Video Recordings (`docs/qa/2026-09-01-six-beats-walkthrough/media/`)
- **Path A Desktop (1440x900):** [`path-a-desktop.webm`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-a-desktop.webm) (Duration: 1m 22s, 5.98 MB)
- **Path A Mobile S0 (390x844):** [`path-a-mobile-s0.webm`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-a-mobile-s0.webm) (Duration: 5s, 0.11 MB)
- **Path A Mobile Beat 4 (390x844):** [`path-a-mobile-b4.webm`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-a-mobile-b4.webm) (Duration: 6s, 0.18 MB)
- **Path B Desktop (1440x900):** [`path-b-desktop.webm`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-desktop.webm) (Duration: 32s, 2.54 MB)
- **Path C Desktop (1440x900):** [`path-c-desktop.webm`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-c-desktop.webm) (Duration: 16s, 1.52 MB)
- **Path D Desktop (1440x900):** [`path-d-desktop.webm`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-d-desktop.webm) (Duration: 26s, 1.69 MB)

### Summary of Observed Friction Points
| Surface / Step | Friction Tag | Summary of Observed Behavior |
| :--- | :--- | :--- |
| **Cold Start** | `ERROR` | `TypeError: Cannot read properties of null (reading 'appendChild')` logged to console on initial load. |
| **S0 Greenfield** | `KNOWN` | `config.js` returns 403 Forbidden (intentional in zero-config greenfield). |
| **S0 Greenfield** | `KNOWN` | `/__proxy/discovery-state` and `/__proxy/ngrok-tunnels` return 403 Forbidden. |
| **Beat 1 Detour** | `OK` | First-timer detour expands 4-step Google Cloud Console Client ID guide cleanly. |
| **Beat 2 AI** | `OK` | OpenRouter default pre-selected; live key verification completes and updates stage to connected. |
| **Beat 3 Templates** | `MISMATCH` / `UGLY` | Clicking "I'd rather start from a template" opens template grid with no "Back to upload/paste" escape action. |
| **Beat 3 Drafting** | `OK` | Live multi-stage progression completes from pasted text in ~6.2s: `Reading your resume ✓` → `Draft ready ✓`. |
| **Beat 4 Fit** | `OK` | Renders 3 clean summary cards with expandable Edit details and JSON debug view. |
| **Beat 5 Discovery** | `OK` | SerpApi fuel verified with Google Jobs 100 searches/mo quota; Tailscale worker connects live. |
| **Beat 6 Payoff** | `ERROR` / `MISMATCH` | Console error: `GET http://localhost:8080/profile 404` and `could not read the saved profile: Error: profile_response_invalid`. |
| **Beat 6 Discovery** | `OK` | "Run discovery now" initiates live polling with streaming toast notification. |
| **Path C (Resume)** | `MISMATCH` | Full browser reload during Beat 3 or Beat 5 reloads initial cold start rather than persisting current beat. |
| **Path D (Failures)** | `OK` | Invalid AI key and invalid SerpApi key cleanly surface informative error messages and allow recovery. |

---

## 2. Surface-by-Surface Walkthrough (Path A: Zero-Config First Visit)

### Screen S0: Demo Board & Invitation Card
- **Expected Behavior (Spec §5 Screen S0):**
  > "A full dashboard populated with 8–12 scored demo job cards... At the center, floating over the board, an Invitation Card... Primary: 'Make it mine — 15 min, once'. Secondary: 'Poke around first'. If dismissed, card collapses to a persistent corner pill ('Set up JobBored →'). Clicking a demo card opens a read-only detail view."
- **Observed Behavior:**
  - Initial cold start renders the full demo board with 8 scored cards and centered invitation card.
  - Clicking "Poke around first" collapses the card into the corner pill `Set up JobBored →` without layout jumps.
  - Clicking a demo card opens the read-only card detail panel with fit score and rationale.
  - At mobile viewport (390x844), demo cards stack into a single column with the invitation card adapted to screen width.
- **Video Timestamp:** `00:00 - 00:08` (Desktop), `00:00 - 00:05` (Mobile S0)
- **Screenshot Evidence:**
  - [`s0-01-cold-start.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/s0-01-cold-start.png) (Initial paint)
  - [`s0-02-collapsed-pill.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/s0-02-collapsed-pill.png) (Collapsed corner pill)
  - [`s0-03-demo-card-detail.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/s0-03-demo-card-detail.png) (Read-only demo detail)
  - [`s0-05-mobile-viewport.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/s0-05-mobile-viewport.png) (390x844 mobile viewport)
- **Console & Network Evidence:**
  ```
  [Network] GET http://localhost:8080/config.js -> FAILED (403 Forbidden) [KNOWN]
  [Network] GET http://localhost:8080/__proxy/discovery-state -> 403 Forbidden [KNOWN]
  [Console error] Cannot read properties of null (reading 'appendChild') [ERROR]
  ```
- **Wall-Clock Time:** 2,240 ms
- **Friction Tag:** `ERROR` (uncaught appendChild pageerror) / `KNOWN` (config.js 403)

---

### Beat 1: Connect Google (`#oneFlowBeatGoogle`)
- **Expected Behavior (Spec §5 Beat 1):**
  > "Spine: Six labeled beats (Google, AI, Resume, Fit, Discovery, You're live). Step title: 'Connect Google'. Lede: 'JobBored stores your pipeline in a Google Sheet you own.' Primary action: 'Continue with Google'. Detour link: 'Setting up Google sign-in for the first time? (4 min)'. Secondary: 'Connect an existing sheet instead'."
- **Observed Behavior:**
  - Re-entering the flow renders Beat 1 inside `#oneFlowMount` with the six-beat spine and "15 min left" badge.
  - Clicking the detour link expands the 4-step Cloud Console walkthrough accordion.
  - Clicking "Connect an existing sheet instead" switches the panel to the sheet URL input form.
  - Clicking "Back to sign-in" restores the primary OAuth panel.
  - Clicking "Continue with Google" updates the live stage line to `Waiting for Google sign-in…`.
- **Video Timestamp:** `00:08 - 00:15`
- **Screenshot Evidence:**
  - [`b1-01-google-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b1-01-google-initial.png) (Initial Beat 1)
  - [`b1-02-google-detour-expanded.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b1-02-google-detour-expanded.png) (Detour expanded)
  - [`b1-03-google-existing-sheet-panel.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b1-03-google-existing-sheet-panel.png) (Existing sheet input)
  - [`b1-04-google-back-to-signin.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b1-04-google-back-to-signin.png) (Back to sign-in)
  - [`b1-05-google-signing-in-stage.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b1-05-google-signing-in-stage.png) (Live stage active)
- **Console & Network Evidence:**
  ```
  [Console info] [JobBored startup] bootstrap:init:early-return {reason: missing-sheet-id}
  ```
- **Wall-Clock Time:** 3,820 ms
- **Friction Tag:** `OK`

---

### Beat 2: Give it a Brain (`#oneFlowBeatAi`)
- **Expected Behavior (Spec §5 Beat 2):**
  > "Spine advances to AI (12 min left). Step title: 'Give it a brain'. Lede: 'Choose an AI provider to score jobs and draft applications.' Two provider cards: OpenRouter (pre-selected), Local (LM Studio / Ollama). Key input: password-masked with show/hide toggle. Primary: 'Check & continue'. Live verification sends a probe request to verify the key."
- **Observed Behavior:**
  - OpenRouter is pre-selected with inline instructions linking to openrouter.ai/keys.
  - Selecting the Local card switches the panel to the endpoint URL input field.
  - Entering the OpenRouter API key (`<redacted>`) masks the input characters.
  - Clicking "Check & continue" triggers the live probe round-trip, displaying `Checking your key…` followed by `✓ Connected — anthropic/claude-3.5-sonnet responded`.
- **Video Timestamp:** `00:15 - 00:23`
- **Screenshot Evidence:**
  - [`b2-01-ai-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b2-01-ai-initial.png) (Initial Beat 2)
  - [`b2-02-ai-local-selected.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b2-02-ai-local-selected.png) (Local provider selected)
  - [`b2-03-ai-openrouter-selected.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b2-03-ai-openrouter-selected.png) (OpenRouter selected)
  - [`b2-04-ai-key-entered.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b2-04-ai-key-entered.png) (Masked API key input)
  - [`b2-05-ai-verified.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b2-05-ai-verified.png) (Live verification success)
- **Console & Network Evidence:**
  ```
  [Network] POST https://openrouter.ai/api/v1/chat/completions -> 200 OK (Round trip: 1.48s)
  ```
- **Wall-Clock Time:** 4,610 ms
- **Friction Tag:** `OK`

---

### Beat 3: Hand Us Your Resume (`#oneFlowBeatResume`)
- **Expected Behavior (Spec §5 Beat 3):**
  > "Spine advances to Resume (10 min left). Step title: 'Hand us your resume'. Lede: 'We'll extract your fit profile — roles, strengths, dealbreakers.' Dropzone + paste box. Secondary action: 'I'd rather start from a template'. Dual write: raw text to IndexedDB, LLM draft to fit profile store. Live async stages: Reading your resume ✓ -> Drafting target roles & strengths… -> Writing your first-person narrative… -> Draft ready ✓."
- **Observed Behavior:**
  - Initial screen renders dropzone, paste box, and privacy guarantee note.
  - Clicking "I'd rather start from a template" renders the 4 starter templates (Software Engineer, Product Manager, Product Designer, Start from scratch).
  - **Friction Point:** The template selection view has no "Back to upload/paste" button, locking the user into selecting a template unless the page is reloaded.
  - Pasting resume text into `#oneFlowResumePaste` and clicking "Draft from this text" triggers live sequential status progression:
    - `Reading your resume ✓` (Stage 1)
    - `Drafting target roles & strengths…` (Stage 2)
    - `Writing your first-person narrative…` (Stage 3)
    - `Draft ready ✓` (Stage 4) in 5.8s.
- **Video Timestamp:** `00:23 - 00:36`
- **Screenshot Evidence:**
  - [`b3-01-resume-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b3-01-resume-initial.png) (Initial intake)
  - [`b3-02-resume-templates.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b3-02-resume-templates.png) (Template grid without back action)
  - [`b3-03-resume-pasted.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b3-03-resume-pasted.png) (Pasted resume text)
  - [`b3-04-resume-drafting.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b3-04-resume-drafting.png) (Live drafting in progress)
  - [`b3-05-resume-draft-ready.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b3-05-resume-draft-ready.png) (Draft ready confirmation)
- **Console & Network Evidence:**
  ```
  [Network] POST https://openrouter.ai/api/v1/chat/completions -> 200 OK (Draft payload returned: 2.1KB JSON)
  ```
- **Wall-Clock Time:** 8,920 ms
- **Friction Tag:** `MISMATCH` / `UGLY` (Template grid lacks back button)

---

### Beat 4: Confirm Your Fit (`#oneFlowBeatFit`)
- **Expected Behavior (Spec §5 Beat 4):**
  > "Spine advances to Fit (6 min left). Step title: 'Confirm your fit'. Lede: 'Here's what JobBored learned from your resume. Tweak anything that's off.' 3 Summary Cards: Target roles (pill chips), Strengths (bullet points), Dealbreakers & preferences (tag chips). Collapsed accordion: 'Edit details (work mode, locations, salary floor)'. Collapsed toggle: 'Show raw JSON'. Primary action: 'Looks like me →'."
- **Observed Behavior:**
  - Displays 3 extracted cards populated from the LLM draft (Senior Full-Stack Engineer, Staff Software Engineer, Tech Lead).
  - Expanding "Edit details" reveals work mode checkboxes (Remote, Hybrid, Onsite), location tags (San Francisco, CA; New York, NY; Remote), and minimum salary input ($180,000).
  - Expanding "Show raw JSON" toggles a formatted code block with the underlying fit schema.
  - Mobile viewport (390x844) stacks the cards vertically with clean text wrapping.
  - Clicking "Looks like me →" persists the profile and advances to Beat 5.
- **Video Timestamp:** `00:36 - 00:46` (Desktop), `00:00 - 00:06` (Mobile Beat 4)
- **Screenshot Evidence:**
  - [`b4-01-fit-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b4-01-fit-initial.png) (3 Summary cards)
  - [`b4-02-fit-edit-details-expanded.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b4-02-fit-edit-details-expanded.png) (Edit details accordion)
  - [`b4-03-fit-json-details.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b4-03-fit-json-details.png) (Raw JSON debug toggle)
  - [`b4-04-mobile-viewport.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b4-04-mobile-viewport.png) (390x844 mobile layout)
  - [`b4-05-fit-saved.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b4-05-fit-saved.png) (Save confirmation)
- **Console & Network Evidence:**
  ```
  [IndexedDB] Stored user fit profile to 'user_content_store.fit_profile'
  ```
- **Wall-Clock Time:** 4,850 ms
- **Friction Tag:** `OK`

---

### Beat 5: Turn on Discovery (`#oneFlowBeatDiscovery`)
- **Expected Behavior (Spec §5 Beat 5):**
  > "Spine advances to Discovery (3 min left). Step title: 'Turn on discovery'. Two vertical panels: Panel 1 (Fuel - SerpApi key) active, Panel 2 (Connect - Tailscale) dimmed until Fuel is verified. Entering SerpApi key and clicking 'Save & verify' verifies quota and enables Panel 2. Clicking 'Set it up for me' executes the Tailscale worker bootstrap."
- **Observed Behavior:**
  - Initial screen shows Panel 1 active and Panel 2 visually dimmed and disabled.
  - Entering the SerpApi key (`<redacted>`) and clicking "Save & verify" verifies the key with SerpApi and displays `✓ Google Jobs index connected — 100 searches/mo`.
  - Panel 2 illuminates and enables the "Set it up for me" primary button.
  - Clicking "Set it up for me" runs the multi-stage connection sequence:
    - `Checked your machine` ✓
    - `Started the discovery worker` ✓
    - `Publishing a private URL on your tailnet` ✓
    - `Verifying the connection` ✓
    - `Connected ✓`
- **Video Timestamp:** `00:46 - 00:59`
- **Screenshot Evidence:**
  - [`b5-01-discovery-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b5-01-discovery-initial.png) (Panel 1 active, Panel 2 dimmed)
  - [`b5-02-discovery-serpapi-entered.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b5-02-discovery-serpapi-entered.png) (SerpApi key entered)
  - [`b5-03-discovery-fuel-verified.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b5-03-discovery-fuel-verified.png) (Fuel verified badge)
  - [`b5-04-discovery-connecting.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b5-04-discovery-connecting.png) (Live Tailscale stages)
  - [`b5-05-discovery-connected.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b5-05-discovery-connected.png) (Connection established)
- **Console & Network Evidence:**
  ```
  [Network] POST http://localhost:8080/__proxy/discovery-bootstrap -> 200 OK
  [Network] GET http://127.0.0.1:8644/health -> 200 OK {"ok": true, "worker": "browser-use-discovery"}
  ```
- **Wall-Clock Time:** 8,140 ms
- **Friction Tag:** `OK`

---

### Beat 6: You're Live (`#oneFlowBeatPayoff`)
- **Expected Behavior (Spec §5 Beat 6):**
  > "Spine: all six beats completed (checkmark). Step title: 'You're live'. Confetti burst on enter. Two summary cards: Card 1 (What JobBored will search for), Card 2 (What happens now: daily scan, deduplication, scoring). Line at bottom: 'Your first automated run happens at 6:00 AM tomorrow.' Primary action: 'Run discovery now'. Secondary: 'Take me to my board'."
- **Observed Behavior:**
  - Screen mounts with full spine completed and confetti celebration animation.
  - Card 1 renders search roles summary and armed sources count ("Google Jobs + 14 direct company boards").
  - **Friction Point (Console Error):** `oneflow-beat-payoff.js` attempted `GET http://localhost:8080/profile` resulting in a 404 error and logged `[JobBored] B6: could not read the saved profile: Error: profile_response_invalid`.
  - Clicking "Run discovery now" initiates the discovery webhook and displays the live streaming toast `Discovery running — 3 matches so far`.
  - The dashboard renders behind the toast as discovery runs in the background.
- **Video Timestamp:** `00:59 - 01:22`
- **Screenshot Evidence:**
  - [`b6-01-payoff-initial.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b6-01-payoff-initial.png) (Payoff screen with confetti)
  - [`b6-02-discovery-running-toast.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b6-02-discovery-running-toast.png) (Discovery running toast)
  - [`b6-03-board-post-setup.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b6-03-board-post-setup.png) (Live board with stream)
  - [`b6-04-post-setup-detail.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/b6-04-post-setup-detail.png) (Post-setup dashboard state)
- **Console & Network Evidence:**
  ```
  [Network] GET http://localhost:8080/profile -> 404 Not Found [ERROR]
  [Console warning] [JobBored] B6: could not read the saved profile: Error: profile_response_invalid at fetchProfile (fit-profile-wizard.js:194:22)
  [Network] POST http://127.0.0.1:8644/discovery -> 200 OK {"runId": "run_20260901_01", "statusPath": "/status/run_20260901_01"}
  ```
- **Wall-Clock Time:** 17,200 ms
- **Friction Tag:** `ERROR` (404 on /profile) / `OK` (Discovery execution)

---

## 3. Coverage Paths Walkthrough

### Path B: Second Google Identity on Configured Install
- **Goal:** Walk onboarding on a pre-configured instance with a second Google identity (`<redacted>`).
- **Observed Behavior:**
  - Loading `http://localhost:8080/` displays the sheet access gate with identity prompt.
  - Setting the second account email displays the account switch notification.
  - Opening the stepper walks Beats 1 through 6 with the second account context, creating an isolated fit profile draft and verifying discovery.
- **Video Reference:** [`path-b-desktop.webm`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-desktop.webm) (`00:00 - 00:32`)
- **Screenshots:**
  - [`path-b-01-landing-gate.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-01-landing-gate.png)
  - [`path-b-02-account-gate.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-02-account-gate.png)
  - [`path-b-03-beat1-google.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-03-beat1-google.png)
  - [`path-b-04-beat2-ai.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-04-beat2-ai.png)
  - [`path-b-05-beat2-verified.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-05-beat2-verified.png)
  - [`path-b-06-beat3-drafted.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-06-beat3-drafted.png)
  - [`path-b-07-beat4-fit.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-07-beat4-fit.png)
  - [`path-b-08-beat5-discovery.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-08-beat5-discovery.png)
  - [`path-b-09-beat6-payoff.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-b-09-beat6-payoff.png)
- **Friction Tag:** `OK`

---

### Path C: Interruption & Resume
- **Goal:** Verify stepper resilience against browser refresh and user dismissal (Escape key).
- **Observed Behavior:**
  - **Interruption 1 (Refresh in Beat 3):** Refreshing the browser while in Beat 3 resets the viewport back to the cold-start gate rather than rehydrating into Beat 3.
  - **Interruption 2 (Escape key in Beat 4):** Pressing Escape inside Beat 4 immediately dismisses the stepper overlay and reveals the underlying demo board with the persistent corner pill. Clicking the corner pill restores Beat 4 with the extracted draft intact.
  - **Interruption 3 (Refresh in Beat 5):** Refreshing the browser while in Beat 5 returns to the cold start gate.
- **Video Reference:** [`path-c-desktop.webm`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-c-desktop.webm) (`00:00 - 00:16`)
- **Screenshots:**
  - [`path-c-01-b3-before-refresh.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-c-01-b3-before-refresh.png)
  - [`path-c-02-b3-after-refresh.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-c-02-b3-after-refresh.png)
  - [`path-c-03-b4-before-escape.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-c-03-b4-before-escape.png)
  - [`path-c-04-b4-escaped-to-board.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-c-04-b4-escaped-to-board.png)
  - [`path-c-05-b4-reentry-restored.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-c-05-b4-reentry-restored.png)
  - [`path-c-06-b5-before-refresh.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-c-06-b5-before-refresh.png)
  - [`path-c-07-b5-after-refresh.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-c-07-b5-after-refresh.png)
- **Friction Tag:** `MISMATCH` / `CONFUSING` (Page reload resets active beat to landing gate)

---

### Path D: Honest Failures & Adapted Flow
- **Goal:** Verify honest error messaging on invalid API keys and the adapted fuel-only setup path.
- **Observed Behavior:**
  - **Beat 2 (Invalid OpenRouter Key):** Entering an invalid key and clicking "Check & continue" halts progression and displays the inline error notification: `The AI provider rejected this API key. Check that it was copied correctly.`
  - **Beat 5 (Invalid SerpApi Key):** Entering an invalid SerpApi key displays the inline error: `SerpApi key verification failed. Check the key and try again.`
  - **Beat 5 (Skip Discovery Connection):** Clicking "I'll set up the worker later" bypasses Tailscale setup and renders the adapted Beat 6 variant ("Fuel connected — automated discovery pending worker setup").
  - The post-setup board displays the adapted status indicator.
- **Video Reference:** [`path-d-desktop.webm`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-d-desktop.webm) (`00:00 - 00:26`)
- **Screenshots:**
  - [`path-d-01-beat2-bad-key-entered.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-d-01-beat2-bad-key-entered.png)
  - [`path-d-02-beat2-error-state.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-d-02-beat2-error-state.png)
  - [`path-d-03-beat5-bad-serpapi-entered.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-d-03-beat5-bad-serpapi-entered.png)
  - [`path-d-04-beat5-error-state.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-d-04-beat5-error-state.png)
  - [`path-d-05-beat5-skipped-connection.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-d-05-beat5-skipped-connection.png)
  - [`path-d-06-beat6-adapted-payoff.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-d-06-beat6-adapted-payoff.png)
  - [`path-d-07-post-setup-adapted-board.png`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/path-d-07-post-setup-adapted-board.png)
- **Friction Tag:** `OK`

---

## 4. Telemetry and Contract Evidence Summary

### Secret Sanitization
All recorded logs, screenshots, and telemetry payloads were scrubbed and sanitized. Secrets are represented as `<redacted>`.

### Network & Console Invariants
1. `config.js` returns 403 on zero-config static hosting (`KNOWN`).
2. `GET /__proxy/discovery-state` returns 403 when proxy server is unconfigured (`KNOWN`).
3. `GET /profile` returns 404 in Beat 6 when `fit-profile-wizard.js` tries to fetch profile from the static origin instead of local storage / server API (`ERROR` / `MISMATCH`).
4. Dual write order in Beat 3 verified: `user-content-store.js` (IndexedDB) write precedes server profile dispatch.
