BLOCKED: Google session ended; pipeline and drafting are inaccessible.

Single focused browser pass on 2026-09-27; final observation 09:35:27 CDT (America/Chicago). Used the connected normal Chrome session at http://localhost:8080/; no fresh profile. No draft was clicked.

| Step | Observed | Screenshot path |
| --- | --- | --- |
| 1 — Done | **Observed:** opened the app and sent one hard refresh. Screen says “Your Google session ended” and “Sign in again to pick up where you left off.” The pipeline dashboard was unavailable. | [Session gate](/Users/emilionunezgarcia/Job-Bored/.lane-evidence/flashqa-20260927/evidence/01-dashboard-session-ended.jpg) |
| 2 — Done | **Observed:** Settings → AI shows provider **Google Gemini** and model **gemini-3.5-flash (saved)**. This differs from the kickoff's expected gemini-3.8-flash. Settings closed without saving. Key field excluded from the saved crops; no key value read. | [Provider](/Users/emilionunezgarcia/Job-Bored/.lane-evidence/flashqa-20260927/evidence/02-ai-provider.jpg), [Model](/Users/emilionunezgarcia/Job-Bored/.lane-evidence/flashqa-20260927/evidence/03-ai-model.jpg) |
| 3 — Blocked | **Observed:** the session gate prevents selecting a pipeline job. **DRAFT_NOT_CLICKED — 0 clicks.** No DRAFT_CLICKED timestamp exists. | [Session gate](/Users/emilionunezgarcia/Job-Bored/.lane-evidence/flashqa-20260927/evidence/01-dashboard-session-ended.jpg) |
| 4 — Blocked | **Unknown:** no draft result, resume, cover letter, retry, or fallback could be assessed because no request started. The four-minute result wait was not entered. | No result screenshot; [blocking gate](/Users/emilionunezgarcia/Job-Bored/.lane-evidence/flashqa-20260927/evidence/01-dashboard-session-ended.jpg) |
| 5 — Blocked | **Observed:** the gate remained after closing Settings. **Unknown:** run/materials history and its model label were inaccessible. | [Session gate](/Users/emilionunezgarcia/Job-Bored/.lane-evidence/flashqa-20260927/evidence/01-dashboard-session-ended.jpg); [final gate text](/Users/emilionunezgarcia/Job-Bored/.lane-evidence/flashqa-20260927/evidence/04-final-gate.txt) |
| 6 — Done | **Observed actions:** no drafting, editing, sending, settings change, API key value access, or port/process changes. | [Action record](/Users/emilionunezgarcia/Job-Bored/.lane-evidence/flashqa-20260927/evidence/actions.txt) |

**Conclusion:** actual requested/resolved drafting model is **unknown**. The settings mismatch is observed; it does not prove which model the drafter would call. The deployed revision and API logs were not independently checked in this browser lane. No tests ran and no browser success is claimed.

**Reconciliation:** Done — local app open/refresh, settings observation, safe crops, report. Blocked — job selection, one draft, result observation, and history inspection. Cancelled — none. Stopped after this single focused pass; the local tab is left at the session gate for handoff.

Evidence is under .lane-evidence/flashqa-20260927/evidence/ (the lane's required storage boundary), rather than the program folder's evidence/. Report-only branch: chore/flashqa-astra-20260927. No commit, push, PR, or deployment.
