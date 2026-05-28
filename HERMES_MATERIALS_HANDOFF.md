# Hermes Materials Bridge — Agent Handoff

**Branch:** `feat/flowing-page`
**Last touched:** 2026-05-27
**Scope:** Replace the in-browser "Workshop" letter/resume flow with a Hermes-driven request loop. Dossier CTAs now POST to a local endpoint that spawns the Hermes wrapper, writes `pending.json`, and pings Telegram. The materials panel surfaces a pending UI and polls until Hermes clears the flag.

---

## State on handoff

- All 47 new tests pass, all 697 root tests pass, `npm run typecheck:repo` is green.
- Live end-to-end verified against the running scraper on `127.0.0.1:3847`.
- Nothing pushed; all changes are on the working tree of `feat/flowing-page`. `git status` includes only the new/modified files listed below plus pre-existing untracked items (`integrations/browser-use-discovery/package-lock.json`, `tmp/`).

---

## What ships

### Materials panel (Phase 1, done in earlier session)
- `server/application-materials.mjs` — manifest discovery from `~/.hermes/job-hunt/applications/<slug>/`, allowlist (resume/cover-letter PDF+HTML, QA report, job analysis/description, manual-apply checklist, manifest.json), realpath-based path-traversal protection.
- `server/index.mjs` endpoints:
  - `GET /api/applications`
  - `GET /api/applications/:slug/manifest`
  - `GET /api/applications/:slug/files/:filename`
  - **NEW** `POST /api/applications/:slug/request`
- `role-materials.js` renders the panel in the dossier brief with slug matching (company token + title-word overlap, drops noise like "Inc.", "Media").

### Workshop removed (Phase 3)
- `index.html` no longer renders `<section data-region="letter">`; letter.js/role-workshop.js script tags commented out.
- `jb-v2-legacy-hide.css` adds belt-and-suspenders hide rule.
- `role.js` empty-state copy no longer mentions "PART 04 · THE LETTER".

### Hermes request loop (Phase 3, just finished)
- **`integrations/hermes-job-hunt/scripts/materials_request.py`** — argparse CLI accepting `--slug --company --title --feature {resume|cover_letter|both} --job-url --notes --applications-root --no-telegram`. Validates inputs, writes/merges `pending.json` (with rolling 10-item history), posts to Telegram thread 48 via `gate2_telegram._api_call`. Exit codes: 0 ok, 1 validation error, 2 Telegram failed (pending.json still written).
- **`integrations/hermes-job-hunt/scripts/materials-request.sh`** — wrapper that picks `$HERMES_PYTHON` → `~/.hermes/job-hunt/.venv/bin/python3` → `python3`. Pure passthrough.
- **`server/materials-request.mjs`** — `normalizeRequestBody` (slug regex `/^[a-z0-9][a-z0-9-]{0,127}$/`, feature allowlist, company/title required, notes capped at 4000 chars) and `spawnMaterialsRequest` (argv-only, no shell interpolation, 30s timeout, exit-code mapping → 400/502/504). Bin path overridable via `HERMES_MATERIALS_REQUEST_BIN` (used by tests).
- **`POST /api/applications/:slug/request`** — forces body.slug to match URL slug before validation.
- **`buildManifest`** now attaches a `pending` block (`feature`, `requestedAt`, `telegramMessageId`, `notes`, `source`) when `pending.json` exists. Malformed JSON is tolerated (treated as no pending state).
- **`role-materials.js`**:
  - Intercepts `jb:role:action` events (`resume-cover` → cover_letter, `resume-tailor` → resume) and POSTs to the request endpoint.
  - Captures notes via `window.prompt` (no modal framework wired).
  - Renders pending pill on affected cards, an amber pulse banner above the grid, and placeholder cards for missing resume/cover-letter when pending.
  - Polls the manifest endpoint every 3–12s (max 10 min) until `pending` clears; backs off on transient errors.
  - Pending state clears as soon as the Hermes side deletes `pending.json`.
- **`role.js`** click delegate no longer calls `openDraftNotesModal` — it only dispatches the `jb:role:action` event (which `role-materials.js` listens for).
- **`role.css`** adds `.brief-materials__card--pending`, `.brief-materials__pending-banner`, `.brief-materials__pulse` + `brief-materials-pulse-centered` keyframes.

---

## Files added

```
server/materials-request.mjs
role-materials.js                                                (Phase 1, extended)
integrations/hermes-job-hunt/scripts/materials_request.py
integrations/hermes-job-hunt/scripts/materials-request.sh
tests/application-materials.test.mjs                             (Phase 1, extended)
tests/role-materials.test.mjs                                    (Phase 1)
tests/materials-request-endpoint.test.mjs
```

## Files modified

```
server/index.mjs                  (imports + POST endpoint)
server/application-materials.mjs  (pending.json surfacing)
index.html                        (workshop region removed)
role.css                          (Application Materials + pending styles)
role.js                           (empty-state copy + CTA delegate)
jb-v2-legacy-hide.css             (force-hide letter region)
package.json                      (typecheck:repo includes new files)
```

