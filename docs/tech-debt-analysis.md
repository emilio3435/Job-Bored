# Tech Debt Analysis: index.html & style.css

*Generated 2026-04-09*

---

## 1. index.html — Overview

| Metric | Value |
|---|---|
| Total lines | 4,976 |
| File size | 185 KB |
| `<div>` elements | 317 |
| `<button>` elements | 141 |
| `<svg>` inline icons | 42 |
| `<input>` elements | 46 |
| `<select>` elements | 12 |
| `<textarea>` elements | 22 |
| `<script>` tags | 19 (all external; 0 inline) |
| `role="dialog"` modals | 14 |
| `style="display: none"` occurrences | 35 |
| `aria-*` attributes | 142 |
| `role=` attributes | 57 |
| HTML comments (section markers) | 41 |

### 1.1 Major Sections (with approx. line ranges)

| Section | Lines (approx.) | Description |
|---|---|---|
| `<head>` | 1–17 | Fonts, GSI client, stylesheets, favicon |
| Setup Screen (`#setupScreen`) | 22–121 | First-run onboarding when config missing |
| Sheet Access Gate (`#sheetAccessGateScreen`) | 122–431 | OAuth sign-in / sheet-connect split-pane |
| Dashboard (`#dashboard`) | 432–928 | Top bar, daily brief, pipeline card list, footer |
| Onboarding Wizard (9 panels) | 938–1402 | Multi-step mandatory onboarding flow |
| Settings Modal | 1403–2221 | Tabbed settings (Setup, Sheet, Discovery, Scraping, ATS, AI Providers) |
| Scraper Setup Modal | 2222–2420 | Cheerio local server setup guide |
| Profile Modal (Portfolio) | 2421–3126 | Resume, writing samples, AI context, style prefs |
| LinkedIn Capture Modal | 3127–3328 | Guided LinkedIn profile capture |
| Document Output Modal (Cover/Resume) | 3329–3644 | Generated document preview + refine + print |
| Draft Notes Modal | 3645–3710 | Per-application notes before generation |
| Discovery Paths Modal | 3711–3927 | Discovery alternatives (no webhook) |
| Discovery Full Guide Modal | 3928–4254 | Apps Script + clasp + verify |
| Discovery Local Worker Modal | 4255–4576 | Browser-use worker + ngrok bootstrap |
| Cloudflare Relay Setup Modal | 4577–4665 | Cloudflare Worker relay setup |
| Discovery Help Modal | 4666–4687 | "Set up Run discovery" explainer |
| Discovery Preferences Modal | 4688–4951 | Manual + AI-suggest tabs for run config |
| Discovery Setup Wizard Mount | 4952 | Dynamic mount point |
| Toast Container | 4953 | Toast notifications |
| Script tags | 4955–4976 | 19 external scripts loaded at end of body |

### 1.2 Anti-Patterns Found

#### A. Inline `style="display: none"` (35 occurrences)
Every modal and toggle-hidden section uses `style="display: none"` directly in HTML rather than a CSS class like `.hidden` or `[hidden]`. This mixes presentation with markup and makes it harder to search for visibility state.

#### B. Massive monolithic file — 14+ modals in one document
All 14 dialog modals, the setup screen, login gate, dashboard, and onboarding wizard live in a single HTML file. Each modal is 50–200 lines of markup. This makes the file extremely difficult to navigate and maintain.

#### C. Inline SVG icons (42 instances)
SVG icons are copy-pasted inline throughout the file. Many icons repeat (close ×, chevron, upload, settings gear, etc.). There is no SVG sprite sheet or icon component system.

#### D. No `<template>` usage
Job pipeline cards are presumably rendered by JavaScript (the container `#jobsContainer` is empty). But onboarding panels, modals, and setup screens are all statically in the DOM. None use `<template>` elements for deferred rendering.

#### E. No inline event handlers ✅
Zero `onclick`, `onchange`, etc. attributes found. All events are bound in JS. This is good practice.

#### F. No inline `<script>` blocks ✅
All 19 scripts are external files loaded at end of body. No inline JS. This is clean.

### 1.3 Accessibility

