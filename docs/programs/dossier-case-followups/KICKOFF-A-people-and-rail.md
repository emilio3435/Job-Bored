# Kickoff · A people-and-rail (Opus) — one native People block; posting facts on the rail; rail input sizing

Read `docs/programs/dossier-case-followups/GROUND-RULES.md` first, then the Case spec `docs/superpowers/specs/2026-09-01-dossier-case-redesign-design.md` §5–§7.

## What's wrong today (see `docs/programs/dossier-case/reports/V1-case-desktop.png`)

The YOUR MOVES lane shows the same four CRM facts twice: the Case's own People rows (contact / last contact / replied / follow-up, inline-editable, writing through `jb:role:writeback`) and, directly under them, the recruiter strip's boxed card (`recruiter-strip.js` `render`: Caveat script label, orange dot, white card with shadow, Yes/No/Unknown pill buttons, a date field with a "Save follow-up" button, its own `sheetsWrite` bridge). Two surfaces, two write paths, one of them styled for a different product.

## The design (this is the brief — build exactly this)

**Subject.** The People block is the human side of an application: who you talked to, when, whether they answered, when you owe them a nudge — and the one move that follows. Its single job: tell you the next move and let you log what happened in one gesture.

**Signature.** The block opens with a *sentence*, not a form: an eyebrow `NEXT MOVE` (mono, crimson, `.case__sub` scale) and the move itself in Lora italic 15/1.5 navy — `Follow up on Sep 4` · `Find a recruiter contact` · `Schedule the next conversation` · `Set a follow-up date`. This text comes from `recruiter-strip.js` `nextAction(data)` (export it; the model calls it — one source of truth shared with the kanban compact strip). Everything under the sentence is quiet ledger rows.

**Rows** (existing `.case__kv` idiom, unchanged metrics):
- `Contact` — inline `edit-field` input, placeholder `Add a contact`.
- `Last contact` — inline `edit-field` input (`heardBack`), placeholder `Aug 30`.
- `Replied` — a three-state segmented control, NOT the strip's bordered pill buttons: three mono uppercase chips `YES · NO · UNKNOWN` at 8.5px/.16em in one row; the active chip is filled navy with parchment text, inactive chips are hairline `var(--border-strong)` with `var(--mute)` text; 28px tall, 44px minimum hit area via padding. `data-action="edit-field" data-field="reply" data-value="Yes|No|Unknown"`. (role.js already routes the reply button click; extend it to read `data-value` verbatim so `Unknown` writes too — check `flowing-writes.writeReply` accepts the three values; if it only writes "Yes", extend it minimally to pass the value through and add the bridge test case.)
- `Follow-up` — the existing `type="date"` input. No Save button: commit on `change` (already wired). After `jb:write:succeeded` for `followupAt`/`reply`/`heardBack`/`contact`, show a transient `saved` mark (mono 8px mint, fades over 1.6s, `prefers-reduced-motion` → no fade) at the row's right edge — the vocabulary stays consistent: the control says what it does, the result says it happened.

**Copy.** Sentence case everywhere. `Next move`, not "Next action". Never "Submit"/"Save follow-up". Empty state for contact is the placeholder, not a hint paragraph.

**What goes away.** The `[data-mount="recruiter-strip"]` in the Case, the `JobBoredRecruiterStrip.render(...)` call in `role.js`, and the dossier-panel rules in `recruiter-strip.css` (`.jb-recruiter-strip` full-card rules; keep every `--compact` rule — `pipeline.js` still calls `renderCompact`). In `recruiter-strip.js`: export `nextAction`; delete only `render` and the helpers only it used; leave `renderCompact` byte-identical.

**Restraint check before you build.** One signature (the sentence). No new colors — `--navy`, `--parchment`, `--crimson`, `--mint-deep`, `--mute`, `--border-strong` only. No new fonts. No icons. If you find yourself adding a card border or a shadow around People, stop — it is rows in a lane, like the rest of the lane.

## Rail additions (client half of the A↔B contract)

Model: `identity.postedAt`, `identity.closesAt`, `identity.postingSalary` from `job.postedAt` / `job.closesAt` / `job.postingSalary` (fixture-driven in your tests; lane B supplies the real values). Rail meta gains, in this order after `Found …`: `Posted 2026-08-27` and `Closes 2026-09-30` when present. When `closesAt` is within 14 days of `nowMs` (or past), the rail-right pills gain `Closes in N days` / `Closes today` / `Closed N days ago` with the amber dot (`case__pill--due` styling, `data-pill="closes"`); this is the fact a job seeker acts on, so it earns a pill — never both a pill and a meta line for the same date. Salary: when the sheet's `salary` is empty and `postingSalary` is present, the rail's salary input shows `postingSalary` as its `placeholder` (not its value — it is not the user's data) and the meta gets a `scrape` source tag after it.

`.case__fact-input`: resolve the sizing tension L7 flagged — keep `width: 12ch` as the fallback and add `@supports (field-sizing: content) { width: auto; min-width: 6ch; }` so supporting browsers hug the value.

## Tests (test-first, each its own commit)

1. `tests/role-case-model.test.mjs` — `moves.people.nextMove` for the four `nextAction` branches; `identity.postedAt/closesAt/postingSalary` pass-through; `nextAction.closesInDays` (or wherever you put it — name it in the report) for 3 days / today / past.
2. `tests/role-case-render.test.mjs` — People block: eyebrow + sentence; segmented replied control with the active chip; NO `data-mount="recruiter-strip"`; rail: `Posted`/`Closes` meta, closes pill within 14 days and none at 40 days, salary placeholder when sheet salary is empty.
3. `tests/role-case-interactions.test.mjs` — reply chips dispatch `jb:role:writeback` with `Yes`/`No`/`Unknown`; the saved mark appears after `jb:write:succeeded`; no `JobBoredRecruiterStrip.render` call (retarget the existing stub assertion).
4. `tests/recruiter-strip-dossier.test.mjs` — retarget: `nextAction` is exported and returns the four sentences; `renderCompact` output unchanged (snapshot the current output first, assert equality after).

Commits: `feat(dossier): one People block — next move sentence, segmented reply, saved marks`, `chore(dossier): retire the recruiter strip's dossier panel`, `feat(dossier): posting dates, closing-soon pill, posted salary on the rail`, `fix(dossier): rail fact inputs hug their value where field-sizing is supported`.

## Definition of Done
1. The four suites above + `tests/role-field-edit-render-guard.test.mjs` + `tests/role-writeback-bridge.test.mjs` green.
2. Full floor incl. BOTH Playwright suites green (ground rules §Floor), pasted in `LANE-REPORT-A.md` §4.
3. `node tools/lint-tokens.mjs --quiet` → 0 findings; `grep -n "recruiter-strip" role-case.js role.js` → no hits.
