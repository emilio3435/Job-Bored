# Role Dossier — UX/UI redesign spec

**Date** 2026-09-17 · **Status** proposal, for a frontend designer to implement
**Replaces** the three-column `.case__board` in `role-case.js` / `role-case.css`
**Why** [`TEARDOWN.md`](TEARDOWN.md) · **Mocks** [`mocks/`](mocks/) · **Plan** [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md)

This spec is normative. Where it says MUST, a review should reject a change that does not do it;
where it says SHOULD, a reasoned deviation is fine. Every layout number is stated in `rem` so it
tracks the user's font size, and every threshold is a container query.

---

## 1. What the dossier is for

A user opens a role from the pipeline to do five things, in this order:

1. **Orient** — is this still live, where am I in it, what is the deadline.
2. **Judge** — how do I match this, and what is weak.
3. **Read** — what the posting actually asks for.
4. **Act** — request a cover letter or a tailored resume, move the stage, log a contact, set a
   follow-up, write a note.
5. **Recall** — what has already happened on this role.

The shipped layout maps 2, 3 and 4 onto three columns rendered side by side, which treats three
sequential phases of one task as three parallel views and pays the full width cost for all three at
all times. The redesign keeps the same information and re-orders it into one narrative with a
persistent action surface.

**Scope note.** This is a layout, hierarchy and state spec. It introduces **no new data sources**:
every value below already exists in the model `role-case-model.js` builds. §4 is the only genuinely
new *content*, and it is derived from fields the model already carries.

---

## 2. Information architecture

Source order, which is also DOM order, tab order, and the single-column reading order:

```
DOSSIER (frame)
├── A  Masthead ................ identity. Who, what, where, the posting's facts, the link to it.
├── B  Verdict ................. one derived sentence + 2–5 metric tiles.
├── C  Docket (sticky) ......... stage stepper · in-flight run · role actions · close.
├── D  Banner (conditional) .... unverified parse, scrape failure, terminal notice.
├── E  Body
│   ├── Canvas (prose) ......... what you read.
│   │   ├── 1  In their words ... the posting's one-liner.
│   │   ├── 2  They want ....... requirements · stack · nice to have.
│   │   ├── 3  You have ........ strengths · evidence · gaps · scorecard.
│   │   ├── 4  Say this ........ talking points.
│   │   └── 5  Notes ........... yours.
│   └── Ledger (widgets) ....... what you check and change.
│       ├── 6  Materials ....... one row per deliverable, every state.
│       ├── 7  People .......... next move · contact · replied · follow-up.
│       └── 8  The record ...... vertical timeline · freshness stamp.
```

Three rules decide what goes where, and they are the reason the ledger can be 320px wide without
repeating the shipped bug:

- **The canvas holds prose.** Anything that is sentences gets a reading measure and nothing else.
- **The ledger holds bounded widgets.** Anything that is a row, a bar, a pill or a field goes here,
  and every one of them is designed and audited at 320px.
- **The docket holds anything the reader might want while looking at something else.**

At single-column widths the ledger follows the canvas in source order. It is never reordered
visually, so tab order and reading order agree at every width (WCAG 1.3.2, 2.4.3).

### Why the ledger is on the right and not the left

The canvas is the longer read and the left column is where the eye starts, so prose gets the
primary position. The counter-argument — that this repeats the shipped mistake of putting materials
in the last column — is answered by the docket: the primary materials actions and the live run
status are in a bar that never leaves the viewport, so the reader never has to *find* the ledger to
act. Materials is also first in the ledger, so it sits top-right, adjacent to the verdict.

---

## 3. Layout

### 3.1 Frame

```css
.dossier {
  container-type: inline-size;
  container-name: dossier;
  width: min(1220px, 100%);
  margin-inline: auto;
  clip-path: inset(0 round 14px);   /* NOT overflow: hidden */
}
```

- The frame MUST be `min(1220px, 100%)` — the same maximum every other flow region resolves to — and
  MUST NOT size itself from `--jb-flow-content-width`. That token contains a percentage that
  re-resolves against the nested containing block and subtracts the shell gutter twice
  (TEARDOWN §4).
- The frame MUST NOT set `overflow: hidden` / `auto` / `scroll`. Doing so makes it a scroll container
  and silently disables `position: sticky` for the docket (TEARDOWN §5). Use `clip-path` for the
  radius, which clips without creating a scrollport.
