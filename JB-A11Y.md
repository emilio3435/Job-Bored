# JB-A11Y.md — JobBored accessibility primitives (T0 / lane P0-F)

**Owner:** lane P0-F (T0 program), reconciled onto the repair base by lane R1.
**Status:** shipped standalone; consumed by fit-profile-wizard.js. Lanes R2 (lattice stage menu),
R3 (scribe announcements) and R4 (discovery drawer, Mark-submitted confirm gate) adopt it next —
on the reconciliation branch those are the lanes that were P0-A / P0-E / P0-B+P0-D under T0.

**Reconciliation note (lane R1).** This file replaced a same-named F3-D primitive that exposed a
flat API (`createOverlayOwner`, `announceToast`, `labelFitProfileControl`, `createMoveToAction`)
and had zero production consumers. Two things survived from it and are documented in place below:
the 320/375/393 phone breakpoints plus the `env(keyboard-inset-bottom, …)` handling in
`jb-a11y.css`, re-expressed on the live `.jb-a11y-*` selectors, and the shared fixture
`tests/fixtures/phone-geometry.json`.
**Scope:** one classic-defer script (`jb-a11y.js`) exposing `window.JobBoredA11y`, plus its
stylesheet (`jb-a11y.css`). The API surface is LOCKED by `T0-SUBSTRATE.md` §2 — additions are
allowed, reshapes are not.

Sibling of `JB-UI.md`. The rules there (no raw hex, `--jb-*` tokens, `block__element` naming,
`data-*` for state) apply here too — with one deliberate divergence, documented below.

---

## Loading

```html
<link rel="stylesheet" href="tokens-v2.css">
<link rel="stylesheet" href="jb-a11y.css">
...
<script src="jb-a11y.js" defer></script>   <!-- EARLY: before jb-ui.js -->
```

`jb-a11y.js` is a **classic global IIFE, not an ES module.** The dashboard has no build step;
`index.html` loads ~70 `defer` scripts in a deliberate order. A single top-level `export` makes the
browser parse-fail the *entire* file silently — `jb-ui.js:472-474` carries the same warning. Attach
to `window.JobBoredA11y`, never `export`.

It must load **before every consumer** (jb-ui.js at index.html:224 is the safe upper bound; the
wizard/modal consumers start at :1578). It reads nothing at load time, so an early position is free.

### Feature-detect at the call site

Consumers must never assume the script is present, and must never cache the global at load time:

```js
function a11y() {
  return typeof window !== "undefined" ? window.JobBoredA11y : null;
}
// ...later, at invocation:
var api = a11y();
if (api && api.dialog) handle = api.dialog.open(root, { opener: opener });
```

---

## Why this file is not v2-scoped

`jb-ui.css` scopes every component under `body.jb-v2` and ships a
`body:not(.jb-v2) { display: none }` kill-switch. **`jb-a11y.css` deliberately does NOT do that.**

The surfaces these primitives serve — the settings modal, the first-run wizard, the onboarding
wizard, the fit-profile wizard — render in the **legacy** view, without the v2 flag. That is the
user path the accessibility audit actually walked. Scoping this file under `body.jb-v2` would make
every dialog invisible exactly where it matters most.

Consequence: `.jb-a11y-*` class names are global. They are prefixed and specific for that reason.
`tests/jb-a11y-move-to-stage.test.mjs` and `tests/jb-a11y-dialog-containment.test.mjs` both pin the
absence of `body.jb-v2` in these two files — that pin is the guardrail, not an accident.

Both files are NEW so the `tools/check-jb-ui-budget.mjs` budgets (jb-ui.js ≤ 12000 B, jb-ui.css
≤ 6000 B minified) are untouched. `tools/lint-tokens.mjs` DOES scan `jb-*.css`, so jb-a11y.css
contains no raw hex.

---

## API at a glance

| Member | Returns | Writes anything? |
|---|---|---|
| `dialog.open(el, opts)` | `{ close(reason?), el }` | no |
| `dialog.confirm(spec)` | `Promise<{confirmed, values}>` | no |
| `drawer.open(el, opts)` | `{ close(reason?), el }` | no (adds/removes `detail-open` body class) |
| `live.announce(msg, opts)` | `void` | no |
| `toast(msg, type?, opts?)` | `dismissFn` | no (delegates to `host().showToast`) |
| `tabs.init(root, opts)` | `{ activate, getActive, destroy }` | no |
| `field.associate(label, control)` | `void` | no |
| `field.build(opts)` | `{ wrap, input }` | no |
| `stageMenu.attach(card, opts)` | `detach()` | **only via the injected `commitMove`** |

