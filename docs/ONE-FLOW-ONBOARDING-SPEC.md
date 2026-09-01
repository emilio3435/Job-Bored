# One-Flow Onboarding — Spec

- **Status:** Draft v2 for review · 2026-08-31 (v2: LLM + SerpApi promoted into the mandatory flow per Emilio — see §11.5)
- **Owner:** Emilio
- **Sources:** Five-agent onboarding teardown ("The One-Time Deal", https://claude.ai/code/artifact/c306f288-a9e7-4596-ac4c-822312e484aa) · clickable prototype ("Six Beats" artifact, https://claude.ai/code/artifact/685ddf41-3eef-4a20-a2c6-ef2bbf35b0d9)
- **Supersedes (as onboarding chapters):** login gate + OAuth sub-wizard, `#setupScreen`, first-run wizard, profile onboarding wizard, fit-profile wizard (as a first-run surface), discovery gate, go-live wizard (as a chained chapter), enhancements wizard (entirely — its two real asks move into the flow), all four celebration stages.

---

**Goal:** Replace JobBored's six chained setup wizards with one flow — a live demo board plus six beats in a single shell — that takes a stranger from first page load to a fully powered pipeline (working LLM, Google Jobs index, armed discovery) in about fifteen minutes, and ends with real jobs on screen.

**Success means:**
- A zero-config visitor sees scored demo job cards within 30 seconds of `npm start`, before any credential ask.
- One visual shell, one 6-beat progress spine, and one celebration exist in the entire flow; grep for `playOnboardingCelebration` call sites returns exactly one.
- The flow cannot complete without a **live-verified AI provider** and a **saved, verified SerpApi key** — a finished setup is a useful tool, never a ledger for manual pulls.
- Every profile datum (roles, strengths, narrative, wants, avoids, constraints, tone) is asked exactly once and lands in both the discovery profile and the server fit profile.
- The final screen renders the user's search summary, connected AI, live source count (including Google's job index), and a first-results ETA, with **Run discovery now** as the primary action — and a run triggered there always starts full-power (intent pre-validated, SerpApi-backed recall, LLM scoring).
- Refreshing mid-flow resumes the same beat with entered data intact; existing users with legacy completion flags never see the flow.
- Each beat emits `beat_opened` / `beat_completed` / `beat_skipped` / `beat_abandoned`.

**Stop when:** a fresh profile and a legacy profile both pass the Phase 4 acceptance script (§10), and the deletions table (§7) is empty in the shipped bundle.

**Constraints:**
- Never re-onboard an existing user: legacy flags migrate forward (§3.3).
- Every mandatory third-party ask uses a free tier and carries a live verification with a rendered success/failure message — a key ask with silent feedback is a defect.
- Demo data never writes to the user's Sheet and is visually watermarked until replaced.

---

## 1. Context (one paragraph)

The Aug 31 teardown found 6 wizards across 13 surfaces in 9 shells with 4 progress systems; 11 "done" moments (4 confetti) before the first job; 35–60 min median time-to-first-value; 8 data points asked more than once; a resume uploaded in wizard 1 invisible to wizard 2 (IndexedDB vs filesystem); no privacy/one-time/value statement anywhere; and the flagship "Set it up for me" running 20–120 s with zero feedback. Full citations live in the teardown artifact. This spec is the replacement, not a patch.

## 2. Principles

1. **Give before you ask** — the first screen is the product with demo data.
2. **One spine** — one shell, one progress system, one voice, resumable.
3. **The resume is the front door** — AI drafts; the user confirms, never composes.
4. **Name the deal, keep the deal** — "fifteen minutes, once", per-beat time labels, one privacy sentence per data ask, an honest reason before every key ask.
5. **Power is part of setup** — the LLM and the Google Jobs index are wired in-flow, because they are the difference between the product and a ledger. Tedious asks get the best framing, never exile to a bonus wizard.
6. **One celebration, at the real end, with the payoff** — then jobs actually appear.

## 3. Flow architecture

### 3.1 Screens and order

