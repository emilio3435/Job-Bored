import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadRuntimeConfig } from "../../src/config.ts";

// GFX R24 F1 (P1): the desktop app and greenfield B5 point
// BROWSER_USE_DISCOVERY_ENV_FILE at ~/.jobbored/... before anything has
// written it. A missing file is an empty file; the worker must boot.
// A file that exists but cannot be read is still fatal, with a clear message.

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "gfx-f1-env-"));
  try {
    await fn(dir);
  } finally {
    await chmod(dir, 0o700).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

test("R24 F1 an explicit env file that does not exist is treated as empty, not fatal", async () => {
  await withTempDir(async (dir) => {
    const env = {
      BROWSER_USE_DISCOVERY_ENV_FILE: join(dir, "not-written-yet.env"),
      BROWSER_USE_DISCOVERY_RUN_MODE: "local",
    };
    const config = loadRuntimeConfig(env);
    assert.equal(config.runMode, "local", "the process env still applies");
  });
});

test("R24 F1 the other explicit env-file names are forgiving too", async () => {
  await withTempDir(async (dir) => {
    for (const key of ["BROWSER_USE_DISCOVERY_WORKER_ENV", "DISCOVERY_ENV_FILE"]) {
      assert.doesNotThrow(() => loadRuntimeConfig({ [key]: join(dir, "missing.env") }));
    }
  });
});

test("R24 F1 an existing env file is still read and merged under the process env", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "worker.env");
    await writeFile(file, "BROWSER_USE_DISCOVERY_RUN_MODE=local\n", "utf8");
    const config = loadRuntimeConfig({ BROWSER_USE_DISCOVERY_ENV_FILE: file });
    assert.equal(config.runMode, "local");
  });
});

test(
  "R24 F1 an env file that exists but cannot be read still fails loudly, naming the path",
  { skip: typeof process.getuid === "function" && process.getuid() === 0 ? "root reads mode 000" : false },
  async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "locked.env");
      await writeFile(file, "BROWSER_USE_DISCOVERY_RUN_MODE=local\n", "utf8");
      await chmod(file, 0o000);
      assert.throws(
        () => loadRuntimeConfig({ BROWSER_USE_DISCOVERY_ENV_FILE: file }),
        (err: unknown) =>
          err instanceof Error &&
          err.message.includes(file) &&
          /could not be read|permission|EACCES/i.test(err.message),
      );
    });
  },
);
