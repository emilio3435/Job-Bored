import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelDownloadJs = readFileSync(
  join(repoRoot, "model-download.js"),
  "utf8",
);

/**
 * Load model-download.js in an isolated vm context. The module is a
 * browser-global IIFE that reaches for fetch/URL/TextDecoder — all provided
 * here so the pull/detect logic can be exercised without a real browser.
 */
function loadModelDownload({ fetchImpl } = {}) {
  const ctx = {
    fetch: fetchImpl,
    URL,
    TextDecoder,
    console: { log() {}, warn() {}, error() {} },
    window: {},
  };
  vm.createContext(ctx);
  vm.runInContext(modelDownloadJs, ctx, { filename: "model-download.js" });
  return ctx.window.CommandCenterModelDownload;
}

function makeFetchStub(responder) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return responder({ url, options, callIndex: calls.length - 1 });
  };
  return { fetchImpl, calls };
}

/** Build a streaming Response-like object that yields NDJSON in byte chunks. */
function makeNdjsonStreamResponse(events, { chunkSize = 8, ok = true } = {}) {
  const text = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const bytes = new TextEncoder().encode(text);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(bytes.subarray(i, i + chunkSize));
  }
  let idx = 0;
  return {
    ok,
    status: ok ? 200 : 500,
    body: {
      getReader() {
        return {
          read() {
            if (idx < chunks.length) {
              return Promise.resolve({ value: chunks[idx++], done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    },
  };
}

describe("model-download — getOllamaRoot (derive native API root from base URL)", () => {
  it("strips the OpenAI-compatible /v1 suffix to the http origin", () => {
    const MD = loadModelDownload();
    assert.equal(
      MD.getOllamaRoot("http://127.0.0.1:11434/v1"),
      "http://127.0.0.1:11434",
    );
    assert.equal(
      MD.getOllamaRoot("http://127.0.0.1:11434/v1/"),
      "http://127.0.0.1:11434",
    );
    assert.equal(
      MD.getOllamaRoot("http://localhost:1234/v1"),
      "http://localhost:1234",
    );
  });

  it("falls back to the default Ollama root when base URL is empty/garbage", () => {
    const MD = loadModelDownload();
    assert.equal(MD.getOllamaRoot(""), "http://127.0.0.1:11434");
    assert.equal(MD.getOllamaRoot("not a url"), "http://127.0.0.1:11434");
  });
});

describe("model-download — detectOllama (GET /api/tags)", () => {
  it("reports reachable + installed model names on 200", async () => {
    const { fetchImpl, calls } = makeFetchStub(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [{ name: "gemma4:e2b" }, { name: "llama3.1:8b" }],
      }),
    }));
    const MD = loadModelDownload({ fetchImpl });
    const out = await MD.detectOllama("http://127.0.0.1:11434/v1");
    assert.equal(calls[0].url, "http://127.0.0.1:11434/api/tags");
    assert.equal(out.reachable, true);
    assert.deepEqual([...out.models], ["gemma4:e2b", "llama3.1:8b"]);
  });

  it("reports unreachable when fetch rejects (Ollama not running)", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    const MD = loadModelDownload({ fetchImpl });
    const out = await MD.detectOllama("http://127.0.0.1:11434/v1");
    assert.equal(out.reachable, false);
    assert.equal(out.models.length, 0);
  });

  it("reports unreachable on a non-ok status", async () => {
    const { fetchImpl } = makeFetchStub(() => ({ ok: false, status: 500 }));
    const MD = loadModelDownload({ fetchImpl });
    const out = await MD.detectOllama("http://127.0.0.1:11434/v1");
    assert.equal(out.reachable, false);
  });
});

describe("model-download — hasModelInstalled", () => {
  it("matches exact names and the implicit :latest tag", () => {
    const MD = loadModelDownload();
    assert.equal(MD.hasModelInstalled(["gemma4:e2b"], "gemma4:e2b"), true);
    assert.equal(MD.hasModelInstalled(["mistral:latest"], "mistral"), true);
    assert.equal(MD.hasModelInstalled(["gemma4:e2b"], "gemma4"), false);
    assert.equal(MD.hasModelInstalled(["gemma4:e2b"], "gemma4:e2b-mlx"), false);
    assert.equal(MD.hasModelInstalled([], "gemma4:e2b"), false);
  });
});

