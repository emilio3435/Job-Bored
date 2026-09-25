# Lane report: stable-transport

Claim **STABLE-1** (primary) + **LIFECYCLE-1** poll-retry classification (second unit, LD-4 ii).
Branch `feat/discovery-hardening-stable-transport`, cut from the locked spec commit `d57fdac`.
Runtime: Node v24.13.0, npm 11.17.0. Vehicle: Opus 5 (`claude --model opus --effort high`) — confirmed.

## Scope and ownership

Two units, per PROGRAM-SPEC LD-4 / LD-5 / LD-8 and `KICKOFF-stable-transport.md`.

**Unit (i) — STABLE-1 hop attribution.** `diagnoseDownstreamChain` decided "this setup uses a
tunnel" from the mere presence of `localWebhookUrl`. `scripts/bootstrap-local-discovery.mjs:1665`
and `config-overrides.js:433–436` write that field for **every** local worker, Tailscale included,
so a Tailscale box with a healthy worker and a broken `tailscale serve` was told to fix an ngrok
tunnel it does not have. Repair: decide from a real tunnel URL or the saved webhook's own kind.

**Unit (ii) — LIFECYCLE-1 poll classification.** `pollRunStatus` called `markPollError` for every
non-ok response, so a `404 Run not found` or a `401` bad status token burned three retries and then
told the user "Lost the status connection after multiple attempts. The discovery run may still be
running." — a false statement. Repair: `classifyRunStatusPollResponse(status)` + a terminal-marking
entry point on the tracker.

### Files touched (all inside the fence)

| File | Unit | Kind |
|---|---|---|
| `discovery-status-handoff.js` | (i) + (ii) | production |
| `discovery-run-tracker.js` | (ii) | production |
| `tests/discovery-stable-transport.test.mjs` | (i) | new test |
| `tests/discovery-lifecycle-poller.test.mjs` | (ii) | new test |

**Not touched, and why:**
- `tests/run-status-honesty.test.mjs` — routed to me for a minimal edit only on a *proven*
  conflict. No conflict arose: all 21 tests pass unchanged, including `:206–213` (ngrok fix survives
  for a real tunnel) and `:215–221` (local-server fix when a local webhook is down). Left byte-identical.
- `discovery-readiness.js` — the row-5 coverage hole needed **no seam**; `showDiscoveryVerificationToast`
  already behaves correctly and is now pinned by three tests. Zero production change there (LD-8 "prefer none").
- `config-overrides.js`, `dev-server.mjs`, `discovery-wizard-probes.js`, `package.json` — out of fence.

## Baseline and RED evidence

### RED 1 — STABLE-1 (`node --test .lane-evidence/stable-1-tailscale-hop.probe.test.mjs`), run on d57fdac before any edit

```
SUMMARY: "ngrok tunnel is not running."
PRIMARY FIX: {"id":"diag_fix_tunnel","label":"Fix tunnel","detail":"Go to the tunnel step to start ngrok."}
CONTROL SUMMARY: "Your discovery worker at mybox.tailnet-1234.ts.net is unreachable. Check that the machine running it is awake and that the saved URL in your connection settings is current, then re-test."
✖ STABLE-1: a Tailscale user with a healthy local worker is not told to fix ngrok (4.134708ms)
✔ STABLE-1 control: the same setup with NO local worker names the ts.net host (0.796375ms)
ℹ tests 2
ℹ pass 1
ℹ fail 1

✖ failing tests:

test at .lane-evidence/stable-1-tailscale-hop.probe.test.mjs:39:1
✖ STABLE-1: a Tailscale user with a healthy local worker is not told to fix ngrok (4.134708ms)
  AssertionError [ERR_ASSERTION]: a Tailscale setup has no ngrok tunnel — naming it points at the wrong hop
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'ngrok tunnel is not running.',
    expected: /ngrok/i,
    operator: 'doesNotMatch',
    diff: 'simple'
  }
```

The control test passing in the same run is what makes this a gap and not a broken probe.

### RED 2 — LIFECYCLE-1 poller (`node --test .lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs`)

