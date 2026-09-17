# Implementation plan — Materials v2

> Spec: `docs/superpowers/specs/2026-09-17-materials-v2-design.md`
> Fixture: `docs/materials-v2/mocks/3e-ai-marketing-analytics-manager/`
> Dogfood: 3E AI & Marketing Analytics Manager

**Goal:** Evolve the JobBored Materials Queue + Hermes drafter so generated resumes and cover letters match Materials v2 (1-page default, claim selection, anti-AI voice, print + ATS). This plan is the build sequence. Do not boil the ocean.

**Non-goals:** Discovery wizard, CDLE, dossier CSS, Pipeline contract, a second LLM pin.

---

## Current loop (keep the bones)

```
POST /api/applications/:slug/request
  → JD gate
  → Writer JSON
  → Cheerio composer (3-page Hermes HTML)
  → Critic (2-page / 325–475 words / 4 banned phrases / all employers frozen)
  → Editor ×2
  → optional PDF
```

v2 keeps the FIFO, pin, JD gate, Cheerio-not-prose rule, and dossier poll. It changes **what is composed, what the model is allowed to say, and what READY means**.

---

## Wave 0 — Lock the contract (docs already in this PR)

- [x] Spec, plan, failure-mode table, 3E HTML/TXT mocks
- [ ] Add a one-line pointer in `docs/README.md` (this PR)
- [ ] Do not change production composer/critic yet

Acceptance: reviewers can open the 3E mocks in a browser and print-preview one page each.

---

## Wave 1 — Stop the 3-page default (templates + budgets)

**Why first:** even a perfect writer still lands in a 3-page shell.

### 1.1 New compose templates

Create (do not overwrite the claim bank yet):

- `integrations/hermes-job-hunt/resume-template/v2/resume.html`
- `integrations/hermes-job-hunt/cover-letter-template/v2/cover-letter.html`

Clone layout tokens from the 3E mocks (Readout: Newsreader + IBM Plex, forest/rust, single column). Slots per spec §4.

Keep `integrations/hermes-job-hunt/resume-template/resume.html` as the **claim bank**. Rename in comments only: “master claim bank — do not compose into this file.”

`server/materials-drafter.mjs` `DEFAULT_RESUME_TEMPLATE` / `DEFAULT_LETTER_TEMPLATE` point at v2.

Tests: composer fixture swap in `tests/materials-drafter.test.mjs` and any HTML-slot tests. Print CSS: one `.page` per document.

### 1.2 Composer can omit

`server/materials-composer.mjs`:

- honor `roles[].include === false` (remove the `article`, do not leave empty `<ul>`)
- new `earlier[]`, `selectedTools[]`, `thesis` / `targetTitle`
- letter slots `p1`–`p4`; stop writing `flourish` / `whyThem` / `whyNow` if absent
- never reintroduce `data-section="capabilities"` on v2

### 1.3 Budgets that match the spec

`server/materials-quality.mjs`:

| Old | New |
|---|---|
| resume fail only if pages > 2 | fail if pages > `pageBudget` (default 1); always fail if pages > 2 |
| 2-page sparse expand | only when `pageBudget === 2` |
| letter 325–475 | letter 180–280; `< 150` review; `> 280` fail |
| require capabilities/skills section | **do not** require capabilities; require `thesis` or summary |

`server/materials-repair.mjs`: stop treating `cover_letter_too_short` as an expand-to-325 strategy. Expand only toward 180. Collapse is the default repair.

`prompts/resume-tailorer-system-prompt.md` and `tests/resume-generate-quality-contract.test.mjs`: same numbers. The current test **pins 325–450 and one-or-two-page** — update the pin.

Hermes `scripts/materials_watcher/prompts/draft-prompt.template.txt`: 1-page default; “do not compose into the 3-page bank.”

`profile/materials-quality.example.md` + `phase3-document-quality-gate.md`: two-page hard cap → one-page default.

### 1.4 Frozen facts = kept claims

`server/materials-critic.mjs`: `frozen_fact_broken` only for employers/metrics listed in `claim-selection.json` with `keep: true` (or Writer `roles[].include: true`). Unjustified drops → `frozen_omission_unjustified`.

