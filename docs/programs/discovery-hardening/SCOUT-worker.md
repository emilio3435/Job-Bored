# Scout report — lane `discovery-hardening-scout-worker` (READ-ONLY)

Worktree `/private/tmp/Job-Bored-discovery-hardening-integration`, branch `feat/discovery-hardening`, HEAD `8f79235` at scout time.
Runtime: Node v24.13.0, npm 11.17.0.
No product file was changed. No commit was made. Scratch lives in `.lane-evidence/scout-worker/` (gitignored, `.gitignore:75`).

Baseline before probing (so every RED below is causal, not ambient):

```
$ npm run test:browser-use-discovery
ℹ tests 727
ℹ pass 727
ℹ fail 0
ℹ skipped 0
```

---

## LIFECYCLE-1

### (a) Exact files and line refs

**Worker — dispatch and order invariant** (`integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts`, 1402 lines):

| Step | Line |
|---|---|
| method check (405) | `:95` |
| secret auth (401 + `auth.category`) | `:108` -> `hasValidWebhookSecret` `:1337` |
| JSON parse (400) | `:124` |
| auth-probe short circuit (200, no run) | `:134` |
| **runId minted** | `:146-148` -> `createRunId` `:1310` |
| per-run `googleAccessToken` read + strip | `:177-184` |
| preflight (400 / 409 / 500) | `:235` -> `validateDiscoveryPreflight` `:611`; the Sheets-credential 409 is `:597` |
| first run-status side effect (`accepted`) | `:262-272` |
| per-run DiscoveryRuns finalizer created | `:274` |
| sync path (`completed_sync`, 200) | `:304` |
| async `running` persist (500 if it fails) | `:380-397` |
| watchdog | `:403` -> `src/webhook/safety-timer.ts` |
| async terminal success / failure `.then`/`.catch` | `:410-486` |
| `202 accepted_async` ack | `:491` |

**Worker — status store** (`src/state/run-status-store.ts`, 516 lines): `buildAcceptedRunStatus:73`, `buildRunningRunStatus:93`, `buildCompletedRunStatus:107`, `buildFailedRunStatus:146`, `createDiscoveryRunStatusStore:169`, terminal-immutability guard inside `put` at `:183-192`, `markNonTerminalRunsAbandoned:221`. Exported surface: `buildAcceptedRunStatus, buildCompletedRunStatus, buildFailedRunStatus, buildRunStatusPath, buildRunningRunStatus, createDiscoveryRunStatusStore` — **no `has`, no list/iterate**.

**Worker — Sheet effects**: `src/sheets/discovery-runs-writer.ts` `createTerminalHistoryFinalizer:63` (one `settled` promise **per finalizer instance**, and one instance is created per webhook invocation at `handle-discovery-webhook.ts:274`), `buildDiscoveryRunLogRowFromStatus:183`, `createDiscoveryRunsLogger:250`, `appendDiscoveryRunRow:264`, `parseDiscoveryRunsCells:102`. `src/sheets/pipeline-writer.ts` identity-match/merge loop `:765-806` (identity hit -> `updates.push` at `:789`, else `appends.push` at `:806`).

**Worker — HTTP**: `src/server.ts` store construction `:279`, `/health` `:1073`, `/runs/{runId}` `:1078` (405 non-GET; hosted-only token/secret auth `:1103-1126`; **404 `Run not found`** `:1129-1141`; 200 `{ok:true, ...payload}` `:1143`). `sharedRunDependencies` `:292-308` sets `randomId` but **never sets `runId`**. `src/contracts.ts`: `DiscoveryWebhookRequestV1` `:299` onward (**no runId, no idempotency key**; identity fields are `sheetId`, `variationKey`, `requestedAt`), `IngestUrlResponseV1.statusPath:542`, `DiscoveryWebhookAck.statusPath:1041`.

**Browser — poller** (`discovery-status-handoff.js`, 1356 lines): `MAX_POLL_ERRORS = 3` `:504`, `buildRunStatusUrl:514`, `resolveAcceptedRunStatusPath:540` with **`result.statusPath || result.status_path` at `:542`**, `buildDiscoveryStatusPollHeaders:589`, `pollRunStatus:606` (non-`ok` branch `:628-633`), `retryDiscoveryStatusConnection:646`, `startDiscoveryStatusPolling:763` (backoff `:798`, `markStatusConnectionLost` `:791`), `TERMINAL_RUN_STATUSES` `:837`. Dispatch handoff: `discovery-run-orchestration.js:389-408` (`resolveAcceptedRunStatusPath` `:392`, `beginTracking` `:393`, `statusUnavailable: !statusPath` `:401`). Second snake_case site: `discovery-wizard-verify.js:444-445`. Client-side abort of the dispatch POST: `discovery-wizard-verify.js:674-683` (`timeoutMs` default 15000 -> `AbortController.abort()`).

### (b) Current behavior

- **runId is server-generated, always fresh.** `handle-discovery-webhook.ts:146` falls back to `createRunId(randomId)` because `server.ts:292` never supplies `runDependencies.runId`, and `createRunId` is `run_${randomUUID()}`. The request schema carries no runId and no idempotency key. **Consequence: the worker cannot tell a duplicate delivery from a new run at all.** Two byte-identical POSTs mint two runIds, run discovery twice, and append two DiscoveryRuns rows.
- **Idempotency that DOES exist, and its scope:**
  - `run-status-store.put` `:189` — once a runId is terminal, later writes are ignored (`discovery.run_status.terminal_immutable_ignored`). Guards *late writers for one run*, not duplicate deliveries.
  - `createTerminalHistoryFinalizer` `:63` — at most one DiscoveryRuns append **per finalizer instance**, i.e. per webhook invocation. A second invocation gets a second finalizer.
  - `pipeline-writer.ts:765-806` — row-level identity match -> merge/update instead of append. So a duplicate run does **not** duplicate Pipeline rows; it re-writes them (inflating `updated`) and doubles browser/LLM/Sheets cost.
  - `grep -in "idempot|duplicate|alreadyRunning|dedupe" src/webhook/handle-discovery-webhook.ts` -> nothing relevant. Nothing anywhere in `src/` guards webhook-level replay.
