/**
 * Isolated F4-C helper: genuine date-windowed metrics.
 *
 * Dawn currently labels the current pipeline snapshot "Last 30 days".
 * This module window-filters jobs by an event date, distinguishes
 * measured zero / unavailable / partial, and renders funnel rows as
 * non-buttons unless a real action is supplied.
 *
 * Not wired from index.html in this lane (orchestrator owns that hotspot).
 * Attach: window.JobBoredMetricsDateWindow
 */
(function (root) {
  "use strict";

  var DEFAULT_WINDOW_DAYS = 30;
  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  var FUNNEL_ROWS = [
    { kind: "discovered", label: "Discovered", stage: "new" },
    { kind: "researched", label: "Researched", stage: "researching" },
    { kind: "applied", label: "Applied", stage: "applied" },
    { kind: "phone_screen", label: "Phone screen", stage: "phone-screen" },
    { kind: "interview", label: "Interview", stage: "interviewing" },
    { kind: "offer", label: "Offer", stage: "offer" },
    { kind: "expired", label: "Expired", stage: "expired" },
  ];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function parseDate(value) {
    if (!value && value !== 0) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    var d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function windowBounds(now, windowDays) {
    var end = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    var days =
      Number.isFinite(windowDays) && windowDays > 0
        ? Math.floor(windowDays)
        : DEFAULT_WINDOW_DAYS;
    return {
      start: new Date(end.getTime() - days * MS_PER_DAY),
      end: end,
      days: days,
    };
  }

  function inWindow(iso, now, windowDays) {
    var parsed = parseDate(iso);
    if (!parsed) return false;
    var bounds = windowBounds(now, windowDays);
    var t = parsed.getTime();
    return t >= bounds.start.getTime() && t <= bounds.end.getTime();
  }

  function classifyAvailability(denominator, discoveredCount) {
    if (!denominator || denominator.dated === 0) return "unavailable";
    if (denominator.dated < denominator.total) return "partial";
    if (!discoveredCount) return "zero";
    return "complete";
  }

  function rowAvailability(overall, count) {
    if (overall === "unavailable") return "unavailable";
    if (count === 0) return "zero";
    if (overall === "partial") return "partial";
    return "complete";
  }

  function deltaForAvailability(availability) {
    if (availability === "unavailable") return "dates unavailable";
    if (availability === "partial") return "last 30 days · partial";
    return "last 30 days";
  }

  function buildWindowedMetrics(jobs, opts) {
    var options = opts || {};
    var dateField = options.dateField || "foundAt";
    var bounds = windowBounds(options.now, options.windowDays);
    var list = Array.isArray(jobs) ? jobs : [];
    var dated = 0;
    var inWindowCount = 0;
    var windowed = [];

    for (var i = 0; i < list.length; i++) {
      var job = list[i] || {};
      var rawDate = job[dateField];
      var parsed = parseDate(rawDate);
      if (!parsed) continue;
      dated += 1;
      if (inWindow(rawDate, bounds.end, bounds.days)) {
        inWindowCount += 1;
        windowed.push(job);
      }
    }

    var byStage = {};
    for (var s = 0; s < FUNNEL_ROWS.length; s++) byStage[FUNNEL_ROWS[s].stage] = 0;
    for (var w = 0; w < windowed.length; w++) {
      var stage = windowed[w].stage;
      if (Object.prototype.hasOwnProperty.call(byStage, stage)) byStage[stage] += 1;
    }

    var denominator = {
      inWindow: inWindowCount,
      dated: dated,
      total: list.length,
    };
    var discoveredCount = byStage["new"] || 0;
    var overall = classifyAvailability(denominator, discoveredCount);

    var funnel = FUNNEL_ROWS.map(function (spec) {
      var count = byStage[spec.stage] || 0;
      return {
        kind: spec.kind,
        label: spec.label,
        stage: spec.stage,
        count: count,
        availability: rowAvailability(overall, count),
        actionable: false,
      };
    });

    var applied = byStage["applied"] || 0;
    var interviews = (byStage["phone-screen"] || 0) + (byStage["interviewing"] || 0);
    var offers = byStage["offer"] || 0;

    function stat(value, label, toneWhenPositive) {
      return {
        value: overall === "unavailable" ? 0 : value,
        label: label,
        delta: deltaForAvailability(overall),
        availability: overall === "unavailable" ? "unavailable" : rowAvailability(overall, value),
        tone: overall === "unavailable" || value === 0 ? null : toneWhenPositive,
      };
    }

    return {
      window: {
        days: bounds.days,
        start: bounds.start,
        end: bounds.end,
        label: "Last " + bounds.days + " days",
      },
      source: dateField,
      denominator: denominator,
      availability: overall,
      funnel: funnel,
      byTheNumbers: [
        stat(discoveredCount, "roles surfaced", "mint"),
        stat(applied, "applications", "amber"),
        stat(interviews, "interviews", "mint"),
        stat(offers, "offers live", "amber"),
      ],
    };
  }

  function renderFunnelRowHtml(row) {
    var r = row || {};
    var kind = r.kind || "";
    var label = r.label || "";
    var count = r.count == null ? 0 : r.count;
    var inner =
      ' class="brief-funnel__row" data-kind="' +
      escapeHtml(kind) +
      '" data-availability="' +
      escapeHtml(r.availability || "") +
      '"';
    var body =
      '<div class="brief-funnel__label">' +
      escapeHtml(label) +
      '</div><div class="brief-funnel__count">' +
      escapeHtml(String(count)) +
      "</div>";
    if (r.actionable) {
      return "<button type=\"button\"" + inner + ">" + body + "</button>";
    }
    return "<div" + inner + ' role="listitem">' + body + "</div>";
  }

  root.JobBoredMetricsDateWindow = {
    WINDOW_DAYS: DEFAULT_WINDOW_DAYS,
    inWindow: inWindow,
    classifyAvailability: classifyAvailability,
    buildWindowedMetrics: buildWindowedMetrics,
    renderFunnelRowHtml: renderFunnelRowHtml,
  };
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
