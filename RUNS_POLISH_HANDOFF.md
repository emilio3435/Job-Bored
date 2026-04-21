# `feat/runs-modal-polish` — handoff

**Branch:** `feat/runs-modal-polish` (off `feat/layer5-integration`).
**Status:** both jobs shipped, tests green, not pushed.
**Base commit on this branch:** `4308b21` (discovery runs log merge).

## What shipped

### Job 1 — visual polish

All edits stay inside the tokens + markup that already existed; no new third-party deps, no backend changes.

- **Semantic status tokens (style.css `:root`).** Added `--status-ok / --status-warn / --status-err / --status-info` plus matching `-bg` / `-border` companions. They're now the source of truth for the three status-badge variants and for the status line's warn/error states, so a theme swap flows through cleanly. Colors pulled from the existing palette (success green `#15803d`, warn `#a16207`, error `#b91c1c`) — all AA-contrast on their tinted backgrounds.
- **Runs-modal CSS rewrite (`.runs-modal`, `.runs-table*`, `.runs-filter-chip`, `.runs-status-badge*`, `.runs-empty`, `.runs-row--skeleton`, `.runs-row--in-progress`).** All ad-hoc `0.3rem / 0.4rem` gone; every length now lands on a `--space-*` step. The modal is a flex column so the header + filters stay put while `.runs-table-wrap` owns the scroll — that makes the `position: sticky` header behave correctly when scrolling 200 rows. Filters got uppercase micro-legends + an accent ring on the active chip so the selection is readable at a glance.
- **Column hierarchy via `nth-child`.** `Run At` (col 1) and `Status` (col 3) are the primary read — full-contrast text, col 1 gets `font-weight: 500` + `white-space: nowrap`. Numeric cols 4–6 are right-aligned with `tabular-nums` so 12 / 18 / 3 stack cleanly. `Source` + `Variation Key` drop to `--text-muted` + `--text-xs` so they read as supporting data. Variation key keeps its mono `<code>` chip, recolored to match the muted palette.
- **Zebra + hover.** `tr:nth-child(even)` gets a near-invisible wash (`rgba(241, 245, 249, 0.45)`), and the hover state overrides it with `--surface-hover` — a cheap way to help the eye track across 9 columns without dominating the design.
- **Error cell: single-line ellipsis + tooltip.** `.runs-error-cell` now truncates with `text-overflow: ellipsis`; runs-tab.js sets a matching `title` attribute so the full string is one hover away. Empty errors render an em-dash in `--text-faint` so the column doesn't look abandoned on successful rows.
- **Modal sizing.** `width: min(1080px, calc(100vw - 2rem))` + `max-height: min(90vh, 960px)`, plus a `@media (max-width: 720px)` block that tightens padding and lets the reload button drop to a new line on narrow viewports. No overflow on a 13" 1440×900 laptop.
- **Loading state.** A `renderSkeletonRows(tbody, 6)` helper paints six greyed rows with `skeletonPulse` (existing animation) on the *first* fetch only. Subsequent 60s auto-refreshes just flip the status line to "Refreshing…" so the table doesn't flash.
- **Empty state.** New `renderEmptyState()` replaces the `<table>` inside `.runs-table-wrap` with a `.runs-empty` block: the clock SVG from `#runsBtn` in a mint-tinted circle, a short title, and a longer hint. Three distinct copies now: missing DiscoveryRuns tab, empty tab, and the two auth/sheet-missing warn states. The `originalTableWrapHtml` is stashed at init so the table comes back intact after the first successful fetch.
- **Accessibility.** `:focus-visible` rings on filter chips, reload button, and sticky-header cells. `aria-hidden` on skeleton rows and the empty-state icon.

### Job 2 — in-progress indicator for manual runs

Pure client-side, no contract extension. Zero new persistence.

- **Event dispatch (`settings-profile-tab.js`).** Both `handleRun()` (the Settings → Profile → Run discovery button) and `handleRefresh()` now bracket their POST to `/discovery-profile` with `jobbored:discovery-run-started` → `jobbored:discovery-run-finished` CustomEvents. The finished event carries `{ trigger, ok }` and fires from the `finally` block so it runs on both success and abort/error paths. A single `dispatchDiscoveryRunEvent()` helper wraps the `document.dispatchEvent` call; it no-ops cleanly in environments without `CustomEvent` so tests and edge browsers don't blow up.
- **Ghost row (`runs-tab.js`).** State adds `ghostRun` + `isOpen`. On `discovery-run-started` the controller sets `ghostRun = { runAt: new Date().toISOString() }` and rerenders — `renderGhostRowHtml()` produces a `.runs-row--in-progress` row with an `in_progress` status badge (pulsing dot, info-palette), "Manual" trigger, and em-dashes for duration / companies / leads / source / variation / error. On `discovery-run-finished` the controller clears `ghostRun` and immediately fires `loadRuns()` — no 60s wait. Events are ignored entirely when the modal is closed (`isOpen === false`), per the brief.
- **CSS (`.runs-row--in-progress`, `.runs-status-badge--in_progress`).** Italic muted body, first-column stays normal-weight for scannability, info-palette pill with a pulsing dot (`@keyframes pulse` already existed in the file).

