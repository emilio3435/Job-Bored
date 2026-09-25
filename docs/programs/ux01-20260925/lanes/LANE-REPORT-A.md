# UX01 lane A (System): lane report, step C1

Branch `feat/ux01-system`, cut from `feat/ux-zero-to-one` at 48756bc. Worktree `~/Job-Bored.worktrees/ux01-system`. Not pushed.

## What changed for the user

Running the browser test suites no longer touches the tester's machine. Before this change, the hermetic fence let every same-origin request through to the in-process dev server except `/config.js`, `GET /__proxy/discovery-state` and `/profile`. A spec, or app code during boot, could therefore reach `/__proxy/start-discovery-worker`, `/__proxy/fix-setup`, `/__proxy/discovery-env-key` or the install endpoints. Those handlers restart the live :8644 worker, rewrite `.env` files and install launchd agents. That is how the 2026-09-25 incident happened, and it is the mechanism behind FD-19. The fence now answers every `/__proxy/*` and `/profile*` request itself. A server-side spy records any that still get through and refuses them, so no real handler runs.

## Changes

| Id | Status | Note |
|---|---|---|
| C1 | done | Fence stubs `/__proxy/*` and `/profile*`. The server spy returns 599 as a backstop. The regression spec failed first and now passes. |
| C2–C4 | not started | Out of scope for this step. They run strictly in order after C1. |

### C1 detail

- `installHermeticNetworkFence` checks every same-origin path with `isHostPath(pathname)` and answers it in the browser:
  - `GET /__proxy/discovery-state` returns 200 with the same body as before.
  - `GET /profile` returns 404 `No profile staged`, the same as before.
  - Everything else returns 503 `{ ok: false, hermetic: true, error }`, the same pattern as the audit harness's `installHostIsolation`.
  - The fence returns `hostPathRequests`, which lists every host path it answered.
- `startHermeticApp` wraps the server's `request` listeners. A host path that reaches the server is added to `app.hostRequests` and refused with `HOST_SPY_REFUSED_STATUS` (599). A spec can reach one real handler only through `app.allowHostPath(path)`, which returns a disposer.
- The critical-journey test "should serve the dashboard's own /profile" already had its own `route.continue()` for `/profile`. It now also calls `app.allowHostPath("/profile")` and disposes it in `finally`. That test points the API at closed port 59997, so the real proxy answers 502 and never reaches a live API.
- New regression spec `tests/e2e-smoke/hermetic-fence.spec.mjs`:
  - It asserts that an unstubbed `POST /__proxy/start-discovery-worker` never reaches the server: `app.hostRequests` stays empty, the status is not 599, and the body is the 503 hermetic stub.
  - A second test sweeps `fix-setup`, `discovery-env-key`, `install-keep-alive`, `local-health`, `POST /profile` and `GET /profile/resume`.

### Red, then green (host-safe)

The spy landed first, so the red run observed the leak through a refusal and the real handler never ran.

```
Error: a /__proxy/* request reached the in-process server
- Array []
+ Array [
+   "POST /__proxy/start-discovery-worker",
+ ]
2 failed
```

After the fence change:

```
✓ hermetic-fence.spec.mjs:46:1 › should never let an unstubbed /__proxy/start-discovery-worker reach the server
✓ hermetic-fence.spec.mjs:70:1 › should answer every host-mutating /__proxy and /profile path in the fence
2 passed
```

### :8644 host check

The live worker PID was **18106** at every check, including before the red run, before the floor and after the floor. No e2e run restarted it.

```
before: node 18106 ... TCP 127.0.0.1:8644 (LISTEN)
after:  node 18106 ... TCP 127.0.0.1:8644 (LISTEN)
```

## Files touched

