/**
 * Unit tests for discovery-autodetect.js
 *
 * Loads the browser module into a synthetic `window` and tests the
 * `recoverIfPossible()` flow with a fetch-mock for /__proxy/discovery-state
 * and /__proxy/full-boot.
 *
 * Lane: feat/discovery-autodetect-silent-recover
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleSrc = readFileSync(
  join(repoRoot, "discovery-autodetect.js"),
  "utf8",
);

/**
 * Build a synthetic browser-ish global, evaluate the module, return the
 * attached `window.JobBoredDiscoveryAutodetect` plus the call log so tests
 * can inspect what fetch was called with.
 */
function loadModule({
  hostname = "localhost",
  fetchHandler,
} = {}) {
  const calls = [];
  const fakeWindow = {
    location: { hostname },
  };
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, init });
    return fetchHandler(url, init);
  };

  // Evaluate the module body in a sandbox with our window/fetch.
  const fn = new Function(
    "window",
    "fetch",
    "AbortController",
    "setTimeout",
    "clearTimeout",
    "console",
    moduleSrc,
  );
  fn(
    fakeWindow,
    fakeFetch,
    globalThis.AbortController,
    globalThis.setTimeout,
    globalThis.clearTimeout,
    { warn() {}, error() {}, log() {} },
  );

  return {
    api: fakeWindow.JobBoredDiscoveryAutodetect,
    calls,
    fakeWindow,
  };
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

