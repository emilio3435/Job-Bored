/**
 * Companies panel — top-level UI surface.
 *
 * Reads the active + skipped + history company lists from stored
 * worker-config via POST /discovery-profile mode=list_companies, and lets
 * the user select, deselect, or eliminate companies from their discovery
 * search. Writes flow through mode=skip_company and mode=unskip_company on
 * the same endpoint — no Gemini call is made here.
 *
 * Companies that the user eliminates are persisted to negativeCompanyKeys
 * and will be excluded from future discovery runs. Restoring a company
 * removes it from the negative list and re-promotes the stored metadata
 * from companyHistory back into the active companies array, so the
 * dashboard reflects the change immediately.
 *
 * Exports (attached to window.JobBoredCompaniesTab for the test harness):
 *   - renderCompanyList(container, companies, options)
 *   - filterCompanies(companies, query)
 *   - sortCompaniesByName(companies)
 *   - pickRandomCompanies(list, n)
 *   - buildCombinedLibrary({ active, history })
 */
(function () {
  "use strict";

  var TAB_ALL = "active";
  var TAB_SKIPPED = "skipped";
  var TAB_HISTORY = "history";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sortCompaniesByName(companies) {
    var copy = (Array.isArray(companies) ? companies : []).slice();
    copy.sort(function (a, b) {
      var an = String((a && a.name) || "").toLowerCase();
      var bn = String((b && b.name) || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
    return copy;
  }

  // Fisher-Yates shuffle on a shallow copy, returning the first `n` entries.
  // Returned entries are distinct references drawn from `list`; n<=0 or empty
  // list yields []; n greater than list length yields the full list (shuffled).
  function pickRandomCompanies(list, n) {
    var arr = Array.isArray(list) ? list.slice() : [];
    var count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    if (count === 0 || arr.length === 0) return [];
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr.slice(0, Math.min(count, arr.length));
  }

  // Merge `active` + `history` lists, tagging each entry with its origin and
  // deduping by companyKey. Active wins on collision — history entries whose
  // key already appeared in active are dropped. Entries without a companyKey
  // are dropped (can't be identified downstream for the allowlist wire format).
  function buildCombinedLibrary(input) {
    var obj = input || {};
    var active = Array.isArray(obj.active) ? obj.active : [];
    var history = Array.isArray(obj.history) ? obj.history : [];
    var seen = Object.create(null);
    var out = [];
    function push(entry, source) {
      if (!entry || typeof entry !== "object") return;
      var key = typeof entry.companyKey === "string" ? entry.companyKey : "";
      if (!key || seen[key]) return;
      seen[key] = true;
      var tagged = {};
      for (var k in entry) {
        if (Object.prototype.hasOwnProperty.call(entry, k)) tagged[k] = entry[k];
      }
      tagged.source = source;
      out.push(tagged);
    }
    for (var i = 0; i < active.length; i++) push(active[i], "active");
    for (var j = 0; j < history.length; j++) push(history[j], "history");
    return out;
  }

  function filterCompanies(companies, query) {
    var list = Array.isArray(companies) ? companies : [];
    var q = String(query || "").trim().toLowerCase();
    if (!q) return list.slice();
    return list.filter(function (c) {
      var name = String((c && c.name) || "").toLowerCase();
      if (name.indexOf(q) !== -1) return true;
      var domains = Array.isArray(c && c.domains) ? c.domains : [];
      for (var i = 0; i < domains.length; i++) {
        if (String(domains[i] || "").toLowerCase().indexOf(q) !== -1) return true;
      }
      var key = String((c && c.companyKey) || "").toLowerCase();
      return key && key.indexOf(q) !== -1;
    });
  }

  function renderCompanyRow(company, action) {
    var name = String((company && company.name) || "Unnamed company");
    var companyKey = String((company && company.companyKey) || "");
    var domains = Array.isArray(company && company.domains)
      ? company.domains
          .map(function (d) {
            return String(d || "").trim();
          })
          .filter(Boolean)
          .slice(0, 3)
      : [];
    var actionLabel =
      action === "eliminate"
        ? "Eliminate"
        : action === "restore"
          ? "Restore"
          : "Remove";
    var actionClass =
      action === "restore" ? "companies-row__action--restore" : "companies-row__action--skip";
    return (
      '<li class="companies-row" data-company-key="' +
      escapeHtml(companyKey) +
      '">' +
      '<div class="companies-row__body">' +
      '<span class="companies-row__name">' +
      escapeHtml(name) +
      "</span>" +
      (domains.length
        ? '<span class="companies-row__domains">' +
          escapeHtml(domains.join(" · ")) +
          "</span>"
        : "") +
      "</div>" +
      '<button type="button" class="companies-row__action ' +
      actionClass +
      '" data-company-action="' +
      escapeHtml(action) +
      '" data-company-key="' +
      escapeHtml(companyKey) +
      '"' +
      (companyKey ? "" : " disabled") +
      ">" +
      escapeHtml(actionLabel) +
      "</button>" +
      "</li>"
    );
  }

  function renderCompanyList(container, companies, options) {
    if (!container) return;
    var opts = options || {};
    var action = opts.action || "eliminate";
    var emptyTitle = opts.emptyTitle || "Nothing here yet";
    var emptyHint = opts.emptyHint || "";
    var list = sortCompaniesByName(companies);
    if (!list.length) {
      container.innerHTML =
        '<div class="companies-empty" role="status">' +
        '<p class="companies-empty__title">' +
        escapeHtml(emptyTitle) +
        "</p>" +
        (emptyHint
          ? '<p class="companies-empty__hint">' + escapeHtml(emptyHint) + "</p>"
          : "") +
        "</div>";
      return;
    }
    container.innerHTML =
      '<ul class="companies-list">' +
      list
        .map(function (c) {
          return renderCompanyRow(c, action);
        })
        .join("") +
      "</ul>";
  }

  function setStatus(statusEl, kind, message) {
    if (!statusEl) return;
    statusEl.className = "companies-status companies-status--" + kind;
    statusEl.textContent = message || "";
  }

  function readAccessToken() {
    if (window.JobBored && typeof window.JobBored.getAccessToken === "function") {
      var token = window.JobBored.getAccessToken();
      if (typeof token === "string" && token) return token;
    }
    return "";
  }

  function readSheetId() {
    if (window.JobBored && typeof window.JobBored.getSheetId === "function") {
      var live = window.JobBored.getSheetId();
      if (typeof live === "string" && live.trim()) return live.trim();
    }
    var el = document.getElementById("settingsSheetId");
    var fromInput = el && typeof el.value === "string" ? el.value.trim() : "";
    if (fromInput) return fromInput;
    var cfg = window.COMMAND_CENTER_CONFIG;
    if (cfg && typeof cfg.sheetId === "string" && cfg.sheetId.trim()) {
      return cfg.sheetId.trim();
    }
    return "";
  }

  function getPostProfile() {
    var mod = window.JobBoredSettingsProfileTab;
    if (mod && typeof mod.postProfileEndpoint === "function") {
      return mod.postProfileEndpoint;
    }
    return null;
  }

  function initCompaniesTab() {
    var modal = document.getElementById("companiesModal");
    var openBtn = document.getElementById("companiesBtn");
    var closeBtn = document.getElementById("companiesModalClose");
    var refreshBtn = document.getElementById("companiesRefreshBtn");
    var rediscoverBtn = document.getElementById("companiesRediscoverBtn");
    var statusEl = document.getElementById("companiesStatus");
    var searchInput = document.getElementById("companiesSearch");
    var tabsEl = modal ? modal.querySelector("[data-companies-tabs]") : null;
    var activeContainer = document.getElementById("companiesActiveList");
    var skippedContainer = document.getElementById("companiesSkippedList");
    var historyContainer = document.getElementById("companiesHistoryList");
    var countActive = document.getElementById("companiesCountActive");
    var countSkipped = document.getElementById("companiesCountSkipped");
    var countHistory = document.getElementById("companiesCountHistory");
    if (!modal || !openBtn || !statusEl || !activeContainer) return;

    var state = {
      isOpen: false,
      loading: false,
      tab: TAB_ALL,
      search: "",
      active: [],
      skipped: [],
      history: [],
      lastRefreshAt: null,
    };

    function updateCountBadges() {
      if (countActive) countActive.textContent = String(state.active.length);
      if (countSkipped) countSkipped.textContent = String(state.skipped.length);
      if (countHistory) countHistory.textContent = String(state.history.length);
    }

    function rerenderLists() {
      var q = state.search;
      renderCompanyList(activeContainer, filterCompanies(state.active, q), {
        action: "eliminate",
        emptyTitle: q
          ? "No active companies match your search."
          : "No active companies yet.",
        emptyHint: q
          ? ""
          : 'Run a discovery from Settings → Profile → Refresh companies to populate this list.',
      });
      renderCompanyList(skippedContainer, filterCompanies(state.skipped, q), {
        action: "restore",
        emptyTitle: q
          ? "No eliminated companies match your search."
          : "No companies eliminated yet.",
        emptyHint: q
          ? ""
          : "When you eliminate a company, it moves here so you can restore it later.",
      });
      renderCompanyList(historyContainer, filterCompanies(state.history, q), {
        action: "eliminate",
        emptyTitle: q
          ? "No archived companies match your search."
          : "No archived companies yet.",
        emptyHint: q
          ? ""
          : "Previously seen companies that aged out of the active shortlist will appear here.",
      });
    }

    function syncTabVisibility() {
      var panes = {
        active: document.getElementById("companiesPaneActive"),
        skipped: document.getElementById("companiesPaneSkipped"),
        history: document.getElementById("companiesPaneHistory"),
      };
      Object.keys(panes).forEach(function (key) {
        var pane = panes[key];
        if (!pane) return;
        var isActive = state.tab === key;
        pane.hidden = !isActive;
        pane.classList.toggle("companies-pane--active", isActive);
      });
      if (tabsEl) {
        var buttons = tabsEl.querySelectorAll("[data-companies-tab]");
        buttons.forEach(function (btn) {
          var tab = btn.getAttribute("data-companies-tab");
          var isActive = tab === state.tab;
          btn.classList.toggle("is-active", isActive);
          btn.setAttribute("aria-selected", String(isActive));
        });
      }
    }

    async function loadCompanies(options) {
      var opts = options || {};
      if (state.loading) return;
      var post = getPostProfile();
      if (!post) {
        setStatus(
          statusEl,
          "warn",
          "Discovery worker client isn't loaded — reload the page and try again.",
        );
        return;
      }
      var sheetId = readSheetId();
      if (!sheetId) {
        setStatus(
          statusEl,
          "warn",
          "Connect a sheet in Settings → Sheet before companies can be loaded.",
        );
        return;
      }
      if (!readAccessToken()) {
        setStatus(
          statusEl,
          "warn",
          "Sign in with Google so the worker can read your stored profile.",
        );
        return;
      }
      state.loading = true;
      if (!opts.silent) {
        setStatus(statusEl, "info", "Loading companies…");
      }
      try {
        var data = await post({ mode: "list_companies", sheetId: sheetId }, 15000);
        if (!data || data.ok !== true) {
          throw new Error((data && data.message) || "Could not load companies.");
        }
        state.active = Array.isArray(data.active) ? data.active : [];
        state.skipped = Array.isArray(data.skipped) ? data.skipped : [];
        state.history = Array.isArray(data.history) ? data.history : [];
        state.lastRefreshAt =
          typeof data.lastRefreshAt === "string" ? data.lastRefreshAt : null;
        updateCountBadges();
        rerenderLists();
        var parts = [
          state.active.length + " active",
          state.skipped.length + " eliminated",
          state.history.length + " in history",
        ];
        setStatus(statusEl, "ok", parts.join(" · "));
      } catch (err) {
        setStatus(
          statusEl,
          "error",
          "Couldn't load companies: " +
            (err && err.message ? err.message : String(err || "unknown error")),
        );
      } finally {
        state.loading = false;
      }
    }

    async function handleAction(action, companyKey, buttonEl) {
      if (!companyKey) return;
      var post = getPostProfile();
      if (!post) {
        setStatus(
          statusEl,
          "error",
          "Discovery worker client isn't loaded — reload the page and try again.",
        );
        return;
      }
      var sheetId = readSheetId();
      if (!sheetId) {
        setStatus(
          statusEl,
          "warn",
          "Connect a sheet in Settings → Sheet before companies can be updated.",
        );
        return;
      }
      if (buttonEl) buttonEl.disabled = true;
      try {
        if (action === "eliminate") {
          await post(
            {
              mode: "skip_company",
              sheetId: sheetId,
              skipCompanyKeys: [companyKey],
            },
            15000,
          );
        } else if (action === "restore") {
          await post(
            {
              mode: "unskip_company",
              sheetId: sheetId,
              unskipCompanyKeys: [companyKey],
            },
            15000,
          );
        } else {
          throw new Error("Unknown action: " + action);
        }
        await loadCompanies({ silent: true });
      } catch (err) {
        setStatus(
          statusEl,
          "error",
          "Couldn't update company: " +
            (err && err.message ? err.message : String(err || "unknown error")),
        );
        if (buttonEl) buttonEl.disabled = false;
      }
    }

    function openModal() {
      modal.style.display = "flex";
      modal.setAttribute("aria-hidden", "false");
      state.isOpen = true;
      syncTabVisibility();
      loadCompanies();
    }

    function closeModal() {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      state.isOpen = false;
    }

    openBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        loadCompanies();
      });
    }
    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeModal();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && modal.style.display !== "none") {
        closeModal();
      }
    });

    if (tabsEl) {
      tabsEl.addEventListener("click", function (event) {
        var target = event.target;
        if (!(target instanceof Element)) return;
        var btn = target.closest("[data-companies-tab]");
        if (!btn) return;
        var tab = btn.getAttribute("data-companies-tab");
        if (!tab) return;
        state.tab = tab;
        syncTabVisibility();
      });
    }

    if (searchInput) {
      var searchTimer = null;
      searchInput.addEventListener("input", function (event) {
        if (searchTimer) clearTimeout(searchTimer);
        var value = (event.target && event.target.value) || "";
        searchTimer = setTimeout(function () {
          state.search = String(value).trim();
          rerenderLists();
        }, 120);
      });
    }

    modal.addEventListener("click", function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var btn = target.closest("[data-company-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-company-action") || "";
      var companyKey = btn.getAttribute("data-company-key") || "";
      if (!action || !companyKey) return;
      handleAction(action, companyKey, btn);
    });

    if (rediscoverBtn) {
      rediscoverBtn.addEventListener("click", function () {
        closeModal();
        if (
          window.__JobBoredDiscoveryPrefsShowProfileCore &&
          typeof window.openCommandCenterSettingsModal === "function"
        ) {
          window.openCommandCenterSettingsModal({ tab: "profile" });
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCompaniesTab);
  } else {
    initCompaniesTab();
  }

  window.JobBoredCompaniesTab = {
    renderCompanyList: renderCompanyList,
    filterCompanies: filterCompanies,
    sortCompaniesByName: sortCompaniesByName,
    pickRandomCompanies: pickRandomCompanies,
    buildCombinedLibrary: buildCombinedLibrary,
    __test: {
      initCompaniesTab: initCompaniesTab,
      renderCompanyRow: renderCompanyRow,
    },
  };
})();
