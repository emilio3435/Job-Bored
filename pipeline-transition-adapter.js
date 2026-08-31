/* ============================================================
   pipeline-transition-adapter.js — F2-A board-move adapter
   ------------------------------------------------------------
   Board movement (Pipeline drop, leftover Lattice writes) goes
   through this helper. When F1-A's JobBoredPipelineTransitions
   writer is present, applyTransition owns the atomic patch.
   Until that lands, this mocks the writer and still emits
   jb:pipeline:move so flowing-writes keeps working.
   ============================================================ */

(function (root) {
  "use strict";

  function move(payload) {
    payload = payload || {};
    var writer = root.JobBoredPipelineTransitions;
    if (writer && typeof writer.applyTransition === "function") {
      return Promise.resolve(writer.applyTransition(payload)).then(function (result) {
        if (result && typeof result === "object") return result;
        return { ok: true, mocked: false, payload: payload };
      });
    }
    var doc = root.document || (typeof document !== "undefined" ? document : null);
    var CE = root.CustomEvent || (typeof CustomEvent !== "undefined" ? CustomEvent : null);
    if (doc && typeof doc.dispatchEvent === "function" && typeof CE === "function") {
      doc.dispatchEvent(new CE("jb:pipeline:move", { detail: payload }));
    }
    return Promise.resolve({ ok: true, mocked: true, payload: payload });
  }

  root.JobBoredPipelineTransitionAdapter = {
    move: move,
  };
})(typeof window !== "undefined" ? window : globalThis);
