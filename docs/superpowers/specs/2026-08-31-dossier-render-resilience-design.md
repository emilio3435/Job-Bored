# Dossier & Brief Render Resilience — Architectural Specification

**Date:** 2026-08-31
**Status:** Proposed
**Diagnostic input:** `DOSSIER_RENDERER_INSPECTION_REPORT.md` (2026-08-31 inspection — all findings referenced below by section number)
**Companion plan:** `docs/superpowers/plans/2026-08-31-dossier-render-resilience.md`

---

## 1. Problem statement

Job-posting content enters JobBored from five sources (Cheerio scrape, ATS JSON APIs, SerpApi, Gemini URL-context, LLM enrichment) in five formats (HTML, entity-encoded HTML, Markdown, plain text, structured JSON). No stage of the pipeline owns "normalize this to one canonical shape," so every consumer improvises:

- `escapeHtml` double-escapes pre-encoded entities and prints raw tags/Markdown tokens on screen (report §2.2, §6).
- Paragraph structure is destroyed twice: Cheerio `.text()` concatenates blocks without separators (§4.1), and CSS `white-space: normal` collapses whatever newlines survive (§2.3.1).
- Fixed-index `slice()` truncation cuts words and UTF-16 surrogate pairs in half (§2.2.3, §3.1).
- `dawn-data.js` re-parses text with regexes that misclassify headings, drop numbered lists, and fragment tags/talking points on `,` `;` `·` (§3.2).
- The drop-cap attaches to quotation marks and ampersands (§2.3.3); long tokens overflow horizontally (§2.3.2).
- A background render while typing in Notes wipes the user's uncommitted text (§2.3.6); the loading skeleton unmounts the Notes textarea entirely (§2.1).

## 2. Architectural principle

> **Normalize at ingestion. Transport canonical text. Derive structure once. Render safely.**

Each pipeline stage gets exactly one text responsibility, enforced by two new shared modules — one per runtime:

```
┌──────────────────────────────────────────────────────────────────────┐
│ INGESTION (server + LLM callers)                                     │
│   owns: HTML→text, entity decode (exactly once), Markdown demotion,  │
│         list-glyph strip, single-line collapse                       │
│   module: server/shared/text-normalize.mjs                           │
│   output: **Canonical Job Text** (defined in §3)                     │
├──────────────────────────────────────────────────────────────────────┤
│ TRANSPORT (pipeline-render.js → data-* attrs on .kanban-card)        │
│   owns: attribute escaping, budget clipping (word/code-point safe),  │
│         JSON array serialization                                     │
│   module: jb-text.js (clip, escapeAttr)                              │
│   invariant: attribute names & budgets unchanged (contract)          │
├──────────────────────────────────────────────────────────────────────┤
│ DERIVATION (dawn-data.js → getRoleViewModel)                         │
│   owns: Canonical Job Text → block model {heading|p|bullets},        │
│         defensive re-normalization (self-heal for legacy cache)      │
│   module: jb-text.js (toBlocks, normalize*)                          │
├──────────────────────────────────────────────────────────────────────┤
│ PRESENTATION (role-brief.js + role.css)                              │
│   owns: block model → HTML, escape exactly once, typography,         │
│         overflow control, edit-focus protection                      │
│   module: jb-text.js (escapeHtml, clip) + role.css standards (§6)    │
└──────────────────────────────────────────────────────────────────────┘
```

The two modules are **pure-function, DOM-free** libraries so the existing `node:vm` test harness (see `tests/dossier-brief-structure.test.mjs`) can exercise them without a browser.

## 3. Canonical Job Text (the interchange contract)

Every multi-line description field (`description`, `data-jd-snippet`, `postingSummary`, `fitAngle`) is, after ingestion:

1. A JS string with **no HTML tags** and **entities decoded exactly once**.
2. `\n\n` = paragraph/section boundary. Single `\n` = line boundary inside a block (bullet item or soft wrap). Never `\n{3,}`.
3. Bullet lines start with `- ` (single canonical glyph). Numbered lists keep their `1. ` prefixes (meaningful order).
4. Heading lines end with `:` or are short ALL-CAPS lines — matching what `toBlocks` (§4.1) detects.
5. **No Markdown emphasis tokens**: `**b**`→`b`, `*i*`/`_i_`→`i`, `` `c` ``→`c`, `[t](url)`→`t (url)`. Heading markers (`## `) are permitted to survive in canonical text — `toBlocks` (§4.1) honors and strips them at derivation.
6. No control characters except `\n`/`\t`; no zero-width characters; NBSP → space; `\r\n`/`\r` → `\n`.