The primitive holds **no state that outlives a call**, performs **no I/O**, and never touches
`updateJobStatus`, `job.status`, `getPipelineData()`, Sheets, `localStorage`, or the `jb:*` write
bus. Its only outbound events are the two observability events below.

---

## `dialog`

### `dialog.open(el, opts) -> handle`

| Opt | Type | Default | Notes |
|---|---|---|---|
| `opener` | `Element` | `document.activeElement` | Captured at open. Focus returns here on close. |
| `initialFocus` | `Element \| string` | first focusable inside `el` | A string is resolved with `el.querySelector`. |
| `label` | `string` | — | Applied as `aria-label` **only** if `el` has no `aria-label`/`aria-labelledby`/`title`. |
| `onClose` | `(reason) => void` | — | `reason` is `'escape'` or `'programmatic'`. |

Handle: `{ close(reason?), el }`. `close()` is idempotent.

Behavior:

- Sets `role="dialog"` and `aria-modal="true"` **only when absent** — markup that declares
  `role="alertdialog"` or its own `aria-labelledby` keeps it.
- **Inerts everything except the dialog's ancestor path.** Walking up from the dialog (rather than
  only inerting `<body>`'s children, as `settings-modal.js:49-67` did) keeps a dialog nested inside
  a wrapper correctly contained.
- Nodes that were **already** inert are left alone, and are not un-inerted on close. Someone else
  owns them.
- **LIFO stack.** Opening a second dialog re-scans and inerts the first. Closing the top one hands
  control back. Closing a *background* dialog out of order repairs the stack and leaves the visible
  dialog live.
- Escape closes the **top of the stack only**. The document keydown listener is attached when the
  stack becomes non-empty and removed when it drains — no listener leak.
- Focus restore uses `focus({ preventScroll: true })` and is **skipped when the user has moved on**:
  the opener is only re-focused if `document.activeElement` is still inside the closing dialog (or
  is `<body>`). Closing a background dialog must not yank focus out of the dialog the user is in.
- An opener that has been re-rendered away is tolerated (`document.contains` guard); focus is
  best-effort and never throws.

**Call `open()` after the element is visible.** `focus()` is a no-op on a `display: none` node.
Flip your own visibility (class, style, `data-active`) first, then open.

### `dialog.confirm(spec) -> Promise<{confirmed, values}>`

```js
const { confirmed, values } = await JobBoredA11y.dialog.confirm({
  title: "Mark as submitted?",
  body: "This writes the applied date to your sheet.",
  confirmLabel: "Mark submitted",
  fields: [{ id: "confirmationNumber", label: "Confirmation number" }],
});
```

Builds its own markup (via `field.build` for each `fields` entry), opens it through `dialog.open`,
removes it from the document once settled. `values` is keyed by each field's `id` (falling back to
`name`, then the generated control id).

**Escape and Cancel both resolve `{ confirmed: false }` and still return what the user typed.**
An Escape is never read as consent to a write, and a cancel never silently discards a draft.

### `drawer.open(el, opts) -> handle`

Identical contract, plus it adds `detail-open` to `<body>` on open and removes it on close —
the class `discovery-drawer.js` already relies on. A stuck `detail-open` freezes page scroll, so
the removal is part of the contract, not a nicety.

### Events (observability only)

```
jb:a11y:dialog:opened   { el, depth }
jb:a11y:dialog:closed   { el, depth, reason }
```

Dispatched on **both `window` and `document`**, matching the convention
`AGENT_CONTRACT.md` states for every `jb:*` event family. **No write behavior may depend on them.**
`depth` is the stack position the dialog occupied (1 = outermost).

---

## `live` and `toast`

### `live.announce(message, { assertive = false })`

Two singleton visually-hidden regions, injected **on first use** (never at script load):

| Kind | Attributes |
|---|---|
| polite | `role="status" aria-live="polite" aria-atomic="true"` |
| assertive | `role="alert" aria-live="assertive" aria-atomic="true"` |

The markup recipe is promoted verbatim from `lattice.js buildLive` (:693-706). Both carry
`.jb-a11y-visually-hidden`, which clips rather than hides — `display: none` or `[hidden]` would
remove the node from the accessibility tree and silence the announcement entirely.

Identical repeats inside ~150ms are dropped; a different message always announces immediately.
Empty and non-string messages are ignored rather than used to blank the region.

### `toast(message, type?, opts?) -> dismissFn`

