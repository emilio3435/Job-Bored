/**
 * recruiter-strip.js — compact recruiter CRM facts for dossier and cards.
 *
 * Classic-global IIFE. All model access is intentionally concentrated in
 * readData(); integration can replace the current VM/DOM channel at one seam.
 */
(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  var REPLY_VALUES = Object.freeze(["Yes", "No", "Unknown"]);

  function host() {
    var injected = root.JobBoredRecruiterStrip && root.JobBoredRecruiterStrip.host;
    if (injected && injected.sheetsWrite) return injected;
    var app = root.JobBoredApp || {};
    return { sheetsWrite: app.sheetsWrite || {} };
  }

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

  function factHtml(label, value, className) {
    return '<span class="jb-recruiter-strip__fact ' + escapeHtml(className) + '">' +
      '<span class="jb-recruiter-strip__label">' + escapeHtml(label) + '</span>' +
      '<span class="jb-recruiter-strip__value">' + escapeHtml(value) + '</span>' +
      '</span>';
  }

  function replyButtonsHtml(current) {
    return REPLY_VALUES.map(function (value) {
      var selected = value === current;
      return '<button type="button" class="jb-recruiter-strip__reply jb-a11y-touch-target"' +
        ' data-action="recruiter-reply" data-value="' + escapeHtml(value) + '"' +
        ' aria-pressed="' + escapeHtml(selected ? "true" : "false") + '">' +
        escapeHtml(value) +
        '</button>';
    }).join("");
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
        '<span class="jb-recruiter-strip__value">' + escapeHtml(nextAction(data)) + '</span></span>' +
      '</div>';
  }

  function dossierHtml(data) {
    var followUpValue = data.followUp === "Unknown" ? "" : data.followUp;
    return '<section class="jb-recruiter-strip jb-recruiter-strip--dossier jb-sticker brief__recruiter-strip"' +
      (data.jobKey ? ' data-job-key="' + escapeHtml(data.jobKey) + '"' : "") +
      ' aria-label="Recruiter CRM">' +
      '<header class="jb-recruiter-strip__head">' +
        '<span class="jb-recruiter-strip__heading"><jb-stage-dot stage="applied" aria-hidden="true"></jb-stage-dot>' +
          '<span>Recruiter CRM</span></span>' +
        '<span class="jb-recruiter-strip__next"><span class="jb-recruiter-strip__label">Next action</span>' +
          '<span class="jb-recruiter-strip__value">' + escapeHtml(nextAction(data)) + '</span></span>' +
      '</header>' +
      '<div class="jb-recruiter-strip__facts">' +
        factHtml("Contact", data.contact, "brief__recruiter-contact") +
        factHtml("Last contact", data.lastContact, "brief__recruiter-last-contact") +
        factHtml("Reply", data.reply, "brief__recruiter-reply") +
        factHtml("Follow-up", data.followUp, "brief__recruiter-follow-up") +
      '</div>' +
      '<div class="jb-recruiter-strip__controls">' +
        '<div class="jb-recruiter-strip__reply-group" role="group" aria-label="Reply status">' +
          replyButtonsHtml(data.reply) +
        '</div>' +
        '<label class="jb-recruiter-strip__follow-up">' +
          '<span class="jb-recruiter-strip__label">Follow-up date</span>' +
          '<input class="jb-recruiter-strip__date jb-a11y-touch-target" type="date" data-recruiter-follow-up' +
            (followUpValue ? ' value="' + escapeHtml(followUpValue) + '"' : "") + '>' +
        '</label>' +
        '<button type="button" class="jb-recruiter-strip__save jb-a11y-touch-target" data-action="recruiter-follow-up">Save follow-up</button>' +
      '</div>' +
      '</section>';
  }

  function findAction(target, mountEl) {
    var node = target;
    while (node && node !== mountEl) {
      if (node.getAttribute && node.getAttribute("data-action")) return node;
      node = node.parentNode;
    }
    return null;
  }

  function bindActions(mountEl) {
    if (!mountEl || !mountEl.addEventListener || mountEl.__jbRecruiterStripBound) return;
    mountEl.__jbRecruiterStripBound = true;
    mountEl.addEventListener("click", function (event) {
      var actionEl = findAction(event && event.target, mountEl);
      if (!actionEl) return;
      var action = actionEl.getAttribute("data-action");
      var data = mountEl.__jbRecruiterStripData || {};
      var writer = host().sheetsWrite;

      if (action === "recruiter-reply") {
        var value = actionEl.getAttribute("data-value");
        if (REPLY_VALUES.indexOf(value) < 0) return;
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (data.jobKey && typeof writer.updateJobResponseFlag === "function") {
          writer.updateJobResponseFlag(data.jobKey, value);
        }
        return;
      }

      if (action === "recruiter-follow-up") {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        var input = mountEl.querySelector && mountEl.querySelector("[data-recruiter-follow-up]");
        var date = input && input.value != null ? String(input.value).trim() : "";
        if (data.jobKey && typeof writer.updateFollowUpDate === "function") {
          writer.updateFollowUpDate(data.jobKey, date);
        }
      }
    });
  }

  function render(mountEl, vm) {
    if (!mountEl) return;
    var data = readData(vm);
    mountEl.__jbRecruiterStripData = data;
    mountEl.innerHTML = dossierHtml(data);
    bindActions(mountEl);
  }

  function renderCompact(mountEl, vm) {
    if (!mountEl) return;
    var data = readData(vm);
    mountEl.__jbRecruiterStripData = data;
    mountEl.innerHTML = compactHtml(data);
  }

  root.JobBoredRecruiterStrip = root.JobBoredRecruiterStrip || {};
  root.JobBoredRecruiterStrip.render = render;
  root.JobBoredRecruiterStrip.renderCompact = renderCompact;
})(typeof window !== "undefined" ? window : this);