---

## Key contracts and decisions

- **Hermes script CLI is the canonical entry.** The server only spawns the wrapper. Hermes can swap implementation freely as long as the CLI flags and exit codes hold.
- **`pending.json` is the UI signal.** Hermes writes it; Hermes deletes it after drafts ship. JobBored never deletes `pending.json`. The UI clears the pending banner only when the manifest endpoint stops returning a `pending` block.
- **Telegram thread 48 is shared with `gate2-status-watcher`.** Reuses the same bot token loader and `_api_call` helper, so token rotation only needs to happen in one place.
- **Slug constraint:** `/^[a-z0-9][a-z0-9-]{0,127}$/`. Enforced in both the Python script and `normalizeRequestBody`. Any path traversal attempt is rejected before spawn.
- **No shell interpolation.** `spawnMaterialsRequest` uses `child_process.spawn(bin, args)`; quotes, semicolons, `$(...)` etc. in notes/company/title are forwarded as plain argv. Verified by `tests/materials-request-endpoint.test.mjs:"forwards exact args to the script as argv"`.
- **Legacy letter.js and role-workshop.js stay on disk.** They're no longer loaded by `index.html`, but the files remain so the older root tests that import them still pass. Don't delete them without checking `tests/role-workshop.test.*`.
- **`openDraftNotesModal` still exists in `app.js`.** It's wired by `app.js`'s `forEach` only to legacy *drawer* buttons that exist at script-load time (lines 13300–13312). The dossier brief CTAs (rendered dynamically by `role-brief.js`) are not caught by that wiring — confirmed by grep. Don't try to "clean up" that path during this work unless asked.

---

## How to verify locally

```bash
cd /Users/emilionunezgarcia/Job-Bored

# Targeted tests
node --test \
  tests/application-materials.test.mjs \
  tests/role-materials.test.mjs \
  tests/materials-request-endpoint.test.mjs

# Full root suite
npm test

# Typecheck
npm run typecheck:repo

# Live end-to-end (replace slug with a real one from ~/.hermes/job-hunt/applications/)
npm run start:scraper   # in another shell
curl -sS -X POST http://127.0.0.1:3847/api/applications/<slug>/request \
  -H "Content-Type: application/json" \
  -d '{"slug":"<slug>","company":"X","title":"Y","feature":"cover_letter","notes":"smoke"}'
ls ~/.hermes/job-hunt/applications/<slug>/pending.json
```

Set `HERMES_MATERIALS_REQUEST_BIN=/path/to/a/stub.sh` to override the wrapper for local testing without spamming Telegram.

---

## Open items / known gaps

1. **No toast/UI surface for request errors.** A failed POST currently re-renders the Application Materials section as an inline error banner. If the broader dashboard grows a toast system, route failures through it.
2. **Notes capture uses `window.prompt`.** Functional but cramped. If a modal framework lands, wire it through `handleDraftRequest` and pass notes the same way (it's already a single string).
3. **`prompt()` is unavailable in some browser contexts (e.g., embedded webviews).** Code degrades by sending an empty notes string. Acceptable for now; revisit if it becomes a complaint.
4. **History stored in `pending.json`** is capped at 10 entries. Not surfaced in the UI yet; if you want to show "previously requested" badges, the data is there.
5. **Telegram message id surfacing.** When the wrapper succeeds with a `telegram_message_id`, it lands in `pending.json` and the manifest payload as `pending.telegramMessageId`. Not yet rendered. Easy add if needed.
6. **The `lint:repo` script only runs `lint:skills`.** No JS/CSS lint coverage on the new files. If the repo adds eslint later, double-check `role-materials.js` doesn't trip rules.
7. **The Python script's `gate2_telegram` import requires Python ≥ 3.10** (union syntax). The wrapper picks `~/.hermes/job-hunt/.venv/bin/python3` (3.12). Don't run the script with system `/usr/bin/python3` (3.9 on this Mac).
8. **No CONTRIBUTING/AGENT_CONTRACT updates yet** for the new endpoint. If you're touching the contract suite, add `POST /api/applications/:slug/request` semantics there.

---

## Suggested next steps (if continuing)

- Wire a real notes modal (replace `prompt`) once the rest of the dossier UI grows one.
- Add a `manifest.pending.telegramMessageId` deep link to the Telegram thread for one-click jump-to-conversation.
- Teach Hermes to write a `materials_status.json` after the draft ships so the UI can show "Cover letter drafted 2 min ago" instead of just "Ready".
- Add a server-side rate limiter (e.g., max 1 request per slug per 60s) — easy guard against double-clicks now that requests have side effects.
- Replace the polling loop with SSE on `/api/applications/:slug/events` if you want sub-second feedback.

---

## Contact / open questions

If the wrapper invocation fails in a way that's not yet covered (e.g., venv missing entirely), `materials-request.sh` falls back to `python3` on `PATH`. There's no explicit guidance to the user beyond the inline error banner. Decide whether the doctor (`scripts/doctor.mjs`) should grow a "Hermes venv detected" check.
