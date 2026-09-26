/**
 * How to spawn each JobBored server. This file is the contract between the
 * source launchers (scripts/start-*-local.mjs) and the desktop supervisor
 * (DESK-A, desktop/supervisor.mjs). GFX R14 froze it; change it only with
 * both sides.
 *
 * @typedef {object} RuntimePorts
 * @property {number} [dashboard] dev-server.mjs listen port (PORT). Default 8080.
 * @property {number} [api] server/index.mjs listen port (PORT, and the
 *   dashboard's JOBBORED_API_PORT). Default 3847.
 * @property {number} [worker] discovery worker port
 *   (BROWSER_USE_DISCOVERY_PORT). Default 8644.
 *
 * @typedef {object} RuntimeEnvOptions
 * @property {string} appRoot Absolute path of the app: a repo checkout in
 *   source mode, the read-only bundle's app folder in desktop mode.
 * @property {string} [home] Absolute HOME for the child. Required in desktop
 *   mode; every write lands under `<home>/.jobbored`.
 * @property {string} [execPath] Absolute runtime binary. Required in desktop
 *   mode: Electron's `process.execPath`, run with ELECTRON_RUN_AS_NODE=1
 *   (S1). Source mode defaults to `node` on PATH, as the launchers always did.
 * @property {boolean} [desktop] Desktop mode. Omitted: true only when
 *   `baseEnv.JOBBORED_DESKTOP === "1"`.
 * @property {string} [desktopVersion] The app's version, surfaced by the
 *   dashboard's /__proxy/ping as `desktopVersion`.
 * @property {RuntimePorts} [ports] Port overrides; distinct, 1-65535.
 * @property {Record<string, string | undefined>} [baseEnv] Environment the
 *   child inherits. Default `process.env`.
 * @property {(message: string) => void} [warn] Receives unreadable env-file
 *   warnings. Default: silent.
 *
 * @typedef {object} RuntimeSpawnSpec
 * @property {string} cmd Executable. Pass to `spawn(cmd, args, { cwd, env })`
 *   with no `shell` option (R18). The source-mode scraper is always `npm`
 *   (execPath ignored); spawn it through scripts/lib/spawn-npm.mjs.
 * @property {string[]} args Argument vector; never a shell string.
 * @property {Record<string, string>} env Complete child environment.
 * @property {string} cwd Working directory.
 *
 * Desktop mode sets, on every child: ELECTRON_RUN_AS_NODE=1,
 * JOBBORED_DESKTOP=1, JOBBORED_DESKTOP_VERSION (when given),
 * JOBBORED_REPO=<appRoot>, HOME, JOBBORED_HOME, JOBBORED_BOOTSTRAP_STATE_PATH,
 * JOBBORED_DASHBOARD_CONFIG_PATH, and a PATH that includes /usr/sbin (F2).
 * Invalid options throw TypeError: nothing is spawned on a guess.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { mergeEnvFileValues, parseEnvFileText } from "./env-file-merge.mjs";
import { applyAtsProviderAliases, applyDiscoveryWorkerLlmAliases } from "./llm-env.mjs";
import { resolveJobBoredPaths } from "./paths.mjs";

export const DEFAULT_RUNTIME_PORTS = Object.freeze({
  dashboard: 8080,
  api: 3847,
  worker: 8644,
});

export const WORKER_ENTRY = "integrations/browser-use-discovery/src/server.ts";
export const BOOTSTRAP_STATE_FILENAME = "discovery-local-bootstrap.json";
const SYSTEM_PATH_DIRS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const DESKTOP_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const BROWSER_COMMAND_ENV_KEYS = [
  "BROWSER_USE_DISCOVERY_BROWSER_COMMAND",
  "BROWSER_USE_COMMAND",
  "DISCOVERY_BROWSER_COMMAND",
];

/** @param {unknown} value */
function clean(value) {
  return String(value ?? "").trim();
}

/**
 * @param {string} label
 * @param {unknown} value
 */
function requireAbsolutePath(label, value) {
  const path = typeof value === "string" ? value : "";
  if (!path || path.includes("\0") || !isAbsolute(path)) {
    throw new TypeError(`runtime-env: ${label} must be an absolute path`);
  }
  return path;
}

/**
 * @param {RuntimePorts | undefined} ports
 * @returns {Partial<Record<keyof RuntimePorts, number>>}
 */