- **How duplicate delivery actually happens in production:** the dashboard aborts the dispatch POST after `timeoutMs` (default 15 s, `discovery-wizard-verify.js:674-683`). Preflight already does network I/O (`validateSheetsCredentialReadiness`, `handle-discovery-webhook.ts:584`), so on a slow link the browser can abort **after** the worker has minted the runId and started the run. The user sees a network error and clicks *Run discovery* again. No automatic client retry of the dispatch POST was found (the auth-refresh retry at `discovery-readiness.js:898-910` only re-fires on a 401, where no run started), so the realistic sources are: user re-click after abort, an at-least-once relay/proxy retry, and manual+scheduled trigger overlap.
- **Browser retry classification is a single undifferentiated bucket.** `pollRunStatus:628` turns *every* non-`ok` HTTP response into `tracker.markPollError("Status endpoint returned HTTP <n>")`. After `MAX_POLL_ERRORS = 3` the UI says *"Lost the status connection after multiple attempts. The discovery run may still be running."* (`:791-793`). For a `404 Run not found` (worker restarted with a fresh run-state dir, or a wrong/rotated runId) and for a `401` (bad/absent `statusToken` in hosted mode) that message is **false** — the run is not still running, and retrying cannot help.
- **`statusPath` / `status_path`:** both spellings are accepted, at `discovery-status-handoff.js:542` and again at `discovery-wizard-verify.js:444-445`. The behavior is real; there is **no test** for the snake_case branch anywhere (`grep -rn "status_path" tests/` -> 0 hits).

### (c) Missing assertions — state x proving test matrix

| # | State / behavior | Proving test today |
|---|---|---|
| 1 | `accepted` status built + persisted first | `integrations/browser-use-discovery/tests/state/run-status-store.test.ts:80`; ack shape at `tests/webhook/handle-discovery-webhook.test.ts:618` |
| 2 | `running` persisted before dispatch; 500 if persist fails | `tests/webhook/handle-discovery-webhook.test.ts:4099` (`F1B-RUN02-PERSIST`); also `:618` asserts `status === "running"` on the 202 |
| 3 | terminal `completed` (sync) | `tests/webhook/handle-discovery-webhook.test.ts:415` |
| 4 | terminal `completed` (async) | `tests/webhook/handle-discovery-webhook.test.ts:618` (post-release assertion) |
| 5 | terminal `failed` (async) | `tests/webhook/handle-discovery-webhook.test.ts:726` |
| 6 | terminal immutable vs late write | `:3992` (`F1B-RUN01-IMMUT`) + `tests/state/run-status-store.test.ts:408` |
| 7 | watchdog terminalization + one history row | `:4219` (`F1B-RUN05-FINAL`) |
| 8 | catastrophic async failure -> one durable history row | `:4167` (`F1B-RUN05-FINAL`) |
| 9 | finalizer idempotent per runId | `tests/webhook/run-discovery-runs-log.test.ts:282` |
| 10 | worker restart terminalizes in-flight runs | `tests/state/run-status-store.test.ts:129` |
| 11 | poller: stale generation / stale runId cannot land | `tests/discovery-run-status-polling.test.mjs:280`, `:297` |
| 12 | poller: synthesizes `/runs/:id` only for local workers; preserves hosted `statusPath` verbatim | `tests/discovery-run-status-polling.test.mjs:130`, `:149` |
| 13 | **retryable polling — which HTTP shapes are retryable vs terminal** | **NONE.** `grep -rn "markPollError\|Status endpoint returned\|pollErrorCount" tests/*.test.mjs` -> 1 incidental hit (`run-status-honesty.test.mjs:97`, a status-name list). No test drives `pollRunStatus` against a non-`ok` response at all. |
| 14 | **poller accepts `status_path` (snake_case)** | **NONE.** Behavior exists at `discovery-status-handoff.js:542`; `grep -rn "status_path" tests/` -> 0 hits. |
| 15 | **duplicate webhook delivery for the same logical run** | **NONE** — and no production guard either. |
| 16 | **exactly-once DiscoveryRuns row across deliveries** | **NONE.** Row 9 proves once-per-invocation only. |
| 17 | **exactly-once Pipeline write across deliveries** | **NONE** at run level. Row-level identity merge is covered (`tests/sheets/pipeline-writer.test.ts:157`, `:938`), so the residual defect is doubled work + inflated `updated`, not duplicated rows. |

### (d) Smallest credible change, and the pattern it reuses

**Answer to the orchestrator's open question first:** the runId is **server-generated** (`handle-discovery-webhook.ts:146-148` + `server.ts:292`, which omits `runId`), and the request body has no runId field (`contracts.ts:299`). So *"the run-status store already holds the runId -> return the existing accepted status"* **cannot work as stated** — the second delivery arrives before any runId exists for it and would mint a fresh one. The store's `get(runId)` is never reachable with the duplicate's identity.

The dedupe key must come from the request. The request already carries a natural one: `sheetId` + `variationKey` + `requestedAt` (`contracts.ts:299-304`), where `requestedAt` is stamped once per user click by the dashboard (`discovery-run-orchestration.js:399` passes `requestedAt: payload.requestedAt`). Smallest credible guard, in order of preference:

1. **Derive the runId deterministically from the request identity instead of randomly.** Replace `createRunId(randomId)` at `:146-148` with, when `runStatusStore` is present, `run_${sha256(sheetId + " " + variationKey + " " + requestedAt).slice(0,32)}`, then `const existing = runStatusStore.get(runId); if (existing) return jsonResponse(202/200, ackFromStatus(existing))` — placed **after** preflight, so the order invariant (method -> auth -> parse -> strip -> preflight -> first status side effect -> run) is untouched and the new short-circuit sits exactly where the first side effect is today (`:262-272`). This reuses machinery already in the file: `createHash("sha256")` is already imported at `:1`, `randomId` injection stays for tests, and the store's own terminal-immutability guard (`run-status-store.ts:189`) covers the rest. It also makes the duplicate's ack *correct* rather than merely suppressed: the caller gets the original runId and `statusPath` and its poller latches onto the live run.
   - No new store method is needed: `get()` already suffices.
   - Backward compatibility: runIds change shape from `run_<uuid>` to `run_<hash>`. Nothing parses runId structure (`buildRunStatusPath` just `encodeURIComponent`s it; the snapshot filename is base64url of the whole string). Tests that pin `run_queued` inject `randomId`, which stays honored — so derive only when no `randomId` is injected, keeping `randomId` as the escape hatch.
2. Fallback if Emilio prefers no runId shape change: keep the random runId but add an in-store index `sheetId|variationKey|requestedAt -> runId`. This needs a genuinely new store method and a second on-disk index; strictly more surface than option 1 for the same result. Not recommended.

**Retry classification** (row 13): add a pure exported classifier next to the poller — `classifyRunStatusPollResponse(status) -> "ok" | "retryable" | "terminal"` in `discovery-status-handoff.js` (retryable: 0/408/425/429/500/502/503/504 and network errors; terminal: 401/403/404/405/410). `pollRunStatus:628` routes `retryable` -> `markPollError` (unchanged) and `terminal` -> a distinct tracker call so `startDiscoveryStatusPolling:789` stops immediately with an honest message instead of the "may still be running" line. This mirrors the existing pure-function + injected-host style of the file and keeps routing out of any model call. Note: `discovery-run-tracker.js` would need one new terminal-marking entry point — flag to the orchestrator, see (e).

