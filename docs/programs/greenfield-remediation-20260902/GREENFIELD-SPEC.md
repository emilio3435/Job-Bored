# GREENFIELD — Phase 1 P0 fixes + Settings unification (2026-09-02)

Source: `ROADMAP.md` in this directory (orchestrator-authored, line-cited against `main @ b5bc7fe`). This spec overrides the roadmap wherever they disagree. Section 5 holds Emilio's locked decisions; they override anything contrary earlier in this document.

Goal: a stranger who clones the repo and runs `npm start` cannot reach a dead AI call, cannot lose a pasted resume, is never punted out of the setup flow into Settings, cannot fire discovery from a payoff that is not ready, always lands in the six-beat flow from the discovery drawer, and finds Settings showing what setup already collected instead of asking again.

Success means:
- Every lane's claims went red first on the integration base and are green on the lane branch.
- Full floor green on `feat/greenfield-integration`: `npm test`, `npm run lint:repo`, `npm run typecheck:repo`, `npm run test:e2e-smoke`, `npm run test:e2e-visual`, plus the new `npm run test:e2e-onboarding` from lane E.
- A greenfield re-walk (lane E's spec run by the orchestrator on the integration branch) records zero failures across E1–E6.

Stop when: the integration branch is green on the full floor, pushed, and swept.

## 1. Findings → root cause (verified in source) → lane

| # | Finding | Root cause (verified) | Lane |
|---|---|---|---|
| F1 | Beat 3 "Missing Gemini API key" with OpenRouter/Local chosen | Server is provider-agnostic since `1feb7c7`. `verifiedProviderConfig()` (`oneflow-beat-resume.js:186-204`) reads `getResumeGenerationConfig()`, which defaults `provider` to `"gemini"` when Beat 2 never persisted (`resume-generate.js:156-164`; Beat 2 persists only in `checkAndContinue`, `oneflow-beat-ai.js:516-524`). `open()`/`goToBeat()` have no ordering gate (`onboarding-flow.js:614-661`), so Beat 3 is reachable with Beat 2 unverified. | **A · beat3-provider** |
| F2 | Resume text lost on Escape + reload | Persistence exists since `d1a35d6`. Saves fire only on `input` (`oneflow-beat-resume.js:364-367`); `flushDrafts()` in `handleShellClose` is fire-and-forget (`onboarding-flow.js:778`); no `pagehide` flush; no Beat 3 reload test (only `SB2-FIT-RELOAD`, `tests/oneflow-sb2-draft-persistence.test.mjs:259`). | **B · beat3-drafts** |
| F3 | Drawer "Open discovery setup" opens the legacy 3-step wizard | `discovery-setup-modals.js:140-149` calls `requestDiscoverySetup({entryPoint:"settings", allowWhileOnboarding:true})` → `openDiscoverySetupWizard` (`discovery-status-handoff.js:490`). | **C · edges** |
| F4 | Beat 1 with no Client ID punts into the Settings modal | `sheet-access-setup.js:636-645` opens `openCommandCenterSettingsModal` when `getOAuthClientId()` is empty, regardless of `options.context`. | **C · edges** |
| F5 | Beat 6 fires "Run discovery now" with no Sheet and no roles; two error toasts | `oneflow-beat-payoff.js` renders "Discovery armed" and an active primary regardless of `sheetId` / roles (`:549` warns but does not gate; `:566-590`). | **C · edges** |
| F6 | Settings re-asks for Sheet ID, Client ID, provider, keys, webhook URL/secret | Two writers into `command_center_config_overrides` plus a raw-localStorage bypass (`settings-profile-tab.js:797-810`); Settings duplicates drawer-owned webhook fields (`settings-modal.js:448-449, :811-816`); stale model defaults (`:829, :837` vs `oneflow-beat-ai.js:132, :144`); no effective-config resolver (`app-config-core.js:51-61` nulls on bad sheetId). | **D · settings** |
| F7 | No automated greenfield gate; walkthrough evidence unreliable | Nothing in CI walks the six beats. Branch `test/greenfield-onboarding-e2e` (`9b93cdb`) holds a 512-line Playwright journey, unmerged. | **E · verify** |

Closed without code: the Beat 6 celebration modal (`b231c0d`, ancestor of main). The orchestrator amends `docs/qa/GEMINI-GREENFIELD-WALKTHROUGH-PROMPT.md` so verdicts must cite their own media.

## 2. Lanes, fences, and the shared substrate

Two files are shared: `onboarding-flow.js` (the controller) and `oneflow-beat-resume.js` (Beat 3). They are split by **function**, not by line range; a lane edits only the functions its fence names and may add new functions adjacent to them. Lane A lands the controller seam (§4.1) in its **first** commit; lanes C and D code against that signature and tolerate its absence.

| Lane | Model / vehicle | Fence (owns) | Consumes |
|---|---|---|---|
| **A · beat3-provider** | Opus 5 high via `claude` | `onboarding-flow.js`: `open`, `resolveEntryBeatId`, `goToBeat`, `completeBeat`, new `gateBeat`, new `returnTo` handling; `oneflow-beat-resume.js`: `verifiedProviderConfig`, `draftOnServer`, the message-slot render it calls; `fit-profile-wizard.js:160-180`; new `tests/greenfield-a-*.test.mjs` | nothing |
| **B · beat3-drafts** | Opus 5 high via `claude` | `onboarding-flow.js`: `saveDraft`, `flushDrafts`, `handleShellClose`, the `root` export block, new `pagehide` wiring; `oneflow-beat-resume.js`: `hydrateFromDrafts`, the paste textarea block in its render helper, new mirror helpers; `user-content-store.js`: `clearOnboardingFlowState` only; new `tests/greenfield-b-*.test.mjs`; one Playwright spec under `tests/e2e-visual/` | nothing |
| **C · edges** | Opus 5 high via `claude` | `discovery-setup-modals.js:130-160`; `sheet-access-setup.js:620-660` (`handleSetupCreateStarterSheet` no-client branch); `oneflow-beat-google.js`: `continueWithGoogle`, `renderDetour`; `oneflow-beat-payoff.js`: `resolvePayoffState`, `render`, action handlers; `tests/oneflow-l7-sweep.test.mjs:585-605`; new `tests/greenfield-c-*.test.mjs` | A's `open(beatId, {returnTo})` |
| **D · settings** | Opus 5 high via `claude` | `app-config-core.js` (add `getEffectiveConfig` beside `getConfig`); `settings-profile-tab.js:780-820` and `:460-480`; `settings-tab-schema.js`; `settings-modal.js`; `partials/settings-modal.html`; `oneflow-beat-ai.js:125-150` (model defaults only) and `:490-500` (`liveConfig`); `model-catalog.js` (defaults export only); existing settings tests; new `tests/greenfield-d-*.test.mjs` | A's `open(beatId, {returnTo})` |
| **E · verify** | GPT 5.6 Sol xhigh via `codex` | `tests/e2e-onboarding/**` (cherry-picked from `9b93cdb` at worktree creation), the `test:e2e-onboarding` line in `package.json`, `docs/programs/greenfield-remediation-20260902/evidence/**` | all locked seams in §4; runs red against the integration base |

Dependency edges: A →(seam 4.1)→ C, D. B is independent. E consumes §4 by contract only.

## 3. Review defects pre-empted

1. **`onboarding-flow.js` is touched by A and B.** Function-level fences; neither lane reformats the file; the `root` export block belongs to B, and A does not need to export anything new (`open` is already exported).
2. **`oneflow-beat-resume.js` is touched by A and B.** A owns the provider/draft-call path; B owns the paste/hydrate path. The mirror is cleared only via `clearOnboardingFlowState` (§4.2), so B never edits A's draft-landed path.
3. **Deep links that advance into the rest of the flow.** Settings "Change" and the drawer button would otherwise walk the user forward through every later beat. `returnTo: "close"` (§4.1) closes the shell when the opened beat completes.
4. **Gate vs. deep links.** The gate must not break `open("discovery")` or `open("ai")` from Settings; only `resume` and `payoff` carry prerequisites (§4.1).
5. **Settings tab ids are load-bearing in tests.** D keeps every field DOM id stable; only tab grouping and panel headers change. Scraping and ATS Scoring tabs stay this program (locked decision 6).
6. **Codex sandbox cannot bind loopback.** Lane E's Playwright run may be refused inside the sandbox; the spec is still written red-first, and the orchestrator runs it. E records the refusal verbatim in report §5.

## 4. Locked seams (code to these exactly)

### 4.1 Controller gate and return-to (lane A, first commit)

```js
// onboarding-flow.js
const BEAT_PREREQS = Object.freeze({
  resume: ["ai"],          // Beat 3 drafts with the provider Beat 2 verified
  payoff: ["google"],      // Beat 6 arms discovery against the Sheet Beat 1 created
});
const GATE_NOTES = Object.freeze({
  ai: "Connect an AI provider first — your resume is drafted with it.",
  google: "Connect Google first — your board lives in that Sheet.",
});

/** Returns { beat, note } — the beat to land on and a one-line note or "". */
function gateBeat(requestedId, state) { /* prereq satisfied iff in state.completedBeats,
  or for "google" iff getConfig().sheetId is non-empty */ }

// open(beatId, options?) — options.returnTo: "close" | undefined
// goToBeat(beatId, options?) — same options, passed through
// completeBeat(beatId): when runtime.returnTo === "close" and beatId is the beat that
// was opened with it, close the shell (existing close path), toast "Saved.", and do
// NOT advance. Otherwise unchanged.
```

The note renders in the shell's existing message slot with `data-gate-note="<prereq id>"` so lane E can assert it. `open()` and `goToBeat()` call `gateBeat` after `resolveEntryBeatId`; `reconcileStaleCompletion` runs first, as today.

### 4.2 Draft mirror (lane B)

- localStorage key: `jb_oneflow_draft_resumeText`, value `JSON.stringify({ text, at: Date.now() })`, capped at 100 000 chars (same cap as `user-content-store.js:576`).
- Written synchronously on every `saveDraft("resumeText", …)` call **before** the debounced IndexedDB write. Save fires on `input`, `change`, and `paste`.
- `hydrateFromDrafts` prefers the mirror's `text` when it is non-empty (it is always at least as fresh as the IndexedDB copy).
- Cleared only in `clearOnboardingFlowState` (`user-content-store.js`), which is the flow's single reset path.
- `root.flushDrafts` is exported; `handleShellClose` awaits it before the pause toast; a `pagehide` listener (registered once when the shell opens) calls it.

### 4.3 Payoff readiness (lane C)

```js
// resolvePayoffState(...) returns, in addition to today's fields:
readiness: { sheet: boolean, roles: boolean }
// primary action id by readiness:
//   !sheet          → "payoff_connect_google"   label "Connect Google to go live"   → ctx.goToBeat("google")
//   sheet && !roles → "payoff_fix_fit"          label "Tell it what to look for"    → ctx.goToBeat("fit")
//   sheet && roles  → "payoff_run_discovery"    (unchanged)
// "What happens now" first line when !sheet || !roles: "Not armed yet — finish the step above and it runs on its own."
```

`payoff_run_discovery` is not rendered unless both are true. Existing secondary "Take me to my dashboard" stays in every state.

### 4.4 Drawer and Beat 1 (lane C)

```js
// discovery-setup-modals.js — the #settingsDiscoveryOpenSetupBtn handler body
const oneFlow = window.JobBoredOneFlow;
if (oneFlow && typeof oneFlow.open === "function") void oneFlow.open("discovery", { returnTo: "close" });
else void h("requestDiscoverySetup", { entryPoint: "settings", allowWhileOnboarding: true });

// sheet-access-setup.js — handleSetupCreateStarterSheet, missing client id:
//   options.context === "wizard" → return { ok: false, reason: "missing_client_id" } and do NOT open Settings
//   otherwise unchanged
// oneflow-beat-google.js — continueWithGoogle checks getOAuthClientId() first; on empty, sets the
// detour <details> open, focuses the Client ID input, renders "Paste your Client ID to continue."
```

### 4.5 Effective config and receipts (lane D)

```js
// app-config-core.js
function getEffectiveConfig() { /* { ...window.COMMAND_CENTER_CONFIG } after applyStoredConfigOverrides();
  never nulls on a malformed sheetId; exported on the same global as getConfig */ }
```

- `populateCommandCenterSettingsForm` and `oneflow-beat-ai.js liveConfig()` read from it.
- `settings-profile-tab.js` writes only through `mergeStoredConfigOverridePatch`; the raw-key path is deleted.
- Tabs: Setup + Sheet merge into one tab id `google` (label "Google"); AI Providers becomes id `ai` (label "AI"). Field DOM ids do not change. Fit Profile, Scraping, ATS Scoring, Upgrades stay.
- Each of the Google and AI panels opens with a receipt block: `<div class="settings-receipt" data-receipt="google|ai">` showing what setup holds (Sheet title or id · signed-in email; provider · model), and a button `data-action="settings_change_in_setup"` that closes the modal and calls `window.JobBoredOneFlow.open(<beat>, { returnTo: "close" })`.
- `settingsDiscoveryWebhookUrl` / `settingsDiscoveryWebhookSecret` populate and payload lines are removed from `settings-modal.js`; the fields are removed from `partials/settings-modal.html`. The drawer's Connection tab is the only owner.
- Model defaults in `settings-modal.js` and `oneflow-beat-ai.js` come from one exported table in `model-catalog.js` (`DEFAULT_MODEL_BY_PROVIDER`).

### 4.6 Verify spec (lane E) — claims E1–E6

| id | Claim | Asserts |
|---|---|---|
| E1 | Beat 3 is gated on Beat 2 | `open("resume")` with `ai` incomplete lands on the AI beat with `[data-gate-note="ai"]`; with `ai` complete but the provider key blanked, "Draft from this text" makes **no** `POST /profile/from-resume` and shows the connect-AI message with a button that lands on the AI beat |
| E2 | Pasted resume survives Escape + reload | For both `locator.type()` and `locator.fill()`: 400+ chars in `#oneFlowResumePaste` → Escape → toast → `page.reload()` → same beat, same value |
| E3 | Drawer setup lands in OneFlow | Click `#settingsDiscoveryOpenSetupBtn` → the shell shows the Discovery beat; `#discoverySetupWizardMount` stays empty |
| E4 | Beat 1 never punts to Settings | No Client ID → "Continue with Google" → Settings modal not visible; detour `<details>` open; Client ID input focused |
| E5 | Payoff is honest | No Sheet → primary `[data-action="payoff_connect_google"]` present, `payoff_run_discovery` absent, no error toast; click → Google beat |
| E6 | Settings shows receipts | No `#settingsDiscoveryWebhookUrl`; tab `google` exists, `setup`/`sheet` do not; `[data-receipt="ai"]` names the provider set in Beat 2; `settings_change_in_setup` opens the shell at that beat and completing it closes the shell |

## 5. Locked decisions (Emilio, 2026-09-02 20:57 CDT)

1. **Scope:** Phase 1 (six P0 items) **plus** Settings unification (roadmap 2.3). OAuth scope narrowing and the maintainer Client ID are out of scope.
2. **Lanes:** four Opus 5 high lanes (A, B, C, D) via `claude`, one GPT 5.6 Sol xhigh verify lane (E) via `codex`. Emilio chose "3 Opus + 1 Codex" for Phase 1; Settings unification adds lane D.
3. **Beat gate:** redirect + note. `resume` requires `ai`; `payoff` requires `google` (or a configured `sheetId`). Every other beat stays reachable by id.
4. **Payoff:** adapt the primary. `Run discovery now` renders only when Sheet and roles are both present.
5. **Return-to:** `open(beatId, { returnTo: "close" })` closes the shell when that beat completes. Drawer and Settings deep links use it. (Orchestrator decision; bounded, ~20 lines, prevents the forward-walk annoyance.)
6. **Settings tab collapse is bounded:** merge Setup + Sheet, rename AI Providers, remove drawer-owned webhook fields. Scraping and ATS Scoring stay as tabs; folding them into Upgrades is a follow-up.
7. **Draft mirror:** yes, localStorage, single key, cleared only by the flow's reset path.

## 6. Integration ledger (orchestrator, 2026-09-03)

Locked decisions 8–10 were taken during integration and override anything contrary above.

8. **PR #103 (`58366b6`) is absorbed, not reverted.** It merged to main at 23:39 on 2026-09-02 while the lanes ran and touched lane A's fence (`oneflow-beat-resume.js` `draftOnServer`, `server/index.mjs` 409 for `*_not_configured`). Lane A merged main and kept the server-side 409; the client copy is the locked §4.1 sentence with the `resume_connect_ai` action, and #103's two `oneflow-l1-beat-resume` assertions now assert that copy verbatim.
9. **Lane F is the Muse Spark 1.3 agent's `fix/beat1-greenfield-gis-init` (`8be33a0`).** It was working on Beat 1 in the shared `~/Job-Bored` checkout in parallel with this program. Its duplicate no-Client-ID guard in `continueWithGoogle` was dropped in favor of lane C's §4.4 behavior; its `saveClientId → initAuth` fallback (GIS was never initialized on a greenfield boot, so the in-place re-init refused and "Continue with Google" no-op'd) is new and merged as lane F with its two tests.
10. **The ready-state payoff action id is `payoff_run_now`.** §4.3 wrote `payoff_run_discovery`; that id never existed. Lane C kept `payoff_run_now`; lane E asserts it.

Merge order and shas: B `e81284c` → A `866886e` (carries main `58366b6`) → C `ebe7b32` → D `0ea295a` → E `bffe91b` → F `8be33a0`. Every merge was clean (`git merge-tree` dry-run, then `--no-ff`). Gates (tests + lint) ran after each merge; the full floor (typecheck, e2e-smoke, e2e-visual, e2e-onboarding, contracts) ran once at the end. Evidence: `.lane-evidence/int-*.txt` in the integration worktree, copied to `evidence/`.

Fence extensions declared by lanes and accepted: C edited `tests/e2e-visual/finale-burst.spec.mjs` (its subject changed from a fixed label to "the payoff's primary"); D added a scoped block to `settings-tabs.css` and one entry to `tests/oneflow-l1-harness.mjs`; A added `GREENFIELD A4` tests beside `tests/fit-profile-wizard.test.mjs` and recommends retitling its "without forwarding secrets" test (done by the orchestrator in the ledger commit).

Follow-ups filed, not done here: `discovery-drawer.js:1090` and `resume-generate.js:180-181,457,503` still carry stale model defaults (D §5.3–5.4); the `tests/e2e/profile-flow-smoke` ↔ `profile-from-resume-unconfigured-provider` server-port race (A §5.1); `tests/server-error-schema.test.mjs` polls a spawned server forever when `server/node_modules` is absent, which hangs `npm test` in any fresh worktree (found during integration; three unrelated runners on this machine were hung on it).

11. **The six-beat journey ends on the skip-connect primary, not `payoff_run_now`.** `buildActions` in `oneflow-beat-payoff.js` honors SIXBEATS §5 B6 first (a payoff reached through Beat 5's connect skip renders "Go to my dashboard" + "Actually — connect discovery"); only an unskipped payoff adapts to §4.3 readiness. VAL-ONEFLOW-001 therefore asserts the primary it actually earns and that neither readiness detour renders. Manufacturing `payoff_run_now` would mean mocking a Tailscale machine and a webhook handshake (lane G §5.2). Accepted.
12. **Lane F2 (Muse) publishes `initAuth` on `app.core.host`.** Lane G's real-browser probe showed lane F's `call("initAuth")` was a silent no-op because `bridge-registry.js` exposed `initAuth` only on `app.bootstrap.host`; lane F's unit tests passed against a stub that had it. The bridge line plus a pinning test land as a second Muse commit.

13. **`npm run test:e2e-journey` belongs on the floor.** The program's floor listed smoke, visual, and onboarding but not the journey suite; CI's `e2e-journey` check caught one pre-gate test (`critical-journey.spec.mjs` "template grid a way back") that jumped straight to Beat 3 on a fresh install. The test now stages Beat 2 complete (not Beat 1: a Google receipt without a Sheet is what `reconcileStaleCompletion` resets). Orchestrator fix on the integration branch; 13/13 green locally.
