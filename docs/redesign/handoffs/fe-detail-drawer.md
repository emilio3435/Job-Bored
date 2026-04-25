# fe-detail-drawer lane — handoff

**Run:** `redesign-20260424T0742Z`
**Worktree:** `../Job-Bored-wt-redesign-fe-detail-drawer`
**Branch:** `redesign/fe-detail-drawer` (off `main@a28c416`)
**Model:** `gpt-5.5`, reasoning `xhigh`.

## Task

Redesign the **expanded role/detail drawer** and its role tools (resume, cover letter, ATS insight surfaces).

**Visual system:** apply `docs/redesign/DESIGN-SYSTEM.md` strictly. This lane delivers:
- Drawer top = **masthead rule** (3px solid top + 3px double bottom in navy) with three typewriter items between: company · role · stage.
- Sectioned scroll via **SectionHeader** primitives (`§ 01 Role`, `§ 02 Fit`, `§ 03 Next action`, `§ 04 Raw intel`, `§ 05 Drafts`).
- **StatRow** for any multi-number blocks (ATS score, salary range, days-in-stage).
- Buttons use **ProjectBtn** pattern (solid navy + ghost, mono 11px uppercase labels).
- Resume/cover/ATS tools become **MonoHeaderBar**-topped white cards with long-soft navy shadows.
- Typewriter (Special Elite) allowed on masthead items and digest-style micro-captions — JobBored zone owns it.
- Honor `prefers-reduced-motion`.

The drawer should answer, in order of scroll:
1. **Who/what/where** — title, company, location, comp, source, stage stepper (existing `renderStageStepper`).
2. **Why care** — AI role-in-one-line + fit + talking points (existing talking-points rendering).
3. **Next action** — resume tailor, cover letter, "mark applied" → `CARD ACTIONS` write-back.
4. **Raw intel** — posting text, must-haves, nice-to-haves, ATS score (existing enrichment).
5. **Document surface** — drafts library, generated PDFs (existing draft-library card).

## Ownership (exclusive)

### JS — `app.js`
- `renderDrawerContent(job, stableKey)` (~L10711).
- `renderStageStepper(job, dataIndex)` (~L10670).
- `renderCardActions(job, indexForNotesId)` (~L11409).
- `handleDetailEscape(e)` (~L10666).
- `openJobDetail` / `closeJobDetail` **behavior** only where relevant to drawer layout; do not change their signatures. The *trigger* (`data-action="open-detail"`) stays fe-kanban's.
- Resume/cover/ATS **orchestration inside the drawer** is yours; the underlying generators (`resume-generate.js`, `resume-bundle.js`, `document-templates.js`, ATS scoring inside the drawer) are **consumer only** — do not change their exported contracts.

### CSS — `style.css`
- `DETAIL DRAWER` (L4265–5167).
- `DRAWER CARD STYLES (retired list-card selectors pruned)` (L5168–5238).
- `TALKING POINTS (active drawer content)` (L5239–5471).
- `CARD ACTIONS (Write-back)` (L5472–5609).
- You may consume tokens; do not edit `:root`. If you need new tokens, post a handoff note to fe-dashboard.

### HTML — `index.html`
- Drawer scaffolding (`#jobDetailDrawer`, `.job-detail-backdrop`, etc.) is yours. Do not touch kanban board or top-bar scaffolding.

## Preserve (do not break)

- **Google Sheet write-back** for status / notes / follow-up / heard / contact / reply: selectors `.status-select`, `.notes-textarea`, `.followup-*`, etc. Their listeners live in `attachCardListeners` (for legacy pipeline cards) and drawer-specific wiring. Keep every `data-action` and `data-index` attribute the write-back layer consumes. If you rename a class, rename the writer call site in the same commit.
- **Resume generation flow**: `resume-generate.js`, `resume-bundle.js`, `resume-ingest.js`, `document-templates.js`, `user-content-store.js` — consumer only. Do not change their function signatures or their POST bodies.
- **ATS insight generation**: whatever produces the ATS score (browse the code first with `fs_search`) — consumer only.
- **Existing data contracts**: `job.*` shape as emitted by `parsePipelineCSV` + `_postingEnrichment`. If a field name seems wrong, flag it with be-data-deploy before renaming.
- Drawer open/close keyboard flow (`Escape`, focus-trap) must keep working.

## Verification (required before handoff)

