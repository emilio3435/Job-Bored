import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleSource = readFileSync(
  join(__dirname, "..", "setup-doctor.js"),
  "utf8",
);

/**
 * The setup-doctor module attaches to `window`. To test it without a real
 * browser we evaluate the source in a fresh sandbox per test, exposing a
 * fake window where we can plant test doubles for accessToken, getOAuthClientId,
 * fetch, etc.
 */
function loadDoctor(env = {}) {
  const win = Object.assign(
    {
      gisLoaded: false,
      gisInitStartedAt: 0,
      accessToken: "",
      getOAuthClientId: () => "",
      getSheetId: () => "",
      location: { hostname: "localhost", origin: "http://localhost:8080" },
      navigator: { clipboard: { writeText: async () => {} } },
      document: {
        createElement: () => ({ appendChild() {}, addEventListener() {} }),
        head: { appendChild() {} },
        querySelector: () => null,
      },
      fetch: () => Promise.reject(new Error("no fetch in sandbox")),
      open: () => null,
      showToast: () => {},
      console,
      setTimeout,
    },
    env,
  );
  // Run the IIFE against our fake window.
  const wrapper = new Function(
    "window",
    "globalThis",
    "module",
    moduleSource +
      "\n;return window.SetupDoctor || (typeof module !== 'undefined' ? module.exports : null);",
  );
  const fakeModule = { exports: null };
  const api = wrapper(win, win, fakeModule);
  return { api, win };
}

describe("SetupDoctor.diagnose", () => {
  it("returns no issues when nothing is wrong", async () => {
    const { api } = loadDoctor();
    const report = await api.diagnose({});
    // No globals point at trouble; expect zero or only async-detected issues = 0
    assert.equal(Array.isArray(report.issues), true);
    assert.equal(report.issues.length, 0);
  });

  it("detects insufficient scope from a Sheets API error string", async () => {
    const { api } = loadDoctor();
    const report = await api.diagnose({
      lastError: "insufficient authentication scopes",
    });
    const ids = report.issues.map((i) => i.id);
    assert.ok(ids.includes("insufficient_scope"));
  });

  it("detects origin_mismatch from OAuth error payloads", async () => {
    const { api } = loadDoctor();
    const report = await api.diagnose({
      lastError: { type: "popup_failed", message: "origin_mismatch" },
    });
    const ids = report.issues.map((i) => i.id);
    assert.ok(ids.includes("origin_mismatch"));
  });

  it("detects ngrok rotation from a diagnosis context", async () => {
    const { api } = loadDoctor();
    const report = await api.diagnose({
      diagnosis: {
        tunnel: { stale: true, status: "stale_url" },
        relay: { targetMismatch: true },
      },
    });
    const ids = report.issues.map((i) => i.id);
    assert.ok(ids.includes("ngrok_rotated"));
  });

  it("flags GIS as stuck after the 8s threshold", async () => {
    const { api } = loadDoctor({
      getOAuthClientId: () =>
        "test.apps.googleusercontent.com",
      gisLoaded: false,
      gisInitStartedAt: Date.now() - 9000,
    });
    const report = await api.diagnose({});
    const ids = report.issues.map((i) => i.id);
    assert.ok(ids.includes("gis_stuck"));
  });
});

describe("SetupDoctor.autoHeal", () => {
  it("calls /__proxy/fix-setup for an ngrok rotation on localhost", async () => {
    let called = null;
    const { api } = loadDoctor({
      fetch: async (url, init) => {
        called = { url, init };
        return {
          ok: true,
          status: 200,
          async json() {
            return { ok: true, relayRedeployed: true };
          },
        };
      },
    });
    const out = await api.autoHeal({
      ctx: {
        diagnosis: {
          tunnel: { stale: true, status: "stale_url" },
          relay: { targetMismatch: true },
        },
      },
    });
    assert.equal(out.fixed.length, 1);
    assert.equal(out.fixed[0].id, "ngrok_rotated");
    assert.equal(called.url, "/__proxy/fix-setup");
    assert.equal(called.init.method, "POST");
  });

  it("surfaces Cloudflare auth needed and stops for user", async () => {
    const { api } = loadDoctor({
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { ok: true, needsAuth: true };
        },
      }),
    });
    const out = await api.autoHeal({
      ctx: {
        diagnosis: {
          tunnel: { stale: true, status: "stale_url" },
          relay: { targetMismatch: true },
        },
      },
    });
    assert.equal(out.fixed.length, 0);
    assert.ok(out.stoppedForUser);
    assert.equal(out.stoppedForUser.id, "ngrok_rotated");
  });

  it("does not auto-fix ngrok rotation when not on localhost", async () => {
    let fetchCalled = false;
    const { api } = loadDoctor({
      location: { hostname: "example.com", origin: "https://example.com" },
      fetch: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, async json() { return {}; } };
      },
    });
    const out = await api.autoHeal({
      ctx: {
        diagnosis: {
          tunnel: { stale: true, status: "stale_url" },
          relay: { targetMismatch: true },
        },
      },
    });
    assert.equal(fetchCalled, false);
    assert.equal(out.fixed.length, 0);
    assert.ok(out.stoppedForUser);
  });
});

