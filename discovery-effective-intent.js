/* Shared effective-discovery-intent helper (browser + Node tests).
 *
 * One object used by the run guard, payload builder, query plan, and worker
 * parser. Isolated module: index.html must load this before discovery-payload.js
 * and discovery-run-orchestration.js (orchestrator hotspot).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JobBoredEffectiveIntent = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var GROUP_KEYS = ["sheets", "workers", "workspaces", "bySheetId", "configs"];
  var ATS_SOURCE_IDS = [
    "greenhouse",
    "lever",
    "ashby",
    "smartrecruiters",
    "workday",
    "icims",
    "jobvite",
    "taleo",
    "successfactors",
    "workable",
    "breezy",
    "recruitee",
    "teamtailor",
    "personio",
  ];

  function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function cleanString(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function unique(values) {
    var seen = {};
    var out = [];
    values.forEach(function (value) {
      var s = cleanString(value);
      var key = s.toLowerCase();
      if (!s || seen[key]) return;
      seen[key] = true;
      out.push(s);
    });
    return out;
  }

  function splitList(value) {
    if (Array.isArray(value)) {
      return unique(
        value.map(function (item) {
          return cleanString(item);
        }),
      );
    }
    return unique(
      String(value == null ? "" : value)
        .split(/[\n;,|]+|(?:\s+\/\s+)/g)
        .map(function (item) {
          return cleanString(item);
        }),
    );
  }

  function firstNonEmptyLists() {
    for (var i = 0; i < arguments.length; i += 1) {
      var list = arguments[i];
      if (Array.isArray(list) && list.length) return list;
    }
    return [];
  }

  function companyFilterKey(company) {
    if (!company || typeof company !== "object") return "";
    return cleanString(
      company.companyKey || company.normalizedName || company.name,
    ).toLowerCase();
  }

  function companyMatchKeys(company) {
    if (!company || typeof company !== "object") return [];
    var raw = [
      company.companyKey,
      company.normalizedName,
      company.name,
    ].map(function (value) {
      return cleanString(value).toLowerCase();
    }).filter(Boolean);
    var extra = [];
    raw.forEach(function (key) {
      extra.push(key.replace(/\s+/g, "-"));
      extra.push(key.replace(/-/g, " "));
    });
    return unique(raw.concat(extra));
  }

  function keySet(values) {
    var set = {};
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var key = cleanString(value).toLowerCase();
      if (key) set[key] = true;
    });
    return set;
  }

  function dedupeCompanies(companies) {
    var seen = {};
    var out = [];
    (Array.isArray(companies) ? companies : []).forEach(function (company) {
      var key = companyFilterKey(company);
      if (!key) {
        out.push(company);
        return;
      }
      if (seen[key]) return;
      seen[key] = true;
      out.push(company);
    });
    return out;
  }

  function filterBySet(companies, blocked, keep) {
    return (Array.isArray(companies) ? companies : []).filter(function (company) {
      var keys = companyMatchKeys(company);
      if (!keys.length) return keep;
      var hit = keys.some(function (key) {
        return !!blocked[key];
      });
      return keep ? hit : !hit;
    });
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function buildEffectiveIntent(input) {
    var source = input && typeof input === "object" ? input : {};
    var profile =
      source.discoveryProfile && typeof source.discoveryProfile === "object"
        ? source.discoveryProfile
        : {};
    var searchPlan =
      profile.searchPlan && typeof profile.searchPlan === "object"
        ? profile.searchPlan
        : {};
    var query =
      searchPlan.query && typeof searchPlan.query === "object"
        ? searchPlan.query
        : {};
    var snapshot =
      profile.profileSnapshot && typeof profile.profileSnapshot === "object"
        ? profile.profileSnapshot
        : {};
    var merged =
      source.mergedUserProfile && typeof source.mergedUserProfile === "object"
        ? source.mergedUserProfile
        : {};
    var identity =
      merged.identity && typeof merged.identity === "object"
        ? merged.identity
        : {};

    var targetRoles = firstNonEmptyLists(
      splitList(profile.targetRoles),
      splitList(query.targetRoles),
      splitList(snapshot.targetRoles),
      splitList(identity.targetRoles),
    );
    var includeKeywords = firstNonEmptyLists(
      splitList(profile.keywordsInclude),
      splitList(query.keywordsInclude),
      splitList(snapshot.keywordsInclude),
    );
    var excludeKeywords = unique(
      splitList(profile.keywordsExclude).concat(
        splitList(query.keywordsExclude),
        splitList(snapshot.keywordsExclude),
      ),
    );
    var locations = firstNonEmptyLists(
      splitList(profile.locations),
      splitList(query.locations),
      splitList(snapshot.locations),
    );
    var remotePolicy =
      cleanString(profile.remotePolicy) ||
      cleanString(query.remotePolicy) ||
      cleanString(snapshot.remotePolicy) ||
      "";
    var seniority =
      cleanString(profile.seniority) ||
      cleanString(query.seniority) ||
      cleanString(snapshot.seniority) ||
      cleanString(identity.targetSeniority) ||
      "";
    var sourcePreset = cleanString(profile.sourcePreset || query.sourcePreset);
    var groundedWebEnabled =
      profile.groundedWebEnabled === false
        ? false
        : profile.groundedWebEnabled === true
          ? true
          : null;
    var blank = targetRoles.length === 0 && includeKeywords.length === 0;
    return {
      intentContractVersion: 1,
      blank: blank,
      targetRoles: targetRoles,
      includeKeywords: includeKeywords,
      excludeKeywords: excludeKeywords,
      locations: locations,
      remotePolicy: remotePolicy,
      seniority: seniority,
      sourcePreset: sourcePreset,
      groundedWebEnabled: groundedWebEnabled,
    };
  }

  function isBlankIntent(effective) {
    if (!effective || typeof effective !== "object") return true;
    return effective.blank === true;
  }

  function resolveEffectiveSources(input) {
    var source = input && typeof input === "object" ? input : {};
    var enabled = Array.isArray(source.enabledSources)
      ? source.enabledSources.slice()
      : [];
    var preset = cleanString(source.sourcePreset) || "browser_plus_ats";
    var out;
    if (preset === "browser_only") {
      out = enabled.filter(function (id) {
        return id === "grounded_web" || id === "serpapi_google_jobs";
      });
    } else if (preset === "ats_only") {
      out = enabled.filter(function (id) {
        return ATS_SOURCE_IDS.indexOf(id) !== -1;
      });
    } else {
      out = enabled.slice();
    }
    if (source.groundedWebEnabled === false) {
      out = out.filter(function (id) {
        return id !== "grounded_web";
      });
    }
    return out;
  }

  function resolveEffectiveCompanyPools(input) {
    var source = input && typeof input === "object" ? input : {};
    var skip = keySet(source.negativeCompanyKeys);
    var block = keySet(source.companyBlocklist);
    var allowRaw = unique(
      Array.isArray(source.companyAllowlist) ? source.companyAllowlist : [],
    );
    var companies = filterBySet(source.companies, skip, false);
    var atsCompanies = filterBySet(source.atsCompanies, skip, false);
    var history = filterBySet(source.companyHistory, skip, false);
    var catalog = dedupeCompanies(companies.concat(history, atsCompanies));
    var catalogKeys = keySet(
      catalog.map(function (company) {
        return companyFilterKey(company);
      }),
    );
    var allowUnrestrictedFallback = source.allowUnrestrictedFallback === true;
    var allowlistResolution = {
      mode: "unrestricted_default",
      matched: [],
      unknown: [],
    };

    if (allowRaw.length) {
      var matched = [];
      var unknown = [];
      allowRaw.forEach(function (entry) {
        var key = cleanString(entry).toLowerCase();
        if (catalogKeys[key]) matched.push(key);
        else unknown.push(entry);
      });
      if (!matched.length) {
        if (allowUnrestrictedFallback) {
          allowlistResolution = {
            mode: "explicit_unrestricted",
            matched: [],
            unknown: unknown,
          };
        } else {
          allowlistResolution = {
            mode: "blocked_unresolved",
            matched: [],
            unknown: unknown,
          };
          return {
            companies: [],
            atsCompanies: [],
            allowlistResolution: allowlistResolution,
            allowUnrestrictedFallback: false,
          };
        }
      } else {
        var allow = {};
        matched.forEach(function (key) {
          allow[key] = true;
        });
        allowlistResolution = {
          mode: "restricted",
          matched: matched,
          unknown: unknown,
        };
        companies = filterBySet(dedupeCompanies(companies.concat(history)), allow, true);
        atsCompanies = filterBySet(atsCompanies, allow, true);
      }
    }

    companies = filterBySet(companies, block, false);
    atsCompanies = filterBySet(atsCompanies, block, false);
    return {
      companies: companies,
      atsCompanies: atsCompanies,
      allowlistResolution: allowlistResolution,
      allowUnrestrictedFallback: allowUnrestrictedFallback,
    };
  }

  function applySheetConfigMutation(raw, sheetId, mutations) {
    var source = isPlainObject(raw) ? cloneJson(raw) : {};
    var patch = isPlainObject(mutations) ? mutations : {};
    var id = cleanString(sheetId);
    for (var i = 0; i < GROUP_KEYS.length; i += 1) {
      var key = GROUP_KEYS[i];
      if (!isPlainObject(source[key])) continue;
      var group = source[key];
      var current = isPlainObject(group[id]) ? group[id] : {};
      var next = {};
      Object.keys(current).forEach(function (field) {
        next[field] = current[field];
      });
      Object.keys(patch).forEach(function (field) {
        next[field] = patch[field];
      });
      group[id] = next;
      return source;
    }
    var flat = {};
    Object.keys(source).forEach(function (field) {
      flat[field] = source[field];
    });
    Object.keys(patch).forEach(function (field) {
      flat[field] = patch[field];
    });
    return flat;
  }

  return {
    buildEffectiveIntent: buildEffectiveIntent,
    isBlankIntent: isBlankIntent,
    resolveEffectiveSources: resolveEffectiveSources,
    resolveEffectiveCompanyPools: resolveEffectiveCompanyPools,
    applySheetConfigMutation: applySheetConfigMutation,
  };
});
