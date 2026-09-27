# Lane CASEWHY: show why a role scored what it did

Read `KICKOFF-CDESK-_SHARED.md` in this folder first; its rules bind you. Family: opus · medium, with the `/frontend-design` skill loaded before you design anything. Worktree `~/Job-Bored.worktrees/cdesk-casewhy`, branch `feat/cdesk-casewhy`, base main `98903e29`.

**Goal:** The Case (the role dossier, `role-case*.js`) shows the fit number with no reason. Show the reason, using data already on the Pipeline row.

**Grounding (read first):** `docs/programs/runhist-20260927/reports/DOSSIER-RECS.md` in the MAIN checkout (`/Users/emilionunezgarcia/Job-Bored/docs/...`), sections "What The Case can say today" and "Phase A". Key facts it cites:
- Match Score (column U, 0–10) reaches the card attribute and view-model (`pipeline-render.js:243-247`, `dawn-data.js:1635`) but the Case model drops it (`role-case-model.js:580-591`).
- Fit Assessment (column K) is clipped onto `data-fit-assessment` (`pipeline-render.js:262`) and shown only in the board drawer (`pipeline-render.js:589-595`). It is one flattened string: band, rationale, up to 4 matches, up to 3 concerns, application label (`integrations/browser-use-discovery/src/.../lead-normalizer.ts:952-968`). Parse that shape defensively; render the raw text when parsing fails.
Re-verify every line number; the doc was written at `5d5b9a59`.

**Fence:** `role-case-model.js`, `role-case.js`, `role-case.css`, their tests (`tests/role-case*.test.mjs`), and one new e2e-journey or e2e-visual assertion. Nothing else.

**Success means:**
1. The Case's fit area shows the Fit Score with its reason: the band/rationale sentence first, then "Why it fits" (matches) and "Watch for" (concerns) as short lists, then Match Score as a secondary figure labelled so a job seeker understands it (for example "Match 7.4 / 10").
2. When K or U is empty, nothing is invented: that part is absent, never a placeholder number (DOSSIER-RECS D5: a number the worker did not measure stays absent).
3. Long prose is readable: clamp to about 4 lines with a "Show all" toggle that is a real button with `aria-expanded`.
4. Unit tests pin: model carries `matchScore` and parsed `fitAssessment`; empty cells render nothing; malformed K renders raw text; the toggle works. A browser assertion shows the reason inside an opened Case in the hermetic journey.
5. Visual: matches The Case's navy/parchment `--dsr-*` language, AA contrast, no text under 12px, works at 375px.
6. Full shared floor pasted; report first line `DONE`.

**Stop when:** the above is committed on your branch, or you are blocked.
