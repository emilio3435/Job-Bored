# Design — Materials v3 visual system ("Volt")

**Date:** 2026-09-17
**Status:** spec for review
**Branch:** `cursor/materials-v3-volt-redesign-9fed`
**Companions:** [operating mechanism](2026-09-17-materials-v3-mechanism-design.md) · [implementation plan](../plans/2026-09-17-materials-v3.md) · [side-by-side vs #117](../../materials-v3/side-by-side.md) · [3E mocks](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/)
**Supersedes:** the "Readout" visual language in PR #117 (`docs/materials-v2/`), rejected as archaic and document-y

---

## 1. Why the previous visual language was rejected

Materials v2 fixed the right structural problems (one page, claim selection, anti-filler voice) and then dressed them in a 1960s annual report: warm cream paper (`#efe4cf`), Newsreader serif for the name and thesis, a forest-green rail printed down the page edge, a letterpress inset border, a diagonal newsprint grain behind the sheet, a folio, and italic display type carrying emphasis. Every one of those choices signals *archive*. None of them signals the person who ships a multi-model platform on Cloud Run.

The critique v2 was answering said "print-first document, not a heavy HTML template." v2 read that as *make it look like print history*. The correct reading is *make it look like something made in 2026 that happens to print perfectly*.

Volt keeps v2's discipline (one column, one page, no chips, no skill bars, no tag soup) and replaces the entire surface: white sheet, contemporary grotesk, one electric accent, and whitespace used as the primary design material.

---

## 2. Design targets, stated as constraints

| Target | Constraint it becomes |
| --- | --- |
| Sleek | Two type families, one accent color, one column, zero borders around content |
| Minimalist | Nothing on the page that is not a claim, a label, or a hairline |
| Modern | No serif anywhere. Grotesk display with negative tracking; mono for micro-labels only |
| *Llamativo* | Exactly three signature moves (§5). A fourth is a bug |
| High craft | Optical sizes in points, hairlines at 0.5pt, no rounded corners, no shadows in print |
| Generous whitespace | The fit solver drops a claim rather than tightening leading, and holds back a 0.2in band so a page never reads full to the edge |
| Prints cleanly | `@page` letter, margin 0, sheet owns padding, accent carries no information |
| Passes ATS | Single text flow, real headings, no images, no columns carrying unique content, `.txt` twin generated from the render model |

---

## 3. Tokens

Defined once in `volt.css`, consumed by both templates. Values are the mock's values; they are the spec.

### Color

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#ffffff` | The sheet. Not cream. Not textured |
| `--ink` | `#0b0b0f` | Name, org names, statement, metric runs |
| `--ink-80` | `#2a2a33` | Body copy and bullets |
| `--ink-55` | `#5d5d6b` | Seat lines, contact, secondary prose |
| `--ink-35` | `#8e8e9c` | Mono micro-labels, dates, footer |
| `--hair` | `#e6e6ee` | 0.5pt rules |
| `--hair-strong` | `#d2d2de` | Token separators |
| `--volt` | `#4a24ff` | Electric indigo. The only accent |
| `--volt-wash` | `rgba(74,36,255,.13)` | Statement highlight band |

Accent rules: the indigo appears in the caret, the leading segment of the masthead rule, the `/` before each section label, bullet ticks, link underlines, and the statement wash. That is the whole list. It never fills a shape, never sits behind body text, and never encodes data — print the document in grayscale and nothing is lost.

### Type

| Role | Family | Size / metrics |
| --- | --- | --- |
| Name | Geist 600 | 27pt / 0.92 / `-0.038em` |
| Statement (resume thesis) | Geist 400 | 12.8pt / 1.38 / `-0.013em`, max 6.3in measure |
| Org name | Geist 600 | 10.6pt / `-0.02em` |
| Seat line | Geist 400 | 9pt, `--ink-55` |
| Bullet | Geist 400 | 9.3pt / 1.45 |
| Letter body | Geist 400 | 10.5pt / 1.7, max 5.4in measure |
| Target title | JetBrains Mono 500 | 7.3pt, uppercase, `0.2em` |
| Section label | JetBrains Mono 500 | 6.6pt, uppercase, `0.24em` |
| Dates / contact / rail / footer | JetBrains Mono 400–500 | 6.4–7.1pt |
| Metric run (`.n`) | JetBrains Mono 500 | `0.93em`, `-0.02em` |

Both families are already vendored in the app (`vendor/fonts/fonts.css`: Geist + JetBrains Mono, self-hosted woff2, captured 2026-06-10). Templates link that stylesheet, so materials need no new font binaries, no network at render time, and no per-mock font copies. Fallback stack is `Inter → Helvetica Neue → Arial` and `ui-monospace → Menlo`; a fallback render shifts metrics slightly and still fits, because the fit solver measures the real layout (see the mechanism spec, §7).

**Forbidden:** any serif, any italic as an emphasis device, any display face for UI-sized text, any third family.

### Space

| Token | Value |
| --- | --- |
| Sheet | 8.5in × 11in, `overflow: hidden` |
| Sheet padding | `0.62in 0.66in 0.5in` |
| Date rail column | `0.98in`, gutter `0.26in` |
| Letter body grid | `1fr 1.15in`, gutter `0.34in` |
| Section rhythm | 16pt between sections, 12pt between entries, 4.5pt between bullets |
| Statement air | 19pt above |

---

## 4. Layout grammar

### Resume (one page, `volt.resume`)

```
masthead      name + caret            |  contact block (mono, right-aligned)
              target title (mono)     |
rule          indigo segment → hairline, full width
statement     2–3 lines, one highlighted clause, 6.3in measure
/ experience  label + hairline
  entry       [dates · location]  [org / seat / 2–4 bullets]
  entry       [dates · location]  [org / seat / 2–4 bullets]
/ earlier     label + hairline
  entry       [dates]             [org — roles / one line, or nothing]
/ selected for this role   13 tokens, slash-separated, one or two lines
/ education               one line
footer        hairline, tailored-for line, 1 / 1
```

Two featured employers is the default, three is the ceiling, and a second page requires an explicit page budget with a reason (mechanism spec §7.3). There is no capabilities section, no taxonomy, no certification list, and no project cards.

### Cover letter (one page, `volt.letter`)

```
index         name · cover letter · company · date     (mono, tracked, hairline under)
              ~0.5in of air
masthead      name + caret / target title  |  contact
rule          indigo segment → hairline
letter body   [prose, 5.4in measure]        | [rail: To / Re / Date]
              salutation
              p1 thesis · p2 analytics proof · p3 AI-ops proof · p4 next step
sign          "Best," / name + caret / mono contact line
footer        hairline, doc · company · role, 1 / 1
```

The narrow measure plus the metadata rail is the letter's whole idea: it looks designed, and it reads in one pass. **Rail rule:** the rail may only restate metadata that also appears in the prose or the header (recipient, role, date). It may never carry a unique claim. That keeps `cover-letter.txt` lossless and keeps a positional PDF parser from dropping information.

---

## 5. The three signature moves

These are the *llamativo*. They are deliberately few, and the spec caps them at three so the system cannot drift back into ornament.

1. **The caret.** A `0.3in × 3pt` indigo bar set on the baseline immediately after the name, in both documents and again above the letter signature. It reads as a cursor, a text-selection mark, a level indicator — a builder's mark rather than a monogram. It is the only ornament in the system.
2. **The statement.** The resume opens with a 12.8pt two-to-three-line argument in the top third, with one clause carrying a soft indigo wash (`--volt-wash`, a 0.44em band anchored to the baseline — a highlighter, not a hyperlink). It is the "hero line" move from modern product pages, applied to the one place a resume actually needs it. A hiring manager should be able to repeat it out loud after fifteen seconds.
3. **Metrics as data.** Verified numbers render in JetBrains Mono 500 inside otherwise-Geist prose (`$2.4M`, `top-3`, `130%`, `25`, `15`). Numbers look like instruments, prose stays prose, and nothing becomes a chart. This is also a correctness feature: metric runs are produced by the deterministic tagger from ledger-verified tokens, so a number the model invented cannot be typeset as data (mechanism spec §6.4).

Supporting details that are *not* signature moves and should stay quiet: the `/ label` + hairline section headers, the 6pt indigo bullet tick, the mono date rail, the leading indigo segment on the masthead rule.

---

## 6. Screen versus print

The screen view is part of the design. Opening a generated resume should not look like opening a Word file.

- **Screen:** the sheet is a white page floating on `#07070b` with an indigo radial glow and a long soft shadow. Above it, one mono strip states the template, document, page count, word count, and target role.
- **Print:** `@media print` drops the stage, the strip, and the shadow. `@page { size: 8.5in 11in; margin: 0 }`; the sheet owns its own margins, so browser print settings cannot reflow the layout.
- `print-color-adjust: exact` keeps the accent and the statement wash. Both are thin; the resume mock prints at 152KB and the letter at 108KB (the old letter PDF was ~449KB).

---

## 7. Forbidden list

Anything on this list is a review rejection, not a preference:

- serif type of any kind; italic as an emphasis device
- cream, ivory, sand, or textured paper; grain, noise, or diagonal hatching
- borders or inset frames around the page; printed page-edge rails
- section numbering (`00`, `§ 01`), folios, drop caps, pull quotes
- chips, pills, tag clouds, `data-tags` visible to a human
- skill bars, meters, radar charts, rating dots, progress indicators
- photos, logos, icon sets, emoji
- definition-list skill taxonomies; a capabilities page
- gradients on text; more than one accent color; accent used as a fill
- runtime JavaScript, CDN assets, or a tweaks/controls panel in the document
- reducing type size or leading to reach one page (drop a claim instead)

---

## 8. Template contract

Templates are dumb renderers over `materials.render-model.v1`. They carry **no candidate facts** — that is the structural break from the v1/v2 "master resume HTML that also happens to be the layout."

- Every text position is a field of the render model. Templates resolve `runs` arrays into `<span class="n">` and `<span class="hl">`; they never accept markup from a model.
- `data-slot` and `data-section` attributes exist for tests and QA extraction, not for Cheerio slot surgery.
- `data-claim` on each bullet and `data-claim-group` on each entry let QA map rendered output back to ledger claim IDs, which is how `invented_fact` and `ats_text_parity` are checked.
- Adding a section means adding a `kind` to the render model and a branch in the template. Sections are never hidden by CSS.

Mock files that are the acceptance snapshot: [`resume.html`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/resume.html), [`cover-letter.html`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/cover-letter.html), [`volt.css`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/volt.css), [`render-model.json`](../../materials-v3/mocks/3e-ai-marketing-analytics-manager/render-model.json).

---

## 9. Variants and user control

One family, two documents, and a small amount of taste — not a theme gallery.

| Knob | Values | Default |
| --- | --- | --- |
| `accent` | `volt` (indigo), `ink` (monochrome), `ember` (`#ff4a1f`), `pine` (`#0f7a5a`) | `volt` |
| `density` | `air` (0.66in padding), `standard`, `tight` (only reachable when the fit solver has already dropped everything droppable) | `standard` |
| `caret` | `on`, `off` | `on` |
| `rail` | `on`, `off` (letter only) | `on` |

`ink` exists for conservative industries and for grayscale printing; it flips `--volt` to `--ink` and the wash to a 7% gray. No other theme axis ships. `visual-themes.js` (five preview themes for the BYOK path) collapses onto this table — see the plan, slice 5.

---

## 10. Accessibility and robustness

- Body text is `--ink-80` on white (≈ 13:1). The lightest text on the page, `--ink-35` mono at 6.4pt, is used only for repeated metadata and clears 4.5:1.
- Reading order in the DOM matches visual order in both documents, including the letter rail (which is placed after the prose in the DOM and moved by grid).
- Links carry a visible underline, not color alone.
- The caret and hairlines are `aria-hidden` decorative elements with no text content.
- No animation, no JavaScript, no external requests at render time.

---

## 11. Acceptance criteria

A Volt render is acceptable when all of the following hold:

1. Resume PDF is exactly 1 page at template defaults; letter PDF is exactly 1 page.
2. Nothing is clipped by `overflow: hidden`, and the fit solver's 0.2in safety band is respected, so the page never reads full to the edge.
3. No token from the forbidden list (§7) appears in the HTML or CSS.
4. `resume.txt` / `cover-letter.txt` contain the statement and every featured bullet; the letter rail contributes nothing unique.
5. A grayscale print loses no information.
6. The document, opened on screen, is immediately distinguishable from a word processor default and from `docs/materials-v2/`.
