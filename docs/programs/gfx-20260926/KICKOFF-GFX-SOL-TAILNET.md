# Lane SOL-TAILNET: allow onboarding and setup over the owner's own tailnet (D13), securely

Read `KICKOFF-GFX-_SHARED.md`, then:
- `SPEC.md` §0 (D2, D13)
- `PLAN.md` §R (R3, R11, R16, R21)
- V3's finding (SPEC B5 ledger, "tailnet dashboards"): `*.ts.net` passes the Host gate (`dev-server.mjs` ~2671), but every `/__proxy/*` call returns 403.

**Routing:** sol · xhigh. This is a security-sensitive change. Threat-model it first, then write the threat model into your report's §1.

Base branch: `feat/gfx-integration` (currently `dd45a692`).

**Goal:** when Emilio opens his own JobBored through **Tailscale Serve** at `https://<this-machine>.<tailnet>.ts.net`, onboarding and setup work as they do on localhost. Nobody else gains anything: not another tailnet user or device, not the public internet, not a foreign page.

**Success means (each item red first, tests named `GFX-D13-*`):**

1. **Server trust**, in `scripts/lib/local-control-auth.mjs` and `dev-server.mjs`. A request is trusted as local control only when **all** of these hold:
   - (a) the TCP peer is loopback (Tailscale Serve proxies from `127.0.0.1`);
   - (b) the `Host` and `Origin` equal **this machine's own** tailnet DNS name. Resolve it from `tailscale status --json` (`Self.DNSName`), cache it with a short TTL, and **fail closed** when tailscale is missing, errors, or returns an empty name;
   - (c) the request carries a `Tailscale-User-Login` header that equals the node owner's login (from the same status JSON: `Self.UserID` → `User[...]`). Tailscale Serve injects and overwrites this header, so it can't be spoofed through Serve.
   - Also:
     - Keep every existing loopback, `Sec-Fetch-Site` and exact-origin rule unchanged.
     - A `*.ts.net` that isn't this machine gets 403.
     - A `Tailscale-User-Login` of another user gets 403.
     - A missing identity header gets 403.
     - A direct, non-Serve connection to the tailnet IP never reaches the server, because it stays bound to loopback. Keep it that way, and test that the bind is loopback.
2. **Ping and CORS:** `/__proxy/ping` answers the own-tailnet origin, and CORS echoes only that exact origin.
3. **Client:** in `local-server.js`, `isLoopbackPage` becomes `isLocalControlPage`. It returns true for loopback, **or** when the page's own same-origin ping answers `{ ok, runtime }` with a new `tailnetOwner: true` field. The server sets that field only when (1) passed.
   - Nothing is hostname-guessed on the client.
   - The FE-B1 pre-flow gate uses it, so a tailnet visitor gets the normal flow and not the route-to-local screen.
   - Keep the old export name as an alias for existing callers.
4. **Honest failure:** when the server refuses a tailnet request, because the identity doesn't match or tailscale is unavailable, the page shows "This JobBored belongs to another Tailscale user" or "Tailscale isn't answering on this computer", each with one fix. Never a generic 403.
5. **Docs:** add a short "Set up from your phone over Tailscale" section to `SETUP.md`, stating the owner-only rule.

**Floor:**
- lint
- typecheck
- `HOME=$(mktemp -d) npm test`: 0 failures. **Your sandbox can't bind loopback, so run what you can, write `DONE (floor pending orchestrator)` if needed, and the orchestrator runs the full floor.**
- tests that inject a fake `tailscale status` JSON through a seam; never call the real tailscale binary in tests
- `gitleaks protect --staged --redact`

**Fence:** `scripts/lib/local-control-auth.mjs`; `dev-server.mjs` (auth, ping, CORS only); `local-server.js`; `oneflow-route-local.js` and `onboarding-flow.js` (only the gate's check); `SETUP.md` (that section); new `tests/gfx-d13-*.test.mjs`.

**Never:**
- call `tailscale serve`, `tailscale funnel`, or anything that changes the tailnet;
- touch :8080/:8644/:3847 or `~/.jobbored`;
- widen trust to any origin besides the machine's own name.

**Report:** `.lane-evidence/LANE-REPORT-SOL-TAILNET.md`. The first line is `DONE`, `DONE (floor pending orchestrator)`, or `BLOCKED: <why>`.
