# Schedule / automation

Cross-platform recurring discovery without a maintainer-hosted service. Install a local scheduler (launchd / systemd / Windows Task Scheduler) or generate a GitHub Actions workflow.

## Surface

Discovery drawer → Automation → Schedule. Implemented in the settings discovery tab.

## Scripts

- `scripts/install-schedule.mjs`, `scripts/uninstall-schedule.mjs` — local scheduler install/remove (`npm run schedule:install-local` / `npm run schedule:uninstall-local`)
- `scripts/install-discovery-tunnel-autostart.mjs`, `scripts/uninstall-discovery-tunnel-autostart.mjs` — local tunnel autostart
- `scripts/discovery-keep-alive.mjs` — watches ngrok tunnel rotation and updates the relay target
- `scripts/install-cloudflare-relay.mjs` — Cloudflare Worker deploy helper

Walkthrough: `docs/SETTINGS-SCHEDULE.md` (includes a Windows-first section).

## GitHub Actions schedule

The Automation tab can also generate a `command-center-discovery.yml` workflow that the user commits to their fork. Templates live under `templates/github-actions/`. The workflow uses Node + `node-fetch`-style HTTP to POST the discovery payload server-side (avoids browser CORS).

## Related

- [Discovery feature](discovery.md)
- [Deployment](../deployment.md)
