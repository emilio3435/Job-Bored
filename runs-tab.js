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
  var SHEET_RANGE = "DiscoveryRuns!A2:J";
  var AUTO_REFRESH_MS = 60 * 1000;
  var DEFAULT_SORT = { key: "runAt", direction: "desc" };
  var MAX_ROWS = 200;
  var JOB_DISCOVERY_RUN_STORAGE_KEY = "command_center_discovery_run_state";

  var SCHEDULED_TRIGGERS = {
    "scheduled-local": true,
    "scheduled-github": true,
    "scheduled-appsscript": true,
  };
  var ACTIVE_JOB_DISCOVERY_STATUSES = {
    pending: true,
    running: true,
    polling_error: true,
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
      var hasUpdatedColumn = row.length >= 10;
      out.push({
        runAt: String(row[0] || ""),
        trigger: String(row[1] || ""),
        status: String(row[2] || ""),
        durationS: toInt(row[3]),
        companiesSeen: toInt(row[4]),
        leadsWritten: toInt(row[5]),
        leadsUpdated: hasUpdatedColumn ? toInt(row[6]) : 0,
        source: String(hasUpdatedColumn ? row[7] : row[6] || ""),
        variationKey: String(hasUpdatedColumn ? row[8] : row[7] || ""),
        error: String(hasUpdatedColumn ? row[9] : row[8] || ""),
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

  function statusBadge(status, labelOverride) {
    var safe = escapeHtml(status || "");
    var label = labelOverride || (status === "in_progress" ? "In progress" : safe);
    return (
      '<span class="runs-status-badge runs-status-badge--' +
      safe +
      '">' +
      label +
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

  // Short form for the Run At column so the first column doesn't blow
  // out into two wrapped lines and break the sticky-header grid.
  function formatRunAtShort(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    try {
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (_) {
      return d.toLocaleString();
    }
  }

  function normalizeJobDiscoveryRunState(raw) {
    var o = raw && raw.state && typeof raw.state === "object" ? raw.state : raw;
    if (!o || typeof o !== "object") return null;
    var status = String(o.status || "").toLowerCase();
    var runId = String(o.runId || "").trim();
    if (!runId || !ACTIVE_JOB_DISCOVERY_STATUSES[status]) return null;
    var runAt = String(o.initiatedAt || o.requestedAt || o.startedAt || "").trim();
    if (!runAt) runAt = new Date().toISOString();
    return {
      runAt: runAt,
      trigger: String(o.trigger || "manual"),
      status: status,
      runId: runId,
      statusPath: String(o.statusPath || ""),
      variationKey: String(o.variationKey || ""),
      message: String(o.message || o.errorMessage || ""),
      error: String(o.errorMessage || ""),
      companiesSeen: toInt(o.companiesSeen),
      leadsWritten: toInt(o.leadsWritten),
      leadsUpdated: toInt(o.leadsUpdated),
    };
  }

  function readStoredJobDiscoveryRun() {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return null;
      var raw = localStorage.getItem(JOB_DISCOVERY_RUN_STORAGE_KEY);
      if (!raw) return null;
      return normalizeJobDiscoveryRunState(JSON.parse(raw));
    } catch (_) {
      return null;
    }
  }

  function clearStoredJobDiscoveryRun() {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return;
      localStorage.removeItem(JOB_DISCOVERY_RUN_STORAGE_KEY);
    } catch (_) {}
  }

  function asTimestampMs(value) {
    var ms = Date.parse(String(value || ""));
    return Number.isFinite(ms) ? ms : 0;
  }

  function hasTerminalSheetMatchForLiveRun(liveJobRun, runs) {
    if (!liveJobRun || !Array.isArray(runs) || runs.length === 0) return false;
    var liveVariation = String(liveJobRun.variationKey || "").trim();
    var liveTrigger = String(liveJobRun.trigger || "manual").trim().toLowerCase();
    var liveRunAtMs = asTimestampMs(liveJobRun.runAt);
    var newestTerminalAtMs = 0;
    for (var i = 0; i < runs.length; i++) {
      var row = runs[i] || {};
      var rowStatus = String(row.status || "").trim().toLowerCase();
      if (!rowStatus || rowStatus === "in_progress" || ACTIVE_JOB_DISCOVERY_STATUSES[rowStatus]) {
        continue;
      }
      var rowTrigger = String(row.trigger || "").trim().toLowerCase();
      if (liveTrigger && rowTrigger && rowTrigger !== liveTrigger) continue;
      var rowRunAtMs = asTimestampMs(row.runAt);
      if (rowRunAtMs > newestTerminalAtMs) newestTerminalAtMs = rowRunAtMs;
      if (liveVariation && String(row.variationKey || "").trim() === liveVariation) {
        if (!liveRunAtMs || !rowRunAtMs || rowRunAtMs + 60 * 1000 >= liveRunAtMs) {
          return true;
        }
      }
    }
    // Fallback when variation key is missing: if we already have a newer
    // terminal row for the same trigger, suppress the stale live banner.
    if (!liveVariation && liveRunAtMs && newestTerminalAtMs >= liveRunAtMs) {
      return true;
    }
    return false;
  }

  function jobDiscoveryStatusLabel(status) {
    if (status === "pending") return "Accepted";
    if (status === "polling_error") return "Retrying";
    return "Running";
  }

  function renderRunsTable(tbody, runs, options) {
    if (!tbody) return;
    var opts = options || {};
    var ghost = opts.ghost || null;
    var liveJobRun = opts.liveJobRun || null;
    var parts = [];
    if (liveJobRun) parts.push(renderLiveJobRunRowHtml(liveJobRun));
    if (ghost) parts.push(renderGhostRowHtml(ghost));
    if (runs && runs.length > 0) {
      for (var i = 0; i < runs.length; i++) {
        var r = runs[i];
        var errorText = r.error ? String(r.error) : "";
        parts.push(
          '<tr class="runs-row runs-row--' + escapeHtml(r.status) + '">' +
            '<td title="' + escapeHtml(formatRunAt(r.runAt)) + '">' +
              escapeHtml(formatRunAtShort(r.runAt)) +
            "</td>" +
            "<td>" + escapeHtml(triggerLabel(r.trigger)) + "</td>" +
            "<td>" + statusBadge(r.status) + "</td>" +
            "<td>" + escapeHtml(formatDuration(r.durationS)) + "</td>" +
            "<td>" + escapeHtml(String(r.companiesSeen)) + "</td>" +
            "<td>" + escapeHtml(String(r.leadsWritten)) + "</td>" +
            "<td>" + escapeHtml(String(r.leadsUpdated || 0)) + "</td>" +
            "<td>" + escapeHtml(r.source) + "</td>" +
            "<td><code>" + escapeHtml(r.variationKey) + "</code></td>" +
            '<td class="runs-error-cell"' +
              (errorText ? ' title="' + escapeHtml(errorText) + '"' : "") +
              ">" +
              escapeHtml(errorText) +
            "</td>" +
          "</tr>"
        );
      }
    }
    tbody.innerHTML = parts.join("");
  }

  function renderGhostRowHtml(ghost) {
    var runAt = ghost && ghost.runAt ? new Date(ghost.runAt) : new Date();
    var runAtIso = runAt.toISOString();
    return (
      '<tr class="runs-row runs-row--in-progress" data-runs-ghost="1">' +
        '<td title="' + escapeHtml(runAtIso) + '">' +
          escapeHtml(formatRunAtShort(runAtIso)) +
        "</td>" +
        "<td>" + escapeHtml(triggerLabel("manual")) + "</td>" +
        "<td>" + statusBadge("in_progress") + "</td>" +
        '<td><span class="runs-dash">—</span></td>' +
        '<td><span class="runs-dash">—</span></td>' +
        '<td><span class="runs-dash">—</span></td>' +
        '<td><span class="runs-dash">—</span></td>' +
        '<td><span class="runs-dash">—</span></td>' +
        '<td><span class="runs-dash">—</span></td>' +
        '<td class="runs-error-cell"></td>' +
      "</tr>"
    );
  }

  function renderLiveJobRunRowHtml(run) {
    var runAt = run && run.runAt ? new Date(run.runAt) : new Date();
    var runAtIso = Number.isNaN(runAt.getTime())
      ? new Date().toISOString()
      : runAt.toISOString();
    var status = run && run.status ? run.status : "running";
    var errorText = run && run.error ? String(run.error) : "";
    var companiesSeen = run && run.companiesSeen > 0 ? String(run.companiesSeen) : "—";
    var leadsWritten = run && run.leadsWritten > 0 ? String(run.leadsWritten) : "—";
    var leadsUpdated = run && run.leadsUpdated > 0 ? String(run.leadsUpdated) : "—";
    return (
      '<tr class="runs-row runs-row--in-progress" data-runs-live="job-discovery">' +
        '<td title="' + escapeHtml(runAtIso) + '">' +
          escapeHtml(formatRunAtShort(runAtIso)) +
        "</td>" +
        "<td>" + escapeHtml(triggerLabel((run && run.trigger) || "manual")) + "</td>" +
        "<td>" + statusBadge("in_progress", jobDiscoveryStatusLabel(status)) + "</td>" +
        '<td><span class="runs-dash">Live</span></td>' +
        "<td>" + escapeHtml(companiesSeen) + "</td>" +
        "<td>" + escapeHtml(leadsWritten) + "</td>" +
        "<td>" + escapeHtml(leadsUpdated) + "</td>" +
        "<td>Job discovery</td>" +
        "<td><code>" + escapeHtml((run && run.variationKey) || "") + "</code></td>" +
        '<td class="runs-error-cell"' +
          (errorText ? ' title="' + escapeHtml(errorText) + '"' : "") +
          ">" +
          escapeHtml(errorText) +
        "</td>" +
      "</tr>"
    );
  }

  function renderSkeletonRows(tbody, count) {
    if (!tbody) return;
    var n = count > 0 ? count : 5;
    var bar = '<span class="runs-skeleton-bar" aria-hidden="true"></span>';
    var row =
      '<tr class="runs-row runs-row--skeleton" aria-hidden="true">' +
        "<td>" + bar + "</td>" +
        "<td>" + bar + "</td>" +
        "<td>" + bar + "</td>" +
        "<td>" + bar + "</td>" +
        "<td>" + bar + "</td>" +
        "<td>" + bar + "</td>" +
        "<td>" + bar + "</td>" +
        "<td>" + bar + "</td>" +
        "<td>" + bar + "</td>" +
        "<td>" + bar + "</td>" +
      "</tr>";
    var html = "";
    for (var i = 0; i < n; i++) html += row;
    tbody.innerHTML = html;
  }

  function setStatus(statusEl, kind, message) {
    if (!statusEl) return;
    statusEl.className = "runs-status runs-status--" + kind;
    statusEl.textContent = message || "";
  }

  function renderEmptyState(container, options) {
    if (!container) return;
    var opts = options || {};
    var title = escapeHtml(opts.title || "No runs logged yet");
    var hint = escapeHtml(
      opts.hint ||
        "Trigger a discovery to populate this list. Every manual and scheduled run appears here.",
    );
    container.innerHTML =
      '<div class="runs-empty" role="status">' +
        '<div class="runs-empty__icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>' +
            '<path d="M3 3v5h5"/>' +
            '<path d="M12 7v5l3 2"/>' +
          "</svg>" +
        "</div>" +
        '<p class="runs-empty__title">' + title + "</p>" +
        '<p class="runs-empty__hint">' + hint + "</p>" +
      "</div>";
  }

  function initRunsTab() {
    var modal = document.getElementById("runsModal");
    var openBtn = document.getElementById("runsBtn");
    var closeBtn = document.getElementById("runsModalClose");
    var refreshBtn = document.getElementById("runsRefreshBtn");
    var statusEl = document.getElementById("runsStatus");
    var tbody = document.getElementById("runsTableBody");
    var table = document.getElementById("runsTable");
    var tableWrap = modal ? modal.querySelector(".runs-table-wrap") : null;
    if (!modal || !openBtn || !tbody || !statusEl) return;

    // Stash the original wrap HTML so we can restore the table after the
    // empty state replaces its contents.
    var originalTableWrapHtml = tableWrap ? tableWrap.innerHTML : "";

    var state = {
      rawRuns: [],
      filters: { trigger: "all", status: "all" },
      sort: { key: DEFAULT_SORT.key, direction: DEFAULT_SORT.direction },
      refreshTimer: null,
      loading: false,
      hasLoadedOnce: false,
      ghostRun: null,
      liveJobRun: readStoredJobDiscoveryRun(),
      isOpen: false,
    };

    function refreshTableRefs() {
      // Empty state nukes the <table>, so after we restore we need fresh
      // references to the new thead/tbody nodes.
      table = document.getElementById("runsTable");
      tbody = document.getElementById("runsTableBody");
    }

    function showTable() {
      if (!tableWrap) return;
      if (!tableWrap.querySelector("#runsTable")) {
        tableWrap.innerHTML = originalTableWrapHtml;
        refreshTableRefs();
      }
    }

    function showEmpty(options) {
      if (!tableWrap) return;
      renderEmptyState(tableWrap, options);
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
      var hasContent = sorted.length > 0 || !!state.ghostRun || !!state.liveJobRun;
      if (hasContent) {
        showTable();
        renderRunsTable(tbody, sorted, {
          ghost: state.ghostRun,
          liveJobRun: state.liveJobRun,
        });
      } else if (state.rawRuns.length > 0) {
        // Filter chips emptied the visible set, but we do have rows —
        // keep the table visible with no rows + a status hint.
        showTable();
        renderRunsTable(tbody, [], { ghost: null });
      }
      if (state.rawRuns.length === 0 && !state.ghostRun && !state.liveJobRun) {
        if (!state.loading && state.hasLoadedOnce) {
          showTable();
          renderRunsTable(tbody, [], { ghost: null, liveJobRun: null });
          showEmpty({
            title: "No runs logged yet",
            hint: "Trigger a discovery to populate this list. Every manual and scheduled run appears here.",
          });
        }
        return;
      }
      if (filtered.length === 0 && !state.ghostRun && !state.liveJobRun) {
        setStatus(
          statusEl,
          "info",
          "No runs match the current filters.",
        );
      } else if (!state.loading) {
        var extras = [];
        if (state.liveJobRun) extras.push("+1 live job run");
        if (state.ghostRun) extras.push("+1 company run");
        var extra = extras.length ? " (" + extras.join(", ") + ")" : "";
        setStatus(
          statusEl,
          "ok",
          "Showing " + filtered.length + " of " + state.rawRuns.length + " runs" + extra + ".",
        );
      }
    }

    async function loadRuns(options) {
      var opts = options || {};
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
        showEmpty({
          title: "No sheet connected",
          hint: "Open Settings → Sheet and paste your pipeline sheet ID so the DiscoveryRuns tab can be read.",
        });
        state.loading = false;
        return;
      }
      if (!token) {
        setStatus(
          statusEl,
          "warn",
          "Sign in with Google to read the DiscoveryRuns tab.",
        );
        showEmpty({
          title: "Sign in to see runs",
          hint: "Discovery run history is read directly from your Google Sheet — sign in above and reopen this panel.",
        });
        state.loading = false;
        return;
      }

      var isInitial = !state.hasLoadedOnce && !opts.silent;
      if (isInitial) {
        showTable();
        renderSkeletonRows(tbody, 6);
        setStatus(statusEl, "info", "Loading runs…");
      } else if (!opts.silent) {
        setStatus(statusEl, "info", "Refreshing…");
      }

      try {
        var result = await fetchDiscoveryRuns(sheetId, token);
        state.hasLoadedOnce = true;
        if (!result.ok) {
          setStatus(statusEl, "error", "Couldn't load runs: " + result.reason);
          if (isInitial) {
            showEmpty({
              title: "Couldn't load runs",
              hint: "Check your connection and try Reload. Full detail: " + result.reason,
            });
          }
          return;
        }
        state.rawRuns = result.runs;
        if (state.liveJobRun && hasTerminalSheetMatchForLiveRun(state.liveJobRun, state.rawRuns)) {
          state.liveJobRun = null;
          clearStoredJobDiscoveryRun();
        }
        if (result.reason === "missing_tab" || result.reason === "empty") {
          if (state.ghostRun || state.liveJobRun) {
            // Render a table view with just the ghost row so the pending
            // manual/live run stays visible while the sheet is still empty.
            showTable();
            renderRunsTable(tbody, [], {
              ghost: state.ghostRun,
              liveJobRun: state.liveJobRun,
            });
            setStatus(statusEl, "info", "Discovery run in progress…");
          } else {
            showEmpty({
              title: "No runs logged yet",
              hint:
                result.reason === "missing_tab"
                  ? "The DiscoveryRuns tab will appear on the first completed run. Trigger a discovery to get started."
                  : "Trigger a discovery from Settings → Profile → Run discovery to populate this list.",
            });
            setStatus(statusEl, "info", "");
          }
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
      state.isOpen = true;
      state.liveJobRun = readStoredJobDiscoveryRun();
      loadRuns();
      startAutoRefresh();
    }

    function closeModal() {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      state.isOpen = false;
      stopAutoRefresh();
    }

    openBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (refreshBtn) refreshBtn.addEventListener("click", function () { loadRuns(); });
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

    // The <table> can be swapped by the empty-state renderer, so delegate
    // the sort-header click to the (stable) .runs-table-wrap.
    if (tableWrap) {
      tableWrap.addEventListener("click", function (event) {
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

    // Job 2 — in-progress ghost row for manual runs.
    // settings-profile-tab.js dispatches these events around its POST to
    // /discovery-profile. The ghost row is client-side only; once the run
    // finishes we immediately refetch so the real row from the sheet
    // replaces it. If the modal is closed, we simply ignore the events —
    // the next open will fetch the fresh list on its own.
    document.addEventListener("jobbored:discovery-run-started", function () {
      if (!state.isOpen) return;
      state.ghostRun = { runAt: new Date().toISOString() };
      rerender();
      setStatus(statusEl, "info", "Manual run in progress…");
    });

    document.addEventListener("jobbored:discovery-run-finished", function () {
      if (state.ghostRun) {
        state.ghostRun = null;
      }
      if (!state.isOpen) return;
      // Immediate refetch — don't wait for the 60s interval.
      loadRuns({ silent: false });
    });

    document.addEventListener("jobbored:job-discovery-run-updated", function (event) {
      var next = normalizeJobDiscoveryRunState(event && event.detail);
      var hadLiveRun = !!state.liveJobRun;
      state.liveJobRun = next;
      if (!state.isOpen) return;
      if (state.liveJobRun) {
        rerender();
        setStatus(statusEl, "info", "Job discovery run in progress…");
        return;
      }
      rerender();
      if (hadLiveRun) {
        loadRuns({ silent: false });
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
    // Test-only hooks (not part of the runtime UI surface).
    __test: {
      renderGhostRowHtml: renderGhostRowHtml,
      renderSkeletonRows: renderSkeletonRows,
      renderRunsTable: renderRunsTable,
      renderEmptyState: renderEmptyState,
      normalizeJobDiscoveryRunState: normalizeJobDiscoveryRunState,
      readStoredJobDiscoveryRun: readStoredJobDiscoveryRun,
      renderLiveJobRunRowHtml: renderLiveJobRunRowHtml,
      initRunsTab: initRunsTab,
      triggerLabel: triggerLabel,
    },
  };
})();
