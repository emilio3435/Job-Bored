# LANE REPORT — L6 (cutover)

Branch: `feat/oneflow-cutover` (worktree `Job-Bored.worktrees/oneflow-cutover`)
Commits: 5, local only. Nothing pushed.

## 1. What this lane was

Flip boot from the legacy six-wizard chain to the one-flow, with the §3.3
migration that guarantees no existing user ever re-onboards — deleting
nothing (that is L7).

Fence: `app-bootstrap.js`, `discovery-status-handoff.js`, `tests/integration/*`,
`tests/oneflow-l6-*`. Plus the three routed additions the orchestrator granted
(`auth-session.js` given_name, `oneflow-beat-google.js` runtime write,
`oneflow-beat-fit.js` runtime write). Four further cross-fence edits were
required and are itemised in §5.

The five kickoff items, and what landed:

1. **Cold start** — `app-bootstrap.js` `init()`'s no-sheet branch mounts
   `JobBoredOneFlowDemoBoard.mount()` instead of `showSheetAccessGate`. The
   gate's `error` mode is untouched; a missing board module still falls back to
   the login gate; `initAuth` still runs so B1's `Continue with Google` works.
2. **Post-auth chain** — `runPostAccessBootstrapOnce` runs
   `startOneFlowIfNeeded()` (which calls `JobBoredOneFlow.maybeStart()`) in
   place of `checkInfraSetupGate` + `checkOnboardingGate`. Grep table in §3.
3. **Migration** — the §3.3 ladder, red-first per row, in
   `discovery-status-handoff.js`.
4. **Completion side-effects** — proven end to end against the real store and
   the real what's-next banner.
5. **Integration tests** — `onboarding-chain-convergence.test.mjs` rewritten
   for the new chain; `greenfield-automation.test.mjs` gained the cold-start
   half its endpoints exist to reach.

## 2. Which claims went red first (named tests)

Every claim below failed before its implementation and passes after.

**`tests/oneflow-l6-cutover.test.mjs`** (19)
- `mounts S0 when no sheet is configured` — cold start opened the login gate.
- `mounts S0 even with no OAuth client id — §4 deletes the no-oauth opening`
- `keeps the gate's error mode for a genuinely broken config (spec §4)`
- `falls back to the login gate when the demo board module is missing`
- `no longer runs the legacy infra gate on the cold-start path`
- `calls JobBoredOneFlow.maybeStart instead of the two gates`
- `does not re-open a flow the S0 card already opened (spec §3.4)`
- `still surfaces a stored terminal run outcome after the cutover`
- the grep-table pair, and `both legacy gates still EXIST — deleting them is L7`
- `the first-run infra wizard does not open over a beat (spec §3)`
- `the infra wizard stays down even between beats`
- `welcome.js's onboarding card does not mount over the demo board`
- `post-sign-in reveal does not paint the setup screen over a beat`

**`tests/oneflow-l6-migration.test.mjs`** (10) — one row per §3.3 claim
- row 1: `marks the flow completed and renders nothing` /
  `stays closed when discovery is incomplete — the banner carries that nudge`
- row 2: `routes a sheet-only legacy profile to the AI beat` /
  `routes a profile with NO sheet to B1 — the sheet is the substrate` /
  `does not spend a provider round-trip when no provider is configured`
- row 3: `routes past B2 when the configured provider answers` /
  `keeps a configured-but-dead provider at B2`
- row 4: `routes to the fit beat and prefills it from the discovery profile` /
  `goes to B3, not B4, once the server fit profile exists`
- §3.4: `a saved beat wins over the migration ladder on the next boot`

**`tests/oneflow-l6-routed.test.mjs`** (9) — the routed items
- `captures given_name from /oauth2/v3/userinfo`, `has no name when Google
  returns none — never a fabricated one`, `persists the name beside the other
  session fields`, `restores the name from a persisted runtime session`,
  `clears the name with the rest of the session`
- `B6 says "You're live, {firstName}." from what B1 wrote` (the session
  accessor is removed before B6 renders, so only the runtime can answer)
- `B6 renders the just-saved search without a second /profile fetch`

**`tests/integration/onboarding-chain-convergence.test.mjs`** (12, rewritten)
- cold start mounts S0 from the shipped fixture with no credential ask;
  `Make it mine` opens B1