- `container-type: inline-size` makes the frame the query container. Note that an element cannot
  respond to its own container query, so the body's column rule lives in a
  `@container dossier (...)` block and is written on `.dossier__body`.

### 3.2 Body — the two tracks

```css
.dossier__body { display: grid; grid-template-columns: minmax(0, 1fr); }

@container dossier (inline-size >= 62rem) {
  .dossier__body {
    grid-template-columns:
      minmax(34rem, 46rem)   /* canvas: floor 544px, cap 736px */
      minmax(20rem, 22rem);  /* ledger: floor 320px, cap 352px */
    justify-content: center;
    align-items: start;
  }
}
```

Four properties of this rule set, each of which is a fix:

1. **Both tracks are bounded.** `minmax(0, 1fr)` is BANNED as a track in any multi-track row that
   carries text. A zero floor is what let the shipped board render a 12px column. The single
   exception: a track whose sole child is an explicit scroller (`overflow-x: auto`) with a visible
   edge affordance may use it, because that child's overflow is reachable by design. In this
   dossier that is exactly one place — the stepper track in the docket.
2. **The threshold is arithmetic, not taste**, and the arithmetic includes the frame's own gutter:

   | | |
   | --- | --- |
   | canvas floor | 34.00rem |
   | ledger floor | 20.00rem |
   | widest column gap | 2.75rem |
   | gutter × 2 | 4.50rem |
   | **engage at** | **62rem** (992px) |

   Leaving the gutter out of this sum is its own bug: it produces a two-column grid whose tracks are
   wider than the box they sit in, which does not report as element overflow — grid simply overflows
   the padding box and the frame's `clip-path` eats it. `audit/shoot-mocks.mjs` checks the track sum
   against the content box for exactly this reason. So the layout is never in a state where a track
   is narrower than the width its contents were designed for: either both floors fit, or there is
   one column.
3. **It is a container query.** The dossier's width is a function of the frame it sits in, not the
   window. A viewport media query is why the shipped board is correct at 1024 and broken at 1440.
4. **Surplus becomes margin.** `justify-content: center` means extra width past the two maxima is
   whitespace, not longer lines. Prose has a measure; a wider window must not make it harder to read.

Measured result: frame 1220 / canvas 736 / ledger 352 at both 1440 and 1280 viewports.

### 3.3 Track floors for every internal component

Any component with more than one horizontal track MUST name a floor. The set in use:

| Component | Tracks | Wrap behaviour below floor |
| --- | --- | --- |
| Masthead | `3.5rem / minmax(18rem,1fr) / minmax(14rem,19rem)` | flags drop to their own row |
| Metric tiles | `repeat(auto-fit, minmax(10rem, 1fr))` | tiles reflow to a new row |
| Requirement row | `0.75rem / minmax(12rem,1fr) / auto` | status word drops under the text |
| Score bar | `minmax(6rem,9rem) / minmax(4rem,1fr) / 2.25rem` | label moves above the bar |
| Talking point | `1.6rem / minmax(0,1fr)` | n/a — the index is fixed and tiny |
| Material row | `minmax(8rem,1fr) / auto` in a 3-row area grid | every area stacks |
| Ledger field row | single column, label above value | n/a |
| Record event | `1rem / minmax(0,1fr)` | n/a |

`repeat(auto-fit, minmax(…, 1fr))` is the required idiom for any collection whose count is
data-driven. `repeat(var(--n), minmax(0, 1fr))` — the shipped metric-tile rule — makes every tile
narrower each time one is added, and MUST NOT be used.

### 3.4 Materials row — the specific fix

The shipped row is `minmax(0, 1fr) auto auto`: name, status, buttons on one line. Both `auto`
tracks are nowrap and cannot shrink, so they take the name's width (TEARDOWN §2).

The replacement never puts the label and the buttons on the same line:

```css
.dossier__doc {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) auto;
  grid-template-areas:
    "name  state"
    "meta  meta"
    "acts  acts";
}
@container ledger (inline-size < 15rem) {
  .dossier__doc { grid-template-columns: minmax(0, 1fr); grid-template-areas: "name" "state" "meta" "acts"; }
}
```

