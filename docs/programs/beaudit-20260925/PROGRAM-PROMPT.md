# BEAUDIT — Backend inventory, audit and improvement spec (Opus 5.5 medium swarm)

Goal: Inventory and audit every JobBored backend surface with an Opus swarm, then turn the verified findings into a succinct, approval-ready spec and an HTML mockup of the fixes, optimizations and backend-enabled features to build next.

Success means:
- `docs/programs/beaudit-20260925/` holds `INVENTORY.md`, `REGISTER.md`, `SPEC-BEAUDIT-20260925.md`, `MOCKUP.html`, `LANES.md`, `PRIOR-CLAIMS.md`, `reports/` and `verdicts/`.
- `INVENTORY.md` lists every backend entrypoint (HTTP route, CLI script, scheduled job, webhook handler, Apps Script function, Python script) with `path:line` at the pinned SHA, its caller, what it reads and writes, and its test file. Every entrypoint has an owning lane.
- Every `REGISTER.md` row follows §Findings schema and carries a status label. Every P0 and P1 row carries a reproducer that the muse family ran, verdict pasted.
- Every backend claim in `docs/audits/2026-08-31-luna-swarms/CRITICAL-AUDIT.md`, and every backend-dependent item in its `FEATURE-WISHLIST.md`, has a ledger row: `PRIOR-FIXED <sha>`, `PRIOR-OPEN` (with repro), `IN-FLIGHT #<pr>`, or `MOOT`.
- The spec body (§1–§9) stays under 2,500 words, opens with five so-whats, and closes with a fenced build program and the decisions Emilio owns.
- `MOCKUP.html` shows current → target architecture, before/after API contracts, and a mock of each proposed feature where it surfaces in the app. It is published as a private Artifact and linked at the top of the final report.
- Grok's plan check is folded into the spec, and the §9 decisions have been put to Emilio.
- Product code is untouched: `git -C ~/Job-Bored.worktrees/beaudit-integration diff <pinned-sha> --stat -- . ':!docs/programs/beaudit-20260925'` prints nothing.

Stop when: every line above holds, or a blocker only Emilio can clear. This program audits and specifies; the build is the next program, run from this spec once Emilio approves it.

## Runtime contract

- **Orchestrator:** this session, running the `orchestrate` skill (lane protocol, reports, watch cadence, sweep) with the overrides below.
- **Audit lanes:** opus family at **medium** effort. This is Emilio's explicit pin for this program; it overrides the xhigh subagent default and the rule that routes investigation to gemini. Launch: `claude --model opus --effort medium --permission-mode auto`, seat chosen by the quota gate. Confirm on the live process that the model resolves to the lock snapshot's Opus id and the effort reads medium; record both in `LANES.md`.
- **Verify:** muse family on its verify launch form (read-only, `--disable-write`, `--disable-web-tools`); capture its JSON output into `verdicts/`.
- **Plan check:** grok family on its review launch form (read-only).
- **Budget:** eight audit lanes plus the orchestrator is nine live terminals. Verify and plan-check lanes start after the audit lanes exit. Apply the global quota rule; at a wall, checkpoint and ask Emilio for the next rung from the program's `fleet.md`.

## Boundaries

This is a read-only audit. Lanes read code, run focused test files, start local servers on loopback against fixtures, and curl `127.0.0.1`. Each lane writes only its own report.

Hard limits (these hold even when a proof needs them — mark the claim `INFERRED` and write the exact command Emilio would run):
- No paid or external calls: no real discovery run, SerpApi, Gemini, Browser Use Cloud, or provider API key in use.
- No writes to any real Google Sheet, no OAuth sign-in, no Telegram send.
- No execution of Hermes apply, submit, filler or gate scripts; lane H audits them statically.
- No launchd, systemd, Tailscale, Cloudflare or DNS changes; no edits under `~/.hermes` or `~/.jobbored`.
- Secrets are reported by path and presence only: `.env`, `server/.env`, `~/.jobbored/**/.env`, `integrations/browser-use-discovery/service-account-key.json`, `~/.hermes/google_token.json`.
- No push, PR or deploy. Commits stay local on `chore/beaudit-20260925`.

## Phase 0 — ground (orchestrator, inline)