- `each beat's own action advances to the next, in spec order`
- `B4 confirms what B3 drafted — no datum is asked twice (spec §2.3)`
- `finishing B6 writes every legacy completion flag (spec §3.2)`
- `the completed flow is the ONE celebration (spec §5 B6, §7)`
- `closing returns to the demo board and re-entry lands on the saved beat`
- `reloading the page lands on the persisted beat with the flow still open`
- `skipping connect finishes the flow and leaves the banner carrying the nudge`
- `the fuel key is NOT skippable`
- `the next boot goes straight to the dashboard`

**`tests/integration/greenfield-automation.test.mjs`** (+2)
- `serves the bundled demo fixture with scored rows and a JSON content type`
- `serves an index.html that mounts the flow after the user-content store`

## 3. What shipped, file-and-fence

### In fence

`app-bootstrap.js` — `sheetAccessGateIsInErrorMode()` +
`mountOneFlowDemoBoard()`; the no-sheet branch mounts S0, keeps `initAuth` and
`renderSetupStarterSheetUi`, and no longer calls `checkInfraSetupGate`.

`discovery-status-handoff.js` — the cutover block: `oneFlow()`,
`isOneFlowOpen()`, `hasConfiguredSheet()`, `hasVerifiedProvider()`,
`hasServerFitProfile()`, `fitDraftFromDiscoveryProfile()`,
`resolveOneFlowEntryBeat()`, `startOneFlowIfNeeded()`.
`runPostAccessBootstrapOnce` calls the last of these instead of the two gates.
`requestDiscoverySetup` also defers while a beat owns the screen (B5 *is*
discovery setup; a second wizard over it would strand the beat).

The §3.3 ladder, read deepest-first, each rung presupposing the one below:

| Legacy state | Entry beat |
|---|---|
| `infraSetupComplete && onboardingComplete` | none — flow marked completed, never renders |
| no sheet | B1 `google` |
| `onboardingComplete` && no server fit profile | B4 `fit`, prefilled from the discovery profile |
| provider configured **and** live-verified | B3 `resume` |
| sheet configured only | B2 `ai` |
| any saved `onboardingFlowState.beat` | that beat — resume outranks the ladder (§3.4) |

"Verified" is not stored anywhere — B2 defines it as a live round trip, so the
migration spends one. A configured provider whose key has since died lands back
on B2, which is the beat that exists to catch exactly that. An unreachable
`/profile` server is treated as "the profile exists": re-asking for work the
user may already have done is the one thing §3.3 forbids.

`tests/oneflow-l6-harness.mjs` — one loader, `loadCutover()`, that builds the
whole page in a single vm context in index.html's order (store, telemetry,
shell, controller, six beats, demo board, celebration, first-run wizard,
sheet-access setup, welcome, status handoff, app-bootstrap, and optionally the
what's-next banner). Because the sandbox *is* the page, a surface that can
steal the screen in production steals it in the probe. Reuses L0's DOM and
IndexedDB fakes; `loadAuthSession()` runs auth-session.js on its own for the
given_name probes.

`tests/oneflow-l6-cutover.test.mjs`, `-migration.test.mjs`, `-routed.test.mjs`.

`tests/integration/onboarding-chain-convergence.test.mjs` — rewritten. Beats
are advanced by firing their **own** footer actions, never by calling the
controller past them, so a broken handoff between two beats fails here.

`tests/integration/greenfield-automation.test.mjs` — two cold-start cases.

### Routed grants (kickoff items 6–8)

`auth-session.js` — `userGivenName` kept from `/oauth2/v3/userinfo`, persisted
in both session records, restored and cleared with the rest, exposed as
`getUserGivenName()`/`setUserGivenName()`. The bearer token still never reaches
localStorage.

`oneflow-beat-google.js` — B1 reads the given name once on sign-in and writes
`ctx.runtime.firstName`.

`oneflow-beat-fit.js` — B4 leaves the saved payload on `ctx.runtime.fitProfile`
before completing, which is what B6's "Your search" card prefers over a second
`GET /profile`.

### Legacy tests updated (behavior I changed, per SUBSTRATE rule 6)

- `tests/oneflow-l0-wiring.test.mjs` — the "lands DARK" pair inverted into
  "the substrate is LIT — and only at the two boot files", plus a new test
  pinning that the three legacy surfaces reference the flow only to stand down.
- `tests/first-run-wizard.test.mjs` — "Infra setup gate ordering" now asserts
  the chain runs `startOneFlowIfNeeded` and neither gate; the bridge-wiring test
  asserts the wiring survives while app-bootstrap no longer calls it.
