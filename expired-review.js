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

  var AUDIT_STAMP_RE =
    /\[(\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)\][^\n]*(?:expired[-\s]?review|availability|cleanup)/i;

  function getPostingHealth(job, options) {
    if (!job || typeof job !== "object") {
      return { state: "unknown", label: "", detail: "", checkedAt: "" };
    }
    var notes = String(job._rawNotes || job.notes || "");
    var stamp = AUDIT_STAMP_RE.exec(notes);
    var checkedAt = stamp ? stamp[1] : "";
    if (normalizeStatus(job.status) === "expired") {
      return {
        state: "expired",
        label: "Posting expired",
        detail: "Marked Expired in the sheet.",
        checkedAt: checkedAt,
      };
    }
    var reason = getReviewReason(job, options);
    if (reason && reason.kind === "cleanup-note") {
      return {
        state: "needs-review",
        label: "Needs review",
        detail: reason.detail,
        checkedAt: checkedAt,
      };
    }
    if (!ACTIVE_STATUS_KEYS[normalizeStatus(job.status)] || !hasHttpUrl(job.link)) {
      return { state: "unknown", label: "", detail: "", checkedAt: checkedAt };
    }
    return {
      state: "open",
      label: "Posting open",
      detail: reason ? reason.detail : "",
      checkedAt: checkedAt,
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
    getPostingHealth: getPostingHealth,
  };
})(typeof window !== "undefined" ? window : globalThis);
