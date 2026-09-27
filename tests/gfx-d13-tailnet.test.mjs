import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

import {
  authorizeLocalControlRequest,
  createTailnetStatusResolver,
} from "../scripts/lib/local-control-auth.mjs";
import { createDevServer, startDevServer } from "../dev-server.mjs";
import { action, loadRouteLocal, text } from "./gfx-fe-b1-harness.mjs";
import { resolveListenHost } from "../scripts/lib/static-path-guard.mjs";

const DNS = "mac.tailnet.ts.net";
const ORIGIN = `https://${DNS}`;
const OWNER = "owner@example.com";
const STATUS = {
  Self: { DNSName: `${DNS}.`, UserID: 42 },
  User: { "42": { LoginName: OWNER } },
};
const silent = { log() {}, error() {} };
const resolver = () => ({ ok: true, dnsName: DNS, ownerLogin: OWNER });

function request({ host = DNS, origin = ORIGIN, login = OWNER, site, peer = "127.0.0.1" } = {}) {
  const headers = { host };
  if (origin !== null) headers.origin = origin;
  if (login !== null) headers["tailscale-user-login"] = login;
  if (site) headers["sec-fetch-site"] = site;
  return { headers, socket: { remoteAddress: peer, localPort: 8080 } };
}

function auth(req, status = resolver) {
  return authorizeLocalControlRequest(req, { tailnetStatusResolver: status });
}

async function withServer(t, fn, status = resolver) {
  let server;
  try {
    server = await startDevServer({ port: 0, host: "127.0.0.1", logger: silent, tailnetStatusResolver: status });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox refuses loopback bind; orchestrator runs this integration check");
      return;
    }
    throw error;
  }
  try {
    assert.equal(server.address().address, "127.0.0.1", "D13 listener remains loopback-bound");
    const base = `http://127.0.0.1:${server.address().port}`;
    await fn(base);
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function headers({ host = DNS, origin = ORIGIN, login = OWNER } = {}) {
  return { host, origin, "tailscale-user-login": login };
}

function dispatch(server, path, method, requestHeaders) {
  const req = {
    url: path,
    method,
    headers: requestHeaders,
    socket: { localAddress: "127.0.0.1", localPort: 8080, remoteAddress: "127.0.0.1" },
  };
  const result = {};
  const res = {
    writeHead(status, responseHeaders) {
      result.status = status;
      result.headers = responseHeaders;
    },
    end(body = "") {
      result.body = body ? JSON.parse(body) : null;
    },
  };
  server.emit("request", req, res);
  return result;
}

describe("GFX-D13 server trust", () => {
  it("GFX-D13-1 resolves Self DNS and owner login, caches briefly, and fails closed", () => {
    let now = 0;
    let calls = 0;
    let answer = STATUS;
    const status = createTailnetStatusResolver({ readStatus: () => { calls += 1; return answer; }, now: () => now, ttlMs: 1000 });
    assert.deepEqual(status(), { ok: true, dnsName: DNS, ownerLogin: OWNER });
    assert.deepEqual(status(), { ok: true, dnsName: DNS, ownerLogin: OWNER });
    assert.equal(calls, 1);
    now = 1001;
    answer = { ...STATUS, Self: { DNSName: "", UserID: 42 } };
    assert.equal(status().ok, false);
    assert.equal(calls, 2);
    now = 2002;
    answer = null;
    assert.equal(status().ok, false);
  });

  it("GFX-D13-2 requires own Host and HTTPS Origin, Serve owner header, and loopback peer", () => {
    assert.equal(resolveListenHost({ env: {} }), "127.0.0.1");
    assert.equal(auth(request()).ok, true);
    assert.equal(auth(request({ host: "other.tailnet.ts.net" })).ok, false);
    assert.equal(auth(request({ host: `${DNS}:443` })).ok, false);
    assert.equal(auth(request({ origin: "https://other.tailnet.ts.net" })).ok, false);
    assert.equal(auth(request({ origin: `http://${DNS}` })).ok, false);
    assert.equal(auth(request({ login: "other@example.com" })).ok, false);
    assert.equal(auth(request({ login: null })).ok, false);
    assert.equal(auth(request({ peer: "100.101.102.103" })).ok, false);
    assert.equal(auth(request(), () => ({ ok: false })).reason, "tailscale_unavailable");
  });

  it("GFX-D13-3 keeps same-origin GET rules and refuses a foreign page", () => {
    assert.equal(auth(request({ origin: null, site: "same-origin" })).ok, true);
    assert.equal(auth(request({ origin: null, site: "cross-site" })).ok, false);
    assert.equal(auth(request({ origin: "https://evil.example", site: "same-origin" })).ok, false);
  });

  it("GFX-D13-4 answers owner ping and exact CORS, including preflight", () => {
    const server = createDevServer({ port: 8080, logger: silent, tailnetStatusResolver: resolver });
    {
      const ping = dispatch(server, "/__proxy/ping", "GET", headers());
      assert.equal(ping.status, 200);
      assert.equal(ping.headers["access-control-allow-origin"], ORIGIN);
      assert.equal(ping.body.tailnetOwner, true);
      const preflight = dispatch(server, "/__proxy/local-health", "OPTIONS", headers());
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers["access-control-allow-origin"], ORIGIN);
      const foreign = dispatch(server, "/__proxy/ping", "GET", headers({ host: "other.tailnet.ts.net" }));
      assert.equal(foreign.status, 403);
      assert.equal(foreign.headers["access-control-allow-origin"], undefined);
    }
  });

  it("GFX-D13-5 gives honest 403 reasons without a success marker", () => {
    const server = createDevServer({ port: 8080, logger: silent, tailnetStatusResolver: resolver });
    {
      const wrong = dispatch(server, "/__proxy/ping", "GET", headers({ login: "other@example.com" }));
      assert.equal(wrong.status, 403);
      assert.equal(wrong.headers["access-control-allow-origin"], undefined);
      assert.equal(wrong.body.reason, "tailnet_owner_required");
      const missing = dispatch(server, "/__proxy/ping", "GET", { host: DNS, origin: ORIGIN });
      assert.equal(missing.body.reason, "tailnet_owner_required");
      const profile = dispatch(server, "/profile", "GET", {
        ...headers({ login: "other@example.com" }), "sec-fetch-site": "same-origin",
      });
      assert.equal(profile.status, 403, "profile fallback cannot bypass tailnet identity");
    }
    const stopped = createDevServer({ port: 8080, logger: silent, tailnetStatusResolver: () => ({ ok: false }) });
    const down = dispatch(stopped, "/__proxy/ping", "GET", headers());
    assert.equal(down.status, 403);
    assert.equal(down.body.reason, "tailscale_unavailable");
  });

  it("GFX-D13-8 keeps the live listener on loopback", async (t) => {
    await withServer(t, async (base) => {
      const ping = await fetch(`${base}/__proxy/ping`, { headers: { Origin: base } });
      assert.equal(ping.status, 200);
    });
  });
});

