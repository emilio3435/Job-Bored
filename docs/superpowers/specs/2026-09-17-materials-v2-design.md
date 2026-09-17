# Design — Materials v2 (resume + cover letter)

**Date:** 2026-09-17
**Status:** spec for review (no production rewrite in this pass)
**Branch:** `cursor/materials-v2-design-8878`
**Companion:** [implementation plan](../plans/2026-09-17-materials-v2.md) · [failure modes](../../materials-v2/failure-modes.md) · [3E mocks](../../materials-v2/mocks/3e-ai-marketing-analytics-manager/)
**Dogfood fixture:** AI & Marketing Analytics Manager @ 3E (Bethesda / Eastern remote)
**Critique input:** `RESUME-CL-CRITIQUE-3E-2026-09-17.md` (3E Materials Queue output)

---

## 1. Why this exists

The 3E dogfood run proved the current Hermes / Materials Queue path can finish end-to-end and stay factually grounded. It also proved the **system rewards coverage, not selection**. The resume rendered ~3 pages, the letter tripped `banned_filler`, and neither document argued *this person for this role*.

That is not a prompt tweak. The canonical HTML shell, the Writer JSON schema, the critic budgets, and the Hermes draft prompt all push the model to dump the master resume into a magazine layout and then pad the letter to 325+ words.

Materials v2 is a new **template + process + quality system**. Goal of every generated pair:

- shorter (1-page resume target; 1-page letter)
- more compelling (sharp thesis in the first three lines)
- tightly customized to this user + this JD
- human / anti-robot / anti-AI-sounding
- strong on print *and* ATS

Out of scope: Discovery wizard, CDLE, dossier CSS, kanban chrome.

---

## 2. Critique adjudication (agree, then sharpen)

The 3E critique is correct. The repo explains *why* those failures were overdetermined.

### 2.1 The master resume is already three pages

`integrations/hermes-job-hunt/resume-template/resume.html` is not a one-page source that overflowed. It is a three-page deck:

- page 1: 28pt Fraunces name, long summary, eight DSM bullets
- page 2: KAM + DCM + four founder projects + education
- page 3: capabilities taxonomy, tooling & stack definition lists, languages & certs

The folio is hard-coded `01 / 03`. Template comments say “TWO-PAGE HARD CAP” and then keep a third page of skill soup. Hermes `draft-prompt.template.txt` says “2 pages or fewer.” `phase3-document-quality-gate.md` says the same. `server/materials-quality.mjs` **fails** `resume_page_count_high` only above 2 pages — so a 3-page render is a fail the composer cannot prevent, because it only rewrites slots inside that shell.

**Sharpening:** page count is a template + schema problem, not just a model that “wouldn’t cut.”

### 2.2 Writer JSON cannot select; Critic punishes selection

`server/materials-writer.mjs` asks for `summary`, `roles[].id` + `bullets`, `capabilitiesOrder`, `stackEmphasis`. `server/materials-composer.mjs` fills existing `data-role` nodes. There is no `omit`, no `pageBudget`, no claim list.

Worse: `critiqueMaterials` in `server/materials-critic.mjs` emits `frozen_fact_broken` (**fail**) if any employer string from the master HTML is missing from the composed resume. Dropping Bucketz or Hormiga to make a 1-page 3E resume is a hard fail. The system structurally forbids the edit the critique demanded.

### 2.3 Letter budgets force the cadence QA then flags

`materials-quality.mjs` wants 325–475 cover-letter words. `prompts/resume-tailorer-system-prompt.md` says 325–450. The 3E critique wants 3–4 tight paragraphs on one sparse page. A 325-word floor is how you get “I am excited… distinctive opportunity…” — language the JD itself uses, which the writer then echoes.

The banned list is four phrases: `leverage|synergize|passionate about|results-driven|proven track record`. It does not catch `distinctive`, `transform`, `optimize`, `excited`, title stacks, or parallel adjective piles. Keyword coverage is “3 tokens of length ≥ 5.” A letter that says “marketing analytics pipeline” passes without Claude, Power BI, DAX, SDR, RevOps, or “decision-support readout.”

