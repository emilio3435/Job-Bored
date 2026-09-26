# 3E mock package: template registry reference fixtures

Role: AI & Marketing Analytics Manager @ 3E (Bethesda, MD / Eastern remote)
System: [Materials v3 — Volt template registry](../../README.md) · specs: [visual](../../../superpowers/specs/2026-09-17-materials-v3-volt-design.md) · [mechanism](../../../superpowers/specs/2026-09-17-materials-v3-mechanism-design.md)

These are real facts from Emilio's claim bank. Nothing here is invented, and nothing is claimed that the ledger cannot support.

## Template families (reference fixtures)

One folder per registry family, from the 2026-09-25 bake-off (final polished r2 files). Each is the acceptance snapshot for its family's look. The build lane promotes them into slot-only templates under `templates/materials/<family>/`.

| Family | Source | Files |
| --- | --- | --- |
| [`signal/`](signal/) (default) | take C, signal instrument | [`resume.html`](signal/resume.html) · [`resume.pdf`](signal/resume.pdf) · [`cover-letter.html`](signal/cover-letter.html) · [`cover-letter.pdf`](signal/cover-letter.pdf) · [`DESIGN.md`](signal/DESIGN.md) |
| [`dossier/`](dossier/) | take A, operator dossier | [`resume.html`](dossier/resume.html) · [`resume.pdf`](dossier/resume.pdf) · [`cover-letter.html`](dossier/cover-letter.html) · [`cover-letter.pdf`](dossier/cover-letter.pdf) · [`DESIGN.md`](dossier/DESIGN.md) |
| [`editorial/`](editorial/) | take B, magazine profile | [`resume.html`](editorial/resume.html) · [`resume.pdf`](editorial/resume.pdf) · [`cover-letter.html`](editorial/cover-letter.html) · [`cover-letter.pdf`](editorial/cover-letter.pdf) · [`DESIGN.md`](editorial/DESIGN.md) |
| [`volt-v1/`](volt-v1/) (history, not a family) | Volt 1.0, this PR's first mock | `resume.*`, `cover-letter.*` (HTML, PDF, `.txt` twins), `volt.css` |

Logos are shared from [`../assets/logos/`](../assets/logos/): the Elio Intelligence Suite mark, the Audacy wordmark, the Primary Residential Mortgage mark, and the Colorado College logo. They are shown unaltered. Fonts come from the repo's `vendor/fonts/fonts.css`. Signal and editorial still load their display faces (Archivo, Martian Mono, Bodoni Moda) from Google Fonts. That is a known gap: the build lane vendors them (plan slice 3), and `tests/materials-v3-mocks.test.mjs` keeps a TODO until then.

What changed when the takes were copied into the repo (each `DESIGN.md` has the details):

- every sheet gained the registry QA markers, `article.page[data-page="1"]` and `h2.company-name`
- signal gained one CSS rule so PDF text extraction reads the name first and each bullet under its employer (visual spec §9.2, rule 6)
- asset paths now point at `../../assets/logos/` and `vendor/fonts/`. All six PDFs were re-rendered from the repo paths with the same headless Chrome command and checked by layout measurement: no sheet overflows, and the last text ends between 10.54in and 10.70in of 11in

## Pipeline artifacts

One fixture per data contract, in pipeline order. They make the mechanism reviewable rather than aspirational. They do not depend on the family through `tag-metrics`. The render model names the default family (`signal`), and `run.json` records it. The measurements in `qa.json` (376 words, two featured employers) were taken on the Volt 1.0 render in `volt-v1/`, where the pipeline first rendered them.

| File | Contract | Shows |
| --- | --- | --- |
| [`jd-extract.json`](jd-extract.json) | `materials.jd-extract.v1` | Gate confidence and signals, weighted nouns, outcomes, the 25-skill/15-connection differentiator, the "not prompting-only" bar, the Denver constraint, JD echo bans |
| [`claim-ledger.json`](claim-ledger.json) | `materials.claim-ledger.v1` | 13 claims with metric tokens and tool ownership levels, including Power BI at `level: none` with a transfer path |
| [`selection.json`](selection.json) | `materials.selection.v1` | Scores and reasons for 10 kept claims, codes for 3 dropped ones, justified employer omissions, prose-only transfers |
| [`render-model.json`](render-model.json) | `materials.render-model.v1` | The only input a template reads, including the `n` metric runs the tagger produced; `template.family` is `signal` |
| [`qa.json`](qa.json) | `materials.qa.v1` | 13 checks, measurements, rubric 11/12, cache key (`…\|signal@1.0\|…`) |
| [`qa-report.md`](qa-report.md) | — | The human-readable twin of `qa.json` |
| [`run.json`](run.json) | `materials.run.v1` | All 15 stages with status, duration, LLM usage and outputs, plus the `template` block the package records |

## Rendering

Open the files from inside the repo checkout, because fonts and logos are referenced relatively.

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# 1-page PDF (US Letter; the sheet owns its margins)
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=4000 \
  --print-to-pdf="$PWD/signal/resume.pdf" "file://$PWD/signal/resume.html"
```

In a browser: File → Print → US Letter, no headers or footers, background graphics on. A PDF page count of 1 does not prove a fit, because each sheet is `overflow: hidden`. Measure the laid-out page instead: the sheet's `scrollHeight` should equal its `clientHeight`.

## Reading the package

- The family mocks use all 13 claims to meet the density Emilio asked for (about 480–500 words, against Volt 1.0's 376). Every figure set as data is a ledger metric token, or 3E's own 25/15 framed as 3E's.
- Power BI and DAX appear only where the page calls them new (the signal "Ramping" row, the dossier "Preferred" row). They are never listed as owned. Salesforce, which the ledger rates adjacent, appears in none of them.
- The Denver conflict is reported as `constraint_conflict` and nothing else. No Maryland address was invented.
