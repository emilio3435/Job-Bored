# 3E mock package — Volt 1.0

Role: AI & Marketing Analytics Manager @ 3E (Bethesda, MD / Eastern remote)
System: [Materials v3 — Volt](../../README.md) · specs: [visual](../../../superpowers/specs/2026-09-17-materials-v3-volt-design.md) · [mechanism](../../../superpowers/specs/2026-09-17-materials-v3-mechanism-design.md)

Real facts from Emilio's claim bank, re-selected and rewritten under the v3 rules. Nothing here is invented, and nothing is claimed that the ledger cannot support.

## Documents

| File | What it is |
| --- | --- |
| [`resume.html`](resume.html) | 1-page resume, 376 visible words |
| [`resume.pdf`](resume.pdf) | Chrome print-to-PDF, US Letter, 1 page |
| [`resume.txt`](resume.txt) | ATS plain-text twin, 78-column wrap |
| [`cover-letter.html`](cover-letter.html) | 1-page letter, 4 paragraphs, 200 words |
| [`cover-letter.pdf`](cover-letter.pdf) | 1 page |
| [`cover-letter.txt`](cover-letter.txt) | ATS plain-text twin |
| [`volt.css`](volt.css) | The whole visual system, shared by both documents |

## Pipeline artifacts

One fixture per data contract, in pipeline order. These are what makes the mechanism reviewable rather than aspirational.

| File | Contract | Shows |
| --- | --- | --- |
| [`jd-extract.json`](jd-extract.json) | `materials.jd-extract.v1` | Gate confidence and signals, weighted nouns, outcomes, the 25-skill/15-connection differentiator, the "not prompting-only" bar, the Denver constraint, JD echo bans |
| [`claim-ledger.json`](claim-ledger.json) | `materials.claim-ledger.v1` | 13 claims with metric tokens and tool ownership levels — including Power BI at `level: none` with a transfer path |
| [`selection.json`](selection.json) | `materials.selection.v1` | Scores and reasons for 10 kept claims, codes for 3 dropped ones, justified employer omissions, prose-only transfers |
| [`render-model.json`](render-model.json) | `materials.render-model.v1` | The only input the templates read, including the `n` metric runs the tagger produced |
| [`qa.json`](qa.json) | `materials.qa.v1` | 13 checks, measurements, rubric 11/12, cache key |
| [`qa-report.md`](qa-report.md) | — | The human-readable twin of `qa.json` |
| [`run.json`](run.json) | `materials.run.v1` | All 15 stages with status, duration, LLM usage, and outputs |

## Rendering

Fonts come from the app's vendored stack (`vendor/fonts/fonts.css`), referenced relatively, so open these from inside the repo checkout.

```bash
# screenshot
google-chrome --headless=new --no-sandbox --hide-scrollbars \
  --window-size=880,1200 --screenshot=resume.png \
  "file://$PWD/resume.html"

# 1-page PDF (US Letter; the sheet owns its margins)
google-chrome --headless=old --no-sandbox --no-pdf-header-footer \
  --print-to-pdf=resume.pdf "file://$PWD/resume.html"
```

In a browser: File → Print → US Letter, no headers or footers, background graphics on.

## Reading the package

- The resume's argument is the statement block, not the bullet count. If you cannot repeat it after fifteen seconds, the draft failed.
- Every featured bullet lands on an outcome from `jd-extract.json`. That mapping is in `selection.json`, per claim, with a reason.
- Bucketz, Hormiga, and the certification list are absent on purpose, with reasons recorded in `selection.json` — which is why dropping them is not a frozen-fact failure.
- Power BI and DAX appear in exactly one sentence of the letter, named as new. They are excluded from the resume token line by `render-model.json`.
- The Denver conflict is reported as `constraint_conflict` and nothing else. No Maryland address was invented.
