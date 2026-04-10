# app.js Monolith Analysis Report

## Summary

| Metric | Value |
|---|---|
| **Total lines** | 16,672 |
| **File size** | 553 KB |
| **Top-level functions** | 468 |
| **Top-level variables (let/const/var)** | 86 |
| **Total declarations (incl. local)** | ~2,633 |

---

## 1. Major Functional Areas (by line range)

### A. Config & Storage Layer — Lines 1–200 (~200 LOC)
- IIFE to load `discovery-wizard-local.js`
- `localStorage` config override read/write (`readStoredConfigOverrides`, `writeStoredConfigOverrides`, `mergeStoredConfigOverridePatch`)
- Config override key whitelist (`COMMAND_CENTER_OVERRIDE_KEYS`)
- `applyStoredConfigOverrides()` — runs on load

### B. Discovery Transport Setup — Lines 115–200 (~85 LOC)
- Discovery transport state read/write from `localStorage`
- URL normalization helpers (`normalizeDiscoveryLocalWebhookUrl`, `normalizeDiscoveryTunnelPublicUrl`)
- `isLocalDashboardOrigin()` detection
- Bootstrap hydration from `discovery-local-bootstrap.json`

### C. Config Validation & Getters — Lines 222–295 (~75 LOC)
- `parseGoogleSheetId()`, `normalizeDashboardTitle()`, `getConfig()`, `getSheetId()`
- `getOAuthClientId()`, `getDiscoveryWebhookUrl()`

### D. Google API Constants & Discovery State Machine — Lines 296–610 (~315 LOC)
- OAuth scope strings, Apps Script constants, starter pipeline headers
- 7 mutable state cache variables (`appsScriptDeployStateCache`, `discoveryEngineStateCache`, etc.)
- Settings field value getters
- Discovery engine state: `getEffectiveDiscoveryEngineStatus()`, `buildDiscoveryStatusActions()`
- `refreshDiscoveryUiState()`, `saveDiscoveryEngineStatePatch()`, `recordDiscoveryEngineState()`
- `preloadDiscoveryUiState()`

### E. Apps Script Deploy & Status — Lines 647–1025 (~380 LOC)
- GIS not-ready status builders
- Public access verification and remediation flows
- URL classifiers (`isLikelyAppsScriptWebAppUrl`, `isLikelyCloudflareWorkerUrl`)
- Cloudflare relay URL builders and shell command generators
- Agent prompt builders for AI assistants

### F. Discovery Wizard Runtime & Steps — Lines 1026–2200 (~1,175 LOC)
- Wizard flow mapping and step definitions
- `createDiscoveryWizardRuntime()`, `getDiscoveryWizardRuntime()`, `updateDiscoveryWizardRuntime()`
- Readiness snapshot building and caching
- Fallback settings/empty-state views
- Flow selection logic
- Wizard assist chooser UI construction
- Agent prompt generation (bootstrap, health, tunnel)
- Step ID generation and navigation

### G. Discovery Wizard Body Builders & UI — Lines 2200–4000 (~1,800 LOC)
- `buildDiscoveryDetectBody()`, `buildDiscoveryBootstrapBody()`, `buildDiscoveryLocalHealthBody()`, `buildDiscoveryTunnelBody()`
- `buildDiscoveryVerifyBody()` (242 LOC)
- `buildDiscoveryWizardSteps()` (271 LOC)
- Downstream chain diagnosis (`diagnoseDownstreamChain()` — 192 LOC)
- Wizard step navigation and rendering

### H. Discovery Wizard Action Handler — Lines 4000–4500 (~500 LOC)
- `handleDiscoveryWizardAction()` — **472 LOC god function** with 30+ action branches
- Handles bootstrap, health check, tunnel detect, relay, verify, fix setup, no-webhook, stub-only, etc.

### I. Scraper & Posting Enrichment Config — Lines 4500–4700 (~200 LOC)
- `getJobPostingScrapeUrl()`, `getAtsScoringConfig()`, `getAtsScorecardApiUrl()`
- Mixed-content detection (`isScraperUrlBlockedOnThisPage`)
- Scraper setup modal open/close
- Clipboard helper, connection test