describe("SetupDoctor.handleFailure", () => {
  it("retries the original action after a successful fix", async () => {
    let retryCount = 0;
    const { api } = loadDoctor({
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { ok: true, relayRedeployed: true };
        },
      }),
    });
    const result = await api.handleFailure(
      "ngrok URL changed",
      async () => {
        retryCount += 1;
        return "retried";
      },
      {
        diagnosis: {
          tunnel: { stale: true, status: "stale_url" },
          relay: { targetMismatch: true },
        },
      },
    );
    assert.equal(result.healed, true);
    assert.equal(retryCount, 1);
    assert.equal(result.retryResult, "retried");
  });

  it("returns healed=false when no autofix applies", async () => {
    const { api } = loadDoctor();
    const result = await api.handleFailure("origin_mismatch", async () => {
      throw new Error("should not retry");
    });
    assert.equal(result.healed, false);
  });
});

describe("SetupDoctor gcloud_can_create_oauth", () => {
  it("detects when gcloud is ready and no Client ID is configured", async () => {
    const { api } = loadDoctor({
      getOAuthClientId: () => "",
      installDoctorState: {
        ok: true,
        tools: {
          gcloud: { installed: true, loggedIn: true, version: "1" },
          wrangler: { installed: true, loggedIn: true },
          ngrok: { installed: true, hasAuthToken: true },
          node: { version: "v20", ok: true },
        },
        missing: [],
      },
    });
    const report = await api.diagnose({});
    const ids = report.issues.map((i) => i.id);
    assert.ok(ids.includes("gcloud_can_create_oauth"));
  });

  it("does not fire when a Client ID is already set", async () => {
    const { api } = loadDoctor({
      getOAuthClientId: () => "abc.apps.googleusercontent.com",
      installDoctorState: {
        ok: true,
        tools: {
          gcloud: { installed: true, loggedIn: true },
          wrangler: { installed: true, loggedIn: true },
          ngrok: { installed: true, hasAuthToken: true },
          node: { version: "v20", ok: true },
        },
        missing: [],
      },
    });
    const report = await api.diagnose({});
    const ids = report.issues.map((i) => i.id);
    assert.equal(ids.includes("gcloud_can_create_oauth"), false);
  });

  it("auto-fix calls oauth-bootstrap and applies the returned client id", async () => {
    let appliedId = null;
    const seen = [];
    const { api } = loadDoctor({
      getOAuthClientId: () => "",
      installDoctorState: {
        tools: { gcloud: { installed: true, loggedIn: true } },
      },
      applyOAuthClientChange: (id) => {
        appliedId = id;
        return true;
      },
      fetch: async (url, init) => {
        seen.push({ url, init });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              clientId: "new123.apps.googleusercontent.com",
              source: "gcloud",
            };
          },
        };
      },
    });
    const out = await api.autoHeal({});
    assert.equal(out.fixed.length, 1);
    assert.equal(out.fixed[0].id, "gcloud_can_create_oauth");
    assert.equal(seen[0].url, "/__proxy/oauth-bootstrap");
    assert.equal(seen[0].init.method, "POST");
    assert.equal(appliedId, "new123.apps.googleusercontent.com");
  });

  it("returns ok:false when oauth-bootstrap is 501 (Phase 1 stub)", async () => {
    const { api } = loadDoctor({
      getOAuthClientId: () => "",
      installDoctorState: {
        tools: { gcloud: { installed: true, loggedIn: true } },
      },
      fetch: async () => ({
        ok: false,
        status: 501,
        async json() {
          return { ok: false, reason: "not_implemented" };
        },
      }),
    });
    const out = await api.autoHeal({});
    assert.equal(out.fixed.length, 0);
    assert.ok(out.stoppedForUser);
    assert.equal(out.stoppedForUser.id, "gcloud_can_create_oauth");
  });
});

