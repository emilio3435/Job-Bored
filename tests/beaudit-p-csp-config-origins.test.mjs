/**
 * BEAUDIT G10 — the served CSP must admit the origins config.js names.
 * Before the fix the header was a fixed list: extraConnectSrc was never
 * passed, so a LAN Ollama, a custom OpenAI-compatible host or a hosted
 * jobBoredApiUrl was blocked, and style-src lacked the GSI stylesheet.
 */
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { describe, it } from "node:test";

import { startDevServer } from "../dev-server.mjs";
import {
  buildContentSecurityPolicy,
  extractConfigConnectOrigins,
} from "../scripts/lib/browser-csp-policy.mjs";

const CONFIG_JS = `window.COMMAND_CENTER_CONFIG = {
  sheetId: "",
  jobBoredApiUrl: "https://jobbored-api-abc123.a.run.app",
  resumeLocalBaseUrl: "http://192.168.1.20:11434/v1",
  resumeOpenRouterBaseUrl: 'https://openrouter.ai/api/v1',
  discoveryWebhookUrl: "",
  atsScoringServerUrl: "javascript:alert(1)",
  title: "https://not-a-url-key.example",
};`;

function directive(policy, name) {
  return policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || "";
}

describe("BEAUDIT G10 — CSP from config.js origins", () => {
  it("extracts only http(s) origins from *Url config keys", () => {
    assert.deepEqual(extractConfigConnectOrigins(CONFIG_JS), [
      "https://jobbored-api-abc123.a.run.app",
      "http://192.168.1.20:11434",
      "https://openrouter.ai",
    ]);
    assert.deepEqual(extractConfigConnectOrigins(""), []);
  });

  it("the policy built from those origins admits them in connect-src", () => {
    const policy = buildContentSecurityPolicy({
      extraConnectSrc: extractConfigConnectOrigins(CONFIG_JS),
    });
    const connect = directive(policy, "connect-src");
    assert.match(connect, /https:\/\/jobbored-api-abc123\.a\.run\.app/);
    assert.match(connect, /http:\/\/192\.168\.1\.20:11434/);
    assert.doesNotMatch(connect, /javascript:/);
  });

  it("style-src admits the GSI stylesheet, on the policy and the served header", async () => {
    assert.match(directive(buildContentSecurityPolicy(), "style-src"), /https:\/\/accounts\.google\.com\/gsi\/style/);
    const server = await startDevServer({ port: 0, logger: { log() {}, error() {} } });
    const port = server.address().port;
    try {
      const csp = await new Promise((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, path: "/", method: "GET" }, (res) => {
          res.resume();
          res.on("end", () => resolve(String(res.headers["content-security-policy"] || "")));
        });
        req.on("error", reject);
        req.end();
      });
      assert.match(directive(csp, "style-src"), /https:\/\/accounts\.google\.com\/gsi\/style/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("BEAUDIT G10 — dev-server serves the config.js-derived CSP", () => {
  it("dashboardSecurityHeaders admits config.js origins and tracks edits", async () => {
    const { mkdtempSync, writeFileSync, utimesSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const devServer = await import("../dev-server.mjs");
    assert.equal(
      typeof devServer.dashboardSecurityHeaders,
      "function",
      "dev-server must build its CSP from config.js (dashboardSecurityHeaders)",
    );
    const dir = mkdtempSync(join(tmpdir(), "beaudit-g10-"));
    const configPath = join(dir, "config.js");
    try {
      writeFileSync(configPath, CONFIG_JS);
      let csp = devServer.dashboardSecurityHeaders(configPath)["content-security-policy"];
      assert.match(directive(csp, "connect-src"), /https:\/\/jobbored-api-abc123\.a\.run\.app/);
      assert.match(directive(csp, "connect-src"), /http:\/\/192\.168\.1\.20:11434/);
      assert.match(directive(csp, "style-src"), /https:\/\/accounts\.google\.com\/gsi\/style/);

      writeFileSync(configPath, `window.COMMAND_CENTER_CONFIG = { jobBoredApiUrl: "https://other.example.com" };`);
      const later = new Date(Date.now() + 5000);
      utimesSync(configPath, later, later);
      csp = devServer.dashboardSecurityHeaders(configPath)["content-security-policy"];
      assert.match(directive(csp, "connect-src"), /https:\/\/other\.example\.com/);
      assert.doesNotMatch(directive(csp, "connect-src"), /jobbored-api-abc123/);

      const missing = devServer.dashboardSecurityHeaders(join(dir, "absent.js"))["content-security-policy"];
      assert.equal(missing, buildContentSecurityPolicy());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the served header is the one dashboardSecurityHeaders builds", async () => {
    const devServer = await import("../dev-server.mjs");
    const server = await startDevServer({ port: 0, logger: { log() {}, error() {} } });
    const port = server.address().port;
    try {
      const csp = await new Promise((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, path: "/", method: "GET" }, (res) => {
          res.resume();
          res.on("end", () => resolve(String(res.headers["content-security-policy"] || "")));
        });
        req.on("error", reject);
        req.end();
      });
      assert.equal(csp, devServer.dashboardSecurityHeaders()["content-security-policy"]);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("BEAUDIT G10 repair — quoted config keys", () => {
  it("reads double-, single- and unquoted *Url keys alike", () => {
    assert.deepEqual(
      extractConfigConnectOrigins('{"jobBoredApiUrl":"https://api.example.com"}'),
      ["https://api.example.com"],
    );
    assert.deepEqual(
      extractConfigConnectOrigins("{ 'resumeLocalBaseUrl' : 'http://10.0.0.5:11434/v1' }"),
      ["http://10.0.0.5:11434"],
    );
    assert.deepEqual(
      extractConfigConnectOrigins('window.COMMAND_CENTER_CONFIG = { jobBoredApiUrl: "https://a.example", "discoveryWebhookUrl": "https://b.example/hook" };'),
      ["https://a.example", "https://b.example"],
    );
    assert.deepEqual(extractConfigConnectOrigins('{"title":"https://not-a-url-key.example"}'), []);
    assert.deepEqual(extractConfigConnectOrigins('{"jobBoredApiUrl\':"https://mismatch.example"}'), []);
  });
});
