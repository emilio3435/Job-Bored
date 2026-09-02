# LANE REPORT — L5 cutover (claim F)

Branch `feat/case-l5`, cut from `feat/dossier-case` at `628a69a`. Three commits, nothing pushed.

| | |
|---|---|
| `9615270` | feat(dossier): cut over to The Case; wire stepper, people, re-render triggers |
| `c839781` | feat(materials): compact document rows inside The Case |
| `96fb2aa` | chore(dossier): retire the Brief renderer and its styles |

---

## 1. What this lane was

Case plan Tasks 8–10 — the cutover. Make `role.js` render The Case instead of the Brief, wire every interaction in spec §5 through the existing event contracts, move the materials panel into the Case as compact rows, and delete `role-brief.js` and its styles without a trace.

---

## 2. Which claims went red first

**Task 8** — `tests/role-case-interactions.test.mjs` (new, 12 cases) run against the pre-cutover `role.js`: **11 of 12 failed**, captured in `.lane-evidence/task8-red.txt`.

```
▶ The Case interactions
  ✖ renders the case into the region for an open role
  ✖ stage step click dispatches jb:pipeline:move with the rendered from-stage
  ✖ clicking the step the role is already on dispatches nothing
  ✖ follow-up date commits on change, exactly once
  ✖ the replied toggle dispatches the opposite value, not the current one
  ✖ a replied role's toggle offers No
  ✖ contact and last-contact commit on blur through the writeback contract
  ✖ the keywords tile opens the existing profile-match modal with the raw job
  ✖ re-renders on jb:ats:state, jb:profile-match:ready and jb:materials:manifest
  ✔ ignores a jb:materials:manifest for a different role
  ✖ defers the new triggers while an edit surface is focused, then flushes on blur
  ✖ the replied toggle never commits through the input path
ℹ pass 1 · fail 11
```

**Task 9** — the seven new `materials rows in the case mount` cases in `tests/role-materials.test.mjs` all failed before `renderCaseRows` existed (the Case mount rendered the legacy panel, so no `.case__doc` row was ever produced). Separately `node tools/lint-tokens.mjs` reported **13 raw-hex findings in `role-case.css`** on the base branch — the orchestrator's addendum, folded into this task.

**Task 10** — the new `the Brief is retired` block in `tests/role-case-render.test.mjs` went red on both cases (`role.css carries no .brief__* presentation rules`, `role-brief.js is gone and nothing loads or falls back to it`) before the deletion.

---

## 3. What shipped, file and fence

### In fence

| File | Change |
|---|---|
| `role.js` | Renders The Case (`collectDeps` → `buildCaseModel` → `render`). Click walker handles `stage-step` (from-stage read off the rendered `.case__step--now`; a self-move is a no-op), the `reply` toggle, and `open-profile-match`. `commitEditField` ignores non-input surfaces and re-seeds `data-original` so a date input's `change` + `blur` pair cannot write twice; `type="date"` commits on `change`. `jb:ats:state` / `jb:profile-match:ready` / `jb:materials:manifest` re-render through the guarded `renderForKey`. New `reviewedVm()` — see "regressions caught" below. |
| `flowing-writes.js` | `writeContact` → column L, `case "contact"` in the writeback switch, `CONTACT_COLUMN` in `_columns` + the self-test. `writeReply` becomes a real two-state toggle: an explicit `"No"` writes `No`, every other payload still writes `Yes` (the frozen date-shaped case is untouched). |
| `role-materials.js` | `renderManifest` branches on its host: `[data-mount="materials"]` gets one `.case__doc` row per `CASE_DOC_TYPES` — read from `JobBoredCase.model`, never copied — with a status pill (ready / drafting / failed / missing), a `phase · elapsed · attempt` line for a draft in flight, `Draft` buttons for a missing resume or cover letter, and the existing preview / download / repair actions for a ready one. `renderEmpty` / `renderError` collapse to a single `.case__hint`. The preview/download/repair builders moved out of `renderCard` into a shared `docActionButtons()` so the allowlist, the inline-vs-download split and the cache-busting version live in one place. The legacy `[data-mount="brief"]` panel is unchanged. |
| `role-case.css` | `.case__doc*` row rules **plus the token-drift fix**: every `var(--x, #hex)` fallback removed, and `--surface` / `--border` / `--case-crimson-soft` / `--case-amber-deep` pinned on the root `.case` rule so the Case never inherits `:root`'s legacy blue-grey `--surface: #ffffff` / `--border: #e2e8f0`. `node tools/lint-tokens.mjs` → **0 findings**; `npm run smoke:jb-v2` → 13/13. |
| `role.css` | Every `.brief` / `.brief__*` / `.skim*` / `.points*` / `.brief-notes*` / `brief-skeleton` / `brief-shimmer` / `brief-enriching-pulse` block deleted, plus the now-dead `@media` wrappers. **2199 → 1170 lines.** `.brief-materials*` kept (the brief-only fallback still renders it), as are `.jb-role-divider*`, `.jb-shelf*`, `.dossier`, `.stepper*`, `.writeback*`, `.chip*`. File header updated to say what actually lives there. |
| `role-brief.js` | **Deleted.** |
| `index.html` | `role-brief.js` script tag removed (that line only). |
| `package.json` | `node --check role-brief.js` dropped from `typecheck:repo`. |
| Tests | New `tests/role-case-interactions.test.mjs`. `role-field-edit-render-guard` retargeted at `.case__title` / `.case__company` / `contact`. `role-writeback-bridge` gains appended `reply: "No"` and `contact` cases. `role-materials` gains seven compact-row cases. `role-materials-manifest-events` retargeted to `data-doc="resume"`. `role-case-render` gains the retirement guard. `dossier-brief-structure.test.mjs` deleted. |
| Docs | `CHANGELOG.md` Unreleased line; the five droid-wiki dossier entries now name `role-case*`; `DOSSIER_RENDERER_INSPECTION_REPORT.md` stamped superseded; one line corrected in `HERMES_MATERIALS_HANDOFF.md`. |

