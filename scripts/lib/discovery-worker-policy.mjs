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
 * @param {{ existingHealthy: boolean, restartExisting: boolean, portBound?: boolean, foreignCheckout?: boolean }} input
 * @returns {"start" | "reuse" | "restart" | "hold_foreign"}
 */
export function decideExistingWorkerAction({ existingHealthy, restartExisting, portBound = false, foreignCheckout = false }) {
  // BEAUDIT G7: a healthy worker from another checkout is never reused or
  // restarted from here — hold and report it.
  if (existingHealthy && foreignCheckout) return "hold_foreign";
  if (!existingHealthy) {
    // BEAUDIT G5: the port answers but it is not the worker (Hermes
    // gateway, another checkout). Spawning anyway dies with EADDRINUSE and
    // exits 1, and concurrently -k takes web+scraper down — hold instead.
    return portBound ? "hold_foreign" : "start";
  }
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

/**
 * What the starter does after its worker child exits.
 *
 * A signal we did not send means another process restarted the worker
 * (the dashboard's full-boot after an env-key write, a keep-alive, an
 * autostart). Under `npm run dev` the starter is a `concurrently -k` child,
 * so exiting would tear the whole stack down — instead: if a healthy
 * replacement already owns the port, hold the process open on its behalf;
 * if nothing replaced it, respawn. A crash (exit code, no signal) or our own
 * shutdown exits as before.
 *
 * @param {{ signal?: string | null, code?: number | null, initiatedByUs: boolean, replacementHealthy: boolean }} input
 * @returns {"hold" | "respawn" | "exit"}
 */
export function decideAfterChildExit({ signal, initiatedByUs, replacementHealthy }) {
  if (initiatedByUs) return "exit";
  if (!signal) return "exit";
  return replacementHealthy ? "hold" : "respawn";
}

/**
 * Consecutive missed hold-probes before the starter takes the port back.
 * BEAUDIT G6 residual: a single missed 1s probe from a busy worker used to
 * trigger a respawn that hit EADDRINUSE, exited 1, and tore the stack down.
 */
export const HELD_WORKER_RESPAWN_CONSECUTIVE_FAILURES = 3;

/**
 * After the starter starts holding for an existing worker (reuse, failed
 * restart, or a healthy replacement after our child was SIGTERM'd), each
 * health probe must decide whether to keep holding or take the port back.
 *
 * A dead held worker cannot leave a zombie noop holder: under `npm run dev`
 * that holder is the concurrently child, so nothing else respawns :8644
 * (observed 2026-09-16 — starter alive for hours, no child, connection
 * refused). Our own Ctrl-C / concurrently teardown still exits.
 *
 * A single missed probe never respawns (see above): only
 * HELD_WORKER_RESPAWN_CONSECUTIVE_FAILURES consecutive misses do, and only
 * when the port is free — respawning into an occupied port is the EADDRINUSE
 * exit this policy exists to prevent.
 *
 * @param {{ heldWorkerHealthy: boolean, shuttingDown: boolean, consecutiveFailures?: number, portFree?: boolean }} input
 * @returns {"keep_holding" | "respawn" | "exit"}
 */
export function decideHeldWorkerAction({
  heldWorkerHealthy,
  shuttingDown,
  consecutiveFailures = 1,
  portFree = true,
}) {
  if (shuttingDown) return "exit";
  if (heldWorkerHealthy) return "keep_holding";
  if (consecutiveFailures < HELD_WORKER_RESPAWN_CONSECUTIVE_FAILURES) {
    return "keep_holding";
  }
  return portFree ? "respawn" : "keep_holding";
}