- `tests/e2e-fixtures/hermetic-harness.mjs` (owned)
- `tests/e2e-smoke/hermetic-fence.spec.mjs` (new; the harness's own regression)
- `tests/e2e-journey/critical-journey.spec.mjs`: four lines that opt the `/profile` test in explicitly. This file is outside the ownership list, but the lane note requires it: "keep that test green by routing it explicitly".

## Contracts touched

None. No Sheet write-back contracts, `data-action`, `data-stable-key`, `expandedJobKeys`, `updateJobStatus`, the PIPELINE-CARDS-HANDOFF selectors or `schemas/pipeline-row.v1.json`.

## APIs added (test harness only)

- `isHostPath(pathname)` and `HOST_SPY_REFUSED_STATUS` (599)
- `app.hostRequests` and `app.allowHostPath(path) → dispose`
- `fence.hostPathRequests`

## Baselines refreshed

None. The visual suite ran green with no baseline changes.

## Handoffs

- Lanes B–E: a spec that needs a real `/__proxy/*` response must register its own route after the fence. A spec that must reach the real server handler must also call `app.allowHostPath(path)`, pointed at a stub or closed port and never at the live worker. Otherwise it gets 599.
- FD-19's product fix belongs to lane B (`discovery-run-orchestration.js`): ask before `/__proxy/fix-setup` mutates anything. C1 only fences the tests.

## Floor (run from the worktree root; logs in `~/Job-Bored.worktrees/.ux01-run/A-C1/`)

```
lint:repo exit=0          OK integrations/openclaw-command-center/SKILL.md
typecheck:repo exit=0     > tsc --noEmit --project server/tsconfig.json (no errors)
test exit=0               ℹ tests 3058 · pass 3057 · fail 0 · skipped 0 · todo 1
test:contract:all exit=0  OK integrations/openclaw-command-center/SKILL.md
test:e2e-smoke exit=0     11 passed (15.2s)
test:e2e-journey exit=0   13 passed (20.8s)
test:e2e-visual exit=0    37 passed (1.0m)
```

Left unverified: CI itself, because nothing was pushed. The one `todo` in `npm test` already existed and was not skipped by this lane.

## Verification · floor (A-C1-r1)

Verifier: a fresh Opus context, separate from the lane author, run against HEAD 9f72ad7 on 2026-09-25. Each command ran once from the workspace root, in order. No command was retried, and none was run with a filter, shard or snapshot update. Logs are in `../.ux01-run/A-C1-r1-floor/<n>.log`.

| # | Command | Result | Counts |
|---|---|---|---|
| 1 | `npm run lint:repo` | PASS (exit 0) | eslint clean; lint:skills OK |
| 2 | `npm run typecheck:repo` | PASS (exit 0) | both tsc projects plus every node --check clean |
| 3 | `npm test` | PASS (exit 0) | tests 3058, pass 3057, fail 0, skipped 0, todo 1 |
| 4 | `npm run test:contract:all` | PASS (exit 0) | all contract checks OK |
| 5 | `npm run test:e2e-smoke` | PASS (exit 0) | 11 passed (15.6s) |
| 6 | `npm run test:e2e-journey` | PASS (exit 0) | 13 passed (22.0s) |
| 7 | `npm run test:e2e-visual` | PASS (exit 0) | 37 passed (1.0m) |

Flaky: none. Green: yes.

The one `todo` is `tests/submission-record-audit.test.mjs:17` ("persists and can remove the canonical submission evidence record # blocked on the canonical-ownership gate"). Node prints it under "failing tests" because its assertion fails, but it is marked todo, so it does not count as a failure.

```
npm test         ℹ tests 3058 · pass 3057 · fail 0 · cancelled 0 · skipped 0 · todo 1 · EXIT=0
e2e-smoke        11 passed (15.6s)  EXIT=0
e2e-journey      13 passed (22.0s)  EXIT=0
e2e-visual       37 passed (1.0m)   EXIT=0
```

---

# Step C2: one token source (commits 2c25acf, 033a321, d97567a)

## What changed for the user

- The first buttons a stranger presses now have readable text. These are Beat 1 "Continue with Google", Settings "Save & reload", drawer "Run discovery", the setup-wizard primary, the runs filter chip, and the materials and brief primaries. Before, they had white text on mint at 2.0:1. Now they use navy `--jb-on-accent` at 6.0:1.
- Muted captions, eyebrows and field labels can be read. `--jb-ink-3` is now #587080 (5.1:1, was 3.9:1), the legacy `--text-faint` resolves to it, and `.field-label` uses `--jb-ink-2` at 7.8:1 in 11px caps (it was 10px at 2.9:1).
- Keyboard focus is visible. Every `:focus-visible` outline and every `--jb-shadow-focus` user now gets a 2px navy ring on a paper gap (12:1, was 1.28:1).
- The legacy view and v2 now share one palette. `style.css :root` only aliases `tokens-v2.css`, so there is one navy, one mint and one paper.
- The "you're set up" celebration card has its padding back, because `--space-7`, `-9` and `-14`, `--text-md` and `--danger` are now defined.
- Toasts stack above modals (`--jb-z-toast` 2100) instead of below them.
- A stray `}` in `role.css` used to swallow the `body.jb-v2 .brief-materials` rule. That rule now applies.

## Changes

| Id | Status | Note |
|---|---|---|
| C1 | done | See above. |
| C2 | done, with partial rows listed below | The one-token-source move, the scales, `--jb-on-accent`, the navy focus ring, ink-3 #587080, and `lint:tokens` in CI with a baseline. |
| C3, C4 | not started | Next steps, in order. |

Finding rows:

| Finding | Status | How |
|---|---|---|
| DS-01 | done | `style.css :root` holds aliases only. Every value is in `tokens-v2.css`. The codemod that moves v2 sheets off the legacy names is C3/C4 work, file by file. |
| DS-02 | partial | The dossier values are promoted to `--jb-parchment`, `--jb-crimson`, `--jb-font-serif` and `--jb-dossier-*` with the same values, so the dossier does not change. Removing the local `--surface`/`--radius-*`/`--mute` redefinitions in role.css and role-case.css waits for casefit and lane E, as the audit row says. |
| DS-03 | partial | The missing scale steps are defined, which fixes the zero-padding bug. The phantom `--jb-*` names (`--jb-cream`, `--jb-rose-soft`, `--jb-mint-ink` …) still render through their hex fallbacks. Most of them live in lane E and C files (see Handoffs). |
| DS-06, AX-06 | done | `--jb-on-accent`/`--jb-on-mint` is navy. A codemod put it on 10 mint-fill rules in style.css and css/legacy-*.css. `--accent-hover` now resolves to `--jb-mint-hover` #52C184 (navy on it is 5.4:1). The wizard hover gradient literal is gone. |
| DS-11 | done (tokens) | `--jb-type-display|title|heading|body|small|label|data|read`, plus `--jb-text-2xs`, `--jb-text-label` and `--jb-label-tracking`. The literal font-size codemod is C3. |
| DS-14 | partial | The z scale is in place: sticky 40, dropdown 100, drawer 800, modal 2000, toast 2100, wizard 3200, celebration 3300. `.detail-overlay`, `.modal-overlay`, the wizard root and `.toast-container` use it. The toast-over-drawer-footer overlap needs the toast to move or to offset while `body.detail-open` is set, and that belongs to the `.jb-toast` kit (C3). |
| DS-15 | done | See lint:tokens below. |
| DS-16 | done | Tokens are split into tier 1 primitives and tier 2 semantic aliases. The stage, fit and status duplicates now alias their primitives. The `.jb-applied-age` Tailwind tints are replaced with `*-tint` tokens. Deleting unused tokens is left for C4. |
| DS-21 | done (tokens) | `--jb-space-0…16` (n×4). Radii are 6, 10, 14 and pill (`--jb-radius-xl` now aliases lg 14). The legacy `--shadow-*` values now live in `tokens-v2.css` as `--jb-shadow-sm|md|lg|hover|soft|strong`. The per-sheet codemod is C3/C4. |
| DS-22 | done | The DESIGN.md "Visual tokens" section is rewritten, and JB-UI.md points at `npm run lint:tokens`. |
| AX-07, AX-08 | done | Covered by the ink-3 and label changes above. |
| AX-11 | done | `--jb-shadow-focus` is `0 0 0 2px var(--jb-paper), 0 0 0 4px var(--jb-navy)`. jb-v2.css and 15 legacy outlines use `--jb-focus-color`. |
| SS-18 | done | The Settings `.btn-modal-primary` uses navy on mint, and `.field-label` uses ink-2. |
| FD-23 | done | The drawer's Run button is `.btn-modal-primary` and the runs chip is `.runs-filter-chip.is-active`, both now navy on mint. The drawer labels use `--text-faint`, which is now 5.1:1. |
| FR-22 | partial | The label colour now meets contrast, because oneflow's labels read `--jb-ink-3`. The 0.6rem size and the "Step 2 of 6 · AI" copy at 375 are in `css/oneflow.css`, which is lane B's file (see Handoffs). |

### How the palette moved (intended, not zero-diff)

These values change in the legacy view:

- `--bg` #f8fafc becomes paper #FFFEF9.
- `--text` #003851 becomes ink #1B2B33.
- `--accent` #59cb89 becomes mint #5FCB8E.
- The stage pills now use `--jb-*` tints. Every text/background pair is at least 4.5:1, for example researching is violet-ink on violet-soft at 5.5:1.
- The legacy radii md, lg and xl move from 8, 12 and 16px to 10, 14 and 14px.

Fonts stay the same. `--font-body` still resolves to DM Sans through `--jb-font-legacy-body`, because retiring DM Sans is C3/C4 work. Stage and fit `--jb-*` values are unchanged, as SPEC §2 requires.

### lint:tokens (DS-15)

- `tools/lint-tokens.mjs` scans every local stylesheet that `index.html` links, which is 35 sheets (`tokens-v2.css` is exempt). It checks for three things:
  - colour literals: hex, `rgb()`, `rgba()`, `hsl()` and `hsla()` in declaration values, skipping `var(--jb-*, fallback)` and ignoring id selectors;
  - `var(--x)` with no fallback where `--x` is defined in no CSS file and set by no JS or HTML;
  - unbalanced braces, which always fail.
- `tools/lint-tokens.baseline.json` freezes the current per-file counts for 23 files, so only a new literal fails. Regenerate it with `npm run lint:tokens -- --update-baseline`.
- `npm run lint:tokens` is wired into `lint:repo`, and CI's `lint` job runs `lint:repo`, so no separate workflow step was needed and `.github/workflows` is untouched. `tests/repo-validation-surface.test.mjs` pins the new `lint:repo` string.
- Red first: `tests/lint-tokens.test.mjs` (8 tests) failed on the missing exports and now passes. Its first run found two real bugs, the stray brace in role.css and the undefined `--ink-3` in legacy-cards-drawer.css, and both are fixed.

## Files touched (C2)

`tokens-v2.css`, `style.css`, `index.html` (head only: `tokens-v2.css` now loads before `style.css`), `jb-v2.css`, `role.css`, `css/legacy-brief.css`, `css/legacy-cards-drawer.css`, `css/legacy-discovery-drawer.css`, `css/legacy-discovery-runs.css`, `css/legacy-discovery-setup-wizard.css`, `css/legacy-login-gate.css`, `css/legacy-materials.css`, `css/legacy-profile-modal.css`, `tools/lint-tokens.mjs`, `tools/lint-tokens.baseline.json` (new), `tests/lint-tokens.test.mjs`, `tests/repo-validation-surface.test.mjs` (the lint:repo pin), `package.json` (scripts), `DESIGN.md`, `JB-UI.md`.

## Contracts touched (C2)

None: `data-action`, `data-stable-key`, `expandedJobKeys`, `updateJobStatus`, the PIPELINE-CARDS-HANDOFF selectors and `schemas/pipeline-row.v1.json` are all untouched. No class or token was deleted. Every legacy name still resolves, and every existing `--jb-*` name is kept.

## APIs added (C2)

New tokens:

- Colours: `--jb-paper-3`, `--jb-mint-hover`, `--jb-mint-tint`, `--jb-green-ink`, `--jb-violet-ink`, `--jb-yellow-soft`.
- Roles: `--jb-action`, `--jb-accent`, `--jb-on-accent`, `--jb-on-mint`, `--jb-accent-ink`, `--jb-on-action`.
- Status tints: `--jb-ok|warn|err|info-tint`.
- Dossier: `--jb-dossier-*`, `--jb-parchment(-deep)`, `--jb-workshop-*`, `--jb-crimson`, `--jb-font-serif`.
- Type: `--jb-type-*`, `--jb-text-2xs|label|md`.
- Space, focus, z-index and motion: `--jb-space-*`, `--jb-focus-color|gap`, `--jb-z-*`, `--jb-duration-*`, `--jb-shadow-sm|md|lg|hover|soft|strong`.

The lint module exports `lintRepo`, `linkedStylesheets`, `findColorLiterals`, `findUndefinedVars`, `collectDefinedProps`, `checkBraces`, `diffAgainstBaseline` and `normalizeLiteral`. `findHexInSource`, `stripComments`, `TokenLinter` and `shouldScan` are kept.

## Baselines refreshed (C2)

- No visual snapshots changed: the visual suite asserts structure, not pixels, and it passed without an update.
- New lint baseline: `tools/lint-tokens.baseline.json`. There was no before file; the after is the committed file. It records existing debt so that CI fails only on new literals.

## Handoffs (C2)

These do not block C2:

- **All lanes:** `npm run lint:tokens` now runs inside `lint:repo`. A new colour literal in any linked sheet fails the build, so use a `--jb-*` token. If a lane lowers its debt, rerun `npm run lint:tokens -- --update-baseline` and commit the lower counts. Text on a mint fill uses `var(--jb-on-accent)`.
- **Lane D, `pipeline.css:123-126`:** `.pipe-tool__chip[aria-pressed="true"]` still sets light text on mint (AX-06). It should use `color: var(--jb-on-accent)`.
- **Lane E, `scribe.css:170-171`:** `.scribe-btn--primary` still sets `--jb-ink-inverse` on `--jb-mint` (DS-06). It should use `var(--jb-on-accent)`.
- **Lane E, `role-case.css`, `letter.css`:** these still use the phantom tokens `--jb-rose-soft`, `--jb-mint-ink`, `--jb-ink-soft`, `--jb-amber-deep` and `--jb-ink-1`. Replace them with real tokens: `--jb-err-tint`, `--jb-accent-ink`, `--jb-ink-2`, `--jb-warn` and `--jb-ink`. After casefit, drop role-case.css's local `--surface`/`--radius-*`/`--mute` redefinitions (DS-02).
- **Lane B, `css/oneflow.css:321-328`:** raise the progress labels from 0.6rem to `var(--jb-type-label)` or larger. At 375, show "Step 2 of 6 · AI" (FR-22).
- **Lane A C3:** move `.jb-toast` to top-center, or offset it while `body.detail-open` is set (DS-14). Codemod the literal font sizes onto `--jb-type-*` (DS-11). Retire DM Sans, Source Sans 3 and Special Elite from `--jb-font-legacy-body` and `--jb-font-dossier-*`.
- **Not owned, `fixtures/runs-modal-preview.html`:** it links `../style.css` without `tokens-v2.css`, so its legacy aliases resolve to nothing. It needs a `<link rel="stylesheet" href="../tokens-v2.css">` before style.css. No test uses it.

## Floor (C2, run from the worktree root; logs in `~/Job-Bored.worktrees/.ux01-run/A-C2-*.log`)

```
lint:repo exit=0          lint:tokens ok: 35 sheet(s), 0 new finding(s), 0 brace error(s)
typecheck:repo exit=0     > tsc --noEmit --project server/tsconfig.json (no errors)
test exit=0               ℹ tests 3065 · pass 3064 · fail 0 · todo 1 (the pre-existing submission-record todo)
test:contract:all exit=0  OK integrations/openclaw-command-center/SKILL.md
test:e2e-smoke exit=0     11 passed (14.7s)
test:e2e-journey exit=0   13 passed (21.2s)
test:e2e-visual exit=0    37 passed (1.0m)
```

The :8644 host worker PID was still 18106 after the floor, so no e2e run restarted it.

Left unverified:

- CI itself, because nothing was pushed.
- The contrast figures are computed from the token values with the WCAG formula, not measured with axe. No axe run was made for C2.
- The legacy view (`?jb-v2=0`) was not inspected by eye, only through the suites.

## Verification · floor (A-C2-r1)

Verifier: fresh Opus context, independent of the author. Run 2026-09-25 from the worktree root at HEAD 144e078, in order, no filters, no retries needed. Logs: `/Users/emilionunezgarcia/Job-Bored.worktrees/.ux01-run/A-C2-r1-floor/<n>.log`. node_modules and server/node_modules confirmed as symlinks into /Users/emilionunezgarcia/Job-Bored.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run lint:repo` | 0 | pass. `lint:tokens ok: 35 sheet(s), 0 new finding(s), 0 brace error(s)` |
| 2 | `npm run typecheck:repo` | 0 | pass. No tsc diagnostics |
| 3 | `npm test` | 0 | pass. tests 3065, suites 740, pass 3064, fail 0, skipped 0, todo 1 |
| 4 | `npm run test:contract:all` | 0 | pass. 12 OK lines, no errors |
| 5 | `npm run test:e2e-smoke` | 0 | pass. 11 passed (14.8s) |
| 6 | `npm run test:e2e-journey` | 0 | pass. 13 passed (20.6s) |
| 7 | `npm run test:e2e-visual` | 0 | pass. 37 passed (1.0m) |

Green: yes. Flaky: none.

The one todo in `npm test` is `tests/submission-record-audit.test.mjs:17` ("persists and can remove the canonical submission evidence record", marked todo: blocked on the canonical-ownership gate). node reports it under "failing tests" with its assertion, but counts it as todo, not fail, and the run exits 0.

Tail of 3.log:

```
ℹ tests 3065
ℹ suites 740
ℹ pass 3064
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 13720.824333
```

---

# Step C3: component kit and :where() type rules (commit ffb133f)

## What changed for the user

- (Inferred from the audit's cascade-trap evidence; not re-measured in a browser this step.) Titles that were flattened to body weight or blown up by the global type ramp now render at the size and weight their own rule sets: the Settings setup-block titles, the materials-modal dropzone title and the discovery drawer title (DS-10). The fix is one edit: the element rules in `jb-type.css` and the heading rules in `jb-v2.css` are scoped with `:where(body.jb-v2)` (0,0,1) instead of `body.jb-v2` (0,1,1).
- Every lane now has one button, one chip, one field, one banner and one toast to build with (`.jb-btn`, `.jb-chip[data-tone]`, `.jb-field` + `.jb-input`/`.jb-select`, `.jb-banner[data-tone]`, `.jb-toast`), matching the mockup's C3 kit. Nothing on screen uses the kit yet; each lane migrates the surfaces it owns (handoffs below).

## Changes

| id | status | note |
|---|---|---|
| DS-10 | done | `:where(body.jb-v2)` on every h1–h6, p, small, blockquote, kbd, code, pre, ul, ol rule in `jb-type.css` and the h1–h6 rules in `jb-v2.css`. `body.jb-v2 a`, `:focus-visible` and `::selection` were left at (0,1,1) on purpose (colour and focus, not type). |
| DS-05 | partial | `.jb-btn` primary/accent/secondary/ghost/icon/danger, sm/md, disabled, focus ring, with recipes in JB-UI.md. Migrating the 10 primary treatments lives in files lanes B–F own (today.css, pipeline.css, dawn.css, scribe.css, role-case.css, css/oneflow.css); handed off. |
| DS-18 | partial | `.jb-field`, `.jb-input`, `.jb-select`, `__hint`, `__error`, `aria-invalid`. Migrating `.modal-input` needs the markup in `index.html` body (lane C) and `.fp-input`/`.settings-select` live in fit-profile.css / settings-tabs.css; handed off. |
| DS-19 | partial | `.jb-chip[data-tone="ok|warn|err|info|miss"]` and `.jb-chip[data-stage=…]` from the status and stage tokens. Folding the five badge families is in lanes B/E files; handed off. |
| SS-23 | partial | `.jb-toast` (navy slip, `data-tone="err|warn"` edge, action button) and the rule "every error toast carries an action" in JB-UI.md. `showToast` lives in `auth-session.js` (lane F): switching it to `.jb-toast` and requiring `action` for errors is handed off. |
| TA-20 | partial | `.jb-btn--primary` is full navy action styling (test-locked). Applying it to the "Mark submitted" confirm and titling the dialog is in `submission-flow.js` (lane D); handed off. |

Test first: `tests/ux01-c3-component-kit.test.mjs` was written and run red before any CSS changed. After the CSS edits and before JB-UI.md was updated it still failed 14 of 21 (the documentation cases); it passes 21 of 21 now. It locks the `:where()` scope, every kit class in both jb-ui.css and JB-UI.md, the four tones, full primary styling, token-only values and single-class specificity.

## Files touched (C3)

`jb-type.css`, `jb-v2.css`, `jb-ui.css`, `JB-UI.md`, `tests/ux01-c3-component-kit.test.mjs` (new).

## Contracts touched (C3)

None. No `data-action`, `data-stable-key`, `expandedJobKeys`, `updateJobStatus`, PIPELINE-CARDS-HANDOFF.md selector or `schemas/pipeline-row.v1.json` field was touched. The kit docs tell migrating lanes to keep `data-action`, `data-stable-key` and `id` unchanged.

## APIs added (C3)

CSS classes only: `.jb-btn` (+ `--primary`, `--accent`, `--secondary`, `--ghost`, `--icon`, `--danger`, `--sm`), `.jb-chip[data-tone|data-stage]`, `.jb-field` (+ `__hint`, `__error`), `.jb-input`, `.jb-select`, `.jb-banner[data-tone]` (+ `__acts`, `__body`), `.jb-toast[data-tone]` (+ `__message`). All single-class and not gated on `body.jb-v2`, so they also work under `?jb-v2=0`. No JS API.

## Baselines refreshed (C3)

None. The visual suite (`tests/e2e-visual`, 37 tests) is structural and passed unchanged; no snapshot moved.

## Handoffs (C3)

- **Lane F** · `auth-session.js` `showToast`: render `.jb-toast` (+ `data-tone`) instead of `.toast`, require `action` when `type === "error"`, and lint out "console", "build", "modules" in toast copy (SS-23). `settings-tabs.css` `.settings-select` → `.jb-select` (DS-18).
- **Lane D** · `submission-flow.js`: title the dialog "{title} at {company}" and give the confirm `.jb-btn jb-btn--primary` (TA-20); `pipeline.css` primary buttons and `.pipe-tool__search-input` → kit (DS-05, DS-18).
- **Lane C** · `index.html` body `.modal-input` fields → `.jb-field`/`.jb-input`; today.css, dawn.css primary buttons → `.jb-btn--primary` (DS-05, DS-18).
- **Lane B** · css/oneflow.css primary (`:1769`) → `.jb-btn`; `.oneflow-demo__score`, discovery drawer and runs badges → `.jb-chip[data-tone]` (DS-05, DS-19). The `.oneflow-demo` ancestor that tests/sixbeats-v1-s0-visual.test.mjs requires is no longer needed to beat the type ramp but stays harmless.
- **Lane E** · scribe.css `:169`, role-case.css `:132` buttons, `.case__chip`, role-case.css `:367` input → kit (DS-05, DS-18, DS-19).
- **Unowned** · `tools/check-jb-ui-budget.mjs`: `DEFAULT_CSS_BUDGET` is 6000 minified; jb-ui.css is now 12138 minified / 2664 gzipped (the check is not in CI). Raise it to 14000, or let C4's retirement of `jb-spark`/`jb-kbd` claw some back. `fit-profile.css` `.fp-input` → `.jb-input`.

## Floor (C3, run from the worktree root; logs in `~/Job-Bored.worktrees/.ux01-run/A-C3-*.log`)

All seven commands exited 0. Unit: 3086 tests, 3085 pass, 0 fail, 1 todo.

`npm run lint:repo`

```
    
    lint:tokens ok: 35 sheet(s), 0 new finding(s), 0 brace error(s)
    EXIT 0
```
`npm run typecheck:repo`

```
    > tsc --noEmit --project server/tsconfig.json
    
    EXIT 0
```
`npm test`

```
    ℹ tests 3086
    ℹ suites 742
    ℹ pass 3085
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 1
    ℹ duration_ms 13655.365416
    EXIT 0
```
`npm run test:contract:all`

```
    
    OK integrations/openclaw-command-center/SKILL.md
    EXIT 0
```
`npm run test:e2e-smoke`

```
    
      11 passed (14.6s)
    EXIT 0
```
`npm run test:e2e-journey`

```
    
      13 passed (20.5s)
    EXIT 0
```
`npm run test:e2e-visual`

```
    
      37 passed (1.0m)
    EXIT 0
```

## Verification · floor (A-C3-r1)

Independent Opus verifier, 2026-09-25, branch `feat/ux01-system` at `bb71664`. Every command ran in order from the worktree root; nothing was retried, filtered, or skipped. Logs: `~/Job-Bored.worktrees/.ux01-run/A-C3-r1-floor/<n>.log`.

| # | Command | Result | Counts |
|---|---|---|---|
| 1 | `npm run lint:repo` | PASS (exit 0) | lint:tokens 35 sheets, 0 new findings, 0 brace errors |
| 2 | `npm run typecheck:repo` | PASS (exit 0) | tsc --noEmit clean |
| 3 | `npm test` | PASS (exit 0) | 3086 tests, 3085 pass, 0 fail, 0 skipped, 1 todo |
| 4 | `npm run test:contract:all` | PASS (exit 0) | 12 OK checks, 0 failures |
| 5 | `npm run test:e2e-smoke` | PASS (exit 0) | 11 passed |
| 6 | `npm run test:e2e-journey` | PASS (exit 0) | 13 passed |
| 7 | `npm run test:e2e-visual` | PASS (exit 0) | 37 passed |

Green: yes. Flaky: none.

Worth noting: the one `todo` in `npm test` is `tests/submission-record-audit.test.mjs:17` ("persists and can remove the canonical submission evidence record", marked `# blocked on the canonical-ownership gate`). The test asserts at line 78 and fails; node lists it under "failing tests" but does not count todos, so it reports `fail 0`.

```
ℹ tests 3086
ℹ pass 3085
ℹ fail 0
ℹ skipped 0
ℹ todo 1
EXIT 0
```
```
  11 passed (15.6s)   # e2e-smoke
  13 passed (23.2s)   # e2e-journey
  37 passed (1.0m)    # e2e-visual
```

# Step C4: dead code out, legacy CSS renamed, gzip (commits 51068da, d8f4c87, 7765ff8, 1b2e949, d4dcb32)

Branch `feat/ux01-system`, fast-forwarded to `feat/ux-zero-to-one` at 7f684f5 before this step. Not pushed.

## What changed for the user

- **Today no longer reassures you when the app can't read anything (SS-08).** Above "Couldn't load this sheet" and after an expired session, Today used to say "Nothing is waiting on you today". It now hides with the other v2 regions until the dashboard is really up.
- **Every page load is lighter.** The dev server gzips HTML, CSS, JS, JSON and SVG when the browser accepts it (AX-26). Fonts and images stay as they are because they are already compressed. About 8,800 lines of CSS and JS that no view ever showed are gone: Lattice, the letter workshop, Mark submitted, the Companies tab, welcome.css, `<jb-spark>`, `<jb-kbd>` and four unused decoration classes. fonts.css drops 55 `@font-face` blocks, and 21 font files are deleted.
- **One body face.** DM Sans is retired. Every `--font-body`, `--sans` and dossier stack now resolves to Geist, and the unvendored "Special Elite" leaves the dossier mono stack, so the same screen looks the same on every machine (DS-12, DS-23).
- **Contributors can tell live CSS from dead CSS.** No sheet is named `legacy-*` any more. Each is named for the surface it styles, and the modal and drawer chassis sit in one `css/overlay.css` (DS-07).

The visual suite passed on the existing baselines (37 of 37), so the renames, the chassis move and the font swap caused no visible change in the captured states.

## Changes

| Id | Status | Note |
|---|---|---|
| SS-08 | done | `[data-region="today"]` is now in both the auth-gated hide list and the `:has(#dashboard…)` reveal list in `jb-v2-legacy-hide.css`. |
| AX-26 | partial | gzip is done. `isCompressibleContentType`, `acceptsGzip` and `sendStaticBody` in `dev-server.mjs` add `Content-Encoding: gzip` and `Vary: Accept-Encoding` for text types of 1 KB or more. The finding's second half, lazy-loading the wizard, drawer, Settings and materials bundles, is not done: those modules belong to lanes B, C and E. |
| DS-04 | done in C2 | role.css no longer has the stray brace, and `lint:tokens` fails on any unbalanced brace. A brace scan of all 34 linked sheets is clean. |
| DS-07 | partial | All 11 live `css/legacy-*.css` sheets are renamed 1:1, in the same link order: login-gate, brief, cards-drawer, materials, discovery-setup-wizard, materials-modal (was profile-modal), settings-profile, runs-log (was discovery-runs), discovery-drawer, fit-profile-overlay, discovery-coachmark. `css/overlay.css` holds `.modal-overlay`, `.btn-modal-primary`, `.btn-modal-primary:hover`, `.btn-modal-secondary`, `.detail-overlay`, `.detail-overlay__backdrop`, `body.detail-open`, `.detail-drawer` and `@keyframes drawerSlideIn`. It is linked where legacy-brief used to load. I checked every class that sits on those elements: none is styled between the old and new positions, so the cascade does not change. **Not done:** folding sheets into sheets I don't own (settings parts into `settings-tabs.css`, the wizard chassis into `css/oneflow.css`, `.btn-materials` into `flowing-chrome.css`). Folding would also reorder the cascade, and 1:1 renames were the zero-diff route. See Handoffs. |
| DS-08 | skipped | This finding would gate app.js's legacy brief and board renderers on `!body.jb-v2`. It is not safe yet: `pipeline.js` repaints on `#jobCards` mutations and `dawn-data.js:110` scrapes `.kanban-card`, so gating the legacy renderer would blank the v2 board and Dawn. Neither file is a lane A file. The trigger has to move to `jb:pipeline:rendered` and `getPipelineJobs()` first (TR-20's second half). See Handoffs. |
| DS-09 | partial | lattice.css and welcome.css are deleted, along with lattice.js. welcome.js stays because it still owns the onboarding-mode host and the oneflow tests load it. role.css stays: its 16 live `.jb-shelf`/`.jb-hint` rules have to move into `role-case.css` or `scribe.css`, which are not lane A files. |
| DS-12 | done | DM Sans is gone from fonts.css and from every token stack (`--jb-font-legacy-body` and `--jb-font-dossier-sans` alias `--jb-font-body`). Caveat, Lora and Source Sans 3 keep only their latin and latin-ext subsets. Source Sans 3 stays because `--doc-resume-font-family` in css/materials.css sets the résumé preview in it. |
| DS-13 | partial | The duplicate `.jb-handwritten` block in jb-v2.css is removed; `jb-type.css` now holds the only one. Caveat is one variable-font file per subset, so "one weight" saves no bytes and the 500/600/700 faces stay. Swapping the sub-14px Caveat labels to mono touches lane B, C and E sheets (see Handoffs). |
| DS-17 | done in C2 | `--surface`, `--surface-2`, `--border` and `--bg-raised` alias the warm `--jb-*` palette. |
| DS-20 | done | `<jb-spark>` and `<jb-kbd>` are removed from jb-ui.js, jb-ui.css and JB-UI.md. `.jb-underline-squiggle`, `.jb-underline-flat`, `.jb-tape`, `.jb-mark` and `.jb-shadow-pencil`/`.jb-shadow-sticker` are removed from jb-deco.css. `.jb-stamp` and `.jb-divider-dashed` stay because scribe.js renders them. `jb-fit-ring` adoption belongs to the board lanes. |
| DS-23 | partial | "Special Elite" is gone from tokens-v2.css and style.css. It is still hard-coded at `role-case.css:367` (see Handoffs). |
| DS-24 | skipped (decision) | Emilio has not approved retiring `?jb-v2=0`, so the legacy view still works. `css/brief.css` and `css/cards-drawer.css` carry a header that names what dies with the flag. |
| TR-20 | partial | lattice.js/.css and mark-submitted.js are deleted. Moving the Pipeline and Dawn render triggers off the legacy DOM is not done; it belongs to the board lanes (see DS-08). |
| TA-25 | partial | letter.js, letter.css and role-workshop.js are deleted, as are the index.html comments that kept them alive. The SCRIBE.md update and the `href="#"` audit link in scribe.js are lane C files (see Handoffs). |
| FD-24 | done | companies-tab.js and its test are deleted. |
| FR-25 | skipped (ownership) | The stale headers are in `onboarding-flow.js:15-18` and `oneflow-demo-board.js:25-26`, which are lane B files (see Handoffs). |

