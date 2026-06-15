# Security

Thanks for taking the time to think about JobBored's security. The product
keeps secrets on the user's machine on purpose — that's the threat model
this file documents, and how to report anything that breaks it.

## Reporting a vulnerability

**Don't open a public issue for a security bug.** Use one of these private
channels:

- **GitHub Security Advisory (preferred):**
  [Open a private report](https://github.com/emilio3435/Job-Bored/security/advisories/new)
- **Email:** [emilio@elioai.app](mailto:emilio@elioai.app)

You'll get an acknowledgement within **72 hours**, a proposed remediation
timeline within **7 days**, and credit in the fix's commit + release notes
unless you ask otherwise.

If you genuinely cannot reach me through either channel after a week, a
public issue is acceptable as a last resort — but please leave the
proof-of-concept out of it until I respond.

## What this project stores in git

- **No API keys, OAuth client secrets, or user tokens** are ever committed
  to tracked files.
- **[`config.example.js`](config.example.js)** uses obvious placeholders
  only (`YOUR_SHEET_ID_HERE`, empty strings for keys). `npm run setup`
  copies it to `config.js`, which is git-ignored.
- **`config.js`** is in `.gitignore`. If it was ever committed by accident,
  remove it with `git rm --cached config.js` **and** rotate any keys that
  were exposed — history rewrites don't help once a key is public.
- **Google Sheet URLs** in docs (e.g. "copy template") contain a public
  spreadsheet id in the path. That id is not an API key — it only
  identifies a file you can copy.

## Where user data actually lives

JobBored is local-first. The honest list of where credentials and content
live by default:

- **Settings (browser `localStorage`):** Sheet id, OAuth client id, AI API
  keys, webhook URLs. Stays in your browser. Not transmitted to the
  project authors.
- **OAuth access token:** In-memory only, lifetime = your browser session.
  Used to write back to Google Sheets.
- **Resume + profile text (browser `IndexedDB`):** Local to your browser.
- **Discovery preferences** (target roles, locations, keywords) and **draft
  history**: Local to your browser via `IndexedDB`.
- **Discovery worker env** (`~/.jobbored/browser-use-discovery/.env`):
  Local to the machine the worker runs on. Holds the worker's
  `BROWSER_USE_DISCOVERY_*` secrets.

The only outbound paths your data takes are the ones you explicitly
configure:

- **Google Sheets API**, when you sign in and the app reads/writes your
  pipeline sheet.
- **Your discovery webhook URL**, when you click Run discovery. The
  request includes your `discoveryProfile`.
- **Your chosen AI provider** (OpenRouter / Gemini / OpenAI / Anthropic /
  local / your webhook), when you draft materials or click Check
  connection. The request includes only the prompt + your key.

## Hardening that's already in place

Most of the obvious foot-guns have been closed. Worth naming so anyone
auditing knows where to look:

- **Provider base-URL allowlist** ([resume-generate.js](resume-generate.js)):
  `https://` to any host, or `http://` only to `127.0.0.1` / `localhost`.
  Without this guard, a user-pasted attacker URL on the OpenRouter / local
  base-URL field would have exfiltrated Bearer keys in cleartext.
- **Constant-time webhook secret comparison**
  ([integrations/browser-use-discovery/src/webhook/](integrations/browser-use-discovery/src/webhook/)):
  the worker SHA-256s both sides before `timingSafeEqual`, so an attacker
  can't learn the configured secret length from response timing.
- **Dev-server CSP + frame headers + `isLocalOrigin` proxy gating**
  ([dev-server.mjs](dev-server.mjs)): the `/__proxy/*` endpoints
  fail-close on non-localhost origins.
- **No CDN on the critical path:** pdf.js, mammoth, and all six font
  families are vendored locally so first paint can't be hijacked by a
  third party.

## If you leaked a real key

1. **Rotate immediately** with the provider (Google AI Studio, OpenAI,
   Anthropic, OpenRouter, SerpApi).
2. For a leaked **OAuth client id**, you can't "rotate" it the same way;
   restrict authorized origins, or create a new client and abandon the
   old one.
3. **Purge history** (`git filter-repo`, BFG) — but treat anything ever
   public as compromised. Rotation, not redaction, is the real fix.

## Scope

In scope:

- The dashboard code (`/`, top-level `.js` / `.mjs` / `.html` / `.css`)
- The discovery worker (`integrations/browser-use-discovery/`)
- The materials server (`server/`)
- Dev-server endpoints (`dev-server.mjs`, `/__proxy/*`)
- The CI workflows (`.github/workflows/`)

Out of scope:

- Vulnerabilities in your AI provider, Google's OAuth, Cloudflare, or
  Tailscale. Report those to the vendor.
- DoS via the user's own browser (you own that surface).
- Issues that require an attacker who already has shell access to the
  user's machine.
