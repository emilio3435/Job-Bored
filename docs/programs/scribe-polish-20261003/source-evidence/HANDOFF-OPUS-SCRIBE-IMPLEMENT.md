# Scribe repairs and UX polish: orchestrator handoff

Goal: use /orchestrate to implement the evidence-backed résumé and cover-letter editor repairs, complete the documented editing controls, and polish the editing experience.

Success means:
- Resolve ASTRA-01 through ASTRA-05 and RISK-01 with meaningful red-first regressions and both-document browser proof.
- Implement GAP-02 selection/focused-block scope and GAP-01 direct manual editing as bounded follow-ups after the reliability substrate lands.
- Deliver concise, truthful copy and a coherent desktop/mobile editing flow, with before/after evidence and preserved facts, history, and sibling documents.
- Produce one locally committed, independently reviewed integration branch, a completed issue-to-fix ledger, and a short HTML review page.

Stop when: the implementation, independent review, and applicable gates are complete with precise evidence; or the same external blocker repeats twice and requires an owner decision. Report any unavailable gate as unavailable and keep its associated claim unverified.

Constraints: work locally; preserve customer drafts, unrelated changes, fact locks, append-only history, and publication boundaries. Never push, open/merge a PR, deploy, or rewrite shared history. Use fictional data and isolated storage/browser contexts for destructive or save/restore testing. Keep credentials and customer content out of tracked files, fixtures, screenshots, logs, and reports.

## 0. Locked decisions and routing

Goal: execute the authorized scope with verified model pins and clean ownership.
Success means: the host/lanes use the locked families and efforts, the work remains within this editor flow, and routine choices are resolved autonomously.
Stop when: the program manifest, contract, lane fences, and first independent plan review are ready.

| Decision | Locked direction |
|---|---|
| Host | Opus at **high**, explicitly requested by Emilio; override the normal max-effort default. HOST-PIN.json beside this file records the exact requested model. |
| Implementation | Sol at the effort prescribed by current model-policy.md; copy a fresh models.lock.json into the implementation program and launch workers from it. The earlier Sol **planning** lane ran high; that is not a new blanket override for build lanes. |
| Review | Fable for the first independent plan/diff/floor round; Astra for computer-use/browser acceptance. Alternate subsequent formal review rounds per policy; the writing family does not review its own work. |
| Scope | Both Scribe document editors, all six reliability repairs, both documented editing capabilities, and local UX/copy/CSS polish of those flows. |
| Preserve | Vanilla JS/global-script architecture, current templates/themes and deliberate load order, server-authoritative nodes, current schema/fit limits, auth/CORS/CSP boundaries. |
| UX direction | Refine the existing product; improve clarity, visual hierarchy, consistency, accessibility, and recovery without a new brand/theme or framework migration. |
| Delivery | Verified local branch/commits and review artifacts. Publication and deployment remain with Emilio/CI. |
| Authority | This handoff supplies scope and execution authorization to the receiving orchestrator. The old audit's “planning only” restriction governed that completed pass; this new implementation pass is authorized. |

Apply these rows as answered §0 scope questions when following /orchestrate. Resolve routine implementation/design choices inside this scope yourself and document them. Surface a genuine scope change or required external authority with the exact reason and source.

Read /orchestrate, directional-prompting, frontend-design, repo AGENTS.md and applicable deeper instructions. Apply the protocol's fresh quota/model checks before launching; use **100%** as the common launch/stop exhaustion threshold. Earlier 1–2% Codex readings are historical, not current permission or capacity evidence. Preserve host high through restarts; verify live argv/session metadata, not profile names alone. Use cmux lanes and the program roster, respect terminal/depth limits, and launch no nested worker swarms.

## 1. Floor commands: establish baseline before changes

Goal: keep baseline, candidate, and browser/real-provider/PDF evidence distinct.
Success means: commands and literal outputs are logged, with failing IDs, filtered cases, TODOs, and unavailable dependencies visible.
Stop when: baseline proof is captured and assigned candidate gates are explicit.

Use Node 24/npm 11. Set JOBBORED_PROFILE_PATH and JOBBORED_LLM_CONFIG_PATH to fresh fictional files in the new implementation program's ignored evidence directory. Use the hermetic browser fence and disposable auth/state.

```sh
node --test tests/materials-nodes.test.mjs tests/materials-edit.test.mjs tests/materials-edit-factcheck-model.test.mjs tests/materials-edit-commit.test.mjs tests/materials-pipeline.test.mjs tests/integration/materials-edit-api.test.mjs
node --test tests/scribe-v2-api.test.mjs tests/scribe-v2-lifecycle.test.mjs tests/scribe-v2-carryover.test.mjs tests/scribe-v2-keyboard.test.mjs tests/scribe-v2-diff.test.mjs tests/scribe-v2-versions.test.mjs
npx playwright test --config tests/e2e-journey/playwright.config.mjs tests/e2e-journey/scribe-edit-journey.spec.mjs tests/e2e-journey/scribe-v2-desk.spec.mjs --output .lane-evidence/scribe-polish-baseline
npm run test:materials-contract
```

