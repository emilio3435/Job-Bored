# UX01 audit: Design system

Lens: Design system · Surfaces: the 36 stylesheets `index.html` links (lines 189–234, in load order), `tokens-v2.css`, `style.css :root`, `jb-v2.css`, `jb-type.css`, `jb-deco.css`, `jb-ui.css` + `jb-ui.js`, `jb-a11y.css`, `visual-themes.js`, the 11 `css/legacy-*.css`, the per-surface sheets, `jb-v2-legacy-hide.css`, `DESIGN.md`, `JB-UI.md`, `tools/lint-tokens.mjs` · Worktree commit `f227fbb` (origin/main) · 2026-09-25

## Method

- **Static pass.** `measure-static.mjs` reads the `<link rel="stylesheet">` list out of `index.html` (with comments stripped), which yields 36 sheets in load order. For each file it walks the declarations and records the following:
  - **Colours:** hex, rgb(a), hsl(a) and named colours, normalised to `#rrggbb[/alpha]`. Literals are counted separately from `var()` uses in colour-bearing properties.
  - **Distinct values** for font sizes, spacing (margin, padding, gap), radii, box-shadows and z-index.
  - **`!important`** count.
  - **Custom properties:** where each one is defined and where it is used. JS `setProperty` calls and inline `--x:` definitions in `*.js`, `*.html` and `partials/` count as definitions, so tokens set at runtime are not flagged as undefined.
- **Runtime pass.** `runtime.mjs` uses the shared harness (`openApp`, `shoot`) in `greenfield` (the demo board, then "Make it mine" to Beat 1, then "Poke around first"), `signed-in` (default; add-job-URL modal; move-to-stage menu; role dossier; settings modal and its tabs; discovery drawer; runs log; materials modal; auth menu), `signed-in-empty` and `signed-in-error`, each at 1440 and 375. For every state it does four things:
  1. Chromium CSS coverage (`page.coverage.startCSSCoverage({resetOnNavigation:false})`, then a reload so first paint is tracked), unioned across states.
  2. A selector-match pass over `document.styleSheets`: interaction pseudo-classes and pseudo-elements are stripped, and a rule counts as matched if `querySelector` hits anywhere, in any sampled state.
  3. A computed-style inventory of buttons, pills, cards and inputs.
  4. The rendered font size, family and weight of every text-bearing element.
- **Follow-up probes:**
  - `checks.mjs`: CSSOM presence of the role.css rule, computed values of undefined tokens, matched versus visibly matched rules per sheet, the DOM hidden by legacy-hide, fonts loaded, and the `?jb-v2=0` legacy view.
  - `legacy-live.mjs`: coverage-used selectors per legacy sheet.
  - `cascade-trap.mjs`: single-class rules on `h1–h6`/`p` whose value loses to `body.jb-v2 h*/p`.
  - `contact-sheet.mjs`: one representative element per look, composed into `components-*.png`.
- **Scripts** are in `/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/ux01/design-system/`. Run each with `node <script>` from the worktree root. Raw output is in `static-out.txt`, `runtime.json`, `checks-out.txt`, `legacy-live-out.txt` and `cascade-trap-out.txt` in the same folder.
- **Other reads:** `node tools/lint-tokens.mjs` (output: `2 findings across 16 file(s)`), plus read-only `git diff main...feat/greenfield-integration` and `main...feat/casefit` for the in-flight fence.

## Measurements

### M1. Per-file static counts (`node …/measure-static.mjs`)