function normalizePorts(ports) {
  /** @type {Partial<Record<keyof RuntimePorts, number>>} */
  const out = {};
  if (ports == null) return out;
  if (typeof ports !== "object") throw new TypeError("runtime-env: ports must be an object");
  const seen = new Set();
  for (const key of /** @type {(keyof RuntimePorts)[]} */ (["dashboard", "api", "worker"])) {
    const raw = ports[key];
    if (raw === undefined) continue;
    if (!Number.isInteger(raw) || raw < 1 || raw > 65535) {
      throw new TypeError(`runtime-env: ports.${key} must be an integer 1-65535`);
    }
    if (seen.has(raw)) throw new TypeError(`runtime-env: ports.${key} duplicates another port`);
    seen.add(raw);
    out[key] = raw;
  }
  return out;
}

/** Single-quote one word for a POSIX shell. */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/**
 * @param {RuntimeEnvOptions} opts
 */
function normalizeOptions(opts) {
  if (!opts || typeof opts !== "object") throw new TypeError("runtime-env: options are required");
  const baseEnv = opts.baseEnv && typeof opts.baseEnv === "object" ? opts.baseEnv : process.env;
  const appRoot = requireAbsolutePath("appRoot", opts.appRoot);
  const desktop =
    typeof opts.desktop === "boolean" ? opts.desktop : clean(baseEnv.JOBBORED_DESKTOP) === "1";
  const ports = normalizePorts(opts.ports);
  const warn = typeof opts.warn === "function" ? opts.warn : () => {};

  if (!desktop) {
    const home = opts.home ? requireAbsolutePath("home", opts.home) : "";
    const execPath = opts.execPath ? requireAbsolutePath("execPath", opts.execPath) : "";
    return { desktop, appRoot, home, execPath, ports, baseEnv, warn, desktopVersion: "" };
  }

  const home = requireAbsolutePath("home", opts.home);
  const execPath = requireAbsolutePath("execPath", opts.execPath);
  const desktopVersion = opts.desktopVersion === undefined || opts.desktopVersion === null
    ? ""
    : String(opts.desktopVersion);
  if (desktopVersion && !DESKTOP_VERSION_PATTERN.test(desktopVersion)) {
    throw new TypeError("runtime-env: desktopVersion must look like a version (1.2.3)");
  }
  return { desktop, appRoot, home, execPath, ports, baseEnv, warn, desktopVersion };
}

/** @param {Record<string, unknown>} env */
function stringEnv(env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}

/** @param {unknown} path */
function withSystemPath(path) {
  const parts = clean(path).split(":").filter(Boolean);
  for (const dir of SYSTEM_PATH_DIRS) {
    if (!parts.includes(dir)) parts.push(dir);
  }
  return parts.join(":");
}

/**
 * The environment every desktop child shares.
 * @param {ReturnType<typeof normalizeOptions>} o
 */
function desktopBaseEnv(o) {
  const inheritedHome = clean(o.baseEnv.JOBBORED_HOME);
  const jobBoredHome = inheritedHome && isAbsolute(inheritedHome)
    ? inheritedHome
    : join(o.home, ".jobbored");
  /** @type {Record<string, string | undefined>} */
  const env = {
    ...o.baseEnv,
    HOME: o.home,
    PATH: withSystemPath(o.baseEnv.PATH),
    ELECTRON_RUN_AS_NODE: "1",
    JOBBORED_DESKTOP: "1",
    JOBBORED_DESKTOP_VERSION: o.desktopVersion || undefined,
    JOBBORED_REPO: o.appRoot,
    JOBBORED_HOME: jobBoredHome,
    JOBBORED_BOOTSTRAP_STATE_PATH: join(jobBoredHome, BOOTSTRAP_STATE_FILENAME),
    JOBBORED_DASHBOARD_CONFIG_PATH: join(jobBoredHome, "desktop", "config.js"),
  };
  return env;
}

/**
 * @param {ReturnType<typeof normalizeOptions>} o
 */
function sourceBaseEnv(o) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...o.baseEnv };
  if (o.home) env.HOME = o.home;
  return env;
}

/**
 * @param {string[]} paths
 * @param {(message: string) => void} warn
 */
function readEnvFileLayers(paths, warn) {
  /** @type {Record<string, string>[]} */
  const layers = [];
  for (const path of paths) {
    if (!path || !existsSync(path)) continue;
    try {
      layers.push(parseEnvFileText(readFileSync(path, "utf8")));
    } catch (err) {
      warn(`could not read ${path}: ${err && /** @type {Error} */ (err).message ? /** @type {Error} */ (err).message : String(err)}`);
    }
  }
  return layers;
}