Run integration-level lint/typecheck/contracts after changes; run the full root suite on the frozen candidate. Preserve the strict Stop expectation even when the baseline is intermittent. Use installed Chrome through the existing harness if bundled Chromium is unavailable; a mock or HTTP200 alone is not visible-edit/save proof.

## 2. Source and evidence to consume

Goal: build on the repaired local baseline and the completed investigation.
Success means: all eight IDs remain mapped to source, tests, lane owners, and acceptance evidence.
Stop when: source compatibility and the input manifest are verified.

Repository: /Users/emilionunezgarcia/Job-Bored
Audited source worktree: /Users/emilionunezgarcia/Job-Bored/.worktrees/scribe-editor-fix
Confirmed source HEAD at handoff: 3641d33fc26e20c22c7a22c15e600ccba8a7de45
Confirmed serving checkout: /Users/emilionunezgarcia/Job-Bored/.worktrees/test-pr160
Confirmed serving HEAD at handoff: e0f9137fb3d99c112065053c7e0c87e8fe175a01
Both checked trees: e05bc82226f7e61b5c75bb510fa07b3a70c8d117; both tracked statuses were clean.

Evidence directory: /Users/emilionunezgarcia/Job-Bored/.worktrees/scribe-editor-fix/.lane-evidence/editor-qa-20261003
Read these files there:
- ASTRA-FINDINGS.md: browser coverage, ranked defects, capability gaps, exact reproductions and limits.
- SOL-REPAIR-PLAN.md: authoritative detailed R0/R1/R2/F1/F2 plan, contract shapes, regression seams and acceptance.
- repair-plan-review.html: short issue/resolution overview.
- HOST-BROWSER-FLOOR.txt, HOST-FOCUSED-FLOOR.txt, astra-targeted-floor.log, astra-stop-rerun.log.
- sol-stop-measuring-result.json and HOST-STOP-RACE-PROBE.txt: controlled server scheduling proof.
- Relevant orphan-*, early-stop-*, pdf-unavailable-*, stale-*, recovery-*, mobile-* JSON/screenshots and probe runners.

Preserve these baseline artifacts. Create a fresh docs/programs/scribe-polish-20261003 program, evidence folder, spec, lock snapshot, LANES.md and report manifest in the new integration worktree. Use absolute source-evidence paths until reports are copied; verify copied hashes. Copy sanitized reports/runners/screenshots only; keep scratch fixtures/provider configuration out of tracked program docs.

Branch from the currently verified default branch into a new feat/ or fix/ integration worktree. Carry prerequisites 4161a43f and 3641d33f (or proven patch-equivalent fixes) if the default branch lacks them. The serving equivalents are c346dbb1 and e0f9137f. Inspect current history/patch equivalence before cherry-picking; preserve current local changes and report drift. Validate that the six repro boundaries still apply to the chosen baseline.

Keep the live app's serving checkout and ~/.jobbored customer storage separate from swarm fixtures. Ports 8080/3847/8644 belong to the active local stack; use ephemeral ports for QA. The private startup script checks exact serving HEAD; a changed checkout without a coordinated guard update can prevent startup. This handoff's completion target is the verified integration branch, not an unreviewed live-checkout installation.

## 3. Required repairs and acceptance

Goal: restore trustworthy editing without weakening the mutation guardrails.
Success means: each row is implemented for both document types and proven by its regression case.
Stop when: all six repairs pass the candidate gates and independent review.

| ID | Required result |
|---|---|
| RISK-01 / R0, first | A Stop that wins remains partial in memory, disk and SSE. Own terminal transitions synchronously, recheck after awaited measuring, serialize snapshots/event delivery, emit one terminal outcome, preserve validated ops. Reject never resurrects its file. Use deterministic barriers; release the held writer before awaiting Stop's queued persistence. |
| ASTRA-01 / R1 | Recover persisted pending/ready/partial proposals across close/reopen, switch and second prompt. Keep Review/Discard reachable; retain composer text and review choices where available; explicit discard awaits DELETE. Preserve one-open-proposal-per-role protection. |
| ASTRA-02 / R1 | Capture Stop intent before proposal ID arrives; settle the late start response by stopping that exact ID. A lost response has role-scoped recovery; stale callbacks cannot mutate the next editor/document. Show Stopping until settlement. |
| ASTRA-03 / R2 | Recognize only the contract's valid committed-run browser_unavailable503 as text saved/PDF unavailable. Update version/history/preview, clear consumed proposal and duplicate Save. Ordinary503 remains failure; accept/manual/restore share truthful outcome handling. |
| ASTRA-04 / R2 | On the single permitted stale creation retry, install exact current listing/model/nodes/preview and await iframe load before redlines. Header, deletion text, words and request base agree. A second concurrent move stays a conflict; accept/manual/restore preserve CAS. |
| ASTRA-05 / R2 | Preserve bounded safe message/error/code/fix and concrete recovery actions. Distinguish provider failure, unreadable reply and genuine model/template violation. Keep raw provider payloads, credentials, paths and stacks out of user copy/logs. |

