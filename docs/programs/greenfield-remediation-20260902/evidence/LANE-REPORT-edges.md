# LANE REPORT — lane C `edges` (claims C1–C5)

Branch `feat/greenfield-edges`, cut from integration base `7addeb4`.

## 1. What this lane was

The three edges of the six-beat flow stop lying: the discovery drawer's `Open discovery setup` button lands in the OneFlow shell at Beat 5 instead of the legacy three-step wizard, Beat 1 with no OAuth Client ID stays in the flow and opens its own detour instead of punting into the Settings modal, and Beat 6 adapts its primary action to what is actually ready instead of firing discovery into a missing Sheet.

Fence as issued: `discovery-setup-modals.js:130-160`, `sheet-access-setup.js:620-660`, `oneflow-beat-google.js` (`continueWithGoogle` / `renderDetour`), `oneflow-beat-payoff.js` (`resolvePayoffState` / `render` / the action handlers / the "What happens now" lines), `tests/oneflow-l7-sweep.test.mjs:585-605`, plus three new `tests/greenfield-c-*.test.mjs`. One file outside the fence had to move — see §5.

## 2. Which claims went red first

Each file was written, run red against the integration base, and only then implemented. Raw output is in `.lane-evidence/c1-red.txt`, `.lane-evidence/c2-c3-red.txt`, `.lane-evidence/c4-c5-red.txt`.

### C1 — `tests/greenfield-c-drawer.test.mjs` (3 tests, 2 pass, 1 fail)

The two passing tests are the fallback-path tests: falling back to `requestDiscoverySetup` *is* the base behavior, so they are green before and after by design. The claim itself is red:

```
✖ opens the flow at the discovery beat instead of the legacy wizard (3.004291ms)
  AssertionError [ERR_ASSERTION]: the flow is opened exactly once

  0 !== 1

      at TestContext.<anonymous> (tests/greenfield-c-drawer.test.mjs:73:12)
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
```

```
ℹ tests 3
ℹ pass 2
ℹ fail 1
```

### C2 + C3 — `tests/greenfield-c-google-nopunt.test.mjs` (10 tests, 3 pass, 7 fail)

```
✖ returns { ok: false, reason: 'missing_client_id' } for the wizard context
  AssertionError: the wizard needs an answer, not undefined
    actual: undefined

✖ never opens the Settings modal from the wizard context
  AssertionError: spec §4.4: Beat 1 owns this state — Settings is the punt F4 names
  + actual - expected
  + [ { name: 'openCommandCenterSettingsModal', args: [] } ]
  - []

✖ reports the missing Client ID through the wizard's own status line
  AssertionError: the beat is told once, in the beat
  0 !== 1

✖ does not sign in or create a sheet when the Client ID is missing
  AssertionError: Google cannot sign anyone in without a client — asking is the dead end
    actual: false, expected: true

✖ renders the locked line in the message slot
  AssertionError: spec §4.4 copy is locked: "Paste your Client ID to continue."
    actual: false, expected: true

✖ opens the detour <details> so the guide is on screen, not behind a summary
  AssertionError: the detour still renders
    actual: null

✖ focuses the Client ID paste field
  AssertionError: the paste field renders inside the detour
    actual: null
```

```
ℹ tests 10
ℹ pass 3
ℹ fail 7
```

(The three green-before tests are the two "unchanged" locks — the non-wizard Settings path, and Beat 1 with a Client ID present — plus "never opens the Settings modal", which the beat passed vacuously because it delegated the punt to `sheet-access-setup.js`.)

### C4 + C5 — `tests/greenfield-c-payoff.test.mjs` (19 tests, 6 pass, 13 fail)

