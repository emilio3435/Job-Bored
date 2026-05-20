# dossier-df-css lane — handoff

**Run ID:** `dossier-df-20260519T2030Z`
**Worktree:** `../Job-Bored-wt-dossier-df-css`
**Branch:** `dossier-df/css` (off `feat/flowing-page`)
**Model:** Claude Opus, max reasoning
**Visual source of truth:** `docs/redesign/dossier-direction-f-wireframe.html`

## Goal

Rewrite `role.css` so the dossier renders as **two distinct cards** (Brief + Workshop) per the wireframe. Stop the dossier from inheriting `.detail-drawer` overlay styles. Introduce `.dossier-brief.*` and `.dossier-workshop.*` namespaces that the Brief and Workshop JS lanes consume.

You implement only CSS. The JS lanes are writing markup against your class names.

## Owns (exclusive)

- `role.css` — full rewrite is in-scope. The file today is ~306 lines of overrides; replace its body with the new namespaces.
- `style.css` — **read-only with one exception**: if the wireframe requires a new `:root` token (e.g. `--workshop-bg`, `--parchment-deep`), you may add it to `:root`. Do not edit any other section of `style.css`. Tokens you add must be additions, not changes.
- `jb-v2-legacy-hide.css` — read-only.

## Do NOT touch

- Any JS file.
- Any test file.
- `style.css` outside `:root` token additions.
- `.detail-drawer.*` rules in `style.css` — the legacy overlay still uses them.

## Class namespace contract

The two JS lanes are emitting markup that uses these classes. **These class names are frozen** — no renames without orchestrator approval.

### Brief (Brief lane consumes)

```
.dossier              /* outer flex column wrapper around both cards */
.brief                /* card 1 outer — parchment, soft shadow */
.brief__masthead
.brief__eyebrow
.brief__title
.brief__company
.brief__facts
.brief__stage-chip
.brief__body          /* the two-col grid */
.brief__col
.brief__col--main     /* wider left, posting lane */
.brief__col--side     /* narrower right, sticky on ≥1081px */
.brief__hook          /* pull-quote */
.brief__lede          /* AI summary with drop-cap */
.brief__lede-tag      /* provenance pill */
.skim                 /* at-a-glance facts panel */
.skim li, .skim .key, .skim .val, .skim .val--score
.section-label        /* shared dossier section heading style */
.points               /* talking points outer */
.points ul, .points li     /* dingbat-bullet rhythm: ✦ ❧ § every 3 */
.jd                   /* raw posting accordion outer */
.jd details, .jd summary, .jd .roman, .jd .toggle, .jd .count, .jd .body
.brief-notes          /* marginalia */
.brief-notes textarea
```

### Workshop (Workshop lane consumes)

```
.workshop             /* card 2 outer — distinct border, cool background, stronger shadow */
.workshop__bar        /* navy top bar */
.workshop__eyebrow
.workshop__primary
.btn-primary, .btn-ghost
.workshop__grid       /* 1fr / 1fr with 1px gutter */
.workshop__col
.ws-card              /* inner cards inside each Workshop column */
.ws-card h4
.stepper, .stepper__step, .stepper__step--done, .stepper__step--current
.timeline, .timeline__row, .timeline__key, .timeline__val, .timeline__val--urgent
.ats-card, .ats-card__number, .ats-card__lines, .ats-card__action
.writeback, .chip, .chip--danger, .chip .pulse
```

### Divider between cards

```
.mode-divider
.mode-divider__rule
.mode-divider__label
```

## Token rules

- Consume existing `:root` tokens from `style.css` (`--navy`, `--parchment`, `--surface`, `--border`, `--border-strong`, `--mint`, `--mint-deep`, `--amber`, `--crimson`, `--ink`, `--ink-soft`, `--mute`, `--radius-md`, `--radius-lg`, `--shadow-soft`, font families).
- If you need a new token (likely candidates: `--workshop-bg`, `--workshop-card`, `--parchment-deep`, `--shadow-strong`), add it to `:root` in `style.css` and document it at the top of `role.css` in a leading comment block. The wireframe already names them in its `:root`; use the same names and values.

## Behavior rules

- **Two-column Brief body grid:** `minmax(0, 1.55fr) minmax(0, 1fr)` with 48px gap. Vertical hairline rule via `::before` between cols. Collapses to single column at ≤1080px.
- **Sticky right column:** `position: sticky; top: 24px;` on `.brief__col--side` only at viewports ≥1081px. Drops to static below.
- **Workshop grid:** `1fr / 1fr`, 1px gutter via background-and-gap trick. Single column at ≤960px.
- **Drop-cap, pull-quote ornament, dingbat rhythm, JD accordion ledger rail, navy workshop bar, ATS giant number, write-back chip pulses, stepper colors** — all reproduce the wireframe pixel-equivalently.
- **`prefers-reduced-motion`** — every animation rule (`jdFadeIn`, chip pulse, hover transforms) must be inside `@media (prefers-reduced-motion: no-preference)` OR have an explicit `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }` reset.
- **`role.css` must stop overriding `.detail-drawer` selectors.** Delete the legacy override block at the end of today's `role.css`. The new namespaces do not inherit from `.detail-drawer`.

## Do NOT

- Add any JS.
- Style anything inside `<section data-region="letter">` — that's Part 04's CSS lane.
- Modify the empty-state `.jb-shelf*` rules unless they conflict with the new namespaces (they shouldn't).

## Verification

```bash
# CSS itself doesn't have a syntax checker in repo, but the dev server must load without errors.
npm run web-only
# Open http://localhost:8080, the wireframe at /docs/redesign/dossier-direction-f-wireframe.html, and side-by-side compare.
```

Diff your rendered dossier against the wireframe at 1440, 1024, 720, 390. Visual deviations must be intentional and noted in the Completion Report.

## Status file

Write to `docs/redesign/status/dossier-df-css.json` matching the schema in `docs/redesign/status/README.md`.

## Completion report (fill in at the end)

- **Commit SHA(s):**
- **Files changed:** (expected: `role.css`, optionally `style.css` for `:root` additions)
- **New tokens added (if any):**
- **Wireframe deviations + why:**
- **Browsers tested:** (Safari + Chrome at minimum)
- **Known risks:**
