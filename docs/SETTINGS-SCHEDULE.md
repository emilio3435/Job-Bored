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
   npm run schedule:install -- --hour 8 --minute 0
   ```

4. Done — the badge flips to green **"Installed"** next time you refresh Settings.

Under the hood, that one command:

- **macOS** → writes `~/Library/LaunchAgents/com.jobbored.refresh.plist` + `launchctl load`.
- **Linux** → writes a **systemd user timer** at `~/.config/systemd/user/jobbored-refresh.timer` (or falls back to `crontab` if systemd user activation isn't available).
- **Windows** → registers a **Task Scheduler** task `JobBoredRefresh` that runs `scripts/windows/refresh.ps1`.

To uninstall: click **"Copy uninstall command"** and run `npm run schedule:uninstall`.

**Works on:** macOS / Linux / Windows. Detected from the browser.
**Requires:** the local worker running when the schedule fires (otherwise the POST fails silently — check `state/schedule-installed.json` exists).
**Downside:** machine must be awake at fire time. Systemd's `Persistent=true` will retry after sleep; macOS/Windows will just skip a missed day.

### Windows walkthrough

1. Install [Node.js 20+](https://nodejs.org/) and [Git for Windows](https://git-scm.com/download/win).
2. Clone and `cd` into the repo. Open a **PowerShell** terminal.
3. Start the local worker once so `.env` is populated: `npm run discovery:worker:start-local`.
4. In another PowerShell window, in the repo root: `npm run schedule:install -- --hour 8 --minute 0`.
5. Verify in **Task Scheduler** → Task Scheduler Library → look for `JobBoredRefresh`. Right-click → **Run** to test-fire.
6. Uninstall with `npm run schedule:uninstall` any time.

> **Note:** the scheduled task runs PowerShell with `-NoProfile -ExecutionPolicy Bypass` so it works under default execution policies without needing Admin. Port validation + a 10-minute timeout are baked into `scripts/windows/refresh.ps1` so a hung worker can't leave the task running forever.

---

## 🥉 Tier 3 — "Runs in the cloud on a schedule"

**Best for:** you want discovery to fire even when your laptop is asleep, or you don't run the worker locally.

This tier uses **GitHub Actions** — free for public repos, no CORS issues, runs regardless of your machine state. The Settings wizard generates a personalized workflow file for you.

1. In the Schedule card, find **"Runs in the cloud on a schedule."**
2. Pick a time (UTC — the card shows your local-time equivalent).
3. Click **"Download workflow file"** → saves `command-center-discovery.yml`.
4. Follow the numbered steps in the card:
   - Fork this repo (or use an existing fork).
   - Add repo secrets `COMMAND_CENTER_DISCOVERY_WEBHOOK_URL` + `COMMAND_CENTER_SHEET_ID`.
   - Upload the downloaded file to `.github/workflows/` in your fork.
5. The **"Advisory"** badge stays on this tier — the worker cannot verify GitHub remotely, so check your fork's Actions tab to confirm the workflow is running.

**Works on:** any OS (schedule runs on GitHub's servers).
**Requires:** the webhook URL in the secrets must be **publicly reachable** (ngrok tunnel for local workers, a Cloudflare Worker relay, or an Apps Script URL). See `templates/cloudflare-worker/README.md` for the relay pattern.
**Downside:** your worker endpoint must be internet-accessible — not just localhost.

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

- **Secret handling in scheduler artifacts.** The macOS launchd plist, the Linux systemd service, and the crontab entry currently embed the webhook secret directly in the scheduled command. The Windows tier already reads the secret at runtime from `.env` (the safer pattern). Before we ship publicly, the other OSes should be aligned to the Windows pattern. Tracked; not yet done.
