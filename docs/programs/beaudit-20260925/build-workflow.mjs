export const meta = {
  name: 'beaudit-build',
  description: 'Build SPEC-BEAUDIT-20260925: dependency-gated Opus 5.5 medium lanes, Muse verify, second-vendor review, serial merge queue',
  whenToUse: 'After SPEC-BEAUDIT-20260925 §0 is locked. Run wave 0 first (incident PR), then waves 1, 2 and 3 after Emilio merges each PR.',
  phases: [
    { title: 'Preflight', detail: '§0, PR gates, landed lanes, quota, integration worktree, baseline floor' },
    { title: 'Build', detail: 'one Opus 5.5 medium agent per lane, started when its dependencies merge', model: 'opus' },
    { title: 'Verify', detail: 'Muse re-runs the floor, the new tests and every claim reproducer' },
    { title: 'Review', detail: 'second-vendor diff review (astra-ro by default, grok when it has balance)' },
    { title: 'Integrate', detail: 'serial merge queue; the floor runs on each merged tree before commit' },
    { title: 'Close', detail: 'final floor and e2e, gitleaks, sweep, completeness critic, PR command for Emilio' },
  ],
}

// ---------- configuration (args override) ----------
const PROG = '/Users/emilionunezgarcia/Job-Bored.worktrees/beaudit-integration/docs/programs/beaudit-20260925'
const REPO = '/Users/emilionunezgarcia/Job-Bored'
const WTS = '/Users/emilionunezgarcia/Job-Bored.worktrees'
const A = args || {}
const WAVES = A.waves || [0]
const ONLY = A.only || null
const REVIEW_RUNG = A.reviewRung || 'astra-ro'
const MAX_REPAIRS = A.maxRepairs === undefined ? 2 : A.maxRepairs
const STAMP = A.stamp || 'unstamped'
const INTEGRATION = A.integrationBranch || (WAVES.includes(0) ? 'fix/beaudit-p0-containment' : `feat/beaudit-build-w${WAVES.join('')}`)
const INT_WT = `${WTS}/bbuild-${INTEGRATION.replace(/[^A-Za-z0-9]+/g, '-')}`
const MODEL = { model: 'opus', effort: 'medium' } // §0.9: every lane is Opus 5.5 at medium effort
const FLOOR = 'npm run lint:repo && npm run typecheck:repo && npm test && npm run test:browser-use-discovery && npm run test:contract:all'
const E2E = 'npm run test:e2e-smoke && npm run test:e2e-journey'

