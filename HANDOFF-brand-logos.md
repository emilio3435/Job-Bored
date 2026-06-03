# Handoff — Profile-driven brand logos (Codex)

**Goal:** make resume logo marks work for *any* user instead of being hardcoded to
Emilio's four (Audacy/Elio/Hormiga/JobBored). The engine is built and tested; this
handoff covers the **backend + dashboard UI** wiring that remains.

**Owner split:** the Python engine (this session) is done. Codex picks up the
Express endpoints, the drafter/setup wiring, the profile-schema fields, and the
classic-JS dashboard panel.

---

## Background: how logos render today

- The resume template references marks by filename:
  `<img class="project-mark" src="assets/logo-<slug>.png">` in
  `integrations/hermes-job-hunt/resume-template/resume.html`.
- The drafter (Hermes/Winky) copies `resume-template/assets/` into each
  `~/.hermes/job-hunt/applications/<slug>/assets/` and preserves the `<img>` marks
  (see `profile/materials-quality.md` §"Visual Assets"). **No drafter change is
  needed** — we only need to guarantee `assets/logo-<slug>.png` always exists.
- Live templates live at `~/.hermes/job-hunt/resume-template/`; the repo copy is
  `integrations/hermes-job-hunt/resume-template/`.

## ✅ Already built (this session) — do not redo

| File | What it does |
|---|---|
| `integrations/hermes-job-hunt/scripts/logo_resolver.py` | Engine. For each manifest entry, resolves `assets/logo-<slug>.png`: **upload → favicon → omit**. Non-destructive by default (skips existing); `--force` re-resolves and deletes stale marks; `--offline` skips network. Stdlib-only (no Pillow). CLI + importable (`resolve_all`, `resolve_entry`). |
| `integrations/hermes-job-hunt/resume-template/logos.json` | Manifest (schema-by-example). Each entry: `{slug, label, domain?, upload?}`. |
| `integrations/hermes-job-hunt/resume-template/uploads/` | Curated own-brand marks used as `upload` sources. |
| `integrations/hermes-job-hunt/resume-template/resume.html` | Logo `<img>` marks carry `onerror="this.remove()"` so an unresolved mark is dropped, not shown broken. |
| `integrations/hermes-job-hunt/tests/test_logo_resolver.py` | 10 tests, offline-safe, all passing. |

**Resolution priority (per slug):**
1. `upload` — a file under `uploads/` (highest fidelity, always wins)
2. `favicon` — auto-fetched from `domain` **or from the `label` (company name) alone**: Clearbit autocomplete resolves name→domain, then Google s2 fetches the icon (validated as a real image). Note: Clearbit's own logo API (`logo.clearbit.com`) is sunset/DNS-dead — do **not** reintroduce it; use autocomplete-for-domain + Google s2.
3. **omitted** — no file written (and stale file removed on `--force`); the template's `<img onerror="this.remove()">` drops the mark, so a missing logo never renders a broken-image icon.

**This answers "must users upload?": no.** A bare company name auto-resolves. Upload is only the fallback for private brands with no findable logo (e.g. own side-projects).

**Run it:**
```bash
cd integrations/hermes-job-hunt
python3 scripts/logo_resolver.py --template-dir resume-template          # fill gaps
python3 scripts/logo_resolver.py --template-dir resume-template --force  # re-resolve all
# tests:
python3 -m pytest tests/test_logo_resolver.py -q
```
Verified end-to-end: `audacy.com` → real Audacy favicon; own brands → uploads;
an entry with no asset/domain → omitted (mark dropped, no broken image).

---

## TODO — backend (Express, `server/`)

Follow the existing **spawn-a-python-helper** pattern in
`server/materials-request.mjs` (it shells out to `materials_request.py` and writes
under `~/.hermes/job-hunt/...`). Mirror its path-resolution + child-process handling.

### 1. `server/brand-logos.mjs` (new bridge)
Resolve the **templates root** the same way `materials-request.mjs` resolves the
integration dir (env override first, then the repo/`~/.hermes` default). Target dir:
`<hermes>/job-hunt/resume-template/`.

Functions:
- `runResolver({ force })` → spawn
  `python3 integrations/hermes-job-hunt/scripts/logo_resolver.py --template-dir <templatesRoot> [--force]`,
  capture stdout report, return parsed `{slug, source, detail}[]`.
