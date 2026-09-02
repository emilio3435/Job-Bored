/**
 * SIXBEATS claim C3 — the fit profile must persist on a fresh install.
 *
 * On a fresh install `jobBoredApiUrl` is empty, so Beat 4's `POST /profile`
 * and Beat 6's `GET /profile` resolve same-origin against the static
 * dashboard host and 404 (`profile_response_invalid`) — the server fit
 * profile silently never persists (SIXBEATS-SPEC claim C3, locked
 * decision 3: the dev server proxies `/profile` and `/profile/*` to the
 * local API, so no stranger has to configure a URL).
 *
 * Authorization posture is the `/__proxy/*` one: loopback peer AND an exact
 * local-origin allowlist, CORS echoing that origin and never `*`.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";

import { startDevServer } from "../dev-server.mjs";

const SILENT_LOGGER = { log() {}, error() {} };
const EVIL_ORIGIN = "https://evil.example";

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * A stub for the local API (server/index.mjs, normally :3847). Records every
 * request it receives so a test can assert the proxy forwarded method, path
 * and body — and assert it received NOTHING when the request was refused.
 */
async function startStubApi(handler) {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const entry = {
        method: req.method,
        url: req.url,
        body,
        headers: { ...req.headers },
      };
      received.push(entry);
      handler(entry, res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, received, port: server.address().port };
}

function respondJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

const originalApiPort = process.env.JOBBORED_API_PORT;

after(() => {
  if (originalApiPort === undefined) delete process.env.JOBBORED_API_PORT;
  else process.env.JOBBORED_API_PORT = originalApiPort;
});

/**
 * Boot the dev server on a free port with the profile proxy pointed at
 * `apiPort` (or at a port nothing listens on, for the upstream-down case).
 */
async function withDashboard({ apiPort }, fn) {
  process.env.JOBBORED_API_PORT = String(apiPort);
  const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
  const port = server.address().port;
  try {
    return await fn({
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      localOrigin: `http://127.0.0.1:${port}`,
    });
  } finally {
    await closeServer(server);
  }
}

/** A free port with nothing listening on it. */
async function reserveDeadPort() {
  const probe = createServer(() => {});
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await closeServer(probe);
  return port;
}

function acao(res) {
  return res.headers.get("access-control-allow-origin");
}

describe("SIXBEATS-C3 — dev server proxies /profile to the local API", () => {
  it("GET /profile returns the upstream's body and status (Beat 6 reads the saved profile)", async () => {
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 200, {
        ok: true,
        profile: { identity: { targetRoles: ["Staff Engineer"] } },
      });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl, localOrigin }) => {
        const res = await fetch(`${baseUrl}/profile`, {
          headers: { Origin: localOrigin },
        });
        assert.equal(res.status, 200, "Beat 6 must not get the static host's 404");
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.deepEqual(body.profile.identity.targetRoles, ["Staff Engineer"]);
        assert.equal(acao(res), localOrigin);
        assert.notEqual(acao(res), "*");
        assert.equal(upstream.received.length, 1);
        assert.equal(upstream.received[0].method, "GET");
        assert.equal(upstream.received[0].url, "/profile");
      });
    } finally {
      await closeServer(upstream.server);
    }
  });

  it("GET /profile streams a non-2xx upstream status back unchanged", async () => {
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 404, { ok: false, reason: "profile_not_found" });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl, localOrigin }) => {
        const res = await fetch(`${baseUrl}/profile`, {
          headers: { Origin: localOrigin },
        });
        assert.equal(res.status, 404, "the API's own status must survive the hop");
        const body = await res.json();
        assert.equal(body.reason, "profile_not_found");
      });
    } finally {
      await closeServer(upstream.server);
    }
  });

  it("POST /profile forwards the JSON body (Beat 4 saves the fit profile)", async () => {
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 200, { ok: true, saved: JSON.parse(entry.body || "null") });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl, localOrigin }) => {
        const payload = {
          schemaVersion: 1,
          identity: { targetRoles: ["Staff Engineer"], primaryNarrative: "x".repeat(40) },
        };
        const res = await fetch(`${baseUrl}/profile`, {
          method: "POST",
          headers: { Origin: localOrigin, "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.deepEqual(body.saved, payload, "the upstream must receive the exact body");
        assert.equal(upstream.received[0].method, "POST");
        assert.equal(upstream.received[0].url, "/profile");
        assert.match(String(upstream.received[0].headers["content-type"]), /application\/json/);
      });
    } finally {
      await closeServer(upstream.server);
    }
  });

  it("forwards sub-paths and query strings (POST /profile/template/:id, /profile/rescore)", async () => {
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 200, { ok: true, seen: entry.url });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl, localOrigin }) => {
        const template = await fetch(`${baseUrl}/profile/template/marketer`, {
          method: "POST",
          headers: { Origin: localOrigin, "content-type": "application/json" },
        });
        assert.equal(template.status, 200);
        assert.equal((await template.json()).seen, "/profile/template/marketer");

        const rescore = await fetch(`${baseUrl}/profile/rescore?dryRun=true`, {
          method: "POST",
          headers: { Origin: localOrigin, "content-type": "application/json" },
          body: "{}",
        });
        assert.equal(rescore.status, 200);
        assert.equal(
          (await rescore.json()).seen,
          "/profile/rescore?dryRun=true",
          "the query string must survive the hop",
        );
      });
    } finally {
      await closeServer(upstream.server);
    }
  });

  it("forwards PUT as well as GET and POST", async () => {
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 200, { ok: true, method: entry.method, body: entry.body });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl, localOrigin }) => {
        const res = await fetch(`${baseUrl}/profile`, {
          method: "PUT",
          headers: { Origin: localOrigin, "content-type": "application/json" },
          body: JSON.stringify({ schemaVersion: 1 }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.method, "PUT");
        assert.equal(body.body, JSON.stringify({ schemaVersion: 1 }));
      });
    } finally {
      await closeServer(upstream.server);
    }
  });

  it("serves the dashboard's own same-origin GET, which carries no Origin header", async () => {
    // Browsers attach Origin only to CORS and non-GET requests; Beat 6's
    // same-origin fetch sends Sec-Fetch-Site + Referer instead. That pair —
    // and only that pair — stands in for Origin (local-control-auth.mjs).
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 200, { ok: true, profile: { schemaVersion: 1 } });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl, localOrigin }) => {
        const res = await fetch(`${baseUrl}/profile`, {
          headers: {
            "sec-fetch-site": "same-origin",
            Referer: `${localOrigin}/index.html`,
          },
        });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).ok, true);
      });
    } finally {
      await closeServer(upstream.server);
    }
  });

  it("does not forward the browser Origin upstream (the API allowlists :8080 only)", async () => {
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 200, { ok: true });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl, localOrigin }) => {
        await fetch(`${baseUrl}/profile`, { headers: { Origin: localOrigin } });
        assert.equal(
          upstream.received[0].headers.origin,
          undefined,
          "a dashboard on a non-8080 port would be 403'd by the API's origin check",
        );
      });
    } finally {
      await closeServer(upstream.server);
    }
  });
});

