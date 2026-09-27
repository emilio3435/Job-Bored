## GFX follow-up: live discovery progress, and owner-only setup over Tailscale

This builds on #132 (merged as `dddaddcf`). It brings in the three lanes that finished after #132 was opened.

### Discovery runs no longer look frozen (UXD-FE + UXD-BE)

- **Worker (UXD-BE):** throttled, structured checkpoints for every long phase of a run. Each carries a 15 s heartbeat, counters, the current company, and up to 8 source lanes. The payload is additive, so older clients keep working.
- **Dashboard (UXD-FE):** a live phase and counters, plus per-source progress, in the Runs tab, the discovery drawer and the run button. It is honest about silence: under 30 s reads "working", 30–120 s reads "quiet", and past 120 s it says "no word from the worker".
- Both sides render only the contract they agreed on byte for byte; nothing is invented.

### Setup from your phone over Tailscale (SOL-TAILNET, D13)

- When you open your own JobBored through **Tailscale Serve** at `https://<this-machine>.<tailnet>.ts.net`, onboarding and setup work as they do on localhost.
- **Owner only.** A request is trusted only when all of these hold:
  - it arrives through Serve from a loopback peer;
  - `Host` and `Origin` are exactly this machine's own tailnet name, taken from the local `tailscale status`, never from the request;
  - `Sec-Fetch-Site` is absent or `same-origin`;
  - `Tailscale-User-Login` equals the node owner's login.
- Anything else gets a named refusal: "belongs to another Tailscale user" or "Tailscale isn't answering on this computer". It fails closed when the daemon is missing.
- The server still binds to loopback only.
- **Residual risk, stated plainly:** this relies on Tailscale Serve overwriting the identity header. Keep **Tailscale Funnel off** for this port. A local process can forge these headers, but it could already forge `Origin` against localhost, so that is not a new exposure.
- `SETUP.md` gains a short "Set up from your phone over Tailscale" section.

### Verification (run by the orchestrator)

| Check | Result |
|---|---|
| `npm run lint:repo`, `npm run typecheck:repo` | exit 0 |
| `HOME=$(mktemp -d) npm test` | 4,634 pass, **0 fail**, 8 todo. Host state unchanged: worker pid, `.env` mtime, LaunchAgents |
| Discovery worker suite | 848 / 848 |
| e2e onboarding / journey / visual | 7 / 7, 33 / 33, 56 / 56 |
| `desktop` tests | 47 / 47 |
| gitleaks over each lane range | no leaks |

- **Merge conflict:** one conflict in `start.sh` (UXD-BE against #132's Linux port-holder fix). It was resolved to `main`'s version; UXD-BE's side of that hunk was the old code, so nothing was lost.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_012DWfF7w7RrJUkP2qSf8Vqt
