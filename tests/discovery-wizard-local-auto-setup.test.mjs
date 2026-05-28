import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadLocalApi({ hostname = "localhost", fetchHandler } = {}) {
  const source = await readFile(
    join(repoRoot, "discovery-wizard-local.js"),
    "utf8",
  );
  const calls = [];
  const window = {
    location: { hostname },
    JobBoredDiscoveryWizard: {},
    JobBoredDiscoveryHelpers: {},
    setTimeout,
    clearTimeout,
  };
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return fetchHandler(url, init);
  };
  vm.runInNewContext(
    source,
    {
      window,
      fetch,
      URL,
      AbortController,
      console: { warn() {}, error() {}, log() {} },
    },
    { filename: "discovery-wizard-local.js" },
  );
  return { api: window.JobBoredDiscoveryWizard.local, calls };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

const bootstrapJson = {
  localWebhookUrl: "http://127.0.0.1:8644/webhook",
  localHealthUrl: "http://127.0.0.1:8644/health",
  tunnelPublicUrl: "https://example.ngrok-free.app/",
  publicTargetUrl: "https://example.ngrok-free.app/webhook",
};

describe("discovery wizard local auto setup", () => {
  it("runs the local setup helper when the bootstrap config is missing on localhost", async () => {
    let bootstrapReads = 0;
    const { api, calls } = await loadLocalApi({
      fetchHandler: async (url) => {
        const path = String(url);
        if (path === "discovery-local-bootstrap.json") {
          bootstrapReads += 1;
          return bootstrapReads === 1
            ? jsonResponse(404, {})
            : jsonResponse(200, bootstrapJson);
        }
        if (path === "/__proxy/fix-setup") {
          return jsonResponse(200, {
            ok: true,
            phases: [{ phase: "verified", message: "Setup restored." }],
          });
        }
        throw new Error(`unexpected fetch: ${path}`);
      },
    });

    const result = await api.runLocalWizardAction("local_bootstrap_refresh", {
      snapshot: {},
      wizardState: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.kind, "bootstrap_ready");
    assert.equal(result.nextStepId, "local_health");
    assert.equal(result.bootstrap.localWebhookUrl, bootstrapJson.localWebhookUrl);
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        "discovery-local-bootstrap.json",
        "/__proxy/fix-setup",
        "discovery-local-bootstrap.json",
      ],
    );
  });

  it("keeps hosted dashboards on the manual bootstrap fallback", async () => {
    const { api, calls } = await loadLocalApi({
      hostname: "jobbored.example.com",
      fetchHandler: async (url) => {
        if (String(url) === "discovery-local-bootstrap.json") {
          return jsonResponse(404, {});
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    });

    const result = await api.runLocalWizardAction("local_bootstrap_refresh", {
      snapshot: {},
      wizardState: {},
    });

    assert.equal(result.ok, false);
    assert.equal(result.kind, "bootstrap_missing");
    assert.equal(result.suggestedCommand, "npm run discovery:bootstrap-local");
    assert.deepEqual(
      calls.map((call) => call.url),
      ["discovery-local-bootstrap.json"],
    );
  });
});
