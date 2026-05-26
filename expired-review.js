(function (root) {
  "use strict";

  var DEFAULT_STALE_DAYS = 30;
  var ACTIVE_STATUS_KEYS = {
    "": true,
    new: true,
    researching: true,
  };
  var REVIEW_NOTE_RE =
    /\b(needs[-\s]?review|review required|availability review|expired review|http\s*(403|429)|captcha|timeout|network error|temporarily unreachable|ambiguous)\b/i;

  function normalizeStatus(status) {
    return String(status || "").trim().toLowerCase();
  }

  function hasHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || "").trim());
  }

  function parseDateLike(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    var parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function daysBetween(start, end) {
    var MS_PER_DAY = 24 * 60 * 60 * 1000;
    return Math.max(
      0,
      Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY),
    );
  }

  function getReviewReason(job, options) {
    if (!job || typeof job !== "object") return null;
    if (job.dismissedAt) return null;
    if (!ACTIVE_STATUS_KEYS[normalizeStatus(job.status)]) return null;
    if (!hasHttpUrl(job.link)) return null;

    var notes = String(job._rawNotes || job.notes || "");
    var noteMatch = REVIEW_NOTE_RE.exec(notes);
    if (noteMatch) {
      return {
        kind: "cleanup-note",
        label: "Cleanup flagged this listing",
        detail: "The latest availability check could not confidently mark it open or closed.",
      };
    }

    var now = parseDateLike(options && options.now) || new Date();
    var staleDays = Number(options && options.staleDays);
    if (!Number.isFinite(staleDays) || staleDays < 1) {
      staleDays = DEFAULT_STALE_DAYS;
    }
    var foundAt = parseDateLike(job.dateFound) || parseDateLike(job.dateFoundRaw);
    if (!foundAt) return null;
    var ageDays = daysBetween(foundAt, now);
    if (ageDays < staleDays) return null;

    return {
      kind: "stale-active",
      label: "Active listing is aging",
      detail: "Found " + ageDays + " days ago and still in New or Researching.",
      ageDays: ageDays,
    };
  }

  function getReviewJobs(jobs, options) {
    if (!Array.isArray(jobs)) return [];
    return jobs
      .map(function (job, index) {
        var reason = getReviewReason(job, options || {});
        if (!reason) return null;
        return {
          index: index,
          job: job,
          reason: reason,
        };
      })
      .filter(Boolean)
      .sort(function (a, b) {
        var aAge = Number(a.reason.ageDays || 0);
        var bAge = Number(b.reason.ageDays || 0);
        if (aAge !== bAge) return bAge - aAge;
        return a.index - b.index;
      });
  }

  root.JobBoredExpiredReview = {
    DEFAULT_STALE_DAYS: DEFAULT_STALE_DAYS,
    getReviewJobs: getReviewJobs,
    getReviewReason: getReviewReason,
  };
})(typeof window !== "undefined" ? window : globalThis);
