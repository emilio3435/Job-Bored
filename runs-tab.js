/**
 * Discovery Runs log — top-level UI surface.
 *
 * Reads the DiscoveryRuns sheet tab (populated by the worker at every run
 * completion — see integrations/browser-use-discovery/src/sheets/discovery-runs-writer.ts)
 * and renders a sortable table with filter chips for trigger + status.
 *
 * Contract: docs/INTERFACE-DISCOVERY-RUNS.md §4–§5.
 *
 * Exports (attached to window.JobBoredRunsLog for the test harness):
 *   - fetchDiscoveryRuns(sheetId, accessToken, options)
 *   - parseDiscoveryRunsValues(values)
 *   - sortRuns(runs, key, direction)
 *   - filterRuns(runs, filters)
 */
(function () {
  "use strict";

  var SHEET_TAB = "DiscoveryRuns";
  var SHEET_RANGE = "DiscoveryRuns!A2:I";
  var AUTO_REFRESH_MS = 60 * 1000;
  var DEFAULT_SORT = { key: "runAt", direction: "desc" };
  var MAX_ROWS = 200;

  var SCHEDULED_TRIGGERS = {
    "scheduled-local": true,
    "scheduled-github": true,
    "scheduled-appsscript": true,
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toInt(value) {
    var n = typeof value === "number" ? value : parseInt(String(value), 10);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Parse raw Sheets values (rows beneath the header, column order must match
   * DISCOVERY_RUNS_HEADER_ROW) into typed run objects.
   *
   * Input: string[][] (Sheets values.get response shape)
   * Output: Run[] where each Run matches the DiscoveryRunLogRow contract.
   */
  function parseDiscoveryRunsValues(values) {
    if (!Array.isArray(values)) return [];
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      if (!Array.isArray(row)) continue;
      // Require at least Run At + Trigger + Status — rows with all three blank
      // are abandoned cells we want to skip rather than render as junk.
      if (!row[0] || !row[1] || !row[2]) continue;
      out.push({
        runAt: String(row[0] || ""),
        trigger: String(row[1] || ""),
        status: String(row[2] || ""),
        durationS: toInt(row[3]),
        companiesSeen: toInt(row[4]),
        leadsWritten: toInt(row[5]),
        source: String(row[6] || ""),
        variationKey: String(row[7] || ""),
        error: String(row[8] || ""),
      });
    }
    return out;
  }

  function sortRuns(runs, key, direction) {
    var dir = direction === "asc" ? 1 : -1;
    var copy = runs.slice();
    copy.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      var as = String(av == null ? "" : av);
      var bs = String(bv == null ? "" : bv);
      if (as < bs) return -1 * dir;
      if (as > bs) return 1 * dir;
      return 0;
    });
    return copy;
  }

  function filterRuns(runs, filters) {
    var triggerFilter = (filters && filters.trigger) || "all";
    var statusFilter = (filters && filters.status) || "all";
    return runs.filter(function (run) {
      if (triggerFilter === "manual" && run.trigger !== "manual") return false;
      if (triggerFilter === "scheduled" && !SCHEDULED_TRIGGERS[run.trigger]) return false;
      if (statusFilter === "success" && run.status !== "success") return false;
      if (statusFilter === "failure" && run.status !== "failure") return false;
      return true;
    });
  }

  /**
   * Fetch DiscoveryRuns rows from the Google Sheet.
   *
   * Resolves to:
   *   { ok: true, runs: Run[] } on success (runs is newest-first, capped at MAX_ROWS)
   *   { ok: true, runs: [], reason: "missing_tab" } when the tab doesn't exist yet
   *   { ok: true, runs: [], reason: "empty" } when the tab exists but has no rows
   *   { ok: false, reason: string } on hard failure
   *
   * Accepts an options.fetchImpl for testing (defaults to window.fetch).
   */
  async function fetchDiscoveryRuns(sheetId, accessToken, options) {
    var opts = options || {};
    var fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!fetchImpl) return { ok: false, reason: "fetch is not available" };
    if (!sheetId || typeof sheetId !== "string") {
      return { ok: false, reason: "sheetId is required" };
    }
    if (!accessToken || typeof accessToken !== "string") {
      return { ok: false, reason: "signed_out" };
    }

    var url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(sheetId) +
      "/values/" +
      encodeURIComponent(SHEET_RANGE) +
      "?valueRenderOption=UNFORMATTED_VALUE";

    var response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: "Bearer " + accessToken },
      });
    } catch (error) {
      return {
        ok: false,
        reason:
          "network error: " +
          (error && error.message ? error.message : String(error)),
      };
    }

    if (response.status === 400) {
      // Sheets returns 400 with "Unable to parse range" when the tab doesn't exist.
      var body = await response.text().catch(function () { return ""; });
      if (/Unable to parse range/i.test(body) || /not found/i.test(body)) {
        return { ok: true, runs: [], reason: "missing_tab" };
      }
      return { ok: false, reason: "HTTP 400 - " + body };
    }
    if (response.status === 401) return { ok: false, reason: "unauthorized" };
    if (!response.ok) {
      var detail = await response.text().catch(function () { return ""; });
      return {
        ok: false,
        reason: "HTTP " + response.status + (detail ? " - " + detail : ""),
      };
    }

    var data;
    try {
      data = await response.json();
    } catch (error) {
      return { ok: false, reason: "invalid JSON from Sheets API" };
    }

    var runs = parseDiscoveryRunsValues(data && data.values);
    if (runs.length === 0) return { ok: true, runs: [], reason: "empty" };
    var sorted = sortRuns(runs, DEFAULT_SORT.key, DEFAULT_SORT.direction);
    if (sorted.length > MAX_ROWS) sorted = sorted.slice(0, MAX_ROWS);
    return { ok: true, runs: sorted };
  }

  function formatRunAt(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  function formatDuration(durationS) {
    var n = toInt(durationS);
    if (n <= 0) return "—";
    if (n < 60) return n + "s";
    var mins = Math.floor(n / 60);
    var secs = n % 60;
    return mins + "m " + secs + "s";
  }

  function statusBadge(status) {
    var safe = escapeHtml(status || "");
    return (
      '<span class="runs-status-badge runs-status-badge--' +
      safe +
      '">' +
      safe +
      "</span>"
    );
  }

  function triggerLabel(trigger) {
    if (trigger === "manual") return "Manual";
    if (trigger === "scheduled-local") return "Scheduled (local)";
    if (trigger === "scheduled-github") return "Scheduled (GitHub)";
    if (trigger === "scheduled-appsscript") return "Scheduled (Apps Script)";
    if (trigger === "cli") return "CLI";
    return trigger || "";
  }

  function renderRunsTable(tbody, runs) {
    if (!tbody) return;
    if (!runs || runs.length === 0) {
      tbody.innerHTML = "";
      return;
    }
    var html = "";
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      html +=
        '<tr class="runs-row runs-row--' + escapeHtml(r.status) + '">' +
        "<td>" + escapeHtml(formatRunAt(r.runAt)) + "</td>" +
        "<td>" + escapeHtml(triggerLabel(r.trigger)) + "</td>" +
        "<td>" + statusBadge(r.status) + "</td>" +
        "<td>" + escapeHtml(formatDuration(r.durationS)) + "</td>" +
        "<td>" + escapeHtml(String(r.companiesSeen)) + "</td>" +
        "<td>" + escapeHtml(String(r.leadsWritten)) + "</td>" +
        "<td>" + escapeHtml(r.source) + "</td>" +
        "<td><code>" + escapeHtml(r.variationKey) + "</code></td>" +
        '<td class="runs-error-cell">' + escapeHtml(r.error) + "</td>" +
        "</tr>";
    }
    tbody.innerHTML = html;
  }

  function setStatus(statusEl, kind, message) {
    if (!statusEl) return;
    statusEl.className = "runs-status runs-status--" + kind;
    statusEl.textContent = message || "";
  }

  function initRunsTab() {
    var modal = document.getElementById("runsModal");
    var openBtn = document.getElementById("runsBtn");
    var closeBtn = document.getElementById("runsModalClose");
    var refreshBtn = document.getElementById("runsRefreshBtn");
    var statusEl = document.getElementById("runsStatus");
    var tbody = document.getElementById("runsTableBody");
    var table = document.getElementById("runsTable");
    if (!modal || !openBtn || !tbody || !statusEl) return;

    var state = {
      rawRuns: [],
      filters: { trigger: "all", status: "all" },
      sort: { key: DEFAULT_SORT.key, direction: DEFAULT_SORT.direction },
      refreshTimer: null,
      loading: false,
    };

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

    function readAccessToken() {
      // app.js exposes a minimal getter; gracefully degrade when not wired.
      if (window.JobBored && typeof window.JobBored.getAccessToken === "function") {
        var token = window.JobBored.getAccessToken();
        if (typeof token === "string" && token) return token;
      }
      return "";
    }

    function rerender() {
      var filtered = filterRuns(state.rawRuns, state.filters);
      var sorted = sortRuns(filtered, state.sort.key, state.sort.direction);
      renderRunsTable(tbody, sorted);
      if (state.rawRuns.length === 0) {
        // Initial empty state is handled by the status line, not the table.
        return;
      }
      if (filtered.length === 0) {
        setStatus(
          statusEl,
          "info",
          "No runs match the current filters.",
        );
      } else if (!state.loading) {
        setStatus(
          statusEl,
          "ok",
          "Showing " + filtered.length + " of " + state.rawRuns.length + " runs.",
        );
      }
    }

    async function loadRuns() {
      if (state.loading) return;
      state.loading = true;
      var sheetId = readSheetId();
      var token = readAccessToken();
      if (!sheetId) {
        setStatus(
          statusEl,
          "warn",
          "Connect a sheet in Settings → Sheet before runs can be loaded.",
        );
        state.loading = false;
        return;
      }
      if (!token) {
        setStatus(
          statusEl,
          "warn",
          "Sign in with Google to read the DiscoveryRuns tab.",
        );
        state.loading = false;
        return;
      }
      setStatus(statusEl, "info", "Loading…");
      try {
        var result = await fetchDiscoveryRuns(sheetId, token);
        if (!result.ok) {
          setStatus(statusEl, "error", "Couldn't load runs: " + result.reason);
          return;
        }
        state.rawRuns = result.runs;
        if (result.reason === "missing_tab") {
          setStatus(
            statusEl,
            "info",
            "No runs logged yet — trigger a discovery to populate this list.",
          );
          tbody.innerHTML = "";
          return;
        }
        if (result.reason === "empty") {
          setStatus(
            statusEl,
            "info",
            "No runs logged yet — trigger a discovery to populate this list.",
          );
          tbody.innerHTML = "";
          return;
        }
        rerender();
      } finally {
        state.loading = false;
      }
    }

    function startAutoRefresh() {
      if (state.refreshTimer) clearInterval(state.refreshTimer);
      state.refreshTimer = setInterval(loadRuns, AUTO_REFRESH_MS);
    }

    function stopAutoRefresh() {
      if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
      }
    }

    function openModal() {
      modal.style.display = "flex";
      modal.setAttribute("aria-hidden", "false");
      loadRuns();
      startAutoRefresh();
    }

    function closeModal() {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      stopAutoRefresh();
    }

    openBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (refreshBtn) refreshBtn.addEventListener("click", loadRuns);
    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeModal();
    });

    var chipGroups = modal.querySelectorAll("[data-runs-filter-group]");
    chipGroups.forEach(function (group) {
      group.addEventListener("click", function (event) {
        var target = event.target;
        if (!(target instanceof Element)) return;
        var chip = target.closest(".runs-filter-chip");
        if (!chip) return;
        var groupName = group.getAttribute("data-runs-filter-group");
        var value;
        if (groupName === "trigger") {
          value = chip.getAttribute("data-runs-filter-trigger") || "all";
          state.filters.trigger = value;
        } else if (groupName === "status") {
          value = chip.getAttribute("data-runs-filter-status") || "all";
          state.filters.status = value;
        }
        var siblings = group.querySelectorAll(".runs-filter-chip");
        siblings.forEach(function (s) { s.classList.remove("is-active"); });
        chip.classList.add("is-active");
        rerender();
      });
    });

    if (table) {
      table.addEventListener("click", function (event) {
        var target = event.target;
        if (!(target instanceof Element)) return;
        var th = target.closest("th[data-runs-sort]");
        if (!th) return;
        var key = th.getAttribute("data-runs-sort");
        if (!key) return;
        if (state.sort.key === key) {
          state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
        } else {
          state.sort.key = key;
          state.sort.direction = "desc";
        }
        rerender();
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && modal.style.display !== "none") {
        closeModal();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRunsTab);
  } else {
    initRunsTab();
  }

  window.JobBoredRunsLog = {
    fetchDiscoveryRuns: fetchDiscoveryRuns,
    parseDiscoveryRunsValues: parseDiscoveryRunsValues,
    sortRuns: sortRuns,
    filterRuns: filterRuns,
  };
})();