```
✖ reports both true when the sheet exists and B4 saved roles
  SyntaxError: "undefined" is not valid JSON        ← state.readiness did not exist
✖ reports sheet:false when no Sheet was ever connected
  TypeError: Cannot read properties of undefined (reading 'sheet')
✖ reports roles:false when the saved profile names no target role
  TypeError: Cannot read properties of undefined (reading 'sheet')
✖ reports roles:false when the profile server is unreachable
  TypeError: Cannot read properties of undefined (reading 'roles')

✖ no Sheet → 'Connect Google to go live'
  + actual 'payoff_run_now'   - expected 'payoff_connect_google'
✖ Sheet but no roles → 'Tell it what to look for'
  + actual 'payoff_run_now'   - expected 'payoff_fix_fit'
✖ never offers a discovery run unless BOTH are ready
  AssertionError: a run into {"sheetId":""} is the two-error-toast dead end F5 names

✖ opens with the locked not-armed line when the Sheet is missing
  + actual   '✓ AI connected — OpenRouter'
  - expected 'Not armed yet — finish the step above and it runs on its own.'
✖ opens with the locked not-armed line when no roles were saved
  + actual   '✓ AI connected — OpenRouter'
  - expected 'Not armed yet — finish the step above and it runs on its own.'
✖ never says 'Discovery armed' when it is not
  AssertionError: "Discovery armed" with {"sheetId":""} is the lie F5 names

✖ payoff_connect_google walks to Beat 1 and nothing else
  + actual []   - expected [ 'google' ]
✖ payoff_fix_fit walks to Beat 4 and nothing else
  + actual []   - expected [ 'fit' ]

✖ offers Connect Google in the footer when no Sheet exists
  + actual   [ 'payoff_run_now', 'payoff_dashboard' ]
  - expected [ 'payoff_connect_google', 'payoff_dashboard' ]
```

```
ℹ tests 19
ℹ pass 6
ℹ fail 13
```

All three files are green on this branch; the counts are in §4.

## 3. What shipped

| File | Fence | What changed |
|---|---|---|
| `discovery-setup-modals.js` | the `#settingsDiscoveryOpenSetupBtn` handler in `initDiscoverySetupGuide` only | **C1.** The click opens `window.JobBoredOneFlow.open("discovery", { returnTo: "close" })` when the flow global carries `open`; otherwise it falls back to the old `requestDiscoverySetup({ entryPoint: "settings", allowWhileOnboarding: true })`. The legacy wizard is neither deleted nor renamed and stays reachable through the fallback. |
| `sheet-access-setup.js` | the missing-client-id branch of `handleSetupCreateStarterSheet` only | **C2.** `options.context === "wizard"` now returns `{ ok: false, reason: "missing_client_id" }` and reports through the caller's own `onStatus` line. It no longer raises the Settings toast and no longer calls `openCommandCenterSettingsModal`. Every non-wizard caller is byte-for-byte unchanged. |
| `oneflow-beat-google.js` | `continueWithGoogle`, `renderDetour`, plus two new helpers beside them | **C3.** `continueWithGoogle` reads `getOAuthClientId()` FIRST; on empty it sets `state.detourOpen`, repaints with the locked line `Paste your Client ID to continue.`, defers a focus onto the Client ID input, and returns without touching `signIn` or the sheet creator. `renderDetour` honours `state.detourOpen` via `details.open`. New: `oauthClientId()`, `focusClientIdSoon()`, `DETOUR_PROMPT` (also exported on `window.JobBoredOneFlowBeatGoogle` for probes). |
| `oneflow-beat-payoff.js` | `resolvePayoffState`, `render`, `buildActions`, `buildNowCard`, `onAction` | **C4/C5.** New `readiness: { sheet, roles }` on the view model, threaded into `buildActions` so the primary is `payoff_connect_google` / `payoff_fix_fit` / `payoff_run_now` per §4.3, with `Take me to my dashboard` in all three. `buildNowCard` opens with the locked `Not armed yet — …` line when not armed and drops the `✓ Discovery armed` claim. `onAction` gained `payoff_connect_google → ctx.goToBeat("google")` and `payoff_fix_fit → ctx.goToBeat("fit")`, neither completing the beat nor firing a run. `render` adopts the readiness the async resolve settles and repaints once when it changed the primary. |
| `tests/oneflow-l7-sweep.test.mjs` | lines 585–605, the one drawer-call assertion | Flipped: it now asserts `oneFlow.open("discovery", { returnTo: "close" })` and keeps asserting `requestDiscoverySetup` / `entryPoint: "settings"` as the fallback. Renamed to "the one button opens the six-beat flow at Beat 5". |
| `tests/greenfield-c-drawer.test.mjs` | new | C1, 3 tests. |
| `tests/greenfield-c-google-nopunt.test.mjs` | new | C2 + C3, 10 tests. |
| `tests/greenfield-c-payoff.test.mjs` | new | C4 + C5, 19 tests. |
| `tests/e2e-visual/finale-burst.spec.mjs` | **OUTSIDE THE FENCE** — see §5 | Retargeted at the payoff's footer primary instead of the literal label `Run discovery now`, which C4 correctly removes on a hermetic cold start. |

No new files were added to the app, so `index.html` needed no new `<script>` tag. `{ returnTo: "close" }` is passed to `open()` as the kickoff instructs; nothing in this lane asserts the close behavior — lane A owns that seam and lane E asserts it on the integration branch.

## 4. Floor results

