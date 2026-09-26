import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

import { getTunnelAutostartPaths } from "../scripts/install-discovery-tunnel-autostart.mjs";
import { getWorkerAutostartPaths } from "../scripts/install-discovery-worker-autostart.mjs";
import { createDevServer } from "../dev-server.mjs";
import { resolveWorkerEnv } from "../scripts/lib/runtime-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("GFX-SOL-1 dev keeps the start process ownership policy", () => {
  const { scripts } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(scripts.dev, scripts.start);
});

test("GFX-SOL-2 autostart readers use desktop bootstrap state even with a spaced HOME", () => {
  const homeDir = join(tmpdir(), "JobBored home with spaces");
  const env = { JOBBORED_DESKTOP: "1", JOBBORED_HOME: join(homeDir, ".jobbored") };
  const expected = join(homeDir, ".jobbored", "discovery-local-bootstrap.json");
  assert.equal(getTunnelAutostartPaths({ homeDir, repoRoot: root, env }).bootstrapStatePath, expected);
  assert.equal(getWorkerAutostartPaths({ homeDir, repoRoot: root, env }).bootstrapStatePath, expected);
});

test("GFX-SOL-3 doctor reads desktop config and ignores repo config", async () => {
  const { loadConfig } = await import("../scripts/doctor.mjs");
  const home = mkdtempSync(join(tmpdir(), "jobbored doctor "));
  const repo = join(home, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, "config.js"), 'window.COMMAND_CENTER_CONFIG = { sheetId: "repo-sheet" };');
  const desktopConfig = join(home, "desktop", "config.js");
  mkdirSync(dirname(desktopConfig));
  writeFileSync(desktopConfig, 'window.COMMAND_CENTER_CONFIG = { sheetId: "desktop-sheet" };');
  const config = await loadConfig(repo, {
    JOBBORED_DESKTOP: "1",
    JOBBORED_HOME: home,
    JOBBORED_DASHBOARD_CONFIG_PATH: desktopConfig,
  });
  assert.equal(config.config.sheetId, "desktop-sheet");
});

test("GFX-SOL-4 B3 provider fetch receives its cancellation signal", async () => {
  const source = readFileSync(join(root, "resume-generate.js"), "utf8");
  let seenSignal;
  const window = {
    COMMAND_CENTER_CONFIG: {
      resumeProvider: "openrouter",
      resumeOpenRouterApiKey: "sk-or-fake-test",
    },
  };
  const ctx = {
    window,
    URL,
    fetch: async (_url, init) => {
      seenSignal = init.signal;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "ready" } }] }) };
    },
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: "resume-generate.js" });
  const controller = new AbortController();
  await window.CommandCenterResumeGenerate.callConfiguredAi("system", "user", { signal: controller.signal });
  assert.equal(seenSignal, controller.signal);
});

test("GFX-SOL-5 salary floor applies to listed salaries without salaryRequired", () => {
  const schema = JSON.parse(readFileSync(join(root, "integrations/browser-use-discovery/src/contracts/user-profile.schema.json"), "utf8"));
  const description = schema.properties?.hardConstraints?.properties?.salaryFloor?.description || "";
  assert.doesNotMatch(description, /only when salaryRequired=true/i);
  assert.match(description, /listed salary/i);
});

test("GFX-SOL-6 a caller cannot send the SerpApi key across origins", async () => {
  const source = readFileSync(join(root, "local-server.js"), "utf8");
  const window = { location: { hostname: "localhost", origin: "http://localhost:8080" } };
  const ctx = { window, URL, setTimeout, clearTimeout, AbortController };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: "local-server.js" });
  const calls = [];
  const result = await window.JobBoredLocalServer.checkSerpApiKey("fake-key", {
    base: "https://untrusted.example",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 200, json: async () => ({ ok: true, version: "0.1.0", routes: ["serpapi-check"] }) };
    },
  });
  assert.equal(result.blocks, true);
  assert.deepEqual(calls, []);
});

