/**
 * GFX BE-FUEL — local-server.js, the one answer to "is JobBored running on
 * this computer, and what exactly is wrong if it isn't".
 *
 * The outcome matrix runs the module's REAL check (ping, then the keyed
 * POST) against real HTTP servers on ephemeral ports: the current
 * dev-server.mjs build, and fixtures for a stale build, a foreign static
 * server, a JSON 403, a 500 JSON and a refused connection. Each is judged
 * from a loopback page and from a hosted page. SerpApi itself is faked
 * in-process — no test reaches the network, and no test binds 8080, 8644
 * or 3847 (PLAN R16).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { after, before, describe, it } from "node:test";

import { startDevServer } from "../dev-server.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SILENT_LOGGER = { log() {}, error() {} };
const FAKE_KEY = "fake-serp-key-000";
const HOSTED = "jobbored.example.test";
const FORBIDDEN_PORTS = new Set([8080, 8644, 3847]);

/** local-server.js in its own realm, as index.html would load it. */
function loadLocalServer({ location, navigator } = {}) {
  const win = {};
  if (location) win.location = location;
  if (navigator) win.navigator = navigator;
  const ctx = {
    window: win,
    fetch: (...args) => globalThis.fetch(...args),
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    Object,
    Array,
    String,
    Number,
    JSON,
    Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, "local-server.js"), "utf8"), ctx, {
    filename: "local-server.js",
  });
  return win.JobBoredLocalServer;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  assert.ok(!FORBIDDEN_PORTS.has(port));
  return port;
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
}

function fixture(handler) {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => handler(req, res, raw));
  });
  return server;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const CURRENT_PING = { ok: true, version: "0.1.0", runtime: "source", routes: ["ping", "serpapi-check"] };

/**
 * A browser page's fetch: relative URLs resolve against the answering
 * server, and every request carries the page's Origin plus the
 * Sec-Fetch-Site a browser would send. Records what was sent.
 */
function pageFetch(targetBase, pageOrigin, calls) {
  return (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body || null });
    const sameOrigin = pageOrigin === targetBase;
    return fetch(`${targetBase}${url}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Origin: pageOrigin,
        "Sec-Fetch-Site": sameOrigin ? "same-origin" : "cross-site",
      },
    });
  };
}

// ---------------------------------------------------------------
// The fake SerpApi the dev-server's own check reaches for.
// ---------------------------------------------------------------

const realFetch = globalThis.fetch;
let serpapiMode = "ok";
function installFakeSerpApi() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://serpapi.com/")) {
      if (serpapiMode === "throw") throw new TypeError("fetch failed");
      if (serpapiMode === "invalid") {
        return new Response(JSON.stringify({ error: "Invalid API key." }), { status: 401 });
      }
      if (serpapiMode === "upstream500") {
        return new Response("oops", { status: 500 });
      }
      return new Response(
        JSON.stringify({ plan_name: "Free Plan", total_searches_left: 3 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return realFetch(url, init);
  };
}

// ---------------------------------------------------------------
// Servers under test
// ---------------------------------------------------------------

const servers = {};
const bases = {};

before(async () => {
  installFakeSerpApi();
  const dev = await startDevServer({ port: 0, host: "127.0.0.1", logger: SILENT_LOGGER });
  servers.current = dev;
  bases.current = `http://127.0.0.1:${dev.address().port}`;

  const defs = {
    // A pre-1cf28155 build: no ping, no check, 404 text/plain.
    stale404: fixture((req, res) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    }),
    // A build whose ping predates the §R3 contract (no version).
    staleNoVersion: fixture((req, res) => {
      if (req.url === "/__proxy/ping") return json(res, 200, { ok: true });
      json(res, 200, { ok: true, plan: "Free", searchesLeft: 5 });
    }),
    // A build that pings with a version but doesn't serve serpapi-check.
    staleNoRoute: fixture((req, res) => {
      if (req.url === "/__proxy/ping") {
        return json(res, 200, { ok: true, version: "0.0.9", runtime: "source", routes: ["ping"] });
      }
      json(res, 200, { ok: true });
    }),
    // python -m http.server style: 405, empty body.
    foreign405: fixture((req, res) => {
      res.writeHead(405);
      res.end();
    }),
    // Live Server style: 404 HTML.
    foreign404Html: fixture((req, res) => {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>404</title>");
    }),
    // A JobBored origin gate refusing both requests.
    json403: fixture((req, res) => json(res, 403, { ok: false, reason: "forbidden" })),
    // A current build whose check hits an internal error.
    json500: fixture((req, res) => {
      if (req.url === "/__proxy/ping") return json(res, 200, CURRENT_PING);
      json(res, 500, { ok: false, reason: "internal_error" });
    }),
    // A 500 JSON on the ping itself — unrecognised, so it fails closed.
    pingJson500: fixture((req, res) => json(res, 500, { ok: false, reason: "boom" })),
  };
  for (const [name, server] of Object.entries(defs)) {
    servers[name] = server;
    bases[name] = `http://127.0.0.1:${await listen(server)}`;
  }
  // A port nobody listens on: bind, note, close.
  const gone = fixture(() => {});
  bases.refused = `http://127.0.0.1:${await listen(gone)}`;
  await closeServer(gone);
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const server of Object.values(servers)) await closeServer(server);
});

