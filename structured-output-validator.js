/* ============================================
   structured-output-validator.js
   Classic-global helper: window.JobBoredStructuredOutput

   Strips leftover model delimiters (fences, XML wrappers,
   chat tokens, field-name leftovers, JSON-as-string lists)
   from enrichment payloads so they cannot render as
   authoritative requirements. Polluted payloads enter
   review state instead of being treated as facts.

   Lane: F3-A (DOSSIER-02). Loaded before job-posting-insights.js
   and role-brief.js once index.html is wired.
   ============================================ */
(function (root) {
  "use strict";

  var LIST_FIELDS = [
    "mustHaves",
    "responsibilities",
    "niceToHaves",
    "toolsAndStack",
    "talkingPoints",
    "extraKeywords",
  ];

  function looksLikeDelimiter(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return true;
    if (/^```(?:json|javascript|js|ts|xml|html|txt)?$/i.test(s)) return true;
    if (/^```/.test(s) && s.length < 24) return true;
    if (/^<\|[\w.-]+\|>/.test(s)) return true;
    if (/^<\/?[a-zA-Z][\w:-]*\s*\/?>$/.test(s)) return true;
    if (/^#{1,6}\s+\S+(?:\s+\S+){0,3}$/.test(s) &&
        /must-?haves?|responsibilities|nice-?to-?haves?|tools?|stack|keywords?|output/i.test(s)) {
      return true;
    }
    if (/^-{3,}$/.test(s) || /^\*{3,}$/.test(s) || /^_{3,}$/.test(s)) return true;
    if (/^(mustHaves|niceToHaves|responsibilities|toolsAndStack|talkingPoints|extraKeywords|postingSummary|roleInOneLine)\s*:?\s*$/i.test(s)) {
      return true;
    }
    if (/^<\/?(output|keywords?|must_haves?|requirements?|tools?)>$/i.test(s)) return true;
    return false;
  }

  function unwrapXml(s) {
    var m = /^<([a-zA-Z][\w:-]*)>([\s\S]+)<\/\1>$/.exec(s);
    if (m) return String(m[2]).trim();
    return s;
  }

  function recoverJsonArray(s) {
    var t = String(s || "").trim();
    if (!/^\s*\[/.test(t)) return null;
    try {
      var parsed = JSON.parse(t);
      if (!Array.isArray(parsed)) return null;
      return parsed.map(function (x) { return String(x == null ? "" : x).trim(); }).filter(Boolean);
    } catch (_) {
      return null;
    }
  }

  function unique(items) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var key = items[i];
      if (seen[key]) continue;
      seen[key] = true;
      out.push(key);
    }
    return out;
  }

  function cleanItem(raw) {
    var s = unwrapXml(String(raw == null ? "" : raw).trim());
    s = s.replace(/^```(?:json|javascript|js|ts|xml|html)?\s*/i, "").replace(/```$/i, "").trim();
    if (looksLikeDelimiter(s)) return { keep: false, polluted: true };
    var recovered = recoverJsonArray(s);
    if (recovered) {
      return { keep: true, values: recovered, polluted: true };
    }
    var heading = /^#{1,6}\s+(.+)$/.exec(s);
    if (heading) {
      var inner = heading[1].trim();
      if (looksLikeDelimiter("## " + inner) || looksLikeDelimiter(inner)) {
        return { keep: false, polluted: true };
      }
    }
    return { keep: true, value: s, polluted: false };
  }

  function cleanList(arr) {
    var out = [];
    var polluted = false;
    if (!Array.isArray(arr)) return { items: [], polluted: false };
    for (var i = 0; i < arr.length; i++) {
      var result = cleanItem(arr[i]);
      if (result.polluted) polluted = true;
      if (result.values) {
        for (var j = 0; j < result.values.length; j++) {
          var inner = cleanItem(result.values[j]);
          if (inner.polluted) polluted = true;
          if (inner.keep && inner.value) out.push(inner.value);
        }
      } else if (result.keep && result.value) {
        out.push(result.value);
      }
    }
    return { items: unique(out), polluted: polluted };
  }

  function validateEnrichment(parsed) {
    var src = parsed && typeof parsed === "object" ? parsed : {};
    var out = {};
    var keys = Object.keys(src);
    for (var k = 0; k < keys.length; k++) out[keys[k]] = src[keys[k]];
    var pollutedFields = [];
    for (var i = 0; i < LIST_FIELDS.length; i++) {
      var name = LIST_FIELDS[i];
      var cleaned = cleanList(src[name]);
      out[name] = cleaned.items;
      if (cleaned.polluted) pollutedFields.push(name);
    }
    if (src.reviewState && src.reviewState.status === "needs_review") {
      var prior = Array.isArray(src.reviewState.pollutedFields)
        ? src.reviewState.pollutedFields
        : [];
      var merged = unique(prior.concat(pollutedFields));
      out.reviewState = {
        status: "needs_review",
        reason: src.reviewState.reason ||
          "Malformed model delimiters polluted structured fields.",
        pollutedFields: merged,
      };
    } else if (pollutedFields.length) {
      out.reviewState = {
        status: "needs_review",
        reason: "Malformed model delimiters polluted structured fields.",
        pollutedFields: pollutedFields,
      };
    } else {
      out.reviewState = { status: "ok", reason: "", pollutedFields: [] };
    }
    return out;
  }

  var api = {
    LIST_FIELDS: LIST_FIELDS,
    looksLikeDelimiter: looksLikeDelimiter,
    cleanList: cleanList,
    validateEnrichment: validateEnrichment,
  };

  root.JobBoredStructuredOutput = api;
  if (typeof window !== "undefined") window.JobBoredStructuredOutput = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