**Strengths:**
- 142 `aria-*` attributes across the file (good coverage)
- 57 `role` attributes including `role="dialog"`, `role="tabpanel"`, `role="tab"`, `role="group"`, `role="status"`, `role="alert"`
- `aria-modal="true"` on all dialog modals
- `aria-hidden="true"` on decorative SVGs
- `sr-only` class used for screen-reader-only labels
- `aria-label` and `aria-labelledby` on interactive elements

**Gaps:**
- No `<main>` landmark element visible (dashboard content is a `<div class="dashboard">`)
- No `<nav>` element for the top bar navigation
- No `<header>` landmark at the page level (the top bar uses `<div class="top-bar">`)
- `<section>` elements exist but the overall page lacks semantic landmark structure
- Missing skip-to-content link
- Focus trap implementation for 14 modals is presumably in JS but not verifiable from HTML alone

### 1.4 Semantic Markup

- `<details>` / `<summary>` used appropriately for progressive disclosure
- `<label>` elements properly associated via `for` attributes
- `<fieldset>` not used for any form groups (relies on `role="group"` instead)
- `<form>` elements not used — all submissions are JS-driven via button clicks

---

## 2. style.css — Overview

| Metric | Value |
|---|---|
| Total lines | 10,532 |
| File size | 213 KB |
| Major section comments (`/* === */`) | 22 |
| Unique class selectors | ~1,028 |
| `var(--*)` usages | 2,325 |
| Hard-coded hex colors | 115 lines |
| Hard-coded `rgba()` values | 300 lines |
| `!important` declarations | 24 |
| `@media` queries | 33 |
| `@keyframes` animations | 12 |
| `border-radius` declarations | 219 |
| BEM `__element` selectors | 684 |
| BEM `--modifier` selectors | 296 |

### 2.1 Major Sections (with line ranges)

| Section | Lines | Description |
|---|---|---|
| Root variables (`:root`) | 1–189 | Full design token system — palette, type, spacing, radius, shadows, transitions |
| Base reset | 127–189 | Box-sizing, html/body defaults |
| Utilities & keyframes | 190–262 | Skeleton, pulse, fadeIn, slideIn, spin, toast animations |
| Reduced motion | 264–272 | `prefers-reduced-motion` overrides |
| Setup screen | 274–457 | `.setup-*` classes |
| Login gate | 458–1109 | `.login-gate__*` — the split-pane sign-in screen |
| Skeleton loading | 1110–1140 | `.skeleton*` |
| Top bar | 1141–1257 | `.top-bar*`, brand, actions |
| Auth section | 1258–1472 | `.auth-*`, `.btn-google-signin` |
| Daily Brief | 1473–3309 | `.brief-*`, `.kpi-*`, `.queue-*`, `.pipeline-funnel*`, charts |
| Modals & forms | 3310–3461 | `.modal-*`, `.field-label`, `.modal-input`, `.btn-modal-*` |
| Pipeline cards | 3462–5549 | `.job-card*`, `.card-*`, `.detail-drawer*`, `.stage-stepper*` |
| Card details/expand | 5000–5549 | `.job-card__details*`, `.details-column*` |
| Materials & resume | 5550–5794 | `.btn-materials*`, `.empty-state*` |
| Contact status | 5795–6062 | `.contact-status*`, `.last-heard-input`, `.response-select` |
| Materials/resume gen. | 6063–7922 | `.btn-materials-upload*`, profile modal, doc output, insight cards |
| Print styles | 7923–7963 | `@media print` block |
| Onboarding wizard | 7964–8300 | `.onboarding-*` |
| Discovery wizard | 8301–9486 | `.discovery-setup-wizard__*` |
| Discovery preferences | 9487+ | `.discovery-prefs*` |
| Profile settings | ~10000–10532 | `.profile-settings*`, `.profile-sample*`, `.profile-modal__footer` |

### 2.2 Naming Convention Analysis

**Primary convention: BEM (Block–Element–Modifier)**
- `__` element separator: 684 occurrences (e.g., `.login-gate__hero`, `.card-identity__title`)
- `--` modifier: 296 occurrences (e.g., `.btn-modal-primary--disabled`, `.stage-step--done`)
- Consistent kebab-case throughout

