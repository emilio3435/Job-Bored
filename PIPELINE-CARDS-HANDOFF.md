# Handoff: Pipeline job cards — collapsed & expanded refactor / redesign

This document orients a future agent to **fully refactor and redesign** the **collapsed** (default) and **expanded** layouts for pipeline/prospect job cards. It summarizes how things work today, where code lives, and what constraints to respect.

---

## Product intent

- **Three-tier progressive disclosure** replacing the old body+rail layout:
  - **Tier 1 (Scan line, ~5 visual lines):** Title + priority icon, company + stage pill, context line (location / salary / date as dot-separated text), AI hook (one sentence from `roleInOneLine` or `fitAngle`), inline action row (View role, Cover letter, Tailor resume, expand chevron).
  - **Tier 2 (Peek, `<details>` disclosure):** Full AI summary, fit verdict, tags/skills, must-haves, source. Opens inline without page jump.
  - **Tier 3 (Expand band):** Talking points + structured lists + raw scraped text (left column), pipeline write-back CRM controls (right column).
- **Design goal**: Answer "Do I care about this role?" in 5 seconds. The collapsed card shows 7-8 fields max (down from ~20). All CRM, prep, and raw data live behind Tier 2/3 disclosures. See **[DESIGN.md](DESIGN.md)** for full principles.

---

## Primary files

| Area                  | File        | What to know                                                                                                                                                                           |
| --------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card HTML             | `app.js`    | `renderJobCard()` (~L1708+) builds each `<article class="job-card">` as a template string.                                                                                             |
| Listeners             | `app.js`    | `attachCardListeners()` (~L2243+) wires clicks: expand/collapse, tags, resume actions, status, notes, etc.                                                                             |
| Expand state          | `app.js`    | `expandedJobKeys` (`Set`, ~L315) persists which cards stay open across `renderPipeline()` re-renders.                                                                                  |
| Pipeline actions HTML | `app.js`    | `renderCardActions()` (~L2133+) — signed-in pipeline controls injected into expanded details **right column**.                                                                         |
| Styles                | `style.css` | Search for sections: **JOB CARDS**, **CARD ACTIONS**, **Expandable details**, **`.card-body-split`**, **`.posting-two-col`**, **`.job-card__details`**, **`.job-card__expand-strip`**. |

Supporting: `index.html` (global modals only; cards are JS-rendered), `user-content-store.js` if touching stored profile content (not required for pure layout).

---

## DOM structure (current)

### Collapsed (Tier 1 + Tier 2)

```text
article.job-card[.priority-hot|.priority-high]  data-stable-key
  .card-identity
    h3.card-title (title text + .priority-icon span)
    p.card-company (company text + .card-stage-pill inline)
  p.card-context (location · salary · date, dot-separated)
  p.card-hook (one-sentence AI hook from roleInOneLine / fitAngle / fitAssessment)
  details.card-peek                              Tier 2 disclosure
    summary.card-peek__toggle "More about this role"
    .card-peek__body
      .card-peek__section > .card-peek__label + .card-peek__text  (AI Summary)
      .card-peek__section > .card-peek__label + .card-peek__text  (Fit)
      .card-peek__section > .card-peek__label + .card-tags         (Tags & skills)
      .card-peek__section > .card-peek__label + .card-peek__list   (Must-haves)
      p.card-peek__source ("via Wellfound")
  .card-actions-row
    a.card-action.card-action--primary (View role)
    button.card-action[data-action="resume-cover"]
    button.card-action[data-action="resume-tailor"]
    button.card-action.card-action--expand[data-action="toggle-card"]  expand chevron
  .job-card__details#job-details-{stableKey}     Tier 3 (display:none until expanded)
    .job-card__details-grid                      grid: "prep writeback"
      .details-column--left [grid-area: prep]
        .details-section-heading "Talking points"
        talking points content
        .expanded-extra (structured lists, scraped text, source meta)
        .card-meta--chips (contact/reply/heard)
      .details-column--right [grid-area: writeback]
        .details-section-heading "Pipeline & notes"
        renderCardActions() output
```

**Stable identity**: `data-stable-key` on the card matches pipeline row index for expand persistence and event handlers.

### Expanded

- `.job-card--expanded` on `article`.
- `#job-details-*` shown; `aria-expanded` on toggle button updated in JS.
- Details grid uses `grid-template-areas: "prep writeback"` (two equal columns above 900px, stacked below).

---

## Behavior contracts (do not break without migration)

- **`[data-action="toggle-card"]`**: Toggles `.job-card--expanded`, updates `expandedJobKeys`, triggers optional posting fetch (`fetchJobPostingEnrichment`) when opening. Keep stable selectors or update `attachCardListeners` + restore logic in `renderPipeline` together.
- **`data-stable-key`**: Used for expand persistence and tag toggles; must remain consistent with `pipelineData` indices.
- **Resume buttons**: `[data-action="resume-cover"]`, `[data-action="resume-tailor"]` with `data-index`.
- **Write-back**: Status, notes, follow-up, etc. use `data-index` and classes like `.status-select`, `.notes-textarea` — grep `attachCardListeners` for full list.

---

## Config / branding

- `window.COMMAND_CENTER_CONFIG` is the legacy global name (do not rename without updating `config.example.js`, `app.js` merge logic, and docs).
- Visual tokens live in `style.css` `:root` (JobBored palette: navy, mint, amber, teal, neutrals).

---

## Architecture notes (post-redesign)

1. **Single-column flow**: Cards are a flat stack (`.card-identity` -> `.card-context` -> `.card-hook` -> `.card-peek` -> `.card-actions-row` -> `.job-card__details`). No nested grids in collapsed state.
2. **No rail**: Quick actions (view role, resume tools) are an inline flex row inside the card body. The expand chevron is right-aligned in the same row.
3. **Tier 2 uses `<details>`**: The `.card-peek` element is a native disclosure. No JS needed for open/close.
4. **Tier 3 unchanged**: The `.job-card__details` expand band keeps the same two-column grid (prep | writeback) and the same `attachCardListeners` wiring.

---

## Quick verification checklist

- [ ] Collapse/expand persists across filter/sort when same row index.
- [ ] No duplicate listeners (innerHTML replace clears old nodes).
- [ ] Keyboard: focus visible on expand button and action buttons.
- [ ] Mobile: actions row wraps gracefully; expanded details not clipped.
- [ ] Cards with no enrichment still render (no hook, no peek content).
- [ ] data-action selectors work: toggle-card, resume-cover, resume-tailor, toggle-tags, status-select, notes, followup, etc.

---

## Related docs (optional)

- `SETUP.md` — OAuth / sheet setup (not layout-specific).
- `AGENT_CONTRACT.md` — automation contract for discovery webhooks.

---

_Generated for agent handoff. Update this file when the new layout ships so the next person isn’t reverse-engineering CSS._