## Red, then green

`tests/ux01-c4-system.test.mjs` (24 tests) was written first. Before any change it failed 22 of 24; the two identity-encoding gzip checks passed from the start.

```
✖ should hide [data-region="today"] by default under body.jb-v2
✖ should delete lattice.js and never include it from index.html
✖ should link no css/legacy-*.css from index.html
✖ should drop DM Sans from fonts.css and every font stack
✖ should gzip a stylesheet when the client accepts gzip
…
```

After the change all 24 pass.

## Tests removed with their modules

`tests/lattice-rich-card`, `lattice-move-source-stage`, `lattice-canonical-off`, `letter-compose-panel`, `letter-draft-folder`, `dossier-workshop-events`, `mark-submitted` and `companies-tab`. The Lattice-only or letter-only assertions are also removed from `pipeline-filter-controls`, `pipeline-fit-units`, `pipeline-transition-adapter`, `stage-registry-canonical`, `v2-flow-width`, `dossier-card-attrs`, `data-integrity-resume-and-saves`, `flowing-writes-stage-resolve` and `oneflow-l7-sweep`. Their Pipeline assertions are unchanged. Three tests (`discovery-wizard-shell`, `discovery-readiness-truth` and `go-live-wizard`) now read the renamed sheet paths. That is why `npm test` dropped from 3,086 tests to 3,030.

