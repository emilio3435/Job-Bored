# SIXBEATS ground-rules addendum (read after docs/programs/oneflow-20260831/GROUND-RULES.md)

- Report file first: `LANE-REPORT-<lane>.md` with the five headings, PENDING until real.
- Visual lanes (V1, V2) and Q1 prove work with screenshots, not adjectives: capture BEFORE and AFTER at 1440×900 and 390×844 with the repo's Playwright (`npx playwright screenshot` or a 10-line script in `.lane-evidence/`), save under `.lane-evidence/`, and paste the filenames + a one-line statement of what changed per claim into the report. Open `docs/programs/sixbeats-20260902/reference/six-beats-prototype.html` in the same browser for side-by-side.
- Start the app for screenshots with `PORT=<free port> node dev-server.mjs` from your worktree (never 8080 — the founder's instance may be there). Use `http://localhost:<port>/?greenfield=1` for the zero-config cold start.
- Copy strings stay normative (spec §4/§5). Visual work changes structure, spacing, hierarchy, and components — never the words.
- The Gemini media at `/Users/emilionunezgarcia/Job-Bored/docs/qa/2026-09-01-six-beats-walkthrough/media/` is read-only evidence; cite filenames, do not copy 45 MB into the repo.
- `node --test <file>` for a single suite; the floor is `npm test` + `lint:repo` + `typecheck:repo` + `test:contract:all`; Q1 adds both Playwright suites.
