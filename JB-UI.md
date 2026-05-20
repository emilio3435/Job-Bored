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
| `<jb-spark>` | Forge-2a | SVG sparkline with last-point dot | decorative; `img` if labeled |
| `<jb-stage-dot>` | Forge-2b | 8px circle + halo, optional label | `status` if labeled, else `img` |
| `<jb-ai-chip>` | Forge-2b | Pill chip with leading glyph + slotted text | `note` |
| `<jb-kbd>` | Forge-2b | Inline keycap chips with `·` separators | `group` |
| `.jb-sticker` | Forge-2c | Paper card primitive (CSS class only) | none (semantic via host) |

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

## `<jb-spark>`

SVG sparkline with translucent area fill and a filled dot at the last point.

### Attributes

| Attr | Type | Default | Notes |
|---|---|---|---|
| `data` | csv or JSON array | required | `"1,2,3,5"` or `"[1,2,3,5]"`. Non-numeric values dropped. |
| `width` | px | `60` | |
| `height` | px | `16` | |
| `color` | token name | `mint` | Resolves to `var(--jb-{name})`. e.g. `mint`, `amber`, `navy`, `ink-3`, `mint-deep`. |
| `fill` | `true \| false` | `true` | Translucent area path under the line. |
| `label` | string | (none) | Sets `aria-label` and removes `aria-hidden="true"`. |

### A11y

Decorative by default (`aria-hidden="true"`). When `label` is set, host gets `role="img"` + `aria-label`.

### Edge cases

- Empty / missing data → flat baseline polyline (does not crash).
- Single point → centered dot only (does not crash).
- All zeros → flat midline (no division by zero).

### Example

```html
<jb-spark data="1,2,1,5,3,7,8" color="mint"></jb-spark>
<jb-spark data="[3,5,4,6,7,9,8,10]" width="120" height="28" color="mint" fill="false"></jb-spark>
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

## `<jb-kbd>`

Inline keyboard hint. Splits `keys` on `+`, renders each token as a small mono chip joined by `·`.

### Attributes

| Attr | Type | Default | Notes |
|---|---|---|---|
| `keys` | string | required | `"cmd+shift+p"`, `"ctrl+enter"`, `"esc"`, `"?"`. |

Pretty-printing: `cmd → ⌘`, `shift → ⇧`, `alt/option → ⌥`, `ctrl → ⌃`, `esc → Esc`, `enter/return → Enter`, `tab → Tab`, `space → Space`, arrow names → `↑↓←→`. Single letters uppercase (`k → K`).

### A11y

`role="group"`, `aria-label="cmd plus shift plus p"`.

### Example

```html
<jb-kbd keys="cmd+k"></jb-kbd>
<jb-kbd keys="cmd+shift+p"></jb-kbd>
<jb-kbd keys="esc"></jb-kbd>
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

## Hard rules (Phase 2 contract)

1. Every selector is scoped under `body.jb-v2`. Bare selectors are forbidden.
2. No raw hex codes anywhere. CI lint (`tools/lint-tokens.mjs`) enforces.
3. Outside the v2 flag, every custom element collapses to `display: none`.
4. No external deps, no fetch, no localStorage, no globals.
5. No `Caveat` font on UI chips, buttons, or body. Caveat is reserved for `h1`, `h2`, and `.jb-handwritten`.
6. Bundle budget: `jb-ui.js` ≤ 12000 bytes minified, `jb-ui.css` ≤ 6000 bytes minified. Verified by `tools/check-jb-ui-budget.mjs`.

## Tooling

| Script | Purpose |
|---|---|
| `node tools/lint-tokens.mjs --paths jb-ui.css jb-ui.demo.html` | Raw-hex linter; must exit 0. |
| `node tools/check-jb-ui-budget.mjs` | Minified-byte budget check on jb-ui.{js,css}. |
| `node tools/audit-jb-ui-a11y.mjs` | Static a11y attribute checker for jb-ui.demo.html. |

## Manual a11y checklist (per component)

For each component, manually verify in a real browser before signing off a Phase-3 consumer:

- **`<jb-fit-ring>`** — host carries `role="meter"`, `aria-valuenow` updates on attr change, screen reader announces "Fit {n}%". Visible focus ring when reachable via tab from a parent button.
- **`<jb-spark>`** — decorative by default; with `label`, screen reader announces the label.
- **`<jb-stage-dot>`** — when label is present, `role="status"` + announce stage.
- **`<jb-ai-chip>`** — `role="note"`, `aria-label` includes "AI:" prefix and slot text.
- **`<jb-kbd>`** — `aria-label` reads keys as "cmd plus shift plus p". Color contrast on chip border vs paper passes AA.
- **`.jb-sticker`** — focus-within triggers visible elevation; `--selected` outline AA-contrasts against paper. Skeleton shimmer pauses under `prefers-reduced-motion`.
