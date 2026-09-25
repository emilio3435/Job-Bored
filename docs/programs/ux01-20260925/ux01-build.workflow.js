export const meta = {
  name: 'ux01-build',
  description: 'UX01 Phase 3: build the approved SPEC cut in dependency-gated lanes, Muse-verify and Grok-review each, merge into feat/ux-zero-to-one, then measure acceptance',
  whenToUse: 'Only after Emilio approves docs/programs/ux01-20260925/SPEC.md and names his cut. Pass {approved: true, cut: [...]}; start with dryRun: true.',
  phases: [
    { title: 'Gate', detail: 'approval, cut, upstream PRs, verifier fleet, what already merged' },
    { title: 'Lane A', detail: 'C1 → C4 in order on one worktree; lands before any other lane' },
    { title: 'Lanes', detail: 'B–F build in parallel worktrees, each gated on its upstream' },
    { title: 'Verify', detail: 'Muse runs the five-command floor, Grok reviews the diff, bounded fix loop' },
    { title: 'Integrate', detail: 'serialized merges into feat/ux-zero-to-one with a smoke check' },
    { title: 'Conform', detail: 'built app against the mockup per C-tag; one fix round for must-fix gaps' },
    { title: 'Acceptance', detail: 'integration floor, SPEC §6 numbers, completeness critic' },
  ],
}

// ---------------------------------------------------------------------------
// Program constants. Everything the lanes need is on disk in the program folder.
// ---------------------------------------------------------------------------
const A = args || {}
const REPO = '/Users/emilionunezgarcia/Job-Bored'
const WT = '/Users/emilionunezgarcia/Job-Bored.worktrees'
const BASE = 'feat/ux-zero-to-one'
const BASE_WT = WT + '/ux01'
const PROG = 'docs/programs/ux01-20260925'
const SPEC = PROG + '/SPEC.md'
const MOCKUP = PROG + '/mockup.html'
const SCRATCH = WT + '/.ux01-run'              // prompt files and CLI output, outside every worktree
const FLOOR = ['npm run lint:js', 'npm test', 'npm run test:e2e-smoke', 'npm run test:e2e-journey', 'npm run test:e2e-visual']
const OPUS = { model: 'opus', effort: 'medium' }  // UX01 overrides the xhigh default: opus family, medium effort
const MAX_FIX = Number.isInteger(A.maxFixRounds) ? A.maxFixRounds : 2
const ATTRIB = A.attribution || 'Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>'
const MUSE = 'muse exec --model muse-spark-1.3-contributor --reasoning-effort max --json --disable-web-tools --disable-write'
const GROK = 'grok -m grok-4.7-build-fast --reasoning-effort xhigh --permission-mode auto --sandbox review --no-subagents --output-format json'
const SOL = "codex exec -p be-hard -m gpt-6-sol -c 'model_reasoning_effort=\"max\"' -c 'sandbox_workspace_write.writable_roots=[\"" + REPO + "/.git\"]'"

// SPEC §3, one line each. `lane` is the owner; C5 is split (see BUILD-PLAN.md §3).
const CHANGES = {
  C1: { lane: 'A', t: 'Test harness answers same-origin /__proxy/* and /profile/* itself (installHermeticNetworkFence)', f: 'incident 2026-09-25, FD-19' },
  C2: { lane: 'A', t: 'One token source: style.css :root becomes aliases of tokens-v2.css; named type/space/z scales; --jb-on-accent; navy focus ring; ink-3 #587080; lint:tokens in CI with a baseline', f: 'DS-01–03/06/11/14–16/21/22, AX-06–08/11, SS-18, FD-23, FR-22' },
  C3: { lane: 'A', t: 'Component kit .jb-btn/.jb-chip/.jb-field/.jb-banner/.jb-toast in jb-ui.css + JB-UI.md; jb-type.css rules wrapped in :where(body.jb-v2)', f: 'DS-05/10/18/19, SS-23, TA-20' },
  C4: { lane: 'A', t: 'Dead code out (Lattice, letter.*, role-workshop, mark-submitted, companies-tab, welcome.css, jb-spark, jb-kbd, unused jb-deco); rename live legacy-*.css to surface names + overlay.css; fix role.css:494 brace; trim fonts; gzip in dev-server; stale headers; Today hidden behind auth gates (SS-08)', f: 'DS-04/07–09/12/13/17/20/23/24, TR-20, TA-25, FD-24, FR-25, SS-08, AX-26' },
  C5: { lane: 'C+D', t: 'Add job with no setup: top-bar "Add job" + empty-state actions (lane C); URL-modal failure opens prefilled manual entry via JobBoredIngest.openManual (lane D)', f: 'FD-01–03/22, FR-03/04, SS-11, TR-22, MP-06' },
  C6: { lane: 'B', t: 'Once a Sheet exists, closing setup or "Poke around" reveals the real board; payoff ends on one real row', f: 'FR-02/10/19, AX-09' },
  C7: { lane: 'B', t: 'Honest setup: ✓ only from recorded checks, "20–25 min", plain copy, capable default model, one start command, "Just this computer", B1 existing-sheet and signed-in cases', f: 'FR-05/07/09/11–18/20/23, SS-12' },
  C8: { lane: 'B', t: 'Discovery asks before acting: "Set up (~3 min)" footer when not configured, wizard preselects Recommended with outcome-named steps, consent before /__proxy/fix-setup', f: 'FD-04–06/14/19/20' },
  C9: { lane: 'B', t: 'User roles always in the query; profile summary + "Edit for this run"; Connection to Settings; run strip "Found N new · View"; runs log fits 375 and settles; local timezone', f: 'FD-07–13/15–18/21/25/26, SS-19/24' },
  C10: { lane: 'B', t: 'Capture bookmarklet: JobPosting JSON-LD → #capture= → JobBoredIngest.openManual prefilled; no server', f: 'MP-02' },
  C11: { lane: 'E', t: 'Draft from the user\'s resume or not at all: request carries the resume, server refuses without it (sol sub-lane), dossier gate "Add your resume first", provenance line', f: 'TA-01/02/15' },
  C12: { lane: 'E', t: 'Drafting states that match reality: server-down disables Draft with Retry + start command; one-click draft; auto-draft opt-in; 3-min stall notice; missing-AI notice once, inline; dock steps aside', f: 'TA-03/05–07/16/18/22/26, TR-24, AX-22' },
  C13: { lane: 'E', t: 'Review row state shows the QA flag; QA report and checklist open inline; score names its document and version', f: 'TA-11–13' },
  C14: { lane: 'E', t: 'Scribe inside the dossier bound to the role\'s document; free live keyword meter; chips from missing keywords', f: 'TA-08–10/23/24, MP-03, AX-17/20/21' },
  C15: { lane: 'D', t: 'Applied writes what was typed (date, follow-up, source + receipt to Notes) through the planner, names the role, Undo; cancel reverts the menu', f: 'TR-06=TA-04, TA-19/21, AX-03' },
  C16: { lane: 'D+E', t: 'Return from View posting asks "Did you apply to <company>?" with source prefilled (D exposes JobBoredSubmission.confirmApplied prefill; E renders the prompt)', f: 'MP-04' },
  C17: { lane: 'D', t: 'One planner for every move: sync or roll back with named Retry; Undo on every move; drag never opens the dossier; stage menu in the top layer; card focus ring; card semantics', f: 'TR-01–05/07/10/11/25, SS-07, AX-02/04/10/13/14' },
  C18: { lane: 'C', t: 'Today / Pipeline / Dossier as views on the same anchors; dossier takes and returns focus; skip link; chrome at 375; no "(v2)" in landmarks', f: 'TR-19/23, TA-09/17, AX-05/12/15/16/23–25' },
  C19: { lane: 'D', t: 'Every non-empty stage open at ≥1280 px; list view under 760 px with a Board toggle; compact cards; ≥44 px targets', f: 'TR-08/09/16/17, AX-01/19, MP-09' },
  C20: { lane: 'C', t: 'One next-step engine feeding Today, the Brief lead, card strip and People; "Due in 48 h" and "Offer open" bands; Done, Snooze, Mark answered, .ics; honest 30-day numbers', f: 'TR-12–15/18, MP-07' },
  C21: { lane: 'F', t: 'Failed ≠ empty: keep last good data with a Retry banner; emit jb:data:loaded / jb:data:load-failed; Refresh + offline notice; plain 403/404 copy naming the account; expired-session timeout', f: 'SS-01/02/05/06/08–10/25/26, TR-21' },
  C22: { lane: 'F', t: 'Settings: tabs usable at 375; scraper guide not inert; save in place; dirty-close guard; doctor previews before writing; plain copy', f: 'SS-03/04/13–17/20/21/27, AX-18' },
}
const ALL = Object.keys(CHANGES)
const CUT = new Set(Array.isArray(A.cut) && A.cut.length ? A.cut : ALL)

