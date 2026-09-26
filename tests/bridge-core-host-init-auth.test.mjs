import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

/* ============================================================
   Beat 1 greenfield GIS init (lane F2) — the bridge must publish
   initAuth on app.core.host.

   oneflow-beat-google.js reaches the host through
   window.JobBoredApp.core.host (its call() helper), so the
   saveClientId fallback's call("initAuth") only reaches the real
   auth-session initAuth when the bridge publishes it THERE —
   app.bootstrap.host is a different object the beat never reads.
   Without this entry the fallback is a silent no-op and Continue
   with Google still has no token client.
   ============================================================ */

function registerBridges(sourceHost) {
  const window = {};
  // registerAllBridges copies a few sheetsWrite helpers at registration
  // time, so the namespace must exist before it runs (as on the page).
  window.JobBoredApp = {
    sheetsWrite: {
      todayStr: "",
      futureDateStr: "",
      updateJobStatus: () => {},
      updateFollowUpDate: () => {},
      updateJobResponseFlag: () => {},
    },
  };
  const sandbox = { window, Object, Array };
  vm.createContext(sandbox);
  vm.runInContext(readRepoFile("bridge-registry.js"), sandbox, {
    filename: "bridge-registry.js",
  });
  const registry = window.JobBoredApp.bridgeRegistry;
  assert.ok(
    registry && typeof registry.registerAllBridges === "function",
    "the bridge registry must expose registerAllBridges",
  );
  registry.registerAllBridges(sourceHost);
  return window.JobBoredApp;
}

describe("bridge-registry — app.core.host publishes the greenfield auth entries", () => {
  it("exposes initAuth as the real host function", () => {
    let initCalls = 0;
    const sourceHost = {
      initAuth(...args) {
        initCalls += 1;
        return args;
      },
      applyOAuthClientChange: () => true,
    };
    const app = registerBridges(sourceHost);
    assert.equal(
      typeof app.core.host.initAuth,
      "function",
      "Beat 1's call('initAuth') resolves against core.host — " +
        "a missing entry is a silent no-op and GIS never initializes",
    );
    assert.equal(
      app.core.host.initAuth,
      sourceHost.initAuth,
      "core.host.initAuth must BE the real host function, not a copy",
    );
    app.core.host.initAuth("probe");
    assert.equal(initCalls, 1, "calling through core.host reaches the host");
  });

  it("keeps publishing applyOAuthClientChange alongside it", () => {
    const sourceHost = {
      initAuth: () => {},
      applyOAuthClientChange: () => true,
    };
    const app = registerBridges(sourceHost);
    assert.equal(typeof app.core.host.applyOAuthClientChange, "function");
  });
});
