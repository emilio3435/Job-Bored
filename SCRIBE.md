# SCRIBE.md — Phase 3 · ATS + Cover Letter Workspace

**Owner:** Scribe (Phase 3, parallel with Dawn / Lattice / Welcome)
**Activates:** `body.jb-v2` + region `<section data-region="scribe">`
**Off-flag:** legacy `#resumeGenerateModal` continues to render and behave byte-identically.

---

## 1. What changed

The legacy cover-letter / résumé authoring surface lived in a tall scrolling
modal (`#resumeGenerateModal`). Under v2 it is replaced by a **split-pane
workspace** that fills the page width. The workspace lives entirely in the
`region:scribe` block of `index.html` and is implemented in **`scribe.css`**
(token-only, scoped) and **`scribe.js`** (vanilla, no deps).

```
┌─ topbar ────────────────────────────────────────────────────────────┐
│ Draft for · Senior role · Co.   [Cover letter | Resume]   ⋯  Print  │
│                                                                Copy │
│                                                                Done │
├──────────────────────────────────┬──────────────────────────────────┤
│  Editor (jb-sticker, paper-2)    │  ATS Match (jb-sticker)          │
│  contenteditable=true            │  ▶ <jb-fit-ring size="lg">       │
│  17/28 line-height, generous     │  ▶ 6 axis bars (tier-coloured)   │
│  margins                         │  Gap callouts (≤3, anchored)     │
│                                  │  Talking points                  │
├──────────────────────────────────┴──────────────────────────────────┤
│ Refine this draft  [chip: more specific] [chip: cut to 250]  …      │
│ ┌────────────────────────────────────────────┐  [ Refine ]          │
│ │ textarea                                   │                       │
│ └────────────────────────────────────────────┘                       │
└──────────────────────────────────────────────────────────────────────┘
```

At `< 900px` the split collapses into a stacked layout (editor first, then
scorecard). The bottom strip is sticky on wide viewports and static on
narrow.

---

## 2. Split-pane spec

| Region          | Width                          | Notes                                                |
|-----------------|--------------------------------|------------------------------------------------------|
| `.scribe-pane--editor`    | `minmax(0, 1.55fr)` of split | `--jb-paper-2` background inside `.jb-sticker`. Geist 400, 17/28. |
| `.scribe-pane--scorecard` | `minmax(0, 1fr)` of split    | Three stickers stacked: scorecard / gap callouts / talking points. |
| `.scribe-strip` (footer)  | full width                    | Sticky on `min-width: 901px`; static below.          |
| Top bar         | full width                     | Tabs (Cover letter / Resume), appearance select, Print/PDF, Copy text, Done. |

The editor is a `[role="textbox"][aria-multiline="true"][contenteditable=true]`
node. Edits are mirrored into the legacy `#resumeGenerateOutput` textarea on
a 600 ms debounce; that legacy textarea is still the source of truth that
`scheduleResumeGenerateAtsRefresh()` and `refineLastResumeGeneration()` read
from.

---

## 3. Scorecard tier rules

The `<jb-fit-ring>` and per-axis bar fills derive their colour from the same
tier function that Forge uses for fit rings:

| Score (overall or axis) | Tier   | Token            |
|-------------------------|--------|------------------|
| `≥ 75%`                 | high   | `--jb-fit-high`  |
| `50% – 74%`             | mid    | `--jb-fit-mid`   |
| `< 50%`                 | low    | `--jb-fit-low`   |

The tier is reflected via `data-tier="high|mid|low"` on each `.scribe-axis`
so consumers can override colour without touching JS.

The six axes — in render order — are: **Req · Experience · Impact ·
Parseability · Tone · Confidence**. Each row is a label + bar (`<jb-spark>`
sits in the same cell, hidden by default, kept in the DOM so future
upgrades can swap the bar for a spark trail without re-rendering).

The footer line reads **`model demo-scorecard-v1 · 2.3s · audit log`**.
The audit-log link is a hash anchor placeholder — wiring it to a real audit
view is left to a future agent (open question, see §7).

