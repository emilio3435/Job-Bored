# KICKOFF M2 — model-truth (serial-first) · GPT 5.6 Sol xhigh via Codex

Read `docs/programs/casefit/GROUND-RULES.md`, then spec §3.2–3.5 and §4, then plan §2–3 (M2 rows).

## Mission
Make the CaseModel rank, cap, dedupe and validate what it hands the renderer, and give matched requirements the resume sentence that matched them. You are the only lane that touches the model; F1 renders whatever your §4 schema says.

## Fence (absolute)
`role-case-model.js`, `jb-text.js`, `structured-output-validator.js`, `keyword-profile-match.js` (only: a new exported `findProfileEvidence(term, searchIndex)` and an exported known-tools alias table; the existing fragmenting logic stays as is — it is correct for matching), `tests/role-case-model.test.mjs`, `tests/jb-text.test.mjs`, `tests/dossier-structured-output.test.mjs`, `tests/keyword-match-analyze-job.test.mjs`. Consume `tests/fixtures/text-normalize-vectors.json` when S3 lands it; until then author your vectors inline and move them when the file appears.

## Commit 1 (F1 is gated on it — land it within the first hour)
The §4 schema delta, minimally: `theyWant.requirements` ranked missing→partial→found→unknown with `evidence: null` on every item, `visibleCount: 8`, `stack` (≤12) / `stackHidden`, `youHave.source ∈ {"scorecard","none"}` (keyword branch returns `none`). Tests for ranking and for `source`. Message: `feat(casefit): rank and cap the They-want model; retire the keyword You-have branch`.

## Then, test-first, in this order
1. `JobBoredText.stripControlTokens`, `isFragment`, `splitHeadingTail` (spec §3.4) — vectors are the spec §1 strings verbatim: `P&L management)`, `[<|"|>AI (Claude`, `Proven omni-channel acumen (eCommerce`, `experiential)`, `…performance narrative. Automation & Technology`, `…capability edge. Customer Intelligence & CDP`.
2. `cleanItem` strips control tokens first; `cleanList` drops fragments and marks `polluted`.
3. Chip dedupe rule (spec §3.2, one rule): `API`≡`APIs`; `AI` drops beside `AI integrations`; `CRM` stays. Strongest status survives.
4. Header-tail split applied to every requirement; the tail is dropped.
5. `findProfileEvidence`: first sentence of `searchIndex.rawText` containing a matched variant or ≥ half the significant tokens; ≤ 140 chars via `JobBoredText.clip`; `{ snippet, source }`. `analyzeJob` result terms carry it; the model attaches it to found/partial requirements only.
6. `buildYouHave` scorecard branch: `topStrengths` kept only at ≥ 3 significant tokens; gaps collapse prefix-duplicates to the longest; `isFragment` applied to both.
7. `collectDeps` builds `sheetPointCounts` from `getPipelineRawRows()` column index 16 (split on newline, else `;`/`·`, normalized lowercase); model drops sheet points with count ≥ 2. Enrichment points are never filtered.

## Definition of Done
All seven items green, floor pasted in report §4, `LANE-REPORT-M2.md` complete, every commit local. Nothing outside the fence changed.