| file | lines | rules | v2-scoped rules | distinct colour literals | colour literal occurrences | colour var() uses | distinct font-sizes |   of which literal | distinct spacing |   of which literal | distinct radii | distinct shadows | distinct z-index | !important | var(--jb-*) uses | var(--legacy) uses | custom-prop defs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| vendor/fonts/fonts.css | 1081 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| style.css | 1888 | 219 | 0 | 91 | 138 | 196 | 12 | 7 | 16 | 7 | 8 | 10 | 3 | 4 | 0 | 422 | 123 |
| css/onboarding-celebration.css | 368 | 37 | 0 | 12 | 15 | 42 | 6 | 3 | 9 | 2 | 4 | 5 | 1 | 1 | 25 | 51 | 0 |
| css/legacy-login-gate.css | 497 | 55 | 0 | 19 | 24 | 46 | 5 | 0 | 9 | 0 | 4 | 4 | 1 | 6 | 0 | 109 | 0 |
| css/legacy-brief.css | 2041 | 305 | 0 | 55 | 70 | 225 | 12 | 5 | 22 | 15 | 8 | 3 | 4 | 0 | 0 | 531 | 0 |
| css/legacy-cards-drawer.css | 1693 | 229 | 0 | 36 | 44 | 200 | 14 | 10 | 17 | 12 | 10 | 15 | 5 | 0 | 0 | 371 | 11 |
| css/legacy-materials.css | 2256 | 295 | 1 | 68 | 99 | 249 | 14 | 6 | 38 | 22 | 10 | 10 | 4 | 13 | 3 | 536 | 39 |
| css/legacy-discovery-setup-wizard.css | 1663 | 213 | 0 | 96 | 163 | 138 | 17 | 11 | 24 | 18 | 7 | 15 | 3 | 4 | 40 | 258 | 0 |
| css/legacy-profile-modal.css | 1040 | 142 | 0 | 16 | 19 | 136 | 7 | 3 | 10 | 5 | 4 | 5 | 2 | 0 | 0 | 300 | 0 |
| css/legacy-settings-profile.css | 390 | 53 | 0 | 11 | 17 | 56 | 2 | 0 | 9 | 4 | 6 | 0 | 0 | 0 | 0 | 132 | 0 |
| css/legacy-discovery-runs.css | 451 | 68 | 0 | 5 | 5 | 68 | 4 | 1 | 8 | 2 | 4 | 1 | 1 | 1 | 0 | 110 | 0 |
| css/legacy-discovery-drawer.css | 466 | 70 | 0 | 26 | 38 | 65 | 4 | 2 | 10 | 7 | 3 | 0 | 2 | 0 | 0 | 115 | 0 |
| css/discovery-run-preview.css | 29 | 4 | 0 | 0 | 0 | 5 | 2 | 0 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 9 | 0 |
| css/legacy-fit-profile-overlay.css | 127 | 18 | 0 | 8 | 15 | 16 | 5 | 3 | 9 | 6 | 2 | 0 | 1 | 0 | 0 | 22 | 0 |
| css/legacy-discovery-coachmark.css | 102 | 10 | 0 | 0 | 0 | 15 | 4 | 0 | 3 | 0 | 2 | 1 | 1 | 0 | 0 | 27 | 0 |
| settings-tabs.css | 250 | 34 | 0 | 2 | 2 | 24 | 3 | 0 | 4 | 0 | 2 | 2 | 0 | 1 | 9 | 49 | 0 |
| tokens-v2.css | 152 | 1 | 0 | 32 | 51 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 69 |
| jb-v2.css | 179 | 22 | 10 | 10 | 10 | 20 | 2 | 1 | 1 | 1 | 3 | 0 | 0 | 2 | 26 | 4 | 3 |
| jb-type.css | 136 | 18 | 18 | 0 | 0 | 12 | 8 | 1 | 5 | 5 | 2 | 0 | 0 | 0 | 28 | 0 | 0 |
| jb-deco.css | 137 | 16 | 16 | 1 | 2 | 18 | 1 | 1 | 4 | 4 | 1 | 3 | 1 | 0 | 22 | 0 | 0 |
| jb-ui.css | 216 | 45 | 44 | 1 | 1 | 44 | 6 | 5 | 7 | 6 | 3 | 4 | 1 | 0 | 68 | 1 | 10 |
| jb-a11y.css | 327 | 31 | 0 | 1 | 1 | 37 | 3 | 0 | 11 | 11 | 3 | 2 | 2 | 0 | 53 | 0 | 4 |
| lattice.css | 778 | 98 | 98 | 0 | 0 | 98 | 8 | 4 | 18 | 18 | 4 | 4 | 1 | 0 | 173 | 3 | 32 |
| dawn.css | 987 | 136 | 135 | 3 | 4 | 120 | 18 | 17 | 26 | 12 | 6 | 6 | 2 | 0 | 148 | 64 | 0 |
| today.css | 183 | 30 | 29 | 0 | 0 | 31 | 4 | 0 | 5 | 0 | 2 | 1 | 0 | 0 | 49 | 16 | 0 |
| flowing-chrome.css | 621 | 73 | 72 | 2 | 2 | 50 | 3 | 3 | 18 | 16 | 5 | 4 | 1 | 0 | 75 | 0 | 0 |
| pipeline.css | 1321 | 165 | 163 | 3 | 3 | 213 | 11 | 7 | 17 | 17 | 4 | 10 | 2 | 1 | 289 | 36 | 25 |
| role.css | 1171 | 167 | 4 | 43 | 65 | 150 | 13 | 13 | 26 | 26 | 9 | 3 | 1 | 3 | 47 | 152 | 4 |
| role-case.css | 464 | 209 | 209 | 27 | 33 | 179 | 15 | 13 | 28 | 26 | 8 | 7 | 2 | 0 | 7 | 270 | 15 |
| recruiter-strip.css | 80 | 11 | 0 | 0 | 0 | 7 | 3 | 0 | 3 | 3 | 1 | 2 | 0 | 0 | 14 | 0 | 0 |
| materials-queue.css | 263 | 31 | 0 | 26 | 33 | 14 | 5 | 5 | 7 | 7 | 3 | 1 | 1 | 0 | 0 | 22 | 0 |
| scribe.css | 877 | 117 | 116 | 0 | 0 | 124 | 7 | 3 | 11 | 11 | 3 | 2 | 1 | 0 | 186 | 2 | 10 |
| welcome.css | 184 | 20 | 20 | 0 | 0 | 25 | 3 | 0 | 10 | 10 | 1 | 2 | 1 | 0 | 43 | 0 | 0 |
| fit-profile.css | 790 | 112 | 0 | 27 | 92 | 78 | 8 | 4 | 15 | 15 | 5 | 2 | 1 | 0 | 0 | 106 | 0 |
| css/oneflow.css | 1999 | 236 | 0 | 27 | 48 | 339 | 25 | 21 | 33 | 23 | 14 | 13 | 7 | 1 | 217 | 372 | 7 |
| jb-v2-legacy-hide.css | 150 | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 0 |
| **TOTAL (distinct across all 36)** | | 3298 | | 459 | 994 | 3040 | 93 | 69 | 129 | 86 | 39 | 103 | 27 | 44 | | | |

"Distinct" in the TOTAL row means distinct across all 36 files, not the sum. Colours are normalised: `#fff`, `white` and `rgb(255,255,255)` count as one.

**Headline numbers:**
- **Colour:** 459 distinct literal colours across 994 literal occurrences, against 3,040 `var()` uses in colour properties.
- **Font size:** 93 distinct values, 69 of them literals.
- **Spacing:** 129 distinct values, 86 of them literals.
- **Radius and shadow:** 39 distinct radii and 103 distinct box-shadows.
- **z-index:** 27 distinct values, from `-1` to `100002`.
- **`!important`:** 44.
- **Rules:** 3,298 across the 36 sheets.

### M2. The two token systems

| | `style.css :root` (legacy + "Direction F" dossier block) | `tokens-v2.css :root` (+ `body.jb-v2` in jb-v2.css) |
|---|---|---|
| Custom properties defined | 123 | 69 (+3 flow-layout props on `body.jb-v2`) |
| Defined but never referenced (CSS+JS+HTML) | 19 (`--bg-raised --text-soft --high-bg --high-border --status-*-bg ×9 --space-16 --glass-bg-hover --navy-soft --workshop-bg --workshop-card --shadow-strong`) | 7 (`--jb-line-strong --jb-ok-bg --jb-warn-bg --jb-err-bg --jb-info --jb-info-bg --jb-radius-xl`) |
| Same value under two or more names inside the system | n/a | 11 collisions, e.g. `#c0392b = --jb-rose = --jb-err = --jb-stage-rejected`; `#fcefa8 = --jb-yellow-tape = --jb-yellow`; `#2f8a5a = --jb-mint-deep = --jb-stage-offer = --jb-fit-high` |
| Spacing scale | `--space-1…16` (10 steps) | **none** |
| Type scale | 6 steps (`--text-xs…2xl`) | 7 steps (`--jb-text-xs…3xl`) |
| Radius / shadow | 4 radii + 2 card radii / 4 + 2 shadows | 6 radii / 4 shadows |

