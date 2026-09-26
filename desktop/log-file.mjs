/**
 * Append-only log files under ~/.jobbored/logs (dir 0700, files 0600),
 * rotated once at 5 MB. The app logs events, never raw deep-link URLs.
 */

import { appendFileSync, chmodSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 5 * 1024 * 1024;

/** @param {string} dir */
export function createLogSink(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best effort: the directory may belong to an earlier install.
  }
  /** @param {string} name @param {string} text */
  function write(name, text) {
    const file = join(dir, name);
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
    } catch {
      // No file yet.
    }
    try {
      appendFileSync(file, text, { mode: 0o600 });
    } catch {
      // Logging must never take the app down.
    }
  }
  return {
    path: (/** @type {string} */ name) => join(dir, name),
    /** @param {string} line */
    event(line) {
      write("desktop.log", `${new Date().toISOString()} ${line}\n`);
    },
    /** @param {string} service @param {string} chunk */
    child(service, chunk) {
      write(`${service}.log`, chunk);
    },
  };
}