const LANES = [
  { id: 'A', slug: 'system', name: 'System', changes: ['C1', 'C2', 'C3', 'C4'], needs: [],
    owns: 'tokens-v2.css, style.css, jb-type.css, jb-ui.css, jb-ui.js, jb-deco.css, jb-v2.css, JB-UI.md, DESIGN.md, vendor/fonts/fonts.css, css/legacy-*.css (renames), new css/overlay.css, jb-v2-legacy-hide.css, role.css, jb-v2-boot-contract.js, index.html <head> link/script list and dead includes, app.js legacy renderer gates, dev-server.mjs (gzip only), tests/e2e-fixtures/hermetic-harness.mjs, tools/lint-tokens.mjs, package.json scripts, the deleted modules and their tests',
    audits: ['design-system.md', 'access-responsive.md'],
    brief: 'Steps run strictly in order C1 → C2 → C3 → C4. C1 first: the floor itself runs on the hermetic harness. C4 renames must be zero-visual-diff (prove with the visual suite). ' + (A.retireLegacyView === true ? 'Emilio approved retiring ?jb-v2=0: keep the flag as a no-op for one release, then delete the legacy-only CSS and renderers.' : 'Emilio has NOT approved retiring ?jb-v2=0: keep the legacy view working; delete only code the audits prove dead in both views.') },
  { id: 'C', slug: 'shell-today', name: 'Shell & Today', changes: ['C5', 'C18', 'C20'], needs: [],
    owns: 'index.html <body> regions (not <head>), flowing-chrome.js, flowing-chrome.css, today.js, today-data.js, today.css, dawn.js, dawn-data.js, dawn.css, recruiter-strip.js, recruiter-strip.css, welcome.js, role.js, expired-review-ui.js',
    audits: ['track.md', 'access-responsive.md', 'find.md', 'modern-patterns.md'],
    brief: 'Your C5 part is the top-bar "Add job" and the empty-state actions; call JobBoredIngest.openManual (lane D provides it; feature-detect). Gate Today/Brief empty copy on the jb:data:loaded event (lane F emits it; until then keep today\'s behaviour). TR-21\'s [hidden] badge fix lives in flowing-chrome.css, so it is yours.' },
  { id: 'D', slug: 'board-apply', name: 'Board & Apply', changes: ['C5', 'C15', 'C16', 'C17', 'C19'], needs: [],
    owns: 'pipeline.js, pipeline-render.js, pipeline-controller.js, pipeline.css, pipeline-transitions.js, pipeline-transition-adapter.js, flowing-writes.js, stage-registry.js, submission-flow.js, jb-a11y.js, jb-a11y.css, ingest-url-flow.js, partials/ingest-manual-modal.html',
    audits: ['track.md', 'tailor-apply.md', 'access-responsive.md', 'find.md', 'modern-patterns.md'],
    brief: 'Expose two window APIs other lanes consume and document them in your report: JobBoredIngest.openManual({url, title, company, location}) and JobBoredSubmission.confirmApplied({dataIndex, prefill:{source, date}}). Your C5 part is the URL-modal failure path (pipeline.js ~845) and the prefill API. C16 for you is the prefill API only; lane E renders the prompt.' },
  { id: 'F', slug: 'states-settings', name: 'States & Settings', changes: ['C21', 'C22'], needs: ['pr104'],
    owns: 'sheets-read-load.js, sheets-writeback.js, app-bootstrap.js, auth-session.js, sheet-access-setup.js, setup-doctor.js, settings-modal.js, settings-tabs.js, settings-tabs.css, settings-tab-schema.js, settings-profile-tab.js, settings-jb-v2-tab.js, settings-discovery-adapters.js, partials/settings-modal.html, partials/scraper-setup-modal.html, scraper-ats-config.js, fit-profile-editor.js, fit-profile-backcompat.js, fit-profile-wizard.js, the renamed settings sheets from lane A',
    audits: ['settings-states.md', 'access-responsive.md'],
    brief: 'Emit jb:data:loaded {rows} on the first successful loadAllData and jb:data:load-failed {status, lastSyncedAt} on failure, on window and document (lane C consumes them). #104 rewrote Settings: build on its receipts model, do not undo it.' },
  { id: 'B', slug: 'entry-find', name: 'Entry & Find', changes: ['C6', 'C7', 'C8', 'C9', 'C10'], needs: ['pr104', 'pr102'],
    owns: 'onboarding-flow.js, oneflow-beat-*.js, oneflow-demo-board.js, css/oneflow.css, onboarding-celebration.js, css/onboarding-celebration.css, model-catalog.js, discovery-*.js, partials/discovery-drawer.html, partials/discovery-run-preview.html, partials/discovery-runs-modal.html, the renamed discovery sheets from lane A, runs-tab.js, new capture-bookmarklet.js',
    audits: ['first-run.md', 'find.md', 'modern-patterns.md', 'settings-states.md'],
    brief: 'C10 hands off through JobBoredIngest.openManual (lane D). C8 consent: never let a dashboard click rewrite .env or restart a worker without an explicit confirm naming what changes.' },
  { id: 'E', slug: 'dossier-tailor', name: 'Dossier & Tailor', changes: ['C11', 'C12', 'C13', 'C14', 'C16'], needs: ['casefit'],
    owns: 'role-case.js, role-case-model.js, role-case.css, role-materials.js, materials-queue.js, materials-queue.css, materials-feature.js, materials-state.js, scribe.js, scribe-state.js, scribe-score-adapter.js, scribe.css, resume-generation.js, posting-enrichment.js, dossier-field-provenance.js (server/materials-*.mjs belong to the sol sub-lane)',
    audits: ['tailor-apply.md', 'access-responsive.md', 'modern-patterns.md'],
    brief: 'The sol sub-lane lands the server half of C11 first; read its report for the request/response contract. C16 for you is the return prompt UI, calling JobBoredSubmission.confirmApplied (lane D; feature-detect). Keep the #119 reading canvas look.' },
]

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const STR = { type: 'string' }
const STRS = { type: 'array', items: STR }
const GATE_SCHEMA = { type: 'object', properties: {
  baseSha: STR, rebasedOnMain: { type: 'boolean' },
  upstream: { type: 'object', properties: { pr104: STR, pr102: STR, casefit: STR }, required: ['pr104', 'pr102', 'casefit'] },
  fleet: { type: 'object', properties: { muse: { type: 'boolean' }, grok: { type: 'boolean' }, codex: { type: 'boolean' } }, required: ['muse', 'grok', 'codex'] },
  alreadyMerged: STRS, liveWorkerFromUx01: { type: 'boolean' }, notes: STRS,
}, required: ['baseSha', 'upstream', 'fleet', 'alreadyMerged', 'notes'] }
const BUILD_SCHEMA = { type: 'object', properties: {
  branch: STR, headSha: STR,
  changes: { type: 'array', items: { type: 'object', properties: { id: STR, status: { type: 'string', enum: ['done', 'partial', 'skipped'] }, note: STR }, required: ['id', 'status'] } },
  filesTouched: STRS, outsideOwnership: STRS, contractsTouched: STRS, apis: STRS,
  baselines: { type: 'array', items: { type: 'object', properties: { snapshot: STR, before: STR, after: STR, why: STR }, required: ['snapshot', 'why'] } },
  handoffs: STRS, selfFloorGreen: { type: 'boolean' }, report: STR,
}, required: ['branch', 'headSha', 'changes', 'filesTouched', 'selfFloorGreen', 'report'] }
const FLOOR_SCHEMA = { type: 'object', properties: {
  verifier: { type: 'string', enum: ['muse', 'unavailable'] }, green: { type: 'boolean' },
  results: { type: 'array', items: { type: 'object', properties: { command: STR, pass: { type: 'boolean' }, summary: STR }, required: ['command', 'pass'] } },
  failures: STRS, raw: STR,
}, required: ['verifier', 'green', 'results'] }
const REVIEW_SCHEMA = { type: 'object', properties: {
  reviewer: { type: 'string', enum: ['grok', 'unavailable'] }, verdict: { type: 'string', enum: ['approve', 'changes'] },
  blocking: { type: 'array', items: { type: 'object', properties: { file: STR, line: { type: 'integer' }, issue: STR, why: STR }, required: ['file', 'issue'] } },
  nonBlocking: STRS, contractRisk: STRS,
}, required: ['reviewer', 'verdict', 'blocking'] }
const MERGE_SCHEMA = { type: 'object', properties: {
  merged: { type: 'boolean' }, mergeSha: STR, conflicts: STRS, smokeGreen: { type: 'boolean' }, note: STR,
}, required: ['merged', 'smokeGreen'] }
const CONFORM_SCHEMA = { type: 'object', properties: {
  deviations: { type: 'array', items: { type: 'object', properties: { tag: STR, lane: STR, surface: STR, width: STR, expected: STR, actual: STR, mustFix: { type: 'boolean' } }, required: ['tag', 'lane', 'expected', 'actual', 'mustFix'] } },
  shots: STRS,
}, required: ['deviations'] }
const ACCEPT_SCHEMA = { type: 'object', properties: {
  rows: { type: 'array', items: { type: 'object', properties: { measure: STR, before: STR, after: STR, target: STR, met: { type: 'boolean' }, command: STR, label: { type: 'string', enum: ['confirmed', 'inferred', 'unknown'] } }, required: ['measure', 'before', 'after', 'target', 'met', 'label'] } },
  notes: STRS,
}, required: ['rows'] }
const CRITIC_SCHEMA = { type: 'object', properties: {
  unaddressed: { type: 'array', items: { type: 'object', properties: { id: STR, why: STR }, required: ['id', 'why'] } },
  risks: STRS, nextActions: STRS,
}, required: ['unaddressed', 'risks'] }

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------
const laneWT = (L) => WT + '/ux01-' + L.slug
const laneBranch = (L) => 'feat/ux01-' + L.slug
const changeLines = (ids) => ids.filter((id) => CUT.has(id)).map((id) => '- ' + id + ': ' + CHANGES[id].t + ' (fixes ' + CHANGES[id].f + ')').join('\n')

