/**
 * Privacy policy and terms of service are public pages on the hosted app
 * and are linked from the first screen and the dashboard footer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resolvePublicFile } from "../scripts/lib/static-path-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const APP = "https://jobbored.elioai.app";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

describe("legal pages", () => {
  it("publishes a privacy policy that names the hosted app", () => {
    const html = read("privacy.html");
    assert.match(html, /<h1>Privacy policy<\/h1>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/jobbored\.elioai\.app\/privacy\.html"/);
    assert.match(html, new RegExp(APP.replaceAll(".", "\\.")));
    assert.match(html, /Limited Use requirements/);
    assert.match(html, /href="terms\.html"/);
  });

  it("publishes terms of service that name the hosted app", () => {
    const html = read("terms.html");
    assert.match(html, /<h1>Terms of service<\/h1>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/jobbored\.elioai\.app\/terms\.html"/);
    assert.match(html, new RegExp(APP.replaceAll(".", "\\.")));
    assert.match(html, /href="privacy\.html"/);
  });

  it("serves both pages from the static host", async () => {
    for (const page of ["privacy.html", "terms.html", "css/legal.css"]) {
      const result = await resolvePublicFile(`/${page}`, { root: ROOT });
      assert.equal(result.ok, true, `${page} should be public`);
    }
  });

  it("links both pages from the dashboard footer and the first screen", () => {
    const index = read("index.html");
    assert.match(index, /href="privacy\.html"/);
    assert.match(index, /href="terms\.html"/);
    const board = read("oneflow-demo-board.js");
    assert.match(board, /privacy\.html/);
    assert.match(board, /terms\.html/);
  });
});
