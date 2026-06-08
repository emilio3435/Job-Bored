import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDiscoveryWorkerEnv,
  killFullBootStalePorts,
  startDevServer,
} from "../dev-server.mjs";
import { applyAtsProviderAliases } from "../scripts/lib/llm-env.mjs";

const SILENT_LOGGER = {
  log() {},
  error() {},
};

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("/__proxy/fix-setup endpoint", () => {
  it("responds to OPTIONS with CORS headers", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__proxy/fix-setup`, {
        method: "OPTIONS",
      });
      assert.equal(res.status, 204);
      assert.ok(res.headers.get("access-control-allow-origin"));
    } finally {
      await closeServer(server);
    }
  });

  it("rejects non-POST methods with 404", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__proxy/fix-setup`, {
        method: "GET",
      });
      assert.equal(res.status, 404);
    } finally {
      await closeServer(server);
    }
  });
});

describe("/__proxy/start-discovery-worker endpoint", () => {
  it("does not mask the packaged worker env file with an empty Gemini key", () => {
    const env = buildDiscoveryWorkerEnv(8644, {});
    assert.equal(Object.hasOwn(env, "BROWSER_USE_DISCOVERY_GEMINI_API_KEY"), false);
  });

  it("normalizes Gemini aliases when the parent process provides one", () => {
    const env = buildDiscoveryWorkerEnv(8644, {
      ATS_GEMINI_API_KEY: "ats-gemini-key",
    });
    assert.equal(env.BROWSER_USE_DISCOVERY_GEMINI_API_KEY, "ats-gemini-key");
  });

  it("propagates OpenRouter worker chat env without enabling Gemini tools", () => {
    const env = buildDiscoveryWorkerEnv(8644, {
      BROWSER_USE_DISCOVERY_LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "sk-or-test",
      OPENROUTER_MODEL: "vendor/model:free",
      OPENROUTER_BASE_URL: "https://router.example/api/v1",
    });
    assert.equal(env.BROWSER_USE_DISCOVERY_LLM_PROVIDER, "openrouter");
    assert.equal(env.BROWSER_USE_DISCOVERY_LLM_API_KEY, "sk-or-test");
    assert.equal(env.BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY, "sk-or-test");
    assert.equal(env.BROWSER_USE_DISCOVERY_LLM_MODEL, "vendor/model:free");
    assert.equal(env.BROWSER_USE_DISCOVERY_OPENROUTER_MODEL, "vendor/model:free");
    assert.equal(env.BROWSER_USE_DISCOVERY_LLM_BASE_URL, "https://router.example/api/v1");
    assert.equal(
      env.BROWSER_USE_DISCOVERY_OPENROUTER_BASE_URL,
      "https://router.example/api/v1",
    );
    assert.equal(Object.hasOwn(env, "BROWSER_USE_DISCOVERY_GEMINI_API_KEY"), false);
  });

  it("derives worker OpenRouter chat env from ATS aliases", () => {
    const env = buildDiscoveryWorkerEnv(8644, {
      ATS_PROVIDER: "openrouter",
      ATS_OPENROUTER_API_KEY: "ats-or-key",
      ATS_OPENROUTER_MODEL: "vendor/ats-model",
      ATS_OPENROUTER_BASE_URL: "https://ats-router.example/v1",
    });
    assert.equal(env.BROWSER_USE_DISCOVERY_LLM_PROVIDER, "openrouter");
    assert.equal(env.BROWSER_USE_DISCOVERY_LLM_API_KEY, "ats-or-key");
    assert.equal(env.BROWSER_USE_DISCOVERY_OPENROUTER_API_KEY, "ats-or-key");
    assert.equal(env.BROWSER_USE_DISCOVERY_LLM_MODEL, "vendor/ats-model");
    assert.equal(env.BROWSER_USE_DISCOVERY_LLM_BASE_URL, "https://ats-router.example/v1");
  });

  it("responds to OPTIONS with CORS headers", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/__proxy/start-discovery-worker`,
        { method: "OPTIONS" },
      );
      assert.equal(res.status, 204);
      assert.ok(res.headers.get("access-control-allow-origin"));
    } finally {
      await closeServer(server);
    }
  });

  it("starts the local discovery worker through the injected starter", async () => {
    let capturedPort = null;
    const server = await startDevServer({
      port: 0,
      logger: SILENT_LOGGER,
      discoveryWorkerStarter: async ({ port }) => {
        capturedPort = port;
        return { ok: true, started: true, port };
      },
    });
    const port = server.address().port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/__proxy/start-discovery-worker?port=8644`,
        { method: "POST" },
      );
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual(body, { ok: true, started: true, port: 8644 });
      assert.equal(capturedPort, 8644);
    } finally {
      await closeServer(server);
    }
  });
});

