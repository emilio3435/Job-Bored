# Comprehensive Codebase Inspection Report: Dossier & Brief Rendering Subsystem

**Repository:** `Job-Bored`  
**Target Surface:** Dossier & Brief Rendering Subsystem (v2 flowing-page UI)  
**Inspection Date:** 2026-08-31  
**Scope:** `role.js`, `role-brief.js`, `role.css`, `dawn-data.js`, `pipeline-render.js`, `flowing-writes.js`, `job-posting-insights.js`, `posting-enrichment.js`, `server/shared/job-scraper-core.mjs`, `server/shared/ats-job-fetchers.mjs`, `role-materials.js`, `materials-queue.js`, `scribe.js`, `letter.js`, `resume-bundle.js`, `resume-generation.js`.

---

## Table of Contents
1. [Architecture & Data Flow Overview](#1-architecture--data-flow-overview)
2. [UI & Presentation Layer Inspection (`role.js`, `role-brief.js`, `role.css`)](#2-ui--presentation-layer-inspection)
3. [Data Serialization & View-Model Parsing Inspection (`pipeline-render.js`, `dawn-data.js`, `flowing-writes.js`)](#3-data-serialization--view-model-parsing-inspection)
4. [Scraper, Extraction & LLM Synthesis Inspection (`job-posting-insights.js`, `posting-enrichment.js`, `server/`)](#4-scraper-extraction--llm-synthesis-inspection)
5. [Application Materials & Document Rendering Inspection (`role-materials.js`, `materials-queue.js`, `scribe.js`, `letter.js`)](#5-application-materials--document-rendering-inspection)
6. [Factual Matrix of Observed Artifacts & Code Origins](#6-factual-matrix-of-observed-artifacts--code-origins)

---

## 1. Architecture & Data Flow Overview

The JobBored Dossier is rendered in the v2 flowing-page interface (`body.jb-v2`) inside `<section data-region="role">`.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Data Ingestion Sources                          │
│  - Google Sheets (Pipeline Tab)                                        │
│  - Cheerio HTML Scraper / ATS Endpoints / SerpApi Google Jobs          │
│  - Gemini URL Context Tool                                             │
│  - LLM Structured Enrichment (Gemini / OpenAI / Anthropic / Local)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               DOM Data Transport (`pipeline-render.js`)               │
│  - Serializes fields into HTML `data-*` attributes on `.kanban-card`   │
│  - Clips strings to fixed character bounds (240 to 4,000 chars)        │
│  - Serializes arrays to JSON strings via `JSON.stringify()`            │
│  - Escapes attributes via `escapeHtml()`                               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│            View-Model Reconstruction (`dawn-data.js`)                 │
│  - `getRoleViewModel(jobKey)` queries `.kanban-card[data-stable-key]`  │
│  - Scrapes title/company from DOM text nodes                           │
│  - Parses `data-*` attributes via `_splitJdSections`, JSON.parse, etc. │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Dossier Presentation (`role-brief.js`)                   │
│  - `renderBrief(briefRoot, vm)` renders HTML string template           │
│  - Passes all fields through `escapeHtml()`                            │
│  - Mounts into `[data-mount="brief"]`                                  │
│  - Appends Application Materials via `role-materials.js`               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. UI & Presentation Layer Inspection

### 2.1 Text Rendering Functions in `role-brief.js`

#### `renderMasthead(job)` (`role-brief.js:136-228`)
- **Inputs:** `job.role`, `job.company`, `job.employment`, `job.location`, `job.salary`, `job.source`, `job.links`.
- **Rendered Output:**
  - `job.employment`: Rendered as `<div class="brief__eyebrow">` + `escapeHtml(eyebrowText)` + `</div>`.
  - `job.role`: Rendered inside a single-line input: `<input type="text" class="brief__title" data-action="edit-field" data-field="title" data-original="<escaped>" value="<escaped>" aria-label="Role title" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">`.
  - `job.company`: Rendered inside a single-line input: `<input type="text" class="brief__company" data-action="edit-field" data-field="company" data-original="<escaped>" value="<escaped>" aria-label="Company" ...>`.
  - `job.location`: Rendered inside `<input type="text" class="brief__fact-input" data-action="edit-field" data-field="location" ...>`.
  - `job.salary`: Rendered inside `<input type="text" class="brief__fact-input" data-action="edit-field" data-field="salary" ...>`.
  - `job.source`: Rendered as `<span>via ` + `escapeHtml(job.source)` + `</span>`.
  - `postingHref`: Derived via `pickPostingHref(job)` (`safeHref` validation for `/^https?:|^mailto:/i`). Rendered as `<a href="<escaped>" target="_blank" rel="noopener" class="brief__cta brief__cta--view">`.

#### `renderHook(hookText)` (`role-brief.js:232-235`)
- **Resolution Hierarchy (`pickHook`, lines 94-107):**
  1. `job.enrichment.roleInOneLine`
  2. `job.companyTagline`
  3. `job.jdSections[0].body`
  4. `job.jdSections[0].bullets[0]`
  5. `job.jdSnippet`
  6. `""` (empty string)
- **Rendered Output:** If non-empty, returns `<p class="brief__hook">` + `escapeHtml(hookText)` + `</p>`.

#### `renderLede(job, hookText)` (`role-brief.js:237-257`)
- **Resolution Hierarchy (`pickLede`, lines 111-124):**
  1. `job.enrichment.postingSummary` (if not strictly equal to `hookText`).
  2. `job.jdSections[0].body` (if not strictly equal to `hookText`).
  3. `""` (empty string).
- **Word Count:** `jdTotalWords(job.jdSections)` sums non-whitespace tokens (`\S+`) across all section bodies and bullets.
- **Rendered Output:**
  ```html
  <div class="brief__lede-block">
    <p class="brief__lede">escapeHtml(lede)</p>
    <div class="brief__lede-tag">escapeHtml(tag)</div>
  </div>
  ```
  Tag text is `"AI Summary · grounded in the posting"` when derived from `postingSummary`, or `"Compressed by JobBored AI · from X words"` when derived from JD text.

#### `renderFitAngle(job)` (`role-brief.js:262-272`)
- **Resolution:** Primary `job.enrichment.fitAngle`, fallback `job.enrichment.fitAssessment`.
- **Rendered Output:**
  ```html
  <section class="brief__fit">
    <h3 class="section-label">Why this role fits</h3>
    <p class="brief__fit-body">escapeHtml(text)</p>
  </section>
  ```

#### `renderEnrichedSections(job)` & `_structSection(label, items, cls)` (`role-brief.js:276-300`)
- **Mapped Sections:**
  - `_structSection("Must-haves", enr.mustHaves, "must")`
  - `_structSection("Responsibilities", enr.responsibilities, "resp")`
  - `_structSection("Nice-to-haves", enr.niceToHaves, "nice")`
  - `_structSection("Tools & stack", enr.toolsAndStack, "tools")`
- **Processing within `_structSection`:**
  - Converts items: `items.map(x => String(x || "").trim()).filter(Boolean)`.
  - Slices array to maximum 12 items: `arr.slice(0, 12)`.
  - Truncates item text: `b.length > 300 ? b.slice(0, 297) + "…" : b`.
  - Escapes each bullet: `'<li>' + escapeHtml(s) + '</li>'`.
  - Rendered Output:
    ```html
    <section class="brief__struct brief__struct--<cls>">
      <h3 class="section-label">escapeHtml(label)</h3>
      <ul><li>...</li></ul>
    </section>
    ```

#### `renderSkim(job)` (`role-brief.js:366-403`)
- **Data Rows:**
  - `ATS Fit`: `Number(enr.atsFitScore)`. Rounded and clamped to `[0, 100]` with `title="escapeHtml(enr.atsFitRationale)"`.
  - `Signals`: `enr.extraKeywords.slice(0, 3).join(" · ")`.
  - `Comp`: `job.salary`.
  - `Location`: `job.location`.
- **Rendered Output:** Wrapped inside `<ul class="skim">...</ul>`.

#### `renderTalkingPoints(job)` (`role-brief.js:405-428`)
- **Resolution:** Primary `enr.talkingPoints`, fallback `job.jdSections[0].bullets`.
- **Processing:** Sliced to maximum 6 items: `bullets.slice(0, 6)`.
- **Rendered Output:**
  ```html
  <section class="points">
    <h3 class="section-label">Talking points</h3>
    <ul><li>escapeHtml(b)</li></ul>
  </section>
  ```

#### `renderTagsAndSkills(job)` (`role-brief.js:433-445`)
- **Source:** `job.tags`.
- **Threshold Rule:** `if (tags.length <= 3) return "";` (completely suppresses rendering if 3 or fewer tags).
- **Processing:** Sliced to maximum 18 chips: `tags.slice(0, 18)`.
- **Rendered Output:** `<section class="brief__tags"><h3 class="section-label">Tags &amp; skills</h3><div class="brief__tag-cloud"><span class="brief__skill-chip">escapeHtml(t)</span>...</div></section>`.

#### `renderNotes(job)` (`role-brief.js:447-455`)
- **Source:** `job.notes && job.notes.body`.
- **Rendered Output:**
  ```html
  <div class="brief-notes">
    <h3 class="section-label">Notes</h3>
    <textarea data-action="notes" placeholder="...">escapeHtml(body)</textarea>
  </div>
  ```

#### `renderEnrichmentLoading(job)` (`role-brief.js:306-362`)
- **Trigger:** `job.enrichment.status === "loading"`.
- **Rendered Output:** Hardcoded skeleton placeholder with badge `<span class="brief__skeleton-badge">AI &middot; Gemini</span>`, four animated CSS status lines, and shimmer placeholder bars.
- **Behavior in `renderBrief`:** When loading, `briefRoot.innerHTML = mastheadHtml + loadingHtml;`, unmounting the entire body of the brief.

---

### 2.2 Escaping, Sanitization, and Truncation Mechanics

1. **`escapeHtml` Function Implementation (`role-brief.js:52-60`):**
   ```javascript
   function escapeHtml(s) {
     if (s == null) return "";
     return String(s)
       .replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;")
       .replace(/'/g, "&#39;");
   }
   ```
   - Escapes only 5 ASCII characters (`&`, `<`, `>`, `"`, `'`).
   - Does not decode entities before escaping. Pre-encoded HTML entities (e.g. `&amp;`, `&quot;`, `&#39;`, `&nbsp;`, `&lt;`, `&gt;`, `&ndash;`, `&mdash;`, `&rsquo;`) become double-escaped to `&amp;amp;`, `&amp;quot;`, `&amp;#39;`, `&amp;nbsp;`, displaying literal entity text.
   - Raw HTML tags (`<p>`, `<br>`, `<strong>`, `<ul>`, `<li>`, `<div>`, etc.) are converted to entity strings (`&lt;p&gt;`, `&lt;strong&gt;`), displaying literal tag strings on screen.

2. **Absence of Markdown Processing:**
   - There is no Markdown parser in `role.js`, `role-brief.js`, or `role.css`.
   - Markdown formatting syntax (`**bold**`, `*italics*`, `_italics_`, `# headings`, `[links](url)`, `` `code` ``, ```` ```code blocks``` ````, `- bullets`, `> quotes`) passes through `escapeHtml` unaltered and displays as raw punctuation characters.

3. **Character Truncation in `_structSection`:**
   - Truncation rule: `b.length > 300 ? b.slice(0, 297) + "…" : b`.
   - Slices on raw character index without word-boundary checking, cutting words in half.
   - Slicing executes *prior* to `escapeHtml(s)`.

4. **Object Coercion:**
   - `_structSection`, `renderTalkingPoints`, and `_parseJsonArrayAttr` call `String(x)`. If an array contains objects (e.g. `[{ text: "..." }]`), `String(x)` outputs `"[object Object]"`.

---

### 2.3 CSS Styles & Layout Properties (`role.css`)

1. **White-Space Behavior:**
   - Explicit `white-space: nowrap` is set only on `.brief__cta span`, `.skim .key`, `.brief__skeleton-status-line`, and `.brief-materials__progress-elapsed`.
   - All body copy containers (`.brief__hook`, `.brief__lede`, `.brief__fit-body`, `.brief__struct li`, `.points li`, `.brief__facts`) have no `white-space` property defined, defaulting to `white-space: normal`.
   - Single newlines (`\n`) and double newlines (`\n\n`) within strings collapse into single horizontal spaces in the browser.

2. **Word Break & Text Overflow:**
   - No `overflow-wrap: break-word`, `word-break: break-word`, or `word-break: break-all` properties are declared on `.brief__title`, `.brief__company`, `.brief__hook`, `.brief__lede`, `.brief__fit-body`, `.brief__struct li`, `.points li`, `.skim .val`, or `.brief__skill-chip`.
   - Continuous unbroken strings (e.g. URLs or long alphanumeric strings) overflow their containers horizontally.

3. **Drop-Cap (`::first-letter`) Styling on `.brief__lede` (`role.css:537-546`):**
   ```css
   .brief__lede::first-letter {
     font-family: var(--serif);
     font-weight: 600;
     float: left;
     font-size: 56px;
     line-height: 0.9;
     padding: 6px 10px 0 0;
     color: var(--crimson);
   }
   ```
   - If `lede` begins with a quotation mark (`"`, `“`, `'`, `‘`), digit, symbol, or HTML entity (starting with `&`), the 56px floated style attaches to that punctuation mark or ampersand rather than the first alphabetical character.

4. **Editable Fact Input Fallback (`role.css:323-338`):**
   - `.brief__fact-input` uses `field-sizing: content;` with fallback `width: 12ch;`. In browser engines lacking `field-sizing` support (Safari < 17.4, Firefox < 128), text longer than 12 characters is clipped horizontally within the input box.

5. **Single-Line Constraints on Titles (`role.css:263-300`):**
   - `.brief__title` and `.brief__company` are rendered as `<input type="text">` elements, constraining titles to a single non-wrapping line.

6. **Focus Guard Vulnerability in `role.js` (`role.js:236-240`):**
   ```javascript
   function editFieldFocusedIn(region) {
     if (!region) return false;
     var ae = document.activeElement;
     return !!(ae && ae.matches && ae.matches('[data-action="edit-field"]') && region.contains(ae));
   }
   ```
   - The focus guard checks only `[data-action="edit-field"]` (masthead inputs) and does not check `[data-action="notes"]` (`textarea`).
   - If a background `jb:pipeline:rendered` or `jb:role:enriched` event fires while a user is typing in the Notes textarea, `renderDossier` rebuilds `region.innerHTML`, wiping uncommitted text.

---

## 3. Data Serialization & View-Model Parsing Inspection

### 3.1 Serialization to DOM in `pipeline-render.js`

`pipeline-render.js` (lines 190–250) builds the `v2Attrs` string placed on `<article class="kanban-card">`:

| Attribute Name | Source Field | Processing / Character Limit |
|---|---|---|
| `data-jd-snippet` | `job._postingEnrichment.description \|\| job.fitAssessment` | `String(jdRaw).slice(0, 4000)` |
| `data-notes` | `job.notes` | Full string |
| `data-location` | `job.location` | Full string |
| `data-salary` | `job.salary` | Full string |
| `data-job-url` | `job.link` | Full string |
| `data-source` | `job.source` | Full string |
| `data-applied-at` | `job.appliedDate` | Full string |
| `data-found-at` | `job.dateFoundRaw` | Full string |
| `data-follow-up` | `job.followUpDate` | Full string |
| `data-tags` | `job.tags` | Full string |
| `data-fit` | `job.fitScore` | `Number.isFinite(job.fitScore) ? String(job.fitScore) : ""` |
| `data-replied` | `job.responseFlag` | `"yes"` if `/^(yes\|replied\|y)$/i`, else `""` |
| `data-talking-points` | `job.talkingPoints` | Full string |
| `data-contacts` | `job.contact` | `JSON.stringify([{ name: String(job.contact).trim() }])` |
| `data-company-tagline` | `_enr.aboutCompany` | Full string |
| `data-employment` | `_enr.employmentType` | Full string |
| `data-role-in-one-line` | `_enr.roleInOneLine` | Clipped to **240 chars** (`_clip(_enr.roleInOneLine, 240)`) |
| `data-posting-summary` | `_enr.postingSummary` | Clipped to **1,200 chars** (`_clip(_enr.postingSummary, 1200)`) |
| `data-fit-angle` | `_enr.fitAngle` | Clipped to **800 chars** (`_clip(_enr.fitAngle, 800)`) |
| `data-fit-assessment` | `job.fitAssessment` | Clipped to **800 chars** (`_clip(job.fitAssessment, 800)`) |
| `data-must-haves` | `_enr.mustHaves` | Max **16 items**, `JSON.stringify()` |
| `data-nice-to-haves` | `_enr.niceToHaves` | Max **16 items**, `JSON.stringify()` |
| `data-responsibilities` | `_enr.responsibilities` | Max **16 items**, `JSON.stringify()` |
| `data-tools-and-stack` | `_enr.toolsAndStack` | Max **16 items**, `JSON.stringify()` |
| `data-ats-fit-score` | `_enr.atsFitScore` | Integer string `0`–`100` |
| `data-ats-fit-rationale` | `_enr.atsFitRationale` | Clipped to **500 chars** (`_clip(_enr.atsFitRationale, 500)`) |
| `data-extra-keywords` | `_enr.extraKeywords` | Max **16 items**, `JSON.stringify()` |
| `data-ai-talking-points` | `_enr.talkingPoints` | Max **16 items**, `JSON.stringify()` |
| `data-enrichment-status` | `job._enrichmentLoading` / `_enr` | `"loading"`, `"ready"`, or `""` |

#### Edge Cases in Serialization:
- **`_clip(s, n)`**: Uses `String(s).slice(0, n)` without boundary checks, truncating mid-word.
- **UTF-16 Surrogate Splitting**: `slice(0, n)` can split 4-byte Unicode surrogate pairs (e.g. emojis), generating lone surrogates.
- **Line Breaks in Attributes**: Literal `\n` characters are placed directly into HTML attributes without numeric character entity conversion (e.g. `&#10;`).

---

### 3.2 View-Model Parsing in `dawn-data.js`

`dawn-data.js` reconstructs the view model via `getRoleViewModel(jobKey)` (lines 1196–1285):

1. **`_splitJdSections(jd)` (lines 974–1000):**
   ```javascript
   function _splitJdSections(jd) {
     var raw = String(jd || "").trim();
     if (!raw) return [];
     var blocks = raw.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
     return blocks.map(function (b) {
       var lines = b.split(/\n/).map(l => l.trim()).filter(Boolean);
       var heading = "";
       var first = lines[0] || "";
       if (/^[A-Z][^.?!]{0,60}:$/.test(first) || (first.length < 60 && lines.length > 1 && !/[.?!]$/.test(first))) {
         heading = first.replace(/:$/, "");
         lines = lines.slice(1);
       }
       var bullets = [];
       var bodyLines = [];
       lines.forEach(function (l) {
         if (/^[-*•·]\s+/.test(l)) bullets.push(l.replace(/^[-*•·]\s+/, ""));
         else bodyLines.push(l);
       });
       return { heading: heading, body: bodyLines.join(" "), bullets: bullets };
     });
   }
   ```
   - **Double Newline Dependency:** Splitting occurs strictly on `\n{2,}`. Single-newline text is parsed as a single block.
   - **Heading Regex `/^[A-Z][^.?!]{0,60}:$/`:**
     - Requires starting with uppercase ASCII (`[A-Z]`). Lowercase headings (`"requirements:"`) or numeric prefixes (`"1. Qualifications:"`) fail.
     - Character class `[^.?!]` rejects headings with periods (e.g. `"U.S. Requirements:"`, `"Node.js Stack:"`).
   - **Heading Fallback `first.length < 60 && lines.length > 1 && !/[.?!]$/.test(first)`:**
     - If the first line of a multi-line paragraph is a short clause without punctuation (e.g. `"We are seeking an engineer\nwho has experience with..."`), line 1 is extracted as `heading: "We are seeking an engineer"` and deleted from `body`.
     - Standalone single-line headings without colons (`lines.length === 1`) are not recognized as headings.
     - Markdown headings (`## Requirements`) retain leading `#` characters in `heading`.
   - **Bullet Regex `/^[-*•·]\s+/`:**
     - Fails on numbered lists (`1. `, `2. `) and unicode bullets (`‣`, `▪`, `–`, `—`), classifying them as `bodyLines` and joining them with spaces.
     - Multi-line wrapped bullets: Continuation lines lack bullet markers and are moved to `bodyLines`, fragmenting the bullet text.

2. **`_parseTalkingPointsFromCard(card)` (lines 1100–1109):**
   - Splits on regex `/\n|·|;/`. Any talking point containing a semicolon (`;`) or middle dot (`·`) is split into multiple bullet fragments.

3. **`_parseTagsFromCard(card)` (lines 1016–1029):**
   - Splits `data-tags` on regex `/[,;|]+/`. Compound tag values like `"C#; .NET"`, `"Austin, TX"`, or `"UI | UX"` are split into separate fragments.
   - Fallback searches `.skill-chip` inside the card; kanban cards use class `.kanban-card__tag`, so the fallback returns `[]`.

4. **`_parseNotesFromCard(card)` (lines 1083–1099):**
   - Queries `.drawer-notes__input` inside `.kanban-card` (where it does not exist), falling back to `data-notes`.

5. **`_parseJsonArrayAttr(card, name)` (lines 1144–1157):**
   - Encloses `JSON.parse(raw)` in a `try...catch` block that returns `[]` on syntax errors without logging.

6. **Secondary Truncation of `jdSnippet`:**
   - `job.jdSnippet` is truncated to 160 characters via `_truncate(jd, 160)` in `getRoleViewModel`.

---

### 3.3 Writeback Handlers in `flowing-writes.js`

- **Sheet Mappings (`flowing-writes.js:14-22`):**
  - `jb:pipeline:move`: Writes stage enum to `Pipeline!M{row}`.
  - `jb:role:note`: Writes note body to `Pipeline!O{row}`.
  - `jb:role:writeback` (`title`, `company`, `location`, `salary`): Delegates to `JobBored.editJobField`, updating columns `B`, `C`, `D`, `G` and setting edit lock column `Y` to `"LOCKED"`.
  - `jb:role:writeback` (`heardBack`, `reply`, `followupAt`, `passed`): Updates columns `R`, `S`, `P`, `M`.
- **Row Resolution (`resolveSheetRow`, lines 18-97):**
  - Step 1: Normalized URL lookup against `Pipeline!E:E` cache.
  - Step 2: DOM row attribute check (`data-sheet-row` on `.kanban-card`).
  - Step 3: Card DOM URL lookup.
  - Step 4: Numeric fallback treating `jobKey` directly as 1-based row index.
- **URL Normalization Discrepancy:** `normalizeUrl` only executes `u.trim().toLowerCase()`. Trailing slashes, query parameters, and hash fragments are not stripped.

---

## 4. Scraper, Extraction & LLM Synthesis Inspection

### 4.1 Extraction in `server/shared/job-scraper-core.mjs`

1. **Cheerio DOM Text Concatenation:**
   - `$.text()` retrieves the text of all descendant text nodes.
   - When adjacent block tags (`<div>`, `<p>`, `<li>`, `<tr>`) lack separating whitespace in source HTML, text strings are concatenated without spaces (e.g. `<div>About Us</div><div>We are...</div>` becomes `"About UsWe are..."`).

2. **Table & Link Processing:**
   - Table structure tags (`<table>`, `<tr>`, `<td>`, `<th>`) are stripped without row/column delimiter insertion.
   - Link tags (`<a>`) lose their `href` attributes; only inner text is extracted.

3. **JSON-LD Description Entity Handling:**
   - In `textFromJobPostingLd()`, if `description` contains `<`, it passes through `stripTags()` (`cheerio.load()`).
   - If `description` contains no `<`, it passes to `normalizeSpace(d)`. Pre-encoded entities like `&amp;` or `&quot;` in non-HTML JSON-LD strings are not decoded.

---

### 4.2 Gemini URL Context in `job-posting-insights.js`

- `fetchViaGeminiUrlContext(postingUrl)` calls Gemini with `tools: [{ url_context: {} }]` and prompt requesting a plain-text extract with section headers.
- Returned raw text is placed directly into `description` without Markdown or HTML filtering.

---

### 4.3 LLM Output Schema & Normalization in `job-posting-insights.js`

1. **Schema Structure (`ENRICHMENT_SCHEMA`, lines 15–108):**
   - 14 required properties: `inferredTitle`, `inferredCompany`, `inferredLocation`, `postingSummary`, `roleInOneLine`, `mustHaves`, `responsibilities`, `niceToHaves`, `toolsAndStack`, `atsFitScore`, `atsFitRationale`, `fitAngle`, `talkingPoints`, `extraKeywords`.

2. **Observed Raw LLM Artifacts:**
   - **Markdown Tokens:** String fields (`postingSummary`, `fitAngle`, `roleInOneLine`, `atsFitRationale`) and array elements (`mustHaves`, `responsibilities`, `toolsAndStack`) frequently contain `**bold**`, `*italics*`, `_italics_`, and `` `code` `` backticks.
   - **Leading Bullet Glyphs:** Array items generated by LLMs may contain leading `- `, `* `, `• `, or `1. ` prefixes.
   - **Internal Line Breaks:** Single-line fields (`roleInOneLine`, `inferredLocation`) occasionally contain `\n` or `\r\n`.

3. **Normalization Behavior (`normalizeEnrichmentJson`, lines 364–382):**
   - Applies `String(parsed[key] || "").trim()` to strings and `strArr()` to arrays.
   - Does not perform Markdown stripping, HTML entity decoding, HTML tag removal, or leading bullet glyph stripping.

4. **Loose Key-Value Fallback Parsing (`parseLooseFieldValue`, lines 195–208):**
   - For array fields, splits strings on regex `/\n|;|,(?=\s*[A-Z0-9])/`.
   - Commas followed by uppercase letters (e.g. `"Denver, CO"`, `"React, TypeScript"`) are split into separate items.

5. **LocalStorage Cache (`posting-enrichment.js:25-151`):**
   - Stored in `localStorage` under `jb_enrichment_v1`. Max 300 entries.
   - `stored.description` is sliced to 8,000 chars (`ENRICHMENT_CACHE_DESC_LIMIT`). All other fields are stored unclipped.

---

## 5. Application Materials & Document Rendering Inspection

### 5.1 Document Allowlist & Visibility in `role-materials.js`

1. **Server Allowlist (`role-materials.js:38-48` & `server/application-materials.mjs:24-34`):**
   - `resume.pdf` (PDF, inline: true)
   - `resume.html` (HTML, inline: true)
   - `cover-letter.pdf` (PDF, inline: true)
   - `cover-letter.html` (HTML, inline: true)
   - `qa-report.md` (Markdown, inline: false)
   - `job-analysis.md` (Markdown, inline: false)
   - `job-description.md` (Markdown, inline: false)
   - `manual-apply-checklist.md` (Markdown, inline: false)
   - `manifest.json` (JSON, inline: false)

2. **Dossier Visibility Filter (`role-materials.js:644-650`):**
   ```javascript
   var docs = docsAll.filter(function (d) {
     return d.type === "resume" || d.type === "cover_letter";
   });
   ```
   - Only `resume` (Tailored Resume) and `cover_letter` (Cover Letter) are rendered as cards in the Dossier.
   - All `.md` files (`qa-report.md`, `job-analysis.md`, `job-description.md`, `manual-apply-checklist.md`) and `manifest.json` are excluded from the Dossier card grid.

3. **Preview & Download Actions (`role-materials.js:366-388`):**
   - **Preview Link:** Rendered as `<a class="brief-materials__btn brief-materials__btn--primary" href="[fileUrl]" target="_blank" rel="noopener">Preview</a>`.
     - File format preference (`pickPreviewFile`): `"html"` → `"pdf"` → `"md"` → first available.
     - Opens in a new browser tab; no inline preview or reader modal exists in the Dossier.
   - **Download Link:** Rendered as `<a class="brief-materials__btn brief-materials__btn--ghost" href="[fileUrl]?download=1&v=[version]" download>Download PDF</a>`.
     - Filters specifically for `format === "pdf"`.

4. **HTTP MIME Types (`server/index.mjs:793-819`):**
   - `.html` served as `text/html; charset=utf-8`
   - `.pdf` served as `application/pdf`
   - `.md` served as `text/markdown; charset=utf-8`
   - `.json` served as `application/json; charset=utf-8`

---

### 5.2 Document Drafting & Preview Renderers (`scribe.js`, `letter.js`, `resume-generation.js`)

1. **`scribe.js` Editor Conversion (`scribe.js:234-248`):**
   - `htmlFromPlainText`: Splits text on `/\n{2,}/`. Escapes `&`, `<`, `>`, converts `\n` to `<br />`, wraps paragraphs in `<p data-scribe-anchor="p-[idx]">`.
   - Does not parse Markdown; raw Markdown tokens appear as text in the editor.

2. **`letter.js` Editor Conversion (`letter.js:139-152`):**
   - `writeTextToEditor`: Splits on `/\n{2,}/`, escapes HTML, converts `\n` to `<br>`, wraps in `<p>`.
   - Does not parse Markdown.

3. **`resume-generation.js` Modal Previews (`resume-generation.js:164-204`):**
   - `formatCoverLetterPreviewHtml`: Splits on `/\n\s*\n/`, escapes HTML, converts `\n` to `<br />`, wraps in `<p class="doc-preview__p">`.
   - `formatResumePreviewHtml`: Splits on `\n`. All-caps lines (`^[A-Z0-9\s&/\-–—:,.]+$`, length 3–56) wrap in `<h2 class="doc-preview__section">`; empty lines become `<div class="doc-preview__gap">`; regular lines wrap in `<p class="doc-preview__resume-line">`.

4. **Insights Sentinel Markers (`resume-generate.js:222-287`):**
   - Scans for delimiters `---JB-INSIGHTS---` and `---END-JB-INSIGHTS---`.
   - Strips the sentinel block from `cleanText` and parses the enclosed JSON payload.
   - If the sentinel delimiters are malformed or missing, sets `insightsError` and displays an error banner.

---

## 6. Factual Matrix of Observed Artifacts & Code Origins

| Observed Artifact / Non-Human Text | Root Code Location | Underlying Mechanism |
|---|---|---|
| **Raw Markdown Bold/Italics (`**text**`, `*text*`, `_text_`)** | `role-brief.js:52-60, 276-300, 405-428` | Passed through `escapeHtml()` without Markdown parsing. Rendered as literal asterisk/underscore characters. |
| **Raw Markdown Headings (`#`, `##`, `###`)** | `dawn-data.js:974-1000`, `role-brief.js:237-257` | `_splitJdSections` retains leading `#` characters in `heading`; `renderLede` escapes and prints `#` verbatim. |
| **Raw Markdown Links (`[Title](https://...)`)** | `role-brief.js:232-272` | `escapeHtml()` escapes bracket characters; URL is not converted into an HTML `<a>` link. |
| **Double-Escaped HTML Entities (`&amp;amp;`, `&amp;quot;`, `&amp;#39;`, `&amp;nbsp;`)** | `role-brief.js:52-60` | `escapeHtml` replaces `&` with `&amp;` without checking for pre-existing entities. |
| **Raw HTML Tags (`<p>`, `<br>`, `<strong>`, `<ul>`, `<li>`)** | `role-brief.js:52-60`, `server/shared/job-scraper-core.mjs` | `escapeHtml()` escapes brackets into `&lt;` and `&gt;`, displaying the literal tag names in the browser. |
| **Flattened Paragraphs & Missing Line Breaks** | `role.css:328, 497, 530, 683, 1359` | Elements use default `white-space: normal`. Single and double newlines collapse into inline spaces. |
| **Punctuation Styled as Giant Drop-Caps** | `role.css:537-546` | `.brief__lede::first-letter` floats and expands first character (56px), attaching to initial quotes (`"`, `“`), digits, or ampersands (`&`). |
| **Mid-Word Truncated Text (`"Architec…"`)** | `role-brief.js:283`, `pipeline-render.js:198` | `_clip(s, n)` and `b.slice(0, 297) + "…"` slice on fixed character indices without word boundary checks. |
| **Duplicate Bullet Glyphs (`• - Item`, `• • Item`)** | `role-brief.js:282-288`, `role.css:1372-1383` | CSS pseudo-element `::before` injects a bullet point, while LLM string retains its own leading `- `, `* `, or `• `. |
| **Literal `"[object Object]"` Strings** | `role-brief.js:278`, `dawn-data.js:1152` | `String(x)` is called on array elements that contain objects instead of primitive strings. |
| **Fragmented Talking Points & Split Sentences** | `dawn-data.js:1100-1109` | `_parseTalkingPointsFromCard` splits on semicolons (`;`) and middle dots (`·`). |
| **Fragmented Tag Chips (`"Austin"`, `"TX"`)** | `dawn-data.js:1016-1029` | `_parseTagsFromCard` splits on commas (`,`), semicolons (`;`), and pipes (`\|`). |
| **Missing Paragraphs in JD Sections** | `dawn-data.js:984-987` | `_splitJdSections` incorrectly classifies the first line of a multi-line paragraph as a heading if length < 60 and terminal punctuation is absent. |
| **Merged Words from Scraped HTML (`"About UsWe are"`)** | `server/shared/job-scraper-core.mjs:485` | Cheerio `$.text()` concatenates block elements without inserting whitespace or newline delimiters. |
| **Zero Tags Rendered for 1–3 Tags** | `role-brief.js:437` | `renderTagsAndSkills` enforces `if (tags.length <= 3) return "";`. |
| **Unmounted Dossier Body during AI Loading** | `role-brief.js:468-471` | When `enr.status === "loading"`, `renderBrief` overwrites `briefRoot.innerHTML` with skeleton HTML only. |
| **Wiped User Notes on Background Events** | `role.js:236-240, 294-307` | `editFieldFocusedIn` does not check `textarea[data-action="notes"]`, triggering DOM replacement while typing. |
