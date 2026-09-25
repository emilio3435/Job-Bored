/* ============================================
   Capture bookmarklet — UX01 C10 (MP-02).

   A one-click clipper that needs no extension, no store review and no
   server. The bookmarklet runs on the job posting the stranger is
   reading, pulls the page's schema.org JobPosting JSON-LD (the same
   structured data Google Jobs indexes), and opens JobBored at
   `#capture=<payload>`. This module reads that hash on load and hands the
   prefilled fields to manual add — `JobBoredIngest.openManual` (lane D),
   or the legacy manual modal where lane D has not landed — which appends
   the Pipeline row directly. Nothing leaves the browser.

   Payload: base64url(UTF-8 JSON) of
     { v: 1, url, title, company, location, description }
   Every field is a string, trimmed and length-capped on BOTH sides:
   the hash is untrusted input from whatever page ran the bookmarklet.

   Classic-global IIFE; also a CommonJS module so node tests can load it.
   ============================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.JobBoredCapture = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const HASH_KEY = "capture";
  const PAYLOAD_VERSION = 1;
  const LIMITS = Object.freeze({
    url: 2048,
    title: 200,
    company: 200,
    location: 200,
    description: 4000,
  });
  /** Hard cap on the encoded hash, so a hostile page cannot stall parsing. */
  const MAX_ENCODED_LENGTH = 16000;

  function clean(value, limit) {
    const text = value == null ? "" : String(value);
    return text.replace(/\s+/g, " ").trim().slice(0, limit);
  }

  /** Keep only http(s) links — a javascript: or data: URL is not a posting. */
  function cleanUrl(value) {
    const url = clean(value, LIMITS.url);
    return /^https?:\/\//i.test(url) ? url : "";
  }

  function sanitizeCapture(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return {
      v: PAYLOAD_VERSION,
      url: cleanUrl(src.url),
      title: clean(src.title, LIMITS.title),
      company: clean(src.company, LIMITS.company),
      location: clean(src.location, LIMITS.location),
      description: clean(src.description, LIMITS.description),
    };
  }

  // ---------------------------------------------------------------
  // base64url over UTF-8 — the same encoding the bookmarklet writes.
  // ---------------------------------------------------------------

  function toBase64Url(text) {
    const bytes = unescape(encodeURIComponent(text));
    const b64 =
      typeof btoa === "function"
        ? btoa(bytes)
        : Buffer.from(bytes, "binary").toString("base64");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(encoded) {
    const b64 = String(encoded).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const bytes =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("binary");
    return decodeURIComponent(escape(bytes));
  }

  function encodeCapture(capture) {
    return toBase64Url(JSON.stringify(sanitizeCapture(capture)));
  }

  /**
   * Read `#capture=…` from a hash string. Returns the sanitized capture,
   * or null when the hash is not a capture or does not decode. A capture
   * with neither a title nor a URL is not worth a form, so it is null too.
   */
  function parseCaptureHash(hash) {
    const raw = String(hash || "").replace(/^#/, "");
    const prefix = `${HASH_KEY}=`;
    if (raw.indexOf(prefix) !== 0) return null;
    const encoded = raw.slice(prefix.length);
    if (!encoded || encoded.length > MAX_ENCODED_LENGTH) return null;
    let parsed;
    try {
      parsed = JSON.parse(fromBase64Url(encoded));
    } catch (_) {
      return null;
    }
    const capture = sanitizeCapture(parsed);
    if (!capture.title && !capture.url) return null;
    return capture;
  }

  // ---------------------------------------------------------------
  // The page-side extractor. It is serialized INTO the bookmarklet, so it
  // must be self-contained: no closures over this module.
  // ---------------------------------------------------------------

  /* eslint-disable no-var */
  function extractJobPosting(doc, loc) {
    var out = { url: loc && loc.href ? String(loc.href) : "" };
    function isPosting(node) {
      var t = node && node["@type"];
      if (Array.isArray(t)) return t.indexOf("JobPosting") !== -1;
      return t === "JobPosting";
    }
    function find(node) {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) {
          var hit = find(node[i]);
          if (hit) return hit;
        }
        return null;
      }
      if (isPosting(node)) return node;
      if (node["@graph"]) return find(node["@graph"]);
      return null;
    }
    // Strip the description's HTML in an INERT document: DOMParser output
    // runs no scripts and fires no handlers, unlike a detached element.
    function text(html) {
      var raw = String(html || "");
      if (typeof DOMParser === "function") {
        var parsed = new DOMParser().parseFromString(raw, "text/html");
        return (parsed.body && parsed.body.textContent) || "";
      }
      return raw.replace(/<[^>]*>/g, " ");
    }
    function place(loc2) {
      var l = Array.isArray(loc2) ? loc2[0] : loc2;
      var a = (l && l.address) || {};
      if (typeof a === "string") return a;
      return [a.addressLocality, a.addressRegion, a.addressCountry && (a.addressCountry.name || a.addressCountry)]
        .filter(Boolean)
        .join(", ");
    }
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var posting = null;
      try {
        posting = find(JSON.parse(scripts[i].textContent || "null"));
      } catch (e) {
        posting = null;
      }
      if (posting) {
        var org = posting.hiringOrganization;
        out.title = posting.title || "";
        out.company = (org && (org.name || org)) || "";
        out.location =
          posting.jobLocationType === "TELECOMMUTE" ? "Remote" : place(posting.jobLocation);
        out.description = text(posting.description);
        if (posting.url) out.url = posting.url;
        return out;
      }
    }
    var sel = doc.getSelection ? String(doc.getSelection() || "") : "";
    out.title = doc.title || "";
    out.description = sel;
    return out;
  }
  /* eslint-enable no-var */

  /**
   * The `javascript:` URL a user drags to their bookmarks bar. `appUrl` is
   * this JobBored's own address, so each install's button opens itself.
   */
  function buildBookmarkletHref(appUrl) {
    const base = String(appUrl || "").split("#")[0];
    const body =
      "(function(){" +
      "var x=(" + extractJobPosting.toString() + ")(document,location);" +
      "var j=JSON.stringify({v:1,url:x.url,title:x.title,company:x.company," +
      "location:x.location,description:String(x.description||'').slice(0,4000)});" +
      "var b=btoa(unescape(encodeURIComponent(j)))" +
      ".replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');" +
      "window.open(" + JSON.stringify(base) + "+'#" + HASH_KEY + "='+b,'_blank');" +
      "})();";
    return "javascript:" + encodeURIComponent(body);
  }

  // ---------------------------------------------------------------
  // The app side: consume the hash once, then hand off to manual add.
  // ---------------------------------------------------------------

  function fillLegacyManualForm(doc, capture) {
    const set = (id, value) => {
      const el = doc.getElementById(id);
      if (el && value) el.value = value;
    };
    set("ingestManualTitle", capture.title);
    set("ingestManualCompany", capture.company);
    set("ingestManualLocation", capture.location);
    set("ingestManualDescription", capture.description);
  }

  /**
   * Open manual add prefilled. Lane D's `JobBoredIngest.openManual` is the
   * contract; the legacy modal is the fallback. Returns which path ran.
   */
  function openManualWithCapture(capture) {
    const win = root;
    const ingest = win && win.JobBoredIngest;
    if (ingest && typeof ingest.openManual === "function") {
      ingest.openManual({
        source: "capture_bookmarklet",
        url: capture.url,
        prefill: {
          title: capture.title,
          company: capture.company,
          location: capture.location,
          description: capture.description,
        },
      });
      return "ingest";
    }
    const legacy = win && win.JobBored;
    if (legacy && typeof legacy.openIngestManualFallback === "function") {
      legacy.openIngestManualFallback(capture.url, {
        message: "Captured from the page you were reading — check it, then save.",
      });
      if (win.document) fillLegacyManualForm(win.document, capture);
      return "legacy";
    }
    return "";
  }

  function clearHash(win) {
    try {
      const loc = win.location;
      if (win.history && typeof win.history.replaceState === "function") {
        win.history.replaceState(null, "", loc.pathname + loc.search);
      } else {
        loc.hash = "";
      }
    } catch (_) {
      /* a hash we cannot clear only means a reload reopens the form */
    }
  }

  /**
   * Boot hook. The manual form may not exist yet when this runs (deferred
   * scripts, a signed-out gate), so it retries briefly before giving up.
   */
  function consumeCaptureHash(options) {
    const opts = options || {};
    const win = root;
    if (!win || !win.location) return null;
    const capture = parseCaptureHash(win.location.hash);
    if (!capture) return null;
    clearHash(win);
    const attempts = Number.isInteger(opts.attempts) ? opts.attempts : 20;
    const delay = Number.isFinite(opts.delayMs) ? opts.delayMs : 250;
    let tries = 0;
    const attempt = () => {
      tries += 1;
      if (openManualWithCapture(capture)) return;
      if (tries < attempts && typeof setTimeout === "function") {
        setTimeout(attempt, delay);
      }
    };
    attempt();
    return capture;
  }

  /**
   * Point every `[data-capture-bookmarklet]` link at this install. The
   * drawer calls it on open (its partial may mount after this script).
   */
  function installBookmarkletLinks() {
    const doc = root && root.document;
    const loc = root && root.location;
    if (!doc || !loc || typeof doc.querySelectorAll !== "function") return 0;
    const href = buildBookmarkletHref(loc.origin + loc.pathname);
    const links = doc.querySelectorAll("[data-capture-bookmarklet]");
    for (let i = 0; i < links.length; i += 1) {
      links[i].setAttribute("href", href);
      if (!links[i].dataset || links[i].dataset.captureBound !== "true") {
        // Clicking it here would capture JobBored itself — say what to do.
        links[i].addEventListener("click", (event) => {
          event.preventDefault();
        });
        if (links[i].dataset) links[i].dataset.captureBound = "true";
      }
    }
    return links.length;
  }

  if (
    root &&
    root.document &&
    root.location &&
    typeof root.document.addEventListener === "function"
  ) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", () => {
        consumeCaptureHash();
        installBookmarkletLinks();
      });
    } else {
      consumeCaptureHash();
      installBookmarkletLinks();
    }
    if (typeof root.addEventListener === "function") {
      root.addEventListener("hashchange", () => consumeCaptureHash());
    }
  }

  return {
    HASH_KEY,
    LIMITS,
    sanitizeCapture,
    encodeCapture,
    parseCaptureHash,
    extractJobPosting,
    buildBookmarkletHref,
    openManualWithCapture,
    consumeCaptureHash,
    installBookmarkletLinks,
  };
});
