# Discovery progress + Resume/CL candidate

Goal: test discovery feedback and resume/cover-letter generation together on the existing localhost origin.
Success means: a real discovery run shows moving elapsed time and truthful progress; a real draft produces both materials or an actionable provider error; existing settings and profile remain available.
Stop when: the checklist passes or a reproducible issue is recorded before publication.

## Candidate
`feat/gfx-review-package` in `/private/tmp/jobbored-review-package` combines PR 133 with the writer JSON repair. PR 133 also retains owner-only Tailscale setup. PR 133 merged upstream during this task. The local candidate adds the writer repair and two reviewed worker progress corrections; those remain unpublished.

## Test now: localhost switch confirmed
1. Reload http://localhost:8080/ in the same browser you normally use.
2. Start discovery. Reopen the discovery drawer and Runs: elapsed time advances, the phase dot animates, counters reflect actual observations, and terminal results replace the live view.
3. Select a role with a usable full job description. Generate a resume and cover letter. Inspect both outputs for factual accuracy and usable rendering.
4. If a provider truncates twice, expect an output-limit message rather than an unexplained unterminated JSON error. Record the message only; exclude credentials and private resume content from shared reports.
5. The earlier navigation-junk job description finding is separate: use a real posting, not scraped job-board navigation, for acceptance.

## Evidence boundary
Automated checks use synthetic fixtures. Their success does not certify a live AI provider response, real Sheets write, or signed Mac artifact. The Mac build runs separately and does not contain this candidate until a later release build.

## Publication after acceptance (Emilio)
PR 133 is already merged. Publish `feat/gfx-review-package` as one follow-up PR against current main, using PR-BODY.md as the description. The diff contains the remaining writer and worker corrections. Leave merge and deployment until acceptance and CI are green. This task has not pushed or opened it.

The candidate has its own installed dependencies and configuration references to the original main checkout. Keep the main checkout and `/private/tmp/jobbored-review-package` in place while testing. The older gfx-followup dependency links are no longer used. To return to the original local stack, stop the preview in workspace:104, change to `/Users/emilionunezgarcia/Job-Bored`, unset the preview `JOBBORED_REPO` and `JOBBORED_BOOTSTRAP_STATE_PATH` overrides if they were exported, and run `npm run dev`. The launch here used command-scoped overrides, not exported shell settings.