**Rows 14, 16, 17** need **tests only**, no production change.

### (e) Likely ownership conflicts

- `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts` — Lane C production edit. Not claimed by any other lane. Must be named in Locked decisions.
- `discovery-status-handoff.js` — **Lane C needs it for retry classification; the roster gives it exclusively to Lane D (stable transport).** Both lanes touch different functions (`pollRunStatus`/`startDiscoveryStatusPolling` vs `diagnoseDownstreamChain`), but the same file, and the merge order is C -> D. Recommend: Lane D merges its `diagnoseDownstreamChain` change after C, or the orchestrator assigns the poller change to Lane D as a second unit. **Decision needed.**
- `discovery-run-tracker.js` — owned by nobody in the roster; needed for the terminal-marking entry point. Must be added to Lane C's fence, or the classifier must report through the existing `markStatusConnectionLost` (acceptable but less precise).
- `integrations/browser-use-discovery/src/state/run-status-store.ts` — Lane C may touch it (`tests/state/` is in its fence); Lane E also wants a read-only listing there (see CANARY-1 (d)). **Two lanes, one file.** Recommend the additive `listRunStatusSnapshots` export be assigned to exactly one lane (E is later in merge order and is the only consumer) and named in Locked decisions.

### (f) Executable RED probes

**Probe 1 — duplicate delivery.**

```bash
node --experimental-strip-types --test .lane-evidence/scout-worker/lifecycle-duplicate-delivery.probe.test.ts
```

```
[probe] observed: firstRunId=run_1 secondRunId=run_2 runDiscoveryCalls=2 discoveryRunsAppends=2
✖ LIFECYCLE-1: a duplicate webhook delivery must not start a second run (3.136958ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

✖ failing tests:

test at .lane-evidence/scout-worker/lifecycle-duplicate-delivery.probe.test.ts:54:1
✖ LIFECYCLE-1: a duplicate webhook delivery must not start a second run (3.136958ms)
  AssertionError [ERR_ASSERTION]: duplicate delivery must resolve to the SAME runId (got run_1 then run_2)

  'run_2' !== 'run_1'

      at TestContext.<anonymous> (file:///private/tmp/Job-Bored-discovery-hardening-integration/.lane-evidence/scout-worker/lifecycle-duplicate-delivery.probe.test.ts:160:10)
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'run_2',
    expected: 'run_1',
    operator: 'strictEqual',
    diff: 'simple'
  }
exit=1
```

The `[probe]` line is the load-bearing evidence: **two runs and two DiscoveryRuns appends** from two byte-identical POSTs. Covers matrix rows 15, 16 and (via `runDiscoveryCalls=2`) 17.

**Probe 2 — retry classification + `statusPath`/`status_path`.**

```bash
node --test .lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs
```

```
[probe] 404 produced pollErrors=["Status endpoint returned HTTP 404"]
[probe] 401 produced pollErrors=["Status endpoint returned HTTP 401"]
▶ LIFECYCLE-1 probe — poll response classification
  ✔ LIFECYCLE-1: a 503 from /runs/:id is retryable and marks a poll error (1.217ms)
  ✖ LIFECYCLE-1: a 404 from /runs/:id is terminal and must not burn a retry (1.1635ms)
  ✖ LIFECYCLE-1: a 401 from /runs/:id is terminal and must not burn a retry (0.426ms)
✖ LIFECYCLE-1 probe — poll response classification (3.180458ms)
▶ LIFECYCLE-1 probe — statusPath / status_path contract
  ✔ LIFECYCLE-1: accepts camelCase statusPath from an accepted_async ack (0.8415ms)
  ✔ LIFECYCLE-1: accepts snake_case status_path from an accepted_async ack (0.453792ms)
✔ LIFECYCLE-1 probe — statusPath / status_path contract (1.38925ms)
ℹ tests 5
ℹ pass 3
ℹ fail 2

✖ failing tests:

✖ LIFECYCLE-1: a 404 from /runs/:id is terminal and must not burn a retry (1.1635ms)
  AssertionError [ERR_ASSERTION]: 404 (run not found) is not retryable — retrying it 3x and then claiming 'the run may still be running' is a false statement
  + actual - expected

  + [
  +   'Status endpoint returned HTTP 404'
  + ]
  - []

✖ LIFECYCLE-1: a 401 from /runs/:id is terminal and must not burn a retry (0.426ms)
  AssertionError [ERR_ASSERTION]: 401 (bad/absent status token) is not retryable
  + actual - expected

  + [
  +   'Status endpoint returned HTTP 401'
  + ]
  - []
exit=1
```

Two RED (row 13), three GREEN. The two green `statusPath`/`status_path` cases are **characterization only** — they prove the behavior at `discovery-status-handoff.js:542` exists but is untested in the repo (row 14). Lane C should land them as real tests with no production change.

The probe files use the vm-mount harness already established in `tests/run-status-honesty.test.mjs:67-117` (classic-global IIFE into `vm.createContext`, stub `window.JobBoredDiscovery.runTracker` and `.status.host`), so Lane C can lift them straight into `tests/discovery-lifecycle.test.mjs`.

---

## STABLE-1 (worker/secret half)

### (a) Exact files and line refs

**Secret name and flow.** The canonical env key is `BROWSER_USE_DISCOVERY_WEBHOOK_SECRET`, with `DISCOVERY_WEBHOOK_SECRET` and `WEBHOOK_SECRET` as accepted aliases: `integrations/browser-use-discovery/src/config.ts:391-395`. `.env.example:105` documents only the canonical key. Bootstrap owns generation/persistence: `scripts/bootstrap-local-discovery.mjs` exports `resolveWebhookSecret`, `generateWebhookSecret`, `writeWebhookSecretToEnvFile`, `WEBHOOK_SECRET_ENV_KEY` (export block `:1869-1884`). The dashboard autofills it from the bootstrap state file: `config-overrides.js:429-436` (`autofillDiscoveryWebhookSecretFromBootstrap`, then `writeDiscoveryTransportSetupState({localWebhookUrl, tunnelPublicUrl})`).

**Verification.** `handle-discovery-webhook.ts:1337 hasValidWebhookSecret` fails closed with three categories — `no_secret_configured`, `missing_secret_header`, `secret_mismatch` — all returned as **401** with `auth.category` / `auth.detail` / `auth.remediation` in the body (`:104-122`). SHA-256 + `timingSafeEqual` with no length-dependent early return (`:1366-1372`). Run-status auth: `src/webhook/run-status-auth.ts` (`createRunStatusToken`, `appendRunStatusToken`, `hasValidRunStatusToken`), enforced only in hosted mode at `server.ts:1103-1126`.

