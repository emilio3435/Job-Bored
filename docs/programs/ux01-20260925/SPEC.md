# UX01: JobBored, zero to one

This spec draws on 189 findings from 8 audits of `origin/main` f227fbb, recorded in `audit/*.md` with screenshots in `audit/shots/`. The target user is a stranger with a Google Sheet and an AI key who wants a tailored, tracked application in one sitting. Work already in flight: #104 (onboarding and settings), #102 (discovery) and `feat/casefit` (dossier). The mockup is at https://claude.ai/artifact/8SpeQ9fdKsT7J5LnYH5f4g.

## 1. The problem

1. **Setup has to finish before anything can be tracked.** That takes about 22 clicks, 3 outside signups and 22 minutes. A pasted URL fails without a worker, and v2 has no manual add (FR-02, FD-01/02).
2. **Drafts are built from the maintainer's committed resume.** The app never asks the user for theirs (TA-01/02).
3. **The tracker loses what you did.** Moves don't update the app, the Applied step discards what the user typed, and a failed refresh shows an empty board (TR-01/06, SS-01).
4. **The app doesn't work on a phone.** The board column is 22 px wide, the stage menu opens underneath a card, and Settings shows 1 of its 7 tabs (AX-01/02, SS-04).
5. **One long page, two design systems.** The page is 5.1 screens tall, there are 72 button styles, the primary button's contrast is 2.0:1, and axe finds 16 critical and 25 serious issues (TR-19, DS-01/05, AX-06).

## 2. Design language

- **Source.** Every value lives in `tokens-v2.css`. `style.css :root` becomes aliases, and each surface is migrated off them. In CI, `lint:tokens` fails on a new colour literal, a `var()` with no fallback, or an unbalanced brace.
- **Type.** `display` Caveat 40 for the view h1 only · `title` Geist 600 24 · `heading` 600 18 · `body` 15 · `small` 13 · `label` JetBrains Mono 11 caps · `data` Mono 13 · `read` Lora 17 for the dossier. Nothing below 13 px is set as a sentence. Retire DM Sans, Source Sans 3 and Special Elite.
- **Grid.** Spacing is n×4 px. Radii are 6, 10, 14 and pill. z-index: drawer 800, modal 2000, toast 2100. The focus ring is 2 px navy on a paper gap, 12:1 (today it is 1.28:1). Motion is 120, 200 or 320 ms; reduced motion gets fades only.
- **Colour roles** (contrast on paper):
  - Surfaces: `paper #FFFEF9`, `paper-2 #FBF7EE`, `paper-3 #F3EEE2`.
  - Ink: `ink #1B2B33` 14.4, `ink-2 #3A5566` 7.8, `ink-3 #587080` 5.1 (was 3.9).
  - Primary: `action #0E3A4E`, the only one.
  - Accent: `accent #5FCB8E`, with `on-accent` in navy at 6.0 (white was 2.0); `accent-ink #1F6F4A` at 6.1.
  - Status: `warn #A15C07` and `err #B4321F`, each with a tint. Stage and fit tokens are unchanged.
- **Components.**
  - Keep: `.jb-sticker`, `<jb-stage-dot>`, `<jb-ai-chip>`, `<jb-fit-ring>`.
  - Merge: 72 button styles into `.jb-btn`, 28 pills into `.jb-chip[data-tone]`, and 11 inputs into `.jb-field`.
  - Add: `.jb-banner`, and `.jb-toast`, where every error has an action.
  - Retire: Lattice, `letter`, `role-workshop`, `mark-submitted`, `companies-tab`, `welcome.css`, `jb-spark`, `jb-kbd`, `jb-deco`.
- **Path off `legacy-*.css`:** alias the tokens → rename the 8 live sheets after their surfaces and add `overlay.css` (zero visual diff) → retire `?jb-v2=0` (**your call**) → stop building the 791 hidden nodes → delete the dead sheets → codemod each surface.

## 3. Changes

The changes run in journey order: **C1–C4 Base** (lands first), **C5–C10 Find**, **C11–C14 Tailor**, **C15–C16 Apply**, **C17–C22 Track**. #104 already fixes FR-01, FR-06, FR-08, FR-21 and SS-22.

