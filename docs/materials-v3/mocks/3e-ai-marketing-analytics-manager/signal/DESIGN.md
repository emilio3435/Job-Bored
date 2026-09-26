> **Registry reference fixture: `signal`**, the **default** family in the Materials v3 template registry ([visual spec §9](../../../../superpowers/specs/2026-09-17-materials-v3-volt-design.md#9-template-registry)).
> Source: take C ("Brand-forward: signal instrument") of the 2026-09-25 bake-off, final polished r2 files (not the `*-r1.*` round-one files). The notes below are the take's own design notes, kept verbatim; paths such as `brief/refs/logos/` and `brief/vendor/fonts/` now resolve to [`../../assets/logos/`](../../assets/logos/) and the repo's `vendor/fonts/fonts.css`.
>
> Changes made when the take was copied into the repo:
>
> - Added the registry QA markers: `article.sheet.page[data-page]` and `h2.org.company-name` (the org name was an `h3`; `.org` sets its own size and margin, so the page is unchanged).
> - Added one CSS rule so every block box is positioned. In r2 the band and the bullets were painted in the positioned layer, so PDF text extraction read the readout strip first, then the headings, and the band and every bullet last. After the fix, pypdf reads the name and contact first and each bullet under its employer.
> - Known gaps, left for the build lane: Archivo and Martian Mono still load from Google Fonts, and pypdf splits some Archivo words at kerning pairs ("fo recast"). The Audacy row repeats the name beside its wordmark.

# Take C: Signal instrument

## The three decisions that make this take

1. **A narrow Volt band with a graduated scale, capped under 1 in.** The band carries only the name (Archivo at 125% width, weight 800, like an engraved nameplate), the target title and the contact details. A white tick scale (minor every 0.1 in, major every 0.5 in) runs along its bottom edge. That scale is the one ornament, and it tells the reader this person measures things. It is sized to avoid the hero trap: the band is under 10% of the page, and real content starts about 1.9 in from the top.
2. **A readout strip where every figure is wired to its source logo.** Six verified figures ($10M+, top-3, 130%, 13%, 21, $2.4M) are set in Martian Mono, condensed to 75% width, at 21 pt. They sit under Volt channel brackets headed by the official Elio and Audacy marks. The logos do two jobs, "crisp row of marks" and provenance, and the strip is the 3-second read. The cover letter ends on the same strip (its own four figures), mirrored with the scale in Volt, so the band and the strip bookend both documents.
3. **A logo-labelled log below, in one reading column.** A 1 in gutter carries each employer's unaltered logo and its dates, like channel labels on an instrument. The main column carries metric-led bullets, with every number in the same mono as the readings. Toolkit is a spec table (AI systems, Analytics, Media, Operations, Ramping). Credentials carries the Colorado College logo. There is no left rail (take A) and no display story (take B). The flair on the letter comes from type: a Volt-ruled lede at 14.5 pt, a Date / To / Re channel gutter, and a Caveat signature in Volt.

## Palette and type

Volt `#4A24FF` (the only accent), Ink `#15112E`, Graphite `#55516E`, Graticule `#D9D5F2`, Paper `#FFFFFF`.

Type is Archivo, used at several widths for the name, heads and body (9.4 pt body); Martian Mono for figures only; Caveat for the signature only. Archivo and Martian Mono load from Google Fonts. `fonts.css` is linked as the offline fallback, and the stacks fall back to DM Sans and JetBrains Mono.

Logos are shown in full color and unaltered: no recoloring, no filters, and aspect ratio preserved. The Elio PNG has built-in transparent padding. It is sized larger, with negative margins, so its visible mark matches the others optically; no pixels are cropped. Logos sit on white only, because the PRM mark has an opaque white square and Audacy orange fights Volt.

## Resume visible word count

**482 words.** v1 had 376, so this is +28%. The count covers all text nodes in `<body>`, including the band, captions and toolkit. Body text is 9.4 pt, captions 8.5 pt, and the smallest text is the mono dates at 7.8 pt.

The cover letter body (salutation plus four paragraphs) is **203 words**, inside the 180–260 range. 271 words are visible on the page in total.

## Page-count check

Rendered with the BRIEF's headless Chrome command, then checked with the BRIEF's counter:

```
resume.pdf 1
cover-letter.pdf 1
```

This counter always reports 1 page for a fixed-height `overflow:hidden` sheet, so I also measured the real content bottom in headless Chrome. The credentials section ends at 10.49 in of 11 in, so nothing is clipped.

I looked at the PDFs once. The first resume render clipped the credentials row. The fix was a tighter band and readout padding, dropping the footer line and PRM's duplicate location, a narrower toolkit label column, and shortening the JobBored bullet (the Google Sheets API moved to the toolkit). Body text then went from 9.2 to 9.4 pt to use the recovered space. On the letter, the date's mixed mono digits were removed. Both PDFs were re-rendered, then I stopped.

## Claims used (all 13)

| Claim | Resume | Letter |
|---|---|---|
| elio-platform | Elio bullet 1, toolkit | P3 |
| elio-forecast | readings (21, $2.4M), Elio bullet 2 | P3, footer readings |
| elio-ops | Elio bullet 3, toolkit Operations | P3 ("keys, service accounts, schedules") |
| jobbored-claude-code | Elio bullet 4 | none |
| audacy-book | readings ($10M+, top-3 / #19), Audacy bullet 1 | P2, footer readings |
| audacy-framework | Audacy bullet 2 (10 AE desks; Looker Studio, GA4 from the claim's tools) | P2 |
| audacy-metric | readings (130%, 13%), Audacy bullet 3 | none |
| audacy-earlier-sme | Audacy 2017 to 2021 sub-row | none |
| prmi-sem | PRM bullet | none |
| hormiga-playbook | Ventures (18-idea) | none |
| bucketz-launch | Ventures | none |
| certs | Credentials | none |
| education | Credentials, with the CC logo | none |

"Ramping: Power BI and DAX" comes from the ledger's `toolInventory` (level none, transferFrom Looker Studio, GA4, SQL) and matches the letter's own line. The letter's "25 skills and 15 connections" is 3E's operating model from v1's argument. It is kept in the letter and deliberately kept off the resume, where a readout strip would imply Emilio owns those numbers. The letter's "$10M" was changed to the ledger's verbatim "$10M+". Nothing else in the letter changed except typography.

Dropped from v1 as not ledger-backed: Python, GTM, REST + webhooks.

## What it costs to turn this into the renderer's template

About 1 to 1.5 days.

- **Fixed chrome (cheap):** the band, scale, gutter grid and spec table are pure CSS. The scale is two repeating gradients, with no images.
- **Readout strip (the real work):** the renderer needs a rule for choosing 4 to 6 metric tokens from `claims[].metrics`, grouping them by `employerId` into channels, and writing a short caption per token. The ledger's `unit` field is close to a caption but not quite ("YoY paid-search conversion growth" works; "book" needs "digital book owned"). Grid column spans derive from the group sizes.
- **Logos:** add a per-logo optical-size table (height and margin), because the Elio PNG's padding and Audacy's wordmark shape need different boxes. The renderer's logo resolver already supplies the files.
- **Fit guard:** fixed-height sheets make the PDF page counter blind to clipping. The template needs the same bottom-of-content measurement used here, and a fallback that drops the Ventures row, then the Ramping row, when content overflows.
- **Fonts:** vendor Archivo (width axis) and Martian Mono into `vendor/fonts/` so rendering never depends on the network.

## Polish r2 (2026-09-25, after Emilio picked take C)

The round-1 files are kept as `*-r1.html` and `*-r1.pdf`, untouched.

**1. Logos sit beside the employer names.**
- Each employer head is now `[logo] Name  Seat` in one row, with the logo centred on the name.
- Heights are near take A's optical size: Elio 0.5 in (its visible mark is about 0.32 in, with the transparent padding offset by negative margins and never cropped), the Audacy wordmark 0.2 in, and PRM 0.34 in.
- PRM's mark now sits directly beside "Primary Residential Mortgage".
- The gutter now carries only dates and location.
- The KPI strip's bracket logos are gone from the resume, and each bracket now has a text label ("**Elio Intelligence Suite**, founder" / "**Audacy**, Digital Sales Manager, 2021 to 2026"). With the logos beside the names, a second set in the strip made the page read as two competing logo rows. The cover letter's footer strip keeps its bracket logos, because they are the only logos on the letter.

**2. Cover letter dead space is closed.** Body text went from 10.6 to 11.2 pt (leading 1.68), the lede from 14.5 to 16 pt, and the signature from 31 to 36 pt, with the measure widened to 5.6 in and paragraph spacing at 13 pt. The gap between the signature and the footer strip went from 1.19 in to 0.45 in.

**3. Wording now matches the claims exactly.**
- In the resume strip and the letter footer, the "$2.4M" caption now reads "of live pipeline, for a seller pitch", which is elio-forecast's own wording. It previously said "modeled".
- The Audacy framework bullet now reads "Wrote the bidding and attribution framework used in QBRs (last-click vs. assisted, incrementality, channel-to-stage movement) and trained 10 AE desks to defend it." That matches audacy-framework. The "Readouts ran in Looker Studio and GA4" sentence and "without me in the room" are gone.
- To hold density, three small additions come from claim tool fields: "reporting dashboards" (audacy-earlier-sme), "on Meta Ads and Shopify" (bucketz-launch), and PRM's location (the employers list).

**4. Fit (layout measurement in headless Chrome, sheet = 11.000 in):**

```
resume.pdf 1
  last content (credentials) bottom = 10.575 in  ->  0.425 in bottom margin, scrollHeight 11.000 (no overflow)
cover-letter.pdf 1
  signature bottom = 8.931 in, footer strip top = 9.382 in  ->  0.451 in gap
  footer strip bottom = 10.580 in  ->  0.42 in bottom margin, scrollHeight 11.000
```

The resume's visible word count is now **483**. The letter body is still 203 words.
