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
