// GFX DESK-B R14 / R18 / R24 / F2: scripts/lib/runtime-env.mjs is the
// contract DESK-A's supervisor spawns from. Each resolver returns
// { cmd, args, env, cwd } with argv arrays only; desktop mode runs the
// child on Electron's own Node (ELECTRON_RUN_AS_NODE=1) and points every
// write under the user's ~/.jobbored.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveDevServerEnv,
  resolveScraperEnv,
  resolveWorkerEnv,
} from "../scripts/lib/runtime-env.mjs";

const APP = "/Applications/JobBored.app/Contents/Resources/app";
const HOME = "/Users/example user";
// Source-mode cases get an empty temp HOME so the real ~/.jobbored never leaks in.
const SRC_HOME = mkdtempSync(join(tmpdir(), "gfx-desk-b-srchome-"));
process.on("exit", () => rmSync(SRC_HOME, { recursive: true, force: true }));
const ELECTRON = "/Applications/JobBored.app/Contents/MacOS/JobBored";

function desktopOpts(extra = {}) {
  return {
    appRoot: APP,
    home: HOME,
    execPath: ELECTRON,
    desktop: true,
    desktopVersion: "1.2.3",
    baseEnv: { PATH: "/usr/bin:/bin" },
    ...extra,
  };
}

function assertSpawnShape(spec, label) {
  assert.equal(typeof spec.cmd, "string", `${label}: cmd is a string`);
  assert.ok(Array.isArray(spec.args), `${label}: args is an array`);
  for (const arg of spec.args) assert.equal(typeof arg, "string", `${label}: argv entries are strings`);
  assert.equal(typeof spec.cwd, "string", `${label}: cwd is a string`);
  for (const [key, value] of Object.entries(spec.env)) {
    assert.equal(typeof value, "string", `${label}: env.${key} is a string`);
  }
}

