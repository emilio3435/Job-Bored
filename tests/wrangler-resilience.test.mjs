import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractWranglerJson } from "../scripts/deploy-cloudflare-relay.mjs";
import {
  runKeepAliveCheck,
  keepAlivePaths,
} from "../scripts/discovery-keep-alive.mjs";

// ── Deliverable 4: wrangler --json stdout is robust to the "agent skills" nag ──

test("extractWranglerJson recovers JSON when wrangler prefixes a notice on stdout", () => {
  const nag =
    "Cloudflare agent skills are available for: Claude Code, Cursor, Codex. Run wrangler in an interactive terminal to install them.\n" +
    JSON.stringify({ loggedIn: true, accounts: [{ id: "abc" }] });
  const parsed = extractWranglerJson(nag);
  assert.equal(parsed.loggedIn, true);
  assert.equal(parsed.accounts[0].id, "abc");
});

test("extractWranglerJson handles clean JSON and embedded/multi-line JSON", () => {
  assert.deepEqual(extractWranglerJson('{"a":1}'), { a: 1 });
  // JSON spread across lines, last line is the closing brace.
  const multiline = "noise\n{\n  \"x\": 2\n}";
  assert.deepEqual(extractWranglerJson(multiline), { x: 2 });
});

test("extractWranglerJson returns null when there is no JSON", () => {
  assert.equal(extractWranglerJson("just a notice, no json"), null);
  assert.equal(extractWranglerJson(""), null);
});

// ── Deliverable 5: keep-alive falls back to `npx wrangler` on ENOENT ──

function discoveryWorkerHealthResponse() {
  return new Response(
    JSON.stringify({ status: "ok", service: "browser-use-discovery-worker" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("runKeepAliveCheck falls back to `npx wrangler` when bare wrangler is ENOENT", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "jobbored-wrangler-fallback-home-"));
  const workDir = mkdtempSync(join(tmpdir(), "jobbored-wrangler-fallback-repo-"));
  try {
    const bootstrapStatePath = join(workDir, "discovery-local-bootstrap.json");
    writeFileSync(
      bootstrapStatePath,
      JSON.stringify({
        localPort: 8644,
        localWebhookUrl: "http://127.0.0.1:8644/webhook",
        workerName: "jobbored-discovery-relay-local",
      }),
      "utf8",
    );

    const calls = [];
    const spawnSyncImpl = (command, args, options) => {
      calls.push({ command, args, options });
      if (command === "wrangler") {
        const err = new Error("spawn wrangler ENOENT");
        err.code = "ENOENT";
        return { error: err };
      }
      // npx --yes wrangler ... succeeds
      return { status: 0, stdout: "", stderr: "" };
    };

    const fetchImpl = async (url) => {
      if (String(url) === "http://127.0.0.1:4040/api/tunnels") {
        return new Response(
          JSON.stringify({
            tunnels: [
              {
                public_url: "https://abc.ngrok-free.app",
                config: { addr: "http://127.0.0.1:8644" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url) === "https://abc.ngrok-free.app/health") {
        return discoveryWorkerHealthResponse();
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await runKeepAliveCheck({
      homeDir,
      bootstrapStatePath,
      fetchImpl,
      spawnSyncImpl,
      nowIso: "2026-05-30T12:10:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(result.redeployed, true);
    // Bare wrangler attempted first (ENOENT), then npx --yes wrangler.
    assert.equal(calls[0].command, "wrangler");
    assert.equal(calls[1].command, "npx");
    assert.deepEqual(calls[1].args, [
      "--yes",
      "wrangler",
      "secret",
      "put",
      "TARGET_URL",
      "--name",
      "jobbored-discovery-relay-local",
    ]);
    assert.equal(
      calls[1].options.input,
      "https://abc.ngrok-free.app/webhook\n",
    );

    // State recorded so subsequent runs are no-ops.
    const state = JSON.parse(
      readFileSync(keepAlivePaths({ homeDir }).statePath, "utf8"),
    );
    assert.equal(state.lastNgrokUrl, "https://abc.ngrok-free.app");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});