1. Pin the SHA: `git fetch origin && git rev-parse origin/main` (it was `f227fbb` when this prompt was written; use the fresh value everywhere below). Create `~/Job-Bored.worktrees/beaudit-integration` on `chore/beaudit-20260925` from it, and one detached worktree per lane at `~/Job-Bored.worktrees/beaudit-<L>`. Symlink `node_modules` and `server/node_modules` from the main checkout into each one.
2. Run the baseline floor in the integration worktree and paste the counts into `LANES.md`: `npm run lint:repo`, `npm run typecheck:repo`, `npm test`, `npm run test:browser-use-discovery`, `npm run test:contract:all`. A red baseline becomes finding `Z1`.
3. Sweep in-flight work: `gh pr list --state open`, then `gh pr diff <n> --name-only` for each PR, plus the live cmux workspaces. Write an "In flight" table in `LANES.md` mapping each PR that touches backend paths to lane letters. At writing time that includes #102 discovery hardening, #104 greenfield, #107–#111 and #113 discovery fixes, #112 scribe empty-draft guard, and #121 dotenv major.
4. Read `docs/audits/2026-08-31-luna-swarms/CRITICAL-AUDIT.md`, `FEATURE-WISHLIST.md` and `TECH_DEBT_REPORT.md` (April; lower weight). Write `PRIOR-CLAIMS.md`: one row per backend claim, assigned to a lane letter.
5. Copy `models.lock.json` and `fleet.md` into the program folder and run the quota gate.
6. Write `KICKOFF-BEAUDIT-_SHARED.md` from §Shared rules and one `KICKOFF-BEAUDIT-<L>.md` per lane from §Lanes. Each kickoff carries the lane's fence, its seed questions, its `PRIOR-CLAIMS.md` rows, its in-flight PRs, and its probe port range.

## Lanes

Seeds are starting questions; each lane follows the evidence past them. Paths are relative to the repo root; `W/` means `integrations/browser-use-discovery/src/`.