**Across both systems:**
- **Total:** 256 custom properties are defined in CSS (79 `--jb-*`, 177 other).
- **Redefinitions:** 6 are defined in more than one file with different values: `--surface`, `--border`, `--radius-md`, `--radius-lg`, `--mute` (role.css:222–225, role-case.css:19–32) and `--sticker-padding`.
- **Aliases:** 21 are bare `var(--x)` aliases.
- **Undefined:** 34 are **referenced but never defined**. That is 60 occurrences: 52 carry a fallback, 8 have none.
- **Same colour under different values.** "Navy" has four values in force at once: `--text #003851`, `--jb-navy #0E3A4E`, `--jb-ink #1B2B33`, `--navy #1B2A4E`. "Mint" has three: `--accent #59cb89`, `--jb-mint #5FCB8E`, `--mint #B5D4C2`. All of them are live on `body` (`checks-out.txt`, `tokens`).
- **v2 sheets still reach into the legacy system.** Distinct legacy tokens referenced per v2 sheet: `css/oneflow.css` 36, `role-case.css` 29, `role.css` 23, `dawn.css` 11, `pipeline.css` 11, `today.css` 5.
- **In-flight branches widen the split.** `feat/casefit` adds 46 lines to role-case.css with 0 `--jb-*` references (6 `--crimson`, 2 `--serif`, 2 `--mute`, …). PR #104 adds 36 lines to settings-tabs.css, all on legacy `--space-*`/`--surface-2`/`--divider`.

### M3. Coverage and selector match, unioned over every sampled state (`node …/runtime.mjs`), labelled inferred because some states go unsampled

| file | bytes | coverage-used bytes | used % | rules | selector matched (any state) | unmatched % | matched **visibly** on signed-in default (checks.mjs) |
|---|---|---|---|---|---|---|---|
| style.css | 39155 | 21453 | 54.8 | 219 | 135 | 38 | 25 |
| css/onboarding-celebration.css | 10129 | 515 | 5.1 | 37 | 9 | 76 | 0 |
| css/legacy-login-gate.css | 10589 | 285 | 2.7 | 55 | 38 | 31 | 0 |
| css/legacy-brief.css | 39946 | 5213 | 13.1 | 305 | 164 | 46 | 2 |
| css/legacy-cards-drawer.css | 35555 | 1081 | 3.0 | 229 | 70 | 69 | 0 |
| css/legacy-materials.css | 47108 | 3596 | 7.6 | 295 | 116 | 61 | 8 |
| css/legacy-discovery-setup-wizard.css | 38512 | 7097 | 18.4 | 213 | 48 | 77 | 0 |
| css/legacy-profile-modal.css | 20793 | 12112 | 58.3 | 142 | 108 | 24 | 0 |
| css/legacy-settings-profile.css | 8681 | 0* | 0 | 53 | 14 | 74 | 0 |
| css/legacy-discovery-runs.css | 10529 | 6226 | 59.1 | 68 | 44 | 35 | 0 |
| css/legacy-discovery-drawer.css | 10529 | 6402 | 60.8 | 70 | 46 | 34 | 0 |
| css/discovery-run-preview.css | 553 | 63 | 11.4 | 4 | 1 | 75 | 0 |
| css/legacy-fit-profile-overlay.css | 2681 | 1114 | 41.6 | 18 | 7 | 61 | 0 |
| css/legacy-discovery-coachmark.css | 2166 | 467 | 21.6 | 10 | 2 | 80 | 0 |
| settings-tabs.css | 5678 | 4340 | 76.4 | 34 | 34 | 0 | 0 |
| tokens-v2.css | 9062 | 8278 | 91.3 | 1 | 1 | 0 | 1 |
| jb-v2.css | 5493 | 1085 | 19.8 | 22 | 10 | 55 | 8 |
| jb-type.css | 3409 | 1265 | 37.1 | 18 | 15 | 17 | 8 |
| jb-deco.css | 4635 | 610 | 13.2 | 16 | 2 | 88 | 2 |
| jb-ui.css | 6951 | 3433 | 49.4 | 45 | 21 | 53 | 21 |
| jb-a11y.css | 9359 | 3178 | 34.0 | 31 | 16 | 48 | 10 |
| lattice.css | 23779 | 257 | 1.1 | 98 | 1 | 99 | 1 |
| dawn.css | 29093 | 20608 | 70.8 | 136 | 119 | 13 | 116 |
| today.css | 6038 | 4015 | 66.5 | 30 | 26 | 13 | 22 |
| flowing-chrome.css | 16979 | 10311 | 60.7 | 73 | 62 | 15 | 52 |
| pipeline.css | 39044 | 23302 | 59.7 | 165 | 137 | 17 | 94 |
| role.css | 33012 | 3763 | 11.4 | 166 | 19 | 89 | 17 |
| role-case.css | 48610 | 20189 | 41.5 | 209 | 120 | 43 | 0 (dossier closed) |
| recruiter-strip.css | 1904 | 1283 | 67.4 | 11 | 9 | 18 | 9 |
| materials-queue.css | 6910 | 848 | 12.3 | 31 | 3 | 90 | 0 |
| scribe.css | 22856 | 12749 | 55.8 | 117 | 74 | 37 | 74 |
| welcome.css | 5131 | 304 | 5.9 | 20 | 1 | 95 | 0 |
| fit-profile.css | 15992 | 6182 | 38.7 | 112 | 50 | 55 | 0 |
| css/oneflow.css | 53812 | 22185 | 41.2 | 236 | 115 | 51 | 0 |
| jb-v2-legacy-hide.css | 6788 | 1193 | 17.6 | 8 | 6 | 25 | 3 |
| vendor/fonts/fonts.css | 49298 | 0 (@font-face not counted) | – | 0 | 0 | – | – |
| **total** | **680759** | **215002** | **31.6** | **3297** | **1643** | **50** | |

\* legacy-settings-profile shows 0 coverage bytes in `runtime.mjs` but 14 used blocks in `legacy-live.mjs`, which clicks through every settings tab. The runtime pass only screenshotted tabs 1–3 at 375.

About two-thirds of the 680 KB of render-blocking CSS goes unused in every state sampled. The "matched" column overstates live work, because the legacy DOM exists in the page but is hidden. Compare the "matched visibly" column: `legacy-brief` has 156 rules that match, but only 2 of them match an element with a box.