- `tests/onboarding-profile-persistence.test.mjs` — "onboarding is decided after
  access is resolved": same claim, new decider.
- `tests/discovery-cold-start-handoffs.test.mjs` — its harness now stubs
  `window.JobBoredOneFlow` in the legacy gates' place; the deep-link deferral
  claim is unchanged.

### Grep table (DoD)

`checkInfraSetupGate` / `checkOnboardingGate` — **still defined, no longer
called from boot**:

| Site | Status |
|---|---|
| `app-bootstrap.js` | **removed** — cold start mounts S0 |
| `discovery-status-handoff.js:1137` (was) | **removed** — `startOneFlowIfNeeded()` |
| `first-run-wizard.js:1290` `checkInfraSetupGate` | still defined; returns false while `window.JobBoredOneFlow` exists |
| `first-run-wizard.js:923-927` → `checkOnboardingGate` | still defined; unreachable — its wizard never opens now |
| `onboarding-wizard.js:509` `checkOnboardingGate` | still defined; no live caller |
| `sheet-access-setup.js:563` → `checkInfraSetupGate` | still called, now always declines |
| `bridge-registry.js:89/90/218/575`, `app-compat.js:530/548`, `app.js:307/308` | wiring only, untouched |

`JobBoredOneFlow` outside the flow's own files:

| Site | Why |
|---|---|
| `app-bootstrap.js:56` | mounts S0 (`JobBoredOneFlowDemoBoard`) |
| `discovery-status-handoff.js:1144` | the entry decision |
| `first-run-wizard.js:1291` | stand-down |
| `sheet-access-setup.js:46` | stand-down |
| `welcome.js:856` | stand-down |

Nothing outside these drives the flow; `tests/oneflow-l0-wiring.test.mjs` pins
that (a stand-down file may *ask* about the flow, never call
`open`/`goToBeat`/`completeBeat`/`registerBeat`).

## 4. Floor results — PASTED output

```
$ npm test
ℹ tests 2713
ℹ suites 658
ℹ pass 2712
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
npm test exit=0
```

