# Discovery Hardening — Fable 5.1 / Opus 5 cmux Swarm

Goal: Orchestrate and locally integrate the next JobBored discovery-hardening increment: immutable Pages asset revisioning, hermetic browser-to-scraper coverage, complete discovery lifecycle and idempotency coverage, stable transport proof, and a read-only operational canary.

Success means:

- Fable 5.1 acts as the sole orchestrator and integration owner.
- A bounded cmux swarm of Opus 5 High agents performs the investigation, implementation, test, and final QA work.
- Every worker runs through Claude Code with `claude --model opus --effort high "<prompt>"` and its live process command confirms both the Claude binary and requested model.
- Each claimed gap has causal RED evidence before implementation and matching GREEN evidence afterward.
- Lane ownership is explicit, changes remain surgical, and shared files have one owner.
- Fable integrates verified local commits sequentially into `feat/discovery-hardening` and independently reruns the program gates.
- The final handoff distinguishes verified behavior, assumptions, environmental blockers, and work that still requires Emilio's approval.

Stop when: The integrated local branch satisfies every applicable success criterion and gate below, or a concrete blocker prevents further safe progress. Stop before any push, pull request, remote merge, deployment, secret mutation, schedule installation, DNS change, Cloudflare mutation, or Tailscale mutation.

## Runtime contract

You are the Fable 5.1 orchestrator. Confirm the active orchestrator model is Fable 5.1 before creating lanes. Treat a different orchestrator model as a launch mismatch and report it.

Orchestrate only. Your responsibilities are architecture, work decomposition, lane kickoff prompts, cmux supervision, file-ownership enforcement, evidence review, sequential local integration, independent verification, and the final handoff. Assign investigation, coding, tests, reviews, and conflict repairs to fresh Opus 5 High workers.

Launch every worker through its own Claude subscription using this command shape:

```sh
claude --model opus --effort high "<lane prompt>"
```

Immediately after each spawn, inspect the worker process with `ps -o args= -p <lane-pid>`. Record the process evidence in the program log. The binary must be `claude` and the arguments must include `--model opus --effort high`. A worker running through Cursor, Codex, Fable, another model, or another billing vehicle is a launch error. If Opus 5 capacity is unavailable, pause that lane and report the blocker so Emilio can choose the next action.

Use the installed orchestration and cmux guidance for workspace creation, observation, prompt delivery, and teardown. After pasting a kickoff prompt, submit it and verify that the worker actually began responding.

## Safety and publication boundary

- Work from `/Users/emilionunezgarcia/Job-Bored` and preserve unrelated changes in the user's current worktree.
- Create isolated worktrees and branches for the integration owner and every implementation lane.
- Use Node 24 and npm 11, matching the repository and CI.
- Commit coherent, reviewed, secret-free, locally verified lane changes. Keep commits local.
- Local merges into the isolated integration branch are in scope.
- Keep OAuth tokens, API keys, webhook secrets, resumes, job data, and other user content out of commits, logs, reports, fixtures, and screenshots.
- Keep all canary behavior read-only. It may inspect health and discovery-run state; it may not start discovery, write Sheet rows, rotate credentials, repair infrastructure, or contact job providers.
- Preserve the existing discovery webhook and Pipeline contracts unless a proven requirement makes a contract change necessary. If a contract changes, update every required schema, fixture, document, and contract test together.
- Prepare a cleanup inventory at the end. Leave cmux workspaces, branches, and worktrees intact until Emilio explicitly approves cleanup.

## Phase 0 — inspect, establish the floor, and lock the spec

Before implementation lanes begin:

1. Read the root `AGENTS.md`, relevant source exports, immediate callers, shared utilities, tests, and contract documents.
2. Inspect current Git status and record unrelated user changes that every lane must preserve.
3. Create the isolated integration worktree at `/private/tmp/Job-Bored-discovery-hardening-integration` on `feat/discovery-hardening`, based on the current approved integration base. Record the exact base SHA.
4. Create `docs/programs/discovery-hardening/PROGRAM-SPEC.md` and `docs/programs/discovery-hardening/INTEGRATION-LOG.md` in the integration worktree.
5. Use two short-lived, read-only Opus 5 High scout lanes in parallel:
   - `discovery-hardening-scout-browser`: inspect Pages assembly, browser assets, scraper transport, and the existing Playwright harness.
   - `discovery-hardening-scout-worker`: inspect webhook lifecycle, retry/idempotency behavior, stable transport, and available health/run-history readers.
