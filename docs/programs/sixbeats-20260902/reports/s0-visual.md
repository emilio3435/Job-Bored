# LANE REPORT — V1 s0-visual (SIXBEATS, claim U1)

Branch: `feat/sixbeats-s0-visual` · base `ed44f35` · HEAD `345d8e1` · committed locally, never pushed.

## 1. What this lane was

Claim **U1 · S0 · UGLY**: as shipped, screen S0 — the first pixel a zero-config
visitor sees — is a bare kanban of demo cards with no page header or wordmark,
no framing, and the invitation card collapsed into a corner pill while most of
the viewport sits empty. The lane rebuilds S0 so that first pixel reads as a
finished product, against the approved prototype
(`docs/programs/sixbeats-20260902/reference/six-beats-prototype.html`, screen
S0) rendered in the product's own token system.

Fence, per SIXBEATS-SPEC lane cut: `oneflow-demo-board.js`, `css/oneflow.css`
inside `/* ONEFLOW:L4 */` only, `fixtures/demo-pipeline.json` copy-only (not
touched — the fixture needed no change). Nothing outside the fence was edited
except the one legacy test that pinned the behaviour U1 names (see §3).

### Root cause found (this is the mechanism behind U1)

The shipped S0 was not merely under-designed — **its type rules never applied
at all**. `jb-type.css` ships

```css
body.jb-v2 h3 { font-size: var(--jb-text-xl); }   /* specificity 0,1,1 */
body.jb-v2 p  { font-size: var(--jb-text-base); } /* specificity 0,1,1 */
```

and every S0 rule was a lone class (`.oneflow-demo__column-title`, 0,1,0), so it
**lost the cascade**. Measured live in the browser on `/?greenfield=1` before
the fix:

| element | rule said | browser computed |
|---|---|---|
| `.oneflow-demo__column-title` (h3) | `var(--text-xs)` ≈ 12 px | **22 px** |
| `.oneflow-demo__note` (p) | `var(--text-xs)` ≈ 12 px | **15 px** |

That is why the shipped board reads as an unstyled dump: giant uppercase column
headings, a kicker at body size, no hierarchy anywhere. Every S0 rule is now
scoped under `.oneflow-demo` (0,2,0) and a probe keeps it that way.

## 2. Which claims went red first (named tests)

`tests/sixbeats-v1-s0-visual.test.mjs` — 15 probes, 13 of them red on `ed44f35`,
committed red in `9323a0a` before any implementation.

| Probe (suite › test) | Red because |
|---|---|
| header strip › renders a header strip carrying the JobBored wordmark | no `.oneflow-demo__header` / `__wordmark` existed |
| header strip › puts the sample-pipeline kicker in the strip, verbatim | the kicker was loose on the page, not in a strip |
| header strip › keeps the header when the fixture cannot be fetched | degraded mode rendered no chrome at all |
| invitation › shows the invitation card on first mount | (passed before — guard against regression) |
| invitation › ignores a stale collapse flag from an earlier visit | **the U1 screenshot**: a persisted sessionStorage flag opened S0 on the corner pill |
| invitation › renders the pill only after "Poke around first" | the pill carried no mark — it was an undesigned button |
| invitation › sits ON the framed board, not loose on the page | there was no frame; the ask was `position: fixed` to the window |
| board › gives every column its stage identity | columns carried no stage class |
| board › gives every card its stage rail class | cards carried no stage class |
| board › paints the rail from the shipped stage tokens | no rail rules existed in L4 |
| type scale › scopes every type-setting S0 rule under `.oneflow-demo` | **the cascade bug above** — 20 unscoped rules |
| type scale › keeps every S0 rule inside the L4 fence | (passed before — fence guard) |
| 390 px › has a mobile breakpoint at or above 390 px | L4 shipped no mobile rules for S0 at all |
| 390 px › collapses the board to a single column | ditto |
| 390 px › lifts the invitation out of the overlay and above the board | ditto — the fixed card sliced the cards it was selling in half |

