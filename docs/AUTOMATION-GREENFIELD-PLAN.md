# Automation Greenfield Plan

## What it does

The greenfield automation path turns first-run discovery setup into a guided local workflow:

- checks whether required free CLIs are installed and logged in,
- creates the Google OAuth client from the user's own Google project when `gcloud` is available,
- starts the local discovery worker and ngrok tunnel,
- deploys or refreshes the user's Cloudflare Worker relay,
- installs a user-level keep-alive job so ngrok rotation can be detected and redeployed without manual copy/paste.

All credentials stay on the user's machine or in their own Google, Cloudflare, and ngrok accounts.

## What it costs

The maintainer pays $0.

The flow uses user-owned free-tier accounts and local machine automation only. There is no maintainer-hosted backend, shared proxy, shared database, or paid managed service in this setup path.

## Required user accounts

- Google account: used for the user's Sheet and OAuth client. The helper can use `gcloud` if installed and authenticated.
- Cloudflare account: used for the user's free Workers relay. The helper uses `wrangler` authentication.
- ngrok account: used for the user's free tunnel and auth token. The helper checks local ngrok configuration.

Each account can be created on a free plan.

## Troubleshooting

- If `gcloud` is missing, install the Google Cloud CLI, then run `gcloud auth login`.
- If Google APIs are disabled, run `gcloud services enable iam.googleapis.com oauth2.googleapis.com` in the selected project.
- If Cloudflare auth is missing, run `npx wrangler login`, then rerun the setup action.
- If ngrok auth is missing, add your ngrok authtoken locally, then rerun the setup action.
- If the keep-alive install fails on macOS, check `launchctl` output and confirm the job file under `~/Library/LaunchAgents/` is readable by your user.
- If the keep-alive install fails on Linux, run `systemctl --user status ai.jobbored.discovery.keepalive.timer` and confirm user services are enabled.
- If setup reports a tunnel rotation, rerun the relay deploy helper so the saved `workers.dev` URL keeps forwarding to the current ngrok URL.