describe("SIXBEATS-C3 — the profile proxy keeps the /__proxy authorization posture", () => {
  it("403s a cross-site Origin and never reaches the API", async () => {
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 200, { ok: true, profile: { secret: "must-not-leak" } });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/profile`, {
          headers: { Origin: EVIL_ORIGIN },
        });
        assert.equal(res.status, 403);
        assert.notEqual(acao(res), "*");
        assert.notEqual(acao(res), EVIL_ORIGIN);
        const body = await res.json().catch(() => ({}));
        assert.equal(body.ok, false);
        assert.equal(upstream.received.length, 0, "the API must never see the request");
      });
    } finally {
      await closeServer(upstream.server);
    }
  });

  it("403s a cross-site POST before the body reaches the API", async () => {
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 200, { ok: true });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/profile`, {
          method: "POST",
          headers: { Origin: EVIL_ORIGIN, "content-type": "application/json" },
          body: JSON.stringify({ identity: { targetRoles: ["pwned"] } }),
        });
        assert.equal(res.status, 403);
        assert.equal(upstream.received.length, 0, "no cross-site write may land");
      });
    } finally {
      await closeServer(upstream.server);
    }
  });

  it("403s an origin-less client (curl) the way /__proxy/* does", async () => {
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 200, { ok: true });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/profile`);
        assert.equal(res.status, 403);
        assert.equal(upstream.received.length, 0);
      });
    } finally {
      await closeServer(upstream.server);
    }
  });

  it("answers the CORS preflight for a local origin and refuses an evil one", async () => {
    const upstream = await startStubApi((entry, res) => {
      respondJson(res, 200, { ok: true });
    });
    try {
      await withDashboard({ apiPort: upstream.port }, async ({ baseUrl, localOrigin }) => {
        const allowed = await fetch(`${baseUrl}/profile`, {
          method: "OPTIONS",
          headers: {
            Origin: localOrigin,
            "access-control-request-method": "POST",
          },
        });
        assert.equal(allowed.status, 204);
        assert.equal(acao(allowed), localOrigin);
        assert.match(
          String(allowed.headers.get("access-control-allow-methods") || ""),
          /PUT/,
          "a preflight that hides PUT blocks the very method we forward",
        );

        const denied = await fetch(`${baseUrl}/profile`, {
          method: "OPTIONS",
          headers: {
            Origin: EVIL_ORIGIN,
            "access-control-request-method": "POST",
          },
        });
        assert.equal(denied.status, 403);
        assert.notEqual(acao(denied), "*");
        assert.notEqual(acao(denied), EVIL_ORIGIN);
      });
    } finally {
      await closeServer(upstream.server);
    }
  });
});

describe("SIXBEATS-C3 — the profile proxy fails loud, never hangs", () => {
  it("answers with a JSON error when the API is not running", async () => {
    const deadPort = await reserveDeadPort();
    await withDashboard({ apiPort: deadPort }, async ({ baseUrl, localOrigin }) => {
      const started = Date.now();
      const res = await fetch(`${baseUrl}/profile`, {
        method: "POST",
        headers: { Origin: localOrigin, "content-type": "application/json" },
        body: JSON.stringify({ schemaVersion: 1 }),
      });
      const elapsed = Date.now() - started;
      assert.equal(res.status, 502, "an unreachable API is a gateway error, not a hang");
      assert.match(
        String(res.headers.get("content-type") || ""),
        /application\/json/,
        "Beat 4 parses the body as JSON before it reads the status",
      );
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.error, "profile_api_unreachable");
      assert.ok(elapsed < 5000, `answered in ${elapsed}ms — must not hang`);
    });
  });

  it("defaults to the local API on 3847 when no API port is configured", async () => {
    const { resolveProfileApiPort } = await import("../dev-server.mjs");
    const original = process.env.JOBBORED_API_PORT;
    try {
      delete process.env.JOBBORED_API_PORT;
      assert.equal(resolveProfileApiPort(), 3847);
      process.env.JOBBORED_API_PORT = "4100";
      assert.equal(resolveProfileApiPort(), 4100);
      process.env.JOBBORED_API_PORT = "not-a-port";
      assert.equal(resolveProfileApiPort(), 3847, "garbage falls back, never crashes boot");
    } finally {
      if (original === undefined) delete process.env.JOBBORED_API_PORT;
      else process.env.JOBBORED_API_PORT = original;
    }
  });
});