Two more requirements on this row:

- **The name MUST NOT set `overflow-wrap: anywhere`.** A label that cannot fit must widen its row or
  wrap on a word boundary. Breaking mid-word is not a graceful degradation; it is the tell that the
  layout has already failed, and allowing it is what hides the failure.
- **The state pill carries one word; the sentence goes in the meta line.** `ready`, `queued`,
  `drafting`, `failed`, `not drafted`. The humane copy the shipped pill carries — "couldn't
  finish" — is 15 nowrap characters in the most width-constrained slot on the page. Same words,
  better place: *"The drafting worker stopped responding before the letter was written. Nothing was
  saved."* in the meta line, which has the whole row.

### 3.5 The record

One row per event, vertical rail. The shipped `grid-auto-flow: column` with
`grid-auto-columns: minmax(0, 1fr)` divides a fixed width by a data-driven N, so every event added
narrows all of them. A timeline MUST NOT be laid out on an axis whose track count comes from data.

### 3.6 Decoration yields before content

Where a row must give up width, the decorative parts go first. The stepper is the worked example:
the connector rules are the only shrinkable items in the row (`flex: 0 1 22px; min-width: 8px`),
giving 5 × 14px of slack before the row scrolls. A stage label is never half-cut to make room for a
rule.

---

## 4. The verdict line (new)

The dossier currently has no lede. The reader must assemble "how am I doing and what next" by
comparing three columns. One sentence at the top does that work.

**It introduces no new data.** Three slots, filled from the existing model, in this order:

| Slot | Source | Copy |
| --- | --- | --- |
| STANDING | `numbers.fit`, plus requirement match counts from `theyWant.requirements[].status` | `Strong fit` ≥ 8/10 · `Solid fit` 6–7 · `Mixed fit` 4–5 · `Weak fit` ≤ 3 · `Fit N of 10` when there is no match data — then `— N of M requirements matched, K keywords missing` |
| GAP | `moves.materials[].status` | `Resume is ready; the cover letter has not been drafted.` / `The cover letter is being written now.` / `The cover letter failed twice; the resume is ready.` / `Nothing drafted yet.` |
| NEXT | `identity.closesInDays`, `nextAction.daysUntil`, `stage.daysInStage` | the single most urgent of: `Closes in N days` · `Follow-up overdue by N days` · `Day N in researching` — one clause only |

Fallback ladder, so the line is never empty and never bluffs:

1. Enrichment loading → `Reading the posting. The fit read and the requirement list land in a few seconds.`
2. No resume on file → STANDING from fit alone + `Add a resume to see which of the N requirements you actually answer.`
3. Scrape failed → STANDING from fit alone + `The posting could not be read, so everything below the fold is the sheet's own data.`
4. Terminal stage → `Rejected <date>, N days after applying.` + what is still on file.

The GAP clause is set in italic crimson — it is the only emphasis in the sentence, and it is always
the thing the reader can do something about.

---

## 5. Interaction model

### 5.1 The docket

Sticky, `top: var(--dsr-chrome-h)`, which the host app sets to its own chrome height. It MUST park
flush beneath the chrome: any gap is a slot the page scrolls through, which reads as a rendering
fault.

Contents, left to right: the stage stepper · the in-flight materials run (when there is one) · the
role actions · close.

- **Stage stepper.** A horizontal scroller with `scroll-snap-type: x proximity` and a
  `mask-image` edge fade so "there is more" is visible. The current step MUST be scrolled into view
  on render. Semantics: `role="group" aria-label="Stage"`, `aria-current="step"` on the live step,
  and every button labelled with what pressing it does (`Move to Applied`) rather than just the
  stage name. Terminal stages collapse the stepper to a single chip.
- **Actions.** `Draft cover letter` (primary) · `Tailor resume` · `×` close. When a run is in flight
  the `Draft cover letter` button is replaced by the in-flight chip, so the same request cannot be
  issued twice from the same surface. On a terminal role the drafting actions are removed entirely.
- **`View posting` lives in the masthead, not here.** It is a navigation affordance that belongs with
  "via Google Jobs · found · posted", not with the controls that change this role. Keeping it out of
  the docket is also what makes six stage labels fit: it is ~125px, which is the difference between
  the whole funnel being visible at a 1220px frame and the last stage scrolling out of view.
