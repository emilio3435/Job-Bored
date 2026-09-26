/**
 * GFX-X2 — `npm run lint:repo` must not lint other checkouts. The main
 * checkout carries nested worktrees under .worktrees/ and Muse lane state
 * under .muse/; eslint scanning them failed every lane's floor on code
 * this tree does not own.
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ESLint } from "eslint";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("GFX-X2 · eslint ignores other checkouts", () => {
  const eslint = new ESLint({ cwd: ROOT });

  for (const path of [
    ".worktrees/feat-standalone-materials-drafter/app.js",
    ".muse/lanes/x/app.js",
  ]) {
    it(`GFX-X2: ignores ${path}`, async () => {
      assert.equal(await eslint.isPathIgnored(join(ROOT, path)), true);
    });
  }

  it("GFX-X2: still lints this checkout's own scripts", async () => {
    assert.equal(await eslint.isPathIgnored(join(ROOT, "local-server.js")), false);
    assert.equal(await eslint.isPathIgnored(join(ROOT, "oneflow-beat-discovery.js")), false);
  });
});