### M4. What `jb-v2-legacy-hide.css` hides (checks.mjs, signed-in, 1440)

| Hidden host (rule) | DOM nodes still built by app.js | box? |
|---|---|---|
| `#dashboard > .command-strip.daily-brief-panel` (l.37) | 178 | no |
| `#dashboard > main.main-content` (l.38), containing `#pipelineSection` / `.pipeline-board` (l.130–131, 526 nodes) | 527 | no |
| `#dashboard > header.top-bar` (l.39) | 17 | no |
| `#resumeGenerateModal` (l.132) | 69 | no |
| `[data-region=lattice]` (l.66, revealed l.87 but empty) | 0 | yes (empty) |
| `[data-region=welcome]` (l.45/68; revealed only for `data-mode="onboarding"`, l.97) | 0 | no |
| `[data-region=letter]` (l.65, l.75) | absent from DOM | – |

The hidden hosts account for about 791 of 3,294 DOM nodes (24%), all built and then hidden. The file has 7 `!important`. Its header comment contradicts its own rules: it lists `.top-bar` as an "intentional non-target" (l.123–125) while l.39 hides it.

**Legacy sheets that still do live work under `body.jb-v2`** (`legacy-live-out.txt`, coverage-used rule blocks across the signed-in overlays and greenfield Beat 1):

| Sheet | Live blocks | What they style |
|---|---|---|
| `legacy-profile-modal` | 67 | materials modal |
| `legacy-brief` | 65 | `.modal-overlay`, `.btn-modal-primary`, settings callouts, `.btn-discovery` |
| `legacy-discovery-drawer` | 45 | discovery drawer |
| `legacy-discovery-runs` | 39 | runs modal |
| `legacy-materials` | 30 | `.btn-materials` icon buttons adopted into `.page-top`, settings-modal chrome |
| `legacy-discovery-setup-wizard` | 27 | the one-flow shell chassis |
| `legacy-settings-profile` | 14 | settings schedule block |
| `legacy-cards-drawer` | 5 | `.detail-overlay` / `.detail-drawer` chassis used by the discovery drawer |
| `legacy-fit-profile-overlay` | 4 | including `.discovery-drawer__footer` |
| `legacy-login-gate` | 3 | pre-paint auth rules |
| `legacy-discovery-coachmark` | 1 | |

Eight of the eleven "legacy" sheets carry live v2 chrome.

### M5. Component inventory (computed style, all sampled states; contact sheets in `audit/shots/design-system/components-*-1440.png`)

A "look" groups elements by fill, border colour, radius (pill or px), family and weight. A "signature" also includes text colour, font size, text-transform, shadow and height.

| Kind | Exact signatures | Distinct looks | Notes |
|---|---|---|---|
| Buttons | 158 | 72 | At least 10 different **primary** treatments: navy mono 8px (`.today-item__action`), navy mono pill (`#discoveryBtn`), navy Geist 8px (`.pipe-tool__btn--url`, `.pipe-url-modal__primary`), navy Geist 10px (`.oneflow-demo__invite-action--primary`), dossier navy `#1B2A4E` mono pill (`.case__btn--primary`), mint pill + navy text (`.brief-btn--primary`), v2 mint 8px + paper text (`.scribe-btn--primary`), legacy mint 8px + white (`.btn-modal-primary`), mint gradient pill + white (`.discovery-setup-wizard__btn--primary`, i.e. "Continue with Google"), teal `#006482` (`.profile-ai-copy-btn`). The 9 `pipe-col__toggle` looks are one component tinted per stage (keep). |
| Pills / chips | 58 | 28 | `case__chip`, `oneflow-demo__score`, `jb-ai-chip`, `runs-status-badge` (legacy rgba tints), `dp-stratum-card__badge` (Tailwind-blue/amber rgba), `discovery-drawer__chip`, `pipe-tool__chip`, `scribe-chip`, `jb-stamp`. |
| Cards | 44 | 8 | Warm paper 14px (`brief-card`, `jb-sticker`) versus cool white/slate 16px (`modal-card`), 12px (`profile-source-card`) and 6px (`dp-stratum-card`). |
| Inputs | 46 | 11 | Warm paper (`pipe-tool__search-input`, `scribe-*`, `oneflow-google__client-id`) versus white/slate (`.modal-input`) versus slate-filled (`.fp-input`, `#f1f5f9`) versus borderless serif/mono (`case__*`) versus translucent (`.settings-select`). |

**Keep, merge or retire:**
- **Keep:** `jb-sticker` / `brief-card` (the v2 card); the pipe-col stage toggle; the navy 8px primary (`today-item__action` / `pipe-tool__btn--url`, merged into one); `pipe-tool__chip` (as the chip base); the warm paper input.
- **Merge:** every mint primary into one `.jb-btn--primary`; `case__btn--primary` into the navy primary; `scribe-btn` / `pipe-url-modal__secondary` / `oneflow-google__client-id-save` into one secondary; `runs-status-badge`, `dp-stratum-card__badge`, `discovery-drawer__chip` and `doctor-keep-alive-pill` into one status chip with tones; `.modal-input` and `.fp-input` into the warm input.
- **Retire:** the gradient wizard primary, `.btn-modal-primary` (white on `#59cb89`), the teal `.profile-ai-copy-btn`, the translucent `.settings-select`, and the cool `modal-card` / `profile-source-card` / `dp-stratum-card` surfaces.

### M6. Type