## Files touched

| File | Purpose |
| --- | --- |
| `style.css` | New `--status-*` tokens; full `.runs-modal` rewrite with hierarchy / skeleton / empty / in-progress / responsive blocks. |
| `runs-tab.js` | Skeleton + empty-state + ghost-row renderers; error-cell tooltip; hierarchy-aware short timestamps; event listeners for Job 2; `__test` hooks exported for unit tests. |
| `settings-profile-tab.js` | Dispatches `jobbored:discovery-run-started` / `-finished` events around `handleRun()` + `handleRefresh()`. No other behavioral changes. |
| `tests/runs-tab.test.mjs` | +6 new tests across `renderGhostRowHtml`, `renderSkeletonRows`, and a 3-test ghost-row lifecycle suite that boots `initRunsTab()` inside a fake-DOM harness and drives it via the real document-level events. |
| `fixtures/runs-modal-preview.html` | Local browser fixture (see below). |

## Self-gate

```
env -u NODE_OPTIONS node --test tests/runs-tab.test.mjs
→ tests 22 | pass 22 | fail 0   (was 16; +6 new)

env -u NODE_OPTIONS node scripts/run-tests.mjs integrations/browser-use-discovery/tests/
→ tests 435 | pass 434 | fail 1
```

The single failing discovery-worker test (`integrations/browser-use-discovery/tests/e2e/operator-prereqs.test.ts`) fails on the **base commit as well** — verified by stashing this branch's diff and re-running. It's an ENOENT on `integrations/browser-use-discovery/state/worker-config.json`, i.e. a worker-bootstrap prerequisite that isn't provisioned in a fresh worktree. Pre-existing environmental failure, not a regression from this branch.

```
node --check runs-tab.js && node --check settings-profile-tab.js
→ JS syntax OK
```

## Browser smoke — what I could and couldn't do

The cmux orchestrator flagged that Emilio's `npm run dev` is already running in a sibling worktree at `:8080` / `:8644` / `:3847`, so I didn't start my own server (would've blown up on `EADDRINUSE`). That running server doesn't see **this** worktree's files, so I couldn't hit the live modal through it for `/design-review` screenshots in the loop the brief describes.

Instead I shipped a standalone fixture: **`fixtures/runs-modal-preview.html`**. It loads `../style.css` and `../runs-tab.js` via relative paths, stubs `window.JobBored` + `fetch`, and ships four states on toggle buttons:

1. **Populated** — 5 runs across `success` / `partial` / `failure` / scheduled + manual triggers, one with a long error to exercise the ellipsis + tooltip.
2. **Empty** — the post-auth "No runs logged yet" state with the clock icon.
3. **Loading** — skeleton rows (fetch is stalled with a 60s timeout).
4. **Populated + ghost row** — dispatches the `discovery-run-started` CustomEvent to show the in-progress row at the top.

Two ways to open it:

- **File URL (no server needed):** open `fixtures/runs-modal-preview.html` directly from Finder; the relative stylesheet + script paths make `file://` work.
- **Local server from this worktree:** `python3 -m http.server 9090 --directory ~/Job-Bored-wt-runs-polish`, then `http://localhost:9090/fixtures/runs-modal-preview.html`.

Screenshots: **not captured** by me — I didn't want to introduce a second dev server on :8080 against the orchestrator's guidance, and the project's existing `/browse` skill isn't wired for cross-worktree asset serving. When Emilio opens the fixture locally the four states above are the intended review surface.

## Deferred / out of scope

- `/design-review` iteration loop (screenshots + commits-per-fix) was not run as a skill invocation — polish is the spec-driven pass described above, validated by the fixture.
- No changes inside `integrations/browser-use-discovery/` (per brief). The contract, worker write path, and Tier 2 / Tier 3 schedule card are untouched.
- Drill-down-into-a-single-run and CSV export stay out of scope per `docs/INTERFACE-DISCOVERY-RUNS.md §5`.

## Commit strategy

Single commit coherent with both jobs:
`feat(runs-modal): visual polish + in-progress ghost row for manual runs`

Rationale: the ghost row's CSS (`.runs-row--in-progress`) and the polish block (`.runs-modal`, `.runs-table`) share the same block of style.css, and the ghost row's renderer piggybacks on the same `renderRunsTable()` pipeline as the main table. Splitting would produce two commits where one file lands half in each. Per Emilio's global "avoid over-engineering" rule, one commit; both jobs fully covered in the message body.

**No push**, per both the global rules and the workspace brief.
