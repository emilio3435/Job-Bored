# REVIEW-GROK

Status: FINDINGS

Goal: independently review the combined discovery-progress and writer-truncation package, prioritizing provider compatibility and truthful progress.

Success means: severity-ranked findings with source evidence, or PASS.

Reviewed: `docs/programs/gfx-review-package/SPEC.md`, then `git diff origin/main...HEAD` (merge-base `dddaddcf`, HEAD `3c9d3908`, 31 files, +3200/−95), and writer commit `3c9d3908` (only `server/materials-writer.mjs` and `tests/materials-writer.test.mjs`).

## Model and effort

Confirmed from this session's `summary.json` (`current_model_id`, `reasoning_effort`): `grok-4.7-build-fast` at `xhigh`. That matches `docs/programs/gfx-review-package/models.lock.json` family `grok`. Process-table argv was not readable in this sandbox (`ps` returned `operation not permitted`). Session id `227291a6-33be-43e4-9481-df096a6fbbac`. Capacity at start: unknown, not exhausted. This review finished without a provider wall.

## Findings

### 1. High — Gemini `responseSchema` uses empty nested objects

`WRITER_RESPONSE_SCHEMA` requires `letter` and `resume` and gives each one `{ type: "object" }` with no `properties` and no `additionalProperties`. That object is sent on `generationConfig.responseSchema` for every Gemini writer and editor call.

```53:60:server/materials-writer.mjs
const WRITER_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    letter: { type: "object" },
    resume: { type: "object" },
  },
  required: ["letter", "resume"],
};
```

```479:483:server/materials-writer.mjs
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
      responseSchema: WRITER_RESPONSE_SCHEMA,
```

The comment above the schema says sub-fields stay unrestricted so frozen facts pass through. On `generateContent`'s `responseSchema` (OpenAPI Schema, not `responseJsonSchema`), a property-less OBJECT is the shape public API errors reject:

`generation_config.response_schema.properties[...].properties: should be non-empty for OBJECT type`