```
$ node --test tests/sixbeats-v1-s0-visual.test.mjs
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

## 3. What shipped, file-and-fence

**`oneflow-demo-board.js`** (whole file is V1's fence)

- `buildHeader()` / `buildWordmark()` / `buildMark()` — the page header strip:
  the JobBored lockup (CSS-drawn mint mark + two-weight `Job|Bored`) and the
  normative kicker "Sample pipeline — this is what a set-up JobBored looks
  like." The mark is textless and `aria-hidden`, so a control that carries it
  keeps its own label as its accessible name.
- `buildFrame()` — the framed board, with its own head (`Pipeline` ·
  `8 roles · demo data`, from the prototype's S0) and the ask nested **inside**
  the frame instead of pinned to the window.
- `buildAskOnly()` — the degraded frame: no fixture (file:// open, 404) still
  gives a framed, centred invitation rather than a void.
- `stageKey()` / stage classes — every column gets
  `oneflow-demo__column--<stage>` and every card
  `oneflow-demo__card--stage-<stage>` (+ `data-oneflow-demo-stage`).
- `fitBand()` — the fit pill's band (high ≥ 85 / mid ≥ 70 / low), matching the
  product's own `--jb-fit-*` split. Score text is now `94% fit` (prototype
  form); the `aria-label` "Fit score 94 out of 100" is unchanged.
- `buildPill()` — the collapsed ask carries the mark plus the normative label;
  it still opens the flow (spec §4 "reopens the flow").
- **Removed** `PILL_SESSION_KEY`, `session()`, `readCollapsed()`,
  `writeCollapsed()`. `mount()` now always opens on the invitation.
- Every normative string is untouched: `INVITATION` is byte-identical, and the
  kicker moved into a `BOARD` constant without a character changing.

**`css/oneflow.css`, `/* ONEFLOW:L4 */` region only** — the S0 block rewritten
(the B6 / go-live rules below it are untouched, and a probe asserts no
`.oneflow-demo` rule leaked into CORE / L1 / L2 / L3):

- Every rule scoped under `.oneflow-demo` — the cascade fix.
- Three-surface ladder: page ground `--jb-paper-2`, framed board `--jb-paper`,
  cards `--jb-paper` on it with `--jb-line-soft` borders.
- Cards speak `.kanban-card`'s language: `box-shadow: inset 3px 0 0
  var(--oneflow-demo-stage)`, painted from the shipped `--jb-stage-*` tokens
  with the legacy `--stage-rail-*` as fallback; stage dot repeated on the column
  head; dashed mono DEMO chip; fit pill in `--jb-fit-*` / `--jb-mint-soft` /
  `--jb-amber-soft`.
- The invitation is absolutely centred **on** the frame with a radial paper glow
  behind it, so the rows read as texture instead of fighting the headline.
- Primary action moved from mint to navy: paper-on-mint is a **1.9:1** contrast
  failure, navy-on-paper is ~11:1, and navy is what the prototype ships.
- `@media (max-width: 640px)`: frame becomes a flex column, board
  `grid-template-columns: 1fr`, ask `position: static; order: -1` (above the
  board), detail panel goes full-bleed. Plus a `prefers-reduced-motion` block.

**`tests/oneflow-l4-demo-board.test.mjs`** — one legacy pin updated in the same
commit, per ground-rules trap 7. "the collapse persists across the session — a
remount shows the pill" became "the collapse lasts the visit, not the browser
session", because that persisted collapse **is** claim U1. Every other assertion
in that suite (25 tests) still passes unchanged, including the verbatim-copy and
read-only-detail probes.

### Screenshots — `.lane-evidence/`, 1440×900 and 390×844, DPR 2

Captured with `.lane-evidence/shoot-s0.mjs` (re-runnable:
`node .lane-evidence/shoot-s0.mjs before|after`), which boots the real
`dev-server.mjs` on a random port through the e2e hermetic fence and loads
`/?greenfield=1` — a true zero-config cold start, no live Google, no checkout
`config.js`.

| Claim | Before | After | What changed |
|---|---|---|---|
| Page header / wordmark | `s0-before-1440x900.png` | `s0-after-1440x900.png` | An unheaded kanban gains a sticky strip: mint mark + `Job`/`Bored` lockup left, the sample-pipeline kicker as a mono eyebrow right. |
| Framed board, product card language | `s0-before-1440x900.png` | `s0-after-1440x900.png` | Edge-to-edge cards on bare ground become a bordered, shadowed frame headed "Pipeline · 8 roles · demo data"; column titles drop from 22 px to an 11 px tracked label with a stage dot; every card gains its stage rail and a fit pill. |
| Invitation as centre of gravity | `s0-before-1440x900.png` | `s0-after-1440x900.png` | The ask stops floating at the window's bottom edge (half-clipped, competing with the Offer column) and sits centred on the board with a paper glow, a navy primary, and the privacy line on its own rule. |
| Collapse → designed pill | `s0-before-pill-1440x900.png` | `s0-after-pill-1440x900.png` | A plain paper button in the window corner becomes a navy pill carrying the mark, docked inside the frame's bottom-right. |
| 390 px layout | `s0-before-390x844.png` | `s0-after-390x844.png` | The fixed invitation stopped slicing the cards mid-scroll: the frame is a column, the ask is first and full-width, the board is one column, and both actions are reachable without scrolling. |
| 390 px, collapsed | `s0-before-pill-390x844.png` | `s0-after-pill-390x844.png` | The pill moves from a floating window-corner chip to the top of the frame, above the board it re-enters from. |

## 4. Floor results — PASTED output

```
$ npm test
ℹ tests 2608
ℹ suites 630
ℹ pass 2607
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6480.135583
EXIT:0
```

```
$ npm run lint:repo
> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
lint EXIT:0
```

```
$ npm run typecheck:repo
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