describe("local startup LLM env aliasing", () => {
  it("normalizes ATS OpenRouter aliases for scraper startup", () => {
    const env = applyAtsProviderAliases({
      ATS_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "sk-or-test",
      OPENROUTER_MODEL: "vendor/model:free",
      OPENROUTER_BASE_URL: "https://router.example/api/v1",
    });
    assert.equal(env.ATS_PROVIDER, "openrouter");
    assert.equal(env.ATS_OPENROUTER_API_KEY, "sk-or-test");
    assert.equal(env.ATS_OPENROUTER_MODEL, "vendor/model:free");
    assert.equal(env.ATS_OPENROUTER_BASE_URL, "https://router.example/api/v1");
  });

  it("normalizes local OpenAI-compatible aliases for scraper startup", () => {
    const env = applyAtsProviderAliases({
      ATS_PROVIDER: "local",
      BROWSER_USE_DISCOVERY_LOCAL_MODEL: "gemma4:e2b-mlx",
      BROWSER_USE_DISCOVERY_LOCAL_BASE_URL: "http://127.0.0.1:11434/v1",
    });
    assert.equal(env.ATS_PROVIDER, "openai_compatible");
    assert.equal(env.ATS_OPENAI_COMPATIBLE_MODEL, "gemma4:e2b-mlx");
    assert.equal(
      env.ATS_OPENAI_COMPATIBLE_BASE_URL,
      "http://127.0.0.1:11434/v1",
    );
    assert.equal(Object.hasOwn(env, "ATS_GEMINI_API_KEY"), false);
  });
});

describe("/__proxy/discovery-state endpoint", () => {
  it("reports the current dashboard origin so setup can repair CORS", async () => {
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/__proxy/discovery-state`,
        { method: "GET" },
      );
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.worker.dashboardOrigin, `http://127.0.0.1:${port}`);
    } finally {
      await closeServer(server);
    }
  });
});

describe("full-boot stale port cleanup", () => {
  it("skips the managed discovery worker when it is already healthy on 8644", async () => {
    const killedPids = [];
    const result = await killFullBootStalePorts({
      ports: [8644, 4040],
      healthyDiscoveryWorkerPort: 8644,
      currentPid: 100,
      waitAfterKillMs: 0,
      findProcesses: (port) =>
        port === 8644
          ? [
              {
                pid: 200,
                command: "node --experimental-strip-types integrations/browser-use-discovery/src/server.ts",
              },
            ]
          : [],
      killPid: (pid) => {
        killedPids.push(pid);
      },
    });

    assert.equal(result.killed, 0);
    assert.equal(result.skippedHealthyWorker, true);
    assert.deepEqual(result.killedProcesses, []);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(killedPids, []);
  });

  it("still kills known JobBored listeners when the discovery worker is not healthy", async () => {
    const killedPids = [];
    const result = await killFullBootStalePorts({
      ports: [8644, 4040],
      workerPort: 8644,
      healthyDiscoveryWorkerPort: null,
      currentPid: 100,
      waitAfterKillMs: 0,
      findProcesses: (port) => {
        if (port === 8644) {
          return [
            {
              pid: 200,
              command: "node --experimental-strip-types integrations/browser-use-discovery/src/server.ts",
            },
          ];
        }
        if (port === 4040) {
          return [{ pid: 300, command: "ngrok http 8644" }];
        }
        return [];
      },
      killPid: (pid) => {
        killedPids.push(pid);
      },
    });

    assert.equal(result.killed, 2);
    assert.equal(result.skippedHealthyWorker, false);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(killedPids, [200, 300]);
  });

  it("reports foreign listeners instead of killing them", async () => {
    const killedPids = [];
    const result = await killFullBootStalePorts({
      ports: [8644],
      workerPort: 8644,
      healthyDiscoveryWorkerPort: null,
      currentPid: 100,
      waitAfterKillMs: 0,
      findProcesses: () => [{ pid: 200, command: "python -m http.server 8644" }],
      killPid: (pid) => {
        killedPids.push(pid);
      },
    });

    assert.equal(result.killed, 0);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].pid, 200);
    assert.match(result.blocked[0].command, /python/);
    assert.deepEqual(killedPids, []);
  });
});