- `saveUpload(slug, buffer)` → validate slug (`^[a-z0-9-]+$`) + that buffer is a real
  image (reuse `logo_resolver.looks_like_image` logic / sniff magic bytes server-side),
  write `<templatesRoot>/uploads/logo-<slug>.png`, then `runResolver({force:true})`.
- `listLogos()` → read `logos.json` + `assets/` and report current mark + source per slug.

### 2. Routes in `server/index.mjs`
Register alongside the other `/api/...` routes:
- `GET  /api/brand-logos` → `listLogos()`
- `POST /api/brand-logos/resolve` → `runResolver({force})` (body `{force?:boolean}`)
- `POST /api/brand-logos/:slug` → multipart file upload → `saveUpload()`. Cap size
  (~2 MB, matches `express.json` limit), accept png/jpg/svg/webp. Use a small
  multipart parser; the repo doesn't appear to bundle `multer` — check
  `server/package.json` before adding a dep, prefer something already present.
- Apply the same auth/CORS guard the other routes use (see `security-boundaries.mjs`).

### 3. Profile schema → manifest generation
- Structured profile lives at `~/.jobbored/profile.json`, validated by
  `integrations/browser-use-discovery/src/contracts/user-profile.schema.json`
  (persisted via `server/user-profile.mjs`, routes `GET/POST /profile`).
- Add optional per-experience/per-project fields: `slug` (kebab), `logoDomain`,
  `logoUpload` (bool/filename). Keep them optional so existing profiles validate.
  The company **name is already in the profile** and auto-resolves on its own, so
  `logoDomain`/`logoUpload` are pure *overrides* — not required for a logo to appear.
- On `POST /profile`, (re)generate `<templatesRoot>/logos.json` from the profile's
  experiences + projects (slug + label, plus domain/upload when set), then call
  `runResolver({force:false})` so new users get favicons (or cleanly-dropped marks) automatically. **Keep favicon fetching off the
  per-draft hot path** — do it at profile-save time, not inside
  `POST /api/applications/:slug/request`.

---

## TODO — dashboard UI (classic-global JS, **not** React)

The dashboard is `window.JobBoredApp.*` IIFE modules (see `materials-feature.js`,
`settings-profile-tab.js`), not React. Add a **"Brand Logos"** section, most likely
inside the profile settings tab (`settings-profile-tab.js`) or a new settings tab
(`settings-tab-schema.js` + `settings-tabs.js`).

Per experience/project row:
- thumbnail of the current mark (`GET /api/brand-logos`),
- a `domain` text field (live favicon preview — reuse
  `company-logo.js#resolveCompanyLogoUrl`, which already does Clearbit/Google-favicon),
- an "Upload logo" button → `POST /api/brand-logos/:slug` (multipart),
- a "Re-resolve" button → `POST /api/brand-logos/resolve`.

Empty state must make clear that doing nothing is fine — they'll get a favicon (if a
domain is set), otherwise the mark is simply dropped — never a broken image.

---

## Definition of done
- A new user with zero uploaded logos gets a clean resume (favicons where a domain
  exists, marks **omitted** otherwise) — **no broken `<img>` ever**. The UI must
  keep the `onerror="this.remove()"` attribute on logo marks it renders/edits.
- Uploading a logo for a slug replaces its mark on the next draft.
- `python3 -m pytest integrations/hermes-job-hunt/tests/test_logo_resolver.py` stays green;
  add endpoint tests for upload validation (happy + rejects non-image) and
  manifest-from-profile generation.
- `npx tsc --noEmit` / lint / server tests pass per the repo's pre-push checklist.

## Notes / gotchas
- **OSS hygiene:** `assets/logo-audacy.png` is a third-party mark currently committed
  for the reference render. Prefer favicon-resolving employer marks (don't commit
  them); keep only own-brand marks in `uploads/`. Decide before the repo goes public.
- Resolver is **non-destructive** — curated `assets/` are never clobbered unless
  `--force`. The server upload path uses `--force` intentionally (a fresh upload should win).
- `~/.hermes/job-hunt/` is Emilio's live instance and he manages it; gate any
  write-to-`~/.hermes` behavior behind the same template-root resolver as
  `materials-request.mjs` rather than hardcoding paths.