**Browser side.** `discovery-wizard-verify.js:12` + `:35-37` (`WEBHOOK_AUTH_FAIL_CATEGORIES`), `isAuthRequiredResponse:285-300` (reads `data.auth.category`, with message-regex fallbacks), `auth_required` result `:468-490`. One automatic re-verify with a refreshed bootstrap secret: `discovery-readiness.js:894-910`. Toast + "Copy bootstrap command" action: `discovery-readiness.js:827-840`.

**Transport.** `scripts/lib/discovery-transport.mjs` (201 lines) — `normalizeTransportPreference`, `detectCloudflared`, `parseQuickTunnelUrl`, `selectTransport`, `isStableTransport` (true only for the named Cloudflare tunnel), `buildQuickTunnelCommand`, `buildNamedTunnelCommand`. `scripts/bootstrap-local-discovery.mjs`: `probeHealth:469` (**not exported**, uses global `fetch`), `isBrowserUseDiscoveryHealth:502` (**exported**), `isHermesWebhookHealth:511`, `ensureBrowserUseWorkerHealth:949-1083`, `ensureGatewayHealth:1085-1121`, public identity probe `:1224-1232`, state payload `:1660-1740` (`localWebhookUrl`, `tunnelPublicUrl`, `ngrokPublicUrl`, `diagnostics{}`, `wizard{}`, `remediations{}`), `buildTransportState:1445`. `dev-server.mjs` Tailscale endpoints are covered by `tests/dev-server-tailscale.test.mjs`.

**Hop attribution.** `discovery-wizard-probes.js:547-559 deriveLocalRecoveryState` -> `needs_full_restart | worker_down | tunnel_down | tunnel_rotated | ok`; `buildRecoveryCopy:561-611`; snapshot assembly `:940-1000` (`savedEndpointIsRemoteHost:950`, `isHostedSavedEndpoint:964`, `isLocalSetup:967`, `localRecoveryState:972`). `discovery-status-handoff.js:195-350 diagnoseDownstreamChain` — `usesTunnelTransport:223`, `remoteWebhookHost:228`, local-health probe `:232-242`, ngrok probe `:244-259`, relay mismatch `:261-276`, and the summary ladder `:278-333`.

**Docs.** There is no dedicated Tailscale runbook file under `docs/` (`ls docs | grep -i tailscale` -> nothing). Tailscale guidance lives inline in the wizard copy (`discovery-wizard-probes.js:902-907`) and in the connection-fix test's expectations.

### (b) Current behavior — the six named tests all pass today

Every one of the six tests the source prompt names is green on `8f79235`, run one at a time with `npm test -- <file>`:

```
tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs   tests 18  pass 18  fail 0  skipped 0
tests/dev-server-tailscale.test.mjs                                 tests  5  pass  5  fail 0  skipped 0
tests/discovery-transport.test.mjs                                  tests  9  pass  9  fail 0  skipped 0
tests/discovery-readiness-truth.test.mjs                            tests  5  pass  5  fail 0  skipped 0
tests/discovery-wizard-verify.test.mjs                              tests  6  pass  6  fail 0  skipped 0
tests/discovery-cold-start-handoffs.test.mjs                        tests  5  pass  5  fail 0  skipped 0
```

Five further files that bear directly on the claim are also green:

```
tests/discovery-bootstrap-secret.test.mjs      tests 17  pass 17  fail 0
tests/discovery-webhook-secret-header.test.mjs tests  7  pass  7  fail 0
tests/discovery-bootstrap-transport.test.mjs   tests  4  pass  4  fail 0
tests/recovery-state.test.mjs                  tests 33  pass 33  fail 0
tests/keep-alive.test.mjs                      tests 12  pass 12  fail 0
```

What that evidence actually establishes:

- **Secret handoff is proven end to end.** `discovery-connection-tailscale-hint-and-secret-fix.test.mjs` proves url+secret survive a `config-overrides.js` round trip (VAL-SIGN-004) and that a bare `ts.net` paste is normalized to `/webhook` before verification with the draft secret (VAL-SIGN-003). `discovery-webhook-secret-header.test.mjs` proves the `x-discovery-secret` header is attached and that a generic 401 is *not* misclassified as `auth_required`. `discovery-bootstrap-secret.test.mjs` proves generation, persistence, and read-back.
- **The three 401 categories are deliberately collapsed to one `auth_required` kind**, and `tests/discovery-wizard-verify.test.mjs` pins that on purpose ("classifies `missing_secret_header` 401 as auth_required", "...`no_secret_configured`...", "...`secret_mismatch`..."). This is **not** the gap: the remediation for all three on a local setup is identical — rerun `npm run discovery:bootstrap-local` and reload — and the worker still ships `auth.category` in the body for anything that wants finer detail.
- **The readiness snapshot CAN distinguish "tunnel down" from "worker down."** `deriveLocalRecoveryState` (`discovery-wizard-probes.js:547`) returns distinct `worker_down` / `tunnel_down` / `tunnel_rotated` / `needs_full_restart`, and `tests/recovery-state.test.mjs` covers all of them (33 tests, including simulation overrides). This candidate gap named in the kickoff is **already closed**.
- **Stable transport is modelled and tested.** `isStableTransport` is true only for the named Cloudflare tunnel (`discovery-transport.test.mjs`), and `runKeepAliveCheck` no-ops on a stable transport without probing or redeploying (`keep-alive.test.mjs`).

### (c) Missing assertion — ONE evidence-backed gap

**`diagnoseDownstreamChain` misattributes the failing hop on the Tailscale stable-transport path: it blames ngrok.**

The precondition is the ordinary Tailscale production configuration, not a contrived one:

1. `npm run discovery:bootstrap-local` always records `localWebhookUrl` in the bootstrap state payload (`scripts/bootstrap-local-discovery.mjs:1665`), and the dashboard copies it into transport setup state on every hydrate (`config-overrides.js:433-435`). So `transport.localWebhookUrl` is set.
2. On the Tailscale path bootstrap manages no tunnel, so `tunnelPublicUrl` is empty.
3. `diagnoseDownstreamChain:223` computes `usesTunnelTransport = !!(localUrl || snapshot.tunnelPublicUrl || transport.tunnelPublicUrl)` — **`localUrl` alone makes this true**, so the honest remote-webhook branch at `:286` (`remoteWebhookHost`) is skipped even though the saved endpoint is `https://<host>.ts.net/webhook`.
4. The local worker is healthy, so the `localServer.status === "unreachable"` branch at `:278` is skipped.
5. `probeNgrokTunnels()` queries the ngrok local API, which does not exist on a Tailscale box, so it returns `""` -> `tunnel.status = "not_running"` (`:254-258`) -> summary **"ngrok tunnel is not running."** and `primaryFix.id = "diag_fix_tunnel"` -> *"Go to the tunnel step to start ngrok."*

