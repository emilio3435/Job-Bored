# MIGRATION.md — JobBored v2 token migration

**Owner:** Atlas (Phase 1 foundation agent)
**Status:** Phase 1 shipped. Forge / Quill / Dawn / Lattice / Scribe / Welcome consume from here.
**Scope:** purely additive. Adding `class="jb-v2"` to `<body>` flips the page to the v2 visual language; removing the class restores legacy byte-for-byte.

This document maps every legacy `:root` variable in `style.css` (lines 1–200) to its v2 equivalent, plus a short "How to consume Atlas tokens" section for downstream agents.

---

## 1. Legacy → v2 token map

| Legacy var (style.css `:root`)        | v2 var (`tokens-v2.css`)                | Notes |
|---------------------------------------|-----------------------------------------|-------|
| `--bg`               `#f8fafc`        | `--jb-paper`        `#FFFEF9`           | Cool slate → warm paper. Global background. |
| `--bg-raised`        `#ffffff`        | `--jb-paper`        `#FFFEF9`           | No more white surface in v2 — paper is the surface. |
| `--surface`          `#ffffff`        | `--jb-surface`      `#FFFEF9`           | Aliased to paper. |
| `--surface-2`        `#f1f5f9`        | `--jb-paper-2`      `#FBF7EE`           | Cream tint, raised paper / mastheads. |
| `--surface-hover`    `#f8fafc`        | `--jb-paper-2`                          | Forge: use paper-2 for hover, or sticker shadow elevation. |
| `--border`           `#e2e8f0`        | `--jb-line-soft`    `#E5DFCC`           | Default border. |
| `--border-bright`    `#cbd5e1`        | `--jb-line`         `#C9C2B0`           | Hard / dashed line per wireframe. |
| `--divider`          `#f1f5f9`        | `--jb-line-strong`  `rgba(14,58,78,.12)`| Navy-tinted strong rule. |
| `--accent`           `#59cb89`        | `--jb-mint`         `#5FCB8E`           | Warmer than legacy. Primary accent. |
| `--accent-dim`       `rgba(89,203,137,.1)` | `--jb-mint-soft` `#DCF1E2`         | Soft mint background tint. |
| `--accent-hover`     `#45b676`        | `--jb-mint-deep`    `#2F8A5A`           | AA-contrast mint for text-on-paper. |
| `--accent-text`      `#006482`        | `--jb-navy`         `#0E3A4E`           | Deeper, more print-like navy. |
| `--text`             `#003851`        | `--jb-ink`          `#1B2B33`           | Body ink. |
| `--text-muted`       `#3d6272`        | `--jb-ink-2`        `#3A5566`           | Subdued body. |
| `--text-faint`       `#7a9aab`        | `--jb-ink-3`        `#6B8493`           | Captions, faint text. |
| `--text-inverse`     `#fefffe`        | `--jb-ink-inverse`  `#FFFEF9`           | Text on dark navy backgrounds. |
| `--hot-orange`       `#ef8f26`        | `--jb-amber`        `#EF8F26`           | Pass-through. Action / urgency. |
| `--hot-bg`           `#fef6eb`        | `--jb-amber-soft`   `#FAE2C2`           | Amber background. |
| `--hot-border`       `#f5d4a0`        | `--jb-amber-soft`   `#FAE2C2`           | Reused; v2 collapses bg+border. |
| `--high-yellow`      `#ca8a04`        | `--jb-warn`         `#A16207`           | Cooler, more contrast on paper. |
| `--high-bg`          `#fefce8`        | `--jb-yellow-tape`  `#FCEFA8`           | Washi tape / highlight. |
| `--high-border`      `#fef08a`        | `--jb-yellow-tape`  `#FCEFA8`           | Reused. |
| `--stage-rail-new`           `#7a9aab`| `--jb-stage-new`           `#6B8493`    | 1:1 semantic. Slightly darker. |
| `--stage-rail-researching`   `#7c3aed`| `--jb-stage-researching`   `#7C3AED`    | Pass-through. |
| `--stage-rail-applied`       `#ef8f26`| `--jb-stage-applied`       `#EF8F26`    | Pass-through. |
| `--stage-rail-phone-screen`  `#0891b2`| `--jb-stage-phone`         `#0891B2`    | Renamed (drop `-screen`). |
| `--stage-rail-interviewing`  `#59cb89`| `--jb-stage-interviewing`  `#5FCB8E`    | Warmer. |
| `--stage-rail-offer`         `#16a34a`| `--jb-stage-offer`         `#2F8A5A`    | Mint-deep, more inky. |
| `--stage-rail-rejected`      `#b91c1c`| `--jb-stage-rejected`      `#C0392B`    | Brick rose, less saturated. |
| `--stage-rail-passed`        `#64748b`| `--jb-stage-passed`        `#64748B`    | Pass-through. |
| `--status-new-bg / -text`             | (use `--jb-info-bg` / `--jb-info`)      | Lattice: derive stage badge styles from stage rail tokens. |
| `--status-researching-bg`             | `--jb-violet-soft`  `#E8DEF7`           | |
| `--status-researching-text`           | `--jb-violet`       `#7C3AED`           | |
| `--status-applied-bg / -text`         | (`--jb-amber-soft` / `--jb-amber`)      | |
| `--status-phone-bg / -text`           | (derive from `--jb-stage-phone`)        | Lattice: use mix() or a soft-bg utility. |
| `--status-interviewing-bg / -text`    | (`--jb-mint-soft` / `--jb-mint-deep`)   | |
| `--status-offer-bg / -text`           | (`--jb-mint-soft` / `--jb-mint-deep`)   | |
| `--status-rejected-bg / -text`        | (`--jb-err-bg` / `--jb-err`)            | |
| `--status-passed-bg / -text`          | (`--jb-paper-2` / `--jb-ink-2`)         | |
| `--fit-high`         `#15803d`        | `--jb-fit-high`     `#2F8A5A`           | Aligned with mint-deep. |
| `--fit-mid`          `#a16207`        | `--jb-fit-mid`      `#A16207`           | Pass-through. |
| `--fit-low`          `#7a9aab`        | `--jb-fit-low`      `#6B8493`           | |
| `--toast-success / -bg`               | `--jb-ok` / `--jb-ok-bg`                | |
| `--toast-error / -bg`                 | `--jb-err` / `--jb-err-bg`              | |
| `--toast-info / -bg`                  | `--jb-info` / `--jb-info-bg`            | |
| `--status-ok / -ok-bg / -ok-border`   | `--jb-ok` / `--jb-ok-bg`                | Border deprecated under v2 — use `--jb-shadow-card` or `--jb-line-soft` instead. |
| `--status-warn / -bg / -border`       | `--jb-warn` / `--jb-warn-bg`            | Border deprecated under v2. |
| `--status-err / -bg / -border`        | `--jb-err` / `--jb-err-bg`              | Border deprecated under v2. |
| `--status-info / -bg / -border`       | `--jb-info` / `--jb-info-bg`            | Border deprecated under v2. |
| `--font-body`  ("DM Sans", …)         | `--jb-font-body`    ("Geist", …)        | Geist replaces DM Sans. |
| `--font-mono`  ("JetBrains Mono", …)  | `--jb-font-mono`    (same)              | Pass-through. |
| (no legacy display font)              | `--jb-font-display` ("Caveat", …)       | New. h1/h2 + `.jb-handwritten` only. |
| `--text-xs … --text-2xl`              | `--jb-text-xs … --jb-text-3xl`          | Anchored ~14–15px base; v2 adds `--jb-text-3xl`. |
| `--space-1 … --space-16`              | no change — keep legacy var             | Spacing scale unchanged. |
| `--radius-sm / -md / -lg / -xl`       | `--jb-radius-sm / -md / -lg / -xl`      | Same scale, slight tweaks (`-lg` 14px, `-xl` 22px to match wireframe). v2 adds `--jb-radius-xs` (4px) and `--jb-radius-pill`. |
| `--radius-card` `1.125rem`            | `--jb-radius-xl`    `22px`              | |
| `--radius-soft` `0.625rem`            | `--jb-radius-md`    `12px`              | |
| `--shadow-sm / -md / -lg / -hover`    | `--jb-shadow-pencil / -sticker / -card / -focus` | New shadow language. `pencil` replaces sm; `card` replaces md/lg; `sticker` is new (polaroid pop); `focus` is new (AA ring). |
| `--glass-bg` `#ffffff`                | `--jb-paper`                            | No glass in v2. |
| `--glass-bg-hover` `#f8fafc`          | `--jb-paper-2`                          | |
| `--glass-stroke` `rgba(15,23,42,.06)` | `--jb-line-strong`                      | |
| `--ease`                              | `--jb-ease`                             | Same curve. |
| `--transition`                        | `--jb-transition-base`                  | Same duration (180ms). v2 adds `-fast` (120) and `-slow` (320). |

