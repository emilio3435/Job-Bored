/**
 * Lane C (tunnel-leak repair): the cloudflared quick-tunnel path in
 * scripts/bootstrap-local-discovery.mjs must reuse a live tunnel for the port
 * (like the ngrok path does via pickNgrokPublicUrl) and, when no live tunnel
 * exists, kill only OUR OWN stale quick-tunnel processes for that port before
 * spawning — never ngrok, named tunnels, or foreign processes.
 *
 * The spawn tail of ensureCloudflareQuickTunnel is intentionally untested
 * here: it detaches a real cloudflared process. Coverage targets the reuse
 * early-return plus the ownership predicate and kill funnel every kill
 * decision flows through.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ensureCloudflareQuickTunnel,
  isOwnCloudflaredQuickTunnelCommand,
  killOwnStaleCloudflaredQuickTunnels,
  listOwnCloudflaredQuickTunnelPids,
  parseProcessTable,
  readLoggedQuickTunnelUrl,
} from "../scripts/bootstrap-local-discovery.mjs";

describe("isOwnCloudflaredQuickTunnelCommand — ownership predicate", () => {
  it("matches our own quick tunnel argv for the port", () => {
    assert.equal(
      isOwnCloudflaredQuickTunnelCommand(
        "cloudflared tunnel --url http://127.0.0.1:8644",
        8644,
      ),
      true,
    );
    // Homebrew-style absolute binary path.
    assert.equal(
      isOwnCloudflaredQuickTunnelCommand(
        "/opt/homebrew/bin/cloudflared tunnel --url http://127.0.0.1:8644",
        8644,
      ),
      true,
    );
    // localhost spelling of the same target.
    assert.equal(
      isOwnCloudflaredQuickTunnelCommand(
        "cloudflared tunnel --url http://localhost:8644",
        8644,
      ),
      true,
    );
  });

  it("rejects named tunnels, ngrok, and foreign processes", () => {
    // User-managed NAMED tunnel: stable, never ours to kill.
    assert.equal(
      isOwnCloudflaredQuickTunnelCommand("cloudflared tunnel run jobbored-discovery", 8644),
      false,
    );
    // ngrok, even for the right port.
    assert.equal(
      isOwnCloudflaredQuickTunnelCommand("ngrok http 8644", 8644),
      false,
    );
    // Bare cloudflared invocations carry no --url.
    assert.equal(
      isOwnCloudflaredQuickTunnelCommand("cloudflared --version", 8644),
      false,
    );
    assert.equal(isOwnCloudflaredQuickTunnelCommand("", 8644), false);
    assert.equal(isOwnCloudflaredQuickTunnelCommand("node server.mjs", 8644), false);
  });

  it("rejects quick tunnels for other ports (with digit-boundary matching)", () => {
    assert.equal(
      isOwnCloudflaredQuickTunnelCommand(
        "cloudflared tunnel --url http://127.0.0.1:9999",
        8644,
      ),
      false,
    );
    // :864 must not prefix-match :8644.
    assert.equal(
      isOwnCloudflaredQuickTunnelCommand(
        "cloudflared tunnel --url http://127.0.0.1:8644",
        864,
      ),
      false,
    );
    assert.equal(
      isOwnCloudflaredQuickTunnelCommand(
        "cloudflared tunnel --url http://127.0.0.1:8644",
        "nope",
      ),
      false,
    );
  });
});

describe("parseProcessTable — ps output parsing", () => {
  it("parses pid/command rows and skips garbage plus our own PID", () => {
    const text = [
      "  123 cloudflared tunnel --url http://127.0.0.1:8644",
      ` ${process.pid} node scripts/bootstrap-local-discovery.mjs`,
      "not a row",
      "",
      "  456 ngrok http 8644",
    ].join("\n");
    assert.deepEqual(parseProcessTable(text), [
      { pid: 123, command: "cloudflared tunnel --url http://127.0.0.1:8644" },
      { pid: 456, command: "ngrok http 8644" },
    ]);
    assert.deepEqual(parseProcessTable(""), []);
  });
});

describe("listOwnCloudflaredQuickTunnelPids — process enumeration", () => {
  const PS_OUTPUT = [
    "  111 cloudflared tunnel --url http://127.0.0.1:8644",
    "  222 cloudflared tunnel run jobbored-discovery",
    "  333 ngrok http 8644",
    "  444 cloudflared tunnel --url http://127.0.0.1:9999",
    "  555 cloudflared tunnel --url http://127.0.0.1:8644",
  ].join("\n");

  it("returns only our own quick-tunnel PIDs for the port", () => {
    const pids = listOwnCloudflaredQuickTunnelPids(8644, {
      spawnSyncImpl: () => ({ status: 0, stdout: PS_OUTPUT }),
    });
    assert.deepEqual(pids, [111, 555]);
  });

  it("kills nothing when the process table cannot be enumerated", () => {
    assert.deepEqual(
      listOwnCloudflaredQuickTunnelPids(8644, {
        spawnSyncImpl: () => ({ error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) }),
      }),
      [],
    );
    assert.deepEqual(
      listOwnCloudflaredQuickTunnelPids(8644, {
        spawnSyncImpl: () => {
          throw new Error("ps missing");
        },
      }),
      [],
    );
  });
});

describe("killOwnStaleCloudflaredQuickTunnels — kill funnel", () => {
  it("signals exactly the owned PIDs and reports them", async () => {
    const signaled = [];
    let slept = 0;
    const killed = await killOwnStaleCloudflaredQuickTunnels(8644, {
      findPids: () => [111, 555],
      killPid: (pid) => {
        signaled.push(pid);
      },
      sleepImpl: async (ms) => {
        slept += ms;
      },
    });
    assert.deepEqual(killed, [111, 555]);
    assert.deepEqual(signaled, [111, 555]);
    assert.ok(slept > 0);
  });

  it("tolerates already-gone processes and sleeps only when something died", async () => {
    let slept = 0;
    const killed = await killOwnStaleCloudflaredQuickTunnels(8644, {
      findPids: () => [111, 222],
      killPid: (pid) => {
        if (pid === 222) throw new Error("ESRCH");
      },
      sleepImpl: async (ms) => {
        slept += ms;
      },
    });
    assert.deepEqual(killed, [111]);
    assert.ok(slept > 0);

    const none = await killOwnStaleCloudflaredQuickTunnels(8644, {
      findPids: () => [],
      killPid: () => {
        throw new Error("must not signal when nothing found");
      },
      sleepImpl: async () => {
        throw new Error("must not sleep when nothing killed");
      },
    });
    assert.deepEqual(none, []);
  });
});

describe("readLoggedQuickTunnelUrl — log URL truth", () => {
  it("returns the newest URL, or empty when the log is missing or URL-less", () => {
    const dir = mkdtempSync(join(tmpdir(), "jobbored-tunnel-log-"));
    try {
      const logPath = join(dir, "discovery-tunnel.log");
      assert.equal(readLoggedQuickTunnelUrl(join(dir, "missing.log")), "");
      writeFileSync(logPath, "starting up, no url yet\n", "utf8");
      assert.equal(readLoggedQuickTunnelUrl(logPath), "");
      writeFileSync(
        logPath,
        [
          "2024-02-13T10:30:00Z INF |  https://old-dead.trycloudflare.com  |",
          "2024-02-14T10:30:01Z INF |  https://new-live.trycloudflare.com  |",
        ].join("\n"),
        "utf8",
      );
      assert.equal(readLoggedQuickTunnelUrl(logPath), "https://new-live.trycloudflare.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ensureCloudflareQuickTunnel — reuse-or-kill", () => {
  it("reuses the logged URL when it still serves this worker (no spawn, no kill)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jobbored-tunnel-reuse-"));
    try {
      const logPath = join(dir, "discovery-tunnel.log");
      writeFileSync(
        logPath,
        "2024-02-14T10:30:01Z INF |  https://live-abc.trycloudflare.com  |\n",
        "utf8",
      );
      const seen = [];
      const result = await ensureCloudflareQuickTunnel(8644, {
        logPath,
        verifyIdentity: async (url) => {
          seen.push(url);
          return { ok: true, healthUrl: `${url}/health` };
        },
        findPids: () => {
          throw new Error("reuse must not enumerate processes");
        },
        killPid: () => {
          throw new Error("reuse must not kill anything");
        },
      });
      assert.deepEqual(result, {
        publicUrl: "https://live-abc.trycloudflare.com",
        startedTunnel: false,
      });
      assert.deepEqual(seen, ["https://live-abc.trycloudflare.com"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
