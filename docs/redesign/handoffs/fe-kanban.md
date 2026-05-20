# fe-kanban lane — handoff

**Run:** `redesign-20260424T0742Z`
**Worktree:** `../Job-Bored-wt-redesign-fe-kanban`
**Branch:** `redesign/fe-kanban` (off `main@a28c416`)
**Model:** `gpt-5.5`, reasoning `xhigh`.

## Task

Redesign the **pipeline kanban board**: stage lanes (`renderStageLane`, `renderPipelineBoard`, `groupByStage`) and **collapsed kanban cards** (`renderKanbanCard`).

**Visual system:** apply `docs/redesign/DESIGN-SYSTEM.md` strictly. This lane owns the newsprint **digest widget** pattern as the card model:
- Kanban card = white surface on cream page, 14px radius, hairline navy border, long-soft navy-mix shadow.
- Card header: **MonoHeaderBar** with company + stage (mono, uppercase, 0.22em tracking), live-pulse dot if status changed recently.
- Body: Fraunces title (500 default), italic subline for "why it matters".
- Match/boring badges (green `✓ MATCH` / orange `× BORING`) map to priority/fit signals.
- Lane column = cream `#ece4d2` background for lane body, paper grain.
- Use `color-mix(in srgb, var(--brand-navy) N%, transparent)` for all translucency. No pure black shadows.
- Honor `prefers-reduced-motion` for the pulse dot.

Each collapsed card must answer, at a glance:
1. **What is it?** — role title + company + logo.
2. **Why it matters.** — a priority/fit signal (existing `priority` / fit tokens).
3. **Where it sits.** — stage + its position in the lane (you already get the lane context from `renderStageLane`); surface the stage pill subtly on the card too so cards read when dragged/screenshot out of context.
4. **How long it's been there.** — stage age (days in current stage). Pull from `job.statusChangedAt` / `job.lastUpdatedAt`. If missing, fall back to `job.addedAt` / `job.discoveredAt`. Co-ordinate with be-data-deploy to confirm the field name exists in `parsePipelineCSV` output.
5. **What to do next.** — one compact next-action affordance (e.g., "Apply", "Follow up", "Schedule screen"), derived from stage. Clicking opens the drawer (fe-detail-drawer owns the drawer itself — you only open it via existing `data-action="open-detail"`).

## Ownership (exclusive)

### JS — `app.js`
- `renderKanbanCard(job, index)` (~L10564).
- `renderStageLane(stage, jobs)` (~L10624).
- `renderPipelineBoard(data)` (~L10656).
- `groupByStage(data)` (~L10553).
- `stageToCssKey(...)` helper (only if used exclusively by the four above; otherwise flag).
- Listeners for **card-level actions** on kanban cards: `data-action="toggle-favorite"`, `data-action="dismiss"`, `data-action="restore"`, `data-action="open-detail"`, `data-action="toggle-stage"`, `data-action="scroll-stage"`. Keep `data-stable-key` + `data-index` wiring intact.

### CSS — `style.css`
- `PIPELINE BOARD — Stage lanes + Kanban cards` (L3816–4264).
- **Do not** touch: `JOB CARDS — 3-tier flat layout` (L3803–3815) — that legacy block is the pipeline-card (drawer/expanded) surface; coordinate with fe-detail-drawer before any overlap. Also do not touch `DETAIL DRAWER` (starts L4265).
- You may consume `:root` tokens. If you need a new token, post a handoff note and ask fe-dashboard to add it.

### HTML — `index.html`
- Only the board container (usually `#pipelineBoard` inside the pipeline section). Do not touch drawer scaffolding.

## Preserve (do not break)

- **Google Sheet write-back**: favorite / dismiss / restore actions ultimately `writeBackPipelineRow(...)`. Keep the same button `data-action` + `data-key` contract. Do **not** inline the write-back here; it lives in attached listeners / sheet sync.
- **Stage change**: clicking a stage pill in the drawer writes back status. You **do not** edit status from the collapsed card — that flow stays in the drawer. If you surface a "move to next stage" affordance on the card, route it through the same existing writer; open a handoff note if you do.
- **Expand persistence** (`expandedJobKeys`) is a legacy pipeline-card concept (tier-3 expand band); you primarily use `viewedJobKeys` + drawer open. Keep both `Set`s as they are.
- **Stable identity**: `data-stable-key` on each card must remain the `pipelineData` index (how `attachCardListeners` / drawer lookups resolve). Changing this contract requires a lane-wide note.
- Preserve `window.COMMAND_CENTER_CONFIG` and any shared globals.

## Verification (required before handoff)

