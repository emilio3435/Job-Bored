/* Shared discovery webhook payload builder (browser + Node tests/scripts). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JobBoredDiscoveryPayload = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SOURCE_PRESETS = ["browser_only", "ats_only", "browser_plus_ats"];
  var TEXT_LIMIT = 2000;
  var LIST_LIMIT = 12;
  var SKILL_LEXICON = [
    "ai",
    "analytics",
    "aws",
    "crm",
    "customer success",
    "data",
    "django",
    "excel",
    "figma",
    "firebase",
    "go",
    "growth",
    "java",
    "javascript",
    "kubernetes",
    "marketing",
    "node",
    "operations",
    "postgres",
    "product",
    "python",
    "react",
    "revops",
    "salesforce",
    "sql",
    "typescript",
  ];

  function cleanString(value, limit) {
    var s = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    var max = Number.isFinite(limit) ? limit : TEXT_LIMIT;
    return s.length > max ? s.slice(0, max).trim() : s;
  }

  function splitList(value) {
    var raw = String(value == null ? "" : value);
    return unique(
      raw
        .split(/[\n;,|]+|(?:\s+\/\s+)/g)
        .map(function (item) {
          return cleanString(item, 120);
        })
        .filter(Boolean),
    ).slice(0, LIST_LIMIT);
  }

  function unique(values) {
    var seen = {};
    var out = [];
    values.forEach(function (value) {
      var s = cleanString(value, 180);
      var key = s.toLowerCase();
      if (!s || seen[key]) return;
      seen[key] = true;
      out.push(s);
    });
    return out;
  }

  function stableHash(value) {
    var s = typeof value === "string" ? value : JSON.stringify(value || {});
    var hash = 2166136261;
    for (var i = 0; i < s.length; i += 1) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function dateKey(value) {
    var d = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(d.getTime())) d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function normalizeSourcePreset(raw) {
    var value = cleanString(raw, 40);
    return SOURCE_PRESETS.indexOf(value) === -1 ? "" : value;
  }

  function sanitizeCompanies(raw) {
    if (!Array.isArray(raw)) return [];
    return unique(
      raw
        .filter(function (value) {
          return typeof value === "string";
        })
        .map(function (value) {
          return cleanString(value, 160);
        })
        .filter(Boolean),
    ).slice(0, 50);
  }

  function sanitizeDiscoveryProfile(raw) {
    var source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    var out = {
      targetRoles: cleanString(source.targetRoles),
      locations: cleanString(source.locations),
      remotePolicy: cleanString(source.remotePolicy),
      seniority: cleanString(source.seniority),
      keywordsInclude: cleanString(source.keywordsInclude),
      keywordsExclude: cleanString(source.keywordsExclude),
      maxLeadsPerRun: cleanString(source.maxLeadsPerRun, 40),
    };
    var sourcePreset = normalizeSourcePreset(source.sourcePreset);
    if (sourcePreset) out.sourcePreset = sourcePreset;
    if (source.groundedWebEnabled === false || source.groundedWebEnabled === true) {
      out.groundedWebEnabled = source.groundedWebEnabled;
    }
    var allow = sanitizeCompanies(source.companyAllowlist);
    var block = sanitizeCompanies(source.companyBlocklist);
    if (allow.length) out.companyAllowlist = allow;
    if (block.length) out.companyBlocklist = block;
    return out;
  }

  function resumeText(input) {
    var resume = input && typeof input === "object" ? input : {};
    return cleanString(
      resume.extractedText || resume.resumeText || resume.text || "",
      60000,
    );
  }

  function extractSkills(text, profile, preferences) {
    var haystack = [
      text,
      profile.keywordsInclude,
      profile.targetRoles,
      preferences.industriesToEmphasize,
      preferences.voiceNotes,
    ]
      .map(function (value) {
        return String(value || "").toLowerCase();
      })
      .join(" ");
    var explicit = splitList(profile.keywordsInclude);
    var found = SKILL_LEXICON.filter(function (skill) {
      return haystack.indexOf(skill.toLowerCase()) !== -1;
    });
    return unique(explicit.concat(found)).slice(0, LIST_LIMIT);
  }

  function deriveAdjacentTitles(roles) {
    var out = [];
    roles.forEach(function (role) {
      var lower = role.toLowerCase();
      if (lower.indexOf("product") !== -1) {
        out.push("Product Lead", "Growth Product Manager", "Platform Product Manager");
      } else if (lower.indexOf("design") !== -1) {
        out.push("Product Designer", "UX Designer", "Design Systems Designer");
      } else if (lower.indexOf("data") !== -1 || lower.indexOf("analytics") !== -1) {
        out.push("Analytics Engineer", "Data Analyst", "Data Scientist");
      } else if (lower.indexOf("marketing") !== -1 || lower.indexOf("growth") !== -1) {
        out.push("Growth Marketing Manager", "Lifecycle Marketing Manager", "Demand Generation Manager");
      } else if (lower.indexOf("sales") !== -1 || lower.indexOf("revenue") !== -1) {
        out.push("Revenue Operations Manager", "Sales Operations Manager", "GTM Operations Manager");
      } else if (lower.indexOf("engineer") !== -1 || lower.indexOf("developer") !== -1) {
        out.push("Backend Engineer", "Full Stack Engineer", "Platform Engineer");
      }
    });
    return unique(out).slice(0, LIST_LIMIT);
  }

  function deriveIndustries(profile, preferences, text) {
    var explicit = splitList(preferences.industriesToEmphasize);
    var fromProfile = splitList(profile.industries);
    var haystack = String([profile.keywordsInclude, text].join(" ")).toLowerCase();
    var inferred = [];
    [
      "ai",
      "healthcare",
      "fintech",
      "education",
      "climate",
      "developer tools",
      "commerce",
      "media",
      "saas",
      "security",
    ].forEach(function (industry) {
      if (haystack.indexOf(industry) !== -1) inferred.push(industry);
    });
    return unique(explicit.concat(fromProfile, inferred)).slice(0, LIST_LIMIT);
  }

  function deriveCompanyTypes(profile, preferences, text) {
    var haystack = String(
      [profile.keywordsInclude, preferences.voiceNotes, text].join(" "),
    ).toLowerCase();
    var out = [];
    ["startup", "scaleup", "enterprise", "agency", "remote-first", "mission-driven"].forEach(
      function (type) {
        if (haystack.indexOf(type) !== -1) out.push(type);
      },
    );
    if (!out.length) out = ["startup", "remote-first", "mid-market"];
    return out;
  }

  function sourceLanes(sourcePreset) {
    if (sourcePreset === "ats_only") return ["ats_provider"];
    if (sourcePreset === "browser_only") return ["grounded_web", "serpapi_google_jobs"];
    return ["serpapi_google_jobs", "grounded_web", "ats_provider"];
  }

  function pick(values, index) {
    if (!values.length) return "";
    return values[Math.abs(index) % values.length];
  }

  function joinList(values) {
    return unique(values).join(", ");
  }

  function buildProfileSnapshot(input) {
    var profile = sanitizeDiscoveryProfile(input.discoveryProfile || input.profile);
    var resume = input.resume && typeof input.resume === "object" ? input.resume : {};
    var preferences =
      input.preferences && typeof input.preferences === "object"
        ? input.preferences
        : {};
    var schedule = input.schedule && typeof input.schedule === "object" ? input.schedule : {};
    var text = resumeText(resume);
    var snapshot = {
      snapshotVersion: 1,
      targetRoles: splitList(profile.targetRoles),
      locations: splitList(profile.locations),
      remotePolicy: profile.remotePolicy || "",
      seniority: profile.seniority || "",
      keywordsInclude: splitList(profile.keywordsInclude),
      keywordsExclude: splitList(profile.keywordsExclude),
      resumeTextLength: text.length,
      resumeUpdatedAt: cleanString(resume.updatedAt || resume.createdAt || "", 80),
      preferences: {
        tone: cleanString(preferences.tone, 80),
        defaultMaxWords: Number(preferences.defaultMaxWords) || undefined,
        industriesToEmphasize: splitList(preferences.industriesToEmphasize),
        wordsToAvoid: splitList(preferences.wordsToAvoid),
        voiceNotesLength: cleanString(preferences.voiceNotes, 60000).length,
      },
      schedule: {
        local: normalizeScheduleState(schedule.local),
        github: normalizeScheduleState(schedule.github || schedule.cloud),
      },
    };
    snapshot.profileHash = stableHash(snapshot);
    return snapshot;
  }

  function normalizeScheduleState(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var hour = Number(source.hour);
    var minute = Number(source.minute);
    return {
      enabled: source.enabled === true,
      hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : undefined,
      minute:
        Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : undefined,
    };
  }

  function buildSearchPlan(input) {
    var profile = sanitizeDiscoveryProfile(input.discoveryProfile || input.profile);
    var preferences =
      input.preferences && typeof input.preferences === "object"
        ? input.preferences
        : {};
    var text = resumeText(input.resume);
    var requestedAt = cleanString(input.requestedAt, 80) || new Date().toISOString();
    var trigger = cleanString(input.trigger, 80) || "manual";
    var roles = splitList(profile.targetRoles);
    var adjacentTitles = deriveAdjacentTitles(roles);
    var skills = extractSkills(text, profile, preferences);
    var industries = deriveIndustries(profile, preferences, text);
    var locations = splitList(profile.locations);
    var seniority = splitList(profile.seniority);
    var companyTypes = deriveCompanyTypes(profile, preferences, text);
    var lanes = sourceLanes(profile.sourcePreset || "");
    var snapshot = buildProfileSnapshot({
      discoveryProfile: profile,
      resume: input.resume,
      preferences: preferences,
      schedule: input.schedule,
    });
    var scheduled = trigger.indexOf("scheduled") === 0;
    var seed = stableHash({
      date: scheduled ? dateKey(requestedAt) : requestedAt,
      variationKey: scheduled ? "" : cleanString(input.variationKey, 120),
      trigger: trigger,
      profileHash: snapshot.profileHash,
    });
    var index = parseInt(seed.slice(0, 8), 16) || 0;
    var role = pick(roles, index);
    var adjacent = pick(adjacentTitles, index + 1);
    var skill = pick(skills, index + 2);
    var industry = pick(industries, index + 3);
    var location = pick(locations, index + 4);
    var level = pick(seniority, index + 5);
    var companyType = pick(companyTypes, index + 6);
    var lane = pick(lanes, index + 7);
    var query = {
      targetRoles: joinList([role, adjacent].filter(Boolean)) || profile.targetRoles,
      locations: location || profile.locations,
      seniority: level || profile.seniority,
      remotePolicy: profile.remotePolicy || "",
      keywordsInclude:
        joinList([skill, industry, companyType].concat(splitList(profile.keywordsInclude))) ||
        profile.keywordsInclude,
      keywordsExclude: profile.keywordsExclude || "",
      sourcePreset: profile.sourcePreset || "",
    };
    return {
      planVersion: 1,
      generatedAt: requestedAt,
      trigger: trigger,
      seed: seed,
      rotationKey: scheduled ? dateKey(requestedAt) : cleanString(input.variationKey, 120),
      rotationIndex: index,
      selected: {
        role: role,
        adjacentTitle: adjacent,
        skill: skill,
        industry: industry,
        location: location,
        seniority: level,
        companyType: companyType,
        sourceLane: lane,
      },
      facets: {
        roles: roles,
        adjacentTitles: adjacentTitles,
        skills: skills,
        industries: industries,
        locations: locations,
        seniority: seniority,
        companyTypes: companyTypes,
        sourceLanes: lanes,
      },
      query: query,
      profileHash: snapshot.profileHash,
    };
  }

  function generateVariationKey(input) {
    var requestedAt = cleanString(input && input.requestedAt, 80) || new Date().toISOString();
    var trigger = cleanString(input && input.trigger, 80) || "manual";
    var profile = sanitizeDiscoveryProfile((input && input.discoveryProfile) || {});
    var snapshot = buildProfileSnapshot({
      discoveryProfile: profile,
      resume: input && input.resume,
      preferences: input && input.preferences,
      schedule: input && input.schedule,
    });
    return [
      trigger.indexOf("scheduled") === 0 ? "daily" : "manual",
      dateKey(requestedAt).replace(/-/g, ""),
      stableHash({ requestedAt: requestedAt, trigger: trigger, hash: snapshot.profileHash }),
    ].join("-");
  }

  function buildDiscoveryWebhookPayload(input) {
    var source = input && typeof input === "object" ? input : {};
    var requestedAt = cleanString(source.requestedAt, 80) || new Date().toISOString();
    var trigger = cleanString(source.trigger, 80) || "";
    var discoveryProfile = sanitizeDiscoveryProfile(
      source.discoveryProfile || source.profile,
    );
    var variationKey =
      cleanString(source.variationKey, 160) ||
      generateVariationKey({
        requestedAt: requestedAt,
        trigger: trigger,
        discoveryProfile: discoveryProfile,
        resume: source.resume,
        preferences: source.preferences,
        schedule: source.schedule,
      });
    var profileSnapshot = buildProfileSnapshot({
      discoveryProfile: discoveryProfile,
      resume: source.resume,
      preferences: source.preferences,
      schedule: source.schedule,
    });
    var searchPlan = buildSearchPlan({
      discoveryProfile: discoveryProfile,
      resume: source.resume,
      preferences: source.preferences,
      schedule: source.schedule,
      requestedAt: requestedAt,
      variationKey: variationKey,
      trigger: trigger || "manual",
    });
    var allow = sanitizeCompanies(discoveryProfile.companyAllowlist);
    var block = sanitizeCompanies(discoveryProfile.companyBlocklist);
    var wireProfile = Object.assign({}, discoveryProfile, {
      profileSnapshot: profileSnapshot,
      searchPlan: searchPlan,
    });
    delete wireProfile.companyAllowlist;
    delete wireProfile.companyBlocklist;
    if (!wireProfile.sourcePreset) delete wireProfile.sourcePreset;
    return {
      event: "command-center.discovery",
      schemaVersion: 1,
      sheetId: cleanString(source.sheetId, 240),
      variationKey: variationKey,
      requestedAt: requestedAt,
      ...(trigger ? { trigger: trigger } : {}),
      discoveryProfile: wireProfile,
      ...(cleanString(source.googleAccessToken, 4096)
        ? { googleAccessToken: cleanString(source.googleAccessToken, 4096) }
        : {}),
      ...(allow.length ? { companyAllowlist: allow } : {}),
      ...(block.length ? { companyBlocklist: block } : {}),
    };
  }

  return {
    buildDiscoveryWebhookPayload: buildDiscoveryWebhookPayload,
    buildProfileSnapshot: buildProfileSnapshot,
    buildSearchPlan: buildSearchPlan,
    generateVariationKey: generateVariationKey,
    sanitizeCompanies: sanitizeCompanies,
    sanitizeDiscoveryProfile: sanitizeDiscoveryProfile,
    splitList: splitList,
    stableHash: stableHash,
  };
});
