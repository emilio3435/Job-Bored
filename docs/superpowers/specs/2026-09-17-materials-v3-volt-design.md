# Design — Materials v3 visual system ("Volt") and template registry

**Date:** 2026-09-17, amended 2026-09-25 (template registry)
**Status:** spec for review
**Branch:** `cursor/materials-v3-volt-redesign-9fed`
**Companions:** [operating mechanism](2026-09-17-materials-v3-mechanism-design.md) · [implementation plan](../plans/2026-09-17-materials-v3.md) · [side-by-side vs #117](../../materials-v3/side-by-side.md) · [3E mocks](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/)
**Supersedes:** the "Readout" visual language in PR #117 (`docs/materials-v2/`), rejected as archaic and document-y

---

## 0. What the 2026-09-25 amendment changed

The first version of this spec described one look, Volt 1.0, and said the system was "not a theme gallery." Emilio reviewed the Volt 1.0 mocks and found them too sparse, too generic, without logos, and with a plain letter. A three-way bake-off followed (2026-09-25). He picked take C, "signal instrument," and asked for templates to be an optional setting, so more can be added over time.

So the spec now separates two layers:

- **Volt is the shared design language.** Every template obeys it: the tokens in §3, the facts-only rule, the template contract in §8, the QA hooks (`data-claim`, `data-slot`, `data-section`, `article.page`, `h2.company-name`), and the shared forbidden list in §7.
- **Templates are families in a registry** (§9). The first three are **`signal`** (the default, from take C), **`dossier`** (take A) and **`editorial`** (take B). More can be added under the registry rules.

The pipeline in the [mechanism spec](2026-09-17-materials-v3-mechanism-design.md) is unchanged. It still ends in one `materials.render-model.v1`, and a family is only the last step: rendering that model. Volt 1.0 is kept as history in [Appendix A](#appendix-a--volt-10-history) and under [`mocks/…/volt-v1/`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/volt-v1/).

---

## 1. Why the previous visual language was rejected

Materials v2 fixed the right structural problems (one page, claim selection, anti-filler voice). Then it dressed them up like a 1960s annual report: warm cream paper (`#efe4cf`), a Newsreader serif for the name and thesis, a forest-green rail printed down the page edge, a letterpress inset border, a diagonal newsprint grain behind the sheet, a folio, and italic display type carrying emphasis. Every one of those choices signals *archive*. None of them signals the person who ships a multi-model platform on Cloud Run.

The critique v2 was answering said "print-first document, not a heavy HTML template." v2 read that as *make it look like print history*. The correct reading is *make it look like something made in 2026 that happens to print perfectly*.

Volt keeps v2's discipline: one page, no chips, no skill bars, no tag soup. It replaces the whole surface with a white sheet, one electric accent, and type chosen on purpose. Emilio's 2026-09-25 review added three requirements for every family: more substance on the page, a look that is distinctly its own, and official logos. It also asked for more flair in the letter.

---

## 2. Design targets, stated as constraints

These apply to every family.

| Target | Constraint it becomes |
| --- | --- |
| One accent | Volt indigo `#4a24ff` is the only accent. Logos are the only other colour on the page |
| Dense, still legible | About 480–560 visible resume words at a body size of at least 8.5pt (9–10pt preferred). The fit solver drops a claim before it shrinks type or leading |
| Distinct | Nothing that reads as a Google Docs, Canva, Novoresume, Resume.io or moderncv template, and none of the AI-default looks (cream with a serif and a terracotta accent, a purple-to-blue gradient, Inter everywhere) |
| Proof, not decoration | Every number set as data traces to a claim-ledger metric token. Official logos mark employers and are never altered |
| Prints cleanly | `@page` is letter with margin 0 and the sheet owns its padding. With the `ink` accent the page survives grayscale and printing with backgrounds off |
| Passes ATS | Real selectable text in one logical reading order, with the name and contact first. No images of text, logos carry `alt`, and a `.txt` twin is generated from the render model |

---

## 3. Shared tokens

A family may add its own neutrals and must keep these:

| Token | Value | Rule |
| --- | --- | --- |
| `--volt` | `#4a24ff` | The only accent. It never encodes information that is missing in grayscale |
| `--paper` | `#ffffff` | The sheet. Never cream, never textured |
| ink | near-black, family-defined (`#0b0b0f` in Volt 1.0, `#15112E` in signal) | Body text contrast at least 7:1 on paper |
| Sheet | 8.5in × 11in, `overflow: hidden`, `@page { size: 8.5in 11in; margin: 0 }` | The sheet owns its margins, so browser print settings cannot reflow it |
| Type floor | body ≥ 8.5pt; captions, dates and footers ≥ 7.5pt | Measured on the laid-out page, not read off the CSS |

**Type is per family** (§9.3), and every face must be vendored under `vendor/fonts/` (§9.2, rule 5). Figures use one face per family, applied to whole tokens, so an en dash or a plus sign never changes font inside a number. (Take B learned this the hard way: Bodoni's hairline dash made "8–10" read as "8 10", and a mixed-font token extracts as "8 –10".)

The `ink` accent swaps `--volt` for the family's ink. Every initial family supports it, and it is the answer to the judge's print note on signal's full-bleed band.

---

## 4. Layout grammar

Layout belongs to each family and is summarized in §9.3. The shared grammar is short:

- **Resume:** identity header (name, target title, contact) → the family's proof device (readouts, gutter, or pull quote) → experience, newest first, one entry per employer, with its logo → the family's secondary blocks (ventures, toolkit, credentials, education) → nothing else. There is no capabilities page, no skill taxonomy and no project cards.
- **Letter:** the same identity header as the family's resume → recipient metadata (To / Re / Date) → salutation and four paragraphs (thesis, analytics proof, AI-ops proof, next step), 180–260 words → sign-off. Letter chrome such as a rail, a footer strip or a pull quote may only **restate** what the body or header already says. It never carries a unique claim, so `cover-letter.txt` stays lossless.
- One page each by default. Two featured employers is the budget default and three is the ceiling. A family may raise its soft word budget within the budget table's hard limits (§9.2, rule 9).

---

## 5. Signature moves

Each family has **at most three** signature moves, and a fourth is a bug. They are listed in §9.3 and declared in the family's `family.json`, so review can check a render against them. Supporting details such as hairlines, labels and bullet ticks stay quiet.

---

## 6. Screen versus print

- **Screen:** the sheet may float on a dark stage with a shadow, and a mono strip above it may state the family, document, page count and word count.
- **Print:** `@media print` drops the stage, the strip and the shadow. `print-color-adjust: exact` keeps the accent.
- A family that paints a large accent area (signal's band, for example) must still read correctly with the `ink` accent and with backgrounds off. Home printers cannot print to the edge, and toner is not free.

---

## 7. Forbidden list

### 7.1 Shared: a review rejection in every family

- cream, ivory, sand, or textured paper; grain, noise, or diagonal hatching; borders or inset frames around the page; printed page-edge rails
- chips, pills, tag clouds, `data-tags` visible to a human
- skill bars, meters, radar charts, rating dots, progress indicators
- photos, icon sets, emoji. **Logos are required, not forbidden:** they come only from the brand-logo resolver and render unaltered (§9.2, rule 3)
- gradients on text; more than one accent colour; filters or blend modes on logos
- runtime JavaScript, CDN assets, Google Fonts or any other network request at render time, a tweaks/controls panel
- any number set as data that is not a claim-ledger metric token (or a figure quoted from the JD and framed as the employer's)
- a tool the ledger rates `adjacent` listed as owned; a tool rated `none` shown anywhere except a row or sentence that calls it new
- a floated drop cap, `initial-letter`, or any initial that splits a word in extracted text
- reducing type size or leading to reach one page (drop a claim instead)

### 7.2 Per family: allowed only where the family declares it

| Device | signal | dossier | editorial |
| --- | --- | --- | --- |
| Serif display type | no | no | yes: Bodoni Moda for words only (name, org names, heads, quote), never for figures |
| Italic as a voice | no | no | yes: section heads, standfirst, signature |
| Accent as a fill | the header band, and nothing else | no | no |
| `repeating-linear-gradient` | the tick scale only | no | no |
| Raised initial (not floated) | no | no | yes, extraction-safe (§9.2, rule 7) |
| Pull quote | no | no | letter only; a verbatim sentence from the body |
| Handwritten signature (Caveat, `aria-hidden`) | yes | yes | no: italic Bodoni instead |

---

## 8. Template contract

Templates are dumb renderers over `materials.render-model.v1`. They carry **no candidate facts**. That is the structural break from the v1/v2 "master resume HTML that also happens to be the layout."

- Every text position is a field of the render model. Templates resolve `runs` arrays into `<span class="n">` (metric figures) and `<span class="hl">` (the statement highlight). They never accept markup from a model.
- `data-slot` and `data-section` attributes exist for tests and QA extraction, not for Cheerio slot surgery.
- `data-claim` on each claim-bearing element and `data-claim-group` on each entry let QA map rendered output back to ledger claim IDs. That is how `invented_fact` and `ats_text_parity` are checked.
- Each sheet is an `article` with class `page` and a `data-page` number, and each employer name is an `h2.company-name`. The server's existing checks read exactly these: `server/materials-quality.mjs:54` counts pages from `article.page`, and `server/materials-critic.mjs:114,128` reads employer names from `h2.company-name`.
- Adding a section means adding a `kind` to the render model and a branch in the template. Sections are never hidden by CSS.
- **Optional fields.** A family may read optional render-model fields that another family ignores, and it must still render acceptably without them. This is what lets a package be regenerated in another family with no LLM call (§9.4). The 2026-09-25 schema adds these optional fields: `logo` on entries and credential lines (resolver output with a `shape` class of `mark`, `wordmark` or `lockup`); section kinds `readouts`, `ventures`, `toolkit` and `credentials`; a resume `intro` (editorial) whose facts trace to `claimIds`; and letter `headline`, `pullQuote` (verbatim, naming its paragraph) and `readouts`.

Reference fixtures, one per family (§9.3), live under [`mocks/3e-ai-marketing-analytics-manager/<family>/`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/). The pipeline fixture they share is [`render-model.json`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/render-model.json).

---

## 9. Template registry

### 9.1 What the registry is

A registry of **families**. Each family is one folder that renders both documents from the same render model:

```
templates/materials/<family>/
  family.json        id, label, version, documents, fonts, accents, densities,
                     logo optical sizes, fit metrics, budget overrides, trim-ladder tail,
                     optional render-model fields it reads, signature moves
  resume.html        slot-only template, no facts
  cover-letter.html  slot-only template, no facts
  <family>.css       the family's stylesheet, over the shared tokens (§3)
```

`server/materials-templates.mjs` owns the registry. It can `list()` families for the settings select, `resolve(id)` a family (unknown ids are rejected), `validate()` every `family.json` at startup and in tests, and return the `DEFAULT_FAMILY`, which is `signal`.

In the render model, `template.family` is one of `signal`, `dossier` or `editorial`, and it defaults to `signal`. Template IDs are `<family>.resume` and `<family>.letter`, and the schema rejects an ID from another family. `template.version` is the family's own version. `pageBudget` applies to every family. `accent` (`volt` or `ink`) and `density` are accepted only if the family's `family.json` lists them. The three initial families list `volt` and `ink`, and `standard` density only, because each was tuned by hand to fill one page. Volt 1.0's `ember` and `pine` accents are dropped, since no family is built around them.

### 9.2 Registry rules

Every family, present and future, must satisfy all of these. Today `tests/materials-v3-mocks.test.mjs` checks each reference fixture against rules 2, 3, 7 and 8, the DOM half of rule 6, and rule 5. Rule 5 is recorded as a TODO for signal and editorial, which still load Google Fonts. The mocks are hand-set, so rule 1 cannot apply to them, and rules 4, 9 and 10 need a browser or a real `family.json`. The render tests in plan slice 3 check all ten rules against real output.

1. **A dumb renderer over render-model.v1.** It carries no facts, accepts no markup, and follows §8. A family that needs a new kind of data gets it as an optional render-model field, added to the schema and logged in the contract changelog. It never gets it by hard-coding text.
2. **QA markers stay.** Each sheet is an `article.page[data-page]`, employer names are `h2.company-name`, claim-bearing elements carry `data-claim`, and sections carry `data-section`. These are what `server/materials-quality.mjs:54` and `server/materials-critic.mjs:114,128` read today. A family that drops them silently breaks page counting and the frozen-fact check.
3. **Logos come from the brand-logo resolver** (`server/brand-logos.mjs` → `logo_resolver.py`: upload, then favicon, then monogram) and render unaltered, in full colour, at their native aspect ratio, with `alt` text. A family sizes a mark by its `shape` class using the optical-size table in `family.json`. It never recolours, crops or filters one. (Transparent padding may be offset with negative margins, as signal and editorial do for the Elio mark.)
4. **One page by default, fit measured on the layout.** The sheet is `overflow: hidden`, so a PDF page count of 1 proves nothing about clipping. Fit is proven by measuring the laid-out page in the renderer's browser: the sheet's `scrollHeight` equals its `clientHeight`, and the last text box ends inside the bottom padding. The PDF page count is still recorded. A family declares the tail of its trim ladder in `family.json` (signal drops Ventures, then the Ramping row; dossier drops ventures, then its JD index, then the earlier sub-entry; editorial drops the Bucketz line, then the JobBored bullet, then trims the intro). This tail runs after the shared ladder in the mechanism spec §6.5.
5. **Fonts are vendored.** Every face a family uses is self-hosted under `vendor/fonts/` and linked through `vendor/fonts/fonts.css`. Nothing is loaded from Google Fonts or any other network at render time. A missing face makes the fallback reflow the page, and the render must not depend on the network.
6. **Name and contact come first in DOM order *and* in paint order**, so ATS text extraction reads them first. DOM order alone is not enough. A PDF's text order follows paint order, and positioned boxes paint after in-flow ones. The signal mock showed this: its band was the first thing in the DOM, but it was `position: relative` while the readout strip was not, so PDF extraction read the readout strip first and the band and every bullet last. The fixture now positions every block box in the sheet, which paints them in DOM order. Verify it by extracting the PDF text, where the first line must be the name.
7. **Drop caps and initials never split a word.** A floated `::first-letter` and `initial-letter` both extract as "S" / "ince". The safe form is a raised initial: a large `::first-letter` with `line-height: 0`, sitting on the first line's baseline without floating. Likewise, a name split across two lines must keep a real text space. (Editorial's two-span name currently extracts as "EmilioNunez-Garcia".)
8. **Facts only.** Figures set as data are ledger metric tokens, adjacent tools are never listed as owned, and a tool rated `none` appears only where the page calls it new. Letter chrome only restates the body.
9. **Budgets stay single-sourced.** `family.json` may override the *soft* budgets (visible words, featured employers, bullets per featured employer) only inside the hard limits of `MATERIALS_BUDGETS` in `server/materials-fit-budget.mjs`. The contract test fails if an override crosses a hard limit.
10. **One accent, and `ink` works.** The family renders with `accent: "ink"` and loses no information in grayscale.

**Adding a family** takes a folder under `templates/materials/`, a `family.json` that validates, the family's id added to the `family` enums in `schemas/materials-render-model.v1.schema.json` and `schemas/materials-run.v1.schema.json`, a reference fixture under `docs/materials-v3/mocks/<case>/<family>/` that passes the registry tests, and a `docs/CONTRACT-CHANGELOG.md` entry. That change is additive. Changing the **default** family is Emilio's call.

### 9.3 The initial families

Each summary is drawn from the family's own `DESIGN.md` in its reference fixture, which also records its measured fit, word count and claims map.

#### `signal`: the default (take C, "signal instrument")

The page is a precision instrument, because Emilio sells AI and measurement. The blind judge scored it highest (70 against 61 and 58), and Emilio picked it.

1. **A narrow Volt band with a graduated scale, capped under 1in.** It carries only the name (Archivo at 125% width, weight 800, like an engraved nameplate), the target title and the contact details. A white tick scale runs along its bottom edge (a minor tick every 0.1in, a major one every 0.5in), and it is the one ornament.
2. **A readout strip of verified figures.** Six ledger figures ($10M+, top-3, 130%, 13%, 21, $2.4M) are set in Martian Mono condensed to 75% width at 21pt, under Volt channel brackets labelled by employer. The letter ends on the same strip, with four figures and the employers' logos in its brackets, so the band and the strip bookend both documents.
3. **A logo-labelled log in one reading column.** A 1in gutter holds the dates and location. Each employer row reads `[logo] Name  Seat`, followed by metric-led bullets whose numbers use the readout mono. Toolkit is a spec table (AI systems, Analytics, Media, Operations, Ramping), and Credentials carries the Colorado College logo.

The palette is Volt `#4A24FF`, Ink `#15112E`, Graphite `#55516E`, Graticule `#D9D5F2` and white paper. The type is Archivo at several widths (9.4pt body), Martian Mono for figures only, and Caveat for the letter signature. The letter has a Date / To / Re channel gutter and a Volt-ruled 16pt lede. It reads the optional fields `readouts`, `logo` and `toolkit`. Known gaps for the build lane: Archivo and Martian Mono must be vendored; the Audacy row repeats the name beside its wordmark; the band needs the `ink` fallback for plain printing; and the renderer needs a rule that picks 4–6 readout tokens from `claims[].metrics`, groups them by `employerId`, and captions each one in the ledger's own wording.

#### `dossier` (take A, "operator dossier")

For a hiring manager who wants every proof point at once. The judge found it the most honest with numbers and the best at logo-to-entry mapping, and the least distinctive of the three.

1. **The hung ledger gutter.** Each bullet opens on its verified number, pulled into a 0.54in mono gutter (JetBrains Mono 600, 10pt, Volt). Bullets without a number get a quiet dash. The sentence itself starts on the figure, so no number appears twice in the text layer. In the letter, the gutter figure is CSS-generated (`attr(data-k)`), so ATS text has no duplicate.
2. **One grid row per employer, with the rail as an evidence index.** The rail cell holds the logo, the org name, the dates, the location, and a "Stack in use" list taken from that employer's claim `tools`. The DOM order in each row is employer, dates, stack, role, bullets. The rail ends with education (with the Colorado College logo), certifications and languages.
3. **Restraint everywhere except the numbers and the logos.** One text family (Source Sans 3, 9.3pt bullets) plus mono for figures only. Labels are in sentence case and there are no section headers, because the logos label the rows. Indigo appears only on the role line, the gutter figures and the rail ticks.

The letter shares the masthead, the rail and the gutter, with a 16pt semibold lede and a Caveat signature at a 3° tilt. Every face it uses is already vendored, so it renders with no network today. It needs a `lead` token per bullet (the drafting rule "lead with the metric"; without it the template falls back to the dash gutter), and it reads `logo`. Its "where the JD's asks land" index block has no render-model field yet and is the first thing its trim ladder drops.

#### `editorial` (take B, "magazine profile")

People remember a story. It has the most flair, and its letter was the best-looking single page in the bake-off.

1. **Bodoni Moda against Source Sans 3.** The name (36pt, two lines), employer names, italic section heads, the pull quote and the initials are Bodoni. Everything read at length is Source Sans 3 at 9.4pt. Every figure and year stamp is Source Sans 3 bold, never Didone.
2. **The positioning statement as a pull quote beside the name**, followed by a third-person profile intro with a raised initial. Every fact in the intro comes from the ledger.
3. **A logo-anchored timeline spine.** A single indigo rule runs the length of the career. Each stop has its logo and a year stamp in the gutter and a node on the spine: solid for employers, hollow for side ventures.

The letter reads like a feature: a masthead with a heavy rule, a To / Re / Date byline, a 33pt headline drawn from the letter's own argument, an italic standfirst, a raised initial, a margin pull quote (a verbatim sentence from paragraph three), and an italic Bodoni signature. It reads the optional fields `intro`, `headline`, `pullQuote` and `logo`. Known gaps: Bodoni Moda must be vendored; the name must keep its text space in extraction; and the intro slot needs a drafting prompt plus a ledger fact-check.

### 9.4 The setting and regeneration

- **Preference.** `materialsTemplate` joins the materials preferences in IndexedDB (`DEFAULT_PREFERENCES` in `user-content-store.js`, next to `visualThemeId`), with the default `"signal"`. It is set by a select in `partials/profile-materials-modal.html` that is populated from the registry's `list()`. When preferences load, an unknown stored value is normalized back to the default, the same way `profileMergePreference` is normalized today.
- **Per request.** Every materials request sends the chosen family as an optional `template` field in the `server/materials-request.mjs` payload. The server resolves it against the registry. An unknown id is a 400 with the list of valid ids, and a missing field means the default. The resolved family is written into the render model's `template` block.
- **Each package records its template.** `run.json` gains a required `template` block (`family`, `version`, `templateIds`, and `source`, which is one of `default`, `preference`, `request` or `regenerate`). The cache key's template segment is `<family>@<version>`, so switching families is a cache miss.
- **Regenerate in another template.** The render model does not depend on the family, so a stored package can be re-rendered in another family by re-running `fit` → `render` → `qa` on its `render-model.json`, with no LLM call. The new run records `source: "regenerate"` and `regeneratedFrom: <runId>`, and the original package is never overwritten. If the target family reads an optional field the stored model lacks, such as editorial's `intro`, it renders without that field. Drafting it is a separate, explicit action.

---

## 10. Accessibility and robustness

- Body text contrast is at least 7:1 on white. The lightest repeated metadata still clears 4.5:1.
- Reading order is the same in the DOM, in paint order, and in the extracted PDF text, in both documents (§9.2, rule 6).
- Links carry a visible underline, not colour alone. Logos carry `alt` text. Decorative marks (the caret, the scale, hairlines, the handwritten signature) are `aria-hidden` and have a real text equivalent where they carry words.
- No animation, no JavaScript, and no external requests at render time.

---

## 11. Acceptance criteria

A render in any family is acceptable when all of the following hold:

1. The resume and the letter each fit one page at the family's defaults, **proven by layout measurement** (no sheet overflow, and the last text inside the bottom padding). The PDF page count is 1 and is recorded.
2. The registry rules in §9.2 hold. The QA markers are present, and the name is the first line of extracted PDF text.
3. Nothing on the shared forbidden list (§7.1) appears, and nothing from §7.2 appears outside the families that declare it.
4. `resume.txt` / `cover-letter.txt` contain the statement and every featured bullet, and letter chrome contributes nothing unique.
5. A render with the `ink` accent, printed in grayscale with backgrounds off, loses no information.
6. The document is recognizably its family's reference fixture, and it is not a word-processor default or `docs/materials-v2/`.

---

## Appendix A — Volt 1.0 (history)

Volt 1.0 was this spec's original single look. Its mocks are kept under [`volt-v1/`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/volt-v1/), and the pipeline fixtures were first measured against it (376 visible resume words, two featured employers with three bullets each, and a 200-word letter). It is not a registry family.

- **Surface:** white sheet, Geist plus JetBrains Mono (both already vendored), one column, whitespace as the primary material. No serif, no italic emphasis, no logos, no drop caps, no pull quotes.
- **Three moves:** a `0.3in × 3pt` indigo caret after the name; a 12.8pt statement with one clause under a soft indigo wash; verified metrics set in JetBrains Mono inside Geist prose.
- **Letter:** a tracked mono index strip, a 5.4in measure, and a To / Re / Date rail that only restates metadata.
- **Knobs it proposed:** `accent` (volt, ink, ember, pine), `density` (air, standard, tight), `caret`, and `rail`. The registry keeps `accent` (volt and ink) and `density`, gated by `family.json`, and drops the rest.
- **Why it was superseded:** in Emilio's 2026-09-25 review it was too sparse, too generic, and had no logos, and its letter was too plain. The bake-off brief, scorecard and decision are recorded in the program folder `docs/programs/ux-volt-materials/` on Emilio's machine; that folder is not committed.

The full text of the Volt 1.0 spec is in this file's git history at commit `89536ac1`.
