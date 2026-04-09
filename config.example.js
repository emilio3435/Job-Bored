/**
 * JobBored — Configuration
 *
 * 1. Copy this file: cp config.example.js config.js
 * 2. Replace the placeholder values below with your own.
 * 3. See SETUP.md for detailed instructions.
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
  // Body: { event, schemaVersion, sheetId, variationKey, requestedAt, discoveryProfile }
  // See AGENT_CONTRACT.md
  discoveryWebhookUrl: "",

  // Cheerio scraper for "Fetch posting" on job cards (see server/).
  // Leave empty: on http://localhost the app defaults to http://127.0.0.1:3847 (npm start).
  // On GitHub Pages (HTTPS), leave empty unless you deploy the scraper — see DEPLOY-SCRAPER.md.
  jobPostingScrapeUrl: "",

  // Optional: company logos on job cards (from the job Link column — no extra scraping).
  // Logos try several public CDNs in order; add Logo.dev for higher-quality marks when you have a token.
  // logoUrlTemplate: "https://your-proxy.example.com/logo?d={{domain}}",
  logoUrlTemplate: "",
  logoDevToken: "",

  // --- Resume Updater & Cover Letter Writer (optional) ---
  // Materials (resume, samples, preferences) are stored locally in IndexedDB.
  // Generation sends text to ONE of: Gemini, OpenAI, Anthropic, or your webhook — never to our servers.
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
  // - Gemini (default): set resumeGeminiApiKey from https://aistudio.google.com/
  // - OpenAI: resumeProvider "openai" + resumeOpenAIApiKey (CORS may block on some hosts)
  // - Anthropic: resumeProvider "anthropic" + resumeAnthropicApiKey (CORS may block; use webhook if needed)
  // - Webhook: resumeProvider "webhook" + resumeGenerationWebhookUrl (your server calls the LLM)
  //
  // Provider: "gemini" (default), "openai", "anthropic", or "webhook"
  resumeProvider: "gemini",
  // Google AI Studio API key (browser-safe; do not commit real keys to public repos)
  resumeGeminiApiKey: "",
  resumeGeminiModel: "gemini-2.5-flash",
  // OpenAI may be blocked by CORS from some static hosts; prefer Gemini or webhook.
  resumeOpenAIApiKey: "",
  resumeOpenAIModel: "gpt-4o-mini",
  resumeAnthropicApiKey: "",
  resumeAnthropicModel: "claude-sonnet-4-6",
  // POST receives JSON: { event, feature, job, profile, instructions, meta, ... }
  // Respond with JSON { "text": "..." } or plain text body.
  resumeGenerationWebhookUrl: "",
};
