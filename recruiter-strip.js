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

  /** The sole view-model/data-channel accessor for this module. */
  function readData(vm) {
    var job = vm && vm.job && typeof vm.job === "object" ? vm.job : (vm || {});
    var replyValue = job.responseFlag != null ? job.responseFlag : job.replied;
    return {
      jobKey: job.jobKey == null ? "" : String(job.jobKey),
      contact: contactText(job),
      lastContact: knownText(job.lastHeardFrom != null ? job.lastHeardFrom : job.lastContact),
      reply: replyText(replyValue),
      followUp: knownText(job.followUpDate),
    };
  }

  function nextAction(data) {
    if (data.contact === "Unknown") return "Find a recruiter contact";
    if (data.followUp !== "Unknown") return "Follow up on " + data.followUp;
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

  function factHtml(label, value, className) {
    return '<span class="jb-recruiter-strip__fact ' + escapeHtml(className) + '">' +
      '<span class="jb-recruiter-strip__label">' + escapeHtml(label) + '</span>' +
      '<span class="jb-recruiter-strip__value">' + escapeHtml(value) + '</span>' +
      '</span>';
  }

  function compactHtml(data) {
    return '<div class="jb-recruiter-strip jb-recruiter-strip--compact jb-sticker pipe-sticker__recruiter-strip"' +
      (data.jobKey ? ' data-job-key="' + escapeHtml(data.jobKey) + '"' : "") + '>' +
      '<span class="jb-recruiter-strip__heading"><jb-stage-dot stage="applied" aria-hidden="true"></jb-stage-dot>' +
        '<span>Recruiter CRM</span></span>' +
      '<span class="jb-recruiter-strip__compact-facts">' +
        factHtml("Contact", data.contact, "pipe-sticker__recruiter-contact") +
        factHtml("Last", data.lastContact, "pipe-sticker__recruiter-last-contact") +
        factHtml("Reply", data.reply, "pipe-sticker__recruiter-reply") +
        factHtml("Follow-up", data.followUp, "pipe-sticker__recruiter-follow-up") +
      '</span>' +
      '<span class="jb-recruiter-strip__next"><span class="jb-recruiter-strip__label">Next action</span>' +
        '<span class="jb-recruiter-strip__value">' + escapeHtml(nextStepText(data)) + '</span></span>' +
      '</div>';
  }

  function renderCompact(mountEl, vm) {
    if (!mountEl) return;
    var data = readData(vm);
    mountEl.__jbRecruiterStripData = data;
    mountEl.innerHTML = compactHtml(data);
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
