# Discovery progress corrections — Sol author report

Goal: correct Grok review findings 2 and 3 in the combined review package.

Success means: an ATS source whose company list is empty after filtering is `skipped` through write and learn, and `leadsQualified` at the saving checkpoint equals the normalized leads retained by frontier selection. A grounded lead remains included. Synthetic `runDiscovery` tests demonstrate both behaviors.

Stop when: the source and tests pass the worker floor, this report records RED→GREEN evidence, and the host can integrate without a lane commit.

Branch: `feat/gfx-review-package`. Changed only `integrations/browser-use-discovery/src/run/run-discovery.ts` and `integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts`. No commit, push, live provider/Sheet call, or service restart.

## Verification floor

Node `v24.13.0`; npm `11.19.1`.

`npm run lint:repo` — exit 0. Actual output:

```text
> command-center@0.1.0 lint:repo
> npm run lint:js && npm run lint:skills && npm run lint:tokens

> command-center@0.1.0 lint:js
> eslint .

> command-center@0.1.0 lint:skills
> node scripts/lint-integration-skills.mjs
OK integrations/openclaw-command-center/SKILL.md

> command-center@0.1.0 lint:tokens
> node tools/lint-tokens.mjs
lint:tokens ok: 34 sheet(s), 0 new finding(s), 0 brace error(s)
```

`npm run typecheck:repo` — exit 0. Actual output after the long npm script command line:

```text
> command-center@0.1.0 typecheck:browser-use-discovery
> tsc --noEmit --project integrations/browser-use-discovery/tsconfig.json

> command-center@0.1.0 typecheck:server
> tsc --noEmit --project server/tsconfig.json
```

`npm run test:browser-use-discovery` — sandbox run exit 1 because 14 loopback tests could not bind `127.0.0.1`. Actual footer and representative error:

```text
ℹ tests 937
ℹ suites 2
ℹ pass 923
ℹ fail 14
ℹ cancelled 0
ℹ skipped 0
Error: listen EPERM: operation not permitted 127.0.0.1
```

The same command rerun with approved unrestricted execution — exit 0. Actual relevant lines and footer:

```text
✔ runDiscovery treats recovered grounded regex fallback as completed when leads write (23.187375ms)
✔ UXD-BE-1: a 500-listing ATS scout publishes bounded, cumulative progress (60.464042ms)
✔ UXD-BE-4: an ATS pool emptied by company filtering is skipped through write and learn (1.069625ms)
ℹ tests 937
ℹ suites 2
ℹ pass 937
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2746.287084
```

`git diff --check` — exit 0 with no output.

## RED→GREEN

The focused command was:

```text
node --experimental-strip-types --test --test-name-pattern='UXD-BE-1|UXD-BE-4|recovered grounded regex' integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts
```

Tests were added before source edits. RED exit 1 (actual output excerpt):

```text
✔ runDiscovery treats recovered grounded regex fallback as completed when leads write (33.138458ms)
✖ UXD-BE-1: a 500-listing ATS scout publishes bounded, cumulative progress (95.920625ms)
✖ UXD-BE-4: an ATS pool emptied by company filtering is skipped through write and learn (3.192708ms)
ℹ tests 3
ℹ pass 1
ℹ fail 2
AssertionError [ERR_ASSERTION]: the saving checkpoint counts retained leads, not all matcher-accepted listings
500 !== 18
AssertionError [ERR_ASSERTION]: write must not display an ATS source still running at 0 of 0
+   state: 'running',
-   state: 'skipped',
```

After the source edits, GREEN exit 0 (actual output):

```text
✔ runDiscovery treats recovered grounded regex fallback as completed when leads write (27.832916ms)
✔ UXD-BE-1: a 500-listing ATS scout publishes bounded, cumulative progress (92.194917ms)
✔ UXD-BE-4: an ATS pool emptied by company filtering is skipped through write and learn (2.684709ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 466.094792
```

The 500-listing case observes 500 normalized leads accepted in scout, 18 retained by the actual frontier budget, and `leadsQualified` equal to 18 at write and learn. The empty ATS case blocks its only configured company, verifies no detection call, and sees `{ id: "ats", state: "skipped", done: 0, total: 0 }` at write and learn. The grounded control confirms that an accepted grounded lead still counts at write.

Implementation: ATS progress is initialized as `skipped` when the effective ATS company list is empty. After selection replaces `normalizedLeads`, `leadsQualified` is reset to that retained length and an exploit checkpoint publishes it; later grounded additions still increment the counter.

Contract/schema files were not changed, so contract tests were not part of this lane floor. Root browser tests, browser UI, Docker, CI, deploy, and production were not run here. Independent Grok/Muse review belongs to the host lane.