Single-line fields (`roleInOneLine`, `inferredTitle/Company/Location`, `employmentType`, `atsFitRationale`, every array item) additionally contain **no newlines** (collapsed to a single space).

### Decision D1 — Markdown is demoted, not rendered

LLM output frequently carries `**bold**` etc. (report §4.3.2). We **strip emphasis to plain text** rather than render an inline-Markdown subset. Rationale: the Brief's beauty comes from its editorial typography, not from LLM-chosen bolding; an inline renderer adds a parser, an XSS review surface, and test weight for marginal gain. Structural Markdown (headings, bullets, numbered lists) **is** honored — it maps onto the block model. The seam to revisit: `renderInlineHtml()` in role-brief.js is the single place emphasis-preserving rendering would slot in later.

### Decision D2 — Entity decode is one-shot at ingestion, pattern-gated self-heal at derivation

New server output arrives decoded. The client still re-runs `decodeEntities` at derivation because the `jb_enrichment_v1` localStorage cache (300 entries, §4.3.5) holds years of un-normalized text. The decoder only rewrites well-formed patterns (`&#\d+;`, `&#x[0-9a-f]+;`, ~30 named entities), so clean text passes through untouched; literal `&amp;` typed by a human is the one accepted casualty. `&amp;lt;` decodes to `&lt;` (one level), never to `<` — decode order is numeric → named-non-amp → `&amp;` last, which guarantees single-level decoding and keeps the renderer's escape-exactly-once invariant intact.

## 4. Module APIs

### 4.1 `jb-text.js` → `window.JobBoredText` (client, classic-global IIFE, loaded with `defer` before `jb-ui.js`)

```js
window.JobBoredText = {
  decodeEntities(s),      // §3/D2. Pattern-gated, single-level.
  normalizeInline(s),     // single-line fields: decode → strip zero-width/control →
                          // newlines+NBSP→space → strip Markdown emphasis → collapse spaces → trim
  normalizeMultiline(s),  // multi-line fields: decode → \r\n→\n → strip control (keep \n\t) →
                          // strip Markdown emphasis per line → collapse \n{3,}→\n\n → trim
  stripMarkdownInline(s), // **b**→b, *i*→i, _i_→i, `c`→c, [t](u)→"t (u)"; leaves lone * / _ alone
  stripListGlyph(s),      // ^\s*([-*•·‣▪–—]|\d{1,2}[.)])\s+ → "" (one leading glyph only)
  itemText(x),            // string → itself; object → .text|.name|.value|.label; else "" — kills [object Object]
  toBlocks(s),            // Canonical Job Text → [{kind:"heading",text} | {kind:"p",text} | {kind:"bullets",items:[]}]
  clip(s, max),           // code-point-safe, word-boundary back-off ≤ 24 chars, trailing-punct trim, "…"
  escapeHtml(s),          // & < > " ' (the existing five)
  escapeAttr(s),          // escapeHtml + \n → &#10; (explicit attr newline encoding)
};
```

`toBlocks` rules (replaces `_splitJdSections`, fixing §3.2.1):

- Split blocks on `\n{2,}`; split lines on `\n`.
- A line is a **bullet** if it matches `^([-*•·‣▪]|\d{1,2}[.)])\s+` — numbered and Unicode glyphs now count. A non-bullet, non-blank line immediately following a bullet **continues that bullet** (fixes wrapped-bullet fragmentation).
- A block's first line is a **heading** only when: (a) Markdown `^#{1,6}\s+`, or (b) it ends with `:` and is ≤ 80 chars (periods and lowercase now allowed — `U.S. Requirements:` works), or (c) it is ALL-CAPS, 3–60 chars. The old "short first line without terminal punctuation" fallback is **deleted** — it was amputating the first line of ordinary paragraphs (§3.2.1, §6 "Missing Paragraphs").
- A paragraph's lines join with a single space (soft wrap).

`clip` (replaces every `String(s).slice(0, n)` / `b.slice(0, 297) + "…"`):

- Returns unchanged when `length ≤ max`.
- Cuts at `max - 1`, drops a trailing lone high surrogate, backs off to the last space when one exists within 24 chars of the cut, trims trailing punctuation/space, appends `…`. Result length ≤ `max`.

### 4.2 `server/shared/text-normalize.mjs` (ESM, Node)

