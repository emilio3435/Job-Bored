/**
 * BEAUDIT A1 (SEC-05) — one unauthenticated `GET //` must not kill the
 * discovery worker. `new URL("//", base)` throws ERR_INVALID_URL; before the
 * fix it ran outside any try in the async request callback, so the rejection
 * was unhandled and the process exited with every in-flight run.
 * Promoted from probes/A/repro-a1-crash.sh.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 19001;

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: PORT, path, method: "GET", headers, timeout: 5000 },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout ${path}`)));
    req.on("error", reject);
    req.end();
  });
}

describe("BEAUDIT A1 — raw paths cannot crash the worker", () => {
  it("answers 400 to // and //x and keeps serving /health", async () => {
    const home = mkdtempSync(join(tmpdir(), "beaudit-p-a1-"));
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", join(REPO_ROOT, "integrations/browser-use-discovery/src/server.ts")],
      {
        cwd: REPO_ROOT,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          BROWSER_USE_DISCOVERY_PORT: String(PORT),
          BROWSER_USE_DISCOVERY_HOST: "127.0.0.1",
          BROWSER_USE_DISCOVERY_WEBHOOK_SECRET: "probe-secret",
          BROWSER_USE_DISCOVERY_STATE_DIR: join(home, "state"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let log = "";
    let exited = false;
    child.stdout.on("data", (c) => (log += c));
    child.stderr.on("data", (c) => (log += c));
    child.on("exit", () => (exited = true));
    try {
      let up = false;
      for (let i = 0; i < 80 && !up && !exited; i += 1) {
        try {
          up = (await get("/health")).status > 0;
        } catch {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      assert.ok(up, `worker did not start: ${log.slice(-2000)}`);
      for (const raw of ["//", "//x", "//evil.example/health"]) {
        let res = null;
        try {
          res = await get(raw);
        } catch {
          res = null;
        }
        assert.ok(res, `no response for ${raw}`);
        assert.equal(res.status, 400, `${raw} must be 400`);
      }
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(exited, false, `worker exited after raw path: ${log.slice(-1500)}`);
      const health = await get("/health");
      assert.ok(health.status > 0, "worker still answers /health");
    } finally {
      child.kill();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