```
[probe] 404 produced pollErrors=["Status endpoint returned HTTP 404"]
[probe] 401 produced pollErrors=["Status endpoint returned HTTP 401"]
▶ LIFECYCLE-1 probe — poll response classification
  ✔ LIFECYCLE-1: a 503 from /runs/:id is retryable and marks a poll error (2.040416ms)
  ✖ LIFECYCLE-1: a 404 from /runs/:id is terminal and must not burn a retry (1.808791ms)
  ✖ LIFECYCLE-1: a 401 from /runs/:id is terminal and must not burn a retry (0.713708ms)
✖ LIFECYCLE-1 probe — poll response classification (5.047792ms)
▶ LIFECYCLE-1 probe — statusPath / status_path contract
  ✔ LIFECYCLE-1: accepts camelCase statusPath from an accepted_async ack (0.963083ms)
  ✔ LIFECYCLE-1: accepts snake_case status_path from an accepted_async ack (0.451709ms)
✔ LIFECYCLE-1 probe — statusPath / status_path contract (1.556958ms)
ℹ tests 5
ℹ pass 3
ℹ fail 2

✖ failing tests:
✖ LIFECYCLE-1: a 404 from /runs/:id is terminal and must not burn a retry (1.808791ms)
  AssertionError [ERR_ASSERTION]: 404 (run not found) is not retryable — retrying it 3x and then claiming 'the run may still be running' is a false statement
  + actual - expected
  + [
  +   'Status endpoint returned HTTP 404'
  + ]
  - []
✖ LIFECYCLE-1: a 401 from /runs/:id is terminal and must not burn a retry (0.713708ms)
  AssertionError [ERR_ASSERTION]: 401 (bad/absent status token) is not retryable
  + actual - expected
  + [
  +   'Status endpoint returned HTTP 401'
  + ]
  - []
```

### RED 3 — the lane's own new suites, before implementation

`npm test -- tests/discovery-stable-transport.test.mjs` → `tests 8 / pass 6 / fail 2`:

```
test at tests/discovery-stable-transport.test.mjs:72:3
✖ STABLE-1: a Tailscale setup with a HEALTHY local worker is never told to fix ngrok (2.6505ms)
  AssertionError [ERR_ASSERTION]: a Tailscale setup has no ngrok tunnel — naming it points at the wrong hop
    actual: 'ngrok tunnel is not running.',
    expected: /ngrok/i,
    operator: 'doesNotMatch',

test at tests/discovery-stable-transport.test.mjs:106:3
✖ STABLE-1: a healthy local worker is described as running, not as the broken hop (0.538292ms)
  AssertionError [ERR_ASSERTION]: telling a user their running worker is unreachable is the same dishonesty in the other direction
    actual: 'ngrok tunnel is not running.',
    expected: /local worker is running/i,
    operator: 'match',
```

The other 6 tests in that file — the two ngrok-regression guards and the three row-5 toast cases —
passed on the base, by design: they are the guards that prove the repair does not over-reach.

`npm test -- tests/discovery-lifecycle-poller.test.mjs` → `tests 15 / pass 3 / fail 12`
(`TypeError: tracker.markStatusEndpointTerminal is not a function` for the tracker block;
`classifyRunStatusPollResponse` undefined for the classifier block; the two routing failures above).

## The 5-row hop matrix

Every row now cites a test that proves the **UI names that hop** as the failing one.

| # | Hop | Proven? | Proving test · line | What is asserted |
|---|---|---|---|---|
| 1 | **Dashboard** (own origin) | ✅ pre-existing | `tests/discovery-wizard-verify.test.mjs:44–51` (+ companion `:53–64`) | `classifyEndpointInput("http://127.0.0.1:8644/webhook")` from a non-local dashboard → `kind: invalid_endpoint`, message matches `/Localhost URLs won't work here/`; a local dashboard is allowed |
| 2 | **Scraper / worker** (local server) | ✅ pre-existing | `tests/run-status-honesty.test.mjs:215–221`; `tests/recovery-state.test.mjs:88–97` | `primaryFix.id === "diag_fix_local_server"` when a local webhook is configured and down; `classifyLocalRecoveryState` → `"worker_down"` when only the worker is down |
| 3 | **Tunnel / stable transport** | ✅ **closed by this lane** | `tests/discovery-stable-transport.test.mjs:72` (Tailscale + healthy worker → no ngrok, ts.net named, `diag_fix_reverify`), `:106` (worker described as running), `:132` (control: no worker → ts.net named), `:151` (ngrok user, tunnel stopped → still told about ngrok), `:173` (saved tunnel URL still counts as tunnel transport). Pre-existing: `tests/run-status-honesty.test.mjs:183–196`, `:206–213`; `tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs:54,71` | the summary names the transport in front of a healthy worker, and only a real tunnel gets the ngrok remediation |
| 4 | **Relay** | ✅ pre-existing | `tests/run-status-honesty.test.mjs:223–285` | `tunnel.stale` / `relay.targetMismatch` transitions and `summary` matching `/ngrok URL changed/i`, incl. trailing-slash and invalid-URL edges |
| 5 | **Secret auth** | ✅ **closed by this lane** | `tests/discovery-stable-transport.test.mjs:243` (auth_required → toast names `x-discovery-secret`, "Copy bootstrap command" copies `npm run discovery:bootstrap-local`), `:274` (tunnel hop → "Fix tunnel"), `:295` (Tailscale failure → no ngrok remediation). Classifier pre-existing: `tests/discovery-webhook-secret-header.test.mjs:133–223`; `tests/discovery-wizard-verify.test.mjs:109–168` | `showDiscoveryVerificationToast` (`discovery-readiness.js:801–869`) — previously called by zero tests — turns each verification kind into the right visible text and action |

