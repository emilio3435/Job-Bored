/* global module */
/* Pure effective discovery-run presenter (browser + Node tests). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JobBoredDiscoveryRunPreview = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var UNKNOWN_ALLOWLIST_WARNING =
    "Allowlist match status is unknown; unknown entries may broaden/no-op this run.";

  function fail(code, message) {
    var error = new Error(message);
    error.code = code;
    throw error;
  }

  function clean(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) {
      var key = value.toLowerCase();
      if (!value || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function list(value) {
    var values = Array.isArray(value)
      ? value
      : clean(value)
        ? String(value).split(/[\n;,|]+|(?:\s+\/\s+)/g)
        : [];
    return unique(
      values
        .map(function (entry) {
          return clean(entry);
        })
        .filter(Boolean),
    );
  }

  function canonicalPayload(payload) {
    var sharedBuilder = root && root.JobBoredDiscoveryPayload;
    if (
      !sharedBuilder ||
      typeof sharedBuilder.buildDiscoveryWebhookPayload !== "function"
    ) {
      fail(
        "SHARED_DISCOVERY_BUILDER_UNAVAILABLE",
        "Discovery run preview requires window.JobBoredDiscoveryPayload.",
      );
    }
    var profile = payload && payload.discoveryProfile;
    if (
      !payload ||
      payload.event !== "command-center.discovery" ||
      payload.schemaVersion !== 1 ||
      !profile ||
      !profile.profileSnapshot ||
      profile.profileSnapshot.snapshotVersion !== 1 ||
      !profile.searchPlan ||
      profile.searchPlan.planVersion !== 1 ||
      Object.prototype.hasOwnProperty.call(profile, "companyAllowlist") ||
      Object.prototype.hasOwnProperty.call(profile, "companyBlocklist")
    ) {
      fail(
        "NON_CANONICAL_DISCOVERY_PAYLOAD",
        "Discovery run preview refused a fallback-shaped payload.",
      );
    }
    return profile;
  }

  function buildDiscoveryRunPreview(payload) {
    var profile = canonicalPayload(payload);
    var merged =
      payload.mergedUserProfile && typeof payload.mergedUserProfile === "object"
        ? payload.mergedUserProfile
        : null;
    var plan = profile.searchPlan;
    var effectiveApi = root && root.JobBoredEffectiveIntent;
    if (!effectiveApi || typeof effectiveApi.buildEffectiveIntent !== "function") {
      fail(
        "EFFECTIVE_INTENT_UNAVAILABLE",
        "Discovery run preview requires window.JobBoredEffectiveIntent.",
      );
    }
    var effective = effectiveApi.buildEffectiveIntent({
      discoveryProfile: profile,
      mergedUserProfile: merged,
    });
    var roles = effective.targetRoles;
    var locations = effective.locations;
    var includeKeywords = effective.includeKeywords;
    var keywordExclusions = effective.excludeKeywords;
    var profileAvoids = list(merged && merged.avoids);
    var allow = list(payload.companyAllowlist).map(function (value) {
      return { value: value, status: "unknown" };
    });
    var block = list(payload.companyBlocklist).map(function (value) {
      return { value: value, status: "blocked" };
    });
    var lanes = list(plan.facets && plan.facets.sourceLanes);
    var warnings = [];
    if (allow.length) warnings.push(UNKNOWN_ALLOWLIST_WARNING);
    var providerUse = {
      groundedWeb: lanes.indexOf("grounded_web") !== -1,
      serpApiGoogleJobs: lanes.indexOf("serpapi_google_jobs") !== -1,
      atsProvider: lanes.indexOf("ats_provider") !== -1,
      googleSheetsCredential: clean(payload.googleAccessToken)
        ? "dashboard_oauth_token"
        : "worker_config",
    };
    var snapshot = profile.profileSnapshot;
    var preview = {
      request: payload,
      schemaVersion: payload.schemaVersion,
      variationKey: clean(payload.variationKey),
      profileHash: clean(snapshot.profileHash),
      profileUpdatedAt: clean(
        (merged && merged.updatedAt) || snapshot.resumeUpdatedAt,
      ),
      intentMode: merged ? "fit_profile" : "legacy_free_form",
      roles: roles,
      locations: locations,
      includeKeywords: includeKeywords,
      hasIntent: roles.length > 0 || includeKeywords.length > 0,
      companies: { allow: allow, block: block },
      exclusions: {
        keywords: keywordExclusions,
        profileAvoids: profileAvoids,
        companies: block.map(function (entry) {
          return entry.value;
        }),
      },
      sources: {
        preset: clean(effective.sourcePreset),
        lanes: lanes,
        selectedLane: clean(plan.selected && plan.selected.sourceLane),
        groundedWebEnabled: profile.groundedWebEnabled !== false,
      },
      providerUse: providerUse,
      warnings: warnings,
    };
    preview.summaryLines = [
      "Roles: " + (roles.join(", ") || "None"),
      "Locations: " + (locations.join(", ") || "Any"),
      "Allow companies: " +
        (allow.map(function (entry) {
          return entry.value + " (" + entry.status + ")";
        }).join(", ") || "Default stored set"),
      "Block companies: " +
        (block.map(function (entry) {
          return entry.value;
        }).join(", ") || "None"),
      "Exclusions: " +
        (keywordExclusions.concat(profileAvoids).join(", ") || "None"),
      "Source lanes: " + (lanes.join(", ") || "None"),
      "Sheets credential: " + providerUse.googleSheetsCredential,
      "Profile hash: " + (preview.profileHash || "Unknown"),
      "Variation key: " + (preview.variationKey || "Unknown"),
    ].concat(warnings);
    return preview;
  }

  return {
    UNKNOWN_ALLOWLIST_WARNING: UNKNOWN_ALLOWLIST_WARNING,
    buildDiscoveryRunPreview: buildDiscoveryRunPreview,
  };
});