describe("GFX-DESK-B R14 runtime-env desktop mode", () => {
  const resolvers = {
    devServer: resolveDevServerEnv,
    scraper: resolveScraperEnv,
    worker: resolveWorkerEnv,
  };

  for (const [name, resolve] of Object.entries(resolvers)) {
    it(`R24 ${name}: spawns Electron-as-Node with the desktop markers`, () => {
      const spec = resolve(desktopOpts());
      assertSpawnShape(spec, name);
      assert.equal(spec.cmd, ELECTRON);
      assert.equal(spec.env.ELECTRON_RUN_AS_NODE, "1");
      assert.equal(spec.env.JOBBORED_DESKTOP, "1");
      assert.equal(spec.env.JOBBORED_DESKTOP_VERSION, "1.2.3");
      assert.equal(spec.env.JOBBORED_REPO, APP);
      assert.equal(spec.env.HOME, HOME);
      assert.equal(spec.env.JOBBORED_HOME, join(HOME, ".jobbored"));
      assert.equal(
        spec.env.JOBBORED_BOOTSTRAP_STATE_PATH,
        join(HOME, ".jobbored", "discovery-local-bootstrap.json"),
      );
    });

    it(`F2 ${name}: PATH carries /usr/sbin so lsof resolves`, () => {
      const spec = resolve(desktopOpts());
      const parts = spec.env.PATH.split(":");
      assert.ok(parts.includes("/usr/sbin"), spec.env.PATH);
      assert.ok(parts.includes("/usr/bin"), spec.env.PATH);
      assert.deepEqual(parts.slice(0, 2), ["/usr/bin", "/bin"], "inherited entries keep their order");
    });

    it(`R18 ${name}: returns argv only, never a shell option`, () => {
      const spec = resolve(desktopOpts());
      assert.deepEqual(Object.keys(spec).sort(), ["args", "cmd", "cwd", "env"]);
    });
  }

  it("dev-server runs dev-server.mjs from the app root on the dashboard port", () => {
    const spec = resolveDevServerEnv(desktopOpts({ ports: { dashboard: 18580, api: 18581, worker: 18582 } }));
    assert.deepEqual(spec.args, ["dev-server.mjs"]);
    assert.equal(spec.cwd, APP);
    assert.equal(spec.env.PORT, "18580");
    assert.equal(spec.env.JOBBORED_API_PORT, "18581");
    assert.equal(spec.env.BROWSER_USE_DISCOVERY_PORT, "18582");
    assert.equal(
      spec.env.JOBBORED_DASHBOARD_CONFIG_PATH,
      join(HOME, ".jobbored", "desktop", "config.js"),
    );
  });

  it("scraper runs server/index.mjs from server/ on the api port", () => {
    const spec = resolveScraperEnv(desktopOpts({ ports: { api: 18581 } }));
    assert.deepEqual(spec.args, ["index.mjs"]);
    assert.equal(spec.cwd, join(APP, "server"));
    assert.equal(spec.env.PORT, "18581");
  });

  it("worker gets --experimental-strip-types and home-rooted state paths", () => {
    const spec = resolveWorkerEnv(desktopOpts({ ports: { worker: 18582 } }));
    assert.deepEqual(spec.args, [
      "--experimental-strip-types",
      "integrations/browser-use-discovery/src/server.ts",
    ]);
    assert.equal(spec.cwd, APP);
    const workerHome = join(HOME, ".jobbored", "browser-use-discovery");
    assert.equal(spec.env.BROWSER_USE_DISCOVERY_PORT, "18582");
    assert.equal(spec.env.BROWSER_USE_DISCOVERY_ENV_FILE, join(workerHome, ".env"));
    assert.equal(spec.env.BROWSER_USE_DISCOVERY_STATE_DB_PATH, join(workerHome, "worker-state.sqlite"));
    assert.equal(spec.env.BROWSER_USE_DISCOVERY_CONFIG_PATH, join(workerHome, "worker-config.json"));
    assert.equal(spec.env.BROWSER_USE_DISCOVERY_RUN_MODE, "local");
  });

  it("R18 worker: the bundled browser command runs on Electron, each path shell-quoted", () => {
    const spec = resolveWorkerEnv(desktopOpts());
    const bin = join(APP, "integrations", "browser-use-discovery", "bin", "browser-use-agent-browser.mjs");
    assert.equal(spec.env.BROWSER_USE_DISCOVERY_BROWSER_COMMAND, `'${ELECTRON}' '${bin}'`);
  });

  it("reads only the home worker .env in desktop mode, never the bundle's", () => {
    const root = mkdtempSync(join(tmpdir(), "gfx-desk-b-env-"));
    try {
      const app = join(root, "app");
      const home = join(root, "home");
      mkdirSync(join(app, "server"), { recursive: true });
      writeFileSync(join(app, "server", ".env"), "BUNDLE_LEAK=1\n");
      mkdirSync(join(home, ".jobbored", "browser-use-discovery"), { recursive: true });
      writeFileSync(
        join(home, ".jobbored", "browser-use-discovery", ".env"),
        "BROWSER_USE_DISCOVERY_GEMINI_API_KEY=fake-gemini-key\n",
      );
      const opts = { appRoot: app, home, execPath: ELECTRON, desktop: true, baseEnv: {} };
      for (const spec of [resolveScraperEnv(opts), resolveWorkerEnv(opts)]) {
        assert.equal(spec.env.BUNDLE_LEAK, undefined);
      }
      assert.equal(resolveWorkerEnv(opts).env.BROWSER_USE_DISCOVERY_GEMINI_API_KEY, "fake-gemini-key");
      assert.equal(resolveScraperEnv(opts).env.ATS_GEMINI_API_KEY, "fake-gemini-key");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("omits JOBBORED_DESKTOP_VERSION when the app gives none", () => {
    const spec = resolveDevServerEnv(desktopOpts({ desktopVersion: undefined, baseEnv: { JOBBORED_DESKTOP_VERSION: "stale" } }));
    assert.equal(spec.env.JOBBORED_DESKTOP_VERSION, undefined);
  });
});

describe("GFX-DESK-B R14 runtime-env fails closed on bad input", () => {
  const bad = [
    ["relative appRoot", { appRoot: "app" }],
    ["missing home", { home: "" }],
    ["relative home", { home: "home" }],
    ["relative execPath", { execPath: "electron" }],
    ["NUL in home", { home: "/Users/a\0b" }],
    ["port out of range", { ports: { dashboard: 70000 } }],
    ["non-integer port", { ports: { api: "3847; rm -rf /" } }],
    ["duplicate ports", { ports: { dashboard: 18580, api: 18580 } }],
    ["shell metacharacters in desktopVersion", { desktopVersion: "1.0.0$(id)" }],
  ];
  for (const [label, extra] of bad) {
    it(`throws on ${label}`, () => {
      for (const resolve of [resolveDevServerEnv, resolveScraperEnv, resolveWorkerEnv]) {
        assert.throws(() => resolve(desktopOpts(extra)), TypeError, label);
      }
    });
  }
});

describe("GFX-DESK-B R14 runtime-env source mode reproduces the launchers", () => {
  it("worker: bare node, repo-relative server.ts, repo bootstrap path untouched", () => {
    const spec = resolveWorkerEnv({ appRoot: "/repo", home: SRC_HOME, desktop: false, baseEnv: { PATH: "/x" } });
    assert.equal(spec.cmd, "node");
    assert.deepEqual(spec.args, [
      "--experimental-strip-types",
      "integrations/browser-use-discovery/src/server.ts",
    ]);
    assert.equal(spec.cwd, "/repo");
    assert.equal(spec.env.PATH, "/x");
    assert.equal(spec.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(spec.env.JOBBORED_DESKTOP, undefined);
    assert.equal(spec.env.BROWSER_USE_DISCOVERY_PORT, "8644");
    assert.equal(
      spec.env.BROWSER_USE_DISCOVERY_BROWSER_COMMAND,
      join("/repo", "integrations", "browser-use-discovery", "bin", "browser-use-agent-browser.mjs"),
    );
  });

  it("scraper: npm run start --prefix server from the repo root", () => {
    const spec = resolveScraperEnv({ appRoot: "/repo", home: SRC_HOME, desktop: false, baseEnv: {} });
    assert.equal(spec.cmd, "npm");
    assert.deepEqual(spec.args, ["run", "start", "--prefix", "server"]);
    assert.equal(spec.cwd, "/repo");
  });

  it("dev-server: node dev-server.mjs, env passed through", () => {
    const spec = resolveDevServerEnv({ appRoot: "/repo", home: SRC_HOME, desktop: false, baseEnv: { PORT: "9999" } });
    assert.equal(spec.cmd, "node");
    assert.deepEqual(spec.args, ["dev-server.mjs"]);
    assert.equal(spec.env.PORT, "9999");
    assert.equal(spec.env.JOBBORED_DASHBOARD_CONFIG_PATH, undefined);
  });

  it("process env wins over env files, as in the launchers", () => {
    const root = mkdtempSync(join(tmpdir(), "gfx-desk-b-src-"));
    try {
      mkdirSync(join(root, "server"), { recursive: true });
      writeFileSync(join(root, "server", ".env"), "PORT=4000\nFROM_FILE=yes\n");
      const spec = resolveScraperEnv({ appRoot: root, home: SRC_HOME, desktop: false, baseEnv: { PORT: "4100" } });
      assert.equal(spec.env.PORT, "4100");
      assert.equal(spec.env.FROM_FILE, "yes");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("desktop is read from JOBBORED_DESKTOP=1 when opts.desktop is omitted", () => {
    const spec = resolveWorkerEnv({
      appRoot: APP,
      home: HOME,
      execPath: ELECTRON,
      baseEnv: { JOBBORED_DESKTOP: "1" },
    });
    assert.equal(spec.cmd, ELECTRON);
    assert.equal(spec.env.ELECTRON_RUN_AS_NODE, "1");
  });
});
