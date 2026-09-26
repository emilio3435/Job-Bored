// GFX DESK-A D11: updates come from the pinned GitHub feed, every 6 h, and
// never in smoke mode or an unpackaged run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { CHECK_INTERVAL_MS, UPDATE_FEED, createUpdater } from "../updater.mjs";

function fakeUpdater() {
  const u = Object.assign(new EventEmitter(), {
    feeds: /** @type {any[]} */ ([]),
    checks: 0,
    installs: 0,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    setFeedURL(/** @type {any} */ feed) {
      u.feeds.push(feed);
    },
    async checkForUpdates() {
      u.checks += 1;
      return null;
    },
    quitAndInstall() {
      u.installs += 1;
    },
  });
  return u;
}

function timers() {
  /** @type {{ fn: () => void, ms: number }[]} */
  const intervals = [];
  return {
    intervals,
    setInterval: (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
      intervals.push({ fn, ms });
      return { unref() {} };
    },
    clearInterval: () => {},
  };
}

test("D11: the feed is emilio3435/jobbored-desktop on GitHub", () => {
  assert.deepEqual({ ...UPDATE_FEED }, { provider: "github", owner: "emilio3435", repo: "jobbored-desktop" });
  assert.equal(CHECK_INTERVAL_MS, 6 * 60 * 60 * 1000);
});

test("D11: disabled when unpackaged or in smoke mode: no feed, no check, no timer", () => {
  for (const [isPackaged, smoke] of [[false, false], [true, true], [false, true]]) {
    const u = fakeUpdater();
    const t = timers();
    /** @type {string[]} */
    const states = [];
    const up = createUpdater({ autoUpdater: u, isPackaged, smoke, onState: (s) => states.push(s.state), ...t });
    up.start();
    up.check();
    up.installNow();
    assert.equal(up.enabled, false);
    assert.deepEqual([u.feeds.length, u.checks, u.installs, t.intervals.length], [0, 0, 0, 0]);
    assert.deepEqual(states, ["disabled"]);
  }
});

test("D11: packaged: checks on launch and every 6 h, downloads in the background, offers restart", async () => {
  const u = fakeUpdater();
  const t = timers();
  /** @type {any[]} */
  const states = [];
  const up = createUpdater({ autoUpdater: u, isPackaged: true, smoke: false, onState: (s) => states.push(s), ...t });
  up.start();
  assert.deepEqual(u.feeds, [UPDATE_FEED]);
  assert.equal(u.autoDownload, true);
  assert.equal(u.checks, 1);
  assert.equal(t.intervals[0].ms, CHECK_INTERVAL_MS);
  t.intervals[0].fn();
  assert.equal(u.checks, 2);
  up.installNow();
  assert.equal(u.installs, 0, "nothing to install before a download finishes");
  u.emit("update-downloaded", { version: "0.2.0" });
  assert.deepEqual(states.at(-1), { state: "ready", version: "0.2.0" });
  up.installNow();
  assert.equal(u.installs, 1);
});

test("D11: an updater error is a state, never a throw", async () => {
  const u = fakeUpdater();
  u.checkForUpdates = async () => {
    throw new Error("net down");
  };
  /** @type {any[]} */
  const states = [];
  const up = createUpdater({ autoUpdater: u, isPackaged: true, smoke: false, onState: (s) => states.push(s), ...timers() });
  up.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(states.at(-1).state, "error");
  u.emit("error", new Error("bad signature"));
  assert.equal(states.at(-1).state, "error");
});