/** Run the real check from a page on `pageHost`, against `target`. */
async function checkFrom(target, pageHost) {
  const api = loadLocalServer();
  const base = bases[target];
  const loopback = pageHost !== HOSTED;
  const pageOrigin = loopback ? base : `https://${HOSTED}`;
  const calls = [];
  const answer = await api.checkSerpApiKey(FAKE_KEY, {
    pageHostname: loopback ? "127.0.0.1" : HOSTED,
    fetchImpl: pageFetch(base, pageOrigin, calls),
  });
  return { answer, calls };
}

function keyPosts(calls) {
  return calls.filter((c) => c.url.includes("serpapi-check"));
}

// ---------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------

describe("GFX-S3/S7/S9 · the outcome matrix against a REAL current dev-server", () => {
  it("GFX-S9: a good key on a loopback page is ok, with the plan and searchesLeft as a note", async () => {
    serpapiMode = "ok";
    const { answer, calls } = await checkFrom("current", "loopback");
    assert.equal(answer.outcome, "ok");
    assert.equal(answer.blocks, false);
    assert.equal(answer.body.plan, "Free Plan");
    assert.equal(answer.body.searchesLeft, 3, "a low count is carried, never a block");
    assert.equal(answer.ping.current, true);
    assert.equal(keyPosts(calls).length, 1);
    assert.ok(calls.every((c) => !c.url.includes(FAKE_KEY)), "the key never rides in a URL");
  });

  it("GFX-S9: a rejected key is invalid_key", async () => {
    serpapiMode = "invalid";
    const { answer } = await checkFrom("current", "loopback");
    assert.equal(answer.outcome, "invalid_key");
    assert.equal(answer.blocks, true);
  });

  it("GFX-S9: SerpApi's network down is unreachable — never no_local_server", async () => {
    serpapiMode = "throw";
    const { answer } = await checkFrom("current", "loopback");
    assert.equal(answer.outcome, "unreachable");
    assert.notEqual(answer.outcome, "no_local_server");
  });

  it("GFX-S9: SerpApi answering 500 is upstream_error", async () => {
    serpapiMode = "upstream500";
    const { answer } = await checkFrom("current", "loopback");
    assert.equal(answer.outcome, "upstream_error");
  });

  it("GFX-S7: a hosted page is refused by the origin gate → forbidden, shown as wrong_origin", async () => {
    serpapiMode = "ok";
    const { answer } = await checkFrom("current", HOSTED);
    assert.equal(answer.outcome, "forbidden");
    assert.equal(answer.display, "wrong_origin");
    assert.equal(answer.ping.outcome, "forbidden", "a JSON 403 ping still proves the server up (GFX-WT-N3)");
  });
});

