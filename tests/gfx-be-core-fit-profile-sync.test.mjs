import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   GFX BE-CORE · N-B4-1 (P0) + N-B4-2 — the profile reaches the server.

   On a greenfield install the config URLs are empty, so the old
   profileApiConfigured() check skipped POST /profile and drafting ran
   blind. fit-profile-sync.js resolves the base through
   JobBoredProfileApi.getProfileApiBase(); "" means same-origin, never
   skip (R7). A 4xx from the server is always surfaced (N-B4-2).
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const syncPath = join(repoRoot, "fit-profile-sync.js");
const LOCAL_ONLY_MESSAGE =
  "Saved on this device. Start JobBored on your computer to use it for drafting.";

function load({ config = {}, protocol = "http:", withProfileApi = true } = {}) {
  assert.ok(existsSync(syncPath), "fit-profile-sync.js must exist");
  const window = {
    COMMAND_CENTER_CONFIG: config,
    location: { protocol },
  };
  const ctx = vm.createContext({ window, console, setTimeout, clearTimeout });
  if (withProfileApi) {
    vm.runInContext(readFileSync(join(repoRoot, "profile-api-base.js"), "utf8"), ctx, {
      filename: "profile-api-base.js",
    });
  }
  vm.runInContext(readFileSync(syncPath, "utf8"), ctx, { filename: "fit-profile-sync.js" });
  assert.ok(window.JobBoredFitProfileSync, "attaches window.JobBoredFitProfileSync");
  return window.JobBoredFitProfileSync;
}

function response(status, body, { json = true } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return /content-type/i.test(name)
          ? json
            ? "application/json; charset=utf-8"
            : "text/html"
          : null;
      },
    },
    async json() {
      if (!json) throw new SyntaxError("Unexpected token <");
      return body;
    },
    async text() {
      return json ? JSON.stringify(body) : String(body);
    },
  };
}

function recorder(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return typeof reply === "function" ? reply(url, init) : reply;
  };
  return { calls, fetchImpl };
}

const PAYLOAD = Object.freeze({
  version: 1,
  identity: { targetRoles: ["PM"], targetSeniority: "any", primaryNarrative: "x".repeat(20) },
  strengths: [{ name: "Strategy", rank: 1 }],
  hardConstraints: { workMode: "any" },
});

// The module runs in its own vm realm; copy the plain result into this one.
function plain(result) {
  return JSON.parse(JSON.stringify(result));
}

describe("N-B4-1 · where the profile goes", () => {
  it("N-B4-1 empty config on an http page POSTs same-origin /profile — never skips (R7)", async () => {
    const sync = load({ config: {} });
    const { calls, fetchImpl } = recorder(response(200, { ok: true, updatedAt: "t" }));
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
    assert.equal(calls.length, 1, "the POST must happen on a greenfield install");
    assert.equal(calls[0].url, "/profile");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].init.body), PAYLOAD);
    assert.equal(result.ok, true);
    assert.equal(result.synced, true);
    assert.equal(result.status, 200);
  });

  it("N-B4-1 a configured API URL is used, trailing slash trimmed", async () => {
    const sync = load({ config: { jobBoredApiUrl: "http://127.0.0.1:3847/" } });
    const { calls, fetchImpl } = recorder(response(200, { ok: true }));
    await sync.syncProfile(PAYLOAD, { fetchImpl });
    assert.equal(calls[0].url, "http://127.0.0.1:3847/profile");
  });

  it("N-B4-1 without profile-api-base.js loaded it still POSTs same-origin rather than skipping", async () => {
    const sync = load({ withProfileApi: false });
    const { calls, fetchImpl } = recorder(response(200, { ok: true }));
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
    assert.equal(calls[0].url, "/profile");
    assert.equal(result.synced, true);
  });
});

describe("N-B4-1 · local-only saves are honest, not errors", () => {
  it("N-B4-1 a network failure is local_only with the drafting message", async () => {
    const sync = load();
    const result = plain(
      await sync.syncProfile(PAYLOAD, {
        fetchImpl: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    );
    assert.deepEqual(
      { ok: result.ok, synced: result.synced, reason: result.reason, message: result.message },
      { ok: true, synced: false, reason: "local_only", message: LOCAL_ONLY_MESSAGE },
    );
  });

  for (const status of [404, 405]) {
    it(`N-B4-1 a static host's ${status} (HTML body) is local_only`, async () => {
      const sync = load();
      const { fetchImpl } = recorder(response(status, "<html>Not allowed</html>", { json: false }));
      const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
      assert.equal(result.ok, true);
      assert.equal(result.synced, false);
      assert.equal(result.reason, "local_only");
      assert.equal(result.status, status);
      assert.equal(result.message, LOCAL_ONLY_MESSAGE);
    });
  }

  it("N-B4-1 the dev server's 502 profile_api_unreachable (API not running) is local_only", async () => {
    const sync = load();
    const { fetchImpl } = recorder(response(502, { ok: false, error: "profile_api_unreachable" }));
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
    assert.equal(result.reason, "local_only");
    assert.equal(result.ok, true);
    assert.equal(result.synced, false);
  });

  it("N-B4-1 a 200 that is not the profile API (HTML fallback) is local_only, not synced", async () => {
    const sync = load();
    const { fetchImpl } = recorder(response(200, "<html></html>", { json: false }));
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
    assert.equal(result.synced, false);
    assert.equal(result.reason, "local_only");
  });

  it("N-B4-1 no fetch at all is local_only, never a throw", async () => {
    const sync = load();
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl: null }));
    assert.equal(result.reason, "local_only");
  });
});

