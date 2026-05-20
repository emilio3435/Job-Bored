# fe-dashboard lane — handoff

**Run:** `redesign-20260424T0742Z`
**Worktree:** `../Job-Bored-wt-redesign-fe-dashboard`
**Branch:** `redesign/fe-dashboard` (off `main@a28c416`)
**Model:** `gpt-5.5`, reasoning `xhigh`.

## Task

Redesign the top-of-page dashboard surface: **TOP BAR**, **COMMAND STRIP (Daily Brief overview)**, **MAIN LAYOUT**, and the **PIPELINE SECTION header** (filters, search, sort, stage pills, KPI strip). The board itself (stage lanes + kanban cards) is **fe-kanban**'s territory — do not touch `renderKanbanCard` / `renderStageLane` / `renderPipelineBoard` internals. The drawer is **fe-detail-drawer**'s.

Make the dashboard answer, in ≤5 seconds:
1. **Board health** — how many roles in pipeline, how many new since last run, how many need follow-up, how stale the data is.
2. **Today's plan** — the Daily Brief compressed into actionable prompts (1–3 items max).
3. **Filter clarity** — stage pills, free-text search, priority + sort controls read as one row, not a toolbar jumble.
4. **Source freshness + run status** — when the last discovery run completed, whether one is in progress, and a one-click trigger when signed in. (Pull state from `runs-tab.js` events; see be-data-deploy for contract guarantees.)

## Ownership (exclusive)

### JS — `app.js`
- `renderPipeline()` (~L11350) — orchestrator. You may re-arrange the header HTML it emits; you may **not** change how it invokes `renderPipelineBoard` (that's fe-kanban) or `openJobDetail` (that's fe-detail-drawer).
- `renderPipelineDailyBrief()` (~L12575) — full ownership.
- All helpers referenced **only** by the two functions above (identify via static search before editing; if shared, post a handoff note).
- Listeners attached to header controls (stage pills, search, sort, priority, "Run discovery" button). If a listener is wired elsewhere (`attachCardListeners`, `initRunsTab`), do **not** move it.

### CSS — `style.css`
- `TOP BAR` (L1158–1274)
- `COMMAND STRIP (Daily Brief overview)` (L1490–3450)
- `MAIN LAYOUT` (L3451–3459)
- `PIPELINE SECTION` (L3460–3802) — header/filters/KPIs only; **do not** touch `JOB CARDS — 3-tier flat layout` (starts L3803) or the board block after it.
- You may add new `:root` tokens if the redesign demands them. Document them inline.

### HTML — `index.html`
- Static scaffolding for the top bar + command strip is fair game if it exists there.
- Do **not** touch drawer scaffolding (`#jobDetailDrawer*`) or kanban scaffolding.

## Preserve (do not break)

- Google Sheet read path (`getConfig`, `loadPipeline`, `parsePipelineCSV`) — consumer only.
- Filter state (`currentStage`, `currentPriority`, `currentSort`, search box) — keep the same JS variable names unless you migrate every call site within this lane.
- `jobbored:discovery-run-started` / `jobbored:discovery-run-finished` CustomEvents — the ghost-row flow lives in `runs-tab.js`. If you add a header indicator, **subscribe**; do not re-dispatch.
- KPIs and Daily Brief must keep reading from the same `pipelineData` shape.

## Verification (required before handoff)

```bash
node --check app.js
env -u NODE_OPTIONS node --test tests/pipeline-*.test.mjs 2>&1 | tail -20
npx prettier --check app.js style.css index.html 2>&1 | tail -20  # if configured; skip if not
```

Start the dev server (`npm run dev`) and capture at `docs/redesign/screenshots/`:
- `fe-dashboard-desktop.png` (1440 wide).
- `fe-dashboard-mobile.png` (390 wide).
- `fe-dashboard-signed-out.png` — login gate header.
- `fe-dashboard-empty-pipeline.png` — `pipelineData.length === 0` state.

## Handoff deliverable

