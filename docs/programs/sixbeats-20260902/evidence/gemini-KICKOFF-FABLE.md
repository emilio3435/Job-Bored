# Six-Beats Onboarding Stepper Revamp: Orchestration Kickoff Prompt

**Audience:** Opus 5 Fleet Orchestrator Model  
**Target Repository:** `JobBored` (`emilio3435/Job-Bored`)  
**Specification Documents:**
- Architecture & Substrate: [`docs/programs/oneflow-20260831/SUBSTRATE.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/programs/oneflow-20260831/SUBSTRATE.md)
- Six-Beats Onboarding Spec: [`docs/ONE-FLOW-ONBOARDING-SPEC.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/ONE-FLOW-ONBOARDING-SPEC.md)
- Walkthrough Telemetry Report: [`docs/qa/2026-09-01-six-beats-walkthrough/REPORT.md`](file:///Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/REPORT.md)

---

## Context & Evidence Claims (C1 – C10)

The following numbered claims are empirical findings observed during the live walkthrough on commit `5239f58a31fe8900d9410d514241a168fe500b9e`. Each claim maps directly to the architectural fences established in `SUBSTRATE.md`.

- **Claim C1 (DOM Init Race):** On cold start (`/?greenfield=1`), an uncaught `TypeError: Cannot read properties of null (reading 'appendChild')` is emitted during initial script execution.  
  *Substrate Fence: §2.1 Boot Sequence & DOM Mount Fences.*
- **Claim C2 (Beat 3 Template Escape Hatch):** In Beat 3 (`oneflow-beat-resume.js`), clicking *"I'd rather start from a template"* renders the 4 starter templates but omits a *"Back to upload/paste"* action, locking users into selecting a template.  
  *Substrate Fence: §3.3 Beat 3 Resume Dual-Mode State Machine.*
- **Claim C3 (Beat 6 Profile 404 Fetch):** In Beat 6 (`oneflow-beat-payoff.js`), `resolvePayoffState` calls `fit-profile-wizard.js:fetchProfile`, which issues a `GET /profile` request to the static web dashboard host (`http://localhost:8080/profile`), returning a 404 Not Found error and throwing `profile_response_invalid`.  
  *Substrate Fence: §3.6 Beat 6 Payoff & Fit Profile Storage Boundary.*
- **Claim C4 (Interruption Rehydration):** Refreshing the browser mid-flow (during Beat 3 or Beat 5) resets the application back to the cold-start gate instead of resuming at the active beat from session storage.  
  *Substrate Fence: §2.3 Flow State Persistence & Rehydration Invariants.*
- **Claim C5 (Escape Key Interception):** Pressing `Escape` in Beat 4 collapses the modal to the demo board and pill. While clicking the pill restores the flow, the transition lacks an explicit dismissal confirmation dialog.  
  *Substrate Fence: §2.2 Overlay Lifecycle & Dismissal Boundaries.*
- **Claim C6 (Live Verification Latency):** Live key verification round-trips for OpenRouter (Beat 2) and SerpApi (Beat 5) take between 1.4s and 3.0s, during which the primary button enters a spinner state without a cancel/retry timeout indicator.  
  *Substrate Fence: §4.1 Async Verification Transport & Timeout Safety.*
- **Claim C7 (Mobile Viewport Horizontal Density):** At 390x844 viewport, Beat 4 summary cards and Beat 5 fuel/connect panels require extensive vertical scrolling; action buttons occupy fixed bottom heights.  
  *Substrate Fence: §5.1 Responsive Fluid Layout Contracts.*
- **Claim C8 (Adapted Flow State Cleanliness):** Skipping discovery worker connection in Beat 5 cleanly transitions to the adapted Beat 6 payoff variant and marks the board as fuel-only.  
  *Substrate Fence: §3.5 Adapted Flow & Partial Setup Degradation.*
- **Claim C9 (Secret Sanitization & Masking):** Password-masked inputs in Beat 2 and Beat 5 prevent accidental visual leakage in recordings; all telemetry pipelines successfully redact keys as `<redacted>`.  
  *Substrate Fence: §6.1 Security & Credential Hygiene.*
- **Claim C10 (Discovery Trigger & Stream Feedback):** Clicking *"Run discovery now"* in Beat 6 successfully dispatches the background webhook to `http://127.0.0.1:8644/discovery` and streams toast notifications.  
  *Substrate Fence: §3.6 Discovery Dispatch & Webhook Handshake.*

---

## Orchestrator Kickoff Prompt

```markdown
You are the Lead Orchestrator Model for the JobBored Six-Beats Onboarding Revamp fleet.

Your mission is to execute a complete, rigorous polish and bugfix pass on JobBored's six-beat onboarding stepper, addressing all friction points documented in REPORT.md (Claims C1–C10) while strictly preserving the architectural fences in SUBSTRATE.md and the copy/design specs in ONE-FLOW-ONBOARDING-SPEC.md.

### Core Objectives for Subagent Fleet:
1. **Fix Boot-Time DOM Null Pointer (Claim C1):** Guard all `appendChild` and mount invocations during startup to ensure clean, error-free greenfield boots.
2. **Implement Beat 3 Template Back Action (Claim C2):** Add an explicit "Back to upload / paste" secondary action to `oneflow-beat-resume.js` when in `state.mode === 'templates'`.
3. **Fix Beat 6 Profile Resolution (Claim C3):** Update `oneflow-beat-payoff.js` to read the saved fit profile directly from `user-content-store.js` (IndexedDB) or in-memory runtime draft before falling back to network endpoints.
4. **Harden Mid-Flow Session Rehydration (Claim C4):** Persist `currentBeatId` and transient step state to `sessionStorage` so browser refreshes resume at the active step seamlessly.
5. **Streamline Mobile & Keyboard Ergonomics (Claims C5, C7):** Refine vertical spacing and sticky action bars for 390x844 viewports, and ensure Escape key behaviors cleanly dock to the corner pill.
6. **Verify Test Suite & Contracts:** Run `npm run test:repo` and `npm run test:contract:all` after all modifications to guarantee zero regression on Discovery Webhook and Pipeline contracts.

Maintain zero secret leakage, adhere strictly to vanilla JavaScript globals order, and ensure all changes pass existing unit, integration, and E2E journey tests.
```