Calls `host().showToast(message, type, persistent, action)` — resolved **lazily at invocation** —
and **ALWAYS** mirrors the message into `live.announce`, assertively when `type === "error"`.

The mirror is unconditional on purpose: `#toastContainer` (index.html:1566) has no `aria-live` and
no `role`, so the announcement *is* the accessible channel until the integrator's one-attribute
edit lands. If the visual renderer is missing or throws, the announcement still happens and the
caller's write path is not broken; the returned dismiss function is then a safe no-op.

### ⚠️ Double-announce rule (read this before wiring a surface)

Three toast systems and two ad-hoc live regions already exist:

| Surface | Its own live region |
|---|---|
| lattice.js | `#jb-lat-live` (:693-706) |
| pipeline.js | `pipe-toast` (:1593-1608) |
| auth-session.js `showToast` | none — `#toastContainer` is silent |

**A surface that already owns an `aria-live` node must NOT also route the same message through
`live.announce`.** Doing so speaks it twice. Pick one per message:

- Migrating a surface → replace its local `announce()` with `live.announce` and delete the local
  region.
- Keeping the local region for now → call `host().showToast` directly, not `JobBoredA11y.toast`.
- New surfaces → use `JobBoredA11y.toast` and add no region of your own.

`stageMenu` announces through `live.announce` itself, so a board adopting it must stop announcing
the same move locally.

---

## `tabs.init(root, { tabs, onChange }) -> { activate, getActive, destroy }`

WAI-ARIA tablist, generalized from `settings-tabs.js` (:44-133) — the pattern
`discovery-drawer.js` (:1257-1315) had already hand-copied.

```js
const tabs = JobBoredA11y.tabs.init(modal, {
  tabs: [
    { id: "setup", buttonId: "settingsTabSetup", panelId: "settingsPanelSetup" },
    { id: "ai",    buttonId: "settingsTabAi",    panelId: "settingsPanelAi" },
  ],
  onChange: (id) => console.log("now on", id),
});
```

- Sets `role="tab"` on buttons and `role="tabpanel"` + `aria-labelledby` on panels when absent.
- Roving tabindex: the active tab is `0`, the rest `-1` — the tablist is one tab stop.
- Arrow Left/Right/Up/Down wrap; Home/End jump. Switching moves focus to the new tab.
- The initial activation is **silent** (no focus steal) — this is called while a modal is opening.
- `onChange` fires for the initial activation and every switch. `destroy()` unbinds.

---

## `field`

### `field.associate(labelEl, controlEl)`

Picks the right association, which is the point:

| Target | What it gets |
|---|---|
| `input` / `select` / `textarea` / `button` / `meter` / `output` / `progress` | `label[for]` ↔ `control.id` (id minted if missing) |
| anything else (chip inputs, radio groups, composite widgets) | `aria-labelledby` → label id, plus `role="group"` if the target has no role |

`for=` pointed at a `<div>` is dead markup: it reviews clean and announces nothing. An existing
`aria-label` / `aria-labelledby` / `title` on the target is never overwritten. Missing arguments
are a safe no-op.

### `field.build(opts) -> { wrap, input }`

Option shape matches `wizard-dom.js appendWizardInput` (:92-126) so wizard code migrates
mechanically: `{ label, id?, hint?, multiline?, type?, value?, rows?, placeholder?, onInput? }`.

- ids are generated when not supplied, and are unique per build.
- `multiline: true` produces a `<textarea>`.
- `hint` renders a `.jb-a11y-field__hint` and attaches it via `aria-describedby` — programmatically,
  not just visually adjacent.
- `onInput` receives the value as a string.

---

## `stageMenu.attach(cardEl, opts) -> detach()`

The explicit, visible, keyboard- and touch-operable answer to MOBILE-01. Before it, the only ways
to move a card on the v2 board were drag-and-drop and an undiscoverable `meta+Arrow` chord
(`lattice.js:798-809`).

```js
const detach = JobBoredA11y.stageMenu.attach(cardEl, {
  stages: JobBoredStages.list(),        // [{ key, label }, ...]
  current: job.status,
  jobKey: job.stableKey,
  getLabel: (key) => JobBoredStages.label(key),   // optional
  commitMove: (jobKey, toStage, fromStage) => setStage(dataIndex, toStage, fromStage),
});
```

Renders inside the card:

```html
<div class="jb-a11y-stage-menu">
  <button type="button"
          class="jb-a11y-stage-menu__trigger jb-a11y-touch-target"
          data-action="move-to-stage"
          data-current-stage="Researching"
          aria-haspopup="menu" aria-expanded="false" aria-controls="…"
          aria-label="Move to stage — currently Researching">Move to stage</button>
  <div class="jb-a11y-stage-menu__list" role="menu" hidden>
    <button type="button" role="menuitem" data-stage="Applied"
            class="jb-a11y-stage-menu__item jb-a11y-touch-target"
            style="--jb-a11y-stage-color: var(--jb-stage-applied)">Applied</button>
    …
  </div>
</div>
```

- The current stage is **not** offered as a destination.
- Item colours come from `--jb-stage-*`. An **unrecognised** stage renders neutral
  (`var(--jb-ink-3)`) rather than borrowing another stage's colour — unknown must never be shown as
  a confident value. The only token-name divergence from the stage vocabulary is
  `Phone Screen → --jb-stage-phone`.
- Keyboard: click/Enter opens and focuses the first item; Arrow Up/Down wrap; Home/End jump;
  Escape closes and returns focus to the trigger. Roving tabindex keeps the menu one tab stop.
- `attach` is **idempotent per card** (boards re-render constantly) and does not steal focus.
  `detach()` removes the control and its listeners.

### The `commitMove` seam — non-negotiable

`commitMove(jobKey, toStage, fromStage) -> Promise<boolean>` is **injected**. `fromStage` is
threaded explicitly for the reason `lattice.js:905-915` documents: an optimistic mutation destroys
the readable previous status, and the Discovered → Researching auto-draft trigger depends on it.

On select the primitive announces `"Moved to X"` optimistically, then:

- resolves `true` → the trigger's reported current stage updates,
- resolves `false` **or rejects** → the trigger reverts to the ORIGINAL stage and it announces
  `"Move failed; reverted to Y"` **assertively**.

A failed move never leaves the control reporting the optimistic value — that would render unknown
as confirmed.

**With no `commitMove` supplied, `attach` renders nothing at all.** A dead button that silently
does nothing is worse than no button.

This seam exists so the parallel repair program (F1-A transition writer, canonical-ownership gate)
can rebind the writer at the call sites it owns with **zero changes inside jb-a11y.js**. If this
primitive wrote directly it would become a fifth writer those gates have to chase.

---

## CSS surface

| Class | Purpose |
|---|---|
| `.jb-a11y-visually-hidden` | Clip-based hiding for live regions (never `display:none`) |
| `.jb-a11y-touch-target` | `min-height: 2.75rem; min-width: 2.75rem` — the 44px floor |
| `.jb-a11y-dialog`, `__panel`, `__title`, `__body`, `__actions`, `__btn` | `dialog.confirm` surface |
| `.jb-a11y-field`, `__label`, `__control`, `__hint` | `field.build` output |
| `.jb-a11y-stage-menu`, `__trigger`, `__list`, `__item` | `stageMenu` output |

`2.75rem` matches `style.css:1681`, the repo's only prior 44px rule. `min-width` matters as much as
`min-height`: an icon-only button is commonly 44px tall and 16px wide, which fails the same
guideline. Coarse pointers get `3rem`. Focus styling reuses `var(--jb-shadow-focus)` everywhere.
`prefers-reduced-motion: reduce` drops the transitions.

---

## Verification status — what is proven, and where

This is the honest split. **Nothing in the "needs browser" column is claimed green by `npm test`.**

