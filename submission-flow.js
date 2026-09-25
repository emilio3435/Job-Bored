/**
 * submission-flow.js — human confirmation seam for an Applied transition.
 *
 * Classic-global IIFE. Every Applied move lands here. UX01 C15: the write goes
 * through the one transition planner (pipeline-transitions.js) with the typed
 * date, follow-up and source + receipt note, immediately, with Undo. The
 * sheets-writeback updateJobStatus path is kept only as the fallback when no
 * planner row can be resolved.
 *
 * Lane-D API (C16): confirmApplied({dataIndex, prefill:{source, date}}).
 * TA-21: prefill.materials = [{id, label, checked?}] fills "Sent with it";
 * without it, JobBoredPipeline.materialsFor(dataIndex) is asked.
 */
(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  var FIELD_IDS = Object.freeze({
    appliedDate: "jb-submission-applied-date",
    source: "jb-submission-source",
    receiptNote: "jb-submission-receipt-note",
    followUpDate: "jb-submission-follow-up-date",
  });

  function host() {
    var injected = root.JobBoredSubmission && root.JobBoredSubmission.host;
    if (injected && injected.sheetsWrite) return injected;
    var app = root.JobBoredApp || {};
    return {
      sheetsWrite: app.sheetsWrite || {},
      showToast: app.core && app.core.host && app.core.host.showToast,
    };
  }

  function text(value) {
    return value == null ? "" : String(value).trim();
  }

  function fieldValue(values, key) {
    if (!values || typeof values !== "object") return "";
    if (values[FIELD_IDS[key]] != null) return text(values[FIELD_IDS[key]]);
    return text(values[key]);
  }

  function defaultsFor(ctx) {
    var writer = host().sheetsWrite;
    var today = typeof writer.todayStr === "function" ? writer.todayStr() : "";
    var followUp = typeof writer.futureDateStr === "function"
      ? writer.futureDateStr(7)
      : "";
    return {
      appliedDate: text(ctx && ctx.appliedDate) || text(today),
      source: text(ctx && ctx.source),
      receiptNote: text(ctx && (ctx.receiptNote || ctx.checklistNote)),
      followUpDate: text(ctx && ctx.followUpDate) || text(followUp),
    };
  }

  function confirmationFields(defaults) {
    return [
      {
        id: FIELD_IDS.appliedDate,
        label: "Applied date",
        type: "date",
        value: defaults.appliedDate,
      },
      {
        id: FIELD_IDS.source,
        label: "Submission source",
        hint: "For example: company portal, recruiter email, or referral.",
        value: defaults.source,
      },
      {
        id: FIELD_IDS.receiptNote,
        label: "Receipt or checklist note (optional)",
        hint: "Add a receipt reference or note what you verified before submitting.",
        multiline: true,
        value: defaults.receiptNote,
      },
      {
        id: FIELD_IDS.followUpDate,
        label: "Follow-up date",
        type: "date",
        value: defaults.followUpDate,
      },
    ];
  }

  /* TA-21: the files that went with the application. Lane E (or any caller)
     can pass them as prefill.materials; otherwise the board's cached
     materials index is asked for this role's ready resume and letter. */
  var SENT_PREFIX = "jb-submission-sent-";

  function materialsFor(jobKey, prefilled) {
    var list = Array.isArray(prefilled) ? prefilled : null;
    if (!list) {
      var board = root.JobBoredPipeline;
      if (board && typeof board.materialsFor === "function") {
        try {
          list = board.materialsFor(jobKey);
        } catch (_) {
          list = null;
        }
      }
    }
    if (!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i] || {};
      var id = text(m.id || m.type);
      var label = text(m.label);
      if (!id || !label || seen[id]) continue;
      seen[id] = true;
      out.push({ id: id, label: label, checked: m.checked !== false });
    }
    return out;
  }

  function sentChecks(materials) {
    if (!materials.length) return null;
    return {
      label: "Sent with it",
      items: materials.map(function (m) {
        return { id: SENT_PREFIX + m.id, label: m.label, checked: m.checked };
      }),
    };
  }

  function sentFrom(values, materials) {
    var sent = [];
    for (var i = 0; i < materials.length; i++) {
      var raw = values && values[SENT_PREFIX + materials[i].id];
      var on = raw == null ? materials[i].checked : String(raw) === "true";
      if (on) sent.push(materials[i].label);
    }
    return sent;
  }

  function evidenceFrom(values, defaults, materials) {
    return {
      appliedDate: fieldValue(values, "appliedDate") || defaults.appliedDate,
      source: fieldValue(values, "source") || "Unknown",
      receiptNote: fieldValue(values, "receiptNote"),
      followUpDate: fieldValue(values, "followUpDate") || defaults.followUpDate,
      sent: sentFrom(values, materials || []),
    };
  }

  function dispatchWriteFailure(jobKey, reason, error) {
    var EventCtor = root.CustomEvent;
    if (typeof EventCtor !== "function" && typeof CustomEvent === "function") {
      EventCtor = CustomEvent;
    }
    if (typeof EventCtor !== "function") return;

    var detail = {
      jobKey: jobKey,
      kind: "pipeline:move",
      reason: reason,
    };
    if (error) detail.error = error;

    if (typeof document !== "undefined" && document.dispatchEvent) {
      document.dispatchEvent(new EventCtor("jb:write:failed", { detail: detail }));
    }
    if (root.dispatchEvent) {
      root.dispatchEvent(new EventCtor("jb:write:failed", { detail: detail }));
    }
  }

  function showToast(a11y, message, type, action) {
    if (a11y && typeof a11y.toast === "function") {
      return a11y.toast(message, type || "success", action ? { action: action } : {});
    }
    var fallback = host().showToast;
    if (typeof fallback === "function") {
      return fallback(message, type || "success", false, action);
    }
    return null;
  }

  function jobFor(jobKey) {
    var api = root.JobBored;
    try {
      var jobs = api && typeof api.getPipelineJobs === "function" ? api.getPipelineJobs() : null;
      return (jobs && jobs[Number(jobKey)]) || null;
    } catch (_) {
      return null;
    }
  }

  function roleName(job) {
    if (!job) return "this role";
    var title = text(job.title);
    var company = text(job.company);
    if (title && company) return title + " at " + company;
    return title || company || "this role";
  }

  /** The row as the planner sees it, when the adapter host can resolve one. */
  function plannerRow(jobKey) {
    var adapter = root.JobBoredPipelineTransitionAdapter;
    var h = adapter && adapter.host;
    if (!h || typeof h.getRow !== "function") return null;
    try {
      return h.getRow(jobKey) || null;
    } catch (_) {
      return null;
    }
  }

  function noteFor(evidence) {
    var parts = ["Applied via " + evidence.source];
    if (evidence.receiptNote) parts.push("receipt: " + evidence.receiptNote);
    if (evidence.sent && evidence.sent.length) parts.push("sent: " + evidence.sent.join(", "));
    return parts.join(" · ");
  }

  /* Accepts the lane-D API shape confirmApplied({dataIndex, prefill:{source,
     date, followUpDate, receiptNote}, fromStage}) and the original
     confirmApplied(jobKey, ctx) shape used by flowing-writes and tests. */
  function normalizeArgs(first, second) {
    if (first && typeof first === "object" && !Array.isArray(first) &&
        (Object.prototype.hasOwnProperty.call(first, "dataIndex") ||
         Object.prototype.hasOwnProperty.call(first, "jobKey"))) {
      var prefill = first.prefill && typeof first.prefill === "object" ? first.prefill : {};
      var key = first.dataIndex != null ? first.dataIndex : first.jobKey;
      return {
        jobKey: key == null ? "" : String(key),
        ctx: {
          fromStage: first.fromStage,
          appliedDate: prefill.date || prefill.appliedDate,
          source: prefill.source,
          receiptNote: prefill.receiptNote,
          followUpDate: prefill.followUpDate,
          materials: prefill.materials,
        },
      };
    }
    return { jobKey: first, ctx: second || {} };
  }

  /** Write Applied through the one planner; the legacy writer is the fallback
   *  only when no planner row can be resolved (no adapter host in the page). */
  async function persistApplied(jobKey, fromStage, evidence) {
    var adapter = root.JobBoredPipelineTransitionAdapter;
    if (adapter && typeof adapter.move === "function") {
      var res = await adapter.move({
        jobKey: jobKey,
        fromStage: fromStage,
        toStage: "applied",
        confirmation: {
          submitted: true,
          date: evidence.appliedDate,
          source: evidence.source,
          followUpDate: evidence.followUpDate,
        },
        note: noteFor(evidence),
        source: "submission",
        announce: false,
        announceUndo: true,
        handOff: false,
      });
      if (res && res.ok) return { ok: true, result: res };
      var code = res && res.code;
      if (code !== "missing_row" && code !== "missing_patch_api" && code !== "no_writer") {
        // The adapter already dispatched jb:write:failed for this move.
        return { ok: false, code: code || "persist-failed", reported: true };
      }
    }

    var writer = host().sheetsWrite;
    if (typeof writer.updateJobStatus !== "function") {
      return { ok: false, code: "writer-unavailable" };
    }
    var succeeded = await writer.updateJobStatus(jobKey, "Applied", fromStage);
    return succeeded ? { ok: true, result: null } : { ok: false, code: "persist-failed" };
  }

  /**
   * Ask for explicit submission confirmation, write Applied with what the
   * person typed (date, follow-up, source + receipt to Notes), then offer Undo.
   *
   * @param {string|number|{dataIndex:(string|number), fromStage?:string,
   *   prefill?:{source?:string, date?:string, followUpDate?:string,
   *   receiptNote?:string}}} first  pipeline data index, or the prefill shape
   * @param {{fromStage?:string, appliedDate?:string, source?:string,
   *   receiptNote?:string, checklistNote?:string, followUpDate?:string}} [second]
   * @returns {Promise<{confirmed:boolean, cancelled?:boolean,
   *   evidence:object|null, result?:object|null, code?:string}>}
   */
  async function confirmApplied(first, second) {
    var args = normalizeArgs(first, second);
    var jobKey = args.jobKey;
    var ctx = args.ctx || {};
    var a11y = root.JobBoredA11y;
    var confirm = a11y && a11y.dialog && a11y.dialog.confirm;
    if (typeof confirm !== "function") {
      dispatchWriteFailure(jobKey, "confirmation-unavailable", "Submission confirmation is unavailable");
      return { confirmed: false, evidence: null, code: "confirmation-unavailable" };
    }

    var job = jobFor(jobKey);
    var row = plannerRow(jobKey);
    var seeded = {
      fromStage: ctx.fromStage,
      appliedDate: ctx.appliedDate || (row && row.appliedDate),
      source: ctx.source,
      receiptNote: ctx.receiptNote || ctx.checklistNote,
      followUpDate: ctx.followUpDate || (row && row.followUpDate),
    };
    var defaults = defaultsFor(seeded);
    var materials = materialsFor(jobKey, ctx.materials);
    var company = job && text(job.company);
    var decision;
    try {
      decision = await confirm({
        title: company ? "Did you apply to " + company + "?" : "Mark this role as applied?",
        body: "Confirm the details for " + roleName(job) +
          ". They are written to your Sheet as you enter them.",
        // TR-06: the label matches the stage it sets.
        confirmLabel: "Mark applied",
        cancelLabel: "Cancel",
        fields: confirmationFields(defaults),
        checks: sentChecks(materials),
        note: "These are written to your Sheet as shown: Applied Date, Follow-up Date, and a line in Notes.",
      });
    } catch (err) {
      dispatchWriteFailure(
        jobKey,
        "confirmation-failed",
        err && err.message ? err.message : String(err),
      );
      return { confirmed: false, evidence: null, code: "confirmation-failed" };
    }

    if (!decision || decision.confirmed !== true) {
      dispatchWriteFailure(jobKey, "cancelled");
      return { confirmed: false, cancelled: true, evidence: null };
    }

    var evidence = evidenceFrom(decision.values, defaults, materials);
    var outcome;
    try {
      outcome = await persistApplied(jobKey, ctx.fromStage, evidence);
    } catch (err) {
      outcome = { ok: false, code: "persist-failed", error: err && err.message ? err.message : String(err) };
    }

    if (!outcome.ok) {
      if (!outcome.reported) {
        dispatchWriteFailure(jobKey, outcome.code || "persist-failed", outcome.error || "Applied write failed");
      }
      showToast(a11y, "Couldn't save Applied for " + roleName(job) + ". Nothing was written.", "error", {
        label: "Retry",
        onClick: function () {
          confirmApplied({ dataIndex: jobKey, fromStage: ctx.fromStage, prefill: {
            source: evidence.source,
            date: evidence.appliedDate,
            followUpDate: evidence.followUpDate,
            receiptNote: evidence.receiptNote,
            materials: materials.map(function (m) {
              return { id: m.id, label: m.label, checked: evidence.sent.indexOf(m.label) !== -1 };
            }),
          } });
        },
      });
      return { confirmed: false, evidence: evidence, code: outcome.code || "persist-failed" };
    }

    var written = outcome.result;
    var message = "Applied: " + roleName(job) + " on " + evidence.appliedDate +
      (evidence.followUpDate ? ". Follow up " + evidence.followUpDate + "." : ".");
    showToast(
      a11y,
      message,
      "success",
      written && typeof written.undo === "function"
        ? { label: "Undo", onClick: function () { return written.undo(); } }
        : null,
    );
    return { confirmed: true, evidence: evidence, result: written };
  }

  root.JobBoredSubmission = root.JobBoredSubmission || {};
  root.JobBoredSubmission.confirmApplied = confirmApplied;
})(typeof window !== "undefined" ? window : this);