### 2.4 Visual system is a portfolio microsite, not a hiring document

Cream + navy + gold, Fraunces italics, gold-circle separators, numbered sections (`00`–`06`), `data-tags` on every `<li>`, React tweaks panel (accent / voice / hook) pulled from unpkg. That matches the critique’s “heavy HTML template” and the ~449KB letter PDF. Hiring managers skim in 15 seconds; ATS parsers want a single column and boring headings. The brand system fights both.

### 2.5 Two generation paths, one bad default

The dashboard BYOK path (`document-templates.js`) already has `resume_compact_one_page`. Materials Queue never uses it. It always composes into the 3-page Hermes master. Hermes `draft-prompt.template.txt` is one-shot (“do the work in this top-level run”) — no JD extract, no claim selection, no anti-AI pass.

### 2.6 Customization is noun-blind and constraint-blind

3E’s differentiator is **owning ~25 live Claude skills + 15 data connections**, 60/40 analytics/AI ops, Demand Gen reporting line, Power BI/DAX preferred, SDR/RevOps partners, Eastern remote, **Colorado authorized excluding Denver**. The current extract is a bag of words. It cannot score “I already run a skills graph” or flag the Denver hire constraint. Role-shaped editing is impossible if the system never builds a role-shaped checklist.

**Verdict:** agree with the critique. Sharpen it: the 3E output is the system working as designed.

---

## 3. Design principles

1. **Selection is the product.** The master resume is a claim bank, not a document. Every generated resume is a subset.
2. **One page is the default.** Two pages require an explicit `pageBudget: 2` justification (federal packet, academic CV, or 15+ years of directly relevant IC/manager evidence). Three pages is always a fail.
3. **Thesis before inventory.** If the first three lines do not state why this person for this JD, the draft is unfinished.
4. **JD nouns and outcomes are a rubric, not a keyword cloud.**
5. **Print-first, ATS-second, chrome-never.** Layout must survive “Save as PDF” and a text extractor equally.
6. **Human unevenness is a gate.** Parallel stacks, synonym runs, and banned filler fail the draft.
7. **Do not invent. Do not over-claim adjacency.** Transfer Power BI from Looker/GA4 in prose; do not list Power BI as a skill.
8. **Constraints are first-class.** Location, clearance, sponsorship, “prompting-only is not enough” — extract them, surface them in QA, do not bury them.

---

## 4. Template system

Replace the 3-page cream/navy/gold magazine deck as the **generation target**. Keep the current Hermes HTML as `master-claim-bank.html` (source of verified facts), not as the composed output.

### 4.1 Visual language — “Readout”

A decision-memo, not a portfolio. One shared system for resume + letter so they look like a pair.

| Token | Value | Why |
|---|---|---|
| Paper | `#f4f1ea` | Warm newsprint; distinct from old cream `#FAF4E6` |
| Ink | `#1a1f1c` | Near-black with a green cast; prints as black |
| Rule | `#3d5a4c` | Forest hairline; quiet EHS/ops adjacency, not gold dots |
| Signal | `#b4532a` | Rust used once (thesis rule or date). Never as fill. |
| Display | Newsreader | Name + thesis only |
| Body | IBM Plex Sans | Print-stable, ATS-boring |
| Meta | IBM Plex Mono | Section labels, dates, contact |
| Name | 20pt / 1.05 | Not 28pt magazine |
| Body | 9.6pt / 1.35 resume, 10.5pt / 1.45 letter | Dense, not cramped |
| Page | US Letter, 0.62in margins | Fits 1 page without sub-9pt type |
| Column | Single, left-aligned | ATS + print |

Forbidden in v2 templates:

- gold circles, section numbers (`00` / `01`), Fraunces italics as voice
- `data-tags` visible to humans
- definition-list skill taxonomies
- React tweaks panel, unpkg, accent/voice/hook toys
- photos, skill bars, emoji, multi-column skill clouds
- a third page of capabilities

### 4.2 Resume template (1 page)

Slots, in order:

```
[masthead]     name, one-line target title (from JD, not title-stack)
[contact]      city · phone · email · site · LinkedIn
[thesis]       2 lines / 28–45 words. Why this person for this JD.
[experience]   1–2 featured roles, 2–4 bullets each
[earlier]      1–3 compressed lines (title, org, years, one clause)
[selected]     8–12 JD-selected tools on one line
[education]    one line (+ languages only if relevant or distinctive)
```

Optional escape hatch (page 2 only when `pageBudget: 2`):

- one more featured role **or** a short selected-projects block
- never a capabilities taxonomy

Composer rules:

- `roles[].include: false` removes the article (not empty bullets)
- `sections.capabilities` defaults **off**
- `selectedTools` is a new slot; it is not the old stack `<dl>`
- frozen employers may be omitted if they appear in `omittedClaims[]` with a reason

### 4.3 Cover-letter template (1 page)

Slots:

```
[masthead]     same name + contact as resume (no second tagline essay)
[meta]         date · company · city/remote · role   (one compact block, not Date/To/Re dl)
[salutation]   Dear {name|team},
[p1]           hook / thesis (why this role, 2–3 sentences)
[p2]           one proof (measurement / analytics)
[p3]           one proof (AI operating model) + JD differentiator
[p4]           close: concrete next step. No flourish line.
[sign]         Best, name, phone, email
```

No `whyThem` flattery paragraph. No `flourish`. No drop-cap. No pull-quote. Company-specific detail belongs inside p1 as one concrete noun (reporting line, product, operating model) — not “I admire your mission.”

### 4.4 ATS plain-text twin

Every HTML compose also writes `resume.txt` / `cover-letter.txt`:

- UTF-8, 72–88 char wrap
- headings in Title Case or ALL CAPS, not images
- bullets as `- `
- no tables, no columns
- contact as a single line

Critic diffs HTML visible text vs TXT; missing thesis or a featured bullet is a fail.

---

## 5. Generation pipeline

Replace one-shot Writer JSON with staged artifacts. Each stage is a file under the application slug so a human can inspect the cut.

```
JD gate (existing)
    ↓
1. JD extract          → jd-extract.json
2. Claim selection     → claim-selection.json
3. Outline             → outline.json
4. Draft               → writer.json   (constrained prose)
5. Compose             → resume.html + cover-letter.html
6. Anti-AI edit        → writer.json'  (same schema)
7. Length budget       → compose again if over
8. ATS text            → resume.txt + cover-letter.txt
9. QA gates            → qa-report.md
   PDF (Playwright, optional)
```

Editor loops (max 2) may re-enter at stage 4 or 6. They may **not** add claims that failed selection. If page count or banned-voice still fails after 2 loops → dossier `REVIEW`, never `READY`.

### 5.1 Stage 1 — JD extract

Structured, not a word bag. Schema:

```json
{
  "role": "AI & Marketing Analytics Manager",
  "company": "3E",
  "reportingLine": "Senior Director of Demand Generation",
  "partners": ["Growth Marketing", "SDR", "Revenue Operations", "AI/technical"],
  "split": { "analytics": 0.6, "aiOps": 0.4 },
  "outcomes": [
    "decision-support readouts (what / why / next)",
    "spend → buying-stage / pipeline explainability",
    "self-serve GTM AI"
  ],
  "mustNouns": [
    "attribution", "pipeline", "marketing spend", "Claude skills",
    "data connections", "executive readout"
  ],
  "preferredStack": ["Claude Code", "Power BI/DAX", "Power Automate", "SQL", "n8n/Zapier/Make"],
  "differentiators": [
    "own ~25 live Claude skills + ~15 data connections"
  ],
  "constraints": [
    { "type": "location", "text": "Eastern remote; CO authorized excluding Denver" },
    { "type": "ai-bar", "text": "prompting-only / standalone tools are not sufficient" }
  ],
  "bannedEcho": ["distinctive opportunity", "transform how our Marketing organization"]
}
```