Treat the plan's GET /api/applications/:slug/edits/open shape and rebase payload as proposed contracts to freeze after source/plan review, then implement consistently in service, registration, live API adapter, explicit stub, and tests/docs. Preserve existing auth/path/CORS boundaries; server/index.mjs imports registerMaterialsEditRoutes, which mounts routes in materials-versions.mjs.

Preserve authoritative server IDs, UTF-16 locks, atomic clone/final validation, fact novelty and explicit unverified confirmation, featured employer 2–5 bullets, statement 20–55 words, letter 3–4 paragraphs, safe legacy-letter normalization, append-only runs, publication claims and exact sibling equality. Keep the old two-paragraph/five-bullet fixes. Unsupported facts stay blocked/flagged even when copy becomes friendlier.

## 4. Editing capabilities and UX polish

Goal: make the edit interaction direct, comprehensible, and visually coherent.
Success means: both documented capabilities work and the UI communicates real state with measurable desktop/mobile usability.
Stop when: both-document capability/visual/CSP/keyboard checks pass and every polish change has a before/after rationale.

Implement after R0–R2:
- GAP-02 / F1: parent-installed selection/focus handlers in the scriptless preview resolve authoritative current-document node IDs. Show actual scope and an accessible Rewrite/Shorten/Emphasize/Ask/Edit text action surface. Substring selection scopes its containing block; stale/invalid selection requires reselection rather than silently expanding to the whole document.
- GAP-01 / F2: eligible plain-text block replace, blur plus two-second debounce into one immutable manual version, with visible save state and retained local draft on failure. Preserve locked spans and whole locked fields, explicit new-fact confirmation, manual role-ownership gate, stale CAS, and sibling/history. Support Save/Discard/Stay for unsaved navigation. Keep beyond-refresh draft persistence outside this bounded pass unless separately specified.

Define polish through concrete changes:
- Inventory the editor's actual copy and states before editing. Use brief, literal labels and consistent terms for request, change review, saved version, and unavailable PDF. Distinguish accepting a suggested change from durable saving according to actual behavior.
- Replace generic “something went wrong,” model-flattering marketing, repeated reassurance, technical status codes, invented jargon, decorative badges, redundant headings and repeated instructions with one clear explanation and the relevant action. Preserve all meaningful warnings, locks and provenance.
- Give request entry, scoped selection, pending/recovered review, Save, Discard, Stop and history a clear hierarchy. Keep one obvious next action per state; preserve intentional shortcuts and visible focus. Consolidate duplicate affordances only when every required action stays reachable.
- Refine spacing, alignment, typography, button sizing and responsive layout within the current theme. Keep content legible; test at1440px and375px,44px targets, no sideways scrolling, reduced motion, keyboard-only use, focus return and accessible state announcements.
- Keep async state stable: preserve typed prompts, local drafts and recoverable changes; prevent disappearing controls, stale marks, unexplained disabled buttons, jumpy status changes and indefinite optimistic promises. Offer specific recovery when an action fails.
- Apply “remove AI slop” to interface copy/design and instructions generated for this flow. Preserve user-authored résumé/letter wording and factual records; polishing UI is not authority to silently rewrite their documents.

Write UX-DELTA.md with actual before/after strings/screenshots, the user benefit and acceptance case. Extend verification to score-modal Fix/Apply/Repair and template/customizer entry points that route into this editor; the audit did not prove those paths. Keep changes to adjacent controls limited to integration/usability defects found there.

## 5. Swarm ownership and integration

Goal: use parallelism where file fences permit it, with one integration owner.
Success means: every path has one writer, shared interfaces land coherently, and reports/tests travel with commits.
Stop when: all lane branches are integrated and independent review issues are resolved.

Recommended flat lanes (confirm precise test/section ownership in the new spec):

