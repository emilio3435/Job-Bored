import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadVerifyHarness({ location, fetchImpl } = {}) {
  const source = await readFile(
    join(repoRoot, "discovery-wizard-verify.js"),
    "utf8",
  );
  const window = {
    setTimeout,
    clearTimeout,
    location:
      location ||
      {
        hostname: "app.example.com",
        port: "",
      },
  };
  const context = {
    window,
    fetch:
      fetchImpl ||
      (async () => {
        throw new Error("Unexpected fetch");
      }),
    URL,
    AbortController,
    console,
    Response,
  };
  vm.runInNewContext(source, context, {
    filename: "discovery-wizard-verify.js",
  });
  return context.window.JobBoredDiscoveryWizard.verify;
}

describe("discovery wizard verifier localhost handling", () => {
  it("rejects localhost webhook URLs from non-local dashboard origins", async () => {
    const verify = await loadVerifyHarness();
    const result = verify.classifyEndpointInput(
      "http://127.0.0.1:8644/webhook",
    );
    assert.equal(result.kind, "invalid_endpoint");
    assert.match(result.message, /Localhost URLs won't work here/);
  });

  it("allows localhost webhook URLs when the dashboard itself is local", async () => {
    const verify = await loadVerifyHarness({
      location: {
        hostname: "localhost",
        port: "8080",
      },
    });
    const result = verify.classifyEndpointInput(
      "http://127.0.0.1:8644/webhook",
    );
    assert.equal(result, null);
  });

  it("posts to localhost and accepts async worker responses from local dashboard origins", async () => {
    let requestedUrl = "";
    const verify = await loadVerifyHarness({
      location: {
        hostname: "localhost",
        port: "8080",
      },
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            ok: true,
            accepted: true,
            runId: "run_localhost_verify",
            statusPath: "/runs/run_localhost_verify",
            pollAfterMs: 100,
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await verify.verifyDiscoveryEndpoint(
      "http://127.0.0.1:8644/webhook",
      {
        context: "run_discovery",
        payload: {
          event: "command-center.discovery",
          schemaVersion: 1,
          sheetId: "sheet_abc123",
          requestedAt: "2026-04-21T00:00:00.000Z",
        },
      },
    );

    assert.equal(requestedUrl, "http://127.0.0.1:8644/webhook");
    assert.equal(result.ok, true);
    assert.equal(result.kind, "accepted_async");
    assert.equal(result.runId, "run_localhost_verify");
  });
});

describe("discovery wizard verifier webhook-secret auth classification", () => {
  it("classifies missing_secret_header 401 as auth_required", async () => {
    const verify = await loadVerifyHarness();
    const result = verify.summarizeResult({
      context: "test_webhook",
      status: 401,
      data: {
        ok: false,
        message: "x-discovery-secret header is missing from the request.",
        auth: {
          category: "missing_secret_header",
          detail: "x-discovery-secret header is missing from the request.",
        },
      },
      responseText:
        '{"ok":false,"message":"x-discovery-secret header is missing from the request.","auth":{"category":"missing_secret_header"}}',
      responseUrl: "https://host.taild4cbb2.ts.net/webhook",
      endpointUrl: "https://host.taild4cbb2.ts.net/webhook",
    });

    assert.equal(result.kind, "auth_required");
    assert.equal(result.ok, false);
    assert.equal(result.httpStatus, 401);
    assert.match(result.message, /webhook secret/i);
  });

  it("classifies no_secret_configured 401 as auth_required", async () => {
    const verify = await loadVerifyHarness();
    const result = verify.summarizeResult({
      context: "test_webhook",
      status: 401,
      data: {
        ok: false,
        message: "Webhook secret is not configured on the worker.",
        auth: { category: "no_secret_configured" },
      },
      responseText: "",
      responseUrl: "https://host.taild4cbb2.ts.net/webhook",
      endpointUrl: "https://host.taild4cbb2.ts.net/webhook",
    });

    assert.equal(result.kind, "auth_required");
  });

  it("still classifies secret_mismatch 401 as auth_required", async () => {
    const verify = await loadVerifyHarness();
    const result = verify.summarizeResult({
      context: "test_webhook",
      status: 401,
      data: {
        ok: false,
        message: "Unauthorized discovery webhook request.",
        auth: { category: "secret_mismatch" },
      },
      responseText: "",
      responseUrl: "https://host.taild4cbb2.ts.net/webhook",
      endpointUrl: "https://host.taild4cbb2.ts.net/webhook",
    });

    assert.equal(result.kind, "auth_required");
  });
});
