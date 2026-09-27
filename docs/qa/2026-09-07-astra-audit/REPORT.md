# JobBored Full System Audit & Performance Report
**Date:** 2026-09-07
**Test Agent:** GPT-6 Astra
**Commit Hash:** 3a0f59c
**Environment:** macOS 27.0 (26A5421a), arm64, Node v24.13.0, npm 11.17.0, Comet 151.0.7922.247 (extension reports Chrome). See [baseline](media/baseline.json).

**Status: In progress — Google authentication handoff. This is a checkpoint, not a completed Phase 0–6 audit.**

The latest screenshot shows the sign-in wait timed out while user authentication was pending. Continue with Google is available again. [Current stopping point](media/01-18-authentication-checkpoint.png).

---

## 1. Executive Summary & Quality Scorecard
- Overall System Health: **Not graded; full live coverage is incomplete.** Assigning a whole-system letter grade from onboarding alone would overstate the evidence.
- Total recorded browser actions: **15**. Phase 0 additionally includes three successful shell health checks. Initial navigation and browser-connection troubleshooting are described separately.
- Step Breakdown: **7 OK | 0 SLOW | 4 ERROR | 4 MISMATCH**. Two ERROR rows are automation failures and one is successful negative validation; these are not three product defects. See action table.
- Primary strengths: all local services responded; S0 renders eight demo roles; existing-sheet validation is actionable; saving the existing OAuth client opens Google sign-in. See [baseline](media/baseline.json), [S0](media/01-01-greenfield-initial.png), [validation](media/01-05-empty-sheet-validation-after.png), and [handoff](media/01-17-google-after-client-save-after.png).
- Top three findings: false waiting state when OAuth is unavailable; misdirected success copy after client save; cold-start accessibility content includes an old stalled materials request. Detailed evidence and uncertainty follow.

---

## 2. Comprehensive Step-by-Step Audit Log
Phase 0: all three endpoints returned 200 in 14.79 ms, 1.15 ms and 141.36 ms respectively. Initial sandbox probes failed with Operation not permitted; an authorized read-only escalation succeeded. No processes were terminated/restarted. [Evidence](media/baseline.json).

Initial navigation to `/?greenfield=1` began at 06:17:32.956Z; navigation returned at 06:17:38.061Z (5.105 s). This includes tool/navigation overhead and is **not** a measured paint or ready-state latency. [Initial screenshot](media/01-01-greenfield-initial.png).

A dash means unmeasured, not instantaneous. Action-call elapsed values are in telemetry.json; user_s and wait_s are intentionally null. Every recorded action has before/after PNGs and a post-action DOM snapshot.

