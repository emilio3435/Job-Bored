# dossier-df-brief lane — handoff

**Run ID:** `dossier-df-20260519T2030Z`
**Worktree:** `../Job-Bored-wt-dossier-df-brief`
**Branch:** `dossier-df/brief` (off `feat/flowing-page`)
**Model:** Claude Opus, max reasoning
**Visual source of truth:** `docs/redesign/dossier-direction-f-wireframe.html`

## Goal

Implement **The Brief** — the parchment editorial card that sits at the top of Part 03. It is the read-mostly half of the dossier: hook quote, AI summary lede, raw posting accordion, talking points, marginalia notes, plus the masthead with a display-only stage chip.

The dossier becomes two side-by-side cards. The Brief is card 1 of 2. Card 2 (The Workshop) is implemented by a different lane against the same shared CSS namespace.

## Owns (exclusive)

### JS
- New file: `role-brief.js`. Loaded from `index.html` immediately after `role.js`.
- Exports: `window.JobBoredDossierBrief = { renderBrief(region, vm) }` (or equivalent IIFE pattern matching `role.js` conventions).
- Helpers private to this file: `renderMasthead`, `renderHook`, `renderLede`, `renderSkim`, `renderTalkingPoints`, `renderRawPosting`, `renderMarginalia`.

### Shell coupling
- One single line added to `role.js` inside `renderDossier(region, vm)`: a call to `window.JobBoredDossierBrief.renderBrief(briefMount, vm)`. That line and the mount-point markup are yours. Do not touch any other line of `role.js`.

### index.html
- Add `<script src="./role-brief.js"></script>` immediately after the existing `role.js` script tag. No other change to `index.html`.

## Do NOT touch

- `role-workshop.js` (other lane)
- `role.css`, `style.css` (dossier-css lane)
- `app.js`, `flowing-writes.js`, any test file (other lanes)
- The empty-state shelf or the PART 03 divider already in `role.js`

## Reading order in the Brief (matches the wireframe exactly)

1. **Masthead** — eyebrow (`Senior · Remote · Full-time`), `<h1>` role title, italic company, facts row (location, salary, source), and a **display-only stage chip** on the masthead right rail.
   - Stage chip: shows current stage label with a mint dot and a caret. Click opens a stepper popover (popover markup is yours; the actual stepper UI is in the Workshop — the popover is a thin teaser that scrolls the user to the Workshop's stepper). Stage chip **does not itself advance the stage** — that's the Workshop's job. Decision locked: "Workshop only — masthead stage chip is display-only."

2. **Brief body grid** — two columns: `minmax(0, 1.55fr) minmax(0, 1fr)` with a 48px gap. Vertical hairline rule via `::before` between them. Right column is `position: sticky; top: 24px;` on ≥1081px viewports.

3. **Left column (main / posting lane):**
   - **Hook** — pull-quote, italic serif, big floating amber `"` glyph in left margin, crimson 56px underline tick.
   - **AI summary** — drop-cap first letter, mono provenance tag `Compressed by JobBored AI · from N words` with a soft mint pulse dot. `N` comes from the role VM's word-count if available, otherwise omit the "from N words" half — never fake the number.
   - **Raw posting accordion** — section label `§ Raw posting` with horizontal rule fill, then ledger-rail `<details>` per JD section. Each section gets: roman numeral (`i. ii. iii. iv. …`), section heading, count chip (`N bullets`), and a `+` toggle that rotates 45° into ✕ when open. Only the first section is `<details open>` by default. Left border switches color: default `border-strong` → hover amber → open crimson.

4. **Right column (side / workspace lane):**
   - **At a glance** — notched "AT A GLANCE" caption, vertical list of `STACK / COMP / SENIORITY / TEAM / LOCATION / ATS fit`. The ATS fit row uses `val--score` styling (giant crimson number with mono `/100`). Only render rows that have data; never placeholder text.
   - **Talking points** — notched "FOR THE CONVERSATION" caption, dingbat-bullet list. Bullets cycle `✦ ❧ §` every three items (the CSS handles this; you just emit `<ul><li>…</li></ul>`). Items come from `job.jdSections[0].bullets` (or wherever the role VM surfaces them).
   - **Marginalia** — notched "MARGINALIA" caption, Special Elite typewriter textarea, dashed bottom rule, focuses crimson. Wired to existing `jb:role:note` event (preserved contract).

## Data shape (consume from the role VM)

The role VM comes from `window.JobBoredDawn.data.getRoleViewModel(jobKey)`. The shape is in `dawn-data.js`. Fields you'll consume (read-only):
- `job.role`, `job.company`, `job.location`, `job.salary`, `job.employment`, `job.source`, `job.links[]`
- `job.companyTagline` (hook fallback chain: `companyTagline` → first JD body sentence → `jdSnippet`)
- `job.jdSections[]` — array of `{ heading, body, bullets[] }`. Section `[0]` feeds talking points; sections `[1..n]` feed the accordion. If only one section exists, talking points populate from `[0].bullets` and the accordion shows nothing.
- `job.tags[]`, `job.fitScore`, `job.salary`, `job.location`, `job.team` (if present) for the at-a-glance panel
- `job.notes.body` for the marginalia textarea
- `job.stage` for the masthead stage chip display

**Graceful fallback rule:** if a field is missing, render nothing for that block. Never insert placeholder text like "—" or "TBD" or "No data."

## Events emitted

- `jb:role:note { jobKey, body }` on marginalia blur — **already exists, preserve the contract**.
- That's it. No new events from this lane.

## Events listened for

- None. The Brief is purely render-on-VM-change.

## Selectors that must be preserved (sheet write-back depends on these)

- `[data-action="close-role"]` on the close button (if you re-render the masthead close button, keep the attribute).
- `[data-action="notes"]` on the marginalia textarea — that selector is what wires up `jb:role:note`.

## Preserve (do not break)

- Empty-state shelf and recents row in `role.js` — leave them alone.
- PART 03 divider markup at the top of `role.js` — leave it alone.
- `body.jb-v2` gating — your code runs only when that class is present, matching the existing `shouldRun()` guard in `role.js`.
- `prefers-reduced-motion` — any animation you add (accordion fade, hook reveal) must respect it. Pattern: `@media (prefers-reduced-motion: reduce) { animation: none; }`.

## Verification

```bash
node --check role-brief.js role.js
# Once the Brief mount point is wired, the dossier-card-attrs test must still pass
npm test -- tests/dossier-card-attrs.test.mjs
```

Visual check: serve the dev server (`npm run web-only`), open a role from the kanban, compare side-by-side with the wireframe at `docs/redesign/dossier-direction-f-wireframe.html`. Differences must be either (a) intentional fidelity to real data shapes, or (b) issues raised in the Completion Report below.

## Status file

Write to `docs/redesign/status/dossier-df-brief.json`:

```json
{
  "lane": "dossier-brief",
  "branch": "dossier-df/brief",
  "status": "completed" | "blocked" | "in-progress",
  "files_changed": ["role-brief.js", "role.js", "index.html"],
  "tests_run": ["tests/dossier-card-attrs.test.mjs"],
  "screenshots": [],
  "notes": "free-form, including any contract concerns",
  "ended_at": "ISO timestamp"
}
```

## Completion report (fill in at the end)

- **Commit SHA(s):**
- **Files changed:**
- **Tests run + results:**
- **Wireframe deviations + why:**
- **Open questions for integration:**
- **Known risks:**
