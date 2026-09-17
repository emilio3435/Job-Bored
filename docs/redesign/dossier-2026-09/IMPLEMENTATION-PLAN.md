# Role Dossier redesign — implementation plan

**Audience** the frontend designer implementing it, and the engineer reviewing it.
**Reads with** [`SPEC.md`](SPEC.md) (the rules) and [`TEARDOWN.md`](TEARDOWN.md) (the why).
**Mocks** [`mocks/`](mocks/) — `mocks/dossier-redesign.css` is written production-shaped and is
meant to be lifted, not retyped.

Nothing in this pass touches production CSS or JS. This document is what makes that safe: it names
every file that changes, every contract that must not, and the order that keeps the surface working
at each step.

---

## 1. Files that change

| File | Change | Size of change |
| --- | --- | --- |
| `role-case.css` | Replace the board rules; keep the palette overrides and the a11y corrections. | Large — most of the 300 lines |
| `role-case.js` | Split `renderMoves`; add `renderDocket` and `renderVerdict`; rework `renderRail` and `renderRecord`. | Large — ~150 of 295 lines |
| `role-case-model.js` | Add the derived verdict; no new inputs. | Small — one function |
| `role.js` | Render `close-role`; wire the display↔edit swap; nothing else. | Small |
| `role-materials.js` | `renderCaseRows` emits the new row shape; the docket mirror reads the same manifest. | Medium — one function + one new mount |
| `role.css` | Remove the `.dossier` / `.brief` width caps that create the triple maximum. | Small |
| `tests/role-case-*.test.mjs` and 8 others | Update selectors. See §5. | Medium, mechanical |

`style.css` gains three layout tokens (`--dsr-*`) and the three contrast tokens promoted out of
`role-case.css`. No colour value changes.

---

## 2. Component inventory

27 components. "Keep" means the component survives with the same job and roughly the same markup;
"Rework" means same job, new structure; "New" means it does not exist today.

| # | Component | Today | Verdict | What changes |
| --- | --- | --- | --- | --- |
| 1 | **Frame** | `.case` — `overflow: hidden`, 3 competing maxima, viewport media queries | **Rework** | `container-type: inline-size`, `clip-path` for the radius, single `min(1220px, 100%)` |
| 2 | **Masthead** | `.case__rail` — `56px minmax(0,1fr) auto` | **Rework** | Bounded flags track; facts become a `<dl>`; visible `<h2>`; gains the `View posting` link |
| 3 | **Identity field** | `.case__title` / `.case__company` — permanent `<input>` | **Rework** | Display-then-edit; wrapping text by default (fixes 81px truncation) |
| 4 | **Fact list** | `.case__meta` | **Keep** | Promoted to `<dl>`, 10px floor |
| 5 | **Status pill** | `.case__pill` | **Keep** | Only deadline + health remain, plus the posting link; the drafting CTAs move to the docket |
| 6 | **Docket** | — | **New** | Sticky bar: stepper + in-flight + actions + close |
| 7 | **Stage stepper** | `.case__stepper` | **Rework** | Moves into the docket; scroll-snap, edge fade, shrinkable connectors, current step scrolled into view |
| 8 | **Verdict line** | — | **New** | One derived sentence, 3 slots (SPEC §4) |
| 9 | **Metric tiles** | `.case__numbers` — `repeat(var(--n), minmax(0,1fr))` | **Rework** | `repeat(auto-fit, minmax(10rem, 1fr))`; `<li>` is the cell, tile fills it |
| 10 | **Provenance chip** | `.case__src` — 7.5px | **Keep** | 10px floor; still `aria-hidden` with words folded into the owner's label |
| 11 | **Provenance banner** | chip only | **New** | Warn banner above the read for `needsReview` |
| 12 | **Lede** | `.case__quote` | **Keep** | Becomes a `<blockquote>` in the canvas |
| 13 | **Requirement row** | `.case__req li` | **Keep** | `12rem` floor on the text track; status drops under at narrow |
| 14 | **Stack chips** | `.case__chips` | **Keep** | 11px |
| 15 | **Strength / evidence / gap** | `.case__strength` / `__evidence` / `__gap` | **Keep** | Move into the canvas beside the requirements they answer |
| 16 | **Score bars** | `.case__dim` — `118px 1fr 30px` | **Rework** | `minmax(6rem,9rem) minmax(4rem,1fr) 2.25rem`; label above at narrow |
| 17 | **Talking points** | `.case__tp` | **Keep** | CSS counter instead of a rendered index |
| 18 | **Material row** | `.case__doc` — `minmax(0,1fr) auto auto` | **Rework** | 3-row area grid; one-word pill + sentence in the meta line; no `overflow-wrap: anywhere` |
| 19 | **Material progress** | `.case__doc-progress` | **Keep** | Gains an indeterminate track; mirrored into the docket |
| 20 | **In-flight chip** | — | **New** | Docket mirror of the running draft, same manifest |
| 21 | **People ledger** | `.case__kv` | **Rework** | `<dl>`, label above value (fixes contact truncation) |
| 22 | **Reply segment** | `.case__seg` | **Keep** | Unchanged behaviour, 10px floor |
| 23 | **Saved mark** | `.case__saved` | **Keep** | Unchanged |
| 24 | **Notes** | `.case__notes` | **Keep** | Moves to the end of the canvas |
| 25 | **Record** | `.case__events` — `grid-auto-flow: column` | **Rework** | Vertical timeline, one row per event |
| 26 | **Skeleton / invite / error** | `.case__skeleton`, `.case__hint`, `.case__hint--error` | **Rework** | Per-section skeleton kept; invite and structured error block are new shapes |
| 27 | **Empty shelf** | `.jb-shelf` in `role.js` | **Keep** | Retuned to the new type scale only |