- **In-flight chip.** `Drafting cover letter · 1m 07s` with a spinner, `role="status"
  aria-live="polite"`. On failure it becomes `Cover letter failed · retry` in crimson. This is the
  fix for materials state having two disagreeing homes: the docket chip and the ledger row render
  from the same manifest, and the global Materials Queue overlay stays what it is — the *cross-role*
  queue — rather than being the only place a reader can see what is happening to the role in front
  of them.
- **`close-role` MUST be rendered.** It is wired in `role.js` today and no control emits it.

### 5.2 Inline editing

The frozen contract is preserved exactly: `data-action="edit-field"` + `data-field`, commit on blur
and Enter, revert on Escape, `data-original` as the baseline, `data-value` for the segmented
control, and the transient `saved` mark keyed by write kind.

One change, for the truncation in TEARDOWN §7: **identity fields are display-then-edit, not
permanent inputs.**

- Default: the title is wrapping text (`<h2>`), with a dotted underline on hover/focus.
- Activation (click, Enter, or Space): swaps to a field sized to its box, value selected.
- Commit/cancel: as today; the display re-renders with the new value.

`role.js`'s keydown wiring already accepts `INPUT` and `TEXTAREA`, so a `<textarea rows="1">` with
`field-sizing: content` is an acceptable lower-risk variant of the same idea — the requirement is
that **a long title is fully readable without horizontal scrolling inside a control**, not the
specific mechanism.

Ledger fields put the label above the value so the value gets the row's full width. A nowrap mono
label beside a `width: 60%` input is what truncates a 31-character contact name today.

### 5.3 Scroll and focus

- Every focusable in the body and every section MUST carry
  `scroll-margin-top: calc(var(--dsr-chrome-h) + 68px)` so the sticky docket never covers the target
  of a focus move or an in-page jump.
- The existing focus-survival behaviour in `role.js` (record the focused control's identity
  attributes, re-focus its replacement after the innerHTML swap) MUST be preserved; the new markup
  keeps the same `data-*` identity attributes.
- The metric tiles that are buttons (`Keywords` → profile match) keep `data-action`; static tiles are
  `<div>`s inside `<li>`s and are not focusable.

---

## 6. States

Every state answers three questions: what is true, why, and what can I do. A blank column answers
none of them.

| # | State | Trigger | Presentation |
| --- | --- | --- | --- |
| 1 | **No role open** | no `openRole` | The shelf. Part number, invitation, two hints, a CTA back to the pipeline. Kept from production. |
| 2 | **Loading** | `enrichment.status === "loading"` | Verdict says `Reading the posting.` The *waiting section only* carries the skeleton, with `aria-busy="true" role="status" aria-live="polite"` and a readable line ("Reading the posting…"). Sections that are already known are not blanked. |
| 3 | **No resume** | no keyword data and no scorecard | "You have" is an invitation with the action attached, not an empty lane. Requirements still render, marked `unknown`, and the status column shows `—` rather than a colour with no meaning. |
| 4 | **Scrape / enrichment failed** | error payload | An error banner above the read: cause, consequence, and two ways out (`Paste the description`, `Try the scrape again`). Mirrors the server's own `{ error, code, detail, nextStep, retryable }` shape — `detail` becomes the sentence, `nextStep` becomes the button. |
| 5 | **Unverified parse** | `provenance.needsReview` | A warn banner above the read, not only a 7.5px chip beside a lane title. The reader is told before they act on a requirement list nobody verified. The chip stays as a secondary marker. |
| 6 | **Terminal** | `stage.terminal` | Stepper collapses to the terminal chip; drafting actions are removed; the verdict says what is still on file. The record keeps everything. |
| 7 | **Materials: not drafted** | no document, no run | `not drafted` pill (dashed), meta `Never requested`, `Draft` button where a draft action exists. Rows for undraftable deliverables say what produces them (`Written with the resume`) instead of offering a dead button. |
| 8 | **Materials: queued** | `phase === "queued"` | `queued` pill, `waiting in queue · 0m 04s`, a sentence saying nothing is required of the user, indeterminate track, `Cancel`. |
| 9 | **Materials: drafting** | any other non-terminal phase | `drafting` pill, `drafting in progress · 1m 07s` (+ `· retry N` only when N > 1), the worker's message, indeterminate track, `Cancel`. Also mirrored in the docket. |
| 10 | **Materials: ready** | `status === "ready"` | `ready` pill, `Drafted <date> · N files`, `Preview` + `Download PDF`. |
| 11 | **Materials: failed** | `phase === "failed"` | `failed` pill, `Stopped after 1m 07s · attempt 2`, the reason as a sentence, `Try again` + `Dismiss`. A failure MUST always offer both a retry and a way to clear it. |
| 12 | **Saved** | `jb:write:succeeded` | The transient `saved` mark, `role="status" aria-live="polite"`, cleared after 1.6s, re-painted after a re-render so a render mid-fade cannot swallow it. Unchanged from production. |

