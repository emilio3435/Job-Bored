# REVIEW-GROK-final

Status: PASS

Goal: final independent re-review of the corrected combined package.

Scope: writer correction `bb1ec7d4` (`3c9d3908..HEAD`, `server/materials-writer.mjs` and `tests/materials-writer.test.mjs` only) plus the uncommitted worker diff in `integrations/browser-use-discovery/src/run/run-discovery.ts` and `integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts`. Initial findings stay in `.lane-evidence/REVIEW-GROK-initial.md`. This file does not edit them.

PASS applies to that combined tree. Findings 2 and 3 are in the uncommitted worker diff, not in `bb1ec7d4` alone.

## Model and effort

Session `227291a6-33be-43e4-9481-df096a6fbbac`, `summary.json`: `current_model_id` `grok-4.7-build-fast`, `reasoning_effort` `xhigh`. Capacity was not exhausted. No live API call, no source edit, no child agent.

## Original findings

### 1. High — empty Gemini `responseSchema` objects. Resolved.

`WRITER_RESPONSE_SCHEMA` is gone. `generateGemini` sends `responseMimeType: "application/json"` and does not set `responseSchema`.

```511:515:server/materials-writer.mjs
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
```

The only remaining `responseSchema` string in that file is the comment at line 507. Editor and writer share `callWithRetry` → `generateGemini`, so both requests omit the schema. Nested letter and resume fields are no longer constrained by an empty OBJECT node. The freeze-facts sentence is still in the system prompt; the existing Gemini post test still matches `Freeze employers, titles, dates, and metrics`.

The new round-trip fixture is fictional (`Example Systems`, `candidate@example.com`, synthetic dates). It proves the parser keeps those fields. It does not prove a live model emits them. JSON mode without a schema is a mime-type hint; shape still depends on the prompt and `parseWriterJson`.

### 2. Medium — empty ATS pool left "Company job boards" running. Resolved in the uncommitted worker diff.

When the filtered ATS list is empty, the only pre-loop publish is `skipped`, not `running`.

```741:746:integrations/browser-use-discovery/src/run/run-discovery.ts
    progressSources.set("ats", {
      id: "ats",
      state: atsCompaniesToSearch.length === 0 ? "skipped" : "running",
      done: 0,
      total: atsCompaniesToSearch.length,
    });
```

The `done` update is still inside the company loop's `finally` (`934–941`). An empty list never enters that loop, so nothing writes `running` back. A non-empty list still starts `running` and finishes `done` or `running` from that `finally`.

`UXD-BE-4` blocks `Acme`, asserts zero board-detection calls, and requires the write and learn checkpoints to carry `{ id: "ats", state: "skipped", done: 0, total: 0 }` with both company counters at 0. That test passed.

The card copies `state` onto `data-state`. Skipped lanes use the quiet ink (`css/runs-log.css` 598–600). `runLaneText` still prints `0 of 0` whenever `total` is present, including for `skipped`, so the value text is not the word "Skipped". The lane is not the old running state.

### 3. Medium — "Leads kept" ignored frontier drops. Resolved in the uncommitted worker diff.

After exploit selection replaces `normalizedLeads`, the counter is set to that retained length and published on the exploit checkpoint.

```1334:1338:integrations/browser-use-discovery/src/run/run-discovery.ts
    normalizedLeads.length = 0;
    normalizedLeads.push(...filteredNormalizedLeads);
    progressCounters.leadsQualified = normalizedLeads.length;
    checkpointRunProgress("exploit");
```

Grounded exploit results are added afterward (`1388–1392`), which matches the original allowance that grounded adds may increment the count. `UXD-BE-1` passed: 500 matcher-accepted listings, frontier keeps 18 (`maxExploitSurfaces`), and the write and learn checkpoints both report `leadsQualified` 18. The recovered-grounded test passed with write-checkpoint `leadsQualified` 1 and `writeResult.appended` 1.

Scout checkpoints can still show the pre-filter count while matching is in progress. The save and learn checkpoints no longer do.

### 4. Low — blocked stops dropped; thought parts concatenated. Resolved. `MAX_TOKENS` drop is intended.

`blockedSignal` fail-fast throws `writer_blocked` with `finishReason` for `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, and `MALFORMED_RESPONSE` (`server/materials-writer.mjs` 298–329 and 677–679). That throw leaves the retry loop, so those stops use one attempt.

Answer text skips parts with `thought === true` (`394–402`).

A body that parses is still rejected when `finishReason` is `MAX_TOKENS` (`681–683`, before `parseWriterJson`). That is the assigned rule: parseable JSON does not prove the expected draft is complete. The new test `still rejects a parseable body stopped at MAX_TOKENS` passed.

Truncation bounds are unchanged: two attempts, 8192 then 16384 on a truncation signal or unterminated JSON with an empty finish. OpenAI `length`, Anthropic `max_tokens`, plain JSON for OpenRouter and local, and the one unterminated escalation all still pass.

## Regressions checked

- Writer commit touches only the two files above. `git diff 3c9d3908..HEAD --stat` is 72 lines in the writer and 179 in its test.
- Worker diff is the two discovery files above (source +9/−1 net in `run-discovery.ts`, tests +77).
- Non-empty ATS pools still use `running`. The empty branch is the `length === 0` ternary only.
- `leadsQualified` is not left at the matcher total through write. `UXD-BE-1` locks 18 against a 500-accept scout.
- New writer fixture uses example.com and synthetic dates. New worker listings use `jobs.example.com` and `Acme`. The thought-part test reuses the pre-existing `valid` object (`EAB`, `audacy-dsm`); that object was not introduced by this correction.

## Checked, not reopened

`UXD-BE-1`'s stored config sets `maxLeadsPerRun` to 5, and `selectLeadsForWrite` (`run-discovery.ts` 1456–1479) caps the sheet write after the counter update. The write checkpoint can therefore show 18 while the writer receives 5. The contract still defines `leadsQualified` as normalized accepted leads before Sheet dedupe (`AGENT_CONTRACT.md` line 172). The new test requires the saving checkpoint to equal the frontier retained count, not the capped write count. That is the assigned finding-3 fix, not a missed frontier drop.

HTTP error text is still `Gemini HTTP <status>` without the response body (`throwIfHttpError`, `453–457`). The invalid schema that made a 400 the expected Gemini failure is gone. This was not part of the returned findings.

## Proof

| Check | Result |
| --- | --- |
| `node --test tests/materials-writer.test.mjs` | 20 pass, 0 fail, 57.5 ms. Includes the new schema, nested-facts, blocked-stop, thought-part, and `MAX_TOKENS` tests. Mocked fetch. |
| `node --experimental-strip-types --test --test-name-pattern 'UXD-BE-1:\|UXD-BE-4:\|recovered grounded regex' integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts` | 3 pass, 0 fail, 265 ms. |
| Live Gemini or other provider | Not called. |
| Host floors (`lint:repo`, `typecheck:repo`, `npm test`, `test:repo`, visual) | Not run. Left to the host. |
| Browser | Not run. |

SQLite experimental warning on the worker test was the only extra output. It did not fail the run.