## Files touched

- Owned: `dev-server.mjs`, `jb-v2-legacy-hide.css`, `jb-v2.css`, `tokens-v2.css`, `vendor/fonts/fonts.css` plus 21 deleted woff2 files, `jb-ui.js`, `jb-ui.css`, `jb-deco.css`, `JB-UI.md`, `index.html` (head list, dead region and comments, and the legacy logo `font-family`), `package.json` (typecheck:repo), `css/*` renames and the new `css/overlay.css`, `tools/lint-tokens.baseline.json` (lowered by `--update-baseline`).
- Deleted modules: `lattice.js`, `lattice.css`, `letter.js`, `letter.css`, `role-workshop.js`, `mark-submitted.js`, `companies-tab.js`, `welcome.css`.
- Tests of the deleted or renamed modules: the files listed above, `tools/smoke-jb-v2.mjs` (REGIONS), and the new `tests/ux01-c4-system.test.mjs`.

## Contracts touched

None. `data-action`, `data-stable-key`, `expandedJobKeys`, `updateJobStatus(dataIndex, stage)`, the PIPELINE-CARDS-HANDOFF selectors and `schemas/pipeline-row.v1.json` are all unchanged. `.modal-overlay`, `.btn-modal-*`, `.detail-overlay` and `.detail-drawer` keep their names; only the file they live in changed. No class or token was deleted that another lane's file uses. `--jb-font-legacy-body` and `--jb-font-dossier-*` stay as aliases.

