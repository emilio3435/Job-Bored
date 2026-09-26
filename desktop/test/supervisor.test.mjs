// GFX DESK-A F4 / R19 / R22: the supervisor spawns the three servers straight
// from runtime-env, attaches to a healthy JobBored instead of double-spawning,
// names a foreign port owner without killing it, restarts crashes on a budget,
// and stops only what it started. No Electron, no real ports: spawn, fetch and
// lsof are a fake port world.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as runtimeEnv from "../../scripts/lib/runtime-env.mjs";
import { createSupervisor, decideSupervisorExit, parseLsofFields } from "../supervisor.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOME = "/Users/tester";
const EXEC = "/Applications/JobBored.app/Contents/MacOS/JobBored";
const PORTS = { dashboard: 18780, api: 18781, worker: 18782 };

const HEALTHY = {
  dashboard: { ok: true, version: "0.1.0", runtime: "source", routes: ["ping", "full-boot"] },
  api: { ok: true, service: "command-center-job-scraper" },
  worker: { status: "ok", service: "browser-use-discovery-worker" },
};
const SERVICE_BY_ENTRY = { "dev-server.mjs": "dashboard", "index.mjs": "api", "--experimental-strip-types": "worker" };

/**
 * @typedef {{ kind: "jobbored" | "foreign" | "raw", service?: string, pid: number, command: string, cwd?: string, child?: any }} Listener
 */
function world({ spawnHealthyAfterMs = 1, crashOnSpawn = () => false } = {}) {
  /** @type {Map<number, Listener>} */
  const ports = new Map();
  /** @type {{ cmd: string, args: string[], opts: any, child: any }[]} */
  const spawned = [];
  /** @type {{ pid: number, signal: string }[]} */
  const kills = [];
  let nextPid = 5000;

  const portOf = (/** @type {string} */ service) => PORTS[/** @type {keyof typeof PORTS} */ (service)];

  const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    const u = new URL(url);
    const l = ports.get(Number(u.port));
    if (!l) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    if (l.kind === "raw") throw new TypeError("fetch failed: other side closed");
    if (l.kind === "foreign") return new Response(JSON.stringify({ gateway: true }), { status: 200 });
    const service = /** @type {keyof typeof HEALTHY} */ (l.service);
    if (service === "dashboard") {
      assert.equal(u.pathname, "/__proxy/ping");
      assert.equal(init.headers?.origin, `http://localhost:${u.port}`);
    } else {
      assert.equal(u.pathname, "/health");
    }
    return new Response(JSON.stringify(HEALTHY[service]), { status: 200 });
  };

  const lsof = async (/** @type {number} */ port) => {
    const l = ports.get(port);
    return l ? [{ pid: l.pid, command: l.command, cwd: l.cwd }] : [];
  };

  const spawnImpl = (/** @type {string} */ cmd, /** @type {string[]} */ args, /** @type {any} */ opts) => {
    const service = SERVICE_BY_ENTRY[/** @type {keyof typeof SERVICE_BY_ENTRY} */ (args[0])];
    const child = Object.assign(new EventEmitter(), {
      pid: nextPid++,
      exitCode: /** @type {number | null} */ (null),
      signalCode: /** @type {string | null} */ (null),
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      exit(/** @type {number | null} */ code, /** @type {string | null} */ signal) {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.exitCode = code;
        child.signalCode = signal;
        const port = portOf(service);
        if (ports.get(port)?.child === child) ports.delete(port);
        setImmediate(() => child.emit("exit", code, signal));
      },
      kill(/** @type {string} */ signal = "SIGTERM") {
        kills.push({ pid: child.pid, signal });
        child.exit(null, signal);
        return true;
      },
    });
    spawned.push({ cmd, args, opts, child });
    if (crashOnSpawn(service, spawned.length)) {
      setTimeout(() => child.exit(1, null), 1);
    } else {
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          ports.set(portOf(service), { kind: "jobbored", service, pid: child.pid, command: "JobBored", child });
        }
      }, spawnHealthyAfterMs);
    }
    return child;
  };

  return { ports, spawned, kills, fetchImpl, lsof, spawnImpl, portOf };
}