6. Have each scout return exact file paths, current behavior, missing assertions, smallest credible change, likely ownership conflicts, and executable RED probes. Scouts create no product changes.
7. Reconcile scout findings into the program spec. State assumptions and choose one existing repository pattern for each seam. Flag competing patterns as follow-up cleanup rather than blending them.
8. Define these baseline claims with exact commands and outcomes:
   - `ASSET-1`: a deployed HTML revision cannot silently reference stale browser JavaScript.
   - `SCRAPE-E2E-1`: the real drawer-to-local-server path proves both successful extraction and a useful structured failure.
   - `LIFECYCLE-1`: accepted, running, retryable polling, terminal success/failure, duplicate delivery, and exactly-once Sheet effects are covered.
   - `STABLE-1`: the existing stable local transport and secret flow are either proven sufficient or have one evidence-backed gap.
   - `CANARY-1`: one read-only command classifies worker health and recent discovery success without exposing secrets.
9. Capture causal RED output for every unsatisfied claim. When a claim is already green, record the exact existing test and leave that behavior unchanged.

Finish and lock the execution spec before spawning implementation lanes. If the investigation materially changes scope or creates overlapping ownership, update the roster first.

## Lane contract

Every lane receives a self-contained kickoff with:

- Goal, Success means, and Stop when.
- Exact worktree, branch, base SHA, and file ownership.
- Relevant architecture and contract invariants.
- Named RED claim and commands.
- Targeted verification commands and expected evidence.
- Local commit requirement and publication boundary.

The lane's first filesystem action is creating `LANE-REPORT-<lane>.md` in its worktree with these headings:

```md
# Lane report: <lane>

## Scope and ownership
PENDING

## Baseline and RED evidence
PENDING

## Implementation
PENDING

## Verification and raw output
PENDING

## Commit, risks, and handoff
PENDING
```

Require each worker to replace every `PENDING`, paste exact raw test or blocker output, review its diff, scan it for secrets, commit one coherent local change, and return its commit SHA. A pass count alone is insufficient evidence. Environmental failures such as listener permission errors, absent credentials, browser-control loss, or network restrictions remain literal blockers and are reported as such.

Each lane edits only its declared fence. When new shared-file ownership is necessary, the worker pauses and asks Fable to reassign or serialize that file before editing it.

## Worktree and lane roster

Create fresh lane worktrees from the locked integration base. Use these branches and ownership fences.

| Lane | Branch | Primary ownership | Dependency |
| --- | --- | --- | --- |
| Assets | `feat/discovery-hardening-assets` | `scripts/assemble-index.mjs`, `.github/workflows/pages.yml`, `tests/pages-deploy-contract.test.mjs`; `index.html` only if the proven revision seam requires it | Locked spec |
| Scrape E2E | `feat/discovery-hardening-scrape-e2e` | `tests/e2e-fixtures/hermetic-harness.mjs`, `tests/e2e-journey/critical-journey.spec.mjs`, narrowly scoped fixture assets under the same E2E directories | Locked spec |
| Lifecycle | `feat/discovery-hardening-lifecycle` | Focused lifecycle/idempotency tests under `integrations/browser-use-discovery/tests/webhook/` and `integrations/browser-use-discovery/tests/sheets/`; exact production files named by the locked spec only when RED proves a defect | Locked spec |
| Stable transport | `feat/discovery-hardening-stable-transport` | `discovery-readiness.js`, `discovery-status-handoff.js`, and the named stable-transport tests; production edits only for a proven gap | Locked spec |
| Canary | `feat/discovery-hardening-canary` | `scripts/discovery-canary.mjs`, one focused test file, `package.json`, and `docs/DISCOVERY-CANARY.md` | Locked spec; reuse existing readers |
| Integrated QA | `feat/discovery-hardening-qa` | Read-only inspection and verification; no product-file edits | All implementation commits integrated |

