// G24: `npm run test:discovery-webhook` must work against a locked Cloudflare
// relay. scripts/verify-discovery-webhook.mjs sends RELAY_TOKEN (or
// --relay-token) as `Authorization: Bearer`, and sends no Authorization
// header when no token is set.
//
// The CLI accepts only https URLs, so each run preloads a fetch stub that
// records the request and answers 202; nothing leaves the process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "verify-discovery-webhook.mjs");
const RELAY = "https://jobbored-relay.example.workers.dev";

const STUB = `
import { appendFileSync } from "node:fs";
const out = process.env.VERIFY_STUB_OUT;
globalThis.fetch = async (url, init = {}) => {
  const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
  appendFileSync(out, JSON.stringify({ url: String(url), method: init.method, headers }) + "\\n");
  return new Response(JSON.stringify({ ok: true, kind: "accepted_async", runId: "run_1", statusPath: "/runs/run_1" }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
};
`;

function runVerify({ args = [], env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "relay-verify-"));
  try {
    const stubPath = join(dir, "fetch-stub.mjs");
    const outPath = join(dir, "requests.jsonl");
    writeFileSync(stubPath, STUB);
    writeFileSync(outPath, "");
    const cleanEnv = { ...process.env };
    for (const key of [
      "RELAY_TOKEN",
      "DISCOVERY_WEBHOOK_SECRET",
      "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET",
      "DISCOVERY_WEBHOOK_URL",
    ]) {
      delete cleanEnv[key];
    }
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(stubPath).href,
        SCRIPT,
        "--url",
        `${RELAY}/webhook`,
        "--sheet-id",
        "sheet_example",
        "--retries",
        "0",
        "--json",
        ...args,
      ],
      {
        cwd: ROOT,
        env: { ...cleanEnv, HOME: dir, VERIFY_STUB_OUT: outPath, ...env },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    const requests = readFileSync(outPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, requests };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("RELAY_TOKEN from the env is sent as a bearer", () => {
  const { status, requests, stderr } = runVerify({
    env: { RELAY_TOKEN: "tok_relay_example" },
  });
  assert.equal(status, 0, stderr);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.authorization, "Bearer tok_relay_example");
});

test("--relay-token is sent as a bearer and wins over the env", () => {
  const { status, requests, stderr } = runVerify({
    args: ["--relay-token", "tok_flag_example"],
    env: { RELAY_TOKEN: "tok_env_example" },
  });
  assert.equal(status, 0, stderr);
  assert.equal(requests[0].headers.authorization, "Bearer tok_flag_example");
});

test("no relay token means no Authorization header", () => {
  const { status, requests, stderr } = runVerify();
  assert.equal(status, 0, stderr);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.authorization, undefined);
});

test("the usage text documents RELAY_TOKEN", () => {
  const src = readFileSync(SCRIPT, "utf8");
  assert.match(src, /--relay-token/);
  assert.match(src, /RELAY_TOKEN/);
});
