# Legacy UI retirement plan

Status: plan only. **No deletion in this program (HOLES).** Each step below is
its own later change, reviewed and verified on its own.

The v2 flowing page (`body.jb-v2`) is the default UI. The pre-v2 dashboard still
ships in the same page: its markup renders, CSS hides it, and parts of it are
still load-bearing for v2. This page lists what is left, what leans on it, and
the order to take it out. Line numbers are as of 2026-10-02.

## Inventory

| Piece | Where | What it is today |
|---|---|---|
| Legacy `#dashboard` markup | `index.html` ~644–1305 | `header.top-bar` (logo, `#sheetLink`, `#materialsBtn`, `#runsBtn`, `#expiredReviewBtn`, `#settingsBtn`, `#authSection`), `section.command-strip.daily-brief-panel` (`#briefHeadline`, `#briefStats`, `#discoveryBtn`), `main.main-content` (`#pipelineSection` toolbar: `#searchInput`, `#sortSelect`, `#favoritesOnlyChip`, `#showDismissedChip`; `#roleCount`, `#jobCards`, `#emptyState`, the error view), `footer.site-footer`. |
| `app-compat.js` | 1,660 lines | ~420 top-level forwarders into `window.JobBoredApp.*`. `app.js` hands these globals to `bridge-registry.js` `registerAllBridges(...)`, so it is the host plumbing for both UIs. Only six forwarders serve the legacy board alone: `renderKanbanCard`, `applyLegacyKanbanCap`, `renderLegacyKanbanHiddenAffordance`, `renderStageLane`, `renderPipelineBoard`, `attachBoardListeners`. |
| Legacy kanban | `pipeline-render.js` | `renderPipelineBoard` / `renderKanbanCard` / `attachBoardListeners` draw `.pipeline-board` into `#jobCards` only while `body.jb-v2` is off (`isV2View`). `watchV2Flag` redraws it when the flag is switched off at runtime. |
| Daily brief DOM | `daily-brief.js` `renderBrief` | Writes `#briefHeadline`, `#briefStats` (the `.stat-card`s) and the rest of `.daily-brief-panel`. |
| `jb-v2-legacy-hide.css` | whole file | Under `body.jb-v2`: hides `header.top-bar`, `.command-strip.daily-brief-panel`, `main.main-content` and `#resumeGenerateModal`; keeps `.page-top` and the region hosts hidden until `body.jb-authed`. |
| `leads.css` gate | `leads.css` ~17 | Reveals `[data-region="leads"]` with the old inline-style gate, `:has(#dashboard:not([style*="display: none"]))`. |

## What still depends on it

- **The signed-in signal.** `#dashboard`'s inline `display` is how the page says
  "signed in". Writers: `app-bootstrap.js` `init()`, `sheet-access-setup.js`
  (`showSheetAccessGate`, `revealDashboardShell`), and the `index.html` prepaint
  script that strips the style for a cached session. `app-bootstrap.js` mirrors
  it onto `body.jb-authed` (HOLES B10). Readers: `jb-v2-legacy-hide.css` (the
  class), `leads.css` (the style string), `flowing-chrome.css` view routing
  (`:has(#dashboard)`, an id there for specificity), and the e2e journeys
  (`#dashboard` visible / hidden).
- **Live controls in legacy markup.** `flowing-chrome.js` `adoptActions` moves
  `#discoveryBtn`, `#sheetLink`, `#materialsBtn`, `#runsBtn`,
  `#expiredReviewBtn`, `#settingsBtn` and `#authSection` into `.page-top`. They
  are authored inside `header.top-bar` and the brief panel.
- **Boot wiring.** `app-bootstrap.js` `init()` binds `#sortSelect` and
  `#searchInput` without a guard (removing either throws in `init()`), plus
  `#favoritesOnlyChip`, `#showDismissedChip` and `#refreshBtn`.
  `initPipelineEmptyAndBriefActions` binds `#emptyStateActions` and
  `.daily-brief-panel`.
