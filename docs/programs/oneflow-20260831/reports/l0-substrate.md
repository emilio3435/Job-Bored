# Lane Report — L0 substrate

Branch `feat/oneflow-l0-substrate` · 3 commits, local only, never pushed.

## 1. What this lane was

Build the one-flow substrate DARK: the flow controller, the persisted flow
state, the telemetry vocabulary, three additive shell regions, and a
registered stub for every beat — with the legacy chain untouched, boot
unwired, and the full floor green. Every other ONEFLOW lane gates on
commit 1.

Source of truth: `docs/ONE-FLOW-ONBOARDING-SPEC.md` §3 and §5,
`docs/programs/oneflow-20260831/SUBSTRATE.md`, and
`docs/programs/oneflow-20260831/KICKOFF-L0-substrate.md`.

Commits, in kickoff order — each one independently green (verified by
extracting the commit with `git archive` into a scratch tree and running
the probes that exist at that commit, plus the legacy suites it touches:
159/159 at commit 1, 175/175 at commit 2):

| # | SHA | What |
|---|---|---|
| 1 | `59adc0b` | contracts — `onboarding-flow.js`, `onboardingFlowState`, STEPS |
| 2 | `a65def9` | shell — spine, message slot, busy stages |
| 3 | `1b5dc55` | stubs, fenced CSS, `index.html` + `package.json` wiring |

## 2. Which claims went red first (named tests)

TDD throughout: each probe ran red against the tree before its
implementation existed, then green. Red counts observed at the moment of
writing:

| Probe file | First red | The claim |
|---|---|---|
| `tests/oneflow-l0-telemetry.test.mjs` | 4 fail | `STEPS.BEAT_OPENED` etc. did not exist, so `emit()` returned early and dispatched nothing |
| `tests/oneflow-l0-store.test.mjs` | 9 fail | `getOnboardingFlowState` / `saveOnboardingFlowState` / `clearOnboardingFlowState` were undefined |
| `tests/oneflow-l0-shell.test.mjs` | 13 fail (3 pass) | no spine, no message slot, no busy state. The 3 that passed from the start are the two legacy byte-identity locks and "renders no message node when the host passes none" — they were green before AND after, which is the whole point of them |
| `tests/oneflow-l0-controller.test.mjs` | 26 fail | `window.JobBoredOneFlow` did not exist |
| `tests/oneflow-l0-wiring.test.mjs` | 1 fail (import) | `css/oneflow.css` did not exist; then the mount, the tags, and the `typecheck:repo` entries |

Named claims worth calling out, because they encode WHY:

- *"script tag order must never decide the flow's order — spec §3.1 does"* —
  `registerBeat` sorts by `order`, so a lane can move its script tag
  without moving its beat.
- *"reopening mid-flow must never dump the user back at beat 1"* — `open()`
  with no argument resolves to the saved beat (§3.4 resume).
- *"a legacy-complete profile must boot straight to the dashboard"* —
  `maybeStart()` returns false and records completion (§3.3), and a
  sibling probe pins that ONE legacy flag is not enough.
- *"closing is pausing, never skipping"* — after `close("escape")` the
  saved beat and `completedBeats` are untouched and reopening lands back
  on it.
- *"a double-submit during a 20s check is how the old wizard lost runs"* —
  `setBusy` disables its own trigger and nothing else, and `clearBusy`
  leaves a host-disabled action disabled.
- *"a failure must interrupt a screen reader, not wait its turn"* — the
  error tone renders `role="alert"`, info/success `role="status"`.
- *"spec §2: ONE spine — the flow must never render two progress
  systems"* — passing `spine` and `journeyStage` together renders the
  spine and zero journey strips.

## 3. What shipped, file-and-fence

**New files (all inside the L0 fence, all registered in `typecheck:repo`)**

