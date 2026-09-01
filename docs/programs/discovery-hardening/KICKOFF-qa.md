# Lane QA — integrated read-only review (all claims)

Read `GROUND-RULES.md`, `PROGRAM-SPEC.md` (Locked decisions LD-1..LD-8), `INTEGRATION-LOG.md`, and every `LANE-REPORT-*.md` archived under `docs/programs/discovery-hardening/reports/`. Worktree: `/private/tmp/Job-Bored-discovery-hardening-qa`, branch `feat/discovery-hardening-qa` (cut from the integrated HEAD named in your launch prompt).

**Goal:** Adversarially review the integrated `feat/discovery-hardening` diff against the five claims and produce a findings report the orchestrator can adjudicate. You change NO product or test file.

**Success means:** `LANE-REPORT-qa.md` (your only write, plus scratch in `.lane-evidence/`) contains, with file:line evidence for every item:
1. **Diff-to-goal traceability** — `git diff 81e313a..HEAD --stat` and, per changed file, which claim (ASSET-1 / SCRAPE-E2E-1 / LIFECYCLE-1 / STABLE-1 / CANARY-1) and which locked decision justifies it. Any line with no claim = finding.
2. **Test strength** — for each new/changed test: what business behavior it encodes, and whether an arbitrary reimplementation could still pass it (hollow test = finding). Confirm no `.skip`, `.only`, `todo`, filtered glob, or weakened assertion: `git diff 81e313a..HEAD | grep -nE 'skip\(|\.only\(|todo\(|continue-on-error'` plus a read of every modified test.
3. **Cross-lane compatibility** — the derived runId (LD-3) vs the poller/tracker changes (LD-4) vs the canary's snapshot reader (LD-6/7): same status enum, same terminal set, same statusPath shape; the 422 fixture shape vs `toScrapeFailureResponse`; the digest stamp vs anything that parses `src=`.
4. **Contract/schema/doc alignment** — `npm run test:contract:all` output pasted; `docs/DISCOVERY-CANARY.md` matches the exit-code table in LD-7; the webhook ack schema unchanged.
5. **Secrets and personal data** — `git diff 81e313a..HEAD | grep -nEi 'ya29|AIza|sk-[a-z0-9]|ngrok-free|ts\.net|@gmail|spreadsheets/d/'` and a read of every fixture; anything real = finding. Confirm no lane committed `config.js`, `.env`, or a real Sheet ID.
6. **Accessibility and plain language** — the scrape 422 rendering (`role=alert`, "Why:/Next:" copy) and the new poller terminal message: readable at a glance, no jargon, no internal hosts.
7. **Determinism and hygiene** — no wall-clock sleeps in race assertions, no live network (grep for `https://` in new tests outside fixtures/comments), temp dirs cleaned in `afterEach`/`finally`, the canary never mutates (read the code path, not just the test).
8. **Explicit statement** that no test was skipped or weakened, or the exact list of those that were.

Run yourself and paste: `npm run typecheck:repo`, `npm run lint:repo`, `npm run test:repo`, `npm test -- tests/pages-deploy-contract.test.mjs`, `npm run test:e2e-journey`, `npm run test:e2e-smoke`, `git diff --check`, and the four canary status invocations with exit codes.

**Fence:** read-only. Findings, not fixes. Rank findings: BLOCKER (claim not actually met / secret / weakened test) → MAJOR (hollow or misleading test, doc mismatch) → MINOR. Commit nothing. Never push.
