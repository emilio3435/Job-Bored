// GFX DESK-B item 8: the desktop self-test. Three servers from a
// `chmod -R a-w` copy of the app, a fresh HOME, spawned through runtime-env
// on 18580-18582 with this Node standing in for Electron's; every probe
// answers, nothing inside the copy changes, and the ports are free after.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SELFTEST_PORTS,
  diffSnapshots,
  isPortFree,
  runDesktopSelftest,
  snapshotTree,
} from "../scripts/desktop-selftest.mjs";

describe("GFX-DESK-B desktop self-test", () => {
  it("the bundle walk sees an added file and a touched mtime (control)", () => {
    const root = mkdtempSync(join(tmpdir(), "gfx-desk-b-walk-"));
    try {
      writeFileSync(join(root, "a.txt"), "a");
      const before = snapshotTree(root);
      writeFileSync(join(root, "b.txt"), "b");
      utimesSync(join(root, "a.txt"), new Date(), new Date(Date.now() + 5_000));
      const changes = diffSnapshots(before, snapshotTree(root));
      assert.ok(changes.includes("added b.txt"), changes.join("\n"));
      assert.ok(changes.includes("modified a.txt"), changes.join("\n"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("boots all three servers read-only with an empty HOME and writes only under it", { timeout: 180_000 }, async () => {
    const result = await runDesktopSelftest();
    const detail = JSON.stringify(result, null, 2);
    assert.equal(result.probes.ping.status, 200, detail);
    assert.equal(result.probes.ping.body.runtime, "desktop", detail);
    assert.equal(result.probes.ping.body.desktopVersion, "0.0.0-selftest", detail);
    assert.equal(result.probes.apiHealth.service, "command-center-job-scraper", detail);
    assert.equal(result.probes.workerHealth.service, "browser-use-discovery-worker", detail);
    assert.equal(result.probes.localHealth.status, 200, detail);
    assert.equal(result.probes.config.status, 200, detail);
    assert.match(result.probes.config.contentType, /javascript/, detail);
    assert.equal(result.probes.keepAlive.body.managedBy, "desktop", detail);
    assert.deepEqual(result.bundleChanges, [], "zero writes under the read-only copy");
    assert.ok(result.homeFiles.includes(join(".jobbored", "desktop", "config.js")), detail);
    assert.ok(
      result.homeFiles.includes(join(".jobbored", "browser-use-discovery", "worker-state.sqlite")),
      detail,
    );
    assert.equal(result.portsFreed, true);
    assert.equal(result.ok, true, detail);
    for (const port of Object.values(SELFTEST_PORTS)) {
      assert.equal(await isPortFree(port), true, `port ${port} is free after the run`);
    }
  });
});
