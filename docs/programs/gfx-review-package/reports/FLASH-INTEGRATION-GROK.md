# Flash integration review

Verdict: PASS

Reviewed the staged merge in `/private/tmp/jobbored-review-package`: `HEAD` `062cad14`, staged `main` `5d5b9a59`. `git ls-files -u` is empty. No conflict markers. Reviewed `git diff main` for the named paths and `git diff --cached HEAD` for the auto-merged Flash consumers. No source edits, provider calls, or suites in this pass.

Observed session pins: `current_model_id` `grok-4.7-build-fast`, `reasoning_effort` `xhigh`.

## Materials writer

`callJsonStage` still sends the stage `systemPrompt` and `userText` and starts at that stage's `maxOutputTokens` (`server/materials-writer.mjs:777-793`, `tests/materials-writer.test.mjs:579-617`). Gemini narrow calls keep `responseMimeType: application/json`. A narrow chat call, including local, sends `response_format: json_object` because `userText` is set (`materials-writer.mjs:611-613`).

Retry stays two attempts. A truncation signal, or unterminated JSON with an empty finish, raises the next attempt to twice the stage cap and stops at 16,384 (`materials-writer.mjs:798-813`). The stage test locks 500 then 1,000. A Gemini `SAFETY` stop throws `writer_blocked` on the first attempt (`materials-writer.mjs:794-796`, test at `654-673`). Parseable output with a truncation signal is not accepted; the wide writer test still requires `writer_truncated` for that case. Wide OpenRouter and local calls stay plain JSON, which is the branch policy main did not have. v3 stages do not use that exception.

## Discovery run

Against `main`, `run-discovery.ts` differs by two edits. An empty ATS pool is `skipped` instead of `running` at 0 of 0 (`run-discovery.ts:828-833`). A nonempty pool stays `running`, then `done`. The grouping key uses `\u0000` where main has one literal NUL byte; `filteredNormalizedLeads` is absent on both sides.

Frontier selection still builds candidates only from `groundedScoutCache` (`run-discovery.ts:1384-1438`). ATS and SerpApi leads are not in that set. `frontier_filtering` is logged only inside that grounded block and records `bypassedLeadCount: normalizedLeads.length` (`1494-1500`).

`UXD-BE-1` keeps the bounded scout checks and now requires `listingsProcessed` 500, `listingsSeen` 500, no `frontier_filtering` event, `normalizedLeadCount` 500, `dedupedLeadCount` 1, `leadsToWriteCount` 1, and `leadsQualified` 500 on both the write and learn checkpoints (`run-discovery.test.ts:362-390`). `UXD-BE-4` requires the emptied ATS pool to stay `{ state: "skipped", done: 0, total: 0 }` through write and learn, with no detection call (`394-438`). The grounded timeout test still requires the retained lead's write checkpoint `leadsQualified` of 1.

## Auto-merged Flash consumers

`git diff main` on `discovery-drawer.js`, `oneflow-beat-ai.js`, `settings-modal.js`, `profile-from-resume.mjs`, `config.ts`, `profile-to-companies.ts`, and `grounded-search.ts` is the Flash wire rule: logical `gemini-flash`, wire `gemini-flash-latest`, and exact legacy `gemini-3.7-flash` included. `git diff --cached HEAD` on those files is main's other work: hosted `apiFetch`, snake_case profile error codes, `~/.jobbored/resume.txt` before the worker snapshot, and `slugifyCompanyKey` / shared `normalizeCompanyKey`. Neither side of those hunks was dropped.

## Unverified

Muse owns the floors. This pass did not re-run `tests/materials-writer.test.mjs` or `UXD-BE-1`. Sol's recorded 26/26 and 1/1 were not repeated here.

## Floor update

The desktop selftest miss was not a packaging bug in this tree. The verification snapshot left new `main` files untracked, and the selftest copies `git ls-files`. The candidate already tracks those modules. Desktop selftest is 2/2, and the host fixed the snapshot index. There is no packaging diff to review.

Eleven other failures were host bootstrap and worker path isolation against fixture paths. They cleared on a targeted rerun.

The remaining floor failure was `tests/fix-setup-endpoint.test.mjs:229`. Fixture verdict: PASS.

`git diff main` for that file is three added lines. The unhealthy-worker case now passes `resolveWorkerOwnership: async () => ({ foreign: false, repoRoot: "ours" })`. Without that callback, `killFullBootStalePorts` uses `defaultWorkerPortOwnership` (`dev-server.mjs:1474`), which probes live port 8644. A foreign `repoRoot` blocks the synthetic worker pid 200 and leaves only the ngrok pid 300, so `killedPids` is `[300]` instead of `[200, 300]`. With `repoRoot: "ours"`, `foreignByIdentity` and `foreignByCommand` are both false (`dev-server.mjs:1528-1531`), and the case still requires both kills and an empty `blocked` list (`tests/fix-setup-endpoint.test.mjs:259-262`).

`git diff main -- dev-server.mjs` and `tests/dev-server-foreign-checkout.test.mjs` are empty. The separate foreign-checkout guards still supply their own ownership doubles. One focused run of this case passed 1/1. The host reports the file at 26/26. No production source changed.