- **Faces declared.** `vendor/fonts/fonts.css` declares 6 families as 25 family·weight·style faces in 118 `@font-face` blocks (49 KB, render-blocking): Geist 300–700; JetBrains Mono 400–600; Caveat 500/600/700; DM Sans 300–800 plus 400i; Lora 400/400i/600; Source Sans 3 400–700.
- **Faces loaded.** On the signed-in first paint, 15 faces load, including 6 DM Sans faces: `document.fonts` with status `loaded` in `checks-out.txt`.
- **Families that render**, with element counts over all sampled states: JetBrains Mono 4,352, Geist 4,125, Caveat 427, Lora 273, DM Sans 40. Source Sans 3 never renders.
- **Special Elite** is named in `role-case.css:367` and `style.css:177` but is not vendored.
- **Caveat.** `tokens-v2.css:103` reserves it for h1/h2 and `.jb-handwritten`. It is used through `--jb-font-display` or a literal in 12 sheets, including onboarding-celebration, dawn (7), pipeline (4), role (2), recruiter-strip, today, welcome and oneflow (3). Those uses include labels such as "about 15 min left", "Recruiter CRM" and score stickers. `.jb-handwritten` is defined twice (`jb-v2.css:75`, `jb-type.css:92`, with different colours) and is referenced by no JS or HTML.
- **Declared scale.** `jb-type.css` declares 7 steps (`--jb-text-xs…3xl`); h5 and h6 reuse sm and xs.
- **Actual scale:**
  - **Rendered:** 50 distinct computed font sizes, 121 family·weight·size combinations, and 5 weights (400, 500, 600, 700, 800).
  - **Declared:** 69 distinct literal `font-size` values across the CSS.
  - **Most-rendered sizes:** 12px, 10px, 11px, 13px, 14px, 13.23px, 10.5px.
  - **Below the scale floor:** `font-size: 10px` is declared 43 times and `11px` 56 times, both under the `--jb-text-xs` floor of 12px.

## Findings

