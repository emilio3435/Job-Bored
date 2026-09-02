# LANE REPORT — B3 beat-ergonomics (claims C2, C4, C5, C6)

Branch `feat/sixbeats-beat-ergonomics`, base `ed44f35`. Committed locally, never pushed.

## 1. What this lane was

Four small red-first ergonomics repairs inside the six-beat onboarding, per
`docs/programs/sixbeats-20260902/KICKOFF-B3-beat-ergonomics.md`:

- **C2** — Beat 3's template grid was a one-way door: choosing to look at the four
  starter templates replaced the dropzone and the paste box, and the only route back
  was a page reload, which also threw away any pasted text.
- **C4** — `?greenfield=1` stayed in the address bar after the cold-start reset ran,
  so a refresh mid-setup re-ran it (dropping IndexedDB again) and landed the user back
  on cold start — against spec §3.4's "reopening or refreshing lands on
  `onboardingFlowState.beat` with drafts restored".
- **C5** — closing the flow via Escape or × preserved the saved beat but said nothing
  on screen, so pausing read as losing the setup (spec §3.4: closing is pausing).
- **C6** — B2's `Check & continue` and B5's fuel `Save & verify` spun on one
  motionless line above a disabled button with no elapsed count and no way out.

## 2. Which claims went red first (named tests)

Committed red at `64bd164` (all four suites failing on `ed44f35`):

| Claim | Suite | Red result before the fix |
|---|---|---|
| C2 | `tests/sixbeats-b3-template-escape.test.mjs` | 4 tests, 4 fail — no `resume_back` action, no route out of the grid |
| C4 | `tests/sixbeats-b3-greenfield-url.test.mjs` | 6 tests, 4 fail — the param survives, and a second load drops the store again |
| C5 | `tests/sixbeats-b3-close-pauses.test.mjs` | 5 tests, 2 fail — no toast on Escape or on the close button |
| C6 | `tests/sixbeats-b3-slow-check.test.mjs` | 6 tests, 6 fail — no timings seam, no elapsed label, no stall affordance |

Each suite also carries guard probes that were green before AND after, pinning the
behavior the repair must not disturb: the preserved flow state and `beat_abandoned`
emission on close, the persisted greenfield mask and forced-consent flag, the
"no toast when the flow finishes" case, and "a fast check earns no apology".

One extra probe was added with the C6 fix — *"lets a Try again supersede the stalled
check instead of racing it"*. It was verified to fail when the run-token guard is
removed (`ℹ pass 6 / ℹ fail 1`), so it is not hollow.

## 3. What shipped, file-and-fence

Everything is inside the lane fence.

- **`oneflow-beat-resume.js` (C2)** — new `ACTION_BACK = "resume_back"`. While
  `state.mode === "templates"` the footer carries exactly one secondary action,
  `Back to upload or paste`, which returns to intake. The pasted draft already lived
  in `state.pasteDraft` (written per keystroke) rather than in the textarea, so it
  survives the round trip untouched; the probe locks that it does, and that the
  preserved text is what `/profile/from-resume` then receives.
- **`config-overrides.js` (C4, greenfield function only)** — `GREENFIELD_URL_PARAMS`
  is now one list (`greenfield`, `fresh`, `reset`) used both to detect the switch and
  to spend it. After the reset applies, `stripGreenfieldUrlParams()` removes those
  params with `history.replaceState`, keeping the path, the hash and every other
  param. No History API → a warn, and the reset still stands. The persisted mask,
  the forced-consent flag and the IndexedDB drop are byte-for-byte unchanged.
- **`onboarding-flow.js` (C5, close hook only)** — `handleShellClose()` shows the
  existing toast through the `JobBoredApp.core.host.showToast` bridge with the
  normative line *"Setup paused — pick up anytime from the corner pill."* for the
  reasons a person causes (`escape`, `close-button`, `close`). `flow-complete` never
  reaches this function and `destroy` is a teardown nobody asked for, so neither
  toasts. No confirm dialog. The saved beat and the `beat_abandoned` emission are
  untouched.
- **`oneflow-beat-ai.js` + `oneflow-beat-discovery.js` (C6)** — each beat gained a
  local clock (`startCheckWatch` / `startFuelWatch`) around its long action. Past
  `slowAfterMs` (2 s) the busy list gains a live `still checking… N s` row; past
  `stalledAfterMs` (15 s) that row becomes `Taking longer than usual`, the message
  slot explains the wait and offers a fresh attempt, and a ghost `Try again` action
  appears in the footer (`ai_retry_check` / `oneflow_discovery_fuel_retry`). The
  clock then stops — **the request does not**: a provider or worker that finally
  answers still passes the beat. A retry pressed over an in-flight attempt bumps a
  run token, and the superseded attempt drops its answer instead of writing over the
  screen the newer one owns. Thresholds live in a mutable `CHECK_TIMINGS` exposed on
  each beat's `_internal` test seam.

