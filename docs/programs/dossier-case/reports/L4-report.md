# Lane report · L4 core (claim E) — the Case model and renderer

Branch: `feat/case-l4` (cut from `feat/dossier-case` @ 3878054)
Commits: `1e0f0f7` (Task 6), `628a69a` (Task 7). **Not pushed.**

## 1. What this lane was

Plan `docs/superpowers/plans/2026-09-01-dossier-case-redesign.md`, Phase 1 + Phase 2:

- **Task 6** — `role-case-model.js`: `buildCaseModel(jobKey, deps)` assembles the
  `CaseModel` (spec §4) purely from injected deps (view-model, keyword analysis,
  persisted ATS scorecard, materials manifest, posting health, stage registry,
  provider label, clock); `collectDeps(jobKey)` gathers those from the live page;
  `CASE_DOC_TYPES` is the four-document contract the numbers band counts against.
- **Task 7** — `role-case.js`: `window.JobBoredCase.render(mount, model)` paints
  every block of the approved design (spec §1 diagram, §5 DOM contract, §7 visual
  spec) from the model alone, escaping exactly once through `JobBoredText`;
  `role-case.css` carries the styles.

The renderer is deliberately **not** reachable from the page — `grep -c JobBoredCase role.js` → `0`.
L5 owns the cutover.

## 2. Which claims went red first (named tests)

- `tests/role-case-model.test.mjs` — 6 tests, red on `ENOENT role-case-model.js`
  (module missing), then red on 3 of 6 after the first implementation because the
  model is assembled inside the `vm` realm and `assert.deepEqual` compares
  prototypes. Fixed in the **harness**, not the assertions: the results are
  round-tripped through JSON via a `plain()` helper, the same idiom
  `tests/dawn-data-jd-blocks.test.mjs` (L1, this program) documents. Every
  assertion from the plan survives verbatim.
- `tests/role-case-render.test.mjs` — 6 tests, red on `ENOENT role-case.js`.
  One implementation fix was needed to satisfy the plan's own assertion: the
  People follow-up `<input>` had `type="date"` **before** `data-action` /
  `data-field`, and the pinned regex requires
  `data-action … data-field="followupAt" … type="date" … value`. The renderer was
  changed to match the test (ground rule 8 — the test is the contract).

Both suites now green, 12/12.

## 3. What shipped, file and fence

Inside the L4 fence:

| File | Change |
|---|---|
| `role-case-model.js` | **new** — `window.JobBoredCase.model.{buildCaseModel, collectDeps, CASE_DOC_TYPES}` |
| `role-case.js` | **new** — `window.JobBoredCase.render(mount, model)` |
| `role-case.css` | **new** — 131 rules, every one scoped under `body.jb-v2 [data-region="role"] .case` |
| `tests/role-case-model.test.mjs` | **new** — 6 tests, plan fixture verbatim |
| `tests/role-case-render.test.mjs` | **new** — 6 tests, plan assertions verbatim |
| `index.html` | 3 lines only: `role-case.css` link after `role.css`; `role-case-model.js` then `role-case.js` after `role.js` |

