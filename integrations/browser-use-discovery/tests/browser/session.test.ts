import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("browser session times out a hung command and falls back to direct fetch", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-browser-session-"));
  const commandPath = join(tempDir, "hung-browser-command");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      "<html><head><title>Fallback Careers</title></head><body>fallback</body></html>",
      {
        status: 200,
        headers: { "content-type": "text/html" },
      },
    );

  try {
    await writeFile(
      commandPath,
      [
        "#!/usr/bin/env node",
        "process.stdin.resume();",
        "setTimeout(() => {",
        "  process.stdout.write('{\"url\":\"https://example.com\",\"text\":\"late\"}\\n');",
        "}, 60000);",
      ].join("\n"),
      "utf8",
    );
    await chmod(commandPath, 0o755);

    const session = createBrowserUseSessionManager(
      makeRuntimeConfig({ browserUseCommand: commandPath }),
    );
    const result = await session.run({
      url: "https://example.com/acme-careers",
      instruction: "load the page",
      timeoutMs: 100,
    });

    assert.equal(result.metadata.mode, "fetch_fallback");
    assert.match(String(result.metadata.browserUseCommandError || ""), /timed out/i);
    assert.match(result.text, /Fallback Careers/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});
