# ROLLOUT.md — JobBored v2 redesign

**Status:** flag-gated, default OFF. Ready for human go/no-go.
**Owner:** Conductor (Phase 4) · then human operator.

The v2 redesign ships behind a single boolean. Everything you need for
enable / verify / revert is one command each.

---

## Enable (per-browser)

Three equivalent ways. Pick whichever suits the moment.

1. **UI** — Settings → Setup → toggle **"Enable v2 redesign"** to ON.
2. **URL** — append `?jb-v2=1` to the dashboard URL. Persists.
3. **Console** — `window.JB_V2.enable()`.

Each path sets `body.jb-v2` and writes the flag to `localStorage`. The
four region hosts (`[data-region="dawn"|"lattice"|"scribe"|"welcome"]`)
mount; the legacy DOM remains in place but visually hidden.

## Disable / revert

1. **UI** — Settings → Setup → toggle to OFF.
2. **URL** — `?jb-v2=0`. Persists.
3. **Console** — `window.JB_V2.disable()`.

Disabling removes `body.jb-v2` and clears `localStorage`. The legacy
UI returns byte-for-byte. There is no migration to undo.

## What flips

| Region   | Host element                          | When OFF                  |
| -------- | ------------------------------------- | ------------------------- |
| Dawn     | `[data-region="dawn"]`                | Legacy `.daily-brief-panel` |
| Lattice  | `[data-region="lattice"]`             | Legacy stacked pipeline   |
| Scribe   | `[data-region="scribe"]`              | Legacy `resumeGenerate*` modal |
| Welcome  | `[data-region="welcome"]`             | Legacy onboarding flow    |

The Sheet contract is unchanged. Pipeline writebacks (`updateJobStatus`,
`completeOnboarding`, `expandedJobKeys`) live in `app.js` and are used
by both surfaces. v2 reads the legacy DOM read-only where it needs the
same data.

## Verify after enabling

Two checks, ~30 seconds total:

1. **Smoke harness** — `npm run smoke:jb-v2`
   - 12 read-only checks: regions present, CSS/JS loaded in correct
     order, scoped under `body.jb-v2`, legacy hooks intact, token
     lint passes.
   - Must be 12/12 green. Failure means the redesign is structurally
     broken; do not flip the default.

2. **Manual smoke** — load `?jb-v2=1`, then:
   - Daily Brief renders with the warm-paper palette.
   - Pipeline kanban shows your jobs with stage rails.
   - Click a card → Scorecard split-pane opens.
   - Settings → Setup shows the toggle in the OFF→ON state.
   - Toggle OFF mid-session → legacy UI returns immediately, no reload.

## What to watch (first week post-flip)

- **Pipeline writeback** — open a card, change stage, refresh. The
  Sheet must reflect the new stage. v2 reuses `updateJobStatus`; if
  this breaks, the failure is in legacy code, not the redesign.
- **Onboarding** — first-run users hit Welcome; completion writes via
  the same path as legacy. Watch `UC.completeOnboarding()` calls.
- **Console errors** — `body.jb-v2` should produce zero new errors.
  The flag plumbing is wrapped in try/catch; storage failures fall
  back to OFF.
- **Performance** — token + region CSS adds ~50KB cold. No new fonts
  beyond Caveat / Geist (already loaded).

## When to flip the default

Flip `body.jb-v2` to default-on only after **all four** are true:

1. `npm run smoke:jb-v2` is 12/12 green on `main`.
2. Two consecutive days of operator usage with `?jb-v2=1`, no
   stage-writeback or onboarding regressions.
3. At least one full discovery run completes with the flag on and
   writes rows to the Sheet.
4. Manual a11y pass on the toggle: keyboard reach, focus ring, screen
   reader announces "switch, off/on".

The default flip is a **one-line change** in `index.html`:

```diff
-          var on = localStorage.getItem(KEY) === '1';
+          var on = localStorage.getItem(KEY) !== '0';
```

(Reads as: ON unless the user explicitly turned it off.) That diff,
plus a re-run of `npm run smoke:jb-v2`, is the entire flip.

## Rollback (post-flip)

If anything regresses after the default flip:

1. **Revert the one-liner.** `git revert <commit>`.
2. **Tell users to clear the flag.** `localStorage.removeItem('jb-v2-flag')`
   in the console, or Settings → Setup → toggle OFF.
3. **No data migration needed.** v2 never wrote a new schema.

Rollback is one revert plus a refresh. Don't overthink it.

## File map (for the next maintainer)

- `index.html` — JB_V2 flag plumbing (~lines 38–55), region hosts,
  Setup-tab toggle markup, script-load order.
- `tokens-v2.css` — v2 design tokens (Atlas, Phase 1).
- `jb-v2.css` — body-scoped base typography.
- `{dawn,lattice,scribe,welcome}.{css,js}` — Phase 3 region screens.
- `settings-jb-v2-tab.js` — toggle controller (Phase 4).
- `settings-tabs.css` — `.jb-v2-switch*` styles.
- `tools/smoke-jb-v2.mjs` — read-only smoke harness.
- `tools/lint-tokens.mjs` — raw-hex linter for v2 CSS.
- `MIGRATION.md` — legacy → v2 token map.

## Conductor's recommendation

**GO with caveat.** Phase 4 acceptance is 10/10 + 12/12 smoke. Ship
the toggle as-is. Hold the default flip behind 48h of operator
dogfooding per the gate above. The diff to flip is one line; the
rollback is one revert. Risk is bounded.
