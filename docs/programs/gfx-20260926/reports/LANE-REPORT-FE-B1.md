DONE
## 1. Mission
FE-B1 (GFX): a brand-new user on any URL reaches a signed-in, sheet-connected state without a false error, dead end or unexplained step. A hosted page is told, before any setup, that JobBored runs on their computer, and gets a real Open JobBored button (D2, D8). Branch `feat/gfx-fe-b1`, 5 local commits (776d75d9, 907e3ae6, 05444f3f, 831e79c9, 32260662) plus the feat/gfx-integration merge, not pushed.

## 2. Claims that went red first (named with ledger IDs)
Proved by copying the three new test files and harness into a detached worktree at 29b7a3f6 (HEAD before this lane): **55 of 58 new tests red**; the 3 that passed there are regression guards (G1 collapsed-with-a-Client-ID, no window.open in the beat, one primary per B1 mode).
- beat-google 21 red: G1, G2, G3, G4, G5, G6, G7, G11, G12, B1-N1/G15, G22, B1-N2 ×2, G16, B1-N3 ×2, B1-N4 ×4, B1-N6.
- docs 13 red: G14 ×2 (SETUP, README), B1-N5, G10, G17, G18, G19, G20, G22, B2-8, N-B3-5, D8 Get JobBored, X4 COPY.md.
- route-local 21 red (no module, no gate at HEAD): D2/R11 ×5 (hosted open renders route-local and writes no state; maybeStart touches no state; deep link; file://; loopback goes to B1), D8 ×3, R4/R21 ×8 (no ping before click; jobbored://open with no beat/returnTo; absolute localhost:8080 ping; failed/denied = unknown; non-Mac fallback primary; stop + listener removal on close; focus wakes poll; blur copy), R3 ×5 (git pull, Update JobBored, no note when current, stale named, PAGE_VERSION == package.json).

## 3. What shipped, file and fence
- `oneflow-route-local.js` (new): route-to-local screen, ladder, click-gated detection with injectable `TIMINGS`, version compare, one primary per state.
- `onboarding-flow.js`: only `maybeStart`/`open`, plus the `hostedPage()`/`showRouteToLocal()` helpers they call. BEAT_PREREQS and the N5 guard untouched.
- `oneflow-beat-google.js`: G1–G7, G11, G12, G15, G16, G22, B1-N1…N4, N6; in-flight guard on Continue.
- `css/oneflow.css`: B1 block rescoped under `.oneflow-google`; new route-local block. :557-572 untouched, so B2 and B3 are visually unchanged.
- `SETUP.md`, `README.md`, `CONTRIBUTING.md`, new `docs/COPY.md`.
- Tests: new `tests/gfx-fe-b1-{route-local,beat-google,docs}.test.mjs` and `tests/gfx-fe-b1-harness.mjs`. Pinned strings updated (named in the 907e3ae6 body): l1-beat-google, ux01-c7, wizards-modal-a11y, oauth-origin-detour, greenfield-c-google-nopunt, e2e-journey critical-journey, e2e-onboarding greenfield-onboarding (stageHarnessAuth no longer clicks the now-open detour shut).
- Evidence: `.lane-evidence/fe-b1-{route-local-idle,route-local-no-signal,route-local-running-outdated,b1-detour}-{1440,375}.png`, taken from a port-0 hermetic dev-server. The hosted origin and localhost:8080 were routed in the browser. Computed-style probe: spine hidden, mono command, rung title weight 600, 1 primary, B1 absent. `hostRequests reaching server: []`.

## 4. Floor results (paste, do not paraphrase)
### npm run lint:repo (exit 0)
```

> command-center@0.1.0 lint:js
> eslint .


> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md

> command-center@0.1.0 lint:tokens
> node tools/lint-tokens.mjs

lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
```
### npm run typecheck:repo (exit 0; tail)
```
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json


> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

```
### node --test (29 files, exit 0)
```
tests/gfx-fe-b1-beat-google.test.mjs tests/gfx-fe-b1-docs.test.mjs tests/gfx-fe-b1-route-local.test.mjs tests/oneflow-l1-beat-google.test.mjs tests/greenfield-a-gate.test.mjs tests/greenfield-a-provider-guard.test.mjs tests/greenfield-b-draft-mirror.test.mjs tests/greenfield-c-drawer.test.mjs tests/greenfield-c-google-nopunt.test.mjs tests/greenfield-c-payoff.test.mjs tests/oneflow-l0-controller.test.mjs tests/oneflow-l0-shell.test.mjs tests/oneflow-l0-store.test.mjs tests/oneflow-l0-telemetry.test.mjs tests/oneflow-l0-wiring.test.mjs tests/oneflow-l6-cutover.test.mjs tests/oneflow-l6-migration.test.mjs tests/oneflow-l6-routed.test.mjs tests/oneflow-l7-routed.test.mjs tests/oneflow-l7-sweep.test.mjs tests/gate-identity-switch.test.mjs tests/ux01-c7-honest-setup.test.mjs tests/oauth-origin-detour.test.mjs tests/wizards-modal-a11y-focus.test.mjs tests/oneflow-l5-repairs.test.mjs tests/bridge-core-host-init-auth.test.mjs tests/gfx-be-fuel-prereqs.test.mjs tests/gfx-be-fuel-local-server.test.mjs tests/sixbeats-v2-shell-visual.test.mjs 
ℹ tests 439
ℹ suites 112
ℹ pass 439
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3084.995625
```
### npm run test:e2e-onboarding (exit 1: the known-red VAL-ONEFLOW-001 only)
```
  ✘  1 tests/e2e-onboarding/greenfield-onboarding.spec.mjs:543:1 › VAL-ONEFLOW-001: six beats reach the payoff on a fresh install (4.8s)
  ✓  2 tests/e2e-onboarding/greenfield-remediation.spec.mjs:204:1 › E1 Beat 3 is gated on Beat 2 (1.6s)
  ✓  3 tests/e2e-onboarding/greenfield-remediation.spec.mjs:259:1 › E2 Pasted resume survives Escape and reload (1.9s)
  ✓  4 tests/e2e-onboarding/greenfield-remediation.spec.mjs:290:1 › E3 Drawer setup lands in OneFlow (1.2s)
  ✓  5 tests/e2e-onboarding/greenfield-remediation.spec.mjs:304:1 › E4 Beat 1 never punts to Settings (870ms)
  ✓  6 tests/e2e-onboarding/greenfield-remediation.spec.mjs:320:1 › E5 Payoff is honest (1.1s)
  ✓  7 tests/e2e-onboarding/greenfield-remediation.spec.mjs:364:1 › E6 Settings shows receipts (1.2s)
    Expected length: 1
    Received length: 0
    > 583 |   expect(state.calls.profileWrites).toHaveLength(1);
    .lane-evidence/onboarding-e2e/test-results/greenfield-onboarding-VAL--3e064-e-payoff-on-a-fresh-install/test-failed-1.png
  1 failed
  6 passed (13.9s)
```
### npm run test:e2e-journey (exit 0)
```
  ✓  26 tests/e2e-journey/shell-today.spec.mjs:320:1 › should not call a loading or failed pipeline empty in the Brief (591ms)
  33 passed (41.8s)
```
### gitleaks
```
per commit: gitleaks protect --staged --redact -> no leaks found (x4)
[90m9:13AM[0m [32mINF[0m [1m4 commits scanned.[0m
[90m9:13AM[0m [32mINF[0m [1mscanned ~86152 bytes (86.15 KB) in 26ms[0m
[90m9:13AM[0m [32mINF[0m [1mno leaks found[0m
```
### ORCH follow-up (09:19): merged feat/gfx-integration, fixed 8 BE-FUEL tests (32260662)
The D2 gate moved the pinned path: B5 is now opened on loopback via `openB5()`, and the hosted hostname is restored before the check. The gate is unchanged.
```
node --test tests/gfx-be-fuel-b5-fuel.test.mjs tests/oneflow-b5-static-handoff.test.mjs tests/gfx-fe-b1-*.test.mjs tests/oneflow-l3-beat-discovery.test.mjs   (exit 0)
ℹ tests 140
ℹ suites 36
ℹ pass 140
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 383.007292
```
After the merge: `npm run lint:repo` exit 0; the 29-file node floor above re-ran on the merged tree, exit 0, `ℹ tests 439 / pass 439 / fail 0`.

VAL-ONEFLOW-001 is **known red on main** (profile P0, N-B4-1; BE-CORE and FE-B4 own the fix). It now clears B1–B3 and fails at `expect(state.calls.profileWrites).toHaveLength(1)` after B4. Before the e2e-onboarding spec fix it failed earlier, at B1's Save Client ID, which this lane caused and fixed.

## 5. Unverified / sandbox refused
**Requests for the orchestrator (outside my fence):**
1. `index.html`: add `<script src="oneflow-route-local.js" defer></script>` after `local-server.js` (:1386) and before `onboarding-flow.js` (:1405). Until then the gate is inert on the real page: `showRouteToLocal()` returns null, and a hosted `open()` renders nothing and writes nothing. The screenshots injected the tag in the browser route.
2. `package.json` `typecheck:repo`: add `node --check oneflow-route-local.js` (I ran it by hand: ok).
3. `release-please-config.json`: add `oneflow-route-local.js` to `extra-files`, so `PAGE_VERSION = "0.1.0"; // x-release-please-version` bumps with package.json. The test `PAGE_VERSION is this build's package.json version` goes red at the first release otherwise.
4. BE-FUEL (`local-server.js`): `localServerHint(platform)` does not take a runtime yet. Please add `localServerHint({ platform, runtime })` returning "open the JobBored app" when `runtime === "desktop"` (R13). `docs/COPY.md` already documents it.

**Not verified:**
- The six Cloud Console deep links were not opened live (they need a Google login). `/auth/scopes` (Data access) is inferred from Google's Auth Platform; SPEC G3 says to check the links before shipping.
- BE-CORE contracts were coded against, not run against: `scope_missing`, `onCreated(created).spreadsheetUrl`, `isGoogleSignInReady`. HEAD's creator still returns undefined and calls `window.open`. B1 also pre-checks `hasGrantedOauthScope(sheets)` before the create, so HEAD's out-of-gesture consent path is not reached from B1.
- Chrome's Local Network Access prompt, and a real `jobbored://` hand-off, are untested in a real browser. Both are covered only by the injected blur/focus and a thrown fetch.
- VAL-ONEFLOW-001 at 29b7a3f6 was not re-run to compare failure points; the known-red call is from the kickoff.

**Adjacent issues noted, not fixed:**
- `openFromDeepLink` (outside my maybeStart/open fence) calls `hydrate`/`reconcileStaleCompletion` before `open()`'s gate. On a hosted origin that already holds pre-D2 flow state, a `?beat=` link could still reset that origin's stale completion.
- Emilio's call: `isLoopbackPage` routes EVERY non-loopback page, including a Tailscale-served dashboard (`*.ts.net:8080`) and a user's own GitHub Pages fork (README still calls Pages "recommended"). This matches D2 and "Hosted mode is unsupported", but those users now see route-to-local.
- `oneflow-demo-board.js` still says "a free Google app key" (G6; not my file). `sixbeats-v2-shell-visual.test.mjs` keeps the old B1 sub in its own fixture (it pins nothing of mine).
- README §1 (Sheet) still precedes §2 (OAuth). N5 named only SETUP.md.
- `body.jb-v2 a` repaints every link-shaped shell primary as mint-deep on mint (about 2:1). I fixed it only on the route-local screen; other beats' link primaries likely carry the same defect.
