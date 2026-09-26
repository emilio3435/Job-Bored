// BEAUDIT floor repair (lane Q): a browser command that exits before reading
// its stdin must not crash the worker with an unhandled EPIPE. The payload is
// larger than a pipe buffer, so the write is still in flight when `exit 3`
// closes the read end; before the fix the stdin 'error' event had no listener
// and surfaced as an uncaught exception, which also leaked the patched fetch
// of one session-ssrf test into the next.
import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserUseSessionManager } from "../../src/browser/session.ts";

test("session falls back to fetch when the command exits before reading stdin", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("<html><head><title>Role</title></head></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
  const uncaught: Error[] = [];
  const onUncaught = (error: Error) => {
    uncaught.push(error);
  };
  process.prependListener("uncaughtException", onUncaught);
  try {
    const session = createBrowserUseSessionManager({
      browserUseCommand: "exit 3",
      host: "127.0.0.1",
      port: 0,
    } as any);
    const result = await session.run({
      url: "https://careers.example.com/jobs",
      instruction: "x".repeat(4 * 1024 * 1024),
      timeoutMs: 5000,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(result.metadata.mode, "fetch_fallback");
    assert.equal(result.metadata.title, "Role");
    assert.deepEqual(calls, ["https://careers.example.com/jobs"]);
    assert.deepEqual(uncaught.map((error) => error.message), []);
  } finally {
    process.removeListener("uncaughtException", onUncaught);
    globalThis.fetch = originalFetch;
  }
});
