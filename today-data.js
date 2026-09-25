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
     used for everything.

     UX01 C20 adds two bands the hidden legacy brief already knew about
     (daily-brief.js upcomingFollowUps48h and its offer count): "due" is a
     follow-up that falls today or within the next two days, and "offer" is
     an open offer whose Follow-up Date is read as the decision date. */
  var BANDS = ["reply", "prep", "follow-up", "due", "offer", "stale", "fit"];

  /* How far "Done" pushes the next follow-up, and the Snooze presets. */
  var NEXT_FOLLOW_UP_DAYS = 7;
  var SNOOZE_PRESETS = [
    { id: "2d", label: "In 2 days", days: 2 },
    { id: "1w", label: "In a week", days: 7 },
  ];

  /* Stages whose follow-up date is a "nudge them" date (TR-15). The two
     interview stages read Follow-up Date as the interview date (see
     toFlagRecord), so a date inside 48 h there is already "prep". */
  var DUE_STAGES = { "applied": true, "phone-screen": true };

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
    /* A bare Sheet date (YYYY-MM-DD) is a local calendar day. Date.parse
       reads it as UTC midnight, which is the previous evening west of
       Greenwich and moved "due tomorrow" to "due today". */
    var bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
    if (bare) {
      return new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])).getTime();
    }
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
  function isoDay(ms) {
    var d = new Date(ms);
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function addDaysIso(nowMs, days) {
    var d = new Date(startOfLocalDay(nowMs));
    d.setDate(d.getDate() + days);
    return isoDay(d.getTime());
  }

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function shortDate(ms) {
    var d = new Date(ms);
    return MONTHS[d.getMonth()] + " " + d.getDate();
  }

  /** TR-13: a reply is owed only until the user has answered it. "Answered"
   *  is recorded with columns that already exist: Mark answered stamps Last
   *  contact (R) and sets a Follow-up Date (P) after it. A follow-up date
   *  later than the last contact therefore means "I answered and scheduled
   *  the next nudge", so the reply stops nagging. No schema change. */
  function replyAnswered(job) {
    var followUpMs = parseMs(job.followUpDate);
    var contactMs = parseMs(job.lastHeardFrom);
    if (followUpMs == null || contactMs == null) return false;
    return startOfLocalDay(followUpMs) > startOfLocalDay(contactMs);
  }

  function classify(job, stageKey, nowMs) {
    var rec = toFlagRecord(job, stageKey);
    var answered = rec.replied && replyAnswered(job);
    if (answered) rec.replied = false;
    var flag = computeFlag(rec, nowMs);
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
        dueMs: followUpMs,
      };
    }

    if (followUpMs != null && startOfLocalDay(followUpMs) < todayMs && stageKey !== "offer") {
      var lateDays = daysBetween(startOfLocalDay(followUpMs), todayMs);
      return {
        reason: "follow-up",
        order: followUpMs, // most overdue first
        headline: "Follow-up slipped " + lateDays + (lateDays === 1 ? " day" : " days"),
        detail: "Due " + relativeDays(-lateDays),
        dueMs: followUpMs,
      };
    }

    /* TR-15: a follow-up due today, tomorrow or the day after. */
    if (DUE_STAGES[stageKey] && followUpMs != null) {
      var dueIn = daysBetween(todayMs, startOfLocalDay(followUpMs));
      if (dueIn >= 0 && dueIn <= 2) {
        return {
          reason: "due",
          order: followUpMs,
          headline: "Follow up " + relativeDays(dueIn),
          detail: appliedMs == null
            ? "Follow-up date " + shortDate(followUpMs)
            : "Applied " + shortDate(appliedMs),
          dueMs: followUpMs,
        };
      }
    }

    /* TR-15: an open offer. Follow-up Date doubles as the decision date. */
    if (stageKey === "offer") {
      if (followUpMs == null) {
        return {
          reason: "offer",
          order: Infinity,
          headline: "Offer open",
          detail: "No decision date set",
        };
      }
      var left = daysBetween(todayMs, startOfLocalDay(followUpMs));
      return {
        reason: "offer",
        order: followUpMs,
        headline: "Offer open · decide by " + shortDate(followUpMs),
        detail: left < 0
          ? "Decision date passed " + relativeDays(left)
          : left === 0 ? "Decision due today" : left + (left === 1 ? " day left" : " days left"),
        dueMs: followUpMs,
      };
    }

    /* A follow-up already scheduled for the future means the silence is
       handled: the row comes back in the "due" band when the date nears.
       This is what lets Done clear a quiet application (TR-12). */
    var scheduled = followUpMs != null && startOfLocalDay(followUpMs) >= todayMs;
    if (!scheduled && (flag === "stale" || isWaitingOnReply(job, stageKey, nowMs))) {
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
  function writeback(item, field, value) {
    return {
      event: "jb:role:writeback",
      detail: { jobKey: item.jobKey, field: field, value: value },
    };
  }

  function openRoleAction(item, label) {
    return {
      id: "open-role",
      label: label,
      event: "jb:role:open",
      detail: { jobKey: item.jobKey, source: "today" },
    };
  }

  /** "I did it": stamp Last contact (R) today and push Follow-up Date (P)
   *  a week out through the existing bridge, so the row leaves its band
   *  (TR-12). The first write is the action's own detail; `also` carries
   *  the second so the primary stays a single contracted intent. */
  function doneAction(item, nowMs, id, label) {
    var first = writeback(item, "heardBack", isoDay(nowMs));
    var next = writeback(item, "followupAt", addDaysIso(nowMs, NEXT_FOLLOW_UP_DAYS));
    return {
      id: id,
      label: label,
      event: first.event,
      detail: first.detail,
      also: [next],
      patch: { lastHeardFrom: isoDay(nowMs), followUpDate: addDaysIso(nowMs, NEXT_FOLLOW_UP_DAYS) },
    };
  }

  function snoozeAction(item) {
    return {
      id: "snooze",
      label: "Snooze",
      kind: "snooze",
      presets: SNOOZE_PRESETS.slice(),
      field: "followupAt",
      detail: { jobKey: item.jobKey, field: "followupAt" },
    };
  }

  function calendarAction(item, dueMs) {
    if (dueMs == null) return null;
    return {
      id: "calendar",
      label: "Add to calendar",
      kind: "ics",
      date: isoDay(dueMs),
    };
  }

  /** The one primary next action for a band, plus the secondary actions
   *  that clear or defer the row in place (MP-07). Every write is an intent
   *  on the bus — Today never writes a cell and never calls a writer.
   *
   *  jb:role:writeback  heardBack -> Pipeline!R (Last contact),
   *                     followupAt -> Pipeline!P (Follow-up Date),
   *                     passed -> Pipeline!M (Status).
   *  jb:pipeline:move   the existing stage-move contract.
   *  jb:role:open       an intent this surface introduces; today.js falls back
   *                     to opening the dossier when nothing claims it. */
  function actionFor(item, nowMs) {
    if (item.reason === "reply") return openRoleAction(item, "Open and reply");
    if (item.reason === "prep") return openRoleAction(item, "Open and prep");
    if (item.reason === "offer") return openRoleAction(item, "Open offer");
    if (item.reason === "follow-up" || item.reason === "due") {
      return doneAction(item, nowMs, "done", "Done");
    }
    if (item.reason === "stale") {
      return doneAction(item, nowMs, "log-follow-up", "Log follow-up");
    }
    if (item.stage === "new") {
      return {
        id: "start-research",
        label: "Start researching",
        event: "jb:pipeline:move",
        detail: { jobKey: item.jobKey, fromStage: "new", toStage: "researching" },
      };
    }
    return openRoleAction(item, "Open dossier");
  }

  function moreActionsFor(item, nowMs, dueMs) {
    var out = [];
    if (item.reason === "reply") {
      var answered = doneAction(item, nowMs, "mark-answered", "Mark answered");
      out.push(answered);
      out.push(snoozeAction(item));
    } else if (item.reason === "follow-up" || item.reason === "due" || item.reason === "stale") {
      out.push(snoozeAction(item));
      var cal = calendarAction(item, item.reason === "stale" ? null : dueMs);
      if (cal) out.push(cal);
    } else if (item.reason === "prep" || item.reason === "offer") {
      var cal2 = calendarAction(item, dueMs);
      if (cal2) out.push(cal2);
    } else if (item.reason === "fit") {
      var pass = writeback(item, "passed", true);
      out.push({ id: "pass", label: "Pass", event: pass.event, detail: pass.detail });
    }
    return out;
  }

  /** TR-14: the single next-step source for every surface that names one
   *  (Today, the Brief's lead, the card strip, the dossier's People row).
   *  Returns null when nothing is waiting — callers keep their own copy. */
  function nextStepFor(job, opts) {
    if (!job || job.dismissedAt) return null;
    var nowMs = opts && opts.now != null
      ? (opts.now instanceof Date ? opts.now.getTime() : Number(opts.now))
      : Date.now();
    if (!isFinite(nowMs)) nowMs = Date.now();
    var stageKey = stageKeyOf(job);
    if (isArchivedStage(stageKey)) return null;
    var verdict = classify(job, stageKey, nowMs);
    if (!verdict) return null;
    return {
      reason: verdict.reason,
      rank: BANDS.indexOf(verdict.reason),
      headline: verdict.headline,
      detail: verdict.detail,
    };
  }

  /* RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
  function icsText(value) {
    return String(value == null ? "" : value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  /* Lines longer than 75 octets are folded with CRLF + space. */
  function icsFold(line) {
    var out = [];
    while (line.length > 74) {
      out.push(line.slice(0, 74));
      line = " " + line.slice(74);
    }
    out.push(line);
    return out.join("\r\n");
  }

  function compactDate(isoDate) {
    return String(isoDate).replace(/-/g, "").slice(0, 8);
  }

  /** An all-day RFC 5545 event any calendar app opens. Pure; the renderer
   *  turns it into a download. */
  function buildIcs(opts) {
    var o = opts || {};
    var date = String(o.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
    var start = compactDate(date);
    var endMs = Date.parse(date + "T12:00:00") + DAY_MS;
    var end = compactDate(isoDay(endMs));
    var nowMs = o.now != null ? Number(o.now instanceof Date ? o.now.getTime() : o.now) : Date.now();
    var stamp = new Date(nowMs).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    var summary = (o.summary || "Follow up") + ": " + (o.title || "Role") + (o.company ? " — " + o.company : "");
    var uid = "jobbored-" + String(o.jobKey == null ? "role" : o.jobKey).replace(/[^\w-]/g, "") + "-" + start + "@jobbored.local";
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//JobBored//Today//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + start,
      "DTEND;VALUE=DATE:" + end,
      "SUMMARY:" + icsText(summary),
    ];
    if (o.description) lines.push("DESCRIPTION:" + icsText(o.description));
    if (o.url) lines.push("URL:" + String(o.url).replace(/[\r\n]/g, ""));
    lines.push("END:VEVENT", "END:VCALENDAR");
    return lines.map(icsFold).join("\r\n") + "\r\n";
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
      item.dueMs = verdict.dueMs == null ? null : verdict.dueMs;
      item.action = actionFor(item, nowMs);
      item.more = moreActionsFor(item, nowMs, item.dueMs);
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
    nextStepFor: nextStepFor,
    buildIcs: buildIcs,
    BANDS: BANDS.slice(),
  };
})(typeof window !== "undefined" ? window : globalThis);
