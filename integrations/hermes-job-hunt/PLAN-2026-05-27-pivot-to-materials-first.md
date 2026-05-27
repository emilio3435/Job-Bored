# JHOS Pivot Plan — Materials-First Job Hunt OS

**Date:** 2026-05-27
**Decision:** De-emphasize full application automation. Put job finding, tracking, and high-quality tailored resume / cover-letter drafting front and center.

---

## Plain-English operating model

The system should help Emilio do three things extremely well:

1. Find good roles.
2. Track progress clearly.
3. Produce excellent custom application materials quickly.

Browser form filling / auto-submit becomes optional, manual, and late-stage only.

---

## What stays valuable from existing work

### Keep as active core

- Daily discovery worker
- Pipeline Google Sheet as source of truth
- Pipeline status summaries
- Follow-up monitor
- Profile docs
- Resume and cover-letter templates
- Per-application folders
- Job analysis / fit scoring
- Quality gates for materials

### Keep but demote

- Gate 2 submit approval
- Universal form filler
- Greenhouse filler reference
- Apply orchestrator
- ATS adapters

These remain available as "assisted apply" tools, but they are no longer the central roadmap.

### Pause or reframe

- Gate 2 status watcher should probably be paused or changed so it does not imply submit automation is the default next step after Researching.
- Phase 8 should become materials QA + discovery/tracking hardening, not universal form-filler test matrix.

---

## New workflow

### Stage 1 — Discover

Daily worker finds jobs and writes them to the Pipeline Sheet.

Outputs:
- Company
- Role
- URL
- Location / remote
- Fit score
- Match notes
- Status = New

Human action:
- Emilio reviews new jobs.
- If interested, he says `YES <COMPANY>` or updates Status to Researching.

### Stage 2 — Analyze

For each Researching role, system fetches the job description and creates:

- `job-description.md`
- `job-analysis.md`

The analysis should answer:
- Is this role worth applying to?
- What positioning angle should Emilio use?
- Which resume template/variant fits best?
- What proof points matter most?
- What risks or missing confirmations exist?

### Stage 3 — Draft materials

System creates:

- `resume.html`
- `resume.pdf`
- `cover-letter.html`
- `cover-letter.pdf`
- `qa-report.md`
- optional `recruiter-note.md`

Hard rules:
- Never invent facts.
- Never include compensation.
- Do not modify templates in place.
- Strip scaffolding before rendering PDFs.
- Verify PDF size and visual quality.

### Stage 4 — Human review

Instead of sending a submit approval by default, the system sends a materials-ready notification:

"Materials ready for [Role] @ [Company]. Review: [folder path]. Recommended action: Apply manually / revise / pass."

Emilio chooses:
- Apply manually
- Revise materials
- Park / pass
- Optional assisted form fill

### Stage 5 — Track outcome

After Emilio applies manually or confirms submission happened:

- Status → Applied
- Applied Date set
- Notes updated with material folder path
- Follow-up monitor handles reminders

---

## New Phase 8 — Materials + Tracking Hardening

Phase 8 should replace the old universal-filler test matrix.

### P8.1 — Auto-draft trigger

When a row becomes Researching:
1. Fetch JD.
2. Create application folder.
3. Write job analysis.
4. Draft resume and cover letter.
5. Render PDFs.
6. Run QA.
7. Notify materials-ready, not submit-ready.

### P8.2 — Materials QA improvements

Add/verify checks for:
- PDF exists and has reasonable size.
- No scaffold comments or template scripts remain.
- No compensation language.
- No invented facts.
- Correct company and role.
- Resume is tailored but still truthful.
- Cover letter sounds like Emilio, not generic AI prose.

### P8.3 — Tracking UX

Improve daily/weekly visibility:
- New roles needing review
- Researching roles with materials ready
- Applied roles needing follow-up
- Stale New roles to expire/pass
- Roles parked or passed with reason

### P8.4 — Resume variants

Build named resume positioning variants:
- performance-marketing
- ai-product-builder
- consulting-strategy
- sales-engineering / solutions-consulting
- ai-search-geo

The system selects one based on role analysis.

### P8.5 — Manual-apply checklist

For each application folder include `manual-apply-checklist.md`:
- Job URL
- Resume PDF path
- Cover letter PDF path
- Suggested answers for common fields
- Warnings: salary skip, legal question manual review, Workday/manual only
- Post-apply update instructions

---

## Concrete operational changes recommended

1. Pause or modify Gate 2 status watcher.
   - Current job: `e48e736a1aa0` — Gate 2 Researching Status Watcher.
   - New behavior should be materials-ready notification after drafts exist, not submit approval immediately.

2. Keep discovery cron active, but fix current error state.
   - Current job: `a72d4d8102cb` — JobBored Discovery Worker.
   - It is still core to the new plan.

3. Keep pipeline status and follow-up monitor active.
   - `351dd9ccb570` Pipeline Status.
   - `8544befd3eed` Follow-up Monitor.

4. Reclassify Phase 7 files as optional assisted-apply tools.
   - `universal_filler.py`
   - `page_state_extractor.js`
   - `apply-orchestrator.py`
   - `ats_adapters/*`

5. Create or update an auto-draft worker that is triggered by Researching rows and produces materials packages.

---

## Preferred notification language

Use "materials ready" instead of "submit approval".

Example:

📄 Materials ready
Role: Senior Digital Marketing Consultant
Company: Chartis.io
Folder: ~/.hermes/job-hunt/applications/chartis-senior-digital-marketing-consultant/

Recommended next step: Review materials, then apply manually.

Reply options:
- REVISE <company>
- APPLIED <company>
- PASS <company>
- ASSIST APPLY <company>

---

## What success looks like

The system is successful if it gives Emilio:

- a clean list of good-fit roles,
- a clear status board,
- high-quality tailored materials fast,
- fewer tabs and less repetitive writing,
- no accidental application submissions.

Auto-submit is optional garnish, not the main course.