describe("N-B4-2 · a 4xx is always surfaced", () => {
  it("N-B4-2 the server's 400 invalid_profile is rejected with its own message", async () => {
    const sync = load();
    const { fetchImpl } = recorder(
      response(400, {
        ok: false,
        reason: "invalid_profile",
        errors: [
          { instancePath: "/identity/targetRoles", message: "must NOT have more than 8 items" },
          { instancePath: "/strengths/0/name", message: "must NOT have more than 60 characters" },
        ],
      }),
    );
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
    assert.equal(result.ok, false, "a rejected profile must never read as saved");
    assert.equal(result.synced, false);
    assert.equal(result.reason, "rejected");
    assert.equal(result.status, 400);
    assert.match(result.message, /\/identity\/targetRoles must NOT have more than 8 items/);
    assert.match(result.message, /\/strengths\/0\/name must NOT have more than 60 characters/);
    assert.equal(result.errors.length, 2, "the raw errors travel for inline mapping");
  });

  it("N-B4-2 a 403 from the origin guard is rejected with the server's message", async () => {
    const sync = load();
    const { fetchImpl } = recorder(response(403, { ok: false, error: "Origin not allowed" }));
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "rejected");
    assert.equal(result.message, "Origin not allowed");
  });

  it("N-B4-2 a 404 carrying our JSON error body is rejected, not mistaken for a static host", async () => {
    const sync = load();
    const { fetchImpl } = recorder(response(404, { ok: false, detail: "No such profile route" }));
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
    assert.equal(result.reason, "rejected");
    assert.equal(result.message, "No such profile route");
  });

  it("N-B4-2 a 4xx without a JSON body is still surfaced, with a plain message", async () => {
    const sync = load();
    const { fetchImpl } = recorder(response(413, "too big", { json: false }));
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "rejected");
    assert.match(result.message, /413/);
  });

  it("N-B4-2 a 200 with ok:false is rejected, never counted as synced", async () => {
    const sync = load();
    const { fetchImpl } = recorder(response(200, { ok: false, reason: "invalid_profile" }));
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "rejected");
  });
});

describe("N-B4-1 · server errors block", () => {
  for (const status of [500, 503]) {
    it(`N-B4-1 a ${status} is server_error`, async () => {
      const sync = load();
      const { fetchImpl } = recorder(
        response(status, { ok: false, reason: "write_failed", detail: "EACCES" }),
      );
      const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
      assert.equal(result.ok, false);
      assert.equal(result.synced, false);
      assert.equal(result.reason, "server_error");
      assert.equal(result.status, status);
      assert.match(result.message, /EACCES/);
    });
  }
});

describe("N-B4-1 · response parsing", () => {
  it("N-B4-1 a JSON reply without a content-type header is still read", async () => {
    const sync = load();
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const result = plain(await sync.syncProfile(PAYLOAD, { fetchImpl }));
    assert.equal(result.synced, true);
  });
});

describe("N-B4-1 · the default fetch", () => {
  it("N-B4-1 with no fetchImpl it calls window.fetch bound to window (a detached fetch throws Illegal invocation)", async () => {
    const calls = [];
    // Load with a window.fetch that enforces its receiver like browsers do.
    const window = { COMMAND_CENTER_CONFIG: {}, location: { protocol: "http:" } };
    window.fetch = function (url) {
      if (this !== window) throw new TypeError("Illegal invocation");
      calls.push(url);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    };
    const ctx = vm.createContext({ window, console, setTimeout, clearTimeout });
    vm.runInContext(readFileSync(syncPath, "utf8"), ctx, { filename: "fit-profile-sync.js" });
    const result = plain(await window.JobBoredFitProfileSync.syncProfile(PAYLOAD));
    assert.deepEqual(calls, ["/profile"]);
    assert.equal(result.synced, true);
  });
});
