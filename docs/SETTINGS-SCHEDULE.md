# Schedule your daily discovery — three options, all from Settings

**New to Command Center?** You don't need to wire any automation to use the dashboard — pasting jobs into the Pipeline sheet works fine. This doc is for when you want Command Center to **find new jobs for you on a schedule**, without thinking about it.

Open the dashboard → **Settings → Profile → Schedule**. You'll see three cards, top to bottom. Pick the first one that fits. You can always upgrade later.

---

## 🥇 Tier 1 — "While this tab is open"

**Best for:** trying it out, keeping the dashboard open anyway, or when you don't want to install anything.

1. In the Schedule card, turn on **"Auto-refresh while this tab is open."**
2. Pick how often (every 6, 12, or 24 hours).

That's it. While the dashboard tab is open in your browser, it'll re-run discovery on that cadence. Close the tab, and the schedule pauses.

**Works on:** any OS, any browser.
**Requires:** nothing.
**Downside:** only runs when you're looking.

---

## 🥈 Tier 2 — "Runs daily on this computer"

**Best for:** you have the discovery worker running locally (`npm run discovery:worker:start-local`) and want a real daily schedule without cloud setup.

1. In the Schedule card, find **"Runs daily on this computer."**
2. Pick a time (e.g. `08:00`) — the card tells you which OS it detected.
3. Click **"Copy install command"** and paste it into a terminal:

   ```bash
   npm run schedule:install -- --hour 8 --minute 0 --sheet-id YOUR_SHEET_ID
   ```

   The copied command includes your configured Sheet ID when the dashboard can read it. If it is omitted, the installer falls back to `.env` and the local worker config.

4. Done — the badge flips to green **"Installed"** next time you refresh Settings.

Under the hood, that one command:

- **macOS** → writes `~/Library/LaunchAgents/com.jobbored.refresh.plist` + `launchctl load`.
- **Linux** → writes a **systemd user timer** at `~/.config/systemd/user/jobbored-refresh.timer` (or falls back to `crontab` if systemd user activation isn't available).
- **Windows** → registers a **Task Scheduler** task `JobBoredRefresh` that runs `scripts/windows/refresh.ps1`.
- Each OS path runs `scripts/run-scheduled-discovery.mjs`, which builds the current `command-center.discovery` payload at fire time and posts it to the worker's `/webhook` endpoint.

To uninstall: click **"Copy uninstall command"** and run `npm run schedule:uninstall`.

**Works on:** macOS / Linux / Windows. Detected from the browser.
**Requires:** the local worker running when the schedule fires (otherwise the POST fails silently — check `state/schedule-installed.json` exists).
**Downside:** machine must be awake at fire time. Systemd's `Persistent=true` will retry after sleep; macOS/Windows will just skip a missed day.

**Secret safety:** local scheduler artifacts run the repo script and read `BROWSER_USE_DISCOVERY_WEBHOOK_SECRET` from `.env` at runtime. macOS launchd, Linux systemd/crontab, and Windows Task Scheduler artifacts should still be treated as local machine config, but they no longer need to embed the webhook secret in the generated command.

### Windows walkthrough

1. Install [Node.js 24.x](https://nodejs.org/) and [Git for Windows](https://git-scm.com/download/win).
2. Clone and `cd` into the repo. Open a **PowerShell** terminal.
3. Start the local worker once so `.env` is populated: `npm run discovery:worker:start-local`.
4. In another PowerShell window, in the repo root: `npm run schedule:install -- --hour 8 --minute 0 --sheet-id YOUR_SHEET_ID`.
5. Verify in **Task Scheduler** → Task Scheduler Library → look for `JobBoredRefresh`. Right-click → **Run** to test-fire.
6. Uninstall with `npm run schedule:uninstall` any time.

> **Note:** the scheduled task runs PowerShell with `-NoProfile -ExecutionPolicy Bypass` so it works under default execution policies without needing Admin. Port validation + a 10-minute timeout are baked into `scripts/windows/refresh.ps1` so a hung worker can't leave the task running forever.

---

## 🥉 Tier 3 — "Runs in the cloud on a schedule"

**Best for:** you want discovery to fire even when your laptop is asleep, or you don't run the worker locally.

This tier uses **GitHub Actions** — free for public repos, no CORS issues, runs regardless of your machine state. The Settings wizard generates a personalized workflow file for you.

1. In the Schedule card, find **"Runs in the cloud on a schedule."**
2. Pick a time in **America/Chicago**. The default is **06:00**, which is 11:00 UTC during daylight time and 12:00 UTC during standard time.
3. Click **"Download workflow file"** → saves `command-center-discovery.yml`.
4. Follow the numbered steps in the card:
   - Fork this repo (or use an existing fork).
   - Add repo secrets `COMMAND_CENTER_DISCOVERY_WEBHOOK_URL` + `COMMAND_CENTER_SHEET_ID`.
   - Add `COMMAND_CENTER_DISCOVERY_WEBHOOK_SECRET` only if you post directly to the browser-use worker, or to another endpoint that enforces `x-discovery-secret`.
   - Optional: add `COMMAND_CENTER_DISCOVERY_PROFILE_JSON` and `COMMAND_CENTER_DISCOVERY_PREFERENCES_JSON` when the public worker endpoint cannot load the profile state saved by your dashboard.
   - Upload the downloaded file to `.github/workflows/` in your fork.
5. The **"Advisory"** badge stays on this tier — the worker cannot verify GitHub remotely, so check your fork's Actions tab to confirm the workflow is running.

**Works on:** any OS (schedule runs on GitHub's servers).
**Requires:** the webhook URL in the secrets must be **publicly reachable** (ngrok tunnel for local workers, a Cloudflare Worker relay, or an Apps Script URL). See `templates/cloudflare-worker/README.md` for the relay pattern.
**Downside:** your worker endpoint must be internet-accessible — not just localhost.

The workflow is DST-safe for America/Chicago: its cron line fires at both possible UTC offsets, `0 11,12 * * *` for the default 06:00 run, and the job exits unless `TZ=America/Chicago date +"%H:%M"` matches the selected local time. Manual **Run workflow** dispatches are not blocked by that guard.

If you use the Cloudflare Worker relay, prefer storing the worker-facing secret as Cloudflare `DISCOVERY_SECRET`; GitHub can then keep only the public Worker URL and Sheet ID.

---

## Which tier?

| If you... | Pick |
| --- | --- |
| just want to try it | Tier 1 |
| run the worker locally and your laptop is usually on | Tier 2 |
| want cloud reliability and have the worker reachable at a public URL | Tier 3 |
| want multiple simultaneously | Any combination — they're independent |

You can enable more than one tier at once. The last tier that saved to the worker-config is the one displayed in the status panel, but all three fire independently.

---

## For developers / contributors

- Machine contract: `docs/INTERFACE-SCHEDULE.md` (webhook shapes, CLI flags, breadcrumb path, TypeScript types).
- Worker endpoints: `POST /discovery-profile` with `mode:"schedule-save"` or `mode:"schedule-status"` — see `integrations/browser-use-discovery/src/webhook/handle-discovery-profile.ts`.
- Cross-platform installer dispatcher: `scripts/install-schedule.mjs`.
- Breadcrumb file: `integrations/browser-use-discovery/state/schedule-installed.json` — written by the installer, read by `schedule-status`. Used for the "Installed" badge.

### Known follow-ups

- **Remote profile source.** GitHub Actions and Cloudflare cron can only include profile/preferences that are available to their runtime. Use the optional JSON secrets when the remote webhook cannot load current worker-side profile state.
