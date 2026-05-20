# DAWN — Daily Brief screen (Phase 3)

**Owner:** Dawn (Daily Brief screen agent)
**Region:** `<section data-region="dawn">` between `region:dawn:start/end` markers in `index.html`.
**Activation:** `body.jb-v2` flag (set via `?jb-v2=1` or `window.JB_V2.enable()`). Off-flag → legacy `.daily-brief-panel` renders unchanged.

This is the v2 replacement for the legacy Daily Brief. It is editorial, scan-first, and AI-as-compression — a single-page lens, not a second database.

---

## 1. Layout map

```
┌──────────────────────────────────────────────────────────────┐
│ EYEBROW (date, mono)                                         │
│ HEADLINE — Caveat, --jb-text-3xl, max 56ch                   │
├──────────────────────────────────────────────────────────────┤
│ ROW 1 · 4 hero stickers  (FOUND / APPLIED / IN LOOP / OFFERS)│
│   each: eyebrow · big number · delta chip · sparkline · sub  │
├──────────────────────────────────────────────────────────────┤
│ ROW 2 · Pipeline funnel (replaces donut + line chart pair)   │
│   horizontal bars by stage, count + pct, tooltip on click    │
├──────────────────────────────────────────────────────────────┤
│ ROW 3 · Recent activity feed (5 most recent)                 │
│   <jb-stage-dot> + role + company + ts                       │
├──────────────────────────────────────────────────────────────┤
│ ROW 4 · "What I see" — 1–3 noticings with quiet action links │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Headline ruleset

Generated client-side from real numbers. Priority order:

1. **offers > 0** → lead with offers; mention in-loop if > 0
2. **inLoop > 0** → lead with in-loop; mention found-this-week if > 0
3. **found > 0 AND applied > 0** → momentum line
4. **found > 0 only** → urgency line
5. **applied > 0 only** → reflection line
6. **none of the above (and pipeline non-empty)** → quiet line
7. **pipeline empty** → onboarding nudge

The headline is **derived in `dawn-data.js#buildHeadline`**, not hardcoded. Lorem is forbidden.

### 8 example states (input → output)

| # | hero state                                              | headline                                                                                  |
|---|---------------------------------------------------------|-------------------------------------------------------------------------------------------|
| 1 | `offers=2, inLoop=3, found=1, applied=2`                | "2 offers are still on the table. 3 conversations are still in the loop."                |
| 2 | `offers=1, inLoop=0, found=0, applied=0`                | "One offer is still on the table."                                                       |
| 3 | `offers=0, inLoop=2, found=4, applied=1`                | "2 conversations are live in the loop. 4 fresh roles surfaced this week."                |
| 4 | `offers=0, inLoop=1, found=0, applied=0`                | "One conversation is live in the loop."                                                  |
| 5 | `offers=0, inLoop=0, found=3, applied=2`                | "3 new this week, 2 out the door — momentum is yours to keep."                           |
| 6 | `offers=0, inLoop=0, found=5, applied=0`                | "5 new roles surfaced this week. Decide fast, apply faster."                             |
| 7 | `offers=0, inLoop=0, found=0, applied=4`                | "4 applications went out this week. Now sharpen the next one."                           |
| 8 | `offers=0, inLoop=0, found=0, applied=0` (non-empty)    | "A quiet pipeline today. A good day to reach out to someone new."                        |

Empty pipeline → "Your pipeline is empty. Run discovery, or add a role to start the day."

---

## 3. Data contract — `getDawnViewModel()`

`dawn-data.js` exports `window.JobBoredDawn.data.getDawnViewModel()`. Read-only DOM scrape; no fetches.

```jsonc
{
  "date": "Mon, May 6, 2026",          // string; from #briefDate or now()
  "headline": "…",                      // string; never empty
  "isEmpty": false,                     // true when no kanban cards rendered
  "total": 78,                          // total card count
  "hero": {
    "found":   { "value": 3, "sub": "vs 1 prior week", "spark": [0,…,3], "tier": "high" },
    "applied": { "value": 2, "sub": "vs 2 prior week", "spark": [...], "tier": "low"  },
    "inLoop":  { "value": 1, "sub": "interviewing + screens", "spark": [...], "tier": "high" },
    "offers":  { "value": 1, "sub": "full pipeline", "spark": [...], "tier": "high" }
  },
  "funnel": [
    { "stage": "new", "dotStage": "new", "label": "New",
      "token": "--jb-stage-new", "count": 73, "pct": 94, "jobs": [{"key":"0","title":"…","company":"…"}] },
    // … one row per stage in canonical order: new, researching, applied, phone-screen,
    //   interviewing, offer, rejected, passed
  ],
  "activity": [
    { "key": "1", "title": "Backend Eng", "company": "Globex",
      "stage": "offer", "dotStage": "offer", "ts": "" }
    // most recent 5, sorted by data-index DESC
  ],
  "noticings": [
    { "kind": "offers", "text": "1 offer is on the table.",
      "action": { "event": "dawn:scroll-to-stage", "payload": "offer", "label": "Open offers" } }
    // 1..3 entries
  ]
}
```

### Field provenance