Two corrections to the scout's version of the matrix:
- Row 2's copy pin was cited as `tests/recovery-state.test.mjs:305`. That line is the **`tunnel_down`**
  copy (a row-3 assertion), not `worker_down`. Row 2's state proof is `:88–97`; there is no dedicated
  `worker_down` copy assertion in that file. Not a gap for STABLE-1 — the user-facing worker string is
  proven at `tests/run-status-honesty.test.mjs:215–221` — but worth knowing before someone cites `:305`.
- Row 3's `tests/dev-server-tailscale.test.mjs` asserts the `/__proxy/tailscale-state` **server payload**
  (`recommendation: needs_install | needs_login | needs_serve | ready`), not any UI string. It proves the
  data exists for the UI to name the hop; it is not itself a UI-naming proof. Kept in the gate, not cited as row 3's proof.

## Implementation

### Unit (i) — `discovery-status-handoff.js`

1. `diagnoseDownstreamChain`, ~line 224: `usesTunnelTransport` no longer reads `localUrl`.
   It is now `!!(snapshot.tunnelPublicUrl || transport.tunnelPublicUrl)`. The saved webhook's own
   kind is already the second half of the decision: `getRemoteDiscoveryWebhookHost` (`:162–180`)
   returns `""` for an ngrok URL — an ngrok webhook **is** the tunnel — so an ngrok user whose
   tunnel is stopped still falls through to the ngrok branch and is still told about ngrok
   (pinned at `tests/discovery-stable-transport.test.mjs:151`).
2. The `remoteWebhookHost` summary (~`:289`) now has two shapes. With an unreachable/absent local
   worker it keeps the exact existing sentence, byte-for-byte, so `tests/run-status-honesty.test.mjs:183–196`
   and the scout's control case stay green. With a **healthy** local worker it says
   `"Your local worker is running, but <host> is not reachable. …"` — LD-5's recommended copy shape.
   `primaryFix.id` is `diag_fix_reverify` in both, unchanged.

No other branch of the ladder moved. `probeNgrokTunnels`, the relay/stale branch, "Everything looks
connected" and the fallback are untouched.

### Unit (ii) — `discovery-status-handoff.js` + `discovery-run-tracker.js`

1. **`classifyRunStatusPollResponse(status) → "ok" | "retryable" | "terminal"`** (exported, pure,
   no model call): 2xx → `ok`; `401/403/404/405/410` → `terminal`; everything else, including
   network failures (`0` / non-numeric) and the transient set `408/425/429/500/502/503/504`, →
   `retryable`. Unknown codes stay retryable so no current behavior silently becomes terminal.
2. **`describeTerminalRunStatusPoll(status)`** (exported) produces the honest copy:
   401/403 → "The status endpoint rejected this run's status token (HTTP n)…",
   404/410 → "The worker has no record of this run (HTTP n)…", else a generic settled message.
   All three end with "Status updates have stopped — check Runs or your sheet for the outcome."
   None of them says the run may still be running.
3. **`pollRunStatus`** routes `terminal` to the tracker's terminal entry point and returns before
   `markPollError` is ever called, so no retry is burned. `retryable` keeps the existing
   `markPollError("Status endpoint returned HTTP n")` path verbatim.
