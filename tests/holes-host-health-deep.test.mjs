/**
 * HOLES HOST: GET /health?deep=1 is the readiness half of /health. It proves
 * the assets the materials modules read at request time are on disk (the
 * schemas, the template families and the vendored fonts; S2 shipped an
 * image without them) and reports the optional PDF browser and logo
 * resolver. A hosted listener asks for the token, shallow /health stays
 * public, and no detail names a server path.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { checkPlaywright } from "../server/health-deep.mjs";
import { probePdfBrowser } from "../server/materials-pdf.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = join(REPO_ROOT, "server");
const TOKEN = "health-deep-test-token";

async function freePort() {
  return new Promise((resolvePort) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = /** @type {import("node:net").AddressInfo} */ (probe.address()).port;
      probe.close(() => resolvePort(port));
    });
  });
}

/**
 * @param {string} cwd the server dir to boot
 * @param {string} scratch a temp root for HOME and state
 */
async function bootHosted(cwd, scratch) {
  const port = await freePort();
  const child = spawn(process.execPath, ["index.mjs"], {
    cwd,
    env: {
      PATH: process.env.PATH || "",
      HOME: join(scratch, "home"),
      USERPROFILE: join(scratch, "home"),
      PORT: String(port),
      LISTEN_HOST: "0.0.0.0",
      JOBBORED_API_TOKEN: TOKEN,
      COMMAND_CENTER_ALLOWED_ORIGINS: "https://dashboard.example",
      HERMES_APPLICATIONS_ROOT: join(scratch, "applications"),
      JOBBORED_LOGOS_DIR: join(scratch, "logos"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  // 30 s boot window: an 8 s window timed out under parallel-suite load.
  for (let i = 0; i < 300; i += 1) {
    if (child.exitCode != null) break;
    const res = await fetch(`${baseUrl}/health`).catch(() => null);
    if (res && res.ok) return { child, baseUrl };
    await sleep(100);
  }
  child.kill("SIGKILL");
  throw new Error(`API did not start: ${stderr.slice(-800)}`);
}

/** @param {import("node:child_process").ChildProcess | null | undefined} child */
async function stop(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill();
  const forced = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(forced);
}

/** @param {string} baseUrl @param {boolean} withToken */
async function getDeep(baseUrl, withToken) {
  const res = await fetch(`${baseUrl}/health?deep=1`, {
    headers: withToken ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}

describe("HOLES HOST /health?deep=1 — repo layout", () => {
  let scratch = "";
  /** @type {{ child: import("node:child_process").ChildProcess, baseUrl: string } | null} */
  let api = null;

  before(async () => {
    scratch = mkdtempSync(join(tmpdir(), "holes-host-deep-"));
    api = await bootHosted(SERVER_DIR, scratch);
  });

  after(async () => {
    await stop(api?.child);
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("keeps shallow /health public and free of checks", async () => {
    const res = await fetch(`${api?.baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.checks, undefined);
  });

  it("asks a hosted caller for the token", async () => {
    const { res } = await getDeep(String(api?.baseUrl), false);
    assert.equal(res.status, 401);
  });

  it("reports every check and is ready when the assets are present", async () => {
    const { res, body, text } = await getDeep(String(api?.baseUrl), true);
    assert.equal(res.status, 200, text);
    assert.equal(body.ok, true);
    assert.equal(body.checks.schemas.ok, true, text);
    assert.ok(body.checks.schemas.count >= 8, text);
    assert.equal(body.checks.templates.ok, true, text);
    assert.ok(body.checks.templates.families.includes("signal"), text);
    assert.equal(body.checks.fonts.ok, true, text);
    assert.ok(body.checks.fonts.faces > 0, text);
    for (const optional of ["playwright", "logoResolver"]) {
      assert.equal(typeof body.checks[optional].ok, "boolean", `${optional}: ${text}`);
    }
    assert.ok(!text.includes(REPO_ROOT), "no detail names the checkout path");
  });
});

describe("HOLES HOST /health?deep=1 — server-only copy (the old image)", () => {
  let scratch = "";
  /** @type {{ child: import("node:child_process").ChildProcess, baseUrl: string } | null} */
  let api = null;

  before(async () => {
    scratch = mkdtempSync(join(tmpdir(), "holes-host-deep-copy-"));
    const copy = join(scratch, "app", "server");
    mkdirSync(copy, { recursive: true });
    cpSync(SERVER_DIR, copy, {
      recursive: true,
      filter: (src) => !src.endsWith("node_modules") && !src.includes(".image-assets"),
    });
    assert.equal(existsSync(join(SERVER_DIR, "node_modules", "express", "package.json")), true);
    symlinkSync(join(SERVER_DIR, "node_modules"), join(copy, "node_modules"), "dir");
    api = await bootHosted(copy, scratch);
  });

  after(async () => {
    await stop(api?.child);
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("answers 503 and names each missing asset without a path", async () => {
    const { res, body, text } = await getDeep(String(api?.baseUrl), true);
    assert.equal(res.status, 503, text);
    assert.equal(body.ok, false);
    assert.equal(body.retryable, false);
    assert.equal(body.checks.schemas.ok, false);
    assert.equal(body.checks.templates.ok, false);
    assert.equal(body.checks.fonts.ok, false);
    assert.equal(body.checks.logoResolver.ok, false);
    for (const name of ["schemas", "templates", "fonts"]) {
      assert.equal(typeof body.checks[name].detail, "string", `${name}: ${text}`);
    }
    assert.ok(!text.includes(scratch), `no detail names a server path: ${text}`);
    assert.ok(!text.includes(REPO_ROOT), `no detail names the checkout path: ${text}`);
  });
});

describe("HOLES HOST /health?deep=1 — the PDF browser probe", () => {
  /** @param {(options: unknown) => Promise<unknown>} launch */
  const importer = (launch) => async () => ({ chromium: { launch } });

  it("reports a missing playwright package", async () => {
    const result = await probePdfBrowser({
      playwrightImport: async () => {
        throw new Error("Cannot find package 'playwright-core'");
      },
    });
    assert.deepEqual(result, { ok: false, detail: "playwright is not installed" });
  });

  it("reports a browser that fails to launch, without its message", async () => {
    const result = await probePdfBrowser({
      playwrightImport: importer(async () => {
        throw new Error("Executable doesn't exist at /opt/secret/chrome");
      }),
    });
    assert.deepEqual(result, { ok: false, detail: "the browser did not launch" });
  });

  it("closes the browser before it answers", async () => {
    const events = [];
    const result = await probePdfBrowser({
      playwrightImport: importer(async () => ({
        close: async () => {
          events.push("closed");
        },
      })),
    });
    events.push("answered");
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(events, ["closed", "answered"]);
  });

  it("closes a browser that comes up after the timeout", async () => {
    let closed = false;
    const result = await probePdfBrowser({
      timeoutMs: 20,
      playwrightImport: importer(async () => {
        await sleep(80);
        return {
          close: async () => {
            closed = true;
          },
        };
      }),
    });
    assert.deepEqual(result, { ok: false, detail: "the browser did not launch" });
    await sleep(150);
    assert.equal(closed, true);
  });

  it("shares one verdict for five minutes", async () => {
    let probes = 0;
    const probe = async () => {
      probes += 1;
      return { ok: true };
    };
    const start = 1e12;
    const env = { JOBBORED_CHROMIUM_PATH: "/usr/bin/chromium-browser" };
    const [a, b] = await Promise.all([
      checkPlaywright({ probe, env, now: () => start }),
      checkPlaywright({ probe, env, now: () => start + 1_000 }),
    ]);
    assert.deepEqual(a, { ok: true, browser: "system" });
    assert.equal(a, b);
    assert.equal(probes, 1);
    await checkPlaywright({ probe, env, now: () => start + 5 * 60_000 + 1 });
    assert.equal(probes, 2);
  });
});
