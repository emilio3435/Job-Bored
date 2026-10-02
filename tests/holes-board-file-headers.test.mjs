/**
 * HOLES BOARD — B18: file headers describe the code that ships.
 *
 * A header is the first thing the next engineer reads. pipeline.js said a card
 * click writes "#letter=<jobKey>" (the role lives at #role= now), and
 * whats-next-banner.js said it loads after first-run-wizard.js and shares a
 * handler with #firstRunPanelDone — neither the file nor the element exists.
 * These checks keep a header from pointing at things that are gone.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(repoRoot, name), "utf8");
const indexHtml = read("index.html");

/** The leading block comment of a script. */
function headerOf(name) {
  const m = /^\s*\/\*([\s\S]*?)\*\//.exec(read(name));
  assert.ok(m, `${name} must open with a header comment`);
  return m[1];
}

/** File names a header mentions: foo.js, bar.css, BAZ.md ... */
function filesNamedIn(header) {
  return [...header.matchAll(/\b([\w-]+\.(?:js|mjs|css|html|md))\b/g)].map((m) => m[1]);
}

/** Element ids a header mentions as #someId (a URL hash like #role= is not an id). */
function elementIdsIn(header) {
  return [...header.matchAll(/#([A-Za-z][\w-]*)(?![\w=-])/g)].map((m) => m[1]);
}

describe("B18 · file headers name only files and elements that exist", () => {
  for (const name of ["pipeline.js", "whats-next-banner.js"]) {
    it(`should name only existing files in the ${name} header`, () => {
      const missing = filesNamedIn(headerOf(name)).filter((f) => !existsSync(join(repoRoot, f)));
      assert.deepEqual(missing, [], `${name} header names files that do not exist`);
    });

    it(`should name only element ids that index.html renders in the ${name} header`, () => {
      const missing = elementIdsIn(headerOf(name)).filter((id) => !indexHtml.includes(`id="${id}"`));
      assert.deepEqual(missing, [], `${name} header names elements index.html does not have`);
    });
  }

  it("should describe the card click as opening #role=, not the retired #letter= hash", () => {
    const header = headerOf("pipeline.js");
    assert.doesNotMatch(header, /#letter=/, "the role lives at #role=<jobKey>");
    assert.match(header, /#role=/);
  });
});