Class-name map: the mock uses `.dossier__*` throughout. Phases 1–2 below can be done **in place
under the existing `.case__*` names**, which is why the migration is ordered the way it is — the
rename is deliberately the last thing, so it never blocks the fix.

---

## 3. Contracts that must not change

These are load-bearing for `role.js`, `role-materials.js`, `flowing-writes.js` and the test suite.
Any of them silently dropped is a regression that renders fine.

**Actions** (`role.js` walks up from the click target reading `data-action`):
`edit-field` · `stage-step` · `open-profile-match` · `resume-cover` · `resume-tailor` ·
`close-role` · `notes` · `brief-view-posting` · `materials-preview` · `materials-download` ·
`materials-retry` · `materials-dismiss` · `materials-repair`.

**Attributes**: `data-field` · `data-value` (Replied writes verbatim, including `Unknown`) ·
`data-original` (the no-op baseline; a commit that equals it must not write) · `data-stage` (the
`--now` step is the only source of the from-stage) · `data-doc` · `data-feature` · `data-num` ·
`data-slug` · `data-saved` · `data-status` · `data-phase`.

**Mount points**: `[data-mount="brief"]` (role.js → the renderer) and `[data-mount="materials"]`
(the renderer → role-materials.js). If the docket mirrors the in-flight run it needs a second mount,
e.g. `[data-mount="materials-inflight"]`, fed from the same manifest — **not** a second poll.

**Behavioural invariants**, each of which exists because it broke once:

- Commit on blur and Enter only, never per keystroke. Escape restores `data-original`.
- The wholesale `innerHTML` swap is deferred while an edit surface has focus, and the deferred
  render flushes on `focusout`. Focus is restored by identity attributes after every swap.
- The optimistic Replied paint happens on click, before the write resolves.
- `saved` marks are re-painted after every render so a render mid-fade cannot swallow one.
- `aria-busy="true"` and `role="status"` stay **adjacent in the source** — `tests/enrichment-self-heal.test.mjs`
  greps `role-case.js` for that exact pair.
- Provenance never upgrades: a classification failure keeps the marks already found rather than
  clearing them.
- `structured-output-validator` still runs on a copy of the enrichment before render.

---

## 4. Migration

Six phases. Each one ships on its own and leaves the dossier working; the first two are where the
user-visible pain goes away.

### Phase 1 — Frame (small, no visual change to the lanes)

1. `.case` → `container-type: inline-size; container-name: dossier`.
2. Remove `overflow: hidden`; add `clip-path: inset(0 round 14px)`.
3. Replace the width rule with `width: min(1220px, 100%)`; drop `max-width` from `.dossier` and any
   width cap on `.brief` so there is one maximum.
4. Convert the two existing `@media (max-width: …)` blocks to `@container dossier (…)` with the
   equivalent thresholds.