`DESIGN.md` and `AGENTS.md` were listed in the fence but contain **no Brief or dossier-renderer reference** (`grep -n "Brief\|dossier" DESIGN.md AGENTS.md` → one unrelated hit about the *Daily Brief* KPI strip). Nothing to update; left untouched rather than manufacturing a reference.

### Test files touched beyond the fence's named list

Deleting `role-brief.js` broke six suites that loaded it as the renderer under test. The fence names "updates to `role-field-edit-render-guard`, `role-writeback-bridge`, `role-materials*`" but not these; they had to be handled or the floor could not be green. **None were weakened** — each was split into what still has a live subject and what described a retired surface:

| File | What happened |
|---|---|
| `tests/dossier-card-attrs.test.mjs` (frozen) | Retargeted block for block onto The Case: `case__rail` / `case__stepper` / `case__board` / `case__notes` / `case__chron`, the editable `title`/`company` inputs, `brief-view-posting`, the materials mount. Every "must NOT contain" Workshop assertion is intact, and each is now paired with a positive assertion so trap 2 (empty render) cannot pass. The `resume-cover` / `resume-tailor` CTA-cluster assertions moved to `tests/role-materials.test.mjs`, where those actions now live as Draft buttons. |
| `tests/dossier-provenance-labels.test.mjs` | Kept all three `classify()` cases (the module is live — `posting-enrichment.js` consumes it). Retired the three that asserted the Brief's rendered provenance chip / "Fetched …" line / escaped fallback reason. |
| `tests/dossier-field-provenance.test.mjs` | Kept the cache-TTL and `stampProvenance` cases. Retired the three-case `title/company inference is not posting-grounded` describe and `renders cache freshness next to the AI summary`, all of which asserted the Brief's lede tag. |
| `tests/dossier-loose-parse-provenance.test.mjs` | Kept the three parse-mode cases. Retired `visibly demotes loose/repaired lists to recovered — review` (the `.brief__struct` chip). |
| `tests/dossier-structured-output.test.mjs` | **Strengthened.** The three Brief cases became three Case cases driven through the real render path, including a **negative control** that asserts the pollution *does* render when the validator is absent — so the guard is what is being tested, not the fixture. Only the `.brief__review` banner assertion retired. |
| `tests/enrichment-self-heal.test.mjs` | The nine-case `brief loading skeleton — visual contract` describe (badge, rotating status line, whole-page shimmer) became a five-case contract for the Case's in-lane skeleton, and the lead case is now a **render** test rather than a source grep: it asserts the skeleton appears in the They-want lane while the rail, stepper, numbers and notes stay mounted (spec §6 / resilience D3). |
| `tests/pipeline-edit-affordance.test.mjs` | The cross-module contract now pins `pipeline.js`'s `focusDossierField` selector against `role-case.js` and `role-case.css` instead of `role-brief.js` / `role.css`. |