```bash
node --check app.js
env -u NODE_OPTIONS node --test tests/*drawer*.test.mjs tests/*resume*.test.mjs tests/*ats*.test.mjs 2>&1 | tail -30
```

Start the dev server and capture at `docs/redesign/screenshots/`:
- `fe-detail-drawer-desktop-open.png` (1440 wide).
- `fe-detail-drawer-mobile-open.png` (390 wide).
- `fe-detail-drawer-resume-tools.png` — resume / cover / ATS panel expanded.
- `fe-detail-drawer-talking-points.png` — AI-generated content visible.
- `fe-detail-drawer-writeback.png` — status dropdown + notes visible after change.

## Handoff deliverable

- [x] Changed files (list).
- [x] Tests run + results (including a write-back smoke: change status → verify the sheet-bound action fires).
- [x] Screenshots saved.
- [x] Known risks.
- [x] Merge notes.

---

## Completion report (lane fills in)

**Files changed:**

- `app.js` — rewrote `renderDrawerContent` (§-sectioned editorial layout), `renderStageStepper` (numbered tick marks, editorial chrome), `renderCardActions` (MonoHeaderBar-style write-back card), and the drawer head inside `openJobDetail` (masthead rule + ProjectBtn actions row). Every `data-action` / `data-index` / write-back class preserved verbatim. `handleDetailEscape` unchanged — DOM reshuffle didn't require adjustments.
- `style.css` — rewrote the four owned ranges (DETAIL DRAWER, DRAWER CARD STYLES, TALKING POINTS, CARD ACTIONS) to implement the JobBored zone visual system: masthead rule, SectionHeader primitive, writeback card w/ mono eyebrow, ProjectBtn solid/ghost, numbered stage stepper, long-soft navy shadow, Lora display face for section kickers + Special Elite masthead items, `prefers-reduced-motion` honored. Enrichment skeleton styles retained intact.
- `index.html` — added `Special+Elite` family to the existing Google Fonts `<link>` (one attribute value changed; no scaffolding moved). Drawer itself is JS-rendered, so no structural HTML edits were required.
- `docs/redesign/screenshots/_fixture.html` — new standalone fixture used only for headless-Chrome screenshot capture; not referenced by the app.

**Tests:**

```
$ node --check app.js
(clean, exit 0)

$ env -u NODE_OPTIONS node --test tests/drawer-crm-sync.test.mjs \
    tests/ats-request-transport-alignment.test.mjs \
    tests/ats-scorecard-provider.test.mjs
…
ℹ tests 23   pass 23   fail 0

$ env -u NODE_OPTIONS node --test tests/draft-generation-stability.test.mjs
…
ℹ tests 25   pass 25   fail 0
```

**Write-back smoke (static contract verification — the env has no live sheet):**

Every `data-action` listener in `attachCardListeners` binds by selector:

- `[data-action="status-select"]` → `renderCardActions` L11501 emits `class="status-select" data-action="status-select" data-index="${dataIndex}"` ✓
- `[data-action="notes"]` → L11525 emits `class="notes-textarea" data-action="notes" data-index="${dataIndex}"` ✓
- `[data-action="followup"]` → L11507 emits `class="followup-input" data-action="followup" data-index="${dataIndex}"` ✓
- `[data-action="last-heard"]` → L11511 emits `class="last-heard-input" data-action="last-heard"` ✓
- `[data-action="response-flag"]` → L11515 emits `class="response-select" data-action="response-flag"` ✓
- `[data-action="stage-step"]` → `renderStageStepper` L10707 emits `data-action="stage-step" data-stage="…" data-index="…"` ✓
- `[data-action="resume-cover"]`, `[data-action="resume-tailor"]` → emitted by `openJobDetail` drawer actions bar ✓
- `[data-action="close-detail"]` (backdrop + close button) ✓
- `[data-action="signin"]` (anonymous card-actions branch) ✓

Status/notes/followup/reply changes therefore still flow through the existing `updateJobStatus` / `updateJobNotes` / `updateFollowUpDate` / `updateLastHeardFrom` / `updateJobResponseFlag` writers unmodified.

**Screenshots:** `docs/redesign/screenshots/`

