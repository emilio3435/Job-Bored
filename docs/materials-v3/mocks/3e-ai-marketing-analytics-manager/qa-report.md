# QA report — 3E · AI & Marketing Analytics Manager

Run `mr_2026091718_3e_7f21` · signal 1.0 (measured on the Volt 1.0 reference render in `volt-v1/`) · gemini-flash → gemini-3.7-flash
Machine-readable twin: [`qa.json`](qa.json) · stage ledger: [`run.json`](run.json)

**Disposition: REVIEW** — one review-severity check. Nothing failed.

## Measurements

| Measure | Value | Budget |
| --- | --- | --- |
| Resume pages (from PDF) | 1 | 1 |
| Resume visible words | 376 | 340–480 |
| Featured bullets per role | 3, 3 | 2–4 |
| Letter pages | 1 | 1 |
| Letter body words | 200 | 180–260 |
| Letter paragraphs | 4 | 4 |
| Weighted JD noun coverage | 0.80 | ≥ 0.60 |
| Banned-phrase hits | 0 | 0 |
| Cadence flags | 0 | 0 |
| Untraced numerals | 0 | 0 |

## Rubric — 11 / 12 (threshold 10)

| Row | Score | Note |
| --- | --- | --- |
| Thesis in first three lines | 2 | Statement names the 60/40 split and the job to be done |
| Differentiator claimed with a real analog | 2 | 25 skills / 15 connections claimed through Elio, with ops proof |
| Outcomes ladder to their outcomes | 2 | Every featured bullet lands on an extract outcome |
| Must-noun coverage | 2 | 8 of 10 weighted nouns; misses are Power BI and DAX |
| Reporting line / partners visible | 2 | Demand Gen named in the letter; QBR and AE partner motion on the resume |
| Constraints surfaced, not lied about | 1 | Raised as a conflict, not resolved |

## Checks

- `resume_page_count` (pass): 1 page at template defaults, measured from the PDF.
- `letter_page_count` (pass): 1 page.
- `letter_word_budget` (pass): 200 words.
- `statement_present` (pass): 44 words, no title stacking.
- `banned_filler` (pass): 0 hits across 40 patterns plus 3 JD echo bans.
- `ai_cadence` (pass): no parallel bullet skeletons, no adjective stacks, 2 em-dashes in the letter.
- `jd_noun_coverage` (pass): 0.80 weighted.
- `differentiator_claimed` (pass): via `elio-platform` and `elio-ops`.
- `transfer_overclaim` (pass): Power BI and DAX appear only as prose-new in letter p4 and are excluded from resume tokens.
- `invented_fact` (pass): all 11 metric runs trace to ledger tokens.
- `omission_justified` (pass): Bucketz and Hormiga omitted with recorded reasons.
- `ats_text_parity` (pass): both `.txt` twins carry the statement and all six featured bullets; the letter rail holds only restated metadata.
- **`constraint_conflict` (review):** the posting authorizes Colorado *excluding* Denver; the candidate is in Denver. Not rewritten, not hidden, and no invented Maryland address. This is a hiring-policy question for a human.

## Not claimed

Power BI, DAX, and Power Automate are in the JD's preferred stack and absent from the ledger. They were recorded as transfers (`Looker Studio`/`GA4` → Power BI, `SQL` → DAX) and named as new in one sentence of the letter. They are not in the resume token line and not in the ATS text skills block.
