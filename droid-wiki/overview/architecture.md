# Architecture

JobBored is composed of one always-present static dashboard plus several optional Node services. They communicate through HTTP and through the user's Google Sheet. There is no maintainer-hosted service; every runtime piece runs in the user's account or on the user's machine.

## Runtime composition

```mermaid
graph LR
    Browser["Static dashboard<br/>(index.html + app.js)"]
    Sheet["Google Sheet<br/>Pipeline / DiscoveryRuns / Blacklist"]
    GIS["Google Identity Services<br/>+ Sheets API"]
    DevServer["dev-server.mjs<br/>:8080"]
    Scraper["server/index.mjs<br/>:3847 (scraper + ATS + materials)"]
    Worker["browser-use-discovery worker<br/>:8644"]
    Relay["Cloudflare relay /<br/>Apps Script / n8n"]
    Hermes["Hermes JHOS (Python)<br/>~/.hermes/job-hunt"]
    LLM["BYOK LLM<br/>Gemini / OpenAI / Anthropic"]
    SerpApi["SerpApi Google Jobs"]
    ATS["Greenhouse / Lever / Ashby<br/>Workday / iCIMS / ..."]

    Browser -->|JSONP gviz read| Sheet
    Browser -->|Sheets API v4 write| GIS --> Sheet
    DevServer -. serves static files .-> Browser
    Browser -->|Run discovery POST| Worker
    Browser -->|optional CORS hop| Relay --> Worker
    Browser -->|Fetch posting / ATS| Scraper
    Browser -->|BYOK| LLM
    Worker -->|Sheets API| Sheet
    Worker -->|Gemini grounded search| LLM
    Worker -->|optional| SerpApi
    Worker -->|public board APIs| ATS
    Hermes -->|Sheets API| Sheet
    Hermes -->|materials manifest| Scraper
```

## The three lanes

- **Browser dashboard** — `index.html` + ~50 root JS files load in deliberate order. `app.js` (24k LOC) owns most behavior. v2 chrome (`flowing-*`, `pipeline.js`, `lattice.js`, `dawn.js`, `role.js`, `letter.js`, `scribe.js`) renders the redesigned surfaces when `body.jb-v2` is set.
- **Optional local server** — `server/index.mjs` is the Express scraper + ATS scorecard + materials API. It also hosts the user-profile and rescore endpoints.
- **Optional discovery worker** — `integrations/browser-use-discovery/src/server.ts` accepts the `command-center.discovery` webhook, runs a scout → score → exploit → learn loop across ATS / grounded web / SerpApi lanes, and writes Pipeline rows back to the Sheet.

## Data flow: read

```mermaid
graph LR
    A[Dashboard load] -->|JSONP fetch| B[gviz endpoint]
    B -->|CSV-shaped response| C[parsePipelineCSV in app.js]
    C --> D[Card render + Daily Brief + KPI bar]
```

Reads use Google's `gviz` JSONP endpoint, so no OAuth is required when the sheet is published or shared "anyone with the link". Signed-in users use the Sheets API.

## Data flow: write

```mermaid
graph LR
    A[User edits status / notes] --> B[app.js write-back]
    B -->|GIS access token| C[Sheets API v4 batchUpdate]
    C --> D[Pipeline row updated]
    D --> E[Card re-renders<br/>flowing-store fan-out]
```

OAuth access tokens stay in browser memory only; they are never persisted (see [security](../security.md)).

## Data flow: discovery

```mermaid
graph LR
    A[User clicks Run discovery] --> B[triggerDiscoveryRun in app.js]
    B -->|POST command-center.discovery| C[Discovery worker /discovery]
    C -->|202 ack + statusPath| B
    B -->|poll /runs/:runId| C
    C -->|scout ATS/web/SerpApi| D[Source lanes]
    D --> E[lead-normalizer + job-matcher]
    E --> F[pipeline-writer]
    F -->|Sheets API| G[Pipeline tab]
    F -->|append| H[DiscoveryRuns tab]
```

The webhook contract is documented in `AGENT_CONTRACT.md` and `schemas/discovery-webhook-request.v1.schema.json`. The worker is one valid receiver; Apps Script, n8n, GitHub Actions, or any other user-owned endpoint can take its place.

## Codebase shape

Source distribution (rough, no `.lock` / generated files):

```mermaid
xychart-beta horizontal
    title "Source files (count) by area"
    x-axis ["root JS/CSS/HTML", "browser-use-discovery TS", "server/", "scripts/", "tests/", "hermes Python", "ats provider TS"]
    y-axis "files" 0 --> 100
    bar [66, 40, 17, 49, 86, 17, 18]
```

```mermaid
xychart-beta horizontal
    title "Lines of code (thousands) by area"
    x-axis ["root JS/CSS", "browser-use-discovery", "tests", "scripts", "server", "hermes scripts"]
    y-axis "kLOC" 0 --> 90
    bar [80, 37, 22, 13, 6, 5]
```

The single biggest file is `app.js` (~24k lines), the second is `style.css` (~13k). The discovery worker's `run-discovery.ts` is the largest TypeScript file (~2.6k lines). See [by-the-numbers](../by-the-numbers.md) for the full breakdown.

## Script loading order

The order of `<script>` tags in `index.html` is load-bearing. None of the root JS files use ES modules; many publish APIs on `window`. The high-level order is:

1. Vendor (`gsi/client`) and fonts
2. Visual themes + document templates (`document-templates.js`, `visual-themes.js`)
3. User content store (`user-content-store.js`) — IndexedDB
4. v2 surfaces (`jb-ui.js`, `welcome.js`, `lattice.js`, `dawn-*.js`, `flowing-*.js`, `pipeline.js`, `role*.js`, `letter.js`, `scribe.js`)
5. Discovery wizard modules (`discovery-wizard-*.js`)
6. Resume/profile (`resume-bundle.js`, `resume-generate.js`, `fit-profile-*.js`)
7. Config (`config.js` generated from `config.example.js`)
8. Settings (`settings-tab-schema.js`, `settings-tabs.js`, `settings-profile-tab.js`, …)
9. Runs / companies (`runs-tab.js`, `companies-tab.js`)
10. `app.js` — main controller

Adding a new module requires placing it correctly in this chain in `index.html`.

## Cross-references

- [Apps overview](../apps/index.md) for per-runtime detail
- [Features overview](../features/index.md) for product capabilities
- [API overview](../api/index.md) for HTTP surface
- [Patterns and conventions](../how-to-contribute/patterns-and-conventions.md) for coding norms