Only the Assets lane owns the Pages workflow and assembler. Only the Scrape E2E lane owns the hermetic harness and critical journey. Only the Canary lane owns `package.json` and the canary document. Only Fable owns the program spec, integration log, merge order, and final integrated branch.

## Lane A — immutable Pages asset revisioning

Goal: Make a deployed Pages HTML revision reference the matching browser assets deterministically, using the smallest mechanism that fits the current static assembly flow.

Success means:

- `ASSET-1` has a causal RED test and a matching GREEN test.
- Pages assembly emits deterministic asset references tied to the deployed content revision or content digest.
- The deployed `_site` output cannot combine newly assembled HTML with an older cached discovery script under the tested contract.
- Local development remains straightforward and existing script load order remains intact.
- The test validates actual assembled HTML/output behavior rather than matching an incidental source string.

Inspect `index.html`, `scripts/assemble-index.mjs`, `.github/workflows/pages.yml`, and `tests/pages-deploy-contract.test.mjs` before choosing the seam. Prefer the existing assembler as the single deterministic transform. Keep any workflow change narrow and observable in the deploy-contract test.

## Lane B — hermetic drawer-to-scraper journey

Goal: Exercise the real browser UI request path to `POST /api/scrape-job` against a hermetic local server fixture.

Success means:

- `SCRAPE-E2E-1` proves a successful Figma-like job extraction through the actual drawer interaction and rendered result.
- A Wellfound-like fixture returns a structured `422`, and the UI presents the actionable error category, plain-language reason, useful diagnostics, and next action without leaking internals or secrets.
- The fixture is local, deterministic, network-independent, and uses the production request/response shape.
- Assertions verify the user's visible outcome and the diagnostic contract, not only that a request occurred.

Extend the existing hermetic harness and critical-journey style. Reuse current signed-in setup and request interception patterns. Keep external sites and live accounts out of this lane.

## Lane C — discovery lifecycle and idempotency

Goal: Prove the browser/worker lifecycle contract, retry behavior, and exactly-once effects under duplicate or delayed delivery.

Success means:

- `LIFECYCLE-1` covers accepted, running, retryable polling, terminal completion, terminal failure, duplicate webhook delivery, and exactly-once Pipeline/DiscoveryRuns effects.
- Tests use deterministic deferred controls or injected dependencies. Wall-clock sleeps are absent from race assertions.
- Polling accepts both `statusPath` and `status_path` where the current contract requires it.
- Retry classification stays deterministic; model calls do not decide routing, retry, or idempotency.
- Production changes appear only where a causal RED proves existing behavior is wrong.

Preserve the webhook security/order invariant: method check, secret auth, JSON parse, per-run `googleAccessToken` stripping, preflight validation, first run-status side effect, then run execution. Preserve error details that support the reinforced discovery UX while keeping secrets redacted.

## Lane D — stable transport proof

Goal: Determine whether the current stable local transport and secret handoff are already sufficient, then make the smallest evidence-backed repair only if a gap remains.

Success means:

- `STABLE-1` is supported by exact existing or new test evidence.
- The UI reports the real failing hop among dashboard, scraper/worker, tunnel or stable transport, relay, and secret authentication.
- Already-satisfied behavior remains unchanged.
- Any repair keeps environment-specific addresses and secrets in configuration rather than source.

Inspect these tests first:

```text
tests/discovery-connection-tailscale-hint-and-secret-fix.test.mjs
tests/dev-server-tailscale.test.mjs
tests/discovery-transport.test.mjs
tests/discovery-readiness-truth.test.mjs
tests/discovery-wizard-verify.test.mjs
tests/discovery-cold-start-handoffs.test.mjs
```

If they already prove the claim, return a test-only/no-product-change lane report. Treat live infrastructure mutation as outside the lane boundary.

