# Handoff — Materials-First JobBored UX + Hermes Drafting Pipeline

**Date:** 2026-05-27
**User intent:** Pivot away from making Phase 7 automated form filling the centerpiece. Instead, make JobBored excellent at moving a user from discovery → research → application-material review, with Hermes generating the dossier, tailored resume, and cover letter locally and surfacing those artifacts beautifully in the JobBored dashboard.

---

## Restatement of Emilio's request

Emilio wants to step back from full application automation and redesign the next phase around a materials-first job-search workflow.

The desired user journey is:

1. JobBored discovers jobs.
2. The user reviews discovered jobs in the JobBored dashboard.
3. The user moves a job from Discovery/New into Research.
4. Hermes automatically fetches the job description and generates:
   - job summary
   - must-haves
   - requirements
   - fit/positioning notes
   - custom resume
   - custom cover letter
5. JobBored displays the generated job dossier directly in the dashboard.
6. JobBored also surfaces beautiful, modern UX cards for the application documents:
   - tailored resume
   - tailored cover letter
   - QA/report/checklist
   - optional recruiter note
7. The user can open, preview, and download those locally generated documents for review/manual application.

In other words: Hermes remains the backstage document factory; JobBored becomes the polished front-of-house interface for reviewing opportunities and downloading tailored materials.

---

## TL;DR direction

Do **not** keep pushing Phase 7 automated submit as the main path.

New main path:

```text
Discovery → Research → Dossier → Tailored Docs → Review/Download → Manual Apply → Track Follow-up
```

Phase 7 universal filler remains optional and shelved:

```text
Optional later: ASSIST APPLY <company>
```

But the next implementation should focus on:

- Research transition workflow
- Dossier generation
- Resume/cover-letter generation
- Local artifact storage
- Dashboard UX for dossier + downloadable docs
- Tracking state between Google Sheet, Hermes artifacts, and JobBored UI

---

## Current known local artifact structure

Hermes-generated job hunt artifacts live under:

```text
~/.hermes/job-hunt/
```

Application packages already exist under:

```text
~/.hermes/job-hunt/applications/<company-role-slug>/
```

Examples discovered on disk:

```text
~/.hermes/job-hunt/applications/chartis-senior-digital-marketing-consultant/
  job-description.md
  job-analysis.md
  resume.html
  resume.pdf
  cover-letter.html
  cover-letter.pdf
  qa-report.md

~/.hermes/job-hunt/applications/tegna-digital-sales-manager/
  job-description.md
  job-analysis.md
  resume.html
  resume.pdf
  cover-letter.html
  cover-letter.pdf
  qa-report.md
```

Templates:

```text
~/.hermes/job-hunt/resume-template/resume.html
~/.hermes/job-hunt/cover-letter-template/cover-letter.html
```

Canonical profile docs:

```text
~/.hermes/job-hunt/profile/profile.md
~/.hermes/job-hunt/profile/voice.md
~/.hermes/job-hunt/profile/resume-bullets.md
~/.hermes/job-hunt/profile/job-preferences.md
```

---

## Important: JobBored repo is NOT on this machine yet

Correction from Emilio: the JobBored app repo is not currently on this machine. Do **not** waste time trying to locate `~/Job-Bored` or infer the dashboard architecture from a missing repo.

Instead, the fresh agent should first find and read the **existing local documents, specs, handoffs, generated application packages, and JobBored/Hermes job-hunt artifacts**. These are the source material for designing the next implementation.

Primary local root:

```text
~/.hermes/job-hunt/
```

Start by inventorying these documents/artifacts:

```text
~/.hermes/job-hunt/PLAN-2026-05-27-pivot-to-materials-first.md
~/.hermes/job-hunt/HANDOFF-2026-05-27-materials-first-jobbored-ux.md
~/.hermes/job-hunt/HANDOFF-2026-05-27-session4.md
~/.hermes/job-hunt/HANDOFF-2026-05-27-phase7-onwards.md
~/.hermes/job-hunt/HANDOFF-2026-05-26-session3.md
~/.hermes/job-hunt/P6-synthesis.md
~/.hermes/job-hunt/P5-synthesis.md
~/.hermes/job-hunt/P4-synthesis.md
~/.hermes/job-hunt/phase3-document-quality-gate.md
~/.hermes/job-hunt/approval-guard-spec.md
~/.hermes/job-hunt/profile/
~/.hermes/job-hunt/resume-template/
~/.hermes/job-hunt/cover-letter-template/
~/.hermes/job-hunt/applications/
~/.hermes/job-hunt/scripts/
```

Use Hermes tools, not assumptions:

```text
search_files(pattern='*', target='files', path='~/.hermes/job-hunt', limit=200)
search_files(pattern='JobBored|dossier|resume|cover letter|Researching|materials ready|Pipeline', target='content', path='~/.hermes/job-hunt', file_glob='*.md', limit=100)
```

The dashboard repo will need to be cloned, copied, or otherwise made available later. Until then, design the integration around a clear contract:

```text
Hermes local artifacts + manifest.json → future JobBored dashboard UI
```

