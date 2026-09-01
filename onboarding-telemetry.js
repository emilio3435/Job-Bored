/* ============================================
   Onboarding funnel telemetry — tiny, local-only event hook.

   The mandatory two-track onboarding chain (first-run -> discovery -> go-live,
   plus the "Finish setup" bar) emits one stable CustomEvent at each step so
   drop-off is observable. Privacy-safe + OSS-friendly: no network, no storage,
   no PII — just the step name plus the existing entryPoint label. Nothing
   listens by default, so this is a no-op until someone attaches a listener
   (devtools, a local dashboard, an opt-in analytics shim).

   Classic-global IIFE under window.JobBoredOnboardingTelemetry — matches every
   sibling module. Callers look it up lazily and guard the call, so a missing
   module never breaks the chain.
   ============================================ */
(function () {
  const root =
    window.JobBoredOnboardingTelemetry ||
    (window.JobBoredOnboardingTelemetry = {});

  const EVENT_NAME = "jobbored:onboarding";

  // Stable funnel vocabulary — frozen so a typo can't silently fork a step
  // name at runtime. Keep in sync with the chain's emit call sites.
  const STEPS = Object.freeze({
    FIRST_RUN_DONE: "first_run_done",
    DISCOVERY_OPENED: "discovery_opened",
    DISCOVERY_FINISHED: "discovery_finished",
    GO_LIVE_OPENED: "go_live_opened",
    GO_LIVE_FINISHED: "go_live_finished",
    LATER_PRESSED: "later_pressed",
    BOTH_DONE: "both_done",

    // One-flow vocabulary (ONE-FLOW-ONBOARDING-SPEC §9). The controller
    // (onboarding-flow.js) emits flow_opened / beat_opened / beat_completed /
    // beat_skipped / beat_abandoned / flow_completed itself; beats supply the
    // detail. key_check and first_results are emitted by the beats that own
    // those moments (B2/B5 key verification, B6's first discovery run).
    FLOW_OPENED: "flow_opened",
    BEAT_OPENED: "beat_opened",
    BEAT_COMPLETED: "beat_completed",
    BEAT_SKIPPED: "beat_skipped",
    BEAT_ABANDONED: "beat_abandoned",
    FLOW_COMPLETED: "flow_completed",
    KEY_CHECK: "key_check",
    FIRST_RESULTS: "first_results",
  });

  /**
   * Emit one funnel event. `step` is a STEPS value; `detail` carries only
   * non-PII context (e.g. the entryPoint). Best-effort: a thrown CustomEvent
   * or dispatch never bubbles up to the chain.
   */
  function emit(step, detail) {
    if (!step || typeof window.CustomEvent !== "function") return;
    try {
      const ev = new window.CustomEvent(EVENT_NAME, {
        detail: { step: String(step), ...(detail || {}) },
        bubbles: true,
      });
      if (typeof document !== "undefined" && document.dispatchEvent) {
        document.dispatchEvent(ev);
      }
    } catch (e) {
      console.warn("[JobBored] onboarding telemetry:", e);
    }
  }

  root.EVENT_NAME = EVENT_NAME;
  root.STEPS = STEPS;
  root.emit = emit;
})();
