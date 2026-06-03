# Emilio Nunez-Garcia - Materials Quality Contract

Goal: Produce tailored resumes and cover letters that are evidence-dense, role-specific, and intentionally fitted to the rendered page count.

Success means:
- The resume renders as either one full page or two full pages, chosen before drafting from the role seniority and available evidence.
- The cover letter renders as one polished page with concise paragraphs and concrete evidence.
- The final materials use verified facts from `profile.md`, `resume-bullets.md`, `voice.md`, the job description, and the job-analysis notes.
- The `qa-report.md` records page count, page-density checks, included evidence, omitted relevant evidence, and caveats.

Stop when: Resume, cover letter, job analysis, and QA report are complete, page-fit checks pass, and the QA report names any remaining caveats plainly.

## Evidence Pass

Read these sources before drafting:

- `profile/profile.md`
- `profile/resume-bullets.md`
- `profile/voice.md`
- `profile/job-preferences.md`
- the role folder's `job-description.md`
- the role folder's existing `job-analysis.md`, when present
- the Pipeline row notes and talking points, when present in the request

Build a short evidence pack before writing:

- 4-6 role requirements from the job description
- 6-10 candidate proof points mapped to those requirements
- 2-4 likely gaps or caveats
- the exact target page shape for the resume
- the cover-letter angle in one sentence

Use verified facts only. When a metric, client name, title, date, certification status, launch status, or project URL is uncertain, either omit it or mark it as a caveat in `qa-report.md`.

## Visual Assets (optional polish)

When the template includes company/project logo marks, prefer to keep them:

- Copy `resume-template/assets/` into `<slug>/assets/` when those files are available locally.
- Preserve the template's `<img>` marks (Audacy `company-mark`, Elio/Hormiga/JobBored `project-mark`, masthead wordmark), keep their `onerror="this.remove()"` attribute so a missing logo is dropped rather than shown broken, and use relative `assets/...` paths when you do.
- Do not change layout, fonts, palette, or ornamental CSS when tailoring copy.

Missing logos or `assets/` files are not a failure — deliver the resume, cover letter, job analysis, and QA report anyway. Note omitted marks in `qa-report.md` only when you had the files but skipped them.

## Resume Shape

Choose one target:

- `one_page_full`: 650-850 rendered HTML words. Use this for focused IC/manager roles, thin job descriptions, or roles where the strongest story is narrow.
- `two_page_full`: 850-1150 rendered HTML words. Use this for director, senior director, sales leadership, RevOps, AI/platform, or hybrid operator-builder roles with enough relevant evidence.

Fit rules:

- A two-page resume uses both pages deliberately. Page 2 should carry at least 240 rendered words and include relevant evidence, not only a closing flourish or sparse project block.
- A two-page resume should include Summary, Experience, Founder Work or Selected Projects, Education, Capabilities/Skills, and Tooling/Stack/Languages when the template supports them.
- A one-page resume should keep the strongest sections and remove lower-value detail until the page is full without overflow.
- Every resume bullet should map to the target role through channel, tool, scope, metric, leadership, or product-building relevance.

Repair loop:

1. Render the PDF.
2. Measure page count and approximate rendered word count by page.
3. Expand a sparse two-page draft with relevant omitted evidence, or tighten it to one full page.
4. Tighten an overflowing draft by removing the lowest-relevance bullets first.
5. Update `qa-report.md` with the final page count and any useful caveat.

## Cover Letter Shape

Target 325-450 rendered HTML words on one page.

Structure:

- Paragraph 1: role-specific hook naming the useful overlap between Emilio and the company.
- Paragraph 2: one compact Audacy proof point and one compact AI-builder proof point.
- Paragraph 3: what Emilio would help the company do next, with a direct fit-check close.

Use the company name, role title, and 2-4 job-specific keywords naturally. Keep the voice warm enough for a letter and spare enough for an executive application.

## QA Report

Record these checks in `qa-report.md`:

- Resume target: `one_page_full` or `two_page_full`
- Resume rendered page count and page word distribution
- Cover letter rendered page count and word count
- Evidence used from the job description
- Strong relevant evidence omitted for space
- Facts excluded because they were uncertain
- Remaining role-fit caveats
