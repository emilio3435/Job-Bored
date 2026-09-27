// GFX DESK-A: smoke mode never touches the live ports, the app runs from its
// own bundle, and children get a curated environment, not the app's.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_PORTS,
  SMOKE_DEFAULT_PORTS,
  childBaseEnv,
  evaluateSmoke,
  isSmokeMode,
  resolveAppRoot,
  resolveSmokePorts,
} from "../app-config.mjs";

test("smoke mode is JOBBORED_DESKTOP_SMOKE=1 only", () => {
  assert.equal(isSmokeMode({ JOBBORED_DESKTOP_SMOKE: "1" }), true);
  for (const v of [undefined, "", "0", "true", "yes", " 1"]) assert.equal(isSmokeMode({ JOBBORED_DESKTOP_SMOKE: v }), false);
});

test("smoke ports default off the live ports and read DESK-D's env names", () => {
  assert.deepEqual(resolveSmokePorts({}), SMOKE_DEFAULT_PORTS);
  for (const p of Object.values(SMOKE_DEFAULT_PORTS)) assert.ok(!LIVE_PORTS.includes(p));
  assert.deepEqual(
    resolveSmokePorts({ JOBBORED_SMOKE_DASHBOARD_PORT: "19080", JOBBORED_SMOKE_API_PORT: "19847", JOBBORED_SMOKE_WORKER_PORT: "19644" }),
    { dashboard: 19080, api: 19847, worker: 19644 },
  );
});

test("smoke refuses 8080/8644/3847, junk and duplicates", () => {
  for (const live of ["8080", "8644", "3847"]) {
    assert.throws(() => resolveSmokePorts({ JOBBORED_SMOKE_API_PORT: live }), /live port/);
  }
  for (const junk of ["0", "65536", "80a", "-1", "1e4", " 19080", "19080.5"]) {
    assert.throws(() => resolveSmokePorts({ JOBBORED_SMOKE_DASHBOARD_PORT: junk }), TypeError);
  }
  assert.throws(() => resolveSmokePorts({ JOBBORED_SMOKE_DASHBOARD_PORT: "19000", JOBBORED_SMOKE_API_PORT: "19000" }), /distinct/);
});

test("the packaged app runs from Resources/app-bundle; dev prefers a staged bundle", () => {
  assert.equal(
    resolveAppRoot({ isPackaged: true, resourcesPath: "/Applications/JobBored.app/Contents/Resources", desktopDir: "/x/desktop", exists: () => false }),
    "/Applications/JobBored.app/Contents/Resources/app-bundle",
  );
  assert.equal(resolveAppRoot({ isPackaged: false, resourcesPath: "", desktopDir: "/x/desktop", exists: () => true }), "/x/desktop/app-bundle");
  assert.equal(resolveAppRoot({ isPackaged: false, resourcesPath: "", desktopDir: "/x/desktop", exists: () => false }), "/x");
});

test("children inherit a curated env: no secrets, no Electron or Node knobs from the app", () => {
  const env = childBaseEnv(
    {
      PATH: "/evil/bin:/usr/bin",
      LANG: "en_US.UTF-8",
      USER: "tester",
      GEMINI_API_KEY: "fake-key",
      NODE_OPTIONS: "--require /tmp/x.js",
      ELECTRON_RUN_AS_NODE: "1",
      DYLD_INSERT_LIBRARIES: "/tmp/x.dylib",
      JOBBORED_DESKTOP_SMOKE: "1",
    },
    "/tmp/jb",
  );
  assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin");
  assert.equal(env.TMPDIR, "/tmp/jb");
  assert.equal(env.LANG, "en_US.UTF-8");
  assert.equal(env.USER, "tester");
  for (const k of ["GEMINI_API_KEY", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "DYLD_INSERT_LIBRARIES", "JOBBORED_DESKTOP_SMOKE"]) {
    assert.equal(env[k], undefined, k);
  }
});

test("evaluateSmoke needs all three spawned by us and a desktop ping with our version", () => {
  const running = { state: "running", detail: "", port: 1, pid: 1, restarts: 0 };
  const snap = { dashboard: running, api: running, worker: running };
  const ping = { ok: true, runtime: "desktop", desktopVersion: "0.1.0", routes: ["ping"] };
  assert.deepEqual(evaluateSmoke(snap, ping, "0.1.0"), { ok: true, failures: [] });
  const attached = { ...snap, api: { ...running, state: "attached" } };
  assert.equal(evaluateSmoke(attached, ping, "0.1.0").ok, false);
  assert.equal(evaluateSmoke(snap, { ...ping, runtime: "source" }, "0.1.0").ok, false);
  assert.equal(evaluateSmoke(snap, { ...ping, desktopVersion: "0.0.9" }, "0.1.0").ok, false);
  assert.equal(evaluateSmoke(snap, null, "0.1.0").ok, false);
});