**Ship check** — the frame width now equals the pipeline region's at the same viewport (TEARDOWN §4:
1116 → 1220), and `measure.mjs` still reports 0 escapes. Nothing else moves.

### Phase 2 — Kill the crush, still three columns (the highest-value phase)

Fix the three components that cannot hold their content, without touching the board:

1. **Material row** → the 3-row area grid; drop `overflow-wrap: anywhere` from `.case__doc-n`; move
   the humane failure copy from the pill to the meta line.
2. **Score bars** → `rem` tracks.
3. **Record** → vertical timeline.

**Ship check** — `measure.mjs` reports 0 self-overflow findings and the shredding detector is clean
at 1280/1440/1512. The 9-line "Cover letter" is gone while the layout is still the shipped one. If
the redesign stalls after this phase, the reported bug is fixed.

### Phase 3 — Docket and verdict (additive markup)

1. `renderDocket` — move the stepper out of its own strip, add the actions currently in
   `.case__rail-right`, add `close-role`, add the in-flight mirror.
2. `renderVerdict` — the derived sentence (SPEC §4) plus the reworked metric tiles.
3. Remove the drafting CTAs from the masthead so there is one home for each action.

**Ship check** — `position: sticky` resolves (it cannot until Phase 1 lands); the docket parks flush
under the app chrome; every focusable in the body has the `scroll-margin-top` clearance.

### Phase 4 — Canvas and ledger

1. Split `renderMoves` into `renderSayThis` (canvas) and `renderLedger` (materials + people).
2. Replace `.case__board` with `.dossier__body` and the two bounded tracks.
3. Move `renderNotes` to the end of the canvas and `renderRecord` into the ledger.
4. Delete the `.case__lane` rules.

**Ship check** — canvas 736 / ledger 352 at 1440 and 1280; both tracks at their floors at a 1024
frame; one column below 62rem; tab order equals DOM order at 1440, 900 and 390.

### Phase 5 — States, type, a11y

1. The six states in SPEC §6 that are not "filled": loading, no-resume, scrape error, needs-review,
   terminal, plus the five materials states.
2. Type floor pass: raise all 23 sub-10px declarations; promote `--mint-ink`, `--mute`, `--amber-ink`
   to `style.css`.
3. Visible `<h2>`; `<dl>` for facts and people; remove every `outline: none` that has no paired
   `:focus-visible` rule.

**Ship check** — axe clean; heading order h2 → h3 with a visible h2; no `font-size` below 10px in
`role-case.css`.

### Phase 6 — Rename and sweep

Rename `.case__*` → `.dossier__*`, delete dead rules, update the screenshot baselines in
`docs/redesign/screenshots/`, and refresh `docs/superpowers/specs/` to point at this spec.

Do this last and in one commit. It is pure churn, it touches ~166 test assertions, and it must not
be entangled with a behavioural change.

---

## 5. Test impact

Eleven root test files assert on dossier class names — 166 references — and five of them read
`role-case.css` or `role.css` as text and assert on the CSS source itself.

| File | `case__` refs | Reads CSS? | Phase that breaks it |
| --- | --- | --- | --- |
| `tests/role-case-render.test.mjs` | 59 | yes (both files) | 2, 4, 6 |
| `tests/role-case-a11y.test.mjs` | 40 | yes | 5, 6 |
| `tests/role-materials.test.mjs` | 14 | yes | 2, 6 |
| `tests/dossier-card-attrs.test.mjs` | 10 | no | 6 |
| `tests/role-case-interactions.test.mjs` | 9 | no | 3, 6 |
| `tests/enrichment-self-heal.test.mjs` | 7 | yes | 2, 6 |
| `tests/role-field-edit-render-guard.test.mjs` | 7 | no | 3, 6 |
| `tests/dossier-field-provenance.test.mjs` | 7 | no | 6 |
| `tests/dossier-provenance-labels.test.mjs` | 5 | no | 5, 6 |
| `tests/role-materials-manifest-events.test.mjs` | 4 | no | 2, 6 |
| `tests/pipeline-edit-affordance.test.mjs` | 4 | yes | 6 |
| `tests/e2e-smoke/case-dossier.spec.mjs` | 7 | no | 4, 6 |

Two things to do rather than just fixing selectors as they break:

- **Add the layout assertions this bug had no test for.** The audit scripts in
  [`audit/`](audit/) are the prototype: a jsdom test cannot catch a 12px grid track, so this needs a
  Playwright check in `tests/e2e-smoke/` that renders the dossier at 1280 and 1440 and asserts
  `scrollWidth <= clientWidth` for every element plus no mid-word shredding. That is the regression
  test the shipped bug is missing, and it should land with Phase 2.
- **Prefer `data-*` selectors over class names in tests.** The `data-action` / `data-doc` /
  `data-field` attributes are contracts (§3); the class names are not. Tests that assert on
  contracts survive Phase 6 for free.

---

## 6. Risks

| Risk | Why it is real here | Mitigation |
| --- | --- | --- |
| **Sticky docket does not stick** | Any ancestor with `overflow: hidden`/`auto` silently kills it, and the shipped frame has exactly that. Ancestors outside the dossier (`.brief`, the region, the app shell) could too. | Phase 1 removes it locally; the Phase 3 ship check asserts `position: sticky` resolves *in the app*, not only in the mock. Walk the ancestor chain in the smoke test. |
| **Container queries + `container-type`** | `container-type: inline-size` applies size containment: the element can no longer be sized by its contents in the inline axis. Harmless for a block-level frame, but it also makes the frame a containing block for absolutely-positioned descendants. | The dossier has two: `.case__notes::before` (inside a positioned parent already) and the `::after` hit-target expanders (also locally positioned). Audit for `position: absolute` without a positioned parent before Phase 1. Baseline support is fine (all evergreen since 2023). |
| **Sticky docket eats vertical space** | ~55px at one row, ~96px at two, on top of the app's own ~64px chrome. On a 900px laptop viewport that is up to 18%. | One row wherever the frame allows it (≥ 52rem); actions are pills, not buttons with icons; no second sticky element anywhere in the dossier. Measure on a 1280×800 laptop before Phase 3 ships. |
| **166 test assertions on class names** | Phase 6 breaks all of them at once. | Phase 6 is last, separate, and mechanical. Migrate tests to `data-*` selectors opportunistically in phases 2–5 so the final diff shrinks. |
| **The verdict line invents a claim** | Derived prose is exactly where a UI starts asserting things nobody measured — this codebase has already been burned by that (`P0-0c`: `Number(null) === 0` rendering as a score of 0; `P0-7`: a `MED` severity pill no engine assigned). | SPEC §4 fixes the derivation as a table with an explicit fallback ladder. Every clause must be traceable to a non-null model field; absent input drops the clause rather than guessing it. Unit-test the assembler with all-null inputs. |
| **Materials state drifts between docket and ledger** | Two renderings of one run is how the current overlay/row disagreement happened. | Both read the same manifest object in the same render pass. The docket mirror MUST NOT poll. |
| **Display-then-edit breaks the write path** | The frozen contract assumes a persistent input with `data-original`. | Keep `data-original` on the field when it is created; commit through the same handler. The `<textarea rows="1">` + `field-sizing: content` variant is the fallback if the swap proves fiddly — `role.js` already accepts `TEXTAREA`. |
| **Ledger at 320px repeats the shipped bug** | It is the same order of width that crushed the materials row. | The difference is that 320px is now a *floor* with a container query behind it, not a residue. Every ledger component is audited at 320px (`04-narrow.html`, 470px viewport → 348px ledger) and the row stacks below 15rem. |
| **The dossier is wider than the pipeline after Phase 1** | Fixing the double-gutter changes the frame by 104px, which is visible against neighbouring regions. | That is the point — they should match. Screenshot the whole flow at 1440 before and after, and check `dawn`, `today` and `lattice` alignment too. |

---

## 7. Definition of done

Phases 1–5 complete, Phase 6 optional but recommended, and:

- All ten acceptance criteria in [SPEC §10](SPEC.md#10-acceptance-criteria) pass.
- `npm test`, `npm run lint:repo`, `npm run typecheck:repo` clean.
- A new Playwright layout regression test covers 1280 and 1440.
- `node docs/redesign/dossier-2026-09/audit/measure.mjs` re-run against the *implemented* dossier
  reports zero findings — i.e. the harness that proved the bug now proves the fix.
- The dogfood pass that produced this brief is repeated on the 3E role: open it, request a cover
  letter, watch it fail, retry, without scrolling back to the masthead once.