### J. Apps Script Deploy Flow — Lines 4700–5900 (~1,200 LOC)
- `loadAppsScriptStubBundle()` — fetches Code.gs + manifest
- `requestAppsScriptDeployAccessToken()` — GIS incremental consent
- `appsScriptApiRequest()` — generic API client
- `deployAppsScriptStubFromSettings()` — **240 LOC** orchestrator
- JSONP public-access probe
- Full deploy state persistence and UI rendering (`renderAppsScriptDeployUi()` — 199 LOC)

### K. Core App State & Data Model — Lines 5944–6075 (~130 LOC)
- `SHEET_ID`, `pipelineData[]`, `pipelineRawRows[]`
- Filter/sort/search state (`currentFilter`, `currentSort`, `currentSearch`)
- Dashboard lifecycle flags
- `expandedJobKeys`, `viewedJobKeys`
- Enrichment cache (localStorage)
- Pipeline stage order and archive set
- `activeDetailKey`

### L. OAuth / Auth Session Management — Lines 6056–6700 (~645 LOC)
- Token state: `accessToken`, `userEmail`, `userPictureUrl`, `tokenExpiresAt`, `tokenClient`
- GIS load state tracking
- `localStorage` session persistence/restore
- Token refresh scheduler (proactive 5-min-before-expiry)
- Silent token refresh via GIS
- `signIn()`, `signOut()`, `updateAuthUI()`
- Auth user menu (avatar, dropdown, profile)
- Login gate with rotating tips

### M. Sheet Access Gate & Setup Screens — Lines 6700–7200 (~500 LOC)
- `showSheetAccessGate()` — multi-mode login/setup gate (120 LOC)
- Starter sheet creation (`createBlankStarterSheet()` — 119 LOC)
- `handleSetupCreateStarterSheet()`
- Setup screen reveal logic

### N. Discovery Local Tunnel & Cloudflare Relay Modals — Lines 7200–8500 (~1,300 LOC)
- ngrok tunnel probe (`probeNgrokFromLocalApi()`) via `/__proxy/ngrok-tunnels`
- Stale tunnel detection and banner
- Local tunnel save/setup
- Cloudflare relay setup modal populate/close
- `initDiscoverySetupGuide()` — **323 LOC** event binding function

### O. CSV Parsing & Data Fetching — Lines 8460–8700 (~240 LOC)
- Hand-rolled CSV parser (`parseCSV()`)
- JSONP fetcher (`fetchSheetJSONP()`)
- Google Sheets API v4 reader (`fetchSheetViaSheetsAPI()`)
- Hybrid fetch strategy (`fetchSheetCSV()` — tries API then JSONP)
- Cell value helpers (`getCellValue`, `getCellFormatted`, `parseGvizDate`)

### P. Data Parsing & Loading — Lines 8700–8970 (~270 LOC)
- `parsePipelineData()` — maps Sheet rows to job objects (30+ fields)
- `loadAllData()` — orchestrates data fetch, parse, and render
- `SHEET_ID` initialization
- Sort comparator, filter/search logic

### Q. Company Logo Fetching — Lines 8971–9090 (~120 LOC)
- Clearbit logo cache (`_LOGO_CACHE`, `_LOGO_PENDING`)
- Async fetch with placeholder upgrade pattern

### R. Pipeline Card & Board Rendering — Lines 9090–9700 (~610 LOC)
- `renderLogoHtml()`, `renderRoleFactsHtml()`, `groupByStage()`
- `renderKanbanCard()` — kanban board card
- `renderStageLane()`, `renderPipelineBoard()`
- Detail drawer: `openJobDetail()`, `closeJobDetail()`, `refreshDrawerIfOpen()`
- Scroll/indicator updates

### S. Pipeline List Card Rendering — Lines 9700–10500 (~800 LOC)
- `renderJobCard()` — **355 LOC god function** — generates the full HTML for a list pipeline card
- `renderDrawerContent()` — **322 LOC** — detail drawer body
- `renderCardActions()` — 101 LOC
- `renderPipeline()` — **103 LOC** orchestrator

### T. Event Listener Attachment — Lines 10500–10700 (~200 LOC)
- `attachCardListeners()` — **282 LOC** — mass re-binding of click/blur/change listeners on every render

