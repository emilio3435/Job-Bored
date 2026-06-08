# Spec — "Use JobBored on other devices" wizard + two-track cross-recommendation

**Date:** 2026-06-08
**Status:** Approved design, ready for swarm implementation
**Branch base:** `feat/gemini-openrouter-signposting` (or a fresh `feat/go-live-wizard` off `main`)
**Execution model:** Opus 4.8 swarm — FE lanes on `claude --model opus` + `/frontend-design`, BE lanes on `codex exec` + GPT-5.5. Orchestrator owns git + integration.

---

## 1. So what (the problem)

The dashboard's two onboarding signposts each point at a setup track:

- **"Turn on job discovery"** → launches the interactive discovery wizard. Works.
- **"Use JobBored on other devices"** → currently runs `window.open("docs/SELF-HOSTING.md")`, which downloads/opens a raw markdown file. That is the bug.

We replace the second CTA with a real interactive wizard that matches the discovery wizard's look and feel, automates what it safely can, and we wire **both** tracks so that finishing either one presents the other as the recommended next step — in either order.

## 2. Mental model — two independent tracks, no duplication

JobBored "going live" has two axes (already the framing in `README.md` §Deploy and `docs/SELF-HOSTING.md`):

| Axis | Owner | What it accomplishes |
|---|---|---|
| **A. Job discovery** | existing discovery wizard | The *worker* runs and is reachable (it already owns Tailscale/ngrok/Cloudflare **worker** transport). |
| **B. Use on other devices** | **new go-live wizard** | The *dashboard* is reachable from your phone / another laptop. |

The new wizard owns **dashboard reachability only**. It never re-implements worker transport — that stays in the discovery wizard. The cross-recommendation links the two.

## 3. The new wizard — two runtime paths

