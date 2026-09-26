/**
 * Runs and watches JobBored's three servers for the desktop app (GFX F4,
 * R19, R22). Electron-free: spawn, fetch and lsof are injected, so the tests
 * drive it against a fake port world.
 *
 * For each server:
 *   1. Probe its port. A healthy JobBored (a source checkout, a LaunchAgent,
 *      the dashboard's own worker respawn) is ATTACHED to, never doubled.
 *   2. Anything else holding the port is a CONFLICT: named through lsof,
 *      never signalled. The user decides what to do with it.
 *   3. A free port gets our own child, spawned straight from runtime-env's
 *      spec: spawn(spec.cmd, spec.args, { cwd, env }), never a shell.
 * A child that dies is replaced by the first healthy JobBored on its port,
 * or respawned with backoff until a restart budget runs out. stop() signals
 * only the children this supervisor spawned.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { runFile } from "./run-file.mjs";

export const SERVICE_NAMES = Object.freeze(/** @type {const} */ (["dashboard", "api", "worker"]));
export const DEFAULT_PORTS = Object.freeze({ dashboard: 8080, api: 3847, worker: 8644 });

/** @typedef {"dashboard" | "api" | "worker"} ServiceName */
/** @typedef {"idle" | "starting" | "running" | "attached" | "conflict" | "restarting" | "failed" | "stopped"} ServiceState */
/** @typedef {{ state: ServiceState, detail: string, port: number, pid: number | null, restarts: number }} ServiceSnapshot */
/** @typedef {{ pid: number, command: string, cwd?: string }} PortOwner */

const RESOLVER = /** @type {const} */ ({
  dashboard: "resolveDevServerEnv",
  api: "resolveScraperEnv",
  worker: "resolveWorkerEnv",
});

const LABEL = { dashboard: "Dashboard", api: "API", worker: "Discovery worker" };

const DEFAULT_TIMING = {
  pollMs: 250,
  probeTimeoutMs: 2_000,
  healthTimeoutMs: 60_000,
  attachRetryMs: 1_500,
  replacementGraceMs: 5_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 30_000,
  stopTimeoutMs: 5_000,
  monitorIntervalMs: 15_000,
};

/**
 * Is this response a healthy JobBored server of the given kind?
 * @param {ServiceName} service
 * @param {number} status
 * @param {any} body
 */
export function isHealthyBody(service, status, body) {
  if (status !== 200 || !body || typeof body !== "object") return false;
  if (service === "dashboard") return body.ok === true && Array.isArray(body.routes) && body.routes.includes("ping");
  if (service === "api") return body.service === "command-center-job-scraper";
  return body.service === "browser-use-discovery-worker";
}

/**
 * What to do after one of our children exits.
 * Mirrors scripts/lib/discovery-worker-policy.mjs decideAfterChildExit for
 * the signal cases (ours → stop, healthy replacement → hold/attach), but a
 * supervisor restarts a crash instead of exiting: that policy's "exit on
 * crash" exists for the npm-dev starter under `concurrently -k`.
 * @param {{ initiatedByUs: boolean, replacementHealthy: boolean, foreignOwner?: boolean, budgetLeft: boolean }} input
 * @returns {"stop" | "attach" | "conflict" | "respawn" | "give_up"}
 */
export function decideSupervisorExit({ initiatedByUs, replacementHealthy, foreignOwner = false, budgetLeft }) {
  if (initiatedByUs) return "stop";
  if (replacementHealthy) return "attach";
  if (foreignOwner) return "conflict";
  return budgetLeft ? "respawn" : "give_up";
}

/**
 * Parses `lsof -F` output into one record per process.
 * @param {string} text
 * @returns {Array<{ pid: number, command?: string, name?: string }>}
 */
export function parseLsofFields(text) {
  /** @type {Array<{ pid: number, command?: string, name?: string }>} */
  const out = [];
  /** @type {{ pid: number, command?: string, name?: string } | null} */
  let current = null;
  for (const line of String(text).split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      const pid = Number(value);
      current = Number.isInteger(pid) && pid > 0 ? { pid } : null;
      if (current) out.push(current);
    } else if (current && tag === "c") {
      current.command = value;
    } else if (current && tag === "n" && current.name === undefined) {
      current.name = value;
    }
  }
  return out;
}

/**
 * Who listens on a TCP port, via /usr/sbin/lsof (argv only).
 * @param {number} port
 * @returns {Promise<PortOwner[]>}
 */