### Two regressions the cutover would have shipped, caught and fixed here

1. **Delimiter pollution stopped failing closed.** `role-brief.js` ran every enrichment through `structured-output-validator.js` before rendering (`role-brief.js:180-186`). The Case model is pure assembly and does not. Verified empirically: with the Brief deleted, a `parsedPolluted` fixture rendered ` ```json `, `<must_haves>` and `<|im_start|>user` as requirement bullets. Fixed **in `role.js`** (the region owner, in fence) with `reviewedVm()`, which validates on a copy and never mutates the view-model `dawn-data` hands over. Pinned by the three retargeted cases in `tests/dossier-structured-output.test.mjs`.
2. **`writeReply` ignored its value.** The Case renders a Yes/No toggle, but `writeReply(jobKey)` hardcoded `"Yes"` — toggling to "No" would have written "Yes". Fixed without touching the frozen bridge case (which passes a date and still expects `Yes`).

---

## 4. Floor results

Real output. Full transcript in `.lane-evidence/floor.txt`.

```
$ npm test
ℹ tests 2681
ℹ suites 654
ℹ pass 2680
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 7931.666958
```

The single `todo` is `tests/submission-record-audit.test.mjs` — `persists and can remove the canonical submission evidence record # blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store`. **Pre-existing**: `git show 628a69a:tests/submission-record-audit.test.mjs` carries the same `todo:` marker at line 18. `fail` is 0.

```
$ npm run lint:js

> command-center@0.1.0 lint:js
> eslint .

(no output — clean)
```

```
$ npm run test:contract:all

> command-center@0.1.0 test:pipeline-contract
> node scripts/test-pipeline-contract.mjs
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js

> command-center@0.1.0 test:pipeline-update-contract
> node scripts/test-pipeline-update-contract.mjs
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
```

```
$ npm run smoke:jb-v2

✔ smoke 1/13: index.html exposes four data-region hosts
✔ smoke 2/13: window.JB_V2 plumbing present in index.html
✔ smoke 3/13: token & base CSS load before region CSS
✔ smoke 4/13: each region CSS is scoped under body.jb-v2
✔ smoke 5/13: each region JS file exists and is loaded
✔ smoke 6/13: Settings → Setup tab contains the v2 toggle
✔ smoke 7/13: settings-jb-v2-tab.js loads after settings-tabs.js
✔ smoke 8/13: schema maps settingsJbV2Toggle → Setup tab
✔ smoke 9/13: jb-v2-switch CSS is token-only
✔ smoke 10/13: app.js retains legacy canonical hooks
✔ smoke 11/13: settings-jb-v2-tab.js parses cleanly
✔ smoke 12/13: legacy panels hidden, regions auth-gated, chrome preserved
✔ smoke 13/13: tools/lint-tokens.mjs passes (0 findings)
ℹ pass 13
ℹ fail 0
```

Green — including smoke 13, which was red on the base branch (13 raw-hex findings in `role-case.css`).

**Definition of Done suite set** (`node --test` over the nine named files): `ℹ tests 116 · suites 17 · pass 116 · fail 0 · skipped 0 · todo 0`.

---

## 5. Anything unverified, and what the cutover drops

### Capabilities the Case does not carry over — flagged, not fixed (L4's fence)

These are real, user-facing, and none of them are mentioned in spec §11 (out of scope). I did not touch `role-case.js` / `role-case-model.js` to fix them.

