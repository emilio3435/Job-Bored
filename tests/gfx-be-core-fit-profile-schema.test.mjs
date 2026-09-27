import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   GFX BE-CORE · N-B4-2 / R8 — one client copy of the profile rules.

   fit-profile-schema.js mirrors user-profile.schema.json (the server's
   ajv contract). The drift test walks the JSON schema, so a limit that
   changes there without changing here fails CI.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(repoRoot, "fit-profile-schema.js");
const jsonSchema = JSON.parse(
  readFileSync(
    join(
      repoRoot,
      "integrations/browser-use-discovery/src/contracts/user-profile.schema.json",
    ),
    "utf8",
  ),
);

function loadSchemaModule() {
  assert.ok(existsSync(schemaPath), "fit-profile-schema.js must exist");
  const window = {};
  const ctx = vm.createContext({ window });
  vm.runInContext(readFileSync(schemaPath, "utf8"), ctx, {
    filename: "fit-profile-schema.js",
  });
  assert.ok(window.JobBoredFitProfileSchema, "attaches window.JobBoredFitProfileSchema");
  return window.JobBoredFitProfileSchema;
}

function node(pointer) {
  let cur = jsonSchema;
  for (const part of pointer.split("/").filter(Boolean)) {
    cur = cur[part];
    assert.ok(cur, `schema path ${pointer} must exist`);
  }
  return cur;
}

const P = "properties";
// Every LIMITS key → the JSON-schema node it mirrors. Array limits carry
// minItems/maxItems on the array and item length on `items`.
const LIMIT_SOURCES = {
  targetRoles: [`${P}/identity/${P}/targetRoles`, "items"],
  yearsRelevantExperience: [`${P}/identity/${P}/yearsRelevantExperience`],
  primaryNarrative: [`${P}/identity/${P}/primaryNarrative`],
  strengths: [`${P}/strengths`],
  strengthName: [`${P}/strengths/items/${P}/name`],
  strengthRank: [`${P}/strengths/items/${P}/rank`],
  strengthEvidence: [`${P}/strengths/items/${P}/evidence`],
  strengthKeywords: [`${P}/strengths/items/${P}/keywords`, "items"],
  wants: [`${P}/wants`, "items"],
  avoids: [`${P}/avoids`, "items"],
  experiences: [`${P}/experiences`],
  projects: [`${P}/projects`],
  salaryFloor: [`${P}/hardConstraints/${P}/salaryFloor`],
  acceptableLocations: [`${P}/hardConstraints/${P}/acceptableLocations`, "items"],
  skipTitles: [`${P}/hardConstraints/${P}/skipTitles`, "items"],
  writingSamples: [`${P}/writingSamples`, "items"],
};
const KEYWORDS = ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"];

function expectedLimit(pointer, itemsKey) {
  const n = node(pointer);
  const out = {};
  for (const k of KEYWORDS) if (typeof n[k] === "number") out[k] = n[k];
  if (itemsKey) {
    const items = n[itemsKey];
    if (typeof items.minLength === "number") out.itemMinLength = items.minLength;
    if (typeof items.maxLength === "number") out.itemMaxLength = items.maxLength;
  }
  return out;
}

function validProfile() {
  return {
    version: 1,
    identity: {
      targetRoles: ["Product Manager"],
      targetSeniority: "ic_senior",
      primaryNarrative: "I build useful products for small teams.",
    },
    strengths: [{ name: "Strategy", rank: 1 }],
    hardConstraints: { workMode: "remote_only", workAuth: "any" },
  };
}

// The module runs in its own vm realm; copy into this realm before deepEqual.
function fields(result) {
  return Array.from(result.errors, (e) => e.field);
}

