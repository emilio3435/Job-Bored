import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildDiscoveryWorkerEnv,
  buildDiscoveryWorkerSpawnEnv,
  readDiscoveryWorkerEnvFileLayers,
} from "../dev-server.mjs";
import { mergeEnvFileValues } from "../scripts/lib/env-file-merge.mjs";

/* ============================================================
   Both ways of starting the worker must hand it the same env.

   `npm run dev` starts the worker through
   scripts/start-discovery-worker-local.mjs, which layers the repo's
   integrations/browser-use-discovery/.env, server/.env, and the user's
   ~/.jobbored/browser-use-discovery/.env. The dashboard starts it through
   the dev server's /__proxy/full-boot — and that path built the child env
   from process.env alone, so a credential configured in the repo env file
   simply was not there.

   Beat 5 and every self-repair force-restart go through full-boot, so the
   worker the wizard leaves behind was ALWAYS the impoverished one: it
   refused runs with "Discovery worker has no Google Sheets credential
   configured" while the key sat configured on disk (Emilio, 2026-09-02).
   ============================================================ */

const SA = "BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE";

describe("buildDiscoveryWorkerEnv — env-file parity with the starter", () => {
  it("carries a credential that only the repo env file declares", () => {
    const env = buildDiscoveryWorkerEnv(8644, {}, {
      envFileLayers: [{ [SA]: "/repo/service-account-key.json" }],
    });
    assert.equal(env[SA], "/repo/service-account-key.json");
  });

  it("does not let a later file's empty placeholder erase it", () => {
    const env = buildDiscoveryWorkerEnv(8644, {}, {
      envFileLayers: [{ [SA]: "/repo/key.json" }, { [SA]: "" }],
    });
    assert.equal(env[SA], "/repo/key.json");
  });

  it("keeps process env winning over the files — an explicit export still rules", () => {
    const env = buildDiscoveryWorkerEnv(
      8644,
      { [SA]: "/exported/key.json" },
      { envFileLayers: [{ [SA]: "/repo/key.json" }] },
    );
    assert.equal(env[SA], "/exported/key.json");
  });

  it("still pins the local run mode, host, and port", () => {
    const env = buildDiscoveryWorkerEnv(8644, {}, { envFileLayers: [] });
    assert.equal(env.BROWSER_USE_DISCOVERY_RUN_MODE, "local");
    assert.equal(env.BROWSER_USE_DISCOVERY_HOST, "127.0.0.1");
    assert.equal(env.BROWSER_USE_DISCOVERY_PORT, "8644");
  });

  it("a file layer cannot override the pinned run mode", () => {
    const env = buildDiscoveryWorkerEnv(8644, {}, {
      envFileLayers: [{ BROWSER_USE_DISCOVERY_RUN_MODE: "cloud" }],
    });
    assert.equal(env.BROWSER_USE_DISCOVERY_RUN_MODE, "local");
  });

  it("stays deterministic with no layers — it never reads files itself", () => {
    const env = buildDiscoveryWorkerEnv(8644, {});
    assert.equal(env[SA], undefined);
  });

  it("the spawn-env builder is what supplies the real files", () => {
    const layers = readDiscoveryWorkerEnvFileLayers();
    assert.ok(Array.isArray(layers), "the layer reader returns a list of files");
    const env = buildDiscoveryWorkerSpawnEnv(8644);
    assert.equal(env.BROWSER_USE_DISCOVERY_RUN_MODE, "local");
    for (const key of Object.keys(mergeEnvFileValues(layers))) {
      assert.ok(key in env, `${key} from an env file must reach the worker`);
    }
  });

  it("the worker spawn uses the spawn-env builder, not the bare one", () => {
    const source = readFileSync(new URL("../dev-server.mjs", import.meta.url), "utf8");
    assert.match(
      source,
      /env:\s*buildDiscoveryWorkerSpawnEnv\(/,
      "a spawn on the bare builder is a worker with no env files again",
    );
  });
});
