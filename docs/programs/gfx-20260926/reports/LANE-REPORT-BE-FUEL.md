DONE

## 1. Mission
BE-FUEL: one tested module (`local-server.js`) owns "is JobBored running on this computer, and what exactly is wrong if it isn't". B5 delegates to it, the hosted-page handoff and presence poll are gone from B5 (D2), the dev-server ping answers the frozen §R3 contract, and the launcher checks the dashboard port first, no longer kills siblings, and starts the whole stack.

## 2. Claims that went red first (named with ledger IDs)
Each ran red against the base (`c142c505`) before its fix landed. Raw output is in `.lane-evidence/red-*.txt`.
- GFX-S3/S7/S9 and GFX-N-stale (local-server matrix): a current dev-server read as `stale_server` because the ping had no version or routes. 5 failed, 49 passed.
- GFX-N-stale (ping contract): the base dev-server had no §R3 body. The suite failed at import (`buildPingBody` missing).
- GFX-X2: the base eslint config linted `.worktrees/**` and `.muse/**`. 2 failed.
- GFX-N1/D1, GFX-S1/D2, GFX-N-stale in B5, GFX-R4: 7 failed against the base B5 and flow files.
- GFX-N4 and GFX-R4 (launcher): 11 failed against the base start.sh and package.json. The `-k` survival claim was first a false green: concurrently echoes each command's text, and that text contained the marker. The marker is now joined at runtime and goes red under `-k` (`red-n4-k.txt`).

## 3. What shipped, file and fence
7 local commits on `feat/gfx-be-fuel`, none pushed:
```
d02f8ee0 test(e2e-onboarding): answer the ping with the §R3 contract
3a76d08f fix(launcher): check the dashboard port first and stop killing siblings
b7e39e2b feat(onboarding): gate discovery behind the fit beat
87dba72d refactor(b5): classify the fuel check through local-server.js, drop the handoff
92a380a5 feat(local-server): add the one module that says whether JobBored is running
8a228f3b feat(dev-server): answer the frozen ping contract with version and routes
6d10203c chore(lint): ignore nested worktrees and Muse state in eslint
```
- **`local-server.js`** (new) exposes `window.JobBoredLocalServer`:
  - frozen `OUTCOMES`, the §R2 table with a `display` key and a `blocks` flag per outcome. `forbidden` shows as `wrong_origin`. There is no `quota` reason, and `unreachable` stays separate from `no_local_server`;
  - `pingLocalServer({base, signal})`;
  - `classifyAnswer(response, {pageHostname})`;
  - `checkSerpApiKey`, which pings first and sends the key only in a POST body;
  - `localServerHint(platform)`, `isLoopbackPage(location)`, `jobBoredOpenUrl(beat)`.
  - Everything fails closed: an unknown reason, a truthy-but-not-`true` ok, or a missing substrate never reads as `ok`.
- **`oneflow-beat-discovery.js`:**
  - Classification and the start hint now come from the substrate; the duplicated logic is deleted.
  - Removed: the copy-key / open-local / get-the-app handoff, the clipboard helpers, the presence poll, and `onLeave`.
  - On the static host, the one fix is **Open JobBored on this computer**, which goes to B1 (`goToBeat("google")`); Save & verify is disabled there.
  - The C3 pending-key slot is kept.
- **`onboarding-flow.js`:**
  - Reverted 02df63f7's `onLeave` wiring, which nothing uses now.
  - `BEAT_PREREQS.discovery = ["fit"]`, with a gate note. The N5 guard is kept; `maybeStart`/`open` are untouched.
- **`dev-server.mjs`:**
  - The ping returns `{ok, version, runtime, routes, desktopVersion?}`.
  - A Pages-origin-only preflight answers `Access-Control-Allow-Private-Network: true`.
  - The CNAME is read once per server.
  - The keyless, exact-origin and loopback-peer rules are unchanged.
- **`start.sh`:**
  - Checks the port first: current build → exit 0; older build → exit 1 with how to stop it; foreign process → named via lsof, exit 1, never killed.
  - Opens `http://localhost:<port>/`.
  - `start.command` got a comment fix only.
- **`package.json`:** `start` drops `-k` and adds the discovery worker, without `--restart-existing`. `typecheck:repo` now checks `local-server.js`.
- **`eslint.config.mjs`:** ignores `.worktrees/**` and `.muse/**`.
- **Tests:**
  - New: `tests/gfx-be-fuel-{local-server,ping-contract,b5-fuel,prereqs,launcher,eslint-ignores}.test.mjs`.
  - Updated because the pinned behaviour genuinely moved (each commit body says so):
    - the static-handoff suite (removed handoff, poll and N7 cases);
    - ping stubs in `connect-healing`, `l3-beat-discovery`, `sixbeats2-fuel-beat`, `sixbeats-b3-slow-check`, `ux01-c8-consent` and the e2e-onboarding spec;
    - `b5-start-opener` (root URL, free ports);
    - `greenfield-a-gate` and `oneflow-l6-migration` (the R4 gate);
    - the l0/l1/l3/l6 harnesses, which now load `local-server.js`.

