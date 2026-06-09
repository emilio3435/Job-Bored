# Optional enhancements wizard — design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) → ready for implementation plan

## The "so what"

Once the mandatory setup is done (sheet → resume/persona → discovery →
multi-device), there's a second tier of **optional** configuration that
materially improves results — but nothing today guides the user to it. Add a
**guided, optional, skippable walk-through wizard** that surfaces *after* the
mandatory flow and helps the user maximize the platform: a SerpApi key (biggest
results boost), a Gemini key for discovery (web search + URL-context), and the
AI provider for drafts — with a deferred tier for the niche knobs.

## Decisions (locked in brainstorming)

- **Shape: guided optional wizard (walk-through), shell-based.** Reuse the same
  `renderWizardShell` that discovery and go-live use (`discovery-wizard-shell.js
  :1586`, `variant:"generic"`, its own mount id) so it looks seamless. Each
  enhancement is a step: benefit + instructions + a **live status badge** +
  "I did it / Skip / Next". Fully skippable at any point.
- **Honest about where keys live.** SerpApi and the Gemini *worker* key live in
  the worker `.env` and need a worker restart — those steps show **instructions
  + a live `/health` status badge** (configured ✓ / not set), not a form field.
  The AI-provider step is a real dashboard form, so it can embed the field or
  deep-link to Settings → AI Providers.
- **Launched after the mandatory flow, re-openable.** Entry point: the go-live
  done step gains a "Maximize your results (optional)" CTA; plus a small,
  persistent re-entry affordance so the user can run it later. It NEVER competes
  with the mandatory flow (only offered once
  `infraSetupComplete && discoverySetupComplete && goLiveSetupComplete`).
- **v1 scope:** ① SerpApi Google Jobs key, ② Gemini key for discovery, ③ AI
  provider for drafts. ④ A deferred "more (optional)" tier — ATS scoring
  endpoint, Logo.dev token, Browser Use Cloud — shown as a final
  lower-emphasis step (links into Settings), built out later.

## The steps (v1)

| # | Step | Benefit (one line) | Status source | Action |
|---|------|--------------------|---------------|--------|
| 1 | **SerpApi Google Jobs** | Highest-recall source — Google's job index across 100+ ATS platforms. | `/health` `readiness.serpApiGoogleJobs.configured` | Instructions (sign up → key → `.env` → restart) + live badge; deep-link to Discovery drawer → Sources |
| 2 | **Gemini for discovery** | One key powers grounded web-search + URL-context ("Add job from URL"). | `/health` `readiness.googleTools.configured` | Instructions + live badge; deep-link to Discovery drawer → Sources |
| 3 | **AI provider for drafts** | Better/your-own resume + cover-letter generation. | dashboard config (`resumeProvider` + active key non-empty) | Embedded field or deep-link to Settings → AI Providers (`setActiveSettingsTab("ai_providers", {focusField:"settingsResumeProvider"})`) |
| 4 | **More (optional)** | ATS scoring endpoint, company logos (Logo.dev), Browser Use Cloud fallback. | config / `/health` | Links into the relevant Settings tabs; built out later |

## Behavior details

- **Live status.** Reuse the existing `/health` poll (`apps-script-deploy.js
  refreshSerpApiCalloutStatus`, ~`:694`) for the SerpApi/Gemini badges; read
  dashboard config for the AI-provider badge. No new worker fields needed — the
  readiness contract already exposes `serpApiGoogleJobs.configured` and
  `googleTools.configured`.
- **Per-step completion/skip.** A step is "done" when its live status reads
  configured; "skipped" writes a per-item dismiss flag in `user-content-store.js`
  (e.g. `serpApiEnhancementDismissed`, `geminiEnhancementDismissed`,
  `aiProviderEnhancementDismissed`). The wizard's done step summarizes what's
  configured vs. skipped and offers a "finish".
- **Deep-links.** Steps that can't be completed in-wizard hand off to the exact
  surface: `openDrawerToSubtab("sources", …)` (`settings-discovery-adapters.js
  :18`) for SerpApi/Gemini; `setActiveSettingsTab("ai_providers", …)`
  (`settings-tabs.js:44`) for the provider. After deep-linking, the wizard
  re-polls status on return so the badge updates.
- **Surface / launch.** A new shell-rendered wizard module
  (`enhancements-wizard-ui.js`) mounting into a new `#enhancementsWizardMount`.
  Launched from the go-live done step CTA and a re-entry affordance. Optional
  telemetry reuses the existing `jobbored:onboarding`-style hook with new step
  names (privacy-safe, no PII).

## Components touched (for the plan)

| File | Change |
|------|--------|
| `enhancements-wizard-ui.js` (NEW) | shell-rendered optional wizard: steps, status polling, deep-links, done summary |
| `index.html` | `#enhancementsWizardMount`; CTA in the go-live done step + a re-entry affordance |
| `go-live-wizard-ui.js` | done step: add "Maximize your results (optional)" CTA → launches the enhancements wizard |
| `user-content-store.js` | per-item dismiss flags (`serpApiEnhancementDismissed`, `geminiEnhancementDismissed`, `aiProviderEnhancementDismissed`) |
| `bridge-registry.js` | host bridge for the new wizard (status poll, deep-link, UC) |
| CSS | reuse the shell's discovery-setup-wizard styles; minor additions for the status badges |

## Testing

- The wizard is offered ONLY after all three mandatory flags are complete.
- Each step renders its benefit + a live status badge that flips configured ✓
  when `/health` (or config) reports it.
- Skip writes the per-item dismiss flag and advances; finishing summarizes
  configured vs. skipped.
- Deep-link actions route to the correct settings/drawer surface.
- Fully skippable: closing the wizard at any step never blocks anything.

## Out of scope

- Editing the worker `.env` from the dashboard (impossible by design — keys are
  server secrets; the wizard guides + shows status only).
- The mandatory discovery gate (separate spec:
  `2026-06-09-mandatory-discovery-gate-design.md`).
- Building out the tier-4 niche knobs beyond deep-links in v1.
