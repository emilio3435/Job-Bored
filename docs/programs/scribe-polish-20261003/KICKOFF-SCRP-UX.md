# Lane UX — Scribe editor visual polish (CSS + visual snapshots)

Read `KICKOFF-SCRP-_SHARED.md` (ground rules, silent traps) and `SPEC-SCRP-20261003.md` §0, §2, §4, §5 in `docs/programs/scribe-polish-20261003/`. §0 overrides this file. Read `COPY-BRIEF.md` (vocabulary/states you are styling), `DESIGN.md` and the repo's token rules (`npm run lint:tokens`). Other lanes now: FE (only writer of `scribe-v2*.js`, adds the §4 DOM anchors and applies copy), BE (server), QA (Astra, read-only).

Goal: refine the existing Scribe editor into a clear, calm, consistent editing surface within the current theme — no new brand, no framework, CSS only.

Success means:
- **Before** screenshots first: both docs at 1440×1000 and 375×667 for idle, busy+Stop, review (rail and mobile card), saved, error, compare/view, versions panel — via a throwaway capture script in `.lane-evidence/` using the hermetic harness (stub mode `?scribe-api=stub` is fine for visuals). Save under `.lane-evidence/ux-before/`.
- CSS changes in `scribe-v2.css`, each tied to a concrete defect you can name: hierarchy (one obvious primary action per state; Save vs Discard vs Accept all weights), status-line stability (no layout jump between stages/states; reserve height), spacing/alignment rhythm on the 4px grid used by the theme, button sizing (≥44px at ≤599px, consistent heights on desktop), long-text wrapping for summaries/errors, focus-visible rings on every interactive element, reduced-motion respected, no horizontal scroll at 375 (check `document.documentElement.scrollWidth`), contrast ≥ 4.5:1 for text using existing tokens.
- Styles for every SPEC §4 anchor (`.scribe__recover`, `.scribe__status[data-state]`, `.scribe__status-action`, `.scribe__scope` (exists — refine), `.scribe__selection-actions`, `.scribe__manual-state[data-state]`, `.scribe__unsaved`) so FE's DOM looks finished the moment it lands. Write them against the anchor names; you do not need FE's DOM to exist to write them, but verify them after FE lands (see Consumes).
- Visual spec `tests/e2e-visual/scribe-v2.spec.mjs`: add `SCRP-U<n>` cases for the new states once FE's DOM exists; regenerate darwin snapshots **only** for intended changes and list each changed snapshot with its reason in report §3.
- **After** screenshots, same matrix, `.lane-evidence/ux-after/`. Write rows into `docs/programs/scribe-polish-20261003/UX-DELTA.md` (create it): change · before img · after img · user benefit · acceptance check. Copy the before/after PNGs you reference into `docs/programs/scribe-polish-20261003/ux/` (≤ 20 images, fictional data only, ≤ 300 KB each — use `sips -Z 1200` to shrink).
- Floor: `npm run lint:repo` (includes lint:tokens), visual spec, C (journey, to prove no functional regression), output pasted in LANE-REPORT §4.
- Report first line `DONE` | `BLOCKED: <why>` | `DONE (uncommitted — sandbox)`.

Stop when: the fence is exhausted and the floor is pasted, or you are blocked.

## Fence (yours alone)
- `scribe-v2.css`
- `tests/e2e-visual/scribe-v2.spec.mjs` and `tests/e2e-visual/scribe-v2.spec.mjs-snapshots/`
- `docs/programs/scribe-polish-20261003/UX-DELTA.md`, `docs/programs/scribe-polish-20261003/ux/`

Do NOT touch: any `.js`, `index.html`, `server/**`, other tests, other CSS files. If a fix needs markup or copy, write it as a request in report §3 under "For FE" (exact element/class/string) — the host routes it.

## Consumes
FE's anchors and copy land on `feat/scribe-polish-20261003-fe`; the host merges them into `feat/scribe-polish-20261003`. When the host messages you (or `git log feat/scribe-polish-20261003 --oneline` shows FE F1/F2 commits), `git merge feat/scribe-polish-20261003` into your branch, then capture after-shots and add visual cases. Until then, polish existing states and write anchor styles.

## Non-negotiables
- Tokens only (`--jb-*`); `npm run lint:tokens` green. Everything scoped under `jb-scribe.scribe` / `.scribe` (cascade trap).
- No change to the iframe page styles (templates are not yours) or to the injected mark CSS in `scribe-v2-diff.js`.
- Reduced motion: no animation without a `prefers-reduced-motion` override.
- Keep existing breakpoints (1023/599) unless a named defect requires a change.

## Definition of Done
```
npm run lint:repo
npx playwright test --config tests/e2e-visual/playwright.config.mjs tests/e2e-visual/scribe-v2.spec.mjs --output .lane-evidence/ux-visual
npx playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-edit-journey.spec.mjs tests/e2e-journey/scribe-v2-desk.spec.mjs --output .lane-evidence/ux-pw
git add scribe-v2.css tests/e2e-visual docs/programs/scribe-polish-20261003/UX-DELTA.md docs/programs/scribe-polish-20261003/ux; gitleaks protect --staged --redact
```
`SCRP-U` covers: each new-state anchor rendered at 1440 and 375, no sideways scroll, 44px targets, focus ring visible. All green, pasted in §4, first line `DONE`. Commit locally, never push.

## AMENDMENTS after the plan check (these override anything above)

1. **Known red baseline (D17).** `tests/e2e-visual/scribe-v2.spec.mjs:230` (`scribe-v2-390-doc-darwin.png`) is red at baseline because #160 added the grade button to the header. Your **first commit** regenerates that one snapshot and names that reason in the commit body.
2. **State injection.** Render the new states (recover, status outcomes, 503, unsaved) in your own spec using `page.route` and DOM setup, as `tests/e2e-journey/scribe-v2-desk.spec.mjs:348-355` does. Do not touch the harness.
3. **Anchors and when to merge.**
   - The anchors now have fixed mount points: SPEC §4 "Mount points".
   - The host merges FE-1's anchor skeleton (`SKELETON <sha>`) early and messages you to merge.
   - Do your **final** snapshot regeneration and UX-DELTA rows only after the host signals `FE-COPY <sha>`, which comes after FE-2.
   - Until then, write styles, before-shots and interim visual cases.
   - In-iframe `[data-scribe-selected]` / `[data-scribe-editing]` styles belong to FE. Put your proposed values under "For FE" in your report.
4. **Long-lived lane.** Expect to idle between signals. When you have nothing left before the next signal, write first line `PENDING — waiting for <signal>` and stop. The host relaunches you with the next instruction.
