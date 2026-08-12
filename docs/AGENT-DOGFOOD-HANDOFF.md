# Agent Dogfood Handoff — re‑enable on Emilio’s Mac

This note is for another agent or maintainer picking up JobBored dogfood on Emilio’s Mac. It explains what was running, how to re‑enable launchd jobs, basic health checks, and where state/logs live. Do not delete plists or secrets — this is documentation only.

## What runs under launchd

User‑level launch agents installed under `~/Library/LaunchAgents/`:

- `ai.jobbored.discovery.worker`
- `ai.jobbored.discovery.worker.watchdog`
- `ai.jobbored.discovery.keepalive`
- `ai.jobbored.discovery.tunnel`
- `ai.jobbored.resilience.tick`
- `com.jobbored.refresh`               — daily discovery refresh
- `com.jobbored.materials-watcher`     — optional Hermes materials watcher
- `com.jobbored.expired-cleanup`       — optional expired‑job cleanup schedule

Primary checkout: `~/Job-Bored` (unless `JOBBORED_REPO` points elsewhere).

State dirs:

- JobBored state: `~/.jobbored/`
- Hermes materials (optional): `~/.hermes/job-hunt/`

## Re‑enable all launch agents

Pattern (per label):

```bash
UID="$(id -u)"
launchctl enable "gui/$UID/<label>"
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/<label>.plist"
# Alternative (older flow): launchctl load -w "$HOME/Library/LaunchAgents/<label>.plist"
```

Exact commands for this machine:

```bash
UID="$(id -u)"

# Discovery worker
launchctl enable   "gui/$UID/ai.jobbored.discovery.worker"
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/ai.jobbored.discovery.worker.plist"

# Worker watchdog
launchctl enable   "gui/$UID/ai.jobbored.discovery.worker.watchdog"
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/ai.jobbored.discovery.worker.watchdog.plist"

# Keep-alive (updates Cloudflare Worker target when ngrok rotates)
launchctl enable   "gui/$UID/ai.jobbored.discovery.keepalive"
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/ai.jobbored.discovery.keepalive.plist"

# Local tunnel (ngrok/Cloudflare as configured)
launchctl enable   "gui/$UID/ai.jobbored.discovery.tunnel"
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/ai.jobbored.discovery.tunnel.plist"

# Resilience tick (housekeeping helpers)
launchctl enable   "gui/$UID/ai.jobbored.resilience.tick"
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/ai.jobbored.resilience.tick.plist"

# Daily discovery refresh (8:15 local unless customized)
launchctl enable   "gui/$UID/com.jobbored.refresh"
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/com.jobbored.refresh.plist"

# Hermes materials watcher (optional)
launchctl enable   "gui/$UID/com.jobbored.materials-watcher"
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/com.jobbored.materials-watcher.plist"

# Expired job cleanup schedule (optional)
launchctl enable   "gui/$UID/com.jobbored.expired-cleanup"
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/com.jobbored.expired-cleanup.plist"
```

Re‑enable everything at once:

```bash
UID="$(id -u)"
for label in \
  ai.jobbored.discovery.worker \
  ai.jobbored.discovery.worker.watchdog \
  ai.jobbored.discovery.keepalive \
  ai.jobbored.discovery.tunnel \
  ai.jobbored.resilience.tick \
  com.jobbored.refresh \
  com.jobbored.materials-watcher \
  com.jobbored.expired-cleanup
do
  launchctl enable "gui/$UID/$label"
  launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/$label.plist"
done
```

## Health checks

- Discovery worker: `curl -fsS http://127.0.0.1:8644/health` (HTTP 200 when up)
- Dashboard: `http://localhost:8080` when started manually (`npm start` or `npm run dev`)
- Cloudflare relay/keep‑alive: `~/.jobbored/logs/keep-alive.log` should show recent successful polls and (when ngrok is used) secret updates

## Where logs live

- Keep‑alive:
  - Log: `~/.jobbored/logs/keep-alive.log`
  - State: `~/.jobbored/keep-alive-state.json`
- Schedules (examples):
  - Daily refresh (Linux cron example in docs): `integrations/browser-use-discovery/state/cron-refresh.log`
  - Expired‑cleanup schedule: `integrations/browser-use-discovery/state/expired-cleanup-schedule.log`
- launchd inspection:
  - `launchctl print gui/$(id -u)/<label>`
  - `log stream --predicate 'subsystem CONTAINS[c] \"jobbored\" OR process CONTAINS[c] \"jobbored\"' --info --style compact`

If a `bootstrap` fails, confirm the `.plist` exists and is readable under `~/Library/LaunchAgents/`, then use `launchctl print` to read the last exit/status.

## Notes and guardrails

- Do not delete `~/Library/LaunchAgents/*.plist` or any secrets/config under `~/.jobbored/` or `~/.hermes/job-hunt/`.
- Dogfood is currently paused. Re‑enable only when asked; turning agents on without an owner can create noisy traffic.
- The repo is public MIT and dogfooding is best‑effort — no maintainer‑run hosted service.

