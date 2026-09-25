import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";

import {
  openDiscoveryWorkerLogStdio,
  resolveDiscoveryWorkerLogPath,
} from "../dev-server.mjs";

/* ============================================================
   The worker the dashboard starts must leave a log behind.

   The dev server's /__proxy/full-boot spawned the worker with
   `stdio: "ignore"`. Every Beat 5 "Save & verify" force-restarts the worker
   through that path, so the worker that runs a new user's FIRST discovery is
   precisely the one with no output anywhere. Emilio's 2026-09-02 run hung in
   the scout phase for 46 minutes and nothing on disk can say why.

   The `npm run dev` starter already streams the worker into the dev log; the
   launchd keep-alive already writes ~/.jobbored/browser-use-discovery/logs/
   worker.log. The dashboard-started worker now appends to that same file.
   ============================================================ */

describe("resolveDiscoveryWorkerLogPath", () => {
  it("lives beside the worker env file, in its logs directory", () => {
    const p = resolveDiscoveryWorkerLogPath("/home/u/.jobbored/browser-use-discovery/.env");
    assert.equal(p, "/home/u/.jobbored/browser-use-discovery/logs/worker.log");
  });
});

describe("openDiscoveryWorkerLogStdio", () => {
  it("hands a detached child stdout+stderr that append to the log file", () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-worker-log-"));
    const logPath = join(dir, "nested", "logs", "worker.log");
    try {
      const { stdio, close } = openDiscoveryWorkerLogStdio(logPath);
      assert.equal(stdio[0], "ignore", "the worker reads nothing from us");
      // A real child, writing to both streams through the fds we opened.
      spawnSync(
        process.execPath,
        ["-e", "process.stdout.write('out-line\\n'); process.stderr.write('err-line\\n');"],
        { stdio },
      );
      close();
      const text = readFileSync(logPath, "utf8");
      assert.match(text, /out-line/, "stdout reaches the file");
      assert.match(text, /err-line/, "stderr reaches the same file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends across restarts instead of truncating the previous worker's lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-worker-log-"));
    const logPath = join(dir, "worker.log");
    try {
      for (const marker of ["first-worker", "second-worker"]) {
        const { stdio, close } = openDiscoveryWorkerLogStdio(logPath);
        spawnSync(process.execPath, ["-e", `process.stdout.write('${marker}\\n')`], { stdio });
        close();
      }
      const text = readFileSync(logPath, "utf8");
      assert.match(text, /first-worker/);
      assert.match(text, /second-worker/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to ignoring output when the log cannot be opened, rather than failing the boot", () => {
    const { stdio, close } = openDiscoveryWorkerLogStdio("/dev/null/not-a-dir/worker.log");
    assert.deepEqual(stdio, ["ignore", "ignore", "ignore"]);
    assert.doesNotThrow(close);
  });
});

describe("the full-boot spawn uses the log stdio", () => {
  it("no longer spawns the worker with stdio: \"ignore\"", () => {
    const source = readFileSync(new URL("../dev-server.mjs", import.meta.url), "utf8");
    const anchor = source.indexOf('["--experimental-strip-types", DISCOVERY_WORKER_SCRIPT]');
    // From the statement before the spawn (where the log stdio is opened)
    // through the spawn options.
    const head = source.slice(Math.max(0, anchor - 200), anchor + 400);
    assert.doesNotMatch(head, /stdio:\s*"ignore"/, "an ignored worker is an unobservable worker");
    assert.match(head, /openDiscoveryWorkerLogStdio\(/);
  });
});
