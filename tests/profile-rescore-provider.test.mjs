import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, it } from "node:test";

import {
  getProfileRescoreProviderConfigFromEnv,
  getProfileRescoreProviderStatus,
  rescoreAllPipelineRows,
} from "../server/profile-rescore-worker.mjs";

function sampleProfile() {
  return {
    version: 1,
    identity: {
      targetRoles: ["Growth Engineer"],
      targetSeniority: "ic_senior",
      yearsRelevantExperience: 8,
      primaryNarrative:
        "I build growth systems that combine product engineering, lifecycle analytics, and LLM tooling.",
    },
    strengths: [
      {
        name: "Growth engineering",
        rank: 1,
        evidence: "Built acquisition and retention systems.",
        keywords: ["growth", "analytics", "automation"],
      },
    ],
    wants: ["hands-on building"],
    avoids: ["pure account management"],
    hardConstraints: {
      workMode: "any",
      salaryRequired: false,
      workAuth: "us_authorized",
    },
  };
}

function pipelineRow(overrides = {}) {
  const row = [];
  row[1] = overrides.title ?? "Senior Growth Engineer";
  row[2] = overrides.company ?? "Acme";
  row[3] = overrides.location ?? "Remote";
  row[4] = overrides.url ?? "https://example.test/jobs/growth";
  row[6] = overrides.salary ?? "$140k";
  return row;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("profile rescore provider config", () => {
  it("accepts OpenRouter env config without a Gemini key", () => {
    const cfg = getProfileRescoreProviderConfigFromEnv({
      PROFILE_RESCORE_PROVIDER: "openrouter",
      PROFILE_RESCORE_OPENROUTER_API_KEY: "or-key",
      PROFILE_RESCORE_OPENROUTER_MODEL: "vendor/model:free",
      PROFILE_RESCORE_OPENROUTER_BASE_URL: "https://openrouter.test/api/v1/",
      GEMINI_API_KEY: "",
    });

    assert.equal(cfg.provider, "openrouter");
    assert.equal(cfg.apiKey, "or-key");
    assert.equal(cfg.model, "vendor/model:free");
    assert.equal(cfg.baseUrl, "https://openrouter.test/api/v1");
    assert.equal(getProfileRescoreProviderStatus(cfg).configured, true);
  });

  it("reports provider-neutral missing config for selected OpenRouter", () => {
    const cfg = getProfileRescoreProviderConfigFromEnv({
      PROFILE_RESCORE_PROVIDER: "openrouter",
    });
    const status = getProfileRescoreProviderStatus(cfg);

    assert.equal(status.configured, false);
    assert.equal(status.provider, "openrouter");
    assert.equal(status.reason, "missing_api_key");
    assert.match(status.detail, /OpenRouter API key/);
    assert.doesNotMatch(status.detail, /Gemini/);
  });

  it("keeps legacy Gemini API-key config usable with the default model", () => {
    const status = getProfileRescoreProviderStatus({
      provider: "gemini",
      geminiApiKey: "g-key",
    });

    assert.equal(status.configured, true);
    assert.equal(status.provider, "gemini");
  });
});

describe("rescoreAllPipelineRows provider behavior", () => {
  it("dryRun counts rows without requiring any LLM provider config", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, method: String(options.method || "GET").toUpperCase() });
      assert.match(href, /sheets\.googleapis\.com/);
      return jsonResponse({ values: [pipelineRow({ url: "" }), pipelineRow()] });
    };
    const events = [];

    try {
      const result = await rescoreAllPipelineRows({
        profile: sampleProfile(),
        sheetId: "sheet-1",
        overrideToken: "sheet-token",
        dryRun: true,
        onProgress: (event) => events.push(event),
      });

      assert.deepEqual(result, {
        rescored: 0,
        skipped: 1,
        failed: 0,
        total: 1,
        dryRun: true,
      });
      assert.equal(calls.length, 1);
      assert.deepEqual(events.at(-1), { kind: "done", ...result });
      assert.equal(events[0].kind, "progress");
      assert.equal(events[0].status, "skipped");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("scores rows through OpenRouter chat/completions and preserves progress payloads", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const href = String(url);
      const method = String(options.method || "GET").toUpperCase();
      calls.push({ href, method, headers: options.headers || {}, body: options.body || "" });

      if (href.includes("sheets.googleapis.com") && method === "GET") {
        return jsonResponse({ values: [pipelineRow()] });
      }
      if (href.includes("sheets.googleapis.com") && href.includes("/values:batchUpdate")) {
        return jsonResponse({ updatedCells: 4 });
      }
      if (href === "https://openrouter.ai/api/v1/chat/completions") {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  fitScore: 8,
                  perStrength: [
                    {
                      name: "Growth engineering",
                      score: 8,
                      rationale: "The role maps to growth and analytics work.",
                    },
                  ],
                  concerns: ["Compensation is not fully clear."],
                  matches: ["Growth systems", "analytics"],
                  rationale: "Strong match with a clear growth engineering angle.",
                  leadAngle: "Lead with growth systems and measurable retention work.",
                }),
              },
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    };
    const events = [];

    try {
      const result = await rescoreAllPipelineRows({
        profile: sampleProfile(),
        sheetId: "sheet-1",
        overrideToken: "sheet-token",
        providerConfig: {
          provider: "openrouter",
          apiKey: "or-key",
          model: "openai/gpt-oss-120b:free",
          baseUrl: "https://openrouter.ai/api/v1",
        },
        onProgress: (event) => events.push(event),
      });

      assert.deepEqual(result, { rescored: 1, skipped: 0, failed: 0, total: 1 });
      const chatCall = calls.find((call) => call.href.includes("/chat/completions"));
      assert.ok(chatCall, "expected OpenRouter chat/completions call");
      assert.equal(chatCall.headers.Authorization, "Bearer or-key");
      const chatBody = JSON.parse(chatCall.body);
      assert.equal(chatBody.model, "openai/gpt-oss-120b:free");
      assert.equal(chatBody.max_tokens, 2048);
      assert.equal(chatBody.messages[0].role, "system");
      assert.equal(chatBody.messages[1].role, "user");
      assert.equal(Object.hasOwn(chatBody, "response_format"), false);

      const writeCall = calls.find((call) => call.href.includes("/values:batchUpdate"));
      assert.ok(writeCall, "expected Sheet batch update");
      const writeBody = JSON.parse(writeCall.body);
      assert.equal(writeBody.data[0].range, "Pipeline!H2");
      assert.equal(writeBody.data[0].values[0][0], "8");
      assert.equal(writeBody.data[3].range, "Pipeline!U2");
      assert.equal(writeBody.data[3].values[0][0], "8");

      const rescoredEvent = events.find(
        (event) => event.kind === "progress" && event.status === "rescored",
      );
      assert.deepEqual(rescoredEvent, {
        kind: "progress",
        row: 2,
        status: "rescored",
        fitScore: 8,
        band: "Strong",
      });
      assert.deepEqual(events.at(-1), { kind: "done", ...result });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("POST /profile/rescore provider validation", () => {
  it("returns llm_not_configured for selected OpenRouter before opening SSE", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "jobbored-rescore-provider-"));
    const profilePath = join(tmpDir, "profile.json");
    writeFileSync(profilePath, JSON.stringify(sampleProfile(), null, 2));
    const port = 38800 + Math.floor(Math.random() * 100);
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn("node", ["index.mjs"], {
      cwd: resolve("server"),
      env: {
        ...process.env,
        PORT: String(port),
        LISTEN_HOST: "127.0.0.1",
        JOBBORED_PROFILE_PATH: profilePath,
        HOME: tmpDir,
        USERPROFILE: tmpDir,
        PROFILE_RESCORE_PROVIDER: "openrouter",
        PROFILE_RESCORE_OPENROUTER_API_KEY: "",
        ATS_OPENROUTER_API_KEY: "",
        OPENROUTER_API_KEY: "",
        GEMINI_API_KEY: "",
        ATS_GEMINI_API_KEY: "",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    try {
      for (let i = 0; i < 30; i += 1) {
        const probe = await fetch(`${baseUrl}/health`).catch(() => null);
        if (probe?.ok) break;
        await sleep(200);
      }
      const ready = await fetch(`${baseUrl}/health`).catch(() => null);
      assert.equal(ready?.ok, true, stderr);

      const response = await fetch(`${baseUrl}/profile/rescore`, { method: "POST" });
      assert.equal(response.status, 503);
      assert.match(response.headers.get("content-type") || "", /application\/json/);
      const payload = await response.json();
      assert.equal(payload.ok, false);
      assert.equal(payload.reason, "llm_not_configured");
      assert.equal(payload.provider, "openrouter");
      assert.match(payload.detail, /OpenRouter API key/);
      assert.doesNotMatch(payload.detail, /Gemini/);
    } finally {
      if (!child.killed) child.kill();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
