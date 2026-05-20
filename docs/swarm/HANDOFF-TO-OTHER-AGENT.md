# Handoff to the other agent working on this repo

> Written by the previous agent (this session). Read before editing anything.
> Last commit on `feat/greenfield-automation-swarm`: `2b85219`.

## TL;DR

I just landed a 4-worker parallel swarm that adds **free-tier-only**
automation to greenfield setup. Branch: `feat/greenfield-automation-swarm`.
**303 / 303 tests pass.** Typecheck clean. Contract tests green.

If you're editing `app.js`, `dev-server.mjs`, `setup-doctor.js`,
`scripts/`, `tests/`, or `integrations/cloudflare-relay-template/`, **read
this whole file first**.

## Branch state

```
2b85219 merge(swarm): Frontend Worker — UI surfacing + auto-wire (Opus 4.7)
fb4617b feat(swarm/worker-fe): Phase 2 — UI surfacing + auto-wire (Opus 4.7)
9ce9729 fix(swarm): align QA gcloud shim with Worker A 'iam oauth-clients' path
4696deb merge(swarm): QA Worker — mocks + integration test + docs
0760728 merge(swarm): Worker B — Cloudflare relay template + keep-alive daemon
9046a61 merge(swarm): Worker A — OAuth bootstrap + install-doctor
fcbcbf2 feat: radical simplification — 3-panel onboarding, single-button SetupDoctor, silent full-boot
86c1daf chore(swarm): lock greenfield-automation interfaces (Phase 0)
```

The working tree may be dirty with unrelated pre-existing modifications
(`README.md`, `app.js`, `index.html`, `style.css`, etc.) that were already
on the branch when I arrived. I did not commit those.

## What was added (locked, do not break)

### 1. Five new HTTP endpoints in `dev-server.mjs`

All localhost-only via `isLocalOrigin(req)`. All response shapes are
documented in the comment block above `handleOAuthBootstrap` in
`dev-server.mjs` — read it before changing any of them.

| Method | Path | Purpose |
|---|---|---|
| POST | `/__proxy/oauth-bootstrap` | Auto-create Google OAuth Client ID via `gcloud iam oauth-clients create` |
| POST | `/__proxy/install-doctor` | Detect gcloud / wrangler / ngrok / node — installed + logged-in |
| POST | `/__proxy/install-keep-alive` | Install per-user launchd (macOS) or systemd-user (Linux) keep-alive job |
| DELETE | `/__proxy/install-keep-alive` | Idempotent uninstall |
| GET | `/__proxy/install-keep-alive/status` | Job status + last ngrok URL |

Plus two endpoints I added earlier in the session that are still live:

| Method | Path | Purpose |
|---|---|---|
| POST | `/__proxy/full-boot` | One-click greenfield boot: kill stale → start worker → fix-setup |
| POST | `/__proxy/kill-stale` | Kill stale processes on ports 8644 and 4040 |

### 2. New CLI scripts (each runnable standalone AND importable)

- `scripts/oauth-bootstrap.mjs` — wraps `gcloud iam oauth-clients create`
- `scripts/install-doctor.mjs` — tool detection
- `scripts/install-keep-alive.mjs` — installs launchd plist or systemd-user `.service` + `.timer`
- `scripts/uninstall-keep-alive.mjs` — idempotent uninstall
- `scripts/discovery-keep-alive.mjs` — extended with structured JSON logging
  to `~/.jobbored/logs/keep-alive.log` and state to
  `~/.jobbored/keep-alive-state.json`. **Job label is
  `ai.jobbored.discovery.keepalive` — do not rename.**

### 3. Cloudflare Worker relay template

`integrations/cloudflare-relay-template/`
- `wrangler.toml` — must deploy with **zero hand-edits**;
  `DISCOVERY_TARGET` comes via `--var` at deploy time
- `src/worker.js` — proxies `POST /discovery`, `GET /runs/:runId`, `GET /health`
- `manifest.json`, `README.md`, `.gitignore`

### 4. Frontend additions (do not duplicate)

In `app.js`:
- `installDoctor()` — POSTs to `/__proxy/install-doctor`, caches into
  `window.installDoctorState`, dispatches `CustomEvent("jobbored:install-doctor:update", { detail })`
- `installKeepAliveOnce()` — silent, idempotent via localStorage key
  `jb:install-keep-alive:installedAt`. Wired into the `/__proxy/full-boot`
  success path.
- `refreshKeepAlivePill()` + `#setupHealthBtn` user-menu handler
- `maybeRevealOAuthGcloudButton()` — probes install-doctor, gracefully hides
  the gcloud button on 501 / not-ready

In `setup-doctor.js`:
- 3 new findings registered (all `autoFixable`, all silently no-op on 501):
  - `gcloud_can_create_oauth`
  - `keep_alive_not_installed`
  - `keep_alive_stale`

In `index.html`:
- `#sheetAccessGateOAuthGcloudBtn` — inside the existing OAuth wizard
  disclosure, hidden by default
