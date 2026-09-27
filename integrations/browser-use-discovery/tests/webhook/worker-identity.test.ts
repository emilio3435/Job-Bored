// BEAUDIT G7: worker /health must identify its checkout so launchers kill or
// reuse only a worker from THIS repo root — a dashboard in another checkout
// must report a foreign worker, never replace it with a detached worker
// running its own code and env files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  resolveWorkerEnvSources,
  resolveWorkerIdentityFields,
  resolveWorkerRepoRoot,
  resolveWorkerVersion,
} from "../../src/worker-identity.ts";

const here = dirname(fileURLToPath(import.meta.url));
// tests/webhook/ -> tests/ -> browser-use-discovery/ -> integrations/ -> repo
const repoRoot = dirname(dirname(dirname(dirname(here))));
const serverModuleUrl = new URL("../../src/server.ts", import.meta.url).href;

test("resolveWorkerRepoRoot finds the repo root from the server module URL", () => {
  assert.equal(resolveWorkerRepoRoot(serverModuleUrl), repoRoot);
});

test("resolveWorkerVersion reads the repo package version", () => {
  const expected = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ).version;
  assert.ok(expected, "root package.json must have a version");
  assert.equal(resolveWorkerVersion(repoRoot), expected);
});

test("resolveWorkerVersion is empty (not a throw) when the manifest is missing", () => {
  assert.equal(resolveWorkerVersion(join(repoRoot, "does-not-exist")), "");
});

test("resolveWorkerEnvSources echoes the explicit runtime env file pointer, never values", () => {
  assert.deepEqual(
    resolveWorkerEnvSources({
      BROWSER_USE_DISCOVERY_WORKER_ENV: "/tmp/u/.jobbored/browser-use-discovery/.env",
      BROWSER_USE_DISCOVERY_GEMINI_API_KEY: "secret-must-never-appear",
    }),
    { runtimeEnvFile: "/tmp/u/.jobbored/browser-use-discovery/.env" },
  );
  assert.deepEqual(resolveWorkerEnvSources({}), { runtimeEnvFile: null });
});

test("resolveWorkerIdentityFields bundles the /health identity fields", () => {
  const identity = resolveWorkerIdentityFields(serverModuleUrl, {});
  assert.equal(identity.repoRoot, repoRoot);
  assert.ok(identity.version, "version must be non-empty on a real checkout");
  assert.deepEqual(identity.envSources, { runtimeEnvFile: null });
});
