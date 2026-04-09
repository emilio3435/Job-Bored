# Security

## What this project stores in git

- **No API keys, OAuth client secrets, or user tokens** should appear in tracked files.
- **[`config.example.js`](config.example.js)** uses obvious placeholders only (`YOUR_SHEET_ID_HERE`, empty strings for keys).
- **[`.gitignore`](.gitignore)** lists `config.js`. If `config.js` was ever committed, remove it from the index with `git rm --cached config.js` and rotate any keys that were exposed.
- **Google Sheet URLs** in docs (e.g. “copy template”) contain a **public** spreadsheet id in the path. That id is not an API key; it only identifies a file you can copy.

## User data in the browser

- **Settings (localStorage):** Sheet id, OAuth client id, AI API keys, webhooks — only on the user’s machine. Not transmitted to the app authors.
- **OAuth access token:** In-memory only for Google Sheets write-back.
- **Profile / resume text:** IndexedDB, local to the browser.
- **Discovery preferences** (target roles, locations, keywords, etc.): IndexedDB, local to the browser. Included in POST bodies to **your** discovery webhook URL only when you click **Run discovery** (or your automation can ignore them).

## If you leaked a real key in git history

1. **Rotate** the key in Google AI Studio, OpenAI, or Google Cloud (OAuth client cannot be “rotated” the same way; restrict origins and create a new client if the id was abused).
2. **Purge** history or treat the repo as compromised for that credential.

## Reporting

Open an issue for security-sensitive bugs in this repository’s code (XSS, unintended data exfiltration, etc.).