```
S0  Demo board (dashboard state, not a modal)
B1  Connect Google           (~3–15 min, dominated by the OAuth detour)
B2  Give it a brain — AI key (~2 min; live-verified, required)
B3  Hand us your resume      (~1 min; drafting is guaranteed powered by B2)
B4  Confirm your fit         (~2–3 min)
B5  Turn on discovery        (~4 min: fuel panel = SerpApi, required · connect panel = Tailscale, skippable)
B6  You're live              (payoff + single celebration)
```

B1→B6 render inside one shell mounted over the (demo) dashboard. S0 is the dashboard itself. Beat order is load-bearing: the AI key precedes the resume beat because B3's profile drafting consumes it; both keys precede B6 so the payoff run is full-power.

### 3.2 Persistence

One IndexedDB key owns flow state: `onboardingFlowState = { version: 3, beat, completedBeats: [], skipped: { discoveryConnect?: true }, startedAt }` written on every beat transition by the shell (pattern: `discoverySetupWizardState`, which already survives refresh). Beat-local drafts (B4 edits, unverified key text) persist under the same key on input, debounced. `flow_completed` writes `onboardingComplete`, `infraSetupComplete`, and (when applicable) `discoverySetupComplete` so every legacy reader keeps working unchanged. Verified keys persist where they live today: provider config via the existing override store, SerpApi via `/__proxy/discovery-env-key`.

### 3.3 Migration (existing users)

On boot, before any gate: if `infraSetupComplete && onboardingComplete` are already true, write `onboardingFlowState.completed = true` and route to the dashboard — the flow never renders. If discovery is incomplete for such a user, the what's-next banner (not a gate) carries the nudge. Partial legacy states map forward: sheet configured → start at B2; provider configured and verified → B2 shows pre-passed and advances on open; profile complete but no fit profile → start at B4 prefilled from the discovery profile.

### 3.4 Entry, exit, resume

- **Entry:** fresh boot with no legacy completion → S0. "Make it mine" → B1 (or the deepest incomplete beat per §3.3).
- **Escape:** every beat's shell close (×/Esc) returns to the dashboard (demo or real — whichever is live) and leaves `onboardingFlowState` intact; the S0 invitation card (or its corner pill) re-enters at the saved beat. Closing writes `beat_abandoned {beat, reason}`. Closing is pausing, never skipping — required beats stay required on re-entry.
- **Resume:** reopening or refreshing lands on `onboardingFlowState.beat` with drafts restored.

### 3.5 Shell (chassis decision)

Extend **`discovery-wizard-shell.js`** as the single chassis — it is tested, a11y-wired (JB-A11Y), and already hosts three wizards. Additions:

1. A **6-beat spine** region replacing the 3-stage journey strip: six segments (Google · AI · Resume · Your fit · Discovery · Done) with `done/current/todo` states, plus a minutes-remaining label derived from the beat table above.
2. A **`message` / `messageTone` slot** in `buildShellContext` rendered under the actions — this fixes the invisible-feedback defect (`discovery-wizard-shell.js:497-530`) for every consumer, and is the delivery channel for every key-verification result in B2 and B5.
3. A **busy state**: any async action renders its stage list live (§5 per-beat) and disables its trigger; the shell exposes `setBusy(actionId, stages)`.

