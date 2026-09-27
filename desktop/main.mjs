/**
 * JobBored for Mac: a menu-bar app that runs JobBored's three servers from
 * its own read-only bundle and opens the dashboard at http://localhost:8080/.
 *
 * No windows. The tray shows each server's state; jobbored:// links (from
 * the hosted page's Open JobBored button) go through protocol.mjs and reach
 * nothing but shell.openExternal with a constant URL.
 *
 * JOBBORED_DESKTOP_SMOKE=1 starts the stack on alternate ports with a
 * throwaway HOME, checks health, prints one result line and exits 0 or 1.
 */

import { app, dialog, Menu, nativeImage, shell, Tray } from "electron";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  childBaseEnv,
  evaluateSmoke,
  isSmokeMode,
  resolveAppRoot,
  resolveSmokePorts,
} from "./app-config.mjs";
import { listJobBoredLaunchAgents, migrateLaunchAgents } from "./launchagents.mjs";
import { createLogSink } from "./log-file.mjs";
import { DASHBOARD_URL, createLaunchGate, parseJobBoredUrl } from "./protocol.mjs";
import { DEFAULT_PORTS, SERVICE_NAMES, createSupervisor } from "./supervisor.mjs";
import { ICON_SIZE, briefcaseBitmap } from "./tray-icon.mjs";
import { createUpdater } from "./updater.mjs";

const DESKTOP_DIR = dirname(fileURLToPath(import.meta.url));
const smoke = isSmokeMode(process.env);
const launchGate = createLaunchGate();

/** @type {ReturnType<typeof createSupervisor> | null} */
let supervisor = null;
/** @type {Promise<void> | null} */
let supervisorReady = null;
/** @type {ReturnType<typeof createUpdater> | null} */
let updater = null;
/** @type {Tray | null} */
let tray = null;
/** @type {ReturnType<typeof createLogSink> | null} */
let logs = null;
/** @type {string | null} */
let pendingTarget = null;
let quitting = false;
let ready = false;
let lockLost = false;

const log = (/** @type {string} */ line) => logs?.event(line);

// ---- jobbored:// (registered before `ready`, R21) -------------------------

/** @param {unknown} raw */
function handleDeepLink(raw) {
  const parsed = parseJobBoredUrl(raw);
  if (!parsed.ok) {
    log(`deep link refused (${parsed.reason})`);
    return;
  }
  if (!launchGate.tryLaunch()) {
    log("deep link debounced");
    return;
  }
  log(`deep link accepted (${new URL(parsed.target).search || "root"})`);
  if (!ready) {
    pendingTarget = parsed.target;
    return;
  }
  void openTarget(parsed.target);
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (!smoke) handleDeepLink(url);
});

if (!smoke) {
  if (!app.requestSingleInstanceLock()) {
    lockLost = true;
    app.quit();
  } else {
    app.on("second-instance", (_event, argv) => {
      const link = argv.find((arg) => typeof arg === "string" && arg.startsWith("jobbored:"));
      if (link) handleDeepLink(link);
      else void openTarget(DASHBOARD_URL);
    });
  }
}

// ---- helpers ---------------------------------------------------------------

/** Loads the frozen runtime-env contract from the bundle the children run. */
async function loadRuntimeEnv(/** @type {string} */ appRoot) {
  return import(pathToFileURL(join(appRoot, "scripts", "lib", "runtime-env.mjs")).href);
}

/** @param {string} stateFile */
function readState(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
}

/** @param {string} stateFile @param {object} state */
function writeState(stateFile, state) {
  try {
    mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 });
    writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    log(`could not save app state: ${/** @type {Error} */ (err).message}`);
  }
}

/** @param {string} target a constant from protocol.mjs */
async function openTarget(target) {
  if (supervisorReady) await supervisorReady;
  const dashboard = supervisor?.snapshot().dashboard;
  if (dashboard?.state === "conflict") {
    await dialog.showMessageBox({
      type: "warning",
      message: "JobBored can't open its dashboard",
      detail: `${dashboard.detail}. Quit that app, then choose Restart services from the JobBored menu.`,
    });
    return;
  }
  await shell.openExternal(target);
}

const STATE_TEXT = /** @type {Record<string, string>} */ ({
  idle: "Waiting",
  starting: "Starting…",
  running: "Running",
  attached: "Running",
  conflict: "Port in use",
  restarting: "Restarting…",
  failed: "Stopped",
  stopped: "Stopped",
});