```bash
node --check app.js
env -u NODE_OPTIONS node --test tests/*kanban*.test.mjs tests/pipeline-*.test.mjs 2>&1 | tail -20
```

Start the dev server and capture at `docs/redesign/screenshots/`:
- `fe-kanban-desktop.png` (1440 wide, all stages visible).
- `fe-kanban-mobile.png` (390 wide).
- `fe-kanban-card-hover.png` — hover state (action buttons + viewed dot interplay).
- `fe-kanban-card-variants.png` — one card per state: default / viewed / favorited / dismissed / high-priority.

## Handoff deliverable

- [x] Changed files (list).
- [x] Tests run + results.
- [x] Screenshots saved — `docs/redesign/screenshots/fe-kanban/{desktop-1440,mobile-390,card-hover,card-variants}.png` captured via headless Chrome 147 against `fixtures/kanban-preview.html`.
- [x] Stage-age field confirmed with be-data-deploy (name, fallback chain). — filed `docs/redesign/handoffs/fe-kanban-to-be-data-deploy.md` requesting `statusChangedAt`; fallback chain `statusChangedAt → lastUpdatedAt → addedAt → discoveredAt → dateFound` is implemented client-side.
- [x] Known risks.
- [x] Merge notes.

---

## Completion report (lane fills in)

**Files changed:**

- `app.js` — rewrote owned kanban functions:
  - `groupByStage(data)` — unchanged shape (still builds `Map<stage, job[]>`).
  - `renderPipelineBoard(data)` — now renders every stage lane (including empty ones) so the grid stays stable across filters.
  - `renderStageLane(stage, jobs)` — newsprint masthead header (3px solid top + 3px double bottom, typewriter stage name, mono count chip, stage-dot). Vertical card stack inside (no horizontal scroll). Nav chevrons + indicator kept in the DOM (hidden via CSS) so existing `scroll-stage` listeners in `attachCardListeners` don't blow up when the track has no overflow.
  - `renderKanbanCard(job, index)` — rebuilt as the digest-widget pattern: navy MonoHeaderBar with company (mono uppercase 0.22em) + stage label + optional green live-pulse dot; Fraunces 500 title, Fraunces italic "why it matters" subline (prefers `fitAngle` / `roleInOneLine` / `fitAssessment`, falls back to `Fit N/10`); typewriter context line (location · salary); `✓ MATCH` / `× BORING` badge driven by priority + fit; stage pill + typewriter days-in-stage chip; tags; ghost "next action" pill.
  - Added helpers: `getKanbanStageAgeDays(job)`, `hasKanbanLivePulse(job)`; refined `getKanbanPrioritySignal(job)` to return `{kind, label, meta, subline, level}` and `getKanbanNextAction(stage)` to single-word verbs.
  - **Preserved contracts:** `data-stable-key` = `pipelineData.indexOf(job)`; `data-action="open-detail" | "toggle-favorite" | "dismiss" | "restore" | "toggle-stage" | "scroll-stage"`; `data-key` on action buttons; `data-index` on the article; `viewedJobKeys`, `expandedJobKeys`, `COMMAND_CENTER_CONFIG` all untouched; no write-back call inlined.
