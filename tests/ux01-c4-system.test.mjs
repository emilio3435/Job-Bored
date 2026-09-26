/**
 * UX01 C4 — lane A (System): dead code out, legacy CSS renamed, fonts trimmed,
 * gzip in the dev server, Today hidden behind the auth gates.
 *
 * Finding ids: DS-04/07/08/09/12/13/17/20/23/24, TR-20, TA-25, FD-24, FR-25,
 * SS-08, AX-26 (docs/programs/ux01-20260925/audit/*.md).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createDevServer } from "../dev-server.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const indexHtml = read("index.html");
const stylesheetHrefs = [...indexHtml.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(
  (m) => m[1],
);
const scriptSrcs = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);

describe("C4 · SS-08 Today stays hidden behind the auth gates", () => {
  const css = read("jb-v2-legacy-hide.css");

  it("should hide [data-region=\"today\"] by default under body.jb-v2", () => {
    const gated = [...css.matchAll(/([^{}]+)\{\s*display:\s*none !important;\s*\}/g)]
      .map((m) => m[1])
      .find((sel) => sel.includes('[data-region="dawn"]'));
    assert.ok(gated, "the default auth-gated hide list must exist");
    assert.match(gated, /body\.jb-v2 \[data-region="today"\]/);
  });

  it("should reveal [data-region=\"today\"] only once #dashboard is visible", () => {
    assert.match(
      css,
      /body\.jb-v2:has\(#dashboard:not\(\[style\*="display: none"\]\)\) \[data-region="today"\][^{]*\{\s*display:\s*block !important;/,
    );
  });
});

describe("C4 · dead modules are gone (DS-09, DS-20, TR-20, TA-25, FD-24)", () => {
  const DEAD_FILES = [
    "lattice.js",
    "lattice.css",
    "letter.js",
    "letter.css",
    "role-workshop.js",
    "mark-submitted.js",
    "companies-tab.js",
    "welcome.css",
  ];

  for (const file of DEAD_FILES) {
    it(`should delete ${file} and never include it from index.html`, () => {
      assert.equal(existsSync(join(repoRoot, file)), false, `${file} still on disk`);
      assert.ok(!stylesheetHrefs.includes(file), `${file} still linked`);
      assert.ok(!scriptSrcs.includes(file), `${file} still loaded`);
    });
  }

  it("should drop the deleted modules from the typecheck:repo script", () => {
    const script = JSON.parse(read("package.json")).scripts["typecheck:repo"];
    for (const file of DEAD_FILES.filter((f) => f.endsWith(".js"))) {
      assert.ok(!script.includes(`node --check ${file}`), `typecheck:repo still checks ${file}`);
    }
  });

  it("should not register <jb-spark> or <jb-kbd> (DS-20)", () => {
    const js = read("jb-ui.js");
    assert.doesNotMatch(js, /["']jb-spark["']/);
    assert.doesNotMatch(js, /["']jb-kbd["']/);
  });

  it("should drop the unused jb-deco classes (DS-20)", () => {
    const css = read("jb-deco.css");
    for (const cls of ["jb-tape", "jb-mark", "jb-underline-", "jb-shadow-"]) {
      assert.ok(!css.includes(`.${cls}`), `jb-deco.css still defines .${cls}`);
    }
  });
});

describe("C4 · DS-07 no live sheet is named legacy", () => {
  it("should link no css/legacy-*.css from index.html", () => {
    const legacy = stylesheetHrefs.filter((h) => /(^|\/)legacy-/.test(h));
    assert.deepEqual(legacy, []);
  });

  it("should keep no css/legacy-*.css on disk", () => {
    const left = readdirSync(join(repoRoot, "css")).filter((f) => f.startsWith("legacy-"));
    assert.deepEqual(left, []);
  });

  it("should link css/overlay.css before the surface sheets that extend its chassis", () => {
    const overlay = stylesheetHrefs.indexOf("css/overlay.css");
    assert.ok(overlay >= 0, "css/overlay.css must be linked");
    assert.ok(overlay < stylesheetHrefs.indexOf("css/brief.css"));
    assert.ok(overlay < stylesheetHrefs.indexOf("css/cards-drawer.css"));
    const overlayCss = read("css/overlay.css");
    for (const sel of [".modal-overlay", ".btn-modal-primary", ".detail-overlay", ".detail-drawer"]) {
      assert.ok(overlayCss.includes(sel), `overlay.css must own ${sel}`);
    }
  });
});

describe("C4 · fonts (DS-12, DS-13, DS-23)", () => {
  const fonts = read("vendor/fonts/fonts.css");

  it("should drop DM Sans from fonts.css and every font stack", () => {
    assert.doesNotMatch(fonts, /font-family:\s*'DM Sans'/);
    assert.doesNotMatch(read("tokens-v2.css"), /"DM Sans"/);
  });

  it("should keep only latin and latin-ext subsets for Caveat, Lora and Source Sans 3", () => {
    const faces = fonts.split("@font-face").slice(1);
    for (const face of faces) {
      const family = /font-family:\s*'([^']+)'/.exec(face)[1];
      if (!["Caveat", "Lora", "Source Sans 3"].includes(family)) continue;
      const range = /unicode-range:\s*([^;]+);/.exec(face)[1];
      assert.ok(
        range.startsWith("U+0000-00FF") || range.startsWith("U+0100-02BA"),
        `${family} ships a non-latin subset: ${range.slice(0, 40)}`,
      );
    }
  });

  it("should not name the unvendored Special Elite face in the token stacks (DS-23)", () => {
    assert.doesNotMatch(read("tokens-v2.css"), /Special Elite/);
    assert.doesNotMatch(read("style.css"), /Special Elite/);
  });

  it("should define .jb-handwritten once, in jb-type.css (DS-13)", () => {
    assert.doesNotMatch(read("jb-v2.css"), /\.jb-handwritten/);
    assert.match(read("jb-type.css"), /\.jb-handwritten/);
  });
});

describe("C4 · AX-26 the dev server gzips text assets", () => {
  let server;
  let port;

  before(async () => {
    server = createDevServer({ port: 0, logger: { log() {}, error() {}, warn() {} } });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  function get(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("should gzip a stylesheet when the client accepts gzip", async () => {
    const { res, body } = await get("/style.css", { "accept-encoding": "gzip, deflate, br" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.match(String(res.headers.vary || ""), /accept-encoding/i);
    assert.equal(gunzipSync(body).toString("utf8"), read("style.css"));
  });

  it("should gzip index.html after expanding its includes", async () => {
    const { res, body } = await get("/index.html", { "accept-encoding": "gzip" });
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.match(gunzipSync(body).toString("utf8"), /<html/i);
  });

  it("should serve identity bytes when the client does not accept gzip", async () => {
    const { res, body } = await get("/style.css");
    assert.equal(res.headers["content-encoding"], undefined);
    assert.equal(body.toString("utf8"), read("style.css"));
  });

  it("should never gzip already-compressed fonts", async () => {
    const { res } = await get("/vendor/fonts/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2", {
      "accept-encoding": "gzip",
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-encoding"], undefined);
  });
});
