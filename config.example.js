/**
 * JobBored — Configuration
 *
 * 1. Copy this file: cp config.example.js config.js
 * 2. Replace the placeholder values below with your own.
 * 3. See SETUP.md and docs/GITHUB-PAGES.md for deployment instructions.
 *
 * Static hosts can also leave config.js placeholder-only and use in-app
 * Settings. Those overrides are stored in this browser's localStorage.
 */
window.COMMAND_CENTER_CONFIG = {
  // Google Sheet: paste the raw ID, or the full spreadsheet URL (same as Settings form)
  sheetId: "YOUR_SHEET_ID_HERE",

  // Your Google OAuth 2.0 Client ID (Web application type)
  // Get one at: https://console.cloud.google.com/apis/credentials
  // Create OAuth 2.0 Client ID → Web application
  // Add your domain to Authorized JavaScript Origins
  oauthClientId: "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",

  // Optional: dashboard title
  title: "JobBored",

  // Optional: Hermes / automation — when the user clicks "Run discovery", the app
  // POSTs JSON to this URL so your agent can run another pass with a fresh
  // variation key (fewer duplicate leads). Endpoint must allow CORS from your site.
  // Local packaged discovery setup keeps worker config/env under
  // ~/.jobbored/browser-use-discovery/ by default; run `npm run setup:discovery`.
  // On GitHub Pages, use an HTTPS endpoint or a Cloudflare Worker relay.
  // Body: { event, schemaVersion, sheetId, variationKey, requestedAt, discoveryProfile }
  // See AGENT_CONTRACT.md
  discoveryWebhookUrl: "",

  // Optional shared secret — when set, the dashboard sends it as the
  // x-discovery-secret header. Required by the browser-use discovery worker
  // (which fail-closes on empty secrets). Leave empty for public endpoints
  // like the Apps Script stub.
  // Do not commit real secrets to a public repository; prefer Settings,
  // private forks, or a Pages deploy workflow that generates config.js.
  discoveryWebhookSecret: "",

  // Cheerio scraper for "Fetch posting" on job cards (see server/).
  // Leave empty: on http://localhost the app defaults to http://127.0.0.1:3847 (npm start).
  // On GitHub Pages (HTTPS), leave empty unless you deploy the scraper — see DEPLOY-SCRAPER.md.
  jobPostingScrapeUrl: "",

  // Base URL of the local API server (server/index.mjs, default :3847) that
  // serves /profile and /api/* (brand logos, materials). Leave empty on
  // http://localhost (defaults to the same scraper origin). Set it only if the
  // dashboard runs on a different origin than the API — e.g.
  // "http://localhost:3847". Falls back to jobPostingScrapeUrl when empty.
  jobBoredApiUrl: "",

  // Optional: company logos on job cards (from the job Link column — no extra scraping).
  // Logos try several public CDNs in order; add Logo.dev for higher-quality marks when you have a token.
  // logoUrlTemplate: "https://your-proxy.example.com/logo?d={{domain}}",
  logoUrlTemplate: "",
  logoDevToken: "",

  // --- Resume Updater & Cover Letter Writer (optional) ---
  // Materials (resume, samples, preferences) are stored locally in IndexedDB.
  // Generation sends text to ONE of: OpenRouter (free default), Gemini, OpenAI,
  // Anthropic, or your webhook — never to our servers.
  //
  // ATS scorecard mode:
  // - "server" (default): POST /api/ats-scorecard on your local/deployed server
  // - "webhook": POST to atsScoringWebhookUrl (same payload contract)
  // When on localhost and atsScoringServerUrl is blank, app defaults to
  // http://127.0.0.1:3847/api/ats-scorecard.
  atsScoringMode: "server",
  atsScoringServerUrl: "",
  atsScoringWebhookUrl: "",
  //
  // For "Draft cover letter" and "Tailor resume" on job cards you must configure ONE of:
  // - OpenRouter (default, free tier): resumeProvider "openrouter" + a FREE resumeOpenRouterApiKey
  //   from https://openrouter.ai/keys — no paid plan needed. CORS-friendly from the browser.
  // - Local: resumeProvider "local" + resumeLocalBaseUrl (e.g. Ollama on http://127.0.0.1:11434/v1)
  //   + resumeLocalModel (e.g. gemma4:e2b) — fully offline, no key required.
  // - Gemini: resumeProvider "gemini" + resumeGeminiApiKey from https://aistudio.google.com/
  // - OpenAI: resumeProvider "openai" + resumeOpenAIApiKey (CORS may block on some hosts)
  // - Anthropic: resumeProvider "anthropic" + resumeAnthropicApiKey (CORS may block; use webhook if needed)
  // - Webhook: resumeProvider "webhook" + resumeGenerationWebhookUrl (your server calls the LLM)
  //
  // Provider: "openrouter" (default, free), "local", "gemini", "openai", "anthropic", or "webhook"
  resumeProvider: "openrouter",
  // OpenRouter free-tier key (browser-safe; paste a FREE key, do not commit real keys to public repos).
  // Get one at https://openrouter.ai/keys. Free models work without any paid plan.
  resumeOpenRouterApiKey: "",
  // Default free model. Pick another ":free" model id in Settings if this one is retired.
  resumeOpenRouterModel: "openai/gpt-oss-120b:free",
  // OpenRouter OpenAI-compatible base URL (no trailing slash). Rarely changed.
  resumeOpenRouterBaseUrl: "https://openrouter.ai/api/v1",
  // Local OpenAI-compatible server (e.g. Ollama). resumeProvider "local" runs
  // fully offline with no key. Pull a model first (e.g. `ollama pull gemma4:e2b`).
  // Base URL of the local server (no trailing slash). Ollama default shown.
  resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
  // Local model id. Offered in Settings: "gemma4:e2b" (default) and
  // "gemma4:e2b-mlx" (Apple Silicon, text-only).
  resumeLocalModel: "gemma4:e2b",
  // Optional local API key — sent as Authorization only when set. Ollama ignores it.
  resumeLocalApiKey: "",
  // Google AI Studio API key (browser-safe; do not commit real keys to public repos)
  resumeGeminiApiKey: "",
  resumeGeminiModel: "gemini-3.5-flash",
  // OpenAI may be blocked by CORS from some static hosts; prefer Gemini or webhook.
  resumeOpenAIApiKey: "",
  resumeOpenAIModel: "gpt-4o-mini",
  resumeAnthropicApiKey: "",
  resumeAnthropicModel: "claude-sonnet-4-6",
  // POST receives JSON: { event, feature, job, profile, instructions, meta, ... }
  // Respond with JSON { "text": "..." } or plain text body.
  resumeGenerationWebhookUrl: "",
};
