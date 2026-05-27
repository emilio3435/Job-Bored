# Emilio Job-Hunt Profile Source Map

Purpose: collect verified source material before generating the canonical job-hunt profile files:

- `profile.md` — factual professional profile and positioning
- `voice.md` — tone, phrasing, cover-letter/resume voice rules
- `resume-bullets.md` — reusable quantified accomplishment bullets
- `job-preferences.md` — target roles, companies, constraints, dealbreakers

## Already available locally

1. Master resume HTML
   - Path: `/Users/emiliong/.hermes/job-hunt/resume-template/resume.html`
   - Use for: verified employment history, positioning, quantified wins, ATS keywords, AI/adtech narrative.

2. Resume template assets
   - Path: `/Users/emiliong/.hermes/job-hunt/resume-template/assets/`
   - Use for: brand/logo context only, not factual profile extraction.

3. JobBored repo contracts
   - Path: `/Users/emiliong/GitHub/emilio3435/Job-Bored/AGENT_CONTRACT.md`
   - Path: `/Users/emiliong/GitHub/emilio3435/Job-Bored/schemas/pipeline-row.v1.json`
   - Use for: Pipeline field names and where profile-derived material will land.

## Needed from Emilio

1. LinkedIn profile export or copied profile text
   - Where to get it: LinkedIn profile → More → Save to PDF, or copy the About / Experience / Featured sections into a text file.
   - Suggested local path: `/Users/emiliong/.hermes/job-hunt/profile/sources/linkedin-profile.txt`
   - Use for: public-facing positioning and chronology cross-check.

2. Current resume PDFs / variants
   - Where to get them: local Downloads/Documents or the original resume folder.
   - Suggested local path: `/Users/emiliong/.hermes/job-hunt/profile/sources/resumes/`
   - Use for: compare variants and preserve strongest phrasing.

3. Target role preferences
   - Where to provide it: paste into `sources/target-roles.md`.
   - Include: must-have titles, acceptable titles, industries, company examples, remote/hybrid/on-site rules, salary floor, seniority floor.

4. Dealbreakers
   - Where to provide it: paste into `sources/dealbreakers.md`.
   - Include: locations, comp ranges, industries, company types, responsibilities, travel, relocation, pure-SWE roles, anything to avoid.

5. Voice examples
   - Where to provide them: paste into `sources/voice-examples.md`.
   - Include: 2–5 emails, cover letters, LinkedIn messages, or notes that sound like Emilio.
   - Use for: preserving the high-touch Audacy/media-sales voice instead of generic AI prose.

6. Company/watchlist preferences
   - Where to provide it: paste into `sources/company-watchlist.md`.
   - Include: dream companies, “maybe” companies, no-go companies, local Denver/remote preferences, AI/adtech/martech targets.

## Extraction rules

- Do not use model training data as a source.
- Treat the resume HTML as verified but still cross-check dates/titles against user-provided resume/LinkedIn sources.
- Preserve Emilio’s differentiated positioning: digital advertising leadership + AI product building + cloud/agent workflows.
- Do not flatten the profile into generic “marketing leader” language.
- Mark uncertain facts as `needs Emilio confirmation` instead of guessing.