const RULES = [
  'Rules for every UX01 build agent:',
  '- Read ' + SPEC + ' (§2 design language, §3 changes), open ' + MOCKUP + ' in a browser (file://; toggle "Phone 375"; pink tags C<n> mark each change), and the audit reports named below. Finding ids point at rows with file:line, evidence and the fix.',
  '- Edit ONLY the files your lane owns. If a change needs a file you do not own, do not edit it: add it to handoffs (file, change, API needed).',
  '- Use the lane A kit and tokens (tokens-v2.css values only, .jb-btn/.jb-chip/.jb-field/.jb-banner/.jb-toast). No raw colour literals. Scope component CSS under its root class (body.jb-v2 h3/p is (0,1,1) unless lane A\'s :where() change is in).',
  '- Keep the Sheet write-back contracts: data-action, data-stable-key, expandedJobKeys, updateJobStatus(dataIndex, stage), the PIPELINE-CARDS-HANDOFF.md selectors, schemas/pipeline-row.v1.json. Name every one you touch.',
  '- Behaviour changes get a failing test first. In Playwright set reduced motion with page.emulateMedia({ reducedMotion: "reduce" }) and assert matchMedia; never test.use.',
  '- Refresh a visual baseline only when your intended change moves it; record snapshot, before path, after path, why.',
  '- Never run npm start / npm run dev, never bind :8080 :3847 :8644, never click setup, save, verify, start or install actions against the host. Browser work goes through the hermetic e2e harness (fenced by C1) or ' + PROG + '/audit/tools/audit-harness.mjs.',
  '- Commit on your lane branch in small conventional commits ending with the line: ' + ATTRIB + '. Never push, open a PR, rebase shared history, or touch main.',
  '- Before returning, run the floor yourself from the worktree root: ' + FLOOR.join(' && ') + '. Write ' + PROG + '/lanes/LANE-REPORT-<lane>.md with what changed for the user, each change id with status, files touched, contracts touched, APIs added, baselines refreshed (before/after), handoffs, and the tail of each floor command. Commit it.',
].join('\n')

