/**
 * The materials template registry (visual spec §9, plan slice 3):
 * server/materials-templates.mjs, templates/materials/<family>/, and the
 * contracts that must agree with it.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MATERIALS_BUDGETS } from "../server/materials-fit-budget.mjs";
import { vendoredFontFaces } from "../server/materials-render.mjs";
import {
  DEFAULT_FAMILY,
  familyIds,
  listFamilies,
  resolveFamily,
  resolveRunFamily,
  templateCacheSegment,
  templateIdsFor,
  TEMPLATES_ROOT,
  validateFamily,
} from "../server/materials-templates.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAMILIES = ["signal", "dossier", "editorial"];

/** @param {string} id */
function familyJson(id) {
  return JSON.parse(readFileSync(join(TEMPLATES_ROOT, id, "family.json"), "utf8"));
}

describe("template registry", () => {
  it("should list signal, dossier and editorial, default first", () => {
    assert.deepEqual(familyIds(), FAMILIES);
    assert.equal(DEFAULT_FAMILY, "signal");
    const list = listFamilies();
    assert.deepEqual(list.map((f) => f.id), FAMILIES);
    assert.deepEqual(list.map((f) => f.default), [true, false, false]);
    for (const family of list) {
      assert.ok(family.label && family.description && family.version, `${family.id} summary is complete`);
    }
  });

  it("should validate every family.json against the schema and the hard budget limits", () => {
    for (const id of FAMILIES) {
      const result = validateFamily(familyJson(id));
      assert.equal(result.ok, true, `${id}: ${JSON.stringify(result.ok ? [] : result.errors)}`);
    }
  });

  it("should reject an unknown family with a 400 unknown_template listing the valid ids", () => {
    assert.throws(
      () => resolveFamily("volt"),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "unknown_template");
        assert.deepEqual(err.validTemplates, FAMILIES);
        assert.match(err.message, /signal, dossier, editorial/);
        return true;
      },
    );
    assert.throws(() => resolveFamily(undefined), { code: "unknown_template" });
    assert.throws(() => resolveFamily({ id: "signal" }), { code: "unknown_template" });
    assert.equal(resolveFamily("dossier").id, "dossier");
  });

  it("should resolve the run's family: request, then preference, then default", () => {
    assert.deepEqual(
      { id: resolveRunFamily({ template: "editorial", preferredTemplate: "dossier" }).family.id, source: resolveRunFamily({ template: "editorial", preferredTemplate: "dossier" }).source },
      { id: "editorial", source: "request" },
    );
    const pref = resolveRunFamily({ preferredTemplate: "dossier" });
    assert.equal(pref.family.id, "dossier");
    assert.equal(pref.source, "preference");
    const def = resolveRunFamily({});
    assert.equal(def.family.id, "signal");
    assert.equal(def.source, "default");
    assert.throws(() => resolveRunFamily({ template: "nope" }), { code: "unknown_template" });
  });

  it("should key the cache on <family>@<version> and name template ids per family", () => {
    const signal = resolveFamily("signal");
    const dossier = resolveFamily("dossier");
    assert.equal(templateCacheSegment(signal), `signal@${signal.version}`);
    assert.notEqual(templateCacheSegment(signal), templateCacheSegment(dossier));
    assert.deepEqual(templateIdsFor(dossier), { resume: "dossier.resume", coverLetter: "dossier.letter" });
  });

  it("should keep the render-model and run schema family enums equal to the registry", () => {
    const renderModel = JSON.parse(readFileSync(join(repoRoot, "schemas/materials-render-model.v1.schema.json"), "utf8"));
    const run = JSON.parse(readFileSync(join(repoRoot, "schemas/materials-run.v1.schema.json"), "utf8"));
    const familySchema = JSON.parse(readFileSync(join(TEMPLATES_ROOT, "family.schema.json"), "utf8"));
    assert.deepEqual(renderModel.$defs.family.enum, familyIds());
    assert.equal(renderModel.properties.template.properties.family.default, DEFAULT_FAMILY);
    assert.deepEqual(run.properties.template.properties.family.enum, familyIds());
    assert.deepEqual(familySchema.properties.id.enum, familyIds());
  });

  it("should reject soft-budget overrides that cross a hard limit (rule 9)", () => {
    const base = familyJson("signal");
    const tooManyWords = { ...base, budgets: { ...base.budgets, visibleWords: [340, MATERIALS_BUDGETS.resume.visibleWordsHardMax + 1] } };
    const tooManyEmployers = { ...base, budgets: { ...base.budgets, featuredEmployers: MATERIALS_BUDGETS.resume.featuredEmployersMax + 1 } };
    const tooManyBullets = { ...base, budgets: { ...base.budgets, bulletsPerFeatured: [2, 5] } };
    for (const bad of [tooManyWords, tooManyEmployers, tooManyBullets]) {
      assert.equal(validateFamily(bad).ok, false);
    }
    const noInk = { ...base, accents: ["volt"] };
    assert.equal(validateFamily(noInk).ok, false, "every family must support the ink accent (rule 10)");
  });

  it("should give each family its two templates and stylesheet", () => {
    for (const id of FAMILIES) {
      const family = resolveFamily(id);
      for (const file of ["resume.html", "cover-letter.html", family.stylesheet, "family.json"]) {
        assert.ok(existsSync(join(TEMPLATES_ROOT, id, file)), `${id}/${file}`);
      }
      assert.equal(family.stylesheet, `${id}.css`);
    }
  });
});

