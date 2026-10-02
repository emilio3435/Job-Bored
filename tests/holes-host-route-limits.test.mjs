/**
 * HOLES HOST S4 (route half): nothing limited the routes that spend LLM
 * tokens or launch Chromium, so a client loop or a leaked hosted token ran
 * up cost and memory without bound. A per-process rate limit and a
 * concurrency cap now answer 429 with retryable:true and Retry-After.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { createRouteLimiter, isLimitedRoute } from "../server/route-limits.mjs";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "server");
const ATS_EXAMPLE = readFileSync(join(SERVER_DIR, "..", "examples", "ats-scorecard-request.v1.json"), "utf8");

describe("HOLES HOST S4 — which routes are limited", () => {
  it("covers the LLM and Chromium routes", () => {
    for (const [method, path] of [
      ["POST", "/api/scrape-job"],
      ["POST", "/api/ats-scorecard"],
      ["POST", "/api/leads/chat"],
      ["POST", "/profile/from-resume"],
      ["POST", "/api/llm-config/judge-test"],
      ["POST", "/api/applications/acme-pm/request"],
      ["POST", "/api/applications/acme-pm/repair"],
      ["POST", "/api/applications/acme-pm/regenerate"],
      ["POST", "/api/applications/acme-pm/scrape-job-description"],
      ["POST", "/api/applications/acme-pm/edits"],
      ["POST", "/api/applications/acme-pm/edits/manual"],
      ["POST", "/api/applications/acme-pm/edits/e1/accept"],
      ["POST", "/api/applications/acme-pm/versions/run-1/restore"],
    ]) {
      assert.equal(isLimitedRoute(method, path), true, `${method} ${path}`);
    }
  });

  it("leaves reads, saves and the single-flight rescore alone", () => {
    for (const [method, path] of [
      ["GET", "/health"],
      ["GET", "/api/applications"],
      ["GET", "/api/applications/acme-pm/edits/e1/stream"],
      ["POST", "/profile"],
      ["POST", "/profile/rescore"],
      ["PUT", "/api/applications/acme-pm/job-description"],
      ["POST", "/api/llm-config"],
    ]) {
      assert.equal(isLimitedRoute(method, path), false, `${method} ${path}`);
    }
  });
});

/** A response stand-in the limiter can write a 429 to and watch finish. */
function fakeRes() {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    /** @type {Record<string, string>} */
    headers: {},
    /** @type {unknown} */
    body: undefined,
    /** @param {string} name @param {string} value */
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    /** @param {number} code */
    status(code) {
      res.statusCode = code;
      return res;
    },
    /** @param {unknown} payload */
    json(payload) {
      res.body = payload;
      res.emit("finish");
      return res;
    },
  });
  return res;
}

/**
 * @param {ReturnType<typeof createRouteLimiter>} limiter
 * @param {string} [path]
 */
function admit(limiter, path = "/api/ats-scorecard") {
  const res = fakeRes();
  let passed = false;
  limiter(/** @type {any} */ ({ method: "POST", path }), /** @type {any} */ (res), () => {
    passed = true;
  });
  return { passed, res };
}

describe("HOLES HOST S4 — limiter", () => {
  it("answers a retryable 429 with Retry-After past the per-minute budget", () => {
    let clock = 1_000_000;
    const limiter = createRouteLimiter({ perMinute: 2, concurrency: 10, now: () => clock });
    for (let i = 0; i < 2; i += 1) {
      const { passed, res } = admit(limiter);
      assert.equal(passed, true);
      res.emit("finish");
    }
    clock += 20_000;
    const refused = admit(limiter);
    assert.equal(refused.passed, false);
    assert.equal(refused.res.statusCode, 429);
    assert.equal(refused.res.headers["retry-after"], "40");
    assert.deepEqual(
      { code: /** @type {any} */ (refused.res.body).code, retryable: /** @type {any} */ (refused.res.body).retryable },
      { code: "rate_limited", retryable: true },
    );
    clock += 40_000;
    assert.equal(admit(limiter).passed, true, "the window slides");
  });

  it("caps requests in flight and frees a slot when one ends or its client leaves", () => {
    const limiter = createRouteLimiter({ perMinute: 100, concurrency: 1 });
    const first = admit(limiter);
    assert.equal(first.passed, true);
    const second = admit(limiter, "/api/applications/acme-pm/regenerate");
    assert.equal(second.passed, false);
    assert.equal(second.res.statusCode, 429);
    assert.equal(/** @type {any} */ (second.res.body).code, "too_many_in_flight");
    assert.equal(/** @type {any} */ (second.res.body).retryable, true);
    assert.ok(Number(second.res.headers["retry-after"]) > 0);
    first.res.emit("close");
    first.res.emit("finish");
    const third = admit(limiter);
    assert.equal(third.passed, true, "a finished request frees exactly one slot");
    assert.equal(admit(limiter).passed, false);
  });

  it("never touches a route it does not limit", () => {
    const limiter = createRouteLimiter({ perMinute: 0, concurrency: 0 });
    assert.equal(admit(limiter, "/api/applications").passed, true);
  });
});

