# dossier-df-tests-screens lane — handoff

**Run ID:** `dossier-df-20260519T2030Z`
**Worktree:** `../Job-Bored-wt-dossier-df-qa` (created AFTER integration merge of phase 1)
**Branch:** `dossier-df/qa` (off the integration branch tip)
**Model:** Claude Opus, max reasoning
**Visual source of truth:** `docs/redesign/dossier-direction-f-wireframe.html`

## Goal

Validate the merged Direction F dossier with three new tests and a screenshot set. This lane runs **after** the five phase-1 lanes have merged onto `dossier-df/integration`.

## Owns (exclusive)

### Tests (new or updated)
- `tests/dossier-card-attrs.test.mjs` — update assertions for the new structure. Required selectors:
  - `[data-action="close-role"]`, `[data-action="notes"]`, `[data-action="resume-tailor"]`, `[data-action="resume-cover"]`
  - `.brief__masthead`, `.brief__col--main`, `.brief__col--side`
  - `.workshop__bar`, `.stepper`, `.ats-card`, `.writeback`
- `tests/dossier-brief-structure.test.mjs` (new) — render the Brief against a fixture VM; assert:
  - masthead emits role + company + facts
  - hook renders only when `companyTagline` or first JD body exists
  - drop-cap lede renders the AI summary
  - skim panel renders only the fields present (no placeholders)
  - raw posting accordion renders one `<details>` per JD section beyond `[0]`
  - first accordion section has `[open]` attribute
  - talking points list comes from `jdSections[0].bullets`
  - marginalia textarea is wired to `jb:role:note` on blur
- `tests/dossier-workshop-events.test.mjs` (new) — render the Workshop against a fixture VM; assert each event:
  - clicking a stepper step emits `jb:role:writeback { field: "stage" }`
  - each chip emits the right `jb:role:writeback` field/value pair
  - "See full scorecard" emits `jb:ats:modal:open`
  - on mount, `jb:ats:state:request` is emitted
  - "Tailor resume" and "Cover letter" emit `jb:role:action` and trigger letter-region scroll
- `tests/ats-state-bus.test.mjs` and `tests/role-writeback-bridge.test.mjs` already exist (from phase 1 lanes) — re-run, do not modify.

### Screenshots
Capture in `docs/redesign/screenshots/` (new files, do not overwrite):
- `dossier-df-1440.png` — desktop, role open, JD section i. expanded
- `dossier-df-1024.png` — tablet
- `dossier-df-720.png` — narrow tablet (Brief collapses to single column)
- `dossier-df-390.png` — mobile (Workshop collapses to single column too)
- `dossier-df-workshop-ats-loading.png` — ATS card mid-fetch
- `dossier-df-workshop-ats-success.png` — ATS card with score visible
- `dossier-df-workshop-ats-error.png` — ATS card error state with retry
- `dossier-df-ats-modal.png` — full scorecard modal open
- `dossier-df-writeback-chip-fired.png` — toast or row-update visible after a chip click

Use `uploads/screens/_capture-server.mjs` if helpful for headless capture, otherwise manual `cmd-shift-4` is fine.

## Owns (exclusive — but read-only on source code)

You do not edit `role.js`, `role-brief.js`, `role-workshop.js`, `role.css`, `app.js`, or `flowing-writes.js`. If tests reveal a defect, **stop and file a status entry**; do not fix the source yourself.

## Do NOT

- Touch product source files. You're QA-only.
- Re-implement event contracts. Read them from `AGENT_CONTRACT.md` and assert against them.

## Verification

```bash
npm test -- tests/dossier-card-attrs.test.mjs \
            tests/dossier-brief-structure.test.mjs \
            tests/dossier-workshop-events.test.mjs \
            tests/ats-state-bus.test.mjs \
            tests/role-writeback-bridge.test.mjs
npm run lint:repo
```

## Status file

Write to `docs/redesign/status/dossier-df-tests-screens.json` matching the schema in `docs/redesign/status/README.md`. Include the screenshot file paths in `screenshots[]`.

## Completion report (fill in at the end)

- **Commit SHA(s):**
- **New test files:**
- **Test results summary:**
- **Screenshots captured:** (list paths)
- **Defects found (do not fix here):** (each one gets a separate status JSON note for the orchestrator)
- **Wireframe diff observations:**
- **Known risks:**