export async function systemLsof(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return [];
  const listing = await runFile("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]);
  /** @type {PortOwner[]} */
  const owners = [];
  for (const { pid, command } of parseLsofFields(listing.stdout)) {
    const cwdListing = await runFile("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    const cwd = parseLsofFields(cwdListing.stdout)[0]?.name;
    owners.push({ pid, command: command || "unknown", ...(cwd ? { cwd } : {}) });
  }
  return owners;
}

/**
 * Signals a child and the process group it leads (children are spawned
 * detached, so the group holds only what that child started).
 * @param {import("node:child_process").ChildProcess} child
 * @param {NodeJS.Signals} signal
 */
function defaultKillChild(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    child.kill(signal);
  }
}

/**
 * @param {object} options
 * @param {string} options.appRoot
 * @param {string} options.home
 * @param {string} options.execPath
 * @param {string} [options.desktopVersion]
 * @param {{ dashboard: number, api: number, worker: number }} [options.ports]
 * @param {Record<string, (opts: object) => { cmd: string, args: string[], env: Record<string, string>, cwd: string }>} options.runtimeEnv
 *   scripts/lib/runtime-env.mjs (the frozen contract), loaded from the bundle.
 * @param {Record<string, string | undefined>} [options.baseEnv]
 * @param {typeof nodeSpawn} [options.spawn]
 * @param {typeof fetch} [options.fetch]
 * @param {(port: number) => Promise<PortOwner[]>} [options.lsof]
 * @param {(child: any, signal: NodeJS.Signals) => void} [options.killChild]
 * @param {{ max: number, windowMs: number }} [options.restartBudget]
 * @param {Partial<typeof DEFAULT_TIMING>} [options.timing]
 * @param {(snapshot: Record<ServiceName, ServiceSnapshot>) => void} [options.onChange]
 * @param {(service: ServiceName, chunk: string) => void} [options.onOutput]
 * @param {(line: string) => void} [options.log]
 */
export function createSupervisor({
  appRoot,
  home,
  execPath,
  desktopVersion,
  ports = DEFAULT_PORTS,
  runtimeEnv,
  baseEnv,
  spawn = nodeSpawn,
  fetch: fetchImpl = globalThis.fetch,
  lsof = systemLsof,
  killChild = defaultKillChild,
  restartBudget = { max: 5, windowMs: 10 * 60_000 },
  timing: timingOverrides = {},
  onChange = () => {},
  onOutput = () => {},
  log = () => {},
}) {
  if (typeof execPath !== "string" || !isAbsolute(execPath)) {
    throw new TypeError("supervisor: execPath must be an absolute path");
  }
  const timing = { ...DEFAULT_TIMING, ...timingOverrides };
  const resolverOptions = { appRoot, home, execPath, desktop: true, desktopVersion, ports, baseEnv };
  // Resolve every spec now: runtime-env throws TypeError on bad input, so a
  // misconfigured app fails before anything is spawned.
  /** @type {Record<ServiceName, { cmd: string, args: string[], env: Record<string, string>, cwd: string }>} */
  const specs = /** @type {any} */ ({});
  for (const name of SERVICE_NAMES) {
    const resolve = runtimeEnv[RESOLVER[name]];
    if (typeof resolve !== "function") throw new TypeError(`supervisor: runtimeEnv.${RESOLVER[name]} is missing`);
    specs[name] = resolve(resolverOptions);
  }

  const services = Object.fromEntries(
    SERVICE_NAMES.map((name) => [
      name,
      {
        name,
        port: ports[name],
        state: /** @type {ServiceState} */ ("idle"),
        detail: "",
        /** @type {any} */ child: null,
        /** @type {number | null} */ attachedPid: null,
        /** @type {number[]} */ restartTimes: [],
        restarts: 0,
        /** @type {Promise<void> | null} */ busy: null,
        failedChecks: 0,
        /** @type {ReturnType<typeof setTimeout> | null} */ retryTimer: null,
      },
    ]),
  );
  /** @typedef {typeof services[string]} Service */

  let stopping = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let monitor = null;
  /** @type {Promise<void> | null} */
  let starting = null;

  const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

  function snapshot() {
    return /** @type {Record<ServiceName, ServiceSnapshot>} */ (
      Object.fromEntries(
        SERVICE_NAMES.map((name) => {
          const s = services[name];
          return [name, { state: s.state, detail: s.detail, port: s.port, pid: s.child?.pid ?? s.attachedPid, restarts: s.restarts }];
        }),
      )
    );
  }

  /** @param {Service} s @param {ServiceState} state @param {string} detail */
  function setState(s, state, detail) {
    if (s.state === state && s.detail === detail) return;
    s.state = state;
    s.detail = detail;
    log(`${s.name}: ${state}${detail ? ` (${detail})` : ""}`);
    try {
      onChange(snapshot());
    } catch {
      // A tray repaint error must never take the supervisor down.
    }
  }

  /** @param {string | undefined} path */
  function tildify(path) {
    if (!path) return "";
    return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
  }

  /** @param {Service} s */
  async function probe(s) {
    const url =
      s.name === "dashboard" ? `http://127.0.0.1:${s.port}/__proxy/ping` : `http://127.0.0.1:${s.port}/health`;
    /** @type {Record<string, string>} */
    const headers = s.name === "dashboard" ? { origin: `http://localhost:${s.port}` } : {};
    try {
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timing.probeTimeoutMs), redirect: "manual" });
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { healthy: isHealthyBody(s.name, res.status, body), body };
    } catch {
      return { healthy: false, body: null };
    }
  }

  /** @param {Service} s */
  async function owners(s) {
    try {
      return await lsof(s.port);
    } catch {
      return [];
    }
  }

  /** @param {Service} s */
  async function attach(s) {
    const [owner] = await owners(s);
    s.attachedPid = owner?.pid ?? null;
    const where = owner ? `${tildify(owner.cwd) || owner.command} (pid ${owner.pid})` : "another JobBored";
    setState(s, "attached", `Running from ${where}`);
  }

  /** @param {Service} s @param {PortOwner[]} found */
  function conflict(s, found) {
    s.attachedPid = null;
    const who = found.length
      ? found.map((o) => `${o.command} (pid ${o.pid})`).join(", ")
      : "another app";
    setState(s, "conflict", `Port ${s.port} is in use by ${who}`);
  }

  /** @param {Service} s */
  async function ensure(s) {
    if (stopping) return;
    if (s.child) return;
    if ((await probe(s)).healthy) return attach(s);
    let found = await owners(s);
    if (found.length) {
      // A JobBored may still be booting on it: look once more.
      await sleep(timing.attachRetryMs);
      if ((await probe(s)).healthy) return attach(s);
      found = await owners(s);
      if (found.length) return conflict(s, found);
    }
    await spawnChild(s);
  }

  /** @param {Service} s */
  async function spawnChild(s) {
    if (stopping || s.child) return;
    s.attachedPid = null;
    const spec = specs[/** @type {ServiceName} */ (s.name)];
    setState(s, s.restarts ? "restarting" : "starting", "");
    let child;
    try {
      child = spawn(spec.cmd, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    } catch (err) {
      setState(s, "failed", `could not start: ${/** @type {Error} */ (err).message}`);
      return;
    }
    s.child = child;
    s.failedChecks = 0;
    const forward = (/** @type {Buffer | string} */ chunk) => onOutput(/** @type {ServiceName} */ (s.name), String(chunk));
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);
    let exited = false;
    /** @type {Promise<void> | null} */
    let exitHandled = null;
    /** @type {(code: number | null, signal: string | null) => void} */
    const onExit = (code, signal) => {
      if (exited) return;
      exited = true;
      if (s.child === child) s.child = null;
      exitHandled = handleExit(s, code, signal, /** @type {any} */ (child).__jbStopRequested === true);
    };
    child.once("exit", onExit);
    child.once("error", (/** @type {Error} */ err) => {
      forward(`[desktop] ${s.name} spawn error: ${err.message}\n`);
      onExit(null, null);
    });

    const deadline = Date.now() + timing.healthTimeoutMs;
    while (Date.now() < deadline) {
      if (stopping) return;
      if (s.child !== child) {
        // It died while booting: report where that left the service.
        await exitHandled;
        return;
      }
      if ((await probe(s)).healthy) {
        if (s.child === child) setState(s, "running", `pid ${child.pid}`);
        return;
      }
      await sleep(timing.pollMs);
    }
    if (s.child === child) {
      setState(s, "failed", `did not answer health checks within ${Math.round(timing.healthTimeoutMs / 1000)} s`);
    }
  }

  /** @param {Service} s */
  function budgetLeft(s) {
    const now = Date.now();
    s.restartTimes = s.restartTimes.filter((t) => now - t < restartBudget.windowMs);
    return s.restartTimes.length < restartBudget.max;
  }

  /**
   * @param {Service} s
   * @param {number | null} code
   * @param {string | null} signal
   * @param {boolean} initiatedByUs
   */
  async function handleExit(s, code, signal, initiatedByUs) {
    if (stopping || initiatedByUs) {
      setState(s, "stopped", "");
      return;
    }
    const why = signal ? `signal ${signal}` : `exit code ${code}`;
    // A signal we did not send usually means the dashboard's full-boot is
    // replacing the worker: give a replacement a moment to come up.
    let replacementHealthy = false;
    const graceUntil = Date.now() + (signal ? timing.replacementGraceMs : 0);
    do {
      replacementHealthy = (await probe(s)).healthy;
      if (replacementHealthy || stopping) break;
      await sleep(timing.pollMs);
    } while (Date.now() < graceUntil);
    if (stopping) return setState(s, "stopped", "");
    const found = replacementHealthy ? [] : await owners(s);
    const action = decideSupervisorExit({
      initiatedByUs: false,
      replacementHealthy,
      foreignOwner: found.length > 0,
      budgetLeft: budgetLeft(s),
    });
    if (action === "attach") return attach(s);
    if (action === "conflict") return conflict(s, found);
    if (action === "give_up") {
      setState(s, "failed", `stopped after ${s.restarts} restarts (last: ${why}); use Restart services`);
      return;
    }
    s.restartTimes.push(Date.now());
    s.restarts += 1;
    const delay = Math.min(timing.backoffBaseMs * 2 ** (s.restartTimes.length - 1), timing.backoffMaxMs);
    setState(s, "restarting", `${why}; retrying in ${Math.max(1, Math.round(delay / 1000))} s`);
    s.retryTimer = setTimeout(() => {
      s.retryTimer = null;
      void run(s, () => spawnChild(s));
    }, delay);
  }

  /** Serialises work per service so one port never gets two spawns. */
  function run(/** @type {Service} */ s, /** @type {() => Promise<void>} */ work) {
    const next = (s.busy ?? Promise.resolve()).then(work, work).finally(() => {
      if (s.busy === next) s.busy = null;
    });
    s.busy = next;
    return next;
  }

  /** One pass over every service: attach/take over/unstick as needed. */
  async function checkNow() {
    await Promise.all(
      SERVICE_NAMES.map((name) =>
        run(services[name], async () => {
          const s = services[name];
          if (stopping || s.retryTimer || s.state === "failed") return;
          if (s.child) {
            if (s.state !== "running") return;
            if ((await probe(s)).healthy) {
              s.failedChecks = 0;
              return;
            }
            s.failedChecks += 1;
            if (s.failedChecks >= 3) {
              log(`${name}: unresponsive for 3 checks; restarting our own child`);
              killChild(s.child, "SIGTERM");
            }
            return;
          }
          await ensure(s);
        }),
      ),
    );
  }

  function start() {
    if (starting) return starting;
    stopping = false;
    starting = Promise.all(SERVICE_NAMES.map((name) => run(services[name], () => ensure(services[name])))).then(() => {
      if (timing.monitorIntervalMs > 0 && !monitor) {
        monitor = setInterval(() => void checkNow(), timing.monitorIntervalMs);
        monitor.unref?.();
      }
    });
    return starting.finally(() => {
      starting = null;
    });
  }

  /** @param {Service} s */
  async function stopOne(s) {
    if (s.retryTimer) {
      clearTimeout(s.retryTimer);
      s.retryTimer = null;
    }
    const child = s.child;
    if (!child) {
      if (s.state !== "attached" && s.state !== "conflict") setState(s, "stopped", "");
      return;
    }
    child.__jbStopRequested = true;
    const exited = new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve(undefined);
      else child.once("exit", () => resolve(undefined));
    });
    killChild(child, "SIGTERM");
    const timer = setTimeout(() => killChild(child, "SIGKILL"), timing.stopTimeoutMs);
    await exited;
    clearTimeout(timer);
    if (s.child === child) s.child = null;
    setState(s, "stopped", "");
  }

  async function stop() {
    stopping = true;
    if (monitor) {
      clearInterval(monitor);
      monitor = null;
    }
    await Promise.all(SERVICE_NAMES.map((name) => stopOne(services[name])));
    // Attached and conflicting owners are left exactly as they were.
    for (const name of SERVICE_NAMES) {
      const s = services[name];
      if (s.state === "attached" || s.state === "conflict") setState(s, "stopped", "");
    }
  }

  async function restart() {
    await stop();
    for (const name of SERVICE_NAMES) {
      const s = services[name];
      s.restartTimes = [];
      s.restarts = 0;
    }
    await Promise.all(SERVICE_NAMES.map((name) => services[name].busy));
    await start();
  }

  /** PIDs of the children this supervisor started and still owns. */
  function ownedPids() {
    return SERVICE_NAMES.map((name) => services[name].child?.pid).filter((pid) => Number.isInteger(pid));
  }

  return { start, stop, restart, snapshot, checkNow, ownedPids, label: (/** @type {ServiceName} */ n) => LABEL[n] };
}
