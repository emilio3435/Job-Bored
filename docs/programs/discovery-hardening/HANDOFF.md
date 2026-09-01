# Discovery hardening — final handoff (Fable 5.1, 2026-09-01)

**Outcome.** All five claims are met on the local integration branch, verified by the orchestrator, adversarially reviewed by an Opus QA lane, and repaired where QA found holes. Nothing was pushed. See `INTEGRATION-LOG.md` for every SHA, gate, and process check; `reports/` for the ten lane reports; `PROGRAM-SPEC.md` for the eight locked decisions.

## Branch

| | |
|---|---|
| Integration branch | `feat/discovery-hardening` at `/private/tmp/Job-Bored-discovery-hardening-integration` |
| Base SHA | `81e313a` (main, 2026-09-01 morning) |
| Lock SHA (spec + kickoffs) | `d57fdac` |
| Final HEAD | `d13a82a` (last product change `a523663`; `0b1916b`/`d13a82a` are docs) |
| Lane commits | `872445e` A · `129d0be` B · `88e156b` C · `dfbad73` D · `f35074f` E · `a7dcc4c` integrator · `0d595b2` repair D · `852eea6` repair E · `9a5fed2` repair A · `64490f2` repair C |
| Merge commits (in order) | `d6b9799` `f92b3b8` `66bebe2` `70b966d` `76e04c5` · `d141564` `2726e6c` `bd19594` `a523663` |
| Diff vs base (non-docs) | 22 files, +4377 / −21 |

## Files changed, by claim

| Claim | Lane | Files |
|---|---|---|
| ASSET-1 | A + repair A | `scripts/assemble-index.mjs`, `.github/workflows/pages.yml`, `tests/pages-deploy-contract.test.mjs`; integrator: `.gitignore` (`index.assembled.html`) |
| SCRAPE-E2E-1 | B | `tests/e2e-fixtures/hermetic-harness.mjs`, `tests/e2e-fixtures/scrape-job-fixtures.mjs` (new), `tests/e2e-fixtures/job-posting-json-ld.html` (new), `tests/e2e-journey/critical-journey.spec.mjs` |
| LIFECYCLE-1 (worker) | C + repair C | `integrations/browser-use-discovery/src/webhook/handle-discovery-webhook.ts`, `tests/webhook/lifecycle-idempotency.test.ts` (new), `tests/webhook/handle-discovery-webhook.test.ts` (+11), root `tests/discovery-lifecycle.test.mjs` (new) |
| LIFECYCLE-1 (poller) + STABLE-1 | D + repair D | `discovery-status-handoff.js`, `discovery-run-tracker.js`, `tests/discovery-stable-transport.test.mjs` (new), `tests/discovery-lifecycle-poller.test.mjs` (new); integrator: `package.json` (`node --check discovery-run-tracker.js`) |
| CANARY-1 | E + repair E | `scripts/discovery-canary.mjs` (new), `tests/discovery-canary.test.mjs` (new), `docs/DISCOVERY-CANARY.md` (new), `package.json` (`discovery:canary` + typecheck entry), `integrations/browser-use-discovery/src/state/run-status-store.ts` (+`listRunStatusSnapshots`), `tests/state/run-status-store.test.ts` (+3) |

## RED → GREEN