function setupSteps(L) {
  const wt = laneWT(L)
  return [
    'Worktree setup (idempotent):',
    '1. If ' + wt + ' does not exist: git -C ' + REPO + ' worktree add ' + wt + ' -b ' + laneBranch(L) + ' ' + BASE,
    '   If it exists: git -C ' + wt + ' merge --ff-only ' + BASE + ' (if that fails, stop and report; do not force).',
    '2. Symlink dependencies if missing: ln -s ' + REPO + '/node_modules ' + wt + '/node_modules; ln -s ' + REPO + '/server/node_modules ' + wt + '/server/node_modules',
    '3. Work only inside ' + wt + ' (absolute paths; your Bash cwd resets between calls, so prefix commands with cd ' + wt + ' &&).',
  ].join('\n')
}

function buildPrompt(L, ids, extra) {
  return [
    'You are UX01 lane ' + L.id + ' (' + L.name + '), an opus FE lane at medium effort building the approved UX01 spec for JobBored (vanilla JS + custom elements, no React, no Tailwind).',
    'Goal: ship these changes so a stranger gets the behaviour the SPEC and mockup show:',
    changeLines(ids),
    'Success means: every change above is done or explicitly partial with a reason, the floor is green in your worktree, and your lane report is committed.',
    'Stop when: the above holds, or you are blocked twice on the same thing (report the blocker and stop).',
    '', setupSteps(L), '',
    'You own: ' + L.owns,
    'Audit reports to read: ' + L.audits.map((f) => PROG + '/audit/' + f).join(', '),
    'Lane notes: ' + L.brief,
    extra || '',
    '', RULES,
  ].join('\n')
}