Acceptance:

- Composing the 3E mock JSON into v2 templates yields 1 page HTML
- A unit test omits Hormiga/Bucketz and does **not** fail frozen-fact
- `npm test -- tests/materials-quality.test.mjs tests/materials-critic.test.mjs tests/materials-drafter.test.mjs` (update expectations)

---

## Wave 2 — JD extract + claim selection + rubric

### 2.1 New modules

| File | Responsibility |
|---|---|
| `server/materials-jd-extract.mjs` | Deterministic nouns + LLM fill for outcomes / differentiators / constraints |
| `server/materials-claim-select.mjs` | Keep 6–10 claims mapped to extract |
| `server/materials-outline.mjs` | thesis, featured ids, `pageBudget`, letter beat sheet |
| `schemas/materials-jd-extract.v1.json` | validate extract |
| `schemas/materials-claim-selection.v1.json` | validate selection |

Write `jd-extract.json`, `claim-selection.json`, `outline.json` next to `resume.html` under `~/.jobbored/applications/<slug>/`. Allowlist them in `server/application-materials.mjs` as support docs (like `job-analysis.md`).

3E golden fixtures live beside the mocks (`jd-extract.json`, `claim-selection.json` already drafted in docs/). Tests assert the extract contains `Claude`, `Demand Generation`, the 25/15 differentiator, and the Denver constraint.

### 2.2 Writer consumes the outline, not the raw master HTML

`server/materials-writer.mjs`:

- system prompt = v2 schema + voice + banned list (load from `server/materials-voice.json`)
- user payload = extract + selected claims + outline + JD text. **Do not** paste the full 3-page master HTML (that is how coverage-dump happens).
- temperature stay ≤ 0.4; max tokens can drop (2k is enough for v2 JSON)

Editor: may rewrite prose and drop a weak bullet; may not resurrect `keep: false` claims.

### 2.3 Rubric scorer

`server/materials-rubric.mjs` implements spec §6. Persist scores in `qa-report.md`. READY requires ≥ 10/12 and no hard-fail code.

Keyword gate: retire “3 tokens ≥ 5 chars” as the primary check. Keep it only as a debug line. `jd_noun_coverage` uses `mustNouns`.

Acceptance: drafter integration test with a stub writer that returns the 3E mock JSON → rubric ≥ 10, `differentiator_missing` absent, `constraint_conflict` present.

---

## Wave 3 — Anti-AI pass + ATS twins

### 3.1 Voice package

`server/materials-voice.json` (banned phrases, tagline bans, symmetry heuristics). `materials-critic.mjs` loads it. Add `ai_cadence` (3+ parallel bullets, 3+ adjective stack, canned “systems behind it”).

Anti-AI editor (`callVoiceEditor` in `materials-writer.mjs`): JD **omitted** on purpose. Input = draft JSON + banned list + voice guide. Output = same schema.

### 3.2 ATS text

`server/materials-ats-text.mjs` renders `resume.txt` / `cover-letter.txt` from Writer JSON. Drafter writes them. Critic `ats_text_mismatch` if a featured bullet is missing.

Dashboard: `role-materials.js` already allowlists files — add the txt twins as downloadable, not as dossier cards if that crowds the Case. Follow existing support-doc pattern.

### 3.3 Hermes watcher parity

If the Python watcher is still used on any machine:

- point `draft-prompt.template.txt` at the staged process (extract → select → outline → draft → voice → txt)
- `check_resume_page_count(..., max_pages=1)`
- do not require `phase3` “preserve CSS / section numbering / flourish”

Acceptance: `tests/materials-critic.test.mjs` covers the expanded banned list (`distinctive opportunity`, `I am excited`, `transform how`). 3E-like letter with those phrases fails. The mock letter passes.

---

## Wave 4 — BYOK + settings alignment (small)

`document-templates.js`:

- make `resume_compact_one_page` and a new `cover_readout_four_graphs` the **defaults**
- add promptInstructions that match v2 budgets and banned list