describe("N-B4-2 drift · fit-profile-schema.js matches user-profile.schema.json", () => {
  it("N-B4-2 every mirrored limit equals the JSON schema's", () => {
    const S = loadSchemaModule();
    for (const [key, [pointer, itemsKey]] of Object.entries(LIMIT_SOURCES)) {
      assert.deepEqual(
        { ...S.LIMITS[key] },
        expectedLimit(pointer, itemsKey),
        `LIMITS.${key} drifted from ${pointer}`,
      );
    }
    assert.deepEqual(
      Object.keys(S.LIMITS).sort(),
      Object.keys(LIMIT_SOURCES).sort(),
      "every LIMITS entry is pinned to a schema path",
    );
  });

  it("N-B4-2 no numeric limit in the JSON schema goes unmirrored", () => {
    const S = loadSchemaModule();
    // Resume-materials fields inside experiences/projects are not edited by
    // the fit profile UI; everything else must be mirrored.
    const ignored = /^properties\/(experiences|projects)\/items\//;
    const covered = new Set();
    for (const [pointer, itemsKey] of Object.values(LIMIT_SOURCES)) {
      covered.add(pointer);
      if (itemsKey) covered.add(`${pointer}/${itemsKey}`);
    }
    const missing = [];
    (function walk(n, path) {
      if (!n || typeof n !== "object") return;
      if (KEYWORDS.some((k) => typeof n[k] === "number") && !ignored.test(path)) {
        if (!covered.has(path)) missing.push(path);
      }
      for (const [k, v] of Object.entries(n)) {
        walk(v, path ? `${path}/${k}` : k);
      }
    })(jsonSchema, "");
    assert.deepEqual(missing, [], "add these to LIMITS and LIMIT_SOURCES");
    assert.ok(S.LIMITS);
  });

  it("N-B4-2 enums equal the JSON schema's", () => {
    const S = loadSchemaModule();
    const hc = `${P}/hardConstraints/${P}`;
    assert.deepEqual([...S.ENUMS.seniority], node(`${P}/identity/${P}/targetSeniority`).enum);
    assert.deepEqual([...S.ENUMS.workMode], node(`${hc}/workMode`).enum);
    assert.deepEqual([...S.ENUMS.workAuth], node(`${hc}/workAuth`).enum);
    assert.deepEqual([...S.ENUMS.starterTemplate], node(`${P}/starterTemplate`).enum);
    assert.deepEqual(
      [...S.ENUMS.tieBreakerLevel],
      node(`${P}/tieBreakers/${P}/salaryTransparencyImportance`).enum,
    );
  });

  it("N-B4-2 the fit profile wizard's render caps match the schema", () => {
    const S = loadSchemaModule();
    const src = readFileSync(join(repoRoot, "fit-profile-wizard.js"), "utf8");
    const num = (name) => Number((src.match(new RegExp(`var ${name} = (\\d+);`)) || [])[1]);
    assert.equal(num("TARGET_ROLES_MAX"), S.LIMITS.targetRoles.maxItems);
    assert.equal(num("STRENGTHS_MAX"), S.LIMITS.strengths.maxItems);
    assert.equal(num("WANTS_MAX"), S.LIMITS.wants.maxItems);
    assert.equal(num("AVOIDS_MAX"), S.LIMITS.avoids.maxItems);
    assert.equal(num("ACCEPTABLE_LOCATIONS_MAX"), S.LIMITS.acceptableLocations.maxItems);
    assert.equal(num("SKIP_TITLES_MAX"), S.LIMITS.skipTitles.maxItems);
    assert.equal(num("NARRATIVE_MIN"), S.LIMITS.primaryNarrative.minLength);
    assert.equal(num("NARRATIVE_MAX"), S.LIMITS.primaryNarrative.maxLength);
  });
});

