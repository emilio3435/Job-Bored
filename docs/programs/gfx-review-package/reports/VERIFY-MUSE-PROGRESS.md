# Muse independent verification — Sol discovery-progress correction

Scope: ONLY the Sol-authored worker correction (Grok findings 2 and 3). No verification of writer code is claimed here.

Package: `/private/tmp/jobbored-review-package` (HEAD `bb1ec7d4`, branch `feat/gfx-review-package`).
Fix record: `.lane-evidence/PROGRESS-FIX-SOL.md`.
Uncommitted source changes at verification time (nothing else touched):
- `integrations/browser-use-discovery/src/run/run-discovery.ts`
- `integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts`
(`docs/programs/gfx-review-package/` is untracked evidence, not source.)

## Diff review (read, not executed for findings)

Finding 2 (empty ATS pool stuck `running`): `run-discovery.ts` now initializes the ATS source as `skipped` when `atsCompaniesToSearch.length === 0`, else `running`. The only other `ats` write is the per-company `finally`, unreachable with an empty list, so `skipped` persists through write and learn. Matches the report.

Finding 3 (`leadsQualified` counts dropped leads): after frontier selection replaces `normalizedLeads`, the counter resets to the retained length and an `exploit` checkpoint publishes it. Later grounded additions still increment. The added `checkpointRunProgress("exploit")` sits in the filtering branch only; the `else` branch keeps its own score/exploit publishes, and phase publishes are cumulative cursor updates (scout already publishes repeatedly), so no double-count or missing-phase regression is introduced. The pre-existing score-publish flow is untouched.

Tests use injected stub dependencies (adapter registry, grounded client, config loaders) — synthetic, no live providers, Sheets, or services.

## Rerun: exact focused three reproducers

Command (verbatim from PROGRESS-FIX-SOL.md, run in `/private/tmp/jobbored-review-package`):

```text
node --experimental-strip-types --test --test-name-pattern='UXD-BE-1|UXD-BE-4|recovered grounded regex' integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts
```

Actual output:

```text
✔ runDiscovery treats recovered grounded regex fallback as completed when leads write (14.350708ms)
✔ UXD-BE-1: a 500-listing ATS scout publishes bounded, cumulative progress (44.209541ms)
✔ UXD-BE-4: an ATS pool emptied by company filtering is skipped through write and learn (1.123041ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Exit code: 0.

## Verdict: PASS

All three reproducers pass and assert the claimed behaviors (ats `skipped` with 0/0 at write and learn; `leadsQualified` equal to frontier-retained count at write and learn; retained grounded lead still counted). Diff review confirms the source changes cause the asserted behavior with no publish-flow regression. Full worker suite intentionally not rerun (host `test:repo` owns it). No source edits, commits, services, secrets, providers, or publication performed.
