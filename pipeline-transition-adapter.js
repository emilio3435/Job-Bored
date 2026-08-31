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

  /** Outcome 3: nothing written, roll the optimistic card move back. */
  function reportFailure(payload, code, message) {
    dispatch(FAILED_EVENT, {
      jobKey: payload.jobKey,
      kind: MOVE_KIND,
      reason: code,
      error: message || code,
    });
    return { ok: false, handled: true, code: code, message: message || "", payload: payload };
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

  function move(payload) {
    payload = payload || {};
    var writer = root.JobBoredPipelineTransitions;
    if (!writer || typeof writer.applyTransition !== "function") {
      // No planner in the page: the event channel is the only writer there is.
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
          return result;
        }
        var code = result.code || "transition_failed";
        if (FALLBACK_CODES[code]) return handOff(payload, code);
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
