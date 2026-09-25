// G24 repair (review P2): the relay credential is saved before RELAY_TOKEN goes
// live, and a save failure is fatal. Before this, the deploy uploaded the
// RELAY_TOKEN secret first and only console.warn'ed when writing
// .jobbored-relay/credential.json failed, then printed "ok": true. A first
// deploy or a --rotate-token run therefore locked the relay with a token the
// dashboard never received (review probe: tokenUploaded=true,
// credentialPersisted=false, reportedOk=true, relayLocked=true).
//
// The deploy script runs as a subprocess from a scratch copy of the repo
// layout, with a fake `npx` first on PATH that records every wrangler call.
// Nothing leaves 127.0.0.1: no Cloudflare API token is set and wrangler is
// never really invoked.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_URL = "https://jobbored-relay.example.workers.dev/";
const OLD_TOKEN = "old-token-abcdefghijklmnopqrstuvwxyz0123456789";

const FAKE_NPX = `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
const log = process.env.FAKE_NPX_LOG;
let input = "";
if (args.includes("secret")) {
  try { input = fs.readFileSync(0, "utf8"); } catch (_) {}
}
fs.appendFileSync(log, JSON.stringify({ args, input: input.trim() }) + "\\n");
if (args.includes("RELAY_TOKEN") && process.env.FAKE_NPX_FAIL_RELAY_TOKEN === "1") {
  process.exit(1);
}
if (process.env.WRANGLER_OUTPUT_FILE_PATH) {
  fs.writeFileSync(
    process.env.WRANGLER_OUTPUT_FILE_PATH,
    JSON.stringify({ type: "deploy", targets: [${JSON.stringify(WORKER_URL)}] }) + "\\n",
  );
}
if (args.includes("deployments")) process.stdout.write("{}");
process.exit(0);
`;

const dirs = [];
afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    try {
      chmodSync(join(dir, ".jobbored-relay"), 0o700);
    } catch (_) {}
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratchRepo() {
  // realpath: the script only runs its CLI entry when argv[1] equals its own
  // resolved path, and macOS tmpdir() sits behind the /var -> /private/var link.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-deploy-fatal-")));
  dirs.push(root);
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  mkdirSync(join(root, "templates", "cloudflare-worker"), { recursive: true });
  mkdirSync(join(root, "bin"));
  copyFileSync(
    join(repoRoot, "scripts", "deploy-cloudflare-relay.mjs"),
    join(root, "scripts", "deploy-cloudflare-relay.mjs"),
  );
  copyFileSync(
    join(repoRoot, "scripts", "lib", "spawn-npm.mjs"),
    join(root, "scripts", "lib", "spawn-npm.mjs"),
  );
  copyFileSync(
    join(repoRoot, "templates", "cloudflare-worker", "worker.js"),
    join(root, "templates", "cloudflare-worker", "worker.js"),
  );
  writeFileSync(join(root, "bin", "npx"), FAKE_NPX, { mode: 0o755 });
  return root;
}

function runDeploy(root, { extraArgs = [], failRelayToken = false } = {}) {
  const log = join(root, "npx-calls.ndjson");
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  delete env.CLOUDFLARE_WORKERS_SUBDOMAIN;
  Object.assign(env, {
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
    FAKE_NPX_LOG: log,
    FAKE_NPX_FAIL_RELAY_TOKEN: failRelayToken ? "1" : "0",
  });
  const result = spawnSync(
    process.execPath,
    [
      join(root, "scripts", "deploy-cloudflare-relay.mjs"),
      "--account-id",
      "example-account",
      "--worker-name",
      "jobbored-relay",
      "--target-url",
      "https://upstream.example/webhook",
      "--no-verify",
      "--json",
      ...extraArgs,
    ],
    { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
  );
  const calls = existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  const relayTokenPut = calls.find(
    (c) => c.args.includes("secret") && c.args.includes("RELAY_TOKEN"),
  );
  return { ...result, calls, relayTokenPut };
}

function readCredential(root) {
  return JSON.parse(readFileSync(join(root, ".jobbored-relay", "credential.json"), "utf8"));
}

describe("deploy saves the relay credential before RELAY_TOKEN goes live", () => {
  it("a successful deploy stores exactly the token it uploaded, with the Worker URL", () => {
    const root = scratchRepo();
    const run = runDeploy(root);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.relayTokenPut, "RELAY_TOKEN was uploaded");
    const cred = readCredential(root);
    assert.equal(cred.relayToken, run.relayTokenPut.input);
    assert.equal(cred.workerUrl, WORKER_URL);
    assert.match(run.stdout, /"ok": true/);
  });

  it("an unwritable credential is fatal and RELAY_TOKEN is never uploaded", () => {
    const root = scratchRepo();
    // A read-only credential directory: mkdir succeeds, the write gets EACCES.
    mkdirSync(join(root, ".jobbored-relay"), { mode: 0o500 });
    chmodSync(join(root, ".jobbored-relay"), 0o500);
    const run = runDeploy(root);
    assert.notEqual(run.status, 0, "deploy must fail when the credential cannot be saved");
    assert.equal(run.relayTokenPut, undefined, "RELAY_TOKEN must not go live without a saved credential");
    assert.doesNotMatch(run.stdout, /"ok": true/);
    assert.match(run.stderr, /could not save the relay token/i);
  });

  it("a failed RELAY_TOKEN upload during rotation restores the previous credential", () => {
    const root = scratchRepo();
    mkdirSync(join(root, ".jobbored-relay"), { mode: 0o700 });
    const previous = {
      workerName: "jobbored-relay",
      workerUrl: WORKER_URL,
      relayToken: OLD_TOKEN,
      relayLocked: true,
    };
    writeFileSync(
      join(root, ".jobbored-relay", "credential.json"),
      JSON.stringify(previous, null, 2) + "\n",
      { mode: 0o600 },
    );
    const run = runDeploy(root, { extraArgs: ["--rotate-token"], failRelayToken: true });
    assert.notEqual(run.status, 0);
    assert.ok(run.relayTokenPut, "the rotation attempted an upload");
    assert.notEqual(run.relayTokenPut.input, OLD_TOKEN, "rotation minted a new token");
    assert.equal(readCredential(root).relayToken, OLD_TOKEN, "the live relay still holds the old token");
  });
});