**Deviations from strict BEM:**
- Some selectors mix BEM with descendant combinators: `.detail-drawer .card-actions-row` (line ~4061)
- Several utility-style classes don't follow BEM: `.sr-only`, `.skeleton`, `.saving`
- State classes use `--` modifier style inconsistently — some use `.job-card--expanded` (BEM), while element states use `.saving` or `.loading` (non-BEM)

### 2.3 CSS Custom Properties (Design Tokens)

**Strength: Excellent token system**
- 2,325 `var(--*)` usages — the vast majority of the file uses tokens
- Comprehensive `:root` block covers: palette (17 colors), status colors (20), type scale (6), spacing (12), radius (5), shadows (4), transitions

**Weakness: Hard-coded color leakage**
- 115 lines with raw hex colors outside `:root` (e.g., `#047857`, `#b45309`, `#92400e`, `#fff`)
- 300 lines with raw `rgba()` values not abstracted into tokens (e.g., `rgba(89, 203, 137, 0.18)`, `rgba(15, 23, 42, 0.06)`)
- These appear mostly in: drawer action buttons, card action states, discovery wizard chips, box-shadows, and border-colors
- Roughly 30% of color usage bypasses the token system

### 2.4 `!important` Usage (24 instances)

| Category | Count | Assessment |
|---|---|---|
| `prefers-reduced-motion` reset | 4 | ✅ Appropriate |
| `display: none !important` (forced hide states) | 7 | ⚠️ Workaround for specificity fights |
| `@media print` overrides | 9 | ✅ Appropriate for print |
| Discovery wizard motion reset | 2 | ✅ Appropriate |
| Onboarding visibility toggles | 2 | ⚠️ Could use higher-specificity selector |

Overall: ~15 are justified (motion/print), ~9 are specificity workarounds.

### 2.5 Media Query Organization

**33 `@media` queries scattered throughout the file** — they are placed inline next to the component they modify, NOT consolidated at the end. This is a modern "component-colocated" approach (acceptable), but creates issues:

- **12 different breakpoints used**: 480px, 520px, 600px, 640px, 720px, 760px, 768px, 900px, 960px, 980px, 1100px, plus `min-width` variants
- No consistent breakpoint token system — breakpoints are raw pixel values
- Some use `min-width` (mobile-first) and some use `max-width` (desktop-first) — **mixed methodology**
- `prefers-reduced-motion` queries: 5 (well distributed)
- `@media print`: 1 consolidated block (good)

### 2.6 Specificity Issues

**Generally low specificity (good):**
- Most rules are single-class selectors: `.card-identity`, `.btn-modal-primary`
- BEM naming avoids deep nesting

**Problem areas:**
- Some compound selectors: `.details-column--right .card-actions__tools` (2 classes)
- Discovery wizard has deeply scoped selectors: `.discovery-setup-wizard__carousel-col .discovery-setup-wizard__list li:last-child` (3 levels)
- The `!important` usage indicates at least 9 places where specificity escalated

### 2.7 Duplication / Repeated Patterns

1. **Button styles**: There are at least 8 distinct button patterns (`.btn-modal-primary`, `.btn-modal-secondary`, `.btn-doc-primary`, `.btn-doc-secondary`, `.btn-materials`, `.btn-discovery-setup`, `.setup-form-btn`, `.profile-btn-*`) — many share similar padding/radius/transition properties without abstraction.

2. **Focus-visible pattern**: `outline: 2px solid var(--accent); outline-offset: 2-3px;` repeated across dozens of interactive elements rather than being a utility or applied via a base selector.

3. **Input/select patterns**: `.modal-input`, `.last-heard-input`, `.response-select`, `.profile-input`, `.profile-select` share border, padding, border-radius, and font-size properties with slight variations.

4. **`border-radius`**: 219 declarations — while many reference `var(--radius-*)`, a non-trivial number use raw values.

5. **Box-shadow patterns**: Repeated `0 1px 2px rgba(...)` and `0 4px 12px rgba(...)` patterns that could be further tokenized.

---

## 3. Suggested Decomposition Strategy

### 3.1 index.html → Component Partials

Split the monolith into logical HTML partials/fragments:

| Partial file | Lines saved | Content |
|---|---|---|
| `partials/setup-screen.html` | ~100 | First-run setup |
| `partials/login-gate.html` | ~310 | OAuth split-pane |
| `partials/onboarding-wizard.html` | ~465 | 9-panel onboarding |
| `partials/settings-modal.html` | ~820 | Tabbed settings |
| `partials/profile-modal.html` | ~700 | Portfolio/resume |
| `partials/linkedin-capture.html` | ~200 | LinkedIn guided capture |
| `partials/document-output.html` | ~315 | Cover letter/resume preview |
| `partials/discovery-modals.html` | ~600 | All 4 discovery setup modals |
| `partials/discovery-prefs.html` | ~285 | Pre-run preferences |

**Implementation approach**: Since there's no build step, use a lightweight HTML include system (e.g., a simple Node script that concatenates partials into `index.html` at dev time, or adopt `<template>` elements loaded via fetch).

### 3.2 style.css → Component Stylesheets

Split into domain-specific CSS files (a second CSS file `settings-tabs.css` already exists, showing precedent):

| File | Approx. lines | Content |
|---|---|---|
| `css/tokens.css` | 190 | `:root` variables, reset |
| `css/base.css` | 150 | Utilities, keyframes, sr-only |
| `css/login-gate.css` | 650 | Login/auth gate |
| `css/setup.css` | 180 | Setup screen |
| `css/topbar.css` | 330 | Top bar + auth section |
| `css/brief.css` | 1,840 | Daily brief, KPIs, charts |
| `css/cards.css` | 2,100 | Pipeline cards, drawer, details |
| `css/modals.css` | 500 | Modal base + settings |
| `css/materials.css` | 1,100 | Portfolio, resume gen, doc output, insights |
| `css/onboarding.css` | 340 | Onboarding wizard |
| `css/discovery.css` | 1,200 | Discovery wizard + preferences |
| `css/profile.css` | 550 | Profile settings/samples |
| `css/print.css` | 40 | Print media |

**Implementation**: Use CSS `@import` during development, then concatenate for production (or rely on HTTP/2 multiplexing since this is a static site).

### 3.3 Quick Wins (No Architecture Change)

1. **Replace `style="display: none"` with `hidden` attribute** — The HTML `hidden` attribute is semantic, styleable, and searchable. Reduces inline styles from 35 to 0.

2. **Extract SVG sprite sheet** — Move the 42 inline SVGs into a `<svg>` sprite at the top of the document or an external `.svg` file. Reference via `<use href="#icon-name">`.

3. **Consolidate hard-coded colors** — Add ~20 missing tokens to `:root` for the leaked hex/rgba values (drawer buttons, card action states, discovery wizard chips).

4. **Standardize breakpoints** — Define `--bp-sm: 480px; --bp-md: 768px; --bp-lg: 1024px;` (note: CSS custom properties can't be used in media queries without `@custom-media`, but a comment-based convention or PostCSS step would help).

5. **Create button base class** — Abstract shared button properties into `.btn-base` and extend with modifier classes.

6. **Add semantic landmarks** — Wrap dashboard in `<main>`, top bar in `<header>`, navigation in `<nav>`. Add skip-to-content link.

---

## 4. Summary of Key Findings

| Category | Status | Notes |
|---|---|---|
| File sizes | 🔴 Critical | 185KB HTML + 213KB CSS — both 3-5× larger than maintainable |
| Modals in DOM | 🔴 High | 14 modals statically in HTML, most hidden |
| Inline SVGs | 🟡 Medium | 42 duplicated SVGs with no sprite/symbol system |
| Inline styles | 🟡 Medium | 35× `display:none`, no other inline styles |
| Inline JS | 🟢 Clean | Zero inline scripts or event handlers |
| Design tokens | 🟢 Strong | 2,325 var() usages; ~30% color leakage |
| BEM naming | 🟢 Strong | 980 BEM selectors; consistent kebab-case |
| Accessibility | 🟡 Good | 142 aria attrs, but missing landmarks |
| Media queries | 🟡 Medium | 12 ad-hoc breakpoints, mixed min/max-width |
| `!important` | 🟢 Acceptable | 24 total; 15 justified (print/motion) |
| Button duplication | 🟡 Medium | 8+ button patterns sharing properties |
| Decomposition | 🔴 None | Single HTML + single CSS, no partials |
