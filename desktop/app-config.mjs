/**
 * Pure configuration for the desktop app: smoke-mode ports, where the app
 * bundle lives, and the environment children start from.
 */

import { join } from "node:path";

/** Emilio's live stack. Smoke mode never binds these. */
export const LIVE_PORTS = Object.freeze([8080, 8644, 3847]);
export const SMOKE_DEFAULT_PORTS = Object.freeze({ dashboard: 18680, api: 18681, worker: 18682 });

/** Env names agreed with DESK-D's CI (desktop-mac.yml). */
const SMOKE_PORT_ENV = Object.freeze({
  dashboard: "JOBBORED_SMOKE_DASHBOARD_PORT",
  api: "JOBBORED_SMOKE_API_PORT",
  worker: "JOBBORED_SMOKE_WORKER_PORT",
});

/** @param {Record<string, string | undefined>} env */
export function isSmokeMode(env) {
  return env.JOBBORED_DESKTOP_SMOKE === "1";
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ dashboard: number, api: number, worker: number }}
 */
export function resolveSmokePorts(env) {
  /** @type {Record<string, number>} */
  const ports = {};
  for (const [key, name] of Object.entries(SMOKE_PORT_ENV)) {
    const raw = env[name];
    if (raw === undefined || raw === "") {
      ports[key] = SMOKE_DEFAULT_PORTS[/** @type {keyof typeof SMOKE_DEFAULT_PORTS} */ (key)];
      continue;
    }
    if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) {
      throw new TypeError(`${name} must be a port number 1-65535`);
    }
    ports[key] = Number(raw);
  }
  for (const [key, port] of Object.entries(ports)) {
    if (LIVE_PORTS.includes(port)) throw new RangeError(`smoke ${key} port ${port} is a live port; pick another`);
  }
  if (new Set(Object.values(ports)).size !== 3) throw new RangeError("smoke ports must be distinct");
  return /** @type {any} */ (ports);
}

/**
 * The read-only app the children run from.
 * @param {{ isPackaged: boolean, resourcesPath: string, desktopDir: string, exists: (path: string) => boolean }} input
 */
export function resolveAppRoot({ isPackaged, resourcesPath, desktopDir, exists }) {
  if (isPackaged) return join(resourcesPath, "app-bundle");
  const staged = join(desktopDir, "app-bundle");
  return exists(staged) ? staged : join(desktopDir, "..");
}

const INHERITED_KEYS = ["LANG", "LC_ALL", "LC_CTYPE", "USER", "LOGNAME", "TZ"];
/** System tools first; Homebrew last so tailscale/cloudflared still resolve. */
const CHILD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin";

/**
 * The environment every child starts from, before runtime-env adds its
 * desktop keys. Nothing from the app's own env leaks through except
 * locale and identity: no keys, no NODE_OPTIONS, no DYLD_*.
 * @param {Record<string, string | undefined>} env
 * @param {string} tmpDir
 */
export function childBaseEnv(env, tmpDir) {
  /** @type {Record<string, string>} */
  const out = { PATH: CHILD_PATH, TMPDIR: tmpDir };
  for (const key of INHERITED_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
}

/**
 * @param {Record<string, { state: string }>} snapshot
 * @param {any} ping
 * @param {string} appVersion
 */
export function evaluateSmoke(snapshot, ping, appVersion) {
  /** @type {string[]} */
  const failures = [];
  for (const [name, s] of Object.entries(snapshot)) {
    if (s.state !== "running") failures.push(`${name} is ${s.state}, not running`);
  }
  if (!ping || ping.ok !== true) failures.push("dashboard ping failed");
  else {
    if (ping.runtime !== "desktop") failures.push(`ping runtime is ${ping.runtime}`);
    if (ping.desktopVersion !== appVersion) failures.push(`ping desktopVersion ${ping.desktopVersion} != ${appVersion}`);
  }
  return { ok: failures.length === 0, failures };
}