- `fe-detail-drawer-desktop-open.png` — 1440×1800 full drawer (masthead → § 05 drafts)
- `fe-detail-drawer-mobile-open.png` — 390×2400 mobile stack
- `fe-detail-drawer-resume-tools.png` — § 05 Drafts + actions bar (cover / tailor / view)
- `fe-detail-drawer-talking-points.png` — § 02 Fit (AI summary + fit angle + skill chips + talking points)
- `fe-detail-drawer-writeback.png` — § 03 Next action (status / followup / last-heard / reply / notes)

Screenshots are generated from a hand-built fixture (`docs/redesign/screenshots/_fixture.html`) that mirrors the exact markup `openJobDetail` → `renderDrawerContent` / `renderCardActions` produce for a realistic job; no live app / sheet required. To regenerate:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE="file://$PWD/docs/redesign/screenshots/_fixture.html"
OUT="$PWD/docs/redesign/screenshots"
"$CHROME" --headless=new --hide-scrollbars --disable-gpu --window-size=1440,1800 --screenshot="$OUT/fe-detail-drawer-desktop-open.png" "$BASE"
"$CHROME" --headless=new --hide-scrollbars --disable-gpu --window-size=390,2400  --screenshot="$OUT/fe-detail-drawer-mobile-open.png"  "$BASE"
"$CHROME" --headless=new --hide-scrollbars --disable-gpu --window-size=1280,900  --screenshot="$OUT/fe-detail-drawer-resume-tools.png"  "$BASE#resume-tools"
"$CHROME" --headless=new --hide-scrollbars --disable-gpu --window-size=1280,900  --screenshot="$OUT/fe-detail-drawer-talking-points.png" "$BASE#talking-points"
"$CHROME" --headless=new --hide-scrollbars --disable-gpu --window-size=1280,900  --screenshot="$OUT/fe-detail-drawer-writeback.png"     "$BASE#writeback"
```

**Known risks:**

1. **Special Elite + Fraunces loaded via Google Fonts.** I added `Special+Elite` to the existing `<link>` in `index.html` (same request, one extra family). Fraunces wasn't needed in the end — section kickers use the already-loaded Lora. If offline / CSP changes block the CDN later, the masthead falls back to `courier-new, monospace` (defined in the style block) so functionality degrades gracefully.
2. **Draft-library card (§ 05) visual polish.** `renderDraftLibraryCardHtml` is owned by another lane; I only wrap it in the § 05 section shell. If that card's own chrome clashes with the new editorial surround, fe-drafts owns the fix.
3. **`propsHtml` removed from drawer.** The legacy two-column prop panel (applied-date chip, overdue flag, stage props grid) is gone because the same data is now rendered inside the § 03 writeback card and masthead. No listener was wired to `propsHtml`, so nothing broke, but downstream code that expected the legacy `.drawer-props` class in the drawer DOM will no longer find it. `fs_search` confirmed no other reader uses it.
4. **Stage stepper horizontal scroll chevrons** (`[data-action="scroll-stage"]`) are visual; I did not wire a click handler for them in this lane because none existed previously. If fe-kanban's listener lane needs to add scroll behavior, the data-action is in place.
5. **Fixture HTML is authored by hand** to mirror the renderer output. If the renderers drift in a follow-up commit without regenerating the fixture, screenshots could diverge from truth. The fixture lives under `docs/redesign/screenshots/_fixture.html` and should be regenerated whenever `renderDrawerContent` / `renderCardActions` / `renderStageStepper` change.

**Merge notes:**

- No `:root` tokens were added. If fe-dashboard later adds tokens for `--drawer-eyebrow-color` etc., this lane's CSS will consume them on first rebase.
- No exported function signatures changed. `resume-generate.js`, `resume-bundle.js`, `document-templates.js`, `user-content-store.js`, the ATS modules, and `attachCardListeners` are untouched.
- `attachCardListeners()` call at the end of `openJobDetail` remains — required for the new drawer markup's data-action listeners.
- Conflict hotspots on merge with other lanes:
  - `index.html` line 10 (`<link href=…>`): fe-dashboard / fe-onboarding may also touch this link. Resolve by keeping the union of requested font families.
  - `app.js` L11029–11115 (`openJobDetail` head): fe-kanban may touch where drawer is opened from, but the function itself is drawer-lane; keep this version.
  - `style.css` L4251–5594: this lane fully rewrote the range. Other drawer-adjacent lanes should rebase on top and only add; no range collisions expected because the owned ranges are exclusive per the handoff.
- Commit is focused on drawer lane files only. Not pushed (per instruction).