States 1–6 are mocked in [`mocks/05-states.html`](mocks/05-states.html); 7–11 in
[`mocks/03-materials-request.html`](mocks/03-materials-request.html).

---

## 7. Responsive rules

All thresholds are container queries. `dossier` = the frame; `canvas` and `ledger` = the two tracks.

| Container | Threshold | Behaviour |
| --- | --- | --- |
| `dossier` | `>= 62rem` (992px) | Two columns: canvas `34–46rem`, ledger `20–22rem`, tracks centred. |
| `dossier` | `< 62rem` | One column. Ledger follows the canvas in source order. Docket stays sticky. |
| `dossier` | `>= 52rem` | Docket is one row (stepper left, actions right). |
| `dossier` | `< 52rem` | Docket is two rows; the stepper keeps full width. |
| `dossier` | `>= 46rem` | Masthead is three columns (crest / identity / flags). |
| `dossier` | `< 46rem` | Masthead flags wrap to their own row under the identity. |
| `canvas` | `< 22rem` | Requirement status word drops under the text. |
| `canvas` | `< 20rem` | Score bar label moves above the bar. |
| `ledger` | `< 15rem` | Material row stacks all four areas. |

Metric tiles need no threshold: `auto-fit` reflows them.

The frame's gutter and the column gap are sized in `cqi`, not `vw`, so the space available to the
tracks is a function of the frame rather than the window — otherwise the threshold above cannot be
computed at all.

Verified widths (viewport → frame): 1560→1220, 1400→1220, **1100→1024** (the tightest two-column
case, 32px above the threshold, both tracks at their floors), 1000→900, 800→720, 470→390. All clean
in [`audit/MOCK-AUDIT.json`](audit/MOCK-AUDIT.json).

**No viewport media query may be used for dossier layout.** The only acceptable media queries are
`prefers-reduced-motion` and `forced-colors`.

---

## 8. Accessibility

### 8.1 Structure

- The role identity MUST be a **visible** `<h2>`. Today the dossier's only `h2` is visually hidden,
  so the heading rotor and H-key navigation return an empty list for a surface that is entirely
  headings-shaped.
- Each section is `<section aria-labelledby>` with a visible `<h3>`. Sections whose title is carried
  by other means (Notes) get a visually hidden `<h3>`.
- The ledger is `<aside aria-label="Role ledger">`; the docket is
  `<div role="group" aria-label="Role docket">`.
- Posting facts are a `<dl>`; the people block is a `<dl>`. They are label/value pairs and should say
  so.

### 8.2 Type floor

`--dsr-label: 10px` is a floor, not a default: **no text in the dossier goes below 10px**, and
anything carrying state a user must read (a status word, a provenance source, a date) is 11px.
The shipped file has 23 declarations under 10px and 21 under 9.5px, all uppercase and tracked at
0.16–0.22em — the least legible combination available. Tracking above 0.18em is reserved for
section titles at 11px.

### 8.3 Contrast

Keep the corrections already in `role-case.css` and make them tokens rather than local overrides:

- `--mint-ink: #3F6B55` for any mint on a light ground (`#6E9F87` is 2.81:1 on parchment).
- `--mute: #5A5347` inside the dossier (the global `--mute` is 4.34:1 and carries most labels).
- `--amber-ink: #A16207` for amber text on light (raw `--amber` is decorative only).

Status MUST NOT be colour-only: every mark is a dot **plus** a word (`found` / `partial` /
`missing`), and every state pill contains its state as text.

### 8.4 Targets and focus

