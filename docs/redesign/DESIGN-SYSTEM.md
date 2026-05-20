# EmilioBuilds Homepage — Design Instructions

A recipe for recreating the homepage aesthetic. Read top to bottom; the system is cumulative.

---

## 1. Foundations

### Palette
Use these tokens verbatim. Neutrals set the mood; per-project colors are **zoned** — never mix them in the same surface.

**Paper & ink (global)**
- `--bg` `#f7f1e8` — warm paper, the default background
- `--surface` `#ffffff`
- `--ink` / `--brand-navy` `#023047` or `#093444`
- `--line` `#e5daca`
- `--brand-amber` `#ffb703` · `--brand-orange` `#fb8500`
- `--brand-sky` `#8ecae6` · `--brand-cerulean` `#219ebc`

**Elio zone** (cosmos) — `#8140c6` purple · `#12cfc9` teal · `#e32285` magenta
**Hormiga zone** (blueprint) — `#093444` navy · `#eb4d56` coral · `#7a8f5c` olive · `#f4d5c8` sand
**JobBored zone** (newsprint) — `#003851` navy · `#59cb89` green · `#ef8f26` orange · `#ece4d2` cream

Rule: if a card is Elio, the entire card lives in cosmos purple/teal/magenta. No cross-contamination.

### Type
- **Display** — Fraunces (variable, opsz). Weights 400–900, italic available. Use italic for emphasis inside headlines.
- **Body / UI** — Inter, 400–700
- **Mono** — JetBrains Mono. Used for eyebrows, tags, section labels, captions. Always uppercase, letter-spacing `0.22em`.
- **Typewriter** — Special Elite. **Reserved for JobBored only.** Do not sprinkle elsewhere.

### Type scale
- Hero headline: `clamp(42px, 6.8vw, 96px)`, Fraunces 500, `line-height 0.97`, `letter-spacing -0.035em`
- Section H2: `clamp(36px, 5vw, 64px)`, Fraunces 500, `letter-spacing -0.03em`
- Project H3 (feature): `clamp(40px, 5.5vw, 72px)`, Fraunces 900
- Lede / pull: `clamp(18px, 1.5vw, 22px)`, Fraunces **italic** 400
- Body: 15–17px Inter
- Eyebrow / label: 10–11px mono, uppercase, `0.22em` tracking

### Motion
Short list. No gratuitous easing.
- `pulse-ring` on live status dots (1.6–1.8s)
- `bob` — gentle Y-translate + tiny rotation on floating cards (6–8s)
- `orbit-spin` — 80–120s linear on dashed rings (reverse on inner ring)
- `marquee` — 40s linear on stack strip
- `scan` — vertical sweep on JobBored digest (3s)
- `walk` — the ant emoji, 7s, flips at midpoint
- Honor `prefers-reduced-motion: reduce` → kill all animation

---

## 2. Voice & copy rules

- **Lowercase confidence.** Mono labels are uppercase; prose is sentence case. No title-case headlines.
- **Italic for stance.** Fraunces italic carries the *opinion*: "Deep roots." "One revenue team." "for customers."
- **Short lines that snap.** Ledes max 38ch. Headlines break hard with `<br>`.
- **Section numbering.** `§ 01`, `§ 02` — editorial, not corporate.
- **Eyebrows are mono and double as metadata.** Example: `// white-label revenue platform · shipping since sep 2025`.
- Never use generic startup verbiage ("empowering", "solutions", "seamless"). Use *ship, sell, close, route, skip, kill*.

---

## 3. Layout grammar

- Max content width **1320px**, padded `clamp(20px, 4vw, 48px)` on both sides.
- Sections breathe: `clamp(72px, 9vw, 120px)` vertical. The hero and finale go larger (`clamp(80–140px)`).
- **Two-column editorial split** is the default: `minmax(0, 1.05fr) minmax(0, 1fr)` or `1.2fr 1fr`, gap ~60–80px. Collapse to one column at 900–960px.
- Hairline borders: `1px solid color-mix(in srgb, var(--brand-navy) 12%, transparent)`. Never pure black.
- Radii: cards 14–20px, pills 999px, small chips 4–6px.
- Shadows are **long and soft**: `0 24px 60px -30px color-mix(in srgb, var(--brand-navy) 30%, transparent)`. Never inset unless functional.

---

## 4. The Nav

- Sticky, `backdrop-filter: blur(12px)`, bg `color-mix(in srgb, var(--bg) 78%, transparent)`, hairline bottom border.
- Left: square navy monogram `E` (Fraunces italic black) + wordmark `Emilio builds` with italic second word.
- Right: 4 links in Inter 500 @ 14px + navy CTA pill `Let's talk →` (mono 11px uppercase).