describe("vendored fonts (rule 5)", () => {
  const faces = vendoredFontFaces();

  it("should declare every face a family sets in vendor/fonts/fonts.css, with the file on disk", () => {
    for (const id of FAMILIES) {
      for (const name of resolveFamily(id).fonts) {
        const [familyName, italic] = name.endsWith(" Italic") ? [name.slice(0, -7), true] : [name, false];
        const matching = faces.filter(
          (f) => f.family === familyName && (italic ? f.style === "italic" : f.style === "normal") && (f.subset === "latin" || f.subset === "latin-ext"),
        );
        assert.ok(matching.length > 0, `${id}: ${name} is not vendored`);
        for (const face of matching) {
          assert.ok(existsSync(join(repoRoot, "vendor/fonts", face.src)), `${face.src} is missing`);
        }
      }
    }
  });

  it("should ship the OFL license beside each vendored family a template uses", () => {
    for (const dir of ["archivo", "martianmono", "bodonimoda", "sourcesans3", "jetbrainsmono", "caveat"]) {
      const license = join(repoRoot, "vendor/fonts", dir, "OFL.txt");
      assert.ok(existsSync(license), `${dir}/OFL.txt`);
      assert.match(readFileSync(license, "utf8"), /SIL OPEN FONT LICENSE/i);
    }
  });

  it("should not point any template or stylesheet at a network font", () => {
    for (const id of FAMILIES) {
      for (const file of readdirSync(join(TEMPLATES_ROOT, id))) {
        const text = readFileSync(join(TEMPLATES_ROOT, id, file), "utf8");
        assert.doesNotMatch(text, /fonts\.(googleapis|gstatic)\.com|@import|https?:\/\//, `${id}/${file}`);
      }
    }
  });
});

describe("templates carry no personal identity (audit H8/F18)", () => {
  /** @param {string} dir @returns {string[]} */
  function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  it("should keep every file under templates/materials free of the maintainer's identity", () => {
    for (const path of walk(TEMPLATES_ROOT)) {
      const text = readFileSync(path, "utf8");
      for (const needle of [/Nunez/i, /emilio3435/i, /501\.366/, /emiliobuilds/i, /Audacy/i]) {
        assert.doesNotMatch(text, needle, `${path.slice(repoRoot.length + 1)} contains ${needle}`);
      }
    }
  });
});