Deterministic extract first (headings, bullet nouns, location lists). LLM only fills `outcomes`, `differentiators`, `bannedEcho`. No prose draft in this stage.

### 5.2 Stage 2 — Claim selection

Input: extract + claim bank (current master HTML + `resume-bullets.md` + profile).

Each claim:

```json
{
  "id": "elio-forecast-21",
  "fact": "21+ SEM forecasts against $2.4M pipeline",
  "source": "elio",
  "mapsTo": ["spend → stage", "decision-support readout", "grounded AI"],
  "keep": true,
  "reason": "Closest analog to 3E's weekly memo + live connection"
}
```

Hard rules:

- Keep **6–10** claims for a 1-page resume; **2** of those appear in the letter (one analytics, one AI ops).
- Drop anything that does not map to an extract noun or outcome.
- Do not keep a claim just because it is impressive (Bucketz, mortgage SEM, 18-idea playbook) unless the JD asks.
- Mark transfers (`looker→powerbi`) as `transfer: true`. Writer may narrate adjacency; Composer must not print the target tool as a skill.

### 5.3 Stage 3 — Outline

```json
{
  "pageBudget": 1,
  "pageBudgetReason": "IC/manager hybrid; enough evidence on one page",
  "thesis": "I already run the measurement + AI operating layer this JD describes.",
  "resume": {
    "featured": ["elio", "audacy-dsm"],
    "earlier": ["audacy-earlier"],
    "selectedTools": ["Claude API", "Claude Code", "Gemini/Vertex", "SQL", "Looker Studio", "GA4", "attribution"]
  },
  "letter": { "p1": "thesis+split", "p2": "audacy readout", "p3": "elio skills-graph", "p4": "sit in on a readout" }
}
```

`pageBudget: 2` without `pageBudgetReason` is invalid.

### 5.4 Stage 4 — Draft

Writer JSON v2 (replaces hook/whyThem/whyMe/whyNow/flourish and unbounded role bullets):

```json
{
  "letter": {
    "date": "",
    "company": "",
    "companyAddr": "",
    "role": "",
    "hiringManager": "",
    "p1": "",
    "p2": "",
    "p3": "",
    "p4": ""
  },
  "resume": {
    "targetTitle": "",
    "thesis": "",
    "roles": [
      { "id": "elio", "include": true, "bullets": ["", "", ""] }
    ],
    "earlier": [""],
    "selectedTools": [""],
    "education": ""
  },
  "omittedClaims": [{ "id": "", "reason": "" }]
}
```

Rules in the system prompt (not suggestions):

- Freeze employers, titles, dates, metrics for **kept** claims.
- 2–4 bullets per featured role; 1-page total ≤ 4 featured bullets on the most recent role.
- Thesis ≤ 45 words. No title stacking (“X and Y and Z with 10+ years…”).
- Letter 180–280 words. Four short paragraphs. No greeting essay.
- Voice samples, if present, govern cadence. If absent, use the default voice guide below.

### 5.5 Stages 5–8 — Compose, anti-AI, length, ATS

- Composer v2 loads the Readout templates. Cheerio still never edits `<style>` or invents employers.
- Anti-AI editor is a **separate** call with the banned list + the draft only (no JD, so it cannot re-echo). It may cut and roughen; it may not add facts.
- Length budget is deterministic: word counts, bullet counts, `pageBudget`. Over → trim weakest kept claim, recompose. Do not shrink type.
- ATS text is rendered from the same JSON, not from HTML scraping, so chrome cannot leak.

---

## 6. Customization rubric (score before READY)

Score 0–2 each. READY requires **≥ 10 / 12** and no hard-fail row.

| # | Check | 0 | 1 | 2 |
|---|---|---|---|---|
| 1 | Thesis in first 3 lines names the JD’s job-to-be-done | missing / generic | partial | specific |
| 2 | Differentiator claimed with a real analog | omitted | hinted | explicit (e.g. skills + connections) |
| 3 | Outcomes ladder (metrics → *their* outcome) | vanity metrics only | mixed | each featured bullet lands on an extract outcome |
| 4 | Must-noun coverage | < 50% | 50–79% | ≥ 80% of `mustNouns` |
| 5 | Reporting line / partners visible | none | one | reporting line or named partners |
| 6 | Constraints surfaced in QA (not lied about) | ignored | noted | `constraint_conflict` or explicit handling |

