# Role Dossier redesign package — 2026-09-17

A frontend-designer-ready redesign of JobBored's Role Dossier. **Specs, plans and mocks only** — no
production dossier CSS or JS is changed by this pass.

Trigger: the dogfood report of 2026-09-17. Opening a role (3E · AI & Marketing Analytics Manager) to
read the posting and request materials lands you in a three-column board that "clips all over."

---

## Read in this order

| | Document | What it is |
| --- | --- | --- |
| 1 | **[TEARDOWN.md](TEARDOWN.md)** | Why three columns fail, measured. Starts with the finding that the layout does not overflow — it crushes. |
| 2 | **[SPEC.md](SPEC.md)** | The redesign, normative. IA, layout, interaction, twelve states, responsive rules, accessibility, acceptance criteria. |
| 3 | **[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)** | 27-component inventory, the frozen contracts, six migration phases, test impact, risk register. |
| 4 | **[mocks/index.html](mocks/index.html)** | Five high-fidelity mock pages. Open in a browser; toggle annotations. |

## The one-paragraph version

At every width the brief names (1280–1512), each of the three lanes gets **323px** of text measure,
and the materials row's status pill and buttons claim 309 of it — so the name column renders at
**12.3px** and "Cover letter" is shredded into **nine lines**. Nothing overflows, because
`minmax(0, 1fr)`, `min-width: 0` and `overflow-wrap: anywhere` between them guarantee the layout
always reports success. The breakpoint that would rescue it is a *viewport* media query at 1080px,
so the shipped dossier is correct at 1024px and broken at 1440px. The frame is also 104px narrower
than the pipeline above it, because the shell's gutter token contains a percentage that re-resolves
against a nested ancestor and subtracts the gutter twice — while 324px of a 1440px viewport sits
empty. The replacement is a **reading canvas** (34–46rem, prose only) beside a **bounded ledger**
(20–22rem, widgets only), under a **sticky docket** that carries stage, the drafting actions and the
live run — with every threshold a container query and every track carrying a floor in `rem`.

## Before / after

| | Shipped | Redesigned |
| --- | --- | --- |
| Materials rows at the same scale | <img alt="Cover letter shredded into nine lines" src="screenshots/before-materials-rows-default.png" width="330" /> | <img alt="Five materials states, all legible at 352px" src="screenshots/after-materials-rows.png" width="330" /> |
| Full dossier at 1440 | <img alt="Shipped three-column dossier" src="screenshots/before-default-1440.png" width="330" /> | <img alt="Redesigned canvas and ledger" src="screenshots/after-default-1440.png" width="330" /> |

Scrolled, with the docket still in reach — impossible in the shipped layout, whose frame is a scroll
container:

<img alt="Redesigned dossier scrolled, docket parked under the app chrome" src="screenshots/after-scrolled-1440.png" width="720" />

## Mocks

| Page | Shows |
| --- | --- |
| [`01-default.html`](mocks/01-default.html) | Filled role at 1440 and 1280, with the eleven annotated decisions |
| [`02-scrolled.html`](mocks/02-scrolled.html) | Scrolled, sticky docket engaged |
| [`03-materials-request.html`](mocks/03-materials-request.html) | In flight, failed, and all five row states at the real 352px ledger width |
| [`04-narrow.html`](mocks/04-narrow.html) | 1024 / 900 / 720 / 390 |
| [`05-states.html`](mocks/05-states.html) | No role open · loading · no resume · scrape failed · unverified parse · rejected |

Add `?annotate=1` to any page for the annotated view.

`mocks/dossier-redesign.css` is the proposal, written production-shaped with real JobBored tokens and
the class names in SPEC — meant to be lifted rather than retyped. `mocks/dossier-mock.js` mirrors
`role-case.js`'s string-template idiom so its functions map one-to-one onto the ones that change.

## Audit

The evidence is reproducible, and it is the same check the mocks have to pass.

```bash
# Measure the shipped 3-column dossier. Loads production CSS + the production
# renderer, walks every element in .case at 1024/1280/1440/1512.
node docs/redesign/dossier-2026-09/audit/measure.mjs

# Run the same audit against the mocks, plus a mid-word shredding detector,
# and capture the after screenshots.
node docs/redesign/dossier-2026-09/audit/shoot-mocks.mjs
```

Current results: [`audit/RESULTS.json`](audit/RESULTS.json) (shipped) and
[`audit/MOCK-AUDIT.json`](audit/MOCK-AUDIT.json) (proposal — clean at every audited width).
See [`audit/README.md`](audit/README.md) for what each field means.

The harness is worth keeping past this redesign: a jsdom test cannot see a 12px grid track, which is
why 166 existing dossier assertions all passed while the surface was unusable.
[IMPLEMENTATION-PLAN §5](IMPLEMENTATION-PLAN.md#5-test-impact) proposes promoting it to a Playwright
regression test alongside Phase 2.
