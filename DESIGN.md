# Design system — Command Center (JobBored)

## Product intent

Command Center is a **single-page lens on a Google Sheet**, not a second database. The UI should feel like **clarity over completeness**: reduce noise, **progressively reveal** detail, and let **AI compress** the job into what matters for a decision.

**Principles**

1. **Scan first** — In the collapsed card, the user should see: role, company, **pipeline stage**, location/comp/time, a **short AI summary** (at a glance), **fit vs role**, and **next actions** (view role, resume tools, expand). Nothing else competes at the same visual weight.
2. **Progressive disclosure** — Long scraped text, keyword lists, structured must-haves/nice-to-haves, raw requirements, and fetch metadata belong **behind** `<details>` or the expanded band, not in the default scan path.
3. **AI as compression** — The product assumes enrichment: **one-line role hook**, **truncated summary** with optional “full summary,” and **fit** in plain language. The Sheet may hold more; the card shows less until the user asks.
4. **Metrics elsewhere** — Aggregates (Daily Brief, KPI strip) stay **above** the list. Per-card UI does not add a fourth “dashboard column” or duplicate board-level metrics.

**Visual tokens**

- **`tokens-v2.css` is the only place values live** — colour, type, space, radius, shadow, z-index and motion. It has two tiers: primitives (raw values such as `--jb-navy`, `--jb-mint`) and semantic names that alias them (`--jb-action`, `--jb-on-accent`, `--jb-err`). Reach for the semantic name.
- **`style.css :root` holds aliases only.** Legacy names (`--text`, `--accent`, `--space-4`, `--navy` …) resolve to `--jb-*` tokens so the legacy view and v2 share one palette. Never add a value there; add it to `tokens-v2.css` and alias it if a legacy name needs it.
- **Roles:** paper `--jb-paper` / `-2` / `-3`; ink `--jb-ink` (14.4:1), `--jb-ink-2` (7.8:1), `--jb-ink-3` (5.1:1 — the floor for any text); the one primary is `--jb-action` (navy). Text on a mint fill is `--jb-on-accent` (navy, 6.0:1), never white (2.0:1). Mint-family text on paper is `--jb-accent-ink`.
- **Scales:** type roles `--jb-type-display|title|heading|body|small|label|data|read` (nothing below 13px is a sentence; `label` is 11px mono caps only); space `--jb-space-N` = N×4px; radii `--jb-radius-sm|md|lg|pill` (6/10/14/pill); z-index `--jb-z-sticky|drawer|modal|toast|wizard`; motion `--jb-duration-fast|base|slow` (120/200/320ms).
- **Focus:** `--jb-shadow-focus` is a 2px navy ring on a 2px paper gap (12:1). Outlines use `var(--jb-focus-color)`.
- **Scope component CSS under its region root.** `body.jb-v2 h3/p` carry specificity (0,1,1); a single-class rule loses to them (the cascade trap).
- **`npm run lint:tokens` must pass** (part of `lint:repo`, so CI runs it). It fails on a new colour literal (hex, rgb, hsl) in any stylesheet `index.html` links, a `var()` of an undefined token with no fallback, or an unbalanced brace. Existing debt is frozen per file in `tools/lint-tokens.baseline.json`; counts may only go down — after burning debt run `npm run lint:tokens -- --update-baseline`.

**Pipeline cards**

- Collapsed layout follows a **two-level grid**: outer `body | rail`; inner optional `posting | fit` only inside `body`. See [PIPELINE-CARDS-HANDOFF.md](PIPELINE-CARDS-HANDOFF.md) for DOM, breakpoints, and behavior contracts (`data-action`, `data-stable-key`, write-back selectors).

**When changing cards**

- Prefer **moving content** into disclosures or expanded sections over **shrinking type** to fit more on screen.
- Preserve **Sheet write-back** contracts and expand persistence (`expandedJobKeys`) when restructuring markup.
