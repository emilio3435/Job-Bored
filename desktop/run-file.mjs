/**
 * Runs an absolute-path executable with an argv array and no shell, and
 * resolves (never rejects) with its exit code and output. The one way the
 * desktop app runs system tools (launchctl, lsof).
 */

import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";

/**
 * @typedef {{ code: number, stdout: string, stderr: string }} RunResult
 * @param {string} file
 * @param {string[]} args
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<RunResult>}
 */
export function runFile(file, args, { timeoutMs = 5_000 } = {}) {
  if (!isAbsolute(file)) throw new TypeError("runFile: file must be an absolute path");
  if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
    throw new TypeError("runFile: args must be an array of strings");
  }
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { shell: false, timeout: timeoutMs, maxBuffer: 1024 * 1024, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}