---

## 5. The Hero (the signature move)

**Concept — "builder's constellation."** A portrait anchors center-right; three product cards orbit on dashed rings with small floating mono tags between them. This is *not* a generic SaaS split — it reads like a founder's wall of work.

**Editorial masthead strip** above everything: three mono items separated by dot, hairline underneath. `§ 00 · Index` / name · city / `Vol. 26 · Spring Issue`.

**Left column (copy)**
1. Eyebrow pill: pulse-ring red dot + `AI engineer · digital strategist · builder`
2. Huge Fraunces headline. Put the **noun** inside a highlight-marker span: skewed (-8deg), amber `opacity: 0.35`, 22% height, sits behind the text at 6% from bottom. The word `for` italicizes.
3. Italic Fraunces lede, max 38ch.
4. Two pills: solid navy + ghost.
5. Stat row — 3 columns, vertical hairline dividers, Fraunces 900 numbers above mono eyebrows.

**Right column (constellation) — aspect-ratio 1/1, max 560px**
- Two concentric dashed ellipses that spin at **80s** and **120s (reversed)**; a third solid thin circle sits static.
- 5 tiny node dots salted around the ring for stellar feel.
- Portrait: circle, `46%` width, centered, 2px navy border, 8px inner surface ring, amber glow bg. Small navy "The builder" pill under the chin.
- 3 **polaroid cards** (one per product): white surface, 14px radius, inner image tile uses the **project's gradient**, a mustard "tape" strip at top-center rotated -4deg. Each bobs at a different duration (6.5 / 7.2 / 7.8s) and delay, with unique rotation (-4/+5/-6deg).
- 3 floating mono pills: `ship/iterate`, `revenue-first`, `brand = product` — small rounded pills with their own bob timing.

**Rule for the constellation:** every element rotates slightly off-axis. Nothing is perpendicular. This is what makes it feel hand-arranged, not generated.

---

## 6. The Work section (§ 01) — bento trio

Layout: `1.35fr 1fr` grid, 20px gap. The Elio card spans **both columns** (feature row); Hormiga and JobBored sit side-by-side below.

### Section header (reusable pattern)
```
[§ 01] ————————— [THE WORK]
H2: "Three products. One builder."
italic lede: short.
```

### Elio card (wide feature)
- Background: cosmos — three radial gradients (purple/teal/magenta) layered on paper.
- Dotted sparkle overlay (`radial-gradient` 1px dots at scattered positions, opacity 0.6).
- Two-column inside: left = narrative, right = **launcher mock**.
- Headline uses text-gradient (linear 120deg teal → purple → magenta). Italic second line.
- Launcher mock: rounded white card with mono top/bottom bars ("LIVE" with pulse dot, "cmd+k to open · gcp · cloud run") and a 2×n grid of tool cells separated by 1px gutter. Each cell: glyph chip (colored tint), tool name (Inter 600 13.5px), 11.5px description.
- Proof strip below: 4-column metric row with text-gradient numbers, mono eyebrow labels, top hairline border.

### Hormiga card
- Blueprint bg: sand `#f4d5c8` with 32px grid lines in 6% navy.
- Headline: "Quiet work. / *Deep roots.*" — second line coral + italic.
- **Terminal widget**: navy bg, sand text, mac traffic-light dots (coral / olive / sand @ 0.7 opacity), header bar `colony · signal`. Each row is `62px 14px 1fr` grid: timestamp (pale), dot glyph (olive), actor bold coral + message.
- Walking ant emoji below with mono caption.

### JobBored card
- Newsprint bg: cream `#ece4d2` with 3px/4px repeating horizontal lines in 4% navy (subtle paper grain).
- **Masthead rule**: 3px solid top + 3px double bottom in navy, with 3 typewriter items between (title, Vol, price).
- Headline is Fraunces 900 **italic** with one word wrapped in a struck-through orange bar (5–6px, skewY -2deg, at 52% top).
- **Digest widget**: white with navy border, navy header bar "Today's digest · N scanned · N for you", animated green scanner sweep, list of rows divided by dashed hairlines. Matches get `rgba(89,203,137,0.1)` tint + `✓ MATCH` badge (green); boring rows get line-through + `× BORING` badge (orange).

---

## 7. What I Bring (§ 02) — dark inversion

- Full-bleed navy background. This is the *only* dark section — use sparingly; it creates pacing.
- 4-card 2×2 grid with a 1px hairline divider (achieved via `gap: 1px` on a lighter navy parent).
- Each card: mono amber number (01–04) → Fraunces 500 title → 15px muted body.
- Accent word in the section title italicized in amber.

