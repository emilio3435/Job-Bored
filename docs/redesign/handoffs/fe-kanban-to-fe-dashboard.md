# Handoff: fe-kanban → fe-dashboard

**Run:** `redesign-20260424T0742Z`
**From:** fe-kanban lane
**To:** fe-dashboard lane

## Ask

Add two font-family tokens to `:root` in `style.css` (+ corresponding Google Fonts entries in `index.html`):

```css
:root {
  --font-display: "Fraunces", "Lora", Georgia, serif;
  --font-typewriter: "Special Elite", "Courier Prime", "Courier New", monospace;
}
```

In `index.html` replace the current Google Fonts `<link>` with one that includes `Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..900` and `Special+Elite`.

## Why

`docs/redesign/DESIGN-SYSTEM.md` (JobBored newsprint zone) calls for:
- **Display**: Fraunces (variable, opsz, italic available) — used on kanban card titles and lane mastheads.
- **Typewriter**: Special Elite — reserved for JobBored zone, used on kanban stage-age chips, digest badges, and masthead items.

Neither font is currently loaded (`index.html` ships DM Sans + JetBrains Mono + Lora + Source Sans 3) and neither token is defined in `:root`. Per the run rules I only edit `:root` tokens via this lane handoff.

## Non-blocking fallback (already in place)

The fe-kanban lane uses `var(--font-display, Georgia, serif)` and `var(--font-typewriter, "Courier New", monospace)` so the card still renders readably without the tokens. When fe-dashboard lands the tokens, the card instantly upgrades to the correct typefaces — no second pass required.

## Impact

- Global: every lane that wants Fraunces / Special Elite will lean on the same tokens.
- Bundle: adds ~2 Google Fonts requests. Preconnect is already in place.
