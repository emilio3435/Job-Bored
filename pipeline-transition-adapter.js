/* ============================================================
   pipeline-transition-adapter.js — F2-A board-move adapter
   ------------------------------------------------------------
   Board movement (Pipeline drop, leftover Lattice writes) goes
   through this helper, which is the single choke point between a
   board gesture and a Sheet write.

   A move ends in EXACTLY ONE of three outcomes, never in silence:

     1. the F1-A planner applied its atomic patch batch, or
     2. `jb:pipeline:move` was dispatched and flowing-writes owns
        the write (planner could not plan one here), or
     3. `jb:write:failed` was dispatched, nothing was written, and
        pipeline.js rolls the optimistic card move back.

   This used to call `applyTransition(payload)` with a single
   argument. The real F1-A signature is
   `applyTransition(input, patchApi)`, so every live board drop
   failed `missing_row` / `missing_patch_api`, nobody read the
   failure, and the `jb:pipeline:move` fallback never fired: the
   card slid into its new column and the Sheet was never written.
   tests/pipeline-transition-adapter.test.mjs pins every branch.

   `host` is injected by bridge-registry.js (the integrator owns
   that hunk) and supplies the two things the planner needs and a
   board cannot know:
     host.getRow(jobKey) -> { sheetRow, status, notes, appliedDate,
                              followUpDate, lastContact, dismissedAt }
     host.patchApi       -> { applyCells(patches) }
   With no host injected the adapter degrades to outcome 2, which
   is the behaviour the page had before F1-A existed.
   ============================================================ */

