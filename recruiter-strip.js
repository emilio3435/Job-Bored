/**
 * recruiter-strip.js — compact recruiter CRM facts for kanban cards.
 *
 * Classic-global IIFE. All model access is intentionally concentrated in
 * readData(); integration can replace the current VM/DOM channel at one seam.
 *
 * The dossier panel this module used to render is retired: The Case owns its
 * own People block (role-case.js). What survives is `renderCompact`, which
 * pipeline.js paints on every kanban card, and `nextAction`, the one place
 * the next-move sentence is decided for both surfaces.
 */
(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  function escapeHtml(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function knownText(value) {
    var normalized = value == null ? "" : String(value).trim();
    return normalized || "Unknown";
  }

  function contactText(job) {
    if (job.contact != null && String(job.contact).trim()) {
      return String(job.contact).trim();
    }
    if (!Array.isArray(job.contacts)) return "Unknown";
    for (var i = 0; i < job.contacts.length; i++) {
      var contact = job.contacts[i];
      var candidate = typeof contact === "string"
        ? contact
        : contact && (contact.name || contact.email);
      if (candidate != null && String(candidate).trim()) return String(candidate).trim();
    }
    return "Unknown";
  }

  function replyText(value) {
    if (value === true) return "Yes";
    var normalized = value == null ? "" : String(value).trim().toLowerCase();
    if (/^(yes|y|replied|true)$/.test(normalized)) return "Yes";
    if (/^(no|n)$/.test(normalized)) return "No";
    return "Unknown";
  }

  var STAGES = {
    new: true, researching: true, applied: true, phone: true,
    interviewing: true, offer: true, rejected: true, passed: true, expired: true,
  };

  function stageKey(value) {
    var key = value == null ? "" : String(value).trim().toLowerCase();
    return STAGES[key] ? key : "";
  }

  var DAY_MS = 86400000;

  /* A Sheet date ("2026-09-20", optionally with a time) as a local calendar
     day, or null when it is not an ISO date. */
  function isoDay(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(String(value || "").trim());
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getMonth() !== Number(m[2]) - 1) return null;
    return { iso: m[1] + "-" + m[2] + "-" + m[3], date: d };
  }

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  /* TR-16: follow-up dates read relative to today ("in 2 days",
     "3 days overdue"); days past due set the overdue flag. */
  function relativeFollowUp(value, now) {
    var day = isoDay(value);
    if (!day) return null;
    var base = new Date(now == null ? Date.now() : now);
    var today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    var diff = Math.round((day.date.getTime() - today.getTime()) / DAY_MS);
    var text;
    if (diff < 0) text = plural(-diff, "day") + " overdue";
    else if (diff === 0) text = "today";
    else if (diff === 1) text = "tomorrow";
    else text = "in " + plural(diff, "day");
    return { iso: day.iso, text: text, daysLate: diff < 0 ? -diff : 0 };
  }

  /** The sole view-model/data-channel accessor for this module. */
  function readData(vm) {
    var job = vm && vm.job && typeof vm.job === "object" ? vm.job : (vm || {});
    var replyValue = job.responseFlag != null ? job.responseFlag : job.replied;
    var followUp = knownText(job.followUpDate);
    var rel = followUp === "Unknown" ? null : relativeFollowUp(followUp, vm && vm.now);
    return {
      jobKey: job.jobKey == null ? "" : String(job.jobKey),
      stage: stageKey(vm && vm.stage != null ? vm.stage : job.stage),
      contact: contactText(job),
      lastContact: knownText(job.lastHeardFrom != null ? job.lastHeardFrom : job.lastContact),
      reply: replyText(replyValue),
      followUp: rel ? rel.text : followUp,
      followUpIso: rel ? rel.iso : "",
      daysLate: rel ? rel.daysLate : 0,
    };
  }

  function allUnknown(data) {
    return data.contact === "Unknown" && data.lastContact === "Unknown" &&
      data.reply === "Unknown" && data.followUp === "Unknown";
  }

  function nextAction(data) {
    if (data.daysLate > 0) return "Follow-up " + plural(data.daysLate, "day") + " overdue";
    if (data.contact === "Unknown") return "Find a recruiter contact";
    if (data.followUp !== "Unknown") {
      return data.followUpIso ? "Follow up " + data.followUp : "Follow up on " + data.followUp;
    }
    if (data.reply === "Yes") return "Schedule the next conversation";
    return "Set a follow-up date";
  }

  /* TR-14: the card strip says the same next step Today does. When the
     one engine (today-data.js nextStepFor) has an answer for this row it
     wins; otherwise the four CRM sentences below still apply. The live row
     is read by pipeline index, which is what the board's jobKey is. */
  function engineStep(data) {
    var today = root.JobBoredToday && root.JobBoredToday.data;
    var api = root.JobBored;
    if (!today || typeof today.nextStepFor !== "function") return null;
    if (!api || typeof api.getPipelineJobs !== "function") return null;
    var idx = Number(data.jobKey);
    if (data.jobKey === "" || !Number.isInteger(idx) || idx < 0) return null;
    try {
      var row = (api.getPipelineJobs() || [])[idx];
      var step = row ? today.nextStepFor(row) : null;
      return step && step.reason !== "fit" ? step.headline : null;
    } catch (_) {
      return null;
    }
  }

  function nextStepText(data) {
    return engineStep(data) || nextAction(data);
  }

  function factHtml(label, value, className, datetime, flag) {
    var valueHtml = datetime
      ? '<time class="jb-recruiter-strip__value" datetime="' + escapeHtml(datetime) + '"' +
          (flag ? ' data-flag="' + escapeHtml(flag) + '"' : "") + '>' + escapeHtml(value) + '</time>'
      : '<span class="jb-recruiter-strip__value">' + escapeHtml(value) + '</span>';
    return '<span class="jb-recruiter-strip__fact ' + escapeHtml(className) + '">' +
      '<span class="jb-recruiter-strip__label">' + escapeHtml(label) + '</span>' +
      valueHtml +
      '</span>';
  }

  /* TR-17: the dot carries the row's real stage. With no stage in the view
     model it renders hidden, and bindStage reads the card's data-stage once
     the strip is mounted (pipeline.js appends it right after rendering). */
  function stageDotHtml(stage) {
    return stage
      ? '<jb-stage-dot stage="' + escapeHtml(stage) + '" aria-hidden="true"></jb-stage-dot>'
      : '<jb-stage-dot hidden aria-hidden="true"></jb-stage-dot>';
  }

  function compactHtml(data) {
    var overdue = data.daysLate > 0;
    var open = '<div class="jb-recruiter-strip jb-recruiter-strip--compact jb-sticker pipe-sticker__recruiter-strip"' +
      (data.jobKey ? ' data-job-key="' + escapeHtml(data.jobKey) + '"' : "") +
      (overdue ? ' data-flag="overdue"' : "");
    var next = '<span class="jb-recruiter-strip__next"><span class="jb-recruiter-strip__label">Next action</span>' +
      '<span class="jb-recruiter-strip__value">' + escapeHtml(nextStepText(data)) + '</span></span>';
    /* TR-17: nothing known about the recruiter side collapses to the one
       Next action line; the four "Unknown" facts are not rendered at all. */
    if (allUnknown(data)) {
      return open + ' data-facts="none">' + stageDotHtml(data.stage) + next + '</div>';
    }
    return open + '>' +
      '<span class="jb-recruiter-strip__heading">' + stageDotHtml(data.stage) +
        '<span>Recruiter CRM</span></span>' +
      '<span class="jb-recruiter-strip__compact-facts">' +
        factHtml("Contact", data.contact, "pipe-sticker__recruiter-contact") +
        factHtml("Last", data.lastContact, "pipe-sticker__recruiter-last-contact") +
        factHtml("Reply", data.reply, "pipe-sticker__recruiter-reply") +
        factHtml("Follow-up", data.followUp, "pipe-sticker__recruiter-follow-up",
          data.followUpIso, overdue ? "overdue" : "") +
      '</span>' +
      next +
      '</div>';
  }

  function bindStage(mountEl) {
    if (!mountEl || typeof mountEl.querySelector !== "function") return;
    var dot = mountEl.querySelector("jb-stage-dot");
    if (!dot) return;
    var card = typeof mountEl.closest === "function" ? mountEl.closest("[data-stage]") : null;
    var stage = card ? stageKey(card.getAttribute("data-stage")) : "";
    if (stage) {
      dot.setAttribute("stage", stage);
      dot.removeAttribute("hidden");
    } else if (typeof dot.remove === "function") {
      dot.remove();
    }
  }

  function renderCompact(mountEl, vm) {
    if (!mountEl) return;
    var data = readData(vm);
    mountEl.__jbRecruiterStripData = data;
    mountEl.innerHTML = compactHtml(data);
    if (!data.stage) {
      Promise.resolve().then(function () { bindStage(mountEl); });
    }
  }

  root.JobBoredRecruiterStrip = root.JobBoredRecruiterStrip || {};
  root.JobBoredRecruiterStrip.renderCompact = renderCompact;
  /* The Case's People block says the same next move the kanban card does, so
     the four branches live here once and both callers read them. */
  root.JobBoredRecruiterStrip.nextAction = nextAction;
  /* The engine-first sentence for a row, for callers that hold a jobKey
     (role-case-model.js's People "Next move" should read this; lane E). */
  root.JobBoredRecruiterStrip.nextStep = nextStepText;
})(typeof window !== "undefined" ? window : this);
