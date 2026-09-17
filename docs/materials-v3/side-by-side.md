# Side by side — why the #117 mocks read archival, and what changed

Paired with the [visual system spec](../superpowers/specs/2026-09-17-materials-v3-volt-design.md) and the [operating mechanism spec](../superpowers/specs/2026-09-17-materials-v3-mechanism-design.md).

- **Before:** `docs/materials-v2/mocks/3e-ai-marketing-analytics-manager/` on PR #117 (branch `cursor/materials-v2-design-8878`) — the "Readout" system.
- **After:** [`mocks/3e-ai-marketing-analytics-manager/`](mocks/3e-ai-marketing-analytics-manager/) — Volt.

The v2 mocks were not badly made. They were made for the wrong year. Every surface decision pointed at *document* and *archive*, which is exactly the note that came back: archaic, document-y, not sleek, not *llamativo*.

---

## 1. The visual tells, one at a time

| Signal | #117 "Readout" | Why it reads archival | Volt |
| --- | --- | --- | --- |
| Paper | `#efe4cf` cream over a `#c9bda6` desk, plus a `-12deg` repeating-linear-gradient grain | Aged newsprint. Simulated paper age is a period costume | `#ffffff` sheet on a `#07070b` stage with an indigo glow. No texture, ever |
| Display face | Newsreader, with `Iowan Old Style` and Palatino in the fallback chain | A book serif from the 1700s lineage. Serif on a résumé says institution, not builder | Geist 600 at `-0.038em`. No serif anywhere in the system |
| Emphasis | Newsreader *italic* inside the thesis | Italic-as-voice is an editorial convention | Weight plus a soft indigo wash band. No italic as an emphasis device |
| Page frame | `.page::after` inset `1px` border at `inset: 10px 10px 10px 17px` | A printed plate frame. Nothing modern puts a box around the page | No frame. Whitespace is the frame |
| Page edge | 7px forest-green rail printed down the left edge of the sheet | Ledger binding | Nothing on the page edge. A `0.3in` caret after the name is the only ornament |
| Accent | Forest `#2f4a3c` rules and rust `#9a3b1e` 3px borders | Heritage palette: hunter green and brick | One electric indigo `#4a24ff` used in five places, never as a fill |
| Section headers | Mono caps labels stacked above content | Fine, but with the serif and cream they read as an annual report | Mono caps with a leading indigo `/` and a hairline running to the margin |
| Metrics | Inline in body prose | Numbers disappear into sentences | Verified numbers in JetBrains Mono 500 — they read as instruments |
| Folio | `1 / 1` under a rust rule, with a "Readout · tailored for 3E" kicker | A kicker plus a folio is magazine furniture | A single hairline footer line, 6.4pt |
| Letter | `Date / To / Re` stack, Newsreader salutation at 13pt, full-measure paragraphs | Business-correspondence template from a 1990s word processor | Tracked mono index strip, half an inch of air, a 5.4in measure, and a metadata rail |
| Screen view | Cream sheets on a tan desk with diagonal hatching | Looks like a scan | White sheet floating on near-black with a long indigo shadow |

Two numbers make the same point. The v2 mock loaded **seven vendored woff2 files across three families** (Newsreader, IBM Plex Sans, IBM Plex Mono) copied into the mock folder. Volt uses **two families already vendored by the app** (`vendor/fonts/fonts.css` — Geist and JetBrains Mono), so materials inherit the product's own type system instead of importing a print-history one.

---

## 2. What v2 got right and Volt keeps

Nothing here is up for re-litigation:

- one intentional page, with two pages as an explicit, justified exception
- claim selection as the core idea — the master résumé is a source, not an output
- a thesis in the first three lines
- four-paragraph letter, no flourish paragraph, no mission flattery
- anti-filler voice with an enforced banned list and per-JD echo bans
- ATS plain-text twins generated alongside every render
- transfers narrated honestly (Power BI is named as new, never listed as a skill)
- the Denver / Colorado-excluding-Denver conflict surfaced, never rewritten

---

## 3. The mechanism gap #117 left open

v2 changed what the model was asked for. It kept the substrate that caused the failures. Volt changes the substrate.