The existing FIX-2 tests in `tests/run-status-honesty.test.mjs:182-211` protect only the *no-tunnel-transport* shape (`diagnose({savedWebhookUrl: "...ts.net/webhook"})` with an empty transport state) — exactly the case where `localWebhookUrl` is absent. `:204-212` explicitly pins "keeps the ngrok fix when the transport actually uses a tunnel", which is what makes the Tailscale-with-local-worker case fall through to the wrong branch. No test covers Tailscale + a recorded `localWebhookUrl`.

User-visible consequence: the one hop that is actually down (the `tailscale serve` / device reachability) is never named, and the user is routed into a dead-end ngrok step for a setup that has no ngrok.

### (d) Smallest credible change, and the pattern it reuses

Make the tunnel branch conditional on the setup actually using a *rotating tunnel*, not merely on a local URL existing. Two edits in `discovery-status-handoff.js`:

1. `:223` — narrow `usesTunnelTransport` to `!!(snapshot.tunnelPublicUrl || transport.tunnelPublicUrl)`; a bare `localUrl` is a local-worker signal, not a tunnel signal. The local-health probe at `:232` is keyed off `localUrl` separately and is unaffected.
2. Add one branch between `:278` and `:296`: when the local server is healthy **and** the saved webhook is a remote host with no tunnel transport, emit the existing `remoteWebhookHost` summary but name which hop is up — "Your local worker is running, but `<host>` is not reachable" — with `primaryFix.id = "diag_fix_reverify"` (already defined at `:291`).

This reuses the file's own vocabulary (`getRemoteDiscoveryWebhookHost`, `diag_fix_reverify`, the `layer`/`summary`/`primaryFix` shape) and adds no new concept. It also strictly *widens* the existing FIX-2 intent ("don't prescribe ngrok remediation to remote-https users"), so the four existing FIX-2 tests should stay green — verify, don't assume. Lane D owns `discovery-status-handoff.js`, so this is inside its fence. New test goes in `tests/discovery-stable-transport.test.mjs` using the `diagnose()` helper already at `tests/run-status-honesty.test.mjs:167-179`.

**Verdict: not "already sufficient" — one evidence-backed gap, with the RED below.** Everything else about the stable transport + secret handoff is proven by the eleven green files listed in (b) and needs no change.

### (e) Likely ownership conflicts

- `discovery-status-handoff.js` — Lane D's fence, but Lane C wants the poller half of the same file (see LIFECYCLE-1 (e)). **Same conflict, flagged once.**
- `tests/run-status-honesty.test.mjs` — not in any lane's fence, but a fifth FIX-2 case would naturally belong there. Avoid the conflict: have Lane D create `tests/discovery-stable-transport.test.mjs` (already anticipated in the roster) and leave `run-status-honesty.test.mjs` untouched.
- No worker-side (`integrations/browser-use-discovery/`) change is needed for STABLE-1.

### (f) Executable RED probe

```bash
node --test .lane-evidence/scout-worker/stable-transport-hop.probe.test.mjs
```

```
[probe] summary="ngrok tunnel is not running." primaryFix="diag_fix_tunnel" tunnel={"status":"not_running","url":"","active":false,"stale":false}
▶ STABLE-1 probe — failing-hop attribution on the Tailscale path
  ✖ STABLE-1: a healthy local worker behind a DOWN ts.net serve must not be diagnosed as an ngrok tunnel failure (2.821083ms)
✖ STABLE-1 probe — failing-hop attribution on the Tailscale path (3.311166ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1

✖ failing tests:

test at .lane-evidence/scout-worker/stable-transport-hop.probe.test.mjs:45:3
✖ STABLE-1: a healthy local worker behind a DOWN ts.net serve must not be diagnosed as an ngrok tunnel failure (2.821083ms)
  AssertionError [ERR_ASSERTION]: the Tailscale stable transport is the failing hop — ngrok is not part of this setup
      at TestContext.<anonymous> (file:///private/tmp/Job-Bored-discovery-hardening-integration/.lane-evidence/scout-worker/stable-transport-hop.probe.test.mjs:71:12)
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'ngrok tunnel is not running.',
    expected: /ngrok/i,
    operator: 'doesNotMatch',
    diff: 'simple'
  }
exit=1
```

---

## CANARY-1

### (a) Exact files and line refs

**Worker health readers (candidates for reuse):**

- `scripts/discovery-keep-alive.mjs:176 isExpectedWorkerHealthPayload` — checks `service === "browser-use-discovery-worker"` && `status === "ok"`. **NOT exported** (export block `:522-528` ships `buildWranglerTargetSecretArgs, pickNgrokPublicUrl, resolveRelayTargetUrl, tunnelMatchesPort, verifyNgrokWorkerIdentity`).
- `scripts/discovery-keep-alive.mjs:186 verifyNgrokWorkerIdentity(ngrokUrl, {fetchImpl})` — **exported**, and it does take an injected `fetchImpl`. But it rewrites the URL to `/health`, hardcodes the `ngrok-skip-browser-warning` header, and returns ngrok-flavoured reason codes (`invalid_ngrok_url`, `health_unreachable`, `unexpected_health_identity`). Usable, but the name and reason codes would lie for a local/Tailscale canary.
- `scripts/bootstrap-local-discovery.mjs:469 probeHealth(healthUrl)` — **not exported**, uses global `fetch`, no DI. Normalizes the response to `{ok, reachable, statusCode, serviceName, workerStatus, mode, platform, body}`.
- `scripts/bootstrap-local-discovery.mjs:502 isBrowserUseDiscoveryHealth(probe)` — **exported** (`:1869-1884`), pure, takes the normalized probe shape above. **This is the right reuse point for worker health.**
- `scripts/discovery-shared-helpers.mjs:103 buildLocalHealthUrl`, `:132 inferPortFromUrl`, `:95 isLocalHost` — all exported, all pure.
- `/health` payload shape: `integrations/browser-use-discovery/src/server.ts:694 buildHealthPayload`, route at `:1073`, frozen mock at `integrations/browser-use-discovery/tests/mocks/health-response.ok.v1.json` (`status`, `service`, `mode`, `asyncAckByDefault`, `routes{}`, `readiness{ready, configLoaded, configuredSheetId, companiesConfigured, sheetsCredentialConfigured, enabledSources[], browserRuntime{}, groundedWeb{}, warnings[]}`). `/health` is **auth-free** — it is matched at `:1073`, before any secret-gated path.

