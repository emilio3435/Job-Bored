# Mascot review — JobBored v2 visual refactor

**Owner:** Quill (Phase 2 typography & illustration agent)
**Source:** `jobbored.svg` (root) — sole mascot variant in the repo.
**Status:** Read-only review. No edits made. Awaiting human approval before any token swap.

## 1. Current palette analysis

Unique colors used in `jobbored.svg`:

- **`#59CB89`** — mascot body fill, chin/jaw, "Bored" italic wordmark fill, signal-wave strokes on phone, dollar-bill rects (alternating with amber), checkmark on resume, calendar dot accent, screen header bar, sparkle near envelope, gradient stop on tail. *Compare to `--jb-mint` (`#5FCB8E`): perceptually within ~3% — slightly cooler/greener than v2 mint, but visually nearly identical.*
- **`#003851`** — every primary stroke (body outline, eye outlines/strokes, smile, chin, clipboard, laptop edge, table, chair, wheels, wordmark fill), pupils, "Job" wordmark fill, phone speaker dot, calendar dots, laptop chassis fill. *Compare to `--jb-navy` (`#0E3A4E`): close family, the SVG navy is a touch cooler/darker.*
- **`#FEFFFE`** — thought-bubble fill, eye whites, phone body, calendar body, laptop screen, envelope body, resume body, connector bubbles. *Compare to `--jb-paper` (`#FFFEF9`): off-white-vs-paper. The SVG is a cold near-white; v2 paper is warm. **This is the most visible token mismatch on the warm-paper background.***
- **`#EF8F26`** — clipboard arm, table top edge, table apron, laptop body, calendar header, alternating dollar-bill stripe, phone-screen tint (at 0.3), screen-corner accent (at 0.5). *Compare to `--jb-amber` (`#EF8F26`): exact match.*
- **`#0B486B`** (at .25 opacity) — ground shadow under the mascot. *No direct token; closest is `--jb-navy-soft` (`#355467`) but the role is shadow, not ink.*
- **`#006482`** — chair post, wheels (two of three), tail gradient stop start, clipboard pen base. *No direct v2 token; functions as a teal-leaning navy mid-tone, sits between `--jb-navy` and `--jb-mint-deep` but matches neither.*
- **`#F9D091`** — small bump on laptop (mouse/wrist rest highlight). *Close to `--jb-amber-soft` (`#FAE2C2`) family but warmer/saturated.*
- **`#F0C087`** — table edge highlight. *Same family as `--jb-amber-soft`; warmer mid-tint of amber.*
- **`#FFD7A8`** (gradient stop) — head-wash gradient behind face. *Warm peach; functions as paper→amber wash.*

**Harmony summary on warm paper:** amber is already token-perfect; mint and navy are within tolerance and would benefit from token-snap (consistency > color shift). The cold `#FEFFFE` whites are the only real mismatch — they fight the warm paper. The teal `#006482` is an out-of-system color that has no clean v2 home; either accept it as an illustration accent or call it out.

## 2. Recommended swaps