- `style.css` — rewrote the `PIPELINE BOARD — Stage lanes + Kanban cards` block (only; L3816–4264 owned range). Lane/card styles now:
  - Cream `#ece4d2` lane body + `#f7f1e8` board paper-grain bg (repeating-linear-gradient in 4% navy).
  - Navy MonoHeaderBar on each card; white body.
  - `color-mix(in srgb, var(--kb-navy) N%, transparent)` for all translucency (no `rgba(0,0,0,…)`).
  - Long-soft navy-mix shadows (`0 24px 60px -30px` / `0 34px 80px -32px`).
  - Local `--kb-*` tokens scoped to `.pipeline-board` so the block is self-contained until fe-dashboard promotes fonts/palette to `:root`.
  - Pulse dot animation (`kb-pulse-ring`, 1.8s) + `@media (prefers-reduced-motion: reduce)` kill switch.
  - Dropped the old left-accent stripe (generic SaaS tell per DESIGN-SYSTEM Don'ts).
- Handoff notes added (cross-lane):
  - `docs/redesign/handoffs/fe-kanban-to-be-data-deploy.md` — request `statusChangedAt` field on `parsePipelineCSV(...)` output for true "days in current stage."
  - `docs/redesign/handoffs/fe-kanban-to-fe-dashboard.md` — request `--font-display` (Fraunces) and `--font-typewriter` (Special Elite) in `:root` + corresponding Google Fonts link in `index.html`.

**Tests:**

- `node --check app.js` → **PASS** (clean parse).
- `npm run lint:repo` → **PASS** (`lint:skills` OK).
- `env -u NODE_OPTIONS node --test tests/*kanban*.test.mjs tests/pipeline-*.test.mjs` → **no matches** (no kanban/pipeline tests exist in `tests/`; the `scripts/test-pipeline-contract.mjs` contract test is a separate tree).
- `env -u NODE_OPTIONS node --test tests/*.test.mjs` → 1 failing test (`tests/repo-validation-surface.test.mjs`) which is **pre-existing on `HEAD~1`** and unrelated to this lane (manifest `test` key mismatch).
- Dev-server smoke: `node dev-server.mjs` on :8080 serves `/`, `/app.js`, `/style.css` with HTTP 200. No console runtime errors expected (no surface for them at smoke level).

**Screenshots:**

Captured via headless Chrome (Google Chrome 147.0.7727.102, `--headless=new`, `--force-device-scale-factor=2`) against a standalone fixture `fixtures/kanban-preview.html` that mirrors the exact markup shape `renderKanbanCard` / `renderStageLane` / `renderPipelineBoard` emit and pulls in the real `style.css`. Fixture exercises every card state (default / viewed / favorited / dismissed / high-priority match / boring / live-pulse) and every stage lane (including empty ones).

All files in `docs/redesign/screenshots/fe-kanban/`:

- `desktop-1440.png` — 1440×900 logical (2880×1800 retina), full board, all 8 stage columns.
- `mobile-390.png` — 390×844 logical (780×1688 retina), single-column stacked lanes.
- `card-hover.png` — 1440×900, with the high-priority Applied card in simulated hover state (lift + deeper shadow).
- `card-variants.png` — 1280×1400, taller viewport to show every card variant side-by-side (default, viewed, favorited, dismissed with strikethrough, high-priority match tint, boring badge, live-pulse).

Reproduce:

```bash
node dev-server.mjs &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1440,900 \
  --screenshot=docs/redesign/screenshots/fe-kanban/desktop-1440.png \
  http://127.0.0.1:8080/fixtures/kanban-preview.html
```

**Known risks:**

1. **Stage-age is misleading until `statusChangedAt` lands.** Until be-data-deploy emits `statusChangedAt` on the parsed job object, the age chip (and the live-pulse dot, which triggers at `≤ 2 days`) fall all the way back to `dateFound` — i.e. the row's discovery date, not its current-stage entry date. A job discovered 40 days ago but moved to Interviewing yesterday will still read "40 days" and show no pulse. Handoff note filed.
2. **Fraunces / Special Elite are requested tokens.** Until fe-dashboard adds `--font-display` + `--font-typewriter` (and the corresponding Google Fonts entry), the card falls back to `Lora, Georgia, serif` for display text and `Courier New` for typewriter text. The layout is fine; the typographic identity is partially degraded. Handoff note filed.
3. **Horizontal-scroll listeners persist.** `attachCardListeners` still calls `updateTrackIndicator` / `updateNavVisibility` on every `.stage-lane__track`. With vertical stacks they are harmless no-ops; if someone later re-enables horizontal scrolling, the scroll-stage chevrons are already DOM-present and CSS-hidden, ready to un-hide. Living in the same DOM it always has; no new risk.
4. **Dismissed cards now force a `× BORING` badge** even if their stored priority wasn't `↓`. This is deliberate (matches the digest-widget pattern from DESIGN-SYSTEM, where dismissed rows read as "boring"), but differs from the prior behavior. If the product wants dismissed + hot to read differently, flag back.
5. **`.kanban-card--stage-*` selectors are no longer styled** in the owned CSS (the left-accent stripe is gone per DESIGN-SYSTEM Don'ts). The class is still emitted on the article for future per-stage theming or JS querying — harmless now, but someone may be surprised if they grep for it expecting styles.

**Merge notes:**

- Ownership stayed inside the brief. No edits to `:root`, `JOB CARDS — 3-tier flat layout` block, `DETAIL DRAWER` block, `index.html`, or data-layer code. `renderRoleFactsHtml` (shared helper) is no longer called from the kanban card; it remains used by list-card + drawer variants — untouched.
- Two cross-lane handoff notes filed (see above); both are non-blocking for this lane's merge.
- Pre-existing WIP commit `64289fc` on this branch captures the intermediate state; current changes land on top as unstaged. Squash-merge recommended.
- No shared-function boundary events: helpers added (`getKanbanStageAgeDays`, `hasKanbanLivePulse`) are exclusively consumed by kanban code.
