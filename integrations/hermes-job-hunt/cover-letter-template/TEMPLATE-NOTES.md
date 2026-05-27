# Cover Letter Template Notes

Canonical cover-letter template extracted from:

`/Users/emiliong/Downloads/Cover Letter PDF Tempalte.zip`

Installed at:

`/Users/emiliong/.hermes/job-hunt/cover-letter-template/`

Primary files:

- `cover-letter.html` — canonical cover-letter HTML design source.
- `resume.html` — bundled matching resume template from the zip; current job-hunt resume canonical remains `/Users/emiliong/.hermes/job-hunt/resume-template/resume.html` unless Emilio changes it.
- `build.py` — Playwright-based renderer included with the template bundle.
- `assets/` and `uploads/` — required logos/wordmark assets.

Cover-letter customization rules:

- Preserve CSS, fonts, palette, logos, masthead, meta block, page shell, footer, and ornamental system.
- Edit only content slots tagged with `data-slot` or equivalent content-bearing nodes.
- Do not treat Markdown cover-letter drafts as final deliverables; final Phase 3 cover letters should be HTML and PDF.
- Pair with `/Users/emiliong/.hermes/job-hunt/phase3-document-quality-gate.md` for QA.

Important slots:

- `date`
- `company`
- `company-addr`
- `role`
- `hiring-manager`
- `salutation-name`
- `hook`
- `company-mention`
- `company-mention-2`
- `role-keyword`
- `why-them`
- `why-me`
- `why-now`
- `closing`
- `closing-hook`
- `flourish`

Notes:

- The zip filename contains a typo: `Tempalte`. Keep the source path as-is when referring to the original download.
- The included `build.py` writes default BASE PDFs to Desktop/iCloud paths; per-application generation should use a copied/adapted build script or a controlled output directory to avoid overwriting canonical BASE files.
