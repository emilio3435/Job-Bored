> **Registry reference fixture: `dossier`**, a registered family in the Materials v3 template registry ([visual spec §9](../../../../superpowers/specs/2026-09-17-materials-v3-volt-design.md#9-template-registry)).
> Source: take A ("Dense: operator dossier") of the 2026-09-25 bake-off, final polished r2 files (not the `*-r1.*` round-one files). The notes below are the take's own design notes, kept verbatim; paths such as `brief/refs/logos/` and `brief/vendor/fonts/` now resolve to [`../../assets/logos/`](../../assets/logos/) and the repo's `vendor/fonts/fonts.css`.
>
> Changes made when the take was copied into the repo:
>
> - Added the registry QA markers: `article.sheet.page[data-page]` and `class="company-name"` on the existing `h2.org` headings. No visual change.
> - Every family it uses (Source Sans 3, JetBrains Mono, Caveat) is already in the repo's `vendor/fonts/`, so this family renders with no network.

# Take A: operator dossier

## The three decisions that make this take

1. **The hung ledger gutter.** Every bullet in the right column opens on its verified number, which is pulled into a 0.54 in mono gutter (JetBrains Mono 600, 10 pt, Volt indigo): `21`, `8–10`, `$10M+`, `top-3`, `10`, `130%`, `18`. Bullets without a metric get a quiet lavender dash, so the numbered ones stand out. Read that one column and you have the career in numbers. That column is how the page stays dense and still reads in 3 seconds. Each bullet was rewritten so its sentence starts on the metric ("21 scenarios run by…"). The DOM therefore reads as natural prose, and no number appears twice in the text layer. The cover letter carries the same gutter: the lead figure of the Audacy and Elio paragraphs sits in it as a CSS-generated marker (`attr(data-k)`), so ATS text has no duplicate.
2. **One grid row per employer, with the rail as the evidence index.** The page is a two-column CSS grid. Each employer is a `display: contents` row, so the rail cell and the main cell share a grid row and line up without absolute positioning. Each row opens with a full-width hairline and a short indigo tick on the rail. The rail cell holds the official logo, the org name, the dates, the location and a "Stack in use" list built only from that employer's claim `tools` arrays. Taken down the page, the rail cells form the tools matrix, broken out by employer. The rail ends with education (Colorado College logo), certifications and languages. The DOM order within a row is employer, dates, stack, role, bullets.
3. **Restraint everywhere except the numbers and the logos.** The page uses one text family (Source Sans 3: a humanist, slightly narrow face that sets 9.3 pt bullets densely without the Inter look, and is not v1's Geist) plus mono for figures only. Labels are in sentence case, with no tracked caps and no section headers, because the logos label the rows. Indigo is used only for the role line, the gutter figures, the rail ticks and the small rail headings. The logos are the only other color on the page (Audacy orange, Elio magenta/teal, PRM slate, CC gold), so they read as proof marks, not decoration. The logos are shown unaltered, in full color, at their native aspect ratio.

The cover letter shares the masthead, the rail (contact, To, and a "From the letter" block of the three logos with figures restated from the body) and the gutter. Its flair comes from a 16 pt semibold lede for the opening sentence, the ledger figures hanging beside the proof paragraphs, and a Caveat hand signature in indigo, set at a 3° tilt over the typed name.

## Resume visible word count

**497 words** after r2 (502 in r1). v1 had 376. The count covers all visible text in `resume.html` with tags, styles and comments stripped. pdftotext is broken on this machine (a missing libplds4 dylib), so the count comes from the HTML text layer, which matches what the PDF renders.

Minimum type sizes (r2): bullets 9.3 pt, rail and index text 8.6–9 pt, mono dates and footer 8.5 pt. The smallest text measured on either page is 8.50 pt.

Cover letter body: 203 words (salutation through the last paragraph). That is inside the 180–260 range.

## Page-count check

```
$ /usr/bin/python3 -c "import re,sys;print(len(re.findall(rb'/Type\s*/Page[^s]', open(sys.argv[1],'rb').read())))" resume.pdf
1
$ ... cover-letter.pdf
1
```

Both files were rendered with the BRIEF's exact headless Chrome command (`--headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=4000 --print-to-pdf`).

## Claims used (all 13)

| ID | Resume | Letter |
|---|---|---|
| elio-platform | Elio bullet 1, summary, fit map | P3 |
| elio-forecast | Elio gutter `21` (`$2.4M` inline), fit map | P3, rail |
| elio-ops | Elio gutter `8–10` (`3–4` inline), fit map | P3 ("keys, service accounts, schedules") |
| jobbored-claude-code | Elio bullet 4, fit map | — |
| audacy-book | Audacy gutters `$10M+` and `top-3` (`#19` inline), title line, fit map | P2, rail |
| audacy-framework | Audacy gutter `10`, summary, fit map | P2 |
| audacy-metric | Audacy gutter `130%` (`13%` inline) | — |
| audacy-earlier-sme | Earlier-roles sub-entry, fit map | — |
| prmi-sem | PRM row | rail (title only) |
| hormiga-playbook | Ventures gutter `18` | — |
| bucketz-launch | Ventures (tools Meta Ads, Shopify from the claim) | — |
| certs | Rail | — |
| education | Rail, with Colorado College logo | — |

Other sources, all allowed by §0: contact and "English & Spanish" from v1; SQL from the ledger `toolInventory` (owned); "25-skill / 15 systems" and the 60/40 framing carried over verbatim from v1, as the BRIEF lists them. Items dropped because they are not in the ledger: v1's Python, GTM, REST + webhooks. One copy fix: v1's letter said "$10M"; this take uses the ledger's verbatim "$10M+".

The "Mapped to 3E's brief" block in the bottom right of the resume uses the ledger's own `outcomes` tags (spend-to-stage, decision-readout, attribution-judgment, self-serve-gtm-ai) as its headings. It restates claims and adds no new facts.

## Cost to turn this into the renderer's template

Low to moderate, about a day.
- The layout is pure CSS grid with no JS and no absolute positioning, so it maps one-to-one onto `render-model.json`: one row per `employers[]` entry, a rail stack list from the union of that employer's claim `tools`, and bullets from claims.
- **New data need 1: a `lead` token per bullet.** Each rendered bullet must start with its first metric token. Claims whose `metrics[0].token` sits mid-sentence need a drafting rule: "lead with the metric". The drafter enforces it, or the template falls back to the dash gutter. The template itself stays fact-free.
- **New data need 2: a logo per employer**, plus a per-logo layout hint (square mark next to the name vs. wordmark above it). This fits the existing `logo_resolver.py` output if it returns an aspect class.
- **Fit risk:** density is tuned by hand to fill exactly one page. The renderer needs an overflow loop: drop the ventures pair first, then the fit map, then the earlier-role sub-entry, re-rendering until the page count is 1.
- The letter's gutter uses `attr(data-k)`, which the renderer fills from the paragraph's first metric. The Caveat signature is the name in the vendored font, so there are no image assets.

## Polish r2

The r1 files are kept alongside as `resume-r1.html/pdf` and `cover-letter-r1.html/pdf`.

1. **"Mapped to 3E's brief" is now an index, not a recap.** It was renamed "Where 3E's asks land in this ledger" and is a two-column list. On the left, each of 3E's asks appears in the JD's own wording (the jd-extract outcomes, plus the required and preferred stack). On the right are pointers back into the page: the employer name plus the gutter figures in indigo mono (`$10M+ top-3 130%`, `21`, `10`, `8–10`), so a reader can jump to the bullet instead of reading it twice. Two rows add information that appears nowhere else on the page: the required-stack check (Claude Code and live data connections at Elio, SQL owned) and the preferred-stack gap (Power BI and DAX are new, with transfer from Looker Studio, GA4 and SQL). Both come from the ledger's `toolInventory.transferFrom`. The old "Core stack" line was folded into those two rows and removed.
2. **The PRM row is rebalanced.** "SEM / WordPress" (the prmi-sem claim's own tools) moved from the rail into the main cell, under the bullet. The rail now holds the logo, name, dates and location. The measured height difference between the rail and main content in that row went from about 0.29 in to 0.08 in. No facts were added. The space this saved was spent on row padding (6.5/7 pt to 8/8.5 pt), so every row breathes a little more.
3. **Type floor.** Mono dates, contact phone, the letter's date and both footers went from 8.0–8.1 pt to 8.5 pt. The letter's rail figures went from 8.4 to 8.6 pt, and the index refs are 9 pt. The measured minimum text size is 8.50 pt on both pages.
4. **Cover letter checked.** The signature fix is correct. "Best,", the Caveat "Emilio", the typed name and the contact line all sit on the prose's left edge, with none of the double indent from r1's last render. It still fits one page, with about 0.8 in of air under the signature.
5. **Production cleanup.** The inline `style=""` attributes are gone (they became `.when--inline` and `.stack--main`), and the orphaned `.also` rules were removed.

**Fit, measured on the laid-out DOM** (headless Chrome, 8.5 × 11 in sheet, script injected into a scratch copy only):

```
resume:       sheetH=11.000in scrollH=11.000in overflow=false contentToFootGap=0.248in prmGap=0.076in minTextPt=8.50
cover-letter: sheetH=11.000in scrollH=11.000in overflow=false contentToFootGap=0.805in minTextPt=8.50
```

Page count after the final render: `resume.pdf: 1`, `cover-letter.pdf: 1`.
