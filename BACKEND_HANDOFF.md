# Backend Handoff — schedule-backend

## Model / branch

- Branch: `feat/schedule-backend`
- `/model` check: not available from this API session. I noted this at startup and proceeded on the requested branch.
- TypeScript gate: per Emilio's latest instruction, the repo does not use project-local `tsc`; the `npx tsc --noEmit` gate does not apply. I did not install TypeScript.

## What shipped

- Extended `StoredWorkerConfig.schedule` with backward-compatible optional fields: `cron`, `hour`, `minute`, `mode`, `installedAt`.
- Added `POST /discovery-profile` modes:
  - `mode:"schedule-save"` validates `sheetId` and schedule fields, then persists `worker-config.schedule`.
  - `mode:"schedule-status"` reads saved schedule state and the local installer breadcrumb without shelling out.
- Added shared installer helpers:
  - `scripts/lib/env.mjs`
  - `scripts/lib/schedule.mjs`
- Updated macOS launchd installer/uninstaller to write/delete `integrations/browser-use-discovery/state/schedule-installed.json`.
- Added Linux installer:
  - systemd user timer first: `templates/systemd/jobbored-refresh.service` and `.timer`
  - crontab fallback when `systemctl --user` is unavailable
  - reviewer smoke script: `scripts/smoke/schedule-linux.sh`
- Added Windows installer:
  - `scripts/install-taskscheduler-refresh.mjs`
  - `scripts/windows/refresh.ps1`
  - manual smoke steps are documented at the top of the installer.
- Added cross-platform dispatcher/status/uninstall:
  - `scripts/install-schedule.mjs`
  - `scripts/uninstall-schedule.mjs`
  - `npm run schedule:install`
  - `npm run schedule:uninstall`
  - `npm run schedule:status`
- Added tests:
  - `integrations/browser-use-discovery/tests/webhook/handle-discovery-profile-schedule.test.ts`
  - `tests/schedule-installers.test.mjs`
  - `scripts/run-tests.mjs` so `npm run test -- <directory>` works with Node's test runner.

## Breadcrumb / plist finding

Root cause: rollback during the requested macOS self-gate, not silent install failure and not a different target path.

Sequence observed:

1. `npm run schedule:install -- --hour 8 --minute 0 --force` succeeded.
2. `npm run schedule:status` printed `installed: true`, which means it successfully read `integrations/browser-use-discovery/state/schedule-installed.json`.
3. `launchctl list com.jobbored.refresh` returned exit 1 with no output, but modern launchctl confirmed the agent with `launchctl print gui/501/com.jobbored.refresh`; it pointed at `/Users/emilionunezgarcia/Library/LaunchAgents/com.jobbored.refresh.plist`.
4. I then ran `npm run schedule:uninstall` to complete the self-gate cleanup. That uninstaller removes the plist and deletes the breadcrumb.
5. Current state is expected after cleanup: breadcrumb missing, plist missing, `npm run schedule:status` prints `installed: false`.

## Verification run

- `npm run test -- integrations/browser-use-discovery/tests/webhook/` passed: 196 tests.
- `npm run test -- tests/schedule-installers.test.mjs` passed: 4 tests.
- macOS smoke:
  - install succeeded
  - status reported installed true
  - launchctl GUI-domain print confirmed the LaunchAgent
  - uninstall succeeded
  - status reported installed false after cleanup
- Linux: not executed on this macOS worktree. Added `scripts/smoke/schedule-linux.sh` for reviewer verification.
- Windows: not executed. Manual smoke steps are documented in `scripts/install-taskscheduler-refresh.mjs`.

## Review follow-up fixes

- Tightened `schedule-status`: a breadcrumb only reports `installed:true` when the saved schedule is `enabled:true` and `mode:"local"`. Stale breadcrumbs are still echoed in `installedArtifact` with `installed:false` so the UI can warn.
- Updated Windows Task Scheduler command to include `-NoProfile -ExecutionPolicy Bypass`.
- Updated `scripts/windows/refresh.ps1` to use `Invoke-WebRequest -TimeoutSec 600` and reject invalid `BROWSER_USE_DISCOVERY_PORT` values outside `1-65535`.
- Added stale-breadcrumb test coverage.

Additional verification after fixes:

- `npm run test -- integrations/browser-use-discovery/tests/webhook/handle-discovery-profile-schedule.test.ts` passed: 5 tests.
- `npm run test -- tests/schedule-installers.test.mjs` passed: 4 tests.
- `node --check scripts/install-taskscheduler-refresh.mjs` passed.

## Deferred / notes

- No push performed.
- `WORKSPACE_BRIEF.md` and `docs/INTERFACE-SCHEDULE.md` remain untracked orchestrator-provided files in this worktree.
- No contract questions are open.
- Follow-up hardening: launchd plist, systemd service, and crontab command currently embed the webhook secret in scheduler artifacts / command args. This matches the pre-existing macOS behavior and is not a regression, but before OSS release these should align with the Windows helper pattern: scheduler invokes a helper that reads `.env` at runtime from a `0600` file.