| # | Structural failure | #117's answer | Volt's answer |
| --- | --- | --- | --- |
| 1 | The three-page master résumé is both the fact store and the layout | Keep the file, rename it "claim bank" in a comment, compose into new v2 templates | A normalized `claim-ledger.json` is the fact store; templates carry zero facts; the ledger is built once per profile change, not read as HTML per draft |
| 2 | Cheerio slot surgery on a finished document cannot omit a role | Teach the composer to honor `include: false` | Delete the surgery. Templates render `materials.render-model.v1`; there is no document to operate on |
| 3 | The critic hard-fails when an employer disappears | Narrow `frozen_fact_broken` to kept claims | Same rule, plus `omittedEmployers[].justified` recorded on disk and an `omission_justified` check, so omission is auditable rather than merely permitted |
| 4 | The 325-word letter floor forces padding | Lower the band to 180–280 | Band is 180–260 and lives in **one** budgets module that the prompts, QA, repair strategy, and fit solver all read — the drift that produced two different floors becomes a failing contract test |
| 5 | The JD gate accepts any ≥ 80-word blob | Keep the gate; add a richer extract | Gate scores confidence from structural signals and splits `jd_thin` (draft, REVIEW) from `jd_unusable` (resumable paste-JD state, no draft) |
| 6 | Page count is guessed from `article.page` counts and demoted when PDF is skipped | Note that the PDF count is authoritative | A deterministic fit solver estimates height, walks an ordered trim ladder, and the rendered PDF page count decides. Type size is never touched. A skipped PDF is REVIEW, not a demoted fail |
| 7 | One writer call picks, drafts, and self-edits with the full JD and full master in context | Stage the process into files | Three narrow LLM calls with small schemas (extract, select-by-ID, draft), a conditional fourth for delint, ≤ 6,144 output tokens, and a deterministic stage between each |
| 8 | Nothing stops a fabricated metric from being typeset like a real one | Banned-list expansion | Metric emphasis is generated by a tagger from ledger-verified tokens. A number the model invented cannot become a mono `n` run, and untraced numerals fail `invented_fact` |
| 9 | Hermes, the server, and the BYOK path each hold their own budgets and prompts | Update all three in the same waves | One orchestrator (JobBored), one budget table, one prompt set; Hermes becomes a `MaterialsExecutor` that contributes execution, not opinions |
| 10 | No pin configured is a 409 and the user gets nothing | Out of scope | A degraded deterministic package publishes as REVIEW with `llm_unconfigured` — and gives the test suite a full-pipeline path with zero network |
| 11 | `pending.json` carries one phase string, so a bad output is unexplainable | Staged files under the slug | Append-only `run.json` stage ledger with status, duration, model, tokens, and named outputs per stage; `pending.json` stays as a UI shim |
| 12 | A regenerate always costs a full run | Not addressed | Cache key `jdHash\|ledgerHash\|templateVersion\|promptVersion\|budgetVersion`, recorded in `qa.json` |

---

## 4. Same facts, different package

Both mocks use the same real evidence. The difference is what each system thought the evidence was for.

| | #117 | Volt |
| --- | --- | --- |
| Resume pages | 1 | 1 |
| Resume visible words | ~410 | 376 |
| Featured employers | 2 | 2 |
| Letter body words | ~220 | 200 |
| Letter paragraphs | 4 | 4 |
| Type families | 3 (Newsreader, IBM Plex Sans, IBM Plex Mono) | 2 (Geist, JetBrains Mono), both already in the app |
| Font files shipped with the mock | 7 | 0 |
| Resume PDF | 135KB | 152KB |
| Letter PDF | 94KB | 108KB (the pre-v2 letter was ~449KB) |
| Machine-readable artifacts | `jd-extract.json`, `claim-selection.json` | `jd-extract.json`, `claim-ledger.json`, `selection.json`, `render-model.json`, `qa.json`, `run.json` |
| Fact store | the three-page master HTML | `claim-ledger.json` |
| Pagination owner | the model, then a critic | a deterministic solver, then the PDF |

The opening line is the clearest read on the difference in intent:

> **#117:** "I build the measurement and AI operating layer that turns channel noise into weekly decision memos. *I already run that stack: live model routing, grounded forecasts, and the readouts a seller carries into the room.*"

> **Volt:** "Sixty percent of this role is <mark>making spend explain itself</mark>; forty is running the AI that does the explaining. I have shipped both — an attribution argument over a $10M book, and a production multi-model stack with live data connections underneath it."

The first is a well-written positioning statement in italic serif. The second answers the posting's own 60/40 split in the reader's language, and it is set in a way that a hiring manager can repeat out loud.

---

## 5. How to check this yourself

```bash
# Volt (this branch)
open docs/materials-v3/mocks/3e-ai-marketing-analytics-manager/resume.html
open docs/materials-v3/mocks/3e-ai-marketing-analytics-manager/cover-letter.html

# Readout (#117)
git fetch origin cursor/materials-v2-design-8878
git show origin/cursor/materials-v2-design-8878:docs/materials-v2/mocks/3e-ai-marketing-analytics-manager/resume.html > /tmp/v2-resume.html
```

Print-preview both at US Letter. Both are one page. Only one of them looks like it was made this year.
