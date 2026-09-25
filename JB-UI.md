# JB-UI.md — JobBored v2 component reference (Forge / Phase 2)

**Owner:** Forge (components agent)
**Status:** Phase 2 shipped. Dawn / Lattice / Scribe / Welcome may consume these primitives in Phase 3.
**Scope:** Five vanilla custom elements (registered by `jb-ui.js`) plus one CSS-only primitive (`.jb-sticker`). All are scoped under `body.jb-v2`; outside the flag every element collapses to `display: none`.

## Loading

```html
<link rel="stylesheet" href="tokens-v2.css">
<link rel="stylesheet" href="jb-v2.css">
<link rel="stylesheet" href="jb-ui.css">
<script type="module" src="jb-ui.js"></script>
```

`jb-ui.js` is an ESM module that self-registers all five custom elements via `customElements.define`. No bundler required. All components use light DOM (no shadow root) so the `body.jb-v2` cascade reaches contents and Phase 3 agents can style without piercing.

## Components at a glance

| Element / class | Owner | Renders | A11y role |
|---|---|---|---|
| `<jb-fit-ring>` | Forge-2a | Conic-gradient ring with center number | `meter` |
| `<jb-stage-dot>` | Forge-2b | 8px circle + halo, optional label | `status` if labeled, else `img` |
| `<jb-ai-chip>` | Forge-2b | Pill chip with leading glyph + slotted text | `note` |
| `.jb-sticker` | Forge-2c | Paper card primitive (CSS class only) | none (semantic via host) |
| `.jb-btn` · `.jb-chip` · `.jb-field` · `.jb-banner` · `.jb-toast` | UX01 C3 | The component kit (CSS classes only) | native (`button`, `label`, `role="alert"`/`"status"`) |

---

## `<jb-fit-ring>`

Conic-gradient role-fit ring. Crisper than SVG arcs at small sizes.

### Attributes

| Attr | Type | Default | Notes |
|---|---|---|---|
| `percent` | `0..100` | required | Out-of-range values clamp. Reactive. |
| `size` | `sm \| md \| lg` | `md` | sm=24px, md=36px, lg=56px. |
| `label` | string | derived | Overrides center text. Default text = `{percent}%`. Updates `aria-label` on the host. |

Tier color (the conic ring stroke):
- `≥ 75` → `var(--jb-fit-high)`
- `≥ 50` → `var(--jb-fit-mid)`
- `< 50` → `var(--jb-fit-low)`

### Slots / events

None. No events.

### A11y

`role="meter"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow="{percent}"`, `aria-label="Fit {percent}%"` (or attr `label`).

### Example

```html
<jb-fit-ring percent="78" size="md"></jb-fit-ring>
<jb-fit-ring percent="92" size="lg" label="A+"></jb-fit-ring>
```

---

## `<jb-stage-dot>`

8px stage indicator with a soft 18% alpha halo (per stage color) and an optional label.

### Attributes

| Attr | Type | Default | Notes |
|---|---|---|---|
| `stage` | enum | required | One of `new \| researching \| applied \| phone \| interviewing \| offer \| rejected \| passed`. Unknown → `var(--jb-ink-3)` fallback. |
| `label` | string | (none) | Renders next to the dot in body font weight 500. |

If `label` is omitted but the element has slotted text content, the slotted text is used as the label.

### A11y

- Without label → `role="img"` + `aria-label="Stage: {stage}"`.
- With label → `role="status"` + `aria-label="Stage: {stage}"`.

### Example

```html
<jb-stage-dot stage="applied" label="Applied"></jb-stage-dot>
<jb-stage-dot stage="interviewing"></jb-stage-dot>
```

---

## `<jb-ai-chip>`

Pill chip used to surface AI-generated content. Violet by default; warn variant uses amber.

### Attributes

| Attr | Type | Default | Notes |
|---|---|---|---|
| `variant` | `default \| summary \| tip \| warn` | `default` | Modulates background tint and leading glyph. |
| `icon` | string | (per variant) | Override the leading glyph. |

Default glyphs: `default → ✦`, `summary → ❝`, `tip → ☼`, `warn → ⚠`.

### Slots

The chip's children become the body text. Children are wrapped once (on connect) into `.jb-ai-chip__text` and an icon span is prepended. Re-rendering does not blow away children.

### A11y

`role="note"`, `aria-label="AI: {textContent}"` (set on connect and on attribute change).

### Example

```html
<jb-ai-chip variant="default">Strong fit on backend systems</jb-ai-chip>
<jb-ai-chip variant="warn">Posting older than 30 days</jb-ai-chip>
<jb-ai-chip variant="tip" icon="★">Tailor your resume to ICs</jb-ai-chip>
```

