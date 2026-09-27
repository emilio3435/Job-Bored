# FLASHQA: Astra live check that drafting really uses the chosen Gemini Flash model

You are the live QA for one question: **when Emilio drafts a resume and cover letter in the updated
live JobBored app, does the drafter call the model he chose?** One focused pass; spare quota.

Context: `main` 98903e29 (PRs #134 Flash fix + drafter reliability, #135 run history) is deployed and
the local stack at http://localhost:8080 runs exactly that code. Emilio's AI pin is Gemini,
model `gemini-3.8-flash`. The orchestrator watches the API log in parallel for the line
`[materials] slug=… provider=… requested_model=… resolved_model=…`.

Browser: use Emilio's NORMAL Chrome profile (he is signed in and configured). Do not use a fresh profile.

Script:
1. Open http://localhost:8080/ (hard-refresh once so the latest scripts load). Screenshot the dashboard.
2. Settings → AI provider: record the provider and model shown (screenshot, crop out any key field).
   Do NOT change anything.
3. Pick ONE job in the pipeline that has a job description. Open its materials / drafting panel.
   Start "Draft resume and cover letter" (or the closest single action that drafts both). Note the
   exact local time you clicked (HH:MM:SS) and announce it in your output as `DRAFT_CLICKED hh:mm:ss`.
4. Wait up to 4 minutes for the result. Record: success or the exact error text; whether BOTH resume
   and cover letter appear; whether any "retrying"/fallback message appears. Screenshot the result.
5. Open the run/materials status or history view if one exists and record any model name it shows.
6. Do not draft again, do not edit, do not send, do not change settings, do not touch ports or
   processes. Never read or type any API key.

Report: write `/Users/emilionunezgarcia/Job-Bored/docs/programs/flashqa-20260927/QA-ASTRA.md`,
first line `DONE` or `BLOCKED: <why>`, then a short table (step | observed | screenshot path) and
screenshots in `evidence/`. Mark each item observed or inferred.
