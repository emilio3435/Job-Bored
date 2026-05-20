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

- **Commit SHA(s):** `12e3585b0a0023f8e4b2f8e1d6a3a5338f2e5e2f` on
  `dossier-df/css` (not pushed). Commit message:
  `feat(dossier-df/css): direction F two-card layout for role region`.
- **Files changed:**
  - `role.css` — new file at the top of the worktree; combines the existing
    PART 03 divider + empty-state shelf rules (`.jb-role-divider*`,
    `.jb-shelf*`, `.jb-recents*`, `.jb-recent-chip*`) with the Direction F
    dossier namespaces (`.dossier`, `.brief*`, `.skim`, `.section-label`,
    `.points`, `.jd*`, `.brief-notes`, `.mode-divider*`, `.workshop*`,
    `.btn-primary`, `.btn-ghost`, `.ws-card`, `.stepper*`, `.timeline*`,
    `.ats-card*`, `.writeback`, `.chip*`). The legacy
    `body.jb-v2 [data-region="role"] .jb-dossier.detail-drawer { … }`
    override block was removed — the new namespaces do not inherit from
    `.detail-drawer`.
  - `style.css` — added new dossier tokens to `:root` only. No existing
    token value was changed.
- **New tokens added (if any):**
  Added to `:root` in `style.css` (all additive — no existing token was
  modified):
  `--navy`, `--navy-soft`, `--ink`, `--ink-soft`, `--mute`,
  `--parchment`, `--parchment-deep`, `--workshop-bg`, `--workshop-card`,
  `--border-strong`, `--mint`, `--mint-deep`, `--amber`, `--crimson`,
  `--shadow-soft`, `--shadow-strong`, `--serif`, `--sans`, `--mono`.
  Tokens whose names already exist in legacy `style.css` with different
  values (`--surface`, `--border`, `--radius-md`, `--radius-lg`) are
  redefined locally inside `.dossier {}` and `.workshop {}` in `role.css`
  so the parchment palette applies inside the dossier subtree without
  changing the legacy values used elsewhere in `style.css`.
- **Wireframe deviations + why:**
  - `--sans` resolves to `"DM Sans"` first instead of the wireframe's
    `"Inter"`, because Inter is not loaded by `index.html` (DM Sans and
    Geist are). The remaining fallback chain (`system-ui`, `-apple-system`,
    `Segoe UI`, `sans-serif`) is unchanged. This keeps the dossier sans face
    consistent with the rest of the v2 surface without an unconfigured
    web font.
  - `--mono` lists `"JetBrains Mono"` first and keeps `"Special Elite"`
    as a fallback for the Marginalia textarea (which still uses
    `font-family: "Special Elite", var(--mono);`). Special Elite is not
    loaded by `index.html`, so the textarea will render in JetBrains Mono
    in practice; the typewriter aesthetic is approximated by the dashed
    underline and the muted italic placeholder.
  - The wireframe's annotation overlay (`.anno`, `.anno-toggle`,
    `body.show-anno`) and the wireframe-only `.part-divider` styles are
    intentionally **not** ported. The annotation overlay is a preview-only
    affordance, and the PART 03 divider is already handled by the
    `.jb-role-divider*` rules at the top of the file.
  - No chip pulse keyframe animation was added. The brief calls out
    "write-back chip pulses" as a visual element (the small dot on each
    chip), and the wireframe does not define a keyframe for it. Keeping
    the chip pulse static matches the wireframe exactly.
- **Browsers tested:** Verified via `PORT=8085 npm run web-only` that
  the dev server serves `role.css`, `style.css`, `index.html`, and the
  wireframe with HTTP 200 and no startup errors. Headless visual diff
  of the rendered dossier vs. the wireframe is blocked until the
  Brief and Workshop JS lanes land (they emit the markup that consumes
  these class names), so cross-browser screenshot diffs are deferred to
  the `tests-screens` lane.
- **Known risks:**
  - The `role.css` content includes the existing `.jb-role-divider`,
    `.jb-shelf*`, `.jb-recents*` rules that today live as an uncommitted
    change in the main worktree (`/Users/emilionunezgarcia/Job-Bored/role.css`).
    On `feat/flowing-page` upstream, `role.css` does not yet exist.
    When this branch lands, the integration lane should accept this
    file as the canonical `role.css` for the dossier region; if the
    in-flight `role.css` from the main worktree also lands first, the
    shared sections are byte-equivalent and the integration lane can
    merge by taking the dossier-df/css version (which is a superset).
  - The dossier-local redefinitions of `--surface`, `--border`,
    `--radius-md`, `--radius-lg` apply to every descendant of `.dossier`
    and `.workshop`. If a future widget mounted inside the dossier
    expects the legacy values, it must opt out by redefining the
    token at its own scope.
  - `prefers-reduced-motion: reduce` disables the JD accordion fade
    and the `+`-to-`✕` toggle rotation. The body transition on
    `.jd details` (border-left-color) is also disabled in reduced-motion
    mode, so accordion state changes are instant rather than easing.