| Where | Current value | Proposed token | Reason |
|---|---|---|---|
| Mascot body fill, chin, "Bored" wordmark, dollar bills, checkmark, signal waves, calendar/screen accents, sparkle | `#59CB89` | `var(--jb-mint)` (`#5FCB8E`) | Within 3% perceptual delta — tokenize for consistency, color shift is imperceptible. |
| All primary strokes, eye pupils, "Job" wordmark fill, phone/calendar dots, laptop chassis | `#003851` | `var(--jb-navy)` (`#0E3A4E`) | Tokenize; v2 navy is slightly warmer/more print-like and reads better on paper. Minor shift. |
| Thought-bubble fill, eye whites, phone/calendar/laptop screens, envelope, resume, connector bubbles | `#FEFFFE` | `var(--jb-paper)` (`#FFFEF9`) | **Largest visible win** — replaces cold white with warm paper so the mascot doesn't punch a cool hole through the v2 paper background. |
| Clipboard, table apron, laptop body, calendar header, dollar stripe, phone-screen tint, screen-corner | `#EF8F26` | `var(--jb-amber)` (`#EF8F26`) | Exact match — pure tokenization, zero color change. |
| Ground shadow | `#0B486B` @ .25 | `var(--jb-navy)` @ ~.2 | Tokenize and warm slightly. |
| Chair post, wheels, tail gradient start, pen base | `#006482` | *Keep, or introduce `--jb-teal` later* | No clean v2 home. Recommend leaving as-is for now and noting it as illustration-only. |
| Laptop highlight bump | `#F9D091` | `var(--jb-amber-soft)` (optional) | Family match; minor lightening. Optional. |
| Table edge highlight | `#F0C087` | *Keep, or `--jb-amber-soft`* | Mid-tint of amber. Optional snap. |
| Head-wash gradient stops | `#FFD7A8` → `#FEFFFE` | `var(--jb-amber-soft)` → `var(--jb-paper)` | Tokenize both stops; preserves warm peach wash and aligns with paper. |

## 3. Stroke weight notes

Current strokes: primary outlines at **1.4** (sometimes 1.2), secondary props at **0.5–0.9**, calendar-hook ticks at 0.9, wordmark stroke at 0.15.

- **16px favicon** — At ~12.5× downscale, the 1.2–1.4 primary stroke renders at ~0.1 device px; the 0.5–0.7 prop strokes vanish. Bubble + props collapse into noise. **A dedicated 16×16 favicon variant is required** — either a head-only crop or a chunkier-stroke (≥2.5 native) redraw. `transform: scale()` cannot recover sub-pixel strokes.
- **28px header logo** — At ~7× downscale, primary outlines hold but the bubble icons (phone screen, calendar dots, dollar text "$") will mush. Acceptable if the bubble is cropped or the logo is rendered as mascot-only (no bubble). At full art with bubble, recommend bumping bubble-prop strokes to ~1.0 in a small-size variant.
- **160px setup-card hero** — Strokes hold beautifully. No action needed.

**Phase 3 / Welcome follow-up:** ship a separate 16×16 favicon variant (or a 32×32 with chunkier strokes) and consider a "logo-only" head-crop variant for the 28px header.

## 4. Optional: face variants for empty states

A `tired / excited / curious` face set would meaningfully help the Welcome agent — empty states ("no jobs yet", "discovery running", "all swept up") currently lean on the same neutral half-smile. Variants only need to swap the **smile path** for an open-O (excited), flat line (tired), or asymmetric quirk (curious), and optionally scale the eye-white groups for "tired" droop or "excited" widen. Body, props, table all stay identical.

## 5. Approval checklist

Decisions for the human conductor before any edit happens:

1. **Tokenize amber `#EF8F26` → `var(--jb-amber)`** (exact match, zero visual change) — yes/no
2. **Tokenize mint `#59CB89` → `var(--jb-mint)`** (~3% shift, slightly warmer green) — yes/no
3. **Tokenize navy `#003851` → `var(--jb-navy)`** (slightly warmer/more print navy) — yes/no
4. **Replace cold `#FEFFFE` whites → `var(--jb-paper)`** (largest visible improvement on warm-paper background) — yes/no
5. **Tokenize ground shadow `#0B486B` → `var(--jb-navy)` @ ~.2 opacity** — yes/no
6. **Leave teal `#006482` (chair, wheels, tail) as illustration-only color, no token** — yes/no
7. **Tokenize head-wash gradient stops to `--jb-amber-soft` → `--jb-paper`** — yes/no
8. **Optional: snap `#F9D091` and `#F0C087` to `--jb-amber-soft`** — yes/no
9. **Phase 3 follow-up: ship a dedicated 16×16 favicon variant; do not rely on CSS scaling** — yes/no
10. **Phase 3 follow-up: produce tired / excited / curious face variants for empty states (smile path swap only)** — yes/no