4. **`discovery-run-tracker.js` gains `markStatusEndpointTerminal(message)`** — the one new
   terminal-marking entry point the kickoff asked for. It sets `pollErrorCount` to `MAX_POLL_ERRORS`,
   `statusUnavailable = true`, and a new `statusEndpointTerminal = true` flag that travels with the
   persisted state. The flag is cleared by `beginTracking`, `resumeFromPollError`,
   `resumeFromStatusPollingFailure` and any successful `updateFromStatusResponse`, and is rehydrated
   in `_load()` / defaulted in `_idle()`.
   `pollRunStatus` falls back to `markStatusConnectionLost` with the same honest message when a
   mounted tracker predates the new method — this is what lets the scout's pre-copied probe (whose
   fake tracker has only the old methods) go green, and it is pinned at
   `tests/discovery-lifecycle-poller.test.mjs:230`.
5. **The false copy is removed at both places it could surface.** The poll loop returns before
   `markStatusConnectionLost("… The discovery run may still be running.")` can overwrite the honest
   message; `renderDiscoveryRunStatus`'s `polling_error` case renders `state.errorMessage` when
   `statusEndpointTerminal` is set, and keeps the existing "may still be running" copy for a genuinely
   exhausted retryable failure (both pinned, `:247` and `:269`).
6. `resumeDiscoveryStatusPollingIfNeeded` does not restart polling for a settled endpoint — otherwise
   "stop polling" would last only until the next reload.

No environment-specific address or secret entered source: the only hostnames in the new tests are
`mybox.tailnet-1234.ts.net` and `abc123.ngrok-free.app`, both already-established repo fixtures
(`tests/run-status-honesty.test.mjs:185,209,224`).

## Verification and raw output

### RED → GREEN, unit (i) — the scout's pre-copied probe, after implementation

```
$ node --test .lane-evidence/stable-1-tailscale-hop.probe.test.mjs
SUMMARY: "Your local worker is running, but mybox.tailnet-1234.ts.net is not reachable. Check that the stable transport in front of it is up and that the saved URL in your connection settings is current, then re-test."
PRIMARY FIX: {"id":"diag_fix_reverify","label":"Re-test","detail":"Re-run the connection test against mybox.tailnet-1234.ts.net."}
CONTROL SUMMARY: "Your discovery worker at mybox.tailnet-1234.ts.net is unreachable. Check that the machine running it is awake and that the saved URL in your connection settings is current, then re-test."
✔ STABLE-1: a Tailscale user with a healthy local worker is not told to fix ngrok (2.949208ms)
✔ STABLE-1 control: the same setup with NO local worker names the ts.net host (0.571167ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 47.104167
```

The worker scout's independent copy of the same probe:

```
$ node --test .lane-evidence/scout-worker/stable-transport-hop.probe.test.mjs
[probe] summary="Your local worker is running, but mybox.tailnet-1234.ts.net is not reachable. Check that the stable transport in front of it is up and that the saved URL in your connection settings is current, then re-test." primaryFix="diag_fix_reverify" tunnel={"status":"not_running","url":"","active":false,"stale":false}
▶ STABLE-1 probe — failing-hop attribution on the Tailscale path
  ✔ STABLE-1: a healthy local worker behind a DOWN ts.net serve must not be diagnosed as an ngrok tunnel failure (2.5305ms)
✔ STABLE-1 probe — failing-hop attribution on the Tailscale path (2.85575ms)
ℹ tests 1
ℹ suites 1
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 44.891291
```

### RED → GREEN, unit (ii) — the scout's pre-copied probe, after implementation

```
$ node --test .lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs
▶ LIFECYCLE-1 probe — poll response classification
  ✔ LIFECYCLE-1: a 503 from /runs/:id is retryable and marks a poll error (…)
  ✔ LIFECYCLE-1: a 404 from /runs/:id is terminal and must not burn a retry (0.834875ms)
  ✔ LIFECYCLE-1: a 401 from /runs/:id is terminal and must not burn a retry (0.338292ms)
✔ LIFECYCLE-1 probe — poll response classification (2.659667ms)
▶ LIFECYCLE-1 probe — statusPath / status_path contract
  ✔ LIFECYCLE-1: accepts camelCase statusPath from an accepted_async ack (0.622916ms)
  ✔ LIFECYCLE-1: accepts snake_case status_path from an accepted_async ack (0.289292ms)
✔ LIFECYCLE-1 probe — statusPath / status_path contract (0.974083ms)
ℹ tests 5
ℹ suites 2
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 41.856041
```

Note: the `404` and `401` `[probe]` stderr lines that printed `pollErrors=[…]` on the base are now
absent, because no poll error is recorded at all.

