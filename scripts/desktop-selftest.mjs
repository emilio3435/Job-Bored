#!/usr/bin/env node
/**
 * Desktop self-test (GFX DESK-B). Proves the three servers run the way the
 * desktop app runs them:
 *   - from a read-only copy of the app (`chmod -R a-w`),
 *   - with a fresh, empty HOME,
 *   - spawned through scripts/lib/runtime-env.mjs in desktop mode, with this
 *     Node standing in for Electron's (SPIKE S1 proved Electron-as-Node),
 * then probes them and asserts that nothing inside the copy changed.
 *
 *   node scripts/desktop-selftest.mjs [--keep]
 *
 * It binds 18580-18582 by default, never the live 8080/3847/8644, refuses to
 * start when a port is taken, and kills only the processes it started.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  constants as fsConstants,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDevServerEnv, resolveScraperEnv, resolveWorkerEnv } from "./lib/runtime-env.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SELFTEST_PORTS = Object.freeze({ dashboard: 18580, api: 18581, worker: 18582 });
const LIVE_PORTS = new Set([8080, 3847, 8644]);
const DESKTOP_VERSION = "0.0.0-selftest";

/** Tracked files plus real copies of the two node_modules trees the servers import. */
export function stageAppCopy(appRoot, dest) {
  const listed = spawnSync("git", ["-C", appRoot, "ls-files", "-z"], { encoding: "utf8" });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  for (const rel of listed.stdout.split("\0").filter(Boolean)) {
    const from = join(appRoot, rel);
    if (!existsSync(from) || !lstatSync(from).isFile()) continue;
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    copyFileSync(from, join(dest, rel), fsConstants.COPYFILE_FICLONE);
  }
  for (const rel of ["node_modules", join("server", "node_modules")]) {
    const from = join(appRoot, rel);
    if (!existsSync(from)) throw new Error(`${rel} is missing; run npm install first`);
    cpSync(realpathSync(from), join(dest, rel), {
      recursive: true,
      dereference: true,
      mode: fsConstants.COPYFILE_FICLONE,
      // Staging excludes node_modules/.cache (SPIKE S3: it carried a TLS key).
      filter: (src) => !src.split("/").includes(".cache"),
    });
  }
}

/** Every entry under `root` with its type, size and mtime; symlinks not followed. */
export function snapshotTree(root) {
  /** @type {Map<string, string>} */
  const entries = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const info = lstatSync(full);
      const kind = info.isDirectory() ? "d" : info.isSymbolicLink() ? "l" : "f";
      entries.set(relative(root, full), `${kind}:${info.size}:${info.mtimeMs}`);
      if (kind === "d") walk(full);
    }
  };
  walk(root);
  return entries;
}

/** Paths added, removed or modified between two snapshots. */
export function diffSnapshots(before, after) {
  const changes = [];
  for (const [path, stamp] of after) {
    if (!before.has(path)) changes.push(`added ${path}`);
    else if (before.get(path) !== stamp) changes.push(`modified ${path}`);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changes.push(`removed ${path}`);
  }
  return changes;
}

function setWritable(root, writable) {
  const mode = writable ? "u+w" : "a-w";
  const result = spawnSync("chmod", ["-R", mode, root]);
  if (result.status !== 0) throw new Error(`chmod -R ${mode} failed: ${result.stderr}`);
}

export function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

async function waitFor(label, check, timeoutMs, children) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    const dead = children.find((c) => c.child.exitCode !== null);
    if (dead) throw new Error(`${dead.name} exited (${dead.child.exitCode}) before ${label}:\n${dead.log()}`);
    try {
      if (await check()) return;
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}

function startChild(name, spec) {
  const child = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk) => {
    output = (output + chunk).slice(-8_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { name, child, log: () => output };
}

async function stopChild({ child }) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 5_000);
  await exited;
  clearTimeout(timer);
}

/**
 * @param {{ appRoot?: string, ports?: { dashboard: number, api: number, worker: number }, keep?: boolean, log?: (line: string) => void }} [options]
 */
