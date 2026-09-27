# Report: WriterJsonError Truncation Repair (RED-to-GREEN + gates)

Branch: `fix/writer-json-truncation` @ `ef122b5c` (from `origin/main` `dddaddcf`).
Worktree: `/Users/emilionunezgarcia/Job-Bored.worktrees/writer-json-fix` (clean, committed locally, NOT pushed).
Checkpoint: `/tmp/writer-fix-checkpoint.md`. Full test log: `/tmp/writer-fix-npm-test.log`. Contract log: `/tmp/writer-fix-contracts.log`.
Capacity: Muse meter unavailable — capacity unknown; no provider exhaustion hit.

## 1. Evidence: confirmed vs hypothesis (kept separate)

CONFIRMED (mechanical, reproduced):
- `extractFirstJsonObject` throws `unterminated JSON object` if and only if output braces never balance — i.e. the model response was cut off mid-JSON. Reproduced with synthetic clipped fixtures (no network, no credentials).
- Old code ignored all finish/stop signals (`textFrom*` returned text only) — code fact, `server/materials-writer.mjs` before fix.
- Old retry was byte-identical input, so a deterministic budget overflow re-truncated — code fact, `callWithRetry` before fix.
- Writer emits cover letter + full resume as ONE JSON blob, so one truncation fails both features — code fact (explains resume AND cover-letter failures).

HYPOTHESIS (supported, live signal never captured):
- Live Apollo failures were `MAX_TOKENS` truncation at the 4096 cap on a thinking model (`gemini-3.8-flash` resolved live during prior investigation). Support: official docs (`max_output_tokens` covers thinking+output combined; 3.8-flash thinking on-medium by default), run durations consistent with two full generations, and the 4096 cap vs letter-band + full-resume output size. NOT confirmed: sandbox blocks direct Google calls (`API_KEY_INVALID` artifact) and the old code never recorded `finishReason`. The fix now surfaces `finishReason` in the error, so the next live failure (if any) will carry the signal.

## 2. Official-docs verification (ai.google.dev, fetched this session)
- `generationConfig` supports `responseMimeType: "application/json"` + `responseSchema` (JSON mode). Used for Gemini.
- `finishReason` enum includes `STOP`, `MAX_TOKENS`, `SAFETY`, `RECITATION`, `MALFORMED_RESPONSE`, etc. (`/api/generate-content`).
- Thinking doc: "`max_output_tokens` applies to the combined total of thinking tokens and output tokens"; gemini-3.8-flash thinking On (medium), levels low/medium/high (minimal NOT allowed). No thinking knob set by this fix (model-version-sensitive; budget + JSON mode instead).

