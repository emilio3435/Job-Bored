#!/usr/bin/env node
// Owner: Backend Worker B
// Purpose: Install a per-user background job that runs
// scripts/discovery-keep-alive.mjs every 30s. macOS = launchd plist;
// Linux = systemd-user .service. Windows = unsupported (return actionable).
//
// Job label: ai.jobbored.discovery.keepalive
// Log path:  ~/.jobbored/logs/keep-alive.log
// State:     ~/.jobbored/keep-alive-state.json
//
// Locked contract — see dev-server.mjs handleInstallKeepAlive header.
//
// Implementation notes:
//   - macOS plist target: ~/Library/LaunchAgents/ai.jobbored.discovery.keepalive.plist
//   - Use "launchctl load -w <plist>" then "launchctl start <label>".
//   - Linux: ~/.config/systemd/user/ai.jobbored.discovery.keepalive.service
//     plus a .timer unit for the 30s loop. "systemctl --user enable --now".
//   - Idempotent: re-running the install must replace, not duplicate.
//   - Must work without sudo.

throw new Error("install-keep-alive not implemented yet (swarm Phase 1)");
