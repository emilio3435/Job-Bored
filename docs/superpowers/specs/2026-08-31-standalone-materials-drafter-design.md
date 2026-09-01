# Design — Standalone materials drafter

**Date:** 2026-08-31
**Status:** draft for review
**Branch:** `feat/standalone-materials-drafter` (from `origin/main`)
**Companion:** `diagrams/materials-drafter-explainer.html` (plain-language digest)

---

## Context

Dragging a job from New/Discovered to Researching POSTs `/api/applications/:slug/request`. The dashboard toasts that a resume and cover letter are being generated. That used to be true: the local server spawned Hermes, which wrote branded HTML/PDF under `~/.hermes/job-hunt/applications/<slug>/`.

Hermes is uninstalled on purpose. The toast is a lie. The EAB role (Senior Director, Digital Marketing Strategy, Advancement) is the fixture: `pending.json` exists, the cached "job description" is a one-line fit blurb (`Low fit … 4.7/10`), and no drafts were written.

The dashboard also has an in-browser BYOK path (`resume-generate.js`) that calls whatever model is in Settings. That path still works, but its default pin is `openai/gpt-oss-120b:free`. ATS scorecards on the local server call `gemini-2.5-flash` from `server/.env`. Settings fallbacks are Gemini 3.5 / GPT-4o-mini / Sonnet 4.6. Three different models, all behind current Flash / GPT-5.6 / Sonnet 5.

## Goal

When a job moves to Researching, a tailored resume and cover letter appear in the existing dossier, written by JobBored's local scraper server, with no Hermes binary.

The model chosen during first-run setup (and later in Settings) is the **one and only** model for every LLM call in the dashboard and the scraper server.

## In scope

1. Replace the Hermes spawn with an in-process Writer → Composer → Critic → Editor loop on the Express server (`npm start` / `:3847`).
2. Keep the HTTP and dossier UI contracts (`POST /api/applications/:slug/request`, poll, branded HTML/PDF).
3. Store packages under `~/.jobbored/applications/<slug>/`. Copy leftover Hermes packages on first boot.
4. One active LLM pin, chosen at setup, used everywhere listed under "One model."
5. Family alias `gemini-flash` (and equivalents) so the pin follows the current stable Flash instead of rotting as `gemini-3.5-flash`.
6. JD gate: if the cached description is a fit blurb or under ~80 words, scrape `jobUrl` before drafting. EAB is the fixture.

## Out of scope

- Reinstalling Hermes, Telegram, or the Python watcher.
- Mail-merge / slot-fill of old bullets with no rewrite.
- Discovery worker search/matcher models (`integrations/browser-use-discovery`). That process has its own wizard and env. Merging it would force Ollama users to search with Gemma, or Gemini-search users to draft with whatever they picked for letters. Leave it.
- Changing Pipeline columns or the discovery webhook contract.
- Shipping the writer on `openai/gpt-oss-120b:free`.

## One model

**Rule:** there is a single active `(provider, model)` pair. Setup writes it. Settings can change it. Every LLM call in the dashboard and scraper server uses that pair. No per-feature override, no `ATS_GEMINI_MODEL` fork, no Writer-on-Flash / Editor-on-Pro split.

**Calls that must use it**

- First-run / Settings "the" model (source of truth)
- Tailor resume and Draft cover letter (browser BYOK)
- Standalone Writer and Editor (server)
- ATS scorecard (server)
- Profile-from-resume extract (server)
- Profile rescore worker (server)
- Job posting insights / Gemini URL-context (browser)

**Not this pin**

- Discovery worker grounded search / Browser Use (out of scope, above)
- Demo/scribe fixtures (`demo-scorecard-v1`)

**How it is stored**

