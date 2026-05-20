# dossier-df-workshop lane — handoff

**Run ID:** `dossier-df-20260519T2030Z`
**Worktree:** `../Job-Bored-wt-dossier-df-workshop`
**Branch:** `dossier-df/workshop` (off `feat/flowing-page`)
**Model:** Claude Opus, max reasoning
**Visual source of truth:** `docs/redesign/dossier-direction-f-wireframe.html`

## Goal

Implement **The Workshop** — the distinct bordered card with its own shadow that sits below the Brief in Part 03. Workshop is the editable/actionable half: navy top bar with primary CTAs, two-column body with stage stepper + timeline on the left and ATS summary + write-back chips on the right.

## Owns (exclusive)

### JS
- New file: `role-workshop.js`. Loaded from `index.html` immediately after `role-brief.js` (Brief lane adds the brief tag; you add the workshop tag right after).
- Exports: `window.JobBoredDossierWorkshop = { renderWorkshop(region, vm) }`.
- Helpers private to this file: `renderWorkshopBar`, `renderModeDivider`, `renderStageStepper`, `renderTimeline`, `renderAtsCard`, `renderWriteBackChips`.

### Shell coupling
- One single line added to `role.js` inside `renderDossier(region, vm)`: a call to `window.JobBoredDossierWorkshop.renderWorkshop(workshopMount, vm)`. That line and the mount-point markup are yours. Do not touch any other line of `role.js`.

### index.html
- Add `<script src="./role-workshop.js"></script>` immediately after `role-brief.js`. No other change to `index.html`.

## Do NOT touch

- `role-brief.js` (other lane)
- `role.css`, `style.css` (dossier-css lane)
- `app.js`, `flowing-writes.js` (other lanes)
- The empty-state shelf or the PART 03 divider already in `role.js`

## Reading order in the Workshop (matches the wireframe exactly)

1. **Mode divider** — a horizontal rule with a mono typewriter eyebrow `THE workshop · YOUR MOVES` centered between two horizontal lines. Sits **above** the Workshop card, between the Brief and the Workshop.

2. **Workshop top bar** — navy background, cream text. Left side: mono eyebrow `Your work · this role`. Right side: primary action buttons in this order:
   - `Tailor resume` (amber `btn-primary`) — emits `jb:role:action { action: "resume-tailor", jobKey }`
   - `Cover letter` (amber `btn-primary`) — emits `jb:role:action { action: "resume-cover", jobKey }`
   - `View posting ↗` (ghost outline) — anchor `<a>` to first valid `job.links[*].href`; omit if no link.

   The first two buttons also smoothly scroll the page to the `[data-region="letter"]` region after dispatching, matching today's `role.js` behavior at `wireDossier`.

3. **Workshop grid** — `1fr / 1fr` two columns with a 1px hairline gutter (the CSS handles the rule via `background: var(--border-strong)` + 1px grid gap). Collapses to single column at ≤960px.

4. **Left column (Track):**
   - **Stage card** — section title `Stage`, then a visual stepper with 5 buttons (`Researching / Applied / Phone screen / Interviewing / Offer`). Past stages get `stepper__step--done` (mint), the current gets `stepper__step--current` (navy), future stages get the default. **Clicking any step emits `jb:role:writeback { jobKey, field: "stage", value: <stageKey> }`**. The masthead stage chip in the Brief opens this card by scrolling here on click — see the Brief brief.
   - **Timeline card** — section title `Timeline`. Each row: a relative-time value (`Applied 6d ago`) and an absolute date keyed in mono on the right. Rows only render when their underlying date exists. Reply-due row uses `timeline__val--urgent` when `daysUntil <= 3`.

5. **Right column (Score & write-back):**
   - **ATS scorecard summary card** — section title `ATS scorecard`. Subscribes to the `jb:ats:state` event (see contracts below). Renders three states:
     - `loading` → "Scoring…" with a thin progress bar (mono)
     - `success` → giant crimson number (`78`) with mono `/100`, plus 2-line breakdown (`Strong: …`, `Weak: …`) extracted from the result, plus a full-width "See full scorecard →" button that emits `jb:ats:modal:open { jobKey }`.
     - `error` → "Couldn't score this role" with a small `Retry` button that emits `jb:ats:state:request { jobKey }` to ask `ats-state-bus` to re-fire.
     - On mount, immediately emit `jb:ats:state:request { jobKey }` so a replay value lands if one is already cached.
   - **Mark progress card** — section title `Mark progress`, then chip row in this order:
     - `Heard back` → emits `jb:role:writeback { jobKey, field: "heardBack", value: <ISO today> }`
     - `Got reply` → emits `jb:role:writeback { jobKey, field: "reply", value: <ISO today> }`
     - `Followup nudge` → emits `jb:role:writeback { jobKey, field: "followupAt", value: <ISO today + 3 days> }`
     - `Mark passed` (danger styling) → emits `jb:role:writeback { jobKey, field: "passed", value: true }`
   - Each chip has a small pulse dot. The danger chip uses `chip--danger`.

## Events emitted

```
jb:role:writeback { jobKey, field, value }
   field ∈ { "stage" | "heardBack" | "reply" | "followupAt" | "passed" }

jb:role:action { action, jobKey }
   action ∈ { "resume-tailor" | "resume-cover" }   // preserved contract

jb:ats:modal:open { jobKey }                       // new — handled by ats-state-bus lane

jb:ats:state:request { jobKey }                    // new — asks ats-state-bus to replay last value
```

## Events listened for

```
jb:ats:state { jobKey, status, result?, error? }   // re-render the ATS summary card
jb:role:opened { jobKey }                          // emit jb:ats:state:request immediately
```

## Selectors that must be preserved

- `[data-action="resume-cover"]` on the Cover letter button — write-back layer reads this.
- `[data-action="resume-tailor"]` on the Tailor resume button.
- `[data-action="close-role"]` is the Brief's responsibility, not yours.

## Preserve (do not break)

- The Tailor / Cover buttons must still scroll the page to `[data-region="letter"]` after dispatching the action — see existing `wireDossier` in `role.js`.
- `prefers-reduced-motion` — chip pulse and stepper transitions must honor it.

## Verification

```bash
node --check role-workshop.js role.js
npm test -- tests/dossier-card-attrs.test.mjs
```

Visual check: serve the dev server, open a role, click each Workshop chip, confirm each one fires the right event payload (use DevTools `monitorEvents(window, ["jb:role:writeback", "jb:role:action", "jb:ats:modal:open", "jb:ats:state:request"])`).

## Status file

Write to `docs/redesign/status/dossier-df-workshop.json` matching the schema in `docs/redesign/status/README.md`.

## Completion report (fill in at the end)

- **Commit SHA(s):**
- **Files changed:**
- **Tests run + results:**
- **Event payload verification:** (paste the four event names + observed payloads)
- **Wireframe deviations + why:**
- **Open questions for integration:**
- **Known risks:**
