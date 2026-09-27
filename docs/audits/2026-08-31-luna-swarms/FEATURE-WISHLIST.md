# JobBored feature wishlist

This wishlist is grounded in the 14 job-hunter lanes. It intentionally separates repair work from net-new capability: the P0/P1 items in `CRITICAL-AUDIT.md` come first.

## Tier 0 — finish the product already present

These are not speculative features. They make existing promises coherent.

| Capability | User value | Acceptance signal |
|---|---|---|
| One canonical Pipeline | Removes contradictory stages, counts, filters, and write paths. | One board DOM, toolbar, role count, stage registry, and transition writer. |
| Today attention queue | Prevents missed replies, follow-ups, interviews, and stale applications. | Default Brief ranks due/replied/prep/stale work before ordinary new leads. |
| Truthful setup state | Lets non-engineers know what works. | Verified, ready-to-test, partial, blocked, stale, and disconnected are distinct; setup never installs silently. |
| Effective discovery preview | Makes each run auditable before cost or writes. | Preview equals the request: roles, locations, companies, exclusions, sources, query rotation, provider use, and profile version. |
| Dossier evidence panel | Restores trust in AI summaries and fit. | Every claim is posting-grounded, user-provided, inferred, or unknown, with source and fetched time. |
| Explicit submission confirmation | Makes Applied a human fact rather than a drag gesture. | “Mark submitted” captures date, source, optional receipt/checklist, follow-up, and undo. |
| Recruiter CRM strip | Uses fields the Sheet already has. | Dossier and cards expose contact, last contact, reply state, follow-up, and next action. |
| Role-bound Scribe | Turns the current editor into a real workspace. | Selected role/document is visible; edits autosave/version; score is real; refine completion is promise-driven. |
| Closure and restore model | Makes terminal states understandable and reversible. | Rejected, Passed, Expired, Dismissed, Archived, and Restored have distinct meaning and actions. |
| Accessible app primitives | Removes per-modal and per-toast inconsistency. | Shared dialog, drawer, live-region, tabs/navigation, field-label, and focus-restoration tests pass. |

## Tier 1 — high-leverage product additions

### 1. Capture inbox and extraction preview

User job: save promising roles quickly without polluting the source of truth.

Capability:

- browser share/bookmarklet and multiline URL paste;
- extraction queue with pending/running/needs-review/ready states;
- pre-write preview for title, employer, location, salary, source, evidence, and missing fields;
- explicit Save, Edit, Save anyway, Retry, and Cancel;
- partial-field preservation after blocked or timed-out extraction.

Acceptance signal: twenty URLs can be queued, previewed, deduped, retried, and committed individually; no Sheet write occurs before confirmation.

### 2. Duplicate review and merge center

User job: unify the same opportunity found through employer, ATS, LinkedIn, referral, or redirect URLs.

Capability:

- canonical URL/provider ID/semantic fingerprint matching;
- side-by-side field conflicts and timestamps;
- keep-both, merge, or alias-source decisions;
- preserved source lineage.

Acceptance signal: submitting an alternate URL shows the existing role, all known source URLs, field conflicts, and an explicit merge decision.

### 3. Saved searches and scheduled search plans

User job: run repeatable discovery without re-entering intent.

Capability:

- named searches with profile-default, one-off, and scheduled modes;
- exact source/company/query preview;
- run budget and provider-cost policy;
- version history and change diff;
- explicit pause and next-run time.

Acceptance signal: a scheduled run records the exact versioned search plan used and can be reproduced manually.

### 4. Opportunity comparison tray

User job: choose where to invest limited application time.

Capability:

- select two to five roles;
- compare source quality, freshness, confidence, must-have evidence, compensation, work mode, stage, deadline, materials effort, and next action;
- explicit apply/hold/pass decision.

Acceptance signal: missing values remain Unknown; no inferred field is presented as verified; decisions write through the canonical transition path.

### 5. Decision facts and next-action rail

User job: decide from one Dossier without reconstructing context from the board and Sheet.

Capability:

- stage and time in stage;
- posting freshness/source;
- deadline;
- application status and submission evidence;
- contact/reply/follow-up;
- material readiness;
- one recommended next action with rationale.

Acceptance signal: populated fixture data appears in one compact, keyboard-accessible rail; absent facts say Unknown.

### 6. Recruiter activity and interview timeline

User job: remember who said what and prepare for the next round.

Capability:

- append-only contact events;
- participants, channel, outcome, notes, and next action;
- interview date/time/timezone, round, format, names, meeting link, and preparation status;
- calendar reminders without making calendar access mandatory.

Acceptance signal: the system can distinguish awaiting reply, recruiter reply, phone screen, scheduled interview, completed round, and next-round follow-up.

### 7. Materials review workspace

User job: confidently finalize a tailored resume or cover letter without losing edits or provenance.