- Browser: existing localStorage overrides (`resumeProvider` + the selected provider's key and model fields). Only the selected provider is live.
- Server: `~/.jobbored/llm.json` (mode `0600`). Written whenever first-run completes or Settings saves. Shape:

```json
{
  "provider": "gemini",
  "model": "gemini-flash",
  "apiKey": "<redact in logs>",
  "baseUrl": "",
  "updatedAt": "2026-08-31T18:00:00Z"
}
```

- `POST /api/llm-config` from the dashboard on save. `GET /api/llm-config` returns the pin with the key redacted (`keyPresent: true`).
- Server LLM calls read `llm.json`. If the file is missing, fail loud: no silent fallback to `ATS_GEMINI_MODEL=gemini-2.5-flash`.
- Existing `ATS_*` / `PROFILE_*` env vars become migrate-from only: if `llm.json` is absent and env is present, copy env into `llm.json` once and log that it happened.

**Family aliases**

Settings first option for Gemini is `gemini-flash` ("Gemini Flash (latest)"). At call time, list models and pick the newest stable Flash that is not lite, not preview, not image, not live. Fallback if the list call fails: `gemini-3.7-flash` (current as of 2026-08-31).

Same idea for other providers if we add aliases later (`claude-sonnet`, `gpt-5.6-terra`). v1 only requires `gemini-flash` because that is the recommended setup default.

Exact snapshot IDs still work. If the user locks `gemini-3.7-flash`, that exact ID is used everywhere until they change it.

Webhook provider: the pin is the webhook URL. Writer and ATS POST to that URL the same way the browser BYOK path already does. Local provider: `baseUrl` + model id in `llm.json` (Ollama etc.).

**Setup default**

- Recommended provider: Gemini. Recommended model: `gemini-flash`.
- OpenRouter remains available. If the chosen model id ends in `:free` or is in a small weak-id list (`gpt-oss-120b:free`, `gpt-oss-20b:free`), first-run shows a hard warning: "This model is too weak for tailored letters. Use Gemini Flash unless you are only testing." Continue is allowed. Do not make it the shipped default.
- No runtime cron. Live catalog fetch already fills the Settings dropdown when a key is present (6h cache). The family alias is what keeps the *call* current.

**Why not one model per surface**

That is the mess we have today. ATS on 2.5, buttons on gpt-oss, Settings on 3.5. One pin is the product.

## Architecture

```
[ Kanban: New → Researching ]
        │  POST /api/applications/:slug/request   (unchanged)
        ▼
[ Express :3847  in-process FIFO ]
   1. JD gate (scrape jobUrl if cached JD is junk)
   2. Writer LLM     — full rewrite for this JD (active pin)
   3. Composer       — Cheerio fills data-slot / data-section / data-role
   4. Critic         — materials-quality.mjs + keywords / echo / filler
   5. Editor LLM     — same pin, max 2 loops back to Composer
   6. PDF            — Playwright if present, else HTML + "pdf skipped"
        │
        ▼
[~/.jobbored/applications/<slug>/]  READY or REVIEW
        ▲
        └── dossier UI already polls this tree
```

Purple in the explainer = LLM. Navy = code. Cheerio never writes prose.

## Components

### Queue

In-process FIFO on the scraper server. `POST /api/applications/:slug/request` stays 202. Do not spawn `materials-request.sh`. Drop Telegram. `pending.json` still exists so the existing poller keeps working.

Concurrency: one draft at a time. A second request for the same slug while pending is a no-op success. A request for a different slug waits.

### Storage

- Default root: `~/.jobbored/applications/`.
- Env override: `JOBBORED_APPLICATIONS_ROOT` (tests). Read `HERMES_APPLICATIONS_ROOT` as a one-time migrate alias.
- First boot: if `~/.hermes/job-hunt/applications/` has packages and the new root is empty, copy them.

### JD gate

Treat cached `job-description.md` as unusable when any of:

- word count < 80
- matches a fit-blurb pattern (`Low fit`, `High fit`, `/10` as the body)
- missing while `jobUrl` is present

Then scrape `jobUrl` with the existing scraper. If scrape fails, stop at REVIEW with `jd_unusable`. Never draft from the EAB one-liner.

### Writer

Input: usable JD, HTML master resume (`integrations/hermes-job-hunt/resume-template/resume.html` as the content source of truth, not thin `profile.json`), voice samples from IndexedDB/profile.

Output: JSON only (schema below). Temperature capped, max tokens set, timeout set. Invalid JSON: retry once, then REVIEW.

Frozen facts: employer names, titles, dates, numeric metrics. Inventing a role is a Critic `fail`.

### Content model (Writer JSON)

Letter:

```json
{
  "date": "",
  "company": "",
  "companyAddr": "",
  "role": "",
  "hiringManager": "",
  "hook": "",
  "whyThem": "",
  "whyMe": "",
  "whyNow": "",
  "closing": "",
  "flourish": ""
}
```

Resume:

```json
{
  "summary": { "opener": "", "body": "" },
  "roles": [{ "id": "audacy-dsm", "bullets": [""] }],
  "capabilitiesOrder": ["..."],
  "stackEmphasis": ["..."]
}
```

`roles[].id` must be an existing `data-role` on the master resume. No new employers. No new sections.

### Composer

Cheerio loads the branded templates. Writes text into `data-slot` / `data-section` / `data-role` nodes. Never edits `<style>`, never adds sections, never invents `data-role` values. If a JSON field is empty, leave the slot empty and let Critic fail it.

### Critic

Keep `server/materials-quality.mjs` budgets:

- Cover letter: 325–475 words, 1 page.
- Resume: ≤ 2 pages; if 2 pages, ≥ 750 words total and page 2 ≥ 240 words.

Add:

- Keyword coverage vs JD (review if below threshold).
- JD-echo (too many posting n-grams copied verbatim).
- Banned filler list.
- Sentence-length variance too low (review).
- Frozen-fact check (fail).
- Model-emitted CSS/HTML in a slot (fail).

Statuses: `pass` → READY; `review`/`fail` with tries left → Editor; after 2 Editor loops still dirty → dossier REVIEW with the scorecard. Never mark READY on a fail.

### Editor

Same active pin as Writer. Prompt includes the numeric scorecard and the current JSON. Output is JSON again, then Composer. Max 2 loops.

### PDF

Playwright if present. If not, HTML is enough for READY and quality notes `pdf_skipped`. Missing PDF is not a fail.

## Errors (user-visible)

| Condition | UI |
|---|---|
| No `llm.json` / no key | Dossier error. Toast does **not** say generating. |
| JD unusable after scrape | REVIEW, `jd_unusable`. |
| Writer JSON invalid twice | REVIEW. |
| Playwright missing | HTML READY, `pdf_skipped`. |
| Two critic loops fail | REVIEW with scorecard. |

The toast only fires after the server has accepted the job onto the FIFO with a usable pin.

## Testing

- Family resolver: fixture list of 3.5 / 3.6 / 3.7 / 3.7-preview / 3.5-flash-lite / image → picks `gemini-3.7-flash`.
- One-pin: Settings save writes `llm.json`; ATS and Writer read that file; a leftover `ATS_GEMINI_MODEL=gemini-2.5-flash` is ignored once `llm.json` exists.
- JD gate: EAB one-liner rejected; scrape required.
- Composer: JSON lands in slots; CSS untouched; frozen facts remain.
- Critic: 200-word letter fails; 400-word letter with keywords passes; 3-page resume fails.
- Editor: first fail rewrites; third fail → REVIEW.
- HTTP: `POST /request` 202 without a `hermes` binary; poll still works.
- Weak-model warning: selecting `openai/gpt-oss-120b:free` in first-run surfaces the warning string.

No live provider calls in CI. Inject `fetchImpl` / fixtures.

## Files (implementation map)

New:

- `server/materials-drafter.mjs` — FIFO + loop
- `server/materials-writer.mjs` — LLM JSON
- `server/materials-composer.mjs` — Cheerio
- `server/model-family.mjs` — `gemini-flash` resolver (Node)
- `server/llm-config.mjs` — `~/.jobbored/llm.json` read/write
- `docs/superpowers/specs/2026-08-31-standalone-materials-drafter-design.md` — this file

Change:

- `server/materials-request.mjs` — stop spawning Hermes; enqueue drafter
- `server/application-materials.mjs` — default root `~/.jobbored/applications`
- `server/ats-scorecard.mjs`, `server/profile-from-resume.mjs`, `server/profile-rescore-worker.mjs` — read `llm.json`
- `first-run-wizard.js`, `settings-modal.js` — POST pin; Gemini default `gemini-flash`; weak-model warning
- `resume-generate.js` / `discovery-drawer.js` / `job-posting-insights.js` — resolve through the active pin, not a second default
- `config.example.js` — recommended Gemini Flash family, not OpenRouter free
- `model-catalog.js` STATIC_FALLBACK — bump listed IDs; put `gemini-flash` first

Do not edit `fix/enrichment-offline-hard-gate` or other in-flight branches.

## Success

1. Drag EAB to Researching with `npm start` running and a Gemini key in Settings. A real posting is scraped. Letter 325–475 words. Resume ≤ 2 pages. Dossier shows READY or REVIEW, never a silent pending forever.
2. ATS scorecard and the letter were produced by the same resolved model id, visible in logs and the scorecard `model` field.
3. `which hermes` can fail. The path still works.
4. Changing the model in Settings changes the next ATS call and the next draft. No leftover 2.5-flash.

## Open questions (resolved)

- Writer vs mail-merge → Writer/Composer/Critic/Editor. Cheerio typesets only.
- Writer model → the setup pin. Recommended default Gemini Flash family. Not gpt-oss-120b:free.
- Cron for dropdowns → no. Live fetch already exists. Family alias keeps the call current.
- One model vs many → one model across dashboard + scraper server. Discovery worker excluded.
