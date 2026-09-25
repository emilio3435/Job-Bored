# The Case — Dossier Redesign Specification

**Date:** 2026-09-01
**Status:** Approved direction (canvas review 2026-09-01) — ready to plan
**Design source:** Artifact "Dossier Render Upgrade", page *Redesign*, board *The Case* (https://claude.ai/code/artifact/9ca7751f-c9d5-44d0-880f-010e30d72b84)
**Companion plan:** `docs/superpowers/plans/2026-09-01-dossier-case-redesign.md`
**Builds on:** `docs/superpowers/specs/2026-08-31-dossier-render-resilience-design.md` (text pipeline) — see §9 for exactly which of its phases this supersedes.

---

## 1. What changes and why

Today's Dossier is a brochure: an AI-written lede, a fit paragraph, four fixed lists, and a side rail. Its most prominent content is its least reliable (free-form LLM prose), while the most reliable signals the system already holds — sheet state, deterministic keyword matching against the resume, the schema-validated ATS scorecard, live materials status, dates — are buried or absent.

**The Case** inverts that. The dossier becomes a working file organized by what the user needs to decide and do:

```
┌──────────────────────────────────────────────────────────────────┐
│ STATUS RAIL (navy)  logo · title · company · facts · priority ★  │
│                     [Follow-up in 3d]  [Posting open · checked]  │
├──────────────────────────────────────────────────────────────────┤
│ STAGE STEPPER   New ─ ● Researching · day 2 ─ Applied ─ … ─ Offer│
├────────┬────────┬────────┬────────┬────────────────────────────── │
│ FIT    │ ATS    │ KEYWDS │ REPLY  │ MATERIALS      (numbers band)│
├────────┴────────┴────────┴────────┴────────────────────────────── │
│ IN THEIR WORDS · one line                                        │
├──────────────────────┬──────────────────────┬────────────────────┤
│ THEY WANT            │ YOU HAVE             │ YOUR MOVES         │
│ requirements ●found  │ strengths            │ say this 01 02 03  │
│ nice-to-have ●partial│ evidence "quote"     │ materials  ready…  │
│ stack chips  ●missing│ gaps  HIGH / MED     │ people             │
│                      │ dimensions ▮▮▮▮▯     │                    │
├──────────────────────┴──────────────────────┴────────────────────┤
│ NOTES · yours                                                    │
├──────────────────────────────────────────────────────────────────┤
│ THE RECORD  ●Found ─ ●Enriched ─ ●Drafted ─ ●Contacted ─ ◐Due ─ ○ │
└──────────────────────────────────────────────────────────────────┘
```

Governing rules:

1. **Every block maps to a field the system actually has.** No fixed taxonomy of labels; no section renders empty. (§3 is the authoritative map.)
2. **AI prose is reduced to one line** (`roleInOneLine`). `postingSummary` / `fitAngle` are cut from the page.
3. **Every block carries a source tag** (sheet · scrape · ai · derived · files) so the reader knows what they're trusting.
4. **Nothing is hardcoded that the data can supply**: the enrichment provider name comes from config, section labels from the data, stage names from the stage registry.

## 2. Architecture

### 2.1 Model / renderer split

```
kanban card data-*  ──┐
keyword-profile-match ─┤
ATS scorecard (persisted) ─┤──▶  role-case-model.js  ──▶  CaseModel  ──▶  role-case.js  ──▶  DOM
materials manifest ────┤        buildCaseModel(jobKey, deps)             render(mount, model)
expired-review ────────┘        (pure; deps injectable)                   (string templates, escape once)
```

- **`role-case-model.js`** (`window.JobBoredCase.model`) — pure assembly. `buildCaseModel(jobKey, deps)` takes the role view-model plus four source adapters and returns the `CaseModel` (§4). No DOM reads beyond what `getRoleViewModel` already does; no fetches. Fully unit-testable with fixture deps.
- **`role-case.js`** (`window.JobBoredCase.render`) — string-template renderer, `render(mount, model)`. Escapes exactly once via `JobBoredText.escapeHtml`; runs all text through `JobBoredText` normalizers (resilience spec §4.1). Emits nothing; role.js wires events.
- **`role-case.css`** — all Case styles. Loaded after `role.css`. The `.brief__*` rules in `role.css` are deleted at cleanup.
- **`role.js`** stays the region owner: chooses the renderer, wires interactions, owns the focus guard and deferred re-render (resilience plan Task 5, unchanged).

### 2.2 Source adapters (Phase 0 seams — each ships alone)

| Seam | Change | Consumer |
|---|---|---|
| `pipeline-render.js` v2Attrs | **add** `data-priority`, `data-favorite`, `data-logo-url`, `data-match-score`, `data-requirements` (JSON), `data-skills` (JSON), `data-scrape-method`. Existing attribute names/budgets untouched. | `dawn-data.js` |
| `dawn-data.js getRoleViewModel` | job gains `priority`, `favorite`, `logoUrl`, `matchScore`, `lastHeardFrom`, `followUpDate`, `replied`, `requirements[]`, `skills[]`; `enrichment` gains `enrichedAt`, `scrapeMethod` | model |
| `keyword-profile-match.js` | **add** `analyzeJob(job)` → analysis or `null` when the profile cache isn't loaded; dispatch `jb:profile-match:ready` after `refreshCandidateProfileMatchCache()` resolves | model / role.js |
| `materials-state.js` + `ats-scorecard.js` | **persist** scorecard results per job opportunity key in `localStorage["jb_ats_scorecard_v1"]` (cap 100, LRU by `storedAt`); **add** `getScorecardForJob(job)`. Today the scorecard is one in-memory slot for the last draft scored — the YOU HAVE lane needs it across sessions. | model |
| `expired-review.js` | **add** `getPostingHealth(job, opts)` → `{state: "open" \| "needs-review" \| "expired" \| "unknown", label, detail, checkedAt}` derived from `job.status`, `getReviewReason`, and the cleanup audit line in Notes | model |
| `role-materials.js` | mount into `[data-mount="materials"]` when present (fallback: `[data-mount="brief"]`); **dispatch** `jb:materials:manifest {jobKey, manifest}` after every fetch/poll; **expose** `getCurrentManifest()`; render **all** document types as compact rows (today it filters to resume + cover letter) | model / role.js |

### 2.3 Events

Preserved (frozen): `jb:role:opened/closed/enriched/note/writeback/action`, `jb:pipeline:move/rendered`, `jb:write:succeeded/failed`, `jb:materials:changed`, `jb:ats:state`.
New: `jb:materials:manifest {jobKey, manifest}`, `jb:profile-match:ready {}`.
role.js re-renders the open role (through the focus guard) on: `jb:role:enriched`, `jb:pipeline:rendered`, `jb:ats:state`, `jb:profile-match:ready`, `jb:materials:manifest`.

## 3. Content model (authoritative)

Reliability legend — **sheet**: Pipeline columns A–Y, always present · **scrape**: deterministic scraper/ATS output · **ai**: schema-enforced enrichment JSON · **derived**: computed locally, no model call · **files**: materials manifest.

| Block | Fields | Source | Empty rule |
|---|---|---|---|
| Status rail | title B, company C, logo T (fallback: favicon of link domain), location D, employment (ai), salary G, source F, dateFound A, priority I, favorite V, link E | sheet, ai | Always renders; missing facts omitted; priority shown as the word High/Normal/Low, favorite as ★ |
| Posting health pill | `getPostingHealth` | sheet, derived | Hidden when `state === "unknown"` |
| Next-action pill | followUpDate P (+ days until), responseFlag S, lastHeardFrom R | sheet | Hidden when no follow-up date |
| Stage stepper | status M, daysInStage, appliedDate N; stage order from the stage registry | sheet, derived | Always; terminal stages (rejected/passed/expired) render as a single chip replacing the stepper |
| Numbers band | fit H (/10) · ATS `scorecard.overallScore` · keywords `analysis.percentage` + found/partial/missing counts · reply S · materials ready/total | sheet, ai, derived, files | Each tile hides when its input is absent; band hides when < 2 tiles |
| In their words | `roleInOneLine` | ai | Hidden until enrichment |
| They want | `scrape.requirements[]` ∪ `ai.mustHaves` (deduped) → requirements; `ai.niceToHaves`; `ai.toolsAndStack` ∪ `scrape.skills[]` ∪ tags J → stack chips; each marked found/partial/missing by `analyzeJob` | scrape, ai, derived | Lane hides when all three lists are empty; marks hidden (plain list + "Add a resume to see matches") when no profile cache |
| You have | scorecard: `topStrengths`, `evidence{claim, sourceSnippet, sourceType}`, `criticalGaps{gap, whyItMatters, severity}`, `dimensionScores` | ai (scorecard) | Fallback when no scorecard: strengths = keyword *found* terms, gaps = keyword *missing* terms (no severity), tagged "from keyword match"; lane hides when neither exists |
| Your moves · Say this | `ai.talkingPoints`, fallback sheet Q | ai, sheet | Hidden when both empty |
| Your moves · Materials | per document: type, label, status (ready / pending / failed / missing), phase, elapsedSeconds, attempt, lastModifiedAt, files | files | Shows "Draft" actions for missing resume/cover letter; shows the server-unreachable line when the local server is down |
| Your moves · People | contact L, lastHeardFrom R, responseFlag S, followUpDate P — all editable | sheet | Always (blank values render as editable placeholders) |
| Notes | notes O | sheet | Always |
| The record | Found (A) → Enriched (enrichedAt, provider from config) → each material's lastModifiedAt → Contacted (R) → Follow-up due (P) → Applied (N) | sheet, files, derived | Always; undated future steps render hollow at the end |

Cut from the page: `postingSummary` lede, `fitAngle` prose, the JD accordion. (A "Read the AI summary" disclosure may be added later; not in scope.)

Not yet available (documented for the optional Phase 5): posting `datePosted` / `validThrough` / `baseSalary` — the scraper reads them from JSON-LD to rank candidates and drops them; ATS team/department.

## 4. CaseModel schema

```js
/** @typedef {"found"|"partial"|"missing"|"unknown"} MatchStatus */
{
  jobKey: string,
  identity: { title, company, location, employment, salary, source, link, logoUrl,
              foundAt: string, priority: "high"|"normal"|"low"|"", favorite: boolean },
  stage:    { current: string, order: string[], terminal: boolean, daysInStage: number|null, appliedAt: string },
  nextAction: { followUpAt: string, daysUntil: number|null, replied: "Yes"|"No"|"Unknown", lastContactAt: string } | null,
  health:   { state: "open"|"needs-review"|"expired"|"unknown", label: string, detail: string, checkedAt: string },
  numbers:  { fit: {value:number, max:10}|null, ats: {value:number}|null,
              keywords: {percentage:number, found:number, partial:number, missing:number}|null,
              reply: {value:"Yes"|"No"|"Unknown"}, materials: {ready:number, total:number, drafting:number}|null },
  oneLine:  string,
  theyWant: { requirements: [{text, status: MatchStatus}], niceToHaves: [{text, status}], stack: [{text, status}], hasMatchData: boolean },
  youHave:  { source: "scorecard"|"keywords"|"none", strengths: string[],
              evidence: [{claim, sourceSnippet, sourceType}], gaps: [{gap, whyItMatters, severity:"high"|"medium"|"low"}],
              dimensions: [{key, label, score}] },
  moves:    { talkingPoints: string[],
              materials: [{type, label, status:"ready"|"pending"|"failed"|"missing", phase, elapsedSeconds, attempt, updatedAt, files:[]}] | null,
              people: {contact, lastContactAt, replied, followUpAt} },
  notes:    { body: string, editedAt: string } | null,
  record:   [{ at: string, label: string, detail: string, state: "done"|"due"|"future" }],
  loading:  { enrichment: boolean, keywords: boolean, materials: boolean },
  meta:     { providerLabel: string }   // from config, never a hardcoded vendor name
}
```

Every string in the model has already passed through `JobBoredText.normalizeInline` / `normalizeMultiline`; the renderer only escapes.

## 5. Interactions and DOM contract

`data-action` values the Case renders (role.js wires them; existing names are reused wherever the semantics match):

| Element | data-action | Behavior |
|---|---|---|
| Rail title / company / location / salary | `edit-field` (`data-field` title\|company\|location\|salary) | existing writeback contract, borderless inputs restyled for the navy rail |
| View posting | `brief-view-posting` | existing |
| Stepper step | `stage-step` (`data-stage`) | dispatch `jb:pipeline:move {jobKey, fromStage, toStage}` |
| Follow-up pill / People follow-up | `edit-field` (`data-field="followupAt"`, `type="date"`) | writeback `followupAt` |
| People last contact | `edit-field` (`data-field="heardBack"`) | writeback `heardBack` |
| People replied | `edit-field` (`data-field="reply"`) — a two-state toggle Yes/No | writeback `reply` |
| Keywords tile | `open-profile-match` | `keywordMatch.openProfileMatchModal(job)` (existing modal) |
| Materials rows | `materials-preview` / `materials-download` / `materials-retry` / `materials-repair` / `materials-dismiss` | existing, delegated to role-materials |
| Missing resume / cover letter | `resume-tailor` / `resume-cover` | existing (`jb:role:action`) |
| Notes | `notes` | existing |

Focus guard selector stays `[data-action="edit-field"], [data-action="notes"]` — every new editable surface uses `edit-field`, so the deferred-render guard covers it without change.

## 6. States

- **Fresh find, nothing run yet** — rail, stepper, numbers (fit, reply), They want (only if the scrape ran), Your moves (sheet talking points, materials with Draft actions, people), notes, record. No skeletons.
- **Enrichment loading** — They want / In their words render skeleton rows inside their lane; everything else stays mounted (resilience D3).
- **No resume on file** — They want lists render without marks and with one muted line: "Add a resume to see what matches."; Keywords tile hidden; You have hidden unless a scorecard exists.
- **No scorecard yet** — You have shows the keyword fallback, tagged `derived · keyword match`.
- **Materials server unreachable** — materials block shows the existing single-line error; numbers tile hidden.
- **Terminal stage** (rejected / passed / expired) — stepper collapses to a chip; health pill shows Expired when status is Expired.

## 7. Visual specification

Tokens: existing `style.css` palette and faces — no new tokens. The rail introduces the product's first dark surface using `--navy #1B2A4E` with parchment text `#FBF7EC` and mint accents `#B5D4C2` / `#6E9F87`; amber `#E7B549` marks *due*; crimson `#B23A48` marks *missing* / *high*.

Layout (desktop ≥ 1081px): case card max-width 1240, rail grid `56px 1fr auto`, numbers `repeat(5, 1fr)`, evidence board `repeat(3, 1fr)` with 1px dividers, record `repeat(N, 1fr)` over a hairline. Padding rhythm 36px horizontal, 22–28px vertical. ≤ 1080px: numbers `repeat(3, 1fr)` then `2`, board stacks to one column, record becomes a vertical list. ≤ 720px: rail stacks, stepper scrolls horizontally.

Type: rail title Lora 26/1.15 500; numbers Lora 30/1 600; lane titles JetBrains Mono 11 · .24em uppercase; body Lora 14.5/1.45; source tags JetBrains Mono 7.5 · .18em; notes Special Elite 14/1.65 (existing notes face). All body copy `overflow-wrap: anywhere`.

Marks: 9px dots — found mint, partial amber, missing crimson; the same three appear inside stack chips.

Motion: none beyond the existing skeleton shimmer; `prefers-reduced-motion` respected.

## 8. Decisions (with tradeoffs)

- **D1 — Persist the ATS scorecard per job.** The scorecard exists only for the last draft scored in this session, so without persistence the YOU HAVE lane would be empty on almost every open. We store results by opportunity key in localStorage (cap 100). Tradeoff: a stored scorecard can lag a newer draft; the lane shows its `storedAt` date and the workshop overwrites it on the next generate/refine.
- **D2 — Requirement marks are keyword-level.** `keyword-profile-match` matches terms, not meaning; a requirement phrased differently from the resume can read *missing*. We label the lane "vs. your resume" and keep the existing breakdown modal one click away. Semantic matching is out of scope.
- **D3 — AI prose is cut, not hidden.** One line stays. Restoring a disclosure later is cheap; shipping it now dilutes the page's promise.
- **D4 — No runtime flag.** The branch is the flag: role.js renders the Case when `window.JobBoredCase` is present; `role-brief.js` is deleted in the cleanup phase. Rollback = revert the merge.
- **D5 — role-materials keeps its actions, loses its panel.** It becomes the manifest owner (fetch, poll, events, request/repair handlers) and renders compact rows into the Case's mount; the standalone `.brief-materials` panel goes away.
- **D6 — Priority renders as a word**, not the sheet's emoji glyph; favorite renders as a text ★.
- **D7 — Provider label comes from config** (`getResumeGenerationConfig().provider` display name); the "AI · Gemini" hardcode dies with `role-brief.js`.

## 9. Relationship to the render-resilience plan (2026-08-31)

| Resilience phase | Status under The Case |
|---|---|
| Phase 0 (jb-text, text-normalize) | **Prerequisite.** The Case renderer consumes `JobBoredText`. |
| Phase 1 Tasks 3, 4, 6 (role-brief.js / role.css presentation) | **Superseded** — skip; role-brief.js is deleted. |
| Phase 1 Task 5 (role.js focus guard + deferred re-render) | **Prerequisite, unchanged.** |
| Phases 2, 3, 4 (dawn-data, transport, ingestion) | **Prerequisite, unchanged.** |
| Phase 5 (materials editors) | Independent. |

Execution order: resilience 0 → 5 → 2 → 3 → 4, then this plan.

## 10. Contracts and tests

**Frozen:** every existing `data-*` attribute name and budget (additive changes only); event names/shapes above; Sheet Interface A; `data-action` values `edit-field`, `notes`, `brief-view-posting`, `resume-cover`, `resume-tailor`, `materials-*`; `tests/dossier-card-attrs.test.mjs`, `tests/dossier-workshop-events.test.mjs`, `tests/role-writeback-bridge.test.mjs`, `tests/flowing-writes-stage-resolve.test.mjs`.

**Retired at cleanup:** `tests/dossier-brief-structure.test.mjs` (replaced by `role-case-render.test.mjs`).

**Updated:** `role-field-edit-render-guard` (rail selectors), `role-materials*` (mount + events + rows), `enrichment-self-heal` (new attrs), `ats-scorecard-provider` (persistence).

**New:** `role-case-model.test.mjs`, `role-case-render.test.mjs`, `keyword-match-analyze-job.test.mjs`, `ats-scorecard-persistence.test.mjs`, `expired-review-posting-health.test.mjs`, `role-materials-manifest-events.test.mjs`, `role-case-interactions.test.mjs`.

Gate: `npm test`.

## 11. Out of scope

Semantic requirement matching; a "read the AI summary" disclosure; company-level context (other roles at this company); mobile-first rework beyond the responsive rules in §7; surfacing JSON-LD posting dates (optional Phase 5 in the plan); the legacy drawer.

## 12. Locked decisions (program `dossier-case`, 2026-09-01 — override anything contrary above)

- **LD1 — Scope.** Resilience plan: Phase 0, Task 5, Phases 2–4 execute in this program; Phase 1 Tasks 3/4/6 are skipped (superseded); Phase 5 (materials editors) is out of this program. Case plan: Tasks 1–10 execute; Task 11 (JSON-LD posting dates) runs only as a final optional lane if every prior lane is green.
- **LD2 — Worker stack.** Emilio's standing default (2026-08-12): FE lanes Opus 5 high via `claude`; server/test lanes GPT 5.6 Sol xhigh via `codex`; Grok 4.6 via Grok Build CLI as fallback. No per-run override.
- **LD3 — Cutover.** No runtime flag (D4 stands). The cutover lane deletes `role-brief.js` and the `.brief__*` styles in the same lane after its interaction tests are green.
- **LD4 — Lane fences and claim letters.** L0 foundation (A) · L1 derive (B) · L2 ingest (C) · L3 seams (D) · L4 core (E) · L5 cutover (F) · L6 dates (G, optional). Fences are listed in `docs/programs/dossier-case/GROUND-RULES.md`; a lane touching a file outside its fence is a defect.
- **LD5 — Integration.** Branch `feat/dossier-case`; lanes branch from it as `feat/case-<lane>`; the orchestrator runs the floor per lane before every merge and after each merge; nothing pushes without Emilio's approval.