Capability:

- document type and role binding;
- autosave and named versions;
- before/after diff for refinements;
- real ATS evidence separated from job-fit score;
- source-claim audit;
- visible QA report, job analysis, checklist, and saved job description;
- clear Prepare, Generate, Review, Export, and Send states.

Acceptance signal: every version identifies source role/profile/provider, changed claims, evidence, save status, and export artifacts; no generated draft can be confused with submitted material.

### 8. Source-quality run drill-down

User job: understand why discovery was sparse or noisy.

Capability:

- per source/company attempted, seen, accepted, rejected, duplicate, written, and updated counts;
- rejection reasons and provider/transport failures;
- run query/profile/config version;
- durable partial/timeout history.

Acceptance signal: every terminal run can be reopened after reload and explains both output and degradation.

### 9. Phone-first role workflow

User job: triage and update roles one-handed.

Capability:

- Today as the first mobile view;
- card-to-dossier route or bottom sheet preserving board position;
- sticky primary actions;
- explicit Move menu and optional undoable swipe;
- visible scroll/stage position cues;
- keyboard-aware notes/search/editor layout.

Acceptance signal: at 320, 375, and 393px, every primary action has a 44px target and no required action depends on hover or native drag.

### 10. Setup and automation control center

User job: operate scheduled discovery without understanding launchd/systemd/ngrok/cloudflared internals.

Capability:

- selected transport and endpoint ownership;
- worker/tunnel/relay/Sheet credential health;
- explicit install/uninstall/restart actions;
- last successful run and next scheduled run;
- logs and bounded repair steps;
- no background install from a diagnostic screen.

Acceptance signal: the UI distinguishes saved intent, installed artifact, active job, reachable endpoint, verified discovery, and recent successful execution.

## Tier 2 — strategic data model

### Event-sourced opportunity timeline

Add append-only events for discovery, review, stage movement, application, contact, reply, interview, offer, rejection, pass, expiry, dismissal, restore, and material generation.

Why: current-status rows cannot support truthful conversion reporting, time-in-stage analysis, or conflict-safe history.

Acceptance signal: current Pipeline state can be reconstructed from events, while the Sheet remains understandable and user-owned.

### True outcome funnel and cohorts

Report discovered → researched → applied → replied → phone screen → interview → offer/rejected/passed by cohort, source, role family, and variation.

Acceptance signal: every rate shows denominator, unknown attribution, sample size, and date window; snapshot metrics are labeled separately.

### Field evidence ledger

Store per-field value, source URL/artifact, extraction method, timestamp, confidence, and user override.

Acceptance signal: title, employer, location, salary, requirements, and summary can each explain their provenance after reload and across browsers.

### Canonical candidate context

Unify Fit Profile, browser materials, discovery overrides, and draft context without forcing them into one storage location.

Acceptance signal: every field states `Saved in`, `Used by`, `Applies when`, and whether it is profile-default or run-only.

## Tier 3 — ambitious wishlist

### Experiment lab

Turn variation keys into named hypotheses comparing source presets, search plans, profile changes, and materials strategies against downstream outcomes.

Acceptance signal: comparison includes sample size, timebox, unknown attribution, and no claim of causation without enough data.

### Personal search health dashboard

Weekly view of source quality, response latency, conversion, time in stage, follow-up adherence, evidence freshness, and one suggested repeat/stop/test action.

Acceptance signal: every number is traceable to event/source data and can be exported.

### Burnout-sensitive planning

Active, Casual, and Coasting modes should change workload guidance. Add daily/weekly budgets, pause/snooze, recovery days, and a clear stop-for-today state.

Acceptance signal: recommendations adapt to the selected pace and never equate application volume with success.

### Grounded interview preparation packet

Combine posting evidence, company research, recruiter timeline, interview round, candidate examples, questions, and uncertainty into a reviewable prep packet.

Acceptance signal: every company/job claim has a source and timestamp; user evidence is never fabricated.

### Portable encrypted workspace

Export/import the local profile, resume library, writing samples, drafts, saved searches, and settings without exposing OAuth/provider secrets by default.

Acceptance signal: a second device can restore the workspace with a manifest of included/excluded data and explicit secret re-entry.

### Job-site capture companion

A browser extension or share target can capture the current posting, source snapshot, and selected excerpt into the intake inbox without submitting an application.

Acceptance signal: capture is preview-only, visibly local, dedupe-aware, and cannot auto-submit.

## Explicit non-goals and safety boundaries

- No automatic job submission without a separate, explicit user decision for each application.
- No payment, identity verification, legal attestation, signature, provider contact, or external message without human control.
- No background service installation from opening or inspecting Settings.
- No AI-generated employer/job claim presented as verified without evidence.
- No analytics that hide missing data as zero or overstate causality.
