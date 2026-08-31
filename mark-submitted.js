/* ============================================
   mark-submitted.js — human Mark submitted confirmation

   Classic-global IIFE under window.JobBoredMarkSubmitted.
   Applied is not a drag-only claim. Calls the F1-A transition adapter
   with an explicit confirmation payload (date, source, receipt/checklist)
   and returns an undo handle. Does not write Sheets itself.
   ============================================ */
(function (root) {
  "use strict";

  function hasEvidence(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (payload.receipt != null && String(payload.receipt).trim()) return true;
    if (Array.isArray(payload.checklist) && payload.checklist.some(function (item) {
      return String(item || "").trim();
    })) {
      return true;
    }
    return false;
  }

  function isDragOnly(payload) {
    if (!payload || typeof payload !== "object") return true;
    var hasStageMove = payload.toStage != null || payload.fromStage != null;
    var hasConfirmFields = payload.submittedAt != null || payload.source != null || hasEvidence(payload);
    return hasStageMove && !hasConfirmFields;
  }

  function validate(payload) {
    if (!payload || typeof payload !== "object") {
      return "confirmation payload required";
    }
    if (isDragOnly(payload)) {
      return "drag-only Applied is not a confirmation payload";
    }
    if (!payload.submittedAt || !String(payload.submittedAt).trim()) {
      return "submittedAt is required";
    }
    if (!payload.source || !String(payload.source).trim()) {
      return "source is required";
    }
    if (!hasEvidence(payload)) {
      return "receipt or checklist is required";
    }
    return null;
  }

  function confirm(job, payload, adapters) {
    var error = validate(payload);
    if (error) return { ok: false, error: error };

    adapters = adapters || {};
    if (typeof adapters.transitionApplied !== "function") {
      return { ok: false, error: "F1-A transition adapter is required" };
    }

    var confirmed = {
      submittedAt: String(payload.submittedAt).trim(),
      source: String(payload.source).trim(),
      receipt: payload.receipt != null ? String(payload.receipt).trim() : "",
      checklist: Array.isArray(payload.checklist)
        ? payload.checklist.map(function (item) { return String(item || "").trim(); }).filter(Boolean)
        : [],
      followUpDate: payload.followUpDate || null,
    };

    var result = adapters.transitionApplied(job, confirmed);
    if (!result || result.ok === false) {
      return {
        ok: false,
        error: (result && result.error) || "transition adapter failed",
      };
    }

    return {
      ok: true,
      undo: result.undo || {
        jobKey: job && job.jobKey,
        previousStatus: job && job.status,
      },
      confirmed: confirmed,
    };
  }

  function undo(handle, adapters) {
    adapters = adapters || {};
    if (!handle) return { ok: false, error: "undo handle required" };
    if (typeof adapters.restore !== "function") {
      return { ok: false, error: "F1-A restore adapter is required" };
    }
    var result = adapters.restore(handle);
    if (!result || result.ok === false) {
      return {
        ok: false,
        error: (result && result.error) || "restore adapter failed",
      };
    }
    return { ok: true };
  }

  root.JobBoredMarkSubmitted = {
    confirm: confirm,
    undo: undo,
    validate: validate,
  };
})(typeof window !== "undefined" ? window : globalThis);