/**
 * @param {ReturnType<typeof normalizeOptions>} o
 * @param {Record<string, string | undefined>} env
 */
function jobBoredPathsFor(o, env) {
  const scoped =
    o.home && !clean(env.JOBBORED_HOME) ? { ...env, JOBBORED_HOME: join(o.home, ".jobbored") } : env;
  return resolveJobBoredPaths({ env: scoped, repoRoot: o.appRoot, cwd: o.appRoot });
}

/**
 * @param {ReturnType<typeof normalizeOptions>} o
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, keyof RuntimePorts>} keys env key -> port it takes
 */
function applyPorts(o, env, keys) {
  for (const [envKey, portKey] of Object.entries(keys)) {
    const port = o.ports[portKey];
    if (port !== undefined) env[envKey] = String(port);
  }
  return env;
}

/**
 * dev-server.mjs: the dashboard, /__proxy/*, and the /profile proxy.
 * @param {RuntimeEnvOptions} opts
 * @returns {RuntimeSpawnSpec}
 */
export function resolveDevServerEnv(opts) {
  const o = normalizeOptions(opts);
  const env = o.desktop ? desktopBaseEnv(o) : sourceBaseEnv(o);
  applyPorts(o, env, {
    PORT: "dashboard",
    JOBBORED_API_PORT: "api",
    BROWSER_USE_DISCOVERY_PORT: "worker",
  });
  return {
    cmd: o.execPath || "node",
    args: ["dev-server.mjs"],
    env: stringEnv(env),
    cwd: o.appRoot,
  };
}

/**
 * server/index.mjs: the local API (/profile, /api/*).
 * Source mode is `npm run start --prefix server`, as start-scraper-local.mjs
 * always ran it; desktop mode runs index.mjs directly (no npm in the bundle).
 * @param {RuntimeEnvOptions} opts
 * @returns {RuntimeSpawnSpec}
 */
export function resolveScraperEnv(opts) {
  const o = normalizeOptions(opts);
  const base = o.desktop ? desktopBaseEnv(o) : sourceBaseEnv(o);
  const files = o.desktop
    ? [jobBoredPathsFor(o, base).workerEnv]
    : [
        join(o.appRoot, "server", ".env"),
        join(o.appRoot, "integrations", "browser-use-discovery", ".env"),
      ];
  // The scraper has always let a later file's value (even an empty one)
  // replace an earlier one; the process env wins over every file.
  const fromFiles = Object.assign({}, ...readEnvFileLayers(files, o.warn));
  /** @type {Record<string, string | undefined>} */
  const env = { ...fromFiles, ...base };
  const fallbackGemini = clean(
    env.ATS_GEMINI_API_KEY ||
      env.GEMINI_API_KEY ||
      env.BROWSER_USE_DISCOVERY_GEMINI_API_KEY ||
      env.DISCOVERY_GEMINI_API_KEY,
  );
  if (!clean(env.ATS_GEMINI_API_KEY) && fallbackGemini) env.ATS_GEMINI_API_KEY = fallbackGemini;
  if (!clean(env.GEMINI_API_KEY) && fallbackGemini) env.GEMINI_API_KEY = fallbackGemini;
  applyPorts(o, env, { PORT: "api" });
  const aliased = applyAtsProviderAliases(env);

  if (!o.desktop) {
    return {
      cmd: "npm",
      args: ["run", "start", "--prefix", "server"],
      env: stringEnv(aliased),
      cwd: o.appRoot,
    };
  }
  return {
    cmd: o.execPath,
    args: ["index.mjs"],
    env: stringEnv(aliased),
    cwd: join(o.appRoot, "server"),
  };
}

/**
 * @param {Record<string, string | undefined>} source
 */
function readFirstEnvValue(source) {
  for (const key of BROWSER_COMMAND_ENV_KEYS) {
    const value = clean(source[key]);
    if (value) return value;
  }
  return "";
}

/**
 * @param {ReturnType<typeof normalizeOptions>} o
 * @param {Record<string, string>} fromFiles
 */
