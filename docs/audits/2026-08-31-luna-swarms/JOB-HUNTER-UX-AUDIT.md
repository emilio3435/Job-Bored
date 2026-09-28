# Job-hunter UX audit

This report consolidates 121 raw defect claims and 68 product proposals from 14 job-hunter lanes. Current behavior is separated from proposals; authenticated writes, paid providers, applications, and external messages were not exercised.

## Product thesis

The underlying product is more capable than the default experience communicates. JobBored already models jobs, stages, fit, source, follow-up, contact, reply state, materials, discovery telemetry, and profile data. The primary UX problem is fragmentation: different surfaces own different subsets, and several visible controls are legacy, inert, stale, or wired to a different state source.

A serious job hunter should be able to answer four questions without reconstructing the system:

1. What needs my attention today?
2. What evidence supports this opportunity and how fresh is it?
3. What exactly will this action save, send, install, or change?
4. What happened after I applied, and what should I learn from it?

The current default UI answers those inconsistently.

## Journey evaluation

| Journey | Current strengths | Current friction | Desired outcome |
|---|---|---|---|
| First run | Strong user-owned Sheet framing; OAuth recovery guide; existing/new Sheet options; multiple providers. | AI and discovery behave like gates; “connected” can mean only syntactically saved; no clear defer path; setup can create a duplicate Sheet. | Reach a useful Sheet-backed tracker first, then complete optional capabilities from a truthful checklist. |
| Candidate profile | Rich canonical schema, atomic server save, backups, hard constraints, scorer integration. | “Profile” means browser resume/context, disk Fit Profile, discovery overrides, and draft context; full wizard starts blank; tie breakers can disappear. | One named Fit Profile with explicit storage, downstream use, and per-run override boundaries. |
| Discovery intent | Good roles/locations/keywords/source controls; safe/adjacent/stretch framing; worker source registry. | Saved profile is fetched from the wrong origin, blocklists/opt-outs can be ignored, unknown company names can broaden search, and the actual rotated query is invisible. | Preview the exact effective query, companies, sources, costs, and profile inputs before Run. |
| Connection and automation | Worker health, relay, schedules, and run tracker concepts are present. | Unverified state can appear green; controls are inert; Cloudflare can be diagnosed as ngrok; opening setup can silently install keep-alive. | One setup flow with explicit ownership, verification, installation consent, and durable health status. |
| Intake | URL, manual fallback, worker extraction, async status, provider lanes, and dedupe foundations exist. | No preview before write; transport failures can strand v2 users; Description becomes Notes; employer/source can be inferred incorrectly; alternate URLs duplicate rows. | Capture first, preview evidence, edit, dedupe/merge, then commit. Preserve all source lineage. |
| Daily triage | Rich cards, search, filters, fit, stage movement, notes, and a polished newspaper visual direction. | Two competing boards, conflicting stage semantics, wrong Lattice fit percentages, hidden Priority, and the default Brief omits follow-ups. | One canonical board plus a short Today queue for due, replied, stale, new, and scheduled work. |
| Mobile | Signed-out gate is coherent and primary controls are large; responsive CSS exists. | Wide/nested boards, small hover-dependent actions, no explicit touch stage picker, hidden scrollbars, no verified soft-keyboard handling. | Phone-first Today view, 44px actions, explicit Move menu, dossier route/bottom sheet, real-device keyboard proof. |
| Dossier/evaluation | Role facts, fit prose, requirements, tools, talking points, notes, and materials entry points exist. | Inference can be labeled posting-grounded; cache age/source are hidden; CRM/stage/deadline facts are absent; malformed AI markers can render as facts. | One decision page with evidence, freshness, confidence, stage, deadline, contact, follow-up, and apply/hold/pass. |
| Resume/cover letter | Multiple provider paths, local version chain for generated drafts, Hermes repair paths, QA artifacts, and export concepts exist. | Scribe can be blank, is disconnected from role/draft state, uses demo ATS scoring, loses edits, and hides QA/source artifacts. | Role-bound versioned editor with real score evidence, diff, autosave, artifact completeness, and review/export states. |
| Application | Status writeback and materials preparation exist; external submission remains human-controlled. | Dragging to Applied is treated as submission, with no confirmation, receipt, checklist, source, or atomic date/follow-up side effects. | Explicit human “Mark submitted” flow with evidence, date/time/source, checklist, follow-up, and undo. |
| Recruiter/interview | Schema already has contact, last contact, reply, and follow-up; helper logic knows stale/prep concepts. | Active v2 hides CRM fields; no interview event model; prep flags depend on attributes production never emits. | Visible recruiter strip and append-only activity/interview timeline with next action. |
| Rejection/archive/restore | Expiry classifier, cleanup worker, review modal, dismiss/restore primitives, and audit-note contract exist. | Terminal taxonomies conflict, cleanup review reasons disappear, direct expiry skips audit side effects, visible dismissed rows lack restore. | One closure model distinguishing rejected, passed, expired, dismissed, archived, and restored, with reversible actions. |
| Reporting/learning | Run telemetry, variation keys, source counters, fit-ranked leads, and funnel UI exist. | “Last 30 days” is a current snapshot; Runs columns shift; partial runs hide; zero and unavailable blur; no event-based conversion funnel. | True cohort funnel, per-source diagnostics, experiments, and explicit zero/unavailable/sample states. |
| Accessibility/privacy/trust | Several strong modal implementations; focus styles; conservative AI prompting; user-owned data model. | Toasts are silent to screen readers, dialog patterns diverge, tabs point to missing panels, nested controls conflict, privacy copy contradicts provider/token behavior. | Shared accessible primitives and a provider/data-flow receipt before consequential actions. |