`resume-generate.js` / `prompts/resume-tailorer-system-prompt.md`: same quality contract as the server (1-page default, 180–280 letter, thesis required). Insights sentinel can stay; add `pageBudget` and `mustNounHits` if cheap.

Do not redesign the Scribe UI in this wave.

---

## Wave 5 — Dogfood + cleanup

1. Regenerate 3E with the new loop (Gemini Flash or better).
2. Diff against `docs/materials-v2/mocks/…` for structure (not prose clone).
3. Confirm print-preview = 1 page each; QA has `constraint_conflict` only as review.
4. Then, and only then, stop composing into the old 3-page HTML. Keep the file as claim bank.
5. Optional: strip React tweaks panel from the *old* letter template so leftover Hermes runs cannot pull unpkg. Not required for v2 compose.

---

## File map (owned changes)

| File | Wave | Change |
|---|---|---|
| `integrations/hermes-job-hunt/resume-template/v2/resume.html` | 1 | new |
| `integrations/hermes-job-hunt/cover-letter-template/v2/cover-letter.html` | 1 | new |
| `server/materials-composer.mjs` | 1 | omit + new slots |
| `server/materials-drafter.mjs` | 1–3 | v2 paths, write extract/selection/txt |
| `server/materials-quality.mjs` | 1 | budgets |
| `server/materials-repair.mjs` | 1 | stop pad-to-325 |
| `server/materials-critic.mjs` | 1–3 | frozen narrowing, nouns, voice |
| `server/materials-writer.mjs` | 2–3 | v2 schema + voice editor |
| `server/materials-jd-extract.mjs` | 2 | new |
| `server/materials-claim-select.mjs` | 2 | new |
| `server/materials-outline.mjs` | 2 | new |
| `server/materials-rubric.mjs` | 2 | new |
| `server/materials-voice.json` | 3 | new |
| `server/materials-ats-text.mjs` | 3 | new |
| `server/application-materials.mjs` | 2–3 | allowlist json/txt |
| `prompts/resume-tailorer-system-prompt.md` | 1, 4 | budgets + thesis |
| `document-templates.js` | 4 | default compact/readout |
| `integrations/hermes-job-hunt/scripts/materials_watcher/prompts/draft-prompt.template.txt` | 1, 3 | 1-page + stages |
| `tests/materials-*.test.mjs` | 1–3 | update + add |
| `tests/resume-generate-quality-contract.test.mjs` | 1, 4 | unpin 325–450 |

---

## Test plan

- Unit: extract nouns from the 3E JD fixture; claim-select keeps Elio forecast + Audacy attribution, drops Bucketz; critic flags `I am excited` and `distinctive opportunity`; composer omit does not fail frozen.
- Contract: quality numbers in prompt + `materials-quality.mjs` stay aligned (extend the existing quality-contract test).
- Drafter: stubbed writer returns 3E mock JSON → 1 `.page` each, letter word count in band, `qa-report.md` contains rubric + `constraint_conflict`.
- No live provider HTTP. Inject `fetchImpl`.
- Manual: open v2 templates and the docs mocks in print preview (Letter). Type must stay at template defaults.

Do not require `npm test` of the whole repo to go green in Wave 0 (docs only). From Wave 1 on, the materials tests listed above must stay 0 fail.

---

## Rollout / risk

- **Old packages** under `~/.jobbored/applications/*` stay readable. New drafts use v2. No migrate-rewrite of old HTML.
- **Weak models** (`:free`) already warn. v2 selection is *more* instruction-heavy; keep the warning.
- **Denver constraint** will REVIEW many CO applicants. That is correct. Do not auto-rewrite location.
- **Capability-section tests** that require `data-section="capabilities"` will fail on purpose — update them.

---

## Suggested PR slices (after this design PR)

1. `feat: materials v2 templates + 1-page budgets`
2. `feat: materials jd extract and claim selection`
3. `feat: materials voice editor and ats text`
4. `feat: align byok resume prompts with materials v2`

Each slice should be mergeable without the next. This design PR is slice 0.