Same validator, still cited in 2026, for empty OBJECT nodes in `response_schema`: [browser-use#3786](https://github.com/browser-use/browser-use/issues/3786) (Dec 2025) and the [Portkey #10566 write-up](https://portkey.ai/error-library/validation-error-10566) (May 2026). Google's structured-output page (updated 2026-09-23) lists `additionalProperties` on the JSON Schema path. This repo already strips `additionalProperties` before sending `responseSchema`, because that proto field rejects the name:

```387:412:server/ai/provider.mjs
const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "additionalProperties",
  "$schema",
  "$id",
  "$ref",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
]);
```

So the "open nested object" the comment describes cannot be expressed on the field this call sets. Gemini is the default drafter. A 400 fails the draft. `throwIfHttpError` drops the response body, and the drafter stores that string:

```453:457:server/materials-writer.mjs
function throwIfHttpError(resp, label) {
  if (!resp || resp.ok === false) {
    const status = resp && typeof resp.status === "number" ? resp.status : 0;
    throw new Error(`${label} HTTP ${status}`);
  }
}
```

```636:641:server/materials-drafter.mjs
  async function failJob(job, err) {
    const error = /** @type {{ message?: unknown }} */ (err);
    const record = withPhase(
      job.record,
      "failed",
      error && error.message ? String(error.message) : "Draft failed before any files were produced.",
```

Synthetic HTTP 400 (body included the non-empty-properties message): one attempt, thrown message `Gemini HTTP 400`, API text discarded. `callWithRetry` does not catch that throw, so a schema 400 is not retried. That bound is right; the request is wrong.

If a server accepted this schema, constrained decoding still has no nested fields to emit. `parseWriterJson` treats empty objects as success, so a `{letter:{}, resume:{}}` body would ship with the resume facts removed:

```222:225:server/materials-writer.mjs
  if (!isPlainObject(parsed) || !isPlainObject(parsed.letter) || !isPlainObject(parsed.resume)) {
    throw new WriterJsonError("WriterJsonError: expected letter and resume objects");
  }
  return /** @type {WriterJson} */ (parsed);
```

Synthetic parse of `{"letter":{},"resume":{}}` returned those empty objects.

The freeze-facts sentence is still in the system prompt (synthetic request contained `Freeze employers, titles, dates, and metrics`, and the prompt still names `hook`). The prompt was not rewritten. The new schema is what can drop or block the facts.

Unit proof does not catch this. `tests/materials-writer.test.mjs` "requests Gemini JSON mode with a letter+resume schema" only asserts `responseSchema.required` is `["letter","resume"]` (lines 309–329). `node --test tests/materials-writer.test.mjs`: 16 pass, 0 fail. Those tests mock `fetch`. They do not submit the schema to Gemini.

Fix: put the prompt's concrete fields on `responseSchema` so every OBJECT node has a non-empty `properties` map (letter strings, `resume.header`, `resume.summary`, `resume.roles` items, string arrays). That matches the facts the prompt already requires. An open object belongs on `responseJsonSchema` with `additionalProperties`, or on `responseMimeType: "application/json"` with no schema. It does not belong on `responseSchema` as `{ type: "object" }`.

Live API: not called. The rejection is inferred from the request shape plus public `generateContent` errors. This review did not observe a 400 from Google.

### 2. Medium — an empty ATS company list leaves "Company job boards" running

When an ATS lane is on, the worker publishes source `ats` as `running` before the company loop. The only write that can move it to `done` is inside that loop's `finally`. An empty list never enters the loop, so the lane stays `running` with `0` of `0` through score, write, and learn.

```733:742:integrations/browser-use-discovery/src/run/run-discovery.ts
  if (hasAtsLanes) {
    progressCounters.companiesTotal = atsCompaniesToSearch.length;
    progressCounters.companiesDone = 0;
    progressCounters.boardsDetected = 0;
    progressCounters.listingsSeen = 0;
    progressCounters.listingsProcessed = 0;
    progressCounters.leadsQualified = 0;
    progressCounters.matcherCalls = 0;
    progressSources.set("ats", { id: "ats", state: "running", done: 0, total: atsCompaniesToSearch.length });
  }
```

```934:941:integrations/browser-use-discovery/src/run/run-discovery.ts
    } finally {
      progressCounters.companiesDone = (progressCounters.companiesDone || 0) + 1;
      progressSources.set("ats", {
        id: "ats", state: progressCounters.companiesDone === atsCompaniesToSearch.length ? "done" : "running",
        done: progressCounters.companiesDone, total: atsCompaniesToSearch.length,
      });
      currentProgress = undefined;
      checkpointRunProgress("scout");
```

`progressSources.set("ats", ...)` occurs only at those two sites. `atsCompaniesToSearch` is whatever remains after the allowlist filter (`run-discovery.ts` 724–732), so a restricted allowlist that matches nobody hits the same path. The card copies `state` through (`discovery-run-tracker.js` 264–271) and prints `0 of 0` whenever `total` is present (`253–255`). The contract says `companiesDone` counts companies finished, including empty and handled timeout work (`AGENT_CONTRACT.md` line 172). A lane that is still `running` after the ATS loop has been skipped says the opposite.

Fix: if `atsCompaniesToSearch.length === 0`, set `ats` to `skipped` or `done` with `done: 0, total: 0` before leaving scout. Do not leave `running` for the rest of the run.

Proof: source path only. `runDiscovery` was not executed.

### 3. Medium — "Leads kept" still counts leads scoring then drops

`leadsQualified` increments for each matcher-accepted ATS or SerpApi lead (`run-discovery.ts` 918 and 1180) and again for grounded leads (1382). Frontier filtering then replaces `normalizedLeads` with the selected subset and does not change the counter:

```1317:1331:integrations/browser-use-discovery/src/run/run-discovery.ts
    const filteredNormalizedLeads = normalizedLeads.filter((lead) => {
      const candidateId = `lead:${lead.url}`;
      return selectedCandidateIds.has(candidateId);
    });
    // ...
    normalizedLeads.length = 0;
    normalizedLeads.push(...filteredNormalizedLeads);
```

The next progress publish is the write checkpoint (`1472`), which still sends the pre-filter count. The live card labels that field "Leads kept":

```175:178:discovery-run-tracker.js
  const RUN_PROGRESS_COUNTER_LABELS = [
    ["listingsSeen", "Listings found"],
    ["listingsProcessed", "Listings checked"],
    ["leadsQualified", "Leads kept"],
```

```491:498:discovery-run-tracker.js
    if (view.counters.length) {
      parts.push('<dl class="jb-live-run__counters">');
      for (const counter of view.counters) {
        parts.push(
          `<div class="jb-live-run__counter"><dt>${esc(counter.label)}</dt><dd>${esc(counter.value)}</dd></div>`,
        );
```

The contract's own gloss is narrower: `leadsQualified` counts normalized accepted leads before Sheet dedupe (`AGENT_CONTRACT.md` line 172). It does not say the count shrinks after exploit selection. The card still shows that number beside "Saving to your Pipeline", and the progress object has no post-score write count. A run that qualifies 10 and selects 2 displays "Leads kept 10" while saving 2.

Fix: at the score checkpoint, set `leadsQualified` to the post-filter length (grounded adds can still increment it), or rename the card label to the contract's meaning ("Qualified") and show the write count separately once write starts.

Proof: source path. The progress-model tests lock the number the worker sent (`tests/gfx-uxd-fe-progress-model.test.mjs` UXD-FE-9). They do not cover a counter that stays high after `selectExploitTargets`.

### 4. Low — non-truncation finish reasons are dropped; thought-marked parts are concatenated

Truncation handling itself is bounded and named. Synthetic Gemini `MAX_TOKENS`, including a body that was already valid JSON: exactly 2 calls, budgets would be 8192 then 16384, error `code=writer_truncated`, `finishReason=MAX_TOKENS`. OpenAI `length` and Anthropic `max_tokens` are covered by the unit file (16 pass). Unterminated JSON with no finish signal escalates once and then keeps the parse error. That matches `callWithRetry` (`server/materials-writer.mjs` 638–662) and `truncationSignal` (271–276).

Two gaps in the same function:

- `finishReason: "SAFETY"` with empty text threw `WriterJsonError: no JSON object found` after 2 calls. `code` and `finishReason` were unset. `RECITATION` and the other non-budget stops take the same path. The drafter then shows a JSON failure for a block.
- `textFromGeminiResponse` joins every part's `text` (`372–375`). A synthetic candidate with `thought: true` text `{"scratch":"drop the 1843 date"}` ahead of a valid letter+resume returned `expected letter and resume objects` and did not return company `EAB`. Current generateContent docs (thinking guide, updated 2026-09-25) say that API has no dedicated thought blocks; thought summaries belong to the Interactions API and are off by default. The writer calls `:generateContent`. This is a defensive hole in the modified extractor, not a live thought-summary capture.

Fix: skip parts with `thought: true`. For `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, and `MALFORMED_RESPONSE`, throw one error that keeps `finishReason`, and do not spend the second attempt. A `MAX_TOKENS` body that already parses as letter+resume can be returned instead of discarded; the synthetic case above threw away a complete payload because the signal is checked before `parseWriterJson`.

## Checked, not defects

- Writer commit scope matches SPEC: `3c9d3908` changes only `server/materials-writer.mjs` and `tests/materials-writer.test.mjs`. Discovery progress is the rest of `origin/main...HEAD`. No import ties the writer to the run-status path.
- Freeze-facts prompt text is unchanged. OpenAI first-party sends `response_format: { type: "json_object" }` only. OpenRouter and local stay plain JSON. Anthropic stays prompt-only JSON and still reads `stop_reason`.
- Retry ceiling is 2 for Writer and Editor. Escalation to 16384 happens once, and only for a truncation signal or unterminated JSON with an empty finish. A non-2xx response is not retried.
- `maxOutputTokens` includes thinking tokens (thinking guide, 2026-09-25). `gemini-3.8-flash` defaults to thinking on, medium. The 8192 base and one 16384 retry match that constraint. No `thinking_level` is set; the writer report left that knob out on purpose. That is a residual truncation risk, not a schema defect.
- Run-status progress is additive and aligned: `schemas/run-status.v1.schema.json` `progress` properties, `examples/run-status.v1.json`, `AGENT_CONTRACT.md` line 172, `docs/CONTRACT-CHANGELOG.md` 2026-09-26 row, `run-progress.ts` `DiscoveryRunProgress`, and the FE allowlist in `discovery-run-tracker.js` 129–141. `phase` stays a free string in the schema; unknown phases render as "Working" with no step current (UXD-FE-14).
- Freshness uses the reader clock and moves `progressObservedAt` only when `sequence` changes (`discovery-run-tracker.js` 709–717). Heartbeats bump `sequence` (`run-discovery.ts` 349–351 and the 15s timer at 397). Missing counters are omitted, not zeroed (UXD-FE-10). Terminal statuses hide the live view (UXD-FE-13). SerpApi `onQueryProgress` receives `state`, `done`, and `total` only (`serpapi-google-jobs.ts` 140–146); the query string stays in logs, not in `current.label`.
- Worker labels in this diff are ordinals (`Company N of M`, `Query N of M`) and source ids. They fit the FE 80-character label cap. The schema allows `current.label` up to 120 (`schemas/run-status.v1.schema.json`). A future label of 81–120 characters would be dropped by `cleanRunProgressLabel`. Nothing in this diff sends one.
- Empty score/exploit checkpoints when there is nothing to rank (`run-discovery.ts` 1332–1340) advance the phase cursor in the same turn as write. A poll is likely to see write or learn, with earlier steps marked done. That matches the linear step rail. It is not a stuck headline.

## Proof split

| Claim | Proof in this review |
| --- | --- |
| Schema shape, empty-object parse, retry counts, SAFETY text, thought-part join, HTTP 400 text dropped | Synthetic, no network. Script output captured below. |
| Writer unit suite green | `node --test tests/materials-writer.test.mjs` — 16 pass, 0 fail, 57.7 ms. Mocked fetch. |
| Gemini rejects or empties this schema | Not live. Inferred from public `generateContent` errors and the 2026-09-23 schema docs. |
| ATS lane stays `running`; leadsQualified ignores the exploit filter | Source read. `runDiscovery` not executed. |
| Draft succeeds against Gemini 3.8 Flash | Not run. SPEC keeps live draft success separate from fixture evidence. |
| `npm run lint:repo`, `typecheck:repo`, `npm test`, `npm run test:repo`, `tests/gfx-uxd-fe-visual.mjs` | Not run here. SPEC assigns those floors to the host. |

Synthetic writer output (mocked fetch only):

```
objectNodesMissingProperties: ["$.letter", "$.resume"]
promptStillFreezesFacts: true
truncation.calls: 2
truncation.code: writer_truncated
truncation.finishReason: MAX_TOKENS
thoughtPart.error: WriterJsonError: expected letter and resume objects
safety.calls: 2
safety.message: WriterJsonError: no JSON object found
http400.calls: 1
http400.message: Gemini HTTP 400
http400.keepsApiMessage: false
emptyObjectsParse: {"letter":{},"resume":{}}
```

## Not verified

- No live Gemini, OpenAI, Anthropic, OpenRouter, or local-model call.
- No browser pass over the discovery drawer, Runs row, or draft UI.
- Host floors named in SPEC were not repeated.
- `runDiscovery` with an empty ATS company list was not executed; finding 2 is the control flow at the cited lines.