1. **Location and salary are no longer editable.** Spec §5 says `Rail title / company / location / salary | edit-field (data-field title|company|location|salary)`. `role-case.js` `renderRail` only builds `editInput` for `title` and `company`; location and salary render as plain `.case__meta` spans. Today's Brief lets you edit all four in place. This is an L4 gap against its own spec, not a cutover choice.
2. **The recruiter strip is gone from the dossier.** `<div data-mount="recruiter-strip">` and the `JobBoredRecruiterStrip.render(...)` call lived only in `role-brief.js:804-815`. `recruiter-strip.js` / `recruiter-strip.css` are still loaded by `index.html` and `tests/recruiter-strip-dossier.test.mjs` still passes (it tests the module, not the mount), but nothing in the role region mounts it any more. Adding the mount to `role-case.js` is a one-line change in L4's file.
3. **The loading skeleton lost its screen-reader announcement.** The Brief's skeleton carried `aria-live="polite"` and `role="status"` alongside `aria-busy`; `role-case.js` `skeletonRows()` emits `aria-busy="true"` only. The new contract test pins `aria-busy`; the announcement needs an attribute added in `role-case.js`.
4. **Provenance labelling is no longer rendered anywhere.** `dossier-field-provenance.js` and `structured-output-validator.js` stay live (`posting-enrichment.js` consumes them, and `role.js` now consumes the validator), but the per-field provenance chip, the "inferred from title and company" lede tag, and the cache-freshness line have no surface in The Case. That follows from spec §3 cutting the AI-prose block — recorded here so it is a decision, not an accident.

### Deliberate deviations from the plan text

- **The elapsed clock in a materials row does not tick per second.** The plan's row spec is `phase · elapsed · attempt` as one escaped string, which cannot contain the `<span data-elapsed-started>` the existing ticker updates. The row recomputes elapsed from `started_at` on every manifest poll (3–12 s) instead; the legacy panel keeps its live clock. Changing this means putting markup inside the escaped substring.
- **The rows keep a `<section class="brief-materials brief-materials--rows">` wrapper** rather than writing bare rows into `hostEl.innerHTML` as the plan sketched. `removeExisting`, `wireSection`, the notes form and the JD paste form all resolve `.brief-materials`; dropping the wrapper would silently unwire every row action. `role-case.css` strips the panel chrome from the `--rows` variant.
- **`renderCaseRows` degrades to the legacy panel** when `JobBoredCase.model.CASE_DOC_TYPES` is unavailable, rather than rendering an empty list. Safe under a script-order accident.
- **The fact-input width fallback is retired**, JS and tests. `role.js` sized `.brief__fact-input` in `ch` where `field-sizing: content` is unsupported; The Case's rail inputs are full-width block fields and it has no borderless inline fact input, so there is nothing left to size. This is the only place a test *count* went down without a replacement, and it is because the surface is gone (see item 1 above — if L4 adds location/salary to the rail, this fallback should come back with it).

### The `role-brief` grep

The kickoff's non-negotiable is that `grep -rn "JobBoredDossierBrief\|role-brief" --include=*.js --include=*.html --include=*.md .` returns only CHANGELOG history. **It does not.** Code and live docs are clean — every `*.js` and `*.html` hit is gone, and the droid-wiki entries now name `role-case*`. What remains is the **dated record**, which I deliberately did not rewrite:

- `docs/superpowers/plans/2026-09-01-dossier-case-redesign.md` and both specs — these *are* the documents instructing the deletion; they must keep naming it.
- `docs/superpowers/plans/2026-08-31-dossier-render-resilience.md`, `docs/redesign/handoffs/dossier-df-*.md`, `docs/redesign/status/*.json`, `docs/programs/oneflow-20260831/reports/*.md`, `docs/handoffs/*`, `integrations/hermes-job-hunt/PLAN-2026-05-27-*.md` — dated handoffs, swarm logs and status files describing work that actually happened.
- `docs/programs/dossier-case/GROUND-RULES.md` and `KICKOFF-L5-cutover.md` — this lane's own instructions.
- `droid-wiki/lore.md` keeps one mention, as history: "the editorial Brief renderer it used before 2026-09-02 (`role-brief.js`) was retired with the Case cutover."
- `CHANGELOG.md` — as required.

Rewriting the historical record to satisfy a grep would falsify it. If the orchestrator wants a hard-zero grep, the right move is to narrow the check to tracked source (`--include=*.js --include=*.html` plus the live docs), not to edit the archive.

### Flaky, not caused by this lane

On one `npm test` run, `POST /profile saves a valid profile and GET round-trips it` and `POST /profile/from-resume drafts a profile through OpenRouter chat JSON with no Gemini key` failed; both passed on every subsequent run, including the recorded floor. They bind loopback ports (ground-rule 10's known hazard). Worth knowing before reading a red CI run as this lane's fault.

### Not verified

No browser run. Phase 3's exit criteria include a manual smoke on a real role (stepper moves the card, follow-up writes column P, replied writes S, notes survive a poll, materials rows update mid-draft). Everything here is covered by the harnesses above, but nothing in this lane was exercised against a live dev server.