function fixPrompt(L, v, round) {
  const floorFails = v.floor && !v.floor.green ? (v.floor.failures || []).concat((v.floor.results || []).filter((r) => !r.pass).map((r) => r.command + ': ' + (r.summary || ''))) : []
  const blocking = (v.review && v.review.blocking) || []
  return [
    'UX01 lane ' + L.id + ' fix round ' + round + '. Work in ' + laneWT(L) + ' on ' + laneBranch(L) + '. Same ownership and rules as your build brief (restated below).',
    floorFails.length ? 'Muse floor failures:\n- ' + floorFails.join('\n- ') : 'The floor was green.',
    blocking.length ? 'Grok blocking review findings:\n' + blocking.map((b) => '- ' + b.file + (b.line ? ':' + b.line : '') + ' ' + b.issue + ' (' + (b.why || '') + ')').join('\n') : 'No blocking review findings.',
    'Fix the root cause of each (systematic debugging, not symptom patches). If a review finding is wrong, say why in the lane report instead of changing code. Re-run the full floor, update the lane report, commit.',
    '', 'You own: ' + L.owns, '', RULES,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Verification: Muse runs the floor, Grok reviews the diff. The writing family
// (opus) never verifies its own work; a missing verifier is a wall, not a skip.
// ---------------------------------------------------------------------------
async function museFloor(label, wt, extraCmds) {
  const cmds = FLOOR.concat(extraCmds || [])
  return agent([
    'You are a thin driver for the Muse verifier. Do not judge the code yourself and do not edit any repo file.',
    '1. mkdir -p ' + SCRATCH + ' and write this prompt to ' + SCRATCH + '/' + label + '-muse.md:',
    '   "Run each command from the workspace root, in order, even if an earlier one fails: ' + cmds.join(' ; ') + '. For each: pass or fail, test counts, and the last 40 lines of output. Do not edit files. Finish with a one-line verdict: GREEN only if every command passed."',
    '2. Run: ' + MUSE + ' --workspace ' + wt + ' --prompt-file ' + SCRATCH + '/' + label + '-muse.md > ' + SCRATCH + '/' + label + '-muse.jsonl 2>&1 (timeout 40 min).',
    '3. If muse is missing, exits non-zero before running commands, or reports quota/auth errors: return verifier "unavailable", green false, and put the error in raw.',
    '4. Otherwise parse the final message: return verifier "muse", green, per-command results, failures, and raw = the verdict line plus failing tails (max 4000 chars).',
    '5. Append a "## Verification · Muse (' + label + ')" section with the per-command results to the lane report in ' + wt + '/' + PROG + '/lanes/ if one exists, and commit it with the attribution line: ' + ATTRIB,
  ].join('\n'), { ...OPUS, label: 'muse:' + label, phase: 'Verify', schema: FLOOR_SCHEMA })
}

async function grokReview(label, wt, ids) {
  return agent([
    'You are a thin driver for the Grok reviewer. Do not review the code yourself and do not edit any repo file.',
    '1. mkdir -p ' + SCRATCH + ' and write the review prompt to ' + SCRATCH + '/' + label + '-grok.md:',
    '   "Review git diff ' + BASE + '...HEAD in this repo. It should implement these UX01 changes: ' + ids.filter((id) => CUT.has(id)).map((id) => id + ' ' + CHANGES[id].t).join(' | ') + '. Spec: ' + SPEC + '. Blocking means: breaks a write-back contract (data-action, data-stable-key, expandedJobKeys, updateJobStatus, pipeline-row.v1 schema), a regression, a change that does not do what the spec says, edits outside the lane\'s owned files, raw colour literals, unscoped component CSS, or a security issue. Everything else is non-blocking. Return JSON matching the schema."',
    '2. Run from ' + wt + ': ' + GROK + ' --cwd ' + wt + ' --json-schema \'' + JSON.stringify({ type: 'object', properties: { verdict: { type: 'string', enum: ['approve', 'changes'] }, blocking: { type: 'array', items: { type: 'object', properties: { file: STR, line: { type: 'integer' }, issue: STR, why: STR } } }, nonBlocking: STRS, contractRisk: STRS }, required: ['verdict', 'blocking'] }) + '\' -p "$(cat ' + SCRATCH + '/' + label + '-grok.md)" > ' + SCRATCH + '/' + label + '-grok.json 2>&1 (timeout 20 min).',
    '3. If grok is missing, fails, or hits quota: return reviewer "unavailable", verdict "changes", blocking [].',
    '4. Otherwise return reviewer "grok" and its verdict, blocking, nonBlocking and contractRisk verbatim.',
  ].join('\n'), { ...OPUS, label: 'grok:' + label, phase: 'Verify', schema: REVIEW_SCHEMA })
}

// Build → verify → bounded fix loop. Returns {status, build, floor, review}.
async function buildAndVerify(L, ids, label, extra) {
  let build = await agent(buildPrompt(L, ids, extra), { ...OPUS, label: 'build:' + label, phase: L.id === 'A' ? 'Lane A' : 'Lanes', schema: BUILD_SCHEMA })
  if (!build) return { status: 'failed', reason: 'build agent returned nothing', label }
  for (let round = 1; ; round++) {
    const floor = await museFloor(label + '-r' + round, laneWT(L))
    if (!floor || floor.verifier === 'unavailable') return { status: 'blocked', reason: 'verifier wall (Muse): ' + ((floor && floor.raw) || 'no result'), label, build }
    const review = floor.green ? await grokReview(label + '-r' + round, laneWT(L), ids) : null
    if (review && review.reviewer === 'unavailable') return { status: 'blocked', reason: 'reviewer wall (Grok)', label, build, floor }
    const blocking = (review && review.blocking) || []
    if (floor.green && review && blocking.length === 0) return { status: 'green', label, build, floor, review }
    if (round > MAX_FIX) return { status: 'needs-attention', reason: 'still red after ' + MAX_FIX + ' fix rounds', label, build, floor, review }
    log('Lane ' + L.id + ' (' + label + '): fix round ' + round + ' — ' + (floor.green ? blocking.length + ' blocking review findings' : 'floor red'))
    build = await agent(fixPrompt(L, { floor, review }, round), { ...OPUS, label: 'fix:' + label + '#' + round, phase: 'Verify', schema: BUILD_SCHEMA }) || build
  }
}

// Serialized merge queue: merges into the base branch never run concurrently.
let mergeChain = Promise.resolve()
function integrate(L, why) {
  const run = () => agent([
    'Merge lane branch ' + laneBranch(L) + ' into ' + BASE + ' in ' + BASE_WT + ' (' + why + ').',
    '1. cd ' + BASE_WT + ' && git status --porcelain: tracked changes present → stop and return merged false with a note (untracked audit/shots are expected).',
    '2. git merge --no-ff --no-commit ' + laneBranch(L) + '. On conflicts: list them, git merge --abort, return merged false.',
    '3. With the merge staged, run: npm run lint:js && npm run test:e2e-smoke. Red → git merge --abort, return merged false, smokeGreen false, and the failing tail in note.',
    '4. Green → git commit -m "merge(ux01): lane ' + L.id + ' ' + L.name + '" with the attribution line ' + ATTRIB + '; return merged true, mergeSha, smokeGreen true.',
    'Never push, never reset or rewrite existing commits.',
  ].join('\n'), { ...OPUS, label: 'merge:' + L.id, phase: 'Integrate', schema: MERGE_SCHEMA })
  const p = mergeChain.then(run)
  mergeChain = p.catch(() => null)
  return p
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------
if (A.approved !== true) {
  return { status: 'not-approved', message: 'UX01 Phase 3 needs Emilio\'s explicit approval. Re-run with {approved: true, cut: [...], retireLegacyView: <bool>} after he signs off on ' + SPEC + '.' }
}
const unknown = [...CUT].filter((id) => !CHANGES[id])
if (unknown.length) return { status: 'bad-args', message: 'Unknown change ids in cut: ' + unknown.join(', ') }

phase('Gate')
const gate = await agent([
  'UX01 Phase 3 gate. Read-only except for one allowed rebase. Report facts; do not fix anything else.',
  '1. Upstream: gh pr view 104 --json state,mergedAt and gh pr view 102 --json state,mergedAt → "merged" | "open" | "closed". For casefit: git -C ' + REPO + ' fetch origin main; "merged" if origin/main contains the tip of feat/casefit (git merge-base --is-ancestor) or a PR from feat/casefit is merged, else "open".',
  '2. Base: in ' + BASE_WT + ' (branch ' + BASE + ', local only, never pushed): if origin/main has commits the base lacks and the base worktree has no tracked changes, git rebase origin/main (allowed: unpushed local branch). On conflicts: git rebase --abort and note it. Report baseSha and rebasedOnMain.',
  '3. Fleet: command -v muse, grok' + (A.solLane === false ? '' : ', codex') + '; also run muse exec --help and grok --help to confirm they start. Report booleans.',
  '4. Idempotency: which of ' + LANES.map(laneBranch).join(', ') + ' and feat/ux01-sol-server exist and are already merged into ' + BASE + ' (git branch --merged ' + BASE + '). Return exact branch names, no markers or spaces.',
  '5. lsof -nP -iTCP:8644 -sTCP:LISTEN and ps: is the live discovery worker running from ' + BASE_WT + '? (liveWorkerFromUx01). Never kill or restart it.',
].join('\n'), { ...OPUS, label: 'gate', phase: 'Gate', schema: GATE_SCHEMA })
if (!gate) return { status: 'blocked', reason: 'gate agent returned nothing' }
if (!gate.fleet.muse || !gate.fleet.grok) {
  return { status: 'blocked', reason: 'verifier fleet missing (muse: ' + gate.fleet.muse + ', grok: ' + gate.fleet.grok + '). Per routing, the writing family never verifies itself; ask Emilio which fallback rung to use (fleet.md).', gate }
}

const merged = new Set(gate.alreadyMerged || [])
const upstreamOk = (need) => (gate.upstream[need] || '') === 'merged'
const plan = LANES.map((L) => {
  const ids = L.changes.filter((id) => CUT.has(id))
  const waiting = L.needs.filter((n) => !upstreamOk(n))
  const state = !ids.length ? 'not-in-cut' : merged.has(laneBranch(L)) ? 'already-merged' : waiting.length ? 'deferred' : 'ready'
  return { lane: L.id, name: L.name, changes: ids, state, waitingOn: waiting }
})
plan.forEach((p) => log('Lane ' + p.lane + ' ' + p.name + ': ' + p.state + (p.waitingOn.length ? ' (waiting on ' + p.waitingOn.join(', ') + ')' : '') + (p.changes.length ? ' · ' + p.changes.join(' ') : '')))
if (gate.liveWorkerFromUx01) log('Note: the live :8644 worker runs from ' + BASE_WT + '. The workflow never removes that worktree.')
if (A.dryRun) return { status: 'dry-run', gate, plan }

// ---------------------------------------------------------------------------
// Lane A: strictly ordered, lands before anything else
// ---------------------------------------------------------------------------
const results = {}
const laneA = LANES[0]
const planA = plan[0]
if (planA.state === 'ready') {
  phase('Lane A')
  for (const id of planA.changes) {
    const extra = id === 'C1'
      ? 'This step is C1 only. Extend installHermeticNetworkFence so same-origin /__proxy/* and /profile/* are answered by the fence (stubs, never the in-process server), except where a spec deliberately exercises the /profile proxy against its own stub API (critical-journey "should serve the dashboard\'s own /profile" test): keep that test green by routing it explicitly. Pattern: ' + PROG + '/audit/tools/audit-harness.mjs installHostIsolation. Add a regression test proving an unstubbed /__proxy/start-discovery-worker never reaches the server.'
      : 'This step is ' + id + ' only; earlier lane A steps are already committed on this branch.'
    const r = await buildAndVerify(laneA, [id], 'A-' + id, extra)
    results['A-' + id] = r
    if (r.status !== 'green') {
      log('Lane A stopped at ' + id + ': ' + r.status + ' — ' + (r.reason || ''))
      return { status: 'lane-A-' + r.status, stoppedAt: id, gate, plan, results }
    }
  }
  const mA = await integrate(laneA, 'lane A lands first')
  results.mergeA = mA
  if (!mA || !mA.merged) return { status: 'lane-A-merge-failed', gate, plan, results }
} else if (planA.state !== 'already-merged' && planA.state !== 'not-in-cut') {
  return { status: 'blocked', reason: 'lane A is ' + planA.state, gate, plan }
}

// ---------------------------------------------------------------------------
// Lanes B–F: build in parallel, verify, merge through the queue as each goes green
// ---------------------------------------------------------------------------
phase('Lanes')
const ready = LANES.slice(1).filter((L) => plan.find((p) => p.lane === L.id).state === 'ready')

// E's server half (C11) goes to the sol family first, when E is ready and C11 is in the cut.
async function solServer() {
  return agent([
    'Drive the sol (Codex) sub-lane for the server half of UX01 C11. You are a driver: do not write server code yourself.',
    setupSteps({ slug: 'sol-server' }),
    '4. Write a prompt file ' + SCRATCH + '/sol-c11.md: "In server/materials-request.mjs and server/materials-drafter.mjs, stop drafting from resume-template/resume.html. The request body gains resume: {source, filename, addedAt, text} (the user\'s resume text sent by the dashboard). Draft from it; when it is missing or empty, respond 422 {code: \\"resume_required\\", message: \\"Add your resume before drafting.\\"}. Keep the repo template only as a clearly labelled sample for tests. Add tests in server/ for both paths. See ' + PROG + '/audit/tailor-apply.md TA-01/TA-02 and ' + SPEC + ' C11. Do not touch files outside server/."',
    '5. Run: ' + SOL + ' -C ' + WT + '/ux01-sol-server --output-last-message ' + SCRATCH + '/sol-c11.out "$(cat ' + SCRATCH + '/sol-c11.md)" (timeout 45 min).',
    '6. Codex cannot always commit in a worktree: if it left uncommitted changes under server/, commit them yourself as "feat(server): draft from the user\'s resume, refuse without one" with the attribution line ' + ATTRIB + '.',
    '7. Write ' + PROG + '/lanes/LANE-REPORT-sol-server.md with the request/response contract and commit it. Return the contract and the head sha.',
  ].join('\n'), { ...OPUS, label: 'sol:C11-server', phase: 'Lanes' })
}

const laneRuns = await pipeline(
  ready,
  async (L) => {
    const ids = L.changes.filter((id) => CUT.has(id))
    let extra = ''
    if (L.id === 'E' && CUT.has('C11')) {
      if (A.solLane === false) {
        extra = 'The sol sub-lane is off for this run: ship only the UI gate for C11 (TA-02 slice) and record the server half as a handoff.'
      } else if (!gate.fleet.codex) {
        extra = 'Codex is unavailable, so the server half of C11 is deferred: ship only the UI gate (TA-02 slice) and record the server half as a handoff.'
      } else {
        const sol = await solServer()
        const solVerify = sol ? await museFloor('sol-server', WT + '/ux01-sol-server', ['npm --prefix server test']) : null
        results.solServer = { sol, solVerify }
        if (solVerify && solVerify.green) {
          const mSol = await integrate({ id: 'E-sol', name: 'sol server', slug: 'sol-server' }, 'server half of C11 before lane E UI')
          results.mergeSol = mSol
          extra = 'The sol sub-lane has merged the server half of C11 into ' + BASE + '; merge ' + BASE + ' into your branch first, then read ' + PROG + '/lanes/LANE-REPORT-sol-server.md for the contract.'
        } else {
          extra = 'The sol sub-lane did not go green; ship only the UI gate for C11 and record the server half as a handoff.'
        }
      }
    }
    return buildAndVerify(L, ids, L.id, extra)
  },
  async (r, L) => {
    results[L.id] = r
    if (!r || r.status !== 'green') { log('Lane ' + L.id + ' not merged: ' + (r ? r.status + ' — ' + (r.reason || '') : 'no result')); return r }
    let m = await integrate(L, 'lane green')
    if (m && !m.merged && (m.conflicts || []).length) {
      // Another lane landed first and touched a shared artifact. Sync once, re-verify, retry.
      log('Lane ' + L.id + ' conflicts with ' + BASE + ' (' + m.conflicts.join(', ') + '); syncing once')
      await agent([
        'In ' + laneWT(L) + ' on ' + laneBranch(L) + ': git merge ' + BASE + '. Resolve conflicts only inside files this lane owns, lane reports, or e2e-visual baselines (regenerate a conflicting baseline with the visual suite rather than picking a side, and record it). If a conflict sits in a file another lane owns, git merge --abort and report it as a handoff.',
        'Then run the floor, update the lane report, commit.', 'You own: ' + L.owns, RULES,
      ].join('\n'), { ...OPUS, label: 'sync:' + L.id, phase: 'Integrate', schema: BUILD_SCHEMA })
      const floor = await museFloor(L.id + '-sync', laneWT(L))
      m = floor && floor.green ? await integrate(L, 'retry after sync') : { merged: false, smokeGreen: false, note: 'floor red after sync' }
    }
    results['merge' + L.id] = m
    return { ...r, merge: m }
  },
)

// ---------------------------------------------------------------------------
// Conform: built app vs mockup, one fix round for must-fix gaps
// ---------------------------------------------------------------------------
phase('Conform')
const SURFACES = [
  { key: 'first-run', tags: 'C5 C6 C7 C11', how: 'greenfield demo board and invite; signed-in-empty dashboard right after setup (receipt + three ways in); Add job with an unreadable link' },
  { key: 'today-pipeline', tags: 'C9 C17 C18 C19 C20 C21', how: 'signed-in Today view, Pipeline board at 1440 and list at 375, stage menu open, undo toast, loading / refresh-failed / offline states' },
  { key: 'dossier', tags: 'C11 C12 C13 C14 C15 C16 C18', how: 'signed-in dossier for Kestrel, materials rows incl. Review state, Scribe in the dossier, Applied dialog, no-resume gate, server-down state' },
]
const conform = await pipeline(SURFACES, (s) => agent([
  'Compare the built app to the approved mockup for the UX01 "' + s.key + '" surface. Read-only: do not edit product code.',
  'Built app: ' + BASE_WT + ' via ' + PROG + '/audit/tools/audit-harness.mjs (openApp / shoot). If axe is needed, npm i --no-save --prefix ' + SCRATCH + '/axe axe-core@4 and set UX01_AXE_PATH.',
  'Mockup: file://' + BASE_WT + '/' + MOCKUP + ' (localStorage "ux01-mock-width" = "desktop" | "phone" switches widths).',
  'States to capture at 1440 and 375: ' + s.how + '. Save shots to ' + BASE_WT + '/' + PROG + '/conform/' + s.key + '/.',
  'For each tag in ' + s.tags + ' (only those in the cut: ' + [...CUT].join(' ') + '): list deviations between built and mockup. mustFix = the SPEC behaviour is missing or wrong, or a visual gap a stranger would notice (wrong primary, unreadable text, missing action). Pure pixel drift is not mustFix. Attribute each to its owning lane (' + LANES.map((L) => L.id + '=' + L.name).join(', ') + ').',
].join('\n'), { ...OPUS, label: 'conform:' + s.key, phase: 'Conform', schema: CONFORM_SCHEMA }))
const mustFix = conform.filter(Boolean).flatMap((c) => c.deviations || []).filter((d) => d.mustFix)
const byLane = {}
mustFix.forEach((d) => { (byLane[d.lane] = byLane[d.lane] || []).push(d) })
const mergedLanes = LANES.filter((L) => (results['merge' + L.id] || {}).merged || plan.find((p) => p.lane === L.id).state === 'already-merged')
const conformFixes = await pipeline(
  mergedLanes.filter((L) => byLane[L.id]),
  (L) => agent([
    'UX01 conformance fix for lane ' + L.id + ' in ' + laneWT(L) + ' on ' + laneBranch(L) + '. First: git merge ' + BASE + ' (fast-forward or clean merge; stop on conflicts).',
    'Close these must-fix gaps against the mockup:\n' + byLane[L.id].map((d) => '- ' + d.tag + ' ' + (d.surface || '') + ' @' + (d.width || '') + ': expected ' + d.expected + '; actual ' + d.actual).join('\n'),
    'Same ownership and rules as the build brief.', 'You own: ' + L.owns, RULES,
  ].join('\n'), { ...OPUS, label: 'conform-fix:' + L.id, phase: 'Conform', schema: BUILD_SCHEMA }),
  async (fix, L) => {
    const floor = await museFloor('conform-' + L.id, laneWT(L))
    if (!floor || !floor.green) return { lane: L.id, status: 'needs-attention', floor }
    return { lane: L.id, status: 'green', merge: await integrate(L, 'conformance fixes') }
  },
)

// ---------------------------------------------------------------------------
// Acceptance: integration floor, final cross-lane review, SPEC §6, completeness
// ---------------------------------------------------------------------------
phase('Acceptance')
const [finalFloor, finalReview, acceptance] = await parallel([
  () => museFloor('integration', BASE_WT),
  () => grokReview('integration', BASE_WT, [...CUT]),
  () => agent([
    'Measure the SPEC §6 acceptance numbers on the integrated branch in ' + BASE_WT + '. Read-only on product code.',
    'Re-run the Phase 1 scripts preserved in ' + PROG + '/audit/tools/scripts/ (they import the audit harness; point any hard-coded /private/tmp output paths at ' + SCRATCH + '/acceptance/ in a copy, never in the repo):',
    '- Stylesheets loaded and CSS bytes/unused: access-responsive/payload2.mjs (NOCOV=1 for counts). Before: 36 · 711 KiB · 85% unused at load. Target: ≤ 16 · ≤ 300 KiB.',
    '- Distinct colours and font sizes: design-system/measure-static.mjs and runtime.mjs. Before: 459 literals; 93 declared / 50 rendered. Target: ≤ 40 all in tokens-v2.css; 8 named / ≤ 9 rendered.',
    '- axe, 8 states × 2 widths: access-responsive/states.mjs both. Before: 16 critical · 25 serious. Target: 0 · 0.',
    '- Clicks to first tracked job: re-walk the first-run step table in ' + PROG + '/audit/first-run.md against the built flow (greenfield → Google step → Add job manual). Before: ~22 clicks, 3 signups (inferred). Target: ≤ 12 clicks, 1 outside task. Label inferred where the GIS stub blocks real sign-in.',
    'Also report page height at 1440/375 and the 375 board card width. Label each row confirmed, inferred or unknown.',
  ].join('\n'), { ...OPUS, label: 'acceptance', phase: 'Acceptance', schema: ACCEPT_SCHEMA }),
])
const critic = await agent([
  'Completeness critic for UX01 Phase 3. Read ' + SPEC + ', every ' + PROG + '/lanes/LANE-REPORT-*.md in ' + BASE_WT + ' and the lane branches, and git log ' + BASE + '.',
  'Which finding ids mapped to the cut (' + [...CUT].join(' ') + ') are not addressed by merged work? Which handoffs were never picked up? What risk would a PR reviewer raise first? Give next actions in order.',
  'Lane outcomes: ' + JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v && (v.status || (v.merged ? 'merged' : 'not-merged'))]))),
].join('\n'), { ...OPUS, label: 'critic', phase: 'Acceptance', schema: CRITIC_SCHEMA })

return {
  status: 'done',
  base: BASE,
  gate,
  plan,
  lanes: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v && { status: v.status || (v.merged !== undefined ? (v.merged ? 'merged' : 'not-merged') : v.solVerify ? (v.solVerify.green ? 'green' : 'red') : 'unknown'), reason: v.reason, mergeSha: v.mergeSha || (v.merge && v.merge.mergeSha), baselines: v.build && v.build.baselines, handoffs: v.build && v.build.handoffs }])),
  deferred: plan.filter((p) => p.state === 'deferred'),
  conformance: { mustFix: mustFix.length, fixes: conformFixes.filter(Boolean).map((f) => ({ lane: f.lane, status: f.status })) },
  integrationFloor: finalFloor,
  integrationReview: finalReview,
  acceptance,
  critic,
  publish: 'Nothing was pushed. A PR from ' + BASE + ' is Emilio\'s call (CI-worthiness gate: approved spec + green local floor).',
}
