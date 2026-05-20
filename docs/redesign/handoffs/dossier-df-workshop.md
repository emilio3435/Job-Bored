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

## Completion report

- **Commit SHA(s):** `d759ea7` on `dossier-df/workshop` (single focused commit `feat(dossier-df/workshop): direction F workshop card, mode divider, ATS bus consumer, write-back chips`).
- **Files changed:**
  - `role-workshop.js` (new, ~430 lines IIFE under `window.JobBoredDossierWorkshop`)
  - `role.js` (additive only inside `renderDossier`: a single `<div data-mount="workshop"></div>` appended after the legacy `<section class="jb-dossier detail-drawer">`, and a single `if (workshopMount && root.JobBoredDossierWorkshop && typeof root.JobBoredDossierWorkshop.renderWorkshop === "function") root.JobBoredDossierWorkshop.renderWorkshop(workshopMount, vm);` line after `wireDossier(region, job)`. No other lines of `role.js` were touched.)
  - `index.html` (one `<script src="role-workshop.js" defer></script>` line right after the `role.js` tag — which will become "right after `role-brief.js`" once the brief lane lands per `docs/redesign/handoffs/dossier-df-integration.md`).
- **Tests run + results:**
  - `node --check role-workshop.js role.js` — passed.
  - `npm test -- tests/dossier-card-attrs.test.mjs` — **skipped**, the test file does not exist on this branch (owned by the dossier-df/qa lane). Workshop carries the `[data-action="resume-cover"]` and `[data-action="resume-tailor"]` selectors so the qa lane's assertions will match.
  - `node --test tests/ats-state-bus.test.mjs tests/role-writeback-bridge.test.mjs` — 8/8 passed; the producers this lane consumes are unchanged.
  - `node --test tests/*.test.mjs` — 341/343 passed; the 2 failing tests in `tests/draft-generation-stability.test.mjs` ("ATS scorecard state is reset when modal opens in loading state" and "retry-ats-scorecard button uses current active draft text") were verified pre-existing on the base via `git stash` + re-run, so they are not regressions from this lane.
  - In-process render smoke test (`vm.runInContext` of `role-workshop.js`) covered: mode-divider + workshop card markup; stepper done|current state for `stage:"applied"` and `stage:"offer"`; timeline rows only when dates exist; `timeline__val--urgent` applied at `daysUntil <= 3` and dropped at `>= 4`; ATS card across `loading`/`success`/`error` re-renders driven by `jb:ats:state`; `jb:ats:state:request` fired on mount and on `jb:role:opened`.
- **Event payload verification:**
  - `jb:role:writeback` — `{ jobKey: "k-9", field: "stage", value: "phone-screen" }` on stepper click. `{ jobKey: "k-9", field: "heardBack", value: "<today ISO>" }` on Heard back chip. `{ jobKey: "k-9", field: "reply", value: "<today ISO>" }` on Got reply chip. `{ jobKey: "k-9", field: "followupAt", value: "<today+3 ISO>" }` on Followup nudge chip. `{ jobKey: "k-9", field: "passed", value: true }` on Mark passed chip. Dispatched on both `window` and `document` to match `flowing-writes.js`'s listener convention.
  - `jb:role:action` — `{ action: "resume-tailor", jobKey: "k-9" }` (and `"resume-cover"`) on the Workshop primary buttons; preceded by a smooth `scrollIntoView` of `[data-region="letter"]` (honoring `prefers-reduced-motion`). The legacy `wireDossier` handler in `role.js` also fires on these buttons (data-action selectors preserved); both paths dispatch the same payload, so the redundancy is idempotent and the contract is preserved.
  - `jb:ats:modal:open` — `{ jobKey: "k-9" }` on "See full scorecard →" click, dispatched on both `window` and `document`. Consumed by `app.js`'s `jb:ats:modal:open` listener at `app.js:17806`.
  - `jb:ats:state:request` — `{ jobKey: "k-9" }` on initial mount, on every `jb:role:opened`, and on the error-state Retry button. Dispatched on both `window` and `document`. The bus only replays when `wantKey === atsScorecardState.cacheKey`, so when the bus has nothing matching the dossier's stable key the Workshop falls back to the loading placeholder until a live state arrives — that is the contracted bus behavior, not a workshop bug.
  - `jb:ats:state` (listened) — re-renders only the inner `[data-ats-container]` container's `<h4> + ats-card` body, not the whole Workshop, to avoid clobbering the wired click delegation. State.jobKey is not filtered against the workshop's jobKey (see Known risks).
  - `jb:role:opened` (listened) — emits `jb:ats:state:request` for the new key.
