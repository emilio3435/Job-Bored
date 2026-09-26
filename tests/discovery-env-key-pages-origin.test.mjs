import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

/* ============================================================
   discovery-env-key appends the hosted Pages origin to CORS heals.

   POST /__proxy/discovery-env-key { key: ALLOWED_ORIGINS } gains
   https://<CNAME> alongside the browser-sent value, so one "Set it
   up for me" heal covers the loopback dashboard AND the public site.
   No CNAME (or an invalid one) leaves the value untouched.
   ============================================================ */

const SILENT_LOGGER = {
  log() {},
  error() {},
};

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("discovery-env-key · Pages origin appended live", () => {
  it("writes the hosted origin once, preserves the rest, ignores other keys", async (t) => {
    // Paths bind at import (module-level consts), so the env override must
    // precede the dynamic import. node:test isolates files per process.
    const repoDir = mkdtempSync(join(tmpdir(), "jb-repo-"));
    const homeDir = mkdtempSync(join(tmpdir(), "jb-home-"));
    t.after(() => {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    });
    writeFileSync(join(repoDir, "CNAME"), "pages.example.test\n", "utf8");
    const envPath = join(homeDir, ".env");
    writeFileSync(envPath, "OTHER_VAR=keepme\n", "utf8");
    process.env.JOBBORED_REPO = repoDir;
    process.env.BROWSER_USE_DISCOVERY_WORKER_ENV = envPath;

    const { startDevServer } = await import("../dev-server.mjs");
    const server = await startDevServer({ port: 0, logger: SILENT_LOGGER });
    const port = server.address().port;
    try {
      const post = (payload) =>
        fetch(`http://127.0.0.1:${port}/__proxy/discovery-env-key`, {
          method: "POST",
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      const origins = async (value) => {
        const res = await post({
          key: "BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS",
          value,
        });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).ok, true);
        return readFileSync(envPath, "utf8");
      };

      const afterFirst = await origins("http://localhost:8080");
      assert.ok(
        afterFirst.includes(
          "BROWSER_USE_DISCOVERY_ALLOWED_ORIGINS=http://localhost:8080,https://pages.example.test",
        ),
        "the hosted origin rides along with the browser-sent value",
      );
      assert.ok(
        afterFirst.includes("OTHER_VAR=keepme"),
        "unrelated env lines are preserved",
      );

      await origins(
        "http://localhost:8080,https://pages.example.test",
      );
      const occurrences = readFileSync(envPath, "utf8").split(
        "https://pages.example.test",
      ).length - 1;
      assert.equal(occurrences, 1, "re-heals must not duplicate the origin");

      const keyRes = await post({ key: "SERPAPI_API_KEY", value: "live-key" });
      assert.equal(keyRes.status, 200);
      const keyLine = readFileSync(envPath, "utf8")
        .split("\n")
        .find((line) => line.startsWith("SERPAPI_API_KEY="));
      assert.equal(
        keyLine,
        "SERPAPI_API_KEY=live-key",
        "non-origins keys pass through verbatim",
      );
    } finally {
      await closeServer(server);
    }
  });
});

describe("appendPagesOriginToAllowedOrigins · CNAME matrix", () => {
  let append;
  it("loads the helper", async () => {
    ({ appendPagesOriginToAllowedOrigins: append } = await import(
      "../dev-server.mjs"
    ));
    assert.equal(typeof append, "function");
  });

  const cases = [
    ["bare host", "a.example.test", "http://localhost:8080",
      "http://localhost:8080,https://a.example.test"],
    ["scheme prefix tolerated", "https://b.example.test", "http://localhost:8080",
      "http://localhost:8080,https://b.example.test"],
    ["host lowercased", "UPPER.EXAMPLE.TEST", "http://localhost:8080",
      "http://localhost:8080,https://upper.example.test"],
    ["first line wins", "c.example.test\nsecond.example.test", "http://localhost:8080",
      "http://localhost:8080,https://c.example.test"],
    ["already present passes through untouched", "d.example.test",
      "http://localhost:8080, https://d.example.test",
      "http://localhost:8080, https://d.example.test"],
    ["missing file content", "", "http://localhost:8080", "http://localhost:8080"],
    ["blank file", "   \n  ", "http://localhost:8080", "http://localhost:8080"],
    ["inner whitespace rejected", "not a host", "http://localhost:8080", "http://localhost:8080"],
    ["http scheme rejected", "http://e.example.test", "http://localhost:8080", "http://localhost:8080"],
    ["single label rejected", "localhost", "http://localhost:8080", "http://localhost:8080"],
    ["userinfo rejected", "user@f.example.test", "http://localhost:8080", "http://localhost:8080"],
  ];
  for (const [name, cnameText, value, expected] of cases) {
    it(name, () => {
      assert.equal(append(value, { cnameText }), expected);
    });
  }
});

describe("discovery-env-key · wiring", () => {
  it("handleDiscoveryEnvKey routes origins writes through the helper", () => {
    const source = readFileSync(
      new URL("../dev-server.mjs", import.meta.url),
      "utf8",
    );
    const fnIdx = source.indexOf("async function handleDiscoveryEnvKey(");
    assert.notEqual(fnIdx, -1);
    const body = source.slice(fnIdx, fnIdx + 2500);
    assert.match(
      body,
      /key === DISCOVERY_ALLOWED_ORIGINS_ENV_KEY/,
      "only the origins key takes the Pages path",
    );
    assert.match(
      body,
      /appendPagesOriginToAllowedOrigins\(value\)/,
      "the live CNAME read feeds the write",
    );
  });
});
