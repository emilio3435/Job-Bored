import { spawn } from "node:child_process";

/**
 * On native Windows npm/npx are .cmd batch files, so a bare
 * spawn("npm", ...) without a shell raises ENOENT — and EINVAL since
 * Node 20.12 (CVE-2024-27980 hardening). Resolve the real command name and
 * shell flag in one place so every script spawns npm/npx the same way on
 * every OS. Plain `node`/process.execPath spawns never need the shim.
 */
export function resolveNpmInvocation(
  command,
  { platform = process.platform } = {},
) {
  const win = platform === "win32";
  if (win && (command === "npm" || command === "npx")) {
    return { command: `${command}.cmd`, shell: true };
  }
  return { command, shell: false };
}

/**
 * Drop-in replacement for spawn("npm"|"npx", args, options) that applies the
 * Windows .cmd + shell shim. The shell decision always comes from the
 * platform, never from caller options.
 */
export function spawnNpm(
  command,
  args = [],
  options = {},
  { platform = process.platform, spawnImpl = spawn } = {},
) {
  const invocation = resolveNpmInvocation(command, { platform });
  return spawnImpl(invocation.command, args, {
    ...options,
    shell: invocation.shell,
  });
}