## APIs added

- `dev-server.mjs`: `isCompressibleContentType(contentType)` and `acceptsGzip(acceptEncoding)`, both exported.
- Tokens: `--jb-scrim-modal`, `--jb-scrim-drawer` and `--jb-shadow-drawer`, with the same values the chassis already rendered.

## Baselines refreshed

None. The visual suite passed 37 of 37 on the existing snapshots.

## Handoffs

| To | File | Change |
|---|---|---|
| Lane B | `onboarding-flow.js:15-18`, `oneflow-demo-board.js:25-26` | FR-25: update the headers to name their real callers (`discovery-status-handoff.js:1270`, `app-bootstrap.js:55`). |
| Lane B | `css/oneflow.css:528`, `:1452` | Two comments still name `css/legacy-discovery-setup-wizard.css` and `css/legacy-cards-drawer.css`. They are now `css/discovery-setup-wizard.css` and `css/cards-drawer.css`. Folding the wizard chassis into oneflow.css (DS-07 step 2) is yours if you want it. |
| Lane C | `role-case.css:367` | DS-23: drop `"Special Elite",` from the notes textarea stack. `var(--mono)` already resolves to JetBrains Mono. |
| Lane C | `role-case.css` / `scribe.css`, `role.css` | DS-09: take the 16 live `.jb-shelf`/`.jb-hint` rules from role.css, then lane A can delete role.css. |
| Lane C | `SCRIBE.md:67-70,217-221`, `scribe.js:232` | TA-25: remove the "demo-scorecard-v1" description and wire or remove the `href="#"` audit link. |
| Board lanes (D/E) | `pipeline.js:1913`, `dawn-data.js:110`, `app.js` | TR-20 / DS-08: trigger Pipeline and Dawn renders from `jb:pipeline:rendered` + `getPipelineJobs()` instead of `#jobCards` mutations and `.kanban-card` scraping. After that, lane A can gate the legacy renderers on `!body.jb-v2` and drop the `#pipelineSection`/`.pipeline-board`/`main.main-content` hide rules. |
| Lanes B, C, E | sheets that set sub-14px text in `--jb-font-display` | DS-13: swap Caveat labels under 14px (step timers, "Recruiter CRM") to `--jb-font-mono`. |
| Settings owner | `settings-tabs.css` | DS-07: optionally fold `css/settings-profile.css` and the settings parts of `css/materials.css` into settings-tabs.css. |
| Lane D (reply) | `index.html` head | The `?v=` cache busters you asked for are not added. The dev server sends `Cache-Control: no-cache` on every static file, so browsers revalidate on each load, and index.html has no `?v=` convention to bump. mark-submitted.js is deleted as you asked. |

