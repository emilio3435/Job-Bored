/**
 * Background updates through electron-updater (GFX D11). The feed is pinned
 * in code to the public GitHub repo emilio3435/jobbored-desktop. Checks on
 * launch and every 6 h, downloads in the background, and offers "Restart to
 * update" once a download is ready. Off in smoke mode and unpackaged runs.
 */

export const UPDATE_FEED = Object.freeze({ provider: "github", owner: "emilio3435", repo: "jobbored-desktop" });
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** @typedef {{ state: "disabled" | "idle" | "checking" | "downloading" | "ready" | "error", version?: string, message?: string }} UpdateState */

/** @param {UpdateState | undefined} update */
export function updateMenuLabel(update) {
  switch (update?.state) {
    case "checking": return "Checking for updates…";
    case "downloading": return `Downloading update${update.version ? ` (${update.version})` : ""}…`;
    case "error": return "Update failed — Check for updates";
    default: return "Check for updates";
  }
}

/**
 * @param {object} options
 * @param {any} options.autoUpdater electron-updater's autoUpdater
 * @param {boolean} options.isPackaged
 * @param {boolean} options.smoke
 * @param {(state: UpdateState) => void} [options.onState]
 * @param {(line: string) => void} [options.log]
 * @param {(fn: () => void, ms: number) => any} [options.setInterval]
 * @param {(handle: any) => void} [options.clearInterval]
 */
export function createUpdater({
  autoUpdater,
  isPackaged,
  smoke,
  onState = () => {},
  log = () => {},
  setInterval: setIntervalImpl = setInterval,
  clearInterval: clearIntervalImpl = clearInterval,
}) {
  const enabled = isPackaged === true && smoke !== true;
  /** @type {UpdateState} */
  let current = { state: enabled ? "idle" : "disabled" };
  /** @type {any} */
  let timer = null;

  /** @param {UpdateState} next */
  function set(next) {
    current = next;
    log(`updater: ${next.state}${next.version ? ` ${next.version}` : ""}${next.message ? ` (${next.message})` : ""}`);
    onState(next);
  }

  function check() {
    if (!enabled || current.state === "ready") return;
    const fail = (/** @type {Error} */ err) => set({ state: "error", message: err?.message ?? String(err) });
    try {
      Promise.resolve(autoUpdater.checkForUpdates()).catch(fail);
    } catch (err) {
      fail(/** @type {Error} */ (err));
    }
  }

  function start() {
    if (!enabled) {
      set({ state: "disabled" });
      return;
    }
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.setFeedURL({ ...UPDATE_FEED });
    autoUpdater.on("checking-for-update", () => set({ state: "checking" }));
    autoUpdater.on("update-not-available", () => set({ state: "idle" }));
    autoUpdater.on("update-available", (/** @type {any} */ info) => set({ state: "downloading", version: info?.version }));
    autoUpdater.on("update-downloaded", (/** @type {any} */ info) => set({ state: "ready", version: info?.version }));
    autoUpdater.on("error", (/** @type {Error} */ err) => set({ state: "error", message: err?.message ?? String(err) }));
    check();
    timer = setIntervalImpl(check, CHECK_INTERVAL_MS);
    timer?.unref?.();
  }

  function installNow() {
    if (!enabled || current.state !== "ready") return false;
    autoUpdater.quitAndInstall();
    return true;
  }

  function stop() {
    if (timer) clearIntervalImpl(timer);
    timer = null;
  }

  return {
    enabled,
    start,
    check,
    installNow,
    stop,
    get state() {
      return current;
    },
  };
}