function supervisorFor(/** @type {ReturnType<typeof world>} */ w, overrides = {}) {
  return createSupervisor({
    appRoot: REPO,
    home: HOME,
    execPath: EXEC,
    desktopVersion: "0.1.0",
    ports: PORTS,
    runtimeEnv,
    baseEnv: { PATH: "/usr/bin:/bin" },
    spawn: /** @type {any} */ (w.spawnImpl),
    fetch: /** @type {any} */ (w.fetchImpl),
    lsof: w.lsof,
    killChild: (/** @type {any} */ child, /** @type {string} */ signal) => child.kill(signal),
    timing: { pollMs: 2, healthTimeoutMs: 500, attachRetryMs: 5, replacementGraceMs: 30, backoffBaseMs: 2, backoffMaxMs: 10, stopTimeoutMs: 50, monitorIntervalMs: 0 },
    ...overrides,
  });
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test("F4: free ports spawn the three servers from runtime-env, argv only, no shell", async () => {
  const w = world();
  const sup = supervisorFor(w);
  await sup.start();
  const snap = sup.snapshot();
  assert.deepEqual(Object.fromEntries(Object.entries(snap).map(([k, v]) => [k, v.state])), {
    dashboard: "running",
    api: "running",
    worker: "running",
  });
  assert.equal(w.spawned.length, 3);
  const opts = { appRoot: REPO, home: HOME, execPath: EXEC, desktop: true, desktopVersion: "0.1.0", ports: PORTS, baseEnv: { PATH: "/usr/bin:/bin" } };
  const expected = {
    "dev-server.mjs": runtimeEnv.resolveDevServerEnv(opts),
    "index.mjs": runtimeEnv.resolveScraperEnv(opts),
    "--experimental-strip-types": runtimeEnv.resolveWorkerEnv(opts),
  };
  for (const { cmd, args, opts: spawnOpts } of w.spawned) {
    const spec = expected[/** @type {keyof typeof expected} */ (args[0])];
    assert.equal(cmd, EXEC);
    assert.deepEqual(args, spec.args);
    assert.equal(spawnOpts.cwd, spec.cwd);
    assert.deepEqual(spawnOpts.env, spec.env);
    assert.ok(!spawnOpts.shell, "shell must never be set");
    assert.equal(spawnOpts.env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(spawnOpts.env.JOBBORED_DESKTOP, "1");
    assert.equal(spawnOpts.env.HOME, HOME);
  }
  await sup.stop();
});

test("R19: a healthy JobBored on every port is attached to, never double-spawned", async () => {
  const w = world();
  w.ports.set(PORTS.dashboard, { kind: "jobbored", service: "dashboard", pid: 111, command: "node", cwd: `${HOME}/Job-Bored` });
  w.ports.set(PORTS.api, { kind: "jobbored", service: "api", pid: 112, command: "node", cwd: `${HOME}/Job-Bored/server` });
  w.ports.set(PORTS.worker, { kind: "jobbored", service: "worker", pid: 113, command: "node" });
  const sup = supervisorFor(w);
  await sup.start();
  await sup.start();
  assert.equal(w.spawned.length, 0);
  const snap = sup.snapshot();
  assert.equal(snap.dashboard.state, "attached");
  assert.equal(snap.dashboard.detail, "Running from ~/Job-Bored (pid 111)");
  assert.equal(snap.worker.detail, "Running from node (pid 113)");
  await sup.stop();
  assert.deepEqual(w.kills, [], "stop never signals an attached process");
});

test("R22: a foreign owner is named in a conflict and never killed; the rest still start", async () => {
  const w = world();
  w.ports.set(PORTS.worker, { kind: "foreign", pid: 222, command: "hermes" });
  w.ports.set(PORTS.dashboard, { kind: "raw", pid: 333, command: "python3.12" });
  const sup = supervisorFor(w);
  await sup.start();
  const snap = sup.snapshot();
  assert.equal(snap.worker.state, "conflict");
  assert.equal(snap.worker.detail, `Port ${PORTS.worker} is in use by hermes (pid 222)`);
  assert.equal(snap.dashboard.state, "conflict");
  assert.equal(snap.dashboard.detail, `Port ${PORTS.dashboard} is in use by python3.12 (pid 333)`);
  assert.equal(snap.api.state, "running");
  assert.deepEqual(w.spawned.map((s) => s.args[0]), ["index.mjs"]);
  await sup.stop();
  assert.ok(!w.kills.some((k) => k.pid === 222 || k.pid === 333));
  assert.equal(w.ports.get(PORTS.worker)?.pid, 222);
});

test("F4: a crashing child restarts with backoff, then gives up on budget", async () => {
  const w = world({ crashOnSpawn: (service) => service === "api" });
  const sup = supervisorFor(w, { restartBudget: { max: 3, windowMs: 60_000 } });
  await sup.start();
  for (let i = 0; i < 50 && sup.snapshot().api.state !== "failed"; i += 1) await tick(10);
  const apiSpawns = w.spawned.filter((s) => s.args[0] === "index.mjs").length;
  assert.equal(sup.snapshot().api.state, "failed");
  assert.equal(apiSpawns, 4, "first spawn plus 3 budgeted restarts");
  assert.match(sup.snapshot().api.detail, /stopped after 3 restarts/);
  assert.equal(sup.snapshot().dashboard.state, "running");
  await sup.stop();
});

test("F4: restart() gives a failed service a fresh budget", async () => {
  let crash = true;
  const w = world({ crashOnSpawn: (service) => service === "api" && crash });
  const sup = supervisorFor(w, { restartBudget: { max: 1, windowMs: 60_000 } });
  await sup.start();
  for (let i = 0; i < 50 && sup.snapshot().api.state !== "failed"; i += 1) await tick(10);
  crash = false;
  await sup.restart();
  assert.equal(sup.snapshot().api.state, "running");
  await sup.stop();
});

test("F4: a child signalled by someone else, replaced by a healthy JobBored, is attached (no respawn)", async () => {
  const w = world();
  const sup = supervisorFor(w);
  await sup.start();
  const worker = w.spawned.find((s) => s.args[0] === "--experimental-strip-types");
  // The dashboard's full-boot SIGTERMs the worker and starts its own.
  worker?.child.exit(null, "SIGTERM");
  w.ports.set(PORTS.worker, { kind: "jobbored", service: "worker", pid: 777, command: "JobBored" });
  await tick(80);
  assert.equal(sup.snapshot().worker.state, "attached");
  assert.equal(w.spawned.length, 3);
  await sup.stop();
  assert.ok(!w.kills.some((k) => k.pid === 777));
});

test("stop() signals only its own children, and they exit", async () => {
  const w = world();
  w.ports.set(PORTS.api, { kind: "jobbored", service: "api", pid: 112, command: "node" });
  const sup = supervisorFor(w);
  await sup.start();
  const own = w.spawned.map((s) => s.child.pid).sort();
  await sup.stop();
  assert.deepEqual(w.kills.map((k) => k.pid).sort(), own);
  assert.ok(w.kills.every((k) => k.signal === "SIGTERM"));
  assert.ok(w.spawned.every((s) => s.child.signalCode === "SIGTERM"));
  assert.equal(sup.snapshot().dashboard.state, "stopped");
  assert.equal(w.ports.get(PORTS.api)?.pid, 112);
  await tick(60);
  assert.equal(w.spawned.length, 2, "nothing respawns after stop");
});

test("stop() escalates to SIGKILL for a child that ignores SIGTERM", async () => {
  const w = world();
  const sup = supervisorFor(w, {
    killChild: (/** @type {any} */ child, /** @type {string} */ signal) => {
      w.kills.push({ pid: child.pid, signal });
      if (signal === "SIGKILL") child.exit(null, "SIGKILL");
    },
  });
  await sup.start();
  await sup.stop();
  const signals = w.kills.map((k) => k.signal);
  assert.equal(signals.filter((s) => s === "SIGTERM").length, 3);
  assert.equal(signals.filter((s) => s === "SIGKILL").length, 3);
});

test("concurrent start() calls spawn each server once", async () => {
  const w = world({ spawnHealthyAfterMs: 15 });
  const sup = supervisorFor(w);
  await Promise.all([sup.start(), sup.start(), sup.start()]);
  assert.equal(w.spawned.length, 3);
  await sup.stop();
});

test("R19: when an attached JobBored goes away, the monitor takes the free port over", async () => {
  const w = world();
  w.ports.set(PORTS.worker, { kind: "jobbored", service: "worker", pid: 113, command: "node" });
  const sup = supervisorFor(w);
  await sup.start();
  assert.equal(sup.snapshot().worker.state, "attached");
  w.ports.delete(PORTS.worker);
  await sup.checkNow();
  await tick(20);
  assert.equal(sup.snapshot().worker.state, "running");
  assert.equal(w.spawned.filter((s) => s.args[0] === "--experimental-strip-types").length, 1);
  await sup.stop();
});

test("a spawn that throws marks the service failed without crashing the supervisor", async () => {
  const w = world();
  const sup = supervisorFor(w, {
    spawn: () => {
      throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
    },
  });
  await sup.start();
  assert.equal(sup.snapshot().dashboard.state, "failed");
  assert.match(sup.snapshot().dashboard.detail, /ENOENT/);
  await sup.stop();
});

test("onChange reports every state move", async () => {
  const w = world();
  /** @type {string[]} */
  const seen = [];
  const sup = supervisorFor(w, { onChange: (/** @type {any} */ snap) => seen.push(snap.api.state) });
  await sup.start();
  await sup.stop();
  assert.ok(seen.includes("starting"));
  assert.ok(seen.includes("running"));
  assert.equal(seen.at(-1), "stopped");
});

test("invalid options throw before anything spawns", () => {
  const w = world();
  assert.throws(() => supervisorFor(w, { appRoot: "relative" }), TypeError);
  assert.throws(() => supervisorFor(w, { ports: { dashboard: 1, api: 1, worker: 2 } }), TypeError);
  assert.throws(() => supervisorFor(w, { execPath: "JobBored" }), TypeError);
  assert.equal(w.spawned.length, 0);
});

test("decideSupervisorExit: ours → stop; healthy replacement → attach; else respawn until budget", () => {
  assert.equal(decideSupervisorExit({ initiatedByUs: true, replacementHealthy: true, budgetLeft: true }), "stop");
  assert.equal(decideSupervisorExit({ initiatedByUs: false, replacementHealthy: true, budgetLeft: false }), "attach");
  assert.equal(decideSupervisorExit({ initiatedByUs: false, replacementHealthy: false, foreignOwner: true, budgetLeft: true }), "conflict");
  assert.equal(decideSupervisorExit({ initiatedByUs: false, replacementHealthy: false, budgetLeft: true }), "respawn");
  assert.equal(decideSupervisorExit({ initiatedByUs: false, replacementHealthy: false, budgetLeft: false }), "give_up");
});

test("parseLsofFields reads -F pc / -F n output", () => {
  assert.deepEqual(parseLsofFields("p222\nchermes\np333\ncpython3.12\n"), [
    { pid: 222, command: "hermes" },
    { pid: 333, command: "python3.12" },
  ]);
  assert.deepEqual(parseLsofFields("p222\nfcwd\nn/Users/x/Job Bored\n"), [{ pid: 222, name: "/Users/x/Job Bored" }]);
  assert.deepEqual(parseLsofFields(""), []);
  assert.deepEqual(parseLsofFields("pNaN\ncx\n"), []);
});

test("F4: start() resolves only after a boot-time crash is handled (no stale 'starting')", async () => {
  const w = world({ crashOnSpawn: (service) => service === "worker" });
  const sup = supervisorFor(w, { restartBudget: { max: 0, windowMs: 1 } });
  await sup.start();
  assert.equal(sup.snapshot().worker.state, "failed");
  await sup.stop();
});
