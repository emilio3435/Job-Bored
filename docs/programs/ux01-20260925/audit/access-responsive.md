# UX01 audit — Access and responsive

Lens: access and responsive · Surfaces: whole app (greenfield demo board, one-flow Beat 1, signed-in dashboard, discovery drawer, Settings, role dossier, Scribe, stage menu, top chrome) · Worktree commit `f227fbb` · 2026-09-25

## Method

- Harness: `docs/programs/ux01-20260925/audit/tools/audit-harness.mjs` (`openApp`, `shoot`, `runAxe`, axe-core tags wcag2a/2aa/21aa/22aa). Modes: `greenfield`, `signed-in`. Viewports: 1440×900 and 375×812, plus 320×700 and 393×760 for the breakpoint check.
- Every number below comes from a script in `/private/tmp/claude-501/-Users-emilionunezgarcia-Job-Bored/24e49a9b-ec72-4e6c-881a-2d26d8c40cbf/scratchpad/ux01/access-responsive/` (referred to as `$S`). Run each one from the worktree root with `node $S/<script>`.

| Script | Measures |
|---|---|
| `states.mjs both` | axe (full page, plus scoped to the overlay), horizontal overflow, elements wider than the viewport, and interactive elements under 44 and under 24 px, for 8 states × 2 widths. Output: `$S/states-both.json` |
| `contrast.mjs desktop` | axe color-contrast node data (foreground, background, ratio, font size). Output: `$S/contrast-desktop.json` |
| `keyboard2.mjs` | Phased keyboard walk: drawer containment, Run discovery → stage move, dossier open/close, Settings containment |
| `keyboard.mjs` | Tab order through the top chrome (steps 1–14 only; the later phases of this script were invalid and were replaced by `keyboard2.mjs`) |
| `move.mjs`, `move2.mjs` | Stage-menu live announcement; Applied confirm cancelled with Escape (Sheet writes counted) |
| `checks.mjs` (`BEAT1=1` adds Beat 1), `inert-ax.mjs` | Beat 1 modality, inert pointer and AX tree, toast semantics, top chrome and Settings tabs at 375 |
| `obscured.mjs desktop\|phone` | WCAG 2.4.11: 150 Tabs, hit-testing the centre of each focused element |
| `tabcount.mjs`, `pills.mjs` | Count of tab stops, skip links, landmarks; whether section pills move focus; Escape on the mobile menu |
| `motion.mjs`, `motion-control.mjs` | Reduced motion: `emulateMedia` → `matchMedia` assertion → running `document.getAnimations()` |
| `payload2.mjs` (`NOCOV=1` for request counts) | Cold signed-in load at 1440: requests and bytes by type, tag counts, coverage, paint timings |
| `coarse.mjs`, `w320.mjs`, `scribe320.mjs`, `geom.mjs`, `card.mjs` | `pointer: coarse` and the 320/393 breakpoints; overflow at 320; stage-menu hit-tests; computed focus style on a card |

Contrast ratios I computed by hand (focus halo, candidate tokens) use the WCAG relative-luminance formula in an inline `node -e` script. Both the formula and its inputs are quoted in the findings.

## Measurements

### 1. axe (violations counted by rule, then by impact)

"Full" runs axe on the whole document. "Scoped" runs it on the overlay root only, so dashboard noise is not counted twice. Inert background content is excluded automatically.

