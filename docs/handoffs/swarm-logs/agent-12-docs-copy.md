# Agent 12 - Docs And UX Copy Lane Report

## Files Changed

- `README.md`
- `SETUP.md`
- `QUICKSTART.md`
- `partials/discovery-drawer.html`
- `partials/first-run-wizard.html`
- `partials/scraper-setup-modal.html`
- `partials/settings-modal.html`
- `posting-enrichment.js`
- `resume-generation.js`
- `tests/enrichment-self-heal.test.mjs`
- `examples/ats-scorecard-response.v1.json`
- `droid-wiki/reference/configuration.md`
- `droid-wiki/apps/discovery-worker/index.md`

## Provider Paths Supported

- OpenRouter is now described as the first generic AI path for drafts, inline discovery ideas, posting summaries, scorecards, and plain JSON/scoring docs.
- Local/OpenAI-compatible provider copy is preserved as a generic AI path that does not require Gemini.
- Resume-generation and posting-enrichment missing-config copy now points users to the selected AI provider instead of a generic Gemini prerequisite.
- Discovery drawer and first-run/settings copy now includes OpenRouter and Local in the user-facing provider paths.
- ATS scorecard example now uses the OpenRouter default model id instead of a Gemini model id.

## Google Tool Paths Preserved

- Gemini remains documented as optional when selected as the active provider.
- Gemini URL Context remains explicitly named as the optional `url_context` page-reading lane.
- Gemini Grounded Search remains explicitly named as the optional `google_search` discovery lane.
- URL Context focused tests remain intact; only the generic missing-provider copy assertion changed.

## Tests Run

- PASS: `npm test -- tests/enrichment-self-heal.test.mjs tests/repo-validation-surface.test.mjs`
- PASS: `npm run test:contract:all`

Note: `npm run test:contract:all` initially failed because `node_modules` was absent and `ajv` was not installed. Ran `npm ci`; no package or lockfile diffs were produced. The rerun passed.

## Known Risks

- Server and worker runtime docs now describe the target OpenRouter provider split from the swarm handoff; final integration must confirm Agents 5, 8, and 11 land the matching env/template/runtime support.
- `integrations/browser-use-discovery/README.md` still contains older Gemini-centered local-run copy. It is outside this lane's primary file list and should be updated by the worker/docs integration owner if they want every nested package README aligned.
