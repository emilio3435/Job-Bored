/**
 * HOLES HOST P9: POST /api/ats-scorecard answered every provider failure
 * with the same 502 "Upstream provider request failed", so the dashboard
 * could not tell a bad key from a rate limit from an outage. Each failure
 * class now gets its own status, code, message and retry hint.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { ProviderApiError, providerHttpError, providerRequestError } from "../server/ai/provider.mjs";
import { atsFailureResponse } from "../server/ats-route-errors.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {unknown} error */
function mapped(error) {
  const { status, body } = atsFailureResponse(error);
  return { status, code: body.code, retryable: body.retryable, error: String(body.error), nextStep: String(body.nextStep || "") };
}

describe("HOLES HOST P9 — each ATS failure has its own answer", () => {
  it("a rejected key is a non-retryable provider_auth_failed naming the provider", () => {
    for (const status of [401, 403]) {
      const m = mapped(providerHttpError("openrouter", status, { error: { code: "invalid_api_key" } }));
      assert.equal(m.status, 502);
      assert.equal(m.code, "provider_auth_failed");
      assert.equal(m.retryable, false);
      assert.match(m.error, new RegExp(`OpenRouter.*HTTP ${status}`));
      assert.match(m.nextStep, /Settings/);
    }
  });

  it("a provider rate limit passes through as a retryable 429", () => {
    const m = mapped(providerHttpError("gemini", 429, { error: { status: "RESOURCE_EXHAUSTED" } }));
    assert.deepEqual([m.status, m.code, m.retryable], [429, "provider_rate_limited", true]);
    assert.match(m.error, /Gemini/);
  });

  it("an unknown model and other rejected requests say what to change", () => {
    const missing = mapped(providerHttpError("openai", 404, {}));
    assert.deepEqual([missing.status, missing.code, missing.retryable], [502, "provider_model_not_found", false]);
    const rejected = mapped(providerHttpError("openai", 400, {}));
    assert.deepEqual([rejected.status, rejected.code, rejected.retryable], [502, "provider_rejected_request", false]);
  });

  it("a provider outage is a retryable provider_unavailable", () => {
    const m = mapped(providerHttpError("anthropic", 503, {}));
    assert.deepEqual([m.status, m.code, m.retryable], [502, "provider_unavailable", true]);
    assert.match(m.error, /Anthropic.*HTTP 503/);
  });

  it("a timeout is a 504 and a network failure says the provider was unreachable", () => {
    const timeout = mapped(providerRequestError("gemini", Object.assign(new Error("t"), { name: "TimeoutError" })));
    assert.deepEqual([timeout.status, timeout.code, timeout.retryable], [504, "provider_timeout", true]);
    const network = mapped(providerRequestError("openai_compatible", new TypeError("fetch failed")));
    assert.deepEqual([network.status, network.code, network.retryable], [502, "provider_unreachable", true]);
  });

  it("no configured provider, an output limit and a cancelled request each get their own code", () => {
    const config = mapped(new ProviderApiError("No AI provider configured.", { provider: "", providerCode: "unconfigured", classification: "config" }));
    assert.deepEqual([config.status, config.code, config.retryable], [503, "llm_not_configured", false]);
    const limit = mapped(new ProviderApiError("hit the limit", { provider: "gemini", providerCode: "max_tokens", classification: "output_limit" }));
    assert.deepEqual([limit.status, limit.code, limit.retryable], [502, "provider_output_limit", false]);
    const controller = new AbortController();
    controller.abort();
    const cancelled = mapped(providerRequestError("gemini", new Error("aborted"), controller.signal));
    assert.deepEqual([cancelled.status, cancelled.code], [499, "request_cancelled"]);
  });

  it("malformed model JSON, a bad request body and anything else", () => {
    const malformed = mapped(new Error("ATS scorecard returned malformed JSON after retry. Retry ATS analysis or try a different model. Last parser error: Unexpected token"));
    assert.deepEqual([malformed.status, malformed.code, malformed.retryable], [502, "provider_malformed_output", true]);
    const invalid = mapped(new Error('Invalid event. Expected "command-center.ats-scorecard".'));
    assert.deepEqual([invalid.status, invalid.code, invalid.retryable], [400, "invalid_request", false]);
    assert.match(invalid.error, /Invalid event/);
    const internal = mapped(new TypeError("Cannot read properties of undefined (reading 'x')"));
    assert.deepEqual([internal.status, internal.code], [500, "internal_error"]);
    assert.doesNotMatch(internal.error, /Cannot read properties/, "an internal error's text stays in the server log");
  });

  it("keeps the provider metadata the dashboard already reads", () => {
    const { body } = atsFailureResponse(providerHttpError("openrouter", 401, { error: { code: "invalid_api_key" } }));
    assert.equal(body.provider, "openrouter");
    assert.equal(body.upstreamStatus, 401);
    assert.equal(body.providerCode, "invalid_api_key");
    assert.equal(body.errorClass, "upstream");
  });
});

describe("HOLES HOST P9 — the route answers with the mapping", () => {
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  /** @type {import("node:http").Server | null} */
  let provider = null;
  let baseUrl = "";
  let home = "";
  /** @type {"unauthorized" | "malformed"} */
  let mode = "unauthorized";

  before(async () => {
    home = mkdtempSync(join(tmpdir(), "holes-host-ats-"));
    provider = createServer((req, res) => {
      req.resume();
      if (mode === "unauthorized") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Incorrect API key provided", code: "invalid_api_key" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "{not json" }, finish_reason: "stop" }] }));
    });
    await new Promise((resolve) => provider?.listen(0, "127.0.0.1", () => resolve(undefined)));
    const providerPort = /** @type {import("node:net").AddressInfo} */ (provider.address()).port;
    const port = await new Promise((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const free = /** @type {import("node:net").AddressInfo} */ (probe.address()).port;
        probe.close(() => resolve(free));
      });
    });
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["index.mjs"], {
      cwd: join(REPO_ROOT, "server"),
      env: {
        PATH: process.env.PATH || "",
        HOME: home,
        USERPROFILE: home,
        PORT: String(port),
        LISTEN_HOST: "127.0.0.1",
        HERMES_APPLICATIONS_ROOT: join(home, "applications"),
        JOBBORED_LLM_CONFIG_PATH: join(home, "llm.json"),
        ATS_PROVIDER: "openai_compatible",
        ATS_OPENAI_COMPATIBLE_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
        ATS_OPENAI_COMPATIBLE_MODEL: "stub-model",
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${baseUrl}/health`).catch(() => null);
      if (res && res.ok) return;
      await sleep(100);
    }
    throw new Error("API did not start");
  });

  after(async () => {
    if (child && child.exitCode == null) {
      const exited = new Promise((r) => child?.once("exit", r));
      child.kill();
      await exited;
    }
    await new Promise((resolve) => provider?.close(() => resolve(undefined)));
    rmSync(home, { recursive: true, force: true });
  });

  const score = () =>
    fetch(`${baseUrl}/api/ats-scorecard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: readFileSync(join(REPO_ROOT, "examples", "ats-scorecard-request.v1.json"), "utf8"),
    });

  it("a rejected key is provider_auth_failed, not a generic upstream_error", async () => {
    mode = "unauthorized";
    const res = await score();
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.code, "provider_auth_failed");
    assert.equal(body.retryable, false);
    assert.match(body.error, /HTTP 401/);
    assert.equal(typeof body.requestId, "string");
  });

  it("malformed model output twice is provider_malformed_output", async () => {
    mode = "malformed";
    const res = await score();
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.equal(body.code, "provider_malformed_output");
    assert.equal(body.retryable, true);
  });
});
