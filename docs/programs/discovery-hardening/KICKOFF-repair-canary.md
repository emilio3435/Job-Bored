# Repair lane E — MINOR-6, MINOR-7, MINOR-8 from the integrated QA review (CANARY-1)

Read `docs/programs/discovery-hardening/GROUND-RULES.md`, then `.lane-evidence/qa-report.md` §MINOR-6, §MINOR-7, §MINOR-8. You are a FRESH lane on branch `feat/discovery-hardening-canary` (HEAD `f35074f`). Same fence as Lane E: `scripts/discovery-canary.mjs`, `tests/discovery-canary.test.mjs`, `docs/DISCOVERY-CANARY.md`, `package.json` (no change expected), `integrations/browser-use-discovery/src/state/run-status-store.ts` (no change expected).

**Goal:** The canary never asserts a fact it did not check, its doc matches its code, and every documented exit code has a test.

**Success means:**
1. MINOR-6: on an argument/config error the report carries ONLY the config-error reasons (e.g. `unknown_argument`) — no fabricated `worker_unreachable` / `run_state_unreadable`; the `worker:` and `newest successful run:` lines say "not checked" (or are omitted) rather than claiming `reachable=false`. Status stays `misconfigured`, exit 3. Test: feed `--bogus-flag`, assert `reasons` deep-equals the config-error reasons only and no probe/read function was called.
2. MINOR-7: `docs/DISCOVERY-CANARY.md` reason table — either remove `sheets_credential_not_available` from the `reasons` enum table or footnote it as report-only (it appears in the `sheets:` line, never in `reasons`, and must not, or the canary could never be healthy). Doc must match code exactly; add a test that the documented reason list equals `Object.keys(CANARY_REASONS)` minus the report-only ones (read the doc file in the test).
3. MINOR-8: make the internal-error path testable — extract the main body into an exported `runCli(argv, { stdout, stderr, ...deps })` (or equivalent) that the `import.meta.url` guard calls, so a test can inject a `runCanary` that throws and assert exit code 4 plus a redacted one-line error (no stack, no paths). RED first (paste), then GREEN.

**First action:** create `LANE-REPORT-repair-canary.md` (five PENDING headings).

**Gate:** `npm test -- tests/discovery-canary.test.mjs`, the four CLI status invocations (fixtures under `.lane-evidence/canary-fixtures/`, health server recipe in your predecessor's report `.lane-evidence/predecessor-report.md`), `npm run typecheck:repo`, then the full floor. ONE local commit `fix(discovery-hardening/canary): …`, SHA in the report. Never push.
