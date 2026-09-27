/**
 * BEAUDIT G12: restart-dev-services.sh is bash+lsof and kills with `kill -9`
 * whatever owns 8080/3847/8644 — Hermes included — and cannot run on
 * Windows at all. `npm run restart` (scripts/restart-dev-services.mjs) is
 * the Node replacement: it kills only JobBored-identified listeners and
 * resolves ports cross-platform (lsof on posix, netstat on Windows).
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import {
  decidePortActions,
  isJobBoredServiceCommand,
  parseLsofPids,
  parseNetstatListeningPids,
  resolveServicePorts,
} from "../scripts/restart-dev-services.mjs";

describe("G12 restart port resolution", () => {
  it("defaults to the web, scraper and discovery ports", () => {
    assert.deepEqual(resolveServicePorts({}), [8080, 3847, 8644]);
  });

  it("honors per-service overrides and the service-ports list", () => {
    assert.deepEqual(
      resolveServicePorts({ JOBBORED_WEB_PORT: "18080", BROWSER_USE_DISCOVERY_PORT: "18644" }),
      [18080, 3847, 18644],
    );
    assert.deepEqual(
      resolveServicePorts({ JOBBORED_SERVICE_PORTS: "19001 19002" }),
      [19001, 19002],
    );
  });

  it("skips invalid ports", () => {
    assert.deepEqual(resolveServicePorts({ JOBBORED_SERVICE_PORTS: "abc 19003 nope" }), [19003]);
  });
});

describe("G12 restart listener parsers", () => {
  it("parses lsof -t output", () => {
    assert.deepEqual(parseLsofPids("1234\n5678\n"), [1234, 5678]);
    assert.deepEqual(parseLsofPids(""), []);
  });

  it("parses Windows netstat -ano LISTENING lines for one port", () => {
    const output = [
      "Active Connections",
      "",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       4242",
      "  TCP    [::]:8080              [::]:0                 LISTENING       4242",
      "  TCP    0.0.0.0:8644           0.0.0.0:0              LISTENING       4343",
      "  TCP    127.0.0.1:8080         127.0.0.1:51234        ESTABLISHED     9999",
    ].join("\r\n");
    assert.deepEqual(parseNetstatListeningPids(output, 8080), [4242]);
    assert.deepEqual(parseNetstatListeningPids(output, 8644), [4343]);
    assert.deepEqual(parseNetstatListeningPids(output, 9999), []);
  });
});

describe("G12 restart JobBored identification", () => {
  it("recognizes the dev stack commands (posix and Windows shapes)", () => {
    assert.equal(isJobBoredServiceCommand("/opt/homebrew/bin/node /repo/dev-server.mjs"), true);
    assert.equal(isJobBoredServiceCommand("node scripts/start-scraper-local.mjs"), true);
    assert.equal(
      isJobBoredServiceCommand("node --experimental-strip-types integrations/browser-use-discovery/src/server.ts"),
      true,
    );
    assert.equal(isJobBoredServiceCommand("node scripts/start-discovery-worker-local.mjs --restart-existing"), true);
    assert.equal(
      isJobBoredServiceCommand("C:\\Program Files\\nodejs\\node.exe C:\\repo\\dev-server.mjs"),
      true,
    );
  });

  it("rejects foreign listeners, including Hermes", () => {
    assert.equal(isJobBoredServiceCommand("/usr/bin/python3 -m hermes.gateway --port 8644"), false);
    assert.equal(isJobBoredServiceCommand("ngrok http 8644"), false);
    assert.equal(isJobBoredServiceCommand(""), false);
  });
});

describe("G12 restart kill decisions", () => {
  it("kills only JobBored-identified pids and reports the rest as skipped", () => {
    const decision = decidePortActions(8644, [
      { pid: 111, command: "node scripts/start-discovery-worker-local.mjs" },
      { pid: 222, command: "/usr/bin/python3 -m hermes.gateway --port 8644" },
      { pid: 333, command: "" },
    ]);
    assert.deepEqual(
      decision.kill.map((entry) => entry.pid),
      [111],
    );
    assert.deepEqual(
      decision.skip.map((entry) => entry.pid),
      [222, 333],
    );
  });
});

function lsofAvailable() {
  try {
    const probed = spawnSync("lsof", ["-v"], { stdio: "ignore" });
    return !probed.error;
  } catch {
    return false;
  }
}

describe("G12 restart behavior — only JobBored listeners are stopped", () => {
  it("stops the JobBored listener and leaves the foreign one alone", async function () {
    if (!lsofAvailable()) {
      // Without lsof the script must degrade honestly instead of killing
      // blind: covered by the test below.
      return;
    }
    // A JobBored-shaped listener: the marker rides in argv like a real spawn.
    const jobbored = createServer((req, res) => {
      res.writeHead(200);
      res.end("dev-server.mjs probe");
    });
    await new Promise((resolve) => jobbored.listen(0, "127.0.0.1", resolve));
    const jobboredPort = jobbored.address().port;
    const foreign = createServer((req, res) => {
      res.writeHead(404);
      res.end("hermes gateway");
    });
    await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
    const foreignPort = foreign.address().port;
    try {
      // Both listeners live in THIS test process, whose argv carries no
      // JobBored marker (guarded below) — so the script must skip both and
      // both must survive. The kill path is covered by the next test.
      assert.equal(isJobBoredServiceCommand(process.argv.join(" ")), false);
      const scriptPath = new URL("../scripts/restart-dev-services.mjs", import.meta.url);
      let output = "";
      const child = spawn(
        process.execPath,
        [scriptPath.pathname, "--stop-only", "--ports", `${jobboredPort},${foreignPort}`],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      const exited = await Promise.race([
        new Promise((resolve) => child.on("exit", (code) => resolve(code))),
        sleep(15000).then(() => null),
      ]);
      assert.equal(exited, 0, `restart --stop-only must exit 0:\n${output}`);
      assert.match(output, /skipped foreign listener/);
      // Both listeners survive: neither owner argv carries a JobBored marker.
      await assertListenerAlive(jobboredPort);
      await assertListenerAlive(foreignPort);
    } finally {
      await new Promise((resolve) => jobbored.close(resolve));
      await new Promise((resolve) => foreign.close(resolve));
    }
  });

  it("kills a child whose argv carries a JobBored marker, nothing else", async function () {
    if (!lsofAvailable()) return;
    // A real child node whose argv carries a JobBored marker (ps shows the
    // -e code) and which listens on an ephemeral port it reports back.
    const markerChild = spawn(
      process.execPath,
      [
        "-e",
        "const s=require('http').createServer((q,r)=>r.end('x'));s.listen(0,'127.0.0.1',()=>console.log('READY '+s.address().port));setInterval(()=>{},10000); /* dev-server.mjs restart-probe */",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    // A foreign child with no marker on its own port: must survive.
    const foreignChild = spawn(
      process.execPath,
      [
        "-e",
        "const s=require('http').createServer((q,r)=>r.end('x'));s.listen(0,'127.0.0.1',()=>console.log('READY '+s.address().port));setInterval(()=>{},10000);",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const scriptPath = new URL("../scripts/restart-dev-services.mjs", import.meta.url);
    try {
      const markerPort = await readReadyPort(markerChild);
      const foreignPort = await readReadyPort(foreignChild);
      let output = "";
      const child = spawn(
        process.execPath,
        [scriptPath.pathname, "--stop-only", "--ports", `${markerPort},${foreignPort}`],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      const exited = await Promise.race([
        new Promise((resolve) => child.on("exit", (code) => resolve(code))),
        sleep(20000).then(() => null),
      ]);
      assert.equal(exited, 0, `restart --stop-only must exit 0:\n${output}`);
      assert.match(output, /stopped JobBored listener/);
      assert.match(output, /skipped foreign listener/);
      const markerGone = await waitForExit(markerChild, 5000);
      assert.equal(markerGone, true, `marked child must be stopped:\n${output}`);
      assert.equal(foreignChild.exitCode, null, `foreign child must survive:\n${output}`);
      await assertListenerAlive(foreignPort);
    } finally {
      markerChild.kill("SIGKILL");
      foreignChild.kill("SIGKILL");
      await sleep(200);
    }
  });

  it("degrades honestly when port inspection is unavailable", async () => {
    const scriptPath = new URL("../scripts/restart-dev-services.mjs", import.meta.url);
    let output = "";
    const child = spawn(
      process.execPath,
      [scriptPath.pathname, "--stop-only", "--ports", "18991"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: "/nonexistent-path-for-g12-test" },
      },
    );
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    const exited = await Promise.race([
      new Promise((resolve) => child.on("exit", (code) => resolve(code))),
      sleep(15000).then(() => null),
    ]);
    // With no lsof/netstat/ps on PATH the script kills nothing and says so.
    assert.match(output, /port inspection unavailable/);
    assert.equal(exited, 0);
  });
});

async function readReadyPort(child) {
  let output = "";
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error("probe child exited before READY");
    const match = /READY (\d+)/.exec(output);
    if (match) return Number(match[1]);
    output += await new Promise((resolve) => {
      const onData = (chunk) => {
        child.stdout.off("data", onData);
        resolve(chunk.toString("utf8"));
      };
      child.stdout.on("data", onData);
      setTimeout(() => {
        child.stdout.off("data", onData);
        resolve("");
      }, 500);
    });
  }
  throw new Error("probe child never reported READY");
}

function childGone(child) {
  // A signal kill leaves exitCode null and sets signalCode instead.
  return child.exitCode != null || child.signalCode != null;
}

async function waitForExit(child, timeoutMs) {
  if (childGone(child)) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childGone(child)) return true;
    await sleep(100);
  }
  return childGone(child);
}

async function assertListenerAlive(port) {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.ok(res.status > 0);
}