## 4. Floor results (paste, do not paraphrase)
`npm run lint:repo` (tail):
```
> eslint .


> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md

> command-center@0.1.0 lint:tokens
> node tools/lint-tokens.mjs

lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
lint exit=0
```
`npm run typecheck:repo`:
```
typecheck exit=0

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

```
B5 floor plus the new files: `node --test tests/oneflow-b5-static-handoff.test.mjs tests/oneflow-b5-pending-fuel.test.mjs tests/b5-start-opener.test.mjs tests/dev-server-ping.test.mjs tests/oneflow-b5-connect-healing.test.mjs tests/oneflow-l3-beat-discovery.test.mjs tests/sixbeats2-fuel-beat.test.mjs tests/ux01-c7-honest-setup.test.mjs tests/gfx-be-fuel-local-server.test.mjs tests/gfx-be-fuel-ping-contract.test.mjs tests/gfx-be-fuel-b5-fuel.test.mjs tests/gfx-be-fuel-prereqs.test.mjs tests/gfx-be-fuel-launcher.test.mjs tests/gfx-be-fuel-eslint-ignores.test.mjs`
```
✔ C7 · the recommended provider pins a capable model (FR-07) (2.397459ms)
ℹ tests 231
ℹ suites 51
ℹ pass 231
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2421.4395
```
Onboarding-flow suites (the 18 named, as a superset of 25 files matched by those prefixes, plus the touched greenfield-a-gate, sixbeats-b3-slow-check and ux01-c8-consent): `node --test tests/data-integrity-resume-and-saves.test.mjs tests/gate-identity-switch.test.mjs tests/greenfield-b-draft-mirror.test.mjs tests/greenfield-c-drawer.test.mjs tests/greenfield-c-google-nopunt.test.mjs tests/greenfield-c-payoff.test.mjs tests/lane-d-repair-routing.test.mjs tests/onboarding-telemetry.test.mjs tests/oneflow-entry-staleness.test.mjs tests/oneflow-l0-controller.test.mjs tests/oneflow-l0-shell.test.mjs tests/oneflow-l0-store.test.mjs tests/oneflow-l0-telemetry.test.mjs tests/oneflow-l0-wiring.test.mjs tests/oneflow-l2-fit-beat.test.mjs tests/oneflow-l2-scorer.test.mjs tests/oneflow-l2-settings-copy.test.mjs tests/oneflow-l6-cutover.test.mjs tests/oneflow-l6-migration.test.mjs tests/oneflow-l6-routed.test.mjs tests/oneflow-l7-routed.test.mjs tests/oneflow-l7-sweep.test.mjs tests/oneflow-payoff-exit.test.mjs tests/oneflow-sb2-draft-persistence.test.mjs tests/oneflow-stale-completion.test.mjs tests/greenfield-a-gate.test.mjs tests/sixbeats-b3-slow-check.test.mjs tests/ux01-c8-consent.test.mjs `
```
ℹ tests 335
ℹ suites 88
ℹ pass 335
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7697.641875
```
Wide cross-check: every test file that touches B5, the ping, the prereqs or an onboarding harness (57 files):
```
ℹ tests 759
ℹ suites 187
ℹ pass 759
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12952.892375
```
`gitleaks protect --staged --redact` (everything is committed, so nothing is staged), then `gitleaks detect --redact --log-opts="c142c505..HEAD"`:
```
8:37AM INF 0 commits scanned.
8:37AM INF scanned ~0 bytes (0) in 7.67ms
8:37AM INF no leaks found
protect exit=0
8:37AM INF 7 commits scanned.
8:37AM INF scanned ~83427 bytes (83.43 KB) in 25.3ms
8:37AM INF no leaks found
detect exit=0
```

## 5. Unverified / sandbox refused
- **Needs the orchestrator:** add `<script src="local-server.js" defer></script>` to `index.html` **before** `oneflow-beat-google.js` (after `user-content-store.js`). Until it lands, the live B5 fails closed as `no_local_server`. The e2e-onboarding Playwright suite will fail at Save & verify for the same reason.
- **Not run:**
  - both Playwright suites (e2e-onboarding and journey);
  - the full `npm test`, per the shared rules;
  - a live launch of `start.sh` against a real :8080. The port-check branches were exercised only through the `JB_START_NO_EXEC` hook on high ports.
- **One deviation from the kickoff:** `jobBoredOpenUrl()` with no argument returns `jobbored://open`. PLAN R4 makes that the greenfield default. Any other non-allowlisted value (including `""`) returns null.
- **Chosen here:**
  - `stale_server` is reported when a JSON answer carries a reason this build never taught the client. A 500 with an unknown reason reads as `internal_error`.
  - The server's `empty_key` maps to `invalid_key`.
  - A 501 or HTML answer from a non-loopback host reads as `static_host`.
- **Adjacent, not touched:**
  - `npm run dev` still uses `concurrently -k` and `--restart-existing`; only `start` was in scope.
  - B5's `wrong_origin` copy still says "open http://localhost:8080" (FE-B5 owns the copy).
  - The dev-server's upstream call puts the key in serpapi.com's query string. SerpApi's API requires that; it is server-to-SerpApi only and never logged.
  - When a JSON 403 ping is followed by the keyed POST, the ping's version is never verified (the WT-N3 design).
- **The R4 gate is one level deep:** `gateBeat` does not follow prerequisites transitively. A cold `?beat=discovery` lands on fit, which has no prerequisites of its own.
