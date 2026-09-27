## Outcome Contract

- **Goal**: Perform a read-only exploration of the JobBored greenfield onboarding path across the 13 specified UI, controller, wizard, access, and documentation files, generating a comprehensive copy inventory of user-facing strings and cataloging terminology variants that describe identical concepts.
- **Success means**: An exact inventory table adhering strictly to the schema `file:line | beat (B1..B6 / wizard / docs) | exact string (verbatim, truncated at 160 chars) | kind (headline, button, error, help, link label, doc)` capped below 900 rows (actual count: 618 rows), accompanied by exact counts and `file:line` citations for all specified terminology variants, written to the artifact directory report path.
- **Stop when**: All 13 target files have been audited, all user-facing strings are cataloged without modifying any source files, and the report artifact is fully persisted.

---

## Floor Verification & Evidence

The inventory script was executed directly against the repository worktree at `/Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration`.

```bash
node /Users/emilionunezgarcia/.gemini/antigravity-cli/brain/cc964cf0-1e84-4d42-8150-9e308323c9f7/scratch/build_all_inventory.mjs
```

**Output**:
```text
Total inventory rows: 618
```

The comprehensive copy inventory artifact has been persisted to [copy_inventory.md](file:///Users/emilionunezgarcia/.gemini/antigravity-cli/brain/cc964cf0-1e84-4d42-8150-9e308323c9f7/copy_inventory.md).

---

## Files Audited

Every user-facing string was inspected across the following 13 files:

1. [oneflow-beat-google.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js) (Beat B1: Connect Google & create/verify Sheet)
2. [oneflow-beat-ai.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js) (Beat B2: AI provider key verification)
3. [oneflow-beat-resume.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js) (Beat B3: Resume upload/paste & drafting)
4. [oneflow-beat-fit.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js) (Beat B4: Fit profile confirmation & constraints)
5. [oneflow-beat-discovery.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js) (Beat B5: SerpApi fuel & discovery connectivity)
6. [oneflow-beat-payoff.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js) (Beat B6: Payoff receipt & first discovery run)
7. [onboarding-flow.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js) (Spine navigation, step gates, and pause/resume toasts)
8. [discovery-wizard-ui.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js) (Discovery wizard form controls, copy actions, and options)
9. [discovery-wizard-shell.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js) (Wizard modal framing, steps rail, and status badges)
10. [sheet-access-setup.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js) (User-visible gate screens, tip carousel, and repair actions)
11. [auth-session.js](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js) (User-visible auth toasts, session expiry notices, and autostart pills)
12. [SETUP.md](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md) (Setup sections: Quick start, paths 1–3, sheet setup, OAuth, deploy, SerpApi)
13. [README.md](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md) (Setup sections: Quick start, commands, setup reference, deployment axes)

---

## Terminology Variants Analysis

Four major terminology variant clusters were evaluated across code and documentation. Claims are marked as **[Confirmed]** based on code citations.

### 1. Google OAuth Identifier Variants (`Client ID` / `app key` / `OAuth client`)
The application shifts terminology depending on whether it is addressing a non-technical user in onboarding, guiding a developer in Cloud Console, or presenting an error dialog.

- **`Client ID`** (19 user-facing occurrences) **[Confirmed]**:
  The dominant term across the application UI and developer documentation.
  - [oneflow-beat-google.js:42](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L42): `"Paste your Client ID to continue."`
  - [oneflow-beat-google.js:267](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L267): `"Click Create. Google shows your Client ID — paste it below."`
  - [oneflow-beat-google.js:293](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L293): `"Google needs a free \"app key\" (it calls it a Client ID)..."`
  - [oneflow-beat-google.js:371](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L371): `"aria-label": "Your Google app key (Client ID)"`
  - [oneflow-beat-google.js:382](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L382): `"Save Client ID"`
  - [oneflow-beat-google.js:394](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L394): `"A Client ID always ends in .apps.googleusercontent.com."`
  - [oneflow-beat-google.js:406](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L406): `"recreate the Client ID as a Web application."`
  - [oneflow-beat-google.js:446](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L446): `"That doesn't look like a Client ID — it should end in .apps.googleusercontent.com. Paste the whole thing."`
  - [oneflow-beat-google.js:460](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L460): `"Client ID saved. Continue with Google below."`
  - [sheet-access-setup.js:453](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L453): `"JobBored needs a Google OAuth Client ID before it can open your sheet. Add one in Settings, then reload."`
  - [sheet-access-setup.js:458](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L458): `"Add a Client ID in Settings, then reload."`
  - [sheet-access-setup.js:768](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L768): `"Paste your Google OAuth Client ID above, then create the sheet."`
  - [SETUP.md:133](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L133): `5. Create OAuth 2.0 Client ID:`
  - [SETUP.md:135](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L135): `- Click **Create Credentials → OAuth client ID**`
  - [SETUP.md:139](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L139): `- Copy the **Client ID** (ends in .apps.googleusercontent.com)`
  - [SETUP.md:144](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L144): `Paste the OAuth Client ID and your Sheet URL when prompted;`
  - [README.md:41](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L41): `create an OAuth Client ID if you don't have one`
  - [README.md:203](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L203): `5. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**`
  - [README.md:206](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L206): `8. Copy the **Client ID**`

- **`app key`** (4 user-facing occurrences) **[Confirmed]**:
  Used intentionally in Beat 1 as an approachable colloquial analogy to explain what a Client ID is.
  - [oneflow-beat-google.js:285](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L285): `"First time? You'll need a free Google app key"`
  - [oneflow-beat-google.js:293](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L293): `"Google needs a free \"app key\" (it calls it a Client ID)..."`
  - [oneflow-beat-google.js:371](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L371): `"aria-label": "Your Google app key (Client ID)"`
  - [auth-session.js:713](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L713): `"Google didn't recognize this page's address. Check the address listed in your Google app key settings, then try signing in again."`

- **`OAuth client`** (5 user-facing occurrences) **[Confirmed]**:
  Used in console configuration instructions and error boundary prompts.
  - [oneflow-beat-google.js:263](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L263): `"Open Credentials → Create credentials → OAuth client ID → application type Web application."`
  - [sheet-access-setup.js:774](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L774): `"Save a Google OAuth client in Settings first, then come back and create the sheet."`
  - [sheet-access-setup.js:784](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L784): `"Google sign-in is not ready yet. Save the OAuth client, reload, then try again."`
  - [auth-session.js:1003](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1003): `"Google sign-in is not ready yet. Save your OAuth client and reload first."`
  - [README.md:225](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L225): `6. Add that URL to your OAuth client's Authorized JavaScript Origins`

- **`Google OAuth credentials`** (2 occurrences) **[Confirmed]**:
  Section titles in documentation.
  - [SETUP.md:119](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L119): `### 2. Create Google OAuth Credentials`
  - [README.md:195](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L195): `### 2. Create Google OAuth credentials`

---

### 2. Server Execution Command Variants
The codebase alternates between double-clickable GUI scripts, npm commands, and shell scripts to launch local services.

- **`start.command`** (4 user-facing occurrences) **[Confirmed]**:
  The macOS double-clickable launcher file cited in UI error messages.
  - [oneflow-beat-resume.js:558](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L558): `"start.command in the JobBored folder to start it, then try again."`
  - [oneflow-beat-discovery.js:204](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L204): `"double-click start.command in the JobBored folder"`
  - [discovery-wizard-ui.js:1006](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1006): `"otherwise double-click start.command in the JobBored folder to start it, then Re-check."`
  - [discovery-wizard-ui.js:2632](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L2632): `"otherwise double-click start.command in the JobBored folder to start it, then Re-check."`

- **`npm start`** (14 occurrences) **[Confirmed]**:
  Starts both dashboard and local scraper API on localhost:8080 and 127.0.0.1:3847.
  - [SETUP.md:54](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L54), [SETUP.md:287](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L287), [SETUP.md:291](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L291), [SETUP.md:293](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L293), [SETUP.md:295](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L295), [SETUP.md:300](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L300)
  - [README.md:36](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L36), [README.md:67](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L67), [README.md:160](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L160), [README.md:171](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L171), [README.md:261](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L261), [README.md:269](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L269), [README.md:319](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L319), [README.md:432](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L432)

- **`npm run dev`** (10 occurrences) **[Confirmed]**:
  Starts dashboard, scraper, and local discovery worker concurrently.
  - [oneflow-beat-ai.js:50](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L50): `"runs through the local server — keep npm run dev running"`
  - [oneflow-beat-ai.js:459](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L459): `"JobBored running on this computer (npm run dev) and try again."`
  - [SETUP.md:67](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L67), [SETUP.md:273](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L273)
  - [README.md:46](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L46), [README.md:124](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L124), [README.md:262](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L262), [README.md:269](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L269), [README.md:320](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L320), [README.md:432](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L432)

- **`the start command / start command`** (3 occurrences) **[Confirmed]**:
  - [oneflow-beat-discovery.js:184](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L184): `"keeps one start command across beats"`
  - [discovery-wizard-ui.js:646](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L646): `"local worker start command"`
  - [README.md:44](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L44): `"Two variants of the start command:"`

- **`./start.sh`** (1 occurrence) **[Confirmed]**:
  The Linux/fallback shell script cited in Beat B5.
  - [oneflow-beat-discovery.js:205](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L205): `"run ./start.sh in the JobBored folder"`

---

### 3. Conceptual Metaphor Variants (`fuel` / `engine` / `brain`)
JobBored applies a mechanical metaphor across beats 2 and 5 to explain AI intelligence and search indexing:

- **`brain`** (2 occurrences) **[Confirmed]**:
  Refers to the LLM provider key (OpenRouter, Gemini, OpenAI, Anthropic, Ollama) that powers scoring and draft generation.
  - [oneflow-beat-ai.js:2](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L2): `"Beat B2 of the one-flow onboarding — Give it a brain."`
  - [oneflow-beat-ai.js:23](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L23): `"const HEADLINE = \"Now give it a brain.\";"`

- **`fuel`** (3 user-facing copy occurrences) **[Confirmed]**:
  Refers to the SerpApi Google Jobs index API key required before discovery can run.
  - [oneflow-beat-discovery.js:7](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L7): `"1. FUEL (SerpApi, required)."`
  - [oneflow-beat-discovery.js:37](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L37): `"const FUEL_TITLE = \"First, the fuel: Google's job index.\";"`
  - [oneflow-beat-discovery.js:570](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L570): `"Add your SerpApi key above first — the engine needs fuel before it needs a connection."`

- **`engine`** (5 user-facing copy occurrences) **[Confirmed]**:
  Refers to the automated discovery crawler/matching worker.
  - [oneflow-beat-discovery.js:28](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L28): `"const HEADLINE = \"Now the engine: jobs come to you.\";"`
  - [oneflow-beat-discovery.js:570](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L570): `"Add your SerpApi key above first — the engine needs fuel before it needs a connection."`
  - [discovery-wizard-shell.js:371](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L371): `"none: \"No engine\""`
  - [discovery-wizard-shell.js:393](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L393): `"label: \"Engine\""`
  - [discovery-wizard-ui.js:753](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L753): `"...browser-use worker is the recommended local discovery engine."`

---

### 4. Discovery Path Name Variants
The system identifies its various discovery runner and network connection topologies under several distinct labels:

1. **`Tailscale / Stable URL · Tailscale (recommended) / One-click`** (17 occurrences) **[Confirmed]**:
   - [oneflow-beat-discovery.js:14](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L14), [560](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L560), [577](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L577), [579](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L579), [588](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L588), [612](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L612)
   - [discovery-wizard-shell.js:45](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L45), [47](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L47)
   - [discovery-wizard-ui.js:763](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L763), [773](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L773), [814](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L814), [815](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L815), [987](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L987), [1069](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1069)
   - [README.md:53](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L53), [314](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L314), [326](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L326), [432](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L432)

2. **`Local discovery worker / Local worker / Just this computer / local_agent`** (11 occurrences) **[Confirmed]**:
   - [oneflow-beat-discovery.js:90](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L90)
   - [discovery-wizard-shell.js:385](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L385)
   - [discovery-wizard-ui.js:754](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L754), [804](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L804), [805](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L805)
   - [SETUP.md:63](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L63), [67](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L67)
   - [README.md:46](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L46), [121](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L121), [262](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L262), [432](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L432)

3. **`No webhook (manual) / Keep discovery manual / Manual / no_webhook`** (6 occurrences) **[Confirmed]**:
   - [discovery-wizard-shell.js:37](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L37), [38](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L38), [39](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L39), [387](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L387)
   - [discovery-wizard-ui.js:780](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L780), [781](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L781)

4. **`External endpoint / Webhook / paste your own endpoint / generic_https`** (11 occurrences) **[Confirmed]**:
   - [oneflow-beat-discovery.js:612](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L612), [618](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L618), [641](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L641)
   - [discovery-wizard-shell.js:44](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L44), [386](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L386)
   - [discovery-wizard-ui.js:355](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L355), [356](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L356), [741](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L741), [756](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L756), [1069](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1069), [1080](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1080)

5. **`Cloudflare relay / Cloudflare Worker / Relay / relay_deploy`** (10 occurrences) **[Confirmed]**:
   - [discovery-wizard-shell.js:75](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L75), [76](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L76), [77](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L77), [413](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L413)
   - [discovery-wizard-ui.js:333](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L333), [335](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L335), [1435](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1435), [1475](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1475)
   - [SETUP.md:174](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L174)
   - [README.md:53](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L53)

6. **`ngrok tunnel / ngrok / Tunnel`** (8 occurrences) **[Confirmed]**:
   - [discovery-wizard-shell.js:68](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L68), [69](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L69), [70](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L70), [408](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L408)
   - [discovery-wizard-ui.js:344](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L344), [346](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L346), [1286](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1286)
   - [README.md:53](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L53)

7. **`Stub only (testing) / Stub / stub_only`** (9 occurrences) **[Confirmed]**:
   - [discovery-wizard-shell.js:96](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L96), [97](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L97), [98](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L98), [372](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L372), [388](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L388)
   - [discovery-wizard-ui.js:795](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L795), [796](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L796), [799](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L799), [800](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L800)

8. **`Apps Script / Apps Script stub / apps_script_stub`** (4 occurrences) **[Confirmed]**:
   - [discovery-wizard-shell.js:398](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L398)
   - [discovery-wizard-ui.js:744](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L744)
   - [SETUP.md:374](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L374)
   - [README.md:291](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L291)

9. **`GitHub Actions scheduled refresh`** (3 occurrences) **[Confirmed]**:
   - [discovery-wizard-ui.js:782](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L782)
   - [SETUP.md:465](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L465)
   - [README.md:444](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L444)

10. **`n8n workflow runner`** (2 occurrences) **[Confirmed]**:
    - [discovery-wizard-ui.js:782](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L782)
    - [README.md:291](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L291)

11. **`Hermes agentic runner`** (4 occurrences) **[Confirmed]**:
    - [discovery-wizard-ui.js:752](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L752)
    - [SETUP.md:94](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L94), [SETUP.md:533](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L533)
    - [README.md:142](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L142)

---

## Complete Copy Inventory Table

Below is the representative extract of the full 618-row verbatim copy inventory. The complete dataset is persisted in the artifact document [copy_inventory.md](file:///Users/emilionunezgarcia/.gemini/antigravity-cli/brain/cc964cf0-1e84-4d42-8150-9e308323c9f7/copy_inventory.md).

| file:line | beat (B1..B6 / wizard / docs) | exact string (verbatim, truncated at 160 chars) | kind (headline, button, error, help, link label, doc) |
|---|---|---|---|
| [oneflow-beat-google.js:27](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L27) | B1 | Your pipeline lives in a Google Sheet you own. | headline |
| [oneflow-beat-google.js:30](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L30) | B1 | Sign in and we'll create it for you. Nothing is stored on our side — there is no 'our side.' | help |
| [oneflow-beat-google.js:42](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L42) | B1 | Paste your Client ID to continue. | help |
| [oneflow-beat-google.js:199](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L199) | B1 | Connect this sheet | button |
| [oneflow-beat-google.js:199](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L199) | B1 | Sign in & connect this sheet | button |
| [oneflow-beat-google.js:204](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L204) | B1 | Back to sign-in | button |
| [oneflow-beat-google.js:213](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L213) | B1 | Continue with Google | button |
| [oneflow-beat-google.js:218](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L218) | B1 | Connect an existing sheet instead | button |
| [oneflow-beat-google.js:254](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L254) | B1 | In Google Cloud Console, create or pick a project (top bar → project picker → New project). | help |
| [oneflow-beat-google.js:256](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L256) | B1 | Configure the OAuth consent screen (APIs & Services → OAuth consent screen). Pick External, fill in an app name and your email, save. Add yourself as a test us… | help |
| [oneflow-beat-google.js:261](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L261) | B1 | Enable the Google Sheets API for the project (APIs & Services → Library → search → Enable). | help |
| [oneflow-beat-google.js:263](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L263) | B1 | Open Credentials → Create credentials → OAuth client ID → application type Web application. | help |
| [oneflow-beat-google.js:265](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L265) | B1 | Under Authorized JavaScript origins, click Add URI and paste this page's origin. Leave redirect URIs empty — JobBored doesn't use them. | help |
| [oneflow-beat-google.js:267](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L267) | B1 | Click Create. Google shows your Client ID — paste it below. | help |
| [oneflow-beat-google.js:285](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L285) | B1 | First time? You'll need a free Google app key | headline |
| [oneflow-beat-google.js:293](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L293) | B1 | Google needs a free "app key" (it calls it a Client ID) that proves this copy of JobBored is yours. Making one takes about 10 minutes and it is genuinely tedio… | help |
| [oneflow-beat-google.js:303](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L303) | B1 | Google rejected this address: | help |
| [oneflow-beat-google.js:310](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L310) | B1 | Copy | button |
| [oneflow-beat-google.js:322](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L322) | B1 | Add this address under Authorized JavaScript origins in the steps below, wait a minute, then press Continue with Google again. | help |
| [oneflow-beat-google.js:331](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L331) | B1 | This page's origin: | help |
| [oneflow-beat-google.js:338](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L338) | B1 | Copy | button |
| [oneflow-beat-google.js:355](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L355) | B1 | Open Google Cloud Console ↗ | link label |
| [oneflow-beat-google.js:369](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L369) | B1 | xxxx.apps.googleusercontent.com | help |
| [oneflow-beat-google.js:371](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L371) | B1 | Your Google app key (Client ID) | help |
| [oneflow-beat-google.js:382](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L382) | B1 | Save Client ID | button |
| [oneflow-beat-google.js:394](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L394) | B1 | A Client ID always ends in .apps.googleusercontent.com. | help |
| [oneflow-beat-google.js:399](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L399) | B1 | Having trouble? | button |
| [oneflow-beat-google.js:405](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L405) | B1 | If Google shows redirect_uri_mismatch, the app type was wrong — recreate the Client ID as a Web application. | help |
| [oneflow-beat-google.js:414](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L414) | B1 | If Google shows an error about an unauthorized origin or "Error 401: invalid client", this page's address isn't on the list yet — add it under Authorized JavaS… | help |
| [oneflow-beat-google.js:446](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L446) | B1 | That doesn't look like a Client ID — it should end in .apps.googleusercontent.com. Paste the whole thing. | error |
| [oneflow-beat-google.js:460](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L460) | B1 | Client ID saved. Continue with Google below. | help |
| [oneflow-beat-google.js:474](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L474) | B1 | Paste the link to a Sheet you already use. It needs a Pipeline tab; we'll check we can read it before connecting. | help |
| [oneflow-beat-google.js:483](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L483) | B1 | https://docs.google.com/spreadsheets/d/… | help |
| [oneflow-beat-google.js:485](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L485) | B1 | Google Sheet link | help |
| [oneflow-beat-google.js:513](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L513) | B1 | Signed in as ${email} · Sheet connected ✓ | help |
| [oneflow-beat-google.js:514](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L514) | B1 | Signed in · Sheet connected ✓ | help |
| [oneflow-beat-google.js:523](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L523) | B1 | We ask for one permission: your Google Sheets. The sheet is created in your Drive, owned by you, and readable only by you. | help |
| [oneflow-beat-google.js:557](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L557) | B1 | Signed in as ${email} ✓ | help |
| [oneflow-beat-google.js:557](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L557) | B1 | Signed in ✓ | help |
| [oneflow-beat-google.js:565](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L565) | B1 | JobBored is still starting up. Reload the page and try again. | error |
| [oneflow-beat-google.js:581](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L581) | B1 | Waiting for Google sign-in… | help |
| [oneflow-beat-google.js:582](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L582) | B1 | Creating your Pipeline sheet… | help |
| [oneflow-beat-google.js:583](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L583) | B1 | Sheet ready ✓ | help |
| [oneflow-beat-google.js:591](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L591) | B1 | Google sign-in didn't finish. If the popup was blocked, allow popups for this page and press Continue with Google again. | error |
| [oneflow-beat-google.js:636](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L636) | B1 | Google didn't create the sheet. Check the permission prompt asked for Google Sheets access, then press Continue with Google again. | error |
| [oneflow-beat-google.js:663](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L663) | B1 | That doesn't look like a Google Sheet link or ID. Paste the full URL from your browser's address bar. | error |
| [oneflow-beat-google.js:674](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L674) | B1 | Waiting for Google sign-in… | help |
| [oneflow-beat-google.js:675](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L675) | B1 | Checking that sheet… | help |
| [oneflow-beat-google.js:683](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L683) | B1 | Google sign-in didn't finish. If the popup was blocked, allow popups for this page and press Sign in & connect this sheet again. | error |
| [oneflow-beat-google.js:699](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L699) | B1 | The sheet checker didn't load. Reload the page, then paste the link again. | error |
| [oneflow-beat-google.js:720](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L720) | B1 | Couldn't read that sheet. Check it's shared with the account you signed in as and that it has a Pipeline tab, then try again. | error |
| [oneflow-beat-google.js:779](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L779) | B1 | Google | button |
| [oneflow-beat-google.js:780](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-google.js#L780) | B1 | about 20–25 min left | help |
| [oneflow-beat-ai.js:23](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L23) | B2 | Now give it a brain. | headline |
| [oneflow-beat-ai.js:26](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L26) | B2 | One AI key powers everything personal here: it drafts your fit profile from your resume on the next screen, scores every job discovery finds, and writes your ta… | help |
| [oneflow-beat-ai.js:33](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L33) | B2 | This model is too weak for tailored letters. Use Gemini Flash unless you are only testing. | error |
| [oneflow-beat-ai.js:45](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L45) | B2 | Your Gemini key also unlocks URL import and grounded search — done, no extra step. | help |
| [oneflow-beat-ai.js:50](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L50) | B2 | runs through the local server — keep npm run dev running | help |
| [oneflow-beat-ai.js:86](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L86) | B2 | Taking longer than usual | help |
| [oneflow-beat-ai.js:88](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L88) | B2 | Still waiting on your provider. Nothing is lost — leave it running, or press Try again to start a fresh check. | help |
| [oneflow-beat-ai.js:105](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L105) | B2 | OpenRouter | button |
| [oneflow-beat-ai.js:106](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L106) | B2 | Recommended. One key for many models, works straight from the browser. The default writes letters well; it's pay-as-you-go, so add a few dollars of credit. | help |
| [oneflow-beat-ai.js:112](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L112) | B2 | sk-or-… | help |
| [oneflow-beat-ai.js:114](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L114) | B2 | Create a free OpenRouter account ↗ | link label |
| [oneflow-beat-ai.js:119](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L119) | B2 | Gemini | button |
| [oneflow-beat-ai.js:120](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L120) | B2 | Free tier, and it lights up URL import and grounded search. | help |
| [oneflow-beat-ai.js:123](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L123) | B2 | AIza… | help |
| [oneflow-beat-ai.js:125](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L125) | B2 | Create a free Gemini key ↗ | link label |
| [oneflow-beat-ai.js:130](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L130) | B2 | OpenAI | button |
| [oneflow-beat-ai.js:131](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L131) | B2 | Paid. It runs through the local server — keep npm run dev running. | help |
| [oneflow-beat-ai.js:134](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L134) | B2 | sk-… | help |
| [oneflow-beat-ai.js:136](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L136) | B2 | Create an OpenAI key ↗ | link label |
| [oneflow-beat-ai.js:140](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L140) | B2 | Anthropic | button |
| [oneflow-beat-ai.js:142](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L142) | B2 | Paid. It runs through the local server — keep npm run dev running. | help |
| [oneflow-beat-ai.js:145](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L145) | B2 | sk-ant-… | help |
| [oneflow-beat-ai.js:147](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L147) | B2 | Create an Anthropic key ↗ | link label |
| [oneflow-beat-ai.js:152](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L152) | B2 | Local — on your machine | button |
| [oneflow-beat-ai.js:153](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L153) | B2 | No key, no cost. Needs a model server (Ollama) already running. | help |
| [oneflow-beat-ai.js:157](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L157) | B2 | http://127.0.0.1:11434/v1 | help |
| [oneflow-beat-ai.js:248](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L248) | B2 | Check & continue | button |
| [oneflow-beat-ai.js:252](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L252) | B2 | Try again | button |
| [oneflow-beat-ai.js:307](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L307) | B2 | still checking… ${Math.floor(elapsed / 1000)} s | help |
| [oneflow-beat-ai.js:323](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L323) | B2 | AI provider | help |
| [oneflow-beat-ai.js:362](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L362) | B2 | Point us at your model server. We'll ask it to answer once before moving on — a server that isn't running is the one failure you'd otherwise only discover on the… | help |
| [oneflow-beat-ai.js:374](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L374) | B2 | Local model server base URL | help |
| [oneflow-beat-ai.js:393](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L393) | B2 | Copy your key. | help |
| [oneflow-beat-ai.js:394](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L394) | B2 | Paste it here. | help |
| [oneflow-beat-ai.js:404](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L404) | B2 | ${def.label} API key | help |
| [oneflow-beat-ai.js:414](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L414) | B2 | The key is stored in this browser and sent only to the provider you picked. | help |
| [oneflow-beat-ai.js:430](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L430) | B2 | Having trouble? | button |
| [oneflow-beat-ai.js:438](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L438) | B2 | Wrong key: keys are easy to truncate on copy. Re-copy the whole string from the provider's page and paste it again — nothing before or after it. | help |
| [oneflow-beat-ai.js:448](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L448) | B2 | Rate limit or no credit: free tiers throttle. Wait a minute and press Check & continue again, or switch to OpenRouter's free tier above. | help |
| [oneflow-beat-ai.js:457](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L457) | B2 | Blocked by the browser: OpenAI and Anthropic refuse direct browser calls, so they run through the local server — keep JobBored running on this computer (npm run… | help |
| [oneflow-beat-ai.js:469](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L469) | B2 | Check your key on ${def.label} ↗ | link label |
| [oneflow-beat-ai.js:585](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L585) | B2 | JobBored will update integrations/browser-use-discovery/.env, and restart your local discovery worker on this computer. Continue? | help |
| [oneflow-beat-ai.js:602](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L602) | B2 | Share your Gemini key with discovery | help |
| [oneflow-beat-ai.js:641](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L641) | B2 | Paste your model server's base URL first — the default is http://127.0.0.1:11434/v1. | error |
| [oneflow-beat-ai.js:643](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L643) | B2 | Paste your ${def.label.split(" — ")[0]} key first. | error |
| [oneflow-beat-ai.js:655](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L655) | B2 | The provider checker didn't load. Reload the page and press Check & continue again. | error |
| [oneflow-beat-ai.js:665](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L665) | B2 | Checking your key… | help |
| [oneflow-beat-ai.js:701](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L701) | B2 | That provider didn't answer. Check the key and press Check & continue again. | error |
| [oneflow-beat-ai.js:714](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L714) | B2 | ✓ Connected — ${model} responded | help |
| [oneflow-beat-ai.js:714](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L714) | B2 | ✓ Connected | help |
| [oneflow-beat-ai.js:760](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L760) | B2 | AI | button |
| [oneflow-beat-ai.js:761](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-ai.js#L761) | B2 | about 12 min left | help |
| [oneflow-beat-resume.js:36](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L36) | B3 | Drop in your resume. We'll do the typing. | headline |
| [oneflow-beat-resume.js:38](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L38) | B3 | From this one file we'll draft your whole fit profile — target roles, strengths, what you want, what to avoid. You'll review everything on the next screen; noth… | help |
| [oneflow-beat-resume.js:56](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L56) | B3 | Connect an AI provider first — your resume is drafted with it. | error |
| [oneflow-beat-resume.js:58](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L58) | B3 | Connect an AI provider | button |
| [oneflow-beat-resume.js:65](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L65) | B3 | Reading your resume ✓ | help |
| [oneflow-beat-resume.js:66](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L66) | B3 | Drafting target roles & strengths… | help |
| [oneflow-beat-resume.js:67](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L67) | B3 | Writing your first-person narrative… | help |
| [oneflow-beat-resume.js:68](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L68) | B3 | Draft ready ✓ | help |
| [oneflow-beat-resume.js:81](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L81) | B3 | Marketer | button |
| [oneflow-beat-resume.js:82](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L82) | B3 | Senior marketing / director. Performance + brand + analytics. | help |
| [oneflow-beat-resume.js:86](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L86) | B3 | Engineer | button |
| [oneflow-beat-resume.js:87](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L87) | B3 | Staff / senior backend IC. Distributed systems + tech leadership. | help |
| [oneflow-beat-resume.js:91](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L91) | B3 | Product Manager | button |
| [oneflow-beat-resume.js:92](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L92) | B3 | Senior / principal PM. Strategy + research + technical fluency. | help |
| [oneflow-beat-resume.js:96](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L96) | B3 | Start blank | button |
| [oneflow-beat-resume.js:97](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L97) | B3 | Fill every field yourself. No seed data. | help |
| [oneflow-beat-resume.js:301](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L301) | B3 | Back to upload or paste | button |
| [oneflow-beat-resume.js:309](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L309) | B3 | Draft from this text | button |
| [oneflow-beat-resume.js:318](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L318) | B3 | Connect an AI provider | button |
| [oneflow-beat-resume.js:323](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L323) | B3 | Try again | button |
| [oneflow-beat-resume.js:327](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L327) | B3 | I'd rather start from a template | button |
| [oneflow-beat-resume.js:373](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L373) | B3 | Drag your resume here — PDF, Word, or plain text. | help |
| [oneflow-beat-resume.js:380](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L380) | B3 | Choose a resume file | help |
| [oneflow-beat-resume.js:413](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L413) | B3 | …or paste the text instead | help |
| [oneflow-beat-resume.js:420](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L420) | B3 | Paste your resume text here. | help |
| [oneflow-beat-resume.js:422](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L422) | B3 | Resume text | help |
| [oneflow-beat-resume.js:457](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L457) | B3 | Pick the closest starting point. Everything is editable on the next screen — a template is a seed, not a lock. | help |
| [oneflow-beat-resume.js:499](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L499) | B3 | Your resume stays in this browser and on this machine. We send the text to the AI provider you connected on the last screen, and nowhere else. | help |
| [oneflow-beat-resume.js:515](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L515) | B3 | The browser's resume store didn't load. Reload the page and try again. | error |
| [oneflow-beat-resume.js:521](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L521) | B3 | My resume | help |
| [oneflow-beat-resume.js:557](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L557) | B3 | Couldn't reach the JobBored app on this computer — double-click start.command in the JobBored folder to start it, then try again. (${err}) | error |
| [oneflow-beat-resume.js:570](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L570) | B3 | The server couldn't read your resume — nothing came through. Try the upload again, or paste the text instead. | error |
| [oneflow-beat-resume.js:585](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L585) | B3 | This page can't draft your resume by itself — drafting runs in the JobBored app on your computer. Press 'I'd rather start from a template' below (everything… | error |
| [oneflow-beat-resume.js:609](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L609) | B3 | The profile drafter failed (HTTP ${res.status}). | error |
| [oneflow-beat-resume.js:659](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L659) | B3 | Drop in a file or paste the text of your resume first. | error |
| [oneflow-beat-resume.js:720](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L720) | B3 | The resume reader didn't load. Reload the page, or paste the text instead. | error |
| [oneflow-beat-resume.js:734](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L734) | B3 | Couldn't read that file. You can paste the text instead. | error |
| [oneflow-beat-resume.js:821](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L821) | B3 | Resume | button |
| [oneflow-beat-resume.js:822](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-resume.js#L822) | B3 | about 10 min left | help |
| [oneflow-beat-fit.js:16](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L16) | B4 | Here's how we'll judge every job for you. | headline |
| [oneflow-beat-fit.js:17](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L17) | B4 | We drafted this from your resume. Fix anything that's off — this is the one-time part that makes every match yours. | help |
| [oneflow-beat-fit.js:27](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L27) | B4 | Intern | help |
| [oneflow-beat-fit.js:28](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L28) | B4 | Entry | help |
| [oneflow-beat-fit.js:29](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L29) | B4 | Mid | help |
| [oneflow-beat-fit.js:30](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L30) | B4 | Senior | help |
| [oneflow-beat-fit.js:31](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L31) | B4 | Staff | help |
| [oneflow-beat-fit.js:32](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L32) | B4 | Principal | help |
| [oneflow-beat-fit.js:33](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L33) | B4 | Manager | help |
| [oneflow-beat-fit.js:34](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L34) | B4 | Director | help |
| [oneflow-beat-fit.js:35](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L35) | B4 | Head | help |
| [oneflow-beat-fit.js:36](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L36) | B4 | VP | help |
| [oneflow-beat-fit.js:37](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L37) | B4 | C-level | help |
| [oneflow-beat-fit.js:38](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L38) | B4 | Any | help |
| [oneflow-beat-fit.js:41](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L41) | B4 | Any | help |
| [oneflow-beat-fit.js:42](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L42) | B4 | Remote only | help |
| [oneflow-beat-fit.js:43](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L43) | B4 | Hybrid OK | help |
| [oneflow-beat-fit.js:44](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L44) | B4 | Onsite OK | help |
| [oneflow-beat-fit.js:47](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L47) | B4 | Any | help |
| [oneflow-beat-fit.js:48](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L48) | B4 | US citizen | help |
| [oneflow-beat-fit.js:49](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L49) | B4 | US authorized | help |
| [oneflow-beat-fit.js:50](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L50) | B4 | Needs sponsorship | help |
| [oneflow-beat-fit.js:259](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L259) | B4 | Add one | help |
| [oneflow-beat-fit.js:275](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L275) | B4 | ↑ | button |
| [oneflow-beat-fit.js:275](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L275) | B4 | Move ${options.label} up | help |
| [oneflow-beat-fit.js:285](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L285) | B4 | ↓ | button |
| [oneflow-beat-fit.js:285](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L285) | B4 | Move ${options.label} down | help |
| [oneflow-beat-fit.js:297](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L297) | B4 | × | button |
| [oneflow-beat-fit.js:297](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L297) | B4 | Remove ${options.label} | help |
| [oneflow-beat-fit.js:326](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L326) | B4 | Add | button |
| [oneflow-beat-fit.js:338](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L338) | B4 | Add a strength | help |
| [oneflow-beat-fit.js:382](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L382) | B4 | ↑ | button |
| [oneflow-beat-fit.js:382](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L382) | B4 | Move strength up | help |
| [oneflow-beat-fit.js:387](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L387) | B4 | ↓ | button |
| [oneflow-beat-fit.js:387](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L387) | B4 | Move strength down | help |
| [oneflow-beat-fit.js:392](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L392) | B4 | × | button |
| [oneflow-beat-fit.js:392](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L392) | B4 | Remove strength | help |
| [oneflow-beat-fit.js:417](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L417) | B4 | Add | button |
| [oneflow-beat-fit.js:493](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L493) | B4 | Looking for | headline |
| [oneflow-beat-fit.js:502](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L502) | B4 | Add a target role | help |
| [oneflow-beat-fit.js:511](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L511) | B4 | Seniority | help |
| [oneflow-beat-fit.js:529](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L529) | B4 | Your edge | headline |
| [oneflow-beat-fit.js:560](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L560) | B4 | edit | button |
| [oneflow-beat-fit.js:569](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L569) | B4 | Lean toward / away | headline |
| [oneflow-beat-fit.js:570](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L570) | B4 | Lean toward | headline |
| [oneflow-beat-fit.js:574](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L574) | B4 | Add what you want | help |
| [oneflow-beat-fit.js:578](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L578) | B4 | Lean away | headline |
| [oneflow-beat-fit.js:582](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L582) | B4 | Add what to avoid | help |
| [oneflow-beat-fit.js:591](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L591) | B4 | Edit details | button |
| [oneflow-beat-fit.js:593](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L593) | B4 | Work mode | help |
| [oneflow-beat-fit.js:617](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L617) | B4 | Acceptable locations | help |
| [oneflow-beat-fit.js:622](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L622) | B4 | Add a city or metro | help |
| [oneflow-beat-fit.js:631](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L631) | B4 | Salary floor (USD/year) | help |
| [oneflow-beat-fit.js:656](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L656) | B4 | Reject listings without published salary | help |
| [oneflow-beat-fit.js:661](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L661) | B4 | Skip titles | help |
| [oneflow-beat-fit.js:665](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L665) | B4 | Add a title to skip | help |
| [oneflow-beat-fit.js:673](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L673) | B4 | Work authorization | help |
| [oneflow-beat-fit.js:693](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L693) | B4 | Raw profile JSON | button |
| [oneflow-beat-fit.js:749](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L749) | B4 | Profile save failed (HTTP ${response.status}). | error |
| [oneflow-beat-fit.js:761](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L761) | B4 | Add at least one target role. | error |
| [oneflow-beat-fit.js:764](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L764) | B4 | Add at least one strength. | error |
| [oneflow-beat-fit.js:768](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L768) | B4 | Keep the narrative between 20 and 1200 characters. | error |
| [oneflow-beat-fit.js:781](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L781) | B4 | Could not save your discovery profile. Reload and try again. | error |
| [oneflow-beat-fit.js:789](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L789) | B4 | Saving your fit profile… | help |
| [oneflow-beat-fit.js:820](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L820) | B4 | Could not save your fit profile: ${error} | error |
| [oneflow-beat-fit.js:831](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L831) | B4 | Your fit | button |
| [oneflow-beat-fit.js:832](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L832) | B4 | about 9 min left | help |
| [oneflow-beat-fit.js:838](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-fit.js#L838) | B4 | Looks like me → | button |
| [oneflow-beat-discovery.js:28](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L28) | B5 | Now the engine: jobs come to you. | headline |
| [oneflow-beat-discovery.js:30](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L30) | B5 | Discovery runs on this computer, searches the job boards overnight, scores each role against your fit, and drops the matches into your pipeline. Only your search… | help |
| [oneflow-beat-discovery.js:37](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L37) | B5 | First, the fuel: Google's job index. | headline |
| [oneflow-beat-discovery.js:39](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L39) | B5 | Discovery reads job boards directly, but Google's index is the single biggest source — it watches 100+ boards at once. The free key covers about 20 runs a month… | help |
| [oneflow-beat-discovery.js:55](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L55) | B5 | Create a free SerpApi account (Google login works, no card needed). | help |
| [oneflow-beat-discovery.js:57](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L57) | B5 | Create your free account ↗ | link label |
| [oneflow-beat-discovery.js:60](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L60) | B5 | Copy your API key from the dashboard — it's the first thing on the page. | help |
| [oneflow-beat-discovery.js:62](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L62) | B5 | Copy your API key ↗ | link label |
| [oneflow-beat-discovery.js:65](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L65) | B5 | Paste it below and hit Save & verify — we write it into the worker and restart it for you. | help |
| [oneflow-beat-discovery.js:69](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L69) | B5 | Then the connection: let it run on its own. | headline |
| [oneflow-beat-discovery.js:71](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L71) | B5 | Skip the connection for now — your keys are saved; jobs won't arrive on their own until you connect. | button |
| [oneflow-beat-discovery.js:77](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L77) | B5 | Checked your machine | help |
| [oneflow-beat-discovery.js:78](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L78) | B5 | Started the discovery worker | help |
| [oneflow-beat-discovery.js:79](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L79) | B5 | Making a private link between your devices | help |
| [oneflow-beat-discovery.js:80](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L80) | B5 | Verifying the connection | help |
| [oneflow-beat-discovery.js:90](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L90) | B5 | Just this computer | button |
| [oneflow-beat-discovery.js:104](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L104) | B5 | Taking longer than usual | help |
| [oneflow-beat-discovery.js:106](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L106) | B5 | Still waiting on the local server. Nothing is lost — leave it running, or press Try again to start a fresh save. | help |
| [oneflow-beat-discovery.js:125](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L125) | B5 | Google Jobs index connected — ${plan} plan, ${left} searches left this month. | help |
| [oneflow-beat-discovery.js:128](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L128) | B5 | Google Jobs index connected — ${left} searches left this month. | help |
| [oneflow-beat-discovery.js:130](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L130) | B5 | Google Jobs index connected. | help |
| [oneflow-beat-discovery.js:139](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L139) | B5 | SerpApi didn't recognise that key. Copy it again from serpapi.com/manage-api-key — the whole string, no spaces — then press Save & verify. | error |
| [oneflow-beat-discovery.js:144](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L144) | B5 | Couldn't reach SerpApi to check the key. Check this machine's internet connection, then press Save & verify again. | error |
| [oneflow-beat-discovery.js:147](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L147) | B5 | SerpApi answered, but not with your account. Wait a moment, then press Save & verify again. | error |
| [oneflow-beat-discovery.js:152](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L152) | B5 | Couldn't reach the JobBored server on this computer. To start it, double-click start.command in the JobBored folder, then press Save & verify. | error |
| [oneflow-beat-discovery.js:162](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L162) | B5 | JobBored is running, but this page's address isn't allowed to use it — open http://localhost:8080 and press Save & verify there. | error |
| [oneflow-beat-discovery.js:165](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L165) | B5 | The JobBored server on this computer hit an error while checking your key. Press Save & verify again; if it keeps happening, quit JobBored and start it again. | error |
| [oneflow-beat-discovery.js:169](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L169) | B5 | This hosted page can't check your key — checking runs in the JobBored app on your computer. Copy your key, open your local setup, then press Save & verify there. | error |
| [oneflow-beat-discovery.js:176](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L176) | B5 | The JobBored server on this computer is out of date or isn't JobBored — quit it and start JobBored again, then press Save & verify. | error |
| [oneflow-beat-discovery.js:204](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L204) | B5 | double-click start.command in the JobBored folder | help |
| [oneflow-beat-discovery.js:205](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L205) | B5 | run ./start.sh in the JobBored folder | help |
| [oneflow-beat-discovery.js:312](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L312) | B5 | Save & verify | button |
| [oneflow-beat-discovery.js:313](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L313) | B5 | Set it up for me | button |
| [oneflow-beat-discovery.js:406](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L406) | B5 | Re-check | button |
| [oneflow-beat-discovery.js:413](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L413) | B5 | Try again | button |
| [oneflow-beat-discovery.js:454](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L454) | B5 | still checking… ${Math.floor(elapsed / 1000)} s | help |
| [oneflow-beat-discovery.js:482](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L482) | B5 | SerpApi API key | help |
| [oneflow-beat-discovery.js:486](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L486) | B5 | Paste your SerpApi key | help |
| [oneflow-beat-discovery.js:535](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L535) | B5 | JobBored will update integrations/browser-use-discovery/.env, and restart your local discovery worker on this computer. Continue? | help |
| [oneflow-beat-discovery.js:560](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L560) | B5 | One click sets this up over Tailscale — a free private network between your own devices. Nothing is exposed to the internet. | help |
| [oneflow-beat-discovery.js:570](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L570) | B5 | Add your SerpApi key above first — the engine needs fuel before it needs a connection. | help |
| [oneflow-beat-discovery.js:577](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L577) | B5 | Tailscale is free and installs in a minute: | help |
| [oneflow-beat-discovery.js:579](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L579) | B5 | Download Tailscale ↗ | link label |
| [oneflow-beat-discovery.js:588](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L588) | B5 | Only using JobBored on this computer? Skip Tailscale — connect to the search that runs right here. | help |
| [oneflow-beat-discovery.js:612](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L612) | B5 | Run without Tailscale, or paste your own endpoint | button |
| [oneflow-beat-discovery.js:618](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L618) | B5 | Address of the part that searches for you (HTTPS, or this computer) | help |
| [oneflow-beat-discovery.js:621](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L621) | B5 | https://your-machine.tailXXXX.ts.net/webhook | help |
| [oneflow-beat-discovery.js:629](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L629) | B5 | Its shared password | help |
| [oneflow-beat-discovery.js:632](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L632) | B5 | Leave empty to keep the one already saved | help |
| [oneflow-beat-discovery.js:641](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L641) | B5 | Use this endpoint | button |
| [oneflow-beat-discovery.js:652](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L652) | B5 | Running the worker yourself? The walkthrough is in | help |
| [oneflow-beat-discovery.js:654](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L654) | B5 | docs/SELF-HOSTING.md | link label |
| [oneflow-beat-discovery.js:677](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L677) | B5 | Your typed key is still in the field above — carry it over: | help |
| [oneflow-beat-discovery.js:685](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L685) | B5 | Copy my key | button |
| [oneflow-beat-discovery.js:693](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L693) | B5 | Open local setup ↗ | link label |
| [oneflow-beat-discovery.js:694](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L694) | B5 | Get the app ↗ | link label |
| [oneflow-beat-discovery.js:728](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L728) | B5 | Paste your key first | button |
| [oneflow-beat-discovery.js:735](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L735) | B5 | Copied ✓ | button |
| [oneflow-beat-discovery.js:745](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L745) | B5 | Key selected — copy it | button |
| [oneflow-beat-discovery.js:824](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L824) | B5 | Your local app is running — copy your key above, then press Open local setup to continue there. | help |
| [oneflow-beat-discovery.js:1050](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1050) | B5 | Paste your SerpApi key first. | error |
| [oneflow-beat-discovery.js:1057](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1057) | B5 | Checking your key with SerpApi… | help |
| [oneflow-beat-discovery.js:1058](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1058) | B5 | Saving your key… | help |
| [oneflow-beat-discovery.js:1059](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1059) | B5 | Google Jobs index connected | help |
| [oneflow-beat-discovery.js:1114](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1114) | B5 | Your key checks out, but it isn't saved — nothing on this computer changed. Press Save & verify when you're ready. | help |
| [oneflow-beat-discovery.js:1146](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1146) | B5 | Couldn't save your SerpApi key — is the local server running? Try again. | error |
| [oneflow-beat-discovery.js:1217](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1217) | B5 | The discovery setup bridge didn't load — reload the page and try again. | error |
| [oneflow-beat-discovery.js:1242](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1242) | B5 | Connected ✓ | help |
| [oneflow-beat-discovery.js:1251](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1251) | B5 | Automatic setup didn't finish — try again, or paste your own endpoint below. | error |
| [oneflow-beat-discovery.js:1261](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1261) | B5 | Paste the worker's HTTPS URL (including /webhook) first. | error |
| [oneflow-beat-discovery.js:1293](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1293) | B5 | Connected ✓ | help |
| [oneflow-beat-discovery.js:1299](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1299) | B5 | That endpoint didn't answer — check the URL and the secret, then try again. | error |
| [oneflow-beat-discovery.js:1317](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1317) | B5 | Add your SerpApi key first — Save & verify unlocks the connection. | error |
| [oneflow-beat-discovery.js:1338](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1338) | B5 | The SerpApi key isn't skippable — without it discovery has nothing to search. | error |
| [oneflow-beat-discovery.js:1351](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1351) | B5 | Discovery | button |
| [oneflow-beat-discovery.js:1352](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-discovery.js#L1352) | B5 | about 7 min left | help |
| [oneflow-beat-payoff.js:31](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L31) | B6 | You're live, {firstName}. | headline |
| [oneflow-beat-payoff.js:32](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L32) | B6 | You're live. | headline |
| [oneflow-beat-payoff.js:33](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L33) | B6 | That was the one-time part. From here, JobBored works for you. | help |
| [oneflow-beat-payoff.js:35](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L35) | B6 | ⏱ First matches land tomorrow morning — or run it right now and watch. | help |
| [oneflow-beat-payoff.js:37](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L37) | B6 | More power-ups — URL import, grounded search, other devices — live in Settings → Upgrades, each one click, none required. | help |
| [oneflow-beat-payoff.js:39](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L39) | B6 | ○ Connection is off — your AI and Google-index keys are saved; connect anytime from the banner below | help |
| [oneflow-beat-payoff.js:43](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L43) | B6 | Not armed yet — finish the step above and it runs on its own. | help |
| [oneflow-beat-payoff.js:44](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L44) | B6 | open it ↗ | link label |
| [oneflow-beat-payoff.js:51](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L51) | B6 | ○ AI isn't checked yet — go back to the AI step to connect it | help |
| [oneflow-beat-payoff.js:53](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L53) | B6 | ○ Job search isn't set up — you can track jobs without it | help |
| [oneflow-beat-payoff.js:57](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L57) | B6 | Track a job you already found | button |
| [oneflow-beat-payoff.js:297](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L297) | B6 | Go to my dashboard | button |
| [oneflow-beat-payoff.js:301](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L301) | B6 | Actually — connect discovery | button |
| [oneflow-beat-payoff.js:308](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L308) | B6 | Take me to my dashboard | button |
| [oneflow-beat-payoff.js:318](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L318) | B6 | Connect Google to go live | button |
| [oneflow-beat-payoff.js:328](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L328) | B6 | Tell it what to look for | button |
| [oneflow-beat-payoff.js:336](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L336) | B6 | Run discovery now | button |
| [oneflow-beat-payoff.js:416](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L416) | B6 | Your search | headline |
| [oneflow-beat-payoff.js:419](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L419) | B6 | Roles | help |
| [oneflow-beat-payoff.js:420](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L420) | B6 | Where | help |
| [oneflow-beat-payoff.js:421](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L421) | B6 | Floor | help |
| [oneflow-beat-payoff.js:422](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L422) | B6 | Your edge | help |
| [oneflow-beat-payoff.js:438](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L438) | B6 | Your saved profile isn't reachable right now — open Settings → Profile to review it. | help |
| [oneflow-beat-payoff.js:450](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L450) | B6 | What happens now | headline |
| [oneflow-beat-payoff.js:461](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L461) | B6 | ✓ AI connected — ${state.provider} | help |
| [oneflow-beat-payoff.js:474](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L474) | B6 | ✓ Discovery armed — ${state.sourceCount} ${noun} watching, including Google's job index | help |
| [oneflow-beat-payoff.js:484](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L484) | B6 | ✓ Pipeline sheet connected — | help |
| [oneflow-beat-payoff.js:660](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L660) | B6 | Your search has no target roles or keywords yet — open Settings → Profile, add them, then run discovery. | error |
| [oneflow-beat-payoff.js:667](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L667) | B6 | Sending your search… | help |
| [oneflow-beat-payoff.js:668](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L668) | B6 | Discovery is looking | help |
| [oneflow-beat-payoff.js:669](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L669) | B6 | First matches land on your board | help |
| [oneflow-beat-payoff.js:788](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L788) | B6 | Done | button |
| [oneflow-beat-payoff.js:789](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/oneflow-beat-payoff.js#L789) | B6 | almost done | help |
| [onboarding-flow.js:40](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L40) | B1 | Google | button |
| [onboarding-flow.js:41](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L41) | B2 | AI | button |
| [onboarding-flow.js:42](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L42) | B3 | Resume | button |
| [onboarding-flow.js:43](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L43) | B4 | Your fit | button |
| [onboarding-flow.js:44](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L44) | B5 | Discovery | button |
| [onboarding-flow.js:45](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L45) | B6 | Done | button |
| [onboarding-flow.js:63](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L63) | B2 | Connect an AI provider first — your resume is drafted with it. | error |
| [onboarding-flow.js:64](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L64) | B1 | Connect Google first — your board lives in that Sheet. | error |
| [onboarding-flow.js:68](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L68) | wizard | Saved. | help |
| [onboarding-flow.js:76](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L76) | wizard | Setup paused — pick up right here anytime. | help |
| [onboarding-flow.js:93](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L93) | wizard | Resume setup ▸ | button |
| [onboarding-flow.js:508](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L508) | wizard | Resume setup — ${label} | help |
| [onboarding-flow.js:702](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L702) | wizard | Set up JobBored | headline |
| [onboarding-flow.js:1220](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/onboarding-flow.js#L1220) | wizard | Resume setup — ${beat.label} | button |
| [discovery-wizard-shell.js:23](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L23) | wizard | Status | help |
| [discovery-wizard-shell.js:24](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L24) | wizard | Current setup status. | headline |
| [discovery-wizard-shell.js:25](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L25) | wizard | Shows what's already connected and what still needs work. | help |
| [discovery-wizard-shell.js:30](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L30) | wizard | Path | help |
| [discovery-wizard-shell.js:31](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L31) | wizard | Choose a connection method. | headline |
| [discovery-wizard-shell.js:32](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L32) | wizard | Pick the option that matches your setup. | help |
| [discovery-wizard-shell.js:37](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L37) | wizard | Manual | help |
| [discovery-wizard-shell.js:38](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L38) | wizard | Keep discovery manual. | headline |
| [discovery-wizard-shell.js:39](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L39) | wizard | Add jobs via automation or manually — no webhook needed. | help |
| [discovery-wizard-shell.js:44](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L44) | wizard | Endpoint | help |
| [discovery-wizard-shell.js:45](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L45) | wizard | Connect a stable URL (Tailscale). | headline |
| [discovery-wizard-shell.js:47](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L47) | wizard | Set up Tailscale below and paste its stable URL — or any public HTTPS endpoint you already control. | help |
| [discovery-wizard-shell.js:52](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L52) | wizard | Config | help |
| [discovery-wizard-shell.js:53](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L53) | wizard | Load local config. | headline |
| [discovery-wizard-shell.js:55](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L55) | wizard | Auto-fills ports, URLs, and tunnel info from your config file. | help |
| [discovery-wizard-shell.js:60](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L60) | wizard | Server | help |
| [discovery-wizard-shell.js:61](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L61) | wizard | Check local server. | headline |
| [discovery-wizard-shell.js:63](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L63) | wizard | Confirms your local discovery server is running and healthy. | help |
| [discovery-wizard-shell.js:68](file:///Users/emilionunezgaraby/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L68) | wizard | Tunnel | help |
| [discovery-wizard-shell.js:69](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L69) | wizard | Connect ngrok tunnel. | headline |
| [discovery-wizard-shell.js:70](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L70) | wizard | Makes your local server reachable from the internet. | help |
| [discovery-wizard-shell.js:75](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L75) | wizard | Relay | help |
| [discovery-wizard-shell.js:76](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L76) | wizard | Deploy the Cloudflare relay. | headline |
| [discovery-wizard-shell.js:77](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L77) | wizard | Creates a permanent URL that forwards to your tunnel. | help |
| [discovery-wizard-shell.js:82](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L82) | wizard | Test | help |
| [discovery-wizard-shell.js:83](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L83) | wizard | Test the connection. | headline |
| [discovery-wizard-shell.js:84](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L84) | wizard | Sends a test request through the full chain. | help |
| [discovery-wizard-shell.js:89](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L89) | wizard | Done | help |
| [discovery-wizard-shell.js:90](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L90) | wizard | You're all set. | headline |
| [discovery-wizard-shell.js:91](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L91) | wizard | Discovery is connected and ready to use. | help |
| [discovery-wizard-shell.js:96](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L96) | wizard | Stub | help |
| [discovery-wizard-shell.js:97](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L97) | wizard | Test-only mode. | headline |
| [discovery-wizard-shell.js:98](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L98) | wizard | Confirms wiring works but won't produce real results. | help |
| [discovery-wizard-shell.js:103](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L103) | wizard | Discovery setup wizard | headline |
| [discovery-wizard-shell.js:104](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L104) | wizard | Connect your job discovery pipeline in a few steps. | help |
| [discovery-wizard-shell.js:371](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L371) | wizard | No engine | help |
| [discovery-wizard-shell.js:372](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L372) | wizard | Stub only | help |
| [discovery-wizard-shell.js:373](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L373) | wizard | Unverified | help |
| [discovery-wizard-shell.js:374](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L374) | wizard | Connected | help |
| [discovery-wizard-shell.js:385](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L385) | wizard | Local worker | help |
| [discovery-wizard-shell.js:386](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L386) | wizard | Webhook | help |
| [discovery-wizard-shell.js:387](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L387) | wizard | Manual | help |
| [discovery-wizard-shell.js:388](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L388) | wizard | Stub | help |
| [discovery-wizard-shell.js:398](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L398) | wizard | Apps Script | help |
| [discovery-wizard-shell.js:404](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L404) | wizard | Found | help |
| [discovery-wizard-shell.js:404](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L404) | wizard | Missing | help |
| [discovery-wizard-shell.js:409](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L409) | wizard | OK | help |
| [discovery-wizard-shell.js:409](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L409) | wizard | Not ready | help |
| [discovery-wizard-shell.js:414](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L414) | wizard | OK | help |
| [discovery-wizard-shell.js:414](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L414) | wizard | Not ready | help |
| [discovery-wizard-shell.js:452](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L452) | wizard | Current step | help |
| [discovery-wizard-shell.js:454](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L454) | wizard | Completed | help |
| [discovery-wizard-shell.js:456](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L456) | wizard | Locked | help |
| [discovery-wizard-shell.js:457](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L457) | wizard | Available | help |
| [discovery-wizard-shell.js:569](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L569) | wizard | Discovery setup | headline |
| [discovery-wizard-shell.js:787](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L787) | wizard | Previous option | button |
| [discovery-wizard-shell.js:793](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L793) | wizard | Next option | button |
| [discovery-wizard-shell.js:811](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L811) | wizard | Option ${i + 1} | button |
| [discovery-wizard-shell.js:904](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L904) | wizard | Back | button |
| [discovery-wizard-shell.js:904](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L904) | wizard | Continue | button |
| [discovery-wizard-shell.js:944](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L944) | wizard | Continue | button |
| [discovery-wizard-shell.js:958](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L958) | wizard | Finish setup | button |
| [discovery-wizard-shell.js:1022](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1022) | wizard | Discovery setup steps | help |
| [discovery-wizard-shell.js:1073](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1073) | wizard | Go back | button |
| [discovery-wizard-shell.js:1084](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1084) | wizard | Step ${context.activeIndex + 1} of ${context.steps.length} | help |
| [discovery-wizard-shell.js:1122](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1122) | wizard | Setup progress | help |
| [discovery-wizard-shell.js:1228](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1228) | wizard | Use the step rail above to jump between steps. | help |
| [discovery-wizard-shell.js:1260](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1260) | wizard | Profile | button |
| [discovery-wizard-shell.js:1261](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1261) | wizard | Job discovery | button |
| [discovery-wizard-shell.js:1262](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1262) | wizard | Other devices | button |
| [discovery-wizard-shell.js:1270](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1270) | wizard | Setup progress | help |
| [discovery-wizard-shell.js:1353](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1353) | wizard | Close wizard | button |
| [discovery-wizard-shell.js:1361](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-shell.js#L1361) | wizard | Close | button |
| [discovery-wizard-ui.js:161](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L161) | wizard | Downloaded. On macOS: right-click → Open the first time (Gatekeeper). After that, double-click to run. | help |
| [discovery-wizard-ui.js:181](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L181) | wizard | Open Terminal anywhere on your computer, paste this one line, press Enter. It changes into your repo folder and runs the command. | help |
| [discovery-wizard-ui.js:182](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L182) | wizard | Open Terminal in your JobBored repo folder, paste this, press Enter. | help |
| [discovery-wizard-ui.js:186](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L186) | wizard | Copy command | button |
| [discovery-wizard-ui.js:206](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L206) | wizard | Downloads a .command file. Double-click it to open Terminal in your repo and run the command (macOS only). | help |
| [discovery-wizard-ui.js:279](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L279) | wizard | Latest result | headline |
| [discovery-wizard-ui.js:308](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L308) | wizard | Next step: ${result.remediation} | help |
| [discovery-wizard-ui.js:333](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L333) | wizard | Use this Worker URL | button |
| [discovery-wizard-ui.js:335](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L335) | wizard | This is the public Cloudflare Worker URL the dashboard should POST to. | help |
| [discovery-wizard-ui.js:337](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L337) | wizard | Saved to Discovery drawer → Connection → Discovery webhook URL when you click Use it. | help |
| [discovery-wizard-ui.js:344](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L344) | wizard | Use this tunnel URL | button |
| [discovery-wizard-ui.js:346](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L346) | wizard | This is the public ngrok URL forwarding to your local server. | help |
| [discovery-wizard-ui.js:348](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L348) | wizard | Saved to your discovery transport config when you click Use it. | help |
| [discovery-wizard-ui.js:355](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L355) | wizard | Use this webhook URL | button |
| [discovery-wizard-ui.js:356](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L356) | wizard | This is your discovery webhook endpoint. | help |
| [discovery-wizard-ui.js:358](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L358) | wizard | Saved to Discovery drawer → Connection → Discovery webhook URL when you click Use it. | help |
| [discovery-wizard-ui.js:364](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L364) | wizard | Copy URL | button |
| [discovery-wizard-ui.js:407](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L407) | wizard | Saved to Discovery webhook URL and copied to clipboard. | help |
| [discovery-wizard-ui.js:408](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L408) | wizard | Copied to clipboard. | help |
| [discovery-wizard-ui.js:413](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L413) | wizard | Copy only | button |
| [discovery-wizard-ui.js:440](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L440) | wizard | Run this command: | help |
| [discovery-wizard-ui.js:456](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L456) | wizard | Stuck? Try one of these: | help |
| [discovery-wizard-ui.js:482](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L482) | wizard | Copies a diagnose-and-fix prompt to your clipboard. Paste it into your AI coding assistant (Claude, ChatGPT, Cursor, Factory) and it will walk you through the fix. | help |
| [discovery-wizard-ui.js:486](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L486) | wizard | AI prompt copied. Paste it into your coding assistant for a guided fix. | help |
| [discovery-wizard-ui.js:499](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L499) | wizard | Skip for now → | button |
| [discovery-wizard-ui.js:503](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L503) | wizard | Advances past this check. Use this if you have a custom setup the wizard can't auto-detect. | help |
| [discovery-wizard-ui.js:512](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L512) | wizard | Skipped. You can come back to this step from the rail any time. | help |
| [discovery-wizard-ui.js:531](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L531) | wizard | Fix the issue above, then continue. | error |
| [discovery-wizard-ui.js:532](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L532) | wizard | Settings updated. | help |
| [discovery-wizard-ui.js:589](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L589) | wizard | Choose how you want to do this. | headline |
| [discovery-wizard-ui.js:643](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L643) | wizard | Do this: | help |
| [discovery-wizard-ui.js:741](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L741) | wizard | A webhook URL is already saved. | help |
| [discovery-wizard-ui.js:744](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L744) | wizard | Only the Apps Script stub is saved — upgrade to a real endpoint. | help |
| [discovery-wizard-ui.js:753](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L753) | wizard | A local Hermes route was detected. It can work, but the browser-use worker is the recommended local discovery engine. | help |
| [discovery-wizard-ui.js:754](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L754) | wizard | A local browser-use worker or local discovery path was detected on this machine. | help |
| [discovery-wizard-ui.js:756](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L756) | wizard | No webhook saved yet — pick a path to get started. | help |
| [discovery-wizard-ui.js:763](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L763) | wizard | Stable URL · Tailscale (recommended) | headline |
| [discovery-wizard-ui.js:764](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L764) | wizard | A permanent, private URL straight to your worker. | help |
| [discovery-wizard-ui.js:768](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L768) | wizard | Stable URL that never rotates — survives restarts and sleep | help |
| [discovery-wizard-ui.js:769](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L769) | wizard | Private: no public internet exposure, no relay to deploy or babysit | help |
| [discovery-wizard-ui.js:770](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L770) | wizard | Fewest moving parts of any option | help |
| [discovery-wizard-ui.js:773](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L773) | wizard | Install Tailscale (free) once per device | help |
| [discovery-wizard-ui.js:774](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L774) | wizard | (Or paste any public HTTPS endpoint you already control) | help |
| [discovery-wizard-ui.js:780](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L780) | wizard | No webhook (manual) | headline |
| [discovery-wizard-ui.js:781](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L781) | wizard | You'll trigger discovery yourself from cron, GitHub Actions, or n8n. | help |
| [discovery-wizard-ui.js:785](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L785) | wizard | Nothing for JobBored to host or keep alive | help |
| [discovery-wizard-ui.js:787](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L787) | wizard | No “Run discovery” button — every run is yours to trigger | help |
| [discovery-wizard-ui.js:788](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L788) | wizard | You build & maintain the trigger, auth, and scheduling outside JobBored | help |
| [discovery-wizard-ui.js:789](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L789) | wizard | Quick to pick here, but real engineering work to actually run discovery | help |
| [discovery-wizard-ui.js:795](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L795) | wizard | Stub only (testing) | headline |
| [discovery-wizard-ui.js:796](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L796) | wizard | You just want to confirm webhook delivery works. | help |
| [discovery-wizard-ui.js:799](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L799) | wizard | Quick wiring test | help |
| [discovery-wizard-ui.js:800](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L800) | wizard | No real job results — smoke test only | help |
| [discovery-wizard-ui.js:804](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L804) | wizard | Local discovery worker | headline |
| [discovery-wizard-ui.js:805](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L805) | wizard | Run the worker on this machine and keep discovery fully local. | help |
| [discovery-wizard-ui.js:809](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L809) | wizard | Real discovery, entirely on your own hardware | help |
| [discovery-wizard-ui.js:810](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L810) | wizard | No third-party service in the request path | help |
| [discovery-wizard-ui.js:813](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L813) | wizard | You run and keep the worker alive yourself | help |
| [discovery-wizard-ui.js:814](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L814) | wizard | Reaching it from other devices needs Tailscale (or a tunnel and relay you maintain) | help |
| [discovery-wizard-ui.js:815](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L815) | wizard | Stops when this computer sleeps — prefer the Tailscale option for a durable link | help |
| [discovery-wizard-ui.js:987](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L987) | wizard | Download Tailscale | link label |
| [discovery-wizard-ui.js:1063](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1063) | wizard | docs/SELF-HOSTING.md | link label |
| [discovery-wizard-ui.js:1069](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1069) | wizard | Worker URL (Tailscale, or your own HTTPS endpoint) | help |
| [discovery-wizard-ui.js:1072](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1072) | wizard | https://your-machine.tailXXXX.ts.net/webhook | help |
| [discovery-wizard-ui.js:1080](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1080) | wizard | Discovery webhook shared secret | help |
| [discovery-wizard-ui.js:1083](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1083) | wizard | Filled automatically by “Set it up for me” | help |
| [discovery-wizard-ui.js:1133](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1133) | wizard | AI assistant | button |
| [discovery-wizard-ui.js:1134](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1134) | wizard | Paste this into your AI coding assistant. | help |
| [discovery-wizard-ui.js:1153](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1153) | wizard | Paste one line into Terminal — no need to find your repo. | help |
| [discovery-wizard-ui.js:1190](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1190) | wizard | Start or restart the server: | help |
| [discovery-wizard-ui.js:1286](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/discovery-wizard-ui.js#L1286) | wizard | Start or detect the tunnel: | help |
| [sheet-access-setup.js:106](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L106) | B1 | Fix sign-in | button |
| [sheet-access-setup.js:135](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L135) | B1 | Set up JobBored for this account | button |
| [sheet-access-setup.js:247](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L247) | B1 | Did you know? | help |
| [sheet-access-setup.js:248](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L248) | B1 | Your pipeline, one glance | headline |
| [sheet-access-setup.js:249](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L249) | B1 | Scan cards for stage, notes, and follow-ups without digging through rows. | help |
| [sheet-access-setup.js:253](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L253) | B1 | Write-back stays in your sheet | headline |
| [sheet-access-setup.js:254](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L254) | B1 | Updates sync to Google Sheets — your spreadsheet remains the source of truth. | help |
| [sheet-access-setup.js:258](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L258) | B1 | Built for speed | headline |
| [sheet-access-setup.js:259](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L259) | B1 | Filter, sort, and expand details only when you need the full story. | help |
| [sheet-access-setup.js:337](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L337) | B1 | Open the Sheet | button |
| [sheet-access-setup.js:405](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L405) | B1 | Opening your workspace | headline |
| [sheet-access-setup.js:426](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L426) | B1 | Log in with Google to continue. | help |
| [sheet-access-setup.js:427](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L427) | B1 | Connecting to your sheet… | help |
| [sheet-access-setup.js:431](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L431) | B1 | Get started | headline |
| [sheet-access-setup.js:433](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L433) | B1 | Sign in with Google to create a starter sheet or connect your sheet. | help |
| [sheet-access-setup.js:435](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L435) | B1 | Welcome back | headline |
| [sheet-access-setup.js:436](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L436) | B1 | Use the Google account that can access this sheet. | help |
| [sheet-access-setup.js:451](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L451) | B1 | Connect Google | headline |
| [sheet-access-setup.js:452](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L452) | B1 | JobBored needs a Google OAuth Client ID before it can open your sheet. Add one in Settings, then reload. | help |
| [sheet-access-setup.js:458](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L458) | B1 | Add a Client ID in Settings, then reload. | help |
| [sheet-access-setup.js:462](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L462) | B1 | Couldn’t open your Sheet | headline |
| [sheet-access-setup.js:464](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L464) | B1 | Check that the Sheet link in Settings is right and that this Google account can open it, then reload. | help |
| [sheet-access-setup.js:474](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L474) | B1 | Sign in with the account that can open this sheet. | help |
| [sheet-access-setup.js:476](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L476) | B1 | Signed in as a different account? Set JobBored up for it instead. | help |
| [sheet-access-setup.js:477](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L477) | B1 | Check Settings or your network and reload. | help |
| [sheet-access-setup.js:503](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L503) | B1 | Try again | button |
| [sheet-access-setup.js:503](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L503) | B1 | Reload | button |
| [sheet-access-setup.js:673](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L673) | B1 | Starter sheet creation failed (HTTP ${createResp.status}). | error |
| [sheet-access-setup.js:682](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L682) | B1 | Google needs Sheets permission before JobBored can create a starter sheet. Approve the prompt and try again. | error |
| [sheet-access-setup.js:727](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L727) | B1 | Starter sheet header setup failed (HTTP ${headerResp.status}). | error |
| [sheet-access-setup.js:735](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L735) | B1 | Could not create starter sheet | error |
| [sheet-access-setup.js:830](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L830) | B1 | Could not create the starter sheet. Check the error message and try again. | error |
| [sheet-access-setup.js:872](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/sheet-access-setup.js#L872) | B1 | Starter sheet created. Opening guided setup… | help |
| [auth-session.js:30](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L30) | B1 | Your Google session ended | headline |
| [auth-session.js:31](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L31) | B1 | Sign in again to pick up where you left off. | help |
| [auth-session.js:437](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L437) | B1 | Session expired — please sign in again | error |
| [auth-session.js:591](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L591) | B1 | Dismiss | button |
| [auth-session.js:712](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L712) | B1 | Google didn't recognize this page's address. Add it in the steps shown, then press Continue with Google again. | error |
| [auth-session.js:713](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L713) | B1 | Google didn't recognize this page's address. Check the address listed in your Google app key settings, then try signing in again. | error |
| [auth-session.js:837](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L837) | B1 | Google sign-in couldn’t open a window. Allow popups for this site, turn off your popup blocker for localhost, and use a normal browser tab (embedded preview… | error |
| [auth-session.js:838](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L838) | B1 | Google sign-in failed. Try again, allow third-party cookies for accounts.google.com if your browser blocks them, or open the app in Chrome/Edge. | error |
| [auth-session.js:879](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L879) | B1 | Google sign-in failed. Try again — and if it keeps failing, allow popups for this page and try once more. | error |
| [auth-session.js:923](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L923) | B1 | Signed in | help |
| [auth-session.js:1003](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1003) | B1 | Google sign-in is not ready yet. Save your OAuth client and reload first. | error |
| [auth-session.js:1058](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1058) | B1 | Signed out | help |
| [auth-session.js:1165](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1165) | B1 | The setup check couldn’t load. Reload the page and try again. | error |
| [auth-session.js:1168](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1168) | B1 | Checking your setup… | help |
| [auth-session.js:1172](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1172) | B1 | Setup looks healthy. | help |
| [auth-session.js:1189](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1189) | B1 | Install doctor isn't available in this build. | help |
| [auth-session.js:1196](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1196) | B1 | All install tools look healthy. | help |
| [auth-session.js:1353](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1353) | B1 | Auto-healing on | help |
| [auth-session.js:1357](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1357) | B1 | Not installed — install | button |
| [auth-session.js:1399](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1399) | B1 | On — runs on boot | help |
| [auth-session.js:1403](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1403) | B1 | Off — start on boot | button |
| [auth-session.js:1441](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1441) | B1 | Worker autostart isn't available in this build. | help |
| [auth-session.js:1450](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1450) | B1 | Couldn't turn off discovery worker autostart. | error |
| [auth-session.js:1451](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1451) | B1 | Couldn't start the discovery worker on boot. | error |
| [auth-session.js:1453](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1453) | B1 | Couldn't turn off | button |
| [auth-session.js:1453](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1453) | B1 | Install failed | button |
| [auth-session.js:1465](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1465) | B1 | Discovery worker will no longer start on boot. | help |
| [auth-session.js:1466](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1466) | B1 | Discovery worker will now start on boot. | help |
| [auth-session.js:1471](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1471) | B1 | Error | help |
| [auth-session.js:1479](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1479) | B1 | Couldn't reach the worker autostart service. | error |
| [auth-session.js:1578](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1578) | B1 | Setup check | headline |
| [auth-session.js:1582](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/auth-session.js#L1582) | B1 | Close | button |
| [SETUP.md:1](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L1) | docs | # Command Center — Setup Guide | doc |
| [SETUP.md:15](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L15) | docs | ## BYO automation templates | doc |
| [SETUP.md:29](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L29) | docs | ## Quick Start | doc |
| [SETUP.md:46](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L46) | docs | ### Pick one setup path | doc |
| [SETUP.md:48](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L48) | docs | **1. Dashboard (core OSS path)** | doc |
| [SETUP.md:57](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L57) | docs | Open `http://localhost:8080` and follow the on-screen setup — the login gate walks you through Google sign-in, and the first-run wizard connects your Sheet and… | doc |
| [SETUP.md:63](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L63) | docs | **2. Local discovery worker** | doc |
| [SETUP.md:70](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L70) | docs | To run the worker on its own (e.g. with the dashboard hosted elsewhere), use `npm run discovery:worker:start-local`. | doc |
| [SETUP.md:87](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L87) | docs | **3. Optional materials drafts (local scraper)** | doc |
| [SETUP.md:89](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L89) | docs | Cover letters and tailored resumes are drafted on the local scraper server using the model you picked at setup (Gemini Flash is the recommended pin). | doc |
| [SETUP.md:107](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L107) | docs | ### 1. Create or copy the starter sheet | doc |
| [SETUP.md:109](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L109) | docs | Recommended in the app: sign in on the login gate, then let the first-run wizard create a **blank starter sheet** in your own Google Drive with just the `Pipelin… | doc |
| [SETUP.md:111](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L111) | docs | Manual fallback: [Click here to copy →](https://docs.google.com/spreadsheets/d/1pVFwPlvu3FqIhlC8YDuRpVA2v6A2fOjRX02TEiMoXRI/copy) | link label |
| [SETUP.md:115](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L115) | docs | **Start with an empty Pipeline:** open your copy → **Pipeline** tab → select all rows **below the header** (row 2 downward) → delete. | doc |
| [SETUP.md:119](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L119) | docs | ### 2. Create Google OAuth Credentials | doc |
| [SETUP.md:121](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L121) | docs | 1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials) | doc |
| [SETUP.md:123](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L123) | docs | 3. Enable the **Google Sheets API** | doc |
| [SETUP.md:127](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L127) | docs | 4. Configure the OAuth consent screen: Choose **External** | doc |
| [SETUP.md:133](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L133) | docs | 5. Create OAuth 2.0 Client ID: Choose **Web application** | doc |
| [SETUP.md:137](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L137) | docs | Add your deployment URL to **Authorized JavaScript Origins** (e.g., `https://yourdomain.com`). For local development, also add `http://localhost:8080`. | doc |
| [SETUP.md:139](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L139) | docs | Copy the **Client ID** (ends in `.apps.googleusercontent.com`) | doc |
| [SETUP.md:141](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L141) | docs | ### 3. Finish setup in the dashboard | doc |
| [SETUP.md:143](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L143) | docs | Open `http://localhost:8080` and follow the on-screen flow. Paste the OAuth Client ID and your Sheet URL when prompted; the app stores both in this browser, so… | doc |
| [SETUP.md:147](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L147) | docs | Your Sheet ID is the long segment in the spreadsheet URL (between `/d/` and `/edit`). You can paste **either** the full URL **or** the ID alone into the dashbo… | doc |
| [SETUP.md:155](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L155) | docs | ### 4. Deploy | doc |
| [SETUP.md:162](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L162) | docs | - **GitHub Pages** — choose **Settings → Pages → Source: GitHub Actions**; the included workflow assembles and deploys the complete artifact | doc |
| [SETUP.md:164](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L164) | docs | - **Vercel** — configure the static build to assemble first and promote `index.assembled.html` to the deployed `index.html` | doc |
| [SETUP.md:166](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L166) | docs | - **Netlify** — use a build-based deploy with the same assembly/promotion step | doc |
| [SETUP.md:167](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L167) | docs | - **Cloudflare Pages** — connect the repo and publish an assembled staging directory | doc |
| [SETUP.md:168](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L168) | docs | - **Local** — `npm run web-only` and open `http://localhost:8080` | doc |
| [SETUP.md:178](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L178) | docs | ## Recommended: enable the SerpApi Google Jobs source | doc |
| [SETUP.md:180](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L180) | docs | The discovery worker at `integrations/browser-use-discovery/` has three source lanes. The highest-quality one — `serpapi_google_jobs` — queries Google Jobs direc… | doc |
| [SETUP.md:186](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L186) | docs | 1. Sign up at [serpapi.com](https://serpapi.com/users/sign_up) — 100 free searches per month (~20 daily discovery runs). | doc |
| [SETUP.md:187](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L187) | docs | 2. Copy your API key from the [SerpApi dashboard](https://serpapi.com/manage-api-key). | doc |
| [SETUP.md:188](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L188) | docs | 3. Add it to `~/.jobbored/browser-use-discovery/.env`: `SERPAPI_API_KEY=paste-your-key-here` | doc |
| [SETUP.md:192](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/SETUP.md#L192) | docs | 4. Restart the worker (`npm run discovery:worker:start-local`) so the new env var loads. | doc |
| [README.md:18](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L18) | docs | ## Quick start | doc |
| [README.md:20](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L20) | docs | JobBored is a local-first job-search dashboard: track your pipeline in your own Google Sheet, draft tailored resumes/cover letters, and optionally run automated… | doc |
| [README.md:35](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L35) | docs | npm install # installs dashboard + server deps | doc |
| [README.md:36](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L36) | docs | npm start # dashboard + job scraper → http://localhost:8080 | doc |
| [README.md:39](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L39) | docs | Then open http://localhost:8080 and follow the on-screen setup — the login gate walks you through Google sign-in (including a guided path to create an OAuth Clie… | doc |
| [README.md:44](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L44) | docs | Two variants of the start command: | doc |
| [README.md:46](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L46) | docs | - npm run dev — adds the local discovery worker (recommended before you set up discovery, so the wizard's "Set it up for me" path has a worker to talk to). | doc |
| [README.md:49](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L49) | docs | - npm run web-only — zero-install dashboard path on a fresh clone; no scraper, worker, or dependency install required. | doc |
| [README.md:52](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L52) | docs | Want it reachable from your phone or another device? Expose the discovery worker with Tailscale (recommended), ngrok, or Cloudflare — see docs/SELF-HOSTING.md. | doc |
| [README.md:63](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L63) | docs | ## OS support | doc |
| [README.md:175](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L175) | docs | ## Setup reference | doc |
| [README.md:177](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L177) | docs | The login gate and first-run wizard do all of this in-app — these sections are the manual reference for what they set up (and for deploying beyond localhost). | doc |
| [README.md:180](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L180) | docs | ### 1. Create or copy a starter Google Sheet | doc |
| [README.md:182](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L182) | docs | Recommended in the app: sign in on the login gate, then let the first-run wizard create a blank starter sheet in your own Google Drive with just the required Pip… | doc |
| [README.md:186](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L186) | docs | Manual fallback: [→ Copy Template Sheet](https://docs.google.com/spreadsheets/d/1pVFwPlvu3FqIhlC8YDuRpVA2v6A2fOjRX02TEiMoXRI/copy) | link label |
| [README.md:195](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L195) | docs | ### 2. Create Google OAuth credentials | doc |
| [README.md:197](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L197) | docs | 1. Go to Google Cloud Console → Credentials | doc |
| [README.md:199](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L199) | docs | 3. Enable the Google Sheets API | doc |
| [README.md:200](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L200) | docs | 4. Configure the OAuth consent screen: choose External (unless you use a Workspace organization)... | doc |
| [README.md:203](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L203) | docs | 5. Go to Credentials → Create Credentials → OAuth 2.0 Client ID | doc |
| [README.md:204](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L204) | docs | 6. Application type: Web application | doc |
| [README.md:205](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L205) | docs | 7. Under Authorized JavaScript origins, add http://localhost:8080 | doc |
| [README.md:206](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L206) | docs | 8. Copy the Client ID | doc |
| [README.md:208](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L208) | docs | ### 3. Deploy | doc |
| [README.md:218](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L218) | docs | #### GitHub Pages (recommended) | doc |
| [README.md:229](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L229) | docs | #### Vercel | doc |
| [README.md:235](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L235) | docs | #### Netlify | doc |
| [README.md:240](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L240) | docs | #### Cloudflare Pages | doc |
| [README.md:247](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L247) | docs | #### Just open it locally | doc |
| [README.md:258](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L258) | docs | git clone https://github.com/emilio3435/Job-Bored.git ~/Job-Bored | doc |
| [README.md:261](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L261) | docs | npm start # → http://localhost:8080 (dashboard + scraper) | doc |
| [README.md:262](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L262) | docs | # Or: npm run dev (adds the local discovery worker) | doc |
| [README.md:263](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L263) | docs | # Or: npm run web-only (dashboard only) | doc |
| [README.md:272](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L272) | docs | ### Manual / advanced configuration | doc |
| [README.md:274](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L274) | docs | You normally don't need any of this — the login gate and first-run wizard collect the same values in-app and store them in this browser. | doc |
| [README.md:311](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L311) | docs | ### Going live — two independent axes | doc |
| [README.md:317](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L317) | docs | - (A) Host the dashboard (axis A) — pick any static host from the list above... Single-machine users can stop here — npm run dev (dashboard + worker on the same… | doc |
| [README.md:322](file:///Users/emilionunezgarcia/Job-Bored.worktrees/gfx-integration/README.md#L322) | docs | - (B) Expose the discovery worker beyond localhost (axis B)... This is the Tailscale (recommended), ngrok, or Cloudflare path. The default single-machine flow… | doc |

---

## Report Summary

The full 618-row verbatim dataset, complete terminology variant listings, and file-by-file counts are available directly in [copy_inventory.md](file:///Users/emilionunezgarcia/.gemini/antigravity-cli/brain/cc964cf0-1e84-4d42-8150-9e308323c9f7/copy_inventory.md).
