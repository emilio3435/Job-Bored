# PLAN: Extract Discovery Setup-Wizard UI from app.js (Pilot Extraction)

> **Status: PLAN ONLY — not yet implemented.** Authored 2026-05-30 as the pilot
> for the larger `app.js` (24,353-line) teardown identified in the pre-refactor
> audit. This document is the contract; do the work in small verifiable steps.

## A. Scope

`app.js` is one top-level classic script (24,353 lines). Discovery code is NOT one
block — it is interleaved with non-discovery infra across ~1,400+ lines. A
whole-surface extraction is unsafe. The pilot takes the **largest contiguous,
lowest-coupling, lowest-test-exposure sub-block**: the **wizard rendering +
step-flow UI layer**.

**Recommended extraction set** — near-contiguous span `app.js:2653–5782` (~2,300 LOC):

| Function group | Lines | ~LOC |
|---|---|---|
| `createWizardNode` … `appendWizard*`, `classifyDiscoverySuggestedUrl`, `buildDiscoveryWizardMessageCard`, assist-mode helpers | 2653–3248 | ~595 |
| `buildDiscoveryBootstrapAgentPrompt` … `buildDiscoveryWizardOptionCard` (prompt + step-id + label helpers) | 3249–3491 | ~242 |
| `buildDiscoveryPathSelectBody` … `buildDiscoveryReadyBody` (step `*Body` builders + `probeAndShowWizardTunnelBanner` + `buildDiagnosisChainItem`) | 3517–4356 | ~840 |
| `buildDiscoveryWizardSteps` | 4357–4628 | ~271 |
| `renderDiscoverySetupWizard`, `openDiscoverySetupWizard`, `getDiscoveryWizardCurrentStepContext`, `moveDiscoveryWizardToStep`, `setDiscoveryWizardMessage`, `handleDiscoveryWizardFlowSelection` | 4629–5085 | ~456 |
| `handleDiscoveryWizardVerification`, `handleDiscoveryWizardAction` | 5086–5782 | ~696 |

**Islands inside the span that MUST stay in app.js** (expose via bridge instead of moving):
- `diagnoseDownstreamChain` (app.js:3119–3188, ~70 LOC) — verify/diagnostics, also called by the drawer.
- `setAppsScriptDeployStatus` / `clearAppsScriptDeployStatus` (~app.js:4049, ~35 LOC) — shared with relay modals that stay.

**What STAYS in app.js (and why):**
- All `getDiscovery*`/`normalizeDiscovery*`/`writeDiscovery*` transport+state helpers (app.js:451–1160) — read config/OAuth/localStorage; called by `triggerDiscoveryRun`, settings, drawer. Heavy source-text test exposure.
- `triggerDiscoveryRun`, `resolveDiscoveryRunWebhookUrl`, `pollRunStatus`, run tracker (app.js:357, 5922–6320, 10038–10369) — run engine, asserted as source text by `discovery-run-status-polling.test.mjs`, `discovery-drawer-payload.test.mjs`.
- Drawer UI (app.js:21513–23500: `initDiscoveryDrawer`, `openDiscoveryDrawer`, subtabs, AI suggestions) — asserted by `discovery-drawer-payload.test.mjs`; separate concern, defer.
- Relay/tunnel **modal** functions (app.js:10438–11000) and `initDiscoverySetupGuide` — bind to settings-modal DOM; defer.
- Module-level state `discoveryWizardRuntime` (let, app.js:896) and its accessors `createDiscoveryWizardRuntime`/`getDiscoveryWizardRuntime`/`updateDiscoveryWizardRuntime` (app.js:2583–2652) — stay; the extracted file uses them via the bridge.

## B. Target Design

**New file: `discovery-wizard-ui.js`** (root, matches `discovery-wizard-*.js` convention).
Loaded in index.html right after `discovery-wizard-verify.js` and **before `app.js`**.

**Module style: classic-global IIFE attaching to `window.JobBoredDiscoveryWizard.ui` — NOT ESM.**
There are 0 ES modules today; every `discovery-wizard-*.js` is a classic IIFE attaching a
sub-namespace under `window.JobBoredDiscoveryWizard` (`.shell`, `.probes`, `.local`, `.relay`,
`.verify` — see app.js:1770–1814). Converting one file to `type="module"` defers execution
past all classic scripts, breaking the load-order contract and the
`ensureDiscoveryWizardLocalApiLoaded` self-loader (app.js:7–31). Match the pattern exactly:
`root.ui = root.ui || {}`.

**The bridge (lowest-risk, two-way).** app.js loads AFTER this file, so the UI file cannot
capture app.js references at load time. Use late binding (same pattern app.js uses to consume
`shell`/`probes`/`verify`):

1. **app.js → UI:** public entry points reachable via namespace. The 4 call sites in app.js
   (`openDiscoverySetupWizard` at 5854; `handleDiscoveryWizardAction` at 3082, 3928, 4644)
   call `window.JobBoredDiscoveryWizard.ui.openSetupWizard(...)` / `.handleAction(...)`. Keep
   thin app.js wrappers (`function openDiscoverySetupWizard(o){return JBDW.ui.openSetupWizard(o);}`)
   so existing internal callers and `discovery-autodetect.js`'s contract reference stay valid.