### The lane's own suites, GREEN

```
$ npm test -- tests/discovery-lifecycle-poller.test.mjs
▶ LIFECYCLE-1 — classifyRunStatusPollResponse
  ✔ LIFECYCLE-1: 2xx is ok (0.322ms)
  ✔ LIFECYCLE-1: transient transport failures are retryable (0.063834ms)
  ✔ LIFECYCLE-1: answers that will not change on retry are terminal (0.049792ms)
  ✔ LIFECYCLE-1: an unknown or missing status stays retryable (0.057375ms)
✔ LIFECYCLE-1 — classifyRunStatusPollResponse (0.829667ms)
▶ LIFECYCLE-1 — pollRunStatus routes by classification
  ✔ LIFECYCLE-1: a 503 from /runs/:id is retryable and burns one retry (1.2655ms)
  ✔ LIFECYCLE-1: a network error is retryable (0.420791ms)
  ✔ LIFECYCLE-1: a 404 from /runs/:id is terminal and must not burn a retry (0.391083ms)
  ✔ LIFECYCLE-1: a 401 from /runs/:id is terminal and names the status token (0.537667ms)
  ✔ LIFECYCLE-1: a tracker without the terminal entry point still gets honest copy (0.528125ms)
✔ LIFECYCLE-1 — pollRunStatus routes by classification (3.324542ms)
▶ LIFECYCLE-1 — the user-visible message stops claiming the run continues
  ✔ LIFECYCLE-1: a terminal status endpoint renders the honest reason, not 'may still be running' (0.486334ms)
  ✔ LIFECYCLE-1: an exhausted retryable failure keeps the existing 'may still be running' copy (0.298125ms)
✔ LIFECYCLE-1 — the user-visible message stops claiming the run continues (0.833542ms)
▶ LIFECYCLE-1 — the tracker records a terminal status endpoint
  ✔ LIFECYCLE-1: markStatusEndpointTerminal stops polling without claiming the run continues (1.423667ms)
  ✔ LIFECYCLE-1: an explicit retry clears the terminal marker (0.343083ms)
  ✔ LIFECYCLE-1: a successful poll clears the terminal marker (0.316667ms)
  ✔ LIFECYCLE-1: beginTracking starts a fresh run without the marker (0.239667ms)
✔ LIFECYCLE-1 — the tracker records a terminal status endpoint (2.379208ms)
ℹ tests 15
ℹ suites 4
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 47.965458
```

### The six named tests (48/48, matching the scout's baseline exactly)

```
$ npm test -- tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs   → ℹ tests 18  ℹ pass 18  ℹ fail 0
$ npm test -- tests/dev-server-tailscale.test.mjs                                 → ℹ tests  5  ℹ pass  5  ℹ fail 0
$ npm test -- tests/discovery-transport.test.mjs                                  → ℹ tests  9  ℹ pass  9  ℹ fail 0
$ npm test -- tests/discovery-readiness-truth.test.mjs                            → ℹ tests  5  ℹ pass  5  ℹ fail 0
$ npm test -- tests/discovery-wizard-verify.test.mjs                              → ℹ tests  6  ℹ pass  6  ℹ fail 0
$ npm test -- tests/discovery-cold-start-handoffs.test.mjs                        → ℹ tests  5  ℹ pass  5  ℹ fail 0
```

### Targeted gate (the kickoff's exact command)

```
$ npm test -- tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs tests/dev-server-tailscale.test.mjs tests/discovery-transport.test.mjs tests/discovery-readiness-truth.test.mjs tests/discovery-wizard-verify.test.mjs tests/discovery-cold-start-handoffs.test.mjs tests/run-status-honesty.test.mjs tests/recovery-state.test.mjs tests/discovery-run-status-polling.test.mjs tests/discovery-stable-transport.test.mjs tests/discovery-lifecycle-poller.test.mjs
…
ℹ tests 141
ℹ suites 27
ℹ pass 141
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 139.8305
```

`tests/run-status-honesty.test.mjs` (21 tests, incl. all of `:167–286`) and
`tests/discovery-run-status-polling.test.mjs` (17 tests) are green **without any edit**.

### Repository floor