function refreshTray() {
  if (!tray || !supervisor) return;
  const snap = supervisor.snapshot();
  const sup = supervisor;
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const statusItems = SERVICE_NAMES.map((name) => {
    const s = snap[name];
    const warn = s.state === "conflict" || s.state === "failed" ? "⚠︎ " : "";
    const detail = s.state === "running" ? "" : s.detail ? ` — ${s.detail}` : "";
    return { label: `${warn}${sup.label(name)}: ${STATE_TEXT[s.state]}${detail}`, enabled: false };
  });
  const update = updater?.state;
  /** @type {Electron.MenuItemConstructorOptions} */
  const updateItem =
    update?.state === "ready"
      ? { label: `Restart to update${update.version ? ` (${update.version})` : ""}`, click: () => void installUpdate() }
      : { label: "Check for updates", enabled: Boolean(updater?.enabled), click: () => updater?.check() };
  const menu = Menu.buildFromTemplate([
    { label: "Open JobBored", click: () => void openTarget(DASHBOARD_URL) },
    { type: "separator" },
    ...statusItems,
    { label: "Restart services", click: () => void supervisor?.restart() },
    { label: "Open logs", click: () => void shell.openPath(logs?.path("desktop.log") ?? "") },
    { type: "separator" },
    {
      label: "Start at login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    updateItem,
    { type: "separator" },
    { label: "Quit JobBored", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  const bad = SERVICE_NAMES.some((n) => snap[n].state === "conflict" || snap[n].state === "failed");
  tray.setToolTip(bad ? "JobBored — needs attention" : "JobBored");
}

async function installUpdate() {
  quitting = true;
  await supervisor?.stop();
  if (!updater?.installNow()) app.exit(0);
}

/** First launch only: offer /Applications, then the LaunchAgent migration. */
async function firstRunOffers(/** @type {string} */ home, /** @type {string} */ stateFile) {
  const state = readState(stateFile);
  if (app.isPackaged && !state.moveOffered && !app.isInApplicationsFolder()) {
    writeState(stateFile, { ...state, moveOffered: true });
    const { response } = await dialog.showMessageBox({
      type: "question",
      message: "Move JobBored to your Applications folder?",
      detail: "It keeps JobBored up to date and easy to find.",
      buttons: ["Move to Applications", "Not now"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      try {
        if (app.moveToApplicationsFolder()) return false; // relaunching from /Applications
      } catch (err) {
        log(`move to Applications failed: ${/** @type {Error} */ (err).message}`);
      }
    }
  }
  const latest = readState(stateFile);
  if (!latest.launchAgentsOffered) {
    const uid = process.getuid?.() ?? -1;
    const agents = uid >= 0 ? await listJobBoredLaunchAgents({ home, uid }) : [];
    if (agents.length) {
      const { response } = await dialog.showMessageBox({
        type: "question",
        message: "Let the JobBored app run JobBored from now on?",
        detail:
          `An earlier setup left ${agents.length} background helper${agents.length === 1 ? "" : "s"} running ` +
          `(${agents.map((a) => a.label).join(", ")}). The app can turn them off and keep JobBored running itself. ` +
          "Their files are moved to ~/.jobbored/launchagents-disabled, so you can put them back.",
        buttons: ["Turn them off", "Keep them"],
        defaultId: 0,
        cancelId: 1,
      });
      const result = await migrateLaunchAgents({ consent: response === 0, home, uid });
      log(
        result.declined
          ? "launchagent migration declined; attaching to them"
          : `launchagents migrated: ${result.migrated.map((m) => m.label).join(", ") || "none"}; failed: ${result.failed.map((f) => f.label).join(", ") || "none"}`,
      );
    }
    writeState(stateFile, { ...readState(stateFile), launchAgentsOffered: true });
  }
  return true;
}

// ---- normal run --------------------------------------------------------------

async function runApp() {
  const home = app.getPath("home");
  logs = createLogSink(join(home, ".jobbored", "logs"));
  log(`JobBored ${app.getVersion()} starting (${app.isPackaged ? "packaged" : "unpackaged"})`);
  app.dock?.hide();

  if (app.isPackaged) app.setAsDefaultProtocolClient("jobbored");
  else log("unpackaged run: not registering jobbored:// (the packaged app's Info.plist does)");

  const stateFile = join(home, ".jobbored", "desktop", "app-state.json");
  if (!(await firstRunOffers(home, stateFile))) return;

  const appRoot = resolveAppRoot({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    desktopDir: DESKTOP_DIR,
    exists: existsSync,
  });
  log(`app root: ${appRoot}`);
  const tmp = join(home, ".jobbored", "desktop", "tmp");
  mkdirSync(tmp, { recursive: true, mode: 0o700 });

  tray = new Tray(
    (() => {
      const image = nativeImage.createFromBitmap(briefcaseBitmap(), { width: ICON_SIZE, height: ICON_SIZE, scaleFactor: 2 });
      image.setTemplateImage(true);
      return image;
    })(),
  );
  tray.setToolTip("JobBored");

  supervisor = createSupervisor({
    appRoot,
    home,
    execPath: process.execPath,
    desktopVersion: app.getVersion(),
    ports: DEFAULT_PORTS,
    runtimeEnv: await loadRuntimeEnv(appRoot),
    baseEnv: childBaseEnv(process.env, tmp),
    onChange: refreshTray,
    onOutput: (service, chunk) => logs?.child(service, chunk),
    log,
  });
  refreshTray();

  if (!app.isPackaged) {
    updater = createUpdater({ autoUpdater: null, isPackaged: false, smoke: false, log });
  } else {
    const { default: updaterPkg } = await import("electron-updater");
    updater = createUpdater({ autoUpdater: updaterPkg.autoUpdater, isPackaged: true, smoke: false, onState: refreshTray, log });
  }
  updater.start();

  supervisorReady = supervisor.start().catch((err) => log(`supervisor start failed: ${err.message}`));
  ready = true;
  await supervisorReady;
  if (pendingTarget) {
    const target = pendingTarget;
    pendingTarget = null;
    await openTarget(target);
  }
}

// ---- smoke run (DESK-D CI and local proof) -----------------------------------

/** @param {number} port */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function runSmoke() {
  app.dock?.hide();
  const started = Date.now();
  /** @type {Record<string, unknown>} */
  const result = { ok: false, packaged: app.isPackaged, version: app.getVersion() };
  const home = mkdtempSync(join(tmpdir(), "jobbored-desktop-smoke-"));
  logs = createLogSink(join(home, ".jobbored", "logs"));
  /** @type {Record<string, string>} */
  const tails = { dashboard: "", api: "", worker: "" };
  try {
    const ports = resolveSmokePorts(process.env);
    result.ports = ports;
    for (const port of Object.values(ports)) {
      if (!(await isPortFree(port))) throw new Error(`smoke port ${port} is in use (nothing was killed)`);
    }
    const appRoot = resolveAppRoot({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      desktopDir: DESKTOP_DIR,
      exists: existsSync,
    });
    result.appRoot = appRoot;
    const tmp = join(home, "tmp");
    mkdirSync(tmp);
    supervisor = createSupervisor({
      appRoot,
      home,
      execPath: process.execPath,
      desktopVersion: app.getVersion(),
      ports,
      runtimeEnv: await loadRuntimeEnv(appRoot),
      baseEnv: childBaseEnv(process.env, tmp),
      onOutput: (service, chunk) => {
        tails[service] = (tails[service] + chunk).slice(-4_000);
        logs?.child(service, chunk);
      },
      log,
      timing: { monitorIntervalMs: 0, healthTimeoutMs: 90_000 },
      restartBudget: { max: 0, windowMs: 1 },
    });
    await supervisor.start();
    const snap = supervisor.snapshot();
    let ping = null;
    try {
      const res = await fetch(`http://127.0.0.1:${ports.dashboard}/__proxy/ping`, {
        headers: { origin: `http://localhost:${ports.dashboard}` },
        signal: AbortSignal.timeout(3_000),
      });
      ping = await res.json();
    } catch (err) {
      ping = { ok: false, error: /** @type {Error} */ (err).message };
    }
    const verdict = evaluateSmoke(snap, ping, app.getVersion());
    // The dashboard page itself must be served from the bundle.
    const index = await fetch(`http://127.0.0.1:${ports.dashboard}/`, { signal: AbortSignal.timeout(3_000) }).catch(() => null);
    result.indexStatus = index?.status ?? 0;
    await index?.body?.cancel();
    if (result.indexStatus !== 200) verdict.failures.push(`GET / answered ${result.indexStatus}`);
    verdict.ok = verdict.failures.length === 0;
    result.services = Object.fromEntries(SERVICE_NAMES.map((n) => [n, { state: snap[n].state, pid: snap[n].pid, detail: snap[n].detail }]));
    result.ping = ping;
    result.failures = verdict.failures;
    await supervisor.stop();
    const freed = await Promise.all(Object.values(ports).map(isPortFree));
    result.portsFreed = freed.every(Boolean);
    result.ok = verdict.ok && result.portsFreed;
  } catch (err) {
    result.error = /** @type {Error} */ (err).message;
    await supervisor?.stop().catch(() => {});
  }
  result.seconds = Math.round((Date.now() - started) / 100) / 10;
  if (!result.ok) result.logs = tails;
  process.stdout.write(`JOBBORED_DESKTOP_SMOKE_RESULT ${JSON.stringify(result)}\n`);
  rmSync(home, { recursive: true, force: true });
  app.exit(result.ok ? 0 : 1);
}

// ---- lifecycle -------------------------------------------------------------------

app.on("window-all-closed", () => {
  // A menu-bar app keeps running with no windows.
});

app.on("before-quit", (event) => {
  if (smoke || quitting || !supervisor) return;
  event.preventDefault();
  quitting = true;
  log("quitting: stopping the services this app started");
  updater?.stop();
  supervisor.stop().finally(() => app.exit(0));
});

app.whenReady().then(() => (lockLost ? undefined : smoke ? runSmoke() : runApp())).catch((err) => {
  log(`fatal: ${err && err.stack ? err.stack : err}`);
  if (smoke) {
    process.stdout.write(`JOBBORED_DESKTOP_SMOKE_RESULT ${JSON.stringify({ ok: false, error: String(err && err.message) })}\n`);
    app.exit(1);
  }
});
