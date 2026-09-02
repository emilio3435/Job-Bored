# LANE-REPORT-P3 — surface truth

Branch `feat/polish-3` from `feat/case-polish` @ 8975312. Two commits, nothing pushed.

- `72439e3` fix(case): the dossier stops printing claims it has not earned
- `f17d2ca` test(case): retire the fixtures that encoded the old Case surface

## 1. Done (by spec id)

Every item below has a named-input test in `tests/role-case-a11y.test.mjs` (new, 24 tests, all green).

| Item | What changed | Where |
|---|---|---|
| P0-B | Closes pill suppressed below -30 days; `getPostingHealth`'s unverified "open" never prints beside a past close date | `role-case.js` `renderRail` |
| P0-5 | Materials caption reads `ready` vs `total` — 0/4 is "0 of 4 ready", not "All ready" | `renderNumbers` |
| P0-6 | Reply tile pushed only when the value is Yes or No | `renderNumbers` |
| P0-9 | "You have" hides when strengths, evidence, gaps and dimensions are all empty | `renderYouHave` |
| P0-11 | Terminal chip goes through `stages.toLabel` | `renderStepper` |
| P1-0 | `.case` takes `--jb-flow-content-width` instead of running edge-to-edge | `role-case.css:24` |
| P1-0b | Numbers band tracks off `data-count` via `--case-num-cols` (2/3/4) | `role-case.css` |
| P1-0c | New `--case-mint-on-light` (`var(--jb-mint-ink, #3F6B55)`) on the saved mark, ready pill, evidence label, derived tag, scorecard bars | `role-case.css` |
| P1-0d | `--mute` redefined inside `.case` to `var(--jb-ink-soft, #5A5347)` — all 15 label rules darkened at the token layer, one line | `role-case.css` token block |
| P1-0f | `.case__stamp--fresh` moved after the base `.case__stamp` rule; the stray dotted gap rule replaced with `:not(:has(+ .case__gap))` | `role-case.css` |
| P1-0g | `.case__cta:hover/:focus-visible`; `.case__num--btn:hover/:focus-visible` | `role-case.css` |
| P1-1 | Visually-hidden `<h2>` role identity; lane titles and "The record" are `<h3>` (with the v2 heading margin cleared) | `role-case.js`, `role-case.css` |
| P1-2 | Stepper is `role="group" aria-label="Stage"`, `aria-current="step"` on the current step, `aria-label="Move to <label>"` per button | `renderStepper` |
| P1-3 | Stack chips emit the same status word the requirement rows do, visually hidden | `renderTheyWant`, `.case__st--vh` |
| P1-4 | Every `case__src` chip is `aria-hidden="true"`; the source folds into each tile's own `aria-label` (`"Fit, from your sheet"`) | `src()`, `tile()` |
| P1-5 | `:focus-visible` outlines on title, company, fact inputs, `.case__v--edit`, notes textarea | `role-case.css` |
| P1-6 | `::after` inset hit areas on stepper steps and doc actions; 24px floor on rail fact inputs; doc-action gap 6px → 12px | `role-case.css` |
| P2-2 | `recovered parse · review` → `unverified`; sub-line → "read these against the posting before you rely on them" | `renderTheyWant` |
| P2-3 | ATS tile is **Resume score**, sub "How well your draft answers this posting", crimson only below 70 | `renderNumbers` |
| P2-7 | Source tags read as English: from your sheet · from the posting · written by AI · matched here · your files | `SRC_WORDS` |

## 2. Not done

- **P1-0, second half** — raising `.dossier`'s 1180px cap so the spec's 1240 is reachable lives in `role.css`, which is outside this lane's fence (P2 owns the `role.css` error-styling hook). The `.case` side is done; the cap still clamps at 1180. One line for whoever merges: `role.css:221-234`.
- **P0-5, second half** — "count only rows the user can actually request" is `total: CASE_DOC_TYPES.length` in `role-case-model.js:243`, which is P1's file. The caption is now honest about whatever total the model reports; the total itself is still all four doc types.
- **P1-0e** — assigned to P2 (`role-materials.js` + `role.css`).

## 3. Fixtures corrected (non-negotiable #1)

Four suites pinned markup this pass changed on purpose. No assertion was weakened — each now names the shape the spec asks for:

- `tests/role-case-render.test.mjs` — `case__src--inferred`/`--scrape` chips gained `aria-hidden`; the fit tile gained an `aria-label`; the review tag and its requirements sub-line carry the P2-2 copy.
- `tests/dossier-provenance-labels.test.mjs`, `tests/dossier-field-provenance.test.mjs` — same `aria-hidden` and copy shape. (The latter two are outside the lane table but owned by no other lane; flagging the touch.)

## 4. Verification run

Only the suites this lane touched — the orchestrator runs the full floor.

```
node --test tests/role-case-a11y.test.mjs tests/role-case-render.test.mjs \
  tests/dossier-provenance-labels.test.mjs tests/dossier-field-provenance.test.mjs \
  tests/dossier-loose-parse-provenance.test.mjs tests/role-case-model.test.mjs
→ pass 92, fail 0

node tools/lint-tokens.mjs --quiet → 0 findings across 16 file(s)
```

Not run here (hard stop, orchestrator's floor): `npm test`, `npm run lint:js`, `npm run test:contract:all`, `npm run typecheck:server`, `npm run smoke:jb-v2`, `npm run test:e2e-smoke`, `npm run test:e2e-journey`.

## 5. Risks for integration

- **Copy is now the contract.** P2-2/P2-3/P2-7 changed visible strings. Any Playwright or smoke assertion outside these six suites that greps for `ATS`, `SHEET`, `SCRAPE`, `DERIVED`, `FILES`, or `recovered parse` will fail on new copy, not a regression. The e2e suites were not run.
- **`--mute` is redefined inside `.case`.** That is deliberate (P1-0d, one line for fifteen rules) but it darkens every `--mute` consumer inside the Case, including any a later lane adds. Scoped to `.case`; nothing outside the region moves.
- **`:has()` in the P1-0f gap rule** — supported everywhere the v2 shell already targets, but it is the first `:has()` in `role-case.css`.
- **P1-6 `::after` overlays** sit above the step/doc-action text; they carry no background, so nothing is painted over, but they will swallow a pointer event aimed at the 6px gutter between two doc actions. The gap went to 12px to keep the targets from overlapping.
