# SIXBEATS-2 — the acceptance rerun's findings (2026-09-02)

Goal: Clear the four blockers and ten defects the observe-only acceptance rerun found on main @ cf0da4d (`evidence/rerun-09-02/REPORT.md`, verdict table NEW-1…NEW-14), so a fresh install walks Beats 1–6 end to end with a real drafted profile, survives a refresh with its data, and ends on a clickable payoff.

Success means:
- Every NEW-n below has a red-first test that fails on cf0da4d and passes on the integration branch; the four BLOCKERs additionally have a real-browser (Playwright, non-hermetic dismissal) proof pasted in the lane report.
- Full floor green on integration: `npm test`, `lint:repo`, `typecheck:repo`, `test:contract:all`, `test:e2e-journey`, `test:e2e-smoke`, `test:e2e-visual`.
- The same observe-only rerun (`docs/qa/SIX-BEATS-RERUN-PROMPT.md`) on the merged build records zero BLOCKER/ERROR and every NEW-n as FIXED.

Stop when: merged to main through CI and the rerun verdict table is filed.

## Findings → root cause (orchestrator-verified in source) → owner
| # | Tag | Finding | Root cause | Lane |
|---|---|---|---|---|
| NEW-1 | BLOCKER | Legacy celebration modal (three-circle journey strip, "or start with your other devices", CTA-gated, aria-modal z100002) sits on top of Beat 6; its actions cannot be clicked | `onboarding-celebration.js` `flow_payoff` stage still renders the legacy journey strip/alt link and gates on a CTA; the finale should be a non-blocking burst over the visible beat | finale |
| NEW-10 | MISMATCH | Beat 6 sub-line rendered twice (shell lede + first body line) | `oneflow-beat-payoff.js` passes the sub as lede AND renders it in the body | finale |
| NEW-4 | MISMATCH | Beat 2 success line visible ~106 ms before auto-advance | `oneflow-beat-ai.js` advances immediately on ok | finale |
| NEW-2 | BLOCKER | Beat 3 drafting → `POST /profile/from-resume` 500 "Missing Gemini API key…" (server env-var names shown to the user) even after Beat 2 verified OpenRouter | client never sends the verified provider config; server falls back to Gemini env; `server/profile-from-resume.mjs` already has `ProfileProviderConfig {provider, apiKey, model, baseUrl}` | drafting-provider |
| NEW-8 | ERROR | Gemini calls hit `models/gemini-flash` → 404 (self-healed by resume-generate fallback) | `oneflow-beat-ai.js:84` `defaultModel: "gemini-flash"` | drafting-provider |
| NEW-11 | MISMATCH | Beat 2 pre-selects Gemini as "Recommended"; spec §5 B2 says OpenRouter pre-selected | `oneflow-beat-ai.js:81` | drafting-provider |
| NEW-14 | BLOCKER | After a refresh Beat 4 resumes empty and cannot advance | drafted profile lives only in `ctx.runtime`; flow state never persists drafts (spec §3.2 says it must) | draft-persistence |
| NEW-7 | MISMATCH | Resume text typed in Beat 3 lost on refresh | same | draft-persistence (API) + drafting-provider (B3 wiring) |
| NEW-6 | CONFUSING | After Escape on a configured/signed-in install there is no control that returns to the paused beat | S0's pill exists only on the demo board; no re-entry affordance elsewhere | draft-persistence |
| NEW-3 | MISMATCH | Beat 5 "Save & verify" never contacts SerpApi; reports "connected" after an env write + restart | `oneflow-beat-discovery.js` fuel = env-key POST + full-boot only | fuel-and-polish |
| NEW-12 | MISMATCH | "Can't reach the endpoint." names no next action (Tailscale path) | `discovery-wizard-verify.js` catch-all copy on the ts.net path | fuel-and-polish |
| NEW-9 | UGLY | Beat 5 numbered steps glue "1." to the previous sentence | list markup/CSS in the fuel panel | fuel-and-polish |
| NEW-5 | BLOCKER | An open demo-card detail (fixed, z5, no close) swallows the pill's clicks | `oneflow-demo-board.js` detail has no close/dismiss | fuel-and-polish |
| NEW-13 | UGLY | 500-px-tall red toast, one word per line, over the gate | toast CSS lacks a max-width / word-break | fuel-and-polish |