| State | Width | Full: crit / ser / mod / min | Full: rules (nodes) | Scoped: crit / ser (rules) |
|---|---|---|---|---|
| Demo board (greenfield) | 1440 | 1 / 1 / 0 / 0 | aria-required-children(1), color-contrast(31) | — |
| Beat 1 ("Make it mine") | 1440 | 1 / 1 / 0 / 0 | aria-required-children(1), color-contrast(37) | — |
| Signed-in dashboard | 1440 | 2 / 2 / 0 / 0 | aria-required-children(2), aria-valid-attr-value(1), color-contrast(89), nested-interactive(2) | — |
| Discovery drawer open | 1440 | 0 / 1 / 0 / 0 | color-contrast(11) | `#discoveryDrawer` 0 / 1 (color-contrast 11) |
| Settings open | 1440 | 0 / 1 / 0 / 0 | color-contrast(2) | `#settingsModal` 0 / 1 (color-contrast 2) |
| Role dossier open | 1440 | 2 / 2 / 0 / 0 | as dashboard; color-contrast(81) | `[data-region=role]` 0 / 0 |
| Scribe | 1440 | 2 / 2 / 0 / 0 | as dashboard; color-contrast(85) | `[data-region=scribe]` 0 / 1 (color-contrast 20) |
| Stage menu open | 1440 | 2 / 3 / 0 / 0 | as dashboard + target-size(1) | — |
| Demo board | 375 | 1 / 1 / 0 / 0 | aria-required-children(1), color-contrast(14) | — |
| Beat 1 | 375 | 1 / 1 / 0 / 0 | aria-required-children(1), color-contrast(21) | — |
| Signed-in dashboard | 375 | 1 / 2 / 0 / 0 | aria-required-children(2), color-contrast(78), nested-interactive(2) | — |
| Discovery drawer open | 375 | 0 / 1 / 0 / 0 | color-contrast(10) | 0 / 1 |
| Settings open | 375 | 0 / 1 / 0 / 0 | color-contrast(2) | 0 / 1 |
| Role dossier open | 375 | 1 / 2 / 0 / 0 | as dashboard; color-contrast(70) | 0 / 0 |
| Scribe | 375 | 1 / 2 / 0 / 0 | as dashboard; color-contrast(78) | 0 / 1 (20) |
| Stage menu open | 375 | 1 / 2 / 0 / 0 | as dashboard; color-contrast(84) | — |
| **Totals (16 runs)** | | **16 / 25 / 0 / 0** | 5 unique rules: color-contrast, aria-required-children, nested-interactive, aria-valid-attr-value, target-size | |

At 375, aria-valid-attr-value disappears because the section pills are hidden behind the hamburger menu.

### 2. Keyboard, signed-in at 1440 (`keyboard.mjs` for the chrome order, `keyboard2.mjs` for the rest)

Focus order from load: 1 JobBored — home · 2 01Brief (role=tab) · 3 02Pipeline · 4 03Dossier · 5 Run discovery · 6 Open Google Sheet · 7 Portfolio · 8 Open discovery run history · 9 No postings need expired-job review · 10 Settings and setup · 11 Account menu — signed in as … · 12–14 Open and reply ×3 · Start researching · Open dossier · Start researching · Open dossier · Daily Brief leads (section) · Previous lead · Next lead · Open dossier · Draft cover letter · Mark expired · queue rows 01–05 · 7 funnel rows · Search kanban roles · Urgency · Fit · Newest · ★ Favorites · Dismissed · Add job from URL · Expand Discovered · Collapse Researching · **Staff Frontend Engineer at Kestrel — open letter (card, no visible ring)** · Edit role details · Favorite · Move to stage — currently Researching.

| Step | Result |
|---|---|
| Run discovery → first "Move to stage" | 44 Tabs. It is tab stop 49 of 77 on the page. There is no skip link. |
| Section pill "02 Pipeline" + Enter | Page scrolls to y=1904, but focus stays on the pill; the next Tab goes to "03 Dossier" |
| Drawer open (Enter on Run discovery) | Focus goes to the "Target roles" textarea. Over 60 Tabs, 0 page controls were reached; focus left only to the browser chrome, as the inert model expects. Shift+Tab ×30: the same. Escape closes and focus returns to Run discovery. The close button also returns focus to Run discovery. |
| Stage menu | Enter opens it with focus on "Discovered"; the arrow keys move; Escape returns focus to the trigger; Enter moves the card, focus stays on the relabelled trigger, and the polite region says "Moved to Discovered". |
| Applied confirm → Escape | Nothing is written (0 Sheet writes; the card stays `researching`), yet the trigger reads "currently Applied" and the live region says "Moved to Applied" (AX-03) |
| Dossier open (Enter on a card) | **Focus → `<body>`**. It then takes 29 Tabs from the card to reach "Close this role". |
| Dossier close (Enter on ×) | **Focus → `<body>`**. The next Tab lands on the shelf CTA inside the role region. |
| Settings | Focus goes to Close on open; 30 Tabs cycle inside the modal; Escape returns focus to "Settings and setup" |
| Beat 1 | aria-modal dialog; focus goes to "Close wizard"; Tab cycles through 4 stops; Escape closes and returns focus to "Make it mine" |
| Focus not obscured (150 Tabs) | 1440: 1 control covered (Cover letter draft body, under the sticky refine strip). 375: 3 controls covered (Account menu under the hamburger; Collapse Researching and the Kestrel card under a collapsed column). |

