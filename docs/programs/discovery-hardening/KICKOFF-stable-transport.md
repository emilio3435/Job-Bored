# Lane D — stable-transport · stable transport proof (claim STABLE-1)

Read `GROUND-RULES.md` and `PROGRAM-SPEC.md` (Locked decisions win). Worktree: `/private/tmp/Job-Bored-discovery-hardening-stable-transport`, branch `feat/discovery-hardening-stable-transport`.

**Goal:** Decide from evidence whether the current stable local transport (Tailscale) and secret handoff already satisfy STABLE-1, and make the smallest evidence-backed repair only if the locked spec records a gap.

**Success means:**
- A 5-row hop matrix in your report — dashboard, scraper/worker, tunnel/stable transport, relay, secret auth — each row citing the exact test (file:line) that proves the UI names that hop as the failing one. Run all six named tests and paste output.
- If the locked spec says "already sufficient": this is a TEST-ONLY / NO-PRODUCT-CHANGE lane. Add at most one `STABLE-1:` test that pins the matrix explicitly (so the claim has a named guard), commit that, and stop.
- If the locked spec names ONE gap: RED probe first, then the smallest repair in the named file, with environment-specific addresses/secrets kept in configuration, never in source.
- Already-satisfied behavior is byte-for-byte unchanged.

**Fence (exclusive, spec LD-4/LD-5/LD-8):** `discovery-status-handoff.js`, `discovery-run-tracker.js`, `discovery-readiness.js` (only if the toast tests need a seam — prefer none), the six named tests, `tests/run-status-honesty.test.mjs` (minimal edit ONLY on a proven conflict, explained in the report), new `tests/discovery-stable-transport.test.mjs`, new `tests/discovery-lifecycle-poller.test.mjs`. No live infrastructure: no Tailscale, ngrok, Cloudflare, launchd, `.env` mutation. `config-overrides.js`, `dev-server.mjs`, `discovery-wizard-probes.js` are NOT yours.

**Second unit — LIFECYCLE-1 poll retry classification (assigned to you because you own the file; tests carry the `LIFECYCLE-1:` prefix):** today `pollRunStatus` (`discovery-status-handoff.js:606`, non-ok branch `:628–633`) treats EVERY non-ok response as retryable; after `MAX_POLL_ERRORS = 3` (`:504`) the UI says "Lost the status connection after multiple attempts. The discovery run may still be running." — false for a `404 Run not found` or a `401` bad status token. Add a pure exported `classifyRunStatusPollResponse(status) → "ok" | "retryable" | "terminal"` (retryable: 0/408/425/429/500/502/503/504 and network errors; terminal: 401/403/404/405/410). Route `retryable` → existing `markPollError` (unchanged); `terminal` → stop polling immediately via one new terminal-marking entry point in `discovery-run-tracker.js` (or corrected copy through `markStatusConnectionLost` if a new entry point proves invasive — say which and why) with an honest message that does not claim the run may still be running. No model call decides routing. RED probe pre-copied: `node --test .lane-evidence/scout-worker/lifecycle-poll-classification.probe.test.mjs` → observed RED: 404 and 401 produce `pollErrors=["Status endpoint returned HTTP 404"]`. Port the 503/404/401 cases into `tests/discovery-lifecycle-poller.test.mjs` (vm-mount harness from `tests/run-status-honesty.test.mjs:67–117`); `tests/discovery-run-status-polling.test.mjs` must stay green.

**Locked verdict (from the browser scout): NOT test-only. Exactly ONE gap, plus one coverage hole.**

The gap: `diagnoseDownstreamChain` in `discovery-status-handoff.js:220–230` computes `usesTunnelTransport = !!(localUrl || snapshot.tunnelPublicUrl || transport.tunnelPublicUrl)`. A Tailscale user who runs the worker locally always has `localWebhookUrl` set (`config-overrides.js:433–436` writes it unconditionally from `discovery-local-bootstrap.json`; `scripts/bootstrap-local-discovery.mjs:1665` writes it regardless of transport). With a HEALTHY local worker and a broken `tailscale serve`, the honest ts.net summary at line ~287 is skipped, `probeNgrokTunnels()` returns `""`, and the UI says `"ngrok tunnel is not running."` with `primaryFix.id === "diag_fix_tunnel"` — the wrong hop.

The repair (smallest, in your fence): decide "uses a tunnel" from an actual tunnel URL or the saved webhook's kind (`classifySavedWebhookKind` / `getRemoteDiscoveryWebhookHost` at `discovery-status-handoff.js:160–192`), NOT from the mere presence of `localWebhookUrl`. Non-negotiable acceptance: (1) the scout's RED turns GREEN; (2) its control case (same inputs, no local worker → ts.net host named) stays green; (3) EVERY existing case in `tests/run-status-honesty.test.mjs:167–286` stays green — in particular `:206–213` (ngrok fix survives for a real tunnel) and `:215–221` (local-server fix when a local webhook is down). An ngrok user whose tunnel is stopped must still be told about ngrok. `config-overrides.js` and `dev-server.mjs` are NOT to be edited.

Fence addition: `tests/run-status-honesty.test.mjs` is routed to Lane D for this program (add the Tailscale-healthy-worker case there or in the new `tests/discovery-stable-transport.test.mjs`; both are yours).

The coverage hole (row 5, no behavior change): `showDiscoveryVerificationToast` (`discovery-readiness.js:801–869`) is called by zero tests. Add the scout's three passing cases (secret hop → "Copy bootstrap command"; tunnel hop → "Fix tunnel"; Tailscale non-tunnel failure → no ngrok remediation) as `STABLE-1:` tests.

The 5-row matrix is in `SCOUT-browser.md` §STABLE-1(c) — reproduce it in your report with the file:line citations, re-run the six named tests, paste.

**RED probe (run first, paste output):** pre-copied to `.lane-evidence/stable-1-tailscale-hop.probe.test.mjs` and `.lane-evidence/stable-1-secret-hop.probe.test.mjs`. `node --test .lane-evidence/stable-1-tailscale-hop.probe.test.mjs` → observed RED on base: `actual: 'ngrok tunnel is not running.'  expected: /ngrok/i  operator: 'doesNotMatch'`, control case passing.

**Targeted gate:** `npm test -- tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs tests/dev-server-tailscale.test.mjs tests/discovery-transport.test.mjs tests/discovery-readiness-truth.test.mjs tests/discovery-wizard-verify.test.mjs tests/discovery-cold-start-handoffs.test.mjs tests/run-status-honesty.test.mjs tests/recovery-state.test.mjs tests/discovery-run-status-polling.test.mjs tests/discovery-stable-transport.test.mjs tests/discovery-lifecycle-poller.test.mjs`.

**DoD:** matrix + pasted results → RED→GREEN for both units → targeted gate → full floor → diff reviewed → ONE local commit `fix(discovery-hardening/stable-transport): …` (two units, one coherent commit; or two commits, one per unit, both named) → SHA(s) in report. Never push.
