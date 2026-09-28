BLOCKED: floor red on one pre-existing, network-dependent test outside lane S's fence (VAL-ROUTE-010 in tests/webhook/routing-enforcement.test.ts); every lane S claim is done or deferred, and every other floor command is green

# BUILD-REPORT-S — BEAUDIT lane S (Sheets client)

Branch `feat/beaudit-w1-s`, based on `feat/beaudit-build-w1b` @ 4a09cf3d. Head 9f425854. Nothing pushed.

Goal: land D1–D10, D12, D13, D16–D20 and A8 with red-then-green tests.
Success means: each claim is fixed or deferred with a reason, and the floor is green under a fresh HOME.
Stop when: that holds, or a blocker I cannot clear remains.

## Claims done

| Claim | What changed | Test |
|---|---|---|
| D1 (+D8) | A per-Sheet mutex (`withSheetLock`) around every writer's read → write window. The writer re-reads column E before it appends and drops URLs another writer added. | pipeline-writer-integrity (p01 ×2), pipeline-patcher-integrity D8 (p09) |
| D2 | `resolveRowsByLink` re-reads each target row by Link right before the write; a moved row is found again, a vanished or duplicated one is skipped with a warning. Writes cover only changed cells. Worker writers: pipeline writer, patcher, cleanup. | writer p02 ×2, patcher "moved", cleanup "deleted" |
| D3 | Cleanup re-reads each row before writing; a row that is no longer New/Researching is skipped (`status_changed`); Notes come from the fresh row. | cleanup-integrity p03 |
| D4 | `discoveryMerge` per column in `schemas/pipeline-row.v1.json`. F, I, J, K, Q (and A, L, M, V, W, X) are fill-if-empty; H, E, T, U are overwrite; B, C, D, G stay under Edit Lock; N, O, P, R, S, Y are preserve. | writer p05 + fill-if-empty + changed-cells-only |
| D5 (+F5) | `escapeCellForUserEntered` in sheets-client (every USER_ENTERED write from the writer, patcher, cleanup and runs-legacy migration); rescore `writeRowScoreCells` escapes Fit Assessment and Talking Points. | writer p06 ×2, patcher, cleanup, profile-rescore-formula-escape |
| D6 | The patcher checks row 1 against the schema and throws `PipelineHeaderMismatchError`; the handler answers 409 `header_mismatch` with detail "Column F is 'Referral?'; expected 'Source'." | patcher p08, handler v2 |
| D7 | `pipeline-update` v2: Applied requires `appliedDate` and `source`; dates must be `YYYY-MM-DD` (v1 and v2). The TS port of `pipeline-transitions.js` (`src/sheets/pipeline-transitions.ts`) writes N, a +7d P and `[today] Applied via <source>: <note>`. v2 schema and example added; v1 is still accepted. | patcher p09 ×2, handler v2 ×3, test-pipeline-update-contract (6 rejections) |
| D9 | Cleanup checks four postings at a time, flushes every 25 rows under the lock, and skips rows with a `[JobBored YYYY-MM-DD]` stamp from the last 7 days. | cleanup p04, concurrency, recently_checked |
| D10 (worker half) | Cleanup and `/pipeline-update stage=Expired` share one cell set: M `Expired`, P cleared, O audit line. | cleanup D10, patcher D10 |
| D12 | The append runs even when the update phase fails; 429/5xx are retried with backoff; an append whose response is lost throws `SheetWriteError{phase:"append", uncertain:true}` with `partialResult`; the append retry re-reads E first, so it is idempotent by URL. | writer p12 ×3 |
| D13 | Only a 400 "Unable to parse range" creates the DiscoveryRuns tab. A legacy 9-column tab is migrated along with its rows (`discovery-runs-legacy.ts`). The edit to `discovery-runs-writer.ts` is additive: 15 lines and 2 guarded branches, for #107. | discovery-runs-writer-edges ×6 |
| A8 (+D16) | Token cache keyed by credential content (one exchange per credential until near expiry). `validateSheetsCredentialReadiness({cacheTtlMs})` is keyed by credential content and Sheet id; `/health` passes 60 s and the preflight stays live. | credential-cache ×4 |
| D17 | The writer snapshot reads `B2:F` and `W2:Y` via batchGet; full rows are fetched only for matched row numbers. | writer p11 |
| D18 (worker) | `src/sheets/sheets-client.ts`: token cache, mutex, Link re-resolution, transport with retry, escaping, header check. `pipeline-columns.generated.ts` is generated from the schema. The writer, patcher and cleanup use it, and the cleanup's private Sheets helpers are deleted. | pipeline-columns-contract |
| D19 | Worker `PIPELINE_HEADER_ROW`, the generated map and `pipeline-transitions.js` COLUMNS are bound to the schema; `scripts/test-pipeline-contract.mjs` fails when the generated file drifts. Probes p01–p06, p08–p12 are promoted onto `tests/sheets/fake-sheets.ts`. | pipeline-columns-contract ×4 |
| D20 | Apps Script stub: the `WEBHOOK_SECRET` property gates POSTs (`?secret=`, constant-time compare); test rows need the secret and are deduped by Link; the log carries only event + variationKey. | apps-script-stub-secret ×4 |

## Claims deferred

