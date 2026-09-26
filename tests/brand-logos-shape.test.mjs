/**
 * The brand-logo resolver's shape class (server/brand-logos.mjs), which the
 * templates size marks by and signal uses to hide a duplicate name beside a
 * wordmark (visual spec §9.2 rule 3).
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  getBrandLogosTemplateRoot,
  getRepoSampleTemplateRoot,
  imageDimensions,
  logoShape,
  readResolvedMarks,
  saveUpload,
} from "../server/brand-logos.mjs";

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

describe("logo storage root", () => {
  const ENV_KEYS = ["JOBBORED_LOGOS_DIR", "HERMES_RESUME_TEMPLATE_DIR", "HERMES_JOB_HUNT_ROOT", "HERMES_ROOT", "JOBBORED_HOME", "HERMES_LOGO_RESOLVER_SCRIPT"];

  /** @param {Record<string, string>} env @param {() => Promise<void>} fn */
  async function withEnv(env, fn) {
    const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, env);
    try {
      await fn();
    } finally {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }

  it("should keep uploads and resolved marks under <JOBBORED_HOME>/logos and never write into the repo sample", async () => {
    const home = await mkdtemp(join(tmpdir(), "jb-logo-home-"));
    const sample = getRepoSampleTemplateRoot();
    /** @param {string} dir */
    const snapshot = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort().join("|") : "");
    const before = snapshot(sample);
    try {
      const stub = join(home, "resolver-stub.py");
      await writeFile(stub, "print('0 marks:')\n");
      await withEnv({ JOBBORED_HOME: home, HERMES_LOGO_RESOLVER_SCRIPT: stub }, async () => {
        assert.equal(getBrandLogosTemplateRoot(), join(home, "logos"));
        const result = await saveUpload("northwind", readFileSync(join(logoDir, "elio.png")));
        assert.equal(result.upload, "uploads/logo-northwind.png");
        assert.ok(existsSync(join(home, "logos", "uploads", "logo-northwind.png")));
        assert.ok(existsSync(join(home, "logos", "logos.json")));
      });
      assert.equal(snapshot(sample), before, "the repo's sample template folder is untouched");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("should refuse to use the repo sample as a writable logo root", async () => {
    await withEnv({ JOBBORED_LOGOS_DIR: getRepoSampleTemplateRoot() }, async () => {
      await assert.rejects(() => saveUpload("northwind", readFileSync(join(logoDir, "elio.png"))), /never write into the repo/);
    });
  });

  it("should default to ~/.jobbored/logos with no overrides", async () => {
    await withEnv({}, async () => {
      assert.equal(getBrandLogosTemplateRoot(), join(homedir(), ".jobbored", "logos"));
    });
  });
});
