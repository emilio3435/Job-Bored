/**
 * BEAUDIT G5: when a non-worker (e.g. the Hermes gateway) holds the worker
 * port, `npm run dev`'s starter used to spawn anyway, print an unhandled
 * EADDRINUSE stack plus the false line "something else terminated the
 * listener", exit 1 — and `concurrently -k` took web+scraper down. Nothing
 * named the owner or the fix.
 *
 * The starter must instead name the owning command, print the fix
 * (BROWSER_USE_DISCOVERY_PORT / move Hermes to 8645), and hold so the dev
 * stack survives.
 *
 * BEAUDIT G6 residual: the hold-watch must not respawn on a single missed
 * 1s probe (a busy worker would trigger a respawn into EADDRINUSE, exit 1,
 * and tear the stack down). Respawn needs consecutive failures plus a
 * port-free check.
 *
 * BEAUDIT G12 (starter half): the starter must spawn process.execPath, not
 * "node" from PATH.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  decideExistingWorkerAction,
  decideHeldWorkerAction,
} from "../scripts/lib/discovery-worker-policy.mjs";
import {
  buildWorkerSpawnCommand,
  describePortOwner,
} from "../scripts/start-discovery-worker-local.mjs";

describe("G5 starter policy — foreign listener on the worker port", () => {
  it("holds (does not start) when the port is bound but no worker is healthy", () => {
    assert.equal(
      decideExistingWorkerAction({ existingHealthy: false, restartExisting: false, portBound: true }),
      "hold_foreign",
    );
    assert.equal(
      decideExistingWorkerAction({ existingHealthy: false, restartExisting: true, portBound: true }),
      "hold_foreign",
    );
  });

  it("still starts when the port is free", () => {
    assert.equal(
      decideExistingWorkerAction({ existingHealthy: false, restartExisting: false, portBound: false }),
      "start",
    );
  });
});

describe("G5 port-owner description", () => {
  it("names each owning pid and command", () => {
    const owner = describePortOwner(8644, {
      listPids: () => [4242],
      getCommand: (pid) => (pid === 4242 ? "/usr/bin/python3 -m hermes.gateway --port 8644" : ""),
    });
    assert.equal(owner.bound, true);
    assert.deepEqual(owner.pids, [4242]);
    assert.match(owner.lines.join("\n"), /pid 4242: \/usr\/bin\/python3 -m hermes\.gateway/);
  });

  it("says the port is free when nothing listens", () => {
    const owner = describePortOwner(8644, {
      listPids: () => [],
      getCommand: () => "",
    });
    assert.equal(owner.bound, false);
    assert.deepEqual(owner.pids, []);
  });

  it("stays honest when owner lookup is unavailable (no lsof)", () => {
    const owner = describePortOwner(8644, {
      listPids: () => null,
      getCommand: () => "",
    });
    assert.equal(owner.bound, null);
    assert.match(owner.lines.join("\n"), /owner lookup unavailable/);
  });
});

describe("G6 residual — hold-watch needs consecutive failures plus a free port", () => {
  it("keeps holding on the first and second consecutive missed probe", () => {
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: false, shuttingDown: false, consecutiveFailures: 1, portFree: true }),
      "keep_holding",
    );
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: false, shuttingDown: false, consecutiveFailures: 2, portFree: true }),
      "keep_holding",
    );
  });

  it("respawns after consecutive failures only when the port is free", () => {
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: false, shuttingDown: false, consecutiveFailures: 3, portFree: true }),
      "respawn",
    );
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: false, shuttingDown: false, consecutiveFailures: 3, portFree: false }),
      "keep_holding",
    );
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: false, shuttingDown: false, consecutiveFailures: 9, portFree: false }),
      "keep_holding",
    );
  });

  it("still exits on our own shutdown", () => {
    assert.equal(
      decideHeldWorkerAction({ heldWorkerHealthy: false, shuttingDown: true, consecutiveFailures: 9, portFree: true }),
      "exit",
    );
  });
});

describe("G12 starter half — spawn the running Node, not PATH node", () => {
  it("builds the worker spawn from process.execPath", () => {
    const { command, args } = buildWorkerSpawnCommand();
    assert.equal(command, process.execPath);
    assert.deepEqual(args, [
      "--experimental-strip-types",
      "integrations/browser-use-discovery/src/server.ts",
    ]);
  });
});

describe("G5 behavior — starter holds (not exits) when a foreign listener owns the port", () => {
  it("names the owner, prints the fix, and stays alive", async () => {
    // A Hermes-gateway-shaped foreign listener: answers HTTP, is not the worker.
    const foreign = createServer((req, res) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("hermes gateway");
    });
    await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
    const port = foreign.address().port;
    const homeDir = mkdtempSync(join(tmpdir(), "jobbored-g5-home-"));
    const cwdDir = mkdtempSync(join(tmpdir(), "jobbored-g5-cwd-"));
    let child = null;
    try {
      const starterPath = new URL("../scripts/start-discovery-worker-local.mjs", import.meta.url);
      let output = "";
      child = spawn(process.execPath, [starterPath.pathname], {
        cwd: cwdDir,
        env: {
          ...process.env,
          HOME: homeDir,
          BROWSER_USE_DISCOVERY_PORT: String(port),
          BROWSER_USE_DISCOVERY_WEBHOOK_SECRET: "probe-secret",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      const exited = await Promise.race([
        new Promise((resolve) => child.on("exit", (code) => resolve(code))),
        sleep(6000).then(() => null),
      ]);
      assert.equal(
        exited,
        null,
        `starter must hold, not exit, when a foreign listener owns the port (exited ${exited}):\n${output}`,
      );
      assert.doesNotMatch(output, /listen EADDRINUSE/);
      assert.doesNotMatch(output, /^\s+at /m);
      assert.doesNotMatch(output, /something else terminated the listener/);
      assert.match(output, new RegExp(`port ${port} is held by another process`));
      assert.match(output, /BROWSER_USE_DISCOVERY_PORT/);
      assert.match(output, /holding so the dev stack survives/);
    } finally {
      if (child && child.exitCode == null) {
        child.kill("SIGKILL");
        await sleep(200);
      }
      await new Promise((resolve) => foreign.close(resolve));
      rmSync(homeDir, { recursive: true, force: true });
      rmSync(cwdDir, { recursive: true, force: true });
    }
  });
});
