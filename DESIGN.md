# Design system — Command Center (JobBored)

## Product intent

Command Center is a **single-page lens on a Google Sheet**, not a second database. The UI should feel like **clarity over completeness**: reduce noise, **progressively reveal** detail, and let **AI compress** the job into what matters for a decision.

**Principles**

1. **Scan first** — In the collapsed card, the user should see: role, company, **pipeline stage**, location/comp/time, a **short AI summary** (at a glance), **fit vs role**, and **next actions** (view role, resume tools, expand). Nothing else competes at the same visual weight.
2. **Progressive disclosure** — Long scraped text, keyword lists, structured must-haves/nice-to-haves, raw requirements, and fetch metadata belong **behind** `<details>` or the expanded band, not in the default scan path.
3. **AI as compression** — The product assumes enrichment: **one-line role hook**, **truncated summary** with optional “full summary,” and **fit** in plain language. The Sheet may hold more; the card shows less until the user asks.
4. **Metrics elsewhere** — Aggregates (Daily Brief, KPI strip) stay **above** the list. Per-card UI does not add a fourth “dashboard column” or duplicate board-level metrics.

**Visual tokens**

- All colors, type, and spacing come from `style.css` `:root` (JobBored palette: navy, mint, amber, neutrals). Do not introduce ad-hoc hex on cards without extending tokens.

**Pipeline cards**

- Collapsed layout follows a **two-level grid**: outer `body | rail`; inner optional `posting | fit` only inside `body`. See [PIPELINE-CARDS-HANDOFF.md](PIPELINE-CARDS-HANDOFF.md) for DOM, breakpoints, and behavior contracts (`data-action`, `data-stable-key`, write-back selectors).

**When changing cards**

- Prefer **moving content** into disclosures or expanded sections over **shrinking type** to fit more on screen.
- Preserve **Sheet write-back** contracts and expand persistence (`expandedJobKeys`) when restructuring markup.