## What is worth preserving

- User ownership of the Google Sheet and local profile/material data.
- Fail-closed worker authentication and request-scoped token stripping.
- Deterministic hard-constraint scoring before LLM scoring.
- Explicit human boundaries around submission and external communication.
- Provider choice, BYOK support, and local-provider options.
- Async run IDs/status paths and a durable DiscoveryRuns concept.
- Rich failure recovery in parts of the materials pipeline.
- Existing inert/focus patterns in Settings, onboarding, and the discovery wizard; these are good candidates for a shared primitive.
- The visual identity and newspaper-like hierarchy, after the duplicate/inert surfaces are removed.

## Highest-value UX repairs

### Make truth visible

- Replace generic ready/error labels with verified, ready-to-test, blocked, stale, partial, and unavailable states.
- Distinguish measured zero from missing telemetry.
- Label every AI-derived field as posting-grounded, user-provided, inferred, or unknown.
- Show source method, fetched time, profile version, provider, and confidence near the claim they qualify.
- Never call a Sheet connected before access and header verification.
- Never call a draft Ready while an older artifact is being replaced.

### Reduce competing ownership

- One Pipeline renderer and stage registry.
- One effective profile/intent object.
- One discovery setup flow.
- One status-transition writer.
- One modal/focus controller.
- One current documentation contract for Daily Brief, Runs, Dossier, and materials.

### Restore the daily job-hunter loop

The default first screen should prioritize:

1. Replies received.
2. Follow-ups overdue or due soon.
3. Interviews needing preparation.
4. Applications becoming stale.
5. High-fit new opportunities awaiting a decision.

Each item should offer one direct next action and retain the user's board position after completion.

### Make consequential actions explicit

Before an action writes, sends, installs, or calls a provider, show:

- target role or machine component;
- destination/provider;
- data categories leaving the browser;
- Sheet/local fields that will change;
- whether the action is reversible;
- what evidence will confirm completion.

This is especially important for setup repair, keep-alive/autostart, AI generation, cleanup, rescore, application tracking, and any future submission flow.

## Quick UX wins

- Correct onboarding step count and ARIA maximum from one constant.
- Add `Leads Updated` to Runs headers and expose Partial filtering.
- Wire or de-button the Dawn funnel rows.
- Relabel 30-day snapshot metrics accurately until real date filtering exists.
- Route Discovery and Rescore profile calls through the configured API base.
- Add a v2 manual-entry CTA to every Add-URL failure state.
- Show stale/fetched/source badges in the Dossier.
- Replace hard-coded Gemini copy with the configured provider or neutral language.
- Add visible Save/Unsaved/Failed state to Scribe and Notes.
- Rename/remove the dead Letter navigation target.
- Make Notes and Fit Profile controls programmatically labeled.
- Add live regions for toasts, upload parsing, saves, and run-status changes.
- Give card actions 44px hit areas and expose them without hover on touch layouts.
- Add a visible `Move to stage` menu to the active board.
- Separate “Clear settings” from “Delete local resumes, drafts, samples, context, OAuth, and consent.”

## Strategic UX changes

- Canonical Pipeline view model shared by Today, board, dossier, search, and reports.
- Decision-facts rail in Dossier: stage, evidence age, deadline, source, contact, reply, follow-up, application state, and next action.
- Capture preview and duplicate merge center.
- Saved discovery searches with a deterministic “this run will search” preview.
- Recruiter/interview timeline and calendar-aware preparation.
- Materials workspace with role binding, real ATS evidence, diff/version history, autosave, completeness, and human review gates.
- True event-based reporting instead of deriving history from current status.
- Shared modal/drawer primitive plus automated desktop/tablet/phone accessibility coverage.

## Research still needed

- Clean authenticated Google OAuth + real Sheet browser journey with a disposable test account/Sheet.
- Real iOS and Android soft-keyboard geometry.
- Hosted browser-to-API authentication design.
- Real Cloudflare named/quick and ngrok recovery on each supported OS.
- External provider cancellation, rate-limit, and data-flow confirmation.
- User testing of whether Today, Pipeline, Dossier, and Materials match real weekly job-search behavior.

## Lane coverage

| Lane | Job-hunter mission | Result |
|---|---|---|
| U01 | First-run setup and workspace access | COMPLETE |
| U02 | Candidate profile and fit personalization | COMPLETE |
| U03 | Discovery intent and source curation | COMPLETE |
| U04 | Connection, automation, and run history | COMPLETE |
| U05 | Intake, import, dedupe, and enrichment trust | COMPLETE |
| U06 | Pipeline information architecture and daily triage | COMPLETE |
| U07 | Mobile, touch, and keyboard | COMPLETE |
| U08 | Dossier and opportunity evaluation | COMPLETE |
| U09 | Resume, cover letter, and materials | COMPLETE |
| U10 | Application and submission tracking | COMPLETE |
| U11 | Recruiter follow-up and interviews | COMPLETE |
| U12 | Rejection, expiry, archive, and restore | COMPLETE |
| U13 | Reporting, outcomes, learning, and motivation | COMPLETE |
| U14 | Accessibility, privacy, AI trust, and broad wishlist | COMPLETE |
