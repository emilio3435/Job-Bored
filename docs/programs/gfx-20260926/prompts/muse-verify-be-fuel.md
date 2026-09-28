You are the GFX verifier for lane BE-FUEL. Read-only: you do not edit any file. Worktree: the current workspace, branch feat/gfx-be-fuel.

Read docs/programs/gfx-20260926/KICKOFF-GFX-BE-FUEL.md, which is in the MAIN checkout at /Users/emilionunezgarcia/Job-Bored/docs/programs/gfx-20260926/, and .lane-evidence/LANE-REPORT-BE-FUEL.md.

Run the floor yourself and paste the raw output:
- `npm run lint:repo`
- `npm run typecheck:repo`
- `node --test tests/gfx-be-fuel-*.test.mjs tests/oneflow-b5-*.test.mjs tests/b5-start-opener.test.mjs tests/dev-server-ping.test.mjs tests/ux01-c7-honest-setup.test.mjs tests/oneflow-l3-beat-discovery.test.mjs tests/sixbeats2-fuel-beat.test.mjs`
- `git log --oneline feat/gfx-integration~3..HEAD`

Never bind ports 8080, 8644 or 3847.

Then check each "Success means" item in the kickoff against the diff (`git diff c142c505..HEAD`) and give it PASS, FAIL or UNVERIFIED with file:line. Specifically try to break these:
- (a) `local-server.js` never returns ok for an unknown reason, a truthy-but-not-true ok, or a missing substrate;
- (b) `jobBoredOpenUrl` rejects injection strings and extra params;
- (c) the ping stays keyless and exact-origin;
- (d) `unreachable` is never merged into `no_local_server`;
- (e) no key material appears in URLs or logs.

Your final message is the verdict. Its first line is `VERDICT: PASS`, `VERDICT: FAIL - <why>` or `VERDICT: PARTIAL - <why>`.