- **v2 repaint triggers.** The v2 regions repaint on `jb:pipeline:rendered`,
  which `pipeline-render.js` `renderPipeline` emits; under v2 that function still
  writes `#roleCount`, `#emptyState` and `#jobCards`. `dawn.js` `observeLegacy`
  watches `#briefStats` / `#briefHeadline` for mutations, and `dawn-data.js`
  `readHero` falls back to scraping `#briefStats` when
  `JobBoredApp.brief.getBriefStats` is missing.
- **Opt-out users.** `body.jb-v2` is on by default, but `?jb-v2=0` or the
  Settings toggle (`settings-jb-v2-tab.js`, `JB_V2.disable()`) persists it off,
  and those users get the legacy UI.
- **Pins.** `tests/ds08-renderer-cutover.test.mjs`,
  `tests/pipeline-filter-controls.test.mjs`, `tests/ux01-c4-system.test.mjs`,
  `tests/ux01-cleanup-ca.test.mjs`, and `tools/smoke-jb-v2.mjs` (check 12 still
  pins the old style gate; the script is not in CI).

## Retirement steps

Run them in order. Each step ships alone and must pass its gate before the next starts.

1. **Move every reader off the inline style.** Gate `leads.css` on
   `body.jb-v2.jb-authed` with the same declarations. Update
   `tools/smoke-jb-v2.mjs` check 12 and the stale comments in `index.html`
   (~640) and `flowing-chrome.css` (~652).
   *Gate:* `grep -rn 'style\*="display: none"' --include='*.css' .` finds
   nothing; `leads-journey` and `holes-board-auth-class` are green.
2. **Give the signed-in signal its own home.** Have the writers set
   `body.jb-authed` directly instead of `#dashboard.style.display`. Replace
   `flowing-chrome.css`'s `:has(#dashboard)` with an id-free selector that still
   out-ranks the reveal rules. Point the e2e journeys at the class.
   *Gate:* `shell-today`, `critical-journey` and `ux01-f-states-settings` are
   green, and a signed-out load shows no v2 region.
3. **Re-home the live controls.** Author the seven adopted controls in
   `.page-top` (or have `flowing-chrome.js` build them), keeping their ids and
   listeners.
   *Gate:* `shell-today` (Add job, the More panel's `#sheetLink`) is green, and
   Settings and the account menu are reachable at 375px and 1440px.
4. **Cut the v2 data path off legacy DOM.** Drop Dawn's `#briefStats` /
   `#briefHeadline` observers and `readHeroFromDom`. Give `renderPipeline` a v2
   branch that needs no `#roleCount` / `#emptyState` / `#jobCards` and still
   emits `jb:pipeline:rendered`. Guard or move the toolbar bindings in
   `app-bootstrap.js` `init()`.
   *Gate:* the dawn / today / pipeline unit suites pass, with
   `ds08-renderer-cutover` updated in the same change, and the e2e journey
   suite is green.
5. **Retire the opt-out.** Announce it, then remove `?jb-v2=0` and the Settings
   toggle; `JB_V2.disable()` becomes a no-op.
   *Gate:* a release note ships, and no code path removes `jb-v2` from
   `body.classList`.
6. **Delete the legacy UI, in a later program.** Delete:
   - the legacy `#dashboard` markup: `header.top-bar`,
     `.command-strip.daily-brief-panel`, `main.main-content`;
   - the legacy kanban in `pipeline-render.js` and its six `app-compat.js`
     forwarders;
   - the DOM writes in `renderBrief`;
   - the hide rules, then `jb-v2-legacy-hide.css` itself.

   `app-compat.js` stays until `app.js` stops passing its globals to
   `registerAllBridges`.
   *Gate:* the full `npm test`, `npm run lint:repo`, `npm run lint:tokens`, the
   e2e-smoke / e2e-journey / e2e-visual Playwright configs, and a manual
   signed-in and signed-out pass at 375px and 1440px.

## Not in this program

HOLES retires nothing. It deletes no file, element, or rule listed above. Its
only change here is B10: the class-based auth gate in `jb-v2-legacy-hide.css`,
fed by `app-bootstrap.js`.