describe("SetupDoctor keep_alive findings", () => {
  it("detects keep_alive_not_installed when status reports installed:false", async () => {
    const { api } = loadDoctor({
      keepAliveStatusState: { installed: false },
    });
    const report = await api.diagnose({});
    const ids = report.issues.map((i) => i.id);
    assert.ok(ids.includes("keep_alive_not_installed"));
    assert.equal(ids.includes("keep_alive_stale"), false);
  });

  it("does not fire keep-alive findings when status is unknown", async () => {
    const { api } = loadDoctor();
    const report = await api.diagnose({});
    const ids = report.issues.map((i) => i.id);
    assert.equal(ids.includes("keep_alive_not_installed"), false);
    assert.equal(ids.includes("keep_alive_stale"), false);
  });

  it("auto-fix posts to install-keep-alive", async () => {
    let seen = null;
    const { api } = loadDoctor({
      keepAliveStatusState: { installed: false },
      fetch: async (url, init) => {
        seen = { url, init };
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              installedAt: "2026-05-06T12:00:00Z",
              jobLabel: "ai.jobbored.keep-alive",
              logPath: "/tmp/x.log",
            };
          },
        };
      },
    });
    const out = await api.autoHeal({});
    assert.equal(out.fixed.length, 1);
    assert.equal(out.fixed[0].id, "keep_alive_not_installed");
    assert.equal(seen.url, "/__proxy/install-keep-alive");
    assert.equal(seen.init.method, "POST");
  });

  it("detects keep_alive_stale when lastRunAt is older than the threshold", async () => {
    const old = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { api } = loadDoctor({
      keepAliveStatusState: { installed: true, lastRunAt: old },
    });
    const report = await api.diagnose({});
    const ids = report.issues.map((i) => i.id);
    assert.ok(ids.includes("keep_alive_stale"));
    assert.equal(ids.includes("keep_alive_not_installed"), false);
  });

  it("does not flag keep_alive_stale when lastRunAt is recent", async () => {
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    const { api } = loadDoctor({
      keepAliveStatusState: { installed: true, lastRunAt: recent },
    });
    const report = await api.diagnose({});
    const ids = report.issues.map((i) => i.id);
    assert.equal(ids.includes("keep_alive_stale"), false);
  });

  it("auto-fix for keep_alive_stale issues a DELETE then POST", async () => {
    const calls = [];
    const old = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { api } = loadDoctor({
      keepAliveStatusState: { installed: true, lastRunAt: old },
      fetch: async (url, init) => {
        calls.push({ url, method: init && init.method });
        if (init && init.method === "DELETE") {
          return {
            ok: true,
            status: 200,
            async json() {
              return { ok: true, removed: true };
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              installedAt: new Date().toISOString(),
              jobLabel: "ai.jobbored.keep-alive",
            };
          },
        };
      },
    });
    const out = await api.autoHeal({});
    assert.equal(out.fixed.length, 1);
    assert.equal(out.fixed[0].id, "keep_alive_stale");
    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[0].url, "/__proxy/install-keep-alive");
    assert.equal(calls[1].url, "/__proxy/install-keep-alive");
  });
});

describe("SetupDoctor pipeline tab repair", () => {
  it("detects a missing Pipeline tab via Sheets metadata", async () => {
    const { api } = loadDoctor({
      accessToken: "tok",
      getSheetId: () => "SHEET",
      fetch: async (url) => {
        if (String(url).includes("?fields=")) {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                sheets: [
                  { properties: { title: "OtherTab", sheetId: 1 } },
                ],
              };
            },
          };
        }
        return { ok: false, status: 404, async json() { return {}; } };
      },
    });
    const report = await api.diagnose({});
    const ids = report.issues.map((i) => i.id);
    assert.ok(ids.includes("pipeline_tab_missing"));
  });

  it("detects wrong headers when first columns mismatch", async () => {
    const { api } = loadDoctor({
      accessToken: "tok",
      getSheetId: () => "SHEET",
      fetch: async (url) => {
        if (String(url).includes("?fields=")) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { sheets: [{ properties: { title: "Pipeline", sheetId: 0 } }] };
            },
          };
        }
        if (String(url).includes("/values/Pipeline!A1:Z1")) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { values: [["Wrong", "Headers", "Here"]] };
            },
          };
        }
        return { ok: false, status: 404, async json() { return {}; } };
      },
    });
    const report = await api.diagnose({});
    const ids = report.issues.map((i) => i.id);
    assert.ok(ids.includes("pipeline_headers_wrong"));
  });
});
