/**
 * Tests for GET/POST /api/llm-config handlers in server/llm-config.mjs.
 * Imports the handlers directly so the suite does not boot Express.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleGetLlmConfig,
  handlePostLlmConfig,
} from "../server/llm-config.mjs";

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("/api/llm-config", () => {
  let dir;
  let env;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-llm-http-"));
    env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("GET returns 404 llm_unconfigured when the pin file is missing", async () => {
    const res = mockRes();
    await handleGetLlmConfig({}, res, env);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "llm_unconfigured");
    assert.equal("apiKey" in res.body, false);
  });

  it("POST then GET round-trips a redacted pin and GET never contains apiKey", async () => {
    const postRes = mockRes();
    await handlePostLlmConfig(
      {
        body: {
          provider: "gemini",
          model: "gemini-flash",
          apiKey: "secret-key",
          baseUrl: "",
        },
      },
      postRes,
      env,
    );
    assert.equal(postRes.statusCode, 200);
    assert.equal(postRes.body.provider, "gemini");
    assert.equal(postRes.body.model, "gemini-flash");
    assert.equal(postRes.body.keyPresent, true);
    assert.equal("apiKey" in postRes.body, false);
    assert.equal(JSON.stringify(postRes.body).includes("secret-key"), false);

    const getRes = mockRes();
    await handleGetLlmConfig({}, getRes, env);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.provider, "gemini");
    assert.equal(getRes.body.model, "gemini-flash");
    assert.equal(getRes.body.baseUrl, "");
    assert.equal(getRes.body.keyPresent, true);
    assert.ok(typeof getRes.body.updatedAt === "string");
    assert.equal("apiKey" in getRes.body, false);
    assert.equal(JSON.stringify(getRes.body).includes("secret-key"), false);
    assert.equal(JSON.stringify(getRes.body).includes("apiKey"), false);
  });

  it("POST 400 when model is missing", async () => {
    const res = mockRes();
    await handlePostLlmConfig(
      { body: { provider: "gemini", apiKey: "k" } },
      res,
      env,
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "llm_invalid");
    assert.equal("apiKey" in res.body, false);
  });
});
