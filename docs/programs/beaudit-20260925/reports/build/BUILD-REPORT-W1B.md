## BEAUDIT wave 1 (part 2): Sheets client, lifecycle and contracts, relay retirement

This PR finishes wave 1 of the 2026-09-25 backend audit build. It lands lanes S (Sheets client) and L (Lifecycle and contracts), plus lane Y (relay retirement), which Emilio added on 2026-09-25. It closes the P1 rows D1, D2, D4, D5 and D6 and the P2/P3 rows these lanes own. Part 1 (H and Q) shipped in #124.

Branch `feat/beaudit-build-w1b` was cut from main at 4a09cf3d, the merge of #124. Main was merged in again at 0fbe69ff before any lane landed; that brought in #107, #112, #105 and #120. Every build lane ran on Opus 5.5 at medium effort, and Muse (Spark 1.3) verified each one. Lane Y's diff was reviewed by astra-ro. Codex then hit its usage limit (it resets on Sep 29) and grok returned 402, so Gemini reviewed L and S instead, on Emilio's call (DECISIONS D9). The orchestrator merged a lane only after its merged tree passed the full floor, all three e2e suites and gitleaks.

| Merge | Lane | Claims | Muse | Review | Repair rounds |
|---|---|---|---|---|---|
| 98836c66 | Y, Relay path retirement (D4) | RGHA | FIXED at 17e74660 | astra-ro: no blocking | 2 |
| 10c18dc1 | L, Lifecycle and contracts | A2, A3, A4, A5, A7, A9, A12, A13, A14, A15, A16, A17, A18, A20, A21, E7 | all FIXED at 2d02ec97 | Gemini: no blocking | 2 |
| 826ecb55 | S, Sheets client | D1–D10, D12, D13, D16–D20, A8 | all 18 FIXED at acb4f9ec | Gemini: no blocking | 0 |

### What changed

- **S, Sheets client.** The worker's pipeline writer, patcher and expired-job cleanup now share one `src/sheets/sheets-client.ts`:
  - The Google token is cached, so a run exchanges it about once instead of three times.
  - Writes to a Sheet go through a mutex, one at a time.
  - Each write finds its row again by Link just before writing.
  - The column map is generated from `schemas/pipeline-row.v1.json`.

  Rediscovery fills only empty user columns, and it writes only the cells it changes. Cell text is escaped against formula injection. A header that doesn't match answers 409 `header_mismatch`. A failed or uncertain append raises a `SheetWriteError`, and the retry is safe to run. Cleanup flushes its writes every 25 rows.

  **pipeline-update moves to v2:** Applied needs `appliedDate` and `source`, and a match that could be more than one row answers 409 `ambiguous_match`. v1 senders are still accepted. In the Apps Script stub (D20), the discovery secret is checked before anything runs.
- **L, Lifecycle and contracts.**
  - **Error envelope:** every worker error, and every local-API response at 400 or above, now carries `api-error.v1`: `{error, code, detail, nextStep, retryable}`.
  - **Webhook v1.1:** an optional `idempotencyKey`. A retried request with the same key resolves to the original run instead of starting a second one.
  - **Cancel route:** `POST /runs/:id/cancel` aborts the run and waits up to 15 s for it and any Sheet write in progress to settle. It then reports `cancelled` and `stopConfirmed` truthfully. If it cannot save the cancelled status, it answers 503 `cancel_status_not_saved`.
  - **New v1 schemas:** `run-status`, `ingest-url` and `cleanup-expired`.
  - **Async lifecycle:** one lifecycle for async discovery and ingest. Boot recovery writes a history row for runs a restart abandoned. Old run snapshots are pruned when the worker starts.
- **Y, Relay retirement.** A GitHub Actions workflow can no longer point at the Cloudflare relay:
  - It stops before posting when the webhook URL is a JobBored relay worker on workers.dev.
  - A relay under another name is caught by its relay-auth 401.
  - Either way the job prints a migration note instead of failing silently.

  An Apps Script 302 is followed with GET. The template, the repo workflow and the workflow Settings generates stay identical. Settings and the wizard no longer offer the relay as a target.
