/**
 * submission-flow.js — human confirmation seam for an Applied transition.
 *
 * Classic-global IIFE. The integration owner routes only the v2 Applied move
 * here; this module delegates persistence to sheets-writeback so its canonical
 * row mapping and M/N/P side-effect batch remain the single source of truth.
 */
(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  var UNDO_GRACE_MS = 10 * 1000;
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

  function evidenceFrom(values, defaults) {
    return {
      appliedDate: fieldValue(values, "appliedDate") || defaults.appliedDate,
      source: fieldValue(values, "source") || "Unknown",
      receiptNote: fieldValue(values, "receiptNote"),
      followUpDate: fieldValue(values, "followUpDate") || defaults.followUpDate,
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

  function waitForGracePeriod() {
    return new Promise(function (resolve) {
      setTimeout(resolve, UNDO_GRACE_MS);
    });
  }

  function showUndoToast(a11y, onUndo) {
    if (a11y && typeof a11y.toast === "function") {
      return a11y.toast(
        "Application marked submitted. Saving in 10 seconds.",
        "info",
        {
          persistent: true,
          action: { label: "Undo", onClick: onUndo },
        },
      );
    }

    var fallback = host().showToast;
    if (typeof fallback === "function") {
      return fallback(
        "Application marked submitted. Saving in 10 seconds.",
        "info",
        true,
        { label: "Undo", onClick: onUndo },
      );
    }
    return null;
  }

  /**
   * Ask for explicit submission confirmation, offer Undo, then persist Applied.
   * @param {string|number} jobKey pipeline data index / stable key
   * @param {{fromStage?:string, appliedDate?:string, source?:string,
   *   receiptNote?:string, checklistNote?:string, followUpDate?:string}} ctx
   * @returns {Promise<{confirmed:boolean, evidence:object|null}>}
   */
  async function confirmApplied(jobKey, ctx) {
    var a11y = root.JobBoredA11y;
    var confirm = a11y && a11y.dialog && a11y.dialog.confirm;
    if (typeof confirm !== "function") {
      dispatchWriteFailure(jobKey, "confirmation-unavailable", "Submission confirmation is unavailable");
      return { confirmed: false, evidence: null };
    }

    var defaults = defaultsFor(ctx || {});
    var decision;
    try {
      decision = await confirm({
        title: "Mark application submitted?",
        body: "Confirm the submission details before Applied is written to your Sheet.",
        confirmLabel: "Mark submitted",
        cancelLabel: "Cancel",
        fields: confirmationFields(defaults),
      });
    } catch (err) {
      dispatchWriteFailure(
        jobKey,
        "confirmation-failed",
        err && err.message ? err.message : String(err),
      );
      return { confirmed: false, evidence: null };
    }

    if (!decision || decision.confirmed !== true) {
      dispatchWriteFailure(jobKey, "cancelled");
      return { confirmed: false, evidence: null };
    }

    var evidence = evidenceFrom(decision.values, defaults);
    var undone = false;
    var dismissToast = showUndoToast(a11y, function () {
      if (undone) return;
      undone = true;
      dispatchWriteFailure(jobKey, "undone");
    });

    await waitForGracePeriod();
    if (typeof dismissToast === "function") dismissToast();
    if (undone) return { confirmed: false, evidence: evidence };

    var writer = host().sheetsWrite;
    if (typeof writer.updateJobStatus !== "function") {
      dispatchWriteFailure(jobKey, "writer-unavailable", "Applied writer is unavailable");
      return { confirmed: false, evidence: evidence };
    }

    try {
      var succeeded = await writer.updateJobStatus(
        jobKey,
        "Applied",
        ctx && ctx.fromStage,
      );
      if (!succeeded) {
        dispatchWriteFailure(jobKey, "persist-failed", "Applied write failed");
        return { confirmed: false, evidence: evidence };
      }
      return { confirmed: true, evidence: evidence };
    } catch (err) {
      dispatchWriteFailure(
        jobKey,
        "persist-failed",
        err && err.message ? err.message : String(err),
      );
      return { confirmed: false, evidence: evidence };
    }
  }

  root.JobBoredSubmission = root.JobBoredSubmission || {};
  root.JobBoredSubmission.confirmApplied = confirmApplied;
})(typeof window !== "undefined" ? window : this);
