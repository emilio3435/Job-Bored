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
  // HOLES HUNT (spec §0.5, §0.10): every plan reserves this share of its
  // rotation slots for picks no past run has tried; never fewer than one.
  var DEFAULT_EXPLORATION_SHARE = 0.3;
  var NOVELTY_HISTORY_LIMIT = 200;
  var COMBO_SEARCH_LIMIT = 64;
  // The rotating picks of a plan, in seeded-offset order (role is index+0 and
  // is not a rotation slot: every target role stays in the query).
  var ROTATION_SLOTS = [
    { key: "adjacentTitle", facet: "adjacentTitles", offset: 1 },
    { key: "skill", facet: "skills", offset: 2 },
    { key: "industry", facet: "industries", offset: 3 },
    { key: "location", facet: "locations", offset: 4 },
    { key: "seniority", facet: "seniority", offset: 5 },
    { key: "companyType", facet: "companyTypes", offset: 6 },
    { key: "sourceLane", facet: "sourceLanes", offset: 7 },
  ];
  var OVERRIDE_QUERY_KEYS = [
    "targetRoles",
    "locations",
    "seniority",
    "keywordsInclude",
    "keywordsExclude",
    "remotePolicy",
    "sourcePreset",
  ];
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

  function sourceLanes(sourcePreset, groundedWebEnabled) {
    if (sourcePreset === "ats_only") return ["ats_provider"];
    if (sourcePreset === "browser_only") {
      return groundedWebEnabled === false
        ? ["serpapi_google_jobs"]
        : ["grounded_web", "serpapi_google_jobs"];
    }
    return groundedWebEnabled === false
      ? ["serpapi_google_jobs", "ats_provider"]
      : ["serpapi_google_jobs", "grounded_web", "ats_provider"];
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

  function normalizeExplorationShare(raw) {
    var n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return DEFAULT_EXPLORATION_SHARE;
    }
    if (n > 1 && n <= 100) n = n / 100;
    if (n <= 0) return 0;
    if (n >= 1) return 1;
    return Math.round(n * 100) / 100;
  }

  function noveltyKey(value) {
    return cleanString(value, 180).toLowerCase();
  }

  function comboKey(selected) {
    return ROTATION_SLOTS.map(function (slot) {
      return noveltyKey(selected && selected[slot.key]);
    }).join("|");
  }

  // History entries may be plans, `{ selected }` objects, or run summaries
  // that carry `searchPlan`. Only the rotation picks matter.
  function readNoveltyHistory(raw) {
    var list = Array.isArray(raw)
      ? raw
      : raw && Array.isArray(raw.history)
        ? raw.history
        : [];
    var triedValues = {};
    var triedCombos = {};
    var count = 0;
    list.slice(0, NOVELTY_HISTORY_LIMIT).forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      var plan =
        entry.searchPlan && typeof entry.searchPlan === "object"
          ? entry.searchPlan
          : entry;
      var selected =
        plan.selected && typeof plan.selected === "object" ? plan.selected : plan;
      var any = false;
      ROTATION_SLOTS.forEach(function (slot) {
        var value = noveltyKey(selected[slot.key]);
        if (!value) return;
        any = true;
        triedValues[slot.key] = triedValues[slot.key] || {};
        triedValues[slot.key][value] = true;
      });
      if (!any) return;
      count += 1;
      triedCombos[comboKey(selected)] = true;
    });
    return { triedValues: triedValues, triedCombos: triedCombos, count: count };
  }

  function wasTried(history, key, value) {
    var seen = history.triedValues[key];
    return Boolean(seen && seen[noveltyKey(value)]);
  }

  // The reserved share takes never-tried values, then never-tried
  // combinations; the exploit slots keep their seeded picks untouched.
  function applyExploration(picks, facets, index, share, history) {
    var withValues = ROTATION_SLOTS.filter(function (slot) {
      return facets[slot.facet].length > 0;
    });
    var total = withValues.length;
    var slotCount = total
      ? Math.min(total, Math.max(1, Math.round(share * total)))
      : 0;
    var start = total ? index % total : 0;
    var rotated = withValues.map(function (_, i) {
      return withValues[(start + i) % total];
    });
    var hasUntried = function (slot) {
      return facets[slot.facet].some(function (value) {
        return !wasTried(history, slot.key, value);
      });
    };
    var reserved = rotated
      .filter(hasUntried)
      .concat(
        rotated.filter(function (slot) {
          return !hasUntried(slot);
        }),
      )
      .slice(0, slotCount);
    var candidates = reserved.map(function (slot) {
      var values = facets[slot.facet];
      var ordered = values.map(function (_, j) {
        return values[(index + slot.offset + j) % values.length];
      });
      return ordered
        .filter(function (value) {
          return !wasTried(history, slot.key, value);
        })
        .concat(
          ordered.filter(function (value) {
            return wasTried(history, slot.key, value);
          }),
        );
    });
    var next = Object.assign({}, picks);
    var assign = function (digits) {
      reserved.forEach(function (slot, i) {
        next[slot.key] = candidates[i][digits[i]];
      });
    };
    var digits = reserved.map(function () {
      return 0;
    });
    assign(digits);
    if (history.count && history.triedCombos[comboKey(next)]) {
      var found = false;
      for (var step = 1; step < COMBO_SEARCH_LIMIT && !found; step += 1) {
        var i = digits.length - 1;
        while (i >= 0) {
          digits[i] += 1;
          if (digits[i] < candidates[i].length) break;
          digits[i] = 0;
          i -= 1;
        }
        if (i < 0) break;
        assign(digits);
        found = !history.triedCombos[comboKey(next)];
      }
      if (!found) {
        assign(
          reserved.map(function () {
            return 0;
          }),
        );
      }
    }
    var reservedKeys = reserved.map(function (slot) {
      return slot.key;
    });
    return {
      picks: next,
      exploration: {
        share: share,
        slotCount: reserved.length,
        slots: reserved.map(function (slot) {
          return {
            facet: slot.key,
            value: next[slot.key],
            novel: !wasTried(history, slot.key, next[slot.key]),
          };
        }),
        exploit: ROTATION_SLOTS.filter(function (slot) {
          return reservedKeys.indexOf(slot.key) === -1;
        }).map(function (slot) {
          return slot.key;
        }),
        novelCombo: !history.triedCombos[comboKey(next)],
        historySize: history.count,
      },
    };
  }

  // A hunt's searchPlanOverride is a plan (hitlist cluster or effectivePlan)
  // or a bare query (tweaks). Its search terms replace the profile's; a plan's
  // own rotation picks are not the user's includes (INTERFACE-HUNTS §7).
  function applySearchPlanOverride(profile, override) {
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      return profile;
    }
    var planShaped = override.query && typeof override.query === "object";
    var query = planShaped ? override.query : override;
    var facets =
      planShaped && override.facets && typeof override.facets === "object"
        ? override.facets
        : {};
    var selected =
      planShaped && override.selected && typeof override.selected === "object"
        ? override.selected
        : {};
    var present = OVERRIDE_QUERY_KEYS.some(function (key) {
      return typeof query[key] === "string";
    });
    if (!present) return profile;
    var next = Object.assign({}, profile);
    var fromFacet = function (list, raw) {
      var values = Array.isArray(list) ? unique(list) : [];
      return values.length ? values.join(", ") : cleanString(raw);
    };
    if (typeof query.targetRoles === "string" || Array.isArray(facets.roles)) {
      next.targetRoles = fromFacet(facets.roles, query.targetRoles);
    }
    if (typeof query.locations === "string" || Array.isArray(facets.locations)) {
      next.locations = fromFacet(facets.locations, query.locations);
    }
    if (typeof query.seniority === "string" || Array.isArray(facets.seniority)) {
      next.seniority = fromFacet(facets.seniority, query.seniority);
    }
    if (typeof query.keywordsInclude === "string") {
      var rotation = ["skill", "industry", "companyType"].map(function (key) {
        return noveltyKey(selected[key]);
      });
      next.keywordsInclude = splitList(query.keywordsInclude)
        .filter(function (value) {
          return rotation.indexOf(noveltyKey(value)) === -1;
        })
        .join(", ");
    }
    if (typeof query.keywordsExclude === "string") {
      next.keywordsExclude = cleanString(query.keywordsExclude);
    }
    if (typeof query.remotePolicy === "string") {
      next.remotePolicy = cleanString(query.remotePolicy);
    }
    if (typeof query.sourcePreset === "string") {
      var preset = normalizeSourcePreset(query.sourcePreset);
      if (preset) next.sourcePreset = preset;
      else delete next.sourcePreset;
    }
    return next;
  }

  // In the browser, hunts-store.js keeps the past plans; Node callers
  // (scripts, tests) have no store and plan from an empty history.
  function runtimeNovelty() {
    var store =
      typeof globalThis !== "undefined" ? globalThis.JobBoredHuntsStore : null;
    if (!store || typeof store.noveltyContext !== "function") return null;
    try {
      return store.noveltyContext();
    } catch (_) {
      return null;
    }
  }

  function buildSearchPlan(input) {
    var profile = applySearchPlanOverride(
      sanitizeDiscoveryProfile(input.discoveryProfile || input.profile),
      input.searchPlanOverride,
    );
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
    var lanes = sourceLanes(
      profile.sourcePreset || "",
      profile.groundedWebEnabled,
    );
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
    var facets = {
      roles: roles,
      adjacentTitles: adjacentTitles,
      skills: skills,
      industries: industries,
      locations: locations,
      seniority: seniority,
      companyTypes: companyTypes,
      sourceLanes: lanes,
    };
    var seeded = {};
    ROTATION_SLOTS.forEach(function (slot) {
      seeded[slot.key] = pick(facets[slot.facet], index + slot.offset);
    });
    var novelty =
      input.novelty && typeof input.novelty === "object" ? input.novelty : null;
    var explored = applyExploration(
      seeded,
      facets,
      index,
      normalizeExplorationShare(
        input.explorationShare != null
          ? input.explorationShare
          : novelty && novelty.explorationShare,
      ),
      readNoveltyHistory(novelty),
    );
    var adjacent = explored.picks.adjacentTitle;
    var skill = explored.picks.skill;
    var industry = explored.picks.industry;
    var location = explored.picks.location;
    var level = explored.picks.seniority;
    var companyType = explored.picks.companyType;
    var lane = explored.picks.sourceLane;
    var query = {
      // UX01 C9 (FD-09): every role the user typed stays in the query; the
      // rotation only ADDS one adjacent title as "also trying". It used to
      // pick one of the user's roles and drop the rest.
      targetRoles:
        joinList(roles.concat([adjacent]).filter(Boolean)) || profile.targetRoles,
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
        alsoTrying: adjacent && roles.indexOf(adjacent) === -1 ? [adjacent] : [],
      },
      facets: facets,
      query: query,
      profileHash: snapshot.profileHash,
      exploration: explored.exploration,
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
    // HOLES HUNT §1: `hunt` is a pass-through ({ id, searchPlanOverride }).
    // /webhook carries no hunt reference (INTERFACE-HUNTS §4.3), so only the
    // override reaches the plan; the id stays in the browser.
    var hunt =
      source.hunt && typeof source.hunt === "object" ? source.hunt : {};
    var searchPlan = buildSearchPlan({
      discoveryProfile: discoveryProfile,
      resume: source.resume,
      preferences: source.preferences,
      schedule: source.schedule,
      requestedAt: requestedAt,
      variationKey: variationKey,
      trigger: trigger || "manual",
      searchPlanOverride: hunt.searchPlanOverride || source.searchPlanOverride,
      explorationShare:
        source.explorationShare != null
          ? source.explorationShare
          : hunt.explorationShare,
      novelty:
        source.novelty && typeof source.novelty === "object"
          ? source.novelty
          : runtimeNovelty(),
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
      // Webhook v1.1 (BEAUDIT A20): a caller that stamps one key per user
      // action passes it through; the worker hashes it into the runId.
      ...(cleanString(source.idempotencyKey, 200)
        ? { idempotencyKey: cleanString(source.idempotencyKey, 200) }
        : {}),
      discoveryProfile: wireProfile,
      ...(cleanString(source.googleAccessToken, 4096)
        ? { googleAccessToken: cleanString(source.googleAccessToken, 4096) }
        : {}),
      ...(allow.length ? { companyAllowlist: allow } : {}),
      // A dashboard allowlist is a PREFERENCE, not a reference into the
      // worker's curated catalog — which a local install ships empty, so
      // every name resolves "unknown" and the run fails closed with
      // "companyAllowlist did not match the configured company catalog"
      // (2026-09-02). The contract's own escape hatch is this flag, so the
      // dashboard opts in whenever it sends a list. An explicit `false`
      // from a caller that wants fail-closed is preserved below.
      ...(source.allowUnrestrictedFallback === false
        ? { allowUnrestrictedFallback: false }
        : allow.length
          ? { allowUnrestrictedFallback: true }
          : {}),
      ...(block.length ? { companyBlocklist: block } : {}),
      // Optional non-secret master Fit Profile merged with per-run overrides.
      // Passed through verbatim; the worker re-validates it via ajv.
      ...(source.mergedUserProfile && typeof source.mergedUserProfile === "object"
        ? { mergedUserProfile: source.mergedUserProfile }
        : {}),
    };
  }

  return {
    buildDiscoveryWebhookPayload: buildDiscoveryWebhookPayload,
    buildProfileSnapshot: buildProfileSnapshot,
    buildSearchPlan: buildSearchPlan,
    generateVariationKey: generateVariationKey,
    normalizeExplorationShare: normalizeExplorationShare,
    sanitizeCompanies: sanitizeCompanies,
    sanitizeDiscoveryProfile: sanitizeDiscoveryProfile,
    splitList: splitList,
    stableHash: stableHash,
  };
});