| Step ID | Surface / Phase | Interaction / Action | Expected Behavior | Observed Behavior | user_s | wait_s | Verdict | Screenshot |
|---|---|---|---|---|---|---|---|---|---|
| 01-02 | S0 sample board | Collapse invitation | Invitation becomes setup pill | Invitation collapsed; eight demo roles remain. Accessibility tree also contains an old stalled materials request. | — | — | OK | [After](media/01-02-poke-around-after.png) · [Before](media/01-02-poke-around-before.png) |
| 01-03 | S0 sample board | Click setup pill | Restore invitation card | Pill opens Beat 1 directly, rather than restoring the invitation. This differs from the requested matrix; usefulness of shortcut is not treated as a defect. | — | — | MISMATCH | [After](media/01-03-restore-invitation-after.png) · [Before](media/01-03-restore-invitation-before.png) |
| 01-04 | Beat 1 | Open existing-sheet branch | Sheet-link input and connection controls | Google Sheet link field, Connect this sheet, and Back to sign-in render. | — | — | OK | [After](media/01-04-existing-sheet-branch-after.png) · [Before](media/01-04-existing-sheet-branch-before.png) |
| 01-05 | Beat 1 | Submit empty sheet field | Specific validation feedback | Expected validation alert explains that a Google Sheet link or ID is required. ERROR verdict follows requested taxonomy; this is a passing negative test. | — | — | ERROR | [After](media/01-05-empty-sheet-validation-after.png) · [Before](media/01-05-empty-sheet-validation-before.png) |
| 01-06 | Beat 1 | Back to sign-in | Return to primary Google branch | Primary Google branch restored. | — | — | OK | [After](media/01-06-return-google-branch-after.png) · [Before](media/01-06-return-google-branch-before.png) |
| 01-07 | Beat 1 | Continue without OAuth client | Immediate prerequisite feedback; no false waiting state | DOM contains a sign-in-not-ready message, while the screenshot shows only waiting and Continue disables and Waiting for Google sign-in remains. Later timeout blames a potentially blocked popup. | — | — | ERROR | [After](media/01-07-google-auth-gate-after.png) · [Before](media/01-07-google-auth-gate-before.png) |
| 01-08 | Beat 1 | Open Client ID help | Recovery instructions and client input | Detailed Google Cloud setup instructions and Save Client ID are present. Waiting state remains. | — | — | OK | [After](media/01-08-google-client-help-after.png) · [Before](media/01-08-google-client-help-before.png) |
| 01-09 | Mobile setup | Request 390x844 viewport | 390x844 CSS viewport | Document reports 520x1125 under inherited zoom. This is a measurement setup mismatch, not an application layout defect. | — | — | MISMATCH | [After](media/01-09-mobile-google-help-after.png) · [Before](media/01-09-mobile-google-help-before.png) |
| 01-10 | Mobile setup | Send browser zoom reset shortcut | Restore 100% zoom | Document remains 520x1125. Required mobile size and DPR are unverified. | — | — | MISMATCH | [After](media/01-10-reset-page-zoom-after.png) · [Before](media/01-10-reset-page-zoom-before.png) |
| 01-12 | Beat 1 recovery | Attempt client fill after timeout | Client field remains available | Timeout rerender collapsed help, so locator had no match. Automation error; no client entered. | — | — | ERROR | [After](media/01-12-existing-client-setup-after.png) · [Before](media/01-12-existing-client-setup-before.png) |
| 01-13 | Beat 1 recovery | Attempt Save after missing field | Save control available | No matching Save control because help was collapsed. Dependent automation action was attempted after a failed fill; excluded from product defects. | — | — | ERROR | [After](media/01-13-save-client-after.png) · [Before](media/01-13-save-client-before.png) |
| 01-14 | Beat 1 recovery | Reopen Client ID help | Input and Save visible | Help reopens; recovery controls return. | — | — | OK | [After](media/01-14-reopen-client-help-after.png) · [Before](media/01-14-reopen-client-help-before.png) |
| 01-15 | Beat 1 recovery | Enter existing project OAuth client | Public client identifier accepted | Existing client from local config entered through UI. No application source changed. | — | — | OK | [After](media/01-15-fill-existing-oauth-client-after.png) · [Before](media/01-15-fill-existing-oauth-client-before.png) |
| 01-16 | Beat 1 recovery | Save existing client | Ready to authenticate | Client ID saved. Continue with Google below. Button is above the message despite the word below; old error text persists in DOM, with visual exposure unverified. | — | — | MISMATCH | [After](media/01-16-save-existing-client-after.png) · [Before](media/01-16-save-existing-client-before.png) |
| 01-17 | Beat 1 recovery | Continue after client save | Google authentication popup | A Google Accounts sign-in tab appears. User-operated authentication requested; completion not verified. | — | — | OK | [After](media/01-17-google-after-client-save-after.png) · [Before](media/01-17-google-after-client-save-before.png) |


---

## 3. Timing & Latency Telemetry
### 3.1 Latency Distribution by Surface
- **Onboarding:** end-to-end setup has not completed. Auth wait starts despite a known missing prerequisite. First timeout was observed by 06:22:42Z; source constant is 120 seconds, not a directly measured exact timeout. [Waiting](media/01-07-google-auth-gate-after.png), [timeout](media/01-12-existing-client-setup-after.png), [source](media/source-review.json).
- **Kanban, discovery and generation:** no live latency, frame-drop, TTFT, token-use or re-score measurements yet. [Stopping point](media/01-17-google-after-client-save-after.png).
- **Console:** two unique initial messages: `[dawn-data:p2] role-shape fail Object` (warning, dawn-data.js) and `[JobBored startup] window:error Object` (error). Serialized object details and stack frames were not supplied by the browser interface. The root cause is unconfirmed. [DOM/log record](../2026-09-07-astra-audit/telemetry.json), [initial screen](media/01-01-greenfield-initial.png).
- **Network:** health checks only. No HAR, full request headers/bodies, interception, packet capture, heap measurements, CLS, or profiler traces were collected. [Capability limitations](media/baseline.json).

### 3.2 Promise vs. Reality Tracking
| Surface / Flow | UI Promise Copy | Actual Measured Time | Delta / Variance |
|---|---|---|---|
| Setup | about fifteen focused minutes / about 15 min left | Incomplete; waiting for user authentication | Not computable |
| Google prerequisite | Continue with Google | Immediate prerequisite error plus waiting UI; source timeout 120 s | Contradictory state, not a timed completed flow |
| Applied undo | Requested matrix specifies 5 seconds | submission-flow.js sets 10 seconds; live path untested | Source/matrix difference only |

