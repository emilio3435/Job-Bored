/**
 * The brand-logo resolver's shape class (server/brand-logos.mjs), which the
 * templates size marks by and signal uses to hide a duplicate name beside a
 * wordmark (visual spec §9.2 rule 3).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { imageDimensions, logoShape, readResolvedMarks } from "../server/brand-logos.mjs";

const logoDir = join(dirname(fileURLToPath(import.meta.url)), "..", "docs/materials-v3/mocks/assets/logos");

describe("logo shape", () => {
  it("should read PNG and SVG dimensions", () => {
    assert.deepEqual(imageDimensions(readFileSync(join(logoDir, "elio.png"))), { width: 1024, height: 1024 });
    const svg = imageDimensions(readFileSync(join(logoDir, "audacy.svg")));
    assert.ok(svg && svg.width / svg.height > 4);
  });

  it("should class a square mark as mark and a wide one as wordmark, and let the manifest declare lockup", () => {
    assert.equal(logoShape(readFileSync(join(logoDir, "prm-apple-touch.png"))), "mark");
    assert.equal(logoShape(readFileSync(join(logoDir, "audacy.svg"))), "wordmark");
    assert.equal(logoShape(readFileSync(join(logoDir, "colorado-college.svg")), "lockup"), "lockup");
    assert.equal(logoShape(Buffer.from("not an image")), "mark");
    assert.equal(logoShape(Buffer.alloc(0), "bogus"), "mark");
  });
});

describe("readResolvedMarks", () => {
  it("should return data: URI marks with alt text and shape, without creating anything", async () => {
    const root = await mkdtemp(join(tmpdir(), "jb-marks-"));
    try {
      await mkdir(join(root, "assets"), { recursive: true });
      await mkdir(join(root, "uploads"), { recursive: true });
      await writeFile(join(root, "assets", "logo-northwind.png"), readFileSync(join(logoDir, "elio.png")));
      await writeFile(join(root, "uploads", "logo-northwind.png"), readFileSync(join(logoDir, "elio.png")));
      await writeFile(
        join(root, "logos.json"),
        JSON.stringify({ logos: [{ slug: "northwind", label: "Northwind Logistics" }, { slug: "missing", label: "Missing Co" }] }),
      );
      const marks = await readResolvedMarks({ templateRoot: root });
      assert.equal(marks.length, 1);
      assert.equal(marks[0].alt, "Northwind Logistics logo");
      assert.equal(marks[0].shape, "mark");
      assert.equal(marks[0].source, "upload");
      assert.match(marks[0].src, /^data:image\/png;base64,/);

      const absent = join(root, "does-not-exist");
      assert.deepEqual(await readResolvedMarks({ templateRoot: absent }), []);
      assert.equal(existsSync(absent), false, "a missing template folder is never created");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
