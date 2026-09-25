// G24 repair (review P1): the relay bearer must survive a bootstrap refresh.
// scripts/bootstrap-local-discovery.mjs rewrites discovery-local-bootstrap.json
// without the `relay` block, and Fix setup skips the relay redeploy when the
// tunnel is unchanged. If the token lived only in that block, the dashboard's
// token route would flip from ok:true to relay_not_deployed and an uncached
// browser would get 401 from the locked relay. The deploy script therefore
// keeps the credential in its own file that the bootstrap writer never touches.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { handleDiscoveryRelayToken } from "../dev-server.mjs";
import { isDeniedRelativePath } from "../scripts/lib/static-path-guard.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts", "deploy-cloudflare-relay.mjs");
const source = readFileSync(scriptPath, "utf8");

const TOKEN = "durable-token-abcdefghijklmnopqrstuvwxyz0123";
const RELAY = {
  workerName: "jobbored-relay",
  workerUrl: "https://jobbored-relay.example.workers.dev/",
  targetUrl: "https://tunnel.example/webhook",
  relayToken: TOKEN,
  relayLocked: true,
};
// What bootstrap-local-discovery.mjs writes on a refresh: no relay block.
const REFRESHED_BOOTSTRAP = {
  localPort: 8644,
  webhookSecret: "not-for-this-route",
  localWebhookUrl: "http://127.0.0.1:8644/webhook",
};

const dirs = [];
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "relay-cred-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("relay credential survives a bootstrap refresh", () => {
  it("round-trips through its own file", async () => {
    const mod = await import(scriptPath);
    const root = tempRoot();
    mod.writeRelayCredential(RELAY, root);
    const cred = mod.readRelayCredential(root);
    assert.equal(cred.relayToken, TOKEN);
    assert.equal(cred.workerUrl, RELAY.workerUrl);
    assert.equal(cred.workerName, RELAY.workerName);
  });

  it("token route still answers ok:true after the bootstrap drops the relay block", async () => {
    const mod = await import(scriptPath);
    const root = tempRoot();
    mod.writeRelayCredential(RELAY, root);
    writeFileSync(join(root, "discovery-local-bootstrap.json"), JSON.stringify(REFRESHED_BOOTSTRAP));
    const res = mod.buildDashboardRelayTokenResponse(
      REFRESHED_BOOTSTRAP,
      mod.readRelayCredential(root),
    );
    assert.deepEqual(res, {
      ok: true,
      relay: { workerUrl: RELAY.workerUrl, relayToken: TOKEN, relayLocked: true },
    });
  });

  it("a redeploy after a bootstrap refresh keeps the same token", async () => {
    const mod = await import(scriptPath);
    const root = tempRoot();
    mod.writeRelayCredential(RELAY, root);
    assert.equal(
      mod.resolveRelayToken({
        existingBootstrap: REFRESHED_BOOTSTRAP,
        existingCredential: mod.readRelayCredential(root),
        workerName: "jobbored-relay",
      }),
      TOKEN,
    );
  });

  it("the dev-server route reads the credential file, not just the bootstrap", () => {
    const res = {
      status: 0,
      body: "",
      writeHead(s) {
        res.status = s;
      },
      end(c) {
        res.body = c ? String(c) : "";
      },
    };
    handleDiscoveryRelayToken(
      {
        method: "GET",
        headers: { origin: "http://127.0.0.1:19011", host: "127.0.0.1:19011" },
        socket: { remoteAddress: "127.0.0.1", localPort: 19011, encrypted: false },
      },
      res,
      { readBootstrap: () => REFRESHED_BOOTSTRAP, readCredential: () => RELAY },
    );
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.relay.relayToken, TOKEN);
    assert.ok(!res.body.includes("not-for-this-route"));
  });

  it("the credential file is owner-only, git-ignored, and never served statically", async () => {
    const mod = await import(scriptPath);
    const root = tempRoot();
    mod.writeRelayCredential(RELAY, root);
    const file = mod.relayCredentialPath(root);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(
      readFileSync(join(dirname(file), ".gitignore"), "utf8").trim(),
      "*",
    );
    assert.equal(isDeniedRelativePath(relative(root, file)), true);
  });

  it("the deploy persists the credential file before the bootstrap block", () => {
    const start = source.indexOf("[discovery-autodetect lane: persist relay info");
    const block = source.slice(start, source.indexOf("[/discovery-autodetect lane]", start));
    const credAt = block.indexOf("writeRelayCredential(");
    assert.ok(credAt !== -1, "persist block must write the credential file");
    assert.ok(credAt < block.indexOf("writeFileSync(bootstrapPath"));
  });
});
