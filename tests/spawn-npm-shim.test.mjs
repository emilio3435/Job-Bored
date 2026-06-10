import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveNpmInvocation, spawnNpm } from "../scripts/lib/spawn-npm.mjs";

/**
 * On native Windows npm/npx are .cmd batch files: spawn("npm", ...) without a
 * shell raises ENOENT (and EINVAL since Node 20.12), which broke every
 * prestart/predev hook, `npm run setup`, the scheduled-refresh autostart, and
 * the npx wrangler fallback. The shared shim must pick `<command>.cmd` plus
 * `shell: true` on win32 and leave POSIX spawns untouched.
 *
 * These tests must FAIL if the win32 shim is removed.
 */
describe("scripts/lib/spawn-npm.mjs windows shim", () => {
  it("picks npm.cmd with shell:true on win32", () => {
    const invocation = resolveNpmInvocation("npm", { platform: "win32" });
    assert.deepEqual(invocation, { command: "npm.cmd", shell: true });
  });

  it("picks npx.cmd with shell:true on win32", () => {
    const invocation = resolveNpmInvocation("npx", { platform: "win32" });
    assert.deepEqual(invocation, { command: "npx.cmd", shell: true });
  });

  it("leaves npm/npx untouched (no shell) on POSIX platforms", () => {
    for (const platform of ["darwin", "linux"]) {
      assert.deepEqual(resolveNpmInvocation("npm", { platform }), {
        command: "npm",
        shell: false,
      });
      assert.deepEqual(resolveNpmInvocation("npx", { platform }), {
        command: "npx",
        shell: false,
      });
    }
  });

  it("passes non-npm commands through unshimmed even on win32", () => {
    assert.deepEqual(resolveNpmInvocation("node", { platform: "win32" }), {
      command: "node",
      shell: false,
    });
  });

  it("spawnNpm forwards npm.cmd + shell:true to spawn on win32 (mocked platform)", () => {
    const calls = [];
    const fakeChild = { on() {} };
    spawnNpm(
      "npm",
      ["run", "start"],
      { cwd: "/repo", stdio: "inherit" },
      {
        platform: "win32",
        spawnImpl: (command, args, options) => {
          calls.push({ command, args, options });
          return fakeChild;
        },
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "npm.cmd");
    assert.deepEqual(calls[0].args, ["run", "start"]);
    assert.equal(calls[0].options.shell, true);
    assert.equal(calls[0].options.cwd, "/repo");
    assert.equal(calls[0].options.stdio, "inherit");
  });

  it("spawnNpm does not let caller options override the platform shell decision", () => {
    const calls = [];
    spawnNpm(
      "npm",
      ["install"],
      { shell: true },
      {
        platform: "linux",
        spawnImpl: (command, args, options) => {
          calls.push({ command, args, options });
          return { on() {} };
        },
      },
    );
    assert.equal(calls[0].command, "npm");
    assert.equal(calls[0].options.shell, false);
  });
});
