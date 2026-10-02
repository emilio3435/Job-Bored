/**
 * HOLES HOST S14: GET /api/applications/:slug/files/:filename served the
 * package's resume.html inline with no CSP and no nosniff, so a drafted
 * document opened in a tab ran in the API's origin. Every file now carries
 * nosniff; HTML also carries a sandboxing CSP that allows only its inline
 * styles and data: fonts and images (the renderer inlines both). PDFs keep
 * no sandbox: Chrome's viewer refuses to render a sandboxed PDF.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "server");

describe("HOLES HOST S14 — materials files carry nosniff and a sandboxing CSP", () => {
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  let root = "";
  let baseUrl = "";

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "holes-host-headers-"));
    const pkg = join(root, "applications", "acme-pm");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "resume.html"), "<!doctype html><style>body{margin:0}</style><h1>Resume</h1>");
    writeFileSync(join(pkg, "resume.pdf"), "%PDF-1.4\n%fixture\n");
    writeFileSync(join(pkg, "qa-report.md"), "# QA\n");
    const port = await new Promise((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const free = /** @type {import("node:net").AddressInfo} */ (probe.address()).port;
        probe.close(() => resolve(free));
      });
    });
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["index.mjs"], {
      cwd: SERVER_DIR,
      env: {
        PATH: process.env.PATH || "",
        HOME: join(root, "home"),
        USERPROFILE: join(root, "home"),
        PORT: String(port),
        LISTEN_HOST: "127.0.0.1",
        HERMES_APPLICATIONS_ROOT: join(root, "applications"),
      },
      stdio: ["ignore", "ignore", "ignore"],
    });
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${baseUrl}/health`).catch(() => null);
      if (res && res.ok) return;
      await sleep(100);
    }
    throw new Error("API did not start");
  });

  after(async () => {
    if (child && child.exitCode == null) {
      const exited = new Promise((r) => child?.once("exit", r));
      child.kill();
      await exited;
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  /** @param {string} name @param {string} [query] */
  async function getFile(name, query = "") {
    const res = await fetch(`${baseUrl}/api/applications/acme-pm/files/${name}${query}`);
    await res.arrayBuffer();
    return res;
  }

  it("serves resume.html with nosniff and a sandboxing CSP", async () => {
    const res = await getFile("resume.html");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const csp = res.headers.get("content-security-policy") || "";
    const directives = csp.split(";").map((d) => d.trim());
    assert.ok(directives.includes("sandbox"), `CSP must sandbox the document: ${csp}`);
    assert.ok(directives.includes("default-src 'none'"), `CSP must default to none: ${csp}`);
    assert.ok(directives.includes("style-src 'unsafe-inline'"), `inline styles stay allowed: ${csp}`);
    assert.ok(directives.includes("img-src data:"), `data: logos stay allowed: ${csp}`);
    assert.ok(directives.includes("font-src data:"), `data: fonts stay allowed: ${csp}`);
    assert.doesNotMatch(csp, /script-src|allow-scripts|allow-same-origin/, "no script may run");
  });

  it("keeps the headers on a forced download", async () => {
    const res = await getFile("resume.html", "?download=1");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy") || "", /(^|;\s*)sandbox(;|$)/);
  });

  it("serves the PDF with nosniff and no sandbox", async () => {
    const res = await getFile("resume.pdf");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("content-security-policy"), null);
  });

  it("serves Markdown with nosniff", async () => {
    const res = await getFile("qa-report.md");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });
});