Hard fails (any one blocks READY): invented metric, listed transfer tool as owned skill, 2+ pages without budget, banned phrase, missing thesis, letter > 280 words, resume > 1 page when `pageBudget` is 1.

3E fixture target: thesis = measurement + AI ops layer; differentiator = Claude skills-graph analog; outcomes = readout / spend→stage / self-serve GTM AI; nouns = attribution, Claude, pipeline, connections; partners = Demand Gen / SDR / RevOps; constraint = Denver vs CO-exclude-Denver logged in QA.

---

## 7. Voice guide (Emilio default; user-overridable)

Copy-on-write into `~/.jobbored/profile/voice.md`. Dashboard writing samples still win when present.

**In one line:** Direct, evidence-first, KPI → business outcome. Sounds like a readout, not a brand deck.

**Do**

- Short sentences next to one longer one. Uneven on purpose.
- Concrete nouns from the JD: readout, skills, connections, stage conversion, Demand Gen.
- One vivid artifact per document (the forecast a seller carried into a pitch; sitting in on a QBR fight over last-click).
- First person in the letter. Implied first person / no “I” spam on the resume.
- Say the analog plainly: “same shape as a live Claude skills graph.”

**Don’t**

- Title stacking and “with 10+ years optimizing…”
- Abstract noun piles (“expertise, ownership, operational excellence, communication, and adaptability”)
- Mission flattery
- Symmetric three-clause bullets
- Claiming Power BI/DAX/Salesforce admin if the bank only has Looker, GA4, Advisr, “Salesforce basics”

**Signature moves (optional, don’t overuse)**

- “The readout was the product.”
- “Prompting-only this is not.”
- “So what do we do Tuesday?”

---

## 8. Banned phrases (enforced)

Fail the letter (and resume thesis/summary) on any match. Case-insensitive. Expandable in `materials-voice.json`.

**Classic filler**

- leverage, synergize, passionate about, results-driven, proven track record
- excited to / I am excited, thrilled, honored to
- distinctive opportunity, unique opportunity
- hit the ground running, value-add, circle back

**Resume-speak / AI cadence**

- transform (as a self-verb: “transform how…”, “transformative”)
- optimize / optimizing as a title-line habit
- utilize, facilitate, drive alignment
- “seasoned professional”, “dynamic leader”, “thought leader”
- “and the systems behind it” as a canned tagline (old template voice)

**JD-echo (per extract `bannedEcho`)**

- any 8-word window copied from the posting (existing `jd_echo`)
- plus extract-provided phrases (“distinctive opportunity”, “transform how our Marketing organization”)

**Structural tells (review, then fail if still present after editor)**

- three consecutive bullets with the same grammar skeleton
- adjective stacks of 3+ (“proactive, collaborative, adaptable”)
- more than two em-dashes in the letter
- skill-matrix or `data-tags=` visible in output

Hermes / BYOK prompts must load this list. The four-phrase regex in `materials-critic.mjs` is retired.

---

## 9. Length budgets

| Surface | Target | Hard fail |
|---|---|---|
| Resume pages | 1 | > `pageBudget` (default 1). 3 always. |
| Resume words (visible) | 380–520 | > 600 on a 1-page budget |
| Thesis | 28–45 words | > 55 or title-stack pattern |
| Featured role bullets | 2–4 | > 4 |
| Earlier block | 1–3 lines | a fourth featured role on page 1 |
| Selected tools | 8–12 tokens | a capabilities `<dl>` |
| Letter pages | 1 | ≠ 1 |
| Letter words | 180–280 | < 150 (thin) or > 280 (pad) |
| Letter paragraphs | 3–4 | hook + 3 body + flourish (old rhythm) |
| ATS txt | must contain thesis + every featured bullet | missing claim |

