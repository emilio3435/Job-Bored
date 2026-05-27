# JHOS Phase 3 Document Quality Gate

Status: active requirement for all application-material cards.

## Principle

Phase 3 is not merely “does Emilio match the job?” and it is not mainly “is the job good?”

Phase 3 is: produce application materials that make Emilio look unusually well-matched, visually polished, and faithful to the canonical HTML resume system.

Role relevance matters only as an input to tailoring. The primary QA target is output quality.

## Required outputs per DRAFT card

Each application DRAFT must produce:

1. Tailored resume as an actual HTML file derived from `/Users/emiliong/.hermes/job-hunt/resume-template/resume.html`.
2. Tailored cover letter as an actual HTML file derived from `/Users/emiliong/.hermes/job-hunt/cover-letter-template/cover-letter.html`.
3. Generated resume PDF and cover-letter PDF, if the template build path supports them.
4. Cover letter Markdown/text draft may exist as an intermediate, but the HTML/PDF version is the deliverable.
5. Recruiter note draft, if useful.
6. Job analysis / fit notes.
7. QA report.

A Markdown “tailored content” file alone is insufficient except as an intermediate scratch artifact.

## Resume fidelity gate

The tailored resume must preserve the template’s design system:

- same CSS, color tokens, typography, page shell, section numbering, and header structure;
- no emoji, photos, badges, skill bars, gimmicks, or palette changes;
- keep the two-page hard cap;
- edit content only inside semantic sections and role bullets;
- preserve ATS keywords where relevant;
- run the template build command when available.

## Tailoring quality gate

The tailored resume must show deliberate role mapping:

- summary rewritten for the role;
- capabilities reordered for the job;
- bullets selected, pruned, and rewritten around the JD’s actual signals;
- no generic keyword stuffing;
- no unverified claims;
- no compensation, severance, unemployment, or internal/private details;
- sales-first vs AI-first vs performance-first positioning chosen intentionally for that role.

## Cover-letter template fidelity gate

The tailored cover letter must preserve the cover-letter template’s design system:

- same CSS, color tokens, typography, page shell, masthead, meta block, section rhythm, and footer;
- edit only slots tagged with `data-slot` or the equivalent content-bearing nodes;
- keep the one-page letter rhythm unless Emilio explicitly asks otherwise;
- do not change logos, layout, fonts, palette, or ornamental system;
- use `/Users/emiliong/.hermes/job-hunt/cover-letter-template/build.py` or the per-application build script when rendering PDF;
- preserve text selectability in the PDF.

Canonical cover-letter template path:

`/Users/emiliong/.hermes/job-hunt/cover-letter-template/cover-letter.html`

Important slots:

- `date`
- `company`
- `company-addr`
- `role`
- `hiring-manager`
- `salutation-name`
- `hook`
- `why-them`
- `why-me`
- `why-now`
- `closing`
- `flourish`

## Cover-letter writing quality gate

The cover letter must:

- follow Emilio’s voice guide;
- be short, specific, and evidence-led;
- use one compact role-specific hook;
- include one Audacy proof point and one builder/system proof point when relevant;
- avoid company flattery, generic enthusiasm, and compensation language;
- read as if written for that exact posting, not a lightly repainted template.

## QA report required

Every DRAFT card must include a QA report answering:

1. Does the resume preserve the HTML template exactly except for content?
2. Was a PDF generated successfully?
3. Which JD requirements are explicitly addressed?
4. Which JD requirements are weak, missing, or require Emilio confirmation?
5. Which bullets were added, removed, or rewritten and why?
6. Does the cover letter preserve the HTML template exactly except for intended content slots?
7. Does the cover letter follow `voice.md`?
8. Are any forbidden claims or banned phrases present?
9. Is this ready for Emilio review, or does it need another pass?

## Position-quality vs application-quality

Position quality should be scored, but it should not dominate Phase 3 unless the role is obviously outside bounds.

- If a role is adjacent but plausible, still draft high-quality materials if Emilio asks.
- Mark relevance risks in the analysis, but do not let that substitute for producing polished docs.
- If the user is testing the system, the success measure is document quality and process fidelity, not whether the job is perfect.

## Approval and submission

Even excellent materials do not imply permission to submit.

Submission still requires:

1. Pipeline Status beyond `New` (i.e. `Researching` or later) — set via Telegram reply or directly in the Sheet.
2. Final confirmation in `telegram:-1003800236296:48`.
