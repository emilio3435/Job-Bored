/* global module */
/* HOLES HUNT-FE: the hitlist, i.e. the user's past searches clustered and
   ranked by yield. GET /hunts/hitlist does this on the worker; this module
   mirrors that contract (docs/INTERFACE-HUNTS.md §3.3, §7) so the Hunts panel
   can rebuild the list from cached run history when the worker is offline.
   Pure functions; classic UMD global (browser + node:test). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JobBoredHuntsHitlist = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var TREND_LIMIT = 10;
  var HALF_LIFE_DAYS = 14;
  var DAY_MS = 86400000;
  // GET /hunts/hitlist considers terminal runs that recorded a searchPlan.
  var HITLIST_STATUSES = ["completed", "partial", "empty", "write_failed"];

  /* ---- search key (§7): byte-for-byte the worker's buildSearchKey ---- */

  function normalizeSearchTerm(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function dedupe(values) {
    var seen = {};
    return values.filter(function (value) {
      if (Object.prototype.hasOwnProperty.call(seen, value)) return false;
      seen[value] = true;
      return true;
    });
  }

  function splitSearchList(value) {
    return dedupe(
      String(value || "")
        .split(/[,;\n]/)
        .map(normalizeSearchTerm)
        .filter(Boolean),
    );
  }

  function facetOrQuery(facet, queryValue) {
    var fromFacet = dedupe(
      (Array.isArray(facet) ? facet : []).map(normalizeSearchTerm).filter(Boolean),
    );
    return fromFacet.length ? fromFacet : splitSearchList(queryValue);
  }

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function searchKeyParts(plan) {
    var source = asObject(plan);
    var query = asObject(source.query);
    var facets = asObject(source.facets);
    var selected = asObject(source.selected);
    var rotationPicks = [selected.skill, selected.industry, selected.companyType]
      .map(normalizeSearchTerm)
      .filter(Boolean);
    return {
      roles: facetOrQuery(facets.roles, query.targetRoles),
      locations: facetOrQuery(facets.locations, query.locations),
      seniority: facetOrQuery(facets.seniority, query.seniority),
      includes: splitSearchList(query.keywordsInclude).filter(function (term) {
        return rotationPicks.indexOf(term) === -1;
      }),
      excludes: splitSearchList(query.keywordsExclude),
      remotePolicy: normalizeSearchTerm(query.remotePolicy),
      sourcePreset: normalizeSearchTerm(query.sourcePreset),
    };
  }

  function canonicalSearch(plan) {
    var parts = searchKeyParts(plan);
    return JSON.stringify({
      roles: parts.roles.slice().sort(),
      locations: parts.locations.slice().sort(),
      seniority: parts.seniority.slice().sort(),
      includes: parts.includes.slice().sort(),
      excludes: parts.excludes.slice().sort(),
      remotePolicy: parts.remotePolicy,
      sourcePreset: parts.sourcePreset,
    });
  }

  function hex(buffer) {
    return Array.prototype.map
      .call(new Uint8Array(buffer), function (byte) {
        return byte.toString(16).padStart(2, "0");
      })
      .join("");
  }

  /** `sk_` + 16 hex of sha256(canonical search). Resolves "" without WebCrypto. */
  function searchKeyOf(plan) {
    var subtle = root && root.crypto && root.crypto.subtle;
    if (!subtle || typeof TextEncoder !== "function") return Promise.resolve("");
    return subtle
      .digest("SHA-256", new TextEncoder().encode(canonicalSearch(plan)))
      .then(function (digest) {
        return "sk_" + hex(digest).slice(0, 16);
      })
      .catch(function () {
        return "";
      });
  }

  /** "roles · locations · seniority", lowercased, as the worker labels it. */
  function searchLabelOf(plan) {
    var parts = searchKeyParts(plan);
    return [
      parts.roles.slice(0, 3).join(", "),
      parts.locations.slice(0, 3).join(", "),
      parts.seniority.join(", "),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  /* ---- run yield ---- */

  function count(value) {
    var n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function fitOf(value) {
    var n = Number(value);
    return value != null && value !== "" && Number.isFinite(n) ? n : null;
  }

  /** A GET /runs summary (headline counts) or a cached local run record. */
  function runYield(run) {
    var source = asObject(run);
    var headline = asObject(source.headline);
    return {
      written: count(headline.written != null ? headline.written : source.written),
      updated: count(headline.updated != null ? headline.updated : source.updated),
      fitAvg: fitOf(headline.fitAvg != null ? headline.fitAvg : source.fitAvg),
    };
  }

  function runTime(run) {
    var source = asObject(run);
    return String(source.completedAt || source.startedAt || source.at || "");
  }

  function timeMs(value) {
    var ms = Date.parse(String(value || ""));
    return Number.isFinite(ms) ? ms : 0;
  }

  /* ---- ranking (§7) ---- */

  function rankScore(cluster, nowMs) {
    var c = asObject(cluster);
    var runs = Math.max(1, count(c.runCount));
    var fitFactor = c.meanFit == null ? 1 : 0.5 + Number(c.meanFit) / 10;
    var days = Math.max(0, (nowMs - timeMs(c.lastRunAt)) / DAY_MS);
    return (count(c.leadsWritten) / runs) * fitFactor * Math.pow(0.5, days / HALF_LIFE_DAYS);
  }

  function roundTo(value, digits) {
    var factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function compareClusters(a, b) {
    return (
      b.score - a.score ||
      Number(b.repeating) - Number(a.repeating) ||
      String(b.lastRunAt).localeCompare(String(a.lastRunAt))
    );
  }

  /**
   * Cluster cached runs into hitlist entries, worker-shaped. `runs` are
   * GET /runs summaries (or local records) that carry `searchPlan`; `hunts`
   * mark which clusters are already saved.
   */
  function deriveHitlist(runs, options) {
    var opts = asObject(options);
    var nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
    var limit = Math.min(50, Math.max(1, count(opts.limit) || 20));
    var hunts = Array.isArray(opts.hunts) ? opts.hunts : [];
    var eligible = (Array.isArray(runs) ? runs : []).filter(function (run) {
      var source = asObject(run);
      return (
        source.searchPlan &&
        typeof source.searchPlan === "object" &&
        runTime(source) &&
        HITLIST_STATUSES.indexOf(String(source.status || "")) !== -1
      );
    });
    return Promise.all(
      eligible.map(function (run) {
        return run.searchKey
          ? Promise.resolve(String(run.searchKey))
          : searchKeyOf(run.searchPlan);
      }),
    ).then(function (keys) {
      var byKey = {};
      var order = [];
      eligible.forEach(function (run, i) {
        var key = keys[i] || "local:" + canonicalSearch(run.searchPlan);
        if (!byKey[key]) {
          byKey[key] = [];
          order.push(key);
        }
        byKey[key].push(run);
      });
      var clusters = order.map(function (key) {
        var group = byKey[key].slice().sort(function (a, b) {
          return (
            runTime(b).localeCompare(runTime(a)) ||
            String(b.runId || "").localeCompare(String(a.runId || ""))
          );
        });
        var newest = group[0];
        var fits = [];
        var written = 0;
        var updated = 0;
        var trend = group.map(function (run) {
          var y = runYield(run);
          written += y.written;
          updated += y.updated;
          if (y.fitAvg != null) fits.push(y.fitAvg);
          var point = {
            runId: String(run.runId || ""),
            at: runTime(run),
            written: y.written,
            updated: y.updated,
          };
          if (y.fitAvg != null) point.fitAvg = y.fitAvg;
          return point;
        });
        var saved = hunts.filter(function (hunt) {
          return hunt && hunt.searchKey === key;
        })[0];
        var cluster = {
          key: key,
          label: searchLabelOf(newest.searchPlan),
          searchPlan: newest.searchPlan,
          runCount: group.length,
          repeating: group.length >= 2,
          leadsWritten: written,
          leadsUpdated: updated,
          meanFit: fits.length
            ? roundTo(
                fits.reduce(function (sum, n) {
                  return sum + n;
                }, 0) / fits.length,
                2,
              )
            : null,
          lastRunAt: runTime(newest),
          lastRunId: String(newest.runId || ""),
          trend: trend.slice(0, TREND_LIMIT),
          huntId: saved ? saved.id : null,
        };
        cluster.score = roundTo(rankScore(cluster, nowMs), 4);
        return cluster;
      });
      clusters.sort(compareClusters);
      return {
        ok: true,
        generatedAt: new Date(nowMs).toISOString(),
        runsConsidered: eligible.length,
        clusters: clusters.slice(0, limit),
      };
    });
  }

  /* ---- trend ---- */

  function mean(values) {
    if (!values.length) return 0;
    return (
      values.reduce(function (sum, n) {
        return sum + n;
      }, 0) / values.length
    );
  }

  /**
   * Direction of "new" leads per run. `trend` is newest first; compares the
   * newer half of the runs with the older half.
   */
  function trendDirection(trend) {
    var points = (Array.isArray(trend) ? trend : []).map(function (point) {
      return count(asObject(point).written);
    });
    if (points.length < 2) return "new";
    var half = Math.ceil(points.length / 2);
    var recent = mean(points.slice(0, half));
    var older = mean(points.slice(half));
    var delta = recent - older;
    if (Math.abs(delta) < Math.max(0.5, older * 0.1)) return "flat";
    return delta > 0 ? "up" : "down";
  }

  return {
    HITLIST_STATUSES: HITLIST_STATUSES,
    canonicalSearch: canonicalSearch,
    deriveHitlist: deriveHitlist,
    rankScore: rankScore,
    runYield: runYield,
    searchKeyOf: searchKeyOf,
    searchKeyParts: searchKeyParts,
    searchLabelOf: searchLabelOf,
    splitSearchList: splitSearchList,
    trendDirection: trendDirection,
  };
});