describe("model-download — describePullEvent (progress percent)", () => {
  it("computes a clamped integer percent from completed/total", () => {
    const MD = loadModelDownload();
    const mid = MD.describePullEvent({ status: "pulling", completed: 50, total: 200 });
    assert.equal(mid.label, "pulling");
    assert.equal(mid.percent, 25);
    assert.equal(MD.describePullEvent({ status: "verifying" }).percent, null);
    assert.equal(MD.describePullEvent({ status: "x", completed: 5, total: 0 }).percent, null);
  });
});

describe("model-download — pullModel (POST /api/pull, NDJSON stream)", () => {
  const PULL_EVENTS = [
    { status: "pulling manifest" },
    { status: "pulling abc123", completed: 100, total: 400 },
    { status: "pulling abc123", completed: 400, total: 400 },
    { status: "verifying sha256 digest" },
    { status: "success" },
  ];

  it("posts {model, stream:true} to the native /api/pull endpoint", async () => {
    const { fetchImpl, calls } = makeFetchStub(() =>
      makeNdjsonStreamResponse(PULL_EVENTS),
    );
    const MD = loadModelDownload({ fetchImpl });
    await MD.pullModel("http://127.0.0.1:11434/v1", "gemma4:e2b", {});
    assert.equal(calls[0].url, "http://127.0.0.1:11434/api/pull");
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers["Content-Type"], "application/json");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.model, "gemma4:e2b");
    assert.equal(body.stream, true);
  });

  it("streams progress events (with percent) and resolves on terminal success", async () => {
    const { fetchImpl } = makeFetchStub(() =>
      makeNdjsonStreamResponse(PULL_EVENTS, { chunkSize: 5 }),
    );
    const MD = loadModelDownload({ fetchImpl });
    const progress = [];
    const result = await MD.pullModel(
      "http://127.0.0.1:11434/v1",
      "gemma4:e2b",
      { onProgress: (p) => progress.push(p) },
    );
    assert.equal(result.ok, true);
    // Every NDJSON line, even split across byte chunks, parsed into an event.
    assert.equal(progress.length, PULL_EVENTS.length);
    const mid = progress.find((p) => p.completed === 100 && p.total === 400);
    assert.ok(mid, "a mid-download progress event was reported");
    assert.equal(mid.percent, 25);
    assert.equal(progress[progress.length - 1].status, "success");
  });

  it("rejects with an actionable 'start Ollama' message when fetch fails", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    const MD = loadModelDownload({ fetchImpl });
    let caught;
    try {
      await MD.pullModel("http://127.0.0.1:11434/v1", "gemma4:e2b", {});
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "must reject when Ollama is unreachable");
    assert.doesNotMatch(caught.message, /^Failed to fetch$/);
    assert.match(caught.message, /Ollama/i);
    assert.match(caught.message, /127\.0\.0\.1:11434/);
  });

  it("rejects when the server returns a non-ok status", async () => {
    const { fetchImpl } = makeFetchStub(() => ({
      ok: false,
      status: 404,
      json: async () => ({ error: "model not found" }),
    }));
    const MD = loadModelDownload({ fetchImpl });
    await assert.rejects(
      () => MD.pullModel("http://127.0.0.1:11434/v1", "bogus:model", {}),
      /model not found|bogus:model/i,
    );
  });

  it("rejects when an NDJSON line carries an error field", async () => {
    const { fetchImpl } = makeFetchStub(() =>
      makeNdjsonStreamResponse([
        { status: "pulling manifest" },
        { error: "pull model manifest: file does not exist" },
      ]),
    );
    const MD = loadModelDownload({ fetchImpl });
    await assert.rejects(
      () => MD.pullModel("http://127.0.0.1:11434/v1", "gemma4:e2b", {}),
      /file does not exist/i,
    );
  });

  it("rejects when the stream ends without a success event", async () => {
    const { fetchImpl } = makeFetchStub(() =>
      makeNdjsonStreamResponse([
        { status: "pulling manifest" },
        { status: "pulling abc", completed: 10, total: 100 },
      ]),
    );
    const MD = loadModelDownload({ fetchImpl });
    await assert.rejects(
      () => MD.pullModel("http://127.0.0.1:11434/v1", "gemma4:e2b", {}),
      /did not confirm|try again/i,
    );
  });
});

describe("model-download — module surface (reusable for Settings + wizard)", () => {
  it("exposes the reusable control API on window.CommandCenterModelDownload", () => {
    const MD = loadModelDownload();
    for (const fn of [
      "getOllamaRoot",
      "detectOllama",
      "hasModelInstalled",
      "describePullEvent",
      "pullModel",
      "mountDownloadModelControl",
    ]) {
      assert.equal(typeof MD[fn], "function", `${fn} should be exported`);
    }
  });
});