**Legend**
- *"no change — keep legacy var"* → the legacy var is still used by Phase 2+ components without a v2 equivalent.
- *"deprecated under jb-v2"* → do not introduce new uses inside the v2 scope; v2 collapses the surface (e.g. status borders).

---

## 2. How to consume Atlas tokens

Phase 2+ agents (Forge, Quill, Dawn, Lattice, Scribe, Welcome) write component styles into their own files (`jb-*.css`). Three rules:

1. **Always scope under `body.jb-v2`.** Bare selectors are forbidden — they would leak into the legacy UI.
2. **Never write a raw hex literal.** Reference `--jb-*` tokens. The CI lint (`tools/lint-tokens.mjs`) fails the build on raw hex inside any `jb-*.css` or any CSS file scoped under `body.jb-v2`.
3. **Don't redefine `--jb-*` tokens.** If you need a new token, ship a Phase-1 patch through Atlas. Do not declare `--jb-...` inside a component file.

### Example 1 — a card primitive (Forge)

```css
body.jb-v2 .jb-card {
  background: var(--jb-paper);
  border: 1px solid var(--jb-line-soft);
  border-radius: var(--jb-radius-lg);
  box-shadow: var(--jb-shadow-card);
  padding: var(--space-4); /* legacy spacing scale is unchanged */
  transition: box-shadow var(--jb-transition-base);
}

body.jb-v2 .jb-card:hover {
  box-shadow: var(--jb-shadow-sticker);
}
```