| # · effort | change | fixes |
|---|---|---|
| **C1** · S | Harness answers `/__proxy`, `/profile` itself | 09-25 incident, FD-19 |
| **C2** · M | One token source; `lint:tokens` in CI | DS-01–03, 06, 11, 14–16, 21, 22 · AX-06–08, 11 · SS-18 · FD-23 · FR-22 |
| **C3** · L | Component kit; type rules wrapped in `:where()` | DS-05, 10, 18, 19 · SS-23 · TA-20 |
| **C4** · M–L | Remove dead code; rename legacy CSS; gzip | DS-04, 07–09, 12, 13, 17, 20, 23, 24 · TR-20 · TA-25 · FD-24 · FR-25 · SS-08 · AX-26 |
| **C5** · S | "Add job" in the top bar, with a manual fallback | FD-01–03, 22 · FR-03, 04 · SS-11 · TR-22 · MP-06 |
| **C6** · M | Your real board once a Sheet exists (after #104) | FR-02, 10, 19 · AX-09 |
| **C7** · S–M | Honest setup: verified ✓, "20–25 min" (after #104) | FR-05, 07, 09, 11–18, 20, 23 · SS-12 |
| **C8** · M | Discovery asks before it writes or restarts | FD-04–06, 14, 19, 20 |
| **C9** · M | Keep your roles; "Found 4 new" strip (after #102) | FD-07–13, 15–18, 21, 25, 26 · SS-19, 24 |
| **C10** · M | JSON-LD capture bookmarklet | MP-02 |
| **C11** · M | Draft from your resume, or not at all | TA-01, 02, 15 |
| **C12** · M | Drafting states that match reality; one-click draft | TA-03, 05–07, 16, 18, 22, 26 · TR-24 · AX-22 |
| **C13** · S | Review state shows the QA flag inline | TA-11–13 |
| **C14** · M | Scribe inside the dossier; live keyword meter | TA-08–10, 23, 24 · MP-03 · AX-17, 20, 21 |
| **C15** · S | Applied writes what you typed; Undo | TR-06 = TA-04 · TA-19, 21 · AX-03 |
| **C16** · S | Back from a posting: "Did you apply?" | MP-04 |
| **C17** · M | One planner for moves: sync or roll back; Undo | TR-01–05, 07, 10, 11, 25 · SS-07 · AX-02, 04, 10, 13, 14 |
| **C18** · M | Separate views, not one scroll; focus; skip link | TR-19, 23 · TA-09, 17 · AX-05, 12, 15, 16, 23–25 |
| **C19** · M | Every active stage open; a list below 760 px | TR-08, 09, 16, 17 · AX-01, 19 · MP-09 |
| **C20** · M | One next-step engine; Done, Snooze, `.ics` | TR-12–15, 18 · MP-07 |
| **C21** · M | A failed load never looks empty: last good data, Retry | SS-01, 02, 05, 06, 08–10, 25, 26 · TR-21 |
| **C22** · M | Settings at 375; save in place (after #104) | SS-03, 04, 13–17, 20, 21, 27 · AX-18 |

## 4. Out of scope

- **Waiting on other work:** the onboarding reorder (MP-01), role templates (FR-24) and the claim → evidence view (TA-14). #117 and #120 own document visuals.
- **Later:** ⌘K, triage keys, the apply kit, and lazy bundles (MP-05/08/10). Worker changes (#107–#113). `?jb-v2=0` is dropped.

## 5. Build lanes

Each lane gets its own worktree off `feat/ux-zero-to-one`, and no two lanes own the same file. **Lane A lands first.**

| lane | changes | owns | starts |
|---|---|---|---|
| A System | C1–C4 | tokens, base, fonts, `css/legacy-*`, `index.html` head, `app.js` legacy, harness | now |
| B Find | C5–C10 | `onboarding-flow`, `oneflow-*`, `ingest-url-flow`, `discovery-*`, `runs-tab` | #104, #102 |
| C Today | C5, C18, C20 | `index.html` body, `flowing-chrome`, `today*`, `dawn*`, `recruiter-strip` | A |
| D Board | C15–C17, C19 | `pipeline*`, `flowing-writes`, `submission-flow`, `jb-a11y` | A |
| E Tailor | C11–C14 | `role-case*`, `materials-*`, `role-materials`, `scribe*`, plus a sol lane for `server/` | casefit |
| F States | C21, C22 | `sheets-*`, `app-bootstrap`, `auth-session`, `setup-doctor`, `settings-*` | #104 |

Every lane starts after A. Lane F emits `jb:data:loaded`, and C gates its empty copy on it. Each lane fixes the axe rules for the files it owns.

## 6. Acceptance

| measure | before (confirmed) | target | re-run |
|---|---|---|---|
| Stylesheets loaded | 36 · 711 KiB · 85% unused at load | ≤ 16 · ≤ 300 KiB | `payload2.mjs` |
| Distinct colours | 459 literals | ≤ 40, all in `tokens-v2.css` | `measure-static.mjs` |
| Distinct font sizes | 93 declared · 50 rendered | 8 named · ≤ 9 rendered | `measure-static`, `runtime` |
| Clicks to first tracked job | ~22 clicks, 3 signups, ~22 min (inferred) | ≤ 12 clicks, 1 outside task, ≤ 12 min | first-run step table |
| axe, 8 states × 2 widths | 16 critical · 25 serious | 0 · 0 | `states.mjs both` |