Screenshots: `focus-run-discovery-1440.png`, `focus-settings-icon-1440.png`, `focus-drawer-open-1440.png`, `focus-drawer-tab-1440.png`, `focus-move-to-stage-1440.png`, `focus-card-article-1440.png`, `focus-dossier-close-1440.png`, `focus-beat1-tab-1440.png`, `focus-obscured-1440.png`, `focus-obscured-375.png`.

### 3. Contrast (`contrast.mjs desktop`: 170 failing nodes over 5 states)

| Group | Foreground on background | Ratio | Need | Where |
|---|---|---|---|---|
| White on mint primary buttons and the active sort chip | #FFFEF9 on #5FCB8E / #FFF on #59CB89 | 1.99–2.03 | 4.5 | Urgency chip, Scribe Done and Refine, drawer Run discovery, Settings Save & reload |
| Set up Fit Profile CTA | #2F8A5A on #59CB89 | 2.10 | 4.5 | drawer banner |
| `--jb-ink-3` muted captions and mono eyebrows | #6B8493 on #FFFEF9 / #FBF7EE | 3.88 / 3.67 | 4.5 | Today eyebrow and counts, item eyebrows and details, Brief deck, Scribe kickers and empty states, Beat 1 spine labels (9.6 px) |
| Legacy `--text-faint` labels | #7A9AAB on #F8FAFC / #FFF | 2.85 / 2.98 | 4.5 | drawer field labels (10 px bold), Settings OAuth label, footer |
| Demo board under `opacity: .82` | #869AA5 on #FFFEF9 | 2.89 | 4.5 | column titles, DEMO chips (9 px), "why" lines |
| Fit chips (demo) | #549F77 on #E2F3E6; #B27E33 on #FBE7CC | 2.75; 2.93 | 4.5 | "94% fit" and similar |
| Dimmed pipeline card (opacity .78) | #8B9DA7 on #FEFCF7; company #5CA27B | 2.73; 2.96 | 4.5 | Recruiter CRM labels, company eyebrow |
| Brief queue company on mint tint | #EF8F26 on #DCF1E2 | 2.05 | 4.5 | queue rows (10 px bold) |
| Inactive nav pill number | #96A7AB on #FBF7EE | 2.33 | 4.5 | "02", "03" |
| Focus halo `--jb-shadow-focus` (non-text) | rgba(89,203,137,.35) composites to #C5ECD2 on #FFFEF9 | 1.28 | 3.0 | every chrome icon and chip focus |

Contrast was measured at 1440 only. At 375 axe finds the same selectors, with 70–84 nodes per state.

### 4. Layout at 375 (`states.mjs`, `geom.mjs`, `checks.mjs`, `w320.mjs`)

`documentElement.scrollWidth - innerWidth` is 0 in every state at 375. Every element wider than the viewport sits inside a scroll container.

| State | Page overflow | Elements past the viewport edge (clipped or scrolled) | Interactive | < 44 px | < 24 px |
|---|---|---|---|---|---|
| Demo board | 0 | 0 | 10 | 2 | 0 |
| Beat 1 | 0 | 0 | 18 | 10 | 2 (detour `summary` 275×19, Cloud Console link 175×19) |
| Dashboard | 0 | 3 `section.pipe-col` | 75 | 60 | 2 (audit log link 59×17, footer "Open Sheet" 72×17) |
| Drawer (scoped) | 0 | `#dd-tab-history` right=431 | 29 | 25 | 1 (`summary` "Excluded companies" 317×19) |
| Settings (scoped) | 0 | 6 tabs, 293 px each, in a 293 px strip | 16 | 14 | 0 |
| Dossier (scoped) | 0 | 3 `pipe-col`, 3 `case__step` (Offer cut off) | 21 | 19 | 0 |
| Scribe (scoped) | 0 | 3 `pipe-col` | 15 | 11 | 1 |
| Stage menu open | 0 | 3 `pipe-col`; all 8 menu items hit-test to `pipe-col` / `pipe-shell` | 83 | 60 | 2 |
| **320 px, signed-in** | **40 px** | `div.auth-section` right=337; `header.scribe-topbar`, `div.scribe-split`, `footer.scribe-strip` at 344 px | 75 | 60 | — |
| 320 px, greenfield | 0 | 0 | — | — | — |