### U. Daily Brief & Analytics — Lines 10705–11750 (~1,045 LOC)
- Date window calculations, stale/waiting/overdue filters
- Activity breakdown (7d/14d/30d/90d), SVG chart rendering (`catmullRomPath`)
- KPI stat cards
- Follow-up queue rendering
- `renderBrief()` — **178 LOC** orchestrator
- Source funnel chart

### V. Keyword Matching & Profile Match — Lines 11945–12500 (~555 LOC)
- `KEYWORD_STOP_WORDS`, `KEYWORD_ALIAS_GROUPS`
- Text normalization, variant expansion
- Keyword search index builder
- `collectJobKeywordGroups()`, `evaluateKeywordTerm()`
- Candidate profile match cache

### W. Resume/Cover Letter Generation — Lines 12500–15400 (~2,900 LOC)
- Draft library cache and rendering
- `fetchJobPostingEnrichment()` — scrape + optional LLM enrichment
- Resume file/paste intake (`profileApplyResumeFile`)
- Materials modal + refresh
- **Onboarding wizard** (9-step flow, ~250 LOC in `initOnboardingWizard`)
- Settings model selects, template selects, visual theme selects
- Settings form populate/save (`saveCommandCenterSettingsFromForm` — 177 LOC)
- Resume generate modal (`openResumeGenerateModal` — 105 LOC)
- `runResumeGeneration()` — 142 LOC
- Refine + draft version opening

### X. ATS Scorecard — Lines 14292–14900 (~600 LOC)
- Cache key computation
- Scorecard result normalization
- Payload builder (`buildAtsScorecardRequestPayload` — 128 LOC)
- `fetchAtsScorecard()`, render functions
- Async state machine (`startAtsScorecardAnalysis`)

### Y. Profile Materials Feature — Lines 15390–15998 (~608 LOC)
- `initResumeMaterialsFeature()` — **608 LOC god function** — single function wiring all profile/materials UI events
- Dropzone binding, file inputs, LinkedIn capture modal, AI context save/clear

### Z. App Init & Discovery Prefs — Lines 15998–16672 (~674 LOC)
- `init()` — main entry point, sets up sort/search/refresh, init auth, load data
- `syncDiscoveryButtonState()` — button enable/disable logic
- Discovery prefs modal (manual fields + AI suggest tab)
- `initDiscoveryPrefsModal()` — 211 LOC
- `initDiscoveryButton()`
- `DOMContentLoaded` bootstrap

---

## 2. Global State (86 top-level variables)

### Mutable Singletons (critical coupling)
| Variable | Line | Description |
|---|---|---|
| `SHEET_ID` | 5944 | Active Google Sheet ID |
| `pipelineData` | 5947 | Master job array — mutated in-place |
| `pipelineRawRows` | 5948 | Raw Sheet rows for index mapping |
| `accessToken` | 6056 | Google OAuth token |
| `userEmail` | 6057 | Signed-in user email |
| `userPictureUrl` | 6059 | Google profile photo URL |
| `tokenExpiresAt` | 6062 | Token expiry epoch |
| `tokenClient` | 6063 | GIS token client instance |
| `gisLoaded` | 6064 | Whether GIS library loaded |
| `activeDetailKey` | 6053 | Currently-open drawer index |
| `currentFilter` | 5950 | Active filter mode |
| `currentSort` | 5951 | Active sort key |
| `currentSearch` | 5952 | Active search query |
| `appsScriptDeployStateCache` | 344 | Apps Script deploy state |
| `discoveryEngineStateCache` | 347 | Discovery engine state |
| `discoveryWizardRuntime` | 350 | Wizard state machine |
| `discoveryReadinessSnapshotCache` | 348 | Readiness snapshot |
| `lastResumeGenerationSession` | 11758 | Last resume gen session |
| `candidateProfileMatchCache` | 11760 | Profile keyword match cache |
| `generatedDraftLibraryCache` | 11766 | Generated drafts cache |
| `atsScorecardState` | 11772 | ATS scorecard async state |
| `onboardingResumeDraft` | 11753 | Onboarding wizard draft |
| `briefActivityRange` | 11021 | Brief chart time range |

### Immutable Config/Constants
- `STAGE_ORDER`, `STAGE_ARCHIVE`, `STARTER_PIPELINE_HEADERS`
- `KEYWORD_STOP_WORDS`, `KEYWORD_ALIAS_GROUPS`
- OAuth scope strings, API base URLs
- Cache keys and limits