| Lane | Family / exclusive responsibility | Dependencies |
|---|---|---|
| BE | Sol: server/materials-versions.mjs, materials-edit.mjs, route registration if needed; integration API/server tests. R0 terminal/persistence substrate, R1 persisted recovery, R2 provider classification, F2 manual gate. | Land R0 first; freeze recovery/error/rebase contracts before FE integration. |
| FE | Sol: scribe-v2.js, scribe-v2-api.js, scribe-v2-versions.js and their focused JS tests. R1/R2 client lifecycle/outcomes, F1/F2 controls/behavior and approved copy. | Build against frozen contract fixtures; integrate real service before acceptance. Own all shared editor JS throughout. |
| UX | Sol build lane: scribe-v2.css and reviewed visual snapshots; host Opus owns the UX brief/copy inventory. Supply a copy/markup proposal for FE to apply. | Freeze DOM/class anchors with FE; keep editor JS ownership in FE, CSS in UX. |
| QA | Astra: read-only product QA, isolated scratch repros/browser/real-PDF evidence and issue ledger. | Start baseline probes early; run candidate acceptance after frozen integration. Assign maintained browser test-file writes to FE or a separate explicitly fenced test lane, not competing writers. |
| Review | Fable: plan before build launches, independent diff/floor review after integration; report findings with actual command output. | Review the family that did not write the implementation; follow policy alternation later. |

Schedule at most four worker lanes concurrently plus host, within actual terminal/provider capacity. Use the reviewer before build launches, then share that slot as appropriate. Preserve a single FE owner for scribe-v2.js; serialize capabilities in that lane rather than spawning overlapping feature writers. Grant any additional verifier slot explicitly. Tell each worker it is not alone and to preserve other lanes' edits. A worker spawns no agents.

Create shared/per-lane kickoffs with Goal/Success means/Stop when, exact fences, dependencies and floor commands. Make every lane's first action its five-section PENDING report. Maintain roster/heartbeat/quota checks and copy completed reports into the program. Integrate one branch at a time and rerun the affected floor; freeze the candidate during long tests. Keep the old red logs and compare failures by ID/detail.

## 6. Final gates, evidence and delivery

Goal: hand Emilio a verified implementation and honest short review artifact.
Success means: all functional and UX claims have the appropriate proof, remaining unavailable lanes are precisely named, and the final branch is locally committed and secret-free.
Stop when: the issue ledger is complete, independent review is resolved, and final deliverables are linked.

Run A–E from SOL-REPAIR-PLAN.md, all existing affected tests plus maintained new regressions. Run full npm test on the frozen candidate; report actual totals, failures, skips and TODOs. Run npm run lint:repo, npm run typecheck:repo, npm run test:contract:all, npm run test:materials-contract and git diff --check. Keep root/server startup, auth and contract boundaries covered where modified. Run staged and commit-range secret scans per /orchestrate.

After the complete focused gate, retain twenty separate strict Stop diagnostic runs as specified by the plan; combine them with deterministic barrier proof. A passing rerun does not erase an intermittent red. Add and run capability tests, existing node-ID/CSP/visual probes, and both-document keyboard/mobile regressions. Review intentional snapshot changes with before/after evidence.

Complete the plan's actual-PDF gate with real installed-browser PDF generation: save fictional edit per document, download/reopen PDF and check changed text, fonts/page count and sibling artifact. Prove HTML-saved/PDF-stale fault copy separately. Mark dependency-unavailable precisely; mock PDF evidence cannot support printable-output readiness. Exercise any real supported PDF recovery path, and remove unsupported promises when no such path exists.

Run a small fictional live-provider sample for both documents and verify visible preview, accepted saved text, reopen persistence, version provenance and sibling equality. Keep live-model success separate from deterministic mocked fault paths; use configured credentials only in private memory/env and record count-only results. Report actual-provider unavailability as a missing proof lane, without manufacturing a fallback pass.

Carry forward the audited results accurately: five existing browser cases passed; four live Gemini saves succeeded; Astra focused60 cases had59pass/1fail, filtered1/1 and host60/60; the controlled server probe confirmed partial→ready with two terminal events. These establish baseline/proof boundaries, not candidate completion.

Deliver:
- Integration branch, exact HEAD and coherent local commits; preserved unrelated work.
- ISSUE-LEDGER.md mapping six repair IDs, two capabilities and each UX change to files/commits, red-first test, candidate evidence and status.
- Independent verdict, full command outputs and precise unverified/blocked lanes.
- IMPLEMENTATION-REVIEW.html: a short issue → implemented resolution → evidence page with before/after UX screenshots and explicit remaining gaps.
- A concise final update leading with resulting editor behavior and any material limitation. Sweep only this program's completed temporary lane worktrees/panes according to /orchestrate; retain source audit evidence and final branch/reports. Print publication commands for Emilio only when appropriate; execute none.
