import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const verifySource = readFileSync(
  join(repoRoot, "discovery-wizard-verify.js"),
  "utf8",
);

/**
 * Loads discovery-wizard-verify.js inside an isolated vm context with a fake
 * window + a controllable fetch mock. The IIFE attaches its API to
 * window.JobBoredDiscoveryWizard.verify, which we hand back to the test.
 */
function loadVerifier({ fetchImpl }) {
  const captured = { calls: [] };
  const fakeWindow = {
    JobBoredDiscoveryWizard: {},
    JobBoredDiscoveryHelpers: {},
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
  };
  const wrappedFetch = async (url, init) => {
    captured.calls.push({ url, init });
    return fetchImpl(url, init);
  };

  const context = vm.createContext({
    window: fakeWindow,
    fetch: wrappedFetch,
    AbortController:
      typeof AbortController !== "undefined" ? AbortController : undefined,
    URL,
    URLSearchParams,
    JSON,
    Number,
    Boolean,
    String,
    Object,
    Array,
    Set,
    Map,
    console,
  });

  vm.runInContext(verifySource, context);
  return {
    verify: fakeWindow.JobBoredDiscoveryWizard.verify,
    captured,
  };
}

const ACCEPTED_ASYNC_BODY = JSON.stringify({
  ok: true,
  kind: "accepted_async",
  runId: "run_test",
  message: "Discovery accepted — worker queued the run.",
  statusPath: "/runs/run_test",
  pollAfterMs: 2000,
});

function makeFetchResponse(body, status = 202) {
  return Promise.resolve({
    status,
    url: "",
    headers: {
      get: () => "application/json",
    },
    text: async () => body,
  });
}

describe("discovery-wizard-verify x-discovery-secret header", () => {
  it("attaches the secret header when options.secret is provided", async () => {
    const { verify, captured } = loadVerifier({
      fetchImpl: () => makeFetchResponse(ACCEPTED_ASYNC_BODY, 202),
    });
    const result = await verify.verifyDiscoveryEndpoint(
      "https://relay.example.workers.dev/",
      {
        sheetId: "sheet_abc",
        secret: "test-secret-xyz",
      },
    );

    assert.equal(captured.calls.length, 1);
    const headers = captured.calls[0].init.headers;
    assert.equal(
      headers["x-discovery-secret"],
      "test-secret-xyz",
      "secret should be sent as x-discovery-secret",
    );
    assert.equal(result.ok, true, "verifier should report success");
    assert.equal(result.httpStatus, 202);
  });

  it("omits the secret header when no secret is provided", async () => {
    const { verify, captured } = loadVerifier({
      fetchImpl: () => makeFetchResponse(ACCEPTED_ASYNC_BODY, 202),
    });
    await verify.verifyDiscoveryEndpoint(
      "https://relay.example.workers.dev/",
      { sheetId: "sheet_abc" },
    );
    const headers = captured.calls[0].init.headers;
    assert.equal(
      Object.prototype.hasOwnProperty.call(headers, "x-discovery-secret"),
      false,
      "should not send an empty secret header",
    );
  });

  it("trims whitespace and treats blank secrets as absent", async () => {
    const { verify, captured } = loadVerifier({
      fetchImpl: () => makeFetchResponse(ACCEPTED_ASYNC_BODY, 202),
    });
    await verify.verifyDiscoveryEndpoint(
      "https://relay.example.workers.dev/",
      { sheetId: "sheet_abc", secret: "   " },
    );
    const headers = captured.calls[0].init.headers;
    assert.equal(
      Object.prototype.hasOwnProperty.call(headers, "x-discovery-secret"),
      false,
      "blank-only secret should not be sent",
    );
  });

  it("classifies the worker's 401 as auth_required (not generic invalid_endpoint)", async () => {
    const { verify } = loadVerifier({
      fetchImpl: () =>
        makeFetchResponse(
          JSON.stringify({
            ok: false,
            message: "Unauthorized discovery webhook request.",
          }),
          401,
        ),
    });
    const result = await verify.verifyDiscoveryEndpoint(
      "https://relay.example.workers.dev/",
      { sheetId: "sheet_abc", secret: "wrong-secret" },
    );
    assert.equal(result.ok, false);
    assert.equal(result.httpStatus, 401);
    assert.equal(
      result.kind,
      "auth_required",
      "401 with the worker's specific message must be auth_required so the toast can show a fix-it action",
    );
    assert.equal(result.suggestedCommand, "npm run discovery:bootstrap-local");
    assert.match(result.detail || "", /secret/i);
  });

  it("classifies a 401 from a non-relay endpoint with auth_required too", async () => {
    const { verify } = loadVerifier({
      fetchImpl: () =>
        makeFetchResponse(
          JSON.stringify({
            ok: false,
            message: "Unauthorized discovery webhook request.",
          }),
          401,
        ),
    });
    // Apps Script-shaped URL — not a Worker, so verifier classifies as upstream
    const result = await verify.verifyDiscoveryEndpoint(
      "https://script.google.com/macros/s/abc123/exec",
      { sheetId: "sheet_abc", secret: "wrong-secret" },
    );
    assert.equal(result.kind, "auth_required");
    assert.equal(result.layer, "upstream");
  });

  it("does not misclassify a generic 401 without the worker message as auth_required", async () => {
    const { verify } = loadVerifier({
      fetchImpl: () =>
        makeFetchResponse(
          JSON.stringify({
            ok: false,
            message: "Some other 401 from a different receiver",
          }),
          401,
        ),
    });
    const result = await verify.verifyDiscoveryEndpoint(
      "https://relay.example.workers.dev/",
      { sheetId: "sheet_abc", secret: "wrong-secret" },
    );
    // Should fall through to the generic invalid_endpoint branch, not auth_required.
    assert.notEqual(result.kind, "auth_required");
  });
});