Do not claim exact frontend components, routes, framework, or API endpoints until the actual JobBored codebase is available and inspected.

---

## Existing scheduled jobs / mechanisms

Checked via `cronjob list` on 2026-05-27.

Keep active/core:

| Job ID | Name | Purpose |
|---|---|---|
| `a72d4d8102cb` | JobBored Discovery (Worker) | Finds jobs and writes them to the Pipeline Sheet. Currently last status was error; still core and should be fixed if broken. |
| `351dd9ccb570` | Pipeline Status (Daily) | Sends daily pipeline summary. |
| `8544befd3eed` | Follow-up Monitor (Applied Roles) | Monitors Applied rows and suggests follow-ups. |
| `b4abbceb4fc2` | Morning AI Brief | Separate morning brief; unrelated but can remain. |

Already paused:

| Job ID | Name | Note |
|---|---|---|
| `e20891fa7b7c` | Daily Job Search | Old daily search, paused. |

Needs redesign/pause:

| Job ID | Name | Current issue |
|---|---|---|
| `e48e736a1aa0` | Gate 2 — Researching Status Watcher | Currently points conceptually toward submit approvals. New desired behavior is draft/materials-ready workflow, not submit-by-default. |

Recommendation:

- Pause or replace `e48e736a1aa0`.
- New watcher should detect Researching rows missing materials and trigger auto-draft.
- Notification should say “Materials ready,” not “Submit approval.”

---

## Desired state model

### Google Sheet / Pipeline remains source of truth

Pipeline row tracks job lifecycle:

```text
New → Researching → Materials Ready → Applied → Phone Screen / Interviewing / Offer / Passed / Rejected
```

If adding a status is hard, `Researching` can remain the sheet status while a separate local manifest tracks material readiness.

### Local application manifest

Each application folder should contain a machine-readable manifest for JobBored to consume:

```text
~/.hermes/job-hunt/applications/<slug>/manifest.json
```

Recommended schema:

```json
{
  "slug": "chartis-senior-digital-marketing-consultant",
  "company": "Chartis.io",
  "title": "Senior Digital Marketing Consultant",
  "job_url": "https://...",
  "pipeline_row": 123,
  "status": "materials_ready",
  "created_at": "2026-05-27T...",
  "updated_at": "2026-05-27T...",
  "dossier": {
    "summary": "...",
    "must_haves": ["..."],
    "requirements": ["..."],
    "positioning_angle": "...",
    "fit_score": 8,
    "risks": ["..."]
  },
  "documents": [
    {
      "type": "resume",
      "label": "Tailored Resume",
      "html_path": "resume.html",
      "pdf_path": "resume.pdf",
      "status": "ready",
      "size_bytes": 123456
    },
    {
      "type": "cover_letter",
      "label": "Cover Letter",
      "html_path": "cover-letter.html",
      "pdf_path": "cover-letter.pdf",
      "status": "ready",
      "size_bytes": 67890
    },
    {
      "type": "qa_report",
      "label": "QA Report",
      "path": "qa-report.md",
      "status": "ready"
    }
  ],
  "actions": {
    "recommended_next_step": "review_and_apply_manually",
    "manual_apply_checklist": "manual-apply-checklist.md"
  }
}
```

Why this matters:

- The dashboard should not have to scrape the filesystem blindly.
- Hermes can write one clear manifest per application.
- JobBored can render dossier + document cards from the manifest.

---

## Dashboard UX requirements

### Dossier section

When a user opens a Researching job in JobBored, show a dossier panel/card with:

- Summary
- Why this role fits Emilio
- Must-haves
- Requirements
- Nice-to-haves
- Positioning angle
- Resume angle chosen
- Risks / open confirmations
- Recommended next step

Desired UX tone:

- Modern
- Beautiful
- Clear
- Not a raw markdown dump
- Scannable cards / sections
- Status badges
- Document readiness indicators

### Application Docs section

Add a polished “Application Docs” module/card.

It should show:

1. Tailored Resume
   - status: generating / ready / needs review / failed
   - last updated
   - PDF size or readiness check
   - buttons: Preview, Download PDF, Open HTML if local

2. Cover Letter
   - same controls

3. QA Report / Checklist
   - view QA report
   - view manual apply checklist

Suggested actions:

- `Preview Resume`
- `Download Resume PDF`
- `Preview Cover Letter`
- `Download Cover Letter PDF`
- `Open Folder`
- `Mark Applied`
- `Request Revision`

### Local file access problem

Because Hermes writes files locally under `~/.hermes/job-hunt/applications/...`, the JobBored web UI needs a safe way to expose them.

Recommended approach:

Add a local backend endpoint to JobBored, something like:

```text
GET /api/applications/:slug/manifest
GET /api/applications/:slug/files/:filename
GET /api/applications/:slug/preview/:docType
```

Safety rules:

- Only serve files under `~/.hermes/job-hunt/applications/<slug>/`.
- No path traversal.
- Only allow known filenames/types:
  - resume.pdf
  - resume.html
  - cover-letter.pdf
  - cover-letter.html
  - qa-report.md
  - job-analysis.md
  - job-description.md
  - manual-apply-checklist.md
  - manifest.json
