# Design — Materials v3 operating mechanism

**Date:** 2026-09-17
**Status:** spec for review
**Branch:** `cursor/materials-v3-volt-redesign-9fed`
**Companions:** [visual system](2026-09-17-materials-v3-volt-design.md) · [implementation plan](../plans/2026-09-17-materials-v3.md) · [side-by-side vs #117](../../materials-v3/side-by-side.md) · [3E mocks + artifacts](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/)
**Dogfood fixture:** AI & Marketing Analytics Manager @ 3E (Bethesda / Eastern remote)

This is the end-to-end operating design for how a JobBored materials request becomes a pair of published artifacts. It replaces both the shipped v1 loop (`server/materials-drafter.mjs`) and the v2 proposal in PR #117.

---

## 1. What is structurally wrong today

Not prompt quality. The shipped mechanism makes the 3E failures inevitable.

| Mechanism fact | File | Consequence |
| --- | --- | --- |
| The "master resume" is simultaneously the fact store *and* the page layout — a three-page deck with `data-page="3"` and a hard-coded `01 / 03` folio | `integrations/hermes-job-hunt/resume-template/resume.html` | Composing can only ever produce three pages |
| Composition is Cheerio surgery on that document: find `article[data-role]`, clone or delete `<li>` nodes | `server/materials-composer.mjs` | There is no way to express "omit this role"; an empty role leaves an empty article |
| Writer JSON has `roles[].bullets[]` with no cap, plus `capabilitiesOrder` and `stackEmphasis` | `server/materials-writer.mjs` | The schema asks for coverage and reordering, never for selection |
| The critic fails `frozen_fact_broken` when any employer string from the master is missing from the output | `server/materials-critic.mjs` | Dropping a role to fit one page is a hard failure. The system forbids the required edit |
| The letter floor is 325 words (475 ceiling), and repair *expands* anything shorter | `server/materials-quality.mjs`, `server/materials-repair.mjs`, `prompts/resume-tailorer-system-prompt.md` | Padding is mandatory, and padding is where "I am excited" and "distinctive opportunity" come from |
| Banned filler is a five-phrase regex; JD relevance is "3 tokens of length ≥ 5" | `server/materials-critic.mjs` | "marketing analytics pipeline" passes with no Claude, no attribution, no readout |
| The whole JD and the whole three-page master are pasted into one writer call, which also picks, drafts, and voices | `server/materials-drafter.mjs` | One call owns four jobs, so none of them is checkable |
| Page count is inferred from `article.page` occurrences, and when PDF rendering is skipped a page-count fail is demoted to review | `server/materials-drafter.mjs` (`adjustScorecardForSkippedPdf`) | Three-page resumes ship as REVIEW |
| The JD gate accepts anything ≥ 80 words that is not a fit blurb | `server/materials-jd-gate.mjs` | Aggregator stubs and search-result pages become "the job description" |
| `pending.json` is the only progress signal, with a single phase string | `server/application-materials.mjs`, `role-materials.js` | Nothing to inspect when output is bad, and no way to show where a run is |

v2 (#117) proposed staged files and narrowed budgets on top of this substrate: keep the three-page HTML as a "claim bank," keep Cheerio composition, keep the writer reading the master HTML. That is an improvement and still leaves facts, layout, and prose tangled in one artifact. v3 separates them.

---

## 2. Four invariants

1. **Facts live in a ledger, layout lives in a template, and prose lives in a draft.** No file is allowed to be two of those three.
2. **The model never controls layout, and never emits markup.** Pagination is a deterministic solver's job. Emphasis is the tagger's job.
3. **Selection is recorded, with reasons, before drafting.** A claim that was not selected cannot appear; a claim that was dropped has a reason on disk.
4. **Every stage writes an inspectable artifact.** If output is bad, a human can see which stage was wrong instead of re-rolling the whole run.

---

## 3. Pipeline

```
 intake ─ jd.resolve ─ jd.gate ─ jd.extract ─┐
                                             ├─ claims.load ─ claims.score ─ claims.select
                                             │                                    │
                                          outline ◄──────────────────────────────┘
                                             │
                    draft ─ delint ─ tag-metrics ─ fit ─ render ─ qa ─ publish
                                                              │
                                                       repair ladder (≤ 2)
```

Fifteen stages, each with a status, a duration, and named outputs, appended to `run.json`. Three of them call an LLM; a fourth (`delint`) calls one only when the deterministic prepass found something. Everything else is arithmetic and string handling.

| # | Stage | LLM | Reads | Writes |
| --- | --- | --- | --- | --- |
| 1 | `intake` | — | request | `request.json`, resolved template family, cache key |
| 2 | `jd.resolve` | — | payload JD, cached JD, scrape | `job-description.md` |
| 3 | `jd.gate` | — | JD text | gate verdict in `run.json` |
| 4 | `jd.extract` | yes | JD text | `jd-extract.json` |
| 5 | `claims.load` | — | claim ledger | ledger hash |
| 6 | `claims.score` | — | extract + ledger | shortlist |
| 7 | `claims.select` | yes | extract + shortlist | `selection.json` |
| 8 | `outline` | — | selection + budgets | `outline.json` |
| 9 | `draft` | yes | outline + selected claim text + voice | `draft.json` |
| 10 | `delint` | conditional | draft + voice pack | `draft.json` (revised) |
| 11 | `tag-metrics` | — | draft + ledger metrics | metric runs |
| 12 | `fit` | — | draft + the family's metrics | `render-model.json` |
| 13 | `render` | — | render model + the family's templates | `.html`, `.pdf`, `.txt` ×2 |
| 14 | `qa` | — | artifacts + extract + selection | `qa.json`, `qa-report.md` |
| 15 | `publish` | — | staged artifacts | slug dir, `manifest.json`, `provenance.json` |

The 3E fixture's real ledger is in [`run.json`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/run.json): 45 seconds wall clock, 3 LLM calls, 3,310 output tokens, one fit-solver trim, one review-severity QA check.

---

## 4. Data contracts

Seven versioned JSON contracts. Each has a schema in `schemas/` and a golden fixture under the 3E mock folder.

| Contract | Schema | Fixture | Owns |
| --- | --- | --- | --- |
| `materials.request.v1` | `schemas/materials-request.v1.schema.json` | — | slug, company, title, feature, jobUrl, notes, jdText, optional `template` (a registry family id) |
| `materials.jd-extract.v1` | `schemas/materials-jd-extract.v1.schema.json` | [`jd-extract.json`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/jd-extract.json) | role, split, outcomes, weighted nouns, stack, differentiators, bars, constraints, echo bans |
| `materials.claim-ledger.v1` | `schemas/materials-claim-ledger.v1.schema.json` | [`claim-ledger.json`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/claim-ledger.json) | employers, claims, metric tokens, tool inventory with ownership levels |
| `materials.selection.v1` | `schemas/materials-selection.v1.schema.json` | [`selection.json`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/selection.json) | budget, kept + scores + reasons, dropped + codes, transfers, letter beat assignment |
| `materials.draft.v1` | `schemas/materials-draft.v1.schema.json` | — | statement, per-bullet prose keyed by claim id, four letter paragraphs |
| `materials.render-model.v1` | `schemas/materials-render-model.v1.schema.json` | [`render-model.json`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/render-model.json) | the only input a template reads |
| `materials.qa.v1` | `schemas/materials-qa.v1.schema.json` | [`qa.json`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/qa.json) | measurements, rubric rows, checks, cache info |

Plus `materials.run.v1` ([`run.json`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/run.json)) for the stage ledger. It records the package's template (`family`, `version`, `templateIds`, `source`, and `regeneratedFrom` for a re-render), so a package can be regenerated in another family later.

**Template family (amended 2026-09-25).** `intake` resolves the family in this order: the request's `template` field, then the user's saved `materialsTemplate` preference, then the registry default (`signal`). An unknown id in the request is rejected with the list of valid ids. The family is fixed for the run and written into the render model's `template` block. Everything up to and including `tag-metrics` is family-independent. `fit`, `render` and `qa` read the family's `family.json`. The registry and its rules are in the [visual spec §9](2026-09-17-materials-v3-volt-design.md#9-template-registry).

Contract rules: additive-only within a major version; a stage may not read a field it does not declare; every contract carries the hashes of its inputs so a stale artifact is detectable.

---

## 5. The claim ledger

The single structural change everything else depends on.

**What it is:** a normalized JSON store of verified facts built from the profile, résumé, and LinkedIn ingest — employers with dates and scope, claims with text and metric tokens and tool lists and the outcomes they can support, and a tool inventory that records ownership level (`owned`, `adjacent`, `none`) with a `transferFrom` list.

**When it is built:** once per profile change (`claims.load` only reads it), not once per draft. Ingest is the existing résumé/LinkedIn parse path, extended to emit ledger entries instead of one blob of text.

**What it replaces:** pasting a three-page HTML document into the writer. The model no longer sees a formatted résumé; it sees a list of facts with IDs. That alone removes the "dump everything" gradient — there is nothing to dump.

**What it enables:**

- omission is legal and recorded (`omittedEmployers[].justified`), so the frozen-fact rule can narrow from "every employer in the master" to "every kept claim and featured employer"
- `invented_fact` becomes checkable: a metric in the output that does not match a ledger token is a fail, not a vibe
- `transfer_overclaim` becomes checkable: Power BI has `level: none` and `transferFrom: ["Looker Studio","GA4"]`, so it may be named as new in prose and may never appear in a skills token line
- the same ledger serves the BYOK/Scribe path, so both generation paths stop disagreeing about what is true

---

## 6. Stage detail

### 6.1 `jd.resolve` + `jd.gate` — a real gate

The current gate is `words ≥ 80 && !fitBlurb`. v3 scores JD quality and records the score:

```
usable            confidence ≥ 0.7 and ≥ 2 structural signals
thin              0.4–0.7            → REVIEW with jd_thin, draft continues
unusable          < 0.4              → paste-JD request, no draft attempted
```

Signals: word count, presence of a responsibilities or requirements block, company-name match against the request, count of distinct role nouns, and negative signals for fit-score blurbs, search-result pages, cookie walls, and aggregator stubs. All deterministic, all recorded in `run.json` (see the 3E fixture: confidence 0.88, 31 distinct role nouns).

Resolution order is unchanged and correct: payload JD → usable cache → scrape. The change is that `jd_unusable` becomes a first-class, resumable UI state ("paste the posting") instead of a failed `pending.json` the user has to interpret.

### 6.2 `jd.extract` — structure, not a bag of words

Deterministic pass first: headings, bullet nouns, location lists, reporting line, and stack terms lifted from the requirements block. The LLM fills only what inference is needed for: `outcomes`, `differentiators`, `bars`, `constraints`, `echoBans`, and noun weights. Output is validated against the schema; a malformed extract retries once and then degrades to the deterministic half.

Two fields are new relative to v2 and both matter for 3E:

- **`bars`** — explicit disqualifiers stated in the posting ("prompting-only is not sufficient"). Selection prefers claims that carry `clears: [barId]`.
- **`echoBans`** — phrases from the posting that the letter may not echo, because the posting's own marketing language is exactly what an LLM will mirror back.

### 6.3 `claims.score` then `claims.select` — deterministic shortlist, narrow model call

Scoring is arithmetic: weighted noun overlap, outcome coverage, differentiator hit, bar clearance, recency, and proof strength (does the claim carry a metric token). It produces a ranked shortlist, typically 8–12 claims.

The model then selects from the shortlist and **returns claim IDs, slots, and reasons — never prose**. It cannot invent a claim, because it is choosing from a list. Hard rules enforced after the call:

- 4–7 featured bullets total across 2 (max 3) featured employers, 2–4 per employer
- 1–3 compressed earlier lines
- ≤ 13 tokens on the selected-tools line, all with ledger evidence
- 2 letter proofs: one analytics, one AI-ops, chosen from kept claims
- anything not mapped to an extract noun, outcome, differentiator, or bar is dropped with a code (`no_jd_mapping`, `low_signal`, `duplicate_signal`, `budget`)

Dropping is the expected outcome, not an exception. The 3E fixture drops Bucketz, Hormiga, and the certification list, and demotes JobBored to one clause of letter p3.

### 6.4 `draft` → `delint` → `tag-metrics`

**`draft`** receives the outline, the text of kept claims only, the voice pack, and the JD's outcome list — not the full posting, and not the ledger. It returns plain strings per slot: statement, one string per featured bullet keyed by claim ID, earlier lines, four letter paragraphs. Any markup in any field is a hard fail (the existing `html_in_slot` check, kept).

**`delint`** is the anti-AI pass and runs in two halves. The deterministic half scans for banned phrases, JD echo (8-word windows plus `echoBans`), adjective stacks of 3+, three consecutive bullets with the same grammar skeleton, em-dash density, and the canned taglines the old templates taught the model. It returns spans. If there are no spans, the LLM call is **skipped** — which is what happened on the 3E fixture, saving a call. If there are spans, the model gets the draft, the spans, and the voice pack, **with the JD deliberately withheld** so it cannot re-echo the posting while fixing an echo. It may cut and roughen; it may not add a fact.

**`tag-metrics`** walks the drafted prose and converts numeric tokens into `n` runs by matching the ledger metric tokens of the claim that bullet came from. Consequences: emphasis is derived rather than authored, the model can never emit markup, and any numeral with no ledger match is reported as `invented_fact`.

### 6.5 `fit` — deterministic pagination

The layout solver, not the model, guarantees one page.

1. Estimate: for each block, compute wrapped line count from character count, the measure in the template's units, and the font's average advance width, then multiply by leading and add block margins. Template metrics are a table in the family's `family.json`, not magic numbers in the solver.
2. Compare against usable height less a safety band. For the Volt 1.0 sheet that was 711.4pt usable (11in less 0.62in and 0.5in padding), minus 14.4pt; each family declares its own usable height in `family.json`. The band exists because the estimate can be a line off in either direction: a borderline plan should be trimmed, not clipped by the sheet's `overflow: hidden`.
3. Over budget → walk the **trim ladder** in order and re-estimate after each step:
   1. drop the earlier-block description lines (keep dates and org)
   2. drop the lowest-ranked featured bullet, if its employer keeps ≥ 2
   3. drop tokens from the selected-tools line down to 8
   4. drop the lowest-ranked earlier entry
   5. drop the lowest-ranked featured employer entirely
   6. escalate to `pageBudget: 2` — only if the request or profile authorized two pages with a reason
4. Under budget by more than ~1.2in → one optional grow step (restore the next shortlisted bullet) so a one-page resume is not a half-empty page.
5. Verification is a layout measurement of the rendered page, never the estimate: the sheet does not overflow (`scrollHeight` equals `clientHeight`) and the last text box ends inside the bottom padding. The PDF page count is recorded too, but the sheet is `overflow: hidden`, so a count of 1 alone cannot prove nothing was clipped. The estimate exists to avoid render loops; the measurement decides. After the shared ladder above, the family's own trim-ladder tail from `family.json` runs.

The solver never changes type size, leading, or margins. `resume_page_count` over budget after the ladder is exhausted is a hard fail and REVIEW, not a demotion.

### 6.6 `render` — one model, three outputs

The render model drives all three surfaces so they cannot drift:

- HTML via the resolved family's templates (no JS, no CDN, vendored fonts)
- PDF via the existing Playwright path, `printBackground: true`, page count captured
- `.txt` from the **render model**, not by scraping HTML, so chrome can never leak into the ATS twin and the letter rail cannot silently add or drop content

### 6.7 `qa` — deterministic checks plus a rubric

Deterministic checks with severities, all computable from the artifacts plus the extract and selection — thirteen of them ran on the 3E fixture. Codes are listed in [`qa.json`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/qa.json); the ones that are new in v3 are `invented_fact`, `transfer_overclaim`, `ats_text_parity`, `omission_justified`, `jd_thin`, and `constraint_conflict`.

The rubric is six rows scored 0–2 (thesis, differentiator, outcome ladder, noun coverage, reporting line/partners, constraints). `READY` requires status `pass` and rubric ≥ 10/12. Anything else is `REVIEW` with the scorecard attached — which the dossier already knows how to display.

Two deliberate reversals of current behavior: the 325-word letter floor is gone (180–260 words, four paragraphs), and a missing capabilities section is no longer a review finding — it is the design.

### 6.8 Repair ladder

At most two repairs, each targeted at the stage that failed rather than "regenerate everything":

| Failure | Re-enters at | Not allowed |
| --- | --- | --- |
| over page budget | `fit` (next ladder step) | shrinking type |
| banned phrase / cadence | `delint` | seeing the JD |
| noun coverage below threshold | `claims.select` (re-rank shortlist) | inventing a tool |
| thin letter (< 180 words) | `draft`, letter slots only | padding above 260 |
| `invented_fact` | `draft`, that bullet only | keeping the number |

After two repairs the run publishes as `REVIEW` with the scorecard. It never loops forever, and it never silently downgrades a check.

### 6.9 `publish` — atomic, provenanced

Stages write into `~/.jobbored/applications/<slug>/.staging/<runId>/`. `publish` moves artifacts into the slug directory in one operation, writes `provenance.json` (which claim IDs appear in which document, plus artifact hashes), appends the final `run.json` entry, and removes `pending.json`. A crashed run leaves a staging directory and the previous published package intact.

---

## 7. Budgets, in one table

The only copy. Prompts, quality checks, the fit solver, and the tailorer prompt all read these numbers from one module so they cannot drift again.

| Surface | Target | Hard fail |
| --- | --- | --- |
| Resume pages | 1 | > page budget; > 2 always |
| Resume visible words | 340–480 | > 560 on a 1-page budget |
| Statement | 28–48 words | > 55, or a title-stack pattern |
| Featured employers | 2 | > 3 |
| Bullets per featured employer | 2–4 | > 4 |
| Earlier lines | 1–3 | a fourth featured employer on page 1 |
| Selected tokens | 8–13 | a capabilities taxonomy |
| Letter pages | 1 | ≠ 1 |
| Letter body words | 180–260 | < 150 or > 280 |
| Letter paragraphs | 4 | 5+, or a flourish line |
| LLM calls per run | 3 | > 4 |
| Output tokens per run | ≤ 6,144 | — |
| Repairs | ≤ 2 | — |

`pageBudget: 2` is valid only with a recorded reason (federal packet, academic CV, or 15+ years of directly relevant evidence). Absent a reason it is a schema violation.

---

## 8. JobBored ↔ Hermes boundary

Today Hermes owns prompts, a Python watcher, a Telegram thread, and its own page-count opinion, while JobBored's server owns a second, different pipeline. That is why the three-page template, the "≤ 2 pages" draft prompt, and the two-page quality gate all disagree.

v3 makes **JobBored the orchestrator** and Hermes one **executor** behind a small interface:

```
MaterialsExecutor
  name: "local-inprocess" | "hermes-cli" | "webhook"
  supports(stage) -> boolean
  run(stage, envelope) -> { artifacts, usage, error? }
```

- `local-inprocess` (default): the `server/materials-*` modules. No Hermes, no Telegram, no Python.
- `hermes-cli`: spawns the existing wrapper with a versioned envelope on stdin and expects artifacts on disk. Hermes contributes model access and long-running execution — not prompts, budgets, or templates.
- `webhook`: the BYO endpoint case, same envelope over HTTP.

Rules for the boundary:

1. Prompts, budgets, templates, and QA live in JobBored, in one place, for every executor.
2. The envelope is versioned and carries only what the stage needs; per-run `googleAccessToken`-style secrets are never included (the discovery webhook's stripping invariant, applied here).
3. An executor that cannot satisfy a stage returns `unsupported` and JobBored falls back to `local-inprocess` for that stage.
4. `pending.json` stays as a UI compatibility shim, written alongside `run.json`, until `role-materials.js` reads stage-level progress.

---

## 9. BYOK and gemini-flash alignment

The app is bring-your-own-key and the dogfood pin is `gemini-flash`. The mechanism is designed for a fast, cheap, JSON-obedient model rather than for a frontier reasoner.

- **Three narrow calls beat one wide call.** Extract, select, and draft each have a small schema and a single job. Flash is reliable at that shape and unreliable at "read three pages of HTML and a posting, then pick, write, and self-edit."
- **Structured output is requested, not hoped for.** `responseMimeType: application/json` plus `responseSchema` on Gemini, JSON mode on OpenAI-compatible providers, and the existing first-JSON-object extractor as the fallback. One retry per stage, then the deterministic degrade path.
- **Selection returns IDs.** The most hallucination-prone step is the one where the model is least able to hallucinate.
- **Temperature stays ≤ 0.4; output caps drop.** Extract 1k, select 1k, draft 2.5k. Total ≤ 6,144 output tokens per run versus today's single 4,096-token call that has to carry everything.
- **One pin, no second model.** Same `resolveActivePin` path and the same resolved-model logging that #116 added.
- **Weak-model honesty.** A `:free`-tier model still writes mush; the existing warning stays, and `qa.json` records the resolved model so a bad package is attributable.
- **Degraded no-key path.** With no pin configured, `claims.score` + `outline` + `fit` + `render` still produce a real, honest package from ledger text (deterministic selection, no rewriting, statement omitted) marked `REVIEW` with `llm_unconfigured`. Today this request is a 409 and the user gets nothing. This also gives the test suite a full-pipeline path with zero network.

---

## 10. Caching and idempotency

Cache key: `jdHash | ledgerHash | templateVersion | promptVersion | budgetVersion`, where `templateVersion` is `<family>@<version>`, so switching template families is a cache miss.

A **regenerate in another template** skips the cache and the LLM stages entirely. It re-runs `fit` → `render` → `qa` on the stored `render-model.json` with the new family, publishes a new package whose `run.json` records `source: "regenerate"` and `regeneratedFrom`, and never overwrites the original.

A repeat request with an unchanged key returns the published package without an LLM call. Changing the JD, the profile, the template, or the prompts invalidates it — which is exactly when a regenerate is warranted. The key is recorded in `qa.json`, so "why did this not change?" is answerable.

Per-slug concurrency stays one in flight (the current FIFO behavior), with the existing "already pending" fast path.

---

## 11. Failure taxonomy

| Code | Surface | User-facing next step |
| --- | --- | --- |
| `jd_unusable` | gate | Paste the posting into the dossier (resumable state, not a dead run) |
| `jd_thin` | gate | Draft continues; REVIEW notes what was missing |
| `llm_unconfigured` | intake | Degraded deterministic package + "add a key in Settings" |
| `llm_http_error` | any LLM stage | One retry, then stage-level failure with the stage named |
| `schema_violation` | any LLM stage | One retry, then deterministic degrade for that stage |
| `ledger_empty` | `claims.load` | "Add a résumé in Settings → Profile"; no draft attempted |
| `fit_impossible` | `fit` | REVIEW with the ladder steps that were tried |
| `render_unavailable` | `render` | HTML + txt published, `pdf_skipped` noted, page count unverified → REVIEW (never a demoted fail) |
| `executor_unsupported` | any | Fall back to `local-inprocess` |

---

## 12. Privacy and security posture

Unchanged where it already works, tightened where the new artifacts create surface:

- The ledger, drafts, and artifacts stay on the user's disk under `~/.jobbored/applications/<slug>/`; nothing is uploaded except the prompt content sent to the user's own provider.
- New JSON artifacts join the existing `server/application-materials.mjs` allowlist explicitly; the realpath traversal guard and the slug regex are unchanged.
- The staging directory is inside the slug directory, so no new write root.
- Executor envelopes carry no credentials.
- `run.json` records provider, requested model, and resolved model — never keys.

---

## 13. Test strategy

- **Unit, no network:** gate scoring on fixture postings (real JD, fit blurb, aggregator stub, cookie wall); claim scoring on the 3E extract + ledger; fit solver estimates and each trim-ladder step; delint spans on a corpus of the exact sentences the 3E run produced; metric tagger against ledger tokens.
- **Contract:** every fixture in the mock folder validates against its schema, and the budget table is asserted identical across the budgets module, the tailorer prompt, and the QA thresholds — the drift that produced the 325-word floor becomes a failing test.
- **Pipeline, stubbed model:** a stub executor replaying the 3E fixtures runs all fifteen stages and must produce one-page HTML for both documents, a letter in band, `qa.json` with `constraint_conflict` as the only review finding, and a rubric ≥ 10.
- **Degraded:** same pipeline with no pin produces a publishable REVIEW package.
- **Visual:** Playwright print-to-PDF asserts page count 1 for both documents and asserts the forbidden-token list (§7 of the visual spec) does not appear in the rendered HTML.

---

## 14. What this does not do

- It does not rewrite the dossier UI, the Discovery wizard, kanban CSS, or the Pipeline contract.
- It does not add a second LLM pin or a "premium editor model."
- It does not migrate previously generated packages; old artifacts stay readable where they are.
- It does not resolve the Denver / Colorado-excluding-Denver conflict. It reports it, every time, and refuses to invent an address.
- It does not make a weak model write well. It makes a weak model's failures visible and cheap to repair.