### Example 2 — stage rail (Lattice)

```css
body.jb-v2 .jb-card[data-stage="researching"] {
  border-left: 3px solid var(--jb-stage-researching);
}

body.jb-v2 .jb-card[data-stage="applied"] {
  border-left: 3px solid var(--jb-stage-applied);
}
```

### Example 3 — a handwritten heading (Quill)

```css
body.jb-v2 .jb-section-title {
  font-family: var(--jb-font-display);
  font-size: var(--jb-text-2xl);
  color: var(--jb-navy);
}
```

### Lint locally before pushing

```sh
node tools/lint-tokens.mjs                # full repo scan
node tools/lint-tokens.mjs --paths jb-card.css   # one file
```

Exit 0 = clean. Exit 1 = raw hex found; switch to a token.

---

## 3. What did NOT change

- The legacy `style.css` file. Untouched.
- `index.html`, `app.js`, any JS module. Untouched.
- Pipeline write-back contracts: `data-action`, `data-stable-key`, `data-job-id`, `expandedJobKeys`. Atlas never references these.
- The legacy spacing scale `--space-*`. Reused as-is by v2.

If you find yourself wanting to modify any of the above, you are out of Phase 1 scope. Stop and ping the conductor.

---

<!-- AGENT-SECTIONS-BELOW -->

<!-- Forge: jb-ui components (Phase 2) -->

## 4. Forge additions — jb-ui components (Phase 2)

Five vanilla custom elements registered by `jb-ui.js` plus one CSS-only class:

| Hook | Purpose | Example |
|---|---|---|
| `<jb-fit-ring>` | Conic-gradient role-fit ring with center number | `<jb-fit-ring percent="78" size="md"></jb-fit-ring>` |
| `<jb-spark>` | SVG sparkline with optional translucent area fill | `<jb-spark data="1,2,1,5,3,7,8" color="mint"></jb-spark>` |
| `<jb-stage-dot>` | 8px stage indicator with halo + optional label | `<jb-stage-dot stage="applied" label="Applied"></jb-stage-dot>` |
| `<jb-ai-chip>` | Pill chip for AI-generated content; default/summary/tip/warn | `<jb-ai-chip variant="warn">Posting older than 30 days</jb-ai-chip>` |
| `<jb-kbd>` | Inline keyboard shortcut chips with pretty-printed keys | `<jb-kbd keys="cmd+shift+p"></jb-kbd>` |
| `.jb-sticker` | Signature paper-card primitive (CSS-only) | `<article class="jb-sticker" data-tape>…</article>` |

Full reference: [`JB-UI.md`](JB-UI.md). Demo states: [`jb-ui.demo.html`](jb-ui.demo.html). Tooling: `tools/check-jb-ui-budget.mjs` and `tools/audit-jb-ui-a11y.mjs`.

<!-- Quill: type & decoration utilities (Phase 2) -->

## 5. Quill additions — type ramp & decoration utilities (Phase 2)

Quill ships two stylesheets — a complete type ramp (`jb-type.css`) and a set of hand-drawn decoration utilities (`jb-deco.css`). All scoped under `body.jb-v2`. Token-only.

### Type ramp (`jb-type.css`)

Anchors h1–h6 + body + utility classes. Sizes via Atlas's clamp() tokens. Caveat is **only** applied to h1, h2, and `.jb-handwritten` — never on body, buttons, or chips.

| Selector | Family | Role |
|---|---|---|
| `body.jb-v2 h1` | Caveat (display) | Display headline; line-height 1.0 |
| `body.jb-v2 h2` | Caveat (display) | Section headline; line-height 1.05 |
| `body.jb-v2 h3` | Geist (body) | Sub-section; weight 600 |
| `body.jb-v2 h4` | Geist (body) | Minor heading; weight 600 |
| `body.jb-v2 h5, h6` | JetBrains Mono | Eyebrows / kickers; uppercase, tracked |
| `body.jb-v2 p` | Geist (body) | Body copy; line-height 1.55, hyphens auto |
| `body.jb-v2 small`, `.jb-caption` | Geist | Faint copy in ink-3 |
| `body.jb-v2 .jb-data` | JetBrains Mono | Numerics, deltas, stamps; tnum + ss01 |
| `body.jb-v2 .jb-handwritten` | Caveat | Single-phrase mint-deep accents |
| `body.jb-v2 blockquote` | Geist italic | Paper-2 left rule, ink-2 |
| `body.jb-v2 kbd, code, pre` | JetBrains Mono | Code surfaces |

### Decoration utilities (`jb-deco.css`)

Hand-drawn touches. Inline data-URI SVGs use `stroke='currentColor'` so the pseudo's `color` token drives the hue (no raw hex inside data URIs).

| Class | Purpose | Example |
|---|---|---|
| `.jb-underline-squiggle` | Animated mint squiggle under inline text. `--alt-a` (loose) and `--alt-b` (tight zigzag) variants. | `<span class="jb-underline-squiggle">Senior Backend Engineer</span>` |
| `.jb-underline-flat` | Yellow-tape highlighter rectangle, slightly skewed. | `<span class="jb-underline-flat">a fast-track loop</span>` |
| `.jb-tape` / `.jb-tape--long` | Absolute-position washi-tape strip. Override rotation via `--jb-tape-rotate`. | `<span class="jb-tape" style="top:-7px;left:24px;"></span>` |
| `.jb-mark` | Inline mint-soft highlighter that wraps cleanly across lines. | `<span class="jb-mark">distributed job queues</span>` |
| `.jb-stamp` / `--urgent` / `--ok` | Small rotated mono pill ("DRAFT", "URGENT", "READY"). Override rotation via `--jb-stamp-rotate`. | `<span class="jb-stamp jb-stamp--urgent">urgent</span>` |
| `.jb-divider-dashed` | Repeating-gradient horizontal rule in `--jb-line`. | `<hr class="jb-divider-dashed" />` |
| `.jb-shadow-pencil` / `.jb-shadow-sticker` | Shadow-utility shorthands for ad-hoc sprinkling. | `<div class="jb-shadow-pencil">…</div>` |

