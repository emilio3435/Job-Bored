# The Case — Content Fit Specification

**Date:** 2026-09-03
**Status:** Locked — decisions taken by Emilio in chat 2026-09-03 00:55 CDT (§9)
**Scope:** make The Case's layout follow its content and make its content earn its place. No new surfaces, no new events, no sheet schema change.
**Source of findings:** live review of `http://localhost:8080` on Emilio's real sheet (CSC Generation · Director, Lifecycle Marketing & CRM; Figma · AE Enterprise; four unenriched roles), 2026-09-02 23:50–00:30 CDT, in the Comet browser. Every number below was measured on the live DOM, every cause was read in source before it entered this document.

---

## 1. What the live page showed

| Measured | Value |
|---|---|
| `.case` height at 1268×1170 | 4,244 px |
| `They want` lane height | 3,455 px — 25 requirements, 21 chips, 3 nice-to-haves, no cap |
| `You have` lane content ends at | ~500 px, then 2,900 px of blank parchment (grid stretch) |
| `Your moves` lane content ends at | ~900 px |
| `You have` strengths | `P&L management)` · `CRM` · `AI` · `API` · `APIs` · `AI integrations` |
| `You have` gaps | the same sentence three times as fragments (`Proven omni-channel acumen (eCommerce, physical retail, and experient…` / `Proven omni-channel acumen (eCommerce` / `experiential)`) + `CDP` + `SMS` |
| Figma AE Enterprise strengths | `[<|"|>AI (Claude` · `OpenAI` · `Gemini` · `Grok` · `Llama` |
| Requirement bullets | posting section headers glued to bullet tails: `…performance narrative. Automation & Technology`, `…capability edge. Customer Intelligence & CDP`, `…for leadership. Loyalty Program` |
| Talking points on 3 of 5 queued roles | identical: `Lead with AI systems experience — multi-model routing, RAG, GCP deploy` (sheet column, agent boilerplate, on marketing and sales roles) |
| Talking points on the enriched role | third-person gerunds written for the agent: `Discussing his experience in…` |
| `Found` date on every role | `2026-09-03` — tomorrow, at 23:50 CDT on 09-02 |
| Small | `Last contact` placeholder reads `Aug 30` (looks like data); follow-up shows the browser's raw `mm/dd/yyyy`; salary renders a grey `Salary` label and nothing; every materials row says `Not drafted` **and** a `Missing` pill |

The fixture we shipped against had 3 requirements and 4 chips. None of this could show.

## 2. Root causes (file:line, current `main` 58366b6)

| # | Cause | Where |
|---|---|---|
| C1 | Board is `repeat(3, minmax(0,1fr))` with default `align-items: stretch`; lane count is fixed regardless of which lanes render. | `role-case.css:106-107` |
| C2 | Requirements, nice-to-haves and stack are concatenated with no cap, no order, no dedupe beyond exact lowercase. | `role-case-model.js:290-292` |
| C3 | The keyword fallback prints analyzer *search terms* as if they were claims. The analyzer deliberately fragments requirements on `;,|`/`and`/`or`, drops items over 8 words, truncates labels at 72 chars — correct for matching, wrong for display. | `keyword-profile-match.js:236-245, 274-279` → `role-case-model.js:187-194` |
| C4 | Raw LLM control tokens (`[<|"|>`) survive `cleanItem`, which only knows delimiters, code fences and headings. | `structured-output-validator.js:75-90` |
| C5 | `guessRequirementsFromText` pushes any 9–199-char line inside the requirements window as a bullet, so a section header line lands as its own item, and boards that flatten headers into the preceding paragraph produce the glued tails. Nothing downstream splits a terminal-punctuation sentence from a trailing Title-Case heading. | `server/shared/job-scraper-core.mjs:1290-1312` |
| C6 | Sheet `Talking Points` (column Q) is the fallback whenever enrichment has not run, with no check that the text is specific to the row. | `role-case-model.js:325`, `dawn-data.js:1223` |
| C7 | Prompt asks for "3-5 short bullets for interview prep" with no voice or anchoring rule. | `job-posting-insights.js:100-105` |
| C8 | Date Found = `requestedAt.toISOString().slice(0,10)` — the UTC calendar day. | `integrations/browser-use-discovery/src/sheets/pipeline-writer.ts:228-230`, `source-adapters.ts:264` |
| C9 | Placeholders and labels: `placeholder="Aug 30"`; native `type="date"` with no empty-state text; `placeholder="Salary"`; doc row prints `not drafted` sub **and** a `missing` status pill. | `role-case.js:47-50, 260-262`, `role-materials.js:721-751` |

