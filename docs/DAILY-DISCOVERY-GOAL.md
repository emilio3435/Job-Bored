Goal: Make Job-Bored daily discovery runs automated, diverse, and powered by the freshest profile, resume, preferences, and job-search context.

Success means:
  - Daily scheduled runs use the existing user-owned discovery webhook and worker path.
  - Manual `#discoveryBtn` runs and scheduled runs share one payload-building path.
  - Each run reads current profile, resume, preferences, role targets, locations, and schedule settings at run time.
  - Each daily run rotates through relevant search facets while staying aligned with the user's current job-search profile.
  - Focused tests or contract checks cover schedule wiring, payload freshness, diversity rotation, and discovery contract compatibility.
  - The final report names changed files, verification commands, and live setup assumptions.

Stop when: The local implementation is complete, focused verification passes, and any remaining user-secret or live-schedule steps are listed.

Constraints:
  - Keep the app local-first and user-owned.
  - Preserve the canonical `#discoveryBtn` manual discovery path.
  - Treat direct LinkedIn job pages as hint-only or blocked-aggregator inputs while allowing SerpApi Google Jobs or grounded search to surface LinkedIn-backed jobs.
  - Update schemas, docs, fixtures, and changelog when webhook or Pipeline contracts change.
  - Keep changes surgical and match the repo's vanilla JavaScript and Node conventions.

Plan:
1. Trace the current discovery path.
   Read `AGENTS.md`, `README.md`, `AGENT_CONTRACT.md`, `app.js`, `settings-profile-tab.js`, `templates/github-actions/command-center-discovery.yml`, and `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts`.
   Map manual discovery, scheduled discovery, payload creation, worker status polling, and `DiscoveryRuns`.
   Run the smallest baseline checks that already cover these surfaces.

2. Build one fresh payload assembler.
   Locate current storage for profile, resume, samples, preferences, target roles, locations, and schedule settings.
   Create or reuse one function that assembles discovery payloads from the latest available state at run time.
   Route both manual and scheduled discovery through that function.
   Add a focused test proving profile, resume, or preference edits change the next discovery payload.

3. Add deterministic diversity.
   Build a compact search-plan generator from current user context.
   Rotate facets by date or run id while keeping output stable for the same input.
   Cover primary roles, adjacent titles, skills, industries, locations, seniority, company types, and source lanes.
   Cap each run with existing max-leads behavior.
   Add tests proving consecutive days differ and same-day inputs stay stable.

4. Wire automation through existing schedule surfaces.
   Update the GitHub Actions template and schedule UI/template copy so daily runs send the fresh rotated payload.
   Keep the existing Chicago-local schedule behavior unless repo evidence shows a newer contract.
   Verify template output and schedule tests together.

5. Preserve worker contracts and observability.
   Add the minimal worker support needed for the richer search plan.
   Record run metadata showing which profile snapshot and query bundle powered the run.
   Update schema, fixtures, docs, and changelog if the webhook contract changes.
   Verify `/runs/<runId>` polling and async timeout behavior still work.

6. Validate and report.
   Run focused browser payload, schedule/template, and worker contract tests.
   Run `npm run typecheck:repo`.
   Run `npm run test:contract:all` when contract files changed.
   Return a concise implementation summary with passed checks and unverified live-run requirements.
