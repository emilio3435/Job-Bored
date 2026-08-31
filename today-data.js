/* ============================================================
   today-data.js — the Today attention queue (view-model)
   ------------------------------------------------------------
   Owner:     T0 lane P0-A (canonical pipeline)
   Publishes: window.JobBoredToday.data.getTodayQueue()

   The default v2 surface (Dawn) ranked leads by fitScore descending and
   nothing else, so a role you had never touched outranked a recruiter who
   replied this morning. The engine that knew better — daily-brief.js's
   overdueFollowUps / waitingOnReplyJobs / stale-applied detection — is
   display:none under body.jb-v2.

   This module is the ranking, and only the ranking:
     reply > interview prep > overdue follow-up > staleness > fit
   Pure. No DOM, no fetches, no writes. Reads plain pipeline-row objects
   (the shape sheets-read-load.js produces) through the sanctioned
   window.JobBored.getPipelineJobs() facade rather than scraping the legacy
   kanban DOM the way dawn-data.js has to.

   Classification is dawn-data.js's computeFlag wherever computeFlag can
   answer, so the Today queue and the pipeline view-model cannot disagree
   about what "reply" / "prep" / "stale" mean on the same card.

   Classic-global IIFE. NOT an ES module — no exports.
   ============================================================ */

(function (root) {
  "use strict";

  var DAY_MS = 24 * 60 * 60 * 1000;

  /* Thresholds are daily-brief.js's, not new ones, so the legacy brief and
     the Today queue agree about when something is late.
     (daily-brief.js BRIEF_STALE_APPLIED_DAYS / BRIEF_WAITING_REPLY_MIN_DAYS) */
  var STALE_APPLIED_DAYS = 14;
  var WAITING_REPLY_MIN_DAYS = 7;

  /* Ranking bands, most urgent first. A job lands in the FIRST band it
     matches; the tail band is ordered by fit, which is what the old surface
     used for everything. */
  var BANDS = ["reply", "prep", "follow-up", "stale", "fit"];

  /* Stages a "fit" item can be in. Fit is a triage signal, so it only ranks
     roles you have not started yet — an Offer with no other signal is not
     "worth a look because it scores 8/10". */
  var TRIAGE_STAGES = { "new": true, "researching": true };

  /* Stages that can be waiting on someone else to write back. */
  var WAITING_STAGES = { "applied": true, "phone-screen": true };

  function stageRegistry() {
    return (root && root.JobBoredStages) || null;
  }

  function dawnData() {
    return (root && root.JobBoredDawn && root.JobBoredDawn.data) || null;
  }

  /** Canonical stage key for a Sheet status. Falls back to a local normalizer
   *  if stage-registry.js is not in the page; unknown stays "new" because that
   *  is what an empty Status column means everywhere else in the app. */
  function stageKeyOf(job) {
    var raw = job && job.status;
    var reg = stageRegistry();
    if (reg) return reg.toKey(raw) || "new";
    var s = String(raw == null ? "" : raw).trim().toLowerCase().replace(/\s+/g, "-");
    if (s === "phone") s = "phone-screen";
    return s || "new";
  }

  function isArchivedStage(key) {
    var reg = stageRegistry();
    if (reg) return reg.isArchived(key);
    return key === "rejected" || key === "passed" || key === "expired";
  }

  function stageLabelOf(key) {
    var reg = stageRegistry();
    return (reg && reg.toLabel(key)) || key;
  }

  /** Mirrors app-compat.js normalizeResponseFlag; "" means the user has not
   *  said, which is NOT the same as "no". */
  function responseFlag(job) {
    var v = job && job.responseFlag;
    if (!v || !String(v).trim()) return "";
    var s = String(v).trim().toLowerCase();
    if (s === "yes" || s === "y") return "yes";
    if (s === "no" || s === "n") return "no";
    if (s === "unknown" || s === "?") return "unknown";
    return "";
  }

  function parseMs(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value.getTime();
    var t = Date.parse(String(value));
    return isFinite(t) ? t : null;
  }

  function startOfLocalDay(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function fitBand(job) {
    var raw = job && job.fitScore;
    if (raw == null || raw === "") return null;
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) return null;
    return Math.max(1, Math.min(10, Math.round(n)));
  }

  function daysBetween(fromMs, toMs) {
    return Math.floor((toMs - fromMs) / DAY_MS);
  }

  function relativeDays(days) {
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days === -1) return "yesterday";
    if (days > 0) return "in " + days + " days";
    return Math.abs(days) + " days ago";
  }

  /** Adapt a pipeline row to the record shape dawn-data.computeFlag reads.
   *
   *  Note on interviewAt: the Sheet has no interview-date column. Follow-up
   *  Date (column P) is the only scheduling field users have, so for the two
   *  interview stages it doubles as the interview date. That is why a phone
   *  screen with a follow-up tomorrow reads as "prep" while an Applied row
   *  with a follow-up tomorrow does not. Recorded as a data-model gap rather
   *  than papered over with a guess. */
  function toFlagRecord(job, stageKey) {
    var followUpMs = parseMs(job.followUpDate);
    var interviewAtMs = null;
    if (stageKey === "phone-screen" || stageKey === "interviewing") {
      interviewAtMs = followUpMs;
    }
    return {
      stage: stageKey,
      replied: responseFlag(job) === "yes",
      appliedAtMs: parseMs(job.appliedDate),
      interviewAtMs: interviewAtMs,
    };
  }

  /** dawn-data's classifier, or an equivalent local one if dawn-data.js is
   *  not in the page. Kept in one place so the fallback is obviously the same
   *  set of rules. */
  function computeFlag(rec, nowMs) {
    var data = dawnData();
    if (data && typeof data.computeFlag === "function") {
      return data.computeFlag(rec, nowMs);
    }
    if (rec.replied) return "reply";
    if (rec.stage === "offer") return "offer";
    if (rec.stage === "phone-screen" || rec.stage === "interviewing") {
      if (rec.interviewAtMs != null && rec.interviewAtMs > nowMs) {
        return rec.interviewAtMs - nowMs <= 2 * DAY_MS ? "prep" : "scheduled";
      }
    }
    if (rec.stage === "applied" && rec.appliedAtMs != null) {
      if (nowMs - rec.appliedAtMs > STALE_APPLIED_DAYS * DAY_MS) return "stale";
    }
    return null;
  }

  /** daily-brief.js waitingOnReplyJobs, over a pipeline row. */
  function isWaitingOnReply(job, stageKey, nowMs) {
    if (!WAITING_STAGES[stageKey]) return false;
    var flag = responseFlag(job);
    if (flag === "yes") return false;
    if (flag === "no") return true;
    var appliedMs = parseMs(job.appliedDate);
    if (appliedMs == null) return false;
    return daysBetween(appliedMs, nowMs) >= WAITING_REPLY_MIN_DAYS;
  }

  /** Which band this row belongs in, plus the words that explain why.
   *  `order` sorts WITHIN the band (ascending). Returns null when there is
   *  genuinely nothing to do — Today never invents work. */
  function classify(job, stageKey, nowMs) {
    var flag = computeFlag(toFlagRecord(job, stageKey), nowMs);
    var followUpMs = parseMs(job.followUpDate);
    var appliedMs = parseMs(job.appliedDate);
    var contactMs = parseMs(job.lastHeardFrom);
    var todayMs = startOfLocalDay(nowMs);

    if (flag === "reply") {
      return {
        reason: "reply",
        // Oldest unanswered reply first; rows with no logged contact date sit
        // at the end of the band rather than jumping the queue.
        order: contactMs == null ? Infinity : contactMs,
        headline: "They replied — you owe an answer",
        detail: contactMs == null
          ? "Reply logged; last contact date unknown"
          : "Last contact " + relativeDays(daysBetween(contactMs, nowMs) * -1),
      };
    }

    if (flag === "prep") {
      var inDays = daysBetween(todayMs, startOfLocalDay(followUpMs));
      return {
        reason: "prep",
        order: followUpMs,
        headline: stageLabelOf(stageKey) + " " + relativeDays(inDays),
        detail: "Prep talking points before the call",
      };
    }

    if (followUpMs != null && startOfLocalDay(followUpMs) < todayMs) {
      var lateDays = daysBetween(startOfLocalDay(followUpMs), todayMs);
      return {
        reason: "follow-up",
        order: followUpMs, // most overdue first
        headline: "Follow-up slipped " + lateDays + (lateDays === 1 ? " day" : " days"),
        detail: "Due " + relativeDays(-lateDays),
      };
    }

    if (flag === "stale" || isWaitingOnReply(job, stageKey, nowMs)) {
      var quietDays = appliedMs == null ? null : daysBetween(appliedMs, nowMs);
      return {
        reason: "stale",
        // Longest silence first. Unknown applied-date sorts to the end.
        order: appliedMs == null ? Infinity : appliedMs,
        headline: quietDays == null
          ? "Gone quiet"
          : "Quiet for " + quietDays + " days",
        detail: responseFlag(job) === "no"
          ? "They said no reply is coming"
          : "No reply since you applied",
      };
    }

    if (TRIAGE_STAGES[stageKey]) {
      var fit = fitBand(job);
      return {
        reason: "fit",
        // Best fit first; unscored last, never treated as a zero.
        order: fit == null ? Infinity : -fit,
        headline: "Worth a look",
        detail: fit == null ? "Fit unknown — not scored yet" : "Fit " + fit + "/10",
      };
    }

    return null;
  }

  /** The one primary next action for a band. Every one is an intent on the
   *  bus — Today never writes a cell and never calls a writer directly.
   *
   *  jb:role:writeback  field "heardBack" -> Pipeline!R (Last contact), the
   *                     single write that records "I followed up today".
   *  jb:pipeline:move   the existing stage-move contract.
   *  jb:role:open       an intent this surface introduces; today.js falls back
   *                     to the navigation dawn.js already does when nothing
   *                     claims it (see today.js for the default binding). */
  function actionFor(item, nowIso) {
    if (item.reason === "reply") {
      return {
        id: "open-role",
        label: "Open and reply",
        event: "jb:role:open",
        detail: { jobKey: item.jobKey, source: "today" },
      };
    }
    if (item.reason === "prep") {
      return {
        id: "open-role",
        label: "Open and prep",
        event: "jb:role:open",
        detail: { jobKey: item.jobKey, source: "today" },
      };
    }
    if (item.reason === "follow-up" || item.reason === "stale") {
      return {
        id: "log-follow-up",
        label: "Log follow-up",
        event: "jb:role:writeback",
        detail: { jobKey: item.jobKey, field: "heardBack", value: nowIso },
      };
    }
    if (item.stage === "new") {
      return {
        id: "start-research",
        label: "Start researching",
        event: "jb:pipeline:move",
        detail: { jobKey: item.jobKey, fromStage: "new", toStage: "researching" },
      };
    }
    return {
      id: "open-role",
      label: "Open dossier",
      event: "jb:role:open",
      detail: { jobKey: item.jobKey, source: "today" },
    };
  }

  function readJobs(opts) {
    if (opts && Array.isArray(opts.jobs)) return opts.jobs;
    var api = root && root.JobBored;
    if (api && typeof api.getPipelineJobs === "function") {
      try {
        return api.getPipelineJobs() || [];
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  /**
   * @param {{jobs?: Array, now?: number|Date, limit?: number}} [opts]
   * @returns {{items: Array, counts: Object, empty: boolean, generatedAt: string}}
   */
  function getTodayQueue(opts) {
    var nowMs = opts && opts.now != null
      ? (opts.now instanceof Date ? opts.now.getTime() : Number(opts.now))
      : Date.now();
    if (!isFinite(nowMs)) nowMs = Date.now();
    var nowIso = new Date(nowMs).toISOString().slice(0, 10);
    var jobs = readJobs(opts);

    var counts = {};
    BANDS.forEach(function (b) { counts[b] = 0; });

    var items = [];
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      if (!job) continue;
      // Dismissed rows are hidden on every board; closed and expired rows have
      // nothing left to do.
      if (job.dismissedAt) continue;
      var stageKey = stageKeyOf(job);
      if (isArchivedStage(stageKey)) continue;

      var verdict = classify(job, stageKey, nowMs);
      if (!verdict) continue;

      var item = {
        jobKey: i,
        title: job.title || "Untitled role",
        company: job.company || "Unknown company",
        stage: stageKey,
        stageLabel: stageLabelOf(stageKey),
        fitScore: fitBand(job),
        reason: verdict.reason,
        rank: BANDS.indexOf(verdict.reason),
        headline: verdict.headline,
        detail: verdict.detail,
        _order: verdict.order,
        _seq: i,
      };
      item.action = actionFor(item, nowIso);
      counts[verdict.reason] += 1;
      items.push(item);
    }

    items.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a._order !== b._order) return a._order - b._order;
      return a._seq - b._seq;
    });

    if (opts && isFinite(opts.limit) && opts.limit > 0) {
      items = items.slice(0, Math.floor(opts.limit));
    }

    return {
      generatedAt: new Date(nowMs).toISOString(),
      items: items,
      counts: counts,
      empty: items.length === 0,
    };
  }

  root.JobBoredToday = root.JobBoredToday || {};
  root.JobBoredToday.data = {
    getTodayQueue: getTodayQueue,
    BANDS: BANDS.slice(),
  };
})(typeof window !== "undefined" ? window : globalThis);