All animated utilities respect `prefers-reduced-motion: reduce`.

### Fonts in `index.html`

The `<head>` now loads Caveat + Geist + JetBrains Mono via a single Google Fonts `<link>`, plus two `<link rel="preload">` entries for Geist 400 and Caveat 600 (the most common bodies). Legacy DM Sans / Lora / Source Sans 3 are no longer requested. The duplicate `@import` previously inside `jb-v2.css` has been removed in favor of the `<link>` (a `<link>` is faster than the @import chain).

Full font perf report: [`docs/redesign/jb-fonts-perf.md`](docs/redesign/jb-fonts-perf.md). Mascot tokenization review (read-only, awaiting approval): [`docs/redesign/mascot-review.md`](docs/redesign/mascot-review.md).

<!-- Dawn: Daily Brief screen (Phase 3) -->

## 6. Phase 3 · Dawn — Daily Brief screen

Dawn replaces the legacy `.daily-brief-panel` with an editorial, scan-first overview, scoped under `body.jb-v2 [data-region="dawn"]`. Off-flag → legacy panel renders unchanged.

| Asset | Role |
|---|---|
| `dawn.css` | Token-only styles for the region. Lints clean against `tools/lint-tokens.mjs`. |
| `dawn-data.js` | Read-only adapter. Exports `window.JobBoredDawn.data.getDawnViewModel()`. NO fetches, NO schema changes. |
| `dawn.js` | Vanilla renderer. Activates only when `body.jb-v2` is present. Idempotent re-render via `MutationObserver` + `requestIdleCallback` (rAF fallback). |
| `DAWN.md` | One-page screen spec: layout, headline ruleset, data contract, a11y checklist, acceptance criteria. |

**What Dawn consumes** (read-only DOM):

- `#briefStats .stat-card` — rendered by legacy `renderBriefStats`. Source for the four hero numbers + their sub-text.
- `#briefDate` — date eyebrow.
- `.kanban-card[data-stable-key]` — per-job stage (via `kanban-card--stage-XXX` class), title, company, `data-index`. Source for funnel + activity feed.

**What Dawn kills** (inside `region:dawn` only — legacy markup outside the region is preserved):

- Full-width "top sources by location" bar.
- Donut + line-chart pair (replaced by the funnel).
- The two ticker callouts at the bottom of the legacy view.

**Contract preservation**: `expandedJobKeys`, `data-action`, `data-stable-key` are not touched. Activity-feed clicks dispatch `.click()` on the matching legacy `.kanban-card[data-stable-key]`, which routes through the existing `openJobDetail()` event delegation. No re-implementation.

**Forge / Quill primitives used**: `<jb-spark>`, `<jb-stage-dot>`, `<jb-ai-chip variant="summary">`, `.jb-sticker`, `.jb-data`, `.jb-caption`. No new components, no new utility classes.

Full screen spec: [`DAWN.md`](DAWN.md).

---

## Phase 3 · Lattice

**Owner:** Lattice. **Region:** `<!-- region:lattice:start --> … :end -->` in `index.html` (container has `data-region="lattice"`). **Files:** `lattice.css` + `lattice.js` (linked from `<head>`).

Replaces the legacy vertically-stacked stage list with a real horizontal kanban that activates only when `body.jb-v2` is present. Cards are `.jb-sticker` instances and re-use Forge primitives (`<jb-fit-ring>`, `<jb-stage-dot>`); no new chip / ring / dot code was added.

**Column enum** (matches `schemas/pipeline-row.v1.json` `columns[id="status"].enum` exactly):

```
New, Researching, Applied, Phone Screen, Interviewing, Offer, Rejected, Passed
```

`Rejected` and `Passed` are hidden by default; the **"Show closed"** mono pill in the toolbar toggles them and persists at `localStorage["jb-v2-lattice-show-closed"]`.

**DnD / keyboard contract.** Native HTML5 DnD only — no library. Drop on a different column calls `window.updateJobStatus(dataIndex, newStage)` (the existing write-back used by the legacy `data-action="status-select"` and `data-action="stage-step"` handlers in `app.js`). No new contract was introduced. `data-action`, `data-stable-key`, and `expandedJobKeys` are untouched. Optimistic UI; reverts on failure with an `aria-live` announcement.