The **325–475 letter floor is removed.** It caused the 3E filler. Repair strategies that `expand` a short letter (`cover_letter_too_short` in `materials-repair.mjs`) must not pad above 280.

Type size is fixed by the template. Overflow is solved by dropping claims, not by `font-size: 8pt`.

---

## 10. QA gates

`qa-report.md` becomes machine-checkable. Suggested codes:

| Code | Severity | Meaning |
|---|---|---|
| `resume_page_count_high` | fail | pages > pageBudget |
| `letter_page_count` | fail | letter ≠ 1 page |
| `letter_over_budget` | fail | > 280 words |
| `letter_under_budget` | review | < 150 words |
| `thesis_missing` | fail | no thesis slot / first 3 lines generic |
| `banned_filler` | fail | expanded list or extract `bannedEcho` |
| `ai_cadence` | fail/review | symmetry, adjective stacks, canned tagline |
| `jd_noun_coverage` | fail if < 50%, else review | vs `mustNouns`, not 5-char tokens |
| `differentiator_missing` | fail | extract differentiator unused |
| `outcomes_not_laddered` | review | metrics don’t map to extract outcomes |
| `transfer_overclaim` | fail | Power BI listed without bank evidence |
| `invented_fact` | fail | metric/employer/title not in bank |
| `constraint_conflict` | review | e.g. Denver vs CO-exclude-Denver |
| `frozen_omission_unjustified` | fail | omitted employer not in `omittedClaims` |
| `html_in_slot` | fail | existing |
| `ats_text_mismatch` | fail | txt missing a featured claim |
| `pdf_skipped` | note | not a fail |

`frozen_fact_broken` is **narrowed**: only kept claims and featured employers must survive. Omitting Hormiga/Bucketz on a 3E page is success.

READY if status is `pass` and rubric ≥ 10/12. REVIEW otherwise, with the scorecard in the dossier (already supported).

---

## 11. 3E fixture (what “good” looks like)

See mocks. The pair must show:

- **Thesis:** measurement + AI operating layer; weekly decision memos; already shipped.
- **Elio featured:** multi-model + connections; 21 forecasts / $2.4M as a readout artifact; production ops (keys, service accounts) to clear the “not prompting-only” bar.
- **Audacy featured:** $10M book + attribution judgment + QBR/readout motion + one conversion metric. Not eight SEM/CRO bullets.
- **Dropped:** capabilities taxonomy, cert laundry list, Bucketz/mortgage as featured, Hormiga playbook, JobBored as a third project card (JobBored may appear as *Claude Code evidence* in the letter, not as a resume section).
- **Tools:** Claude, Claude Code, Gemini/Vertex, SQL, Looker/GA4/GTM, attribution models. Power BI called a transfer in QA, not a skill chip.
- **Letter:** 4 short paragraphs, Demand Gen + 60/40 + 25/15 named, one vivid Audacy anecdote, one Elio analog, a Tuesday-style close. No flourish.
- **QA:** `constraint_conflict` for Denver vs authorized-CO-excluding-Denver. Do not invent a Maryland address.

---

## 12. What we are not doing

- Rewriting dossier CSS or the Discovery wizard.
- Deleting the old Hermes visual files in wave 1 (they become the claim bank).
- Making the model smaller-font its way to one page.
- A second LLM pin for “editor quality.” One pin stays.
- Inventing Salesforce admin, Power BI, or DAX fluency.

---

## 13. Success measure

A 3E-class regenerate (same JD, same claim bank, Gemini Flash or better) produces:

1. `resume.html` that prints to **1 page** at template defaults
2. `cover-letter.html` that prints to **1 page**, 180–280 words
3. QA `pass` or `REVIEW` only for `constraint_conflict` / `pdf_skipped`
4. A human reader can say the thesis aloud after 15 seconds
5. No `banned_filler`, no capabilities page, no “I am excited”

The mocks in `docs/materials-v2/mocks/3e-ai-marketing-analytics-manager/` are the acceptance snapshot for layout + voice. Implementation must beat them on process (staged files), not merely clone the prose.