describe("HOLES HOST S4 — the API enforces it", () => {
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  /** @type {import("node:http").Server | null} */
  let provider = null;
  let baseUrl = "";
  let home = "";
  /** @type {() => void} */
  let releaseProvider = () => {};

  before(async () => {
    home = mkdtempSync(join(tmpdir(), "holes-host-limits-"));
    // An OpenAI-compatible stand-in that holds every call until released,
    // then answers at once (so a provider-side retry cannot hang the test).
    let released = false;
    /** @type {import("node:http").ServerResponse[]} */
    const held = [];
    /** @param {import("node:http").ServerResponse} res */
    const answer = (res) => {
      if (res.writableEnded) return;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "stub" } }));
    };
    provider = createServer((req, res) => {
      req.resume();
      if (released) answer(res);
      else held.push(res);
    });
    releaseProvider = () => {
      released = true;
      for (const res of held.splice(0)) answer(res);
    };
    await new Promise((resolve) => provider?.listen(0, "127.0.0.1", () => resolve(undefined)));
    const providerPort = /** @type {import("node:net").AddressInfo} */ (provider.address()).port;
    const port = await new Promise((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const free = /** @type {import("node:net").AddressInfo} */ (probe.address()).port;
        probe.close(() => resolve(free));
      });
    });
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["index.mjs"], {
      cwd: SERVER_DIR,
      env: {
        PATH: process.env.PATH || "",
        HOME: home,
        USERPROFILE: home,
        PORT: String(port),
        LISTEN_HOST: "127.0.0.1",
        HERMES_APPLICATIONS_ROOT: join(home, "applications"),
        JOBBORED_LLM_CONFIG_PATH: join(home, "llm.json"),
        ATS_PROVIDER: "openai_compatible",
        ATS_OPENAI_COMPATIBLE_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
        ATS_OPENAI_COMPATIBLE_MODEL: "stub-model",
        JOBBORED_ROUTE_CONCURRENCY: "1",
        JOBBORED_ROUTE_RATE_PER_MINUTE: "4",
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${baseUrl}/health`).catch(() => null);
      if (res && res.ok) return;
      await sleep(100);
    }
    throw new Error("API did not start");
  });

  after(async () => {
    releaseProvider();
    if (child && child.exitCode == null) {
      const exited = new Promise((r) => child?.once("exit", r));
      child.kill();
      await exited;
    }
    await new Promise((resolve) => provider?.close(() => resolve(undefined)));
    rmSync(home, { recursive: true, force: true });
  });

  it("refuses a second LLM request while one is in flight, then the per-minute budget", async () => {
    const post = (/** @type {string} */ path, /** @type {string} */ body) =>
      fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
    // Two fast 400s (a malformed ATS body, a scrape with no URL) use two of
    // the four admissions this minute and hold no slot.
    assert.equal((await post("/api/ats-scorecard", JSON.stringify({ bogus: true }))).status, 400);
    assert.equal((await post("/api/scrape-job", "{}")).status, 400);
    // The third holds the only slot: an ATS call the stub never answers.
    const held = post("/api/ats-scorecard", ATS_EXAMPLE);
    await sleep(400);
    const busy = await post("/api/scrape-job", "{}");
    assert.equal(busy.status, 429);
    const refused = await busy.json();
    assert.equal(refused.code, "too_many_in_flight", "a refused request is not admitted");
    assert.equal(refused.retryable, true);
    assert.ok(Number(busy.headers.get("retry-after")) > 0);
    releaseProvider();
    await (await held).text();
    // The slot is free again: the fourth admission runs, the fifth is over
    // this minute's budget.
    assert.equal((await post("/api/scrape-job", "{}")).status, 400);
    const overBudget = await post("/api/scrape-job", "{}");
    assert.equal(overBudget.status, 429);
    const limited = await overBudget.json();
    assert.equal(limited.code, "rate_limited");
    assert.equal(limited.retryable, true);
  });
});
