/* ============================================
   today-queue.js — one actionable Today membership selector

   Classic-global IIFE under window.JobBoredTodayQueue.
   Queue membership only: overdue follow-up, waiting-on-reply, and
   stale-application work. Fit ranking belongs to F2-A.
   ============================================ */
(function (root) {
  "use strict";

  var STALE_APPLIED_DAYS = 14;
  var WAITING_REPLY_MIN_DAYS = 7;
  var KIND_OVERDUE = "overdue-follow-up";
  var KIND_WAITING = "waiting-on-reply";
  var KIND_STALE = "stale-application";
  var KIND_RANK = {};
  KIND_RANK[KIND_OVERDUE] = 0;
  KIND_RANK[KIND_WAITING] = 1;
  KIND_RANK[KIND_STALE] = 2;

  var ACTION_FOR = {};
  ACTION_FOR[KIND_OVERDUE] = "follow-up";
  ACTION_FOR[KIND_WAITING] = "nudge-or-close";
  ACTION_FOR[KIND_STALE] = "revive-or-close";

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function startOfLocalDay(d) {
    var copy = new Date(d.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function statusOf(job) {
    return String((job && (job.status || job.stage)) || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
  }

  function jobKeyOf(job, index) {
    if (!job || typeof job !== "object") return String(index);
    if (job.jobKey != null && job.jobKey !== "") return String(job.jobKey);
    if (job.key != null && job.key !== "") return String(job.key);
    return String(index);
  }

  function normalizeResponseFlag(val) {
    var s = String(val == null ? "" : val).trim().toLowerCase();
    if (s === "yes" || s === "y" || s === "replied") return "yes";
    if (s === "no" || s === "n") return "no";
    return "";
  }

  function isTerminal(status) {
    return (
      status.indexOf("reject") !== -1 ||
      status === "passed" ||
      status.indexOf("expired") !== -1 ||
      status.indexOf("dismiss") !== -1
    );
  }

  function daysSince(date, now) {
    return (now.getTime() - date.getTime()) / (24 * 3600 * 1000);
  }

  function isOverdueFollowUp(job, now) {
    var fd = parseDate(job && job.followUpDate);
    if (!fd) return false;
    return startOfLocalDay(fd) < startOfLocalDay(now);
  }

  function isWaitingOnReply(job, now) {
    var status = statusOf(job);
    if (
      status.indexOf("interviewing") !== -1 ||
      status.indexOf("offer") !== -1 ||
      isTerminal(status) ||
      status === "new" ||
      status.indexOf("researching") !== -1
    ) {
      return false;
    }
    var waitingStage = status === "applied" || status.indexOf("phone-screen") !== -1 || status.indexOf("phone screen") !== -1;
    if (!waitingStage) return false;

    var flag = normalizeResponseFlag(job && (job.responseFlag || job.replied));
    if (flag === "yes") return false;
    if (flag === "no") return true;

    var ad = parseDate(job && job.appliedDate);
    if (!ad) return false;
    return daysSince(ad, now) >= WAITING_REPLY_MIN_DAYS;
  }

  function isStaleApplied(job, now) {
    var status = statusOf(job);
    if (status.indexOf("applied") === -1) return false;
    if (
      status.indexOf("interview") !== -1 ||
      status.indexOf("phone-screen") !== -1 ||
      status.indexOf("phone screen") !== -1 ||
      status.indexOf("offer") !== -1 ||
      isTerminal(status)
    ) {
      return false;
    }
    var ad = parseDate(job && job.appliedDate);
    if (!ad) return false;
    return daysSince(ad, now) >= STALE_APPLIED_DAYS;
  }

  function classify(job, now) {
    var status = statusOf(job);
    if (isTerminal(status)) return null;
    if (isOverdueFollowUp(job, now)) return KIND_OVERDUE;
    if (isWaitingOnReply(job, now)) return KIND_WAITING;
    if (isStaleApplied(job, now)) return KIND_STALE;
    return null;
  }

  function emptyByKind() {
    var byKind = {};
    byKind[KIND_OVERDUE] = [];
    byKind[KIND_WAITING] = [];
    byKind[KIND_STALE] = [];
    return byKind;
  }

  function select(jobs, options) {
    var now = options && options.now ? parseDate(options.now) || new Date() : new Date();
    var byKind = emptyByKind();
    var items = [];
    if (!Array.isArray(jobs)) return { items: items, byKind: byKind };

    jobs.forEach(function (job, index) {
      var kind = classify(job, now);
      if (!kind) return;
      var entry = {
        jobKey: jobKeyOf(job, index),
        kind: kind,
        title: (job && (job.title || job.role)) || "",
        company: (job && job.company) || "",
        action: ACTION_FOR[kind],
        job: job,
      };
      items.push(entry);
      byKind[kind].push(entry);
    });

    items.sort(function (a, b) {
      var rank = (KIND_RANK[a.kind] || 9) - (KIND_RANK[b.kind] || 9);
      if (rank !== 0) return rank;
      return String(a.jobKey).localeCompare(String(b.jobKey));
    });

    return { items: items, byKind: byKind };
  }

  root.JobBoredTodayQueue = {
    STALE_APPLIED_DAYS: STALE_APPLIED_DAYS,
    WAITING_REPLY_MIN_DAYS: WAITING_REPLY_MIN_DAYS,
    KIND_OVERDUE: KIND_OVERDUE,
    KIND_WAITING: KIND_WAITING,
    KIND_STALE: KIND_STALE,
    select: select,
  };
})(typeof window !== "undefined" ? window : globalThis);
