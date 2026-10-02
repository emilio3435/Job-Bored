/**
 * HOLES HOST S13: JOBBORED_SERVE_STATIC=1 mounted express.static over the
 * whole repo root, so the API served server source, package.json, logs and
 * any other file under it. It now serves the dashboard's public allowlist,
 * the same one the dev server uses (scripts/lib/static-path-guard.mjs).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "server");

const PUBLIC = {
  "index.html": "<!doctype html><title>JobBored</title>",
  "app.js": "console.log('app');",
  "css/tokens.css": ":root{}",
  "docs/SELF-HOSTING.md": "# Self-hosting",
};
const PRIVATE = {
  "server/index.mjs": "// server source",
  "package.json": "{\"name\":\"command-center\"}",
  "tmp/jobbored-dev.log": "log line",
  "integrations/browser-use-discovery/service-account-key.json": "{\"private_key\":\"fixture\"}",
  "dev-server.mjs": "// dev server source",
};

describe("HOLES HOST S13 — opt-in static serving is an allowlist", () => {
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  let root = "";
  let baseUrl = "";

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "holes-host-static-"));
    for (const [rel, body] of Object.entries({ ...PUBLIC, ...PRIVATE })) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    const port = await new Promise((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const free = /** @type {import("node:net").AddressInfo} */ (probe.address()).port;
        probe.close(() => resolve(free));
      });
    });
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["index.mjs"], {
      cwd: SERVER_DIR,
      env: {
        PATH: process.env.PATH || "",
        HOME: join(root, "home"),
        USERPROFILE: join(root, "home"),
        PORT: String(port),
        LISTEN_HOST: "127.0.0.1",
        HERMES_APPLICATIONS_ROOT: join(root, "home", "applications"),
        JOBBORED_SERVE_STATIC: "1",
        JOBBORED_STATIC_ROOT: root,
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${baseUrl}/health`).catch(() => null);
      if (res && res.ok) return;
      await sleep(100);
    }
    throw new Error("API did not start");
  });

  after(async () => {
    if (child && child.exitCode == null) {
      const exited = new Promise((r) => child?.once("exit", r));
      child.kill();
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("serves the dashboard's public files", async () => {
    for (const [rel, body] of Object.entries(PUBLIC)) {
      const res = await fetch(`${baseUrl}/${rel}`);
      assert.equal(res.status, 200, rel);
      assert.equal(await res.text(), body, rel);
    }
    const home = await fetch(`${baseUrl}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<title>JobBored<\/title>/);
  });

  it("never serves server source, package files, logs or keys", async () => {
    for (const rel of Object.keys(PRIVATE)) {
      const res = await fetch(`${baseUrl}/${rel}`);
      const text = await res.text();
      assert.notEqual(res.status, 200, `${rel} was served`);
      assert.equal(text.includes(PRIVATE[/** @type {keyof typeof PRIVATE} */ (rel)]), false, `${rel} content leaked`);
    }
  });

  it("leaves the API routes alone", async () => {
    const res = await fetch(`${baseUrl}/api/materials/templates`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await res.json()).templates));
  });
});
