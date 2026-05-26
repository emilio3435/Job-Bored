/* ============================================================
   role-workshop.js — JobBored v2 Workshop sub-renderers
   ------------------------------------------------------------
   Owner:    dossier-df/workshop lane (refactored 2026-05-20)
   Role:     This module no longer renders a standalone block
             inside the dossier. The Workshop is now the renamed
             PART 04 region (data-region="letter") and is
             rendered by letter.js. role-workshop.js provides
             small reusable renderers + a click-delegate the
             workshop region can call once per mount.

   Public surface
     window.JobBoredDossierWorkshop = {
       renderHeroCtas(job)         -> "" (deprecated; see note below)
       renderStageStepper(job)     -> HTML string (5-step stage stepper)
       renderProgressChips()       -> HTML string (heardBack/reply/followup/passed)
       wireWorkshop(region, jobKey) -> attach delegated click handler
       todayIso() / plusDaysIso(n) -> helpers used by tests
     }

   Note on hero CTAs
     The Dossier owns the canonical CTA cluster (View posting,
     Draft cover letter, Tailor resume) in the brief masthead.
     The Workshop intentionally does NOT duplicate those entry
     points; it owns the doing (editor, scorecard, missing
     keywords, tools, progress). renderHeroCtas() is preserved
     as an empty stub so older snapshot tests don't trip.

   Events emitted (preserved contract — same as before)
     jb:role:writeback     { jobKey, field, value }
       field ∈ { "stage" | "heardBack" | "reply"
                 | "followupAt" | "passed" }
     jb:role:action        { action, jobKey }
       action ∈ { "resume-tailor" | "resume-cover" }

   Activation: body.jb-v2 only (letter.js gates it).
   ============================================================ */