// ---------- lanes (SPEC §8 as amended by §0) ----------
// deps: lane ids that must be merged first (in this run, or already on origin/main from an earlier run)
// gates: external conditions the preflight checks (PRs Emilio merges)
const LANES = [
  // Wave 0 — P0 containment, shipped as its own incident PR (§0.1)
  { id: 'P', wave: 0, name: 'Perimeter', deps: [], gates: [], browser: true,
    claims: ['E1', 'G2', 'G3', 'A1', 'G4', 'G10', 'E17'], decisions: ['0.1'],
    fence: ['integrations/browser-use-discovery/src/server.ts (request listener and URL parsing only)', 'server/security-boundaries.mjs (origin and Host section only; the SSRF section belongs to lane X)', 'server/index.mjs (middleware only)', 'dev-server.mjs (request gate, /profile proxy, full-boot skip_tunnel)', 'scripts/lib/static-path-guard.mjs', 'scripts/lib/browser-csp-policy.mjs', 'discovery-autodetect.js', 'tests/ (new or updated tests for these claims)', 'integrations/browser-use-discovery/tests/ (router tests)'],
    probes: ['A/repro-a1-crash.sh', 'A/sec05-raw-paths.mjs', 'E/probe-e-cors.sh', 'G/g-profile-rebind.sh', 'G/g-static-traversal.sh', 'G/g-autodetect-fullboot.mjs'],
    notes: 'One loopback guard (Host in {127.0.0.1, localhost, [::1]}:port, exact Origin) shared by the dev-server, API and worker listeners. Static serving becomes an allowlist. Autodetect may only start the local worker (skip_tunnel=1).' },
  { id: 'R', wave: 0, name: 'Relay auth', deps: [], gates: [], browser: true,
    claims: ['G1', 'G24'], decisions: ['0.7', '0.4'],
    fence: ['templates/cloudflare-worker/**', 'scripts/deploy-cloudflare-relay.mjs', 'integrations/cloudflare-relay-template/**', 'discovery-wizard-relay.js', 'apps-script-relay-helpers.js', 'the browser call sites that POST to the relay (find them with grep; list them in the report)', 'README.md, SETUP.md, docs/ (relay and hosted-mode sections)', 'tests/cloudflare-relay-*.test.mjs, tests/relay-*.test.mjs'],
    probes: ['G/g-relay-open-proxy.mjs'],
    notes: 'Deploy mints a per-dashboard bearer token stored in the dashboard config; the relay answers 401 without it and forwards only /webhook and /runs/*. tests/cloudflare-relay-secret-injection.test.mjs:116 pins the unauthenticated injection as correct — change it and say why in the commit body. Also mark hosted mode unsupported in the docs (§0.4).' },
  { id: 'X', wave: 0, name: 'Egress', deps: ['P'], gates: [],
    claims: ['C1', 'C2', 'D15', 'C8', 'C9', 'E8', 'C16'], decisions: ['0.1'],
    fence: ['integrations/browser-use-discovery/src/browser/session.ts', 'integrations/browser-use-discovery/bin/browser-use-agent-browser.mjs', 'integrations/browser-use-discovery/src/cleanup/expired-job-cleanup.ts (checkJobPostingUrl only)', 'integrations/browser-use-discovery/src/net/**', 'server/security-boundaries.mjs (SSRF section: private ranges, safeFetch, pinnedFetch)', 'tests/, integrations/browser-use-discovery/tests/ (for these claims)'],
    probes: ['C/C-ssrf-session.mjs', 'C/C-ssrf-browser-command.sh', 'C/C-safefetch-redirect-headers.mjs', 'D/p14-cleanup-loopback-fetch.mjs', 'E/probe-e-ssrf.mjs'],
    notes: 'Every outbound URL goes through safeFetch; the agent-browser command gets a pre-spawn DNS check; credential headers are stripped on cross-origin redirects; the body is capped while streaming. Add an optional abortSignal pass-through to sessionManager.run for lane D.' },

  // Wave 1 — substrates
  { id: 'S', wave: 1, name: 'Sheets client', deps: ['X'], gates: ['pr113', 'pr107'],
    claims: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D8', 'D9', 'D12', 'D13', 'D16', 'D17', 'D18', 'D19', 'A8', 'D7', 'D10', 'D20'], decisions: ['0.5'],
    fence: ['integrations/browser-use-discovery/src/sheets/**', 'integrations/browser-use-discovery/src/cleanup/** (not checkJobPostingUrl)', 'integrations/browser-use-discovery/src/webhook/handle-pipeline-update.ts', 'schemas/pipeline-row.v1.json, schemas/pipeline-update-request.*, examples/pipeline-update-request.*', 'AGENT_CONTRACT.md (pipeline sections), README.md (Sheet Structure), docs/CONTRACT-CHANGELOG.md', 'scripts/test-pipeline-contract.mjs, scripts/test-pipeline-update-contract.mjs', 'integrations/browser-use-discovery/tests/sheets/**, tests/webhook/handle-pipeline-update*'],
    probes: ['D/p01-concurrent-append-dup.mjs', 'D/p02-rowdrift-writer.mjs', 'D/p03-cleanup-stale-overwrite.mjs', 'D/p05-rediscovery-overwrites-user-columns.mjs', 'D/p06-formula-injection.mjs', 'D/p08-patcher-header-drift.mjs', 'D/p09-pipeline-update-applied-and-note-race.mjs', 'D/p12-half-written.mjs', 'D/fake-sheets.mjs'],
    notes: 'Build W/sheets/sheets-client.ts (token cache, per-Sheet mutex, Link re-resolution, schema-generated column map). pipeline-update becomes v2: Applied requires appliedDate and source; 409 header_mismatch and ambiguous_match. Adopt api-error.v1 once lane L lands it; until then keep the field names identical to the spec.' },
  { id: 'Q', wave: 1, name: 'AI provider', deps: [], gates: [],
    claims: ['E15', 'E2', 'E9', 'E10', 'E12', 'E14', 'E18', 'B17', 'E11'], decisions: [],
    fence: ['server/ai/** (new)', 'server/llm-config.mjs', 'server/model-family.mjs', 'server/ats-scorecard.mjs (provider section only)', 'server/shared/gemini-url-context-scrape.mjs', 'integrations/browser-use-discovery/src/ai/chat-provider.ts', 'the provider-call functions only of server/profile-from-resume.mjs, server/profile-rescore-worker.mjs and server/materials-drafter.mjs/materials-writer.mjs', 'tests/llm-*.test.mjs, tests/ats-scorecard-provider.test.mjs, new tests'],
    probes: ['E/probe-e-local-pin.sh', 'E/probe-e-cors.sh'],
    notes: 'server/ai/provider.mjs: one provider enum (local and ollama alias openai_compatible), keys from the llm.json pin only, Gemini key in the x-goog-api-key header, chat({messages, schema, signal, maxTokens}) with AbortSignal.any([timeout, request]), one ProviderApiError taxonomy with redacted upstream bodies. The worker chat-provider re-exports it. POST /api/llm-config keeps the stored key when apiKey is omitted.' },
  { id: 'L', wave: 1, name: 'Lifecycle and contracts', deps: ['P'], gates: ['pr102'],
    claims: ['A2', 'A3', 'A4', 'A5', 'A7', 'A9', 'A12', 'A14', 'A15', 'A16', 'A17', 'A18', 'A20', 'A21', 'E7', 'A13'], decisions: [],
    fence: ['integrations/browser-use-discovery/src/webhook/** (not handle-pipeline-update.ts)', 'integrations/browser-use-discovery/src/state/run-status-store.ts', 'integrations/browser-use-discovery/src/run/run-abort.ts', 'integrations/browser-use-discovery/src/contracts.ts', 'integrations/browser-use-discovery/src/config.ts (A16 write lock only)', 'integrations/browser-use-discovery/src/server.ts (route table and /runs routes)', 'schemas/** (not pipeline-row or materials), examples/**', 'AGENT_CONTRACT.md, docs/CONTRACT-CHANGELOG.md', 'server/index.mjs (error helper and route error responses)', 'integrations/browser-use-discovery/tests/webhook/**, tests/state/**, new tests'],
    probes: ['A/lifecycle.mts', 'A/ingest-order.mts', 'A/schema-drift.mts', 'E/probe-e-errshape.sh'],
    notes: 'api-error.v1 {error, code, detail, nextStep, retryable} for the API and the worker. Webhook v1.1: optional idempotencyKey hashed into the runId. POST /runs/:id/cancel. New v1 schemas: run-status, ingest-url, cleanup-expired, api-error. One runAsyncLifecycle for async discovery and ingest.' },
  { id: 'H', wave: 1, name: 'Hermes safety', deps: [], gates: [],
    claims: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11', 'H12', 'H13', 'H15', 'H16', 'H18', 'H19', 'H20', 'H22', 'H23'], decisions: ['0.6', '0.2'],
    fence: ['integrations/hermes-job-hunt/** except scripts/materials_watcher/**, scripts/materials_request.py, scripts/materials-request.sh, scripts/logo_resolver.py, resume-template/**, cover-letter-template/**', 'scripts/setup.mjs', '.github/workflows/ (a new Hermes pytest job only)', 'tests/approval-contract.test.mjs, tests/hermes-*.test.mjs'],
    probes: ['H/h_probe_pure.py', 'H/h_static.sh', 'H/h_argv_canary.py', 'H/h_setup_cp_force.mjs', 'H/h_pytest_shim.py'],
    notes: 'Apply stays shelved (§0.6): delete greenhouse_filler.py, remove CLI live mode, harden Gate 1 and Gate 2 (exact match, reply-to id, sender allowlist, cancel on any other reply). Owner PII and IDs become neutral examples loaded from gitignored local files, with no history rewrite (§0.2). H9 cannot be proved without Telegram: add a unit test with a stubbed getUpdates that returns 409.' },

  // Wave 2 — consumers of the substrates
  { id: 'D', wave: 2, name: 'Discovery engine', deps: ['Q', 'L', 'X'], gates: ['pr113'],
    claims: ['B1', 'B2', 'B3', 'B4', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13', 'B18', 'C3', 'C4', 'C5', 'C6', 'C7', 'C10', 'C12', 'C13', 'C15', 'E3', 'C17', 'C18'], decisions: ['0.8'],
    fence: ['integrations/browser-use-discovery/src/run/** (not run-abort.ts)', 'integrations/browser-use-discovery/src/normalize/**', 'integrations/browser-use-discovery/src/match/**', 'integrations/browser-use-discovery/src/discovery/**', 'integrations/browser-use-discovery/src/grounding/**', 'integrations/browser-use-discovery/src/state/discovery-memory-store.ts, listing-score-cache.ts, run-discovery-memory-store.ts', 'integrations/browser-use-discovery/src/browser/providers/**, src/browser/source-adapters.ts', 'integrations/browser-use-discovery/src/sources/**', 'integrations/browser-use-discovery/src/webhook/handle-ingest-url.ts (C6 and C12 only)', 'server/shared/job-scraper-core.mjs, server/shared/ats-job-fetchers.mjs', 'tests for these claims'],
    probes: ['B/B-frontier-saturation.mjs', 'B/B-e2e-exploit-cap.mjs', 'B/B-exploit-prose-bypass.mjs', 'B/B-hung-llm-outlives-run-cap.mjs', 'B/B-llm-calls-per-run.mjs', 'B/B-memory-write-only.mjs', 'B/B-provider-key-collision.mjs', 'B/B-zero-lead-partial-and-optout.mjs', 'B/B-allowlist-partial-unknown.mjs', 'C/C-run-ats-gating.mjs', 'C/C-ingest-lineage.mjs', 'C/C-jobboard-hint-only.mjs', 'E/probe-e-serp-sibling.mjs'],
    notes: 'Memory is wired, not deleted (§0.8): a stable intent hash replaces run:<runId>, successful ATS detections write company and surface records, and exploit outcomes feed frontier priorAcceptedYield. Promote the probes to run-level tests with production-scale fixtures (C15, B19).' },
  { id: 'M', wave: 2, name: 'Materials and profile', deps: ['Q', 'L'], gates: ['pr120'],
    claims: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F13', 'F14', 'F16', 'F17', 'F18', 'F20', 'E13', 'F19', 'F21'], decisions: ['0.3', '0.2'],
    fence: ['server/materials-*.mjs', 'server/application-materials.mjs', 'server/profile-*.mjs', 'server/user-profile.mjs', 'server/legacy-profile-migrator.mjs', 'server/brand-logos.mjs', 'server/index.mjs (/profile* and /api/applications/* routes only)', 'integrations/hermes-job-hunt/resume-template/**, cover-letter-template/**, scripts/materials_watcher/**, scripts/materials_request.py, scripts/materials-request.sh, scripts/logo_resolver.py', 'integrations/browser-use-discovery/src/profile/**, src/contracts/user-profile.*', 'schemas/materials-*.v1.schema.json (from #120)', 'tests for these claims'],
    probes: ['F/F-materials-e2e.sh', 'F/F-profile-critic.mjs', 'F/F-rescore-overlap.mjs'],
    notes: 'Build PR #120 claim-ledger design (§0.3): the master comes from the user resume and profile, 3 narrow calls, a cache key; neutral example templates (§0.2); template and logo roots under ~/.jobbored, never the repo (F7); rescore single-flight with a generation id and RAW or escaped writes (F4, F5).' },
  { id: 'O', wave: 2, name: 'Ops and hosted', deps: ['L', 'P'], gates: [],
    claims: ['G5', 'G6', 'G7', 'G8', 'G9', 'G11', 'H14', 'G12', 'G13', 'G14', 'G15', 'G16', 'G19', 'G20', 'E5', 'E6'], decisions: ['0.4'],
    fence: ['scripts/** (not setup.mjs)', 'dev-server.mjs (worker lifecycle, installers and Tailscale sections)', 'server/Dockerfile, server/.dockerignore, render.yaml', 'package.json (scripts), .github/workflows/ci.yml, .github/workflows/pages.yml', 'integrations/browser-use-discovery/src/server.ts (/health payload identity fields only)', 'README.md (platform matrix and hosted sections)', 'tests for these claims'],
    probes: ['G/g-port-collision.sh', 'G/g-respawn-hold.sh', 'G/g-fullboot-foreign-checkout.mjs', 'G/g-autostart-status-artifact.mjs', 'G/g-keepalive-tailscale.mjs', 'G/g-env-writer-dollar.mjs', 'E/probe-e-docker-sim.sh', 'E/probe-e-hosted.sh'],
    notes: 'Worker /health gains {repoRoot, version, envSources}; the starter names the port owner and holds instead of exiting; hosted mode works end to end (E5, E6) per §0.4.' },
  { id: 'B', wave: 2, name: 'Browser surfaces', deps: ['L', 'S'], gates: [], browser: true,
    claims: ['E4', 'D11'], decisions: ['0.4'],
    fence: ['hosted-api-auth.js, app-config-core.js', 'the browser fetch sites that call the API (one apiFetch helper)', 'submission-flow.js, sheets-writeback.js, pipeline-transitions.js, flowing-writes.js', 'tests/ and tests/e2e-* for these claims'],
    probes: ['E/probe-e-hosted.sh', 'D/p13-browser-writer-divergence.mjs'],
    notes: 'Every API call goes through one apiFetch() that attaches the hosted token; the Applied flow writes its evidence through planTransition and pipeline-update v2.' },

  // Wave 3 — features (serialized where they share files) and cleanup
  { id: 'F1', wave: 3, name: 'Discovery preview and cost receipt', deps: ['D', 'L'], gates: [], browser: true,
    claims: ['B20', 'B23'], decisions: [], fence: ['worker preview route and handler', 'DiscoveryRuns cost columns (docs/INTERFACE-DISCOVERY-RUNS.md)', 'discovery drawer run button surface', 'schemas/discovery-preview.v1.schema.json', 'tests'], probes: [], notes: 'See MOCKUP.html Features #1 and Contracts "Discovery preview".' },
  { id: 'F6', wave: 3, name: 'Run history drill-down', deps: ['F1'], gates: [], browser: true,
    claims: ['A19', 'C22'], decisions: [], fence: ['worker GET /runs list route', 'schemas/run-status-list.v1.schema.json', 'runs-tab.js', 'tests'], probes: [], notes: 'Mockup Features #6.' },
  { id: 'F5', wave: 3, name: 'Capture preview', deps: ['F6'], gates: [], browser: true,
    claims: ['C19', 'E20'], decisions: [], fence: ['worker /ingest-url preview mode', 'server/shared/job-scraper-core.mjs (provenance fields)', 'ingest-url-flow.js', 'schemas/ingest-url.v1.schema.json', 'tests'], probes: [], notes: 'Mockup Features #5.' },
  { id: 'F8', wave: 3, name: 'Saved searches', deps: ['F1'], gates: [], browser: true,
    claims: ['B21'], decisions: ['0.8'], fence: ['saved-search table and trigger in the worker', 'worker config schema', 'discovery drawer saved-search surface', 'tests'], probes: [], notes: 'Builds on the stable intent hash from lane D.' },
  { id: 'F3', wave: 3, name: 'Duplicate review', deps: ['S', 'B'], gates: [], browser: true,
    claims: ['D22'], decisions: [], fence: ['Review tab writer in W/sheets', 'schemas/review-tab.v1.schema.json', 'board badge and merge drawer', 'tests'], probes: [], notes: 'Mockup Features #3.' },
  { id: 'F4', wave: 3, name: 'Timeline, funnel and receipt', deps: ['F3', 'H'], gates: [], browser: true,
    claims: ['D23', 'D24', 'H24'], decisions: [], fence: ['PipelineEvents writer (every stage writer appends)', 'schemas/pipeline-events.v1.schema.json, schemas/application-receipt.v1.schema.json', 'dossier timeline and funnel surfaces', 'tests'], probes: [], notes: 'Mockup Features #4.' },
  { id: 'F7', wave: 3, name: 'Setup control center', deps: ['O', 'Q'], gates: [], browser: true,
    claims: ['G21', 'G22', 'E21'], decisions: [], fence: ['dev-server /__proxy/ops-status (read-only)', 'POST /api/llm-config/verify', 'setup-doctor.js and Settings surfaces', 'tests'], probes: [], notes: 'Mockup Features #7. Diagnostics never install anything.' },
  { id: 'F9', wave: 3, name: 'Rescore preview', deps: ['M'], gates: [], browser: true,
    claims: ['F23'], decisions: [], fence: ['server/profile-rescore-worker.mjs and its route (preview mode)', 'Settings rescore surface', 'tests'], probes: [], notes: 'Mockup Features #9.' },
  { id: 'Z', wave: 3, name: 'File splits and docs', deps: ['F1', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9'], gates: [],
    claims: ['B15', 'B16', 'C14', 'G18', 'A11', 'G17', 'E16'], decisions: [], fence: ['the files each claim names (pure moves pinned by the existing tests)', 'docs'], probes: [], notes: 'Mechanical splits only: no behavior change; every existing test stays green unchanged.' },
]
LANES.forEach((l, i) => { l.ports = `${19000 + i * 10}-${19000 + i * 10 + 9}` })
const byId = Object.fromEntries(LANES.map(l => [l.id, l]))
const branchOf = l => `${l.wave === 0 ? 'fix' : 'feat'}/beaudit-w${l.wave}-${l.id.toLowerCase()}`
const wtOf = l => `${WTS}/bbuild-${l.id.toLowerCase()}`
const floorOf = l => FLOOR + (l.browser ? ` && ${E2E}` : '')

// ---------- schemas ----------
const PRE_SCHEMA = { type: 'object', required: ['ok', 'blockers', 'gates', 'landedLanes', 'quota', 'integrationHead', 'baseline'], properties: {
  ok: { type: 'boolean' }, blockers: { type: 'array', items: { type: 'string' } },
  gates: { type: 'array', items: { type: 'object', required: ['id', 'ok', 'detail'], properties: { id: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } } } },
  landedLanes: { type: 'array', items: { type: 'string' } },
  quota: { type: 'array', items: { type: 'object', required: ['pool', 'reading'], properties: { pool: { type: 'string' }, reading: { type: 'string' } } } },
  integrationHead: { type: 'string' }, baseline: { type: 'string' } } }
const BUILD_SCHEMA = { type: 'object', required: ['status', 'branch', 'worktree', 'head', 'claimsDone', 'claimsDeferred', 'testsAdded', 'floorPassed', 'floorSummary', 'reportPath'], properties: {
  status: { type: 'string', enum: ['done', 'blocked'] }, branch: { type: 'string' }, worktree: { type: 'string' }, head: { type: 'string' },
  commits: { type: 'array', items: { type: 'string' } }, claimsDone: { type: 'array', items: { type: 'string' } },
  claimsDeferred: { type: 'array', items: { type: 'object', required: ['id', 'reason'], properties: { id: { type: 'string' }, reason: { type: 'string' } } } },
  testsAdded: { type: 'array', items: { type: 'string' } }, floorPassed: { type: 'boolean' }, floorSummary: { type: 'string' },
  reportPath: { type: 'string' }, blocker: { type: 'string' } } }
const VERIFY_SCHEMA = { type: 'object', required: ['verdict', 'failures', 'walled', 'verdictPath'], properties: {
  verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, failures: { type: 'array', items: { type: 'string' } },
  walled: { type: 'boolean' }, wallDetail: { type: 'string' }, verdictPath: { type: 'string' } } }
const REVIEW_SCHEMA = { type: 'object', required: ['blocking', 'nonBlocking', 'walled', 'reviewPath'], properties: {
  blocking: { type: 'array', items: { type: 'string' } }, nonBlocking: { type: 'array', items: { type: 'string' } },
  walled: { type: 'boolean' }, wallDetail: { type: 'string' }, reviewPath: { type: 'string' } } }
const MERGE_SCHEMA = { type: 'object', required: ['merged', 'head', 'floorSummary', 'gitleaks', 'detail'], properties: {
  merged: { type: 'boolean' }, head: { type: 'string' }, floorSummary: { type: 'string' }, gitleaks: { type: 'string' },
  conflicts: { type: 'array', items: { type: 'string' } }, detail: { type: 'string' } } }
const CLOSE_SCHEMA = { type: 'object', required: ['floorSummary', 'gitleaks', 'swept', 'kept', 'reportPath', 'commandsForEmilio'], properties: {
  floorSummary: { type: 'string' }, gitleaks: { type: 'string' }, swept: { type: 'array', items: { type: 'string' } },
  kept: { type: 'array', items: { type: 'string' } }, reportPath: { type: 'string' }, commandsForEmilio: { type: 'array', items: { type: 'string' } } } }
const CRITIC_SCHEMA = { type: 'object', required: ['uncoveredP0P1', 'unverified', 'nextRunArgs'], properties: {
  uncoveredP0P1: { type: 'array', items: { type: 'string' } }, unverified: { type: 'array', items: { type: 'string' } },
  nextRunArgs: { type: 'string' } } }

// ---------- prompts ----------
function preflightPrompt(sel) {
  const gates = [...new Set(sel.flatMap(l => l.gates))]
  const crossDeps = [...new Set(sel.flatMap(l => l.deps).filter(d => !sel.some(s => s.id === d)))]
  return `Preflight for the BEAUDIT build program (waves ${WAVES.join(', ')}; lanes ${sel.map(l => l.id).join(', ')}). You are read-only except for creating the integration worktree.

Goal: report whether this run may start, and set up ${INTEGRATION}.
Success means: every field of the schema is filled from commands you ran; ok is false when any blocker exists.
Stop when: the schema is filled.

1. Spec §0: ${PROG}/SPEC-BEAUDIT-20260925.md §0 must hold rows 0.1 to 0.9 (not "Empty until"). Otherwise blocker "spec §0 not locked".
2. Gates (read-only gh; never merge, comment or push). Required: ${gates.length ? gates.join(', ') : 'none'}. For each gate id prN, run \`gh pr view N --repo emilio3435/Job-Bored --json state,mergedAt\` and set ok=true only when mergedAt is set. Report every required gate, ok or not; an unmet gate is NOT a blocker (the lane will be deferred), just report it.
3. Landed lanes: \`git -C ${REPO} fetch origin --quiet\`, then collect every value of the commit trailer "Beaudit-Lane: <id>" on origin/main (\`git -C ${REPO} log origin/main --format=%B | grep '^Beaudit-Lane: '\`) and, if the branch ${INTEGRATION} exists locally, on it too. This run needs these lanes from earlier runs: ${crossDeps.length ? crossDeps.join(', ') : 'none'} — list them in landedLanes only if you found the trailer.
4. Quota: read the Claude pool (every build lane runs there): \`script -q <your scratch dir>/usage.raw claude /usage\` then parse "Current session", "Current week (all models)" and their "Resets" lines from the capture (strip ANSI escapes). Report Codex as "unknown" unless you can read it without touching credentials, and Muse as "unknown (dashboard only; Emilio approved blind Muse runs for BEAUDIT)". Any pool at 100% or more is a blocker "QUOTA WALL <pool>".
5. Integration worktree ${INT_WT}: if it does not exist, create it: \`git -C ${REPO} worktree add ${INT_WT} -b ${INTEGRATION} origin/main\` (if the branch already exists, omit -b and check it out). Symlink node_modules: \`ln -s ${REPO}/node_modules ${INT_WT}/node_modules\` and \`ln -s ${REPO}/server/node_modules ${INT_WT}/server/node_modules\` when missing. Never touch ${REPO}'s own checkout (Emilio's branch and dirt).
6. Baseline: in ${INT_WT} run \`${FLOOR}\` and put each command's pass/fail counts line in baseline. A red baseline is a blocker "baseline red: <command>".

Return integrationHead as \`git -C ${INT_WT} rev-parse HEAD\`.`
}

function buildPrompt(l, failures) {
  const wt = wtOf(l), br = branchOf(l)
  const setup = failures
    ? `Reuse the existing worktree ${wt} on ${br}. Your earlier work is committed there; do NOT redo it.`
    : `Create it: \`git -C ${REPO} worktree add ${wt} -b ${br} ${INTEGRATION}\` (if ${wt} already exists from an interrupted run, reuse it and continue from its commits). Then \`ln -s ${REPO}/node_modules ${wt}/node_modules && ln -s ${REPO}/server/node_modules ${wt}/server/node_modules\`.`
  const repair = failures
    ? `\nRepair round. Muse verification or the second-vendor review failed with these issues. Fix exactly these, keep everything else, re-run the floor and commit:\n${failures.map(f => '- ' + f).join('\n')}\n`
    : ''
  return `You are build lane ${l.id} (${l.name}) of the BEAUDIT build program. Emilio pinned every lane to Opus 5.5 at medium effort (spec §0.9).

Goal: land claims ${l.claims.join(', ')} on branch ${br}, each proved by a test that fails before your change and passes after it.
Success means:
- Every claim is fixed or explicitly deferred with a reason; every fixed claim has a regression test (promote the named audit probe where one exists).
- The floor passes in your worktree: \`${floorOf(l)}\`.
- Commits sit on ${br} only; each commit message ends with the trailer "Beaudit-Lane: ${l.id}" followed by the attribution lines from your instructions; nothing is pushed.
Stop when: all claims are done or deferred and the floor is green, or a blocker you cannot clear (then status "blocked" with the blocker).

Read first:
- ${PROG}/SPEC-BEAUDIT-20260925.md. §0 overrides the rest of the spec. Decisions that bind this lane: ${l.decisions.length ? l.decisions.map(d => '§' + d).join(', ') : 'none beyond §0 in general'}.
- Your register rows: ${PROG}/verdicts/_register.json (each row's "ids" lists merged rows). Full evidence: ${PROG}/REGISTER.md and ${PROG}/reports/LANE-REPORT-<letter>.md, where the letter is the first character of the claim id.
- Audit reproducers: ${l.probes.length ? l.probes.map(p => `${PROG}/probes/${p}`).join(', ') : 'none (feature lane: write the tests from the MOCKUP contract)'}.
- ${PROG}/MOCKUP.html (Contracts and Features tabs are the API and UI targets).
${l.notes ? `\nLane notes: ${l.notes}\n` : ''}
Fence (edit only these; new files under them are fine):
${l.fence.map(f => '- ' + f).join('\n')}
Other lanes own everything else. If a fix needs a file outside the fence, do not edit it: report it as a blocker naming the file and why.

Worktree: ${setup} Work only in ${wt}. Never touch ${REPO} (Emilio's checkout) or any other worktree.
${repair}
Rules:
- Red first: write or promote the test, watch it fail for the claimed reason, then fix.
- Contract invariant (AGENTS.md): a change to a webhook, pipeline, ATS or other schema-bearing payload updates the schema, examples, AGENT_CONTRACT.md and docs/CONTRACT-CHANGELOG.md together; run \`npm run test:contract:all\`.
- Any server you start runs with HOME="${wt}/.lane-evidence/home" on ports ${l.ports}. Never write under ~/.jobbored or ~/.hermes. Never POST to 8080, 3847, 8644 or 8645, and never kill those listeners.
- No network beyond 127.0.0.1 in tests or probes: no paid provider, Google, Telegram, ATS, tunnel or deploy calls.
- Stage only fence paths (never \`git add -A\`), run \`gitleaks protect --staged --redact\` before each commit, and treat a hit as a blocker.
- Never push, open a PR, merge into ${INTEGRATION}, or deploy. The integration runner merges.
- Change an existing test only when the behavior it pins genuinely changes, and say so in the commit body.
- Commit green increments as you go, so an interrupted run resumes from your commits.
- Keep ${wt}/.lane-evidence/BUILD-REPORT-${l.id}.md current (write a temp file, then rename). First line DONE or BLOCKED: <why>. Sections: claims done, claims deferred, tests added with red then green evidence, floor output pasted, unverified.

Return the schema: head is \`git -C ${wt} rev-parse HEAD\`; floorSummary is the pass/fail counts line of each floor command.`
}

function verifyPrompt(l, b, round) {
  const wt = wtOf(l), tag = `${l.id}-r${round}`
  return `You are the Muse verify runner for build lane ${l.id}. You do not judge the code yourself: you launch Muse (a different model family, because the family that wrote the work never verifies it), wait for it, and relay its verdict.

Goal: a PASS or FAIL for lane ${l.id} at ${b.head}, decided by Muse's output alone.
Success means: ${PROG}/verdicts/BUILD-VERDICT-${tag}.json holds Muse's final JSON, and your verdict follows the rule in step 4.
Stop when: that file exists and you have returned, or Muse hit a quota wall (walled=true).

1. Write ${wt}/.lane-evidence/VERIFY-BUILD-${tag}.md containing these instructions for Muse:
   "Verify and leave the code as you found it. In ${wt} at HEAD ${b.head}: (a) run each floor command separately: ${floorOf(l).split(' && ').join(' ; ')}; (b) run each added or changed test: ${(b.testsAdded || []).join(', ') || 'see BUILD-REPORT-' + l.id + '.md'}; (c) for each claim ${l.claims.join(', ')}, re-run its audit reproducer from ${PROG}/probes/ (the lane report at ${PROG}/reports/LANE-REPORT-<letter>.md §4 names the command) and report FIXED if the defect no longer appears, STILL-BROKEN if it does, UNCLEAR otherwise. Servers you start use HOME=${wt}/.lane-evidence/home and ports ${l.ports}; no network beyond 127.0.0.1; never POST to 8080, 3847, 8644 or 8645; never read secret files. Paste the decisive output for every check. Your final answer is one JSON object matching the output schema."
2. Launch Muse with Bash run_in_background (it takes several minutes; never a foreground sleep), from ${wt}:
   muse exec --model muse-spark-1.3-contributor --reasoning-effort max --json --workspace ${wt} --disable-web-tools --disable-write --user-input-auto-resolve --max-model-steps 300 --max-tool-output-bytes 200000 --output-schema ${PROG}/build-verdict.schema.json --prompt-file .lane-evidence/VERIFY-BUILD-${tag}.md
   Send stdout to .lane-evidence/VERIFY-${tag}.jsonl and stderr to .lane-evidence/VERIFY-${tag}.stderr (if a shell guard refuses a redirect, pipe through \`tee -a\`).
3. When it exits, take the event whose payload_type starts with "run.terminal", parse payload.text as JSON, and save it to ${PROG}/verdicts/BUILD-VERDICT-${tag}.json. If stderr or the stream shows a quota, billing or rate-limit error (402, 429, "exhausted", "usage limit"), return walled=true with the message and verdict FAIL.
4. verdict = PASS only when every floor entry passed, every test passed and every claim is FIXED. Otherwise FAIL, with one failures line per failing check: "<check>: <decisive output line>".`
}

function reviewPrompt(l, b) {
  const wt = wtOf(l)
  const cmd = REVIEW_RUNG === 'grok'
    ? `grok -m grok-4.7-build-fast --reasoning-effort xhigh --permission-mode auto --sandbox review --no-subagents -s <a fresh uuidgen> --disable-web-search --json-schema "$(cat ${PROG}/review.schema.json)" --prompt-file .lane-evidence/REVIEW-PROMPT-${l.id}.md --output-format json`
    : `codex exec -p verify -m gpt-6-astra -c 'model_reasoning_effort="xhigh"' -s read-only -C ${wt} --output-schema ${PROG}/review.schema.json -o .lane-evidence/REVIEW-${l.id}.json - (prompt on stdin from .lane-evidence/REVIEW-PROMPT-${l.id}.md)`
  return `You are the second-vendor review runner for build lane ${l.id}. The ${REVIEW_RUNG} rung reviews; you relay its findings and do not add your own.

Goal: blocking and non-blocking review findings for \`git -C ${wt} diff ${INTEGRATION}...${b.head}\`.
Success means: ${PROG}/verdicts/REVIEW-${l.id}.json holds the reviewer's JSON and your return mirrors it.
Stop when: that file exists, or the reviewer hit a quota wall (walled=true).

1. Write ${wt}/.lane-evidence/REVIEW-PROMPT-${l.id}.md: "Review the diff \`git diff ${INTEGRATION}...${b.head}\` in ${wt} for: correctness bugs; security regressions (auth, Host and Origin checks, SSRF, secrets, formula injection); AGENTS.md contract-invariant breaks (schema, examples, AGENT_CONTRACT.md and docs/CONTRACT-CHANGELOG.md must move together); edits outside this fence: ${l.fence.join('; ')}; and tests that pin implementation instead of behavior. Blocking means it must be fixed before merge. Cite file and line for every finding. Output JSON matching the schema."
2. Run with Bash run_in_background from ${wt}, and wait for it to exit: ${cmd}
3. Copy the result to ${PROG}/verdicts/REVIEW-${l.id}.json. A 402, 429 or "balance exhausted" error means walled=true with the message.
4. Return blocking and nonBlocking as "file:line issue" strings.`
}

function mergePrompt(l, b) {
  return `You are the integration runner, and you hold the merge queue: exactly one merge at a time.

Goal: merge ${branchOf(l)} (head ${b.head}, lane ${l.id} — ${l.name}) into ${INTEGRATION} in ${INT_WT}, only if the merged tree is green.
Success means: merged=true with a merge commit whose floor and gitleaks both passed, or merged=false with the integration branch unchanged.
Stop when: one of those holds.

1. \`cd ${INT_WT}\`; \`git status --porcelain\` must be empty (untracked caches are fine). If it is not, return merged=false with detail "integration tree dirty".
2. \`git merge --no-ff --no-commit ${branchOf(l)}\`. On conflicts, do not hand-stitch: run \`git merge --abort\` and return merged=false listing the conflicting files. The orchestrator resolves at the source.
3. On the uncommitted merge, run \`${floorOf(l)}\`, then \`gitleaks detect --log-opts="${INTEGRATION}..${branchOf(l)}" --redact\`.
4. All green: \`git commit\` with subject "merge: lane ${l.id} — ${l.name}", a body listing claims ${l.claims.join(', ')}, the trailer "Beaudit-Lane: ${l.id}" and the attribution lines. Return merged=true, head, and the floor counts. Anything red: \`git merge --abort\`, then return merged=false with the failing command and its decisive output.
Never push. Never \`git reset --hard\`. Never touch ${REPO}'s own checkout.`
}

function closePrompt(results) {
  const merged = results.filter(r => r.status === 'merged').map(r => r.lane)
  return `Close out BEAUDIT build waves ${WAVES.join(', ')} on ${INTEGRATION} (${INT_WT}). Merged lanes: ${merged.join(', ') || 'none'}.

Goal: a verified integration branch and the commands Emilio runs next. You publish nothing.
Success means: the floor and e2e output are pasted, gitleaks is clean, merged-lane worktrees are swept and their reports copied, and the PR commands are printed.
Stop when: the report is written.

1. In ${INT_WT}, run \`${FLOOR} && ${E2E}\` and paste the counts line of each command.
2. Run \`gitleaks detect --log-opts="origin/main..HEAD" --redact\`.
3. For each merged lane: copy <lane worktree>/.lane-evidence/BUILD-REPORT-<id>.md into ${PROG}/reports/build/, confirm no process still runs in that worktree, then \`git -C ${REPO} worktree remove <lane worktree>\`. It refuses dirty trees; if it refuses, leave the tree and list it in kept. Keep every branch. Lane worktrees are ${merged.map(id => wtOf(byId[id])).join(', ') || 'none'}.
4. Write ${PROG}/reports/build/BUILD-REPORT-W${WAVES.join('')}.md with: a lanes table (id, status, commits, repairs, claims done and deferred) from this JSON: ${JSON.stringify(results.map(r => ({ lane: r.lane, status: r.status, repairs: r.repairs || 0, done: r.build ? r.build.claimsDone : [], deferred: r.build ? r.build.claimsDeferred : [], reason: r.reason || '' })))}, then the floor output, the gitleaks output and an unverified list.
5. Put these in commandsForEmilio without running them: \`git -C ${INT_WT} push -u origin ${INTEGRATION}\`; \`gh pr create --repo emilio3435/Job-Bored --base main --head ${INTEGRATION} --title "<conventional title>" --body-file ${PROG}/reports/build/BUILD-REPORT-W${WAVES.join('')}.md\`; and \`/code-review ultra\` on that PR.`
}

function criticPrompt(results) {
  const sel = LANES.filter(l => WAVES.includes(l.wave))
  return `You are the completeness critic for BEAUDIT build waves ${WAVES.join(', ')}.

Goal: name what this run did not cover.
Success means: every P0 and P1 register row assigned to these waves is either done in a merged lane or listed as uncovered with the reason.
Stop when: the lists are complete.

Inputs: ${PROG}/verdicts/_register.json (rows with sev P0 or P1); lanes planned for these waves with their claims: ${JSON.stringify(sel.map(l => ({ id: l.id, claims: l.claims })))}; results: ${JSON.stringify(results.map(r => ({ lane: r.lane, status: r.status, done: r.build ? r.build.claimsDone : [], deferred: r.build ? r.build.claimsDeferred : [], reason: r.reason || '' })))}.
List as uncoveredP0P1 every P0/P1 row (and every row merged into it) owned by a lane that did not merge, or deferred inside a merged lane. List as unverified every claim marked done whose Muse verdict file (${PROG}/verdicts/BUILD-VERDICT-<lane>-r<n>.json) is missing or does not say FIXED. In nextRunArgs, give the Workflow args for the follow-up run (waves, only, reviewRung) as a JSON string.`
}

// ---------- run ----------
const selected = LANES.filter(l => WAVES.includes(l.wave) && (!ONLY || ONLY.includes(l.id)))
log(`BEAUDIT build ${STAMP}: waves ${WAVES.join(', ')} → ${selected.length} lanes (${selected.map(l => l.id).join(' ')}) on ${INTEGRATION}; Opus 5.5 medium; review via ${REVIEW_RUNG}; up to ${MAX_REPAIRS} repair rounds per lane`)

phase('Preflight')
const pre = await agent(preflightPrompt(selected), { label: 'preflight', phase: 'Preflight', ...MODEL, schema: PRE_SCHEMA })
if (!pre || !pre.ok) {
  return { status: 'blocked-preflight', stamp: STAMP, blockers: pre ? pre.blockers : ['preflight agent returned nothing'], gates: pre ? pre.gates : [], quota: pre ? pre.quota : [] }
}
log(`Preflight ok. Integration ${INTEGRATION} @ ${pre.integrationHead}. Gates: ${pre.gates.map(g => `${g.id}=${g.ok ? 'ok' : 'no'}`).join(' ') || 'none'}. Landed from earlier runs: ${pre.landedLanes.join(' ') || 'none'}.`)
const landed = new Set(pre.landedLanes)
const gateOk = g => pre.gates.some(x => x.id === g && x.ok)

let halt = null          // set at the first quota wall; lanes not yet building are held
let mergeTail = Promise.resolve()
const running = {}

function enqueueMerge(l, b) {
  const p = mergeTail.then(() => (halt ? null : agent(mergePrompt(l, b), { label: `merge:${l.id}`, phase: 'Integrate', ...MODEL, schema: MERGE_SCHEMA })))
  mergeTail = p.catch(() => null)
  return p
}

async function depState(d) {
  if (landed.has(d)) return 'merged'
  if (running[d]) { const r = await running[d]; return r && r.status === 'merged' ? 'merged' : `not merged (${r ? r.status : 'no result'})` }
  return 'not in this run and not on origin/main'
}

async function runLane(l) {
  await null // let every lane register in `running` before dependencies are read
  for (const d of l.deps) {
    const s = await depState(d)
    if (s !== 'merged') return { lane: l.id, status: 'deferred', reason: `dependency ${d}: ${s}` }
  }
  const unmet = l.gates.filter(g => !gateOk(g))
  if (unmet.length) return { lane: l.id, status: 'deferred', reason: `gate not met: ${unmet.join(', ')}` }
  if (halt) return { lane: l.id, status: 'held', reason: halt }

  let b = await agent(buildPrompt(l, null), { label: `build:${l.id}`, phase: 'Build', ...MODEL, schema: BUILD_SCHEMA })
  let round = 0
  while (true) {
    if (!b) return { lane: l.id, status: 'blocked', reason: 'build agent returned nothing (resume reuses the worktree)' }
    if (b.status !== 'done') return { lane: l.id, status: 'blocked', reason: b.blocker || 'blocked', build: b }
    if (halt) return { lane: l.id, status: 'held', reason: halt, build: b }
    const v = await agent(verifyPrompt(l, b, round), { label: `verify:${l.id}${round ? ' r' + round : ''}`, phase: 'Verify', ...MODEL, schema: VERIFY_SCHEMA })
    if (v && v.walled) { halt = halt || `Muse quota wall: ${v.wallDetail || ''}`; return { lane: l.id, status: 'walled', pool: 'muse', reason: v.wallDetail, build: b } }
    let failures = null
    if (!v || v.verdict !== 'PASS') {
      failures = v && v.failures.length ? v.failures : ['verify runner returned no verdict']
    } else {
      const r = await agent(reviewPrompt(l, b), { label: `review:${l.id}${round ? ' r' + round : ''}`, phase: 'Review', ...MODEL, schema: REVIEW_SCHEMA })
      if (r && r.walled) { halt = halt || `${REVIEW_RUNG} quota wall: ${r.wallDetail || ''}`; return { lane: l.id, status: 'walled', pool: REVIEW_RUNG, reason: r.wallDetail, build: b } }
      if (r && r.blocking.length === 0) break
      failures = r ? r.blocking : ['review runner returned no result']
    }
    if (round >= MAX_REPAIRS) return { lane: l.id, status: 'red', reason: `still failing after ${round} repair round(s)`, failures, build: b, repairs: round }
    round++
    log(`${l.id}: repair round ${round} for ${failures.length} issue(s)`)
    b = await agent(buildPrompt(l, failures), { label: `repair${round}:${l.id}`, phase: 'Build', ...MODEL, schema: BUILD_SCHEMA })
  }

  const m = await enqueueMerge(l, b)
  if (!m) return { lane: l.id, status: halt ? 'held' : 'blocked', reason: halt || 'integration runner returned nothing', build: b, repairs: round }
  log(`${l.id}: ${m.merged ? 'merged @ ' + m.head : 'integration red — ' + m.detail}`)
  return { lane: l.id, status: m.merged ? 'merged' : 'integration-red', reason: m.merged ? '' : m.detail, merge: m, build: b, repairs: round }
}

for (const l of selected) {
  running[l.id] = runLane(l).catch(e => ({ lane: l.id, status: 'error', reason: String(e) }))
}
const results = await Promise.all(selected.map(l => running[l.id]))

phase('Close')
const anyMerged = results.some(r => r.status === 'merged')
const close = anyMerged ? await agent(closePrompt(results), { label: 'close', phase: 'Close', ...MODEL, schema: CLOSE_SCHEMA }) : null
const critic = await agent(criticPrompt(results), { label: 'completeness critic', phase: 'Close', ...MODEL, schema: CRITIC_SCHEMA })
const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
log(`Done: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}${halt ? ` — HALTED: ${halt}` : ''}`)

return {
  stamp: STAMP,
  waves: WAVES,
  integration: INTEGRATION,
  integrationWorktree: INT_WT,
  halt,
  counts,
  lanes: results.map(r => ({ lane: r.lane, status: r.status, reason: r.reason || '', repairs: r.repairs || 0, head: r.merge ? r.merge.head : (r.build ? r.build.head : ''), claimsDone: r.build ? r.build.claimsDone : [], claimsDeferred: r.build ? r.build.claimsDeferred : [], failures: r.failures || [] })),
  close,
  critic,
  resume: halt ? 'Quota wall: ask Emilio for the next rung in fleet.md, then re-run with the same args plus resumeFromRunId (or reviewRung set to the new rung).' : null,
}