---

## `.jb-sticker` (CSS-only primitive)

Signature paper-sticker card. The visual anchor of the v2 design language. Pure CSS — no JS.

### Markup

```html
<article class="jb-sticker" data-tape>
  <header class="jb-sticker__head">…</header>
  <div class="jb-sticker__body">…</div>
  <footer class="jb-sticker__foot">…</footer>
</article>
```

### Variants and modifiers

| Hook | Effect |
|---|---|
| `data-tape` | Renders a 56×14 yellow washi-tape strip at top-left, rotated -3deg. |
| `data-tape="long"` | Widens the strip to 88×14. |
| `.jb-sticker--selected` | 2px navy outline, 4px outline-offset, pencil shadow promoted. |
| `.jb-sticker--muted` | Opacity 0.7, no shadow, no hover lift. For archived / passed rows. |
| `aria-busy="true"` | Shimmer skeleton placeholder; respects `prefers-reduced-motion`. |
| `--sticker-padding` (custom prop) | Override default `18px 20px`. |

### Behavior

- Default shadow `var(--jb-shadow-sticker)`.
- Hover / `:focus-within` shadow `var(--jb-shadow-pencil)`.
- Hover transform `translate(-1px, -1px)` for the "lifted off paper" feel.
- Footer separated by `1px dashed var(--jb-line-soft)`.

### Composition

Stickers compose freely with the custom elements:

```html
<article class="jb-sticker" data-tape>
  <header class="jb-sticker__head">
    <h3>Senior Backend Engineer</h3>
    <jb-fit-ring percent="78" size="md" style="margin-left:auto;"></jb-fit-ring>
  </header>
  <div class="jb-sticker__body">
    <jb-ai-chip variant="default">Strong fit on async systems</jb-ai-chip>
    <jb-stage-dot stage="applied" label="Applied"></jb-stage-dot>
  </div>
</article>
```

### Gotchas

- Tape sits at `top: -7px` and overhangs the host. A parent with `overflow: hidden` will clip it.
- `:focus-within` triggers the pencil shadow — intentional for keyboard nav. For single-selection groups, prefer the explicit `.jb-sticker--selected` class.
- Skeleton state hides children via `visibility: hidden`; nested interactives are visually inert but still focusable. Pair with `inert` if needed.

---

## Component kit (UX01 C3)

One button, one chip, one field, one banner and one toast replace the 72 button styles, 28 pill families and 11 input looks the design-system audit counted (DS-05, DS-18, DS-19). Every class is a single class (specificity 0,1,0) and is not scoped under `body.jb-v2`, so the kit works in both views and a surface can adjust it with a rule scoped under its own root (`.pipe-tool .jb-btn`, 0,2,0). Values come from `tokens-v2.css` only.

Migrating a surface: add the kit class next to the old one, delete the old class's colour, border, radius and type declarations, and keep every `data-action`, `data-stable-key` and `id` exactly as it was. Each lane migrates the surfaces it owns.

### `.jb-btn`

| class | use |
|---|---|
| `.jb-btn.jb-btn--primary` | The one main action on a view or dialog. Navy fill (`--jb-action`), paper text (`--jb-on-action`). |
| `.jb-btn.jb-btn--accent` | A positive side action such as "Run search". Mint fill, navy text (`--jb-on-accent`, 6.0:1). |
| `.jb-btn.jb-btn--secondary` | Cancel, Back, Retry. Paper fill, navy text, `--jb-line` border. |
| `.jb-btn.jb-btn--ghost` | Low-weight actions such as Snooze. |
| `.jb-btn.jb-btn--icon` | Square icon button; always give it an `aria-label`. |
| `.jb-btn.jb-btn--danger` | Destructive actions. Red text, never a red fill. |
| `.jb-btn--sm` | 32 px tall instead of 36 px. |

```html
<button class="jb-btn jb-btn--primary" type="button" data-action="save-job">Save to Pipeline</button>
<button class="jb-btn jb-btn--secondary jb-btn--sm" type="button">Cancel</button>
<button class="jb-btn jb-btn--icon" type="button" aria-label="Settings"><svg aria-hidden="true">…</svg></button>
```

`:disabled` and `aria-disabled="true"` fade to 50%. Focus is the shared ring (`--jb-shadow-focus`, 12:1). A dialog's confirm button is always `--primary`, never a pale mint (TA-20).

### `.jb-chip[data-tone]`

Status is carried by `data-tone`, not by a colour class: `ok`, `warn`, `err`, `info`, `miss` (outlined, for "missing"). A stage chip takes `data-stage="researching|applied|phone|interviewing|offer|rejected|passed|expired"` and draws the stage dot from the stage tokens.