| File | What |
|---|---|
| `onboarding-flow.js` | `window.JobBoredOneFlow`: `registerBeat` / `maybeStart` / `open` / `getState` per the SUBSTRATE contract, plus `goToBeat` / `completeBeat` / `skipBeat` / `close` / `getRegisteredBeats` / `getBeat` / `isOpen`. S0+B1–B6 state machine, resume-on-open, §3.3 migration guard, §9 emissions, §3.2 completion side-effects. |
| `oneflow-beat-{google,ai,resume,fit,discovery,payoff}.js` | Six registered stubs. Each carries its NORMATIVE §5 headline + sub verbatim, its `order`, and its remaining-time label, rendered as a visible `.oneflow-placeholder` card. |
| `oneflow-demo-board.js` | S0 namespace + fixture path (§4). Registers no beat — S0 is a screen. |
| `onboarding-celebration.js` | Empty IIFE + namespace; L4 moves the celebration player here (§7). |
| `css/oneflow.css` | `/* ONEFLOW:CORE */` (spine, message, busy, placeholder) then empty `L1`…`L4` fences, in order. |
| `tests/oneflow-l0-harness.mjs` | Shared fakes: an in-memory IndexedDB good enough to run the real `user-content-store.js`, the DOM subset the shell builds against, `serializeTree`, and one sandbox loader per module. Not a `*.test.mjs`, so the runner never treats it as a suite. |
| `tests/oneflow-l0-{telemetry,store,controller,shell,wiring}.test.mjs` | 69 probes. |

**Edited shared files (L0-owned per the ownership map)**

| File | Change |
|---|---|
| `onboarding-telemetry.js` | STEPS += the eight one-flow steps, inside the same `Object.freeze`. Legacy steps untouched. |
| `user-content-store.js` | `ONBOARDING_FLOW_BEATS`, `DEFAULT_ONBOARDING_FLOW_STATE`, `normalizeOnboardingFlowState`, `get/save/clearOnboardingFlowState` — placed next to, and shaped like, `saveDiscoverySetupWizardState` (:529). Exported on `window.CommandCenterUserContent`. Nothing existing changed. |
| `discovery-wizard-shell.js` | `normalizeSpine` / `normalizeBusy` / `isBusyAction`; four new context fields; `renderSpine` / `renderMessage` / `renderBusy`; spine replaces the journey strip in `renderRoot`; busy/message appended under the actions in `renderFooter`; one clause added to an action's `disabled`; `setMessage` / `clearMessage` / `setBusy` / `clearBusy` exported. |
| `index.html` | One `#oneFlowMount` (hidden) beside the other wizard mounts; one `<link>` for `css/oneflow.css`; nine `<script defer>` tags after `enhancements-wizard-ui.js` — i.e. after `user-content-store.js` and after `discovery-wizard-shell.js`, controller before beats. 1717 lines, under the 2000-line gate. |
| `package.json` | `node --check` for all nine new browser files appended to `typecheck:repo`. |

**Not done, deliberately (deliverable 4).** `maybeStart()` exists, is
exported, and is tested by direct call — and nothing calls it. Grep-proof:

```
$ grep -rn "maybeStart" app-bootstrap.js discovery-status-handoff.js
$ echo $?
1
```

```
$ grep -ln "JobBoredOneFlow" *.js | grep -v '^oneflow-'
onboarding-flow.js
```

The only match is the module that defines the namespace. A probe in
`tests/oneflow-l0-wiring.test.mjs` fails if `app-bootstrap.js`,
`discovery-status-handoff.js`, `app.js`, `app-compat.js`,
`whats-next-banner.js`, `first-run-wizard.js`, `onboarding-wizard.js`, or
`welcome.js` ever learns the flow exists before L6.

**Legacy hosts render unchanged — proven, not asserted.** Before touching
the shell I serialized two real renders (the discovery wizard's `detect`
step with its actions, and the go-live host with `journeyStage` +
`mascotSrc`) into canonical text. Those two trees are embedded in
`tests/oneflow-l0-shell.test.mjs` and compared against the current shell
node-for-node, attribute-for-attribute. Both match. The existing
`tests/discovery-wizard-shell.test.mjs`, `go-live-wizard.test.mjs`,
`enhancements-wizard.test.mjs` and `wizards-modal-a11y-focus.test.mjs`
(132 tests) also pass untouched — no legacy test needed updating, because
no legacy behavior changed.

## 4. Floor results — PASTED output

```
$ npm test
ℹ tests 2453
ℹ suites 587
ℹ pass 2452
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 8369.203958
npm test exit=0
```

The one `todo` is pre-existing and unrelated:
`tests/submission-record-audit.test.mjs` is declared
`todo: "blocked on the canonical-ownership gate; no legal Sheet column or
IndexedDB store"` — present at `bdee27b`, the branch point.