Run from the worktree root on the final tree. Raw output in `.lane-evidence/floor-*.txt`.

### `npm test`

```
ℹ tests 3065
ℹ suites 743
ℹ pass 3064
ℹ fail 0
ℹ skipped 0
ℹ todo 1
exit=0
```

The one `todo` is the pre-existing `tests/submission-record-audit.test.mjs` "persists and can remove the canonical submission evidence record # blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store" — it is marked `todo` on the base and is untouched by this lane.

### `npm run lint:repo`

```
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
exit=0
```

### `npm run typecheck:repo`

```
> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
exit=0
```

(plus every `node --check` in the chain, including the four files this lane edited.)

### `npm run test:e2e-smoke`

```
Running 7 tests using 1 worker

  ✓  1 tests/e2e-smoke/boot-smoke.spec.mjs:93:1 › greenfield boot produces zero console errors (3.6s)
  ✓  2 tests/e2e-smoke/boot-smoke.spec.mjs:102:1 › every <script src> in the served HTML returns 200 (332ms)
  ✓  3 tests/e2e-smoke/boot-smoke.spec.mjs:128:1 › screen S0 — the demo board — is the cold-start surface, credential gate hidden (407ms)
  ✓  4 tests/e2e-smoke/boot-smoke.spec.mjs:144:1 › demo cards render watermarked, with a fit score and a why-it-fits line (366ms)
  ✓  5 tests/e2e-smoke/boot-smoke.spec.mjs:161:1 › JobBoredOneFlow.open() renders a beat, and its primary action is hittable (422ms)
  ✓  6 tests/e2e-smoke/boot-smoke.spec.mjs:182:1 › requestDiscoverySetup() renders the wizard shell with a usable primary action (437ms)
  ✓  7 tests/e2e-smoke/case-dossier.spec.mjs:227:1 › The Case renders in a real browser from seeded pipeline data (5.9s)

  7 passed (12.5s)
exit=0
```

### `npm run test:e2e-visual`

```
  37 passed (1.1m)
exit=0
```

Including all five `tests/e2e-visual/finale-burst.spec.mjs` tests — the burst (`b231c0d`) is untouched:

```
  ✓ tests/e2e-visual/finale-burst.spec.mjs › the B6 finale at 1440×900 › should fire on Beat 6 and clear itself, carrying no second payoff (1440×900)
  ✓ tests/e2e-visual/finale-burst.spec.mjs › the B6 finale at 1440×900 › should let the payoff's primary be clicked while the burst is up (1440×900)
  ✓ tests/e2e-visual/finale-burst.spec.mjs › the B6 finale at 390×844 › should fire on Beat 6 and clear itself, carrying no second payoff (390×844)
  ✓ tests/e2e-visual/finale-burst.spec.mjs › the B6 finale at 390×844 › should let the payoff's primary be clicked while the burst is up (390×844)
  ✓ tests/e2e-visual/finale-burst.spec.mjs › the B6 finale under prefers-reduced-motion › should still show, still clear itself, and still not block the beat
```

### The lane's own suites, green

```
tests/greenfield-c-drawer.test.mjs         3 tests,  3 pass, 0 fail
tests/greenfield-c-google-nopunt.test.mjs 10 tests, 10 pass, 0 fail
tests/greenfield-c-payoff.test.mjs        19 tests, 19 pass, 0 fail
```

And the suites the kickoff names as non-negotiable, green together with them:

```
tests/sixbeats2-finale.test.mjs + tests/oneflow-l4-payoff.test.mjs
+ tests/oneflow-payoff-exit.test.mjs + tests/greenfield-c-payoff.test.mjs
ℹ tests 67  ℹ pass 67  ℹ fail 0

tests/oneflow-l1-beat-google.test.mjs + tests/oneflow-l7-sweep.test.mjs
+ tests/oneflow-l5-repairs.test.mjs
ℹ tests 70  ℹ pass 70  ℹ fail 0
```

`node_modules` and the Playwright browsers were already present; no `npm ci` and no `npx playwright install` was needed.

## 5. Anything unverified, and the decisions that need the orchestrator

Nothing in this lane was refused by the sandbox. `npm test`, both Playwright suites, lint, typecheck and `git commit` all ran. Five things need to be read by whoever integrates:

### 5.1 One file edited outside the fence: `tests/e2e-visual/finale-burst.spec.mjs`