describe("GFX-N-stale/S1 · stale, foreign and dead servers, from loopback and hosted pages", () => {
  const MATRIX = [
    // [target, loopback outcome, hosted outcome, key may be POSTed?]
    ["stale404", "stale_server", "static_host", false],
    ["staleNoVersion", "stale_server", "stale_server", false],
    ["staleNoRoute", "stale_server", "stale_server", false],
    ["foreign405", "stale_server", "static_host", false],
    ["foreign404Html", "stale_server", "static_host", false],
    ["json403", "forbidden", "forbidden", true],
    ["json500", "internal_error", "internal_error", true],
    ["pingJson500", "stale_server", "stale_server", false],
    ["refused", "no_local_server", "no_local_server", false],
  ];
  for (const [target, onLoopback, onHosted, posts] of MATRIX) {
    for (const [page, expected] of [["loopback", onLoopback], [HOSTED, onHosted]]) {
      it(`GFX-S1/N-stale: ${target} from a ${page === HOSTED ? "hosted" : "loopback"} page → ${expected}`, async () => {
        const { answer, calls } = await checkFrom(target, page);
        assert.equal(answer.outcome, expected);
        assert.equal(answer.blocks, true, "nothing unrecognised is ever ok");
        assert.equal(
          keyPosts(calls).length,
          posts ? 1 : 0,
          posts ? "a JobBored-shaped ping earns the keyed check" : "the key never leaves on a failed ping",
        );
      });
    }
  }

  it("GFX-WT-N2: a stale server on a loopback page is never static_host", async () => {
    const { answer } = await checkFrom("stale404", "loopback");
    assert.equal(answer.outcome, "stale_server");
  });

  it("GFX-N-stale: an absolute base names the answering host, whatever the page", async () => {
    const api = loadLocalServer({ location: { hostname: HOSTED } });
    const ping = await api.pingLocalServer({
      base: bases.stale404.replace("127.0.0.1", "localhost"),
    });
    assert.equal(ping.outcome, "stale_server", "a 404 from localhost is an old build, not the hosted page");
  });
});

describe("GFX-N-stale · pingLocalServer against the §R3 contract", () => {
  it("a current build reports version, runtime and routes", async () => {
    const api = loadLocalServer();
    const calls = [];
    const ping = await api.pingLocalServer({
      pageHostname: "127.0.0.1",
      fetchImpl: pageFetch(bases.current, bases.current, calls),
    });
    assert.equal(ping.outcome, "ok");
    assert.equal(ping.up, true);
    assert.equal(ping.current, true);
    assert.match(ping.version, /^\d+\.\d+\.\d+/);
    assert.equal(ping.runtime, "source");
    assert.ok(ping.routes.includes("serpapi-check"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].body, null, "the ping is keyless");
  });

  it("an aborted signal reads as no answer, never as up", async () => {
    const api = loadLocalServer();
    const ctrl = new AbortController();
    ctrl.abort();
    const ping = await api.pingLocalServer({
      base: bases.current,
      signal: ctrl.signal,
    });
    assert.equal(ping.up, false);
    assert.equal(ping.outcome, "no_local_server");
  });

  it("a hung server times out to no_local_server", async (t) => {
    const hung = createServer(() => {});
    const port = await listen(hung);
    t.after(() => closeServer(hung));
    const api = loadLocalServer();
    const ping = await api.pingLocalServer({ base: `http://127.0.0.1:${port}`, timeoutMs: 50 });
    assert.equal(ping.outcome, "no_local_server");
    assert.equal(ping.aborted, true);
  });
});

describe("GFX-S3 · classifyAnswer fails closed", () => {
  const api = loadLocalServer();
  const res = (status, body, contentType) => ({
    status,
    headers: { get: (n) => (String(n).toLowerCase() === "content-type" ? contentType || null : null) },
    json: async () => {
      if (body === undefined) throw new SyntaxError("no json");
      return body;
    },
  });

  it("an unknown JSON reason is stale_server, a 500 one internal_error — never ok", async () => {
    assert.equal((await api.classifyAnswer(res(200, { ok: false, reason: "quota" }), { pageHostname: "localhost" })).outcome, "stale_server");
    assert.equal((await api.classifyAnswer(res(500, { ok: false }), { pageHostname: "localhost" })).outcome, "internal_error");
  });

  it("a truthy-but-not-true ok is not a pass", async () => {
    const answer = await api.classifyAnswer(res(200, { ok: "yes" }), { pageHostname: "localhost" });
    assert.equal(answer.outcome, "stale_server");
  });

  it("a missing response is no_local_server", async () => {
    assert.equal((await api.classifyAnswer(null, {})).outcome, "no_local_server");
  });

  it("the server's empty_key is a key problem", async () => {
    assert.equal((await api.classifyAnswer(res(400, { ok: false, reason: "empty_key" }), {})).outcome, "invalid_key");
  });

  it("a 200 text/plain off loopback is unproven → no_local_server; on loopback → stale_server", async () => {
    assert.equal((await api.classifyAnswer(res(200, undefined, "text/plain"), { pageHostname: HOSTED })).outcome, "no_local_server");
    assert.equal((await api.classifyAnswer(res(200, undefined, "text/plain"), { pageHostname: "localhost" })).outcome, "stale_server");
  });
});