Fill in, at bottom of this file, before marking lane complete:
- [ ] Changed files (list).
- [ ] Tests run + results.
- [ ] Screenshots saved.
- [ ] Known risks.
- [ ] Merge notes for integration lane (especially any shared-token additions and any shared-function boundary events).

---

## Completion report (lane fills in)

**Files changed:**

- `style.css` — added newsprint `:root` tokens (`--jb-paper`, `--jb-cream`,
  `--jb-ink`, `--jb-ink-soft`, `--jb-ink-hair`, `--jb-green`, `--jb-orange`,
  `--jb-rule`, `--font-display`, `--font-typewriter`). Restyled TOP BAR
  (L1158–), COMMAND STRIP (L1490–) with paper-grain bg + editorial
  eyebrow/section-title primitives, MAIN LAYOUT (paper grain), PIPELINE
  SECTION header/filters/KPIs (hairline pill filter bar, run-status pill,
  mono+Fraunces typography). No changes below L3803 (JOB CARDS — out of
  scope).
- `index.html` — added editorial masthead strip above the top bar
  (`.masthead-strip`, `#mastheadIssue`), rebuilt the Daily Brief hero with
  `§ 01` eyebrow + editorial section title, rebuilt the Pipeline section
  header with `§ 02` eyebrow + editorial title + run-status pill
  (`#pipelineRunStatus`). Added Fraunces + Special Elite to the Google
  Fonts import. No drawer or kanban scaffolding touched.
- `app.js` — added new helpers referenced **only by** `renderPipeline()`:
  `updateMastheadIssue()`, `pipelineStatusRelative()`,
  `updatePipelineRunStatus(forceState)`, `ensurePipelineRunStatusWired()`,
  plus module-local state (`pipelineRunStatusWired`,
  `pipelineRunStatusDoneTimer`). `renderPipeline()` now calls them at the
  top of the function. No other `app.js` changes.

**Tests:**

```
node --check app.js            → ok
npm run typecheck:repo         → ok
node --test tests/*.test.mjs   → 225 pass / 1 fail (pre-existing)
node --test tests/runs-tab.test.mjs → 22/22 pass (event contract green)
```

The single failing test (`tests/repo-validation-surface.test.mjs`) checks
`package.json`'s `test:repo` script; it fails identically on `HEAD`
without my changes (stashed-then-re-run confirmed). Not introduced by
this lane.

Prettier: no `.prettierrc*` config present in repo → skipped per brief.

**Screenshots:**

Saved to `docs/redesign/screenshots/` (inside the worktree):
- `fe-dashboard-desktop.png` (1440×2200)
- `fe-dashboard-mobile.png` (390×2400)
- `fe-dashboard-signed-out.png`
- `fe-dashboard-empty-pipeline.png`

Captured via headless Chrome against `npm run dev`. The app's default
cold-load shows the setup/login gate (no config, no auth), so the
desktop / signed-out / empty-pipeline captures coincide. Driving the
dashboard into its "signed-in with empty pipelineData" state requires
valid Google OAuth + a connected empty sheet — that setup lives outside
this lane's ownership. The signed-out gate IS the true "login gate
header" shot, which is the explicit deliverable.

**Known risks:**

1. **Screenshot coverage of dashboard states.** Only the login/setup gate
   was reachable from a cold start without Google OAuth + Sheet config.
   The dashboard-authenticated states (full pipeline + empty pipeline +
   run-in-progress pill) should be spot-checked manually by the
   integration lane when merging; the CSS/markup is in place.
2. **`renderPipelineDailyBrief()` is a stub.** The brief's L12575
   reference is to a one-liner that currently just returns
   `pipelineData.length > 0`. The actual brief rendering happens in
   `renderBrief()` (L12579+), which is **not** in this lane's named
   ownership. I therefore styled the brief surface via CSS only
   (`.command-strip`, `.brief-hero`, `.stat-card__label/value`,
   `.brief-headline`, `.btn-discovery`) without editing `renderBrief()`
   internals or the widget helpers it calls
   (`renderDonutWidget`/`renderAreaWidget`/`renderSourceWidget`/
   `renderBriefFeed`/`renderBriefStats`/`briefHeadlineSentence`/
   `buildBriefSuggestions`). If the integration lane wants deeper
   editorial compression of the brief (1–3 actionable prompts), that
   touches `renderBrief()` + several helpers and should be negotiated
   with whichever lane owns that function now.