**Run-history readers:**

- `integrations/browser-use-discovery/src/state/run-status-store.ts` — the store writes one JSON snapshot per run under `runtimeConfig.runStateDirectory`, default `dirname(stateDatabasePath)/run-state`, documented as `~/.jobbored/browser-use-discovery/run-state` (`.env.example:17`, resolution at `src/config.ts:298-303`). Filenames are `base64url(runId) + ".json"` (`:352`), content is `{schemaVersion:1, runId, writtenAt, status:<full DiscoveryRunStatusPayload>}` (`:318-325`), directory mode `0o700`, file mode `0o600`. **This is a real, credential-free, local run history.** Live on this machine: `~/.jobbored/browser-use-discovery/run-state/` holds `cnVuX2I5NDQ4NDg0...json` and `aW5nZXN0Xzgx...json`.
- **But there is no read-only reader for it.** Exports are `buildAcceptedRunStatus, buildCompletedRunStatus, buildFailedRunStatus, buildRunStatusPath, buildRunningRunStatus, createDiscoveryRunStatusStore` — no list/iterate/read.
- `src/sheets/discovery-runs-writer.ts:102 parseDiscoveryRunsCells(cells, headers)` — exported, pure, tolerant of the 9/10-cell variants. Only relevant if the canary reads Sheets.
- The dashboard's DiscoveryRuns reader is `runs-tab.js:240 fetchDiscoveryRuns(sheetId, accessToken, options)` + `:182 parseDiscoveryRunsValues`, a browser IIFE reading `DiscoveryRuns!A2:J` (`:19`) with a **GIS browser OAuth access token** (`:290`). Not reachable from a Node CLI. `discovery-run-tracker.js:495` only holds the single local terminal outcome for the last run, in `localStorage`.
- The worker exposes **no run-list HTTP route**: `server.ts` serves `/health`, `/runs/{runId}` (single id, `:1078`), and the POST paths enumerated at `:1150`. So `/runs/` cannot enumerate.

**CLI patterns:**

- `scripts/doctor.mjs` — `check(level, name, message, details):26`, `summarize(checks):30`, `runDoctor(options):579` with `options.spawnSyncImpl` / `options.fetchImpl` DI (`:582-583`), `formatDoctorReport(report):875`, `parseArgs(argv):886`, main block `:892-903` with `process.exitCode = report.ok ? 0 : 1`, exports `{formatDoctorReport, runDoctor}` `:905`. **Best model for DI + `--json` + report/exit-code shape.** Its `parseArgs` is boolean-flags-only and cannot parse `--max-age-hours 24`.
- `scripts/discovery-keep-alive.mjs:487 parseArgs(argv)` — the repo's cleanest **valued-flag** loop: `for` over argv, `--interval-ms <n>` consumes `argv[i+1]`, validates with an explicit `throw new Error("--interval-ms must be an integer >= 1000")`, `--help` prints usage and exits 0, unknown flag throws. **Copy this loop shape for `--max-age-hours`; copy doctor's everything-else.**
- `scripts/bootstrap-local-discovery.mjs:125 parseArgs` — larger valued-flag parser, but entangled with bootstrap defaults; not the model to copy.

**Wiring points:**

- `package.json:35` is `"discovery:keep-alive"`. The single new script line belongs immediately after it, at what is currently line 36: `"discovery:canary": "node scripts/discovery-canary.mjs",` — keeping the `discovery:*` operator commands contiguous (`bootstrap-local`, `keep-alive`, `canary`, then the `worker:` / `tunnel:` sub-namespaces).
- `package.json:76 typecheck:repo` — append `&& node --check scripts/discovery-canary.mjs` immediately after the existing `node --check scripts/discovery-keep-alive.mjs`, before `&& npm run typecheck:server`.
- Test discovery: `npm test` runs `scripts/run-tests.mjs`, which recursively collects `tests/**/*.test.{mjs,js,ts}` excluding only `tests/e2e-smoke` (`scripts/run-tests.mjs:6-27`). `npm run test:repo` runs the narrower `node --test tests/*.test.mjs`. **`tests/discovery-canary.test.mjs` sits at the top level of `tests/`, so BOTH globs pick it up.** No glob change is needed. Single-file form: `npm test -- tests/discovery-canary.test.mjs`.

### (b) Current behavior

No canary exists. `scripts/discovery-canary.mjs`, `tests/discovery-canary.test.mjs`, and `docs/DISCOVERY-CANARY.md` are all absent; `package.json` has no `discovery:canary`.

Today an operator has to compose the answer by hand: `curl localhost:8644/health` for worker health, and either open the dashboard Runs tab (browser OAuth) or `ls -lt ~/.jobbored/browser-use-discovery/run-state/` and hand-decode base64url filenames for run freshness.

### (c) Missing assertions

Everything. The two structural questions worth pinning before Lane E starts are:

| Question | Answer today |
|---|---|
| Is there a read-only reader for local run history? | **NONE** — see probe 2 below. |
| Is `createDiscoveryRunStatusStore` safe for a read-only canary? | **NO** — it mutates. See probe 2 below. |

### (d) Recommendation — which readers, whether Sheets is needed, exit codes

**(1) Worker health: reuse `isBrowserUseDiscoveryHealth` from `scripts/bootstrap-local-discovery.mjs`.** It is already exported, already pure, and already the repo's definition of "this is *our* worker, and it says ok". The canary supplies its own tiny DI'd probe (`fetchImpl(healthUrl)` -> the normalized `{ok, reachable, statusCode, serviceName, ...}` shape that `probeHealth:469` produces) rather than reusing `verifyNgrokWorkerIdentity`, whose name, ngrok header, and reason codes would be wrong for a local/Tailscale operator. Build the health URL with the exported `buildLocalHealthUrl` from `scripts/discovery-shared-helpers.mjs:103`. Pin the payload contract against the existing frozen mock `integrations/browser-use-discovery/tests/mocks/health-response.ok.v1.json`.

**(2) Newest successful run: read the local run-state snapshot directory. Sheets is NOT needed and should report `unavailable` if ever asked for.**

Justification: the run-state directory is the only credential-free source that exists. The DiscoveryRuns tab is reachable only with a Google OAuth token; the dashboard gets one from browser GIS sign-in (`runs-tab.js:290`), and the worker's own Sheets path needs a service account or a per-run user token. A read-only CLI has no non-interactive way to obtain either without (a) reading the user's service-account JSON, which drags a credential into an "operator status" command for no benefit, or (b) an interactive OAuth dance, which breaks determinism. **Recommendation: the canary never touches Sheets. If a future flag asks for it, the correct answer is status `unavailable` with reason `sheets_credential_not_available`, not a credential grab.** The local snapshots carry everything the claim needs — `status`, `terminal`, `completedAt`/`updatedAt`, `lifecycle.state`, `writeResult` — and they are the same payload the dashboard polls.

