# JobBored Greenfield Setup Audit & Redesign Spec
**Author:** Antigravity (Pair Programming Agent)  
**Date:** September 26, 2026  
**Audience:** Emilio ("Elio") Nunez Garcia, Opus 5.5 (BE Expert Squadron), GPT-6 SOL (FE Design Squadron)  
**Target Repo:** `Job-Bored` (commit: current `main` + working tree)

---

## 1. Executive Summary & The "So-What"

JobBored's core promise is brilliant: **a private, self-hosted job discovery and tracking command center backed by a user-owned Google Sheet, with zero maintainer data harvesting.**

However, the greenfield onboarding experience currently suffers from severe friction, developer-centric jargon ("AI slop" and engineer-brain UI), and a critical architectural bug in the SerpApi setup that traps users in an unsolvable error loop:
> *"Couldn't reach JobBored's local server to check your key — double-click start.command in the JobBored folder to start it, then press Save & verify."*

### Key Findings
1. **The SerpApi "Local Server" Trap ([confirmed](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-discovery.js#L823-L903)):** When users access JobBored via a hosted URL (e.g., `jobbored.elioai.app`, Cloudflare Pages, or GitHub Pages), the browser executes relative fetches to `/__proxy/ping` and `/__proxy/serpapi-check`. These requests hit the static hosting provider (returning a 404 HTML document) instead of the local dev-server. Even when `start.command` is running locally, CORS guards in [`scripts/lib/local-control-auth.mjs`](file:///Users/emilionunezgarcia/Job-Bored/scripts/lib/local-control-auth.mjs#L54-L96) explicitly block non-loopback origins with a `403 Forbidden`, causing the UI to display the error. Telling the user to *"double-click start.command... then press Save & verify"* in their current tab is impossible to satisfy.
2. **Google OAuth & Sheet Creation Friction ([confirmed](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-google.js#L253-L268)):** Setting up a Google OAuth Client ID is buried in an initially collapsed `<details>` accordion. The instructions tell users the process is *"genuinely tedious and takes about 10 minutes"* (demoralizing upfront), provide **zero clickable links** to the exact Google Cloud Console pages, and fail to explain the required OAuth scopes and consent screens clearly.
3. **The "Fitness Profile" UX is Visually Overwhelming ([confirmed](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-fit.js#L500-L705)):** The Fit Profile screen (Beat 4) attempts to cram a 3-column dense grid into an onboarding modal. It features microscopic micro-controls (`↑`, `↓`, `×` buttons on tiny pill tags), hidden textareas triggered by raw text links, multiple nested collapsible accordions, and a literal **raw JSON syntax dump** (`<pre>` block) in consumer onboarding.
4. **AI Key Selection Misalignment ([confirmed](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-ai.js#L98-L160)):** The flow recommends OpenRouter with paid credits upfront, relegating Google Gemini (which offers a free tier, grounded search, and URL import) to second place, creating unnecessary payment friction on step 2.

---

## 2. Greenfield User Walkthrough: Step-by-Step Teardown

Below is the complete audit of a brand-new user journey from initial load to first discovery run.

```mermaid
journey
    title Greenfield User Setup Journey
    section B1: Google & Sheet
      Open App / First Screen: 3: User
      Discover missing Client ID: 1: User
      Navigate Google Cloud Console: 1: User
      Sign in & Sheet Creation: 4: User
    section B2: AI Key
      Pick AI Provider: 3: User
      Gemini Key Entry: 4: User
      Key Verification: 4: User
    section B3: Resume
      Paste Resume / Pick Template: 4: User
      Wait for LLM extraction: 3: User
    section B4: Fit Profile
      View 3-column micro-grid: 1: User
      Edit tags & priorities: 2: User
      Encounter raw JSON pre block: 1: User
    section B5: Discovery & SerpApi
      Paste SerpApi Key: 4: User
      Click Save & Verify: 1: User
      Encounter "Local Server" Error: 1: User
      Attempt start.command loop: 1: User
    section B6: Payoff
      First Run Trigger: 3: User
```

---

### Step 1: Google OAuth & Pipeline Sheet Connection
**Files:** [`oneflow-beat-google.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-google.js), [`auth-session.js`](file:///Users/emilionunezgarcia/Job-Bored/auth-session.js), [`sheet-access-setup.js`](file:///Users/emilionunezgarcia/Job-Bored/sheet-access-setup.js)

#### User Experience
- The user is greeted with: *"Your pipeline lives in a Google Sheet you own."*
- Below is a primary button: **"Continue with Google"**.
- When clicked on a greenfield install (where `oauthClientId` is not yet configured), the button doesn't sign in. Instead, it triggers a warning tone and pops open a collapsed `<details>` drawer:
  > *"First time? You'll need a free Google app key"*  
  > *"Google needs a free 'app key' (it calls it a Client ID) that proves this copy of JobBored is yours. Making one takes about 10 minutes and it is genuinely tedious. You only ever do this once."*

#### Friction, Jargon & Issues
1. **Hostile Emotional Tone:** Telling the user their next task is *"genuinely tedious"* before they even start sets an adversarial, exhausting tone.
2. **Missing Deep Links:** In [`oneflow-beat-google.js#L253-L268`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-google.js#L253-L268), the six steps are plain unformatted text. The user has to manually navigate Google Cloud Console:
   - No direct link to create a project (`https://console.cloud.google.com/projectcreate`).
   - No direct link to OAuth consent screen (`https://console.cloud.google.com/apis/credentials/consent`).
   - No direct link to enable the Google Sheets API (`https://console.cloud.google.com/apis/library/sheets.googleapis.com`).
   - No direct link to Credentials (`https://console.cloud.google.com/apis/credentials/oauthclient`).
3. **Unclear Scopes & Permission Warnings:**
   - The user must guess what scopes to add. The app requests [`GOOGLE_SIGNIN_SCOPES`](file:///Users/emilionunezgarcia/Job-Bored/auth-session.js#L22-L26):
     - `https://www.googleapis.com/auth/spreadsheets`
     - `https://www.googleapis.com/auth/userinfo.email`
     - `https://www.googleapis.com/auth/userinfo.profile`
   - If the user fails to add their Google account as an "Audience / Test User", Google's sign-in modal throws: *"Error 403: access_denied / This app has not completed the Google verification process"*.
   - When configured correctly, Google still presents a scary unverified app warning: *"Google hasn't verified this app"*. The instructions mention *"Advanced → Go to JobBored"*, but lack visual emphasis or screenshots.
4. **Origin Mismatch Fragility:**
   - The user must copy "This page's origin" into "Authorized JavaScript origins".
   - If they run from `127.0.0.1:8080` vs `localhost:8080`, Google treats them as different origins and rejects the sign-in with `origin_mismatch`.

#### Recommendations for BE & FE
- **FE:** Replace the unlinked text list with an interactive, progressive 4-step checklist featuring direct one-click links to Google Cloud Console with prepopulated query parameters where supported.
- **FE:** Add an inline copy button for the exact origin and explicit guidance on the "Advanced → Proceed" consent flow.
- **BE/Script:** Offer a local helper script (`npm run setup:google-oauth` or an automated local OAuth redirect helper) for users running on their workstation.

---

### Step 2: AI Provider & Gemini API Key Setup
**Files:** [`oneflow-beat-ai.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-ai.js), [`resume-generate.js`](file:///Users/emilionunezgarcia/Job-Bored/resume-generate.js)

#### User Experience
- Headline: *"Now give it a brain."*
- Subtitle explains that one AI key powers fit profiling, scoring, tailored resumes, and cover letters.
- Card selector with 5 options: OpenRouter (pre-selected / "Recommended"), Gemini, OpenAI, Anthropic, Local (Ollama).

#### Friction, Jargon & Issues
1. **Unnecessary Paywall Barrier:** OpenRouter is set as the default recommendation, noting *"it's pay-as-you-go, so add a few dollars of credit."* This introduces payment friction on step 2 of a supposedly free open-source project.
2. **Gemini is Undersold:** Gemini is free-tier and automatically unlocks grounded web search and URL import. It should be the default option for zero-cost greenfield onboarding.
3. **Confusing Dev Server Warnings:** Options like OpenAI and Anthropic carry an inline tag:
   > *"runs through the local server — keep npm run dev running"*  
   A greenfield user who launched via `start.command` or a static host does not know what `npm run dev` is or why some models need it while others don't (CORS limitations).

#### Recommendations for BE & FE
- **FE:** Promote **Google Gemini** as the default recommended free provider (`AI Studio` key link). Place OpenRouter as the secondary choice for multi-model enthusiasts.
- **FE:** Clarify why keys are needed: *"Your key stays in your browser's private storage and talks directly to Google/OpenRouter. We never see it."*
- **BE:** Normalize LLM proxy endpoints so CORS handling is transparent to the user.

---

### Step 3: Resume Input & Parsing
**Files:** [`oneflow-beat-resume.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-resume.js), [`user-content-store.js`](file:///Users/emilionunezgarcia/Job-Bored/user-content-store.js)

#### User Experience
- The user pastes their resume text or selects from 4 starter personas (Marketer, Engineer, Product Manager, Blank).
- Clicking "Analyze resume" calls the AI provider configured in Step 2 to generate structured JSON for Step 4.

#### Friction & Issues
- If the AI key in Step 2 was valid but rate-limited or throttled, this step hangs with a generic spinner before timing out.
- Plain text pasting often strips formatting from PDFs or Word docs; there is no drag-and-drop PDF extraction in the main flow.

---

### Step 4: Fitness Profile ("Your Fit") Setup — The UX Teardown
**Files:** [`oneflow-beat-fit.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-fit.js), [`css/oneflow.css`](file:///Users/emilionunezgarcia/Job-Bored/css/oneflow.css#L860-L1054), [`fit-profile-wizard.js`](file:///Users/emilionunezgarcia/Job-Bored/fit-profile-wizard.js)

#### User Experience
- Headline: *"Here's how we'll judge every job for you."*
- Subtitle: *"We drafted this from your resume. Fix anything that's off — this is the one-time part that makes every match yours."*
- A dense 3-column grid is rendered inside the modal dialog:
  - **Column 1 ("Looking for"):** Chip list of target roles + Seniority dropdown + location preview line.
  - **Column 2 ("Your edge"):** Drag-and-drop list of strengths with up/down arrows and ranking numbers, followed by an italicized "primary narrative" paragraph with a tiny "edit" text button that toggles a hidden textarea.
  - **Column 3 ("Lean toward / away"):** Two stacked chip lists for "wants" and "avoids".
- Below the grid is a collapsible `<details>` accordion: **"Edit details"** containing 8 form fields (Work mode radios, acceptable locations, salary floor, salary requirement checkbox, skip titles, work authorization).
- Below that is **ANOTHER** collapsible `<details>` accordion: **"Raw profile JSON"** displaying an unformatted JSON `<pre>` block!

```
+---------------------------------------------------------------------------------------+
|  Here's how we'll judge every job for you.                                            |
|  [ Looking for ]              [ Your edge ]               [ Lean toward / away ]       |
|  (Role 1) [↑][↓][×]           1. [Strength 1] [↑][↓][×]   Wants:                      |
|  (Role 2) [↑][↓][×]           2. [Strength 2] [↑][↓][×]   (want 1) [×] (want 2) [×]   |
|  [+ Add role]                 [+ Add strength]            Avoids:                     |
|  Seniority: [ Senior    v ]   "I lead teams..." [edit]    (avoid 1) [×]               |
+---------------------------------------------------------------------------------------+
|  ▶ Edit details (Work mode, Salary floor, Locations, Skip titles, Work auth)          |
+---------------------------------------------------------------------------------------+
|  ▶ Raw profile JSON  { "version": 1, "identity": { ... } }                            |
+---------------------------------------------------------------------------------------+
```

#### Why it's "Hideous": Detailed UX & Design Teardown
1. **Cognitive Overload in a Single Viewport:** Squeezing 15+ complex filtering vectors into a cramped 3-column modal destroys visual hierarchy. Every element competes for attention.
2. **Micro-Interaction Clutter:**
   - Every chip has three microscopic buttons: `↑`, `↓`, and `×`.
   - The chip input fields have a hardcoded `width: 11rem` in CSS ([`css/oneflow.css#L921`](file:///Users/emilionunezgarcia/Job-Bored/css/oneflow.css#L921)), which causes ugly word wrapping and overflow on smaller displays.
   - Text editing inside chips feels broken; clicking a chip often triggers the drag-and-drop handler rather than text editing.
3. **The "Edit" Link Button Anti-Pattern:** The primary narrative is rendered as static italicized text with a tiny blue underline link labeled `edit` ([`oneflow-beat-fit.js#L560-L565`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-fit.js#L560-L565)). Clicking it toggles a raw `<textarea>` with 4 rows. This feels like an internal admin debug tool from 2005.
4. **Raw JSON Leakage:** Exposing `<details class="oneflow-fit-json"><summary>Raw profile JSON</summary><pre>...</pre></details>` in an onboarding flow for job seekers is quintessential engineer brain. A user wanting to find a job should never be handed a JSON AST to inspect.
5. **Two Conflicting Profile Systems:**
   - The codebase has `oneflow-beat-fit.js` (B4) *and* `fit-profile-wizard.js` (a legacy 5-step wizard) *and* `fit-profile-editor.js` (Settings tab). They have completely different CSS classes (`.oneflow-fit-*` vs `.fp-*`), different color schemes, and disjointed validation rules.

#### Recommendations for FE Design (GPT-6 SOL)
- **Transform into a "Career Intent Studio":** Replace the chaotic grid with a clean, 2-column or step-guided card layout:
  - **Left / Hero Section:** "Your Target Identity" — Prominent role pills (modern tags with tap-to-remove), Seniority badge, and an editable Narrative Card with an auto-expanding clean textarea.
  - **Right Section:** "Your Evaluation Criteria" — Clear tabs or segmented cards for **Strengths & Superpowers**, **Preferences (Wants vs Avoids)**, and **Hard Guardrails (Salary, Location, Remote)**.
- **Eliminate the JSON block entirely** from onboarding (relegate it to an Advanced Developer section in Settings).
- **Modern Tag Input:** Replace the brittle chip inputs (`width: 11rem` + arrow buttons) with standard fluid tag inputs: type and press enter/comma, click `×` to remove. Prioritization should use a clean vertical reorderable list with smooth drag handles, not inline `↑`/`↓` character buttons.

---

### Step 5: Discovery Setup & The SerpApi Local Server Error
**Files:** [`oneflow-beat-discovery.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-discovery.js), [`dev-server.mjs`](file:///Users/emilionunezgarcia/Job-Bored/dev-server.mjs), [`scripts/lib/local-control-auth.mjs`](file:///Users/emilionunezgarcia/Job-Bored/scripts/lib/local-control-auth.mjs), [`start.sh`](file:///Users/emilionunezgarcia/Job-Bored/start.sh)

#### User Experience
- Headline: *"Now the engine: jobs come to you."*
- Section 1: *"First, the fuel: Google's job index."*
- Step instructions:
  1. Create a free SerpApi account.
  2. Copy API key.
  3. Paste key and hit "Save & verify".
- User pastes their key and clicks **"Save & verify"**.
- **The Screen Fails with Error:**
  > **"Couldn't reach JobBored's local server to check your key — double-click start.command in the JobBored folder to start it, then press Save & verify."**

```
+---------------------------------------------------------------------------------------+
|  First, the fuel: Google's job index.                                                 |
|  [ Paste SerpApi Key: •••••••••••••••••••••••••••• ]                                  |
|  [ Save & verify ]                                                                    |
|                                                                                       |
|  (!) Couldn't reach JobBored's local server to check your key — double-click         |
|      start.command in the JobBored folder to start it, then press Save & verify.      |
+---------------------------------------------------------------------------------------+
```

#### Complete Architectural Root Cause Analysis
Why does this happen, and why is the user trapped?

1. **Relative Proxy Routing on Hosted/Static Origins ([confirmed](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-discovery.js#L842-L878)):**
   - The browser executes:
     ```javascript
     const ping = await fetch("/__proxy/ping");
     const response = await fetch("/__proxy/serpapi-check", { method: "POST", ... });
     ```
   - When a user opens JobBored from `https://jobbored.elioai.app`, `https://emilio3435.github.io/Job-Bored`, or a Cloudflare Pages domain, the browser fetches `https://jobbored.elioai.app/__proxy/ping`.
   - The static CDN returns **404 Not Found (or HTML 404)**.
   - The client code classifies this as `no_local_server` ([`oneflow-beat-discovery.js#L865`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-discovery.js#L865)) and renders `FUEL_CHECK_ERRORS.no_local_server`.

2. **The `start.command` Broken Remediation Loop ([confirmed](file:///Users/emilionunezgarcia/Job-Bored/start.sh#L19-L117)):**
   - The error tells the user: *"double-click start.command in the JobBored folder to start it, then press Save & verify."*
   - When the user double-clicks `start.command`, [`start.sh`](file:///Users/emilionunezgarcia/Job-Bored/start.sh) boots `dev-server.mjs` on `http://localhost:8080` and opens `http://localhost:8080/?beat=discovery` in a **new browser tab/window**.
   - If the user follows the instructions literally and stays in their original tab (clicking "Save & verify" again), **it still fails!** Their original tab is still on the hosted origin and still fetching relative to that origin.
   - Even if the original tab tries to fetch `http://localhost:8080/__proxy/serpapi-check`:
     The request is blocked by **CORS / Local Control Security Boundary**:
     [`scripts/lib/local-control-auth.mjs#L65-L95`](file:///Users/emilionunezgarcia/Job-Bored/scripts/lib/local-control-auth.mjs#L65-L95) mandates that the request Origin must exactly match `localControlOrigins`:
     ```javascript
     export function localControlOrigins({ port, tls = false } = {}) {
       return [
         `http://127.0.0.1:${port}`,
         `http://localhost:${port}`,
         `http://[::1]:${port}`,
       ];
     }
     ```
     Requests originating from `https://jobbored.elioai.app` or any other origin receive `403 Forbidden` (`untrusted_origin`).
   - And what does `checkFuelKey` do with a 403 Forbidden? It falls back to `no_local_server`! The loop is unbreakable without closing the tab and starting over on `localhost:8080`.

3. **CORS Architectural Dilemma:**
   - SerpApi's upstream API (`https://serpapi.com/account.json`) does not send `Access-Control-Allow-Origin: *`.
   - Browsers cannot call SerpApi directly without a backend proxy.
   - JobBored is advertised as a static dashboard, yet this critical verification step enforces a hard dependency on a locally running Node dev-server reverse proxy.

#### Recommendations for BE & FE
- **BE Architecture Fix (Opus 5.5):**
  1. **Dual-Mode Verification:** If `window.location.origin` is loopback (`localhost`/`127.0.0.1`), use the local proxy `/__proxy/serpapi-check`.
  2. If running from a hosted static site:
     - Check if a configured local worker URL or relay URL exists.
     - If no local proxy is reachable, do **NOT** hard-block the user. Provide an unverified save option: validate key format client-side (SerpApi keys are 64-character hex strings), store the key securely in browser storage/local worker `.env`, and schedule the verification for the first discovery run.
  3. **Allow Hosted Dashboard Origin in Dev-Server CORS:** Update [`dev-server.mjs#L1742-L1750`](file:///Users/emilionunezgarcia/Job-Bored/dev-server.mjs#L1742-L1750) and [`scripts/lib/local-control-auth.mjs`](file:///Users/emilionunezgarcia/Job-Bored/scripts/lib/local-control-auth.mjs) so that loopback requests originating from the configured hosted domain (e.g. `CNAME` origin or user-configured app origin) are recognized as authorized local-control peers for key verification.
- **FE UX Fix (GPT-6 SOL):**
  - Clarify the architecture honestly: *"JobBored needs a local runner on your machine to search Google Jobs and bypass browser restrictions."*
  - If the check cannot reach the local server, offer a clear choice:
    - `[ Switch to Local App (Open localhost:8080) ]`
    - `[ Save Key Without Verification ]` (proceed with setup, verify on first run).
    - Never trap the user behind a single disabled button.

---

### Step 6: Discovery Connection & Payoff (Beat B6)
**Files:** [`oneflow-beat-payoff.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-payoff.js), [`oneflow-beat-discovery.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-discovery.js)

#### User Experience
- Discovery connection attempts Tailscale auto-setup. If Tailscale is not present, it offers a "Just this computer" local connection fallback.
- Beat B6 ("You're live, {firstName}") summarizes:
  - Sheet connected ✓
  - AI provider armed ✓
  - Search criteria configured ✓
- Button: **"Run discovery now"** (guaranteed full-power run).

#### Friction & Delights
- **Delight:** Once reached, Beat 6 is clean and personalized. Calling the user by their Google First Name and summarizing their specific search criteria gives an immediate sense of accomplishment.
- **Friction:** If any upstream step was skipped (e.g., discovery connect skipped), B6 shows hollow circles (`○`) with warning copy: *"Connection is off — your AI and Google-index keys are saved; connect anytime from the banner below"*. This dampens the celebration.

---

## 3. Comprehensive Jargon & "AI Slop" Inventory

| Screen / Step | Current Text / Jargon | Why It's Bad | Recommended Replacement |
|---|---|---|---|
| **B1: Google** | *"Making one takes about 10 minutes and it is genuinely tedious. You only ever do this once."* | Discouraging, unprofessional, creates instant user dread. | *"Google requires a free developer key (Client ID) so your browser can talk directly to your Sheet. It takes about 3 minutes to generate."* |
| **B1: Google** | *"Under Authorized JavaScript origins, click Add URI and paste this page's origin. Leave redirect URIs empty — JobBored doesn't use them."* | Technical developer speak; doesn't explain what an origin is or why it matters. | *"Paste your app address into 'Authorized JavaScript origins' (click Copy below). Leave redirect URIs blank."* |
| **B2: AI** | *"CORS note: runs through the local server — keep npm run dev running"* | Mentions internal browser security concepts (CORS) and terminal commands to non-technical users. | *"Requires the JobBored background app to be running on your computer."* |
| **B4: Fit** | `<details><summary>Raw profile JSON</summary><pre>{ ... }</pre></details>` | Blatant engineer-brain leakage; completely irrelevant to someone looking for a job. | **Remove completely from onboarding.** Move to Settings → Developer Tools. |
| **B4: Fit** | Micro-buttons `[↑][↓][×]` on tag pills | Microscopic click targets, visually noisy, feels like a prototype form builder. | Modern fluid tags with tap-to-dismiss and clean drag-to-reorder list items. |
| **B5: SerpApi** | *"First, the fuel: Google's job index."* | Mixed metaphors ("fuel", "engine", "scout", "brain"). Confuses what is an API key vs software. | *"Step 1: Connect Google Jobs Search (SerpApi)"* |
| **B5: SerpApi** | *"Couldn't reach JobBored's local server to check your key — double-click start.command..."* | Cryptic, inaccurate when on hosted site, traps user in broken loop. | *"Unable to reach the local background helper. If you're using JobBored in your browser, switch to your local app or save the key to verify later."* |

---

## 4. Google Sheets API & Permissions Blueprint (Linked & Concise)

For the user or agent authoring documentation and in-app tooltips, here is the exact, unambiguous permission model:

### Required APIs & Scopes
1. **Google Sheets API:** `sheets.googleapis.com` (Must be Enabled in Google Cloud Project).
2. **OAuth Consent Scopes:**
   - `https://www.googleapis.com/auth/spreadsheets` (Read/Write access to the user's Google Sheets to manage the Pipeline tab).
   - `https://www.googleapis.com/auth/userinfo.email` (Display user identity and sign-in status).
   - `https://www.googleapis.com/auth/userinfo.profile` (Fetch given name for personalized onboarding greeting).
3. **Google Drive API:** **NOT NEEDED.** JobBored creates and accesses Sheets via the Sheets API v4 directly. Do **not** request Drive root scopes.

### Exact 4-Step Google Cloud Setup Matrix
1. **Create Project:** Go to [Google Cloud Console → New Project](https://console.cloud.google.com/projectcreate). Name it `JobBored` and click **Create**.
2. **Configure Consent:** Go to [OAuth Consent Screen](https://console.cloud.google.com/apis/credentials/consent):
   - User Type: **External**.
   - App Name: `JobBored`, Support Email: your email.
   - Audience / Test Users: **Add your own Gmail address as a Test User** (Critical: prevents 403 `access_denied`).
3. **Enable Sheets API:** Go to [Google Sheets API Library](https://console.cloud.google.com/apis/library/sheets.googleapis.com) and click **Enable**.
4. **Create OAuth Client ID:** Go to [Credentials → Create Credentials → OAuth client ID](https://console.cloud.google.com/apis/credentials/oauthclient):
   - Application type: **Web application**.
   - Name: `JobBored Web Client`.
   - **Authorized JavaScript origins:** Add your current URL (e.g. `http://localhost:8080` or `https://jobbored.elioai.app`).
   - Click **Create**, copy the Client ID (ends in `.apps.googleusercontent.com`), and paste into JobBored.

---

## 5. Engineering Action Plan & Agent Work Packages

### Squadron 1: BE Expert Agent (Opus 5.5) — Backend & Protocol Hardening
**Mission:** Eliminate the local server verification trap, harden dev-server proxy auth, and streamline multi-origin key persistence.

#### Work Package BE-1: Dual-Mode SerpApi Verification Endpoint
- **Target Files:** [`dev-server.mjs`](file:///Users/emilionunezgarcia/Job-Bored/dev-server.mjs), [`oneflow-beat-discovery.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-discovery.js)
- **Task:**
  1. In `oneflow-beat-discovery.js`, inspect `window.location.origin`. If running on a remote/hosted origin without an active loopback proxy connection, do not make relative calls to `/__proxy/*` that 404.
  2. Implement client-side syntactic key validation for SerpApi (`/^[a-f0-9]{64}$/i`). If valid, allow "Save & Verify Later" when the local server is offline.
  3. When running against loopback, ensure `/__proxy/serpapi-check` returns informative JSON:
     `{ ok: false, reason: "server_offline" | "invalid_key" | "quota_exhausted" | "forbidden_origin" }`.

#### Work Package BE-2: Relaxed Hosted-Origin CORS for Loopback Probing
- **Target Files:** [`scripts/lib/local-control-auth.mjs`](file:///Users/emilionunezgarcia/Job-Bored/scripts/lib/local-control-auth.mjs), [`dev-server.mjs`](file:///Users/emilionunezgarcia/Job-Bored/dev-server.mjs)
- **Task:**
  1. Allow the dashboard origin specified in `CNAME` or `config.js` to perform loopback `POST /__proxy/serpapi-check` if the TCP peer is verified loopback (`127.0.0.1` / `::1`).
  2. This enables a user running the frontend on `https://jobbored.elioai.app` or GitHub Pages to check keys against their local `dev-server.mjs` running on `localhost:8080`.

#### Work Package BE-3: Worker Auto-Start & Start Script Handoff
- **Target Files:** [`start.sh`](file:///Users/emilionunezgarcia/Job-Bored/start.sh), [`package.json`](file:///Users/emilionunezgarcia/Job-Bored/package.json)
- **Task:**
  1. `start.sh` currently executes `npm start`, which only runs `start:web` and `start:scraper` (missing `discovery-worker`).
  2. Update `start.sh` or provide `npm run dev` orchestration so double-clicking `start.command` starts the discovery worker alongside the web server, ensuring `/__proxy/local-health` immediately passes.

---

### Squadron 2: FE Design Agent (GPT-6 SOL) — UI/UX Overhaul
**Mission:** Transform the setup flow from an engineer's configuration script into an elegant, consumer-grade onboarding studio.

#### Work Package FE-1: Fitness Profile ("Your Fit") Redesign
- **Target Files:** [`oneflow-beat-fit.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-fit.js), [`css/oneflow.css`](file:///Users/emilionunezgarcia/Job-Bored/css/oneflow.css)
- **Design Spec:**
  1. **Layout:** Split the modal into two clear, balanced panes:
     - **Left Pane ("Your Career Story"):** Target roles pill group with quick-add tag bar; Seniority selector dropdown; Primary narrative editor with a clean auto-expanding textarea and subtle character counter.
     - **Right Pane ("Evaluation Guardrails"):**
       - Strengths card: numbered vertical cards with subtle drag handles and inline edit/delete.
       - Desires card: Clean segmented control for "What you love" (Wants) vs "Dealbreakers" (Avoids).
       - Constraints card: Clean pill toggles for Work Mode (Remote / Hybrid / Onsite), salary floor input with formatted currency, and work authorization.
  2. **Interactions:**
     - Replace micro-buttons `[↑][↓][×]` with native drag-to-reorder and standard `×` dismiss icons.
     - Remove the `Raw profile JSON` pre block completely from onboarding.
     - Add visual polish with JobBored's design tokens (`var(--jb-navy)`, `var(--jb-mint)`, smooth border radii, subtle focus rings).

#### Work Package FE-2: Guided Google OAuth Stepper
- **Target Files:** [`oneflow-beat-google.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-google.js), [`css/oneflow.css`](file:///Users/emilionunezgarcia/Job-Bored/css/oneflow.css)
- **Design Spec:**
  1. Replace the plain `<ol>` in the detour with an interactive 4-step accordion or horizontal stepper cards:
     - Card 1: **New Project** (One-click button: "Open Google Cloud Console ↗").
     - Card 2: **Consent Screen & Scopes** (Clear badge: "Add yourself as Test User").
     - Card 3: **Enable Sheets API** (Direct link to Sheets API).
     - Card 4: **Create Client ID** (Click-to-copy origin button + auto-detecting Client ID input).
  2. Tone revision: Remove "genuinely tedious" and replace with empowering, outcome-oriented copy.

#### Work Package FE-3: SerpApi Error Recovery & Unverified Flow
- **Target Files:** [`oneflow-beat-discovery.js`](file:///Users/emilionunezgarcia/Job-Bored/oneflow-beat-discovery.js), [`css/oneflow.css`](file:///Users/emilionunezgarcia/Job-Bored/css/oneflow.css)
- **Design Spec:**
  1. When a key check fails due to local server unavailability, display an actionable recovery card:
     - Explain clearly: *"We couldn't reach your local JobBored helper to test this key right now."*
     - Offer two clear actions:
       - Primary: `[ Save Key & Continue Anyway ]`
       - Secondary: `[ How to start the local helper ↗ ]`
  2. Provide live feedback when a key matches the expected 64-character format.

---

## 6. Verification Floor & Test Matrix

Before merging any changes resulting from these work packages, the following floor commands must be executed and confirmed:

```bash
# 1. Repository linting
npm run lint:repo

# 2. Type checking across root, server, and worker
npm run typecheck:repo

# 3. Unit and harness tests for beats and onboarding
npm test -- tests/oneflow-l3-beat-discovery.test.mjs
npm test -- tests/oneflow-b5-connect-healing.test.mjs
npm test -- tests/oneflow-b5-static-handoff.test.mjs
npm test -- tests/e2e-onboarding/greenfield-onboarding.spec.mjs

# 4. Discovery contracts
npm run test:contract:all
```

---

*Artifact created: `greenfield-setup-teardown-and-spec.md` in conversation brain.*
