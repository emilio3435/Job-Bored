/* ============================================
   COMMAND CENTER v2 — Company Logo
   Extracted from app.js (company-logo cut).

   Classic-global IIFE under window.JobBoredApp.companyLogo — NOT an ES module.
   Loaded BEFORE app.js.

   HOLES B14: logos come from the local JobBored API, never a third-party
   logo host. renderLogoHtml draws job.logoUrl (http(s) only) when the Sheet
   has one; else the company's mark from GET <API base>/api/brand-logos/company
   (server/company-logo-route.mjs: the brand-logos cache, else one bounded
   resolver run), drawn only as a raster data:image URL; else initials, which
   are swapped for the mark in place when it arrives. One lookup per company
   key (company-cap.js companyKey) for the page's life: a render while it is
   in flight reuses it, and a miss is remembered as "" and not asked again.

   resolveCompanyLogoUrl gives the Sheet's Logo URL column a portable http(s)
   URL with no network call: the Google s2 favicon for <company key>.com
   ("Stripe, Inc." → stripe.com).
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const companyLogo = root.companyLogo || (root.companyLogo = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  // A server mark is drawn only as a raster image data: URL — never a script
  // URL, an SVG or a remote host.
  const MARK_SRC = /^data:image\/(?:png|jpeg|gif|webp);base64,/;

  // company key -> a MARK_SRC-checked src, or "" for a miss (no mark, an
  // error, an unreachable API).
  const _MARK_CACHE = new Map();
  // company keys with a lookup in flight.
  const _MARK_PENDING = new Set();

  // Local fallback — the same R18 normalization as company-cap.js.
  const LEGAL_SUFFIX = /\s+(?:inc|incorporated|llc|llp|lp|ltd|limited|corp|corporation|co|company|gmbh|plc|ag|sa|bv|nv|pty|pte)$/;

  // One employer, one key: "Stripe, Inc." and "Stripe" share a lookup and a mark.
  function _companyKey(name) {
    const cap = window.JobBoredCompanyCap;
    if (cap && typeof cap.companyKey === "function") {
      return cap.companyKey({ company: name });
    }
    const base = String(name || "")
      .toLowerCase()
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let key = base;
    while (LEGAL_SUFFIX.test(key)) key = key.replace(LEGAL_SUFFIX, "");
    return key || base;
  }

  // The JobBored API base (no trailing slash), found the way pipeline.js
  // finds it; "" when there is none, and the board keeps initials.
  // dev-server.mjs does not proxy /api/brand-logos, so a page-relative URL
  // would miss the API.
  function _apiBaseUrl() {
    const helper = window.getJobPostingScrapeUrl;
    if (typeof helper === "function") {
      try {
        const url = helper();
        if (url) return String(url).replace(/\/+$/, "");
      } catch (_) {
        /* fall through */
      }
    }
    const cfg = window.COMMAND_CENTER_CONFIG;
    const raw = cfg && cfg.jobPostingScrapeUrl;
    if (raw) return String(raw).trim().replace(/\/+$/, "");
    const h = window.location && window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") {
      return "http://127.0.0.1:3847";
    }
    return "";
  }

  // E4: the JobBored API transport. Attaches the hosted token when
  // hosted-api-auth.js is loaded; plain fetch otherwise.
  function apiFetch(url, init) {
    const auth = window.JobBoredHostedApiAuth;
    if (auth && typeof auth.apiFetch === "function") return auth.apiFetch(url, init);
    return fetch(url, init);
  }

  function _fetchCompanyMark(companyName, key) {
    if (_MARK_CACHE.has(key) || _MARK_PENDING.has(key)) return;
    const base = _apiBaseUrl();
    if (!base) return;
    _MARK_PENDING.add(key);
    const url =
      base + "/api/brand-logos/company?name=" + encodeURIComponent(companyName);
    // Inside the executor, a transport that throws becomes a miss.
    new Promise(function (resolve) {
      resolve(apiFetch(url, { credentials: "omit" }));
    })
      .then(function (r) {
        return r && r.ok ? r.json() : null;
      })
      .then(function (body) {
        var src = body && body.ok === true && body.mark ? body.mark.src : "";
        return typeof src === "string" && MARK_SRC.test(src) ? src : "";
      })
      .catch(function () {
        return "";
      })
      .then(function (src) {
        _MARK_CACHE.set(key, src);
        _MARK_PENDING.delete(key);
        if (src) _upgradePlaceholders(key, src);
      });
  }

  // The Sheet's Logo URL for a company: a portable http(s) URL computed with
  // no network call — the Google s2 favicon for <company key>.com, which
  // renders as a generic globe when the guess is not a real domain
  // (harmless). "" for an empty name. Async because callers await it.
  async function resolveCompanyLogoUrl(companyName) {
    const domain = _companyKey(companyName).replace(/[^a-z0-9]+/g, "");
    if (!domain) return "";
    return (
      "https://www.google.com/s2/favicons?domain=" +
      encodeURIComponent(domain + ".com") +
      "&sz=128"
    );
  }

  // True when the existing Logo URL cell is a placeholder that was derived
  // from an aggregator hostname (linkedin.com, indeed.com, etc.). Those were
  // written by the worker's deriveLogoUrl when the company name was still
  // the aggregator-hostname placeholder; auto-enrich should replace them.
  function isPlaceholderLogoUrl(value) {
    const v = String(value || "").trim().toLowerCase();
    if (!v) return true;
    // Google-favicon URLs keyed to an aggregator or to the raw hostname slug
    // of the paste URL. Match the ?domain= query-string param directly.
    const aggrMatch = /domain=(?:[a-z0-9-.%]+\.)?(linkedin|indeed|glassdoor|ziprecruiter|monster|simplyhired|careerbuilder|wellfound|google|builtin|dice)/i;
    return aggrMatch.test(v);
  }

  // Swap the initials for the mark in every placeholder of this company,
  // whichever spelling of its name the placeholder carries.
  function _upgradePlaceholders(key, logoUrl) {
    document
      .querySelectorAll(".co-logo-wrap[data-company]")
      .forEach(function (wrap) {
        if (_companyKey(wrap.getAttribute("data-company")) !== key) return;
        var fallback = wrap.querySelector(".co-logo--fallback");
        if (!fallback) return;
        var img = document.createElement("img");
        img.className = fallback.className
          .replace("co-logo--fallback", "")
          .trim();
        img.src = logoUrl;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.onerror = function () {
          img.remove();
        };
        fallback.before(img);
        fallback.remove();
      });
  }

  /**
   * Render a logo wrapper. job.logoUrl (http(s) only) or the company's
   * cached server mark renders an <img> directly; otherwise it shows
   * initials and starts the company's lookup, which upgrades the
   * placeholder when the mark arrives.
   */
  function renderLogoHtml(job, variant) {
    var companyName = (job.company || "").trim();
    var initial = (companyName || "?").charAt(0).toUpperCase();
    var sizeClass =
      variant === "drawer"
        ? "co-logo--lg"
        : variant === "kanban"
          ? "co-logo--sm"
          : "co-logo--md";
    var key = companyName ? _companyKey(companyName) : "";
    var cachedUrl =
      host().safeHref(job.logoUrl) ||
      (key && _MARK_CACHE.get(key)) ||
      "";
    var inner;

    if (cachedUrl) {
      inner =
        '<img class="co-logo ' +
        sizeClass +
        '" src="' +
        host().escapeHtml(cachedUrl) +
        '" alt="" loading="lazy" referrerpolicy="no-referrer">';
    } else {
      inner =
        '<span class="co-logo co-logo--fallback ' +
        sizeClass +
        '" aria-hidden="true">' +
        host().escapeHtml(initial) +
        "</span>";
      if (key) _fetchCompanyMark(companyName, key);
    }

    return (
      '<span class="co-logo-wrap" data-company="' +
      host().escapeHtml(companyName) +
      '">' +
      inner +
      "</span>"
    );
  }

  Object.assign(companyLogo, {
    resolveCompanyLogoUrl,
    isPlaceholderLogoUrl,
    renderLogoHtml,
  });
})();