```html
<span class="jb-chip" data-tone="ok">Ready</span>
<span class="jb-chip" data-tone="warn">Review · 1 flag</span>
<span class="jb-chip" data-stage="researching">Researching</span>
```

Chips are labels: 11 px mono caps is allowed here because a chip is never a sentence.

### `.jb-field`, `.jb-input`, `.jb-select`

```html
<label class="jb-field">
  <span>Company <small>optional</small></span>
  <input class="jb-input" type="text" name="company" />
</label>
<p class="jb-field__hint">Shown on the card.</p>
<p class="jb-field__error" id="company-error">Add a company name.</p>
```

Warm paper, `--jb-line` border, 10 px radius, and the focus ring on `:focus-visible`. Set `aria-invalid="true"` (plus `aria-describedby` to the error) to turn the border red.

### `.jb-banner[data-tone]`

An inline state that stays on the page until it is resolved, with its own actions.

```html
<div class="jb-banner" data-tone="err" role="alert">
  <svg aria-hidden="true">…</svg>
  <p>Couldn't refresh from your Sheet. Showing what we had at 9:41.</p>
  <div class="jb-banner__acts"><button class="jb-btn jb-btn--secondary jb-btn--sm" type="button">Retry</button></div>
</div>
```

### `.jb-toast`

A navy slip for a short confirmation. **Every error toast carries an action** (Sign in, Retry, Open Settings → tab), and toast copy never points at "the console", "this build" or "modules" (SS-23). `data-tone="err"` or `"warn"` adds a coloured edge.

```html
<div class="jb-toast" role="status">
  <span class="jb-toast__message">Moved Canopy to Applied</span>
  <button type="button">Undo</button>
</div>
```

`showToast()` in `auth-session.js` still renders the legacy `.toast` markup; moving it onto `.jb-toast` and making `action` required for `type: "error"` is lane F's handoff.

### Type rules no longer trap classes (DS-10)

`jb-type.css` and the heading rules in `jb-v2.css` are scoped with `:where(body.jb-v2) h3` (specificity 0,0,1), so any class rule, such as `.settings-setup-block__title`, now sets its own size and weight. Surface CSS no longer needs an extra ancestor just to out-rank the type ramp.

---

## Hard rules (Phase 2 contract)

1. Every custom-element and `.jb-sticker` selector is scoped under `body.jb-v2`. The C3 kit classes (`.jb-btn`, `.jb-chip`, `.jb-field`, `.jb-input`, `.jb-select`, `.jb-banner`, `.jb-toast`) are the one exception: single-class, both views.
2. No raw colour literals anywhere; values live in `tokens-v2.css`. CI lint (`npm run lint:tokens`, inside `lint:repo`) enforces.
3. Outside the v2 flag, every custom element collapses to `display: none`.
4. No external deps, no fetch, no localStorage, no globals.
5. No `Caveat` font on UI chips, buttons, or body. Caveat is reserved for `h1`, `h2`, and `.jb-handwritten`.
6. Bundle budget: `jb-ui.js` ≤ 12000 bytes minified, `jb-ui.css` ≤ 6000 bytes minified. Verified by `tools/check-jb-ui-budget.mjs`. The C3 kit takes `jb-ui.css` to about 12 KB minified (2.7 KB gzipped); the budget in the tool has not been raised yet, and C4 retired `jb-spark` and `jb-kbd` (DS-20), which gave back about 1 KB. They had no caller; the real primitives are the ones listed above.

## Tooling

| Script | Purpose |
|---|---|
| `npm run lint:tokens` | Token linter over every linked sheet against `tools/lint-tokens.baseline.json`; must exit 0. |
| `node tools/check-jb-ui-budget.mjs` | Minified-byte budget check on jb-ui.{js,css}. |
| `node tools/audit-jb-ui-a11y.mjs` | Static a11y attribute checker for jb-ui.demo.html. |

## Manual a11y checklist (per component)

For each component, manually verify in a real browser before signing off a Phase-3 consumer:

- **`<jb-fit-ring>`** — host carries `role="meter"`, `aria-valuenow` updates on attr change, screen reader announces "Fit {n}%". Visible focus ring when reachable via tab from a parent button.
- **`<jb-stage-dot>`** — when label is present, `role="status"` + announce stage.
- **`<jb-ai-chip>`** — `role="note"`, `aria-label` includes "AI:" prefix and slot text.
- **`.jb-sticker`** — focus-within triggers visible elevation; `--selected` outline AA-contrasts against paper. Skeleton shimmer pauses under `prefers-reduced-motion`.