---

## 4. Action mapping table

The legacy modal **does not use `data-action` attributes** for refine /
print / copy / done — those buttons are wired by **id**. Per the
non-negotiable rule (don't rename data-action attributes), Scribe re-uses
the legacy ids verbatim by triggering `click()` on the legacy DOM nodes
from new buttons. The legacy modal stays in the page but is hidden under
v2 by its own legacy CSS; its handlers continue to be the single point of
truth for refine/print/copy/done.

| Legacy hook (id / data-action)                     | New button location (under `[data-region="scribe"]`) |
|----------------------------------------------------|------------------------------------------------------|
| `#resumeGenerateRefine` (id)                       | `#scribeRefineBtn` (bottom strip)                    |
| `#resumeGenerateFeedback` (id, textarea)           | `#scribeRefineInput` (mirrored on Refine click)      |
| `#resumeGeneratePrint` (id)                        | `#scribePrintBtn` (top bar)                          |
| `#resumeGenerateCopy` (id)                         | `#scribeCopyBtn` (top bar)                           |
| `#resumeGenerateDone` (id)                         | `#scribeDoneBtn` (top bar)                           |
| `#resumeGenerateClose` (id)                        | (fallback for Done if Done id is missing)            |
| `#resumeGenerateOutput` (id, textarea)             | `#scribeEditor` (mirrored both ways, 600 ms debounce)|
| `#resumeGenerateVisualTheme` (id)                  | `#scribeAppearance` (option list mirrored on render) |
| `[data-action="draft-tab"][data-feature=*]`        | `.scribe-tab[data-feature=*]` (top bar tabs; click delegates to legacy) |
| `[data-action="retry-ats-scorecard"]`              | (unchanged; legacy retry stays inside scorecard hint) |

Two existing `data-action` names are preserved verbatim and reused by
delegation (`draft-tab`, `retry-ats-scorecard`). No new `data-action`
attributes are introduced.

---

## 5. Interactions

1. **Typing → rescore.** `input` on the editor schedules a 600 ms debounce.
   On flush, the editor's plain-text projection is written into
   `#resumeGenerateOutput`, and a synthetic `input` event is dispatched so
   the existing `scheduleResumeGenerateAtsRefresh()` listener picks up the
   change. Scribe also paints a fast local fallback scorecard so the panes
   never render "blank" while the real scorecard is in flight. The status
   pip in the strip cycles `idle → typing → scored`.

2. **Refine.** Click → mirror current editor body into
   `#resumeGenerateOutput`, copy the strip textarea into
   `#resumeGenerateFeedback`, then `click()` `#resumeGenerateRefine`. The
   refine handler in `app.js` writes the new draft into
   `#resumeGenerateOutput`. After `~350 ms` Scribe re-pulls the textarea
   back into the editor (single undo step, since the editor's HTML is
   replaced wholesale once).

3. **Quick chips.** "more specific", "cut to 250 words", "emphasize
   Python" — clicking a chip appends its text to the strip textarea
   (separated by `; `) and focuses it. The user can edit before submit.

4. **Gap → anchor.** Clicking a gap callout calls `flashAnchor()`, which
   scrolls the matching paragraph into view (`scrollIntoView`,
   `behavior: smooth`) and toggles the Quill `.jb-mark` utility on it for
   ~900 ms (extra `.scribe-anchor-flash` modifier brightens the highlight
   to amber so it reads against paper).

5. **Tabs.** Clicking the Cover letter / Resume tab in the top bar
   delegates to the existing `[data-action="draft-tab"][data-feature=…]`
   button so the legacy active-panel logic runs untouched.

6. **Appearance.** The select is mirrored from
   `#resumeGenerateVisualTheme`. Changing it propagates the value back to
   the legacy select and dispatches `change`, so the existing theme-swap
   handler runs.

---

## 6. Smoke routine

`scribe.js` includes an inline smoke routine gated behind
**`?jb-v2-test=scribe`**. It monkey-patches `HTMLElement.prototype.click`
to record every dispatched id, then programmatically clicks the four new
top-level / strip buttons and asserts the matching legacy id was clicked.

```
?jb-v2=1&jb-v2-test=scribe
```

Expected console output (table-formatted):

```
[scribe smoke] PASS
┌─────────┬───────────────────────┬─────────────────────────┬──────┐
│ (idx)   │ btn                   │ legacy                  │ ok   │
├─────────┼───────────────────────┼─────────────────────────┼──────┤
│ 0       │ '#scribePrintBtn'     │ 'resumeGeneratePrint'   │ true │
│ 1       │ '#scribeCopyBtn'      │ 'resumeGenerateCopy'    │ true │
│ 2       │ '#scribeDoneBtn'      │ 'resumeGenerateDone'    │ true │
│ 3       │ '#scribeRefineBtn'    │ 'resumeGenerateRefine'  │ true │
└─────────┴───────────────────────┴─────────────────────────┴──────┘
```

A failure prints `[scribe smoke] FAIL` and a row with `ok: false`. Results
are also stashed on `window.__JB_SCRIBE_SMOKE_RESULTS__` for headless CI.

For ad-hoc checks:

```js
// In DevTools, with body.jb-v2 set:
JB_SCRIBE.smoke();        // runs the assertion suite
JB_SCRIBE.rescore();      // forces a fallback rescore
JB_SCRIBE.syncEditorIntoLegacy();  // pushes editor → #resumeGenerateOutput
```

---

## 7. Accessibility checklist

(In the absence of an automated axe-core run inside this swarm, this is the
manual checklist Scribe ran against the rendered DOM.)

- [x] Editor has `role="textbox"`, `aria-multiline="true"`, and a stable
      `aria-label`.
- [x] Topbar exposes `role="toolbar"` with a labelled button set;
      `Cover letter | Resume` form a `role="tablist"` with `aria-selected`
      reflecting active state.
- [x] `<jb-fit-ring>` carries `role="meter"` plus aria-valuemin/max/now via
      Forge primitive.
- [x] All buttons keyboard-reachable; `:focus-visible` paints the AA
      `--jb-shadow-focus` ring.
- [x] Chip group is `role="group"` with `aria-label`.
- [x] `prefers-reduced-motion` disables axis-fill transitions and the
      anchor flash transition.
- [x] Region falls back to `display: none` outside `body.jb-v2`, so the
      legacy modal is the sole tabbable cover-letter surface in legacy
      mode (no dual-focus traps).
- [x] No new `<dialog>` / modal — workspace is a region in the document
      flow, so no focus-trap escape hatch is required.

Open follow-ups: an automated axe-core gate is a future-Phase concern
(would belong in `tools/audit-jb-ui-a11y.mjs`).

---

## 8. Defensible choices made without conductor input

1. **Legacy modal preserved in DOM.** Removing it would break off-flag
   parity (the rule is byte-identical legacy when `body.jb-v2` is absent).
   It is hidden under v2 by its own legacy display rules; its IDs remain
   the canonical handlers.
2. **Click-delegation, not handler relocation.** The brief asks to "reuse
   data-action names verbatim". The legacy modal uses **ids** instead of
   `data-action` for these four buttons; the spirit of the rule (don't
   move/rename existing handlers) is honoured by delegating new buttons to
   the legacy ids via `click()`. This keeps all refine/print/copy/done
   logic in `app.js` exactly where it was.
3. **Local fallback scorecard.** When the real ATS pipeline hasn't yet
   produced a result, a deterministic heuristic fills the bars so the
   panes are never empty. The pipeline overrides as soon as it returns.
4. **Audit-log link is a placeholder.** No audit-log surface exists yet
   in the legacy code; Scribe leaves an `href="#"` so a follow-up agent
   can wire it without renaming markup.
5. **Resume tab content not authored separately.** Phase 3 tabs flip the
   *legacy* draft-deck panels via the existing `data-action="draft-tab"`
   listener — no new resume-tab content is introduced here.