At 375 the focused pipeline column renders 22 px wide and its cards 26 px wide (`geom.mjs`). The account button shows 10 px of its 36 px inside a scrolling action pill whose scrollbar is hidden.

### 5. Reduced motion (`motion.mjs`, `motion-control.mjs`)

| State | `matchMedia(reduce)` | Running animations |
|---|---|---|
| Demo board | true | 0 |
| Dashboard | true | 0 |
| Dossier open | true | 8 transitions of 0.01 ms (nav pill colours; the global reduce override) |
| Discovery drawer open | true | 0 |
| Celebration (`JobBoredOnboardingCelebration.playOnboardingCelebration`) | true | 2 caret-color transitions of 0.01 ms; 0 confetti |
| Control: celebration, no-preference | false | 32 (28 celebrationConfetti, celebrationPop, celebrationBounce, 2 celebrationRise) |

Reduced motion passes. Screenshot: `celebration-reduced-motion-1440.png`.

### 6. Payload: cold signed-in load at 1440, cache disabled (`NOCOV=1 node $S/payload2.mjs`, then `node $S/payload2.mjs` for coverage)

| Type | Requests | Transferred |
|---|---|---|
| JS | 118 | 2,905,721 B (2,838 KiB) |
| CSS | 36 | 728,462 B (711 KiB) |
| Fonts | 5 | 231,917 B (226 KiB) |
| Images | 4 | 473,741 B (463 KiB) |
| HTML | 1 | 208,273 B (203 KiB) |
| Other (XHR and the like) | 24 | 14,100 B |
| **Total** | **188** | **4,562,214 B (4,455 KiB)** |

- Tags: 122 `<script>` (118 with `src`) and 36 `<link rel=stylesheet>`. 3,294 DOM nodes. 0 of 224 responses compressed.
- Coverage at load plus 2.5 s idle, one entry per URL: JS 67.8% unused (890 KB used of 2,762 KB); CSS 84.8% unused (103 KB used of 681 KB). Biggest unused JS files: `discovery-wizard-ui.js` 120/127 KiB, `role-materials.js` 84/101, `discovery-drawer.js` 56/68, `settings-profile-tab.js` 53/83. Biggest unused CSS files: `css/oneflow.css` 52/53, `vendor/fonts/fonts.css` 48/48, `role-case.css` 47/47, `css/legacy-materials.css` 45/46.
- Timing on loopback: FCP 60 ms, LCP 176 ms, DCL 148 ms, load 164 ms; the first `.today-item` appears at 171 ms and the first `.pipe-sticker` at 179 ms.
- The coverage run makes CSS appear twice in the network log (224 requests), so the request counts above come from the `NOCOV` run.

### 7. JB-A11Y.md "NEEDS BROWSER VERIFICATION"

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | The UA honours `inert` for pointer, Tab and the AX tree | **verified** | CDP `getFullAXTree`: "Open and reply" nodes go from 9 to 0 with the drawer open. 60 Tabs reach 0 page controls. A mouse click on the inert "02 Pipeline" pill leaves scrollY at 0 and closes the drawer through the backdrop (`inert-ax.mjs`, `checks.mjs`). |
| 2 | Tab cannot escape an open dialog | **verified** for the drawer, Settings and Beat 1 | Focus leaves only to the browser chrome (`keyboard2.mjs`, `checks.mjs`) |
| 3 | `:focus-visible` paints `--jb-shadow-focus` at every stop | **failed** | Pipeline cards paint nothing (`box-shadow: none`; AX-04). Where the halo does paint it measures 1.28:1 (AX-11). |
| 4 | A screen reader speaks the live regions, polite and assertive in order | **not reachable** (no screen reader in the harness); DOM half verified | Polite "Moved to Discovered"; the assertive region mirrors the error toast. The polite region also announces a move that never happened (AX-03). |
| 5 | Touch targets are ≥ 44 px after the cascade; the stage menu is operable on mobile | **failed** | 60 of 75 controls are under 44 px at 375. `.jb-a11y-touch-target` items do measure 44, or 58 under coarse pointer, but at 375 every menu item hit-tests to `pipe-col` (AX-02, AX-19) |
| 6 | reduced-motion, `pointer: coarse`, 320/375/393 breakpoints, keyboard inset | **partly verified** | Reduced motion verified (0 vs 32 animations); `pointer: coarse` resolves (touch targets 58 px); 375 and 393 have no overflow, but **320 overflows by 40 px** (AX-17); `keyboard-inset-bottom` needs a real soft keyboard and was not reached |
| 7 | The stage menu opens inside the card's scroll/overflow context on a real board | **failed** | At 1440 the items hit-test to the next `pipe-sticker` and recruiter strip; at 375 to `pipe-col` (AX-02; `stage-menu-1440.png`) |