| L | Lane | Fence | Seed questions |
|---|---|---|---|
| A | Ingress and run lifecycle | `W/server.ts`, `W/webhook/*`, `W/http/*`, `W/state/run-status-store.ts`, `W/run/run-abort.ts`, `W/run/run-progress.ts`, `W/contracts.ts`, `schemas/*`, `examples/*`, `AGENT_CONTRACT.md` | Does the order invariant (method → secret → parse → token strip → preflight → first side effect → run) hold on `/webhook`, `/discovery`, `/discovery-profile`, `/ingest-url`, `/cleanup-expired`, `/pipeline-update` and `/runs/:id`? What does a retried POST do? Which runs never reach a terminal state? Where do the schema and the code disagree? |
| B | Discovery engine | `W/run/run-discovery.ts`, `frontier-scorer.ts`, `budget-tracker.ts`, `retry-broadening.ts`, `W/discovery/*`, `W/grounding/grounded-search.ts`, `W/match/*`, `W/normalize/*`, `W/ai/chat-provider.ts`, `W/state/discovery-memory-store.ts`, `listing-score-cache.ts`, `run-discovery-memory-store.ts` | Where does a run spend tokens and wall time? What does the memory store learn, and what reads it back? Why do runs end as zero-lead partials? Where are the seams inside the 4,381-line `grounded-search.ts` and the 3,014-line run loop? |
| C | Sources and ATS providers | `W/browser/**`, `W/sources/**`, `W/net/safe-fetch.ts`, `server/shared/job-scraper-core.mjs`, `server/shared/ats-job-fetchers.mjs`, `server/shared/gemini-url-context-scrape.mjs`; reads `W/discovery/career-surface-resolver.ts` alongside B | Map the two fetch layers (`server/shared` and the worker's `sources`) and name the one to keep. Which of the 17 providers have fixture-backed tests? Does every outbound fetch go through the SSRF guard? Do job boards stay hint-only? |
| D | Sheets persistence and data integrity | `W/sheets/*`, `W/cleanup/expired-job-cleanup.ts`, `W/webhook/handle-pipeline-update.ts` (shared read with A), `integrations/apps-script/Code.gs`, `schemas/pipeline-row.v1.json`, `scripts/run-scheduled-expired-cleanup.mjs`; reads `sheets-writeback.js` for comparison | Does dedupe-by-URL hold under two concurrent runs? What happens to header drift and user-edited columns? How many Sheets API calls does one run make, and against which quota? How does a half-written batch recover? Where do the worker, Apps Script and browser stage writers diverge? |
| E | Scraper/ATS API and AI provider layer | `server/index.mjs` (`/health`, `/api/scrape-job`, `/api/ats-scorecard`, `/api/llm-config`, `/api/brand-logos*`), `server/ats-scorecard.mjs`, `ats-request-payload.mjs`, `llm-config.mjs`, `model-family.mjs`, `brand-logos.mjs`, `security-boundaries.mjs`, `server/Dockerfile`, `render.yaml` | How many AI-provider abstractions exist (server `llm-config`, worker `chat-provider`, browser `callConfiguredAi`), and what would one look like? Does every route return `{ error, code, detail, nextStep, retryable }`? Do the CORS and origin rules match hosted mode? |
| F | Profile and materials pipeline | `server/user-profile.mjs`, `profile-from-resume.mjs`, `profile-rescore-worker.mjs`, `legacy-profile-migrator.mjs`, `application-materials.mjs`, `materials-*.mjs` (routes `/profile*`, `/api/applications/*`), `W/profile/*`, `W/contracts/user-profile.*`, Hermes `scripts/materials_watcher/*`, `materials_request.py`, `logo_resolver.py` | Is there one profile source of truth? What does the drafter → critic → repair loop cost per application, and how does it fail ("Missing required output(s)", empty drafts)? What happens when two rescores overlap? |
| G | Local ops, transport and deploy | `dev-server.mjs` (static serving, `/__proxy/*`, profile proxy), `scripts/*.mjs`, `scripts/lib/*`, `templates/**`, `integrations/cloudflare-relay-template/**`, `start.sh`, `start.command` | Re-verify SEC-01 (path traversal, bind address). Which `/__proxy` mutation routes accept a cross-origin request? Does the worker respawn when `:8644` dies? How do `~/.jobbored/**/.env` and repo `.env` precedence and the Hermes `:8644/:8645` collision surface to a new user? What breaks on Windows and Linux? |
| H | Apply and follow-up automation | `integrations/hermes-job-hunt/scripts/**` except the materials files in F, `approval-contract.v1.json`, `approval-guard-spec.md`, `kanban-task-conventions.md` | Does an approval gate stand in front of every submit path? How robust is each ATS filler? Where does follow-up state live? Which scripts are live, and which are dead? How does the Python side handle secrets? |

Probe ports: lane position `n` (A=1 … H=8) uses `181n0`–`181n9`. Ports 8080, 3847, 8644 and 8645 belong to Emilio's running stack; read them, leave them running.

## Audit lenses (every lane walks all eight)

1. **Inventory:** list each entrypoint, store, external call and background job in the fence, with `path:line`, its caller, what it writes, and its test.
2. **Correctness:** trace the happy path and the top three failure paths end to end. Check idempotency, timeouts, and the structured error shape.
3. **Trust boundary:** check auth, origin guard, secret handling, SSRF, path traversal, token stripping, body limits.
4. **Reliability:** check restart behavior, stuck runs, partial writes, rate limits, and whether the logs let a new user diagnose the failure.
5. **Performance and cost:** count Sheets, LLM, SerpApi and fetch calls per operation; find missing caches and oversized payloads; estimate tokens per run.
6. **Simplify:** name every concern implemented in two or more of browser, `dev-server`, `server/`, worker, Hermes and Apps Script, citing both sites. Flag dead code and 1,000-line files that hide seams.
7. **Tests:** name each claim with no test, and each test that pins implementation instead of behavior.
8. **Features:** propose two to four backend-enabled features the fence makes cheap. Tie each to a job-hunter moment (find, triage, apply, follow up, close). Where `FEATURE-WISHLIST.md` has the idea, extend it by its name.

## Findings schema

One row per root cause. Illustrative shape, not a known finding:

| ID | Kind | Sev | Status | Claim | Evidence | Fix / proposal | Contract | Effort | Build |
|---|---|---|---|---|---|---|---|---|---|
| A3 | DEFECT | P1 | CONFIRMED | A retried `POST /discovery` with an identical body starts a second run | `W/webhook/handle-discovery-webhook.ts:412`; probe `A3-retry` | Return the existing run for a repeated idempotency key | none | M | sol |

- **Kind:** DEFECT · OPTIMIZE · SIMPLIFY · TEST-GAP · FEATURE.
- **Sev:** P0 secret exposure, data loss or security hole · P1 broken user path or silently wrong result · P2 degraded or costly · P3 polish. FEATURE rows use Value H/M/L.
- **Status:** CONFIRMED (you ran it; output in report §4) · INFERRED (read, not run; the proving command in §5) · IN-FLIGHT #pr · PRIOR-FIXED sha · PRIOR-OPEN prior-id.
- **Evidence:** `path:line` at the pinned SHA plus the probe name.
- **Effort:** S up to half a day · M one to two days · L more than two days.
- **Build:** sol for backend · opus for a frontend surface · gemini for bulk edits or docs.
- **Contract:** `none`, or the schema, fixtures, docs and code that must change together.

## Lane report

First action: create `.lane-evidence/LANE-REPORT-<L>.md`, first line `PENDING`, with five headings each `PENDING`:

1. **Mission and fence**
2. **Inventory:** the lens 1 table
3. **Findings:** schema rows ranked by severity, then the prior-claim ledger for this lane, then the lane's top three so-whats
4. **Probes and floor:** pasted command output for every CONFIRMED row and every focused test file run
5. **Unverified:** every INFERRED row with the command that would prove it, plus anything the boundaries blocked

Update by writing a temp file and renaming it. Keep the register to the 25 strongest rows. Retire at about 60% context: write the report, then stop. The final first line is `DONE` or `BLOCKED: <why>`.

## Shared rules (copy into `KICKOFF-BEAUDIT-_SHARED.md`)

- Cite `path:line` at the pinned SHA; `main` keeps moving under you.
- Run root tests with `npm test -- <file>`. It runs `scripts/run-tests.mjs`, which includes `tests/integration/`; bare `node --test tests/*.test.mjs` skips that directory without saying so.
- Run worker tests with `node --experimental-strip-types --test <file>`.
- `:8080` serves the dashboard with no API. The API is on `:3847`, and `dev-server` proxies `/profile*` to it.
- A worktree without the `node_modules` symlinks fails on import, which hides the claim under test. Check the symlinks before the first probe.
- `~/.jobbored/browser-use-discovery/.env` shadows the repo `.env`. Record which file a value came from, by path only.
- Tag a finding already fixed by an open PR as `IN-FLIGHT #n` and give that PR's approach one line.
- Write in plain text. Every row stands on its own, with no "see above".

## Phase 2 — verify (muse)

For each finished lane, run muse against that lane's worktree and report. It re-runs every P0 and P1 reproducer and every CONFIRMED command, and returns REPRODUCED, NOT-REPRODUCED or UNCLEAR with output. Save it as `verdicts/VERDICT-<L>.json`. Downgrade NOT-REPRODUCED rows to INFERRED, and cut them if the evidence was the reproducer alone.

## Phase 3 — synthesize (orchestrator)

1. **`INVENTORY.md`:** merge the lane tables and add one system diagram covering browser → dev-server `:8080` → server `:3847` → worker `:8644` → Sheets, Gemini, SerpApi, Browser Use, ATS hosts, Hermes, and the relays.
2. **`REGISTER.md`:** dedupe by root cause across lanes (merge rows, keep every piece of evidence) and rank.
3. **Cross-cutting pass:** turn the lens 6 duplication rows into shared-substrate proposals, each naming the single funnel it creates and the call sites that move onto it.
4. **`SPEC-BEAUDIT-20260925.md`**, with these sections in this order:
   - §0 Locked decisions (empty until Emilio answers)
   - §1 So-what: five bullets, bad news included
   - §2 Inventory snapshot: at most 15 rows, linking to `INVENTORY.md`
   - §3 Prior-audit ledger: counts, plus every row still open
   - §4 Fix now: P0 and P1 defects with ID, claim, evidence, fix, effort
   - §5 Optimize: reliability, cost, performance, simplification, each with its measured or estimated delta
   - §6 Add: backend-enabled features ranked by job-hunter value ÷ effort, each with value, API sketch, data or schema change, frontend surface, effort
   - §7 Target architecture: what moves, merges or splits, and any contract version bumps
   - §8 Build program: lanes with fences, claim-id letters, family (sol builds backend, opus builds frontend surfaces, gemini takes bulk edits and docs, muse verifies), serial substrate first, floor per lane
   - §9 Decisions for Emilio: options for each, recommended option first
5. **`MOCKUP.html`:** load the `artifact-design` skill first, then build one self-contained file with five tabs:
   - **Now → Next:** inline-SVG architecture before and after, changed nodes highlighted
   - **Fixes:** a card per P0/P1: symptom → root cause (`path:line`) → fix → the test that proves it
   - **Contracts:** before/after request and response JSON for every changed or new endpoint, with schema versions
   - **Features:** per feature, a value line, a sequence diagram, the API sketch, and a static mock of where it appears in the app, styled from `tokens-v2.css` variables so it reads as JobBored
   - **Roadmap:** §8 lanes with dependencies and effort

   Support light and dark themes and phone width. Publish it as a private Artifact.

## Phase 4 — plan check (grok)

Give grok the spec, the register and the mockup. Ask it to check contract changes against the `AGENTS.md` contract invariants, find missing edges, find §8 fences that collide, flag features that are really frontend work, and challenge the estimates. Fold its findings in, and log what changed in `LANES.md`.

## Phase 5 — decide and stop

1. Put §9 to Emilio with the interactive question tool, at most four per call, recommended option first. Append his answers to §0.
2. Copy reports into `reports/`, then sweep the lane worktrees per `orchestrate` §6.
3. Commit the program folder on `chore/beaudit-20260925`, locally.
4. Report to Emilio, in this order: the Artifact link; the five so-whats; finding counts by kind, severity and status; the model-mix table (lane · family · locked id · effort · bucket used%); quota spent; everything left unverified.
