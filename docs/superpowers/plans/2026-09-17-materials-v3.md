# Implementation plan — Materials v3 (Volt template registry + staged mechanism)

> Specs: [visual system](../specs/2026-09-17-materials-v3-volt-design.md) · [operating mechanism](../specs/2026-09-17-materials-v3-mechanism-design.md)
> Fixtures: [`docs/materials-v3/mocks/3e-ai-marketing-analytics-manager/`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/)
> Dogfood role: AI & Marketing Analytics Manager @ 3E

**Goal:** replace the materials generation path end to end — the visual language, the fact store, the pipeline, and the QA contract — without breaking the dossier UI or the existing published packages.

**Amended 2026-09-25:** the single Volt look becomes a template registry ([visual spec §9](../specs/2026-09-17-materials-v3-volt-design.md#9-template-registry)). There are three families, `signal` (the default), `dossier` and `editorial`, and a user can choose one as an optional setting. Slice 3 builds the registry, the new slice 3b builds the setting and regeneration, and slice 7 folds the browser's preview themes into the registry. The other slices are unchanged.

**Non-goals:** Discovery wizard, CDLE, kanban CSS, Pipeline sheet contract, a second LLM pin, migrating old artifacts.

**Sequencing principle:** the ledger and the budgets module land before anything that reads them; the templates and the fit solver land before the staged pipeline, so there is somewhere correct to render into; the old three-page template stops being a compose target only in the final slice.

---

## Slice 0 — contract and fixtures (this PR)

- Visual spec (Volt design language plus the template registry), mechanism spec, this plan, and the [side-by-side](../../materials-v3/side-by-side.md)
- Registry reference fixtures, one per family: `mocks/3e-ai-marketing-analytics-manager/{signal,dossier,editorial}/` with `resume.html`, `resume.pdf`, `cover-letter.html`, `cover-letter.pdf` and `DESIGN.md`, taken from the 2026-09-25 bake-off (takes C, A and B, polished r2), with logos in `mocks/assets/logos/`
- The Volt 1.0 mocks kept as history under `volt-v1/`: both documents, both PDFs, both `.txt` twins and `volt.css`
- Mechanism fixtures: `jd-extract.json`, `claim-ledger.json`, `selection.json`, `render-model.json`, `qa.json`, `qa-report.md`, `run.json`
- Two demonstration stubs with tests: `server/materials-fit-budget.mjs` (budget table + deterministic estimator and trim ladder) and `server/materials-delint.mjs` + `server/materials-voice.json` (banned-span detector)

No production path changes. Acceptance: reviewers open each family's two mocks and print-preview one page each; `tests/materials-v3-mocks.test.mjs` passes the registry checks for all three families; and the budget table and the delint corpus read as executable rather than aspirational.

---

## Slice 1 — the claim ledger

**Why first:** every later slice reads it, and it is what removes "paste the master résumé into the model."

| File | Change |
| --- | --- |
| `schemas/materials-claim-ledger.v1.schema.json` | new (added in slice 0) |
| `server/materials-ledger.mjs` | new: read, validate, hash, query by employer/outcome/tool |
| `server/materials-ledger-build.mjs` | new: build ledger entries from `readProfile()` + résumé/LinkedIn ingest text |
| `server/profile-from-resume.mjs` | emit ledger claims alongside the existing profile fields |
| `server/user-profile.mjs` | persist `claim-ledger.json` under the profile root; hash on write |
| `server/application-materials.mjs` | allowlist the new artifacts as support documents |
| `tests/materials-ledger.test.mjs` | new: build from a fixture résumé, assert claim IDs, metric tokens, tool ownership levels |

Acceptance: the 3E fixture ledger round-trips through `materials-ledger.mjs`, and `toolInventory` reports Power BI as `level: none` with `transferFrom`.

Risk: ingest quality. Mitigation — the ledger builder is allowed to mark claims `verified: false`, and selection will not feature an unverified claim.

---

## Slice 2 — one budget table

**Why here:** the numbers must be single-sourced before QA, prompts, and the solver all start reading them.

| File | Change |
| --- | --- |
| `server/materials-fit-budget.mjs` | promote the slice-0 stub to the canonical budget source |
| `server/materials-quality.mjs` | read budgets from the module; letter band 180–260; drop the 325 floor; stop requiring a capabilities/skills section; require a statement |
| `server/materials-repair.mjs` | `cover_letter_too_short` expands toward 180, never 325; collapse becomes the default strategy |
| `prompts/resume-tailorer-system-prompt.md` | same numbers, statement requirement, no "325–450 words" |
| `tests/resume-generate-quality-contract.test.mjs` | update the pin (it currently asserts 325–450 and one-or-two pages) |
| `tests/materials-quality.test.mjs`, `tests/materials-repair.test.mjs` | update expectations |
| `scripts/test-contract.mjs` or a new `scripts/test-materials-contract.mjs` | assert the budget table is identical in the module, the prompt, and the QA thresholds |

Acceptance: a 200-word letter passes; a 340-word letter fails as padded; a package with no capabilities section is not flagged; the contract test fails if any copy of a number drifts.

---

## Slice 3 — template registry, render model, renderer, ATS twin

| File | Change |
| --- | --- |
| `templates/materials/signal/{resume.html, cover-letter.html, signal.css, family.json}` | new: the default family, promoted from the `signal/` reference fixture as slot-only templates with no facts |
| `templates/materials/dossier/{resume.html, cover-letter.html, dossier.css, family.json}` | new: from the `dossier/` fixture |
| `templates/materials/editorial/{resume.html, cover-letter.html, editorial.css, family.json}` | new: from the `editorial/` fixture |
| `templates/materials/family.schema.json` | new: shape of `family.json` (id, label, version, documents, fonts, accents, densities, logo optical sizes per `shape`, fit metrics, soft-budget overrides, trim-ladder tail, optional render-model fields read, signature moves) |
| `server/materials-templates.mjs` | new: the registry — `listFamilies()`, `resolveFamily(id)` (throws `unknown_template` with the valid ids), `validateFamily(json)`, `DEFAULT_FAMILY = "signal"`; loads `templates/materials/*/family.json` once and validates each against the schema and against the hard limits in `MATERIALS_BUDGETS` |
| `vendor/fonts/` + `vendor/fonts/fonts.css` | vendor Archivo (width axis), Martian Mono and Bodoni Moda (opsz + italic) as self-hosted woff2, so no family touches Google Fonts at render time |
| `server/materials-render.mjs` | new: render model + family → HTML (replaces Cheerio slot surgery for the v3 path); emits `article.page[data-page]`, `h2.company-name`, `data-claim`, `data-section`; header first in DOM and paint order |
| `server/materials-ats-text.mjs` | new: render model → `.txt`, never scraped from HTML, identical for every family |
| `server/materials-fit.mjs` | new: estimator + shared trim ladder over `materials-fit-budget.mjs`, reading each family's metrics and ladder tail from `family.json` (`VOLT_RESUME_METRICS` becomes the Volt 1.0 entry in history only) |
| `server/materials-pdf.mjs` | measure fit on the laid-out page (sheet `scrollHeight` vs `clientHeight`, last text box inside the padding) and capture the PDF page count; stop letting a skipped PDF demote a page-count fail |
| `server/materials-drafter.mjs` | `DEFAULT_*_TEMPLATE` resolve through the registry; keep the old path behind a flag for one release |
| `server/brand-logos.mjs` | expose resolved marks with a `shape` class (`mark`, `wordmark`, `lockup`) so render-model `logo` fields carry it |
| `tests/materials-templates.test.mjs` | new: every `family.json` validates; `resolveFamily` rejects unknown ids; default is `signal`; enums in both schemas equal the registry list; soft-budget overrides stay inside the hard limits |
| `tests/materials-render.test.mjs`, `tests/materials-ats-text.test.mjs`, `tests/materials-fit.test.mjs` | new; the render test runs once per family |
| `tests/e2e-visual/materials-templates.spec.mjs` | new, per family and document: layout-measured fit, PDF page count 1, PDF text starts with the name, no request leaves the machine during render, shared forbidden-token scan, and the `ink` accent renders |

Acceptance: rendering the fixture `render-model.json` in each family matches that family's reference fixture structurally; both documents fit one page in every family by layout measurement; the `.txt` twins are byte-identical across families; the no-Google-Fonts test in `tests/materials-v3-mocks.test.mjs` drops its TODO for signal and editorial because the templates no longer need the network.

Note: `tests/materials-composer.test.mjs` asserts the old Cheerio behavior. Keep it green while the legacy flag exists; delete it with the flag in slice 8.

---

## Slice 3b — template setting, per-request family, regenerate in another template

**Why here:** the registry exists after slice 3, and the pipeline in slice 4 must know which family a run renders in. The setting is small and user-facing, so it lands before the pipeline grows.

| File | Change |
| --- | --- |
| `user-content-store.js` | `DEFAULT_PREFERENCES.materialsTemplate: "signal"` next to `visualThemeId`; normalize an unknown stored id back to the default on read, like `profileMergePreference` |
| `partials/profile-materials-modal.html` | a "Template" select beside the existing template selects, with one option per registry family (label + one-line description), default `signal` |
| `profile-materials.js`, `materials-feature.js` | fill the select from the registry list and save it with the other materials preferences |
| `server/materials-templates.mjs` + the materials router | `GET` the family list (id, label, description, version, default) for the select; the browser falls back to the bundled list offline |
| `server/materials-request.mjs` | payload gains an optional `template` (family id); validated with `resolveFamily()`; unknown → 400 `unknown_template` listing the valid ids; missing → preference, then default |
| `server/materials-drafter.mjs` / `server/materials-run-ledger.mjs` | write the `template` block into `run.json` (`family`, `version`, `templateIds`, `source`) and `manifest.json`; the cache key's template segment is `<family>@<version>` |
| `server/materials-regenerate.mjs` | new: re-render a published package in another family from its stored `render-model.json` — `fit` → `render` → `qa` only, zero LLM calls, new package with `source: "regenerate"` and `regeneratedFrom`, original untouched |
| `role-materials.js` | a "Regenerate in…" menu on a published package listing the other families; reads the package's recorded family to mark the current one |
| `tests/materials-request-no-hermes.test.mjs`, `tests/materials-request-endpoint.test.mjs` | extend: `template` passes through; an unknown id is a 400 with the list; omitted means the default |
| `tests/materials-regenerate.test.mjs` | new: regenerating the 3E fixture in `editorial` makes no LLM call, records `regeneratedFrom`, and leaves the original package byte-identical |
| `tests/materials-template-preference.test.mjs` | new: the default is `signal`; an unknown stored id normalizes to the default |

Acceptance: choosing `dossier` in the modal and requesting materials produces a package whose `run.json` says `family: "dossier"`, `source: "preference"`; the same request with `template: "editorial"` says `source: "request"`; "Regenerate in → signal" publishes a second package with `source: "regenerate"` and no LLM call; an unknown `template` is a 400.

---

## Slice 4 — staged pipeline

| File | Change |
| --- | --- |
| `server/materials-jd-gate.mjs` | confidence scoring, structural signals, `jd_thin` vs `jd_unusable` |
| `server/materials-jd-extract.mjs` | new: deterministic pass + narrow LLM fill, schema-validated |
| `server/materials-claim-score.mjs` | new: deterministic shortlist |
| `server/materials-select.mjs` | new: LLM returns IDs + reasons; post-call hard rules |
| `server/materials-outline.mjs` | new: deterministic from selection + budgets |
| `server/materials-writer.mjs` | three narrow prompts; structured-output request per provider; caps 1k/1k/2.5k |
| `server/materials-drafter.mjs` | become the stage runner: staging dir, `run.json` append, atomic publish, repair ladder |
| `server/materials-run-ledger.mjs` | new: append-only stage ledger, writes `pending.json` shim |
| `tests/materials-jd-gate.test.mjs` | extend with aggregator-stub, cookie-wall, and search-results fixtures |
| `tests/materials-extract.test.mjs`, `tests/materials-select.test.mjs`, `tests/materials-pipeline.test.mjs` | new; the pipeline test replays the 3E fixtures through a stub executor |

Acceptance: the stubbed pipeline produces one-page HTML for both documents, a letter in band, `qa.json` with `constraint_conflict` as the only review finding, and rubric ≥ 10. A crash mid-run leaves the previously published package intact.

---

## Slice 5 — voice pack, delint, metric tagger

| File | Change |
| --- | --- |
| `server/materials-voice.json` | promoted from the slice-0 stub; user-overridable copy at `~/.jobbored/profile/voice.md` |
| `server/materials-delint.mjs` | add the conditional LLM rewrite (JD withheld), keep the deterministic prepass as the gate |
| `server/materials-metric-tag.mjs` | new: numeric tokens → `n` runs matched to ledger metrics; report untraced numerals |
| `server/materials-critic.mjs` | retire the five-phrase regex and the "3 tokens ≥ 5 chars" keyword gate; narrow `frozen_fact_broken` to kept claims; add `invented_fact`, `transfer_overclaim`, `ats_text_parity`, `omission_justified` |
| `server/materials-rubric.mjs` | new: the six-row rubric |
| `tests/materials-delint.test.mjs` | extend with the 3E "before" corpus (`I am excited`, `distinctive opportunity`, `transform how`) |
| `tests/materials-critic.test.mjs` | update: omitting Hormiga/Bucketz must not fail; Power BI in a token line must fail |

Acceptance: the v2-era 3E letter fails `banned_filler` and `ai_cadence`; the Volt 1.0 mock letter (`volt-v1/`) passes both; a fabricated metric fails `invented_fact`.

---

## Slice 6 — executor boundary, degraded path, caching

| File | Change |
| --- | --- |
| `server/materials-executor.mjs` | new: `local-inprocess`, `hermes-cli`, `webhook`; `unsupported` → local fallback |
| `server/materials-request.mjs` | route through the executor registry; keep the CLI contract and exit codes |
| `integrations/hermes-job-hunt/scripts/materials_watcher/prompts/draft-prompt.template.txt` | reduce to an envelope executor; prompts and budgets move to JobBored |
| `integrations/hermes-job-hunt/phase3-document-quality-gate.md` | supersede the two-page cap; point at the budget table |
| `server/materials-cache.mjs` | new: `jdHash|ledgerHash|templateVersion|promptVersion|budgetVersion` |
| `server/materials-drafter.mjs` | degraded no-pin path publishes a deterministic REVIEW package instead of a 409 |
| `tests/materials-executor.test.mjs`, `tests/materials-degraded.test.mjs`, `tests/materials-cache.test.mjs` | new |
| `tests/materials-request-no-hermes.test.mjs` | extend: the local executor is the default and needs no Hermes |

Acceptance: a request with no configured pin returns a publishable REVIEW package with `llm_unconfigured`; an unchanged repeat request is a cache hit with zero LLM calls; `hermes-cli` runs a stage without owning a prompt.

---

## Slice 7 — BYOK / Scribe alignment

| File | Change |
| --- | --- |
| `document-templates.js` | replace the six prompt-instruction templates with v3-aligned defaults (`v3_resume_one_page`, `v3_letter_four_beats`) carrying the same budgets; these are prompt instructions, independent of the visual family |
| `visual-themes.js` | fold into the template registry instead of keeping a second theme system: the BYOK preview renders the same families from `server/materials-templates.mjs` (or its bundled list), and the five preview themes (`classic`, `compact`, `serif_emphasis`, `muted`, `high_contrast`) are retired |
| `user-content-store.js`, `resume-generation.js`, `profile-materials.js`, `materials-feature.js` | `visualThemeId` stops being written; for one release a stored `visualThemeId` is ignored in favour of `materialsTemplate`, then the key is removed; `#resumeGenerateVisualTheme` / `#prefVisualTheme` become the one template select |
| `resume-generate.js` / `resume-generation.js` | statement requirement, letter band, banned list from the voice pack |
| `prompts/resume-tailorer-system-prompt.md` | final pass so the BYOK prompt and the server prompts are the same contract |
| `tests/resume-generate-system-prompt.test.mjs`, `tests/materials-feature.test.mjs` (if present) | update pins |

Acceptance: the dashboard BYOK path and the Materials Queue produce documents with the same budgets, the same banned list, and the same template family, chosen by the one `materialsTemplate` preference. No code path reads `visualThemeId`.

---

## Slice 8 — dogfood and retirement

1. Regenerate the 3E package through the real loop on `gemini-flash`.
2. Compare structure (not prose) against the slice-0 fixtures: stage list, budgets, rubric rows, one page each.
3. Regenerate two more roles with different shapes (a senior IC posting and a thin JD) to exercise `jd_thin` and the trim ladder.
4. Remove the legacy compose flag, delete `tests/materials-composer.test.mjs`, and demote `integrations/hermes-job-hunt/resume-template/resume.html` to an ingest source with a header comment saying so.
5. Strip the React tweaks panel and the unpkg reference from the old letter template so no leftover run can fetch a CDN.

---

## Tests that must change on purpose

These currently encode the behavior v3 removes. They are expected to fail until updated, and updating them is part of the slice that changes the behavior:

- `tests/resume-generate-quality-contract.test.mjs` — pins 325–450 words and a one-or-two-page target (slice 2)
- `tests/materials-quality.test.mjs` — expects a capabilities/skills section and the two-page rule (slice 2)
- `tests/materials-critic.test.mjs` — expects `frozen_fact_broken` when an employer disappears (slice 5)
- `tests/materials-composer.test.mjs` — asserts Cheerio slot surgery on the three-page master (slice 8)
- `tests/materials-drafter.test.mjs` — asserts the single-writer-call loop and the skipped-PDF demotion (slices 3 and 4)
- `tests/materials-v3-mocks.test.mjs` — the no-Google-Fonts check is a TODO for `signal` and `editorial` until their faces are vendored (slice 3); remove them from `GOOGLE_FONTS_GAP` then
- `tests/fixtures/scribe/scribe-dom.mjs` — stubs the `#resumeGenerateVisualTheme` select; it follows the select's rename (slice 7). No test pins the five preview themes or `visualThemeId` today, so slice 7 adds `tests/materials-template-preference.test.mjs` rather than editing one
- `tests/materials-request-endpoint.test.mjs` / `tests/materials-request-no-hermes.test.mjs` — the payload gains `template` (slice 3b)

---

## Risk register

| Risk | Handling |
| --- | --- |
| Ledger ingest produces weak claims | `verified: false` claims are never featured; REVIEW rather than silent mush |
| Fit estimator disagrees with the renderer | The PDF page count is authoritative; the estimator only avoids render loops |
| Flash returns invalid JSON | Structured-output request, one retry, then deterministic degrade for that stage |
| A user's saved package looks different after upgrade | Old artifacts are never rewritten; new runs use the chosen family (default `signal`) |
| A family's display face is missing at render time | Fonts are vendored (slice 3); the e2e render test fails if a request leaves the machine |
| Families drift apart on facts or QA | Every family renders the same render model, keeps the same QA markers, and is checked by the same per-family tests |
| The registry grows faster than it is maintained | Adding a family requires a reference fixture that passes the registry tests and a contract-changelog entry; the default changes only on Emilio's call |
| Hermes machines run an older watcher | Executor returns `unsupported`; JobBored runs the stage locally |
| Scope creep into dossier/Discovery UI | Out of scope in every slice; `role-materials.js` changes are limited to reading `run.json` |
