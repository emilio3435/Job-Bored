// BEAUDIT R repair (review P1): the relay bearer lives only in the owner-only
// credential file (.jobbored-relay/credential.json, mode 0600). The deploy
// helper also merges the relay's public details into
// discovery-local-bootstrap.json, which it writes with the process umask (0644
// under umask 022) and which keeps whatever loose mode it already had. A token
// copied there is readable by other local users, so the bootstrap relay block
// must carry no relayToken, including one left behind by an earlier deploy.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts", "deploy-cloudflare-relay.mjs");

const TOKEN = "bootstrap-leak-token-abcdefghijklmnopqrstuv0123";
const RELAY = {
  workerName: "jobbored-relay",
  workerUrl: "https://jobbored-relay.example.workers.dev/",
  targetUrl: "https://tunnel.example/webhook",
  corsOrigin: "*",
  relayToken: TOKEN,
  relayLocked: true,
  deployedAt: "2026-09-25T00:00:00.000Z",
};

const dirs = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "relay-boot-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("the bootstrap relay block never holds the relay bearer", () => {
  it("writes the Worker URL and lock flag but not the token", async () => {
    const mod = await import(scriptPath);
    const root = tempRoot();
    const path = mod.writeRelayBootstrap(RELAY, root);
    const raw = readFileSync(path, "utf8");
    assert.ok(!raw.includes(TOKEN), "bootstrap file must not contain the relay token");
    const body = JSON.parse(raw);
    assert.equal(body.relay.workerUrl, RELAY.workerUrl);
    assert.equal(body.relay.relayLocked, true);
    assert.equal(Object.hasOwn(body.relay, "relayToken"), false);
  });

  it("strips a token an earlier deploy left in the bootstrap and keeps other fields", async () => {
    const mod = await import(scriptPath);
    const root = tempRoot();
    const path = join(root, "discovery-local-bootstrap.json");
    writeFileSync(
      path,
      JSON.stringify({
        localPort: 8644,
        relay: { workerName: "jobbored-relay", relayToken: "old-" + TOKEN },
      }),
    );
    mod.writeRelayBootstrap(RELAY, root);
    const raw = readFileSync(path, "utf8");
    assert.ok(!raw.includes(TOKEN));
    assert.equal(JSON.parse(raw).localPort, 8644);
  });

  it("the token stays reachable through the credential file", async () => {
    const mod = await import(scriptPath);
    const root = tempRoot();
    mod.writeRelayCredential(RELAY, root);
    const bootstrapPath = mod.writeRelayBootstrap(RELAY, root);
    const res = mod.buildDashboardRelayTokenResponse(
      JSON.parse(readFileSync(bootstrapPath, "utf8")),
      mod.readRelayCredential(root),
    );
    assert.equal(res.ok, true);
    assert.equal(res.relay.relayToken, TOKEN);
  });
});