## 3. Design

### 3.1 The board follows its lanes (C1)

- `.case__board` gets `align-items: start`. A lane is exactly as tall as its content.
- The renderer counts the lanes it actually emitted and stamps `data-lanes="1|2|3"` on the board. CSS: three lanes → `repeat(3, 1fr)`; two → `repeat(2, 1fr)`; one → `1fr`. The empty third column seen in `V1-case-desktop.png` cannot recur.
- Below 1080px the board is already one column; unchanged.

### 3.2 "They want" is ranked, capped, and disclosable (C2)

Model (`theyWant`):
```
requirements: [{ text, status, evidence: { snippet, source } | null }]   // full list, ordered
visibleCount: 8                                                            // constant, spec-owned
stack:        [...]  capped at 12 after dedupe; stackHidden: n
```
- Order: `missing` → `partial` → `found` → `unknown`; stable within a rank (posting order). The reader sees what they lack first, because that is what the next hour of work is about.
- Dedupe before the cap, one rule: normalize case and singular/plural (`API` ≡ `APIs`); then drop any single-token chip whose token appears inside another chip that has ≥ 2 significant tokens (`AI` drops because `AI integrations` exists; `CRM` stays because no longer chip contains it). The surviving chip carries the strongest status of the pair.
- Renderer: the first `visibleCount` requirements render; the rest render inside a `<div class="case__more" hidden>` behind a `<button data-action="toggle-requirements" aria-expanded="false">Show all 25</button>`. The toggle is client-state only: no writeback, no event, no persistence beyond the open role. `aria-controls` points at the hidden div. When the total ≤ `visibleCount`, no button.
- Nice-to-haves keep their own list (they are short) but sit inside `.case__more` when the requirements were collapsed, so the lane's visible height is bounded.
- Stack chips: 12 visible, then one quiet `+9 more` chip that expands in place; same `data-action="toggle-stack"`.

### 3.3 "You have" becomes evidence beside the demand (C3) — decision §9-2

- The keyword-fallback **lane is removed.** `buildYouHave` returns `source: "none"` when there is no scorecard; `renderYouHave` already hides on `none`.
- Each requirement that the analyzer marks `found` or `partial` carries `evidence`: the first profile sentence (≤ 140 chars, clipped on a word boundary with `JobBoredText.clip`) that contains a matched variant or ≥ half of the term's significant tokens, with `source` = the profile section it came from when the excerpt is labelled, else `"profile"`. New analyzer API `findProfileEvidence(term, index)` reads `searchIndex.rawText`; the analyzer already builds that index and throws the text away today.
- Renderer: under a marked requirement, one line: `<span class="case__req-ev">“…sentence…” <i>from your resume</i></span>`. Serif, 12.5px, muted ink, indented under the text column. No evidence line on `missing`/`unknown`. Only the visible 8 get evidence lines by default; expanded ones get them too — no separate fetch, it is in the model.
- With a scorecard present the lane still renders **gaps**, **dimensions**, **evidence quotes** and the `Scored <date>` stamp — but never `strengths` as a bare list; `topStrengths` from the scorecard are shown only when each is ≥ 3 significant tokens (a claim, not a noun).

### 3.4 Content validation before render (C4, C5)