Evidence: [setup](media/01-03-restore-invitation-after.png), [Google](media/01-07-google-auth-gate-after.png), [source](media/source-review.json).

---

## 4. Detailed Defect & Issue Log

### [DEFECT-001] Missing OAuth prerequisite enters long sign-in waiting state
- **Severity:** MAJOR
- **Phase & Step:** Phase 1, 01-07 and 01-12
- **Surface / Component:** oneflow-beat-google.js / Google setup
- **Verbatim UI Error / Log:** `Google sign-in is not ready yet. Save your OAuth client and reload first.`
- **Observed Behavior:** Continue is disabled and Waiting for Google sign-in appears. The DOM contains the immediate prerequisite error, but the screenshot does not display that error; sighted users see the waiting state. Later failure suggests allowing popups, which does not address a missing client. Help remains reachable, so this is recoverable.
- **Console Evidence:** startup generic object error also observed; causal connection is unverified.
- **Network Evidence:** No request capture; no claim about whether the first click contacted Google.
- **Screenshot Ref:** [waiting/error](media/01-07-google-auth-gate-after.png), [later timeout](media/01-12-existing-client-setup-after.png).

### [DEFECT-002] Client-save instruction points below a button located above
- **Severity:** COSMETIC
- **Phase & Step:** Phase 1, 01-16
- **Surface / Component:** Google setup feedback
- **Verbatim UI Error / Log:** `Client ID saved. Continue with Google below.` coexists with `Google sign-in is not ready yet. Save your OAuth client and reload first.`
- **Observed Behavior:** The visible success message says Continue with Google below, but the button is above it. A stale failure also remains in the accessibility snapshot; the screenshot does not establish that the old toast is visually exposed. The subsequent action opens Google sign-in.
- **Console Evidence:** No additional specific exception established.
- **Network Evidence:** Not captured.
- **Screenshot Ref:** [saved client feedback](media/01-16-save-existing-client-after.png).

### [DEFECT-003] Greenfield DOM retains old materials-queue content
- **Severity:** MINOR (pending accessibility and storage reproduction)
- **Phase & Step:** Phase 1, 01-02
- **Surface / Component:** Materials queue / greenfield reset
- **Verbatim UI Error / Log:** `STALLED?`, `97h 39m`, `CSC Generation · Director, Lifecycle Marketing & CRM` in captured accessibility DOM.
- **Observed Behavior:** Old queue content appears in the DOM snapshot after the requested reset. The S0 screenshot overlays the application; visual exposure to sighted users is not established. Source resets one IndexedDB database on a best-effort basis. Storage origin and causality remain unverified.
- **Console Evidence:** DOM in telemetry.json; no specific queue exception.
- **Network Evidence:** Not captured.
- **Screenshot Ref:** [screen associated with DOM](media/01-02-poke-around-after.png).

### Audit limitations and specification differences (not confirmed application defects)
- Initial requested mobile override produced a 520×1125 document, not 390×844; inherited 75% zoom and screenshot scaling need correction. DPR 1.0 has not been verified. Do not accept these captures as the required mobile floor. [Evidence](media/baseline.json), [capture](media/01-09-mobile-google-help-after.png).
- Setup pill opens Beat 1 directly, whereas the matrix asks it to restore the invitation. [Evidence](media/01-03-restore-invitation-after.png).
- Source exposes a 10-second submission undo constant and themes Classic, Compact, Serif emphasis, Muted, High contrast. These differ from matrix assumptions; verify the live active route before assigning product defects. [Evidence](media/source-review.json).

---

## 5. Areas for Optimization (Actionable Backlog)
1. **Frontend & Rendering Performance:** investigate the startup error before profiling; obtain stack details and verify that no initialization branch is skipped. Establish true CSS viewport and DPR, then collect layout-shift and frame data. Existing evidence does not establish paint thrashing. [Baseline](media/baseline.json).
2. **AI Engine & Token Optimization:** ATS payload already clips individual fields, including 10,000 profile characters and 8,000 resume characters; do not claim unbounded inputs. Measure actual aggregate payload/token sizes and duplicate context before proposing pruning or caching. Generation and SSE improvements remain hypotheses. [Source](media/source-review.json).
3. **UX, Ergonomics & Information Architecture:** reject missing OAuth prerequisites before entering the sign-in wait; align success copy with button position and inspect stale accessibility feedback on recovery; explain actual prerequisite failure rather than defaulting to popup advice. [Waiting](media/01-07-google-auth-gate-after.png), [recovery](media/01-16-save-existing-client-after.png).
4. **System Architecture & Resilience:** investigate best-effort greenfield IndexedDB cleanup and isolation from pre-existing queue content. Test runtime token persistence and worker snapshots before claiming secret hygiene. Source stores runtime bearer state in sessionStorage and strips the nonempty discovery request token before downstream request persistence; this is not runtime verification. [Source](media/source-review.json), [associated screen](media/01-02-poke-around-after.png).