| id | lens | surface | file:line | evidence | type | severity | user impact | fix | effort | label |
|---|---|---|---|---|---|---|---|---|---|---|
| DS-01 | design-system | all surfaces (token layer) | style.css:25, tokens-v2.css:36, tokens-v2.css:44, style.css:159 | `--text: #003851;` versus `--jb-ink: #1B2B33;` versus `--jb-navy: #0E3A4E;` versus `--navy: #1B2A4E;` (M2) | system | P1 | Brand colours drift from screen to screen (four navies, three mints live at once), so the product reads as several apps stitched together and every new surface picks its palette by accident. | Make `tokens-v2.css` the only place values live. Rewrite `style.css :root` so every legacy name is an alias (`--text: var(--jb-ink)`, `--accent: var(--jb-mint)`, `--navy: var(--jb-navy)` …), then codemod v2 sheets off legacy names file by file. | M | confirmed |
| DS-02 | design-system | Role dossier (Case) | style.css:159-177, role.css:222-225, role-case.css:19-32 | `--radius-md: 10px` in role.css versus `0.5rem` in style.css; screenshot `audit/shots/design-system/signed-in-dossier-1440.png` | system | P2 | The dossier uses a third palette and a serif (Lora, `#1B2A4E`, parchment, crimson) that sits next to the v2 navy page header, so the flagship screen looks like it belongs to another product. | Promote the Direction F values into `--jb-*` tokens (`--jb-parchment`, `--jb-crimson`, `--jb-font-serif`), delete the local `--surface/--border/--radius-*/--mute` redefinitions in role.css and role-case.css, and point `.case` at them (feat/casefit adds 6 more `--crimson` uses, so land this after it merges). | M | confirmed |
| DS-03 | design-system | onboarding celebration, settings, materials, brief | css/onboarding-celebration.css:60, settings-tabs.css:80, css/legacy-materials.css:1090, css/legacy-brief.css:1265 | `padding: var(--space-7) var(--space-7) var(--space-6);` computes to `0px` (checks.mjs `celebrationCard`) | bug | P2 | The "you're set up" celebration card renders with zero padding; four other headings and skeletons silently lose their size. 34 tokens are referenced but never defined, including 8 phantom `--jb-*` names (`--jb-cream`, `--jb-mute`, `--jb-rose-soft`, …) whose hex fallbacks are the real value. | Define the missing scale steps (`--space-7`, `--space-9`, `--space-14`, `--text-md`, `--danger`) as aliases in the token file, replace the phantom `--jb-*` names with real tokens, and add an "undefined var without fallback" check to lint-tokens (DS-15). PR #104 touches settings-tabs.css but does not fix line 80. | S | confirmed |
| DS-04 | design-system | Role dossier, application materials panel | role.css:494 | a lone `}` after the `@media (prefers-reduced-motion)` block; CSSOM has no `body.jb-v2 .brief-materials` rule (checks.mjs `roleHasRootRule: false`) | bug | P2 | The materials panel loses its card chrome (padding, border, crimson rail, radius, shadow) because the browser discards the rule that follows the stray brace. | Delete the stray `}` at role.css:494 and add a brace-balance check to the CSS lint. | S | confirmed |
| DS-05 | design-system | all surfaces (buttons) | jb-ui.css:1 (no button primitive), today.css:130, pipeline.css:168, dawn.css:435, scribe.css:169, role-case.css:132, css/legacy-brief.css:1853, css/legacy-discovery-setup-wizard.css:1095, css/oneflow.css:1769 | `audit/shots/design-system/components-buttons-1440.png` (72 looks, 158 signatures) | system | P1 | A stranger cannot learn what "the main action" looks like: across the path to a tracked application, the primary button is navy, then mint, then a mint gradient, then dossier-navy, and pill or square changes by screen. | Add `.jb-btn` (primary, secondary, ghost, icon; sm and md) plus a `<button class="jb-btn">` recipe to `jb-ui.css` and JB-UI.md, then migrate the 10 primary treatments first and keep `data-action` attributes untouched. | L | confirmed |
| DS-06 | design-system | Beat 1 "Continue with Google", Settings "Save & reload", discovery Run, Scribe Done/Refine, active sort chip | css/legacy-discovery-setup-wizard.css:1096-1097, css/legacy-brief.css:1857-1858, scribe.css:170-171 | `background: var(--jb-mint); color: var(--jb-ink-inverse);` at 2.0:1 (white on #59cb89 = 2.03, #FFFEF9 on #5FCB8E = 2.00, navy #0E3A4E on #5FCB8E = 6.01) plus `audit/shots/design-system/greenfield-beat1-1440.png` | tweak | P1 | The first button a stranger must press, and the save button in Settings, have text too faint to read comfortably, well under the 4.5:1 AA floor. | Add `--jb-on-mint: var(--jb-navy)` to tokens-v2.css and use it for every mint fill (or fill with `--jb-mint-deep` and keep paper text); one token change fixes all five buttons. | S | confirmed |
| DS-07 | design-system | settings modal, discovery drawer, runs log, materials modal, one-flow shell | css/legacy-*.css (see M4 table) | `.btn-modal-primary {` lives in css/legacy-brief.css:1853; 8 of 11 legacy sheets show coverage-used rules under jb-v2 (`legacy-live-out.txt`) | system | P2 | Contributors cannot tell which CSS is safe to change: sheets named "legacy" style the live settings, drawer, runs and onboarding chrome, so either a "cleanup" breaks them or nobody dares touch them. | Rename each live legacy sheet for the surface it owns (for example `legacy-discovery-drawer.css` becomes `discovery-drawer.css`) and move the shared modal and drawer chassis out of `legacy-brief.css` and `legacy-cards-drawer.css` into one `overlay.css` (order under "Path off legacy-*.css"). | M | confirmed |
| DS-08 | design-system | dashboard (jb-v2) | jb-v2-legacy-hide.css:37-41, jb-v2-legacy-hide.css:130-134 | about 791 of 3,294 DOM nodes are built by app.js and then hidden (`.command-strip` 178, `main.main-content` 527, `.top-bar` 17, `#resumeGenerateModal` 69; checks.mjs `hiddenHosts`) | system | P2 | Every dashboard load renders the whole legacy brief and kanban and then hides them, which costs a quarter of the DOM and keeps two sets of CSS fighting through 7 `!important`s. | Gate the legacy brief and board renderers in app.js on `!body.jb-v2`, then delete the hide rules. Touches `.pipeline-board` and `#pipelineSection`, so keep the `data-action`, `data-stable-key` and PIPELINE-CARDS-HANDOFF selectors on the v2 board as they are. | M | confirmed |
| DS-09 | design-system | Lattice, Welcome, legacy dossier | index.html:219 (lattice.css), index.html:230 (welcome.css), index.html:224 (role.css); lattice.js:25; welcome.js:89; jb-v2-legacy-hide.css:97 | lattice.css 98 rules, 1 matched; welcome.css 20 rules, 1 matched (host only); role.css 166 rules, 17 matched (M3) | system | P2 | About 62 KB of render-blocking CSS is downloaded on every load for renderers that never show: Lattice is the "LOSING_RENDERER", Welcome only reveals for `data-mode="onboarding"` but welcome.js sets `"empty"`, and role.css was superseded by role-case.css. | Unlink lattice.css and welcome.css (and their scripts) once their tests are re-pointed, move the 16 live `.jb-shelf`/`.jb-hint` rules from role.css into `role-case.css` or `scribe.css`, and delete the rest of role.css after feat/casefit lands. | S | confirmed |
| DS-10 | design-system | discovery drawer, settings, materials modal, Beat 1, dossier shelf | css/legacy-discovery-drawer.css:206, settings-tabs.css:107, css/legacy-profile-modal.css:251, role.css:134, css/oneflow.css:107 | `.discovery-drawer__title` wants 24px, gets 36px; `.settings-setup-block__title` wants weight 700, gets 400; `.profile-dropzone__title` 600, gets 400 (`cascade-trap-out.txt`, 12 font-size/weight hits in 7 sheets) | tweak | P2 | Titles in Settings and the materials modal render at body weight and the drawer title renders 50% too large, so the hierarchy a stranger scans is flattened in some places and shouting in others. | Scope each rule under its root (`.settings-modal .settings-setup-block__title`, `.detail-drawer--discovery .discovery-drawer__title`, …) or lower `jb-type.css` h*/p rules to `:where(body.jb-v2) h3` (0,0,1) so any class wins. The `:where` option is one edit that clears the whole trap. PR #104 touches settings-tabs.css. | S | confirmed |
| DS-11 | design-system | all surfaces (type) | jb-type.css:28-83, tokens-v2.css:114-120 | 7 declared steps versus 50 rendered computed sizes; `font-size: 10px` ×43 and `11px` ×56 below the `--jb-text-xs` floor of 12px (M6) | system | P2 | Text sizes wander (10, 10.5, 11, 11.15, 11.5, 12, 12.14, 13, 13.23 px …), so eyebrows and labels are too small to read on phone and nothing lines up across sections. | Add `--jb-text-2xs` (10px) and `--jb-text-label` (11px mono, uppercase tracking) tokens that match what the design actually uses, cap the ramp at 9 steps, and codemod literal font-sizes in v2 sheets onto it. | M | confirmed |
| DS-12 | design-system | fonts (all surfaces) | style.css:106, vendor/fonts/fonts.css:1 | `--font-body: "DM Sans", …`; 6 DM Sans faces load on the signed-in first paint to render 40 elements; Source Sans 3 (28 @font-face, 164 KB) never renders | tweak | P2 | Strangers download fonts the v2 UI barely uses, and a 49 KB render-blocking `fonts.css` delays first paint on slow connections. | Point `--font-body` and `--sans` at `var(--jb-font-body)` (Geist), drop the Source Sans 3 and DM Sans faces from fonts.css, and keep only Latin subsets for Caveat and Lora. | S | confirmed |
| DS-13 | design-system | Brief, Pipeline, one-flow, dossier (display face) | tokens-v2.css:103, jb-v2.css:75, jb-type.css:92 | `Caveat: reserved for h1/h2 + .jb-handwritten only.` yet it renders on 427 elements in 12 sheets, including labels such as "about 15 min left" (`audit/shots/design-system/greenfield-beat1-1440.png`) | tweak | P3 | Handwriting at small sizes ("Recruiter CRM", step timers) is hard to read and weakens the brand face's job as the headline voice. | Decide the rule in writing: keep Caveat for headings plus a named `.jb-handwritten` accent. Swap sub-14px Caveat labels to mono, remove the duplicate `.jb-handwritten` block in jb-v2.css, and ship one Caveat weight. | S | confirmed |
| DS-14 | design-system | discovery drawer and every overlay | style.css:1371-1375, css/legacy-cards-drawer.css:486-489, css/onboarding-celebration.css:33 | `audit/shots/design-system/discovery-open-1440.png` (toasts cover the drawer's Run footer); 27 z-index values from -1 to 100002 | system | P2 | Error toasts (z 1000) land on top of the discovery drawer's primary button (z 800), so a stranger trying to start a first search has to dismiss toasts to reach it. | Add a z-index scale to tokens-v2 (`--jb-z-sticky 40`, `--jb-z-drawer 800`, `--jb-z-modal 2000`, `--jb-z-toast 2100`, `--jb-z-wizard 3200`, `--jb-z-celebration`), and move the toast stack to top-center or offset it by the drawer width while `body.detail-open` is set. | S | confirmed |
| DS-15 | design-system | tooling | tools/lint-tokens.mjs:14-19, package.json:69-73 | `HEX_RE = /#(?:[0-9a-f]{8}\|…)/`; allow-lists `style.css` and `settings-tabs.css`; referenced by no npm script or workflow | system | P2 | Nothing stops drift: 459 distinct literal colours pass because the linter only sees hex, only in v2-marked files, and never runs in CI. | Extend lint-tokens to rgb/hsl, undefined `var()` without fallback, and brace balance across all 36 linked sheets, with a committed baseline file so only new literals fail, and wire `lint:tokens` into `lint:repo`. | S | confirmed |
| DS-16 | design-system | token file | tokens-v2.css:21-99 | 11 same-value collisions (`--jb-rose = --jb-err = --jb-stage-rejected = #C0392B`); 7 tokens unused (`--jb-ok-bg`, `--jb-err-bg`, …) while jb-v2.css:108-111 hardcodes `rgba(34, 197, 94, 0.13)` status tints | system | P3 | Contributors cannot tell a primitive from a semantic token, so they bypass both and hardcode tints (the Tailwind greens and ambers in `.jb-applied-age` and `.dp-stratum-card__badge`). | Split tokens-v2 into a primitive tier (`--jb-navy-700`, `--jb-mint-400`, …) and a semantic tier that only aliases it (`--jb-err: var(--jb-rose)`), use the existing `*-bg` tokens in jb-v2.css and the badges, and delete the 26 never-used tokens across both files. | S | confirmed |
| DS-17 | design-system | settings modal, discovery drawer, runs, materials modal | css/legacy-brief.css:1853, css/legacy-materials.css (modal-card), style.css:10-16 | `audit/shots/design-system/settings-open-1440.png`: cool `#ffffff` / `#e2e8f0` / `#f1f5f9` panels over the warm `#FFFEF9` page | system | P2 | Every setup overlay a stranger opens switches from warm paper to a cool slate admin look, which reads as unfinished. | After DS-01, alias `--surface`, `--surface-2`, `--border` and `--bg-raised` to the warm `--jb-paper`, `--jb-paper-2` and `--jb-line-soft` so all legacy overlays warm up in one change; then check contrast on the tinted section blocks. | S | inferred (the alias effect is not yet rendered) |
| DS-18 | design-system | inputs (settings, discovery, fit profile, pipeline, dossier) | style.css (`.modal-input`), fit-profile.css (`.fp-input`), pipeline.css (`.pipe-tool__search-input`), role-case.css:367 | `audit/shots/design-system/components-inputs-1440.png` (11 looks, 46 signatures) | system | P2 | Form fields change fill, border and radius between Settings, Fit Profile, the discovery drawer and the dashboard, so the setup forms don't feel like one flow. | Add `.jb-field` / `.jb-input` / `.jb-select` to jb-ui.css (warm paper, `--jb-line`, 8px, `--jb-shadow-focus`) and migrate `.modal-input`, `.fp-input` and `.settings-select` onto it. | M | confirmed |
| DS-19 | design-system | chips and status badges | css/legacy-discovery-runs.css (`.runs-status-badge`), css/legacy-discovery-drawer.css (`.dp-stratum-card__badge`, `.discovery-drawer__chip`), role-case.css (`.case__chip`), css/oneflow.css (`.oneflow-demo__score`) | `audit/shots/design-system/components-pills-1440.png` (28 looks, 58 signatures) | tweak | P3 | The same idea ("ready", "partial", "high fit") is shown in different colours and shapes on different screens, which weakens scanning. | Add a `.jb-chip` with `data-tone="ok|warn|err|info|stage-*"` driven by the status and stage tokens, and fold the five badge families into it. | M | confirmed |
| DS-20 | design-system | jb-ui / jb-deco primitives | jb-ui.js:466-470, jb-deco.css:12-136 | `<jb-spark>` and `<jb-kbd>` are used by no file; `<jb-fit-ring>` is used only in scribe.js; 9 jb-deco classes (`jb-tape`, `jb-mark`, `jb-underline-*`, `jb-shadow-*`) are referenced by 0 JS/HTML; jb-deco has 14 of 16 rules unmatched | system | P3 | The documented component kit is not what the product uses, so contributors reading JB-UI.md build against primitives no screen renders. | Adopt `jb-fit-ring` for the pipeline sticker fit badge and the dossier score, delete `jb-spark`, `jb-kbd` and the unused deco classes (or mark them experimental in JB-UI.md), and list real primitives only. | S | confirmed |
| DS-21 | design-system | spacing, radius, shadow | tokens-v2.css:122-142 | tokens-v2 has no spacing scale; 86 literal spacing values, 39 distinct radii (`999px`, `9999px`, `100px` and `50%` all mean "pill"), 103 distinct box-shadows against 4 `--jb-shadow-*` tokens (M1) | system | P3 | Padding, corner and depth vary slightly on every card and button, which reads as sloppy. | Add `--jb-space-1…12` (4px base, aliased from `--space-*`), standardise pills on `--jb-radius-pill`, fold shadows onto the four jb tokens, and codemod v2 sheets. | M | confirmed |
| DS-22 | design-system | docs | DESIGN.md:16 | `All colors, type, and spacing come from style.css :root` | tweak | P3 | A contributor following the design doc extends the legacy system, which widens the split this audit measures. | Rewrite the "Visual tokens" section: tokens-v2 is the source, legacy names are aliases only, new CSS scopes under its region root (cascade trap), and `lint:tokens` must pass. | S | confirmed |
| DS-23 | design-system | dossier notes | role-case.css:367, style.css:177 | `font-family: "Special Elite", var(--mono);` (Special Elite is not vendored) | tweak | P3 | Notes render in JetBrains Mono for most strangers but in a typewriter face for anyone who happens to have Special Elite installed, so the same screen differs by machine. | Drop "Special Elite" from both stacks (or vendor it deliberately). | S | confirmed |
| DS-24 | design-system | legacy view | index.html:303, `?jb-v2=0` | `audit/shots/design-system/legacy-view-default-1440.png` (DM Sans, slate, donut chart, a different product) | system | P2 | Keeping a full second design reachable by URL is why roughly 250 KB of legacy CSS cannot be deleted and why every fix must be made twice. | Decide to retire `?jb-v2=0` (keep the flag as a no-op for one release), which unlocks deleting the dead parts of legacy-brief, legacy-cards-drawer, legacy-materials and style.css. | S (decision) / M (deletion) | confirmed |

Counts: 24 findings.
- **By type:** system 15, tweak 7, bug 2, hole 0, feature 0.
- **By severity:** P0 0, P1 3, P2 15, P3 6.

## Top five (impact ÷ effort)

1. **DS-06** (P1, S). One token (`--jb-on-mint`) fixes the unreadable text on the first button of onboarding, on Settings save and on Scribe's primary. It is the highest-leverage change on the path to a first application.
2. **DS-04** (P2, S). Deleting one character restores a whole rule (the materials panel chrome). It proves the CSS has no parse-safety net.
3. **DS-03** (P2, S). Defining five missing scale steps gives the celebration card its padding back and stops headings from silently losing size. It also exposes the 8 phantom `--jb-*` tokens.
4. **DS-01** (P1, M). Aliasing `style.css :root` to `--jb-*` collapses four navies and three mints into one palette. It warms every legacy overlay for free (DS-17) and is the prerequisite for everything below.
5. **DS-15** (P2, S). Wiring a baseline-aware `lint:tokens` into CI stops the split from growing again. Both in-flight branches (#104, feat/casefit) currently add legacy-token CSS.

## Path off legacy-*.css

This order depends on DS-01 (the alias layer) landing first.

1. **Delete outright once `?jb-v2=0` is retired (DS-24).**
   - **legacy-cards-drawer.css:** 224 of 229 rules. First move the 5 `.detail-overlay` / `.detail-drawer` chassis rules to a new `overlay.css`.
   - **legacy-brief.css:** roughly 240 of 305 rules. The `.brief-*`, `.command-strip` and feed/widget rules are dead under v2. First move `.modal-overlay`, `.btn-modal-primary`/secondary and the `.settings-discovery-callout*` rules to `overlay.css` and `settings-tabs.css`.
   - **legacy-login-gate.css:** keep the 3 pre-paint rules in `style.css`. The rest is used only by the pre-auth gate, which one-flow replaced; confirm the gate state is unreachable first.
   - **Also:** lattice.css and welcome.css (not legacy-named, but dead; DS-09).
2. **Fold into surface sheets, and rename rather than rewrite.**
   - `legacy-discovery-drawer` + `legacy-fit-profile-overlay` (its 4 live rules, including `.discovery-drawer__footer`) + `legacy-discovery-coachmark` (1 rule) → `discovery-drawer.css`.
   - `legacy-discovery-runs` → `runs-log.css`.
   - `legacy-profile-modal` → `materials-modal.css`.
   - `legacy-settings-profile` + settings parts of `legacy-materials` (`.settings-modal-head`, `.settings-details`, `.settings-select`, …) → `settings-tabs.css`, after PR #104 merges.
   - The `.btn-materials` icon-button rules in `legacy-materials` → `flowing-chrome.css`, which owns `.page-top`.
   - `legacy-discovery-setup-wizard` (the one-flow shell chassis) → merge into `css/oneflow.css`.
3. **Order of work.**
   1. DS-01 aliases.
   2. The renames (step 2), which carry zero visual change and can be verified by screenshot diff.
   3. The overlay chassis extraction.
   4. The `?jb-v2=0` retirement decision.
   5. Gating app.js legacy renderers (DS-08).
   6. Deleting the dead files (step 1) and the `jb-v2-legacy-hide.css` rules they make unnecessary.
   7. Codemodding legacy token names out of the v2 sheets, one surface per PR.
4. **Cost of the order.** Steps 1–2 can run in parallel with PR #104 and feat/casefit if they avoid settings-tabs.css and role-case.css until those branches merge.

## Not covered

- **Unsampled states.** Materials queue with items, a live discovery run, Beats 2–6 of one-flow (they need Google OAuth, which the fence blocks), the celebration overlay, the expired-review and LinkedIn-capture modals, and print styles. The "unmatched" and coverage numbers for `materials-queue.css`, `css/oneflow.css`, `onboarding-celebration.css`, `fit-profile.css` and `role-case.css` are therefore inferred upper bounds. The celebration padding bug was verified with a probe element, not a rendered celebration.
- **Selector-match method.** Stripping pseudo-classes and matching hidden elements overcounts live rules. The "matched visibly" column in M3 covers only the signed-in default at 1440.
- **Cascade-trap probe.** It compares line-heights against a probe element with a different font-size, so its line-height hits are noisy and were excluded. Only the font-size and font-weight hits are cited in DS-10.
- **Contrast.** Contrast was measured only for the mint-button token pairing (DS-06). A full contrast audit belongs to the accessibility lens.
- **`visual-themes.js`.** It holds five résumé-preview theme descriptors (id, label, description) and no CSS tokens, so it has no bearing on the design system and was not audited further.
- **Handed to the responsive lens, not filed here.** At 375 the settings tab strip scrolls the selected "Setup" tab out of view while its panel shows (`audit/shots/design-system/settings-open-375.png`).
- **Font network cost.** Measured as faces loaded in `document.fonts`, not bytes transferred over the fenced loopback.
- **Harness safety stop (coordinator notice, received about 05:44 CDT).** My browser runs used the pre-patch harness, so same-origin `/__proxy/*` and `/profile/*` calls could reach the live local API. I never clicked a control that saves, verifies, starts, installs, fixes or drafts. I did click controls that *open* things, and opening them may have fired background status calls. Runs and clicks:
  - `runtime.mjs`, 05:31–05:35: opened Settings (clicked tabs only), the discovery drawer via #discoveryBtn (opens the pre-run drawer; no Run clicked), the runs log, the materials modal, the auth menu and the add-URL modal; clicked "Make it mine" and "Poke around first".
  - `checks.mjs`, 05:36: page loads only.
  - `legacy-live.mjs`, 05:37–05:39: the same overlays plus the discovery sub-tabs Sources, Automation, Connection and History (tab buttons only).
  - `pagetop.mjs`, 05:40: page load only.
  - `cascade-trap.mjs`, 05:39–05:41:00: opened Settings, the discovery drawer and materials; clicked "Make it mine".
  - **Overlap with the incident.** The cascade-trap run ends at the 05:41 window you reported. I cannot rule out that opening the discovery drawer or Settings then triggered a background `/__proxy` call, so treat that run as a possible contributor.
  - **After the notice.** I ran no browser sessions after receiving it, and nothing here was re-run on the patched harness.