| Claim | RED on base (scout probe, verbatim core) | GREEN on final HEAD |
|---|---|---|
| ASSET-1 | `assembled index carries 153 asset references not tied to file content: jb-ui.js (expected v=ae4c643ea3) …`; hand `?v=N` stamps fail too | `--write` stamps 151 refs with sha256 content digests (2 font preloads exempt by design); `--verify-site _site` guard step in `pages.yml` names a drifted `app.js`; single-quoted and script/style-preload shapes now stamped and verified (repair A); `pages-deploy-contract` 18/18 |
| SCRAPE-E2E-1 | success path rendered `Scraped: Untitled`; 422 path `role="status"` — the harness's materials catch-all answered `/api/scrape-job` with a fake 200 | real `#dpScrapeBtn` click → `Scraped: Platform Engineer at Acme` (`role=status`); Wellfound company-index URL → production 422 `job_detail_url_required` rendered as summary / Why / Next / Details with `role=alert`, no internals leaked; journey 9/9 |
| LIFECYCLE-1 | `firstRunId=run_1 secondRunId=run_2 runDiscoveryCalls=2 discoveryRunsAppends=2` (two identical POSTs → two runs); 404/401 polls retried 3× then "may still be running" | byte-identical redelivery → same runId/statusPath, one run, one DiscoveryRuns row, one Pipeline write (19 tests); `status_path` accepted (5 tests); 404/401 settle the poll loop immediately with honest copy, loop-level test proven by mutation (repair D); worker 749/749 |
| STABLE-1 | Tailscale + healthy local worker + broken `tailscale serve` → `"ngrok tunnel is not running."` / `diag_fix_tunnel` | → `"Your local worker is running, but <host>.ts.net is not reachable …"` / `diag_fix_reverify`; ngrok users unchanged; 5-row hop matrix fully cited; `showDiscoveryVerificationToast` pinned (3 tests); six named tests 48/48 unchanged |
| CANARY-1 | `npm error Missing script: "discovery:canary"`; opening the run-status store deleted a `.tmp-` file | `npm run discovery:canary -- --max-age-hours 24 --json` → healthy 0 / stale 1 / unavailable 2 / misconfigured 3 / internal 4; read-only lister proven byte-for-byte non-mutating; `--bogus-flag` reports only `unknown_argument` (repair E); 24 tests |

## Gates (final HEAD `0b1916b`, all run by Fable)

pages-deploy-contract 18/18 · e2e-journey 9/9 · e2e-smoke 6/6 · worker 749/749 · contract:all green (no contract edits) · typecheck green · lint green · test:repo 2556 pass / 0 fail / 1 pre-existing todo · `npm test` 2587 pass / 0 fail / 0 skipped / 1 pre-existing todo · diff --check clean · canary six invocations with documented exit codes, 0 redaction hits. Nothing skipped; no environmental blocker. Test-count delta vs base: root +73 (`npm test` 2515 → 2588), worker +22, journey +2.

## Coverage matrix

| Path | Proof |
|---|---|
| Browser → local scraper (`POST /api/scrape-job`) | `critical-journey.spec.mjs` SCRAPE-E2E-1 ×2 (real click, hermetic fixture generated from `server/shared/job-scraper-core.mjs`) |
| Browser → worker dispatch ack (`statusPath` / `status_path`) | `tests/discovery-lifecycle.test.mjs` ×5 |
| Browser → worker status poll (retryable vs terminal) | `tests/discovery-lifecycle-poller.test.mjs` ×20 incl. the real loop |
| Worker webhook lifecycle + idempotency | `lifecycle-idempotency.test.ts` ×19 (+ pre-existing rows 1–12 cited in `reports/lifecycle.md`) |
| Transport hop attribution + secret toast | `tests/discovery-stable-transport.test.mjs` ×8 + six named tests |
| Deployed HTML ↔ assets | `tests/pages-deploy-contract.test.mjs` ×18 + `pages.yml` guard step |
| Operator health | `tests/discovery-canary.test.mjs` ×24 + CLI invocations |

## Canary

`npm run discovery:canary -- --max-age-hours 24 --json [--state-dir <dir>] [--worker-url <origin>]`. Statuses `healthy`/`stale`/`unavailable`/`misconfigured`; exit 0/1/2/3, 4 = internal error; precedence misconfigured > unavailable > stale > healthy. Sources: worker `/health` (auth-free) and the local run-state snapshot directory; Sheets never read. `empty` counts as a successful run (LD-7 — worth your eye). Sample (redacted by construction):

```
{"status":"healthy","reasons":["worker_healthy","successful_run_fresh"],"exitCode":0,
 "worker":{"checked":true,"healthUrlOrigin":"http://127.0.0.1:8644","reachable":true,"statusCode":200,"isDiscoveryWorker":true},
 "runHistory":{"checked":true,"available":true},"run":{"runId":"run_…","status":"completed","ageHours":2.01},
 "sheets":{"status":"unavailable","reason":"sheets_credential_not_available"}}
```

## Stable transport conclusion

**Repaired, one gap.** The secret handoff and Tailscale transport were already proven by eleven green files (see `SCOUT-worker.md` §STABLE-1). The one defect: `diagnoseDownstreamChain` inferred "uses a tunnel" from the mere presence of `localWebhookUrl`, which bootstrap writes for every local worker, so Tailscale users with a healthy worker were sent to fix ngrok. Fixed in `discovery-status-handoff.js`; all pre-existing honesty tests unchanged and green.

