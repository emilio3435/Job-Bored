# LANE REPORT — L8 (E2E truth pass)

Branch: `feat/oneflow-e2e` · 3 commits, all local, nothing pushed.
Net: **3 files changed** — both Playwright suites rewritten (`4 → 7` and
`5 → 6` tests) plus a 5-line cross-fence fix in `index.html` (§5).

---

## 1. What this lane was

Both Playwright release-gate suites still pinned the DELETED credential-first
onboarding, so PR #81 was red on `test:e2e-journey` and `test:e2e-smoke` — the
one-flow program's last two red gates. This lane rewrote both to pin the
shipped `docs/ONE-FLOW-ONBOARDING-SPEC.md` v2 surface: screen S0 (§4) as the
cold-start screen, and the one shell / six-beat spine / close-is-pausing
contract (§3.4, §3.5, §5 B1).

Fence: `tests/e2e-journey/**`, `tests/e2e-smoke/**`. One change landed OUTSIDE
that fence — see §5, it was load-bearing and is called out there.

## 2. Which claims went red first (named tests)

Baseline on the branch as handed over (`npx playwright test` on each config):

- `tests/e2e-journey/critical-journey.spec.mjs` — 1 failed / 3 passed.
  `should keep the dashboard behind the login gate when signed out` asserted
  `#sheetAccessGateScreen` visible on cold start; it resolved to
  `<div class="login-gate" data-gate-mode="loading" ... hidden>`. Spec §4
  deleted that opening — the claim itself was wrong, not the app.
- `tests/e2e-smoke/boot-smoke.spec.mjs` — 5 failed / 0 passed. Every test
  routed through `bootGreenfield()`, which waited on `#oneFlowMount` (the
  BEAT shell mount, `hidden` until a beat opens) rather than the demo board.
  All five died on the same line 52 `toBeVisible()`.
- A third claim went red only once the suite reached the app: **greenfield
  boot was NOT console-error free.** `index.html`'s blank-shell watchdog
  judged the page by `#dashboard` and `#sheetAccessGateScreen` only, and the
  cutover hides both behind screen S0 — so every cold start logged
  `[JobBored startup] blank shell detected` at DOMContentLoaded + 2s. This
  was a real post-cutover defect the old suite could never have caught,
  because it never got as far as asserting on the new surface.

## 3. What shipped, file-and-fence

**`tests/e2e-journey/critical-journey.spec.mjs`** (in fence) — 4 passed → 7.
Kept bones: the hermetic harness, the `unexpectedExternal` network fence
asserted in every test, `bootSignedIn`, and the two discovery/dossier journey
tests unchanged. Rewritten / added:

| Test | Spec claim |
|---|---|
| `should open a zero-config visit on the demo board, not a credential ask` (replaces the login-gate test) | §4 + §2.1 — demo cards + `DEMO` chip render; gate, `#dashboard`, `#oneFlowMount` all hidden; the invitation card's headline / body / privacy line / both button labels asserted VERBATIM |
| `should collapse the invitation to a corner pill that still opens the flow` | §4 — "Poke around first" → `Set up JobBored — 15 min ▸`, board survives, pill re-enters the flow |
| `should enter the one shell at beat 1 with the six-beat spine when the visitor accepts` | §3.4 entry, §3.5 chassis, §5 B1 — B1 headline + sub verbatim, `Continue with Google`, the six spine labels in order, current segment `google`, `about 15 min left` |
| `should treat closing the flow as pausing — Esc returns to the board and re-entry resumes the saved beat` | §3.4 — Esc hides the shell, board stays, saved beat intact and NOT marked complete; a plain reload (no `?greenfield=1`) then re-entry lands back on the saved beat, spine included |
| `should never show the one-flow to a user who already finished setup` | §3.3 — legacy-complete profile gets the dashboard with no demo board and no shell |

**`tests/e2e-smoke/boot-smoke.spec.mjs`** (in fence) — 5 tests → 6, all boot
health, re-aimed at the new surface. `bootGreenfield()` now waits on
`#oneFlowDemoBoard`. Reasserted: zero console errors (no allowlist), every
`<script src>` 200, S0 visible by computed style with the gate hidden, the
flow opens a beat visible by computed style. Added: demo cards render
watermarked with a fit score and a why-it-fits line (an empty board is a boot
failure — the invitation card alone is not screen S0); and both primary-action
checks now assert a real non-zero bounding box, the CSS-burial bug class the
suite exists for.

**`index.html`** (OUTSIDE fence — see §5) — the blank-shell watchdog's
snapshot and predicate learned about `oneFlowDemoBoard`, so screen S0 counts
as a painted surface. 5 lines.

No `.skip`, no `.only`, no filtered runs, no allowlisted console errors.

## 4. Floor results — PASTED output