- `#setupHealthBtn` user-menu entry containing `#keepAlivePill`

In `style.css`:
- `.doctor-gcloud-btn`
- `.doctor-keep-alive-pill[--on/--off]`
- All using existing `:root` tokens (no ad-hoc hex)

### 5. Test infrastructure

- `tests/oauth-bootstrap.test.mjs`, `tests/install-doctor.test.mjs`,
  `tests/keep-alive.test.mjs`, `tests/relay-template.test.mjs`,
  `tests/install-doctor-frontend.test.mjs`, `tests/setup-doctor.test.mjs`
  (extended with 3 new findings)
- `tests/integration/greenfield-automation.test.mjs` — drives all 4 flows
- `tests/mocks/{gcloud,wrangler,ngrok-api}.mjs` — reusable factories

### 6. Docs

- `docs/swarm/AUTOMATION-SWARM-PLAN.md`
- `docs/swarm/PROMPT-worker-{a,b,fe,qa}.md`
- `docs/AUTOMATION-GREENFIELD-PLAN.md`
- `README.md` has an appended `## One-line setup` section
- `docs/QA-DISCOVERY-GREENFIELD-CHECKLIST.md` has 4 new appended items

## Earlier in this session (also live on the branch)

Before the swarm, I shipped a separate radical-simplification pass in commit
`fcbcbf2`:

- Onboarding wizard collapsed from 9 panels → 3 (resume / AI context / tone)
- SetupDoctor inline view rewritten as a **single** "Something's off — fix
  it" button (no walls of text, no bulleted issue lists). The new pattern
  is: button cycles `Working on it… → Fixing: X → Done → reload`.
- OAuth Client ID input: 12-step wall of text → single field that
  auto-saves on paste, with a "Create one for me with gcloud" button
  inside an expandable "I don't have a Client ID yet" disclosure
- Setup screen: 3 cards → 1 button "Create my Pipeline sheet"
- Discover Jobs button on greenfield localhost → silent
  `POST /__proxy/full-boot` instead of opening the wizard

## Hard rules — please honor these

1. **Don't widen the locked endpoint contracts.** They're documented in the
   header above `handleOAuthBootstrap` in `dev-server.mjs`. If you need a
   change, propose it; don't quietly broaden a field.
2. **All new endpoints stay localhost-only** via `isLocalOrigin(req)`.
3. **No new runtime deps in root `package.json`** for the dashboard. CLI
   scripts may shell out to `gcloud`, `wrangler`, `ngrok`, `launchctl`,
   `systemctl`. That's it.
4. **BYO security model is sacred.** No credential — OAuth, Cloudflare,
   ngrok — ever leaves the user's machine or hits a maintainer-controlled
   host. The maintainer pays $0.
5. **501 graceful-degrade pattern is locked.** Every new frontend
   affordance silently hides when its endpoint returns 501. Don't surface
   error toasts for 501s.
6. **The SetupDoctor "single big button" UX is locked.** Don't reintroduce
   bulleted issue lists or per-issue Fix-it buttons.
7. **Discovery webhook contract `schemaVersion: 1` and Pipeline schema
   are unchanged.** Don't touch them as a side effect.
8. **Keep-alive job label `ai.jobbored.discovery.keepalive`** is referenced
   by install/uninstall/status. Don't rename.

## What was *not* done (open invitations)

- The dirty working-tree files (`README.md`, `app.js`, `index.html`,
  `style.css`, `docs/QA-DISCOVERY-GREENFIELD-CHECKLIST.md`,
  `integrations/browser-use-discovery/.env`) had pre-existing
  modifications I never committed. They came in with the branch. If
  you're the agent that owns those, by all means commit them.
- Untracked: `.claude/`, `AGENTS.md`, `assets/`, `docs/redesign/`,
  `integrations/browser-use-discovery/worker.log`,
  `scripts/generate-mascot-header-images.mjs`,
  `scripts/redesign-spawn-workers.sh`, `uploads/`. None of these were
  touched by the swarm.
- The branch hasn't been pushed or PR'd. The user was about to choose
  squash-merge to `main` vs. open a PR vs. additional polish.

## Test commands you'll want

```sh
npm run typecheck:repo     # node --check across all browser/server scripts
npm test                   # 303 tests, currently 100% green
npm run test:contract:all  # discovery webhook + ATS + Pipeline + skill links
```

If you break any of these, please don't commit until you've fixed them. The
swarm verified all three were green before handoff.

## If you want to read more

- `docs/swarm/AUTOMATION-SWARM-PLAN.md` — full execution plan
- `docs/swarm/PROMPT-worker-*.md` — exact prompts each worker received
- The four merge commits on the branch — diffs are clean and per-worker
- `dev-server.mjs` — header comment block above `handleOAuthBootstrap`
  documents every new endpoint contract

Good luck. Ping the user if anything in here looks stale.
