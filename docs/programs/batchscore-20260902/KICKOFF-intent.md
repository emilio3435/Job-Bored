# KICKOFF — lane `intent` (wave 1)

Read `GROUND-RULES.md` and `BATCHSCORE-SPEC.md` §1 (F2), §3 item 2, and §4.1 first. Create `LANE-REPORT-intent.md` before anything else.

## Mission
The scoring prompt tells the model which roles the user is pursuing, at what seniority, and with which focus keywords, so a stretch-role listing is judged on evidence instead of dismissed for a title mismatch. The prompt must not inflate scores: no "reward", "bonus", or "boost" language anywhere in it.

## Fence (you own exactly these)
- `integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts` — `ScoreListingForProfileOptions`, a new exported `SearchIntent` type, `buildSystemPrompt(profile, searchIntent?)`, and the prompt assembly inside `scoreListingWithLlm`. Nothing else in the file; the `batch` lane will add a section below the single-item orchestrator later and will call your `buildSystemPrompt`.
- `integrations/browser-use-discovery/src/normalize/lead-normalizer.ts` — the single `scoreListingForProfile(...)` call site only: pass `searchIntent`.
- New test: `integrations/browser-use-discovery/tests/profile-aware-scorer-intent.test.ts` (at the worker tests root, beside `profile-aware-scorer-prefilter.test.ts`; see the ground-rules trap on test placement).

## Consumes
Nothing. `profile.identity.targetRoles` and `targetSeniority` already exist in `contracts/user-profile.ts`. The run config's role and keyword arrays already exist on the resolved run settings; confirm the exact property names in `run-discovery.ts` / `contracts.ts` (they are `targetRoles` and `includeKeywords` on the stored config) and name them in the report.

## Non-negotiables
- Implement §4.1 exactly: the `SearchIntent` shape, the option field name `searchIntent`, the three prompt lines (roles = profile roles ∪ intent roles, deduped, order preserved, profile first; seniority; focus keywords only when non-empty), and the directive paragraph verbatim from the spec.
- The cache key does not change. A test proves the same `cacheKey` is produced with and without `searchIntent`.
- Byte-stable output: when `searchIntent` is absent and the profile has no `targetRoles`, the prompt is identical to today's (a snapshot test against the current builder output taken on the base commit, then asserted unchanged).
- Red-first tests, named for behavior:
  - prompt names the pursued roles when the profile has them and no intent is passed;
  - prompt merges intent roles after profile roles without duplicates;
  - prompt omits the FOCUS KEYWORDS line when keywords are empty;
  - prompt never contains "reward", "bonus", or "boost" (case-insensitive) for any fixture;
  - normalizer passes the run config's roles and keywords through (spy on the scorer via the existing test seams; if the normalizer has no injectable seam, say so in section 5 and cover it at the `run-discovery` level with the fake-dependencies harness in `tests/run/`).
- Live-model calibration (a stretch role scoring within one point of an on-title role) is not a unit test. Write the two fixtures you would use into `.lane-evidence/live-check-fixtures.md`; the orchestrator runs them in `evidence/LIVE-CHECK.md`.

## Definition of Done
1. Report section 2 shows every test above red on the base commit, then green.
2. Full floor pasted into report section 4:
   ```
   npm run typecheck:browser-use-discovery
   npm run test:browser-use-discovery
   npm run test:contract:all
   npm run lint:repo
   npm test
   ```
3. Commit locally (`feat(discovery): scoring prompt carries the pursued roles`), never push. Keep scratch in `.lane-evidence/`. Delete nothing.