```
$ npm run typecheck:repo
> command-center@0.1.0 typecheck:repo
…
> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
(exit 0)

$ npm run lint:repo
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md
(exit 0)

$ npm run test:repo
(exit 0)
ℹ tests 2507      ← root node:test suite
ℹ pass 2506
ℹ fail 0
ℹ skipped 0
ℹ todo 1          ← pre-existing: tests/submission-record-audit.test.mjs:18, unrelated to this lane
ℹ tests 727       ← integrations/browser-use-discovery
ℹ pass 727
ℹ fail 0
ℹ skipped 0
ℹ todo 0

$ npm test            # run-tests.mjs — the real gate; test:repo's `node --test tests/*.test.mjs` skips tests/integration/
(exit 0)
ℹ tests 2538
ℹ pass 2537
ℹ fail 0
ℹ skipped 0
ℹ todo 1

$ git diff --check
(no output, exit 0)
```

`npm test` was run in addition to the floor because `test:repo`'s `node --test tests/*.test.mjs`
silently skips `tests/integration/` (GROUND-RULES trap 1). The 31-test delta is that directory; it is green.

## Commit, risks, and handoff

**Commit:** `dfbad73f16a70e0d9fa1c4bc40a2cc43fafa9a8a` (`dfbad73`) — `fix(discovery-hardening/stable-transport): name the real failing hop and stop retrying settled status polls`
(one coherent commit, both units, per the kickoff's DoD). Local only; nothing pushed, no PR, no remote touched.
The report itself is gitignored (`.gitignore:80` `LANE-REPORT-*.md`), so it is not in the commit — it stays in the worktree for the integrator.

Diff reviewed line by line and scanned for `ya29.` / `AIza` / `sk-` / long opaque tokens / `.env`
values / real Sheet IDs — none present. The only hostnames are the repo's existing test fixtures.

### Risks

1. **Behavior change for one real configuration.** A user whose saved webhook is a remote https host
   (Tailscale, workers.dev, any non-ngrok https) **and** who has no `tunnelPublicUrl` saved, with a
   healthy local worker, now gets the remote-host summary + `diag_fix_reverify` instead of
   "ngrok tunnel is not running" + `diag_fix_tunnel`. That is the point of the claim. A user who
   genuinely fronts a local worker with ngrok is unaffected: either they have `tunnelPublicUrl`
   saved (`tests/discovery-stable-transport.test.mjs:173`) or their saved webhook is the ngrok URL
   itself, which `getRemoteDiscoveryWebhookHost` deliberately returns `""` for (`:151`).
2. **New persisted state field.** `statusEndpointTerminal` is additive and defaults to `false` in
   `_load()`, so state written by an older build rehydrates unchanged. It is cleared on every path
   that resumes or restarts a run, so it cannot strand a live run in a settled-looking state.
3. **Unclassified HTTP codes stay retryable.** A `400` or `501` from a status endpoint still burns
   three retries and lands on the old "may still be running" copy. Deliberate: only codes the spec
   proved are settled stop the poller.

### Handoff to the orchestrator

- **`discovery-run-tracker.js` is absent from `typecheck:repo`.** `package.json:76` runs
  `node --check` over ~90 root browser files; `discovery-run-tracker.js` is not one of them, so a
  syntax error in it would pass the floor silently (GROUND-RULES trap 2, in its "existing file"
  form). I verified my edit with `node --check discovery-run-tracker.js` by hand (clean). `package.json`
  is Lane E's fence — **Lane E or the integrator should add `&& node --check discovery-run-tracker.js`**
  to `typecheck:repo`. I did not touch `package.json`.
- **`tests/run-status-honesty.test.mjs` was routed to me and I did not need it.** It is unmodified,
  so the routing costs the integrator nothing and no other lane is blocked on it.
- **`config-overrides.js:418–440` is still the write path that made this gap reachable** — it writes
  `localWebhookUrl` unconditionally. The fix is correct without changing it (the consumer no longer
  over-reads the field), and it is in no lane's fence. Flagged so a reviewer does not ask for a
  second change; no follow-up needed for STABLE-1.
- **Lane C overlap:** none. My LIFECYCLE-1 work is browser-side only, in files LD-4 assigns
  exclusively to this lane. Lane C's browser-side characterization tests
  (`statusPath` / `status_path`, `tests/discovery-lifecycle.test.mjs`) do not collide — I added no
  test to that file, and `resolveAcceptedRunStatusPath` is unchanged.
- **Merge-order note (A → B → C → D → E):** this lane touches no file any earlier lane owns, so a
  rebase onto C should be clean.

No environmental blockers. Nothing was skipped, filtered, or marked `.skip`.