- Interactive targets are ≥ 44×44 where layout allows; where a chip must stay 28–30px tall, the
  target is grown with an `::after` inset that does not move the ink (the pattern the shipped Replied
  chips use), and spacing is ≥ 8px to satisfy the AA 24px exception.
- Every focusable has a visible `:focus-visible` ring: 2px, 2px offset, `--navy` on light and
  `--amber` on the navy masthead. `outline: none` MUST NOT appear in dossier CSS — in the shipped
  file it sits at specificity (0,4,1) on the edit surfaces and beats the app's own focus rule, so a
  1px dashed underline is the only focus signal on the masthead.
- Focus order equals DOM order equals visual order at every width, because the grid never reorders.

### 8.5 Live regions and motion

- Materials progress, the docket in-flight chip and the saved marks are `role="status"
  aria-live="polite"`. Skeletons pair `aria-busy="true"` with `role="status"` and a readable line —
  `aria-busy` alone announces nothing.
- Errors are `role="alert"`; warnings are `role="status"`.
- Decorative provenance chips are `aria-hidden="true"` and their words are folded into the owning
  element's `aria-label`, so a reader does not hear ~10 stray tokens per dossier.
- `prefers-reduced-motion: reduce` disables the shimmer, the indeterminate track and the spinner.
- `forced-colors: active` restores borders on tinted surfaces and uses system colours for the bars.

---

## 9. Visual language

JobBored's own newsprint system, unchanged. The redesign is a layout and hierarchy change, not a
repaint: every colour token below is the value already in `style.css`.

- **Palette** navy `#1B2A4E` · parchment `#FBF7EC` / `#F5EFDC` · surface `#FFFEF9` · lines `#E5DFCC`
  / `#C9C2A8` · mint `#B5D4C2` / `#6E9F87` / `#3F6B55` · amber `#E7B549` / `#A16207` · crimson
  `#B23A48`.
- **Type** Lora (serif) for anything read as prose — the lede, requirements, strengths, evidence,
  talking points, values. DM Sans for UI. JetBrains Mono for labels, eyebrows and numerics, always
  uppercase and tracked. Special Elite for the notes textarea only.
- **The masthead is the only dark surface.** It is what makes the dossier read as a document with a
  cover rather than a dashboard panel.
- **Newspaper furniture, kept**: mono eyebrows, the `NOTES · YOURS` tab on the notes block, dotted
  hairlines between ledger rows, the 2px coloured section rule (crimson for what they want, mint for
  what you have, amber for what you say, navy for materials).
- **Radii** 14px frame · 8–10px blocks · 999px pills · 3–4px chips. **Shadow** one, soft, navy-tinted;
  the sticky docket adds a second only when stuck.

The three additions, all layout tokens: `--dsr-canvas-min/max`, `--dsr-ledger-min/max`,
`--dsr-chrome-h`. Everything else is existing.

---

## 10. Acceptance criteria

A reviewer can check all of these mechanically.

1. `node docs/redesign/dossier-2026-09/audit/measure.mjs` reports **0** self-overflow findings and
   **0** column bleed at 1024 / 1280 / 1440 / 1512 for every fixture variant.
2. No label anywhere in the dossier renders over 3 lines at fewer than 6 characters per line (the
   shredding detector in `audit/shoot-mocks.mjs`).
3. `getComputedStyle(frame).overflowX === "visible"` and
   `getComputedStyle(docket).position === "sticky"`.
4. The dossier frame width equals the pipeline region width at the same viewport.
5. No `minmax(0, 1fr)` in a multi-track row that carries text, except the docket's stepper track;
   no `repeat(var(--n), …)`; no viewport media query except `prefers-reduced-motion` and
   `forced-colors`; no `vw` in a dossier length.
6. No `font-size` below `10px`; no `outline: none` without an accompanying `:focus-visible` rule.
7. The role title renders in full at 1280 for a 57-character posting title, with no clipped input.
8. Every state in §6 renders with a cause and at least one action; no state is a blank region.
9. Axe: no violations. Heading order h2 → h3 with a visible h2. Tab order matches DOM order at 1440,
   900 and 390.
10. All frozen `data-action` / `data-field` / `data-value` / `data-doc` / `data-feature` /
    `[data-mount="materials"]` contracts still resolve — see the inventory in
    [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) §3.