---

## 3. Coupling Points

1. **`pipelineData` is read/written everywhere** — rendering (cards, board, drawer, brief), event handlers (status change, notes, follow-up), enrichment, filtering, sorting. Any module touching jobs must access this global array.

2. **`accessToken` gates all Google API calls** — Sheet reads, writes, starter sheet creation, Apps Script deploy, token refresh. Auth module is coupled to data fetch, settings save, and starter sheet.

3. **`window.COMMAND_CENTER_CONFIG`** — read by config getters, settings form, and discovery logic. Written by config override layer.

4. **`window.CommandCenterUserContent`** (external module) — touched by discovery state, profile match, materials, onboarding, resume generation, settings, and discovery prefs.

5. **Discovery readiness snapshot** — built from ~6 different state sources (Apps Script cache, discovery engine cache, transport setup, wizard runtime, probes API). Read by discovery button, settings, empty state, brief, wizard.

6. **`showToast()`** — called from nearly every module as the sole user feedback mechanism.

7. **DOM coupling** — functions directly read/write DOM by `getElementById`. No component abstraction. Re-render triggers full HTML replacement + mass event re-binding.

---

## 4. Anti-Patterns Found

### God Functions (>200 LOC)
| Function | LOC | Issue |
|---|---|---|
| `initResumeMaterialsFeature()` | 608 | Wires ALL profile/materials event handlers in one function |
| `handleDiscoveryWizardAction()` | 472 | 30+ action branches in one giant switch |
| `renderJobCard()` | 355 | Builds entire pipeline card HTML string |
| `initDiscoverySetupGuide()` | 323 | Binds all discovery modal event handlers |
| `renderDrawerContent()` | 322 | Builds entire detail drawer HTML string |
| `attachCardListeners()` | 282 | Re-binds every interactive element after each render |
| `buildDiscoveryWizardSteps()` | 271 | Constructs full wizard step array |
| `initOnboardingWizard()` | 250 | All onboarding event wiring |
| `buildDiscoveryVerifyBody()` | 242 | Wizard verify step DOM construction |
| `deployAppsScriptStubFromSettings()` | 240 | Full deploy orchestration |
| `initDiscoveryPrefsModal()` | 211 | Discovery prefs modal event wiring |
| `renderAppsScriptDeployUi()` | 199 | Full Apps Script status rendering |

### Duplicated Patterns
- **Manual DOM event binding** — `.addEventListener("click", ...)` applied individually to dozens of elements across 5+ `init*` functions. Each render cycle re-creates all listeners.
- **URL normalization** — `normalizeDiscoveryLocalWebhookUrl`, `normalizeDiscoveryTunnelPublicUrl`, `normalizeDiscoveryWebhookIdentity` all do similar URL clean-up with slight variations.
- **Status/tone pattern** — `{ tone, message, detail, steps, actions }` status objects are hand-built in 10+ places with no shared constructor.
- **HTML string concatenation** — Massive template literals throughout rendering functions, no shared component/template system.
- **`escapeHtml()` calls** — scattered through every rendering function but defined once (appears around ~8970 area).

### Structural Issues
- **No module system** — all 468 functions and 86 globals share a single scope. Any function can call any other.
- **innerHTML re-render** — `renderPipeline()` replaces entire card list HTML on every state change, then `attachCardListeners()` re-binds all events (282 LOC of querySelector + addEventListener).
- **Synchronous global mutation** — functions like `recordDiscoveryEngineState()` mutate cache globals and trigger cascading UI refreshes.
- **Mixed concerns in single functions** — `loadAllData()` handles data fetch, parse, cache, auth retry, and UI render.
- **No error boundary** — individual try/catch blocks everywhere but no systematic error handling strategy.

---

## 5. Suggested Module Decomposition

### Module Map (16 files)