2. **UI → app.js (~25 infra deps):** app.js publishes ONE bridge object near its existing
   `window.JobBoredDiscovery` export (app.js:10353):
   `window.JobBoredDiscoveryWizard.ui.host = { showToast, refreshDiscoveryReadinessSnapshot,
   getDiscoveryWizardRuntime, updateDiscoveryWizardRuntime, createDiscoveryWizardRuntime,
   clearDiscoveryWizardRuntime, persistDiscoveryWizardState, triggerDiscoveryRun,
   isOnboardingWizardVisible, hideOnboardingWizard, showOnboardingWizard, isSettingsModalOpen,
   closeCommandCenterSettingsModal, openCommandCenterSettingsModal, installKeepAliveOnce,
   handleAppsScriptBrowserCorsFailure, diagnoseDownstreamChain, copyTextToClipboard,
   getSettingsSheetIdValue, isLocalDashboardOrigin, normalizeDiscoveryWebhookIdentity,
   mapDiscoveryWizardFlow, getDiscoveryWizardStepIds, getDiscoveryWizardStepsBefore,
   getDiscoveryWizardDefaultDrafts, getDiscoveryReadinessSnapshot, escapeHtml, ... }`.
   The UI file reads `const host = window.JobBoredDiscoveryWizard.ui.host` **lazily inside each
   function** (NOT at IIFE top) so it resolves after app.js runs.

This bridge is the single, explicit, greppable seam. No custom events (the wizard is
synchronous user-driven UI; events add race risk for no benefit).

## C. Dependency Seams

**Inbound deps (UI → app.js helpers, all confirmed defined):** `showToast` (18 calls in block),
`escapeHtml`, `copyTextToClipboard` (6), `isLocalDashboardOrigin` (15), `getSettingsSheetIdValue` (5),
`diagnoseDownstreamChain` (4), `refreshDiscoveryReadinessSnapshot`, `get/update/create/clearDiscoveryWizardRuntime`,
`persistDiscoveryWizardState`, `triggerDiscoveryRun`, `mapDiscoveryWizardFlow`,
`getDiscoveryWizardStepIds/StepsBefore/DefaultDrafts`, `normalizeDiscoveryWebhookIdentity`,
onboarding trio, settings-modal trio, `installKeepAliveOnce`, `handleAppsScriptBrowserCorsFailure`,
namespace getters `getDiscoveryWizardShell/Probes/Local/Relay/VerifyApi`. Each passed via `ui.host`.

**Call sites in app.js to rewire (4):** app.js:3082, 3928, 4644 (`handleDiscoveryWizardAction`),
app.js:5854 (`openDiscoverySetupWizard` inside `requestDiscoverySetup`). Thin local wrappers keep
ripple to zero.

**Shared mutable state — the hard part:** `discoveryWizardRuntime` (let, app.js:896) is
read/written *directly* at app.js:1104, 4673, 4678, 4785. **Resolution:** route ALL mutation
through accessors `getDiscoveryWizardRuntime`/`updateDiscoveryWizardRuntime` (exist: 2623/2630)
plus a new `clearDiscoveryWizardRuntime()`; keep the `let` + accessors in app.js; the extracted
UI never touches the closure var directly. **This is the one change that makes the cut clean —
do it BEFORE any move (step 2).**

**Flagged:** `persistDiscoveryWizardState` (app.js:3492) calls `getDiscoveryWizardProbesApi().setDiscoverySetupWizardState`
— move it into the new file (needs only `probes` via host). `diagnoseDownstreamChain` (3119) is
also called by verify-body — leave in app.js, expose via host (diagnostics, not pure UI).

## D. Step-by-Step Extraction Sequence

Each step verified by `npm test` (node --test over `tests/*.test.mjs`).

1. **Pre-flight (no code):** run `npm test`, record baseline pass count. Note `discovery-cold-start-handoffs.test.mjs` asserts the text `async function openDiscoverySetupWizard` in app.js — the ONE extracted symbol with source-text coverage.
2. **Introduce the bridge, no move:** in app.js near 10353 add `window.JobBoredDiscoveryWizard.ui = {...}; .ui.host = {…}`. Add `clearDiscoveryWizardRuntime()`; replace direct `discoveryWizardRuntime` writes (4678, 4785) and reads (4673) with accessors. `npm test` — green (pure refactor).
3. **Create `discovery-wizard-ui.js`** as empty IIFE attaching `root.ui`. Add `<script src="discovery-wizard-ui.js"></script>` at index.html after verify, before app.js. `npm test` — green.
4. **Move pure leaf helpers** (`createWizardNode`, `appendWizard*`, `classifyDiscoverySuggestedUrl`, assist helpers, prompt builders, label helpers) into the file as functions closed over `host`. No source-text tests on these. `npm test`.
5. **Move step `*Body` builders + `buildDiscoveryWizardSteps`.** `npm test`.
6. **Move `renderDiscoverySetupWizard`, `moveDiscoveryWizardToStep`, `setDiscoveryWizardMessage`, `handleDiscoveryWizardFlowSelection`, `handleDiscoveryWizardVerification`, `handleDiscoveryWizardAction`.** Expose `ui.handleAction`; rewire app.js:3082/3928/4644 (or keep wrapper). `npm test`.
7. **Move `openDiscoverySetupWizard`** last. Expose `ui.openSetupWizard`. Keep app.js wrapper `async function openDiscoverySetupWizard(o){return window.JobBoredDiscoveryWizard.ui.openSetupWizard(o);}` so `discovery-cold-start-handoffs.test.mjs` still matches. `npm test`.
8. **index.html cache-bust:** bump `app.js?v=N` → `N+1`.
9. **Final full `npm test` + manual smoke** (E).

