# Implementation plan — Materials v3 (Volt + staged mechanism)

> Specs: [visual system](../specs/2026-09-17-materials-v3-volt-design.md) · [operating mechanism](../specs/2026-09-17-materials-v3-mechanism-design.md)
> Fixtures: [`docs/materials-v3/mocks/3e-ai-marketing-analytics-manager/`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/)
> Dogfood role: AI & Marketing Analytics Manager @ 3E

**Goal:** replace the materials generation path end to end — the visual language, the fact store, the pipeline, and the QA contract — without breaking the dossier UI or the existing published packages.

**Non-goals:** Discovery wizard, CDLE, kanban CSS, Pipeline sheet contract, a second LLM pin, migrating old artifacts.

**Sequencing principle:** the ledger and the budgets module land before anything that reads them; the templates and the fit solver land before the staged pipeline, so there is somewhere correct to render into; the old three-page template stops being a compose target only in the final slice.

---

## Slice 0 — contract and fixtures (this PR)

- Volt visual spec, mechanism spec, this plan, and the [side-by-side](../../materials-v3/side-by-side.md)
- 3E mocks: `resume.html`, `cover-letter.html`, `volt.css`, both PDFs, both `.txt` twins
- Mechanism fixtures: `jd-extract.json`, `claim-ledger.json`, `selection.json`, `render-model.json`, `qa.json`, `qa-report.md`, `run.json`
- Two demonstration stubs with tests: `server/materials-fit-budget.mjs` (budget table + deterministic estimator and trim ladder) and `server/materials-delint.mjs` + `server/materials-voice.json` (banned-span detector)

No production path changes. Acceptance: reviewers open both mocks, print-preview one page each, and can read the budget table and the delint corpus as executable rather than aspirational.

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

## Slice 3 — Volt templates, render model, renderer, ATS twin

| File | Change |
| --- | --- |
| `templates/materials/volt/volt.css` | new: promoted from the mock, unchanged tokens |
| `templates/materials/volt/resume.html` | new: slot-only template, no facts |
| `templates/materials/volt/cover-letter.html` | new |
| `templates/materials/volt/metrics.json` | new: per-block type metrics the fit solver reads |
| `server/materials-render.mjs` | new: render model → HTML (replaces Cheerio slot surgery for the v3 path) |
| `server/materials-ats-text.mjs` | new: render model → `.txt`, never scraped from HTML |
| `server/materials-fit.mjs` | new: estimator + trim ladder over `materials-fit-budget.mjs` |
| `server/materials-pdf.mjs` | capture and return page count; stop letting a skipped PDF demote a page-count fail |
| `server/materials-drafter.mjs` | `DEFAULT_*_TEMPLATE` point at Volt; keep the old path behind a flag for one release |
| `tests/materials-render.test.mjs`, `tests/materials-ats-text.test.mjs`, `tests/materials-fit.test.mjs` | new |
| `tests/e2e-visual/materials-volt.spec.mjs` | new: print-to-PDF page count 1 for both documents; forbidden-token scan |

Acceptance: rendering the fixture `render-model.json` reproduces the mock HTML structurally; both PDFs are one page; `.txt` twins contain the statement and all six featured bullets; the forbidden-token scan is clean.

Note: `tests/materials-composer.test.mjs` asserts the old Cheerio behavior. Keep it green while the legacy flag exists; delete it with the flag in slice 8.

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

Acceptance: the v2-era 3E letter fails `banned_filler` and `ai_cadence`; the Volt mock letter passes both; a fabricated metric fails `invented_fact`.

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
| `document-templates.js` | replace the six prompt-instruction templates with Volt-aligned defaults (`volt_resume_one_page`, `volt_letter_four_beats`) carrying the same budgets |
| `visual-themes.js` | collapse the five preview themes onto the §9 knob table (`accent`, `density`, `caret`, `rail`) |
| `resume-generate.js` / `resume-generation.js` | statement requirement, letter band, banned list from the voice pack |
| `prompts/resume-tailorer-system-prompt.md` | final pass so the BYOK prompt and the server prompts are the same contract |
| `tests/resume-generate-system-prompt.test.mjs`, `tests/materials-feature.test.mjs` (if present) | update pins |

Acceptance: the dashboard BYOK path and the Materials Queue produce documents with the same budgets, the same banned list, and the same visual system.

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

---

## Risk register

| Risk | Handling |
| --- | --- |
| Ledger ingest produces weak claims | `verified: false` claims are never featured; REVIEW rather than silent mush |
| Fit estimator disagrees with the renderer | The PDF page count is authoritative; the estimator only avoids render loops |
| Flash returns invalid JSON | Structured-output request, one retry, then deterministic degrade for that stage |
| A user's saved package looks different after upgrade | Old artifacts are never rewritten; new runs use Volt |
| Hermes machines run an older watcher | Executor returns `unsupported`; JobBored runs the stage locally |
| Scope creep into dossier/Discovery UI | Out of scope in every slice; `role-materials.js` changes are limited to reading `run.json` |