(function (root) {
  "use strict";

  if (!root) return;

  var STAGE_LABELS = {
    "researching":  "Researching",
    "applied":      "Applied",
    "phone-screen": "Phone screen",
    "interviewing": "Interviewing",
    "offer":        "Offer",
  };
  var STAGE_ORDER = ["researching", "applied", "phone-screen", "interviewing", "offer"];

  /* -------------------- helpers -------------------- */

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function isoFromDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function todayIso() {
    return isoFromDate(new Date());
  }

  function plusDaysIso(daysOffset) {
    var d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return isoFromDate(d);
  }

  function dispatch(name, detail) {
    if (typeof root.CustomEvent !== "function") return;
    try {
      var payload = { detail: detail || {}, bubbles: true };
      var ev1 = new root.CustomEvent(name, payload);
      var ev2 = new root.CustomEvent(name, payload);
      if (typeof document !== "undefined" && document.dispatchEvent) {
        document.dispatchEvent(ev1);
      }
      if (typeof root.dispatchEvent === "function") {
        root.dispatchEvent(ev2);
      }
    } catch (e) { /* swallow */ }
  }

  /* -------------------- renderers (pure HTML strings) -------------------- */

  /* Hero CTAs — deprecated. The Dossier's brief masthead owns the
     canonical CTA cluster (View posting / Draft cover letter /
     Tailor resume). The Workshop is the doing surface (editor,
     scorecard, missing keywords, tools, progress) and does NOT
     duplicate the entry-point CTAs. Returns an empty string so
     letter.js can keep splicing the slot without conditionals. */
  function renderHeroCtas(job) {
    void job;
    return "";
  }

  /* Stage stepper — five horizontal steps, the current one highlighted. */
  function renderStageStepper(job) {
    var currentKey = String((job && job.stage) || "").toLowerCase();
    var currentIdx = STAGE_ORDER.indexOf(currentKey);
    var stepsHtml = "";
    for (var i = 0; i < STAGE_ORDER.length; i++) {
      var key = STAGE_ORDER[i];
      var label = STAGE_LABELS[key];
      var cls = "stepper__step";
      if (currentIdx >= 0 && i < currentIdx) cls += " stepper__step--done";
      if (currentIdx === i) cls += " stepper__step--current";
      stepsHtml +=
        '<button type="button" class="' + cls + '"' +
          ' data-stage-value="' + escapeHtml(key) + '"' +
          (currentIdx === i ? ' aria-current="step"' : "") +
        '>' + escapeHtml(label) + '</button>';
    }
    return '' +
      '<section class="jb-letter-block jb-letter-block--stage">' +
        '<h2 class="jb-letter-block__title">Stage</h2>' +
        '<div class="stepper">' + stepsHtml + '</div>' +
      '</section>';
  }

  /* Progress chips — write-back buttons (heard back / got reply / follow-up / passed). */
  function renderProgressChips() {
    return '' +
      '<section class="jb-letter-block jb-letter-block--progress">' +
        '<h2 class="jb-letter-block__title">Mark progress</h2>' +
        '<div class="writeback">' +
          '<button type="button" class="chip" data-writeback="heardBack">' +
            '<span class="pulse" aria-hidden="true"></span>Heard back' +
          '</button>' +
          '<button type="button" class="chip" data-writeback="reply">' +
            '<span class="pulse" aria-hidden="true"></span>Got reply' +
          '</button>' +
          '<button type="button" class="chip" data-writeback="followupAt">' +
            '<span class="pulse" aria-hidden="true"></span>Follow-up nudge' +
          '</button>' +
          '<button type="button" class="chip chip--danger" data-writeback="passed">' +
            '<span class="pulse" aria-hidden="true"></span>Mark passed' +
          '</button>' +
        '</div>' +
      '</section>';
  }

  /* -------------------- click delegation -------------------- */

  function handleWriteback(field, jobKey) {
    if (!jobKey || !field) return;
    if (field === "heardBack") {
      dispatch("jb:role:writeback", { jobKey: jobKey, field: "heardBack", value: todayIso() });
    } else if (field === "reply") {
      dispatch("jb:role:writeback", { jobKey: jobKey, field: "reply", value: todayIso() });
    } else if (field === "followupAt") {
      dispatch("jb:role:writeback", { jobKey: jobKey, field: "followupAt", value: plusDaysIso(3) });
    } else if (field === "passed") {
      dispatch("jb:role:writeback", { jobKey: jobKey, field: "passed", value: true });
    }
  }

  /* The workshop region (letter.js) calls wireWorkshop(region, jobKey).
     A single delegated click handler watches for:
       - data-stage-value="<stage>"     -> jb:role:writeback (stage)
       - data-writeback="<field>"        -> jb:role:writeback (field)
       - data-action="resume-tailor|cover" -> jb:role:action
     The remaining data-action="*" handlers (manual-revise, address, etc.)
     are owned by letter.js's own delegate and are not consumed here. */
  function wireWorkshop(region, jobKey) {
    if (!region) return;
    if (region.__workshopWired) {
      region.__workshopWiredJobKey = jobKey || "";
      return;
    }
    region.__workshopWired = true;
    region.__workshopWiredJobKey = jobKey || "";

    region.addEventListener("click", function (e) {
      var key = region.__workshopWiredJobKey || "";
      var t = e.target;
      while (t && t !== region) {
        if (t.getAttribute) {
          var stageVal = t.getAttribute("data-stage-value");
          if (stageVal) {
            dispatch("jb:role:writeback", { jobKey: key, field: "stage", value: stageVal });
            return;
          }
          var writeback = t.getAttribute("data-writeback");
          if (writeback) {
            handleWriteback(writeback, key);
            return;
          }
          var action = t.getAttribute("data-action");
          if (action === "resume-tailor" || action === "resume-cover") {
            dispatch("jb:role:action", { action: action, jobKey: key });
            return;
          }
        }
        t = t.parentNode;
      }
    });
  }

  /* -------------------- expose -------------------- */

  root.JobBoredDossierWorkshop = {
    renderHeroCtas: renderHeroCtas,
    renderStageStepper: renderStageStepper,
    renderProgressChips: renderProgressChips,
    wireWorkshop: wireWorkshop,
    todayIso: todayIso,
    plusDaysIso: plusDaysIso,
  };
})(typeof window !== "undefined" ? window : this);