## Lane E — read-only discovery canary

Goal: Add one deterministic operator command that summarizes local worker health and the freshness of the newest successful discovery run.

Success means:

- `npm run discovery:canary -- --max-age-hours 24 --json` exists.
- Output has stable machine-readable statuses: `healthy`, `stale`, `unavailable`, and `misconfigured`.
- Exit codes are documented and covered by tests.
- Tests inject the clock, fetch implementation, and run-history reader.
- Text and JSON output redact credentials and avoid printing request headers or source job content.
- The command is read-only and performs no recovery mutation.

Reuse existing worker health and DiscoveryRuns-reading boundaries when practical. Keep the canary as a thin deterministic classifier. Document configuration, status meanings, exit codes, examples, and safe operator follow-up.

## Integration protocol

Fable performs these steps after a lane reports completion:

1. Inspect the lane report, status, diff, commit, and secret scan.
2. Rerun that lane's targeted gate in its worktree. Match the original RED probe to its GREEN result by claim ID and meaningful detail.
3. Reject hollow tests, hidden skips, unrelated formatting, speculative abstractions, and edits outside the lane fence. Send corrections back to a fresh Opus 5 High repair lane when needed.
4. Merge accepted lane commits sequentially into the isolated integration branch, recording every SHA and result in `INTEGRATION-LOG.md`.
5. After each merge, rerun the affected targeted gates and check for ownership collisions.
6. Resolve integration conflicts in the lane that owns the losing file, using a fresh Opus 5 High conflict-repair worker. Fable reviews and integrates the resulting local commit.

Use this merge order unless the locked spec records a dependency-backed reason to change it:

1. Assets
2. Scrape E2E
3. Lifecycle
4. Stable transport
5. Canary

## Integrated verification

Run the narrow tests named by every lane, then run the repository floor from the integration worktree:

```sh
npm test -- tests/pages-deploy-contract.test.mjs
npm run test:e2e-journey
npm run test:e2e-smoke
npm run test:browser-use-discovery
npm run test:contract:all
npm run typecheck:repo
npm run lint:repo
npm run test:repo
git diff --check
```

Also run the canary's focused tests and deterministic fixture invocations for all four statuses. Record exact output, duration, skipped tests, environment limitations, and the integration HEAD SHA. A command that cannot run in the environment remains unverified even if related static checks pass.

After the floor is green, spawn the Integrated QA lane as a fresh Opus 5 High worker. Its read-only review must cover:

- Diff-to-goal traceability for every changed line.
- Business-meaningful strength of each test.
- Cross-lane lifecycle and error-shape compatibility.
- Contract/schema/document alignment.
- Secret and personal-data exposure.
- Accessibility and plain-language quality of user-visible scrape/discovery errors.
- Determinism, cleanup behavior, and accidental live-network dependencies.
- Explicit confirmation that no test was skipped or weakened.

Fable adjudicates every QA finding, delegates any correction to the owning Opus lane, reintegrates it, and reruns the affected gates plus the full floor.

## Final handoff

Return one concise, evidence-backed report containing:

- Outcome in plain English.
- Integration branch, base SHA, final HEAD SHA, and local commit list.
- Files changed, grouped by claim and lane.
- RED-to-GREEN table for `ASSET-1`, `SCRAPE-E2E-1`, `LIFECYCLE-1`, `STABLE-1`, and `CANARY-1`.
- Exact targeted and full-gate results, including skips and environmental blockers.
- Browser-to-server and browser-to-worker coverage matrix.
- Canary command, statuses, exit-code contract, and sample redacted output.
- Stable-transport conclusion: already sufficient or repaired, with supporting evidence.
- Integrated QA findings and their disposition.
- Remaining risks, assumptions, and anything that requires external verification.
- Explicit statement that no push, PR, remote merge, deployment, secret change, schedule installation, Cloudflare mutation, DNS mutation, or Tailscale mutation occurred.
- Cleanup inventory listing only this program's cmux workspaces, worktrees, and branches; await Emilio's approval before removing or closing them.

