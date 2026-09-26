> **Registry reference fixture: `editorial`**, a registered family in the Materials v3 template registry ([visual spec §9](../../../../superpowers/specs/2026-09-17-materials-v3-volt-design.md#9-template-registry)).
> Source: take B ("Editorial: magazine profile") of the 2026-09-25 bake-off, final polished r2 files (not the `*-r1.*` round-one files). The notes below are the take's own design notes, kept verbatim; paths such as `brief/refs/logos/` and `brief/vendor/fonts/` now resolve to [`../../assets/logos/`](../../assets/logos/) and the repo's `vendor/fonts/fonts.css`.
>
> Changes made when the take was copied into the repo:
>
> - Added the registry QA markers: `article.sheet.page[data-page]` and `class="company-name"` on the three employer `h2`s (not the ventures heading). No visual change.
> - Known gaps, left for the build lane: Bodoni Moda still loads from Google Fonts; the two-line name extracts as "EmilioNunez-Garcia" (the space between its two block spans is lost), so the renderer must keep a text space or a single text node.

# Take B: Editorial, magazine profile

## The three decisions that make this take

1. **Bodoni Moda against Source Sans 3: display contrast carries the identity.** The name (Bodoni Moda 900, 36 pt, two lines), the employer names, the section heads (Bodoni italic, sentence case) the pull quote and the initials are set in a high-contrast Didone. Everything you read at length is Source Sans 3 at 9.4 pt. Metric tokens and year stamps are Source Sans 3 bold, not mono, which keeps B clear of A's and C's mono data voice (changed in r2; see Polish r2). Volt indigo (#4a24ff) is kept as the only accent: quote mark, deck line, timeline spine, bullets, initials. There is no second brand color.
2. **The positioning statement is a pull quote beside the name, followed by a profile intro with a raised initial.** The opener reads like the first spread of a profile: name on the left, the thesis in Bodoni italic under a big indigo quotation mark on the right. A two-column, third-person standfirst paragraph then tells the career as a story (2015, PRM, Audacy 2017 to 2026, the $10M+ book, Elio since 2024, Colorado College). Every fact in it is from the ledger. This is the "people remember a story" bet, and it is also where most of the extra density comes from.
3. **A logo-anchored timeline spine.** A single indigo vertical rule runs the length of the career. Each stop has the official logo and a Bodoni year stamp in the left gutter, and a node on the spine. Solid nodes are employers; a hollow node marks the side ventures (Hormiga, Bucketz), which have no logos in the brief's set. Both Audacy roles sit under one Audacy mark. Logos are shown in full color and unaltered, sized only (Elio and PRM squares, the Audacy wordmark, the Colorado College lockup in the back matter).

The cover letter reuses the same three moves as a feature article: a masthead with a heavy rule, a To / Re / Date byline row with Bodoni italic labels, a 33 pt Bodoni headline drawn from the letter's own argument, the salutation and first paragraph set as a 14.5 pt italic standfirst, a 40 pt indigo raised initial opening the body, a margin pull quote under an indigo bar (it repeats the job-fit sentence from paragraph three, so the plain-text letter loses nothing), and an italic Bodoni signature.

## Resume visible word count

**492 words** after r2 (r1: 499; v1: 376). Counted from the resume's visible HTML text, with head and comments stripped:

```
$ python3 (strip <head>, comments, tags; split on whitespace)
492
```

The cover letter body (salutation through the last paragraph, pull quote excluded) is **203 words**, inside the 180–260 range.

## Page-count check

```
$ /usr/bin/python3 -c "import re,sys;print(sys.argv[1],len(re.findall(rb'/Type\s*/Page[^s]', open(sys.argv[1],'rb').read())))" resume.pdf
resume.pdf 1
$ ... cover-letter.pdf
cover-letter.pdf 1
```

Both were rendered with the brief's exact headless Chrome command. Because the sheet uses `overflow: hidden`, a 1-page count alone would not prove a fit, so I also screenshotted each page at letter size to confirm nothing is clipped. After fixes, the resume's back matter clears the bottom margin and the letter has balanced white space above the folio.

## Claims used (all 13)

| Claim ID | Where |
|---|---|
| elio-platform | Elio bullet 1, profile intro |
| elio-forecast | Elio bullet 2 |
| elio-ops | Elio bullet 3 |
| jobbored-claude-code | Elio bullet 4 |
| hormiga-playbook | Side ventures |
| bucketz-launch | Side ventures |
| audacy-book | Audacy bullet 1, org line, pull quote, intro |
| audacy-framework | Audacy bullet 2, intro |
| audacy-metric | Audacy bullet 3 |
| audacy-earlier-sme | Audacy 2017–2021 sub-role |
| prmi-sem | PRM entry, intro |
| certs | Credentials |
| education | Education with the Colorado College logo, intro |

Contact details and "English & Spanish" come from v1's contact and education blocks. The toolkit uses only tools named in claims or in the ledger's `toolInventory` rated owned (SQL). Salesforce, rated adjacent, was removed in r2. v1's Python, GTM and "REST + webhooks" are dropped because the ledger does not carry them. The "25 skills / 15 connections" figures describe 3E's system, so they appear only in the cover letter, where v1's argument uses them. The letter corrects v1's "$10M" to the ledger's "$10M+".

## Known limits

- **Network font.** Bodoni Moda loads from Google Fonts. The renderer should vendor it next to the other families in `vendor/fonts/` so offline renders do not fall back to Georgia and reflow.
- **The Elio PNG** has a lot of built-in padding. It is sized larger than the others and offset with negative margins so it reads at equal weight. The image itself is not cropped.

## Cost to make this the renderer's template

About 1 to 1.5 days.
- Vendor Bodoni Moda (variable, with opsz and italic) into `vendor/fonts/` and add it to `fonts.css`: under an hour.
- Map slots: name, deck, statement becomes pull quote, contact, `intro` (a new generated slot, one short paragraph assembled from ledger facts, which needs a drafting prompt plus a fact-check against the ledger), stops[] with `logo`, `years`, `location`, `org`, `role`, `bullets[]`, sub-roles, a `side` flag for hollow nodes, toolkit groups, credentials, education. About half a day.
- Logo resolution: stops take their mark from `logos.json` / `logo_resolver.py` with per-logo size classes (square vs. wordmark). A quarter day.
- Fit control: the page is at capacity near 500 words. The renderer needs a fit loop that measures overflow in headless Chrome and drops, in order, the Bucketz line, then the JobBored bullet, then trims the intro. About half a day, plus tests.
- Cover letter: the headline is a new slot. It should be derived from the statement, not invented, and the pull-quote slot must be constrained to a verbatim sentence from the body. A quarter day.

## Polish r2

The r1 files are kept as `resume-r1.html/pdf` and `cover-letter-r1.html/pdf`. The r2 fixes answer the blind judge:

1. **Vanishing en dashes and pluses.** Bodoni's en dash is a hairline and its plus is a tiny raised glyph, so "8–10" read as "8 10" and "$10M+" lost its plus. I first tried borrowing only those glyphs from Source Sans 3 through a `unicode-range` face. It rendered correctly, but PDF extraction then split tokens at the font change ("8 –10"). The shipped fix sets every whole figure token (`.fig`) and every year stamp (`.years`) in Source Sans 3 bold, including "$10M+" inside the pull quote. Bodoni stays on words only. Extraction check with pypdf: "8–10 API", "3–4 GCP", "$10M+ book", "top-3", "2024–now" and "2017–2026" all come back intact.
2. **Salesforce removed** from the Toolkit. The ledger rates it "adjacent", and an adjacent tool does not belong in an owned list.
3. **Audacy framework bullet** now matches the audacy-framework claim: "Wrote the bidding and attribution framework used in QBRs (last-click vs. assisted, incrementality, channel-to-stage movement) and trained 10 AE desks to defend it." The invented "Looker Studio and GA4 readouts" phrase is gone. Looker Studio and GA4 stay in the Toolkit, since they are the claim's listed tools.
4. **Pull quote kept, but changed.** A margin pull quote is part of the seed, and on a skim-read letter it earns its place: headline, standfirst and pull quote together carry the whole pitch. It now quotes the job-fit line from paragraph three ("That is the shape of 25 skills and 15 connections, and it is not prompting.") and sits at the top of the margin beside paragraph two, so it no longer mirrors the sentence printed next to it.
5. **Drop caps are extraction-safe.** The r1 drop caps already used `::first-letter`, but with `float` they extracted as "S" / "ince" and "A" / "t Audacy", confirmed with pypdf. Tests showed that `initial-letter` splits the same way. A raised initial (a `::first-letter` that is large with `line-height: 0`, sitting on the first line's baseline without floating) extracts whole. Both documents now use it: pypdf returns "Since 2015" and "At Audacy".

Fit, measured by layout rather than page count. Playwright loads each page with print media and waits for `document.fonts.ready`. On each sheet, `scrollHeight` equals `clientHeight` (1056 = 1056 px), so nothing overflows. The auto-margin slack above the back matter is 31.7 px on the resume and 18.3 px above the folio on the letter.

```
resume.pdf 1
cover-letter.pdf 1
```