Keyboard parity: `⌘ ←` / `⌘ →` move focused card to the prev/next stage (write-back); `⌘ ↑` / `⌘ ↓` reorder within a column (visual-only); `Enter` / `Space` opens the role drawer via `window.openJobDetail(stableKey)`; `/` focuses the search field.

**Scroll persistence.** Board horizontal `scrollLeft` is debounced-persisted to `localStorage["jb-v2-lattice-scroll"]` and restored on every render.

Full screen contract, manual a11y checklist, and self-test instructions live in [`LATTICE.md`](LATTICE.md).


<!-- Scribe: ATS + Cover Letter workspace (Phase 3) -->

## 6. Scribe additions — ATS + Cover Letter workspace (Phase 3)

Scribe replaces the tall `#resumeGenerateModal` with a split-pane workspace inside `region:scribe`. Editor on the left (contenteditable, Geist 17/28 inside a `.jb-sticker`), ATS scorecard on the right (Forge `<jb-fit-ring size="lg">` + 6 axis bars, Quill `.jb-stamp` "DRAFT" tape on the corner), refine instructions in a docked bottom strip. Stacks to a single column at viewports `< 900px`.

**Region scope.** Only the `<section data-region="scribe">` body and two head imports (`scribe.css`, `scribe.js`) are added. Outside the region: untouched. Off the v2 flag: legacy modal renders unchanged.

**Action mapping (legacy → Scribe).** The legacy modal wires Refine / Print / Copy / Done by **id**, not by `data-action`. To honor "do not rename `data-action` attributes", Scribe re-uses every legacy id verbatim by triggering `click()` on the legacy DOM nodes. The legacy modal stays in the DOM and is hidden under v2 by its own legacy CSS; its handlers in `app.js` remain the single point of truth.

| Legacy hook (id / data-action) | New button location |
|---|---|
| `#resumeGenerateRefine` | `#scribeRefineBtn` (bottom strip) |
| `#resumeGenerateFeedback` | `#scribeRefineInput` (mirrored on Refine click) |
| `#resumeGeneratePrint` | `#scribePrintBtn` (top bar) |
| `#resumeGenerateCopy` | `#scribeCopyBtn` (top bar) |
| `#resumeGenerateDone` | `#scribeDoneBtn` (top bar) |
| `#resumeGenerateClose` | (fallback for Done if Done id is missing) |
| `#resumeGenerateOutput` | `#scribeEditor` (mirrored both ways, 600 ms debounce) |
| `#resumeGenerateVisualTheme` | `#scribeAppearance` (option list mirrored on render) |
| `[data-action="draft-tab"][data-feature=*]` | `.scribe-tab[data-feature=*]` (delegates `click()` to legacy) |
| `[data-action="retry-ats-scorecard"]` | (unchanged — legacy retry stays inside scorecard hint) |

No new `data-action` names are introduced; two existing ones (`draft-tab`, `retry-ats-scorecard`) are preserved verbatim.

**Smoke routine.** A `?jb-v2-test=scribe` URL gate runs an inline assertion suite (monkey-patches `HTMLElement.prototype.click` to record dispatched ids, then clicks each new button and confirms the matching legacy id fired). PASS / FAIL prints to console; results are also stashed on `window.__JB_SCRIBE_SMOKE_RESULTS__`. Full spec, scorecard tier rules, and a11y checklist: [`SCRIBE.md`](SCRIBE.md).


<!-- Welcome: Onboarding + first-run empty state (Phase 3) -->

## 7. Welcome additions — onboarding + first-run empty state (Phase 3)

Welcome replaces the legacy single-step onboarding card (rendered while `body.jb-v2` is on) with a paced **9-step flow** inside `region:welcome`, plus the **first-run empty state** for the dashboard ("nothing here yet — paste a URL"). Off the v2 flag, neither surface activates and the legacy onboarding card / `#emptyState` render unchanged.

**Region scope.** Only the `<div data-region="welcome">` host and two head imports (`welcome.css`, `welcome.js`) are added. The `data-region="welcome"` host is mounted inside the region markers; `welcome.js` lazily fills it. Outside the region: untouched.

