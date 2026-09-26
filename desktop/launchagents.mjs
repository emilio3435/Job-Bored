/**
 * First-run migration of the LaunchAgents an earlier source install left
 * behind (GFX R19). Exactly five labels, no globs: nothing else in
 * ~/Library/LaunchAgents (ai.hermes.gateway, say) is ever read or touched.
 *
 * Listing is read-only. Migration runs only when `consent === true`: each
 * label is booted out with `launchctl bootout gui/<uid>/<label>` (an argv
 * array) and its plist is moved to ~/.jobbored/launchagents-disabled/, so the
 * user can put it back. Declining changes nothing; the supervisor attaches
 * to whatever those agents run.
 */

import { existsSync, lstatSync, mkdirSync, renameSync, chmodSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { runFile } from "./run-file.mjs";

export const JOBBORED_LAUNCH_AGENT_LABELS = Object.freeze([
  "ai.jobbored.discovery.keepalive",
  "ai.jobbored.discovery.worker",
  "ai.jobbored.discovery.tunnel",
  "com.jobbored.refresh",
  "com.jobbored.expired-cleanup",
]);

/** @typedef {(args: string[]) => Promise<{ code: number }>} Launchctl */

/** @type {Launchctl} */
export const systemLaunchctl = (args) => runFile("/bin/launchctl", args);

/**
 * @param {{ home: unknown, uid: unknown }} input
 */
function validate({ home, uid }) {
  if (typeof home !== "string" || !isAbsolute(home) || home.includes("\0")) {
    throw new TypeError("launchagents: home must be an absolute path");
  }
  if (!Number.isInteger(uid) || /** @type {number} */ (uid) < 0) {
    throw new TypeError("launchagents: uid must be a non-negative integer");
  }
  return { home, uid: /** @type {number} */ (uid) };
}

/** @param {string} path */
function isFile(path) {
  try {
    const info = lstatSync(path);
    return info.isFile() || info.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * @typedef {{ label: string, plistPath: string, plistExists: boolean, loaded: boolean }} AgentInfo
 * @param {{ home: string, uid: number, launchctl?: Launchctl }} options
 * @returns {Promise<AgentInfo[]>} only the labels that have a plist or are loaded
 */
export async function listJobBoredLaunchAgents({ home, uid, launchctl = systemLaunchctl }) {
  const v = validate({ home, uid });
  /** @type {AgentInfo[]} */
  const found = [];
  for (const label of JOBBORED_LAUNCH_AGENT_LABELS) {
    const plistPath = join(v.home, "Library", "LaunchAgents", `${label}.plist`);
    const plistExists = isFile(plistPath);
    const loaded = (await launchctl(["print", `gui/${v.uid}/${label}`])).code === 0;
    if (plistExists || loaded) found.push({ label, plistPath, plistExists, loaded });
  }
  return found;
}

/**
 * @param {string} dir
 * @param {string} label
 */
function freeBackupPath(dir, label) {
  const plain = join(dir, `${label}.plist`);
  if (!existsSync(plain)) return plain;
  for (let i = 1; ; i += 1) {
    const candidate = join(dir, `${label}.${Date.now()}-${i}.plist`);
    if (!existsSync(candidate)) return candidate;
  }
}

/**
 * @param {{ consent: boolean, home: string, uid: number, launchctl?: Launchctl }} options
 */
export async function migrateLaunchAgents({ consent, home, uid, launchctl = systemLaunchctl }) {
  const v = validate({ home, uid });
  /** @type {{ label: string, movedTo: string | null }[]} */
  const migrated = [];
  /** @type {{ label: string, reason: string }[]} */
  const failed = [];
  if (consent !== true) return { declined: true, migrated, failed };

  const agents = await listJobBoredLaunchAgents({ home: v.home, uid: v.uid, launchctl });
  const disabledDir = join(v.home, ".jobbored", "launchagents-disabled");
  for (const agent of agents) {
    if (agent.loaded) {
      const result = await launchctl(["bootout", `gui/${v.uid}/${agent.label}`]);
      if (result.code !== 0) {
        failed.push({ label: agent.label, reason: `bootout exited ${result.code}` });
        continue;
      }
    }
    let movedTo = null;
    if (agent.plistExists) {
      try {
        mkdirSync(disabledDir, { recursive: true, mode: 0o700 });
        chmodSync(disabledDir, 0o700);
        movedTo = freeBackupPath(disabledDir, agent.label);
        renameSync(agent.plistPath, movedTo);
      } catch (err) {
        failed.push({ label: agent.label, reason: `move failed: ${/** @type {NodeJS.ErrnoException} */ (err).code ?? "error"}` });
        continue;
      }
    }
    migrated.push({ label: agent.label, movedTo });
  }
  return { declined: false, migrated, failed };
}
