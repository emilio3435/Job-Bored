// GFX DESK-A R19: the first-run LaunchAgent migration names five exact
// labels, and acts only on explicit consent. Temp HOME, injected launchctl.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JOBBORED_LAUNCH_AGENT_LABELS,
  listJobBoredLaunchAgents,
  migrateLaunchAgents,
} from "../launchagents.mjs";

const LABELS = [
  "ai.jobbored.discovery.keepalive",
  "ai.jobbored.discovery.worker",
  "ai.jobbored.discovery.tunnel",
  "com.jobbored.refresh",
  "com.jobbored.expired-cleanup",
];

function fixture(labels = LABELS, extra = []) {
  const home = mkdtempSync(join(tmpdir(), "jb desk-a home "));
  const dir = join(home, "Library", "LaunchAgents");
  mkdirSync(dir, { recursive: true });
  for (const label of [...labels, ...extra]) {
    writeFileSync(join(dir, `${label}.plist`), `<plist>${label}</plist>`);
  }
  /** @type {string[][]} */
  const calls = [];
  const loaded = new Set(labels);
  const launchctl = async (/** @type {string[]} */ args) => {
    calls.push(args);
    if (args[0] === "print") return { code: loaded.has(args[1].split("/").pop() ?? "") ? 0 : 113 };
    if (args[0] === "bootout") {
      loaded.delete(args[1].split("/").pop() ?? "");
      return { code: 0 };
    }
    return { code: 1 };
  };
  return { home, dir, calls, launchctl, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("R19: the label list is exactly the five agents, no globs", () => {
  assert.deepEqual([...JOBBORED_LAUNCH_AGENT_LABELS], LABELS);
  assert.ok(Object.isFrozen(JOBBORED_LAUNCH_AGENT_LABELS));
});

test("R19: listing reports only the five labels, never lookalikes", async () => {
  const f = fixture(LABELS.slice(0, 2), ["ai.hermes.gateway", "ai.jobbored.other", "com.jobbored.refresh.bak"]);
  try {
    const found = await listJobBoredLaunchAgents({ home: f.home, uid: 501, launchctl: f.launchctl });
    assert.deepEqual(found.map((a) => a.label), LABELS.slice(0, 2));
    assert.ok(found.every((a) => a.plistExists && a.loaded));
    for (const call of f.calls) {
      assert.equal(call[0], "print");
      assert.ok(LABELS.some((l) => call[1] === `gui/501/${l}`));
    }
  } finally {
    f.cleanup();
  }
});

test("R19: a declined offer changes nothing", async () => {
  const f = fixture();
  try {
    for (const consent of [false, undefined, "yes", 1, null]) {
      const result = await migrateLaunchAgents({
        consent: /** @type {any} */ (consent),
        home: f.home,
        uid: 501,
        launchctl: f.launchctl,
      });
      assert.equal(result.declined, true);
      assert.deepEqual(result.migrated, []);
    }
    assert.ok(f.calls.every((c) => c[0] !== "bootout"));
    for (const l of LABELS) assert.ok(existsSync(join(f.dir, `${l}.plist`)));
    assert.equal(existsSync(join(f.home, ".jobbored")), false);
  } finally {
    f.cleanup();
  }
});

test("R19: consent boots out each label by argv and moves its plist aside", async () => {
  const f = fixture(LABELS, ["ai.hermes.gateway"]);
  try {
    const result = await migrateLaunchAgents({ consent: true, home: f.home, uid: 501, launchctl: f.launchctl });
    assert.deepEqual(result.migrated.map((m) => m.label), LABELS);
    const bootouts = f.calls.filter((c) => c[0] === "bootout");
    assert.deepEqual(bootouts, LABELS.map((l) => ["bootout", `gui/501/${l}`]));
    const disabled = join(f.home, ".jobbored", "launchagents-disabled");
    for (const l of LABELS) {
      assert.equal(existsSync(join(f.dir, `${l}.plist`)), false);
      assert.equal(readFileSync(join(disabled, `${l}.plist`), "utf8"), `<plist>${l}</plist>`);
    }
    assert.equal(statSync(disabled).mode & 0o777, 0o700);
    // A foreign agent is never touched.
    assert.ok(existsSync(join(f.dir, "ai.hermes.gateway.plist")));
    assert.ok(!f.calls.some((c) => c.join(" ").includes("hermes")));
  } finally {
    f.cleanup();
  }
});

test("R19: a plist that fails bootout stays in place and is reported", async () => {
  const f = fixture(["com.jobbored.refresh"]);
  try {
    const launchctl = async (/** @type {string[]} */ args) => {
      if (args[0] === "bootout") return { code: 5 };
      return { code: args[1] === "gui/501/com.jobbored.refresh" ? 0 : 113 };
    };
    const result = await migrateLaunchAgents({ consent: true, home: f.home, uid: 501, launchctl });
    assert.deepEqual(result.migrated, []);
    assert.deepEqual(result.failed.map((x) => x.label), ["com.jobbored.refresh"]);
    assert.ok(existsSync(join(f.dir, "com.jobbored.refresh.plist")));
  } finally {
    f.cleanup();
  }
});

test("R19: a loaded agent with no plist is still booted out; an existing backup is not overwritten", async () => {
  const f = fixture(["ai.jobbored.discovery.worker"]);
  try {
    const disabled = join(f.home, ".jobbored", "launchagents-disabled");
    mkdirSync(disabled, { recursive: true });
    writeFileSync(join(disabled, "ai.jobbored.discovery.worker.plist"), "old");
    const result = await migrateLaunchAgents({ consent: true, home: f.home, uid: 501, launchctl: f.launchctl });
    assert.equal(result.migrated.length, 1);
    assert.equal(readFileSync(join(disabled, "ai.jobbored.discovery.worker.plist"), "utf8"), "old");
    assert.ok(result.migrated[0].movedTo?.startsWith(join(disabled, "ai.jobbored.discovery.worker.")));
    assert.equal(readFileSync(/** @type {string} */ (result.migrated[0].movedTo), "utf8"), "<plist>ai.jobbored.discovery.worker</plist>");
  } finally {
    f.cleanup();
  }
});

test("R19: bad home or uid throws before any launchctl call", async () => {
  const f = fixture();
  try {
    await assert.rejects(listJobBoredLaunchAgents({ home: "relative/home", uid: 501, launchctl: f.launchctl }), TypeError);
    await assert.rejects(migrateLaunchAgents({ consent: true, home: f.home, uid: /** @type {any} */ ("501; rm"), launchctl: f.launchctl }), TypeError);
    assert.equal(f.calls.length, 0);
  } finally {
    f.cleanup();
  }
});