## QA findings and disposition

No BLOCKER. MAJOR-1 (untested loop branch, mutation-proven) → repair D, closed. MAJOR-2 (idempotency narrative claimed the re-click case) → repair C, narrative corrected and the limitation pinned by a test. MINOR-3 (failed-run redelivery acks `200 completed_sync`) → pinned as-is; a `kind:"duplicate"`/failed-ack shape would be a contract change — **your call**. MINOR-4 (parser blind spots) → repair A, closed. MINOR-6/7/8 (canary fabricated reasons, doc drift, untested exit 4) → repair E, closed. MINOR-5 (pre-existing journey flake at `critical-journey.spec.mjs:265`, seen once under load), MINOR-9 (old webhook suite pins runId via the `runDependencies.runId` seam per LD-3(e)), MINOR-11 (400/422/501 still retry 3×, deliberate fail-open), MINOR-12 (duplicate `.gitignore` line, pre-existing) → recorded. **MINOR-10** (drawer 422 appends a "Fallback:" sentence that is noise for this case; `role=alert` is set after the text so the first announcement is polite) is product copy outside every fence → **follow-up for you**.

## Decisions I locked that deserve your review (LD-1..LD-8 in PROGRAM-SPEC.md)

1. **LD-3 derived runIds.** Run identity is `sha256(sheetId + variationKey + requestedAt)`; runIds changed shape from `run_<uuid>` to `run_<hex32>`. Nothing parses the shape; ack schema unchanged. Catches relay/proxy redelivery, NOT a user double-click (fresh `requestedAt` per click). Closing the double-click case needs a client idempotency key on the request contract.
2. **LD-4 one owner for `discovery-status-handoff.js`** (Lane D took the poller classification unit). Unknown HTTP codes stay retryable.
3. **LD-7 canary semantics** — `empty` = success, exit-code table, Sheets never read.
4. **Integrator edits outside any fence:** `package.json` typecheck entry for `discovery-run-tracker.js` (a modified file the floor could not see) and `.gitignore` for `index.assembled.html`.

## Remaining risks / follow-ups

- First Pages deploy after merge re-downloads every asset once (all URLs change). Intended.
- The `pages.yml` guard is a hard gate: a dangling local `<script src>` now fails the build instead of 404ing. Intended; message names the tag.
- Docs `README.md:211,241`, `SETUP.md:150`, `docs/GITHUB-PAGES.md:9` still describe `--write` as include-expansion only; `--verify-site` is undocumented outside `assemble-index.mjs`. Doc-only follow-up.
- Runs started by an older worker keep `run_<uuid>` ids; a redelivery of one of those will not dedupe (one-time transitional gap).
- Canary trusts the default run-state dir; a custom `BROWSER_USE_DISCOVERY_RUN_STATE_DIR` needs `--state-dir`.
- MINOR-5 flake: watch `critical-journey.spec.mjs:265` in CI.

## Publication boundary

No push, PR, remote merge, deployment, secret change, schedule installation, Cloudflare, DNS, or Tailscale mutation occurred. Every commit is local to worktrees under `/private/tmp`. Your main checkout's unrelated changes (`logos.json` modification, untracked dossier docs/diagrams, the swarm prompt) were never touched.

## Cleanup inventory (awaiting your approval — nothing removed)

| Kind | Items |
|---|---|
| cmux workspaces | 192 scout-browser · 193 scout-worker · 194 assets · 195 scrape-e2e · 196 lifecycle · 197 stable-transport · 198 canary · 199 qa · 200 repair-assets · 201 repair-lifecycle · 202 repair-stable-transport · 203 repair-canary (all named `DH · …`) |
| worktrees | `/private/tmp/Job-Bored-discovery-hardening-{integration,assets,scrape-e2e,lifecycle,stable-transport,canary,qa}` |
| branches | `feat/discovery-hardening` (keep), `feat/discovery-hardening-{assets,scrape-e2e,lifecycle,stable-transport,canary,qa}` |
| stashes | none created by this program |

Suggested next step once you approve: `git worktree remove` the six lane worktrees and close workspaces 192–203; keep the integration worktree and branch until the PR lands; then delete lane branches.
