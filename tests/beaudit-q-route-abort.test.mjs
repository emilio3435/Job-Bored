/**
 * BEAUDIT lane Q, E11: a client that disconnects must abort the upstream
 * provider call. Before the fix the provider routes in server/index.mjs never
 * passed a request signal, so a closed tab left the provider request running
 * until its own timeout (30 s for ATS, none at all for profile-from-resume).
 *
 * Harness: server/index.mjs on 127.0.0.1 with a throwaway HOME, pinned to a
 * fake openai-compatible provider on loopback that never answers. The client
 * sends the request, waits until the provider has it, then disconnects. The
 * provider must see its socket close within a few seconds.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = join(ROOT, "server");
const API_PORT = 19046;
const PROVIDER_PORT = 19047;
/** Well under the ATS 30 s provider timeout, so only the client abort can close it. */
const ABORT_BUDGET_MS = 5_000;

/** @type {{ path: string, closed: Promise<number>, receivedAt: number }[]} */
const upstream = [];
/** @type {((entry: (typeof upstream)[number]) => void)[]} */
let waiters = [];

function nextUpstreamRequest() {
  return new Promise((resolve) => waiters.push(resolve));
}

/** @type {import("node:http").Server} */
let provider;
/** @type {import("node:child_process").ChildProcess} */
let child;
let home = "";
let output = "";
const baseUrl = `http://127.0.0.1:${API_PORT}`;

before(async () => {
  provider = createServer((req) => {
    const receivedAt = Date.now();
    const closed = new Promise((resolve) => {
      req.socket.once("close", () => resolve(Date.now()));
    });
    req.resume();
    const entry = { path: String(req.url), closed, receivedAt };
    upstream.push(entry);
    const pending = waiters;
    waiters = [];
    for (const w of pending) w(entry);
    // Never answer: only an abort from the API side can end this request.
  });
  await new Promise((r) => provider.listen(PROVIDER_PORT, "127.0.0.1", () => r(undefined)));

  home = mkdtempSync(join(tmpdir(), "beaudit-q-abort-home-"));
  mkdirSync(join(home, ".jobbored"), { recursive: true });
  child = spawn(process.execPath, ["index.mjs"], {
    cwd: SERVER_DIR,
    env: {
      PATH: process.env.PATH || "",
      HOME: home,
      USERPROFILE: home,
      PORT: String(API_PORT),
      LISTEN_HOST: "127.0.0.1",
      JOBBORED_LLM_CONFIG_PATH: join(home, ".jobbored", "llm.json"),
      JOBBORED_PROFILE_PATH: join(home, ".jobbored", "profile.json"),
      HERMES_APPLICATIONS_ROOT: join(home, "applications"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (c) => (output += String(c)));
  child.stderr?.on("data", (c) => (output += String(c)));
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    if (child.exitCode != null) break;
    const res = await fetch(`${baseUrl}/health`).catch(() => null);
    if (res && res.ok) up = true;
    else await sleep(150);
  }
  if (!up) throw new Error(`API failed to start: ${output.slice(-1500)}`);

  const pin = await fetch(`${baseUrl}/api/llm-config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "local",
      model: "stall-model",
      apiKey: "",
      baseUrl: `http://127.0.0.1:${PROVIDER_PORT}/v1`,
    }),
  });
  assert.equal(pin.status, 200, await pin.text());
});

after(async () => {
  if (child && child.exitCode == null) {
    const exited = new Promise((r) => child.once("exit", r));
    child.kill();
    await exited;
  }
  await new Promise((r) => {
    provider.closeAllConnections?.();
    provider.close(() => r(undefined));
  });
  if (home) rmSync(home, { recursive: true, force: true });
});

/**
 * POST `body` to `path`, disconnect once the provider holds the upstream
 * request, and report how long the upstream socket stayed open after that.
 * @param {string} path
 * @param {unknown} body
 */
async function disconnectMidCall(path, body) {
  const seen = nextUpstreamRequest();
  const payload = JSON.stringify(body);
  const req = httpRequest(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
  });
  req.on("error", () => {});
  req.end(payload);
  const entry = await Promise.race([
    seen,
    sleep(10_000).then(() => null),
  ]);
  assert.ok(entry, `the route never reached the provider: ${output.slice(-800)}`);
  const disconnectedAt = Date.now();
  req.destroy();
  const closedAt = await Promise.race([
    entry.closed,
    sleep(ABORT_BUDGET_MS).then(() => null),
  ]);
  return { entry, closedAfterMs: closedAt == null ? null : closedAt - disconnectedAt };
}

describe("E11 a client disconnect aborts the upstream provider call", () => {
  it("POST /api/ats-scorecard", async () => {
    const example = JSON.parse(
      readFileSync(join(ROOT, "examples", "ats-scorecard-request.v1.json"), "utf8"),
    );
    const { entry, closedAfterMs } = await disconnectMidCall("/api/ats-scorecard", example);
    assert.match(entry.path, /\/v1\/chat\/completions/);
    assert.notEqual(
      closedAfterMs,
      null,
      `upstream still open ${ABORT_BUDGET_MS} ms after the client left`,
    );
  });

  it("POST /profile/from-resume", async () => {
    const { entry, closedAfterMs } = await disconnectMidCall("/profile/from-resume", {
      resumeText:
        "Senior frontend engineer. Eight years of React and TypeScript product work at two startups.",
    });
    assert.match(entry.path, /\/v1\/chat\/completions/);
    assert.notEqual(
      closedAfterMs,
      null,
      `upstream still open ${ABORT_BUDGET_MS} ms after the client left`,
    );
  });

  it("POST /profile/rescore takes its signal from routeDeadlineSignal", () => {
    // The live rescore path needs a Sheet (Google), so the wiring is pinned
    // statically: the SSE route must hand rescoreAllPipelineRows a signal from
    // routeDeadlineSignal (response close), not req "close", which Node fires
    // as soon as the request body has been read.
    const src = readFileSync(join(SERVER_DIR, "index.mjs"), "utf8");
    const start = src.indexOf('app.post("/profile/rescore"');
    const end = src.indexOf("app.", start + 10);
    const route = src.slice(start, end);
    assert.ok(route.length > 0, "the /profile/rescore route is missing");
    assert.ok(/routeDeadlineSignal\(req, res/.test(route), "rescore never calls routeDeadlineSignal(req, res, ...)");
    assert.ok(!/req\.on\("close"/.test(route), "rescore still aborts on req close");
  });
});

describe("routeDeadlineSignal(req, res, Infinity) for the rescore stream", () => {
  it("has no deadline and aborts only when the response closes early", async () => {
    const { EventEmitter } = await import("node:events");
    const { routeDeadlineSignal } = await import("../server/ai/provider.mjs");
    const res = Object.assign(new EventEmitter(), { writableFinished: false });
    const signal = routeDeadlineSignal(null, res, Infinity);
    await sleep(20);
    assert.equal(signal.aborted, false);
    res.emit("close");
    assert.equal(signal.aborted, true);
  });
});