## Not in the floor, noted

- `node --test tools/smoke-jb-v2.mjs` (the `smoke:jb-v2` script, not part of CI) fails check 13/13 because it expects zero total token findings and ignores the baseline. It failed the same way before this step, and it is not a CI gate.
- `jb-ui.demo.html` and `jb-type.demo.html` still show the removed primitives as unstyled markup. They are demo pages that index.html does not load.
- `jb-v2-boot-contract.js` still carries the "lattice" adapter slot. With `window.JB_LATTICE` gone it does nothing, and its test pins the unmount behaviour. Removing it is a small follow-up.

## Floor (C4)

Run from the worktree root. Logs are in `~/Job-Bored.worktrees/.ux01-run/A-C4-*.log`. The live :8644 worker kept PID 18106 before and after.

| # | Command | Result |
|---|---|---|
| 1 | `npm run lint:repo` | PASS: `lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)` |
| 2 | `npm run typecheck:repo` | PASS: exit 0 (tsc clean) |
| 3 | `npm test` | PASS: 3030 tests, 3029 pass, 0 fail, 1 todo (the known submission-record-audit todo) |
| 4 | `npm run test:contract:all` | PASS: exit 0 |
| 5 | `npm run test:e2e-smoke` | PASS: 15 passed |
| 6 | `npm run test:e2e-journey` | PASS: 13 passed |
| 7 | `npm run test:e2e-visual` | PASS: 37 passed |

