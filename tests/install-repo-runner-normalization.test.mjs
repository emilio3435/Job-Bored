import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { installRepo } from "../scripts/install-repo.mjs";

/**
 * Regression: scripts/setup.mjs's `runCommand` resolves a `{ status }` object
 * (and setup.mjs's own `runChecked` reads `result.status`), but installRepo
 * historically treated the runner's return as a numeric exit code in its
 * `!== 0` check. Because `{ status: 0 } !== 0` is ALWAYS true, a real
 * `npm run setup` on a fresh clone threw
 *   `npm install exited with code [object Object]`
 * and never created config.js. installRepo must accept BOTH contracts.
 *
 * These tests must FAIL if the normalization is removed.
 */

async function createScratchRepo() {
  const scratchRoot = await mkdtemp(join(tmpdir(), "job-bored-runner-"));
  await mkdir(join(scratchRoot, "server"), { recursive: true });
  await writeFile(
    join(scratchRoot, "package.json"),
    `${JSON.stringify({ name: "scratch-root", private: true }, null, 2)}\n`,
  );
  await writeFile(
    join(scratchRoot, "package-lock.json"),
    `${JSON.stringify({ name: "scratch-root", lockfileVersion: 3 }, null, 2)}\n`,
  );
  await writeFile(
    join(scratchRoot, "server", "package.json"),
    `${JSON.stringify({ name: "scratch-server", private: true }, null, 2)}\n`,
  );
  await writeFile(
    join(scratchRoot, "server", "package-lock.json"),
    `${JSON.stringify({ name: "scratch-server", lockfileVersion: 3 }, null, 2)}\n`,
  );
  return scratchRoot;
}

// Object-returning runner matching scripts/setup.mjs's `runCommand` contract.
function createObjectStatusRunner() {
  return async (command, args, { cwd }) => {
    await mkdir(join(cwd, "node_modules"), { recursive: true });
    await mkdir(join(cwd, "server", "node_modules"), { recursive: true });
    return { status: 0 };
  };
}

describe("installRepo runner contract normalization", () => {
  it("resolves with installed:true when given an object-returning runner with {status:0}", async () => {
    const scratchRoot = await createScratchRepo();
    const result = await installRepo({
      repoRoot: scratchRoot,
      runner: createObjectStatusRunner(),
      silent: true,
    });
    assert.equal(result.installed, true);
    assert.equal(
      existsSync(join(scratchRoot, "node_modules", ".repo-install-state.json")),
      true,
      "expected install stamp to be written under node_modules",
    );
  });

  it("throws 'npm install exited with code 1' (not '[object Object]') when the object runner reports {status:1}", async () => {
    const scratchRoot = await createScratchRepo();
    const failingRunner = async () => ({ status: 1 });
    await assert.rejects(
      () =>
        installRepo({
          repoRoot: scratchRoot,
          runner: failingRunner,
          silent: true,
        }),
      (err) => {
        assert.equal(err.message, "npm install exited with code 1");
        assert.doesNotMatch(err.message, /\[object Object\]/);
        return true;
      },
    );
  });

  it("throws the numeric code from the object runner for non-zero {status:N}", async () => {
    const scratchRoot = await createScratchRepo();
    const failingRunner = async () => ({ status: 137 });
    await assert.rejects(
      () =>
        installRepo({
          repoRoot: scratchRoot,
          runner: failingRunner,
          silent: true,
        }),
      (err) => {
        assert.equal(err.message, "npm install exited with code 137");
        return true;
      },
    );
  });

  it("still accepts the numeric-returning runner contract (regression lock)", async () => {
    const scratchRoot = await createScratchRepo();
    const numericRunner = async (command, args, { cwd }) => {
      await mkdir(join(cwd, "node_modules"), { recursive: true });
      await mkdir(join(cwd, "server", "node_modules"), { recursive: true });
      return 0;
    };
    const result = await installRepo({
      repoRoot: scratchRoot,
      runner: numericRunner,
      silent: true,
    });
    assert.equal(result.installed, true);
  });

  it("throws the numeric code when the object runner reports {status:1} for the server fallback path", async () => {
    const scratchRoot = await createScratchRepo();
    // First call (root `npm install`) succeeds and creates only root node_modules;
    // the second call (`npm install --prefix ./server`) gets the failing object.
    const calls = [];
    const failingServerOnly = async (command, args, { cwd }) => {
      calls.push([command, ...args]);
      if (args.includes("--prefix")) {
        return { status: 1 };
      }
      await mkdir(join(cwd, "node_modules"), { recursive: true });
      // Deliberately DO NOT create server/node_modules → fallback must run.
      return { status: 0 };
    };
    await assert.rejects(
      () =>
        installRepo({
          repoRoot: scratchRoot,
          runner: failingServerOnly,
          silent: true,
        }),
      (err) => {
        assert.equal(
          err.message,
          "npm install --prefix ./server exited with code 1",
        );
        assert.doesNotMatch(err.message, /\[object Object\]/);
        return true;
      },
    );
    assert.equal(calls.length, 2);
  });
});