| Field        | Source                                                      |
|--------------|-------------------------------------------------------------|
| `date`       | `#briefDate` text → fallback `new Date().toLocaleDateString` |
| `hero.*.value` / `.sub` | `#briefStats .stat-card` (rendered by legacy `renderBriefStats`) |
| `hero.*.spark` | **Synthesized** — see "Sparkline note" below              |
| `funnel[]`   | `.kanban-card[data-stable-key]` class `kanban-card--stage-XXX` |
| `activity[]` | Same cards, sorted by `data-index` DESC, top 5             |
| `noticings[]`| Derived from hero + funnel (see `buildNoticings`)          |
| `headline`   | Derived from hero + funnel (see `buildHeadline`)           |

### Sparkline note

The legacy schema does not expose a per-day series for "found / applied / in-loop / offers". Rather than fabricate history, `dawn-data.js#syntheticSpark()` returns 13 zeros + the current value as the terminal tick. This communicates "today's number" honestly and reserves the visual slot for future per-day data without changing the consumer contract.

---

## 4. Integration with legacy contracts

- **`expandedJobKeys`**: not touched. Activity-feed clicks dispatch a `.click()` on the matching legacy `.kanban-card[data-stable-key]`, which routes through the legacy event delegation (`openJobDetail` → `expandedJobKeys.add/delete`). No re-implementation.
- **`data-stable-key`**: forwarded verbatim from the legacy card to the dawn feed item; click handler reads it back.
- **`data-action`**: legacy actions are untouched. The v2 region uses `data-event` on its own buttons (no overlap).
- **Discovery webhook contract**: unchanged. Dawn does not call any discovery endpoint.

---

## 5. Re-render strategy

`dawn.js` mounts a `MutationObserver` on three legacy nodes:

1. `#briefStats` (subtree, characterData) — fires when `renderBriefStats` writes new HTML
2. `#briefHeadline` (subtree, characterData) — fires when the legacy headline updates
3. `#kanbanPipeline` (subtree) — fires when cards are added/removed/restaged

Each trigger schedules an idle re-render (`requestIdleCallback` with `requestAnimationFrame` fallback). The render is **idempotent**: HTML is hashed by string equality, the DOM only updates on diff.

A second `MutationObserver` watches `body.class` so flipping the `jb-v2` flag at runtime activates / clears the region without a reload.

---

## 6. Manual a11y checklist

(axe-core not wired into local CI; mirrors Forge's manual approach.)

- [x] Region wrapped in `<section aria-label="Daily Brief (v2)">`.
- [x] `<h1>` for the editorial headline; `<h2>` for each section title.
- [x] Funnel rows are `<button>` with full `aria-label` (`"<stage> <count> roles, <pct> percent of pipeline"`).
- [x] Hero deltas annotated via `data-trend`; the chip text is the literal delta number with sign.
- [x] Sparklines pass `label=` so `<jb-spark>` exposes `role="img"` + `aria-label`.
- [x] Activity feed items are `<button>` with `aria-label="Open <title> at <company>"`.
- [x] Note action links are `<button>` (not `<a>`) with text + `→` glyph.
- [x] Focus rings: `box-shadow: var(--jb-shadow-focus)` on `:focus-visible`. AA against paper.
- [x] `prefers-reduced-motion` honored — funnel-fill width transition disabled.
- [x] Tooltip uses `role="status" aria-live="polite"` so funnel disclosures announce.

---

## 7. Acceptance criteria

1. **Region gated by flag.** `body:not(.jb-v2) [data-region="dawn"] { display:none }`. Removing `jb-v2` in devtools collapses the region.
2. **Off-flag legacy renders unchanged.** Dawn never edits the legacy `.daily-brief-panel`.
3. **Token-only CSS.** `node tools/lint-tokens.mjs --paths dawn.css` returns 0 findings.
4. **a11y.** Manual checklist above. axe-core is not run locally.
5. **No diff in `app.js`, `style.css`, or any legacy file.** Only `index.html` (region + 3 head imports) and `MIGRATION.md` (append) are touched outside new files.
6. **`expandedJobKeys` toggles correctly.** Activity clicks call `.click()` on the matching `.kanban-card[data-stable-key]`, which is the only legacy event entry point.
7. **Top-sources bar is gone inside region:dawn.** No `.top-sources` markup is authored by Dawn; the legacy node lives outside the region.
8. **Funnel responsive.** Layout grids:
   - **320–599px**: hero stacks 1-up; funnel `96px / 1fr / 64px`; section heads stack vertically.
   - **600–1023px**: hero 2×2; funnel `132px / 1fr / 88px`.
   - **≥ 1024px**: hero 4-up; funnel unchanged.
   - **1280px / 1920px**: same as ≥ 1024 (max-width comes from page chrome, not Dawn).

---

## 8. Forge / Quill primitives used

- `<jb-spark>` — hero sparklines (color: `mint` or `mint-deep`).
- `<jb-stage-dot>` — funnel labels and activity feed.
- `<jb-ai-chip variant="summary">` — per-noticing chip.
- `.jb-sticker` — hero card primitive.
- `.jb-data` — mono numerals for hero values and ts.
- `.jb-caption` — subdued empty-state text.

No new components, no new utility classes.

---

## 9. What this kills

Inside `region:dawn` only (legacy markup outside the region is preserved):

- Full-width "top sources by location" bar.
- Donut + line-chart pair (replaced by the funnel).
- The two ticker callouts at the bottom of the legacy view.
