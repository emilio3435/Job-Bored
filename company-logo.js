/* ============================================
   COMMAND CENTER v2 — Company Logo
   Extracted from app.js (company-logo cut).

   Classic-global IIFE under window.JobBoredApp.companyLogo — NOT an ES module.
   Loaded BEFORE app.js. Clearbit/logo cache, async lookup, and logo HTML.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const companyLogo = root.companyLogo || (root.companyLogo = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  const _LOGO_CACHE = new Map();
  const _LOGO_PENDING = new Set();

  function _fetchCompanyLogo(name) {
    if (_LOGO_CACHE.has(name) || _LOGO_PENDING.has(name)) return;
    _LOGO_PENDING.add(name);
    fetch(
      "https://autocomplete.clearbit.com/v1/companies/suggest?query=" +
        encodeURIComponent(name),
    )
      .then(function (r) {
        return r.ok ? r.json() : [];
      })
      .then(function (results) {
        var url = "";
        if (Array.isArray(results) && results.length) {
          var hit = results[0];
          if (hit && hit.logo) {
            url = hit.logo;
          } else if (hit && hit.domain) {
            url =
              "https://www.google.com/s2/favicons?domain=" +
              encodeURIComponent(hit.domain) +
              "&sz=128";
          }
        }
        _LOGO_CACHE.set(name, url);
        _LOGO_PENDING.delete(name);
        if (url) _upgradePlaceholders(name, url);
      })
      .catch(function () {
        _LOGO_CACHE.set(name, "");
        _LOGO_PENDING.delete(name);
      });
  }

  // Promise-returning version of the Clearbit/Google-favicon lookup used by
  // the auto-enrich path. Resolves to a usable logo URL or empty string.
  // Never rejects — worst case returns a Google-favicon fallback built from
  // the company's slug, which renders as a generic "?" icon if the domain
  // doesn't exist (harmless).
  async function resolveCompanyLogoUrl(companyName) {
    const name = String(companyName || "").trim();
    if (!name) return "";
    // Fast path: already cached from earlier render.
    const cached = _LOGO_CACHE.get(name);
    if (cached !== undefined) return cached || "";
    // Piggyback on the existing fetcher so the in-memory cache + DOM upgrade
    // both fire as a side-effect. We still do our own fetch because we need
    // a Promise-shaped return for the auto-enrich caller.
    _fetchCompanyLogo(name);
    try {
      const resp = await fetch(
        "https://autocomplete.clearbit.com/v1/companies/suggest?query=" +
          encodeURIComponent(name),
        { method: "GET" },
      );
      if (resp.ok) {
        const results = await resp.json();
        if (Array.isArray(results) && results.length) {
          const hit = results[0];
          if (hit && hit.logo) return String(hit.logo);
          if (hit && hit.domain) {
            return (
              "https://www.google.com/s2/favicons?domain=" +
              encodeURIComponent(hit.domain) +
              "&sz=128"
            );
          }
        }
      }
    } catch (_) {
      /* network failure → fall through to slug fallback */
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!slug) return "";
    return (
      "https://www.google.com/s2/favicons?domain=" +
      encodeURIComponent(slug + ".com") +
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

  function _upgradePlaceholders(companyName, logoUrl) {
    document
      .querySelectorAll(
        '.co-logo-wrap[data-company="' + CSS.escape(companyName) + '"]',
      )
      .forEach(function (wrap) {
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
   * Render a logo wrapper. Shows initials immediately. If a Clearbit result
   * is cached it renders an <img> directly; otherwise kicks off the async
   * lookup and upgrades the placeholder when it resolves.
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
    var cachedUrl =
      host().safeHref(job.logoUrl) ||
      host().safeHref(_LOGO_CACHE.get(companyName)) ||
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
      if (companyName) _fetchCompanyLogo(companyName);
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