3. **Top-bar icon cluster unchanged.** I kept the existing `.top-bar-right`
   button group (sheet / wizard / materials / runs / settings) intact to
   avoid cross-lane breakage with `initRunsTab`, materials modal, and
   discovery-setup wiring. Only the top-bar background + masthead rule
   were restyled.
4. **Ingest URL hero styling** (L3538+ in CSS) was not retouched — it
   still uses the old blue/violet gradient. It sits inside the Pipeline
   section so it's technically in range, but changing it risks drift
   from fe-kanban's card treatment; left as-is and flagged for the
   integration lane.
5. **Font loading.** Added `Fraunces` and `Special Elite` to the Google
   Fonts `<link>`. First paint may briefly show fallback fonts
   (`DM Sans` / `Courier New`); the existing `display=swap` keeps this
   graceful.

**Merge notes (for integration lane):**

- **New shared-token additions** (in `style.css` `:root`):
  `--jb-paper`, `--jb-cream`, `--jb-ink`, `--jb-ink-soft`,
  `--jb-ink-hair`, `--jb-green`, `--jb-orange`, `--jb-rule`,
  `--font-display`, `--font-typewriter`. All are additive and
  documented inline; no existing tokens were renamed or removed.
- **New CSS primitives** (reusable across lanes if they adopt the
  newsprint zone): `.editorial-eyebrow` (+ `__num` / `__rule` /
  `__kicker`), `.section-title--editorial` (+ `__lead` / `__italic`),
  `.masthead-strip` (+ `__item` / `__sep`), `.section-header--editorial`
  (+ `__intro` / `__meta`), `.run-status-pill` (+ `__dot` / `__label`,
  states `idle`/`running`/`done`).
- **New DOM IDs** (added in `index.html`): `#mastheadIssue`,
  `#pipelineRunStatus`. No existing IDs renamed. All existing element
  IDs the JS reads (`#briefDate`, `#briefHeadline`, `#briefStats`,
  `#briefPipeline`, `#briefInsights`, `#briefFollowupPanel`,
  `#briefAction`, `#briefSources`, `#heading-pipeline`, `#roleCount`,
  `#searchInput`, `#sortSelect`, `#favoritesOnlyChip`,
  `#showDismissedChip`, `#discoveryBtn`) preserved.
- **Event subscriptions (additive, no re-dispatch):**
  `app.js::ensurePipelineRunStatusWired()` adds two
  `document.addEventListener` listeners for
  `jobbored:discovery-run-started` / `jobbored:discovery-run-finished`.
  They only mutate the `#pipelineRunStatus` pill DOM. The existing
  `runs-tab.js` listeners for the same events are untouched;
  `settings-profile-tab.js` remains the sole dispatcher.
- **Filter state contract preserved:** `currentStage`, `currentPriority`,
  `currentSort`, `currentSearch`, `favoritesOnly`, `showDismissed` —
  none renamed; listener wiring in `initDashboard()` untouched.
- **Sheet I/O untouched:** `getConfig` / `loadPipeline` /
  `parsePipelineCSV` / write-back selectors (`.status-select`,
  `.notes-textarea`, `[data-action="followup"]`, etc.) all intact.
- **Discovery webhook untouched.**
- **Mid-run snapshot commit** `38f0b94` was present on the branch at
  start of my session (authored by the prior forge surface before it
  crashed); it contained the CSS + index.html edits I needed to
  continue. I treated it as my own WIP and layered the app.js changes
  on top. The integration lane should squash both commits when merging.

- [x] Changed files (list).
- [x] Tests run + results.
- [x] Screenshots saved.
- [x] Known risks.
- [x] Merge notes for integration lane.
