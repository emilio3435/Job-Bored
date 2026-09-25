// Repair (review P2, scripts/deploy-cloudflare-relay.mjs): the deploy verified
// the Worker BEFORE it uploaded RELAY_TOKEN. On a first deploy, and on
// --rotate-token, the live relay did not yet hold the token the verify step
// sent, so the review reproduced `verify:401 -> upload RELAY_TOKEN -> ok:true,
// verified:false` for both. Verification now runs only after the upload.
//
// The deploy script runs as a subprocess from a scratch copy of the repo
// layout. A fake `npx` records every wrangler call, and a preloaded module
// replaces fetch with a fake relay that accepts only the bearer most recently
// uploaded as RELAY_TOKEN. Nothing leaves the process: no network at all.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
if (process.env.WRANGLER_OUTPUT_FILE_PATH) {
  fs.writeFileSync(
    process.env.WRANGLER_OUTPUT_FILE_PATH,
    JSON.stringify({ type: "deploy", targets: [${JSON.stringify(WORKER_URL)}] }) + "\\n",
  );
}
if (args.includes("deployments")) process.stdout.write("{}");
process.exit(0);
`;

// The fake relay: 401 unless the bearer equals the last RELAY_TOKEN upload.
const FAKE_FETCH = `
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const log = process.env.FAKE_NPX_LOG;
globalThis.fetch = async (url, init = {}) => {
  const calls = existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const puts = calls.filter((c) => c.args && c.args.includes("RELAY_TOKEN"));
  const live = puts.length ? puts[puts.length - 1].input : "";
  const auth = String((init.headers && init.headers.Authorization) || "");
  const ok = !!live && auth === "Bearer " + live;
  appendFileSync(log, JSON.stringify({ verify: String(url), status: ok ? 202 : 401 }) + "\\n");
  return new Response(
    JSON.stringify(ok ? { ok: true, status: "accepted" } : { ok: false, error: "unauthorized" }),
    { status: ok ? 202 : 401, headers: { "Content-Type": "application/json" } },
  );
};
`;

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function scratchRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-deploy-verify-order-")));
  dirs.push(root);
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  mkdirSync(join(root, "templates", "cloudflare-worker"), { recursive: true });
  mkdirSync(join(root, "bin"));
  for (const rel of [
    ["scripts", "deploy-cloudflare-relay.mjs"],
    ["scripts", "lib", "spawn-npm.mjs"],
    ["templates", "cloudflare-worker", "worker.js"],
  ]) {
    copyFileSync(join(repoRoot, ...rel), join(root, ...rel));
  }
  writeFileSync(join(root, "bin", "npx"), FAKE_NPX, { mode: 0o755 });
  writeFileSync(join(root, "fake-fetch.mjs"), FAKE_FETCH);
  return root;
}

function runDeploy(root, extraArgs = []) {
  const log = join(root, "npx-calls.ndjson");
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  delete env.CLOUDFLARE_WORKERS_SUBDOMAIN;
  Object.assign(env, { PATH: `${join(root, "bin")}:${process.env.PATH}`, FAKE_NPX_LOG: log });
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      join(root, "fake-fetch.mjs"),
      join(root, "scripts", "deploy-cloudflare-relay.mjs"),
      "--account-id",
      "example-account",
      "--worker-name",
      "jobbored-relay",
      "--target-url",
      "https://upstream.example/webhook",
      "--sheet-id",
      "example-sheet-id",
      "--json",
      ...extraArgs,
    ],
    { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
  );
  const events = existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const putIndex = events.findIndex((e) => e.args && e.args.includes("RELAY_TOKEN"));
  const verifyIndex = events.findIndex((e) => e.verify);
  const jsonStart = result.stdout.lastIndexOf("\n{");
  let payload = null;
  try {
    payload = JSON.parse(result.stdout.slice(jsonStart + 1));
  } catch (_) {}
  return { ...result, events, putIndex, verifyIndex, payload };
}

function assertVerifiedAfterUpload(run) {
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.putIndex >= 0, "RELAY_TOKEN was uploaded");
  assert.ok(run.verifyIndex >= 0, "the deploy verified the Worker");
  assert.ok(
    run.verifyIndex > run.putIndex,
    `verify must run after the RELAY_TOKEN upload (events: ${JSON.stringify(run.events.map((e) => e.verify ? "verify:" + e.status : e.args.slice(0, 3).join(" ")))})`,
  );
  assert.equal(run.events[run.verifyIndex].status, 202);
  assert.ok(run.payload, `deploy printed a JSON payload:\n${run.stdout}`);
  assert.equal(run.payload.verified, true);
}

describe("deploy verifies the relay only after RELAY_TOKEN is live", () => {
  it("a first deploy verifies with the token it just uploaded", () => {
    assertVerifiedAfterUpload(runDeploy(scratchRepo()));
  });

  it("--rotate-token verifies with the new token, not before it is uploaded", () => {
    const root = scratchRepo();
    mkdirSync(join(root, ".jobbored-relay"), { mode: 0o700 });
    writeFileSync(
      join(root, ".jobbored-relay", "credential.json"),
      JSON.stringify(
        { workerName: "jobbored-relay", workerUrl: WORKER_URL, relayToken: OLD_TOKEN, relayLocked: true },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    const run = runDeploy(root, ["--rotate-token"]);
    assertVerifiedAfterUpload(run);
    const put = run.events[run.putIndex];
    assert.notEqual(put.input, OLD_TOKEN, "rotation minted a new token");
  });
});