A path-select step offers two cards with honest pros/cons (mirror discovery's path cards in `discovery-wizard-ui.js`).

### Path A — Tailscale mesh (recommended; heavily automated)

Goal: open your **local** dashboard from any device on your private tailnet, over a stable HTTPS URL that never rotates.

Steps the wizard drives:
1. **Detect** Tailscale install + login state via `/__proxy/install-doctor` → `tools.tailscale`.
2. **Install** (if missing): OS-aware install link + copy-paste command, then re-probe.
3. **Log in** (if installed, logged out): show `tailscale up`; poll `/__proxy/tailscale-state` until logged in.
4. **Expose dashboard** (one click): `POST /__proxy/tailscale-serve { port: 8080 }` runs `tailscale serve --bg 8080`.
5. **Derive URL**: read `https://<machine>.<tailnet>.ts.net` from `tailscale status --json`; present "Open this on your phone (same tailnet)."
6. **Verify**: fetch-probe the URL for reachability (reuse the discovery probe-with-timeout pattern).
7. **OAuth reminder**: guide the user to add the URL to Google OAuth authorized origins (Google console can't be automated — detect + guide).

### Path B — Deploy the dashboard to the cloud (detect + pre-fill + verify)

Goal: publish the static dashboard to a host so any device with the URL can use it. Interactive cloud auth means the deploy click is the user's; the wizard automates detection, command pre-fill, and verification.

Steps:
1. **Detect** `vercel` / `netlify` / `gh` CLIs via `/__proxy/install-doctor`.
2. **Offer the path that fits**: if a CLI exists, show its exact one-command (`vercel`, `netlify deploy`) with a copy button; otherwise show the one-click Deploy buttons + GitHub Pages steps drawn from `README.md` §Deploy.
3. **Capture + verify**: user pastes their live URL; the wizard fetch-probes it and confirms it serves the dashboard.
4. **OAuth reminder**: same as Path A.

Copy is honest about what is one-click versus what the user runs. No fake "deploying…" progress.

## 4. Reuse the discovery wizard shell ("beautiful" for free)

Render the new wizard through the existing shell renderer so it inherits the stepper, focus-trap, keyboard nav, and styling.

Generalize `discovery-wizard-shell.js` minimally, defaults preserving discovery byte-for-byte:

- `renderWizardShell(input)` gains optional `mountId` (default `"discoverySetupWizardMount"`), `headerTitle` (default `"Discovery setup"`), and `variant` (`"discovery"` default | `"generic"`). `variant: "generic"` skips discovery-specific snapshot/state normalization, the discovery snapshot panel, and the `option-grid` → `wizard_choose_flow_*` action mapping.
- Replace the boolean `shell._delegatesBound` with a per-mount registry (a `Set` of bound mount elements) so a second mount also receives click delegates.
- Extract the reusable DOM body-builder helpers (`createWizardNode`, `appendWizardParagraph`, `appendWizardList`, `appendWizardCodeBlock`, `appendWizardInput`, `appendWizardResultCard`, …) into a new shared `wizard-dom.js` (`window.JobBoredWizardDom`). Leave discovery's existing inline helpers untouched (no regression surface); the new wizard consumes the shared module.

Fallback if generalization proves invasive: fork a lean `wizard-shell.js`. Prefer generalization (one renderer).

## 5. Cross-recommendation (in either order)

Persist completion per track in the IndexedDB settings store (`user-content-store.js`), following the `infraSetupComplete` trio pattern:

- `goLiveSetupComplete` — set when the go-live wizard finishes a reachable/verified path.
- `discoverySetupComplete` — **new** (discovery has no completion flag today); set when the discovery wizard closes with `reason === "finish"` and a connected result.

Surfaces:
- **Each wizard's terminal step** shows a "✓ Done" panel; when the *other* track is incomplete, it shows a prominent **"Recommended next: <other setup>"** primary CTA that launches the other wizard directly.
- **The what's-next banner** (`whats-next-banner.js`) becomes completion-aware: it checks off / drops a finished track and presents the remaining one as the recommended next step. When both tracks are complete it hides entirely. This makes "regardless of order" work.

## 6. Wire-up

Swap the four `window.open("docs/SELF-HOSTING.md")` CTAs to launch the new wizard:
- `first-run-wizard.js` → `handleFirstRunDoneOpenSelfHosting` (done-panel CTA). Mirror the discovery CTA's full dashboard handoff first, then `requestGoLiveSetup(...)`.
- `whats-next-banner.js` → `handleOpenSelfHosting` (dashboard banner CTA).

The markdown doc remains as deep reference, linked from inside the wizard (a "Full transport reference" link), not as the primary surface.

---

## 7. Interface contracts (the seams that let lanes parallelize)

Every lane codes against these. The orchestrator integrates after all lanes finish.

### 7.1 Backend — Tailscale lib (`scripts/lib/tailscale.mjs`, owned by BE-1)

```
detectTailscale({ spawnSync? }) -> {
  installed: boolean,
  version: string | null,
  loggedIn: boolean,
  dnsName: string | null,      // Self.DNSName, trailing dot trimmed, e.g. "mac.tailnet.ts.net"
  tailnet: string | null
}
deriveTailnetDashboardUrl(detect) -> string | null   // "https://<dnsName>" or null
runTailscaleServe({ port, spawnSync? }) -> {
  ok: boolean, alreadyServing: boolean, url: string | null, error: string | null
}
```
Probes: `tailscale version`; `tailscale status --json` (parse `Self.DNSName`, `CurrentTailnet`/`MagicDNSSuffix`); `tailscale serve --bg <port>`.

### 7.2 Backend — dev-server endpoints (`dev-server.mjs`, owned by BE-1)

Both guarded by `isLocalOrigin(req)` (403 otherwise) — the established contract.

```
GET  /__proxy/tailscale-state -> 200 {
  installed, loggedIn, version, dnsName,
  dashboardUrl: string | null,           // https://<dnsName>
  serving: { "8080": boolean },
  recommendation: "ready" | "needs_install" | "needs_login" | "needs_serve"
}
POST /__proxy/tailscale-serve  body { port: 8080 } -> 200 {
  ok, alreadyServing, url: string | null, error: string | null
}
```
Port allow-list: `{ 8080, 8644 }` only. Default port 8080 (dashboard).

### 7.3 Backend — install-doctor detections (`scripts/install-doctor.mjs`, owned by BE-2)

Extend `runInstallDoctor()` `tools` with:
```
tailscale: { installed, loggedIn, version, dnsName }   // via detectTailscale (BE-1 lib)
vercel:    { installed, loggedIn, version }            // `vercel --version`, `vercel whoami` exit 0
netlify:   { installed, loggedIn, version }            // `netlify --version`, `netlify status` exit 0
gh:        { installed, loggedIn, version }            // `gh --version`, `gh auth status` exit 0
```
Append human-readable next steps to `missing` when a tool is absent.

### 7.4 Frontend — generalized shell (`discovery-wizard-shell.js` + `wizard-dom.js`, owned by FE-1)

```
renderWizardShell({
  mountId = "discoverySetupWizardMount",
  headerTitle = "Discovery setup",
  variant = "discovery" | "generic",
  title, lede, steps, snapshot, state, activeStepId,
  onAction, onNavigate, onStateChange, onClose, onRender, open, focus
}) -> lastRender
```
`window.JobBoredWizardDom` exposes the body-builder helpers listed in §4.
`index.html` gains: `<div class="discovery-setup-wizard-root" id="goLiveSetupWizardMount" hidden aria-hidden="true"></div>`, a `<script src="go-live-wizard-ui.js"></script>` include after the discovery wizard scripts, and any banner completion-badge markup FE-3 needs.

### 7.5 Frontend — go-live wizard module (`go-live-wizard-ui.js`, owned by FE-2)

```
window.JobBoredGoLive = {
  openGoLiveSetupWizard(options) -> Promise<void>,   // renders via shell variant:"generic", mountId:"goLiveSetupWizardMount"
  requestGoLiveSetup(options) -> Promise<{ deferred: boolean }>  // defer-if-onboarding gate, mirror requestDiscoverySetup
}
```
Host bridge: register `openGoLiveSetupWizard` + `requestGoLiveSetup` on the host (`bridge-registry.js`, `app.js`, `app-compat.js`). On finish, call `UC.completeGoLiveSetup()` and recommend discovery when `!await UC.isDiscoverySetupComplete()`.

### 7.6 Frontend — persistence + cross-rec (`user-content-store.js` + consumers, owned by FE-3)

```
isGoLiveSetupComplete() / completeGoLiveSetup() / resetGoLiveSetupCompletion()
isDiscoverySetupComplete() / completeDiscoverySetup() / resetDiscoverySetupCompletion()
```
Exported on `window.CommandCenterUserContent`. `discovery-wizard-ui.js` onClose sets `completeDiscoverySetup()` on finish-with-connected and recommends go-live. `whats-next-banner.js` reads both flags for completion-aware gating. `first-run-wizard.js` + `whats-next-banner.js` swap the self-hosting CTA to `requestGoLiveSetup`.

---

## 8. Lane decomposition + tool assignment

| Lane | Tool | Owns (edit ONLY these) | Mission |
|---|---|---|---|
| **BE-1** | `codex` + GPT-5.5 | `scripts/lib/tailscale.mjs` (new), `dev-server.mjs`, their tests | Tailscale lib + `/__proxy/tailscale-state` + `/__proxy/tailscale-serve` (§7.1, §7.2) |
| **BE-2** | `codex` + GPT-5.5 | `scripts/install-doctor.mjs`, its tests | tailscale/vercel/netlify/gh detection (§7.3) |
| **FE-1** | Opus 4.8 + `/frontend-design` | `discovery-wizard-shell.js`, `wizard-dom.js` (new), `index.html`, `css/legacy-discovery-setup-wizard.css`, shell tests | Generalize shell, shared DOM helpers, new mount + script include (§7.4) |
| **FE-2** | Opus 4.8 + `/frontend-design` | `go-live-wizard-ui.js` (new), `app.js`, `app-compat.js`, `bridge-registry.js`, go-live wizard tests | The new two-path wizard + host bridge (§7.5) |
| **FE-3** | Opus 4.8 + `/frontend-design` | `user-content-store.js`, `first-run-wizard.js`, `whats-next-banner.js`, `discovery-wizard-ui.js`, `tests/whats-next-signpost.test.mjs` + new cross-rec tests | Completion flags, cross-rec surfaces, CTA swaps (§7.6) |

**Dependency graph (code-to-contract, integrate after all DONE):**
- FE-2 → FE-1 (shell `variant:"generic"` + `mountId` + `wizard-dom.js` + mount + script tag), FE-3 (UC flags), BE-1 (tailscale endpoints), BE-2 (install-doctor shapes).
- FE-3 → FE-2 (`requestGoLiveSetup` host method).
- BE-2 → BE-1 (`detectTailscale` export) — may inline a minimal `tailscale version`/`status` probe to stay independent if the lib is not yet present at test time.

No two lanes edit the same file (verified against §8 ownership). `index.html` is FE-1 only; FE-3's banner needs are markup hooks FE-1 adds per §7.4.

## 9. Verification gates (orchestrator runs after integration)

- `npm run typecheck:repo` → exit 0.
- `node --check` on every new/changed `.js`/`.mjs`.
- Focused FE tests green: `node --test tests/whats-next-signpost.test.mjs tests/first-run-wizard*.test.mjs tests/go-live-wizard*.test.mjs` + shell regression test.
- Focused BE tests green: `node --test tests/dev-server-*.test.mjs` + install-doctor + tailscale-lib tests.
- Full suite: `node --test tests/*.test.mjs` all pass.
- `git diff --check` clean.
- **Discovery-unchanged regression lock** (FE-1): a test asserting `renderWizardShell` with no `mountId`/`variant` behaves identically to today (mount id, header title, normalization).

## 10. Testing approach (each lane writes its own)

Mirror the repo's vm-context unit tests (see `tests/whats-next-signpost.test.mjs`). Tests encode WHY: e.g. "tailscale path auto-fills the derived URL", "banner drops a track once its flag is set", "discovery onClose sets discoverySetupComplete only on finish-with-connected", "shell variant generic skips discovery normalization", "self-hosting CTA launches the go-live wizard, never `window.open`". Update any test that locks the old `window.open` behavior to assert the new wizard launch.

## 11. Out of scope

- Headless cloud deploy (cloud auth is interactive).
- Editing Google OAuth origins programmatically.
- Changing discovery's worker-transport steps.
- Automating `tailscale up` login (interactive; the wizard polls state).
