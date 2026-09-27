# Combined discovery and drafting review package

Goal: provide one local candidate containing PR 133 discovery progress and the Resume/CL JSON repair for Emilio to test together.
Success means: focused reproducers, repository floors, browser progress checks, independent review, and one documented local launch path on an isolated checkout.
Stop when: the candidate is ready for user review or a precise blocker remains.

## Locked decisions
- Base: feat/gfx-followup at bd886f5c; retain its owner-only Tailscale setup scope.
- Add Muse repair ef122b5c; copied as 3c9d3908, then corrected by 0691a4a2 copied as bb1ec7d4.
- Integration: feat/gfx-review-package in /private/tmp/jobbored-review-package.
- Publication: PR 133 was merged upstream at 2026-09-27 03:48:11 UTC during this task. Emilio can publish one follow-up PR for the remaining writer and worker corrections after testing. This task does not push, open PRs, merge upstream, release, or deploy.
- Keep main checkout dirt, credentials, and signing files untouched. Emilio approved switching the existing localhost stack after checks pass; preserve browser origin and reference existing config without displaying or copying secret contents.
- Use synthetic test fixtures. Live draft success remains separate from fixture evidence.
- Discovery and drafting: flat integration of completed lanes; a bounded Sol follow-up addresses review findings 2 and 3.
- Grok: independent plan/diff review. Muse authored the writer change and cannot independently verify it.
- Current model lock refreshed with no drift. Quota refresh reports no current Grok or Muse reading; capacity unknown, not exhausted. Stop affected work on provider exhaustion.

## Floor
npm run lint:repo
npm run typecheck:repo
npm test
npm run test:repo
node --test tests/gfx-uxd-fe-visual.mjs

## Shared boundaries
Writer changes only server/materials-writer.mjs and tests/materials-writer.test.mjs. Discovery contract/frontend come from PR 133. Writer review changes are returned to the writer lane before final integration; Sol owns the two worker progress corrections. Real API calls and real Sheets writes are user-operated acceptance work.