## Findings

| id | lens | surface | file:line | evidence | type | severity | user impact | fix | effort | label |
|---|---|---|---|---|---|---|---|---|---|---|
| AX-01 | access-responsive | Pipeline board @375 | pipeline.css:517-520 | audit/shots/access-responsive/pipeline-squeezed-375.png | bug | P1 | On a phone, the one open column is 22 px wide and its cards 26 px, so a stranger cannot read or tap a single role in their pipeline. | Below 600 px, stack the stages vertically as an accordion, or give the focused column `minmax(280px, 1fr)` and let the board scroll sideways with the collapsed rails at 44 px; keep `.pipe-sticker`, `data-stable-key` and the handoff selectors. | M | confirmed |
| AX-02 | access-responsive | Stage menu (1440 and 375) | jb-a11y.css:221-223 | audit/shots/access-responsive/stage-menu-1440.png | bug | P1 | The "Move to stage" list draws underneath the next card (1440) or the next column (375); every item hit-tests to another element, so a mouse or touch user cannot move a role. | Render `.jb-a11y-stage-menu__list` in the top layer (`popover` attribute, or portal it to `body` with fixed positioning taken from the trigger's rect) so the card's opacity stacking context (pipeline.css:873) and `.pipe-col` `overflow: hidden` cannot trap it; keep `data-action="move-to-stage"`. | M | confirmed |
| AX-03 | access-responsive | Stage menu → Applied confirm | pipeline.js:1058-1064 | `trigger label: Move to stage — currently Applied` (after Escape; 0 Sheet writes, card still `researching`) | bug | P1 | Cancelling "Mark application submitted?" writes nothing, yet the menu announces "Moved to Applied" and relabels itself, so a screen-reader user believes the role was tracked when it was not. | Have `emitBoardMove` resolve `{ ok: false, cancelled: true }` when the submission-flow confirm returns `confirmed: false`, so `commitMove` returns false and the menu reverts its label and says "Move cancelled"; `updateJobStatus(dataIndex, stage)` is untouched. | S | confirmed |
| AX-04 | access-responsive | Pipeline card focus | pipeline.css:871-875 | audit/shots/access-responsive/focus-card-article-1440.png | bug | P1 | A keyboard user who tabs onto a role card sees no focus indicator at all: the focused-column rule sets `box-shadow: none` and beats `.pipe-sticker:focus-visible` (line 896). | Add `body.jb-v2 [data-region="pipeline"] .pipe-col[data-focused="true"] .pipe-sticker:focus-visible { box-shadow: var(--jb-shadow-focus) }`, or switch the card to `outline`, which that rule does not reset. | S | confirmed |
| AX-05 | access-responsive | Dossier open and close | role.js:246-248 | `E after Enter on card \| <body>` · `E after close \| <body>` | bug | P1 | Opening a role from the board, or closing its dossier, drops focus to `<body>`, so a keyboard or screen-reader user is thrown back to the top of a 77-stop page and needs 29 Tabs to reach the dossier's controls. | On open, focus the dossier heading (`tabindex="-1"`). On close, restore focus to the originating `.pipe-sticker[data-stable-key]`, or to the Today "Open dossier" button when that was the opener. | S | confirmed |
| AX-06 | access-responsive | Primary mint buttons (drawer Run discovery, Settings Save & reload, Scribe Refine and Done, active sort chip) | tokens-v2.css:46 | `#discoveryPrefsRun "Run discovery" #ffffff on #59cb89 = 2.03:1` | system | P1 | The main call to action on three surfaces is white text at 2.0:1, which low-vision users and anyone in bright light cannot read. | Put `--jb-ink` or `--jb-navy` text on mint (7.3:1), or darken the fill to about #1F7A4A for white text (5.3:1); apply the same change to legacy `--accent` (style.css:19) and `.pipe-tool__chip[aria-pressed="true"]` (pipeline.css:123-126). | S | confirmed |
| AX-07 | access-responsive | Muted captions and mono eyebrows app-wide | tokens-v2.css:38 | `.today-item__detail "Last contact yesterday" #6b8493 on #fffef9 = 3.88:1` | system | P2 | Status lines, counts, kickers and empty-state hints (about 60 nodes on the dashboard, many in 10–11 px mono) fall below 4.5:1, so the context a stranger needs to read is the hardest text on the page. | Darken `--jb-ink-3` to #587080 (5.1:1 on paper, 4.9:1 on paper-2) and keep eyebrow text at 12 px or larger. | S | confirmed |
| AX-08 | access-responsive | Discovery drawer and Settings labels | style.css:27 | `label[for="dpTargetRoles"] #7a9aab on #f8fafc = 2.85:1` | tweak | P2 | The labels on every discovery search field and the OAuth Client ID field are 10 px text at 2.9:1, so a first-time user struggles to see what each field asks for. | Map legacy `--text-faint` to the corrected `--jb-ink-3`, or use `--jb-ink-2` for the drawer's `.modal-label` and the Settings field labels. | S | confirmed |
| AX-09 | access-responsive | Greenfield demo board | css/oneflow.css:1401-1402 | audit/shots/access-responsive/demo-board-1440.png | tweak | P2 | The stranger's first screen renders every demo column title, chip and fit badge at 2.75–2.93:1 because the whole board is set to `opacity: .82`. | Remove the root opacity and mark the demo with the existing DEMO chips plus a tinted board background, so demo text keeps full ink. | S | confirmed |
| AX-10 | access-responsive | Unselected pipeline cards | pipeline.css:873 | `.pipe-sticker__recruiter-co "Contact" #8b9da7 on #fefcf7 = 2.73:1` | tweak | P2 | In the open column, unselected cards are dimmed to 78% opacity, which pushes their company names and CRM labels to 2.7–3.0:1. | Drop `opacity: 0.78` and signal "not selected" with a border or background change; this also removes the stacking context behind AX-02. | S | confirmed |
| AX-11 | access-responsive | Focus indicator token | tokens-v2.css:142 | audit/shots/access-responsive/focus-settings-icon-1440.png | system | P2 | The shared focus halo is 35% mint, measuring 1.28:1 against the paper (needs 3:1), so keyboard users lose their place on the icon buttons, chips and nav. | Redefine `--jb-shadow-focus` as a 2 px solid `--jb-navy` ring with a 2 px paper gap (`0 0 0 2px var(--jb-paper), 0 0 0 4px var(--jb-navy)`, 12:1). | S | confirmed |
| AX-12 | access-responsive | Top nav pills and skip route | flowing-chrome.js:178-180 | `"aria-controls": 'region-' + p.id,` (ids do not exist; axe critical aria-valid-attr-value) | bug | P2 | "02 Pipeline" scrolls the page but leaves focus in the header, and no skip link exists, so a keyboard user presses Tab 44 times after Run discovery to reach the first stage control. | Make the pills plain buttons with `aria-current` (not `role="tab"`), point them at real region ids, move focus to the region heading on activation, and add a "Skip to pipeline" link as the first tab stop. | S | confirmed |
| AX-13 | access-responsive | Pipeline card semantics | pipeline.js:953-958 | `el.setAttribute("role", "button");` (axe serious nested-interactive; name "… — open letter") | bug | P2 | Each card is a `role=button` wrapping the Edit, Favorite and Move buttons, so screen readers treat those children as presentational, and the card's name promises "open letter" when it opens the dossier. | Drop `role`/`tabindex` from the `article` and put the open action on a real `<button>` around the role title, named "Open dossier: <role> at <company>"; keep `.pipe-sticker` and `data-stable-key` (PIPELINE-CARDS-HANDOFF selectors). | M | confirmed |
| AX-14 | access-responsive | Today list and pipeline board | today.js:154 | `el("div", { class: "today-list", role: "list" })` (same pattern at pipeline.js:1198; axe critical aria-required-children) | bug | P3 | Screen readers announce "list" and then find no items, so the Today queue and the board lose their counts and navigation. | Give each Today row and each `.pipe-col` `role="listitem"`, or drop `role="list"`. | S | confirmed |
| AX-15 | access-responsive | Top chrome @375 | flowing-chrome.css:507-513 | audit/shots/access-responsive/chrome-clipped-375.png | bug | P2 | On a phone, the account button (sign-out, switch account) shows 10 of its 36 px inside a sideways-scrolling pill with a hidden scrollbar, so a stranger cannot find it. | At 600 px and below, keep Run discovery, Settings and the account button in the bar, and move Sheet, Portfolio, Run history and Expired review into the hamburger menu. | M | confirmed |
| AX-16 | access-responsive | Mobile section menu | flowing-chrome.js:207-210 | `375 menu open: true after Esc still open: true` | bug | P3 | The phone section menu does not close on Escape, and after a section is chosen it leaves `aria-expanded="true"` on the toggle (line 187 removes only the class). | Add an Escape handler that closes the menu and returns focus to `.page-top__menu-btn`, and set `aria-expanded="false"` in the pill click handler. | S | confirmed |
| AX-17 | access-responsive | Scribe at 320 (reflow, WCAG 1.4.10) | scribe.css:39-47 | audit/shots/access-responsive/signed-in-overflow-320.png | bug | P2 | At 320 px (a 1280 px window at 400% zoom), the whole app pans sideways by 40 px because the Scribe topbar keeps a 344 px minimum content width. | Add `min-width: 0` to `.scribe-topbar`, let `.scribe-topbar__role-target` wrap (scribe.css:72 `nowrap`), and wrap the actions row. | S | confirmed |
| AX-18 | access-responsive | Settings and drawer tablists @375 | settings-tabs.css:240-243 | audit/shots/access-responsive/settings-375.png | tweak | P2 | On a phone, Settings shows 1 of its 7 tabs ("Setup"), each 293 px wide, with the scrollbar hidden, so a stranger never finds Sheet, AI Providers or Fit Profile; the drawer's History tab is cut off the same way. | In the 600 px and below block, set `.settings-tablist__btn { width: auto }` and show an edge fade, or swap the tabs for a `<select>` at 375. | S | confirmed |
| AX-19 | access-responsive | Touch targets app-wide | jb-a11y.css:314-316 | `dashboard @375 … int=75 <44=60 <24=2` | tweak | P2 | 60 of 75 controls at 375 are under 44 px (chrome icons 36, column toggles 28–32, favourite 25, edit 28, funnel rows 24 tall), which causes mis-taps on the board a stranger uses daily. | Extend the `pointer: coarse` floor beyond `.jb-a11y-touch-target` to `.btn-materials--icon`, `.pipe-col__toggle`, `.pipe-sticker__edit`, `.pipe-sticker__favorite` and `.brief-funnel__row`, using `min-width`/`min-height: var(--jb-touch-min)`. | M | confirmed |
| AX-20 | access-responsive | Scribe editor focus | scribe.css:514-524 | audit/shots/access-responsive/focus-obscured-1440.png | bug | P2 | Tabbing into "Cover letter draft body" puts the caret behind the sticky refine strip, so a keyboard user types into a field they cannot see (WCAG 2.4.11). | Add `scroll-padding-bottom` equal to the strip height on the Scribe scroller, or unstick the strip while the editor has focus. | S | confirmed |
| AX-21 | access-responsive | Scribe ATS ring | scribe.js:216-217 | audit/shots/access-responsive/scribe-1440.png | tweak | P3 | The unscored ring prints "Overall ATS match not available" as visible text that spills over the "ATS match" heading, at 1440 and at 375. | Keep that string as the ring's accessible name only (visually hidden) and draw an em dash inside the ring. | S | confirmed |
| AX-22 | access-responsive | Toasts @375 | auth-session.js:540 | audit/shots/access-responsive/dossier-375.png | tweak | P2 | Opening a dossier stacks two identical 351×82 error toasts that cover about 20% of a phone screen over the dossier's stage row. | Deduplicate `showToast` by message and type while one is visible, and cap stacked toasts at one on viewports under 600 px. | S | confirmed |
| AX-23 | access-responsive | Region landmarks | index.html:347 | `<section data-region="today" aria-label="Today (v2)">` (also 356, 452, 456, 474) | tweak | P3 | Screen-reader users hear an internal build tag ("Pipeline (v2)", "Role dossier (v2)") in every landmark list. | Drop "(v2)" from the five region labels. | S | confirmed |
| AX-24 | access-responsive | Dossier shelf CTA | role.js:84 | `'<span class="jb-shelf__cta-key">⌘K</span>'` | tweak | P3 | Windows and Linux users are told to press ⌘K, a key they do not have, although the handler also accepts Ctrl (pipeline.js:1496). | Show "Ctrl K" unless `navigator.userAgentData.platform` or `navigator.platform` reports an Apple device. | S | confirmed |
| AX-25 | access-responsive | Dossier stage stepper @375 | role-case.css:152 | audit/shots/access-responsive/dossier-375.png | tweak | P3 | On a phone the six-step stage row scrolls sideways with its scrollbar hidden and a fade mask, so "Offer" and "Interviewing" are invisible and the row looks complete. | Wrap the stepper to two rows at 375 or show only the previous, current and next stages with a "+3" button. | S | confirmed |
| AX-26 | access-responsive | Cold load | index.html:190 | `scripts:122 · styles:36 · 4,562,214 B · JS 67.8% / CSS 84.8% unused · 0 of 224 compressed` | system | P3 | Loopback hides the cost (FCP 60 ms), but a hosted or low-end-device user downloads 4.4 MiB uncompressed and parses 118 scripts, two-thirds of them unused at load. | Enable gzip/brotli in `dev-server.mjs`, and lazy-load the wizard, drawer, Settings and materials bundles on first open. | L | confirmed |

## Top five (impact ÷ effort)

1. **AX-04**: one CSS rule restores the focus ring on every pipeline card, the most-used keyboard target (P1, S).
2. **AX-03**: a single return value stops the stage menu telling a screen-reader user that a cancelled Applied move was tracked, a data-trust bug (P1, S).
3. **AX-06**: one token change makes the primary CTAs on the drawer, Settings and Scribe readable, from 2.0:1 to 7.3:1 (P1, S).
4. **AX-05**: restoring focus on dossier open and close fixes the keyboard route of the core job, from card to dossier to materials (P1, S).
5. **AX-02**: moving the stage menu to the top layer makes stage moves work by mouse and touch at every width, and it closes JB-A11Y claim 7 (P1, M). Same-tier alternative: AX-01, the unusable phone board (P1, M).

## Not covered

- **Harness safety stop.** The coordinator reported that before the harness patch (applied about 05:43 CDT), the in-process server forwarded `/profile/*` and `/__proxy/*` to the host, and that a worker restart and a discovery `.env` rewrite happened at 05:41. Between 05:29 and 05:43 CDT my runs opened the discovery drawer (Escape or Close only; no control inside was clicked), opened Settings (Escape only), opened dossiers (which fire the AI-insight request that produced the "Configure your selected AI provider" toast), and made stage moves (Sheets writes are fenced by the fixture). My `motion.mjs` run opened the drawer at about 05:41:40. I never clicked Save & verify, Start worker, Fix setup, Install keep-alive, Tailscale, a draft action or "Looks like me". Whether a drawer-open GET such as `/__proxy/discovery-state` caused the 05:41 event is **unknown**. Every measurement above was re-run at or after 05:44 on the patched harness, with the same results.
- Screen-reader speech (JB-A11Y claim 4) and real soft-keyboard insets (claim 6) need a screen reader and a real device; neither is reachable from headless Chromium.
- Legacy view (`?jb-v2=0`), and the `signed-in-empty` and `signed-in-error` modes, were not swept with axe.
- Contrast was extracted at 1440 only; the 375 node counts come from the axe sweep.
- Beats 2–6 of the one-flow were not driven, because they sit behind save and verify actions the safety stop forbids. The celebration was reached through its public API, not the real B6 path.
- JS coverage is load plus 2.5 s idle with no interaction, so the unused percentages are upper bounds.
- In-flight work: no branch after `f227fbb` touches accessibility or responsive code (checked with `git for-each-ref --sort=-committerdate` and `git log --all --since=2026-09-20`), so no finding is marked fixed elsewhere.
- A few shots in `audit/shots/access-responsive/` are not cited above: they are exploratory captures and screenshots written by the check scripts.