## 3. What changed (2 files, public API unchanged)
`server/materials-writer.mjs`:
- Budget 4096 -> 8192 base (matches profile drafter's `PROFILE_DRAFT_MAX_OUTPUT_TOKENS`); one truncation retry escalates to hard cap 16384. Attempts stay bounded at 2 for Writer and Editor.
- Structured JSON per codebase policy (mirrors `server/ai/provider.mjs` + ats-scorecard comment): Gemini `responseMimeType` + minimal schema (requires only `letter`+`resume` objects; sub-fields unrestricted); first-party OpenAI `response_format: json_object` (not strict schema — intentionally loose); OpenRouter/local plain JSON; Anthropic prompt-only JSON (output_config deferred: loose schema + unverifiable from sandbox).
- Truncation signals (`MAX_TOKENS` / `length` / `max_tokens`) throw `WriterJsonError` with `code=writer_truncated`, `provider`, `finishReason`, message "<Label> cut the draft off at its output limit (<signal> <value>). Try a shorter resume, or pick a larger model in Settings." (mirrors profile-from-resume's `truncatedDraftError`; class name stable for UI/catchers).
- Unterminated JSON with NO signal keeps its honest parse message but still gets the one escalated retry (probable-truncation case).
`tests/materials-writer.test.mjs`: 7 new synthetic truncation cases (all providers + recovery + plain-JSON policy lock); one intended update (4096 -> 8192).
Content preservation: no prompt/schema change restricts resume sub-fields; freeze-facts system prompt untouched; JSON mode only constrains syntax + top-level keys.

## 4. Verification (pasted)
RED (before fix, new tests only):
```
✔ parseWriterJson / callWriter / callEditor (10 pass, pre-existing)
✖ callWriter truncation — 6 fail (names finishReason, recovery budgets,
  JSON mode, OpenAI length, Anthropic max_tokens, blind escalation)
ℹ tests 16, pass 10, fail 6
```
GREEN (after fix):
```
✔ parseWriterJson / callWriter / callEditor / callWriter truncation
ℹ tests 16, pass 16, fail 0
```
Writer-adjacent focused suites (writer, drafter, letter-budget, beaudit-q-repair, render-model-adapter):
```
ℹ tests 48, pass 48, fail 0
```
`npm run lint:repo` — exit 0 (`eslint .`, `lint:skills` OK, `lint:tokens ok: 34 sheet(s), 0 new finding(s)`).
`npm run typecheck:repo` — exit 0 (incl. `tsc --noEmit` browser-use-discovery + `typecheck:server`).
`npm test` — exit 0: `ℹ tests 4604, suites 1104, pass 4596, fail 0, todo 8`. Note: full-log interleavings from environment-sensitive suites (beaudit-p-e17 docker/tmp paths, submission-record) appear in nested output but totals read fail 0 and the gate exits 0; e17 passes standalone (13 pass / 0 fail on clean tree) and neither suite imports the writer.
`npm run test:contract:all` — exit 0 (no versioned contract touched; run as insurance).
Pre-commit hook: "Pre-commit validation passed."

## 5. Deliberately separate / follow-ups (not in this change)
- JD-navigation-junk finding (Apollo JD was Learn4Good nav text): untouched, still open.
- `max_completion_tokens` for OpenAI reasoning models (writer always sends `max_tokens`): latent, out of scope.
- Anthropic `output_config`: deferred until verifiable against live API.
- Historical plan doc `docs/superpowers/plans/2026-08-31-standalone-materials-drafter.md` still cites the old 4096 writer budget (point-in-time record; left as-is).
- Live stack untouched (still gfx-integration PIDs); no push/PR/deploy. To pick up the fix, restart the scraper server from this branch when Emilio is ready.

---

## 6. Grok findings 1+4 repair (commit 0691a4a2, same branch/worktree)

Review evidence: `/private/tmp/jobbored-review-package/.lane-evidence/REVIEW-GROK.md`. Scope kept to `server/materials-writer.mjs` + `tests/materials-writer.test.mjs`. No secrets, live APIs, restarts, push, or PR.

Finding 1 (High): removed `WRITER_RESPONSE_SCHEMA` and its wire use. Gemini keeps `responseMimeType: "application/json"` with NO `responseSchema` (property-less OBJECT nodes are validator-rejected; an open object can't be expressed there). Prompt facts untouched; shape still enforced by prompt + `parseWriterJson`. Superseded test "requests Gemini JSON mode with a letter+resume schema" removed — it locked the exact invalid request; replaced by "sends responseMimeType and no responseSchema" plus a nested-facts round-trip lock (letter fields, header, roles/bullets with metrics, skills all survive `deepEqual`).

Finding 4 (Low): new `GEMINI_BLOCKED_FINISH_REASONS` (SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT, MALFORMED_RESPONSE) throw `code=writer_blocked` with `provider` + `finishReason` on the FIRST attempt (no retry). `textFromGeminiResponse` skips `thought === true` parts defensively. MAX_TOKENS stays conservative per directive: a fully parseable body under a truncation signal is still rejected (locked by test), never accepted as complete. Unknown/empty finishes keep the parse path, so tolerant providers and old doubles still work. OpenAI `content_filter` and other non-Gemini blocks intentionally out of scope (finding named Gemini reasons only).

RED-to-GREEN (focused `node --test tests/materials-writer.test.mjs`):
```
RED:  tests 21, pass 18, fail 3  (no-responseSchema, blocked reasons, thought parts)
GREEN: tests 20, pass 20, fail 0  (superseded schema test removed with cause above)
```
Gates: `eslint` on both files clean; `npm run typecheck:server` exit 0; full `npm test` exit 0 (`tests 4608, pass 4600, fail 0, todo 8`; log `/tmp/writer-fix-npm-test2.log`). Pre-commit hook passed. Ready for independent Grok re-review.

Correction (pre-review): new nested-facts fixture fictionalized (Example Candidate / Example Systems / Example College, explicitly synthetic dates and metrics); pre-existing Audacy fixtures untouched. Thought-part comment simplified to the durable behavior (ignore thought-marked parts so only answer text reaches the parser). Re-verified: focused 20/20, eslint clean, typecheck:server exit 0; amended into the local commit above.