describe("discovery-autodetect", () => {
  describe("isLocalDashboard", () => {
    it("returns true for localhost", () => {
      const { api } = loadModule({
        hostname: "localhost",
        fetchHandler: async () => jsonResponse(200, {}),
      });
      assert.equal(api._isLocalDashboard(), true);
    });
    it("returns true for 127.0.0.1", () => {
      const { api } = loadModule({
        hostname: "127.0.0.1",
        fetchHandler: async () => jsonResponse(200, {}),
      });
      assert.equal(api._isLocalDashboard(), true);
    });
    it("returns false for hosted dashboards", () => {
      const { api } = loadModule({
        hostname: "jobbored.example.com",
        fetchHandler: async () => jsonResponse(200, {}),
      });
      assert.equal(api._isLocalDashboard(), false);
    });
  });

  describe("classify", () => {
    it("treats recommendation:'ready' as ready", () => {
      const { api } = loadModule({ fetchHandler: async () => jsonResponse(200, {}) });
      const v = api.classify({ recommendation: "ready" });
      assert.equal(v.ready, true);
      assert.equal(v.recommendation, "ready");
    });
    it("treats recommendation:'auto_recoverable' as not-ready, recoverable", () => {
      const { api } = loadModule({ fetchHandler: async () => jsonResponse(200, {}) });
      const v = api.classify({
        recommendation: "auto_recoverable",
        recoverableHint: "ngrok_rotated",
      });
      assert.equal(v.ready, false);
      assert.equal(v.recommendation, "auto_recoverable");
      assert.equal(v.hint, "ngrok_rotated");
    });
    it("falls through to needs_human for unknown recommendations", () => {
      const { api } = loadModule({ fetchHandler: async () => jsonResponse(200, {}) });
      const v = api.classify({ recommendation: "weird" });
      assert.equal(v.ready, false);
      assert.equal(v.recommendation, "needs_human");
    });
    it("treats null state as needs_human", () => {
      const { api } = loadModule({ fetchHandler: async () => jsonResponse(200, {}) });
      const v = api.classify(null);
      assert.equal(v.ready, false);
      assert.equal(v.recommendation, "needs_human");
    });
  });

  describe("recoverIfPossible", () => {
    it("returns ready when probe returns ready — no recovery call", async () => {
      const { api, calls } = loadModule({
        fetchHandler: async (url) => {
          if (url === "/__proxy/discovery-state") {
            return jsonResponse(200, {
              ok: true,
              recommendation: "ready",
              worker: { up: true, port: 8644 },
              ngrok: { up: true, url: "https://abc.ngrok.app" },
              relay: { reachable: true },
            });
          }
          throw new Error("unexpected url: " + url);
        },
      });
      const v = await api.recoverIfPossible();
      assert.equal(v.ready, true);
      assert.equal(v.recommendation, "ready");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "/__proxy/discovery-state");
    });

    it("runs full-boot then re-probes when recommendation is auto_recoverable", async () => {
      let probeCount = 0;
      const { api, calls } = loadModule({
        fetchHandler: async (url) => {
          if (url === "/__proxy/discovery-state") {
            probeCount += 1;
            if (probeCount === 1) {
              return jsonResponse(200, {
                ok: true,
                recommendation: "auto_recoverable",
                recoverableHint: "ngrok_rotated",
                worker: { up: true, port: 8644 },
                ngrok: { up: true, url: "https://new.ngrok.app" },
                relay: { reachable: false },
              });
            }
            return jsonResponse(200, {
              ok: true,
              recommendation: "ready",
              worker: { up: true, port: 8644 },
              ngrok: { up: true, url: "https://new.ngrok.app" },
              relay: { reachable: true },
            });
          }
          if (url === "/__proxy/full-boot") {
            return jsonResponse(200, { ok: true, phases: [] });
          }
          throw new Error("unexpected url: " + url);
        },
      });
      const v = await api.recoverIfPossible();
      assert.equal(v.ready, true, "should be ready after recovery");
      assert.equal(probeCount, 2, "should probe twice (before + after)");
      assert.ok(
        calls.some((c) => c.url === "/__proxy/full-boot" && c.init.method === "POST"),
        "full-boot must have been POSTed",
      );
    });

    it("does not loop: if recovery still reports auto_recoverable, returns needs_human", async () => {
      const { api } = loadModule({
        fetchHandler: async (url) => {
          if (url === "/__proxy/discovery-state") {
            return jsonResponse(200, {
              ok: true,
              recommendation: "auto_recoverable",
              recoverableHint: "ngrok_rotated",
            });
          }
          if (url === "/__proxy/full-boot") {
            return jsonResponse(200, { ok: true });
          }
          throw new Error("unexpected url: " + url);
        },
      });
      const v = await api.recoverIfPossible();
      assert.equal(v.ready, false);
      assert.equal(v.recommendation, "needs_human");
    });

    it("returns recommendation:'unknown' when probe is unreachable", async () => {
      const { api } = loadModule({
        fetchHandler: async () => {
          throw new TypeError("network");
        },
      });
      const v = await api.recoverIfPossible();
      assert.equal(v.ready, false);
      assert.equal(v.recommendation, "unknown");
    });

    it("returns unknown on 501 (older dev-server)", async () => {
      const { api } = loadModule({
        fetchHandler: async () => jsonResponse(501, { ok: false, reason: "not_implemented" }),
      });
      const v = await api.recoverIfPossible();
      assert.equal(v.recommendation, "unknown");
    });

    it("on hosted dashboards (non-localhost), probe short-circuits to unknown", async () => {
      const { api, calls } = loadModule({
        hostname: "dashboard.example.com",
        fetchHandler: async () => jsonResponse(200, { recommendation: "ready" }),
      });
      const v = await api.recoverIfPossible();
      assert.equal(v.recommendation, "unknown");
      assert.equal(calls.length, 0, "must not probe on hosted dashboards");
    });

    it("respects allowRecover:false — returns auto_recoverable without calling full-boot", async () => {
      const { api, calls } = loadModule({
        fetchHandler: async (url) => {
          if (url === "/__proxy/discovery-state") {
            return jsonResponse(200, {
              ok: true,
              recommendation: "auto_recoverable",
              recoverableHint: "worker_down",
            });
          }
          throw new Error("unexpected url: " + url);
        },
      });
      const v = await api.recoverIfPossible({ allowRecover: false });
      assert.equal(v.recommendation, "auto_recoverable");
      assert.ok(
        !calls.some((c) => c.url === "/__proxy/full-boot"),
        "must not call full-boot when allowRecover is false",
      );
    });
  });

  describe("cache", () => {
    it("getCachedState returns null when nothing has been probed yet", () => {
      const { api } = loadModule({ fetchHandler: async () => jsonResponse(200, {}) });
      assert.equal(api.getCachedState(), null);
    });

    it("clearCache wipes the cache", async () => {
      const { api } = loadModule({
        fetchHandler: async () =>
          jsonResponse(200, { ok: true, recommendation: "ready" }),
      });
      await api.probeState();
      assert.ok(api.getCachedState());
      api.clearCache();
      assert.equal(api.getCachedState(), null);
    });
  });
});