- **Wireframe deviations + why:**
  - Stepper steps are rendered as `<button type="button">` instead of `<div>` (wireframe used divs). Buttons are keyboard-focusable, natively clickable, and the brief specifically requires click handling. CSS in `role.css` targets `.stepper__step` regardless of element type, so the visual is unchanged. Current step also gets `aria-current="step"` for assistive tech.
  - The "Heard back 2d ago" timeline row from the wireframe is not rendered: the role VM does not surface a `heardBack` date (only `appliedAt` and `deadline.dueDate`). Per the brief's "Rows only render when their underlying date exists" rule, the row is omitted; clicking the Heard back chip will write the date to `Pipeline!R`, but until the row is read back from the sheet (next refresh), the timeline won't show it. Flagged below as an open question.
  - Mode divider is rendered as a sibling of `<aside class="workshop">` *inside* the workshop mount (rather than as a sibling of the workshop mount inside an outer `.dossier` wrapper). This is a side-effect of the lane being the only producer that knows where the mode divider belongs while the brief lane has not merged yet. After integration the structure becomes the wireframe-canonical `dossier > brief / mode-divider / workshop`; the visual is identical because the mode-divider's CSS does not depend on its parent.
  - The Workshop also adds a redundant `<a class="btn-ghost" rel="noopener" target="_blank">View posting ↗</a>` only when `job.links[*].href` carries a valid `http(s)://` or `mailto:` URL — same contract as the wireframe but with explicit URL safety.
- **Open questions for integration:**
  - Does the integration lane want the legacy `<section class="jb-dossier detail-drawer">` block in `role.js` removed once brief + workshop are both merged? Today both the brief mount (added by `role-brief.js`) and the workshop mount (added here) live alongside the legacy section. The brief lane's status notes call out the same open question; recommend the integration lane delete the now-unreachable `renderDrawerHead/Actions/About/Structured/TalkingPoints/Props/NotesBlock` helpers + the legacy section markup at integration time.
  - Should the timeline gain a `Heard back` row sourced from the new `Pipeline!R` column (`lastHeardFrom`)? The role VM in `dawn-data.js` does not parse this attribute today. If yes, the dossier-df/integration or a follow-up VM lane should add `data-last-contact` on the kanban card (per `AGENT_CONTRACT.md` v2 kanban-card data-attrs) and surface it on `vm.job.lastHeardFrom`.
  - The bus's `jb:ats:state:request` replay is gated on `wantKey === atsScorecardState.cacheKey`, where the cacheKey is the ATS scorecard cache key (e.g. `ats:cover_letter:job-1:<sig>`), not the dossier's stable key. The workshop's request will essentially never trigger a replay. This is a contract-level mismatch for the replay channel; live state events still propagate, so the only impact is the workshop staying in "Scoring…" until something else triggers ATS work for the open role. Flagged for the integration / ats-state-bus lane to decide whether the bus should index by `(stableKey → cacheKey)` to support replay.
- **Known risks:**
  - Double-dispatch of `jb:role:action` for Tailor/Cover: the workshop's click handler and `role.js`'s `wireDossier` region-level handler both fire for the same click. Both produce the same payload and the same scroll target, so this is idempotent — but a downstream listener that side-effects (e.g. analytics) would see two events. Acceptable per the lane brief's "Do not touch any other line of role.js" rule; the integration lane can choose to remove the duplicate if it becomes a problem.
  - The `data-mount="workshop"` div is appended after the legacy detail-drawer section; before integration with the brief lane, the dossier shows both the legacy drawer AND the workshop. Visually the legacy drawer continues to take the page, but the workshop renders below it with full functionality. Once the brief lane merges, the integration lane will replace the legacy section with the brief mount per `docs/redesign/handoffs/dossier-df-integration.md`.
  - ATS state is not filtered by jobKey on receipt. If the bus has cached state for a different role and emits it, the workshop will render that state. Mitigated by `jb:role:opened` re-emitting `jb:ats:state:request` for the new key, which the bus will only replay if it matches — so the typical flow (open role → bus fires for that role's cacheKey) is correct. Stale cross-role bleed is theoretically possible but unlikely given how `setAtsScorecardState` is called by app.js (always with the active resume session's cacheKey).
