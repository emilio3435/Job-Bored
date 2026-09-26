/**
 * GFX-N4 — the launcher no longer kills the dashboard when a sibling dies,
 * and it looks at the dashboard port before it starts anything:
 *
 *   · a current JobBored build answers the §R3 ping → "already running",
 *     open the URL, exit 0;
 *   · an older JobBored answers → say so and how to stop it, exit 1;
 *   · a foreign process holds the port → name it (lsof), exit 1, never kill.
 *
 * Every case runs start.sh through its JB_START_NO_EXEC hook with the
 * browser open skipped, against servers on ephemeral ports. No test binds
 * 8080, 8644 or 3847 (PLAN R16); the real dev-server is spawned with an
 * argv array (PLAN R18) and killed in `after`.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { readRepoFile, repoRoot } from "./oneflow-l0-harness.mjs";

const START_SH = join(repoRoot, "start.sh");
const HAS_LSOF = spawnSync("sh", ["-c", "command -v lsof"]).status === 0;
const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

/**
 * Async on purpose: the fixtures live in this process, and a spawnSync
 * would block the event loop they answer from.
 */
function runStartSh(port, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [START_SH], {
      env: {
        ...process.env,
        CI: "",
        PORT: String(port),
        JB_START_NO_EXEC: "1",
        JB_SKIP_BROWSER_OPEN: "1",
        ...extra,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("start.sh did not finish in 20s"));
    }, 20000);
    child.on("exit", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** An HTTP fixture on localhost (both families, as a dev-server would be reached). */
async function fixture(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "localhost", resolve));
  cleanups.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return server.address().port;
}

async function waitFor(check, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe("GFX-N4 · start.sh checks the dashboard port before starting", () => {
  it("GFX-N4: a current JobBored build → already running, exit 0, nothing started", async () => {
    const port = await freePort();
    // The real dev-server, spawned with argv (never a shell string).
    const child = spawn(process.execPath, [join(repoRoot, "dev-server.mjs")], {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    });
    cleanups.push(async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise((resolve) => child.once("exit", resolve));
      }
    });
    const up = await waitFor(async () => {
      try {
        const res = await fetch(`http://localhost:${port}/__proxy/ping`, {
          headers: { Origin: `http://localhost:${port}` },
        });
        return res.status === 200;
      } catch {
        return false;
      }
    });
    assert.ok(up, "the dev-server came up on its high port");
    const r = await runStartSh(port);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`JobBored is already running at http://localhost:${port}/`));
    assert.doesNotMatch(r.stdout, /NO_EXEC npm start skipped/, "nothing new is started");
  });

  it("GFX-N4: an older JobBored (pre-§R3 ping) → says so, how to stop it, exit 1", async () => {
    const port = await fixture((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const r = await runStartSh(port);
    assert.equal(r.status, 1);
    assert.match(r.stdout, new RegExp(`An older JobBored is already running on port ${port}`));
    assert.match(r.stdout, /Ctrl\+C/);
    if (HAS_LSOF) assert.match(r.stdout, new RegExp(`kill ${process.pid}`));
    assert.doesNotMatch(r.stdout, /NO_EXEC/);
  });

  it("GFX-N4: a JobBored from before the ping (404 text/plain ping, own dashboard) is old too", async () => {
    const port = await fixture((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><title>JobBored — Streamline the Search</title>");
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    });
    const r = await runStartSh(port);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /An older JobBored is already running/);
  });

  it("GFX-N4: a foreign server is named, never killed, exit 1", async () => {
    const port = await fixture((req, res) => {
      res.writeHead(405);
      res.end();
    });
    const r = await runStartSh(port);
    assert.equal(r.status, 1);
    assert.match(r.stdout, new RegExp(`Port ${port} is already in use by`));
    assert.match(r.stdout, /which is not JobBored/);
    if (HAS_LSOF) {
      assert.match(r.stdout, new RegExp(`\\(process ${process.pid}\\)`), "lsof names the holder");
      assert.match(r.stdout, /node/i);
    }
    const stillUp = await fetch(`http://localhost:${port}/`).then(
      (res) => res.status,
      () => 0,
    );
    assert.equal(stillUp, 405, "the foreign holder is left running (PLAN R22)");
  });

  it("GFX-N4: a free port falls through to starting the stack", async () => {
    const r = await runStartSh(await freePort());
    assert.equal(r.status, 0);
    assert.match(r.stdout, /NO_EXEC npm start skipped/);
    assert.doesNotMatch(r.stdout, /already|in use/);
  });
});

describe("GFX-N4 · npm start keeps the dashboard alive when a sibling dies", () => {
  const pkg = JSON.parse(readRepoFile("package.json"));
  const start = pkg.scripts.start;

  it("GFX-N4: start does not pass concurrently's kill-others flag", () => {
    assert.doesNotMatch(start, /(^|\s)(-k|--kill-others(-on-fail)?)(\s|$)/);
  });

  it("GFX-N4/R13: start runs the whole stack, discovery worker included — without restarting a healthy one", () => {
    assert.match(start, /start:web/);
    assert.match(start, /start:scraper/);
    assert.match(start, /start-discovery-worker-local\.mjs/);
    assert.doesNotMatch(start, /--restart-existing/, "a healthy worker is reused, never killed");
  });

  it("GFX-N4: with start's own concurrently flags, a dying sibling leaves the others running", () => {
    const flags = start.slice(start.indexOf("concurrently") + "concurrently".length, start.indexOf('"')).trim().split(/\s+/);
    const node = JSON.stringify(process.execPath);
    const r = spawnSync(
      join(repoRoot, "node_modules", ".bin", "concurrently"),
      [
        ...flags,
        `${node} -e "process.exit(1)"`,
        // The marker is joined at runtime: concurrently echoes each command's
        // text when it exits, so a literal marker would match a killed child.
        `${node} -e "setTimeout(() => console.log(['SCRAPER', 'SURVIVED'].join('_')), 600)"`,
        `${node} -e "setTimeout(() => console.log(['WORKER', 'SURVIVED'].join('_')), 600)"`,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    assert.match(r.stdout, /SCRAPER_SURVIVED/);
    assert.match(r.stdout, /WORKER_SURVIVED/);
    assert.notEqual(r.status, 0, "the failure still surfaces in the exit code");
  });
});
