import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { repoRoot } from "./holes-disco-harness.mjs";

/* HOLES DISCO §0.11: a scheduled run's dispatch POST gets a generous timeout
   (60 s) instead of waiting forever on a worker that took the request and
   never answered — and since the worker may have taken it, the script says
   so rather than inviting a duplicate run. */

const SCRIPT = join(repoRoot, "scripts", "run-scheduled-discovery.mjs");

/** A worker that is healthy but holds every POST /webhook open. */
async function silentWorker() {
  const dispatches = [];
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    dispatches.push(res);
    req.resume();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    dispatches,
    close() {
      for (const res of dispatches) res.destroy();
      server.close();
    },
  };
}

function runScript(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    // Old behavior waits forever; end it so the test reports instead of hanging.
    const killer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.on("exit", (code, signal) => {
      clearTimeout(killer);
      resolve({ code, signal, stderr });
    });
  });
}

describe("§0.11 · the scheduled run's dispatch POST", () => {
  it("gives up on a worker that never answers and says the run may have started", async (t) => {
    const worker = await silentWorker();
    const home = mkdtempSync(join(tmpdir(), "holes-disco-sched-"));
    t.after(() => {
      worker.close();
      rmSync(home, { recursive: true, force: true });
    });

    const result = await runScript(
      [
        "--sheet-id", "1AbCdEfGhIjKlMnOpQrSt",
        "--port", String(worker.port),
        "--dispatch-timeout-ms", "300",
      ],
      {
        BROWSER_USE_DISCOVERY_WORKER_HOME: home,
        BROWSER_USE_DISCOVERY_WEBHOOK_SECRET: "holes-disco-secret",
      },
    );

    assert.equal(result.signal, null, `exits on its own; stderr: ${result.stderr}`);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /may have started — check Runs/);
    assert.equal(worker.dispatches.length, 1, "dispatched exactly once");
  });

  it("waits 60 seconds by default", async () => {
    const script = await import(SCRIPT);
    assert.equal(script.DEFAULT_DISPATCH_TIMEOUT_MS, 60_000);
    assert.equal(script.parseArgs([]).dispatchTimeoutMs, 60_000);
    assert.equal(script.parseArgs(["--dispatch-timeout-ms", "90000"]).dispatchTimeoutMs, 90_000);
  });
});
