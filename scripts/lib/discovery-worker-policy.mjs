/**
 * Policy for scripts/start-discovery-worker-local.mjs when a healthy worker
 * already listens on the port.
 *
 * Default: REUSE it. Restarting a healthy worker ("to load latest code") is a
 * developer's explicit intent at `npm run dev` time — never something a
 * runtime self-repair (dashboard full-boot / fix-setup, keep-alive, launchd
 * autostart) should do, because under `npm run dev` that healthy worker is
 * the foreground child and killing it takes the whole stack down via
 * `concurrently -k` (observed 2026-09-02).
 */

/**
 * @param {{ existingHealthy: boolean, restartExisting: boolean }} input
 * @returns {"start" | "reuse" | "restart"}
 */
export function decideExistingWorkerAction({ existingHealthy, restartExisting }) {
  if (!existingHealthy) return "start";
  return restartExisting ? "restart" : "reuse";
}

/**
 * `--restart-existing` (the dev script) or BROWSER_USE_DISCOVERY_RESTART_EXISTING=true
 * opt into restarting; the legacy BROWSER_USE_DISCOVERY_REUSE_EXISTING=true
 * still wins and forces reuse.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {{ restartExisting: boolean }}
 */
export function parseStarterOptions(argv, env) {
  const truthy = (v) => String(v || "").trim().toLowerCase() === "true";
  if (truthy(env.BROWSER_USE_DISCOVERY_REUSE_EXISTING)) return { restartExisting: false };
  const flag = Array.isArray(argv) && argv.includes("--restart-existing");
  return { restartExisting: flag || truthy(env.BROWSER_USE_DISCOVERY_RESTART_EXISTING) };
}