```js
export function decodeHtmlEntities(s)         // same contract as client decodeEntities
export function htmlToText(html)              // block-aware strip:
   // decode entities first (Greenhouse double-encodes, §ats stripHtml), drop <script>/<style>,
   // <br> → \n, <li> → "\n- ", </p> </div> </h1-6> </ul> </ol> </table> </section> → \n\n,
   // </tr> → \n, </td> </th> → " · ", every other tag → " ", then whitespace discipline (§3.2)
export function normalizeJobText(s)           // plain text → Canonical Job Text (no tag handling)
export function normalizeInlineField(s)       // server mirror of client normalizeInline
export function normalizeListItems(arr, max)  // itemText coercion + glyph/Markdown strip + dedupe + cap
```

`htmlToText` supersedes `stripHtml` in `ats-job-fetchers.mjs` (which currently emits **single** `\n` for `</p>`, so ATS paragraphs collapse into one client-side block) and becomes the JSON-LD `description` path in `job-scraper-core.mjs`. The Cheerio DOM path gets a `blockText($, node)` walker that inserts the same separators between block elements, fixing `"About UsWe are"` (§4.1, §6).

## 5. Per-stage behavioral changes

### 5.1 Ingestion

| Surface | Change |
|---|---|
| `ats-job-fetchers.mjs` `stripHtml` | Delegate to shared `htmlToText`; paragraphs become `\n\n`, list items `\n- ` |
| `job-scraper-core.mjs` | `findBestDescriptionFromDom` / `largestTextBlock` use `blockText` instead of `normalizeSpace($el.text())`; `textFromJobPostingLd` decodes entities on the no-`<` branch |
| `gemini-url-context-scrape.mjs` | Pipe returned text through `normalizeJobText` |
| `job-posting-insights.js` `normalizeEnrichmentJson` | Single-line fields via `normalizeInline`; `postingSummary`/`fitAngle` via `normalizeMultiline`; arrays via `itemText` + `stripListGlyph` + `stripMarkdownInline` (fixes §4.3.2/§4.3.3) |
| `job-posting-insights.js` `parseLooseFieldValue` | Comma-split only when the value has no newlines/semicolons **and** ≥ 3 commas (stops shredding `"Denver, CO"`, §4.3.4) |

### 5.2 Transport (`pipeline-render.js`)

- `_clip` → `JobBoredText.clip`; `data-jd-snippet`'s `slice(0, 4000)` → `clip(jdRaw, 4000)`. **Budgets unchanged** (240/1200/800/500/4000 — they are transport budgets, not display truncation).
- `_attrEsc` → `escapeAttr` (newlines explicitly `&#10;`).
- Attribute names, JSON array shapes, and `data-enrichment-status` values are **frozen contract** — `tests/dossier-card-attrs.test.mjs` keeps passing unmodified.

### 5.3 Derivation (`dawn-data.js`)

- `_splitJdSections` reimplemented on `toBlocks`; view-model `jdSections` keeps its `{heading, body, bullets}` shape (consumers unchanged) — a block group = one section: heading + joined paragraph text + bullet items.
- `_parseTagsFromCard`: try `JSON.parse` first (future-proof), else legacy `/[,;|]+/` split; chip fallback selector gains `.kanban-card__tag` (§3.2.3).
- `_parseTalkingPointsFromCard`: when the attr contains `\n`, split on newlines **only**; the `;`/`·` split applies only to single-line values (§3.2.2).
- `_parseJsonArrayAttr` and `_parseEnrichmentFromCard` route items through `itemText` + `normalizeInline` — legacy cached entities and `[object Object]` self-heal here (D2).

### 5.4 Presentation (`role-brief.js`, `role.js`, `role.css`)

- **Multi-paragraph fields render as blocks.** `renderLede` and `renderFitAngle` split their text with `toBlocks`: first paragraph keeps its pinned class (`.brief__lede`, `.brief__fit-body`); subsequent paragraphs render as sibling `<p>`s with a `--cont` modifier; bullets inside a summary render as a `<ul>`. Newlines stop vanishing (§2.3.1) without resorting to `white-space: pre-wrap`.
- **List items**: `_structSection` and `renderTalkingPoints` apply `itemText` → `stripListGlyph` → `clip(·, 300)` — no more `• - Item`, `[object Object]`, or mid-word cuts (§6).
- **Drop cap is conditional** (D4): `renderLede` adds `brief__lede--dropcap` only when the first paragraph starts with a letter (`/^\p{L}/u`, ASCII fallback); `role.css` moves the `::first-letter` rules under that class (§2.3.3).
- **Tags threshold** (D5): render whenever ≥ 1 tag (the `<= 3` suppression goes away, §6); the 18-chip cap stays.
- **Skeleton keeps user data** (D3): while `enrichment.status === "loading"`, render masthead + skeleton + the Notes block. Notes are the user's own text — never AI-stale — and unmounting them mid-flight was the report's §2.1 finding. Skim/tags/talking-points stay out (AI-adjacent, the original atomic-replace intent stands).
- **Focus guard covers every edit surface and defers instead of dropping** (D6): `editFieldFocusedIn` matches `[data-action="edit-field"], [data-action="notes"]`; a blocked render records the pending jobKey and a region-level `focusout` listener flushes it after blur. Typing is never wiped (§2.3.6) *and* the dossier is never left stale after editing (the current guard silently discards renders).

