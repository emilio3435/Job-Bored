// BEAUDIT A16: overlapping upsertStoredWorkerConfig calls must not lose an
// update (read-modify-write with no lock; the last rename won).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadRuntimeConfig, upsertStoredWorkerConfig } from "../../src/config.ts";

test("A16: four overlapping upserts on one Sheet each keep their field", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-config-lock-"));
  try {
    const workerConfigPath = join(dir, "worker-config.json");
    const runtimeConfig = loadRuntimeConfig({
      BROWSER_USE_DISCOVERY_WORKER_CONFIG: workerConfigPath,
      BROWSER_USE_DISCOVERY_RUN_MODE: "local",
    } as never);
    const sheetId = "sheet-four-00000001";
    await Promise.all([
      upsertStoredWorkerConfig(runtimeConfig, { sheetId, mutations: { targetRoles: ["Role Alpha"] } as never }),
      upsertStoredWorkerConfig(runtimeConfig, { sheetId, mutations: { includeKeywords: ["kw-bravo"] } as never }),
      upsertStoredWorkerConfig(runtimeConfig, { sheetId, mutations: { excludeKeywords: ["kw-charlie"] } as never }),
      upsertStoredWorkerConfig(runtimeConfig, { sheetId, mutations: { locations: ["Loc Delta"] } as never }),
    ]);
    const document = readFileSync(workerConfigPath, "utf8");
    for (const expected of ["Role Alpha", "kw-bravo", "kw-charlie", "Loc Delta"]) {
      assert.ok(document.includes(expected), `lost ${expected}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A16: concurrent upserts of different fields on one Sheet keep both fields", async () => {
  const dir = mkdtempSync(join(tmpdir(), "worker-config-lock-"));
  try {
    const workerConfigPath = join(dir, "worker-config.json");
    const runtimeConfig = loadRuntimeConfig({
      BROWSER_USE_DISCOVERY_WORKER_CONFIG: workerConfigPath,
      BROWSER_USE_DISCOVERY_RUN_MODE: "local",
    } as never);
    const sheetId = "sheet-one-000000001";
    await upsertStoredWorkerConfig(runtimeConfig, { sheetId, mutations: {} });
    await Promise.all([
      upsertStoredWorkerConfig(runtimeConfig, {
        sheetId,
        mutations: { targetRoles: ["Staff Engineer"] } as never,
      }),
      upsertStoredWorkerConfig(runtimeConfig, {
        sheetId,
        mutations: { includeKeywords: ["distributed systems"] } as never,
      }),
    ]);
    const document = readFileSync(workerConfigPath, "utf8");
    assert.ok(document.includes("Staff Engineer"), document);
    assert.ok(document.includes("distributed systems"), document);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