test("GFX-SOL-7 a failed HTTP response cannot authenticate the server or key", async () => {
  const source = readFileSync(join(root, "local-server.js"), "utf8");
  const window = { location: { hostname: "localhost", origin: "http://localhost:8080" } };
  const ctx = { window, URL, setTimeout, clearTimeout, AbortController };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: "local-server.js" });
  const calls = [];
  const result = await window.JobBoredLocalServer.checkSerpApiKey("fake-key", {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { status: 500, json: async () => ({ ok: true, version: "0.1.0", routes: ["serpapi-check"] }) };
    },
  });
  assert.equal(result.blocks, true);
  assert.equal(calls.length, 1, "only the keyless ping may run");
  assert.equal(calls[0].init.method, "GET");
  const answer = await window.JobBoredLocalServer.classifyAnswer({
    status: 500,
    json: async () => ({ ok: true }),
  });
  assert.equal(answer.blocks, true);
});

test("GFX-SOL-8 ping timeout also covers a stalled JSON body", async () => {
  const source = readFileSync(join(root, "local-server.js"), "utf8");
  const window = { location: { hostname: "localhost", origin: "http://localhost:8080" } };
  const ctx = { window, URL, setTimeout, clearTimeout, AbortController };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: "local-server.js" });
  let signal;
  const ping = window.JobBoredLocalServer.pingLocalServer({
    timeoutMs: 10,
    fetchImpl: async (_url, init) => {
      signal = init.signal;
      return {
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      };
    },
  });
  const result = await Promise.race([
    ping,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error("ping hung after headers")), 100)),
  ]);
  assert.equal(result.current, false);
  assert.equal(signal.aborted, true);
});

test("GFX-SOL-11 desktop fix and full boot never launch a tunnel or worker", async () => {
  const prior = process.env.JOBBORED_DESKTOP;
  process.env.JOBBORED_DESKTOP = "1";
  let starts = 0;
  const server = createDevServer({
    port: 18080,
    logger: { log() {}, error() {} },
    discoveryWorkerStarter: async () => { starts += 1; return { ok: true }; },
  });
  try {
    for (const route of ["fix-setup", "full-boot"]) {
      const response = await new Promise((resolve) => {
        const req = {
          method: "POST",
          url: `/__proxy/${route}`,
          headers: { host: "127.0.0.1:18080", origin: "http://127.0.0.1:18080" },
          socket: { remoteAddress: "127.0.0.1", localPort: 18080, encrypted: false },
        };
        const res = {
          status: 0,
          writeHead(status) { this.status = status; },
          end(body) { resolve({ status: this.status, body: JSON.parse(body) }); },
        };
        server.emit("request", req, res);
      });
      assert.equal(response.status, 409);
      assert.equal(response.body.reason, "desktop_managed");
    }
    assert.equal(starts, 0);
  } finally {
    if (prior === undefined) delete process.env.JOBBORED_DESKTOP;
    else process.env.JOBBORED_DESKTOP = prior;
  }
});

test("GFX-SOL-12 a browser command path with spaces stays one shell word", () => {
  const home = mkdtempSync(join(tmpdir(), "jobbored runtime "));
  const browserCommand = join(home, "Agent Browser.command");
  writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  const spec = resolveWorkerEnv({
    appRoot: root,
    home,
    execPath: process.execPath,
    desktop: true,
    baseEnv: { BROWSER_USE_DISCOVERY_BROWSER_COMMAND: browserCommand },
  });
  assert.equal(spec.env.BROWSER_USE_DISCOVERY_BROWSER_COMMAND, `'${browserCommand}'`);
});

test("GFX-SOL-13 subprocess stderr is never sent to the browser", () => {
  const source = readFileSync(join(root, "dev-server.mjs"), "utf8");
  assert.doesNotMatch(source, /detail:\s*(?:bootstrapResult|deployResult)\.stderr/);
});

test("GFX-SOL-14 launcher rejects malformed port and wait values before use", () => {
  for (const extra of [
    { PORT: "8080@untrusted.example" },
    { PORT: "0" },
    { JB_OPEN_MAX_WAIT_SECS: "x[$(touch /tmp/should-not-run)]" },
  ]) {
    const run = spawnSync("bash", [join(root, "start.sh")], {
      cwd: root,
      env: { ...process.env, JB_START_DRY_RUN: "1", JB_FORCE_BROWSER_OPEN: "1", ...extra },
      encoding: "utf8",
    });
    assert.notEqual(run.status, 0, JSON.stringify(extra));
    assert.doesNotMatch(run.stdout, /OPEN url=/);
  }
});
