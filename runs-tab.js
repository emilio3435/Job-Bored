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

  var SHEET_RANGE = "DiscoveryRuns!A1:K";
  var AUTO_REFRESH_MS = 60 * 1000;
  var DEFAULT_SORT = { key: "runAt", direction: "desc" };
  var MAX_ROWS = 200;
  var JOB_DISCOVERY_RUN_STORAGE_KEY = "command_center_discovery_run_state";

  var SCHEDULED_TRIGGERS = {
    "scheduled-browser": true,
    "scheduled-local": true,
    "scheduled-github": true,
    "scheduled-cloudflare": true,
    "scheduled-appsscript": true,
    "scheduled-hunt": true, // HOLES HUNT-FE: INTERFACE-HUNTS.md §8
  };
  var LOCAL_JOB_DISCOVERY_STATUSES = {
    pending: true,
    running: true,
    polling_error: true,
    completed: true,
    empty: true,
    partial: true,
    failed: true,
    write_failed: true,
  };
  var ACTIVE_JOB_DISCOVERY_STATUSES = {
    pending: true,
    running: true,
    polling_error: true,
    in_progress: true,
  };
  var TERMINAL_JOB_DISCOVERY_STATUSES = {
    completed: true,
    empty: true,
    partial: true,
    failed: true,
    write_failed: true,
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * User-world rendering of fetchDiscoveryRuns failure reasons. The internal
   * codes stay machine-shaped for logic (missing_tab, unauthorized); only
   * what reaches the screen is translated — every error names its next
   * action (ONE-FLOW-ONBOARDING-SPEC §8.4), never a status code.
   */
  function describeRunsFailure(reason) {
    var raw = String(reason == null ? "" : reason);
    if (raw === "signed_out" || raw === "unauthorized") {
      return "Your Google session ended — sign in again.";
    }
    if (raw === "sheetId is required") {
      return "No sheet configured — connect one in Settings.";
    }
    if (raw === "fetch is not available") {
      return "This browser can't reach Google Sheets.";
    }
    if (/^network error:/i.test(raw)) {
      return "Check your connection and try Reload.";
    }
    if (/^HTTP \d+/i.test(raw)) {
      return "Google Sheets rejected the request — try Reload.";
    }
    if (/invalid JSON/i.test(raw)) {
      return "Google Sheets sent a reply JobBored couldn't read — try Reload.";
    }
    return raw;
  }

  function toInt(value) {
    var n = typeof value === "number" ? value : parseInt(String(value), 10);
    return Number.isFinite(n) ? n : 0;
  }

  var RUN_HEADER_ALIASES = {
    "run at": "runAt",
    "trigger": "trigger",
    "status": "status",
    "duration (s)": "durationS",
    "duration": "durationS",
    "companies seen": "companiesSeen",
    "companies": "companiesSeen",
    "leads new": "leadsWritten",
    "leads": "leadsWritten",
    "leads written": "leadsWritten",
    "leads updated": "leadsUpdated",
    "source": "source",
    "variation key": "variationKey",
    "variation": "variationKey",
    "error": "error",
    "run id": "runId",
  };

  function isNumericCell(value) {
    if (typeof value === "number") return Number.isFinite(value);
    if (value == null) return false;
    var s = String(value).trim();
    if (s === "") return false;
    return /^-?\d+(\.\d+)?$/.test(s);
  }

  function metricFromCell(value) {
    if (value == null || value === "") {
      return { value: 0, availability: "unavailable" };
    }
    var n = typeof value === "number" ? value : parseInt(String(value), 10);
    if (!Number.isFinite(n)) return { value: 0, availability: "unavailable" };
    return { value: n, availability: n === 0 ? "zero" : "value" };
  }

  function detectHasLeadsUpdated(row) {
    if (!row || row.length < 7) return false;
    if (row.length >= 10) return true;
    // Sheets values.get drops trailing empty Error, so a canonical 10-col
    // success row arrives as 9 cells with numeric Leads Updated at index 6.
    // Legacy 9-col rows put Source (a non-numeric string) at index 6.
    return isNumericCell(row[6]);
  }

  function cellsFromHeaders(row, headers) {
    var mapped = {};
    if (!Array.isArray(headers)) return mapped;
    for (var i = 0; i < headers.length; i++) {
      var key = RUN_HEADER_ALIASES[String(headers[i] || "").trim().toLowerCase()];
      if (key) mapped[key] = i < row.length ? row[i] : undefined;
    }
    return mapped;
  }

  function cellsFromPositional(row) {
    var ten = detectHasLeadsUpdated(row);
    return {
      runAt: row[0],
      trigger: row[1],
      status: row[2],
      durationS: row[3],
      companiesSeen: row[4],
      leadsWritten: row[5],
      leadsUpdated: ten ? row[6] : undefined,
      source: ten ? row[7] : row[6],
      variationKey: ten ? row[8] : row[7],
      error: ten ? row[9] : row[8],
      runId: ten ? row[10] : undefined,
    };
  }

  function buildParsedRun(cells) {
    var duration = metricFromCell(cells.durationS);
    var companies = metricFromCell(cells.companiesSeen);
    var leadsWritten = metricFromCell(cells.leadsWritten);
    var leadsUpdated = metricFromCell(cells.leadsUpdated);
    var status = String(cells.status || "");
    var error = String(cells.error == null ? "" : cells.error);
    var variationKey = String(cells.variationKey == null ? "" : cells.variationKey);
    var source = String(cells.source == null ? "" : cells.source);
    // Never let a successful status, source, or variation key occupy Error
    // when Sheets omitted the trailing empty cell.
    if (error && (error === status || error === source || error === variationKey)) {
      error = "";
    }
    if (status === "success") error = "";
    return {
      runAt: String(cells.runAt || ""),
      trigger: String(cells.trigger || ""),
      status: status,
      durationS: duration.value,
      durationSAvailability: duration.availability,
      companiesSeen: companies.value,
      companiesSeenAvailability: companies.availability,
      leadsWritten: leadsWritten.value,
      leadsWrittenAvailability: leadsWritten.availability,
      leadsUpdated: leadsUpdated.value,
      leadsUpdatedAvailability: leadsUpdated.availability,
      source: source,
      variationKey: variationKey,
      error: error,
      runId: String(cells.runId == null ? "" : cells.runId).trim(),
    };
  }

  /**
   * Parse raw Sheets values (rows beneath the header, column order must match
   * DISCOVERY_RUNS_HEADER_ROW) into typed run objects.
   *
   * Input: string[][] (Sheets values.get response shape)
   * Output: Run[] where each Run matches the DiscoveryRunLogRow contract.
   *
   * options.headers: optional header row (F1-B versioned contract). When
   * present, cells are mapped by header name so 9-vs-10 and trailing-empty
   * Sheets responses cannot shift Source/Variation into Error.
   */
  function parseDiscoveryRunsValues(values, options) {
    if (!Array.isArray(values)) return [];
    var headers = options && Array.isArray(options.headers) ? options.headers : null;
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var row = values[i];
      if (!Array.isArray(row)) continue;
      var cells = headers ? cellsFromHeaders(row, headers) : cellsFromPositional(row);
      // Require at least Run At + Trigger + Status — rows with all three blank
      // are abandoned cells we want to skip rather than render as junk.
      if (!cells.runAt || !cells.trigger || !cells.status) continue;
      out.push(buildParsedRun(cells));
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
      if (statusFilter === "partial" && run.status !== "partial") return false;
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

    // RUNHIST: the range starts at the header row so the appended Run ID
    // column (K) maps by name; a header-less response parses positionally.
    var values = data && Array.isArray(data.values) ? data.values : [];
    var headerRow =
      Array.isArray(values[0]) && String(values[0][0] || "").trim().toLowerCase() === "run at"
        ? values[0]
        : null;
    var runs = headerRow
      ? parseDiscoveryRunsValues(values.slice(1), { headers: headerRow })
      : parseDiscoveryRunsValues(values);
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

  function formatDuration(durationS, availability) {
    if (availability === "unavailable") {
      return '<span class="runs-dash" data-availability="unavailable">—</span>';
    }
    var n = toInt(durationS);
    if (availability === "zero" || n <= 0) {
      return '<span class="runs-dash" data-availability="zero">—</span>';
    }
    var label;
    if (n < 60) label = n + "s";
    else {
      var mins = Math.floor(n / 60);
      var secs = n % 60;
      label = mins + "m " + secs + "s";
    }
    return escapeHtml(label);
  }

  function formatMetricCell(value, availability) {
    if (availability === "unavailable") {
      return '<span class="runs-dash" data-availability="unavailable">—</span>';
    }
    if (availability === "zero") {
      return '<span data-availability="zero">' + escapeHtml(String(value || 0)) + "</span>";
    }
    if (value == null || value === "") {
      return '<span class="runs-dash" data-availability="unavailable">—</span>';
    }
    return escapeHtml(String(value));
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
    if (trigger === "scheduled") return "Scheduled";
    if (trigger === "scheduled-browser") return "Scheduled (browser)";
    if (trigger === "scheduled-local") return "Scheduled (local)";
    if (trigger === "scheduled-github") return "Scheduled (GitHub)";
    if (trigger === "scheduled-cloudflare") return "Scheduled (Cloudflare)";
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
    if (!runId || !LOCAL_JOB_DISCOVERY_STATUSES[status]) return null;
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
      statusUnavailable: !!o.statusUnavailable,
      // Live progress (UXD-FE): the tracker's view-model reads these.
      startedAt: String(o.startedAt || ""),
      initiatedAt: String(o.initiatedAt || ""),
      progress: o.progress && typeof o.progress === "object" ? o.progress : null,
      progressObservedAt: String(o.progressObservedAt || ""),
      progressHeartbeatSeen: !!o.progressHeartbeatSeen,
      pollErrorCount: toInt(o.pollErrorCount),
      statusEndpointTerminal: !!o.statusEndpointTerminal,
      // DISCAT D9: lifecycle.filterStats from the run status (absent on
      // runs from before DISCAT).
      filterStats: o.filterStats && typeof o.filterStats === "object" ? o.filterStats : null,
    };
  }

  // DISCAT D9: name the exclude keyword when it alone removed at least a
  // quarter of the listings a run saw. States the fact; changes nothing.
  var FILTER_HINT_MIN_SHARE = 0.25;

  function formatCount(n) {
    try {
      return Number(n).toLocaleString("en-US");
    } catch (_) {
      return String(n);
    }
  }

  // DISCAT Fix-B: plain-language cause for each backend rejection reason
  // code. excluded_keyword is absent on purpose: a keyword hint must name the
  // keyword (byExcludeKeyword), and older runs mislabelled other drops as it.
  var FILTER_REASON_LABELS = {
    remote_unknown: "their remote status was unknown",
    remote_policy_mismatch: "they did not match your remote preference",
    location_mismatch: "their location was outside the places you listed",
    skip_title: "their title contained one of your skip-title phrases",
    work_auth_mismatch: "they said they would not sponsor a work visa",
    salary_below_floor: "their published salary was below your floor",
    salary_missing: "they did not publish a salary and you require one",
    headline_mismatch: "their title did not match your target roles",
    missing_required_fields: "they were missing a title, company or link",
    matcher_rejected: "the matcher judged them a poor fit",
  };

  function positiveCount(value) {
    var n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Up to two lines, larger cause first: the largest precise reason and the
   * largest exclude keyword, each stated only when it alone removed at least
   * 25% of the listings the run saw, so a large reason never hides a
   * keyword hint. Lines are joined with "\n". Changes nothing.
   */
  function filterHintText(filterStats) {
    if (!filterStats || typeof filterStats !== "object") return "";
    var seen = Number(filterStats.listingsSeen);
    if (!Number.isFinite(seen) || seen <= 0) return "";
    var topKeyword = null;
    var keywords = Array.isArray(filterStats.byExcludeKeyword) ? filterStats.byExcludeKeyword : [];
    for (var i = 0; i < keywords.length; i++) {
      var entry = keywords[i];
      if (!entry || typeof entry.keyword !== "string" || !entry.keyword.trim()) continue;
      var count = positiveCount(entry.count);
      if (count && (!topKeyword || count > topKeyword.count)) {
        topKeyword = { keyword: entry.keyword.trim(), count: count };
      }
    }
    var topReason = null;
    var reasons = filterStats.byReason && typeof filterStats.byReason === "object" ? filterStats.byReason : {};
    for (var code in reasons) {
      if (!Object.prototype.hasOwnProperty.call(reasons, code)) continue;
      if (!Object.prototype.hasOwnProperty.call(FILTER_REASON_LABELS, code)) continue;
      var reasonCount = positiveCount(reasons[code]);
      if (reasonCount && (!topReason || reasonCount > topReason.count)) {
        topReason = { reason: code, count: reasonCount };
      }
    }
    var causes = [topReason, topKeyword].filter(function (cause) {
      return cause && cause.count / seen >= FILTER_HINT_MIN_SHARE;
    });
    causes.sort(function (a, b) {
      return b.count - a.count;
    });
    return causes
      .map(function (cause) {
        var share = Math.round((cause.count / seen) * 100);
        if (cause.keyword) {
          return (
            'Your exclude keyword "' + cause.keyword + '" filtered out ' +
            formatCount(cause.count) + " of " + formatCount(seen) + " listings (" +
            share + "%)."
          );
        }
        return (
          formatCount(cause.count) + " of " + formatCount(seen) + " listings (" + share +
          "%) were dropped because " + FILTER_REASON_LABELS[cause.reason] + "."
        );
      })
      .join("\n");
  }

  function filterHintRowHtml(text) {
    if (!text) return "";
    return (
      '<tr class="runs-filter-hint-row"><td colspan="' + VISIBLE_COLUMNS + '">' +
        String(text)
          .split("\n")
          .map(function (line) {
            return '<p class="runs-filter-hint">' + escapeHtml(line) + "</p>";
          })
          .join("") +
      "</td></tr>"
    );
  }

  function liveRunTracker() {
    var rt = window.JobBoredDiscovery && window.JobBoredDiscovery.runTracker;
    return rt && typeof rt.deriveLiveRunView === "function" ? rt : null;
  }

  function liveRunView(run) {
    var rt = liveRunTracker();
    return rt && run ? rt.deriveLiveRunView(run, Date.now()) : null;
  }

  function liveProgressCellHtml(view) {
    var rt = liveRunTracker();
    return rt && view ? rt.renderLiveRunProgressHtml(view, { variant: "row" }) : "";
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
    // RUNHIST: a history row carrying the live run's own Run ID settles it.
    var liveRunId = String(liveJobRun.runId || "");
    if (liveRunId) {
      for (var k = 0; k < runs.length; k++) {
        var candidate = runs[k] || {};
        if (candidate.runId === liveRunId && candidate.status && candidate.status !== "in_progress") {
          return true;
        }
      }
    }
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
    if (status === "completed") return "Completed";
    if (status === "empty") return "Empty";
    if (status === "partial") return "Partial";
    if (status === "failed") return "Failed";
    if (status === "write_failed") return "Write failed";
    // UX01 C9 (FD-16): polling stopped for good — no retry is coming, so
    // "Retrying" was a promise. The row says what is known.
    if (status === "polling_error") return "Status unknown";
    return "Running";
  }

  function isTerminalJobDiscoveryRun(run) {
    return !!(run && TERMINAL_JOB_DISCOVERY_STATUSES[run.status]);
  }

  // UX01 C9 (FD-17): four visible columns — Run at · Status · New roles ·
  // Why — so the log fits a 375 px phone and the reason a run failed is never
  // the clipped last column. Trigger, duration, companies, updated, source
  // and variation live in a per-row disclosure. The Sheet's 10-column
  // DiscoveryRuns contract (parseDiscoveryRunsValues) is unchanged.
  var VISIBLE_COLUMNS = 4;
  var detailSeq = 0;

  function whyText(status, error) {
    var text = error ? String(error) : "";
    if (text) return text;
    if (status === "failure" || status === "partial") return "No reason logged";
    return "";
  }

  function whyCellHtml(status, error, actionHtml) {
    var text = whyText(status, error);
    return (
      '<td class="runs-why-cell">' +
        (text ? escapeHtml(text) : '<span class="runs-dash">—</span>') +
        (actionHtml || "") +
      "</td>"
    );
  }

  function retryWriteButtonHtml(run) {
    return run && run.runId && (run.workerStatus === "write_failed" || run.status === "write_failed")
      ? ' <button type="button" class="jb-btn jb-btn--secondary jb-btn--sm" data-runs-retry-write="' +
          escapeHtml(run.runId) + '">Retry write</button>'
      : "";
  }

  // HOLES HUNT-FE: the "Save as hunt" switch; hunts-ui.js renders it from the
  // saved hunts and omits it for rows without a worker run id.
  function saveHuntToggleHtml(run) {
    var huntsUi = window.JobBoredHuntsUI;
    return huntsUi && typeof huntsUi.runToggleHtml === "function"
      ? huntsUi.runToggleHtml(run)
      : "";
  }

  function newRolesCellHtml(count, availability) {
    var n = toInt(count);
    if (availability !== "unavailable" && n > 0) {
      var label = n === 1 ? "View 1 new role in Pipeline" : "View " + n + " new roles in Pipeline";
      return (
        '<td class="runs-new-cell">' +
          '<button type="button" class="runs-view-pipeline" data-runs-view-pipeline="' + n + '"' +
          ' aria-label="' + escapeHtml(label) + '">' + n + "</button>" +
        "</td>"
      );
    }
    return '<td class="runs-new-cell">' + formatMetricCell(count, availability) + "</td>";
  }

  function runAtToggleHtml(runAtIso, detailId, options) {
    var o = options || {};
    return (
      '<td class="runs-at-cell">' +
        '<button type="button" class="runs-row-toggle" id="' + detailId + '-toggle"' +
        ' aria-expanded="' + (o.open ? "true" : "false") + '"' +
        ' aria-controls="' + detailId + '"' +
        (o.key ? ' data-runs-key="' + escapeHtml(o.key) + '"' : "") +
        ' title="' + escapeHtml(formatRunAt(runAtIso)) + '">' +
          escapeHtml(formatRunAtShort(runAtIso)) +
        "</button>" +
      "</td>"
    );
  }

  // RUNHIST: the panel is a region named by its toggle, so a screen reader
  // lands in "Sep 27, 5:08 AM, region" rather than an anonymous cell.
  function detailRowHtml(detailId, content, open) {
    return (
      '<tr class="runs-detail-row" id="' + detailId + '"' + (open ? "" : " hidden") + ">" +
        '<td colspan="' + VISIBLE_COLUMNS + '">' +
          '<div class="runs-story" role="region" aria-labelledby="' + detailId + '-toggle">' +
            content +
          "</div>" +
        "</td>" +
      "</tr>"
    );
  }

  function nextDetailId() {
    detailSeq += 1;
    return "runs-detail-" + detailSeq;
  }

  function stableDetailId(key) {
    return "runs-detail-" + slug(key);
  }

  function renderRunsTable(tbody, runs, options) {
    if (!tbody) return;
    var opts = options || {};
    var ghost = opts.ghost || null;
    var liveJobRun = opts.liveJobRun || null;
    var expanded = opts.expanded || {};
    var details = opts.details || {};
    var parts = [];
    if (liveJobRun) parts.push(renderLiveJobRunRowHtml(liveJobRun));
    if (ghost) parts.push(renderGhostRowHtml(ghost));
    if (runs && runs.length > 0) {
      for (var i = 0; i < runs.length; i++) {
        var r = runs[i];
        var key = runKey(r);
        var detailId = stableDetailId(key);
        var open = !!expanded[key];
        parts.push(
          '<tr class="runs-row runs-row--' + escapeHtml(r.status) + '">' +
            runAtToggleHtml(r.runAt, detailId, { open: open, key: key }) +
            "<td>" + statusBadge(r.status) + "</td>" +
            newRolesCellHtml(r.leadsWritten, r.leadsWrittenAvailability) +
            whyCellHtml(r.status, r.error, retryWriteButtonHtml(r) + saveHuntToggleHtml(r)) +
          "</tr>" +
          filterHintRowHtml(filterHintText(r.filterStats)) +
          detailRowHtml(detailId, details[key] || renderCoarseDetailHtml(r), open)
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
        '<td class="runs-at-cell" title="' + escapeHtml(runAtIso) + '">' +
          escapeHtml(formatRunAtShort(runAtIso)) +
          '<span class="sr-only"> ' + escapeHtml(triggerLabel("manual")) + "</span>" +
        "</td>" +
        "<td>" + statusBadge("in_progress") + "</td>" +
        '<td class="runs-new-cell"><span class="runs-dash">—</span></td>' +
        '<td class="runs-why-cell"><span class="runs-dash">—</span></td>' +
      "</tr>"
    );
  }

  function renderLiveJobRunRowHtml(run) {
    var runAt = run && run.runAt ? new Date(run.runAt) : new Date();
    var runAtIso = Number.isNaN(runAt.getTime())
      ? new Date().toISOString()
      : runAt.toISOString();
    var status = run && run.status ? run.status : "running";
    var terminal = isTerminalJobDiscoveryRun(run);
    var errorText = run && run.error ? String(run.error) : "";
    var companiesSeen = run && run.companiesSeen > 0 ? String(run.companiesSeen) : "—";
    var leadsWritten = run && run.leadsWritten > 0 ? run.leadsWritten : 0;
    var leadsUpdated = run && run.leadsUpdated > 0 ? String(run.leadsUpdated) : "—";
    var detailId = nextDetailId();
    var view = terminal ? null : liveRunView(run);
    var progressCell = view ? liveProgressCellHtml(view) : "";
    var durationHtml =
      view && view.elapsedText
        ? escapeHtml(view.elapsedText)
        : '<span class="runs-dash">' + (terminal ? "Local" : "Live") + "</span>";
    return (
      '<tr class="runs-row runs-row--' + escapeHtml(terminal ? status : "in-progress") + '" data-runs-live="job-discovery">' +
        runAtToggleHtml(runAtIso, detailId) +
        "<td>" + statusBadge(terminal ? status : "in_progress", jobDiscoveryStatusLabel(status)) + "</td>" +
        (leadsWritten > 0
          ? newRolesCellHtml(leadsWritten, "")
          : '<td class="runs-new-cell"><span class="runs-dash">—</span></td>') +
        whyCellHtml(terminal ? status : "", errorText, retryWriteButtonHtml(run)) +
      "</tr>" +
      (terminal ? filterHintRowHtml(filterHintText(run && run.filterStats)) : "") +
      (progressCell
        ? '<tr class="runs-live-progress-row" data-live-run-progress="1"><td colspan="' +
          VISIBLE_COLUMNS + '">' + progressCell + "</td></tr>"
        : "") +
      detailRowHtml(detailId, detailListHtml([
        ["Trigger", escapeHtml(triggerLabel((run && run.trigger) || "manual"))],
        ["Duration", durationHtml],
        ["Companies", escapeHtml(companiesSeen)],
        ["Updated", escapeHtml(leadsUpdated)],
        ["Source", "Job discovery"],
        ["Variation", "<code>" + escapeHtml((run && run.variationKey) || "") + "</code>"],
      ]), false)
    );
  }

  function renderSkeletonRows(tbody, count) {
    if (!tbody) return;
    var n = count > 0 ? count : 5;
    var bar = '<span class="runs-skeleton-bar" aria-hidden="true"></span>';
    var cells = "";
    for (var c = 0; c < VISIBLE_COLUMNS; c++) cells += "<td>" + bar + "</td>";
    var row =
      '<tr class="runs-row runs-row--skeleton" aria-hidden="true">' + cells + "</tr>";
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

  /* ------------------------------------------------------------------
     RUNHIST (2026-09-27) — durable run history. The worker's GET /runs
     (AGREED CONTRACT, FE ⇄ BE) is merged with the Sheet's DiscoveryRuns
     rows by Run ID; either side alone still lists. Detail comes lazily
     from each summary's statusPath. D5: a number the worker did not
     measure is absent, never 0.
     ------------------------------------------------------------------ */
  var HISTORY_PAGE_SIZE = 25;
  var SHEET_STATUSES = { success: true, partial: true, failure: true };

  function workerStatusToSheetStatus(status) {
    var s = String(status || "").toLowerCase();
    if (s === "completed" || s === "empty") return "success";
    if (s === "partial") return "partial";
    if (s === "failed" || s === "write_failed") return "failure";
    return "in_progress";
  }

  function measured(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }

  function metricFromMeasured(value) {
    var n = measured(value);
    if (n === null) return { value: 0, availability: "unavailable" };
    return { value: n, availability: n === 0 ? "zero" : "value" };
  }

  function workerSummaryToRun(summary) {
    var s = summary || {};
    var headline = s.headline && typeof s.headline === "object" ? s.headline : {};
    var ms = measured(s.durationMs);
    var duration = metricFromMeasured(ms === null ? null : Math.round(ms / 1000));
    var written = metricFromMeasured(headline.written);
    var updated = metricFromMeasured(headline.updated);
    var trigger = String(s.trigger || "manual");
    return {
      runAt: String(s.completedAt || s.startedAt || ""),
      trigger: trigger === "scheduled" ? "scheduled-local" : trigger,
      status: SHEET_STATUSES[s.sheetStatus] ? s.sheetStatus : workerStatusToSheetStatus(s.status),
      durationS: duration.value,
      durationSAvailability: duration.availability,
      companiesSeen: 0,
      companiesSeenAvailability: "unavailable",
      leadsWritten: written.value,
      leadsWrittenAvailability: written.availability,
      leadsUpdated: updated.value,
      leadsUpdatedAvailability: updated.availability,
      source: "",
      variationKey: "",
      error: "",
      runId: String(s.runId || ""),
      statusPath: String(s.statusPath || ""),
      workerStatus: String(s.status || ""),
      origin: "worker",
      // DISCAT D9: the summary's filterStats (absent on runs from before
      // DISCAT) drive the filter hint under the run's row.
      filterStats: s.filterStats && typeof s.filterStats === "object" ? s.filterStats : null,
    };
  }

  function runKey(run) {
    if (run && run.runId) return "run:" + run.runId;
    return "sheet:" + String((run && run.runAt) || "") + "|" + String((run && run.trigger) || "");
  }

  function mergeRunHistory(sheetRuns, workerSummaries) {
    var byKey = {};
    var order = [];
    var sheet = Array.isArray(sheetRuns) ? sheetRuns : [];
    for (var i = 0; i < sheet.length; i++) {
      var row = sheet[i];
      if (!row) continue;
      var key = runKey(row);
      if (byKey[key]) continue;
      byKey[key] = Object.assign({}, row, {
        runId: String(row.runId || ""),
        statusPath: "",
        origin: "sheet",
      });
      order.push(key);
    }
    var workers = Array.isArray(workerSummaries) ? workerSummaries : [];
    var seenWorker = {};
    for (var j = 0; j < workers.length; j++) {
      var w = workerSummaryToRun(workers[j]);
      if (!w.runId || seenWorker[w.runId]) continue;
      seenWorker[w.runId] = true;
      var wKey = runKey(w);
      var existing = byKey[wKey];
      if (!existing) {
        byKey[wKey] = w;
        order.push(wKey);
        continue;
      }
      // Worker wins on what it measured; the Sheet fills the rest.
      var merged = Object.assign({}, existing, {
        statusPath: w.statusPath,
        workerStatus: w.workerStatus,
        filterStats: w.filterStats,
        origin: "both",
      });
      if (w.runAt) merged.runAt = w.runAt;
      if (w.status !== "in_progress") merged.status = w.status;
      ["durationS", "leadsWritten", "leadsUpdated"].forEach(function (field) {
        if (w[field + "Availability"] !== "unavailable") {
          merged[field] = w[field];
          merged[field + "Availability"] = w[field + "Availability"];
        }
      });
      byKey[wKey] = merged;
    }
    var out = order.map(function (k) { return byKey[k]; });
    out.sort(function (a, b) {
      var am = asTimestampMs(a.runAt);
      var bm = asTimestampMs(b.runAt);
      if (am !== bm) return bm - am;
      return String(b.runAt) < String(a.runAt) ? -1 : String(b.runAt) > String(a.runAt) ? 1 : 0;
    });
    return out;
  }

  /**
   * One history session: loads the Sheet and the worker's first page in
   * parallel, pages with the worker's opaque cursor, and caches run detail
   * (successes only, so Retry re-fetches).
   */
  function createRunHistory(options) {
    var opts = options || {};
    var pageSize = opts.pageSize > 0 ? opts.pageSize : HISTORY_PAGE_SIZE;
    var s = {
      sheetRuns: [],
      workerRuns: [],
      nextBefore: null,
      pagedPastFirst: false,
      visible: pageSize,
      sheet: "unknown",
      sheetReason: "",
      worker: "unknown",
      workerReason: "",
      detailCache: {},
    };

    function unionWorkerRuns(fresh, older) {
      var seen = {};
      var out = [];
      fresh.concat(older).forEach(function (run) {
        if (!run || !run.runId || seen[run.runId]) return;
        seen[run.runId] = true;
        out.push(run);
      });
      return out;
    }

    function note() {
      if (s.worker !== "ok" && s.sheet === "ok" && s.workerReason !== "no_worker") {
        return "Detailed run stats appear when the discovery worker is reachable; these rows come from your Sheet.";
      }
      if (s.sheet !== "ok" && s.worker === "ok") {
        return "These rows come from the discovery worker; your Sheet’s log couldn’t be read.";
      }
      return "";
    }

    function view() {
      var all = mergeRunHistory(s.sheetRuns, s.workerRuns);
      return {
        ok: s.sheet === "ok" || s.worker === "ok",
        reason: s.sheet === "ok" || s.worker === "ok" ? "" : s.sheetReason || s.workerReason,
        sheetReason: s.sheetReason,
        all: all,
        runs: all.slice(0, s.visible),
        visible: s.visible,
        total: all.length,
        hasMore: all.length > s.visible || !!s.nextBefore,
        sheet: s.sheet,
        worker: s.worker,
        note: note(),
      };
    }

    async function safe(fn, arg) {
      try {
        var res = typeof fn === "function" ? await fn(arg) : null;
        return res && typeof res === "object" ? res : { ok: false, reason: "unavailable" };
      } catch (err) {
        return { ok: false, reason: err && err.message ? err.message : "unavailable" };
      }
    }

    async function load() {
      var results = await Promise.all([
        safe(opts.loadSheet),
        safe(opts.loadWorkerPage, { limit: pageSize }),
      ]);
      var sheetRes = results[0];
      var workerRes = results[1];
      if (sheetRes.ok) {
        s.sheet = "ok";
        s.sheetReason = sheetRes.reason || "";
        s.sheetRuns = Array.isArray(sheetRes.runs) ? sheetRes.runs : [];
      } else {
        s.sheet = "unavailable";
        s.sheetReason = sheetRes.reason || "unavailable";
      }
      if (workerRes.ok) {
        s.worker = "ok";
        s.workerReason = "";
        s.workerRuns = unionWorkerRuns(workerRes.runs || [], s.pagedPastFirst ? s.workerRuns : []);
        if (!s.pagedPastFirst) s.nextBefore = workerRes.nextBefore || null;
      } else {
        s.worker = "unavailable";
        s.workerReason = workerRes.reason || "unavailable";
      }
      return view();
    }

    async function loadMore() {
      s.visible += pageSize;
      var total = mergeRunHistory(s.sheetRuns, s.workerRuns).length;
      if (total < s.visible && s.nextBefore && s.worker === "ok") {
        var res = await safe(opts.loadWorkerPage, { limit: pageSize, before: s.nextBefore });
        if (res.ok) {
          s.workerRuns = unionWorkerRuns(s.workerRuns, res.runs || []);
          s.nextBefore = res.nextBefore || null;
          s.pagedPastFirst = true;
        }
      }
      return view();
    }

    function detail(run) {
      if (!run || !run.statusPath) {
        return Promise.resolve({ ok: false, reason: "no_worker_record" });
      }
      var key = runKey(run);
      if (s.detailCache[key]) return s.detailCache[key];
      var pending = safe(opts.loadWorkerDetail, run.statusPath).then(function (res) {
        if (!res.ok) delete s.detailCache[key];
        return res;
      });
      s.detailCache[key] = pending;
      return pending;
    }

    return { load: load, loadMore: loadMore, detail: detail, view: view };
  }

  /* ---- The run story: what the expanded row says --------------------- */

  var FUNNEL_STAGES = [
    ["listingsSeen", "Listings found", "flow"],
    ["listingsProcessed", "Checked against your profile", "flow"],
    ["duplicatesInRun", "Duplicates within this run", "drop"],
    ["duplicatesVsSheet", "Already in your Sheet", "drop"],
    ["rejected", "Filtered out", "drop"],
    ["candidates", "Strong enough to save", "flow"],
    ["written", "Saved as new roles", "kept"],
    ["updated", "Updated existing roles", "kept"],
  ];
  var REJECTION_REASON_LABELS = {
    skip_title_match: "Title is on your skip list",
    headline_mismatch: "Title doesn’t match your target roles",
    work_mode_mismatch: "Work mode doesn’t match",
    location_outside_acceptable: "Location outside your area",
    location_mismatch: "Location doesn’t match",
    work_auth_mismatch: "Work authorization doesn’t match",
    salary_below_floor: "Salary below your floor",
    salary_missing_but_required: "No salary listed",
    duplicate: "Duplicate listing",
    low_quality_extraction: "Listing couldn’t be read",
    blocked_aggregator: "Aggregator site skipped",
    // DISCAT Fix-B: the precise codes the worker now records.
    skip_title: "Title is on your skip list",
    excluded_keyword: "Matched an exclude keyword",
    remote_unknown: "Remote status unknown",
    remote_policy_mismatch: "Not remote",
    salary_missing: "No salary listed",
    missing_required_fields: "Missing title, company or link",
    matcher_rejected: "Judged a poor fit",
  };
  var PHASE_LABELS = {
    initializing: "Start",
    scout: "Search",
    score: "Score",
    exploit: "Refine",
    write: "Save",
    learn: "Learn",
  };
  var SOURCE_LABELS = {
    ats: "Company job boards",
    serpapi_google_jobs: "Google Jobs",
    grounded_web: "Web search",
    grounded_search: "Web search",
  };
  var SOURCE_COLUMNS = [
    ["seen", "Found"],
    ["accepted", "Kept"],
    ["rejected", "Filtered"],
    ["duplicates", "Duplicates"],
    ["timeouts", "Timeouts"],
  ];
  var SEARCHED_SHOWN = 12;

  function humanizeCode(code) {
    var words = String(code || "").replace(/[_-]+/g, " ").trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
  }

  function slug(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function formatMs(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var sec = total % 60;
    if (h > 0) return h + "h " + m + "m";
    if (m > 0) return m + "m " + sec + "s";
    return sec + "s";
  }

  function formatScore(value) {
    return String(Math.round(value * 10) / 10);
  }

  function share(value, of) {
    if (!(of > 0)) return "0";
    return String(Math.round(Math.min(1, Math.max(0, value / of)) * 10000) / 10000);
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  function statSpan(key, value, text) {
    return '<span class="runs-story__num" data-runs-stat="' + key + '">' +
      escapeHtml(text == null ? String(value) : text) + "</span>";
  }

  function sectionHtml(idBase, name, heading, body) {
    var id = idBase + "-" + name;
    return (
      '<section class="runs-story__section runs-story__section--' + name + '" data-runs-section="' + name +
        '" aria-labelledby="' + id + '">' +
        '<h4 class="runs-story__heading" id="' + id + '">' + escapeHtml(heading) + "</h4>" +
        body +
      "</section>"
    );
  }

  function ledeHtml(stats) {
    var f = stats.funnel || {};
    var written = measured(f.written);
    var updated = measured(f.updated);
    var seen = measured(f.listingsSeen);
    var duration = measured(stats.durationMs);
    var text = "";
    if (written !== null) {
      text = written === 0 ? "Saved no new roles" : "Saved " + written + " new " + plural(written, "role", "roles");
      if (updated !== null) text += " and updated " + updated;
    } else if (updated !== null) {
      text = "Updated " + updated + " " + plural(updated, "role", "roles");
    }
    if (text && seen !== null) text += " from " + seen + " " + plural(seen, "listing", "listings");
    if (!text && seen !== null) text = "Read " + seen + " " + plural(seen, "listing", "listings");
    if (duration !== null) text = text ? text + " in " + formatMs(duration) : "Ran for " + formatMs(duration);
    return text ? '<p class="runs-story__lede">' + escapeHtml(text) + ".</p>" : "";
  }

  function searchedLineHtml(f) {
    var parts = [];
    var companies = measured(f.companiesSearched);
    var boards = measured(f.boardsDetected);
    var queries = measured(f.queriesRun);
    if (companies !== null) parts.push(statSpan("companiesSearched", companies) + " " + plural(companies, "company", "companies"));
    if (boards !== null) parts.push(statSpan("boardsDetected", boards) + " job " + plural(boards, "board", "boards"));
    if (queries !== null) parts.push(statSpan("queriesRun", queries) + " " + plural(queries, "search", "searches"));
    if (!parts.length) return "";
    var list = parts.length === 1
      ? parts[0]
      : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
    return '<p class="runs-funnel__searched">Searched ' + list + ".</p>";
  }

  function reasonsHtml(reasons) {
    if (!Array.isArray(reasons)) return "";
    var items = "";
    for (var i = 0; i < reasons.length && i < 8; i++) {
      var r = reasons[i] || {};
      var count = measured(r.count);
      var code = String(r.reason || "");
      if (!code || count === null) continue;
      items +=
        '<li class="runs-funnel__reason" data-runs-reason="' + escapeHtml(code) + '">' +
          '<span class="runs-funnel__reason-label">' + escapeHtml(REJECTION_REASON_LABELS[code] || humanizeCode(code)) + "</span>" +
          '<span class="runs-story__num">' + count + "</span>" +
        "</li>";
    }
    return items ? '<ul class="runs-funnel__reasons" aria-label="Why listings were filtered out">' + items + "</ul>" : "";
  }

  function funnelHtml(stats, idBase) {
    var f = stats.funnel && typeof stats.funnel === "object" ? stats.funnel : {};
    var present = FUNNEL_STAGES.filter(function (st) { return measured(f[st[0]]) !== null; });
    var searched = searchedLineHtml(f);
    var matcher = measured(stats.matcherCalls);
    if (!present.length && !searched && matcher === null) return "";
    var denom = 0;
    present.forEach(function (st) { denom = Math.max(denom, f[st[0]]); });
    var rows = present.map(function (st, i) {
      var value = f[st[0]];
      return (
        '<li class="runs-funnel__stage" data-kind="' + st[2] + '">' +
          '<span class="runs-funnel__label">' + escapeHtml(st[1]) + "</span>" +
          '<span class="runs-funnel__track" aria-hidden="true">' +
            '<span class="runs-funnel__bar" data-runs-bar="' + st[0] + '" style="--runs-share: ' +
              share(value, denom) + "; --runs-i: " + i + '"></span>' +
          "</span>" +
          statSpan(st[0], value) +
          (st[0] === "rejected" ? reasonsHtml(f.rejectedTopReasons) : "") +
        "</li>"
      );
    }).join("");
    return sectionHtml(
      idBase,
      "funnel",
      "How the listings narrowed",
      searched +
        (rows ? '<ol class="runs-funnel">' + rows + "</ol>" : "") +
        (matcher !== null
          ? '<p class="runs-story__aside">' + statSpan("matcherCalls", matcher) + " AI " + plural(matcher, "check", "checks") + " to judge fit.</p>"
          : ""),
    );
  }

  function fitHtml(stats, idBase) {
    var fit = stats.fit && typeof stats.fit === "object" ? stats.fit : null;
    if (!fit) return "";
    var avg = measured(fit.avg);
    var median = measured(fit.median);
    var min = measured(fit.min);
    var max = measured(fit.max);
    var scored = measured(fit.scored);
    var scale = measured(fit.scale) || 10;
    var figures = "";
    if (avg !== null) figures += '<div class="runs-fit__figure"><dt>Average</dt><dd>' + statSpan("fitAvg", avg, formatScore(avg)) + "</dd></div>";
    if (median !== null) figures += '<div class="runs-fit__figure"><dt>Median</dt><dd>' + statSpan("fitMedian", median, formatScore(median)) + "</dd></div>";
    if (min !== null && max !== null) {
      figures += '<div class="runs-fit__figure"><dt>Range</dt><dd>' + statSpan("fitRange", min, formatScore(min) + "–" + formatScore(max)) + "</dd></div>";
    }
    var hist = "";
    var bins = Array.isArray(fit.histogram) ? fit.histogram : null;
    if (bins && bins.length && bins.every(function (b) { return measured(b) !== null; })) {
      var peak = Math.max.apply(null, bins);
      var spoken = [];
      var cols = bins.map(function (count, score) {
        if (count > 0) spoken.push(count + " " + plural(count, "role", "roles") + " scored " + score);
        var pct = (score / scale) * 100;
        var tier = pct >= 75 ? "high" : pct >= 50 ? "mid" : "low";
        return '<span class="runs-fit__bin" data-runs-fit-bin="' + score + '" data-tier="' + tier +
          '" style="--runs-share: ' + share(count, peak) + "; --runs-i: " + score + '"></span>';
      }).join("");
      hist =
        '<figure class="runs-fit__chart">' +
          '<div class="runs-fit__hist" role="img" aria-label="Fit scores: ' +
            escapeHtml(spoken.length ? spoken.join(", ") : "none scored") + '">' + cols + "</div>" +
          '<div class="runs-fit__axis" aria-hidden="true"><span>0</span><span>' +
            formatScore(scale / 2) + "</span><span>" + formatScore(scale) + "</span></div>" +
        "</figure>";
    }
    if (!figures && !hist) return "";
    return sectionHtml(
      idBase,
      "fit",
      "Fit scores",
      (figures ? '<dl class="runs-fit__figures">' + figures + "</dl>" : "") +
        hist +
        (scored !== null
          ? '<p class="runs-story__aside">' + statSpan("fitScored", scored) + " " + plural(scored, "role", "roles") +
            " scored, out of " + formatScore(scale) + ".</p>"
          : ""),
    );
  }

  function sourcesHtml(stats, idBase) {
    var list = Array.isArray(stats.sources) ? stats.sources.filter(function (x) { return x && x.id; }).slice(0, 8) : [];
    if (!list.length) return "";
    var cols = SOURCE_COLUMNS.filter(function (c) {
      return list.some(function (src) { return measured(src[c[0]]) !== null; });
    });
    var head = '<tr><th scope="col">Source</th>' + cols.map(function (c) {
      return '<th scope="col">' + c[1] + "</th>";
    }).join("") + "</tr>";
    var body = list.map(function (src) {
      var id = slug(src.id);
      var searched = src.searched && typeof src.searched === "object" ? src.searched : {};
      var bits = [];
      if (measured(searched.companies) !== null) bits.push(searched.companies + " " + plural(searched.companies, "company", "companies"));
      if (measured(searched.boards) !== null) bits.push(searched.boards + " " + plural(searched.boards, "board", "boards"));
      if (measured(searched.queries) !== null) bits.push(searched.queries + " " + plural(searched.queries, "search", "searches"));
      var state = String(src.state || "");
      var stateChip = state && state !== "done"
        ? ' <span class="jb-chip" data-tone="' + (state === "failed" ? "err" : "warn") + '">' + escapeHtml(humanizeCode(state)) + "</span>"
        : "";
      var cells = cols.map(function (c) {
        var key = "source-" + id + "-" + c[0];
        var v = measured(src[c[0]]);
        if (v === null) {
          return '<td data-runs-absent="' + key + '"><span aria-hidden="true">—</span><span class="sr-only">not measured</span></td>';
        }
        return '<td class="runs-story__num" data-runs-stat="' + key + '">' + v + "</td>";
      }).join("");
      return (
        '<tr><th scope="row"><span class="runs-sources__name">' +
          escapeHtml(src.label || SOURCE_LABELS[src.id] || humanizeCode(src.id)) + "</span>" + stateChip +
          (bits.length ? '<span class="runs-sources__meta">' + escapeHtml(bits.join(", ")) + "</span>" : "") +
        "</th>" + cells + "</tr>"
      );
    }).join("");
    return sectionHtml(
      idBase,
      "sources",
      "By source",
      // Focusable and named: on a phone the table scrolls sideways in here.
      '<div class="runs-sources__wrap" tabindex="0" role="group" aria-labelledby="' + idBase + '-sources">' +
        '<table class="runs-sources"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>",
    );
  }

  function timelineHtml(stats, idBase) {
    var phases = Array.isArray(stats.timeline)
      ? stats.timeline.filter(function (t) { return t && t.phase && measured(t.durationMs) !== null; })
      : [];
    if (!phases.length) return "";
    var sum = phases.reduce(function (acc, t) { return acc + t.durationMs; }, 0);
    var firstStart = asTimestampMs(phases[0].startedAt);
    var total = Math.max(measured(stats.durationMs) || 0, sum);
    var cursor = 0;
    var rows = phases.map(function (t, i) {
      var start = asTimestampMs(t.startedAt);
      var offset = firstStart && start ? start - firstStart : cursor;
      cursor = offset + t.durationMs;
      return (
        '<li class="runs-timeline__phase" data-runs-phase="' + escapeHtml(slug(t.phase)) + '">' +
          '<span class="runs-timeline__label">' + escapeHtml(PHASE_LABELS[t.phase] || t.label || humanizeCode(t.phase)) + "</span>" +
          '<span class="runs-timeline__track" aria-hidden="true"><span class="runs-timeline__bar" style="--runs-offset: ' +
            share(offset, total) + "; --runs-share: " + share(t.durationMs, total) + "; --runs-i: " + i + '"></span></span>' +
          '<span class="runs-story__num runs-timeline__time">' + escapeHtml(formatMs(t.durationMs)) + "</span>" +
        "</li>"
      );
    }).join("");
    return sectionHtml(idBase, "timeline", "Timeline", '<ol class="runs-timeline">' + rows + "</ol>");
  }

  function labelListHtml(idBase, name, title, labels) {
    var clean = labels.filter(function (l) { return typeof l === "string" && l.trim(); });
    if (!clean.length) return "";
    var listId = idBase + "-" + name + "-list";
    var items = clean.map(function (label, i) {
      return "<li" + (i >= SEARCHED_SHOWN ? " hidden data-runs-more-item" : "") + ">" + escapeHtml(label) + "</li>";
    }).join("");
    var extra = clean.length - SEARCHED_SHOWN;
    return (
      '<div class="runs-searched__group">' +
        '<h5 class="runs-searched__title">' + escapeHtml(title) + ' <span class="runs-story__num">' + clean.length + "</span></h5>" +
        '<ul class="runs-searched__list runs-searched__list--' + name + '" id="' + listId + '">' + items + "</ul>" +
        (extra > 0
          ? '<button type="button" class="runs-more" aria-expanded="false" aria-controls="' + listId +
            '" data-runs-more="' + extra + '">+' + extra + " more</button>"
          : "") +
      "</div>"
    );
  }

  function searchedHtml(stats, idBase) {
    var s = stats.searched && typeof stats.searched === "object" ? stats.searched : null;
    if (!s) return "";
    var body =
      labelListHtml(idBase, "companies", "Companies", Array.isArray(s.companies) ? s.companies : []) +
      labelListHtml(idBase, "queries", "Searches", Array.isArray(s.queries) ? s.queries : []);
    if (s.truncated === true) body += '<p class="runs-story__aside">Not every search was recorded.</p>';
    return body ? sectionHtml(idBase, "searched", "Where it searched", body) : "";
  }

  function coarseItems(run) {
    var r = run || {};
    return [
      ["Trigger", escapeHtml(triggerLabel(r.trigger))],
      ["Duration", formatDuration(r.durationS, r.durationSAvailability)],
      ["Companies", formatMetricCell(r.companiesSeen, r.companiesSeenAvailability)],
      ["Updated", formatMetricCell(r.leadsUpdated, r.leadsUpdatedAvailability)],
      ["Source", escapeHtml(r.source)],
      ["Variation", "<code>" + escapeHtml(r.variationKey) + "</code>"],
    ];
  }

  function detailListHtml(items) {
    var dl = "";
    for (var i = 0; i < items.length; i++) {
      dl +=
        '<div class="runs-detail__item"><dt>' + escapeHtml(items[i][0]) + "</dt>" +
        "<dd>" + items[i][1] + "</dd></div>";
    }
    return '<dl class="runs-detail">' + dl + "</dl>";
  }

  function renderCoarseDetailHtml(run) {
    return detailListHtml(coarseItems(run));
  }

  function renderRunDetailHtml(detail, run, options) {
    var idBase = (options && options.idBase) || "runs-story";
    var stats = detail && detail.runStats && typeof detail.runStats === "object" ? detail.runStats : null;
    if (!stats) {
      return (
        '<p class="runs-story__aside">Detailed stats weren’t recorded for this run.</p>' +
        renderCoarseDetailHtml(run)
      );
    }
    var body =
      funnelHtml(stats, idBase) +
      fitHtml(stats, idBase) +
      sourcesHtml(stats, idBase) +
      timelineHtml(stats, idBase) +
      searchedHtml(stats, idBase);
    var r = run || {};
    var meta = [["Trigger", escapeHtml(triggerLabel(r.trigger || (detail && detail.trigger)))]];
    if (r.variationKey) meta.push(["Variation", "<code>" + escapeHtml(r.variationKey) + "</code>"]);
    if (r.runId) meta.push(["Run ID", "<code>" + escapeHtml(r.runId) + "</code>"]);
    return (
      ledeHtml(stats) +
      '<div class="runs-story__grid">' + body + "</div>" +
      detailListHtml(meta)
    );
  }

  function renderDetailStateHtml(kind, run) {
    if (kind === "loading") {
      return '<p class="runs-story__aside runs-story__loading">Loading this run’s details…</p>' +
        renderCoarseDetailHtml(run);
    }
    return (
      '<p class="runs-story__aside">Couldn’t load this run’s details from the discovery worker. ' +
        '<button type="button" class="jb-btn jb-btn--secondary jb-btn--sm" data-runs-detail-retry="' +
          escapeHtml(runKey(run)) + '">Try again</button></p>' +
      renderCoarseDetailHtml(run)
    );
  }

  function initRunsTab() {
    var modal = document.getElementById("runsModal");
    var openBtn = document.getElementById("runsBtn");
    var closeBtn = document.getElementById("runsModalClose");
    var refreshBtn = document.getElementById("runsRefreshBtn");
    var statusEl = document.getElementById("runsStatus");
    var tbody = document.getElementById("runsTableBody");
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
      // RUNHIST: one history session per open; expansions and loaded
      // details survive the 60 s auto-refresh repaint.
      history: null,
      hasMore: false,
      visible: HISTORY_PAGE_SIZE,
      note: "",
      expanded: {},
      details: {},
      detailState: {},
      runByKey: {},
    };
    var showMoreBtn = document.getElementById("runsShowMoreBtn");

    function statusApi() {
      var d = window.JobBoredDiscovery && window.JobBoredDiscovery.status;
      return d && typeof d.fetchRunHistoryPage === "function" ? d : null;
    }

    function createHistorySession() {
      return createRunHistory({
        loadSheet: function () {
          return fetchDiscoveryRuns(readSheetId(), readAccessToken());
        },
        loadWorkerPage: function (opts) {
          var api = statusApi();
          return api ? api.fetchRunHistoryPage(opts) : Promise.resolve({ ok: false, reason: "no_worker" });
        },
        loadWorkerDetail: function (statusPath) {
          var api = statusApi();
          return api ? api.fetchRunDetail(statusPath) : Promise.resolve({ ok: false, reason: "no_worker" });
        },
      });
    }

    function applyHistoryView(view) {
      state.rawRuns = view.all;
      state.visible = view.visible;
      state.hasMore = view.hasMore;
      state.note = view.note;
    }

    function storyRegion(key) {
      var row = document.getElementById(stableDetailId(key));
      return row && row.querySelector ? row.querySelector(".runs-story") : null;
    }

    function paintDetail(key) {
      var region = storyRegion(key);
      if (!region) return;
      region.innerHTML = state.details[key] || "";
      // The reveal plays once, when details first arrive — never on repaint.
      if (state.detailState[key] === "ok") region.setAttribute("data-reveal", "");
      if (state.detailState[key] === "loading") region.setAttribute("aria-busy", "true");
      else region.removeAttribute("aria-busy");
    }

    function loadDetail(key, force) {
      var run = state.runByKey[key];
      if (!run || !run.statusPath || !state.history) return;
      var current = state.detailState[key];
      if (!force && (current === "loading" || current === "ok")) return;
      state.detailState[key] = "loading";
      state.details[key] = renderDetailStateHtml("loading", run);
      paintDetail(key);
      state.history.detail(run).then(function (res) {
        state.detailState[key] = res && res.ok ? "ok" : "error";
        state.details[key] = res && res.ok
          ? renderRunDetailHtml(res.detail, run, { idBase: "runs-story-" + slug(key) })
          : renderDetailStateHtml("error", run);
        paintDetail(key);
      });
    }

    function refreshTableRefs() {
      // Empty state nukes the <table>, so after we restore we need fresh
      // references to the new thead/tbody nodes.
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
      var liveActiveId =
        state.liveJobRun && !isTerminalJobDiscoveryRun(state.liveJobRun)
          ? String(state.liveJobRun.runId || "")
          : "";
      var filtered = filterRuns(state.rawRuns, state.filters).filter(function (run) {
        return !liveActiveId || run.runId !== liveActiveId;
      });
      var sorted = sortRuns(filtered, state.sort.key, state.sort.direction).slice(0, state.visible);
      state.runByKey = {};
      sorted.forEach(function (run) { state.runByKey[runKey(run)] = run; });
      if (showMoreBtn) showMoreBtn.hidden = !(state.hasMore || filtered.length > sorted.length);
      var hasContent = sorted.length > 0 || !!state.ghostRun || !!state.liveJobRun;
      if (hasContent) {
        showTable();
        renderRunsTable(tbody, sorted, {
          ghost: state.ghostRun,
          liveJobRun: state.liveJobRun,
          expanded: state.expanded,
          details: state.details,
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
          "Showing " + sorted.length + " of " + state.rawRuns.length + " runs" + extra + "." +
            (state.note ? " " + state.note : ""),
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
        if (state.liveJobRun) {
          // Local terminal/active outcomes must not be hidden behind a
          // Loading skeleton while DiscoveryRuns is still in flight.
          renderRunsTable(tbody, [], {
            ghost: state.ghostRun,
            liveJobRun: state.liveJobRun,
          });
          setStatus(
            statusEl,
            "info",
            "Showing the local run state; fetching DiscoveryRuns…",
          );
        } else {
          renderSkeletonRows(tbody, 6);
          setStatus(statusEl, "info", "Loading runs…");
        }
      } else if (!opts.silent) {
        setStatus(statusEl, "info", "Refreshing…");
      }

      try {
        if (!state.history) state.history = createHistorySession();
        var view = await state.history.load();
        var result = view.ok
          ? { ok: true, runs: view.all, reason: view.all.length ? "" : view.sheetReason || "empty" }
          : { ok: false, reason: view.reason };
        state.hasLoadedOnce = true;
        if (!result.ok) {
          if (state.liveJobRun) {
            showTable();
            renderRunsTable(tbody, [], {
              ghost: state.ghostRun,
              liveJobRun: state.liveJobRun,
            });
            setStatus(
              statusEl,
              "warn",
              "Couldn't load DiscoveryRuns; showing the local run state.",
            );
          } else if (isInitial) {
            setStatus(
              statusEl,
              "error",
              "Couldn't load runs: " + describeRunsFailure(result.reason),
            );
            showEmpty({
              title: "Couldn't load runs",
              hint: describeRunsFailure(result.reason),
            });
          } else {
            setStatus(
              statusEl,
              "error",
              "Couldn't load runs: " + describeRunsFailure(result.reason),
            );
          }
          return;
        }
        applyHistoryView(view);
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
                  : "Trigger a discovery from the Discovery drawer to populate this list.",
            });
            setStatus(statusEl, "info", "");
          }
          return;
        }
        // Keep unmatched local terminal outcomes visible. Only
        // hasTerminalSheetMatchForLiveRun() may drop them.
        // UX01 C9 (FD-15): the load is done BEFORE the final paint, or the
        // status line stays on "Loading runs…" under rows that already landed.
        state.loading = false;
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

    // Elapsed and "updated Xs ago" must keep moving between polls, so a
    // one-second tick repaints only the live progress cell (never the table:
    // focus and open detail rows stay put).
    var liveTickTimer = null;

    function tickLiveProgress() {
      var cell = tbody && tbody.querySelector
        ? tbody.querySelector("[data-live-run-progress] > td")
        : null;
      var view = state.liveJobRun ? liveRunView(state.liveJobRun) : null;
      if (!cell || !view || view.mode === "hidden") return;
      cell.innerHTML = liveProgressCellHtml(view);
    }

    function syncLiveTick() {
      var wanted =
        state.isOpen &&
        !!state.liveJobRun &&
        !isTerminalJobDiscoveryRun(state.liveJobRun) &&
        !!liveRunTracker();
      if (wanted && !liveTickTimer) {
        liveTickTimer = setInterval(tickLiveProgress, 1000);
      } else if (!wanted && liveTickTimer) {
        clearInterval(liveTickTimer);
        liveTickTimer = null;
      }
    }

    function openModal() {
      modal.style.display = "flex";
      modal.setAttribute("aria-hidden", "false");
      state.isOpen = true;
      state.history = createHistorySession();
      state.liveJobRun = readStoredJobDiscoveryRun();
      loadRuns();
      startAutoRefresh();
      syncLiveTick();
    }

    function closeModal() {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      state.isOpen = false;
      stopAutoRefresh();
      syncLiveTick();
    }

    openBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    var setupBtn = document.getElementById("runsOpenSetupBtn");
    if (setupBtn) {
      setupBtn.addEventListener("click", function () {
        closeModal();
        if (typeof window.requestDiscoverySetup === "function") {
          window.requestDiscoverySetup({
            entryPoint: "runs_history",
            allowWhileOnboarding: true,
          });
        }
      });
    }
    if (refreshBtn) refreshBtn.addEventListener("click", function () { loadRuns(); });
    if (showMoreBtn) {
      showMoreBtn.addEventListener("click", function () {
        if (!state.history) return;
        showMoreBtn.disabled = true;
        state.history.loadMore().then(function (view) {
          showMoreBtn.disabled = false;
          applyHistoryView(view);
          rerender();
        });
      });
    }
    var runDiscoveryBtn = document.getElementById("runsRunDiscoveryBtn");
    if (runDiscoveryBtn) {
      runDiscoveryBtn.addEventListener("click", function () {
        closeModal();
        if (typeof window.openDiscoveryDrawer === "function") {
          window.openDiscoveryDrawer();
        }
      });
    }
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
    // sort-header activation (click + keyboard Enter/Space) to the stable wrap.
    if (tableWrap) {
      function onSortHeaderEvent(event) {
        var target = event.target;
        if (!(target instanceof Element)) return;
        var th = target.closest("th[data-runs-sort]");
        if (!th) return;
        if (event.type === "keydown") {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
          } else {
            return;
          }
        }
        var key = th.getAttribute("data-runs-sort");
        if (!key) return;
        if (state.sort.key === key) {
          state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
        } else {
          state.sort.key = key;
          state.sort.direction = "desc";
        }
        rerender();
      }
      tableWrap.addEventListener("click", onSortHeaderEvent);
      // FD-17: the Run-at button discloses the row's details; New roles
      // opens the Pipeline view.
      tableWrap.addEventListener("click", function (event) {
        var target = event.target;
        if (!(target instanceof Element)) return;
        var toggle = target.closest(".runs-row-toggle");
        if (toggle) {
          var detail = document.getElementById(toggle.getAttribute("aria-controls") || "");
          var open = toggle.getAttribute("aria-expanded") !== "true";
          toggle.setAttribute("aria-expanded", open ? "true" : "false");
          if (detail) detail.hidden = !open;
          var key = toggle.getAttribute("data-runs-key");
          if (key) {
            if (open) state.expanded[key] = true;
            else delete state.expanded[key];
            if (open) loadDetail(key, false);
          }
          return;
        }
        var retry = target.closest("[data-runs-detail-retry]");
        if (retry) {
          loadDetail(retry.getAttribute("data-runs-detail-retry") || "", true);
          return;
        }
        var retryWrite = target.closest("[data-runs-retry-write]");
        if (retryWrite) {
          var runId = retryWrite.getAttribute("data-runs-retry-write") || "";
          var api = statusApi();
          if (!api || typeof api.retryRunWrite !== "function") return;
          retryWrite.disabled = true;
          api.retryRunWrite(runId, readAccessToken()).then(function (res) {
            if (!res.ok) {
              if (res.reason === "status_unknown") {
                setStatus(statusEl, "warn", "The write may still be finishing. Refresh Runs before trying again.");
                return;
              }
              setStatus(statusEl, "warn", "Write retry failed — reopen the dashboard and try again.");
              retryWrite.disabled = false;
              return;
            }
            var tracker = window.JobBoredDiscovery && window.JobBoredDiscovery.runTracker &&
              window.JobBoredDiscovery.runTracker.discoveryRunTracker;
            if (tracker && tracker.getState().runId === runId) tracker.updateFromStatusResponse(res.run);
            state.liveJobRun = readStoredJobDiscoveryRun();
            state.history = null;
            loadRuns();
          }).catch(function () {
            setStatus(statusEl, "warn", "Write retry failed — reopen the dashboard and try again.");
            retryWrite.disabled = false;
          });
          return;
        }
        var saveHunt = target.closest("[data-runs-save-hunt]");
        if (saveHunt) {
          var huntsUi = window.JobBoredHuntsUI;
          if (huntsUi && typeof huntsUi.toggleRunHunt === "function") {
            huntsUi.toggleRunHunt(saveHunt.getAttribute("data-runs-save-hunt") || "", saveHunt);
          }
          return;
        }
        var more = target.closest("[data-runs-more]");
        if (more) {
          var list = document.getElementById(more.getAttribute("aria-controls") || "");
          var reveal = more.getAttribute("aria-expanded") !== "true";
          if (list) {
            list.querySelectorAll("[data-runs-more-item]").forEach(function (item) {
              item.hidden = !reveal;
            });
          }
          more.setAttribute("aria-expanded", reveal ? "true" : "false");
          more.textContent = reveal ? "Show fewer" : "+" + more.getAttribute("data-runs-more") + " more";
          return;
        }
        var view = target.closest("[data-runs-view-pipeline]");
        if (view) {
          closeModal();
          document.dispatchEvent(
            new CustomEvent("jb:view:request", {
              detail: { view: "pipeline", source: "runs_log" },
            }),
          );
          const views = window.JobBoredFlowing && window.JobBoredFlowing.views;
          if (views && typeof views.show === "function") {
            views.show("pipeline", { focus: true });
          }
        }
      });
      tableWrap.addEventListener("keydown", onSortHeaderEvent);
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
      syncLiveTick();
      if (!state.isOpen) return;
      if (state.liveJobRun) {
        rerender();
        if (isTerminalJobDiscoveryRun(state.liveJobRun)) {
          setStatus(
            statusEl,
            "info",
            "Job discovery finished locally; refreshing DiscoveryRuns…",
          );
          loadRuns({ silent: false });
          return;
        }
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
    mergeRunHistory: mergeRunHistory,
    createRunHistory: createRunHistory,
    renderRunDetailHtml: renderRunDetailHtml,
    renderCoarseDetailHtml: renderCoarseDetailHtml,
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
      whyText: whyText,
      triggerLabel: triggerLabel,
      filterHintText: filterHintText,
      describeRunsFailure: describeRunsFailure,
    },
  };
})();