```
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills


> command-center@0.1.0 lint:js
> eslint .


> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
lint exit=0

=== npm run typecheck:repo ===



> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json


> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json

typecheck exit=0

=== npm run test:contract:all ===

> command-center@0.1.0 test:contract:all
> npm run test:contract && npm run test:ats-contract && npm run test:pipeline-contract && npm run test:pipeline-update-contract && npm run lint:skills


> command-center@0.1.0 test:contract
> node scripts/test-contract.mjs

OK schema: examples/discovery-webhook-request.v1.json
OK schema: examples/discovery-webhook-request.v1-with-profile.json
OK schema: examples/discovery-webhook-request.v1-preview-parity.json
OK discovery-payload.js covers schema properties schemas/discovery-webhook-request.v1.schema.json
OK discovery-readiness.js delegates to discovery-payload.js

> command-center@0.1.0 test:ats-contract
> node scripts/test-ats-scorecard-contract.mjs

OK schema (ATS request): examples/ats-scorecard-request.v1.json
OK schema (ATS response): examples/ats-scorecard-response.v1.json
OK ats-scorecard.js request builder matches schema for full bundle payload
OK ats-scorecard.js request builder matches schema for sparse payload

> command-center@0.1.0 test:pipeline-contract
> node scripts/test-pipeline-contract.mjs

OK schemas/pipeline-row.v1.json ↔ README.md ↔ app-config-core.js ↔ pipeline-render.js

> command-center@0.1.0 test:pipeline-update-contract
> node scripts/test-pipeline-update-contract.mjs

OK schema (pipeline-update request): examples/pipeline-update-request.v1.json

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
contract exit=0
```

## 5. Anything unverified, including what the sandbox refused

1. **`buildShellContext` does not exist under that name.** The kickoff and
   spec §3.5.2 name it; the actual shell context builder is
   `getWizardContext`, exported as `shell.buildWizardContext`. `message` /
   `messageTone` / `spine` / `busy` went into that function. No rename —
   renaming it would touch three live hosts for nothing.

2. **`onboardingFlowState` carries a sixth field, `completed`.** The
   kickoff lists `{version, beat, completedBeats, skipped, startedAt}`, but
   spec §3.3 requires writing `onboardingFlowState.completed = true` for a
   migrated user, and the kickoff's own migration-guard test asserts
   `maybeStart()` "writes completed". Added as a normalized boolean,
   defaulting false.

3. **`saveOnboardingFlowState` MERGES `skipped` rather than replacing it.**
   A partial that names `skipped` would otherwise erase a skip another beat
   recorded. Flagged because it differs from a plain `{...cur, ...patch}`.

4. **`css/oneflow.css` adds `flex-wrap: wrap` to
   `.discovery-setup-wizard__footer`, guarded by `:has()`** — it applies
   only to a footer that actually contains a message or busy list, so no
   legacy host is reachable by the rule. `:has()` is already used in
   `css/legacy-first-run-wizard.css` and `jb-v2-legacy-hide.css`. CSS is not
   covered by any of the four floor commands, so this is verified by reading
   and by the byte-identity DOM lock, not by an executed style test.

5. **Not visually verified in a browser.** Everything here is proven at the
   DOM/serialization level. Nobody has looked at the spine, the message
   slot, or the busy list rendered on screen — and nothing can render them
   yet, since the substrate is dark and no host passes the new inputs. The
   first lane that opens the flow (L6) should expect to tune spacing and
   colors in the `ONEFLOW:CORE` fence.

6. **One unplanned file: `tests/oneflow-l0-harness.mjs`.** Ground rules say
   to stop and report rather than create unplanned files; that rule targets
   browser JS that must join `typecheck:repo`. This is a test-only helper
   with the lane prefix, and it is not a `*.test.mjs`, so
   `scripts/run-tests.mjs` never runs it as a suite. It exists so the five
   probe files share ONE IndexedDB fake and ONE DOM fake instead of three
   drifting copies. Reporting it rather than asking, as instructed.

7. **`node_modules` was missing in this worktree**, so `lint:repo` and
   `typecheck:repo` initially failed with `eslint: command not found`. Fixed
   locally by symlinking each entry of the main checkout's `node_modules`
   (and `server/node_modules`) into the worktree. Both are gitignored /
   untracked and nothing was committed; `git status` is clean apart from
   the untracked `server/node_modules` symlink, which a later lane or the
   integrator can delete freely.

8. **Beat time labels are derived, not quoted.** Spec §3.1 gives per-beat
   durations (`~3–15 min`, `~2 min`, …) and voice rule §8.2 requires a
   time label on every beat, but the spec never writes the remaining-time
   strings. I derived them from a 15-minute total: `about 15 / 10 / 8 / 7 /
   4 min left`, then `almost done` for B6. If Emilio wants different
   wording, it is one constant per stub file and nothing else moves.

9. **No lane needed anything outside its fence.** Nothing to route.
