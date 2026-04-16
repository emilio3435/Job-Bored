# Wave 5 Cross-Lane Regression Notes

## Feature Implemented
- Feature: wave5-cross-lane-regression-and-smoke
- Commit: ad89121
- Assertions covered: VAL-LOOP-CROSS-001, VAL-LOOP-CROSS-002, VAL-LOOP-CROSS-005

## Tests Added
File: `integrations/browser-use-discovery/tests/webhook/cross-area-flows.test.ts`
- VAL-LOOP-CROSS-001: unrestricted browser_plus_ats with empty companies uses both ATS and browser lanes in shared loop
  - Verifies loopCounters.atsScoutCount > 0 and loopCounters.browserScoutCount > 0
  - Verifies stageOrder with all 4 phases
  - Verifies both source families in terminal status
- VAL-LOOP-CROSS-002: ats_only preset produces explicit grounded_web exclusion evidence in terminal status
  - Verifies grounded_web appears with "excluded by preset" warning
  - Verifies pagesVisited=0 for excluded source

## Manual Smoke Tests (VAL-LOOP-CROSS-005)
- Local webhook: `curl -X POST http://127.0.0.1:8644/webhook -H "Content-Type: application/json" -H "x-discovery-secret: <secret>" -d '{...}'`
  - Response: `{"ok":true,"kind":"accepted_async","runId":"run_...","statusPath":"/runs/run_...","pollAfterMs":2000}`
- Poll run status: `curl http://127.0.0.1:8644/runs/<runId>`
  - Terminal status reached with `terminal: true` and `completedAt` present
- Public relay: same workflow via ngrok tunnel URL

## Critical: Port 8644 Conflict
- Port 8644 is declared in `.factory/services.yaml` for `discovery_worker`
- Pre-existing Hermes Python gateway was occupying port 8644
- Resolution: `lsof -ti tcp:8644 | xargs kill` (allowed per manifest port rule)
- After killing, Node.js discovery worker starts successfully

## Webhook Secret
Located in: `integrations/browser-use-discovery/.env`
Key: `BROWSER_USE_DISCOVERY_WEBHOOK_SECRET`
Value: `22fb309934e7177f41228938f01bf2a3b277e0bbd671ced74ffff6798020c52b`

## Test Results
- All 317 tests pass
- Typecheck: pass
- Lint: pass
