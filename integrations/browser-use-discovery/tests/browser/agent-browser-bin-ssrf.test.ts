// BEAUDIT C2: the bundled agent-browser command forwarded any URL, including
// cloud metadata, to `agent-browser open`. Promotes C-ssrf-browser-command.sh:
// a fake agent-browser records its argv so the test sees whether it ran.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, "../../bin/browser-use-agent-browser.mjs");

async function makeFakeAgentBrowser(dir: string, openUrl: string | null) {
  const argvLog = join(dir, "argv.log");
  const fake = join(dir, "fake-agent-browser");
  await writeFile(
    fake,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
      "const args = process.argv.slice(2);",
      "const op = args[3];",
      `const openUrl = ${JSON.stringify(openUrl)};`,
      "if (op === 'open') console.log(JSON.stringify({ success: true, data: { url: openUrl || args[4], title: 'Fake' } }));",
      "else if (op === 'get') console.log(JSON.stringify({ success: true, data: { html: '<p>PROBE-PAGE-BODY</p>' } }));",
      "else console.log(JSON.stringify({ success: true, data: {} }));",
    ].join("\n"),
    "utf8",
  );
  await chmod(fake, 0o755);
  return { fake, argvLog };
}

async function runBin(dir: string, fake: string, url: string) {
  const child = spawn(process.execPath, [BIN], {
    env: {
      ...process.env,
      HOME: dir,
      AGENT_BROWSER_PATH: fake,
      BROWSER_USE_DISCOVERY_AGENT_BROWSER_PATH: "",
      BROWSER_USE_DISCOVERY_AGENT_BROWSER_SOCKET_DIR: join(dir, "sock"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  child.stdin.end(JSON.stringify({ url, instruction: "x", timeoutMs: 3000 }) + "\n");
  const code = await new Promise<number | null>((done) => child.once("close", done));
  return { code, stdout, stderr };
}

async function readArgv(argvLog: string): Promise<string[][]> {
  try {
    return (await readFile(argvLog, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

test("agent-browser command refuses a metadata URL before spawning agent-browser", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jb-agent-browser-ssrf-"));
  try {
    const { fake, argvLog } = await makeFakeAgentBrowser(dir, null);
    const result = await runBin(dir, fake, "http://169.254.169.254/latest/meta-data/");
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /private-network/);
    assert.deepEqual(await readArgv(argvLog), [], "agent-browser must never run");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent-browser command opens a public URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jb-agent-browser-ssrf-"));
  try {
    const { fake, argvLog } = await makeFakeAgentBrowser(dir, null);
    const result = await runBin(dir, fake, "http://192.0.2.10/jobs");
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /PROBE-PAGE-BODY/);
    const argv = await readArgv(argvLog);
    assert.deepEqual(argv[0].slice(3), ["open", "http://192.0.2.10/jobs"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent-browser command withholds the page when the browser lands on a private URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jb-agent-browser-ssrf-"));
  try {
    const { fake, argvLog } = await makeFakeAgentBrowser(dir, "http://127.0.0.1:8644/health");
    const result = await runBin(dir, fake, "http://192.0.2.10/jobs");
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stdout, /PROBE-PAGE-BODY/);
    assert.match(result.stderr, /private-network/);
    const ops = (await readArgv(argvLog)).map((argv) => argv[3]);
    assert.ok(!ops.includes("get"), `no content read after a private landing: ${ops}`);
    assert.ok(ops.includes("close"), "the session is still closed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent-browser target check resolves DNS before open (rebinding name)", async () => {
  const mod = await import(pathToFileURL(BIN).href);
  assert.equal(typeof mod.assertSafeBrowserTarget, "function");
  await assert.rejects(
    () =>
      mod.assertSafeBrowserTarget("http://127.0.0.1.nip.io/jobs", {
        lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    /private-network/,
  );
  await mod.assertSafeBrowserTarget("https://jobs.example.com/", {
    lookupImpl: async () => [{ address: "192.0.2.1", family: 4 }],
  });
});

test("agent-browser command opens a public IPv6 literal without a DNS lookup", async () => {
  const mod = await import(pathToFileURL(BIN).href);
  const noDns = async () => {
    throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
  };
  assert.equal(
    await mod.assertSafeBrowserTarget("https://[2606:4700:4700::1111]/jobs", { lookupImpl: noDns }),
    "https://[2606:4700:4700::1111]/jobs",
  );
  const dir = await mkdtemp(join(tmpdir(), "jb-agent-browser-ssrf-"));
  try {
    const { fake, argvLog } = await makeFakeAgentBrowser(dir, null);
    const result = await runBin(dir, fake, "https://[2606:4700:4700::1111]/jobs");
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /PROBE-PAGE-BODY/);
    const argv = await readArgv(argvLog);
    assert.deepEqual(argv[0].slice(3), ["open", "https://[2606:4700:4700::1111]/jobs"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const url of [
  "http://[::1]/jobs",
  "http://[fc00::1]/jobs",
  "http://[fe80::1]/jobs",
  "http://[::ffff:127.0.0.1]/jobs",
]) {
  test(`agent-browser command still refuses private IPv6 literal ${url}`, async () => {
    const mod = await import(pathToFileURL(BIN).href);
    await assert.rejects(
      () =>
        mod.assertSafeBrowserTarget(url, {
          lookupImpl: async () => [{ address: "8.8.8.8", family: 4 }],
        }),
      (error: { code?: string; message?: string }) =>
        error.code === "SSRF_BLOCKED" && /private-network/.test(String(error.message)),
    );
  });
}