(function (root) {
  "use strict";

  var MOVE_EVENT = "jb:pipeline:move";
  var FAILED_EVENT = "jb:write:failed";
  var MOVE_KIND = "pipeline:move";

  /* Planner refusals that another writer can still honour. `missing_row` and
     `missing_patch_api` mean this adapter lacks the substrate, not that the
     move is wrong; `confirmation_required` means an Applied move needs the
     submission gate, which lives downstream of flowing-writes. All three hand
     the move to the event channel rather than dropping it. */
  var FALLBACK_CODES = {
    confirmation_required: true,
    missing_row: true,
    missing_patch_api: true,
  };

  function self() {
    return root.JobBoredPipelineTransitionAdapter || null;
  }

  function hostOf() {
    var api = self();
    return (api && api.host) || null;
  }

  function dispatch(name, detail) {
    var doc = root.document || (typeof document !== "undefined" ? document : null);
    var CE = root.CustomEvent || (typeof CustomEvent !== "undefined" ? CustomEvent : null);
    if (!doc || typeof doc.dispatchEvent !== "function" || typeof CE !== "function") {
      return false;
    }
    try {
      doc.dispatchEvent(new CE(name, { detail: detail }));
      return true;
    } catch (err) {
      try { console.warn("[JobBoredPipelineTransitionAdapter] dispatch failed", err); } catch (_) {}
      return false;
    }
  }

  /** Outcome 2: flowing-writes owns this move. */
  function handOff(payload, code) {
    dispatch(MOVE_EVENT, payload);
    return { ok: true, mocked: true, handled: true, fellBack: true, code: code, payload: payload };
  }

  /** Outcome 3: nothing written, roll the optimistic card move back.
   *  C17 / SS-07: unless the caller owns its own copy (announce:false), the
   *  person sees which role did not move, the stage it stayed in, and Retry.
   *  `announced` on the event tells the board not to stack a second toast. */
  function reportFailure(payload, code, message) {
    var announced = payload.announce !== false && code !== "cancelled";
    dispatch(FAILED_EVENT, {
      jobKey: payload.jobKey,
      kind: MOVE_KIND,
      reason: code,
      error: message || code,
      announced: announced,
    });
    if (announced) announceFailure(payload);
    return { ok: false, handled: true, code: code, message: message || "", payload: payload };
  }

  /* sheets-writeback.js (lane F) paints its own "Update failed: <raw server
     text>" toast for every refused batch. For a move this adapter names, that
     toast says less than ours and sits on top of it, so it is retired here.
     Matching on its copy is deliberate: when lane F drops that toast for
     planner writes this becomes a no-op. */
  function supersedeGenericFailureToast() {
    var doc = root.document;
    if (!doc || typeof doc.querySelectorAll !== "function") return;
    try {
      var nodes = doc.querySelectorAll("#toastContainer .toast-error .toast-message");
      for (var i = 0; i < nodes.length; i++) {
        var textValue = String(nodes[i].textContent || "");
        if (/^Update failed/.test(textValue)) {
          var toastEl = nodes[i].closest ? nodes[i].closest(".toast") : null;
          if (toastEl && toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
        }
      }
    } catch (_) {
      /* cosmetic only */
    }
  }

  function announceFailure(payload) {
    supersedeGenericFailureToast();
    var who = describeJob(payload.jobKey) || "The role";
    var stayed = payload.fromStage ? stageLabelFor(payload.fromStage) : "";
    var target = payload.toStage ? " to " + stageLabelFor(payload.toStage) : "";
    var retryPayload = {};
    for (var k in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) retryPayload[k] = payload[k];
    }
    toast(
      "Couldn't move " + who + target + ". The Sheet didn't accept it" +
        (stayed ? ", so it is still in " + stayed + "." : "."),
      "error",
      { label: "Retry", onClick: function () { return move(retryPayload); } },
    );
  }

  /** Resolve the planner input: an explicit row on the payload wins, then the
   *  injected host. A host that throws is treated as "no row", never as a
   *  reason to skip the move entirely. */
  function resolveRow(payload, host) {
    if (payload.row) return payload.row;
    if (!host || typeof host.getRow !== "function") return null;
    try {
      return host.getRow(payload.jobKey) || null;
    } catch (_) {
      return null;
    }
  }

  function resolvePatchApi(payload, host) {
    if (payload.patchApi) return payload.patchApi;
    return (host && host.patchApi) || null;
  }

  function plannerInput(payload, row) {
    var input = {};
    for (var k in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) input[k] = payload[k];
    }
    if (row) input.row = row;
    return input;
  }

  /* ---------------------------------------------------------------------
     UX01 C17: one planner for every move. A planned write that lands now
     (TR-01) syncs the local row, emits jb:write:succeeded so the board, Today
     and Dawn re-render, and (TR-10) offers Undo through the planner's own
     rollback snapshot. An Applied move (AX-03) opens the submission dialog
     here and resolves cancelled when the person cancels.
     --------------------------------------------------------------------- */

  var SUCCEEDED_EVENT = "jb:write:succeeded";

  function stageLabelFor(key) {
    var writer = root.JobBoredPipelineTransitions;
    var label = writer && typeof writer.statusFor === "function" ? writer.statusFor(key) : null;
    if (String(key) === "new") return "Discovered";
    return label || String(key || "");
  }

  function describeJob(jobKey) {
    var api = root.JobBored;
    try {
      var jobs = api && typeof api.getPipelineJobs === "function" ? api.getPipelineJobs() : null;
      var job = jobs && jobs[Number(jobKey)];
      if (!job) return "";
      var title = job.title ? String(job.title) : "";
      var company = job.company ? String(job.company) : "";
      if (title && company) return title + " at " + company;
      return title || company;
    } catch (_) {
      return "";
    }
  }

  /** Apply written cells to pipelineData so every surface reads the truth. */
  function syncLocal(jobKey, patches) {
    var host = hostOf();
    try {
      if (host && typeof host.applyLocal === "function") {
        host.applyLocal(jobKey, patches);
        return;
      }
      var app = root.JobBoredApp;
      var ctrl = app && app.pipelineController;
      if (ctrl && typeof ctrl.applyPipelineCellPatches === "function") {
        ctrl.applyPipelineCellPatches(jobKey, patches);
      }
    } catch (err) {
      try { console.warn("[JobBoredPipelineTransitionAdapter] local sync failed", err); } catch (_) {}
    }
  }

  function toast(message, type, action) {
    var a11y = root.JobBoredA11y;
    if (a11y && typeof a11y.toast === "function") {
      return a11y.toast(message, type || "success", action ? { action: action } : {});
    }
    return null;
  }

  function undo(payload, planned) {
    var writer = root.JobBoredPipelineTransitions;
    var patchApi = resolvePatchApi(payload, hostOf());
    if (!writer || typeof writer.applyUndo !== "function" || !planned || !planned.rollback) {
      return Promise.resolve({ ok: false, code: "no_rollback" });
    }
    return Promise.resolve()
      .then(function () { return writer.applyUndo(planned.rollback, patchApi); })
      .then(function (res) {
        if (res && res.ok) {
          syncLocal(payload.jobKey, planned.rollback.patches);
          dispatch(SUCCEEDED_EVENT, {
            jobKey: payload.jobKey,
            kind: MOVE_KIND,
            fromStage: payload.toStage,
            toStage: payload.fromStage,
            undo: true,
          });
          if (payload.announce !== false || payload.announceUndo) {
            toast("Undone. " + (describeJob(payload.jobKey) || "The role") + " is back in " + stageLabelFor(payload.fromStage) + ".", "info");
          }
          return res;
        }
        toast("Couldn't undo. The Sheet did not accept the change.", "error");
        return res || { ok: false, code: "undo_failed" };
      })
      .catch(function (err) {
        toast("Couldn't undo. The Sheet did not accept the change.", "error");
        return { ok: false, code: "undo_failed", message: (err && err.message) || String(err) };
      });
  }

  function settleSuccess(payload, planned) {
    syncLocal(payload.jobKey, planned.patches || []);
    dispatch(SUCCEEDED_EVENT, {
      jobKey: payload.jobKey,
      kind: MOVE_KIND,
      fromStage: payload.fromStage,
      toStage: payload.toStage,
      status: stageLabelFor(payload.toStage),
      source: payload.source || "",
    });
    planned.undo = function () { return undo(payload, planned); };
    if (payload.announce !== false && payload.fromStage && payload.fromStage !== payload.toStage) {
      var who = describeJob(payload.jobKey);
      toast(
        "Moved " + (who || "the role") + " to " + stageLabelFor(payload.toStage) + ".",
        "success",
        { label: "Undo", onClick: planned.undo },
      );
    }
    return planned;
  }

  /** AX-03 / C15: an Applied move needs the person to confirm what they sent. */
  function confirmAppliedMove(payload) {
    var sub = root.JobBoredSubmission;
    return Promise.resolve()
      .then(function () {
        return sub.confirmApplied({
          dataIndex: payload.jobKey,
          fromStage: payload.fromStage,
        });
      })
      .then(function (res) {
        if (res && res.confirmed) {
          var inner = res.result && typeof res.result === "object" ? res.result : {};
          inner.ok = true;
          inner.handled = true;
          inner.applied = true;
          return inner;
        }
        if (res && res.cancelled) {
          return { ok: false, handled: true, cancelled: true, code: "cancelled", payload: payload };
        }
        return { ok: false, handled: true, code: (res && res.code) || "applied_not_saved", payload: payload };
      }, function (err) {
        return reportFailure(payload, "write_failed", (err && err.message) || String(err));
      });
  }

  function move(payload) {
    payload = payload || {};
    var writer = root.JobBoredPipelineTransitions;
    if (!writer || typeof writer.applyTransition !== "function") {
      // No planner in the page: the event channel is the only writer there is.
      if (payload.handOff === false) {
        return Promise.resolve({ ok: false, handled: false, code: "no_writer", payload: payload });
      }
      return Promise.resolve(handOff(payload, "no_writer"));
    }

    var host = hostOf();
    var row = resolveRow(payload, host);
    var patchApi = resolvePatchApi(payload, host);

    return Promise.resolve()
      .then(function () {
        return writer.applyTransition(plannerInput(payload, row), patchApi);
      })
      .then(function (result) {
        // A writer that reports nothing at all is the pre-F1-A mock shape.
        if (!result || typeof result !== "object") {
          return { ok: true, mocked: false, handled: true, payload: payload };
        }
        if (result.ok) {
          result.handled = true;
          return settleSuccess(payload, result);
        }
        var code = result.code || "transition_failed";
        if (
          code === "confirmation_required" &&
          !payload.confirmation &&
          root.JobBoredSubmission &&
          typeof root.JobBoredSubmission.confirmApplied === "function"
        ) {
          return confirmAppliedMove(payload);
        }
        if (FALLBACK_CODES[code]) {
          // A caller that is itself the fallback writer (flowing-writes, the
          // submission dialog) must not be handed its own move back.
          if (payload.handOff === false) {
            return { ok: false, handled: false, code: code, payload: payload };
          }
          return handOff(payload, code);
        }
        // unknown_stage and anything else the planner refuses: writing it
        // through another channel would just write the same bad value.
        return reportFailure(payload, code, result.message);
      })
      .catch(function (err) {
        return reportFailure(payload, "write_failed", (err && err.message) || String(err));
      });
  }

  root.JobBoredPipelineTransitionAdapter = {
    move: move,
    /* Injected by bridge-registry.js; see the header. */
    host: null,
  };
})(typeof window !== "undefined" ? window : globalThis);
