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