Salvage from `welcome.js`: the paced single-card rhythm, Enter-to-advance, and per-keystroke draft persistence. Delete its onboarding half (§7). *(Flagged alternative: promote `welcome.js` as the chassis — cheaper visually, but it lacks the shell's action system, a11y coverage, and tests; not chosen.)*

## 4. Screen S0 — the demo board

- **Purpose:** show the promise before any ask. **Entry:** zero-config or signed-out boot.
- **Content:** the real pipeline renderer (`pipeline-render.js`) seeded from a bundled fixture (`fixtures/demo-pipeline.json`, ~8 rows across stages, each with a fit score and one-line "why it fits"). Cards carry a `DEMO` watermark chip and reduced opacity. Over the board, one invitation card:
  > **This is your job hunt on autopilot.**
  > Set it up once — about fifteen focused minutes — and roles scored against *your* fit land here every morning. Your resume and pipeline stay in your Google Sheet and on this machine.
  > `[ Make it mine — 15 min, once ]` `[ Poke around first ]`
- **Interactions:** *Make it mine* → B1. *Poke around first* → the card collapses to a corner pill (`Set up JobBored — 15 min ▸`) that persists across the session and reopens the flow. Demo cards open read-only detail views.
- **Exit:** first real Sheet row replaces the fixture; the pill and watermark disappear.
- **Implementation notes:** seed via a `getPipelineData()` demo source when `!getSheetId()`; bypass `showSheetAccessGate` for the render path; keep the gate's error mode for genuinely broken configs. Delete the credential-first `no-oauth` opening.

## 5. Beats B1–B6

Each beat lists: content (copy is normative — ship these strings), interactions, async stages, skip, exit condition, telemetry.

### B1 — Connect Google

- **Headline:** "Your pipeline lives in a Google Sheet you own." **Sub:** "Sign in and we'll create it for you. Nothing is stored on our side — there is no 'our side.'"
- **Primary:** `Continue with Google` → OAuth popup → on grant, auto-create the starter sheet (existing `sheet-access-setup.js:665-762` POST) with live stages: `Signed in as {email} ✓` → `Creating your Pipeline sheet…` → `Sheet ready ✓`. Auto-advance to B2.
- **Secondary:** `Connect an existing sheet instead` → inline sheet-URL field with the existing validation.
- **First-timer detour (collapsed `details`):** "First time? You'll need a free Client ID" — the guided Cloud Console walkthrough with an **honest ~10 minute estimate**, clipboard-assisted values, consent-screen step included, Drive API step removed, and the line "You only ever do this once." The gcloud one-click ships only after `oauth-bootstrap.mjs` mints a real Web-application client; until then the button is absent.
- **Skip:** none (the sheet is the product's substrate); shell close returns to S0.
- **Exit:** `getSheetId()` truthy. **Telemetry:** `beat_completed {beat:"google", createdSheet: bool}`.

### B2 — Give it a brain (AI provider, required)

- **Headline:** "Now give it a brain." **Sub:** "One AI key powers everything personal here: it drafts your fit profile from your resume on the next screen, scores every job discovery finds, and writes your tailored resumes and cover letters. OpenRouter is free and takes about two minutes."
- **Provider cards:** `OpenRouter — free` (pre-selected, recommended) · `Gemini` · `OpenAI` · `Anthropic` · `Local — on your machine`. The OpenAI/Anthropic cards carry the browser-CORS note inline ("runs through the local server — keep `npm start` running"). The webhook option moves to Settings.
- **Key path:** three numbered steps (`Create a free account ↗` deep link → `Copy your key` → `Paste it here`), a masked key field, and the primary action **`Check & continue`**.
- **Verification (required):** `Check & continue` runs a real round-trip and renders its stages live: `Checking your key…` → `✓ Connected — {model} responded`. The beat completes only on a passed check. `Local` completes only on a passed Ollama connection check — closing the invisible-hatch bug where Local "passed" unverified and broke on first draft. Failures render the provider's error in the message slot with the retry path and a `Having trouble?` details block (rate-limit, wrong-key, and CORS cases each name their fix).
- **Gemini bonus (automatic):** when the chosen provider is Gemini, write the key through to the discovery worker env (`/__proxy/discovery-env-key`) so grounded web search and Add-job-from-URL light up with zero extra asks; say so inline ("Your Gemini key also unlocks URL import and grounded search — done, no extra step.").
- **Skip:** none. This is the product's utility; the ask is honest instead of avoidable. Shell close pauses (§3.4).
- **Exit:** a provider config saved **and** its live check passed this session (or previously verified per §3.3). **Telemetry:** `beat_completed {beat:"ai", provider, checkMs}`.

### B3 — Hand us your resume

- **Headline:** "Drop in your resume. We'll do the typing." **Sub:** "From this one file we'll draft your whole fit profile — target roles, strengths, what you want, what to avoid. You'll review everything on the next screen; nothing is saved until you approve it."
- **Interactions:** drag/paste/browse. On receipt, write the extracted text to **both** stores — IndexedDB (`setPrimaryResume`) and the server resume path that `/profile/from-resume` reads (add the missing `~/.jobbored/resume.txt` writer or a request-body param). Then call `/profile/from-resume` with the `wants: leave []` / `avoids: leave []` prompt rules **removed** so every section returns drafted. Drafting runs on the B2-verified provider — the template fallback is a choice here, never a failure mode caused by a missing key.
- **Async stages (rendered live):** `Reading your resume ✓` → `Drafting target roles & strengths…` → `Writing your first-person narrative…` → `Draft ready ✓`; auto-advance to B4.
- **Fallbacks:** `I'd rather start from a template` → the four existing starter templates, then B4. Extraction error → message slot with the server error and both retry + template paths (keep the current honest 404/error split).
- **Exit:** a draft profile object exists in beat state. **Telemetry:** `beat_completed {beat:"resume", source:"upload"|"paste"|"template"}`.

### B4 — Confirm your fit

- **Headline:** "Here's how we'll judge every job for you." **Sub:** "We drafted this from your resume. Fix anything that's off — this is the one-time part that makes every match yours."
- **Layout — one screen, three summary cards + one expander:**
  1. **Looking for:** role chips (editable, ordered), humanized seniority label (reuse the drawer's label map — raw enum ids never render), work-location line ("Remote or Austin · $180k floor").
  2. **Your edge:** top strengths as an ordered list (drag to reorder), narrative shown as one italic sentence with `edit`.
  3. **Lean toward / away:** wants and avoids chips, both AI-drafted.
  4. **`Edit details` expander:** work-mode radios, locations chips (rendered **only when** work mode ≠ remote-only *and* ≠ any — closing the remote-kill trap), salary floor (enforced standalone — decoupled from the salary-required checkbox), skip-titles chips, work authorization. Fields nothing consumes (`yearsRelevantExperience`, `starterTemplate` passthrough) do not exist here.
- **Primary:** `Looks like me →` — validates (≥1 role, ≥1 strength, narrative 20–1200 chars) with inline messages at the offending card, then writes **once** to both the discovery profile (roles/locations for query building) and the server fit profile (`~/.jobbored/profile.json` for scoring). Review shows plain English; raw JSON lives behind a `details` toggle.
- **Exit:** both writes acknowledged. **Telemetry:** `beat_completed {beat:"fit", edited: bool}`.
- **Absorbs:** profile wizard steps 2–4 and all 7 fit-profile wizard steps. The fit-profile wizard remains as a Settings editor only — and gains fetch-on-open (fixing the overwrite-on-reopen data-loss bug).

### B5 — Turn on discovery (fuel, then connect)

- **Headline:** "Now the engine: jobs come to you." **Sub (the three missing sentences, verbatim):** "Discovery runs on this computer, searches the job boards overnight, scores each role against your fit, and drops the matches into your pipeline. Only your search terms leave this machine. Set up once; it runs itself."
- **Panel 1 — Fuel (SerpApi, required):** titled **"First, the fuel: Google's job index."** Copy: "Discovery reads job boards directly, but Google's index is the single biggest source — it watches 100+ boards at once. Free key, 100 searches a month — plenty for daily runs. Three steps, about 60 seconds." Three numbered steps with deep links (existing enhancements card, `enhancements-wizard-ui.js:248-254`), masked key field, action **`Save & verify`** → stages `Saving key…` → `✓ Google Jobs index connected — 100 searches/mo`, delivered through the message slot (the current silent `Save key` is a defect, §10 Phase 0). The saved key persists via the existing `/__proxy/discovery-env-key` + worker restart path. Panel 2 renders dimmed until the fuel check passes.
- **Panel 2 — Connect:** **`Set it up for me`** → runs autodetect first as a **visible** beat ("Checked your machine ✓") — including during onboarding (remove the `entryPoint !== "onboarding"` bypass) — then the Tailscale auto path with its four stages rendered live: `Checked your machine` → `Started the discovery worker` → `Publishing a private URL on your tailnet` → `Verifying the connection`. Success shows `Connected ✓` inline and advances. Blocked states (Tailscale missing/logged-out) keep the current honest copy + `Download Tailscale` / `Re-check`, in the message slot. **Advanced (collapsed `details`):** "Run without Tailscale, or paste your own endpoint" — the manual URL+secret pair, and the local-worker path as a doc link (`docs/SELF-HOSTING.md`). The ngrok+Cloudflare screens leave the wizard.
- **Skip (connect only):** `Skip the connection for now — your keys are saved; jobs won't arrive on their own until you connect.` → `skipped.discoveryConnect = true`, B6 renders the adapted variant. The fuel panel has no skip — a keyless discovery setup is the ledger this spec exists to prevent. The blocking discovery gate is deleted.
- **Exit:** fuel verified **and** (connection `connected` or connect skipped). **Telemetry:** `beat_completed {beat:"discovery", path, fueled:true}` / `beat_skipped {beat:"discovery_connect"}`.
- **Verification stays a handshake** (auth-probe header), and stub endpoints keep their current honest non-completion behavior.

### B6 — You're live (the payoff)

- **The only celebration:** one confetti burst (reuse the existing, well-tested celebration player; all other call sites removed). Headline: "You're live, {firstName}." Sub: "That was the one-time part. From here, JobBored works for you."
- **Card 1 — Your search:** roles · where · floor · edge (top 3 strengths), all read from the just-saved profile.
- **Card 2 — What happens now:** `✓ AI connected — {provider}` · `✓ Discovery armed — {n} sources watching, including Google's job index` · `✓ Pipeline sheet connected — open it ↗` · `⏱ First matches land tomorrow morning — or run it right now and watch.`
- **Actions:** `Run discovery now` (primary; guaranteed full-power — B4 wrote intent, B2/B5 verified the keys) → the shell fades while the run streams its first cards onto the board behind it, with a live toast (`Discovery running — {n} matches so far`). `Take me to my dashboard` (ghost).
- **Skipped-connect variant:** the armed line becomes `○ Connection is off — your AI and Google-index keys are saved; connect anytime from the banner below`, and the primary becomes `Go to my dashboard`. Three-circles-of-skip screens never render.
- **Footer line:** "More power-ups — URL import, grounded search, other devices — live in Settings → Upgrades, each one click, none required."
- **Exit:** writes all completion flags (§3.2), `flow_completed {skips, durationMs}`.

## 6. Deferred moments (leave onboarding, gain context)

| Moment | Trigger | Ask |
|---|---|---|
| Gemini grounded search + URL import (only when provider ≠ Gemini) | URL pasted into ingest with no Gemini key | Inline one-field ask on the input; a Gemini provider key from B2 already unlocked this automatically |
| Other devices | Settings → Devices + one banner nudge post-completion | The go-live wizard, plus a first-class "I only use JobBored on this computer" answer that writes `goLiveSetupSkipped` and permanently quiets the banner; the cloud path's `no-cors` probe warns instead of blocking Finish |

*(v1 of this spec deferred the AI provider and SerpApi here; both are now mandatory beats — §11.5.)*

## 7. Deletions and migrations

| Item | Action |
|---|---|
| Enhancements wizard (all 5 steps) | Delete; SerpApi → B5 fuel panel, Gemini → B2 write-through + §6 moment; a Settings → Upgrades page lists the `more_optional` cards |
| Discovery gate (`#discoverySetupGate`) | Delete; B5's required fuel + skippable connect + banner replace it |
| Celebration stages `profile`/`discovery`/`devices`/`bonus` | Collapse to the single B6 call |
| `welcome.js` onboarding half + `WELCOME.md` step spec | Delete; keep and re-document `mountEmpty` (the empty-state card) |
| Five legacy discovery modals + `discovery-setup-modals.js` copy + the drawer's five Connection buttons | Replace with one `Open discovery setup` button (completing the original spec's Phase 3) |
| `#setupScreen` ("One more step.") | Delete; B1 owns sheet creation |
| Dead elements/flags: `#enhancementsReEntryBtn`, whats-next badges, `#onboardingWizardBtn` handler, `fitProfileOnboardingComplete`, 3 `*EnhancementDismissed` flags, `pendingDiscoverySetup` plumbing | Delete |
| Fossils: "Step 1 of 9" markup, `aria-valuemax="3"`, "Task #6" copy, jb-v2 "off by default" Settings claim, duplicate "One more step" headlines | Correct alongside their surfaces |

## 8. Voice rules (copy deck)

1. Every ask names its return in the user's world ("makes every match yours"), never the machine's ("goes into the LLM scoring prompt").
2. Every beat shows a time label; the flow's total appears at S0 and B1. Estimates are honest — a 10-minute detour says 10 minutes.
3. Every data ask carries one privacy sentence; every key ask opens with what the key buys; every long-running action shows its real stages.
4. Every error names the next action ("Install Tailscale, then Re-check"), and reaches the screen through the message slot.
5. "One-time" / "once" appears at S0, B4, and B6 — the promise, the work, the receipt.

## 9. Telemetry

Extend the frozen vocabulary in `onboarding-telemetry.js`: `flow_opened`, `beat_opened`, `beat_completed`, `beat_skipped`, `beat_abandoned` (all with `{beat}`), `flow_completed {skips, durationMs}`, `key_check {beat, provider|source, ok, ms}`, `first_results {count, ms}`. Every emit site references `STEPS.*`, including the currently unlisted enhancement events (which disappear with §7). Wire shell close/Esc to `beat_abandoned` so drop-off within the flow is finally measurable — B2 and B5's fuel panel are the two beats most worth watching, since they carry the mandatory external signups (§11.5).

## 10. Phased delivery and acceptance

| Phase | Ships | Acceptance (checkable) |
|---|---|---|
| **0 — Repairs** | Teardown bug table: fetch-on-open for fit wizard; location-trap + salary-floor fixes; busy states for `Set it up for me` / `Save key`; shell message slot; z-index fix; strand-on-escape fix; gcloud fix-or-remove; Drive-API removal; Node gate ≥ 20; README corrections (consent screen, localhost origin, clone block); dead-element deletion; single-device exit + cloud-finish unblock; browser-CORS warning on OpenAI/Anthropic picks | Each fix has a failing-then-passing test; `npm test` green; no redesign dependency |
| **1 — One spine** | Shell spine + message slot; discovery gate → B5-style required-fuel/skippable-connect; B2 provider beat with live check (replacing the first-run provider step's silent gate); celebrations → 1; enhancements retired (SerpApi/Gemini asks absorbed per §7) | A fresh profile walked end-to-end encounters exactly one shell and one confetti; the flow refuses to complete without a passed provider check and a verified SerpApi key; `grep playOnboardingCelebration` = 1 call site |
| **2 — Resume-first** | Resume dual-write; unrestricted `/profile/from-resume`; B4 confirm screen replacing profile steps 2–4 + fit wizard; single profile write path | Upload → B4 arrives with all six sections drafted via the B2 provider; saving writes both stores; no field is asked twice anywhere in the flow |
| **3 — Bookends** | S0 demo board; B6 payoff with live first run; §6 contextual moments | Cold start shows scored demo cards < 30 s; B6 renders real profile + provider + source values; `Run discovery now` streams ≥ 1 SerpApi-sourced card in the same session on a connected setup |
| **4 — Sweep** | §7 deletions complete; migration §3.3 verified | Legacy-flagged profile boots straight to dashboard; deletions table empty; telemetry funnel renders a complete open→complete series per beat |

## 11. Decisions made (flagged alternatives)

1. **Chassis = discovery shell**, welcome.js salvaged for rhythm only (§3.5).
2. **Tailscale is the only presented discovery path**; local ngrok+relay moves to docs. (Alternative — keep it as a wizard branch — rejected: 4 screens, 4 shell commands, 2 permanent terminals, self-arguing card copy.)
3. **The fit-profile wizard survives as a Settings editor**, not an onboarding surface. (Alternative — delete it — rejected: power users need deep editing; it gains fetch-on-open.)
4. **Demo data is a bundled fixture, not a generated sample** — deterministic, curated, zero AI cost at boot.
5. **LLM + SerpApi are mandatory in-flow** (Emilio, 2026-08-31, overriding v1's deferred-upsell design): a keyless install is a ledger for manual pulls, not the product — and B3's profile drafting depends on the provider anyway, so the key belongs before the resume, not after onboarding. Accepted tradeoff: two external signups sit in the mandatory path, which is where funnels historically die. Mitigations, all required: free tiers only, value-named framing before each ask (§8.3), live verification with rendered success/failure (never a silent save), per-case `Having trouble?` recovery blocks, and `key_check` telemetry on both beats so the drop-off cost of this decision is measured, not guessed.