---

## 8. About (§ 03)

Two-column: timeline left, workbench panel right. Dot-grid background (30px spacing, 7% navy, fade-masked top/bottom).

**Timeline** — dashed vertical rule on the left. Each entry has:
- 9px amber dot with 2px navy border, positioned -5px into the gutter
- Mono uppercase year
- Fraunces 500 role
- 14px body description, max 50ch

**Workbench panel** — white card, soft shadow, 16px radius
- Mono eyebrow `Workbench · the stack`
- Stack pills in 4px-radius chips (mono, 10.5px, subtle navy tint)
- Dashed internal divider, then `Currently` status list: green check = doing, coral × = not doing. Exact pattern: `✓ Taking on X` / `× Not doing generic wrappers`.

---

## 9. Stack Marquee

- Thin band between sections, hairline top and bottom.
- Fraunces **italic** 500, muted navy, 22–34px clamp.
- Amber `✦` star between each item.
- `mask-image: linear-gradient(90deg, transparent, black 10%, black 90%, transparent)` for feathered edges.
- 40s linear infinite. Triple the array to prevent visible seam.

---

## 10. Finale (§ 04) — CTA

- Centered, enormous. `clamp(52px, 8vw, 124px)` Fraunces with italic second line.
- Amber radial glow behind (900×900, blurred 60px, 22% opacity). Sets the warmth.
- Two pills centered: solid navy with email + ghost "Book a 20-min call".
- Footer row: hairline top, mono metadata left, three mono links right.

---

## 11. Do / Don't

**Do**
- Number sections with `§ 0N`
- Keep mono labels small, tracked (0.22em), uppercase
- Use `color-mix(in srgb, var(--brand-navy) N%, transparent)` for all translucency — no rgba hex-soup
- Let italic Fraunces carry emphasis. Never bold body text.
- Rotate hero elements off-axis (-6° to +5°)
- Zone per-project colors strictly

**Don't**
- Gradient backgrounds on full sections (except cosmos, which is purposeful)
- Emoji outside the ant and `✦` marquee star
- Rounded-corner cards with a left-border accent stripe (generic SaaS tell)
- Inter for headlines, Fraunces for UI — they have assigned roles
- Mix Special Elite outside JobBored
- Drop shadows with `rgba(0,0,0,...)`. Always blend from navy.

---

## 12. Component checklist

If you're porting this elsewhere, these are the reusable primitives:

| Component | Purpose |
|---|---|
| `Eyebrow` | mono · uppercase · 0.22em · optional leading hairline |
| `SectionHeader` | `§ NN` + kicker + large Fraunces H2 + italic lede |
| `ProjectTag` | mono pill with pulse-ring dot when live |
| `ProjectBtn` | solid or ghost rounded-pill, mono 11px uppercase |
| `Polaroid` | white card, tape strip, tilted, bobbing |
| `FloatTag` | small mono rounded pill, bobbing |
| `Timeline` | dashed rule + amber dots + Fraunces entries |
| `StatRow` | hairline-divided 3–4 col, Fraunces 900 numbers |
| `MonoHeaderBar` | widget top/bottom bars with LIVE + shortcut hint |

Stay disciplined about these and the page will feel coherent even when you add sections.

---

## JobBored application rules (added for redesign-20260424T0742Z)

When applying this system to the JobBored Command Center dashboard:

- **Zone:** the entire dashboard is **JobBored zone** (newsprint). Palette available:
  - cream `#ece4d2`, newsprint green `#59cb89`, orange `#ef8f26`, navy `#003851`
  - plus globals: paper `#f7f1e8`, surface `#ffffff`, line `#e5daca`, amber `#ffb703`
- **Typewriter (Special Elite)** is allowed and encouraged — JobBored owns it.
- **Masthead rule** (3px solid top + 3px double bottom with typewriter items between) is the top-bar / command-strip move.
- **Digest widget** pattern (white card, navy header, scanner sweep, green ✓ MATCH / orange × BORING badges) is the **model for the kanban card and runs-log rows**.
- **Eyebrow + SectionHeader + StatRow + MonoHeaderBar + Polaroid + FloatTag** are the primitives to build dashboard surfaces.
- Keep **§ 0N editorial numbering** on major sections (Daily Brief, Pipeline, Runs, Settings).
- Paper grain background (3px/4px repeating horizontal lines in 4% navy) replaces flat surface-2 for the dashboard body.
- Respect `prefers-reduced-motion`.
