# Lane E — canary · read-only discovery canary (claim CANARY-1)

Read `GROUND-RULES.md` and `PROGRAM-SPEC.md` (Locked decisions win). Worktree: `/private/tmp/Job-Bored-discovery-hardening-canary`, branch `feat/discovery-hardening-canary`.

**Goal:** Add one deterministic, read-only operator command that classifies local worker health and the freshness of the newest successful discovery run.

**Success means:**
- `npm run discovery:canary -- --max-age-hours 24 --json` runs `scripts/discovery-canary.mjs`.
- Status enum exactly: `healthy`, `stale`, `unavailable`, `misconfigured`. Exit codes (spec LD-7): `healthy`=0, `stale`=1, `unavailable`=2, `misconfigured`=3, unhandled internal error=4. Precedence when several apply: misconfigured > unavailable > stale > healthy. One test per row plus one precedence test. Documented in `docs/DISCOVERY-CANARY.md`.
- Sources (LD-7): worker `/health` through injected `fetchImpl`, classified with the already-exported `isBrowserUseDiscoveryHealth` from `scripts/bootstrap-local-discovery.mjs` (build the probe shape `{ok, reachable, statusCode, serviceName, workerStatus, mode, platform, body}` yourself — `probeHealth` there is not exported and uses global fetch), URL from `buildLocalHealthUrl` in `scripts/discovery-shared-helpers.mjs`; pin the payload contract against `integrations/browser-use-discovery/tests/mocks/health-response.ok.v1.json`. Newest successful DISCOVERY run from the local run-state snapshot directory (default `~/.jobbored/browser-use-discovery/run-state`, override `--state-dir <dir>`; `--worker-url <origin>` optional, default the local worker port) — filter OUT `ingest_` runs; success = `status ∈ {completed, partial, empty}`. Sheets is NEVER read; a future request for it answers `unavailable` / `sheets_credential_not_available`.
- Read-only reader (LD-6): add ONE additive pure export `listRunStatusSnapshots(directory)` to `integrations/browser-use-discovery/src/state/run-status-store.ts` (readdirSync + the file's existing filename decode + JSON.parse + `isRunStatusSnapshot`; SKIP malformed entries; never mkdir, never delete `.tmp-` files, never rewrite). NEVER call `createDiscoveryRunStatusStore` from the canary — the scout proved merely opening it deletes files. Add cases to `integrations/browser-use-discovery/tests/state/run-status-store.test.ts` proving the lister leaves a directory (including a stray `.tmp-` file and a malformed snapshot) byte-for-byte untouched. Importing worker `.ts` from a root `.mjs` is established (`tests/discovery-run-status-polling.test.mjs:7`); `node scripts/discovery-canary.mjs` relies on Node 24 default type stripping — verify it runs without flags.
- Redaction test feeds: a `ya29.fake…` token, a `sheetId`, a job title, and an `error` string through both health and run-state inputs; assert none appears in text or JSON output. Emit only: status, fixed-enum reasons, runId, ISO timestamps, ages, health-URL origin.
- `parseArgs`: copy the valued-flag loop shape from `scripts/discovery-keep-alive.mjs:487` (`--max-age-hours <n>` integer ≥ 1, `--json`, `--state-dir`, `--worker-url`, `--help` → usage exit 0, unknown flag → misconfigured exit 3). Everything else copies `scripts/doctor.mjs` (`check/summarize`, `runCanary(options)` with `now`/`fetchImpl`/`readRunHistory` DI defaulted at the top, `formatCanaryReport`, `import.meta.url` main guard, `export { classifyCanary, formatCanaryReport, runCanary }`).
- `tests/discovery-canary.test.mjs` (`CANARY-1:` prefix) injects `now`, `fetchImpl`, and the run-history reader; covers all four statuses + the exit codes + redaction; no network, no real files under `~`.
- Text and JSON output never print credentials, request headers, tokens, or job/source content (test it: feed a payload containing `ya29.fake…` and a job title, assert absent).
- The command performs NO mutation: no run start, no Sheet write, no credential refresh, no restart. Read-only fetches of `/health` and the run-history source only.
- Reuse the readers the locked spec names; the canary is a thin classifier (`classifyCanary(inputs) → {status, reasons[]}` as a pure exported function).

**Fence (exclusive):** `scripts/discovery-canary.mjs`, `tests/discovery-canary.test.mjs`, `package.json` (exactly two edits: `"discovery:canary": "node scripts/discovery-canary.mjs",` right after `discovery:keep-alive` at line 35, and `&& node --check scripts/discovery-canary.mjs` right after the existing `node --check scripts/discovery-keep-alive.mjs` in `typecheck:repo`), `docs/DISCOVERY-CANARY.md`, `integrations/browser-use-discovery/src/state/run-status-store.ts` (the one additive export only) + `integrations/browser-use-discovery/tests/state/run-status-store.test.ts` (additive cases).

**RED probes (run first, paste output):**
```bash
npm run discovery:canary -- --max-age-hours 24 --json   # observed: npm error Missing script: "discovery:canary"  (capture $? unpiped)
node --experimental-strip-types --test .lane-evidence/scout-worker/canary-run-history-reader.probe.test.ts   # observed: no read-only listing export; opening the store deleted a .tmp- file
```

**Targeted gate:** `npm test -- tests/discovery-canary.test.mjs`, then the four deterministic fixture invocations (one per status) with exit codes pasted, then `npm run typecheck:repo`.

**DoD:** RED pasted → GREEN pasted → targeted gates → full floor → diff reviewed, secret-scanned → ONE local commit `feat(discovery-hardening/canary): …` → SHA in report. Never push.