```
$ npm run test:e2e-journey

Running 7 tests using 1 worker

  ✓  1 tests/e2e-journey/critical-journey.spec.mjs:119:1 › should open a zero-config visit on the demo board, not a credential ask (345ms)
  ✓  2 tests/e2e-journey/critical-journey.spec.mjs:155:1 › should collapse the invitation to a corner pill that still opens the flow (420ms)
  ✓  3 tests/e2e-journey/critical-journey.spec.mjs:183:1 › should enter the one shell at beat 1 with the six-beat spine when the visitor accepts (401ms)
  ✓  4 tests/e2e-journey/critical-journey.spec.mjs:225:1 › should treat closing the flow as pausing — Esc returns to the board and re-entry resumes the saved beat (622ms)
  ✓  5 tests/e2e-journey/critical-journey.spec.mjs:276:1 › should never show the one-flow to a user who already finished setup (493ms)
  ✓  6 tests/e2e-journey/critical-journey.spec.mjs:291:1 › should show queued, running, and partial discovery outcomes (2.0s)
  ✓  7 tests/e2e-journey/critical-journey.spec.mjs:344:1 › should carry completed discovery into the pipeline and ready dossier materials (8.5s)

  7 passed (13.1s)
```

```
$ npm run test:e2e-smoke

Running 6 tests using 1 worker

  ✓  1 tests/e2e-smoke/boot-smoke.spec.mjs:93:1 › greenfield boot produces zero console errors (3.3s)
  ✓  2 tests/e2e-smoke/boot-smoke.spec.mjs:102:1 › every <script src> in the served HTML returns 200 (262ms)
  ✓  3 tests/e2e-smoke/boot-smoke.spec.mjs:128:1 › screen S0 — the demo board — is the cold-start surface, credential gate hidden (266ms)
  ✓  4 tests/e2e-smoke/boot-smoke.spec.mjs:144:1 › demo cards render watermarked, with a fit score and a why-it-fits line (261ms)
  ✓  5 tests/e2e-smoke/boot-smoke.spec.mjs:161:1 › JobBoredOneFlow.open() renders a beat, and its primary action is hittable (327ms)
  ✓  6 tests/e2e-smoke/boot-smoke.spec.mjs:182:1 › requestDiscoverySetup() renders the wizard shell with a usable primary action (327ms)

  6 passed (5.1s)
```

```
$ npm test

ℹ tests 2515
ℹ suites 597
ℹ pass 2514
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6012.963333
$ echo $?
0
```

```
$ npm run lint:repo

> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
$ echo $?
0
```

```
$ npm run typecheck:repo
… (browser-use-discovery tsc, ~120 node --check passes, server tsc)
> tsc --noEmit --project server/tsconfig.json
$ echo $?
0
```

```
$ npm run test:contract:all
OK schemas/ats-scorecard.v1.json ↔ scribe-score-adapter.js
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
$ echo $?
0
```

The single `todo` in `npm test` is `submission-record-audit.test.mjs`'s
pre-existing "blocked on the canonical-ownership gate" entry — present before
this lane, `fail 0`.

## 5. Anything unverified, including what the sandbox refused

**One change landed outside the L8 fence, deliberately, and needs the
orchestrator's eye: `index.html`.**

The kickoff's DoD requires "no console errors" reasserted against the new
surface. That claim failed, and the fault was the app's, not the test's:
`blankShellDetected()` in `index.html`'s early startup script checks only
`dashboard` and `sheetAccessGateScreen`, and post-cutover `app-bootstrap.js`
sets `#dashboard` to `display:none` and mounts screen S0 as its own overlay.
Every cold boot therefore logged a false `blank shell detected` at
console.error level. The fix adds `oneFlowDemoBoard` to the snapshot and to
the predicate's surface list — a genuine blank shell (S0 failed to mount)
still fires, as it must.

I verified the fix is load-bearing rather than cosmetic: with `index.html`
reverted to HEAD, `greenfield boot produces zero console errors` fails with
exactly `+ "[JobBored startup] blank shell detected …"`; with it applied, the
suite is green. `tests/startup-diagnostics.test.mjs`, which pins that script's
shape, still passes.

There was no way to satisfy the DoD from inside the fence — a suite that
allowlisted the error would have hidden a real cutover defect. Flagging it
here rather than assuming the routing.

Other notes:

- `tests/e2e-fixtures/hermetic-harness.mjs` was left untouched (it is not in
  the L8 fence and needed no change). Its `stageSignedInDisposableAuth` still
  stubs `showSheetAccessGate` for the signed-in path; harmless, but a future
  lane could drop it now that the gate is not the cold-start surface.
- `eslint.config.mjs` grants browser globals to `tests/e2e-smoke/**` only.
  Rather than widen that glob (out of fence), the journey spec's
  `page.evaluate` snippets use `globalThis.JobBoredOneFlow`, matching the
  `globalThis.CommandCenterUserContent` idiom already in that file.
- Beats B2–B6 are NOT driven end to end here. Completing B1 for real needs a
  live Google OAuth grant, which the hermetic fence refuses by design; the
  resume test therefore advances through the controller (`goToBeat`) and
  states so inline. Per-beat behavior stays covered by the L1–L4 unit suites.
- `npx playwright install chromium` was not needed — chromium 1234 was
  already present in the local Playwright cache. CI installs its own.
- Nothing was pushed. Commits are local, on `feat/oneflow-e2e`.