Two caveats Lane E must handle:

- The directory holds **both** discovery runs (`run_...`) and Add-URL ingests (`ingest_...`) — this machine has one of each. "Newest successful **discovery** run" must filter, e.g. on the presence of `status.lifecycle` or a `run_` runId prefix. Do not count an ingest as a discovery run.
- Terminal success is `status` in `{completed, partial}`; `empty` is a *successful run that found nothing*, and `failed` is not success. The enum is `run-status-store.ts:35-42`. Whether `empty` counts as "recent discovery success" is a **decision for the locked spec**; recommendation: yes for `healthy` (the pipeline ran), and say so in `docs/DISCOVERY-CANARY.md`.

**(3) The reader itself — one decision needed.** The canary must not call `createDiscoveryRunStatusStore`: opening the store `mkdirSync`s the directory (`run-status-store.ts:178`), **deletes** orphaned `.tmp-` files (`sweepTemporaryRunStatusSnapshots:295`), and **rewrites** any snapshot that fails to parse (`loadRunStatusSnapshots:240-267`). All three violate "read-only, no recovery mutation". Probe 2 below demonstrates the deletion. Options:

- **Preferred:** add one additive, pure export to `run-status-store.ts` — `listRunStatusSnapshots(directory): DurableDiscoveryRunStatusPayload[]` that does `readdirSync` + `decodeRunIdFromSnapshotFilename` + `JSON.parse` + `isRunStatusSnapshot`, and **skips** anything malformed instead of repairing it. About 20 lines, reuses the private helpers already in the file, and keeps the snapshot format defined in exactly one place. **But `run-status-store.ts` is outside Lane E's fence**, so this needs a Locked decision (see Ownership conflicts).
- **Fallback (zero cross-lane conflict):** implement the read inside `scripts/discovery-canary.mjs`. It costs about 25 duplicated lines (base64url filename decode + `schemaVersion === 1` check) and creates a second definition of the snapshot format that can drift. Acceptable if the orchestrator wants Lane E fully self-contained.

Root `.mjs` importing worker `.ts` is already proven in this repo — `tests/discovery-run-status-polling.test.mjs:7` imports `../integrations/browser-use-discovery/src/http/origin-guard.ts` and runs green under `npm test`. Note that `node scripts/discovery-canary.mjs` (the `package.json` script, no flags) relies on Node 24's default type stripping, whereas `run-tests.mjs` passes `--experimental-strip-types` explicitly for the test path.

**(4) `parseArgs` + DI pattern to copy:** `discovery-keep-alive.mjs:487` for the valued-flag loop (`--max-age-hours <n>`, validate, `throw` on unknown, `--help` -> usage + exit 0); `doctor.mjs` for everything else — `check()`/`summarize()`, `runCanary(options)` with `options.now`, `options.fetchImpl`, `options.readRunHistory` injected and defaulted at the top of the function (`doctor.mjs:582-583`), `formatCanaryReport(report)` mirroring `formatDoctorReport:875`, and the `import.meta.url` main guard at `:892`. Export the pure classifier and the formatter (`export { classifyCanary, formatCanaryReport, runCanary }`), matching `doctor.mjs:905`.

**(5) Proposed status -> exit-code mapping.** `doctor.mjs` is binary (`0` ok / `1` not, `:898`), which cannot carry four statuses. Extend it in the same spirit — `0` means "no operator action", every non-zero is a distinct actionable class, and the numbers stay small so shell `if` and `&&` chains read naturally:

| Status | Exit | Meaning | Typical cause |
|---|---|---|---|
| `healthy` | `0` | Worker answers `/health` as our worker, and a successful discovery run finished within `--max-age-hours`. | nominal |
| `stale` | `1` | Worker is healthy, but the newest successful run is older than `--max-age-hours` (or there is none). | schedule not firing, runs failing |
| `unavailable` | `2` | Worker did not answer, or answered as something else. | worker down, port taken, transport down |
| `misconfigured` | `3` | The canary could not evaluate the question: unreadable or absent run-state directory, bad flag value, unparseable `/health`. | wrong `--state-dir`, first run before any bootstrap |
| *(internal error)* | `4` | Unhandled exception inside the canary. | bug |

Rationale for the ordering: `stale` before `unavailable` so `[ $? -le 1 ]` means "the worker is up"; `misconfigured` highest of the classified statuses because it means the answer is unknown rather than bad. Precedence when several apply: `misconfigured` > `unavailable` > `stale` > `healthy` — you cannot call a run stale if you could not read the history. Document all of this in `docs/DISCOVERY-CANARY.md` and pin it with one test per row plus one precedence test.

**(6) Redaction.** `/health` never contains a credential, but `readiness.warnings[]` is free text assembled at `server.ts:743-800` and could quote a config value; the run-status payload contains `request.sheetId` and, in `error`, arbitrary upstream text. The canary must emit only: status, reasons (from a fixed enum), `runId`, ISO timestamps, ages, and the health URL's **origin** — never headers, never `sheetId`, never the run `error` string verbatim, never job or source content. Lane E's kickoff already requires a test that feeds a `ya29.`-shaped token and a job title through and asserts absence; add `sheetId` to that assertion.

### (e) Likely ownership conflicts

- `integrations/browser-use-discovery/src/state/run-status-store.ts` — Lane E wants an additive `listRunStatusSnapshots` export; Lane C may also touch this file (its fence already includes `tests/state/`). **Needs a Locked decision.** Merge order is C -> D -> E, so if both changes are approved, Lane C lands first and Lane E rebases onto it. If the orchestrator prefers zero conflict, take the fallback in (d)(3) and Lane E touches nothing outside its fence.
- `package.json` — Lane E owns it exclusively per the roster. Confirmed no other lane needs it: the canary is the only new root script, and no other lane creates a root browser JS file that would need a `typecheck:repo` entry (Ground Rules trap 2).
- `scripts/bootstrap-local-discovery.mjs` and `scripts/discovery-shared-helpers.mjs` — **read-only imports only**; no lane edits them. No conflict.
- `integrations/browser-use-discovery/tests/mocks/health-response.ok.v1.json` — read-only fixture reference from a root test crosses the package boundary but changes nothing. If the orchestrator dislikes that, Lane E can inline the `/health` fixture in its own test file.

### (f) Executable RED probes