**The one file outside the row** (authorized by the kickoff's Fence paragraph):
`bridge-registry.js` — `window.JobBoredApp.core` had no accessor for a raw
pipeline job by stable key (`grep -rn getJobByStableKey` was empty before this
lane), so one function `getJobByStableKey(stableKey)` was added to the
`Object.assign(app.core, …)` block at `bridge-registry.js:700`. A card's
`data-stable-key` is its index into the loaded pipeline array
(`pipeline-render.js:178`), so the accessor reads `host.getPipelineData()[index]`
with an integer guard. It is added where `app.core` is assembled rather than in
`app.js`, because doing it in `app.js` would have meant three edits across two
files (function + host export + registry pass-through) instead of one function in
one place. `collectDeps` is its only caller today; L5's Task 8 exercises it.

Non-negotiables checked:
- `grep -n Gemini role-case*.js` → **empty** (see §5 for how the provider-label
  map was changed to make that true).
- Every CSS rule scoped (trap 3): `grep -nE '^[^@ /}].*\{' role-case.css` returns
  only `body.jb-v2 [data-region="role"] .case …` selectors; the two `@media`
  blocks and the one `@media (prefers-reduced-motion)` rule are scoped inside too.
- No `escapeHtml` / entity decoder / truncation of its own — `role-case.js` calls
  `JobBoredText.escapeHtml` / `escapeAttr` only; `role-case-model.js` calls
  `normalizeInline` / `itemText` / `stripListGlyph` only.
- Stage order comes from the injected `stages.pairs()/toKey()/toLabel()/isClosed()`.
- Both `vm` harnesses evaluate `jb-text.js` first and assert it loaded (trap 2);
  every test asserts positive content except the four that pin a block's absence.

## 4. Floor results

```
$ npm test
ℹ tests 2694
ℹ suites 655
ℹ pass 2693
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6584.562583
exit=0
```

The single `✖` line in that run is the pre-existing `todo` test
`submission-record-audit.test.mjs → "persists and can remove the canonical
submission evidence record" # blocked on the canonical-ownership gate`. It is
`todo 1 / fail 0`: the suite declares it with
`todo: "blocked on the canonical-ownership gate; no legal Sheet column or
IndexedDB store"` (`tests/submission-record-audit.test.mjs:18`), and
`git diff 3878054..HEAD -- tests/submission-record-audit.test.mjs submission-flow.js`
is empty — this lane did not touch it.

```
$ npm run lint:js

> command-center@0.1.0 lint:js
> eslint .

exit=0   (no output = no findings)
```

```
$ npm run test:contract:all
OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
…
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
exit=0
```

Definition-of-Done suite:

```
$ node --test tests/role-case-model.test.mjs tests/role-case-render.test.mjs \
       tests/index-html-cold-start.test.mjs tests/index-html-size.test.mjs
ℹ tests 22
ℹ pass 22
ℹ fail 0
```

(`npm run typecheck:server` not run — L4 ships no server file; the ground rules
scope it to L2/L6.)

## 5. Anything unverified / deviations

1. **`PROVIDER_LABELS` → `PROVIDER_CASING`, vendor keys dropped.** The plan's
   Task 6 code hardcodes `{ gemini: "Gemini", openai: "OpenAI", anthropic:
   "Anthropic", … }`, which fails the kickoff's checkable gate (`grep -n Gemini
   role-case*.js` must be empty). The `gemini` and `anthropic` entries were
   removed because `collectDeps`'s own fallback — title-casing the configured
   provider id — produces exactly the same labels for them. The map now holds
   only the four ids whose display casing cannot be derived (`openai`,
   `openrouter`, `local`, `webhook`) and is documented as a casing table, never a
   default: an unset provider still yields `""`. Behavior is identical to the
   plan for every provider; the vendor-name gate is now satisfied.
2. **`var(--surface, #FFFEF9)` and `var(--border, #E5DFCC)` fallbacks are dead.**
   Transcribed verbatim from the plan, but `style.css:11,14` define `--surface:
   #ffffff` and `--border: #e2e8f0` at `:root`, so chips, the evidence panel and
   every card border resolve to the legacy blue-grey values, not the mockup's
   parchment tones. Not changed here — the plan says "exact values", and
   repainting the Case's borders is a design call, not a transcription. Flagging
   it for L5 / design review: the fix is to point those at `--parchment-deep` /
   `--border-strong`, or to define Case-local fallbacks.
3. **`collectDeps` is not unit-tested** — by the plan's own design ("the unit
   tests inject `deps`, so `collectDeps` is covered by Task 8's interaction
   tests"). Its live wiring — `JobBoredDawn.data.getRoleViewModel`,
   `JobBoredApp.core.getJobByStableKey`, `app.keywordMatch.analyzeJob`,
   `app.materialsState.getScorecardForJob`,
   `JobBoredRoleMaterials.getCurrentManifest`,
   `JobBoredExpiredReview.getPostingHealth`,
   `CommandCenterResumeGenerate.getResumeGenerationConfig` — was verified to
   exist by reading each seam, but has never executed in a browser. L5 is the
   first run.
4. **`getJobByStableKey` has no test of its own.** It is one guarded array read
   in `bridge-registry.js`, reached only through `collectDeps`, which is itself
   deferred to Task 8. If L5 finds the dossier's `jobKey` is ever something other
   than the card's numeric `data-stable-key`, this accessor is the thing to fix.
5. **Nothing rendered in a real browser.** The renderer produces a string; both
   suites assert against that string with a stub mount (`{ innerHTML: "" }`).
   Layout, the navy rail's contrast, the record's hairline, and the responsive
   breakpoints are unverified visually — no lane in this program has mounted the
   Case yet, and it is unreachable from `role.js` by design until L5.
6. **`contact` is still not a writeback field.** The plan's own note stands: the
   renderer emits `data-field="contact"` per spec §5, but `flowing-writes.js`
   has no `contact` writer (title/company/location/salary/heardBack/reply/
   followupAt/passed). Editing it will no-op until L5 adds the writer. That is
   L5's file, untouched here.
