/* ============================================
   dossier-field-provenance.js
   Classic-global helper: window.JobBoredDossierProvenance

   Stamps field-level grounding, confidence, source,
   profile revision, freshness/TTL, and unknown state
   onto posting-enrichment payloads so inferred claims
   are never labeled posting-grounded.

   Also the ONE provenance classifier for the dossier surface:
   classify(enrichmentMeta, editLock, field) returns the visible
   label vocabulary (posting-grounded | user-provided | inferred |
   unknown) backed by the same grounding rules used for stamping.
   dossier-provenance.js is not part of this repo; this file is the
   single definer of window.JobBoredDossierProvenance.

   Lane: F3-A (DOSSIER-01) + R5 reconciliation. Loaded before
   role-brief.js and posting-enrichment.js once index.html is wired.
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

  /* Card-attr reload delivers VM field names (source / enrichedAt /
     fetchedAt); the fetch path delivers _scrapeSource / scrapedAt.
     Both shapes must resolve or every reloaded card reads unknown. */
  function resolveSource(enr) {
    if (!enr || typeof enr !== "object") return "";
    var src = String(
      enr._scrapeSource ||
        enr.source ||
        (enr.provenance && enr.provenance.source) ||
        "",
    ).trim();
    if (src && src !== "unknown") return src;
    if (isScrapeBlocked(enr)) return "title-and-company";
    return src === "unknown" ? "" : src;
  }

  function isScrapeBlocked(enr) {
    return !!(enr && (enr._scrapeBlocked === true || enr.scrapeBlocked === true));
  }

  function resolveParseMode(enr) {
    if (!enr || typeof enr !== "object") return "";
    return String(enr.parseMode || enr._parseMode || "").trim().toLowerCase();
  }

  function resolveGrounding(enr, source) {
    var desc = descriptionText(enr);
    var blocked = isScrapeBlocked(enr);
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

  /* scrapedAt is the fetch-path epoch; enrichedAt/fetchedAt arrive as ISO
     strings on the card-attr reload path. Either may be the freshness clock. */
  function resolveFetchedMs(enr) {
    if (!enr || typeof enr !== "object") return NaN;
    var candidates = [enr.scrapedAt, enr.enrichedAt, enr.fetchedAt];
    for (var i = 0; i < candidates.length; i++) {
      var raw = candidates[i];
      if (raw == null || raw === "" || raw === 0 || raw === "0") continue;
      if (typeof raw === "number") {
        if (Number.isFinite(raw) && raw > 0) return raw;
        continue;
      }
      var text = String(raw).trim();
      if (!text) continue;
      var ms = /^\d+$/.test(text) ? Number(text) : new Date(text).getTime();
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
    return NaN;
  }

  function freshness(enr, nowMs, ttlMs) {
    var scrapedAt = resolveFetchedMs(enr);
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

  /* ---------- visible label classifier (T0 DOSSIER-01 contract) ----------
     classify(enrichmentMeta, editLock, field) -> {label, source, fetchedAt}.
     Conservative by construction: "unknown" is the default for every
     missing, malformed, or pre-metadata shape, a persisted edit lock
     always outranks scrape lineage, and only a schema-mode parse from a
     posting source with real posting text may read posting-grounded. */
  function normalizeFetchedAt(value) {
    if (value == null || value === "" || value === 0 || value === "0") return null;
    var raw = value;
    if (typeof raw === "string" && /^\d+$/.test(raw.trim())) raw = Number(raw);
    try {
      var date = new Date(raw);
      return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    } catch (e) {
      return null;
    }
  }

  function lockedFields(editLock) {
    var values = Array.isArray(editLock)
      ? editLock
      : String(editLock == null ? "" : editLock).split(",");
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var name = String(values[i] == null ? "" : values[i]).trim().toLowerCase();
      if (name) out.push(name);
    }
    return out;
  }

  function classifyValue(enrichmentMeta, editLock, field) {
    var meta = enrichmentMeta && typeof enrichmentMeta === "object" && !Array.isArray(enrichmentMeta)
      ? enrichmentMeta
      : {};
    var fieldName = String(field == null ? "" : field).trim().toLowerCase();
    if (fieldName && lockedFields(editLock).indexOf(fieldName) !== -1) {
      return { label: "user-provided", source: "edit-lock", fetchedAt: null };
    }

    var fetchedAt = normalizeFetchedAt(resolveFetchedMs(meta));
    var source = resolveSource(meta);
    var parseMode = resolveParseMode(meta);
    if (!source || !parseMode || parseMode !== "schema") {
      return {
        label: "unknown",
        source: source || "unknown",
        fetchedAt: fetchedAt,
      };
    }

    /* stampProvenance's grounding rules are the same rules, so a thin or
       blocked body can never be upgraded here to posting-grounded. */
    var grounding = resolveGrounding(meta, source);
    if (grounding === "inferred") {
      return { label: "inferred", source: source, fetchedAt: fetchedAt };
    }
    if (grounding === "posting") {
      return { label: "posting-grounded", source: source, fetchedAt: fetchedAt };
    }
    /* Posting source, schema parse, but no posting text to measure: the
       card-attr reload path carries no description, so lineage alone decides. */
    if (POSTING_SOURCES[source] && !descriptionText(meta)) {
      return { label: "posting-grounded", source: source, fetchedAt: fetchedAt };
    }
    return { label: "unknown", source: source, fetchedAt: fetchedAt };
  }

  function classify(enrichmentMeta, editLock, field) {
    try {
      return classifyValue(enrichmentMeta, editLock, field);
    } catch (e) {
      return { label: "unknown", source: "unknown", fetchedAt: null };
    }
  }

  var api = {
    DEFAULT_TTL_MS: DEFAULT_TTL_MS,
    MIN_POSTING_CHARS: MIN_POSTING_CHARS,
    CLAIM_FIELDS: CLAIM_FIELDS,
    fingerprintProfile: fingerprintProfile,
    stampProvenance: stampProvenance,
    classify: classify,
    ledeTag: ledeTag,
    freshness: freshness,
    resolveGrounding: resolveGrounding,
    resolveSource: resolveSource,
  };

  root.JobBoredDossierProvenance = api;
  if (typeof window !== "undefined") window.JobBoredDossierProvenance = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