- **Orchestrator: VAL-ROUTE-010.** This test sent strict preflight to example.com over the live network, and it failed on main offline (804/805). It now uses a local stub. Lane Y's stub (be8087c3) is the one kept. The orchestrator's duplicate (8a11ff60, cherry-picked to S as acb4f9ec) was dropped at each merge, because the two declared `originalFetch` twice.

### Deferred (not P0; D2, D4 and D6 are P1 residuals)

- **Browser halves of D2, D6, D10, D18 and D19:** `sheets-writeback.js` and the shared column map in the browser, `Code.gs` and `ingest-url-flow.js` go to lane B.
- **F16:** the rescore row numbers in `server/profile-rescore-worker.mjs` go to lane M.
- **D4:** the salary column (G) stays under Edit Lock and is not fill-if-empty, by design.
- **discovery-runs-writer.ts:** it keeps its own HTTP helpers. Moving it onto sheets-client is follow-up work.
- **A14:** tsconfig does not cover `tests/**`.
- **A20:** the dashboard does not stamp an `idempotencyKey` yet.
- **A16:** the config write lock is in-process only.
- **E7:** error text inside the lane M and S fences is unchanged.

### Review notes (non-blocking)

- **L (Gemini):**
  - Boot recovery counts an `append` that resolved `{ok:false}` as written (`webhook/boot-recovery.ts:70`).
  - Runs that use a request-scoped Google token have a fixed 50-minute cap and never check the token's remaining TTL (`handle-discovery-webhook.ts:461`).
  - The schema does not enforce that `sourcePreset` and `enabledSources` are exclusive.
- **S (Gemini):**
  - An append that lands and then returns a retryable error is counted as `skippedDuplicates`, not `appended` (`pipeline-writer.ts:656`).
  - A row patched by company and title, with no Link, keeps its snapshot row number. The mutex covers writes from inside the process, but not rows someone inserts in the Sheet by hand.
- **Error-code casing:** lane S emits lowercase codes (`header_mismatch`, `ambiguous_match`, as spec §7 writes them). Lane L's router emits uppercase ones (`NOT_FOUND`). They should agree before any client matches on `code`.

### Evidence: floor on the merged tree (826ecb55)

Every command ran with `HOME` set to a fresh temp dir and `PLAYWRIGHT_BROWSERS_PATH` pointed at the real cache:

```
npm run lint:repo                   exit 0
npm run typecheck:repo              exit 0
npm test                            tests 3826, pass 3816, fail 0, todo 10
npm run test:browser-use-discovery  tests 929, pass 929, fail 0
npm run test:contract:all           exit 0
npm run test:e2e-smoke              24 passed
npm run test:e2e-journey            33 passed
npm run test:e2e-onboarding         7 passed
gitleaks detect (origin/main..HEAD) no leaks found
```

Evidence files, all under `docs/programs/beaudit-20260925/`:
- Muse verdicts: `verdicts/BUILD-VERDICT-S-r0.json`, `BUILD-VERDICT-L-r{0,1,2}.json`, `BUILD-VERDICT-Y-r{0,1,2}.json`
- Reviews: `verdicts/REVIEW-{S,L,Y}.json`
- Lane reports: `reports/build/BUILD-REPORT-{S,L,Y}.md`
- Decisions: `DECISIONS.md` D2–D9

### Unverified

- No live Google Sheets, Telegram, Cloudflare or GitHub Actions call was made. Sheets behavior was checked against the in-memory fake, and the workflow script ran under bash with a fake `curl`.
- The `/health` credential cache (A8) is covered only by typecheck and reading; no server-level test drives it.
- L and S had one second-vendor review, from Gemini. astra-ro and grok could not run.
