## GFX: greenfield onboarding, fixed end to end (plus the JobBored Mac app)

A brand-new user now gets from a cold open to a live dashboard with no false error, no dead end, and no sentence they can't act on. The program started from two onboarding audits, a Gemini one and a Muse one. Opus verifiers checked all 71 of their claims (8 were refuted) and found 34 more bugs. Every ledger row is fixed with a test named for its ID, or waived in §0.

**Spec, plan and evidence:** `docs/programs/gfx-20260926/` holds the SPEC ledger and §0 decisions D1–D12, PLAN §R (R1–R25), the lane reports, the verdicts, and QA-LIVE.

### What changes for a new user

- **Hosted page (D2):** before any setup, the hosted page says plainly that JobBored runs on your computer, then offers Open JobBored (`jobbored://`), Download for Mac, or the copy-setup command.
- **B1:** the Client ID steps are linked. The permission copy is honest. Re-consent runs inside the click, so no popups get blocked. Sheet creation happens exactly once. Every failure gets its own message.
- **B2:** Gemini is the default. A local key write happens only after an explicit consent row. The false CORS note is gone.
- **B3:** drafting shows a stall watch at 30 s and aborts at 90 s. The provider's real error is shown. `.doc` is no longer accepted.
- **B4:** the fit profile is redesigned and **actually reaches the server**. This fixes the P0 behind `VAL-ONEFLOW-001`, which has been red on main since #130. A 4xx is never swallowed. The schema is shared.
- **B5:**
  - Each of the nine key-check outcomes gets one diagnosis and one fix.
  - `start.sh` checks :8080 first and names whoever holds it.
  - `npm start` no longer dies when a sibling does, and it starts the worker.
  - The wizard uses plain names and recommends exactly one path.
  - Discovery setup opens above the drawer, and a stale worker secret heals with one reload.
- **B6:** it waits for the first run to start, and uses softer copy for skipped steps.
- **Phones:** every beat's error line is visible at 375 px. Before this fix, it was drawn off-screen.

### Backend and platform

- `local-server.js` is the single substrate. It carries the frozen outcome table and the ping contract `{ok, version, runtime, routes, desktopVersion?}`.
- Desktop mode:
  - `scripts/lib/runtime-env.mjs` is the spawn contract;
  - writes move to `~/.jobbored`;
  - keep-alive and autostart become no-ops under the app;
  - the python3 logo resolver is gated.
- `desktop/`: a menu-bar Electron app. It has a locked-down `jobbored://` handler, a supervisor that attaches before it spawns and never kills processes it didn't start, a LaunchAgent migration that needs consent and covers five exact labels, and an updater.
- `.github/workflows/desktop-mac.yml`: a universal build with sign, notarize and staple, producing a **draft** release in `emilio3435/jobbored-desktop`. It is **not a required check**. Runbook: `docs/DESKTOP-RELEASE.md`.
- Hardening from an adversarial review by Sol: fail-closed checks, `ajv` moved to runtime dependencies, and the app owns its worker.

### Verification (run by the orchestrator, not taken from the lanes)

| Check | Result |
|---|---|
| `npm run lint:repo`, `npm run typecheck:repo` | exit 0 |
| `HOME=$(mktemp -d) npm test` | 4,588 pass, **0 fail**, 8 todo. Host state unchanged: worker pid, `.env` mtime, LaunchAgents |
| Discovery worker suite | 845 / 845 |
| `test:e2e-onboarding` / `test:e2e-journey` | 7 / 7 (incl. VAL-ONEFLOW-001), 33 / 33 |
| `desktop` tests + packaged smoke run from outside the repo | 47 / 47, `runtime: desktop`, ports freed |
| gitleaks over every lane range | no leaks |
| Live walkthrough (astra, Emilio driving) | B1–B5 pass live; see QA-LIVE.md for the open discovery items |

### Known and deferred

- Signing and notarization are proven only structurally, until the secrets are added (spike S2). The updater is proven end to end only once the feed repo exists (spike S6).
- Windows and Linux apps, and the relay/tunnel inside the app, are not in v1.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_012DWfF7w7RrJUkP2qSf8Vqt
