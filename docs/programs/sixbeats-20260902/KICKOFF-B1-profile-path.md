# Lane B1 — profile-path (claim C3: the fit profile must persist on a fresh install)

Read `SIXBEATS-SPEC.md` (locked decision 3), the ONEFLOW ground rules, spec §5 B4 + B6. Fence: `dev-server.mjs` (one new proxy route + its tests), a comment in `fit-profile-wizard.js` `profileUrl()` only.

**Mission:** On a fresh install `jobBoredApiUrl` is empty, so `POST /profile` (Beat 4) and `GET /profile` (Beat 6) hit the static dashboard host and 404 — the server fit profile silently never persists. Add a dev-server proxy so same-origin `/profile` and `/profile/*` (GET/POST/PUT) forward to the local API (`http://127.0.0.1:3847` by default; honor the existing API-port configuration if `dev-server.mjs` already knows one), with the same local-origin authorization posture as the existing `/__proxy` routes, streaming status and JSON body back unchanged.

Deliver:
1. Red-first tests in `tests/sixbeats-b1-profile-proxy.test.mjs` using the `startDevServer({port:0})` pattern from `tests/dev-server-proxy-cors-handshake.test.mjs`: with a stub upstream listening on a free port and the proxy pointed at it, `GET /profile` returns the upstream's body and status; `POST /profile` forwards the JSON body; a cross-site Origin is refused; upstream down → a JSON error, never a hang.
2. The route.
3. Prove the end-to-end claim: from a fresh worktree run the app and (with the API from `npm run start:scraper` or a stub on 3847) walk Beat 4 → Beat 6 in a Playwright script in `.lane-evidence/`, asserting no `/profile` 404 in the network log. Paste the log lines.

DoD: tests green, full floor green (pasted), report complete, committed locally, never pushed.