```
js/
├── config.js              (~200 LOC) Config read/write, overrides, localStorage, getConfig/getSheetId/getOAuthClientId
├── constants.js           (~100 LOC) All constants: stage order, scopes, URLs, cache keys, pipeline headers
├── auth.js                (~650 LOC) OAuth/GIS: token client, sign-in/out, refresh, session persist, auth UI
├── sheets-api.js          (~350 LOC) CSV parser, JSONP fetcher, Sheets API v4 reader, fetchSheetCSV
├── data-model.js          (~300 LOC) pipelineData management, parsePipelineData, sort/filter/search, loadAllData
├── toast.js               (~50 LOC)  showToast, escapeHtml, copyTextToClipboard
├── logo.js                (~120 LOC) Company logo cache + Clearbit fetch
├── cards.js               (~800 LOC) renderJobCard, renderCardActions, renderRoleFactsHtml, renderLogoHtml
├── board.js               (~300 LOC) Kanban board: renderKanbanCard, renderStageLane, renderPipelineBoard
├── drawer.js              (~500 LOC) Detail drawer: openJobDetail, closeJobDetail, renderDrawerContent
├── brief.js               (~1,050 LOC) Daily brief: stats, charts, follow-up queue, renderBrief
├── keyword-match.js       (~560 LOC) Keyword normalization, search index, profile match, evaluateKeywordTerm
├── enrichment.js           (~400 LOC) Posting scrape, LLM enrichment, enrichment cache, fetchJobPostingEnrichment
├── resume.js              (~2,500 LOC) Onboarding wizard, materials modal, resume generation, draft library, ATS scorecard
├── discovery.js           (~4,500 LOC) Discovery wizard runtime, wizard steps, wizard actions, readiness snapshot, prefs modal
│   (or split further:)
│   ├── discovery-state.js     (~800 LOC) Engine state, readiness snapshot, fallback views
│   ├── discovery-wizard.js    (~2,000 LOC) Wizard runtime, step builders, UI construction
│   ├── discovery-actions.js   (~700 LOC) handleDiscoveryWizardAction + verification
│   └── discovery-modals.js    (~1,000 LOC) Setup guide, tunnel modal, relay modal, prefs modal
├── apps-script.js         (~1,200 LOC) Apps Script deploy, public access checks, remediation, deploy UI
├── settings.js            (~700 LOC) Settings modal: populate, save, clear, init event handlers
├── setup.js               (~500 LOC) Sheet access gate, starter sheet, setup screen logic
└── init.js                (~200 LOC) DOMContentLoaded bootstrap, init* calls, setInterval
```

### Dependency Graph (simplified)
```
init.js → config.js, auth.js, settings.js, setup.js, discovery.js, data-model.js
data-model.js → config.js, sheets-api.js, auth.js, toast.js
cards.js → logo.js, enrichment.js, keyword-match.js, toast.js
board.js → cards.js
drawer.js → cards.js, enrichment.js, resume.js
brief.js → data-model.js, discovery.js
resume.js → enrichment.js, keyword-match.js, auth.js, toast.js
discovery.js → config.js, auth.js, apps-script.js, toast.js
settings.js → config.js, discovery.js, apps-script.js, resume.js
```

---

## 6. Additional Tech Debt Observations

1. **No build step** — vanilla JS with no bundler. Module decomposition requires either adopting ES modules (with `<script type="module">`) or a simple bundler (esbuild/rollup). ES modules would be the lightest lift since there's no framework.

2. **innerHTML rendering** — the entire pipeline re-renders by setting `.innerHTML` on a container, then re-binds all events. This is O(n) DOM thrash on every state change. A virtual DOM or at minimum a keyed diff would improve performance.

3. **Event delegation missing** — `attachCardListeners()` (282 LOC) binds individual listeners to every interactive element. A single delegated handler on the container would eliminate this function entirely.

4. **No TypeScript or JSDoc types** — 468 functions with no type annotations. Function signatures rely on runtime duck-typing.

5. **Inline SVG icons** — SVG markup is copy-pasted throughout card/drawer rendering functions. Should be extracted to an icon registry or sprite.

6. **Synchronous data access pattern** — `pipelineData[idx]` is used everywhere with no null-safety pattern. If indices shift (e.g., during concurrent updates), stale references cause bugs.

7. **Wizard-related code is ~35% of the file** (~5,800 LOC for discovery wizard + Apps Script + setup) despite being used only during initial configuration. Strong candidate for lazy-loading.

8. **No unit tests** — the monolith makes pure-function extraction and testing impossible without refactoring.