`JobBoredText` gains two pure helpers, mirrored in `server/shared/text-normalize.mjs`:
- `stripControlTokens(s)`: removes `[<|`, `<|…|>`, `|>`, `<|"|>` and lone `[<` / `>]` residue, then re-trims.
- `isFragment(s)`: true when any of — unbalanced `(`/`)` or quotes; starts with a lowercase letter and the previous character context is unknown **and** has < 3 significant tokens; ends in `,` `;` `and` `or`; < 2 significant tokens and not in the analyzer's known-tools alias table. Documented in the test as the single rule.
- `splitHeadingTail(s)`: if `s` ends with a terminal-punctuation sentence followed by a ≤ 6-word run with no terminal punctuation and Title Case on ≥ 60% of words, return `{ body, heading }`. The model applies it to every requirement and drops `heading` (it is the *next* section's name, not a requirement).

`structured-output-validator.cleanItem` calls `stripControlTokens` first, and `cleanList` drops items where `isFragment` is true, marking `polluted` so provenance still says `unverified`.

The model applies `isFragment` to scorecard gaps and strengths too. A gap that is a prefix of another gap (the truncated-sentence triplet) collapses to the longest.

### 3.5 Talking points earn their place (C6, C7) — decision §9-3

- `collectDeps` reads column Q across `getPipelineRawRows()` once per render and passes `sheetPointCounts: Map<normalizedText, rowCount>`. The model drops any sheet-sourced point whose normalized text appears on ≥ 2 rows. Enrichment points are never filtered this way.
- Prompt (`job-posting-insights.js`): `talkingPoints` description becomes: *"3-5 points, each ≤ 25 words, second person, imperative, opening with a verb (Lead with…, Show…, Ask about…). Each point names ONE must-have from this posting and the candidate-profile fact that answers it. Never a gerund opener, never third person."* `fitAngle` gets the same voice sentence. The schema and field names do not change; cached enrichments keep the old voice until re-enriched, and the Case shows them as-is (no client-side rewriting of AI prose).
- Renderer: unchanged shape (`01`, `02`…). With zero points after filtering, the `Say this` sub-block does not render.

### 3.6 Dates are the user's calendar day (C8)

`buildLeadRow` formats Date Found from `discoveredAt` in the worker's local zone (`Intl.DateTimeFormat("en-CA", { timeZone: process.env.TZ || undefined })` style `YYYY-MM-DD`), never `toISOString().slice(0,10)`. `mergeExistingRow` still keeps the original on re-discovery. The dashboard's read side already parses either.

### 3.7 Labels tell the truth once (C9)

- `Last contact` placeholder → `Add a date`. `Salary` placeholder → `Add salary` (posting salary as placeholder stays).
- Follow-up: keep `type="date"`; wrap in `.case__date` and render a sibling `<span class="case__date-empty">Not set</span>` that CSS shows only while the input's value is empty (`input:placeholder-shown`, `input[value=""] + span` — lane picks the reliable one and tests it), so the raw `mm/dd/yyyy` never reads as content.
- Doc rows: when `status === "missing"`, the status pill is dropped and the sub-line `not drafted` is the one label; the `Draft` button stays. `ready`/`failed`/`drafting` unchanged.

## 4. Model schema delta (the F1 ⇄ M2 contract)

```js
theyWant: {
  requirements: [{ text, status, evidence: { snippet, source } | null }],  // ranked, deduped, header-tails removed
  visibleCount: 8,
  niceToHaves: [{ text, status }],
  stack: [{ text, status }],   // ≤ 12
  stackHidden: [{ text, status }],
  hasMatchData: bool,
}
youHave: { source: "scorecard" | "none", ... }   // "keywords" is no longer a value
moves.talkingPoints: [string]                     // sheet boilerplate already removed
```
Everything else in the CaseModel is unchanged. Every `data-action` value that exists today is frozen; two are added: `toggle-requirements`, `toggle-stack` (both client-only, both `aria-expanded`).

## 5. Frozen

`jb:*` event names and shapes · Sheet Interface A · `recruiter-strip.js` · every existing `data-action` · the enrichment JSON schema field names · `role.js` focus guard selector.

## 6. Out of scope

Grouping by posting section (§9-1 rejected) · auto-enrich on open (already happens: opening a role runs enrichment; the four "unenriched" roles had simply never been opened) · the stuck Materials Queue toast (the API on :3847 was down during the review; `renderUnreachable` behaved correctly) · the login gate leaking the Today panel (separate, onboarding program).

## 7. Verification that would have caught this

- A **real-shape fixture**: a posting with 25 requirements, 21 stack items, 3 nice-to-haves, two glued header tails, one `[<|"|>` token, one truncated triplet gap. Lives in `tests/e2e-fixtures/` and is used by both the node:vm render tests and the Playwright smoke.
- Playwright assertions at 1240px: tallest lane ≤ 1.6 × shortest rendered lane; ≤ 8 `.case__req li` visible before the toggle; the toggle reveals all; `[<|` appears nowhere in `.case` text; `data-lanes` equals the rendered lane count.
- Model tests name the real strings from §1 verbatim as inputs.

## 8. Success

Opening CSC Generation at 1268px shows the whole board — rail, numbers, three lanes to their first fold — in under two screens, with no blank column, no fragment, no control token, no boilerplate point, and every visible requirement that the resume answers carrying the sentence that answers it.

## 9. Locked decisions (Emilio, 2026-09-03 00:55 CDT) — override anything contrary above

1. **They want:** top 8 by gap (missing → partial → found), rest behind `Show all N`; chips capped at 12 and deduped.
2. **You have:** requirement-anchored evidence; the keyword-fallback lane goes away; the lane survives only for scorecard output.
3. **Sheet talking points:** render only when unique across rows; identical text on ≥ 2 rows is suppressed.
4. **Workers (per-run directive):** FE lane runs **Spark 1.3 via the native `muse` CLI**, not Opus. Opus and Fable are preserved: no Opus lanes this run; Fable 5.1 orchestrates only.