describe("GFX-S3 · the frozen outcome table (PLAN §R2)", () => {
  const api = loadLocalServer();
  it("names exactly the nine outcomes, with no quota reason", () => {
    assert.deepEqual(Object.keys(api.OUTCOMES).sort(), [
      "forbidden",
      "internal_error",
      "invalid_key",
      "no_local_server",
      "ok",
      "stale_server",
      "static_host",
      "unreachable",
      "upstream_error",
    ]);
    assert.equal(api.OUTCOMES.quota, undefined);
  });

  it("only ok does not block; forbidden shows as wrong_origin", () => {
    for (const [name, row] of Object.entries(api.OUTCOMES)) {
      assert.equal(row.blocks, name !== "ok", name);
      assert.equal(row.display, name === "forbidden" ? "wrong_origin" : name);
    }
    assert.notEqual(api.OUTCOMES.unreachable.display, api.OUTCOMES.no_local_server.display);
  });

  it("is frozen all the way down", () => {
    assert.ok(Object.isFrozen(api.OUTCOMES));
    assert.ok(Object.isFrozen(api.OUTCOMES.ok));
    assert.ok(Object.isFrozen(api));
  });
});

describe("GFX-X1 · localServerHint is the one start sentence", () => {
  it("names start.command on a Mac and ./start.sh everywhere else", () => {
    const api = loadLocalServer();
    assert.equal(api.localServerHint("MacIntel"), "double-click start.command in the JobBored folder");
    assert.equal(api.localServerHint("macOS"), "double-click start.command in the JobBored folder");
    assert.equal(api.localServerHint("Linux x86_64"), "run ./start.sh in the JobBored folder");
    assert.equal(api.localServerHint("Win32"), "run ./start.sh in the JobBored folder");
    assert.equal(api.localServerHint(""), "run ./start.sh in the JobBored folder");
  });

  it("reads the navigator when no platform is passed, and never names npm", () => {
    const api = loadLocalServer({ navigator: { userAgentData: { platform: "macOS" }, platform: "" } });
    assert.match(api.localServerHint(), /start\.command/);
    assert.doesNotMatch(api.localServerHint(), /npm/);
  });
});

describe("GFX-WT-N2 · isLoopbackPage", () => {
  const api = loadLocalServer();
  for (const hostname of ["localhost", "127.0.0.1", "127.9.8.7", "[::1]", "::1", "LOCALHOST"]) {
    it(`${hostname} is loopback`, () => assert.equal(api.isLoopbackPage({ hostname }), true));
  }
  for (const hostname of [HOSTED, "my-mac.tailnet.ts.net", "192.168.1.5", "localhost.evil.example", "127.0.0.1.evil.example", ""]) {
    it(`${hostname || "(empty)"} is not loopback`, () => assert.equal(api.isLoopbackPage({ hostname }), false));
  }
  it("a missing location is not loopback", () => {
    assert.equal(api.isLoopbackPage(null), false);
    assert.equal(loadLocalServer().isLoopbackPage(), false);
  });
});

describe("GFX-D8/R4 · jobBoredOpenUrl allowlists the beat", () => {
  const api = loadLocalServer();
  it("builds the link for each allowlisted beat", () => {
    for (const beat of ["google", "ai", "resume", "fit", "discovery", "payoff"]) {
      assert.equal(api.jobBoredOpenUrl(beat), `jobbored://open?beat=${beat}`);
    }
  });

  it("no beat is the greenfield default link (R4)", () => {
    assert.equal(api.jobBoredOpenUrl(), "jobbored://open");
  });

  it("rejects unknown beats, extra params and injection strings", () => {
    for (const bad of [
      "",
      "settings",
      "Discovery",
      " discovery",
      "discovery ",
      "discovery&returnTo=close",
      "discovery?x=1",
      "discovery#frag",
      "discovery%26returnTo%3Dclose",
      "../discovery",
      "discovery\nX-Evil: 1",
      "javascript:alert(1)",
      "<script>",
      null,
      42,
      ["discovery"],
      { toString: () => "discovery" },
    ]) {
      assert.equal(api.jobBoredOpenUrl(bad), null, JSON.stringify(String(bad)));
    }
  });
});