The single `todo` is the pre-existing
`tests/submission-record-audit.test.mjs` entry ("blocked on the
canonical-ownership gate"); it is a `todo`, not a failure, and predates this
lane (baseline before any L6 change: 2663 tests, 0 fail, 1 todo, exit 0).

```
$ npm run lint:repo

> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
lint exit=0
```

```
$ npm run typecheck:repo

> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

(node --check across every registered browser file: no output = clean)
typecheck exit=0
```

```
$ npm run test:contract:all
OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js
OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload
OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js
OK schema (pipeline-update request): examples/pipeline-update-request.v1.json
OK integrations/openclaw-command-center/SKILL.md
contract exit=0
```

Raw captures: `.lane-evidence/floor.txt`, `.lane-evidence/npm-test-raw.txt`,
`.lane-evidence/grep-table.txt`.

## 5. Anything unverified, and the cross-fence edits this lane had to make

### A. Cross-fence edits beyond the three granted (orchestrator: please review)

Four edits outside my fence and outside the three routed grants. Each is
listed with what breaks without it. None deletes anything.

1. **`onboarding-flow.js` (L0) — added `seedRuntime(partial)`.**
   §3.3 row 4 requires B4 to open "prefilled from the discovery profile". B4
   reads its draft from `ctx.runtime.profileDraft`; the controller's `runtime`
   is module-private with no exported seam, and the persisted flow state
   normalizes unknown keys away, so migration had no way to hand B4 a draft.
   `seedRuntime` is six additive lines that `Object.assign` into that scratch;
   nothing else changed, and `maybeStart()` still renders nothing.

2. **`first-run-wizard.js` (L7's deletion target) — `checkInfraSetupGate()`
   returns false while `window.JobBoredOneFlow` exists.**
   Boot no longer calls it, but `sheet-access-setup.js`'s
   `revealSetupScreenAfterAuth()` still does — and "signed in with no sheet
   yet" is precisely Beat 1's own state. Without this, signing in from B1 pops
   the legacy first-run wizard over the flow shell and the cutover is
   cosmetic. Red-first probe:
   `the first-run infra wizard does not open over a beat (spec §3)`.

3. **`sheet-access-setup.js` — `oneFlowOwnsSurface()` guard on
   `revealPipelineSetupStepsScreen()`.**
   With (2) in place the reveal falls through to `#setupScreen` ("One more
   step.") instead, painting it over the beat. The guard sits beside the
   existing `firstRunWizardOwnsSurface()` one and uses the same shape.
   Red-first probe: `post-sign-in reveal does not paint the setup screen over
   a beat`.

4. **`welcome.js` — `shouldShowOnboarding()` returns false while the flow
   exists.** welcome.js boots on the `jb-v2` body flag (on by default) and
   mounts an `aria-modal` onboarding card whenever `onboardingComplete` is
   false — which is every cold start, i.e. exactly when S0 is the surface. Its
   empty-state half (`mountEmpty`, the piece §7 keeps) is untouched. Red-first
   probe: `welcome.js's onboarding card does not mount over the demo board`.

5. **`oneflow-beat-fit.js` (L2) — `runtime.resumeDraft` added to B4's draft
   alias chain.** This is a genuine cross-lane defect the new integration test
   caught on its first run: **B3 writes its drafted profile to
   `ctx.runtime.resumeDraft` (`oneflow-beat-resume.js:429, :497`) and B4 read
   only `ctx.runtime.profileDraft`.** The resume-first premise (spec §2.3) died
   between the two beats — B4 rendered completely empty and the user would
   retype everything they had just uploaded. No lane test covered the seam
   because L1 and L2 each tested their own side. Fixed on the B4 side because
   `normalizeDraft` already unwraps the `{ profile, source, starterTemplate }`
   wrapper B3 writes. **The orchestrator should decide whether the canonical
   key is `resumeDraft` or `profileDraft` and make L7 collapse the alias.**

### B. Known defects left alone (out of fence, not cutover regressions)

1. **B6's on-screen headline still reads the literal `{firstName}`.** The
   controller passes the static `beat.headline` to the shell as the step
   title (`onboarding-flow.js` `renderBeat`), and B6 registers
   `headline: "You're live, {firstName}."`. The *resolved* headline
   (`resolvePayoffState().headline`) only reaches the celebration overlay's
   title, which is where this lane's routed-item probes assert it. So the
   substitution works, but the shell's own title shows the placeholder.
   Smallest fix: let `beat.headline` be a function the controller calls with
   the context (L0 + L4 fence). **Worth fixing before the PR** — it is
   user-visible normative copy.

2. **`showSheetAccessGate` can still paint over a live beat.** Its existing
   `firstRunWizardOwnsSurface()` guard was not extended to the flow. The only
   way to hit it is a token expiry or a sheets-read failure mid-flow (B1 for a
   fresh visitor is signed out, so nothing calls it there). Deferring it would
   also need a resume path for when the flow closes, which is more design than
   this lane should decide. Flagged for L7, which retires the gate's
   onboarding role anyway.

3. **The blocking discovery gate (`#discoverySetupGate`) is now unreachable**
   rather than deleted: its only caller is `onboarding-wizard.js`'s
   auto-open-after-onboarding path, which runs only after `checkOnboardingGate`
   opens that wizard — and nothing calls that any more. L7 deletes it per §7.

### C. Not verified by this lane

- **No browser run.** Everything is asserted in vm sandboxes against the real
  modules; nobody has watched the flow in Chrome. The DOM fakes are L0's, now
  extended with `documentElement`, a document listener table,
  `document.querySelector`, `remove()`, `style.setProperty` and window timers.
  A real-browser pass on the cold start and B1→B6 is the obvious next check.
- **Live third parties.** SerpApi, Tailscale, OpenRouter and Google OAuth are
  all doubles. `hasVerifiedProvider()` calls the real
  `verifyResumeProviderLive()` in production; the probes stub it.
- **The §3.3 migration rows are synthesized**, not replayed from a real legacy
  profile on disk. Spec §10 Phase 4's acceptance ("a legacy profile passes the
  acceptance script") still wants one real migration.
- **`isAllMandatorySetupComplete()` stays false after a completed flow**,
  because `goLiveSetupComplete` is false — go-live is a deferred §6 moment the
  banner nudges, not part of the flow. That is intended, and the integration
  test pins it; naming it here so nobody reads it as a miss.
- **Nothing was pushed.** Five local commits on `feat/oneflow-cutover`.

### D. Sandbox

No commit or tooling refusals. All five commits landed locally; the repo's
pre-commit syntax check passed each time.