## E. Test & Rollback Strategy

**Tests that prove behavior unchanged:**
- `discovery-cold-start-handoffs.test.mjs` — asserts `async function openDiscoverySetupWizard` text; the wrapper preserves it. PRIMARY guard for the entry point.
- `discovery-run-status-polling.test.mjs`, `discovery-drawer-payload.test.mjs`, `ingest-url-endpoint-resolution.test.mjs`, `relay-bootstrap-persist.test.mjs`, `discovery-payload-sanitization.test.mjs` — assert on functions that STAY. Should be untouched; if any goes red, the cut took too much — narrow it.
- `discovery-wizard-verify.test.mjs`, `discovery-wizard-local-auto-setup.test.mjs` — confirm sibling namespace intact.
- **New** `discovery-wizard-ui.test.mjs` (optional): `readFileSync("discovery-wizard-ui.js")`, assert moved builders present + `root.ui` attach.

**Manual checks:** serve locally (`start.sh`), open the discovery setup wizard from Settings, walk detect→path→bootstrap→local_health→tunnel→relay→verify→ready, run "Test connection", confirm toasts, confirm onboarding re-shows on close, confirm autodetect silent-recover still fires.

**Rollback:** each step is one commit → `git revert` that commit; the index.html script tag + `?v` bump revert with it. app.js wrappers preserve every external symbol name, so no consumer (`discovery-autodetect.js`, `settings-discovery-adapters.js`, tests) needs coordinated rollback.

## F. Risks & Gotchas

1. **Load-order / late binding (#1 risk):** `discovery-wizard-ui.js` runs before app.js, so `host` is undefined at IIFE top. MUST read `host` lazily inside functions — exactly why the existing `discovery-wizard-*.js` files read `window.*` at call time.
2. **`discoveryWizardRuntime` closure var** is the one true shared-state hazard. Any extracted function holding a direct reference to the app.js `let` silently breaks (separate scopes). Step 2 eliminates this before any move — do NOT skip it.
3. **Structure-string tests** (49/85 read app.js source) are the documented codebase hazard. For THIS cut only `openDiscoverySetupWizard`'s text is asserted; the wrapper neutralizes it. Do NOT extract `triggerDiscoveryRun`, the run-status resolver, drawer, or transport helpers — dense source-text assertions will break.
4. **`?v` cache:** stale cached app.js after deploy calls moved functions that no longer exist locally. Bump `?v` AND add the new tag in the same change.
5. **`document.currentScript` self-loader** (app.js:7–31) only guards `discovery-wizard-local.js`. No new self-loader needed (index.html lists the new file), but keep it ordered before app.js.
6. **Prior extraction pain:** the existing 9 files succeeded because they are leaf/pure with namespace-only coupling. This UI cut is riskier (two-way coupled) — the `ui.host` bridge brings it down to their risk level.

## G. Effort Estimate & Recommendation

**Right first cut?** Yes, with a refinement: split into two PRs.
- **Phase 1a** — pure presentation helpers `createWizardNode` + `appendWizard*` + step `*Body` builders + `buildDiscoveryWizardSteps` (app.js:2653–4628, ~1,400 LOC). ZERO source-text coverage, inbound deps only. Safest possible pilot. **~4–6 hours, low complexity.**
- **Phase 1b** — `render/open/handle*` + 4 rewired call sites + the runtime-accessor refactor (the only fiddly part). **~3–4 hours, medium complexity.**

**Total ~8–10 hours** incl. manual QA. **Net app.js reduction: ~2,300 lines (→ ~22,000).** Proves the
`ui.host` bridge + `type`-stays-classic pattern that every later app.js extraction will reuse.

### Critical Files
- `app.js` — source of the cut; bridge publish near :10353; runtime accessors :2583–2652, :896; call sites :3082/3928/4644/5854
- `discovery-wizard-ui.js` — NEW target (classic IIFE under `window.JobBoredDiscoveryWizard.ui`)
- `index.html` — script tag after `discovery-wizard-verify.js`, `?v` bump on app.js
- `discovery-wizard-shell.js` — the pattern to match (namespace attach, exports)
- `tests/discovery-cold-start-handoffs.test.mjs` — the one source-text test guarding the entry point