- **D2, browser and rescore halves:** the browser half (`sheets-writeback.js`, hours-old snapshot) goes to lane B. F16 (rescore row numbers, `server/profile-rescore-worker.mjs:1355`) goes to lane M. Both need their own row re-resolution in files owned by those lanes, and neither fix is small.
- **D6 and D10, browser halves:** `sheets-writeback.js` fixed letters and `markStatusExpired` writing only M. That file is lane B's fence (spec §8 wave 2), and the change routes the browser through `pipeline-transitions.js`.
- **D18 and D19, browser, Code.gs and ingest-url-flow column maps:** sharing the generated map with the browser is lane B/G work. `discovery-runs-writer.ts` keeps its own HTTP helpers until #107 lands, because a rewrite there waits on #107.
- **Salary (G) in D4:** it stays under Edit Lock, not fill-if-empty, because the existing Edit Lock tests pin "unlocked salary keeps improving" by design. The register's fix line lists I, J, K, Q, F only.

## Tests added (red on base 4a09cf3d, then green)

Red logs are in `.lane-evidence/red/`, run against a `git archive 4a09cf3d` snapshot:
- pipeline-writer-integrity: 12/13 red for the claimed reasons (duplicate row, Gamma overwritten, Source overwritten, unescaped `=HYPERLINK`, full `Pipeline!A2:Y` read, append skipped after a 503, TypeError not SheetWriteError). The fill-if-empty case passed on base, as expected.
- pipeline-patcher-integrity: 8/8 red.
- handle-pipeline-update-v2: 6 of 9 red. The date test was then widened to cover v1, which base accepts. The other two already held on base.
- expired-cleanup-integrity: 7/7 red.
- discovery-runs-writer-edges: 4/6 red (401/403/429 plus legacy). The 503 and missing-tab cases already held.
- credential-cache: 2/4 red. The two that held pin that the change does not cache the live path.
- pipeline-columns-contract: red (the generated map did not exist).
- apps-script-stub-secret: 4/4 red.
- profile-rescore-formula-escape: red on the assertion (`=IMPORTDATA` sent unescaped).

Green: every test named above passes in the floor run below (57 lane S tests).

Existing tests changed, each named in its commit body: `pipeline-writer.test.ts`, `pipeline-patcher.test.ts` and `expired-job-cleanup.test.ts` swap mocks that routed by encoded range string for the Sheets fake. The pinned behavior changed: a header check, batchGet, and changed-cell writes. VAL-DATA-002 now scripts four 500s because 5xx answers are retried.

## Floor output (fresh HOME per command, PLAYWRIGHT_BROWSERS_PATH set)

```
lint:repo                   EXIT 0   eslint clean; lint:tokens ok: 34 sheet(s), 0 new finding(s)
typecheck:repo              EXIT 0
npm test                    EXIT 0   ℹ tests 3740  ℹ pass 3732  ℹ fail 0  ℹ todo 8
test:browser-use-discovery  EXIT 1   ℹ tests 856   ℹ pass 855   ℹ fail 1
test:contract:all           EXIT 0   19 OK lines; pipeline-update v2 rejections OK
test:e2e-smoke              EXIT 0   24 passed
test:e2e-journey            EXIT 0   33 passed
test:e2e-onboarding         EXIT 0   7 passed
```

The single failure is `VAL-ROUTE-010: browser_only with empty companies uses modifier-driven grounded query` (12005 ms). It is pre-existing: `.lane-evidence/baseline-discovery.log` shows it failing on 4a09cf3d before any lane S change (804/805). It also fails alone. Confirmed: the test's grounded candidate goes through `grounded-search.ts` strict preflight, which does a real `fetch("https://example.com/senior-engineer")` with `PRE_FLIGHT_TIMEOUT_MS = 12_000`. In this network-restricted run it times out, so the result depends on live network (inferred). The file sits outside lane S's fence (routing/grounding), so I did not edit it.

## Fence leeway edits

- `integrations/browser-use-discovery/src/server.ts`: `cacheTtlMs: 60_000` on the one `/health` readiness call (A8), 2 lines.
- `server/profile-rescore-worker.mjs`: `escapeCellText` on Fit Assessment and Talking Points, and `writeRowScoreCells` exposed on `_internal` (D5/F5), about 10 lines. Lane M owns the file and is not running.
- `integrations/apps-script/Code.gs` and `integrations/apps-script/README.md`: D20.
- `docs/INTERFACE-DISCOVERY-RUNS.md`: one paragraph on D13 (the claim's contract doc).
- New tests outside the worker tree: `tests/apps-script-stub-secret.test.mjs`, `tests/profile-rescore-formula-escape.test.mjs`.

## Unverified

- The `/health` wiring (server.ts passing `cacheTtlMs`) is covered only by typecheck and reading; no server-level test drives `/health` with an injected fetch.
- Sheets `values:batchGet` and the escape behavior were checked against the in-memory fake, not live Google (no network allowed).
- api-error codes are lowercase (`header_mismatch`, `ambiguous_match`, as spec §7 writes them), but MOCKUP.html shows `HEADER_MISMATCH`. Once lane L lands `api-error.v1`, reconcile the case. The field names match the spec.
- Cross-process races (the browser or Hermes writing between the worker's re-read and its write) are narrowed to one request round-trip, not eliminated. The Sheets values API has no conditional write.
- No second-vendor review or Muse verification has run on this branch yet.
