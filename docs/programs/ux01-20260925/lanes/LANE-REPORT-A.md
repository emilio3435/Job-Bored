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