The helper is duplicated in the two beats on purpose: a shared module would be a new
browser file, which ONEFLOW ground-rules trap #2 says to report rather than invent.
See §5.

No new browser JS files, so `typecheck:repo` needed no new `node --check` entry. No
copy outside the two strings the kickoff quotes was changed.

## 4. Floor results — PASTED output

`npm test` (the only gate that counts — baseline on `ed44f35` was `tests 2593 / pass 2592 / fail 0 / todo 1`):

```
ℹ tests 2615
ℹ suites 630
ℹ pass 2614
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 1
ℹ duration_ms 6558.250334

✖ failing tests:

test at tests/submission-record-audit.test.mjs:17:1
✖ persists and can remove the canonical submission evidence record (2.244625ms) # blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store
```

That single line is the pre-existing `todo` (`fail 0`); it reports identically on the
base commit and is outside this fence.

`npm run lint:repo`:

```
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs

OK integrations/openclaw-command-center/SKILL.md
```

`npm run typecheck:repo` (head + tail; the middle is the `node --check` chain, all silent):

```
> command-center@0.1.0 typecheck:repo
> npm run typecheck:browser-use-discovery && node --check app.js && … && node --check onboarding-celebration.js

> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
```

`npm run test:contract:all`:

```
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
```

Per-claim suites, run individually:

```
tests/sixbeats-b3-template-escape.test.mjs   ℹ tests 4  ℹ pass 4  ℹ fail 0
tests/sixbeats-b3-greenfield-url.test.mjs    ℹ tests 6  ℹ pass 6  ℹ fail 0
tests/sixbeats-b3-close-pauses.test.mjs      ℹ tests 5  ℹ pass 5  ℹ fail 0
tests/sixbeats-b3-slow-check.test.mjs        ℹ tests 7  ℹ pass 7  ℹ fail 0
```

## 5. Anything unverified, including what the sandbox refused

- **No screenshots.** B3 is not a visual lane (the addendum requires before/after
  pairs from V1, V2 and Q1). Everything here is proved by DOM assertions through the
  real shell in the L1/L3 harnesses — the rendered busy list, the rendered message
  slot, the rendered footer buttons — not by source regexes. Nothing in this lane was
  exercised against a live browser or a real provider; **the C6 thresholds are proved
  at millisecond scale, not at the shipped 2 s / 15 s.** The constants themselves are
  the one thing a human should sanity-check on screen.
- **Routed to the orchestrator — the duplicated clock.** `startCheckWatch` in
  `oneflow-beat-ai.js` and `startFuelWatch` in `oneflow-beat-discovery.js` are the
  same ~30 lines twice. The honest home for it is a shared helper on the shell
  (`discovery-wizard-shell.js` already owns `setBusy`/`clearBusy`, and every future
  long action would inherit the affordance for free), but that file belongs to lane
  V2 and a standalone module would be an unplanned new browser file. Flagging as
  cleanup, not blending the two.
- **`STALLED_MESSAGE` is new copy.** The kickoff supplies the two normative fragments
  ("still checking… 4 s", "Taking longer than usual", "Try again"); the sentence
  around them is mine, written to §8's rules — honest about what is still running,
  names the next action, promises nothing. Worth a copy pass.
- **Fresh-attempt semantics on the B5 fuel retry.** Pressing Try again re-POSTs the
  SerpApi key and re-issues the forced worker restart while the first pair may still
  be in flight. Both are idempotent writes against the same key and the same worker,
  and the run token keeps the stale answer off the screen — but this was verified in
  the harness, never against a real worker on 8644.
- **`toast()` in `onboarding-flow.js` is a no-op when the bridge is absent** (the
  substrate can load before `bridge-registry.js` wires `JobBoredApp.core.host`). That
  is deliberate — a missing toast must never take the close path down — but it means
  a boot-order regression would silently lose the pause line rather than throw.
- **`LANE-REPORT-*.md` is gitignored** (`.gitignore:80`), so this report lives in the
  worktree and is not in any commit. Nothing else in the lane was refused: commits,
  tests, lint and typecheck all ran normally in this worktree.