**Probe 1 — the command does not exist (the kickoff's named probe).**

```bash
npm run discovery:canary -- --max-age-hours 24 --json
```

```
npm error Missing script: "discovery:canary"
npm error
npm error To see a list of scripts, run:
npm error   npm run
npm error A complete log of this run can be found in: /Users/emilionunezgarcia/.npm/_logs/2026-09-01T20_13_34_394Z-debug-0.log
exit=1
```

(Note: piping this command through `head` masks the exit code — `$?` then reports the pipe's status, which is 0. Capture it on the bare command, as above.)

**Probe 2 — there is no read-only run-history reader, and the store constructor mutates.**

```bash
node --experimental-strip-types --test .lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts
```

```
[probe] run-status-store exports: buildAcceptedRunStatus, buildCompletedRunStatus, buildFailedRunStatus, buildRunStatusPath, buildRunningRunStatus, createDiscoveryRunStatusStore
[probe] files before=["cnVuX29ycGhhbg.json.tmp-1-2-3"] after=[]
✖ CANARY-1: run-status-store exposes a read-only snapshot listing the canary can reuse (0.612291ms)
✖ CANARY-1: createDiscoveryRunStatusStore is NOT usable as a read-only reader (1.526416ms)
ℹ tests 2
ℹ pass 0
ℹ fail 2

✖ failing tests:

test at .lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts:11:1
✖ CANARY-1: run-status-store exposes a read-only snapshot listing the canary can reuse (0.612291ms)
  AssertionError [ERR_ASSERTION]: no exported read-only listing (list/read/loadRunStatus*) — the canary has nothing to import for 'newest successful run'
    actual: undefined,
    expected: true,
    operator: '==',

test at .lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts:23:1
✖ CANARY-1: createDiscoveryRunStatusStore is NOT usable as a read-only reader (1.526416ms)
  AssertionError [ERR_ASSERTION]: opening the store mutated the run-state directory — a read-only canary cannot use createDiscoveryRunStatusStore
  + actual - expected

  + []
  - [
  -   'cnVuX29ycGhhbg.json.tmp-1-2-3'
  - ]
    operator: 'deepStrictEqual',
exit=1
```

The second failure is the load-bearing one: merely **opening** the store deleted a file from the directory. Lane E must not use `createDiscoveryRunStatusStore`.

---

## Ownership conflicts

| File | Lanes that both need it | What each needs | Recommendation |
|---|---|---|---|
| `discovery-status-handoff.js` | **C** (lifecycle) and **D** (stable transport) | C: retry classification in `pollRunStatus:606` / `startDiscoveryStatusPolling:763`. D: hop attribution in `diagnoseDownstreamChain:195-333`. Disjoint functions, same file. | Merge order is C -> D, so C lands first and D rebases — or assign the poller change to D as a second unit and make C test-only. **Orchestrator decision; must be in Locked decisions.** |
| `integrations/browser-use-discovery/src/state/run-status-store.ts` | **C** (possible dedupe seam; `tests/state/` already in fence) and **E** (additive `listRunStatusSnapshots` export) | C: nothing required if the dedupe lands in the webhook handler (recommended). E: one pure read-only listing export. | Grant the export to **E only** and keep C's production change confined to `handle-discovery-webhook.ts`. If the orchestrator wants zero cross-fence edits, E inlines the reader (costs about 25 duplicated lines). |
| `discovery-run-tracker.js` | **C** — and it is in **no lane's fence** | One terminal-marking entry point so a 401/404 stops polling with an honest message. | Add to Lane C's fence, or have C route terminal responses through the existing `markStatusConnectionLost` with corrected copy (weaker, but no fence change). |
| `tests/run-status-honesty.test.mjs` | **D** would naturally extend its FIX-2 block | A fifth Tailscale case. | Avoid: have D create `tests/discovery-stable-transport.test.mjs` (already in the roster) instead. No conflict. |
| `package.json` | **E** only | One script line at `:36`, one `node --check` in `typecheck:repo` at `:76`. | Confirmed exclusive. No other lane needs it. |

**Also for Locked decisions (open questions this scout surfaced):**

1. **Duplicate-delivery dedupe key.** The orchestrator's working assumption ("the store already holds the runId") is not implementable — runIds are server-generated per POST and the request carries no idempotency key. Approve `sha256(sheetId + variationKey + requestedAt)` as the derived runId, or supply an alternative. Note this changes runId shape from `run_<uuid>` to `run_<hash>`; nothing parses runId structure, and the injected `randomId` escape hatch keeps existing tests that pin `run_queued` green.
2. **Does `empty` count as a recent discovery success for the canary?** Recommend yes.
3. **Canary exit codes** — the table in CANARY-1 (d)(5) is a proposal; Lane E's kickoff has `<<FROM LOCKED SPEC>>` waiting for it.
4. **Lane C production files** — the kickoff has `<<FROM LOCKED SPEC>>`. Recommend exactly: `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts` (dedupe short-circuit) plus `discovery-status-handoff.js` and `discovery-run-tracker.js` (retry classification), subject to decision 1 above and the `discovery-status-handoff.js` conflict.

---

## Environment

Everything the kickoff asked for ran. Nothing was blocked.

- `npm run test:browser-use-discovery` — 727 pass / 0 fail / 0 skipped.
- All six STABLE-1 tests plus five adjacent ones ran individually via `npm test -- <file>`; raw counts pasted in STABLE-1 (b). No skips, no filtered tests.
- All four scout probes ran and produced the pasted output.

Notes, not blockers:

- `node --experimental-strip-types --test` on a `.ts` probe under `.lane-evidence/` emits `MODULE_TYPELESS_PACKAGE_JSON` (the root `package.json` has no `"type": "module"`). Cosmetic; stripped from the pasted output above. Worker tests under `integrations/browser-use-discovery/` do not emit it because that package's `package.json` sets `"type": "module"`.
- `npm run <script> | head` swallows the exit code (`$?` reports the pipe's status). The CANARY-1 probe's `exit=1` was captured from the unpiped command.
- Nothing was run against live infrastructure: no Tailscale, no ngrok, no Cloudflare, no launchd, no Sheets, no real credentials. The `~/.jobbored/browser-use-discovery/run-state/` directory was only `ls`-ed to confirm the snapshot format is live on this machine; no file in it was read, written, or deleted. The mutation probe operated on a fresh `mkdtemp` directory that it removed.

**Scratch inventory** (`.lane-evidence/scout-worker/`, gitignored — safe to delete):

```
lifecycle-duplicate-delivery.probe.test.ts    out-lifecycle-dup.txt
lifecycle-poll-classification.probe.test.mjs  out-lifecycle-poll.txt
stable-transport-hop.probe.test.mjs           out-stable-hop.txt
canary-run-history-reader.probe.test.ts       out-canary-reader.txt
                                              out-canary-cli.txt
```

Vehicle check (Ground Rules "Model / vehicle"): this lane ran as Opus 5.