**localStorage persistence schema.** Key `jb-v2-onboarding`:

```jsonc
{
  "step": 1,                   // integer 1-9
  "values": {
    "name": "",                // step 1
    "goal": "active",          // step 2: "active" | "casual" | "coasting"
    "sources": [],             // step 3: ["greenhouse","lever","ashby","linkedin","indeed","manual"]*
    "tone": "warm",            // step 4: "direct" | "warm" | "formal" (verbatim legacy strings)
    "stack": "",               // step 5: comma-list of skills
    "comp": 120000,            // step 6: USD integer (target, not range)
    "locations": [],           // step 7: chip labels
    "sheetId": ""              // step 8: populated when legacy connect succeeds
  },
  "updatedAt": "ISO-8601"
}
```

State is written on every input/click and step navigation, then **flushed to legacy stores on Step 9 submit** and the local key is cleared.

**Field-key mapping (Welcome → legacy stores).** Welcome never invents new schema; every value writes through to the same `CommandCenterUserContent` surface the legacy onboarding wizard uses (`app.js:16280-16347`).

| Welcome field | Legacy store / call | Origin contract |
|---|---|---|
| `values.tone` | `UC.savePreferences({ tone })` | `DEFAULT_PREFERENCES.tone` (`user-content-store.js:166`) — legacy `wizardPrefTone` write path. |
| `values.stack` | `UC.saveDiscoveryProfile({ targetRoles: stack })` | `DEFAULT_DISCOVERY_PROFILE.targetRoles` (`user-content-store.js:182`). Same key the legacy chips wrote to (`app.js:16329`). |
| `values.locations[]` | `UC.saveDiscoveryProfile({ locations })` | Comma-joined to a string per `DEFAULT_DISCOVERY_PROFILE.locations`. |
| `values.name`, `goal`, `sources[]`, `comp` | `UC.saveAdditionalContext({ text })` | Aggregated into the legacy "Additional context" blob (the surface used for "Superpower / Avoid / pasted summary" in legacy step 3). |
| `values.sheetId` | _delegated_ — clicks `#setupCreateStarterSheetBtn` (create) or any of `#setupShowGate` / `#openSheetGateBtn` (connect existing); reads `window.JobBored.getSheetId()`. | We never re-implement OAuth; the legacy starter-sheet creator and gate own the canonical write. |
| _(completion flag)_ | `UC.completeOnboarding()` → IndexedDB setting `onboardingComplete = true` | Same call `app.js:16347` makes; we additionally click any `[data-action="completeOnboarding"]` element if present. |

**Empty-state contract.** Triggered when (and only when) the legacy condition fires — `pipelineData.length === 0 && !dataLoadFailed`. Welcome detects this by observing the legacy `#emptyState` element (display + `#emptyStateTitle` text matches `/your pipeline is empty/i`) via `MutationObserver` plus a 10-second polling fallback. Three quick actions delegate to existing controls: paste-URL focuses `#ingestUrlInput`; manual-add clicks `#ingestManualModalOpenBtn`; discovery clicks `[data-action="openDiscovery"]` / `#openDiscoveryBtn` / `#runDiscoveryBtn`.

**Mascot variant strategy.** No `jobbored.svg` edits (per `docs/redesign/mascot-review.md`'s 10-decision approval gate). Welcome ships the same SVG and varies it per step using only safe transforms — `rotate` (±2°–5°), `translateY`, `scaleX(-1)` (mirror) on Step 8 — and a single celebratory `drop-shadow(... var(--jb-amber-soft))` on Step 9. When a future tired/excited/curious face set lands, swapping `<img src>` per step is a 3-line patch.

**Self-test.** `?jb-v2-test=welcome` (combined with `?jb-v2=1`) runs three console assertions: refresh-mid-flow restoration on step 5, Esc-on-step-6 confirm dialog, and step-9 submit (asserts `[data-action="completeOnboarding"]` click if present, otherwise the documented no-op log path). Full step list, copy, transitions, and a11y checklist: [`WELCOME.md`](WELCOME.md).