- Set correct content types.
- Prefer download for PDFs, inline preview for HTML/Markdown if safe.

If JobBored is currently static-only through nginx, a fresh agent must decide whether to:

1. Add a small local API server, or
2. Use an existing backend if one exists, or
3. Generate a static JSON index into the served `html/` directory.

Do not guess. Inspect actual JobBored code first.

---

## Hermes side: auto-draft worker

Need a script or worker that converts a Researching pipeline row into local materials.

Possible script:

```text
~/.hermes/job-hunt/scripts/materials_autodraft.py
```

Responsibilities:

1. Read Pipeline Sheet.
2. Find rows with Status = Researching and no complete manifest/materials.
3. Fetch job description.
4. Create application folder.
5. Generate job dossier:
   - job-description.md
   - job-analysis.md
   - manifest.json dossier block
6. Generate application docs:
   - resume.html/pdf
   - cover-letter.html/pdf
   - qa-report.md
   - manual-apply-checklist.md
7. Update manifest.json with document readiness.
8. Notify Telegram thread 3: “Materials ready.”
9. Optionally update Pipeline Notes with local folder path.

Important existing validated pattern from skill:

Two-phase drafting prevents subagent timeout:

- Phase 1: JD + analysis only.
- Phase 2: Resume + cover letter + PDFs + QA.

Use canonical profile docs and templates. Never invent facts.

---

## Recommended next implementation plan

### Task 0 — Locate JobBored repo and architecture

Find the dashboard code and determine:

- frontend framework
- backend/static server situation
- where Pipeline rows are loaded
- where dossier/job detail UI lives
- whether local API endpoints already exist
- how nginx/local dashboard is served

Do this before coding.

### Task 1 — Define application manifest contract

Create a schema/doc:

```text
~/.hermes/job-hunt/application-manifest.schema.json
```

or in JobBored repo if appropriate.

Also add a sample manifest based on Chartis or TEGNA.

### Task 2 — Build Hermes manifest writer

Add/update script to scan existing application folders and write manifests.

Script should support:

```bash
python3 ~/.hermes/job-hunt/scripts/write_application_manifest.py --app-dir <folder>
python3 ~/.hermes/job-hunt/scripts/write_application_manifest.py --all
```

### Task 3 — Add JobBored local artifact API or static index

Depending on actual architecture:

Option A — backend API:

```text
GET /api/applications
GET /api/applications/:slug/manifest
GET /api/applications/:slug/files/:filename
```

Option B — static index:

Hermes writes:

```text
<JobBored served dir>/data/applications-index.json
```

and copies/symlinks safe PDFs into a served local directory.

Prefer API if JobBored already has a backend.

### Task 4 — Dashboard dossier UI

In job detail view, add Dossier section:

- summary card
- must-haves list
- requirements list
- fit/positioning card
- risks/open questions

### Task 5 — Dashboard docs UX

Add “Application Docs” section:

- Tailored Resume card
- Cover Letter card
- QA Report card
- Manual Apply Checklist card

Each card should support:

- status badge
- preview/open
- download
- updated timestamp

### Task 6 — Researching trigger → auto-draft

Replace or redesign `e48e736a1aa0`:

Old behavior:

```text
Researching → Gate 2 submit watcher
```

New behavior:

```text
Researching → generate materials → materials-ready notification
```

### Task 7 — Manual apply tracking

Add handling for:

```text
APPLIED <company>
PASS <company>
REVISE <company>
```

This can be Telegram first, dashboard later.

---

## Do not do yet

Do not continue expanding Phase 7 form automation unless Emilio explicitly says:

```text
ASSIST APPLY <company>
```

Do not make auto-submit the default path.

Do not send Gate 2 submit prompts just because a role enters Researching.

Do not assume JobBored repo path or frontend architecture.

---

## User style/context reminders

Emilio wants:

- Plain-English explanations
- TL;DR first
- Elegant but practical UX
- Less emphasis on brittle automation
- More emphasis on high-quality materials and tracking
- Local documents surfaced accessibly in JobBored
- No accidental submissions

Assistant persona:

Sophisticated, whimsical, intelligent house-elf. Warm, direct, polished. Not cutesy. Use subtle charm, but prioritize clarity.

---

## Fresh-agent first actions

1. Read this handoff.
2. Read:
   - `~/.hermes/job-hunt/PLAN-2026-05-27-pivot-to-materials-first.md`
   - `~/.hermes/job-hunt/HANDOFF-2026-05-27-session4.md`
   - `~/.hermes/job-hunt/HANDOFF-2026-05-27-phase7-onwards.md`
3. Locate the actual JobBored dashboard repo.
4. Inspect how the dashboard currently reads Pipeline data and renders job details.
5. Propose concrete implementation plan before changing code.

---

## Short answer for Emilio

We are changing JobBored from “try to apply for me” into “find the best jobs, research them, build my best materials, and make them easy to review/download.”

Hermes will generate the dossier/resume/cover letter locally.
JobBored will show those materials beautifully in the dashboard.
The user applies manually unless they explicitly request assisted apply.
