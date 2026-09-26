// W2SQ lane E (dotenv 18): the server's single dotenv call site
// (`import "dotenv/config"` in server/index.mjs) keeps its behaviour across
// the 17 -> 18 bump: file vars load, preset env wins (no override), and boot
// prints one `injected env` notice — now on stderr with no tip.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string[]} args @param {Record<string, string>} env @param {string} cwd */
function runNode(args, env, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      { cwd, env, timeout: 30000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }));
        else resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

describe("W2SQ-E — dotenv/config behaviour on dotenv 18", () => {
  it("loads the env file, never overrides preset env, and logs once on stderr", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "jobbored-dotenv-"));
    try {
      writeFileSync(
        join(tmpDir, ".env"),
        "JB_DOTENV_PROBE_FILE=fromfile\nJB_DOTENV_PROBE_PRESET=fromfile\n",
      );
      const probe = [
        'import "dotenv/config";',
        "console.log(JSON.stringify({",
        "  fromFile: process.env.JB_DOTENV_PROBE_FILE ?? null,",
        "  preset: process.env.JB_DOTENV_PROBE_PRESET ?? null,",
        "}));",
      ].join("\n");
      const { stdout, stderr } = await runNode(
        ["--input-type=module", "-e", probe],
        {
          PATH: process.env.PATH || "",
          DOTENV_PATH: join(tmpDir, ".env"),
          JB_DOTENV_PROBE_PRESET: "fromenv",
        },
        join(repoRoot, "server"),
      );
      const seen = JSON.parse(stdout.trim().split("\n").at(-1));
      assert.equal(seen.fromFile, "fromfile", "file vars load");
      assert.equal(seen.preset, "fromenv", "preset env wins without override");
      const stderrNotices = stderr.split("\n").filter((line) => /injected env \(\d+\) from /.test(line));
      assert.equal(stderrNotices.length, 1, `one stderr notice, got: ${JSON.stringify(stderr)}`);
      assert.match(stderrNotices[0], /injected env \(1\) from /);
      assert.doesNotMatch(stdout, /injected env/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
