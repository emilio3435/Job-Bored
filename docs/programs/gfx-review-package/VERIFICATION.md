# Integration verification

Goal: verify the combined discovery progress and Resume/CL repair before switching Emilio's localhost stack.
Success means: repository floors, synthetic regressions, independent review, and local service/source checks pass with evidence separated from live acceptance.
Stop when: the candidate is ready for Emilio to test or a precise blocker remains.

Candidate: feat/gfx-review-package, based on PR 133 at bd886f5c, writer commits 3c9d3908 and bb1ec7d4, plus the reviewed Sol worker correction 00587516.

## Confirmed checks

Node 24.13.0, npm 11.19.1. Full logs remain in .lane-evidence/.

| Command | Result |
| --- | --- |
| npm run lint:repo | exit 0; 34 sheets, 0 new findings, 0 brace errors |
| npm run typecheck:repo | exit 0; worker and server included |
| Muse independent worker verification | PASS; three focused reproducers |
| npm test | exit 0; 4653 tests, 4645 pass, 0 fail, 8 TODO, 0 skipped |
| npm run test:repo | exit 0; contracts pass; root 4620 tests, 4612 pass, 0 fail, 8 TODO; worker 937/937 |
| node --test tests/gfx-uxd-fe-visual.mjs | 9/9; desktop/mobile and reduced motion, unchanged frontend |
| npm run test:e2e-journey -- --grep 'discovery\|draft\|resume\|letter' | 5/5; filtered, full journey suite not run |
| Grok independent re-review | PASS; all four original findings resolved; writer 20/20 and worker reproducers 3/3 |
| Sol worker author checks | RED 2 failures to GREEN 3/3; full worker 937/937; lint/typecheck exit 0 |

Final root output:

```text
ℹ tests 4653
ℹ suites 1114
ℹ pass 4645
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 8
```

Final test:repo output:

```text
ℹ tests 4620
ℹ suites 1104
ℹ pass 4612
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 8
ℹ tests 937
ℹ suites 2
ℹ pass 937
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## Earlier unsuccessful attempts

Initial sandbox runs could not bind loopback; host reruns passed. One later paired run was invalidated by preview config.js being present (the deploy contract expects it absent) and two suites sharing desktop test port 18580. Only the three preview symlinks were removed; owner files were untouched. Sequential clean-tree reruns passed. Failed logs are retained, not overwritten as proof of success.

The eight pre-existing TODOs are not passes. No test was weakened or filtered out of npm test/test:repo. The focused journey run was explicitly filtered. The browser screenshot uxd-fe-drawer-working-1440.png was visually inspected using synthetic fixtures.

## Evidence boundaries

The original live draft's finish signal was never captured, so a 4096-token root cause remains a hypothesis. Synthetic tests verify the bounded retry and error handling. No live AI draft, real discovery write, CI run for this candidate, or signed build of this candidate has been executed by this task.

Separately, macOS workflow 36288968900 attempt 2 completed successfully for the earlier source revision; it does not include this package.

## Local preview confirmed

The authorized stack switch completed in workspace:104 / surface:197. The original stack stopped cleanly and all three ports were clear before starting the candidate. Owner configuration is referenced through three ignored symlinks; no configuration contents were displayed or copied. Bootstrap state remains at the owner checkout path.

```text
Dashboard HTTP 200 — port 8080, PID 68213
API health HTTP 200 — port 3847, PID 68264
Worker health HTTP 200 — port 8644, PID 68219
```

All three process working directories point to `/private/tmp/jobbored-review-package` (API under server/). The served discovery-run-tracker.js digest equals the candidate file: `8af7f7a0769ca9dd106d8a5dffb101a875ddaf546704adb6d9a1b4c7e14ba921`. One sandbox digest attempt returned no content; the unrestricted rerun with pipefail and curl --fail confirmed the match.

Final lint/typecheck exited 0. Muse independently verified the Sol worker correction, three reproducers passed. Source changes are committed locally through 00587516; gitleaks found no leaks in the three remaining commits against current origin/main. Final documentation is committed separately. Preview links are ignored and are not committed.

## Upstream changed during verification

PR 133 merged at 2026-09-27 03:48:11 UTC; origin/main is now 0ea077df. Its discovery animation and owner-only setup are already upstream. The remaining local code diff is three writer/worker correction commits. Initial evidence was collected against dddaddcf; no claim is made that this task merged PR 133. A single follow-up PR can contain the remaining corrections after user acceptance.

No push, PR mutation, upstream merge, or deployment was performed by this task.

## Flash-family repair and current-main integration (2026-09-27)

The Flash repair is checkpointed at `062cad14`. The integrated candidate incorporates main `5d5b9a59`, including its v3 materials pipeline. Grok reviewed the combined source and the two deterministic fixture corrections: PASS. Muse independently verifies `/private/tmp/jobbored-flash-integrated`, with a matching source manifest and new main files staged so the desktop selftest includes them. Server dependencies were installed from the updated lockfile.

The first integrated run was invalidated by two snapshot setup errors: global bootstrap/worker directory overrides interfered with fixture paths, and new main files were untracked in the snapshot, so the desktop selftest did not copy them. Neither required a production code correction. A remaining main test omitted an ownership double and probed live port 8644 despite using synthetic process IDs; its ownership result is now injected. Production foreign-checkout guards are unchanged. Original failed logs are retained.

Final verification uses only test-specific `JOBBORED_LLM_CONFIG_PATH` and `JOBBORED_PROFILE_PATH` overrides; HOME is unchanged and other fixtures use their own paths. Lint and typecheck exit 0. Full `npm test`:

```text
ℹ tests 4898
ℹ pass 4891
ℹ fail 0
ℹ todo 7
```

Seven existing TODOs are not passes. `npm run test:repo` passed its contract gates, root subset and worker suite:

```text
ℹ tests 4865
ℹ pass 4858
ℹ fail 0
ℹ todo 7
ℹ tests 995
ℹ pass 995
ℹ fail 0
ℹ todo 0
```

`npm run test:e2e-visual` completed: **56 passed (1.5m)**. The final required automated gates pass. Grok reviewed the integrated diff; Muse ran all five floor commands independently. No live AI request, user resume submission, CI run, or signed Mac build of this candidate was performed.