describe("GFX-D13 client gate", () => {
  function client(ping) {
    const window = { location: { hostname: DNS, origin: ORIGIN, protocol: "https:" } };
    const context = {
      window,
      fetch: async (url) => {
        assert.equal(url, "/__proxy/ping", "only the page's own same-origin server is probed");
        return { status: ping.status, json: async () => ping.body };
      },
      setTimeout, clearTimeout, AbortController, URL,
    };
    runInNewContext(readFileSync(new URL("../local-server.js", import.meta.url), "utf8"), context);
    return window.JobBoredLocalServer;
  }

  it("GFX-D13-6 trusts only a same-origin ping with tailnetOwner true", async () => {
    const yes = client({ status: 200, body: { ok: true, runtime: "source", tailnetOwner: true } });
    assert.equal(await yes.isLocalControlPage(), true);
    const no = client({ status: 200, body: { ok: true, runtime: "source" } });
    assert.equal(await no.isLocalControlPage(), false);
    assert.equal(await yes.isLocalControlPage({ hostname: "localhost" }), true);
    const refused = client({ status: 403, body: { ok: false, reason: "tailnet_owner_required" } });
    assert.deepEqual(
      JSON.parse(JSON.stringify(await refused.inspectLocalControlPage())),
      { trusted: false, reason: "tailnet_owner_required" },
    );
  });

  it("GFX-D13-7 sends the owner through B1 and gives each refused visitor one fix", async () => {
    const owner = loadRouteLocal({
      location: { hostname: DNS, origin: ORIGIN, protocol: "https:" },
      ping: () => ({ ok: true, runtime: "source", tailnetOwner: true }),
    });
    await owner.flow.open();
    assert.equal(text(owner.mount()).includes("JobBored runs on your computer."), false);

    const wrong = loadRouteLocal({
      location: { hostname: DNS, origin: ORIGIN, protocol: "https:" },
      ping: () => ({ ok: false, reason: "tailnet_owner_required" }),
    });
    await wrong.flow.open();
    assert.match(text(wrong.mount()), /This JobBored belongs to another Tailscale user/);
    assert.match(text(wrong.mount()), /Sign in to Tailscale with the owner's account/);
    assert.ok(action(wrong.mount(), "route_local_reload"));
    assert.equal(action(wrong.mount(), "route_local_open"), null);

    const down = loadRouteLocal({
      location: { hostname: DNS, origin: ORIGIN, protocol: "https:" },
      ping: () => ({ ok: false, reason: "tailscale_unavailable" }),
    });
    await down.flow.open();
    assert.match(text(down.mount()), /Tailscale isn't answering on this computer/);
    assert.match(text(down.mount()), /Start Tailscale on this computer/);
    assert.ok(action(down.mount(), "route_local_reload"));
  });
});