The kickoff lists this spec as a non-negotiable that "stays green". It could not, unchanged, because its subject collides with C4 head-on: it drives a **hermetic cold start** (no Sheet, no fit profile) to Beat 6 and then clicks a button named literally `Run discovery now` — which is precisely the button C4 stops rendering when there is no Sheet. Its own comment already conceded the problem ("On a hermetic cold start there is no saved fit profile, so B6's intent guard is the honest response").

The spec's actual claim is that the celebration overlay does not intercept clicks on the beat's primary — which is orthogonal to *which* primary is rendered. The exact lines changed:

- `const RUN_NOW = "Run discovery now";` → `const PRIMARY = "#oneFlowMount .discovery-setup-wizard__btn--primary";`
- `page.getByRole("button", { name: RUN_NOW, exact: true })` → `page.locator(PRIMARY)` (two sites)
- the `document.elementFromPoint` probe finds the button by that selector instead of by label text
- the post-click wait also accepts "the flow landed on another beat" alongside the two answers it already accepted
- the test title `should let Run discovery now be clicked…` → `should let the payoff's primary be clicked…`

Nothing about the overlay's shape, `pointer-events`, z-index, hit-test, reduced-motion behaviour or dismissal timing was touched. All five tests pass. **If the orchestrator would rather the spec stayed byte-identical, the alternative is to seed the hermetic harness with a Sheet id and a fit profile so the payoff is genuinely armed — that is a change to `tests/e2e-fixtures/hermetic-harness.mjs`, which is further outside this lane's fence than the change made.**

### 5.2 The ready-state action id is `payoff_run_now`, not `payoff_run_discovery`

§4.3 writes the third primary as `sheet && roles → "payoff_run_discovery" (unchanged)`. There is no `payoff_run_discovery` anywhere in the codebase — the id has always been `payoff_run_now`, and `tests/oneflow-l4-payoff.test.mjs` (4 sites) and `tests/oneflow-payoff-exit.test.mjs` (2 sites) pin it, both outside this fence. Reading `(unchanged)` as governing, this lane kept `payoff_run_now`.

Lane E's claim E5 asserts only that `payoff_run_discovery` is **absent** when not ready, which holds trivially. **But if lane E writes a test asserting `payoff_run_discovery` is present in the ready state, it will fail.** The two new ids, `payoff_connect_google` and `payoff_fix_fit`, are verbatim from §4.3, as are all three labels and the `Not armed yet — …` line.

### 5.3 The ETA line still renders when B6 is not armed

`⏱ First matches land tomorrow morning — or run it right now and watch.` is arguably as false as `✓ Discovery armed` when nothing is armed, and the first draft dropped it. That broke `tests/oneflow-l4-payoff.test.mjs` → "survives an unreachable profile server without losing the payoff", which asserts the ETA promise survives a dead `/profile` — an out-of-fence test. §4.3 locks only the *first* line of "What happens now", so the ETA was restored and only the `✓ Discovery armed` claim is gated. Flagging it as a copy call the orchestrator may want to make differently.

### 5.4 "Roles" are unknown, not missing, on the first synchronous paint

The shell reads the footer's action list synchronously, but `readiness.roles` comes from the saved fit profile, which is an async read. Beat 4 hands the profile forward on `ctx.runtime.fitProfile`, so the normal walk (B4 → B5 → B6) knows the roles on the first paint and the primary never flips. On a *re-entry* that carries no runtime profile, this lane treats roles as **unknown → assume ready**, then repaints once if the resolve disagrees. Treating unknown as "missing" instead would have painted `Tell it what to look for` for one frame on every correctly-configured re-entry, and broke the out-of-fence footer test in `tests/oneflow-l4-payoff.test.mjs`. `readiness.sheet` is always read fresh and never cached, so connecting a Sheet in Beat 1 and returning is seen immediately.

The repaint is the `render()` → `ctx.setMessage("")` path (the same one Beat 1 uses); it settles after one extra pass because the resolved roles answer is remembered in `resolvedRoles` and read by the next synchronous `baseState`. `_reset()` clears it. An earlier draft that rebuilt the actions without readiness in `render()` oscillated forever — worth knowing if anyone touches that function.

### 5.5 `{ returnTo: "close" }` is passed but not asserted

Lane A's seam had not landed on this branch. `open("discovery", { returnTo: "close" })` is passed exactly as §4.4 writes it; today's `open(beatId)` ignores the second argument, so the drawer button opens Beat 5 and the flow walks forward from there until lane A lands. Nothing in this lane asserts the close behaviour, per the kickoff.

## Definition of Done

Met. C1–C5 went red first with the output pasted in §2, all three suites are green, the full floor is green with the output pasted in §4, and the work is committed locally on `feat/greenfield-edges`. Nothing was pushed.