function resolveBrowserUseCommand(o, fromFiles) {
  const bundled = join(o.appRoot, "integrations", "browser-use-discovery", "bin", "browser-use-agent-browser.mjs");
  const processCommand = readFirstEnvValue(o.baseEnv);
  if (processCommand) {
    // session.ts executes this through a shell. A configured executable path
    // is one word even when HOME or the app folder contains spaces.
    return existsSync(processCommand) ? shellQuote(processCommand) : processCommand;
  }

  const fileCommand = readFirstEnvValue(fromFiles);
  const isPathLike = fileCommand.includes("/") || fileCommand.includes("\\");
  if (fileCommand && (!isPathLike || existsSync(resolve(o.appRoot, fileCommand)))) {
    return isPathLike ? shellQuote(fileCommand) : fileCommand;
  }
  if (fileCommand) {
    o.warn(`ignoring stale browser command from env file because it does not exist: ${fileCommand}`);
  }
  // Desktop: the bin's `#!/usr/bin/env node` finds no node on a fresh Mac,
  // so run it on Electron's Node. The worker spawns this line through a
  // shell (session.ts), so each path is quoted for a HOME with spaces (R18).
  return o.desktop ? `${shellQuote(o.execPath)} ${shellQuote(bundled)}` : bundled;
}

/**
 * integrations/browser-use-discovery/src/server.ts under strip-types.
 * @param {RuntimeEnvOptions} opts
 * @returns {RuntimeSpawnSpec}
 */
export function resolveWorkerEnv(opts) {
  const o = normalizeOptions(opts);
  const base = o.desktop ? desktopBaseEnv(o) : sourceBaseEnv(o);
  const initialPaths = jobBoredPathsFor(o, base);
  const files = (o.desktop
    ? [initialPaths.workerEnv]
    : [
        join(o.appRoot, "integrations", "browser-use-discovery", ".env"),
        join(o.appRoot, "server", ".env"),
        initialPaths.workerEnv,
      ]
  ).filter((path, index, all) => path && all.indexOf(path) === index);
  // Later files override earlier ones, but a present-but-EMPTY value never
  // erases a configured one (scripts/lib/env-file-merge.mjs).
  const fromFiles = mergeEnvFileValues(readEnvFileLayers(files, o.warn));
  /** @type {Record<string, string | undefined>} */
  const env = { ...fromFiles, ...base };
  applyPorts(o, env, { BROWSER_USE_DISCOVERY_PORT: "worker" });
  const paths = jobBoredPathsFor(o, env);
  const fallbackGemini =
    clean(env.BROWSER_USE_DISCOVERY_GEMINI_API_KEY) ||
    clean(env.ATS_GEMINI_API_KEY) ||
    clean(env.GEMINI_API_KEY);
  const runtimeEnv = {
    ...env,
    BROWSER_USE_DISCOVERY_RUN_MODE: clean(env.BROWSER_USE_DISCOVERY_RUN_MODE) || "local",
    BROWSER_USE_DISCOVERY_HOST: clean(env.BROWSER_USE_DISCOVERY_HOST) || "127.0.0.1",
    BROWSER_USE_DISCOVERY_PORT:
      clean(env.BROWSER_USE_DISCOVERY_PORT) || String(DEFAULT_RUNTIME_PORTS.worker),
    BROWSER_USE_DISCOVERY_CONFIG_PATH:
      clean(env.BROWSER_USE_DISCOVERY_CONFIG_PATH) ||
      clean(env.BROWSER_USE_DISCOVERY_WORKER_CONFIG) ||
      paths.workerConfig,
    BROWSER_USE_DISCOVERY_WORKER_CONFIG:
      clean(env.BROWSER_USE_DISCOVERY_WORKER_CONFIG) ||
      clean(env.BROWSER_USE_DISCOVERY_CONFIG_PATH) ||
      paths.workerConfig,
    BROWSER_USE_DISCOVERY_ENV_FILE:
      clean(env.BROWSER_USE_DISCOVERY_ENV_FILE) ||
      clean(env.BROWSER_USE_DISCOVERY_WORKER_ENV) ||
      paths.workerEnv,
    BROWSER_USE_DISCOVERY_WORKER_ENV:
      clean(env.BROWSER_USE_DISCOVERY_WORKER_ENV) ||
      clean(env.BROWSER_USE_DISCOVERY_ENV_FILE) ||
      paths.workerEnv,
    BROWSER_USE_DISCOVERY_STATE_DB_PATH:
      clean(env.BROWSER_USE_DISCOVERY_STATE_DB_PATH) || paths.workerStateDb,
    BROWSER_USE_DISCOVERY_BROWSER_COMMAND: resolveBrowserUseCommand(o, fromFiles),
    BROWSER_USE_DISCOVERY_GEMINI_API_KEY: fallbackGemini,
  };
  return {
    cmd: o.execPath || "node",
    args: ["--experimental-strip-types", WORKER_ENTRY],
    env: stringEnv(applyDiscoveryWorkerLlmAliases(runtimeEnv)),
    cwd: o.appRoot,
  };
}
