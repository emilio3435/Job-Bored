import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserUseSessionManager } from "../../src/browser/session.ts";

function makeRuntimeConfig(overrides = {}) {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "",
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "",
    webhookSecret: "",
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "local",
    asyncAckByDefault: true,
    ...overrides,
  };
}

test("browser session falls back to direct fetch when no command is configured", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      "<html><head><title>Acme Careers</title></head><body>hello</body></html>",
      {
        status: 200,
        headers: { "content-type": "text/html" },
      },
    );
  try {
    const url = "https://example.com/acme-careers";
    const session = createBrowserUseSessionManager(makeRuntimeConfig());
    const result = await session.run({
      url,
      instruction: "load the page",
      timeoutMs: 5000,
    });

    assert.equal(result.url, url);
    assert.match(result.text, /Acme Careers/);
    assert.equal(result.metadata.mode, "fetch");
    assert.equal(result.metadata.title, "Acme Careers");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
