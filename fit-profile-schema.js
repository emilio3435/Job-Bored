/**
 * fit-profile-schema.js — the client's one copy of the Fit Profile rules.
 *
 * Mirrors integrations/browser-use-discovery/src/contracts/user-profile.schema.json,
 * which the server enforces with ajv on POST /profile. Beat 4, the
 * onboarding wizard and the Settings editor validate through this module so
 * a profile the server would reject is caught before the POST, field by
 * field. tests/gfx-be-core-fit-profile-schema.test.mjs walks the JSON schema
 * and fails when a limit or enum here drifts from it.
 *
 * Classic-global IIFE, no dependencies. Attaches window.JobBoredFitProfileSchema.
 * Load before fit-profile-wizard.js.
 */
(function (root) {
  "use strict";

  var ENUMS = Object.freeze({
    seniority: Object.freeze([
      "intern", "entry", "ic_mid", "ic_senior", "ic_staff", "ic_principal",
      "manager", "director", "head", "vp", "c_level", "any",
    ]),
    workMode: Object.freeze(["remote_only", "hybrid_ok", "onsite_ok", "any"]),
    workAuth: Object.freeze(["us_citizen", "us_authorized", "needs_sponsorship", "any"]),
    starterTemplate: Object.freeze([
      "marketer", "engineer", "product_manager", "data_scientist", "designer", "custom",
    ]),
    tieBreakerLevel: Object.freeze(["high", "medium", "low"]),
  });

  var LIMITS = Object.freeze({
    targetRoles: Object.freeze({ minItems: 1, maxItems: 8, itemMinLength: 1, itemMaxLength: 80 }),
    yearsRelevantExperience: Object.freeze({ minimum: 0, maximum: 60 }),
    primaryNarrative: Object.freeze({ minLength: 20, maxLength: 1200 }),
    strengths: Object.freeze({ minItems: 1, maxItems: 8 }),
    strengthName: Object.freeze({ minLength: 2, maxLength: 60 }),
    strengthRank: Object.freeze({ minimum: 1, maximum: 8 }),
    strengthEvidence: Object.freeze({ maxLength: 400 }),
    strengthKeywords: Object.freeze({ maxItems: 20, itemMinLength: 1, itemMaxLength: 40 }),
    wants: Object.freeze({ maxItems: 12, itemMinLength: 2, itemMaxLength: 200 }),
    avoids: Object.freeze({ maxItems: 12, itemMinLength: 2, itemMaxLength: 200 }),
    experiences: Object.freeze({ maxItems: 24 }),
    projects: Object.freeze({ maxItems: 24 }),
    salaryFloor: Object.freeze({ minimum: 0 }),
    acceptableLocations: Object.freeze({ maxItems: 20, itemMinLength: 2, itemMaxLength: 80 }),
    skipTitles: Object.freeze({ maxItems: 30, itemMinLength: 2, itemMaxLength: 80 }),
    writingSamples: Object.freeze({ maxItems: 8, itemMinLength: 1, itemMaxLength: 2000 }),
  });

  // additionalProperties:false objects — the server rejects any other key.
  var KEYS = {
    root: [
      "version", "createdAt", "updatedAt", "starterTemplate", "identity",
      "strengths", "wants", "avoids", "experiences", "projects",
      "hardConstraints", "tieBreakers", "writingSamples",
    ],
    identity: ["targetRoles", "targetSeniority", "yearsRelevantExperience", "primaryNarrative"],
    strength: ["name", "rank", "evidence", "keywords"],
    hardConstraints: [
      "salaryFloor", "salaryRequired", "workMode", "acceptableLocations", "workAuth", "skipTitles",
    ],
    tieBreakers: [
      "salaryTransparencyImportance", "companyCredibilityImportance", "applicationComplexityAversion",
    ],
  };

  function isObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function isInt(v) {
    return typeof v === "number" && Number.isInteger(v);
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function validateProfile(profile) {
    var errors = [];
    function fail(field, message) {
      errors.push({ field: field, message: message });
    }

    function unknownKeys(obj, allowed, prefix) {
      Object.keys(obj).forEach(function (k) {
        if (allowed.indexOf(k) === -1) {
          fail(prefix + k, "“" + k + "” isn't a profile field JobBored can save.");
        }
      });
    }

    function checkEnum(value, list, field, label) {
      if (list.indexOf(value) === -1) fail(field, "Pick a " + label + " from the list.");
    }

    function checkIntRange(value, limit, field, label) {
      if (!isInt(value)) {
        fail(field, label + " must be a whole number.");
      } else if (
        (typeof limit.minimum === "number" && value < limit.minimum) ||
        (typeof limit.maximum === "number" && value > limit.maximum)
      ) {
        fail(
          field,
          typeof limit.maximum === "number"
            ? label + " must be between " + limit.minimum + " and " + limit.maximum + "."
            : label + " can't be below " + limit.minimum + ".",
        );
      }
    }

    function checkText(value, limit, field, label) {
      if (typeof value !== "string") {
        fail(field, label + " must be text.");
        return;
      }
      var min = typeof limit.minLength === "number" ? limit.minLength : limit.itemMinLength;
      var max = typeof limit.maxLength === "number" ? limit.maxLength : limit.itemMaxLength;
      if (typeof min === "number" && value.length < min) {
        fail(field, label + (min === 1 ? " can't be empty." : " needs at least " + min + " characters."));
      } else if (typeof max === "number" && value.length > max) {
        fail(field, label + " must be " + max + " characters or fewer.");
      }
    }

    // A string list: one error for the count, then one per bad item.
    function checkList(value, limit, field, label, itemLabel) {
      if (!Array.isArray(value)) {
        fail(field, label + " must be a list.");
        return;
      }
      if (typeof limit.minItems === "number" && value.length < limit.minItems) {
        fail(field, "Add at least " + limit.minItems + " " + itemLabel + ".");
        return;
      }
      if (typeof limit.maxItems === "number" && value.length > limit.maxItems) {
        fail(field, "Keep to " + limit.maxItems + " " + label.toLowerCase() + " or fewer.");
        return;
      }
      value.forEach(function (item, i) {
        checkText(item, limit, field + "[" + i + "]", "Each " + itemLabel);
      });
    }

    if (!isObject(profile)) {
      fail("", "The profile must be an object.");
      return { ok: false, errors: errors };
    }

    unknownKeys(profile, KEYS.root, "");
    if (profile.version !== 1) fail("version", "Profile version must be 1.");
    if (has(profile, "starterTemplate")) {
      checkEnum(profile.starterTemplate, ENUMS.starterTemplate, "starterTemplate", "starter template");
    }

    var id = profile.identity;
    if (!isObject(id)) {
      fail("identity", "Add your target roles, seniority and narrative.");
    } else {
      unknownKeys(id, KEYS.identity, "identity.");
      checkList(id.targetRoles, LIMITS.targetRoles, "identity.targetRoles", "Target roles", "target role");
      checkEnum(id.targetSeniority, ENUMS.seniority, "identity.targetSeniority", "seniority");
      if (has(id, "yearsRelevantExperience")) {
        checkIntRange(
          id.yearsRelevantExperience,
          LIMITS.yearsRelevantExperience,
          "identity.yearsRelevantExperience",
          "Years of experience",
        );
      }
      checkText(id.primaryNarrative, LIMITS.primaryNarrative, "identity.primaryNarrative", "Your narrative");
    }

    var strengths = profile.strengths;
    if (!Array.isArray(strengths)) {
      fail("strengths", "Add at least one strength.");
    } else if (strengths.length < LIMITS.strengths.minItems) {
      fail("strengths", "Add at least one strength.");
    } else if (strengths.length > LIMITS.strengths.maxItems) {
      fail("strengths", "Keep to " + LIMITS.strengths.maxItems + " strengths or fewer.");
    } else {
      strengths.forEach(function (s, i) {
        var at = "strengths[" + i + "]";
        if (!isObject(s)) {
          fail(at, "Each strength needs a name and a rank.");
          return;
        }
        unknownKeys(s, KEYS.strength, at + ".");
        checkText(s.name, LIMITS.strengthName, at + ".name", "Strength name");
        checkIntRange(s.rank, LIMITS.strengthRank, at + ".rank", "Strength rank");
        if (has(s, "evidence")) {
          checkText(s.evidence, LIMITS.strengthEvidence, at + ".evidence", "Evidence");
        }
        if (has(s, "keywords")) {
          checkList(s.keywords, LIMITS.strengthKeywords, at + ".keywords", "Keywords", "keyword");
        }
      });
    }

    if (has(profile, "wants")) checkList(profile.wants, LIMITS.wants, "wants", "Wants", "want");
    if (has(profile, "avoids")) checkList(profile.avoids, LIMITS.avoids, "avoids", "Avoids", "avoid");
    if (has(profile, "writingSamples")) {
      checkList(profile.writingSamples, LIMITS.writingSamples, "writingSamples", "Writing samples", "writing sample");
    }
    ["experiences", "projects"].forEach(function (key) {
      if (!has(profile, key)) return;
      if (!Array.isArray(profile[key])) fail(key, key + " must be a list.");
      else if (profile[key].length > LIMITS[key].maxItems) {
        fail(key, "Keep to " + LIMITS[key].maxItems + " " + key + " or fewer.");
      }
    });

    var hc = profile.hardConstraints;
    if (!isObject(hc)) {
      fail("hardConstraints", "Pick a work mode.");
    } else {
      unknownKeys(hc, KEYS.hardConstraints, "hardConstraints.");
      if (has(hc, "salaryFloor") && hc.salaryFloor !== null) {
        checkIntRange(hc.salaryFloor, LIMITS.salaryFloor, "hardConstraints.salaryFloor", "Salary floor");
      }
      if (has(hc, "salaryRequired") && typeof hc.salaryRequired !== "boolean") {
        fail("hardConstraints.salaryRequired", "Salary required must be yes or no.");
      }
      checkEnum(hc.workMode, ENUMS.workMode, "hardConstraints.workMode", "work mode");
      if (has(hc, "acceptableLocations")) {
        checkList(
          hc.acceptableLocations,
          LIMITS.acceptableLocations,
          "hardConstraints.acceptableLocations",
          "Locations",
          "location",
        );
      }
      if (has(hc, "workAuth")) {
        checkEnum(hc.workAuth, ENUMS.workAuth, "hardConstraints.workAuth", "work authorization");
      }
      if (has(hc, "skipTitles")) {
        checkList(hc.skipTitles, LIMITS.skipTitles, "hardConstraints.skipTitles", "Skip titles", "skip title");
      }
    }

    if (has(profile, "tieBreakers")) {
      var tb = profile.tieBreakers;
      if (!isObject(tb)) {
        fail("tieBreakers", "Tie-breakers must be an object.");
      } else {
        unknownKeys(tb, KEYS.tieBreakers, "tieBreakers.");
        KEYS.tieBreakers.forEach(function (k) {
          if (has(tb, k)) checkEnum(tb[k], ENUMS.tieBreakerLevel, "tieBreakers." + k, "level");
        });
      }
    }

    return { ok: errors.length === 0, errors: errors };
  }

  var api = Object.freeze({
    ENUMS: ENUMS,
    LIMITS: LIMITS,
    validateProfile: validateProfile,
  });

  if (root) root.JobBoredFitProfileSchema = api;
})(typeof window !== "undefined" ? window : globalThis);