typecheck EXIT:0
```

```
$ npm run test:contract:all
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js

> command-center@0.1.0 test:pipeline-update-contract
> node scripts/test-pipeline-update-contract.mjs

OK schema (pipeline-update request): examples/pipeline-update-request.v1.json

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
contract EXIT:0
```

Not required of this lane (they are Q1's), but run because V1 changes surfaces
they assert — both green, so Q1 inherits a clean base:

```
$ npm run test:e2e-smoke     →  6 passed (5.3s)      EXIT:0
$ npm run test:e2e-journey   →  7 passed (13.4s)     EXIT:0
```

Full logs: `.lane-evidence/floor-npm-test.txt`, `floor-lint.txt`,
`floor-typecheck.txt`, `floor-contract.txt`, `e2e-smoke.txt`, `e2e-journey.txt`.

## 5. Anything unverified, and decisions the orchestrator should adjudicate

1. **Spec §4 conflict — the collapse no longer persists across the session.**
   Spec §4 says the pill "persists across the session"; the V1 kickoff says the
   invitation is "never auto-collapsed" and requires a probe that the pill
   renders *only* after "Poke around first". Those cannot both hold. I followed
   the kickoff, because the persisted collapse is exactly what the U1 evidence
   shows (pill + empty viewport on a reload). Spec §4's sentence should be
   amended to "persists for the visit". **Not averaged**: the pill still opens
   the flow on click (spec §4 "reopens the flow"), unchanged.
2. **Kickoff phrase "a designed pill … that reopens it".** Read literally
   against the prototype, the pill would re-open the *invitation card*
   (`reopenInvite()` in the prototype's JS). I kept it opening the **flow**,
   because spec §4 states that explicitly and `tests/e2e-journey/
   critical-journey.spec.mjs` ("should collapse the invitation to a corner pill
   that still opens the flow") pins it from outside my fence. If the orchestrator
   wants the prototype's two-step behaviour, it is a three-line change in
   `buildPill()` plus that e2e test — route it.
3. **Score label changed from `94 fit` to `94% fit`** (prototype form). Not a
   spec §4/§5 normative string; the `aria-label` is unchanged. Flagging it
   because it is user-visible text.
4. **`eslint .` lints `.lane-evidence/`** — the directory the ground rules tell
   every lane to use for scratch. Two throwaway browser-diagnostic scripts I
   wrote there failed `lint:repo` with `no-undef` on `document` /
   `getComputedStyle`; I deleted them and lint is green, but the next lane that
   leaves a scratch `.mjs` there will hit the same wall. Fix is one `ignores`
   entry in `eslint.config.mjs` — **outside my fence**, not touched.
5. **`evidence/s0-as-shipped-emilio.png` is not in the repo.** The kickoff says
   to open it beside the prototype; `docs/programs/sixbeats-20260902/evidence/`
   contains only the two markdown files (`*.png` is gitignored repo-wide). I
   worked from my own before-capture of the same cold start instead, which is
   what `.lane-evidence/s0-before-*.png` is.
6. **Not verified: real fonts.** The screenshots render Geist / Caveat /
   JetBrains Mono from `vendor/fonts`, as the app ships them. No check was made
   against a machine where those fail to load; the stacks all carry system
   fallbacks.
7. **Not verified: Safari / Firefox.** Screenshots and computed-style checks are
   Chromium-only (the repo's Playwright browser). `color-mix()` is not used in
   the new rules; `clamp()`, `min()`, sticky, and grid `auto-fit` are all
   already used elsewhere in the shipped CSS.
8. **U2 overlap left alone.** The flow shell's double step-rail and its header
   polish are V2's claim and V2's fence (`ONEFLOW:CORE`); nothing in this lane
   touches them.
