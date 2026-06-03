# Self-hosting JobBored

JobBored runs entirely on your own machine. The dashboard (`http://localhost:8080`),
the local server (`http://127.0.0.1:3847`), and the discovery worker
(`http://127.0.0.1:8644`) all start with `npm run dev`.

The only thing you might need to expose beyond `localhost` is the **discovery
worker** — the service that runs job-search passes when you click **Run
discovery**. You need to expose it when the dashboard runs somewhere the worker
can't be reached at `127.0.0.1:8644`, for example:

- You deploy the dashboard to GitHub Pages (HTTPS) but run the worker on your laptop.
- You want to trigger discovery from your phone or another device.

If you only ever use JobBored on one machine, you can skip all of this — the
default localhost setup already works.

This guide covers the transport options from **simplest** to **most flexible**.

---

## Option 1 — localhost (default, no tunnel)

Single machine, nothing to expose. This is the default and needs no setup.

In `config.js`:

```js
discoveryWebhookUrl: "http://127.0.0.1:8644/webhook",
discoveryWebhookSecret: "", // optional locally; if set, must match the worker
```

Start everything:

```bash
npm run dev
```

The dashboard, served from `http://localhost:8080`, can reach the worker on the
same machine. Done.

---

## Option 2 — Tailscale (recommended for multi-device)

[Tailscale](https://tailscale.com) puts all your devices on a private mesh
network with **stable** addresses that **never rotate**. This is the most
durable option for using JobBored across your laptop, desktop, and phone.

**Why Tailscale over the alternatives:**

- **vs. ngrok** — ngrok's free URL changes every time the tunnel restarts, so
  you'd have to edit `config.js` constantly. Tailscale's URL is permanent.
- **vs. Cloudflare quick tunnels** — those are public and are blocked or
  filtered on some networks (DNS/SNI filtering). Tailscale is a private mesh, so
  there's no public exposure and nothing for a network to block.

**Setup:**

1. Install Tailscale on **each** device (the worker host and any device that
   opens the dashboard) and log them all in to the **same tailnet**:
   <https://tailscale.com/download>

2. On the **worker host** (the machine running `npm run dev`), expose the worker
   over your tailnet with HTTPS:

   ```bash
   tailscale serve --bg 8644
   ```

   This prints a stable URL like:

   ```
   https://<your-machine>.<your-tailnet>.ts.net
   ```

   `<your-machine>` is that device's Tailscale name and `<your-tailnet>` is your
   tailnet name (both shown in the Tailscale admin console). It does not change.

3. In `config.js` on the device running the dashboard, point at that URL plus
   `/webhook`, and set the shared secret to the worker's secret:

   ```js
   discoveryWebhookUrl: "https://<your-machine>.<your-tailnet>.ts.net/webhook",
   discoveryWebhookSecret: "<same value as the worker's BROWSER_USE_DISCOVERY_WEBHOOK_SECRET>",
   ```

   Set `BROWSER_USE_DISCOVERY_WEBHOOK_SECRET` in the worker's env file
   (`~/.jobbored/browser-use-discovery/.env`, created by `npm run setup:discovery`).
   The worker fail-closes on an empty secret when exposed, so set it on both sides.

Any device on your tailnet can now trigger discovery. The URL is private to your
mesh and never rotates.

---

## Option 3 — ngrok (fastest to try, URL rotates)

[ngrok](https://ngrok.com) gives you an instant public HTTPS tunnel. Good for a
quick test; the catch is the free URL **changes every restart**, so you re-edit
`config.js` each time.

```bash
# install: https://ngrok.com/download, then `ngrok config add-authtoken <token>`
ngrok http 8644
```

Copy the `https://<random>.ngrok-free.app` URL it prints, then in `config.js`:

```js
discoveryWebhookUrl: "https://<random>.ngrok-free.app/webhook",
discoveryWebhookSecret: "<your worker secret>",
```

Always set `discoveryWebhookSecret` here — the tunnel is public.

---

## Option 4 — Cloudflare (only if you own a domain)

If you already own a domain on Cloudflare, a
[named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
gives you a stable custom URL (e.g. `https://discovery.yourdomain.com`). This
needs a Cloudflare account and DNS you control.

> Note: Cloudflare **quick tunnels** (`trycloudflare.com`) are public and may be
> blocked on some networks. Prefer a named tunnel on your own domain, or use
> Tailscale (Option 2).

Point `discoveryWebhookUrl` at your tunnel's hostname + `/webhook` and set
`discoveryWebhookSecret` as above. The repo includes a Cloudflare Worker relay
helper if you deploy via Pages: `npm run cloudflare-relay:deploy`.

---

## Keeping the worker always-on

To run discovery on a schedule (or keep the worker alive after reboot) without
keeping a terminal open:

- **macOS (launchd):** the repo installs a launchd agent for you.

  ```bash
  npm run discovery:worker:autostart:install   # keep the worker running
  npm run discovery:tunnel:autostart:install   # keep your tunnel up (if used)
  npm run discovery:worker:autostart:status    # check it
  ```

  Uninstall with the matching `:autostart:uninstall` scripts. Implementation:
  `scripts/install-discovery-worker-autostart.mjs` and
  `scripts/install-discovery-tunnel-autostart.mjs`.

- **Linux (systemd):** there's no bundled systemd unit, but the same idea
  applies — wrap `npm run start:discovery-worker` (which runs
  `scripts/start-discovery-worker-local.mjs`) in a user service. A minimal unit:

  ```ini
  # ~/.config/systemd/user/jobbored-discovery.service
  [Unit]
  Description=JobBored discovery worker

  [Service]
  WorkingDirectory=%h/Job-Bored
  ExecStart=/usr/bin/env npm run start:discovery-worker
  Restart=on-failure

  [Install]
  WantedBy=default.target
  ```

  ```bash
  systemctl --user enable --now jobbored-discovery.service
  ```

For more on local discovery paths and config, see
[DISCOVERY-PATHS.md](DISCOVERY-PATHS.md).