## Locked decisions
1. Integration branch `feat/sixbeats2-integration`; lane branches `feat/sixbeats2-<lane>`; one PR; `gh pr merge --rebase`.
2. **The finale is not a modal.** Confetti + title/sub float over the visible Beat 6 for ~2.5 s with `pointer-events: none`, then fade; no journey strip, no alt link, no CTA gate. Beat 6's actions are clickable from first paint. Keep the reduced-motion/a11y mechanics.
3. **Drafting uses the verified provider.** Beat 3 sends `{provider, apiKey, model, baseUrl}` from `getResumeGenerationConfig()` in the request body; the server prefers the body config over env for every provider it supports (add the OpenAI-compatible chat path for openrouter/openai/local and an Anthropic path if missing). User-facing errors name the provider, never env-var names. Spec §5 B2: OpenRouter pre-selected and "Recommended"; Gemini pin `gemini-3.5-flash`.
4. **Draft persistence contract (shared seam — code to this, both sides):** the controller (`onboarding-flow.js`) adds `ctx.saveDraft(key, value)` (debounced write into flow state `drafts: {}` via `saveOnboardingFlowState`, normalized by `user-content-store.js`) and exposes `ctx.runtime.drafts` hydrated on `open()`/`goToBeat()`. Keys: `resumeText`, `profileDraft`. draft-persistence owns the controller/store side and Beat 4's read; drafting-provider owns Beat 3 calling `ctx.saveDraft("resumeText", …)` on input and `ctx.saveDraft("profileDraft", …)` on draft ready, restoring from `ctx.runtime.drafts` on render. Lane tests on each side stub the other side to this exact shape.
5. **Fuel verification is real:** a dev-server route `/__proxy/serpapi-check` (local-origin auth like the other proxies) calls `https://serpapi.com/account.json?api_key=…` server-side and returns `{ok, plan, searchesLeft}`; the beat shows the real quota line and only then reports connected. Unreachable/invalid → message slot with a next action.
6. **Re-entry after Escape** when the demo board is not the surface: the controller's close hook shows a small "Resume setup ▸" pill (same look as S0's) that calls `open()`; hidden once the flow completes.

Fences: finale → `onboarding-celebration.js`, `oneflow-beat-payoff.js`, `oneflow-beat-ai.js` (advance delay only), `css/oneflow.css` CORE. drafting-provider → `oneflow-beat-resume.js`, `oneflow-beat-ai.js` (defaults/labels), `server/profile-from-resume.mjs`. draft-persistence → `onboarding-flow.js`, `user-content-store.js` (normalize only), `oneflow-beat-fit.js`, `css/oneflow.css` CORE (pill rule only). fuel-and-polish → `oneflow-beat-discovery.js`, `dev-server.mjs` (one route), `discovery-wizard-verify.js`, `oneflow-demo-board.js`, toast CSS rule (`style.css` or wherever `.toast` lives — one rule), `css/oneflow.css` L3/L4 regions. Two lanes share `oneflow-beat-ai.js`: finale edits ONLY the auto-advance delay; drafting-provider edits ONLY provider defaults/labels — different hunks.

Ground rules: `docs/programs/oneflow-20260831/GROUND-RULES.md` + `docs/programs/sixbeats-20260902/GROUND-RULES-ADDENDUM.md` apply unchanged. Every blocker lane proves its fix in a real browser with Playwright (no programmatic dismissal of overlays) and pastes the console/network lines.