The selected component floor passed **72/72**, zero failures and zero skips, across eight existing test files. This includes stage registry, company cap, atomic transitions, polling, URL guard, Settings URL guard, and greenfield tests. It is supplemental evidence and does not replace the live flows. [Exact output](media/component-checks.txt).

---

## 6. Surfaces Not Reached & Dead Ends
The active stopping point is Google sign-in. User completion has been requested; the Comet audit tab is preserved. The following remains pending, with no simulated success or fabricated timings. [Stopping screenshot](media/01-17-google-after-client-save-after.png).

| Step | Surface / edge case | Why not verified |
|---|---|---|
| 1.1 | S0 KPI pills, Make it mine primary CTA, true 390x844 S0 | Sample roles/collapse observed. KPI summary absent from captured S0; primary CTA was not clicked separately. Mobile override did not yield required CSS size. |
| 1.2 | Both authenticated Sheet connection branches | Google sign-in pending; empty-link validation and branch navigation observed. No template created or Sheet verified. |
| 1.3 | Beat 2 provider choices, malformed and valid AI key checks | Blocked upstream at Beat 1. |
| 1.4 | Beat 3 TXT/PDF upload, paste, extraction, interruption, IndexedDB persistence | Blocked upstream at Beat 1. |
| 1.5 | Beat 4 fit field edits and required mobile audit | Blocked upstream at Beat 1. |
| 1.6 | Beat 5 SerpApi, local/Tailscale/relay paths | Blocked upstream at Beat 1. |
| 1.7 | Beat 6 celebration and discovery handoff | Blocked upstream at Beat 1. |
| 2 | Dashboard KPIs, Daily Brief, Today Queue, filters, search, sorting, closed visibility, company expansion, expired review and cleanup | Authenticated dashboard not reached from greenfield path. |
| 3.1 | Nine-stage pointer drag, capture, ghost, duplicates, frame timing and event dispatch | Real pipeline not reached; S0 is a separate demo surface. |
| 3.2 | Applied confirmation, undo, delayed commit and Column N date | Real writable pipeline not reached. Source has a 10-second submission-flow constant; live route timing unverified. |
| 3.3 | Keyboard stage menu, ARIA and focus traps | Not reached on real pipeline. |
| 3.4 | Optimistic rollback with network failure | Not reached; network blocking capability unavailable through connected browser API. |
| 3.5 | Column-collapse persistence and mobile Kanban | Not reached; required viewport/DPR remains unverified. |
| 4.1 | Discovery connection, sources, context and automation tabs | Drawer not reached; worker health alone reports readiness. |
| 4.2 | Preflight payload, POST webhook and x-discovery-secret | Not dispatched. No live payload/header evidence. |
| 4.3 | Async ack, statusToken preservation, polling and phase progression | Not dispatched. Component test evidence only. |
| 4.4 | Sheet append columns, second-run dedupe, edit lock Y and DiscoveryRuns | Not dispatched; no Sheet mutations or audit rows verified. |
| 5.1 | Role dossier, posting text and provenance labels | Not reached from greenfield path. |
| 5.2 | Cover-letter guidance, first token, completion and token use | Not generated. |
| 5.3 | Quick tools, custom refinement and version history | Not generated. |
| 5.4 | Resume tailoring, skills and gaps | Not generated. |
| 5.5 | ATS scorecard, Address actions and 1.2-second debounce | Health reports configured Gemini; no scoring request made. |
| 5.6 | Themes, clipboard and Print/PDF | Not reached. Source theme names differ from requested matrix. |
| 6 | Unsafe remote HTTP URL, runtime token scrubbing and offline resilience | Source and selected component tests only; no live Settings or network fault injection. |

All pending rows refer to the actual [Beat 1 stopping point](media/01-17-google-after-client-save-after.png), not fabricated screenshots of unreached screens. Source code and git metadata have not been modified; the only intended workspace additions are this audit directory. No live job-stage or Sheet writes, discovery runs, AI generations, exports, or crash-recovery tests have been performed. Final repository-state verification is recorded when the checkpoint is saved.

Repository-state checkpoint: [git status](media/repository-status.txt). The pre-existing tracked modification remains; this audit directory is the new untracked entry.