describe("N-B4-2 validateProfile · per-field errors at the schema's edges", () => {
  it("N-B4-2 a minimal valid profile passes", () => {
    const S = loadSchemaModule();
    const result = S.validateProfile(validProfile());
    assert.deepEqual(fields(result), []);
    assert.equal(result.ok, true);
  });

  it("N-B4-2 a non-object is one root error, never a throw", () => {
    const S = loadSchemaModule();
    for (const bad of [null, undefined, "x", [], 3]) {
      const r = S.validateProfile(bad);
      assert.equal(r.ok, false);
      assert.deepEqual(fields(r), [""]);
    }
  });

  it("N-B4-2 target roles: 1..8, each 1..80 chars", () => {
    const S = loadSchemaModule();
    const p = validProfile();
    p.identity.targetRoles = [];
    assert.deepEqual(fields(S.validateProfile(p)), ["identity.targetRoles"]);
    p.identity.targetRoles = Array.from({ length: 8 }, (_, i) => `Role ${i}`);
    assert.equal(S.validateProfile(p).ok, true, "exactly 8 passes");
    p.identity.targetRoles.push("Role 9");
    assert.deepEqual(fields(S.validateProfile(p)), ["identity.targetRoles"]);
    p.identity.targetRoles = ["x".repeat(80)];
    assert.equal(S.validateProfile(p).ok, true, "80 chars passes");
    p.identity.targetRoles = ["ok", "x".repeat(81)];
    assert.deepEqual(fields(S.validateProfile(p)), ["identity.targetRoles[1]"]);
  });

  it("N-B4-2 narrative: 20..1200 chars", () => {
    const S = loadSchemaModule();
    const p = validProfile();
    for (const [len, ok] of [[19, false], [20, true], [1200, true], [1201, false]]) {
      p.identity.primaryNarrative = "x".repeat(len);
      const r = S.validateProfile(p);
      assert.equal(r.ok, ok, `narrative length ${len}`);
      if (!ok) assert.deepEqual(fields(r), ["identity.primaryNarrative"]);
    }
  });

  it("N-B4-2 seniority, work mode and work auth must be schema enums", () => {
    const S = loadSchemaModule();
    const p = validProfile();
    p.identity.targetSeniority = "senior";
    p.hardConstraints.workMode = "remote";
    p.hardConstraints.workAuth = "citizen";
    assert.deepEqual(fields(S.validateProfile(p)), [
      "identity.targetSeniority",
      "hardConstraints.workMode",
      "hardConstraints.workAuth",
    ]);
    delete p.identity.targetSeniority;
    assert.ok(fields(S.validateProfile(p)).includes("identity.targetSeniority"), "required");
  });

  it("N-B4-2 strengths: 1..8, name 2..60, rank 1..8, evidence ≤400, keywords ≤20 of 1..40", () => {
    const S = loadSchemaModule();
    const p = validProfile();
    p.strengths = [];
    assert.deepEqual(fields(S.validateProfile(p)), ["strengths"]);
    p.strengths = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}x`, rank: 1 }));
    assert.deepEqual(fields(S.validateProfile(p)), ["strengths"]);
    p.strengths = [{ name: "x".repeat(60), rank: 8 }];
    assert.equal(S.validateProfile(p).ok, true, "60-char name, rank 8 pass");
    p.strengths = [
      { name: "x", rank: 1 },
      { name: "x".repeat(61), rank: 9 },
      { name: "ok", rank: 1, evidence: "e".repeat(401) },
      { name: "ok", rank: 1, keywords: Array.from({ length: 21 }, () => "k") },
      { name: "ok", rank: 1, keywords: ["k".repeat(41)] },
    ];
    assert.deepEqual(fields(S.validateProfile(p)), [
      "strengths[0].name",
      "strengths[1].name",
      "strengths[1].rank",
      "strengths[2].evidence",
      "strengths[3].keywords",
      "strengths[4].keywords[0]",
    ]);
  });

  it("N-B4-2 wants/avoids: ≤12 each, 2..200 chars", () => {
    const S = loadSchemaModule();
    for (const key of ["wants", "avoids"]) {
      const p = validProfile();
      p[key] = Array.from({ length: 12 }, (_, i) => `item ${i}`);
      assert.equal(S.validateProfile(p).ok, true, `12 ${key} pass`);
      p[key].push("one more");
      assert.deepEqual(fields(S.validateProfile(p)), [key]);
      p[key] = ["x", "y".repeat(201), "y".repeat(200)];
      assert.deepEqual(fields(S.validateProfile(p)), [`${key}[0]`, `${key}[1]`]);
    }
  });

  it("N-B4-2 locations ≤20, skip titles ≤30, each 2..80; salary floor a non-negative integer or null", () => {
    const S = loadSchemaModule();
    const p = validProfile();
    p.hardConstraints.acceptableLocations = Array.from({ length: 21 }, (_, i) => `City ${i}`);
    p.hardConstraints.skipTitles = Array.from({ length: 31 }, (_, i) => `Title ${i}`);
    p.hardConstraints.salaryFloor = -1;
    assert.deepEqual(fields(S.validateProfile(p)), [
      "hardConstraints.salaryFloor",
      "hardConstraints.acceptableLocations",
      "hardConstraints.skipTitles",
    ]);
    p.hardConstraints = { workMode: "any", salaryFloor: null, skipTitles: ["x".repeat(81)] };
    assert.deepEqual(fields(S.validateProfile(p)), ["hardConstraints.skipTitles[0]"]);
    p.hardConstraints = { workMode: "any", salaryFloor: 120000.5 };
    assert.deepEqual(fields(S.validateProfile(p)), ["hardConstraints.salaryFloor"]);
  });

  it("N-B4-2 unknown keys fail closed, as the server's additionalProperties:false does", () => {
    const S = loadSchemaModule();
    const p = validProfile();
    p.extra = true;
    p.identity.nickname = "x";
    p.hardConstraints.remote = true;
    p.strengths[0].weight = 2;
    assert.deepEqual(fields(S.validateProfile(p)), [
      "extra",
      "identity.nickname",
      "strengths[0].weight",
      "hardConstraints.remote",
    ]);
  });

  it("N-B4-2 every error carries a human message", () => {
    const S = loadSchemaModule();
    const p = validProfile();
    p.identity.targetRoles = [];
    const [err] = S.validateProfile(p).errors;
    assert.equal(typeof err.message, "string");
    assert.match(err.message, /target role/i);
  });
});

describe("N-B4-2 consumers · the wizard and editor gate through the schema", () => {
  function loadWizard({ withSchema = true } = {}) {
    const window = {
      location: { hash: "", protocol: "http:" },
      addEventListener() {},
      COMMAND_CENTER_CONFIG: {},
    };
    const document = { readyState: "complete", addEventListener() {} };
    const ctx = vm.createContext({ window, document, console });
    if (withSchema) {
      vm.runInContext(readFileSync(schemaPath, "utf8"), ctx, { filename: "fit-profile-schema.js" });
    }
    vm.runInContext(readFileSync(join(repoRoot, "fit-profile-wizard.js"), "utf8"), ctx, {
      filename: "fit-profile-wizard.js",
    });
    return window.FitProfileForm;
  }

  it("N-B4-2 the wizard rejects what the server would: 9 roles, a 61-char strength, 13 wants", () => {
    const form = loadWizard();
    const p = validProfile();
    assert.equal(form.validateClientSide(p).length, 0);
    p.identity.targetRoles = Array.from({ length: 9 }, (_, i) => `Role ${i}`);
    p.strengths = [{ name: "x".repeat(61), rank: 1 }];
    p.wants = Array.from({ length: 13 }, (_, i) => `want ${i}`);
    assert.equal(form.validateClientSide(p).length, 3);
  });

  it("N-B4-2 without the schema module the wizard fails closed instead of passing everything", () => {
    const form = loadWizard({ withSchema: false });
    const problems = form.validateClientSide(validProfile());
    assert.equal(problems.length, 1);
    assert.match(problems[0], /reload/i);
  });

  it("N-B4-2 the Settings editor validates through FitProfileForm.validateClientSide, not a copy", () => {
    const src = readFileSync(join(repoRoot, "fit-profile-editor.js"), "utf8");
    const save = src.slice(src.indexOf("async function handleSave"));
    assert.match(save, /FP\.validateClientSide\(payload\)/);
    assert.doesNotMatch(src, /primaryNarrative\.length|NARRATIVE_MIN\s*=|_MAX\s*=\s*\d/);
  });
});