export async function runDesktopSelftest({
  appRoot = REPO_ROOT,
  ports = SELFTEST_PORTS,
  keep = false,
  log = () => {},
} = {}) {
  for (const port of Object.values(ports)) {
    if (LIVE_PORTS.has(port)) throw new Error(`refusing live port ${port}`);
    if (!(await isPortFree(port))) throw new Error(`port ${port} is in use; free it and retry (nothing was killed)`);
  }

  const root = realpathSync(mkdtempSync(join(tmpdir(), "jobbored-desktop-selftest-")));
  const app = join(root, "app");
  const home = join(root, "home");
  mkdirSync(home);
  mkdirSync(join(root, "tmp"));
  /** @type {ReturnType<typeof startChild>[]} */
  const children = [];
  const result = { ok: false, root, probes: {}, bundleChanges: [], homeFiles: [], portsFreed: false };

  try {
    log(`staging ${appRoot} -> ${app}`);
    stageAppCopy(appRoot, app);
    setWritable(app, false);
    const before = snapshotTree(app);

    const opts = {
      appRoot: app,
      home,
      execPath: process.execPath,
      desktop: true,
      desktopVersion: DESKTOP_VERSION,
      ports,
      baseEnv: { PATH: "/usr/bin:/bin", TMPDIR: join(root, "tmp") },
    };
    children.push(startChild("dev-server", resolveDevServerEnv(opts)));
    children.push(startChild("api", resolveScraperEnv(opts)));
    children.push(startChild("worker", resolveWorkerEnv(opts)));

    const dashboard = `http://127.0.0.1:${ports.dashboard}`;
    const origin = { origin: `http://localhost:${ports.dashboard}` };
    await waitFor("the dashboard", async () => (await fetchJson(`${dashboard}/__proxy/ping`, origin)).status === 200, 30_000, children);
    await waitFor("the api", async () => (await fetchJson(`http://127.0.0.1:${ports.api}/health`)).status === 200, 30_000, children);
    await waitFor("the worker", async () => (await fetchJson(`http://127.0.0.1:${ports.worker}/health`)).status === 200, 60_000, children);

    const ping = await fetchJson(`${dashboard}/__proxy/ping`, origin);
    const apiHealth = await fetchJson(`http://127.0.0.1:${ports.api}/health`);
    const workerHealth = await fetchJson(`http://127.0.0.1:${ports.worker}/health`);
    const localHealth = await fetchJson(`${dashboard}/__proxy/local-health`, origin);
    const config = await fetch(`${dashboard}/config.js`, { signal: AbortSignal.timeout(3_000) });
    const keepAlive = await fetchJson(`${dashboard}/__proxy/install-keep-alive/status`, origin);
    result.probes = {
      ping: { status: ping.status, body: ping.body },
      apiHealth: { status: apiHealth.status, service: apiHealth.body && apiHealth.body.service },
      workerHealth: { status: workerHealth.status, service: workerHealth.body && workerHealth.body.service },
      localHealth: { status: localHealth.status },
      config: { status: config.status, contentType: config.headers.get("content-type") },
      keepAlive: { status: keepAlive.status, body: keepAlive.body },
    };
    await config.body?.cancel();

    result.bundleChanges = diffSnapshots(before, snapshotTree(app));
    result.homeFiles = [...snapshotTree(home).keys()].sort();
    const p = result.probes;
    result.ok =
      p.ping.status === 200 &&
      p.ping.body && p.ping.body.runtime === "desktop" &&
      p.apiHealth.status === 200 && p.apiHealth.service === "command-center-job-scraper" &&
      p.workerHealth.status === 200 && p.workerHealth.service === "browser-use-discovery-worker" &&
      p.localHealth.status === 200 &&
      p.config.status === 200 &&
      p.keepAlive.body && p.keepAlive.body.managedBy === "desktop" &&
      result.bundleChanges.length === 0;
    if (!result.ok) result.logs = Object.fromEntries(children.map((c) => [c.name, c.log()]));
  } finally {
    await Promise.all(children.map(stopChild));
    const free = await Promise.all(Object.values(ports).map(isPortFree));
    result.portsFreed = free.every(Boolean);
    if (!result.portsFreed) result.ok = false;
    if (!keep) {
      if (existsSync(app)) setWritable(app, true);
      rmSync(root, { recursive: true, force: true });
    }
  }
  return result;
}

const invokedAsCli =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsCli) {
  const keep = process.argv.includes("--keep");
  runDesktopSelftest({ keep, log: (line) => console.error(`[desktop-selftest] ${line}`) })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((err) => {
      console.error(`[desktop-selftest] failed: ${err && err.message ? err.message : err}`);
      process.exitCode = 1;
    });
}
