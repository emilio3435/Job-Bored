# Plan — Opus 4.7 JobBored Materials Interface

Goal: Build a professional JobBored-stylized interface that lets Emilio review and download existing researched application materials from the dashboard.

Success means:
- JobBored lists every application folder with generated resume and cover-letter materials under `~/.hermes/job-hunt/applications/`.
- Each ready opportunity has a polished materials view with tailored resume, cover letter, job analysis, and QA/checklist affordances.
- The UI follows JobBored's existing vanilla HTML/CSS/JS architecture and visual language.
- The implementation serves local files through a safe local-only contract with path traversal protection and known-file allowlists.
- Phase 7 assisted submit remains an explicit later action available only when Emilio requests `ASSIST APPLY <company>`.

Stop when: The dashboard can open a researched opportunity, show professional document cards for its resume and cover letter, preview or download the generated artifacts, and pass focused tests for manifest/file safety plus UI rendering.

## Prompt For Opus 4.7

Goal: Implement the JobBored materials review interface for researched opportunities that already have generated application documents.

Success means:
- Read `README.md`, `app.js`, `index.html`, `role.js`, `role-brief.js`, `role-workshop.js`, `style.css`, `server/index.mjs`, and `integrations/hermes-job-hunt/HANDOFF-2026-05-27-materials-first-jobbored-ux.md` before editing.
- Inspect `~/.hermes/job-hunt/applications/` and model the ready state around folders containing `job-analysis.md` plus resume and cover-letter PDF or HTML files.
- Add a local materials contract that exposes application manifests and known-safe files from `~/.hermes/job-hunt/applications/`.
- Render an `Application Materials` section in the role dossier/workshop experience with JobBored-native typography, spacing, badges, and document actions.
- Show Tailored Resume and Cover Letter as first-class cards with status, last modified time, file type, preview/open, and download actions.
- Show Job Analysis and QA Report as supporting cards when files exist.
- Keep incomplete folders visible only when useful as `Analysis ready` or `Materials pending`; make complete folders the default success path.
- Add focused tests for manifest discovery, path safety, content-type handling, and DOM rendering.
- Run the smallest relevant test set first, then the repo checks needed for confidence.

Stop when: The user can start JobBored locally, open a researched role with generated materials, preview or download the resume and cover letter, and see a concise verification report with tests run and residual gaps.

Implementation path:
1. Trace the current dossier flow from Pipeline card click to role render.
2. Trace the local server shape and choose the smallest backend addition for local artifact access.
3. Define a manifest shape in code that can be generated from existing folders without requiring Hermes to create `manifest.json` first.
4. Add local-only API routes under `server/index.mjs` or the existing local server boundary:
   - `GET /api/applications`
   - `GET /api/applications/:slug/manifest`
   - `GET /api/applications/:slug/files/:filename`
5. Resolve the applications root from `HERMES_APPLICATIONS_DIR` or `~/.hermes/job-hunt/applications`.
6. Allow only these filenames: `resume.pdf`, `resume.html`, `cover-letter.pdf`, `cover-letter.html`, `qa-report.md`, `job-analysis.md`, `job-description.md`, `manual-apply-checklist.md`, `manifest.json`.
7. Match each manifest to Pipeline rows by normalized company/title slug first, then by company/title metadata when available.
8. Add dossier-side UI that feels like JobBored: compact command-center cards, clear status chips, restrained accent color, dense scannable document metadata, and direct actions.
9. Use existing toast and drawer/modal patterns for preview errors and unavailable files.
10. Document the local workflow in `README.md` or the Hermes handoff only where the user needs to run or verify it.

Safety boundaries:
- Treat `~/.hermes/job-hunt/applications` as local private data.
- Serve only files inside the configured applications root after resolving real paths.
- Keep generated document content out of tests and logs.
- Keep assisted apply and submit automation outside this implementation path; surface only review, download, manual apply readiness, and optional revision hooks.

Suggested verification:
- Unit test manifest generation with complete Chartis/TEGNA/CrowdStrike-style fixtures.
- Unit test rejected path traversal and unknown filenames.
- Browser or DOM test for rendered document cards on a role with matching materials.
- Manual smoke: `npm start`, open `http://localhost:8080`, open a researched role, confirm resume and cover-letter actions are visible.