| Claim | How it is verified today | Where |
|---|---|---|
| `role`/`aria-modal`/`aria-label` applied without clobbering | vm-simulated (real source, hand-rolled DOM) | `jb-a11y-dialog-behavior.test.mjs` |
| `.inert` set on the background and released on close | vm-simulated | `jb-a11y-dialog-behavior.test.mjs` |
| already-inert nodes are not stolen | vm-simulated | `jb-a11y-dialog-behavior.test.mjs` |
| opener captured; `focus({preventScroll:true})` on close | vm-simulated | `jb-a11y-dialog-behavior.test.mjs` |
| Escape → close; listener removed when the stack drains | vm-simulated | `jb-a11y-dialog-behavior.test.mjs` |
| stacked dialog inerts its parent; re-scan covers late nodes | vm-simulated | `jb-a11y-dialog-stacking.test.mjs` |
| closing B restores focus INTO A; interleaved close repairs the stack | vm-simulated | `jb-a11y-dialog-stacking.test.mjs` |
| `detail-open` added/removed by `drawer` | vm-simulated | `jb-a11y-dialog-behavior.test.mjs` |
| live regions injected with the right ARIA; debounce | vm-simulated | `jb-a11y-toast-announcement.test.mjs` |
| `toast` always announces; host bridge called lazily; survives a throw | vm-simulated | `jb-a11y-toast-announcement.test.mjs` |
| no load-time `host()` read; no ES `export` | **source-pinned** | `jb-a11y-toast-announcement.test.mjs` |
| `field.build` / `associate` pairing (incl. composites) | vm-simulated | `jb-a11y-fit-profile-labels.test.mjs` |
| every `fp-field__label` associated (count pin) | **source-pinned** | `jb-a11y-fit-profile-labels.test.mjs` |
| fit-profile adoption of `dialog.open` + handle close | **source-pinned** | `jb-a11y-dialog-containment.test.mjs` |
| discovery-drawer still has no inert/restore (open gap) | **source-pinned (today's truth)** | `jb-a11y-dialog-containment.test.mjs` |
| stage menu markup, ARIA, keyboard, `commitMove` contract, revert copy | vm-simulated | `jb-a11y-move-to-stage.test.mjs` |
| primitive is not a writer (no `updateJobStatus`, no I/O) | **source-pinned** | `jb-a11y-move-to-stage.test.mjs` |
| 2.75rem floor declared; no raw hex; not v2-scoped | **CSS-pinned** | `jb-a11y-move-to-stage.test.mjs` |
| `tabs` ARIA, roving tabindex, keyboard, destroy | vm-simulated | `jb-a11y-dialog-behavior.test.mjs` |
| `dialog.confirm` resolution, Escape-as-cancel, cleanup | vm-simulated | `jb-a11y-dialog-behavior.test.mjs` |

### ⚠️ NEEDS BROWSER VERIFICATION — not proven by any test in this repo

The hand-rolled DOM (`tests/fixtures/jb-a11y-dom.mjs`) executes the real module but is not a user
agent. It records that `focus()` was called and that `.inert` was assigned; it cannot enforce what a
browser does with them. These remain **UNVERIFIED** until an e2e-smoke / manual `/browse` pass
covers them:

1. A real user agent honours `inert` — pointer, Tab order, and the accessibility tree.
2. **Tab cannot escape an open dialog.** The primitive relies on `inert` for containment rather
   than a wrap-around Tab trap; that is correct per spec but is a browser behavior, untested here.
3. `:focus-visible` actually paints `--jb-shadow-focus` at every focus stop.
4. A screen reader speaks the live regions, and polite/assertive ordering is as intended.
5. Touch targets really measure ≥ 44 CSS px after the cascade, and the stage menu is reachable and
   operable at mobile viewport widths.
6. `prefers-reduced-motion`, `pointer: coarse` and the 320/375/393 phone breakpoints resolve as
   written, and `env(keyboard-inset-bottom, var(--jb-keyboard-inset, 0px))` actually clears a real
   soft keyboard. The recorded insets in `tests/fixtures/phone-geometry.json` are fixtures for the
   hermetic harness, NOT real-device proof.
7. The stage menu opens within the card's scroll/overflow context on a real board (it is
   `position: absolute` inside the card).

---

## Integration surface (integrator-owned; this lane does not edit these)

- `index.html` — ALREADY SATISFIED on the reconciliation base: the stylesheet is at :209 and the
  script at :226. Those slots sit *after* `jb-ui.js` rather than before it, which the T0 lane had
  asked for; the order is inert (neither file references the other, and every consumer loads
  later), so the slots stay where they are rather than churning the file. Still open: add
  `role="status" aria-live="polite"` to `#toastContainer`.
- `auth-session.js` — one feature-detected line in `showToast` mirroring into
  `JobBoredA11y.live.announce`.
- `package.json` — add `node --check jb-a11y.js` to the `typecheck:repo` allowlist chain.
- `AGENT_CONTRACT.md` — rows for the `jb:a11y:dialog:*` event family.

Exact hunks with anchor lines are in
`evidence/t0/p0-f/LANE-REPORT-p0-f.md` § "Hand-off recipes".

---

## Deliberately out of scope this phase

`settings-modal.js`, `first-run-wizard.js` and `onboarding-wizard.js` keep their own focus wiring.
`tests/wizards-modal-a11y-focus.test.mjs` regex-pins their internal identifiers
(`settingsLastOpener`, `applyFirstRunInertBackground`, …); migrating them to this primitive requires
updating those pins in the same commit. That is the F3-D follow-up, tracked, not forgotten.
