# Agent 10 - Worker Google Tool Lanes

## Files Changed

- `integrations/browser-use-discovery/src/grounding/grounded-search.ts`
  - No code changes. Preserved as the Gemini-only `google_search` lane.
- `integrations/browser-use-discovery/src/sources/gemini-url-context-extractor.ts`
  - Reworded missing-key result as an optional Gemini `url_context` Google-tool skip.
- `integrations/browser-use-discovery/src/webhook/handle-ingest-url.ts`
  - Added a missing-Gemini-key short-circuit before invoking Gemini URL Context.
  - Logs the skip as optional `provider: "gemini"`, `tool: "url_context"`.
- `integrations/browser-use-discovery/src/run/run-discovery.ts`
  - Reworded missing grounded search as optional Gemini `google_search` unavailability.
  - Adds source-summary diagnostics for the optional Google Search skip.
  - Treats optional Google-tool unavailability as non-degrading when another lane writes leads.
- `integrations/browser-use-discovery/src/server.ts`
  - Moves missing grounded Google Search from blocking health warnings to advisory warnings.
  - Adds `groundedWeb` provider/tool/optional metadata and a `googleTools` readiness block for `url_context` and `google_search`.
- `integrations/browser-use-discovery/tests/webhook/handle-ingest-url.test.ts`
  - Added coverage proving missing Gemini skips URL Context and falls through to Cheerio.
- `integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts`
  - Updated grounded readiness assertions to Google-tool wording.
  - Added coverage proving mixed ATS plus missing Gemini Google Search completes when ATS writes leads.

## Provider Paths Supported

- OpenRouter-only or non-Gemini worker runs can proceed through non-Google lanes without treating missing Gemini tools as a whole-worker failure.
- Ingest URL without `BROWSER_USE_DISCOVERY_GEMINI_API_KEY` skips Gemini URL Context and continues to Cheerio/Browser Use fallback.
- Mixed source discovery can complete when ATS writes leads and optional grounded Google Search is unavailable.

## Google Tool Paths Preserved

- Grounded search remains Gemini-only because it uses the Gemini `google_search` tool.
- URL Context remains Gemini-only because it uses the Gemini `url_context` tool.
- Existing Gemini-key-present behavior still invokes the Gemini URL Context tier before Cheerio.
- Missing-key behavior is reported as optional Google-tool unavailability, not a generic LLM failure.

## Tests Run

- `npm ci` to install dependencies in the isolated worktree.
- `node --experimental-strip-types --test integrations/browser-use-discovery/tests/webhook/handle-ingest-url.test.ts integrations/browser-use-discovery/tests/webhook/run-discovery.test.ts` - PASS, 72 tests.
- `npm run typecheck:repo` - PASS.
- `node --experimental-strip-types --check integrations/browser-use-discovery/src/server.ts && node --experimental-strip-types --check integrations/browser-use-discovery/src/run/run-discovery.ts && node --experimental-strip-types --check integrations/browser-use-discovery/src/webhook/handle-ingest-url.ts && node --experimental-strip-types --check integrations/browser-use-discovery/src/sources/gemini-url-context-extractor.ts` - PASS.

## Known Risks

- `server.ts` health payload changes are syntax-checked but not covered by the focused Agent 10 tests because the server module starts a listener on import.
- Worker generic chat provider readiness is not implemented in this lane; that remains Agent 8 ownership.
- `grounded-search.ts` was intentionally left unchanged to preserve the Gemini `google_search` lane.
