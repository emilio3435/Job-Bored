/* ============================================
   dossier-field-provenance.js
   Classic-global helper: window.JobBoredDossierProvenance

   Stamps field-level grounding, confidence, source,
   profile revision, freshness/TTL, and unknown state
   onto posting-enrichment payloads so inferred claims
   are never labeled posting-grounded.

   Lane: F3-A (DOSSIER-01). Loaded before role-brief.js
   and posting-enrichment.js once index.html is wired.
   ============================================ */
(function (root) {
  "use strict";

  var DEFAULT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
  var MIN_POSTING_CHARS = 80;
  var POSTING_SOURCES = { cheerio: true, "gemini-url-context": true };
  var CLAIM_FIELDS = [
    "inferredTitle",
    "inferredCompany",
    "inferredLocation",
    "postingSummary",
    "roleInOneLine",
    "mustHaves",
    "responsibilities",
    "niceToHaves",
    "toolsAndStack",
    "atsFitScore",
    "atsFitRationale",
    "fitAngle",
    "talkingPoints",
    "extraKeywords",
  ];

  function fingerprintProfile(excerpt) {
    var s = String(excerpt == null ? "" : excerpt).trim();
    if (!s) return "";
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = Math.imul(h, 33) ^ s.charCodeAt(i);
    }
    return "excerpt:" + s.length + ":" + (h >>> 0).toString(16);
  }

  function descriptionText(enr) {
    if (!enr || typeof enr !== "object") return "";
    return String(enr.description || enr.bodyText || "").trim();
  }

  function resolveSource(enr) {
    if (!enr || typeof enr !== "object") return "";
    var src = String(
      enr._scrapeSource ||
        (enr.provenance && enr.provenance.source) ||
        "",
    ).trim();
    if (src && src !== "unknown") return src;
    if (enr._scrapeBlocked) return "title-and-company";
    return src === "unknown" ? "" : src;
  }

  function resolveGrounding(enr, source) {
    var desc = descriptionText(enr);
    var blocked = !!(enr && enr._scrapeBlocked);
    if (source === "title-and-company" || blocked) return "inferred";
    if (POSTING_SOURCES[source] && !blocked && desc.length >= MIN_POSTING_CHARS) {
      return "posting";
    }
    if (source && !POSTING_SOURCES[source]) return "inferred";
    return "unknown";
  }

  function confidenceFor(grounding, source, descLen) {
    if (grounding === "posting" && source === "cheerio" && descLen > 400) return "high";
    if (grounding === "posting") return "medium";
    if (grounding === "inferred") return "low";
    return "unknown";
  }

  function formatAge(ageMs) {
    if (!Number.isFinite(ageMs) || ageMs < 0) return "fetched time unknown";
    if (ageMs < 60 * 1000) return "fetched just now";
    if (ageMs < 60 * 60 * 1000) {
      return "fetched " + Math.max(1, Math.round(ageMs / 60000)) + "m ago";
    }
    if (ageMs < 24 * 60 * 60 * 1000) {
      return "fetched " + Math.max(1, Math.round(ageMs / 3600000)) + "h ago";
    }
    return "fetched " + Math.max(1, Math.round(ageMs / 86400000)) + "d ago";
  }

  function freshness(enr, nowMs, ttlMs) {
    var scrapedAt = Number(enr && enr.scrapedAt);
    var now = Number.isFinite(nowMs) ? nowMs : Date.now();
    var ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
    if (!Number.isFinite(scrapedAt) || scrapedAt <= 0) {
      return {
        scrapedAt: null,
        ageMs: null,
        ttlMs: ttl,
        stale: true,
        label: "fetched time unknown",
      };
    }
    var age = now - scrapedAt;
    var stale = !Number.isFinite(age) || age > ttl;
    var label = formatAge(age);
    if (stale) label += " · stale";
    return { scrapedAt: scrapedAt, ageMs: age, ttlMs: ttl, stale: stale, label: label };
  }

  function isUnknownValue(val) {
    if (val == null) return true;
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === "number") return !Number.isFinite(val);
    return String(val).trim() === "";
  }

  function stampProvenance(enrichment, opts) {
    var enr = enrichment && typeof enrichment === "object" ? Object.assign({}, enrichment) : {};
    opts = opts || {};
    var source = resolveSource(enr) || "unknown";
    var grounding = resolveGrounding(enr, source === "unknown" ? "" : source);
    var descLen = descriptionText(enr).length;
    var conf = confidenceFor(grounding, source === "unknown" ? "" : source, descLen);
    var profileRevision = opts.profileRevision != null
      ? String(opts.profileRevision)
      : fingerprintProfile(opts.profileExcerpt || "");
    var fresh = freshness(enr, opts.nowMs, opts.ttlMs);
    var fields = {};
    for (var i = 0; i < CLAIM_FIELDS.length; i++) {
      var name = CLAIM_FIELDS[i];
      var unknown = isUnknownValue(enr[name]);
      fields[name] = {
        unknown: unknown,
        grounding: unknown ? "unknown" : grounding,
        confidence: unknown ? "unknown" : conf,
        source: source,
      };
    }
    enr.provenance = {
      source: source,
      grounding: grounding,
      confidence: conf,
      profileRevision: profileRevision,
      freshness: fresh,
      fields: fields,
    };
    return enr;
  }

  function ledeTag(enr, opts) {
    opts = opts || {};
    if (!opts.fromLlm) {
      var tag = "Compressed by JobBored AI";
      var words = Number(opts.jdWordCount) || 0;
      if (words > 0) {
        tag += " · from " + words + " word" + (words === 1 ? "" : "s");
      }
      return tag;
    }
    var prov = (enr && enr.provenance) || stampProvenance(enr || {}, opts).provenance;
    if (prov.grounding === "posting") return "AI Summary · grounded in the posting";
    if (prov.grounding === "inferred" || prov.source === "title-and-company") {
      return "AI Summary · inferred from title and company";
    }
    return "AI Summary · source unverified";
  }

  var api = {
    DEFAULT_TTL_MS: DEFAULT_TTL_MS,
    MIN_POSTING_CHARS: MIN_POSTING_CHARS,
    CLAIM_FIELDS: CLAIM_FIELDS,
    fingerprintProfile: fingerprintProfile,
    stampProvenance: stampProvenance,
    ledeTag: ledeTag,
    freshness: freshness,
    resolveGrounding: resolveGrounding,
    resolveSource: resolveSource,
  };

  root.JobBoredDossierProvenance = api;
  if (typeof window !== "undefined") window.JobBoredDossierProvenance = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
