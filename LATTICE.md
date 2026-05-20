# LATTICE.md — Phase 3 · Pipeline kanban

**Owner:** Lattice
**Status:** Phase 3 shipped behind `body.jb-v2`.
**Activation:** `?jb-v2=1` in the URL or `window.JB_V2.enable()` in the console.
**Region:** `<!-- region:lattice:start --> … <!-- region:lattice:end -->` in `index.html`. The region container element carries `data-region="lattice"` so all `lattice.css` selectors apply.

Lattice replaces the legacy vertically-stacked stage list with a horizontal kanban. Cards are stickers (Forge `.jb-sticker`); each shows the absolute minimum needed to decide what to do next. Drag (or keyboard) between columns updates the Pipeline `Status` cell via the existing write-back contract — **no new contracts**.

When `body.jb-v2` is **not** set, the region stays empty and the legacy markup (outside the region) renders byte-for-byte unchanged.

---

## 1. Column schema

The eight stages match `schemas/pipeline-row.v1.json` (`columns[].id="status"`) **exactly**:

| Order | Stage          | Closed? | Stage-dot key |
|------:|----------------|:-------:|---------------|
| 1     | New            |         | `new`           |
| 2     | Researching    |         | `researching`   |
| 3     | Applied        |         | `applied`       |
| 4     | Phone Screen   |         | `phone`         |
| 5     | Interviewing   |         | `interviewing`  |
| 6     | Offer          |         | `offer`         |
| 7     | Rejected       | ✓       | `rejected`      |
| 8     | Passed         | ✓       | `passed`        |

`<jb-stage-dot>` accepts only the lowercase keys above (per `jb-ui.js`); we map "Phone Screen" → `phone`.

**Closed stages** (Rejected + Passed) are hidden behind the **"Show closed"** mono pill in the toolbar. The toggle persists at `localStorage["jb-v2-lattice-show-closed"]` (`"1"` or absent).

Cards with a non-empty `dismissedAt` value are not rendered (parity with the legacy dismiss flow). Cards with no recognised status fall into **New**.

Sort within a column is deterministic by `data-stable-key` ascending (i.e. their Pipeline-row order). Within a column, keyboard reorder is local-only — it does not write back (no contract).

---

## 2. Drag & drop contract

- **Library:** none. Native HTML5 DnD only.
- **Pickup:** `dragstart` on a `.jb-lat__card` records `{ dataIndex, fromStage }` in module state and sets `aria-grabbed="true"`.
- **Hover:** the column under the pointer gets `data-drop-active="true"` (visual: dashed mint outline + mint-soft bg).
- **Drop:** on `drop`, if the drop column's `data-stage` differs from `fromStage`, we call:

  ```js
  window.updateJobStatus(dataIndex, newStage)
  ```

  This is the **only** write-back path. It is the same function the legacy `data-action="status-select"` and `data-action="stage-step"` handlers call (defined in `app.js` line ≈10708). We do not import any sheet client of our own.

- **Optimism:** local `pipelineData[idx].status` is mutated and the board re-rendered immediately. On promise rejection or `false` resolution, we revert and announce the failure on the `aria-live` region.
- **No-op:** drops onto the same column don't fire write-back; we only announce "Card stayed in <stage>".

### Manual repro for write-back persistence

1. `?jb-v2=1` and sign in to Google.
2. Open a real Pipeline sheet with at least one row.
3. Drag any card from **New** to **Applied**.
4. Watch the toast (`Updated to "Applied" — applied date set`) — that toast comes from the existing `updateJobStatus` write-back inside `app.js`, proving the contract was hit.
5. Reload the page (`⌘R`).
6. The same card should re-appear in **Applied**, sourced fresh from the sheet.

---

## 3. Keyboard support (REQUIRED)

Tab-order is column-by-column, top-to-bottom (DOM order matches visual order; we do not override `tabindex` beyond the cards).

| Keys                     | Action                                                  |
|--------------------------|---------------------------------------------------------|
| `Tab` / `Shift+Tab`      | Move focus card-to-card across columns.                  |
| `Enter` / `Space`        | Open the role drawer (`window.openJobDetail(stableKey)`). |
| `⌘ ←` / `⌃ ←`            | Move focused card to the **previous** stage (write-back). |
| `⌘ →` / `⌃ →`            | Move focused card to the **next** stage (write-back).     |
| `⌘ ↑` / `⌃ ↑`            | Reorder card up within column (visual-only, no write-back). |
| `⌘ ↓` / `⌃ ↓`            | Reorder card down within column (visual-only).            |
| `/`                       | Focuses the search input (when no input is already focused). |

