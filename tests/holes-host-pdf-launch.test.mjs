/**
 * HOLES HOST S9: hosted PDF rendering.
 *
 * The server image has no repo-root node_modules, so `import("playwright")`
 * failed there and every PDF render and fit measurement skipped. The loader
 * now falls back to the server's own playwright-core, and both launch sites
 * honor JOBBORED_CHROMIUM_PATH so the image can drive its system Chromium
 * (Alpine has no Playwright browser build).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { importPlaywright, openPdfSession, renderPdfIfPossible } from "../server/materials-pdf.mjs";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..", "server");

describe("HOLES HOST S9 — playwright-core is a server dependency", () => {
  it("declares playwright-core so `npm ci --omit=dev` installs it in the image", () => {
    const pkg = JSON.parse(readFileSync(join(serverDir, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(serverDir, "package-lock.json"), "utf8"));
    assert.match(String(pkg.dependencies["playwright-core"] || ""), /^\^?1\.\d+\.\d+$/);
    const locked = lock.packages["node_modules/playwright-core"];
    assert.ok(locked, "server/package-lock.json must lock playwright-core");
    assert.notEqual(locked.dev, true, "playwright-core must be a production dependency");
  });
});

/** A Playwright stand-in that records every launch call. */
function fakePlaywright() {
  /** @type {unknown[]} */
  const launches = [];
  const page = {
    setContent: async () => {},
    pdf: async () => {},
    close: async () => {},
  };
  const chromium = {
    launch: async (/** @type {unknown} */ options) => {
      launches.push(options);
      return { newPage: async () => page, close: async () => {} };
    },
  };
  return { launches, importer: async () => ({ chromium }) };
}

describe("HOLES HOST S9 — Playwright loading", () => {
  it("falls back to playwright-core when the playwright package is absent", async () => {
    const asked = [];
    const core = { chromium: { launch: async () => ({}) } };
    const loaded = await importPlaywright(async (name) => {
      asked.push(name);
      if (name === "playwright") throw Object.assign(new Error("Cannot find package 'playwright'"), { code: "ERR_MODULE_NOT_FOUND" });
      return core;
    });
    assert.equal(loaded, core);
    assert.deepEqual(asked, ["playwright", "playwright-core"]);
  });

  it("prefers the full playwright package when it resolves (local dev keeps its browsers)", async () => {
    const full = { chromium: { launch: async () => ({}) } };
    const asked = [];
    const loaded = await importPlaywright(async (name) => {
      asked.push(name);
      return full;
    });
    assert.equal(loaded, full);
    assert.deepEqual(asked, ["playwright"]);
  });
});

describe("HOLES HOST S9 — JOBBORED_CHROMIUM_PATH", () => {
  /** @type {string | undefined} */
  let previous;
  let scratch = "";
  beforeEach(() => {
    previous = process.env.JOBBORED_CHROMIUM_PATH;
    scratch = mkdtempSync(join(tmpdir(), "holes-host-pdf-"));
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.JOBBORED_CHROMIUM_PATH;
    else process.env.JOBBORED_CHROMIUM_PATH = previous;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("openPdfSession launches the configured system Chromium", async () => {
    process.env.JOBBORED_CHROMIUM_PATH = "/usr/bin/chromium";
    const fake = fakePlaywright();
    const session = await openPdfSession({ playwrightImport: fake.importer });
    assert.ok(session, "a session opens");
    await session.close();
    assert.deepEqual(fake.launches, [{ headless: true, executablePath: "/usr/bin/chromium" }]);
  });

  it("renderPdfIfPossible launches the configured system Chromium", async () => {
    process.env.JOBBORED_CHROMIUM_PATH = "/usr/bin/chromium";
    const fake = fakePlaywright();
    const result = await renderPdfIfPossible("<p>hi</p>", join(scratch, "out.pdf"), { playwrightImport: fake.importer });
    assert.equal(result.skipped, false);
    assert.deepEqual(fake.launches, [{ headless: true, executablePath: "/usr/bin/chromium" }]);
  });

  it("launches Playwright's own browser when no path is configured", async () => {
    delete process.env.JOBBORED_CHROMIUM_PATH;
    const fake = fakePlaywright();
    const session = await openPdfSession({ playwrightImport: fake.importer });
    assert.ok(session);
    await session.close();
    assert.deepEqual(fake.launches, [{ headless: true }]);
  });
});
