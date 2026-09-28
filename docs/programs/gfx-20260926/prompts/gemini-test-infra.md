Read-only exploration of /Users/emilionunezgarcia/Job-Bored. Map the test infrastructure that GFX lanes must use for onboarding beats B1–B6, the discovery wizard, dev-server /__proxy/* routes, and scripts/start-*.mjs.

For each area, give:
- (1) the test files and the harness modules (tests/oneflow-l0-harness.mjs, oneflow-l3-harness.mjs, hermetic-harness.mjs, etc.): what each one stubs and how to load a beat in isolation;
- (2) the Playwright suites (tests/e2e-onboarding and the journey suite): how they run, which config files they use, and which network routes they fulfil;
- (3) the host-leak hazards. hermetic-harness does NOT fence same-origin /profile/* or /__proxy/*, and local runs can restart the live :8644 worker and edit ~/.jobbored .env. Find installHostIsolation (UX01) and say how a lane should use it;
- (4) how `npm test` (scripts/run-tests.mjs) selects files, and the exact command to run one file;
- (5) the eslint config and why it scans .worktrees/ (give the exact ignore fix);
- (6) existing fixtures useful for a "stale dev-server" or "foreign static server" test.

Be concrete, with file:line. Cap at 250 lines. Write to the report path you were given.