### Screen-reader announcements

Lattice owns a single visually-hidden `aria-live="polite"` region (`#jb-lat-live`) inside `[data-region="lattice"]`. The following events post a short message there:

- Pickup: `Picked up <Title> from <Stage>`
- Drop different col: `Moved to <Stage>`
- Drop same col: `Card stayed in <Stage>`
- Reorder: `Reordered <Title>`
- Failed write-back: `Move failed; reverted to <PreviousStage>`

Each card has `role="button"`, `aria-roledescription="Draggable card"`, `aria-grabbed`, and a focus ring (`:focus-visible` → `var(--jb-shadow-focus)`).

---

## 4. Scroll persistence

The board container (`.jb-lat__board`) has `overflow-x: auto`. Its `scrollLeft` is debounced-persisted (150ms) to:

```
localStorage["jb-v2-lattice-scroll"] = "<integer pixels>"
```

On `init()` and on every full re-render, we restore the saved value. The board uses `scroll-snap-type: x mandatory` with `scroll-snap-align: start` on each column so flicks always land on a column edge.

Vertical column scroll lives **inside** each `.jb-lat__list`, capped at `max-height: 72vh` so the board itself never grows the page beyond one viewport.

---

## 5. Empty states

Empty columns render a dashed-border placeholder sticker:

```
[ STAGE-NAME ]
nothing here — add a role above
```

(See `.jb-lat__empty` in `lattice.css`.)

---

## 6. Self-test

`lattice.js` ships with an inline self-test gated behind a URL param. Open:

```
http://localhost:8080/?jb-v2=1&jb-v2-test=lattice
```

The test:

1. Stubs `window.updateJobStatus` with a spy that resolves `true`.
2. Replaces `window.pipelineData` with a single synthetic job in stage "New".
3. Calls `handleStageChange(0, "New", "Applied")` — the same code path a real drop fires.
4. Asserts the spy was called with `(0, "Applied")`.
5. Logs `[lattice self-test] PASS` (or `FAIL` with details) and announces the result.
6. Restores the originals and re-renders the real board.

In normal use (no `jb-v2-test=lattice` param), the test never runs.

---

## 7. Manual a11y checklist (axe-core not run automatically)

We did **not** wire an automated axe-core run inside this skill (the repo does not have one for the legacy dashboard either). Run the following manual checks:

- ✓ Each column has a unique `aria-label="<Stage> column"`.
- ✓ Each card is a focusable button-roled element with a meaningful accessible name (its `<h4>` title is the first text node).
- ✓ The aria-live region announces every drag/drop/keyboard move.
- ✓ Focus ring is visible on `:focus-visible` (mint shadow).
- ✓ Reduced motion is respected (`@media (prefers-reduced-motion: reduce)` removes drag rotation and snap easing).
- ✓ All color tokens come from `tokens-v2.css`; contrast ratios for `--jb-ink`/`--jb-ink-2` on `--jb-paper`/`--jb-paper-2` were already audited by Atlas in Phase 1.

Optional: with the page open and the kanban rendered, paste the axe-core CDN snippet into the console and run `axe.run([data-region="lattice"])` — at time of authorship, no serious or critical issues were observed in dev with mock data.

---

## 8. Hard rules followed

1. **Forge primitives + Quill utilities only.** No new chip / ring / dot code; cards re-use `.jb-sticker`, `<jb-fit-ring>`, `<jb-stage-dot>`. Mono caps on column counts use existing tokens; no new component class outside `.jb-lat__*` (which are scoped layout helpers, not new primitives).
2. **No change to write-back contracts.** `updateJobStatus(dataIndex, newStage)`, `data-action`, `data-stable-key`, and `expandedJobKeys` are unchanged.
3. **Read state, never invent.** Column enum is byte-identical to `schemas/pipeline-row.v1.json` `columns[id="status"].enum`.
4. **Token-only CSS.** `node tools/lint-tokens.mjs` passes against `lattice.css`.
5. **Region scope.** `index.html` diff is the two head imports (one `<link>`, one `<script defer>`) plus the region body itself.
6. **Native DnD.** Zero drag-library import.
7. **Keyboard accessibility.** Documented above; tab order is DOM order; `aria-live` announces all moves.
8. **Persisted scroll.** `localStorage["jb-v2-lattice-scroll"]`.

---

## 9. Files

- `lattice.css` — scoped layout & sticker shape under `body.jb-v2 [data-region="lattice"]`.
- `lattice.js` — render + DnD + keyboard + write-back delegation + self-test.
- `index.html` — region content + the two head imports.
- `MIGRATION.md` — appended `## Phase 3 · Lattice` section.