## 6. Typography, layout & visual standards (`role.css`)

Design-token source of truth stays `style.css:159-177` (parchment palette; `--serif` Lora, `--sans` DM Sans, `--mono` JetBrains Mono) — **no token value changes**. Additions, all scoped under `.brief`:

1. **Overflow discipline**: `overflow-wrap: anywhere; min-width: 0;` on body-copy containers — `.brief__hook`, `.brief__lede`, `.brief__fit-body`, `.brief__struct li`, `.points li`, `.skim .val`, `.brief__skill-chip`, and `min-width: 0` on `.brief__col`. URLs and long tokens wrap instead of escaping the parchment (§2.3.2).
2. **Drop cap**: `.brief__lede--dropcap::first-letter` carries the existing 56px Lora crimson float; bare `.brief__lede::first-letter` rules are removed.
3. **Paragraph rhythm**: `.brief__lede--cont`, `.brief__fit-body--cont` — same face/size as their lead paragraph, `margin-top: 0.75em`, no drop cap. Bullets inside the lede block reuse `.brief__struct li` metrics.
4. **Editable fact fallback**: keep `field-sizing: content`; where unsupported, role-brief sets an inline `width: min(len+1, 40)ch` on `.brief__fact-input` at render (feature-detected via `CSS.supports`), replacing the fixed 12ch clip (§2.3.4).
5. Single-line masthead `<input>`s stay single-line by design (title/company are identity fields, not prose) — unchanged.

## 7. Contracts, schemas & test suites

**Frozen (must keep passing unmodified):**

- Events: `jb:role:opened/closed/enriched/note/writeback/action`, `jb:pipeline:rendered/move` — names and detail shapes.
- DOM contract: `data-mount="brief"`, `data-stable-key`, all `data-action` values, every `data-*` attribute name/budget in `pipeline-render.js` (§3.1 table), `.brief__*` class names asserted by `tests/dossier-brief-structure.test.mjs` and `tests/dossier-card-attrs.test.mjs`.
- Sheet Interface A (`AGENT_CONTRACT.md`, `schemas/pipeline-row.v1.json`) — untouched.
- `tests/dossier-workshop-events.test.mjs`, `tests/flowing-writes-stage-resolve.test.mjs`, `tests/role-materials*.test.mjs`.

**Updated in place (assertions extended, never weakened):** `dossier-brief-structure`, `role-field-edit-render-guard`, `enrichment-self-heal`, `job-scraper-ats-api`, `job-scraper-gemini-url-context`, `scribe`, `letter-compose-panel`.

**New suites:** `jb-text.test.mjs`, `text-normalize.test.mjs`, `dossier-brief-content-formats.test.mjs`, `dawn-data-jd-blocks.test.mjs`, `insights-normalization.test.mjs`.

Gate: `npm test` (`scripts/run-tests.mjs`, includes `tests/integration/`) — the only command that counts (per project memory: `node --test tests/*.test.mjs` silently skips integration).

## 8. Out of scope / explicitly deferred

- Inline Markdown emphasis rendering (D1 seam documented).
- Materials editor convergence (`scribe.js` `htmlFromPlainText`, `letter.js` `writeTextToEditor`, `resume-generation.js` previews) is Phase 5 of the plan — optional polish; their paragraph handling is already correct, they only lack Markdown demotion.
- The Dossier's exclusion of `.md` materials cards (§5.1.2) — by design, unchanged.
- `flowing-writes.js` URL normalization (§3.3) — a writeback-routing concern, not a rendering one; flagged for a separate fix.
- Legacy drawer renderers in `pipeline-render.js` (drawer-ai-section et al.) — the drawer shares attrs, so it inherits ingestion/derivation fixes for free; its own render code is not touched.