```
ℹ tests 3030
ℹ pass 3029
ℹ fail 0
ℹ skipped 0
ℹ todo 1
EXIT 0
  15 passed (17.2s)   # e2e-smoke
  13 passed (19.9s)   # e2e-journey
  37 passed (1.0m)    # e2e-visual
```

## Verification · floor (A-C4-r1)

Verifier: fresh Opus context (floor only; no product code or tests edited). Worktree `feat/ux01-system`. Logs: `Job-Bored.worktrees/.ux01-run/A-C4-r1-floor/<n>.log`. No retries needed; no flaky specs.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run lint:repo` | 0 | PASS: `lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)` |
| 2 | `npm run typecheck:repo` | 0 | PASS: all `tsc --noEmit` projects clean |
| 3 | `npm test` | 0 | PASS: tests 3030, pass 3029, fail 0, cancelled 0, skipped 0, todo 1 |
| 4 | `npm run test:contract:all` | 0 | PASS: every schema/contract check OK |
| 5 | `npm run test:e2e-smoke` | 0 | PASS: 15 passed (19.1s) |
| 6 | `npm run test:e2e-journey` | 0 | PASS: 13 passed (22.7s) |
| 7 | `npm run test:e2e-visual` | 0 | PASS: 37 passed (1.1m) |

Green: yes.

Note: the node reporter lists one entry under "failing tests". That test is marked `todo` and does not count as a failure:
`tests/submission-record-audit.test.mjs:17` "persists and can remove the canonical submission evidence record # blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store" (deepStrictEqual: actual `[]`).

Tail, `npm test`:
```
ℹ tests 3030
ℹ suites 728
ℹ pass 3029
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
```
